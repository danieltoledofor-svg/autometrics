import { search, AdsContext } from './client';
import { supabaseAdmin, decryptSecret } from './server';
import { addUsage } from './sync';

/**
 * Etapa 0 — conferência diária com o Google.
 *
 * Pergunta ao Google o que ele registrou nos últimos 7 dias fechados e compara
 * com daily_metrics, no total da conta e campanha por campanha. Hoje fica de
 * fora: ainda está acumulando.
 *
 * A coleta de hora em hora já regrava o que mudou, então divergência aqui quer
 * dizer outra coisa: o script da MCC sobrescreveu o dia com outro valor, uma
 * gravação falhou, ou há campanha no Google que não chegou ao painel. Duas
 * consultas por conta, uma vez por dia.
 */

const DAYS = 7;
const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface Totals { impressions: number; clicks: number; cost: number; conversions: number }
/** No painel, conversões do Google podem faltar (dia gravado só pelo script). */
type PanelTotals = Omit<Totals, 'conversions'> & { conversions: number | null };

export interface ReconcileIssue {
  date: string;
  campaign_id: string | null;
  campaign: string;
  /** faltando: o Google tem gasto e o painel não · sobrando: o contrário · diferente: os dois têm, com valores diferentes · total: só o total da conta não bate */
  type: 'faltando' | 'sobrando' | 'diferente' | 'total';
  fields?: string[];
  google?: Totals;
  panel?: PanelTotals;
  source?: string | null;
}

export interface ReconcileSummary {
  start: string;
  end: string;
  days: number;
  divergent_days: number;
  issues: number;
  /** Soma do custo no Google menos no painel, no período. */
  cost_diff: number;
  google_cost: number;
  panel_cost: number;
  api_calls: number;
}

const n = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function todayIn(timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Um centavo, ou 0,2% em dias de gasto alto — o arredondamento do Google. */
const costDiffers = (a: number, b: number) => Math.abs(a - b) > Math.max(0.01, Math.abs(a) * 0.002);

export async function reconcileAccount(acc: any, refreshToken: string, usage: { calls: number }): Promise<ReconcileSummary> {
  const ctx: AdsContext = { refreshToken, customerId: acc.customer_id, loginCustomerId: acc.login_customer_id };
  const q = async (gaql: string) => { usage.calls++; return search(ctx, gaql); };
  const today = todayIn(acc.time_zone);
  const start = addDays(today, -DAYS);
  const end = addDays(today, -1);
  const range = `segments.date BETWEEN '${start}' AND '${end}'`;
  const calls0 = usage.calls;

  const [accountRows, campaignRows] = await Promise.all([
    q(`SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM customer WHERE ${range}`),
    q(`SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE ${range}`),
  ]);

  const toTotals = (m: any): Totals => ({
    impressions: n(m?.impressions), clicks: n(m?.clicks), cost: n(m?.costMicros) / 1e6, conversions: n(m?.conversions),
  });
  const googleDay = new Map<string, Totals>();
  for (const r of accountRows) googleDay.set(r.segments.date, toTotals(r.metrics));

  const googleCampaign = new Map<string, { name: string; t: Totals }>(); // campanha|dia
  const names = new Map<string, string>();
  for (const r of campaignRows) {
    const cid = String(r.campaign.id);
    names.set(cid, r.campaign.name);
    googleCampaign.set(`${cid}|${r.segments.date}`, { name: r.campaign.name, t: toTotals(r.metrics) });
  }

  // Produtos do painel desta conta: pelas campanhas que o Google citou e pelos
  // já marcados com a conta (para achar gasto no painel que o Google não tem).
  const db = supabaseAdmin();
  const products = new Map<string, { cid: string; name: string }>();
  const campaignIds = [...names.keys()];
  for (let i = 0; i < campaignIds.length; i += 200) {
    const { data } = await db.from('products').select('id, name, google_ads_campaign_id')
      .eq('user_id', acc.user_id).in('google_ads_campaign_id', campaignIds.slice(i, i + 200));
    for (const p of data || []) products.set(p.id, { cid: String(p.google_ads_campaign_id), name: p.name });
  }
  {
    const { data } = await db.from('products').select('id, name, google_ads_campaign_id')
      .eq('user_id', acc.user_id).eq('google_ads_customer_id', acc.customer_id);
    for (const p of data || []) products.set(p.id, { cid: String(p.google_ads_campaign_id || ''), name: p.name });
  }

  const panelCampaign = new Map<string, { t: PanelTotals; source: string | null }>();
  const productIds = [...products.keys()];
  let cols = 'product_id, date, impressions, clicks, cost, google_conversions, last_source';
  for (let i = 0; i < productIds.length; i += 100) {
    for (let page = 0; ; page++) {
      let { data, error } = await db.from('daily_metrics').select(cols)
        .in('product_id', productIds.slice(i, i + 100)).gte('date', start).lte('date', end)
        .range(page * 1000, page * 1000 + 999);
      if (error && cols.includes('last_source')) {
        cols = 'product_id, date, impressions, clicks, cost, google_conversions';
        ({ data, error } = await db.from('daily_metrics').select(cols)
          .in('product_id', productIds.slice(i, i + 100)).gte('date', start).lte('date', end)
          .range(page * 1000, page * 1000 + 999));
      }
      if (error) throw new Error(`Leitura do painel: ${error.message}`);
      for (const d of (data || []) as any[]) {
        const p = products.get(d.product_id)!;
        const k = `${p.cid}|${d.date}`;
        const prev = panelCampaign.get(k);
        const t = {
          impressions: n(d.impressions) + (prev?.t.impressions || 0),
          clicks: n(d.clicks) + (prev?.t.clicks || 0),
          cost: n(d.cost) + (prev?.t.cost || 0),
          conversions: d.google_conversions === null || d.google_conversions === undefined ? (prev?.t.conversions ?? null) : n(d.google_conversions) + (prev?.t.conversions || 0),
        };
        panelCampaign.set(k, { t, source: d.last_source ?? prev?.source ?? null });
        if (!names.has(p.cid)) names.set(p.cid, p.name);
      }
      if (!data || data.length < 1000) break;
    }
  }

  // Campanha por campanha, dia por dia.
  const issues: ReconcileIssue[] = [];
  const panelDay = new Map<string, PanelTotals>();
  const keys = new Set([...googleCampaign.keys(), ...panelCampaign.keys()]);
  for (const k of keys) {
    const [cid, date] = k.split('|');
    const g = googleCampaign.get(k)?.t;
    const p = panelCampaign.get(k);
    const name = names.get(cid) || `Campanha ${cid}`;
    if (p) {
      const pd = panelDay.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: null };
      pd.impressions += p.t.impressions; pd.clicks += p.t.clicks; pd.cost += p.t.cost;
      if (p.t.conversions !== null) pd.conversions = (pd.conversions || 0) + p.t.conversions;
      panelDay.set(date, pd);
    }
    if (g && !p) {
      if (g.cost > 0 || g.clicks > 0) issues.push({ date, campaign_id: cid, campaign: name, type: 'faltando', google: g });
      continue;
    }
    if (p && !g) {
      if (p.t.cost > 0.01 || p.t.clicks > 0) issues.push({ date, campaign_id: cid, campaign: name, type: 'sobrando', panel: p.t, source: p.source });
      continue;
    }
    if (!g || !p) continue;
    const fields: string[] = [];
    if (g.impressions !== p.t.impressions) fields.push('impressões');
    if (g.clicks !== p.t.clicks) fields.push('cliques');
    if (costDiffers(g.cost, p.t.cost)) fields.push('custo');
    if (p.t.conversions !== null && Math.abs(g.conversions - p.t.conversions) > 0.01) fields.push('conversões');
    if (fields.length) issues.push({ date, campaign_id: cid, campaign: name, type: 'diferente', fields, google: g, panel: p.t, source: p.source });
  }

  // Total da conta por dia. Se o total não bate sem nenhuma campanha explicar,
  // há gasto no Google fora das campanhas que o painel conhece.
  const dates = new Set([...googleDay.keys(), ...panelDay.keys()]);
  const rows: any[] = [];
  const summary: ReconcileSummary = { start, end, days: 0, divergent_days: 0, issues: 0, cost_diff: 0, google_cost: 0, panel_cost: 0, api_calls: 0 };
  for (const date of [...dates].sort()) {
    const g = googleDay.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    const p = panelDay.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: null };
    if (!g.cost && !g.clicks && !g.impressions && !p.cost && !p.clicks && !p.impressions) continue;
    const dayIssues = issues.filter(i => i.date === date);
    if (!dayIssues.length && (costDiffers(g.cost, p.cost) || g.clicks !== p.clicks)) {
      dayIssues.push({ date, campaign_id: null, campaign: 'Total da conta', type: 'total', google: g, panel: p });
    }
    const status = dayIssues.length ? 'divergente' : 'ok';
    rows.push({
      user_id: acc.user_id, account_id: acc.id, date, status,
      google_impressions: g.impressions, panel_impressions: p.impressions,
      google_clicks: g.clicks, panel_clicks: p.clicks,
      google_cost: g.cost, panel_cost: p.cost,
      google_conversions: g.conversions, panel_conversions: p.conversions,
      issues: dayIssues, checked_at: new Date().toISOString(),
    });
    summary.days++;
    if (status === 'divergente') summary.divergent_days++;
    summary.issues += dayIssues.length;
    summary.google_cost += g.cost;
    summary.panel_cost += p.cost;
  }
  summary.cost_diff = Math.round((summary.google_cost - summary.panel_cost) * 100) / 100;
  summary.google_cost = Math.round(summary.google_cost * 100) / 100;
  summary.panel_cost = Math.round(summary.panel_cost * 100) / 100;
  summary.api_calls = usage.calls - calls0;

  if (rows.length) {
    const { error } = await db.from('google_ads_reconciliations').upsert(rows, { onConflict: 'account_id, date' });
    if (error) throw new Error(`Gravação da conferência: ${error.message}`);
  }
  return summary;
}

/** Sem migration_conferencia.sql a conferência fica desligada — e não gasta cota. */
let tablesChecked: { ok: boolean; at: number } | null = null;
export async function reconcileReady(): Promise<boolean> {
  if (tablesChecked && Date.now() - tablesChecked.at < 10 * 60 * 1000) return tablesChecked.ok;
  const { error } = await supabaseAdmin().from('google_ads_reconciliations').select('id').limit(1);
  tablesChecked = { ok: !error, at: Date.now() };
  return tablesChecked.ok;
}

export function isReconcileDue(acc: any): boolean {
  return !acc.last_reconciled_at || Date.now() - new Date(acc.last_reconciled_at).getTime() >= RECONCILE_INTERVAL_MS;
}

/** Confere uma conta e grava o resultado nela. Erro de uma conta não derruba as outras. */
export async function reconcileAccountRecord(acc: any): Promise<ReconcileSummary | { account: string; error: string }> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const usage = { calls: 0 };
  try {
    const { data: conn } = await db.from('google_ads_connections').select('refresh_token_enc').eq('id', acc.connection_id).single();
    if (!conn) throw new Error('Conexão não encontrada');
    const summary = await reconcileAccount(acc, decryptSecret(conn.refresh_token_enc), usage);
    await db.from('google_ads_accounts').update({
      last_reconciled_at: now,
      last_reconcile_status: summary.divergent_days ? 'divergente' : 'ok',
      last_reconcile_summary: summary,
    }).eq('id', acc.id);
    return summary;
  } catch (e: any) {
    await db.from('google_ads_accounts').update({
      last_reconciled_at: now, last_reconcile_status: 'erro', last_reconcile_summary: { error: String(e.message).slice(0, 500) },
    }).eq('id', acc.id);
    return { account: acc.name, error: e.message };
  } finally {
    await addUsage(usage.calls).catch(() => {});
  }
}
