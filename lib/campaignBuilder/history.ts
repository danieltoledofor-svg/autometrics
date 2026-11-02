import { supabaseAdmin } from '@/lib/googleAds/server';

/**
 * Histórico das campanhas que o Autometrics criou ou duplicou, só para consultar.
 *
 * A fonte é google_ads_actions (action 'criar' ou 'duplicar', kind 'campanha'), gravada a cada
 * criação de verdade desde o primeiro dia do criador; os ensaios não entram. A situação vem do que
 * a coleta já guarda: products.google_status (a de hoje), daily_metrics (a de cada dia com dados,
 * reunida em períodos) e as pausas e ativações feitas pelo Autometrics. Nada aqui consulta o Google.
 */

export interface HistoryEvent {
  /** Data e hora (ISO) ou só o dia (AAAA-MM-DD). */
  quando: string;
  /** Último dia do período, quando o evento cobre vários dias. */
  ate?: string;
  texto: string;
  /** effective_status do período, para a cor. */
  status?: string;
  gasto?: number;
  conversoes?: number;
}

export interface HistoryItem {
  id: string;
  tipo: 'criar' | 'duplicar';
  quando: string;
  nome: string;
  conta_id: string;
  conta: string;
  mcc: string;
  campanha_id: string | null;
  ok: boolean;
  erro: string | null;
  /** Avisos do Google numa criação que deu certo (ex.: a meta de conversão não entrou). */
  aviso: string | null;
  origem: string | null;
  product_id: string | null;
  moeda: string | null;
  /** Situação mais recente lida do Google e o dia dela. */
  situacao: string | null;
  situacao_motivos: string | null;
  situacao_dia: string | null;
  gasto: number;
  conversoes: number;
  eventos: HistoryEvent[];
}

/** Nome curto de cada situação, como aparece na linha do tempo. */
export const STATUS_NAME: Record<string, string> = {
  ATIVA: 'Ativa', APRENDENDO: 'Ativa, aprendendo', LIMITADA: 'Ativa, limitada',
  PAUSADA: 'Pausada', AGENDADA: 'Agendada', ENCERRADA: 'Encerrada', REMOVIDA: 'Removida',
  NAO_VEICULANDO: 'Sem veiculação', DESCONHECIDO: 'Não informada pelo Google',
  SUSPENSA: 'Suspensa pelo Google', COM_ERRO: 'Sem veicular (configuração)', NAO_ELEGIVEL: 'Sem veicular',
  CONTA_SUSPENSA: 'Conta suspensa', CONTA_ENCERRADA: 'Conta encerrada',
};
const statusName = (s: string | null | undefined) => STATUS_NAME[String(s || '').toUpperCase()] || 'Não informada pelo Google';
const digits = (v: any) => String(v ?? '').replace(/\D/g, '');

/** Todas as linhas de uma consulta, de mil em mil (o limite do Supabase por resposta). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const chunks = <T,>(list: T[], size = 200) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

export async function campaignHistory(userId: string): Promise<HistoryItem[]> {
  const db = supabaseAdmin();
  const made = await all<any>((a, b) => db.from('google_ads_actions')
    .select('id, created_at, customer_id, campaign_id, action, target, target_key, new_status, ok, error')
    .eq('user_id', userId).eq('kind', 'campanha').in('action', ['criar', 'duplicar']).order('created_at', { ascending: false }).range(a, b));
  if (!made.length) return [];

  // Campanha de origem das duplicações: "origem <conta>/<campanha>".
  const originOf = (key: string | null) => { const m = /origem\s+(\d+)\/(\d+)/.exec(key || ''); return m ? m[2] : null; };
  const campaignIds = [...new Set(made.flatMap(r => [digits(r.campaign_id), originOf(r.target_key)]).filter(Boolean) as string[])];
  const accountIds = [...new Set(made.map(r => digits(r.customer_id)).filter(Boolean))];

  const products: any[] = [], accounts: any[] = [];
  await Promise.all([
    ...chunks(campaignIds).map(ids => db.from('products')
      .select('id, name, google_ads_campaign_name, google_ads_campaign_id, google_ads_customer_id, account_name, mcc_name, currency, is_hidden, google_status, google_status_reasons, google_status_date')
      .eq('user_id', userId).in('google_ads_campaign_id', ids).then(r => { products.push(...(r.data || [])); })),
    ...chunks(accountIds).map(ids => db.from('google_ads_accounts').select('customer_id, name, mcc_name, currency_code')
      .eq('user_id', userId).in('customer_id', ids).then(r => { accounts.push(...(r.data || [])); })),
  ]);
  const accountOf = new Map(accounts.map(a => [digits(a.customer_id), a]));

  // A mesma campanha pode ter mais de uma linha em products (uma por MCC que a enxerga). Vale a da
  // conta certa, não oculta, com a situação mais recente; as outras só completam os dias.
  const byCampaign = new Map<string, any[]>();
  for (const p of products) {
    const id = digits(p.google_ads_campaign_id);
    if (!byCampaign.has(id)) byCampaign.set(id, []);
    byCampaign.get(id)!.push(p);
  }
  const rank = (p: any, account: string) => [digits(p.google_ads_customer_id) === account ? 0 : 1, p.is_hidden ? 1 : 0, -(Date.parse(p.google_status_date || '') || 0)];
  const productsOf = (campaign: string, account: string) => (byCampaign.get(campaign) || []).slice().sort((x, y) => {
    const a = rank(x, account), b = rank(y, account);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });

  const createdIds = [...new Set(made.map(r => digits(r.campaign_id)).filter(Boolean))];
  const productIds = createdIds.flatMap(c => (byCampaign.get(c) || []).map(p => p.id));
  const days: any[] = [], moves: any[] = [];
  await Promise.all([
    ...chunks(productIds, 100).map(ids => all<any>((a, b) => db.from('daily_metrics')
      .select('product_id, date, effective_status, campaign_status, cost, conversions')
      .in('product_id', ids).order('date').range(a, b)).then(rows => { days.push(...rows); })),
    ...chunks(createdIds).map(ids => db.from('google_ads_actions').select('campaign_id, created_at, action, new_status, ok')
      .eq('user_id', userId).in('campaign_id', ids).in('action', ['pausar', 'ativar']).then(r => { moves.push(...(r.data || [])); })),
  ]);
  const daysOf = new Map<string, any[]>();
  for (const d of days) {
    if (!daysOf.has(d.product_id)) daysOf.set(d.product_id, []);
    daysOf.get(d.product_id)!.push(d);
  }

  return made.map(r => {
    const campaign = digits(r.campaign_id), account = digits(r.customer_id);
    const own = campaign ? productsOf(campaign, account) : [];
    const main = own[0];
    const acc = accountOf.get(account);
    const origin = originOf(r.target_key);
    const originProduct = origin ? productsOf(origin, '')[0] : null;
    const born = String(r.new_status || '').toUpperCase();

    const eventos: HistoryEvent[] = [];
    // Um dia por data: a linha principal primeiro, as outras só onde ela não tem o dia.
    const perDay = new Map<string, any>();
    for (const p of own) for (const d of daysOf.get(p.id) || []) if (!perDay.has(d.date)) perDay.set(d.date, d);
    const sorted = [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    let gasto = 0, conversoes = 0;
    for (const d of sorted) {
      const status = String(d.effective_status || (d.campaign_status === 'PAUSED' ? 'PAUSADA' : d.campaign_status === 'ENABLED' ? 'ATIVA' : 'DESCONHECIDO')).toUpperCase();
      const cost = Number(d.cost) || 0, conv = Number(d.conversions) || 0;
      gasto += cost; conversoes += conv;
      const last = eventos[eventos.length - 1];
      if (last && last.status === status && last.gasto !== undefined) { last.ate = d.date; last.gasto! += cost; last.conversoes! += conv; }
      else eventos.push({ quando: d.date, ate: d.date, status, texto: statusName(status), gasto: cost, conversoes: conv });
    }
    for (const m of moves) {
      if (digits(m.campaign_id) !== campaign || !m.ok || Date.parse(m.created_at) < Date.parse(r.created_at)) continue;
      eventos.push({ quando: m.created_at, status: m.action === 'pausar' ? 'PAUSADA' : 'ATIVA', texto: m.action === 'pausar' ? 'Pausada pelo Autometrics' : 'Ativada pelo Autometrics' });
    }
    // Períodos entram pelo meio do dia: a pausa feita de manhã aparece antes do período que começa no mesmo dia.
    const key = (e: HistoryEvent) => (e.quando.length === 10 ? `${e.quando}T12:00:00Z` : e.quando);
    eventos.sort((a, b) => key(a).localeCompare(key(b)));
    eventos.unshift({
      quando: r.created_at, status: r.ok ? (born === 'PAUSED' ? 'PAUSADA' : 'ATIVA') : undefined,
      texto: !r.ok ? 'O Google recusou a criação'
        : `${r.action === 'duplicar' ? 'Duplicada' : 'Criada'} pelo Autometrics, ${born === 'PAUSED' ? 'nasceu pausada' : 'nasceu ativa'}`,
    });
    if (main?.google_status) eventos.push({ quando: main.google_status_date || '', status: main.google_status, texto: `Situação mais recente: ${statusName(main.google_status)}` });

    return {
      id: r.id, tipo: r.action === 'duplicar' ? 'duplicar' : 'criar', quando: r.created_at,
      nome: main?.google_ads_campaign_name || r.target || main?.name || 'Campanha sem nome',
      conta_id: account, conta: acc?.name || main?.account_name || `Conta ${account}`,
      mcc: main?.mcc_name || acc?.mcc_name || '',
      campanha_id: campaign || null, ok: !!r.ok, erro: r.ok ? null : r.error || null, aviso: r.ok ? r.error || null : null,
      origem: origin ? (originProduct?.google_ads_campaign_name || originProduct?.name || `campanha ${origin}`) : null,
      product_id: main?.id || null, moeda: main?.currency || acc?.currency_code || null,
      situacao: main?.google_status || (r.ok ? null : 'RECUSADA'), situacao_motivos: main?.google_status_reasons || null, situacao_dia: main?.google_status_date || null,
      gasto: Math.round(gasto * 100) / 100, conversoes: Math.round(conversoes * 100) / 100, eventos,
    } satisfies HistoryItem;
  });
}
