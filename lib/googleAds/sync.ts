import { search, AdsContext, GoogleAdsError } from './client';
import { supabaseAdmin, decryptSecret } from './server';
import { ingestCampaignDay } from './ingest';
import { campaignMetricFields, normalizeMetrics, selectableFields, metricFieldsFor } from './fields';
import { DIMENSION_STORED_METRICS, mergeGoogleMetrics } from '@/lib/metrics/catalog';
import { ACTION_SELECT, ACTION_WHERE, addActionRow, stableActions } from './conversionActions';
import type { ActionCounts } from '@/lib/metrics/dimension';
import { syncEntities, EntitySyncResult } from './entities';
import { syncAssets } from './assets';

/**
 * Coleta direta pela Google Ads API.
 *
 * Faz o mesmo que o script, com três diferenças que atacam o problema do custo:
 *
 * 1. Uma consulta traz todas as campanhas × todos os dias da janela, em vez de
 *    uma consulta por dia por campanha. A coleta de uma conta leva segundos e
 *    pode rodar a cada poucos minutos.
 * 2. A janela inteira (30 dias por padrão) é relida a cada rodada. Quando o
 *    Google devolve custo de cliques inválidos dias depois, a revisão chega
 *    sozinha — e o ingest já registra o valor anterior em cost_previous.
 * 3. Dia antigo que não mudou não é regravado, então reler 30 dias é barato.
 *
 * Os dados passam pelo mesmo ingestCampaignDay do webhook: script e API gravam
 * idêntico enquanto convivem.
 */

export interface AccountRow {
  id: string;
  user_id: string;
  connection_id: string;
  customer_id: string;
  login_customer_id: string;
  name: string;
  mcc_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  status: string | null;
  last_deep_sync_at?: string | null;
  entities_synced_at?: string | null;
}

export interface SyncSummary {
  account: string;
  campaigns: number;
  days_written: number;
  days_unchanged: number;
  deep: boolean;
  api_calls: number;
  enabled_campaigns: number;
  cost_today: number;
  /** Grupos, anúncios e palavras-chave — só na coleta profunda. */
  entities?: EntitySyncResult;
  entities_full?: boolean;
  /** Sitelinks, frases de destaque e promoções gravados. */
  assets?: number;
  /** Dias passados que ganharam orçamento/meta pelo histórico de alterações. */
  backfilled_days?: number;
  errors: string[];
}

const LOOKBACK_DAYS = Math.max(1, Number(process.env.GOOGLE_ADS_LOOKBACK_DAYS) || 30);
/** Termos, públicos, locais e histórico: hoje e os 3 dias anteriores, como o script. */
const DEEP_DAYS_BACK = 3;
const TOP_SEARCH_TERMS = 200;
const INGEST_CONCURRENCY = 4;

const GEO_NAMES: Record<string, string> = {
  '2076': 'Brasil', '2840': 'Estados Unidos', '2826': 'Reino Unido',
  '2124': 'Canadá', '2036': 'Austrália', '2250': 'França',
  '2276': 'Alemanha', '2724': 'Espanha', '2380': 'Itália',
  '2392': 'Japão', '2484': 'México', '2032': 'Argentina',
  '2152': 'Chile', '2170': 'Colômbia', '2604': 'Peru',
  '2620': 'Portugal', '2703': 'Eslováquia', '2528': 'Países Baixos',
  '2056': 'Bélgica', '2040': 'Áustria', '2616': 'Polônia',
};
const geoCache = new Map<string, string>(Object.entries(GEO_NAMES));

// ── datas ───────────────────────────────────────────────────────────────────

/** Data de hoje no fuso da conta — o mesmo dia que o Google usa em segments.date. */
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

const n = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// ── histórico (change_event) ────────────────────────────────────────────────

const toSnake = (s: string) => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** Valor de 'amountMicros' dentro de { campaignBudget: { amountMicros } }. */
function valueAt(resource: any, path: string): any {
  if (!resource) return undefined;
  const parts = path.split('.').map(toCamel);
  const walk = (obj: any) => parts.reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
  const direct = walk(resource);
  if (direct !== undefined) return direct;
  // changed_fields é relativo ao recurso alterado, que vem embrulhado em
  // old_resource/new_resource sob o nome do tipo (campaign, campaignBudget...).
  for (const inner of Object.values(resource)) {
    if (inner && typeof inner === 'object') {
      const v = walk(inner);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** Igual ao formatarValor do script: micros viram valor legível. */
function formatValue(v: any): string {
  if (v === null || v === undefined || typeof v === 'object') return '';
  const x = Number(v);
  if (!isNaN(x) && Math.abs(x) >= 10000 && x % 10000 === 0) return String(x / 1_000_000);
  return String(v);
}

/** Meta atual da campanha: CPA alvo (na moeda da conta) ou ROAS alvo. */
function campaignTarget(camp: any): number {
  if (n(camp?.maximizeConversions?.targetCpaMicros)) return n(camp.maximizeConversions.targetCpaMicros) / 1e6;
  if (n(camp?.targetCpa?.targetCpaMicros)) return n(camp.targetCpa.targetCpaMicros) / 1e6;
  if (n(camp?.maximizeConversionValue?.targetRoas)) return n(camp.maximizeConversionValue.targetRoas);
  if (n(camp?.targetRoas?.targetRoas)) return n(camp.targetRoas.targetRoas);
  return 0;
}

const TARGET_PATHS: [string, number][] = [
  ['maximize_conversions.target_cpa_micros', 1e6],
  ['target_cpa.target_cpa_micros', 1e6],
  ['maximize_conversion_value.target_roas', 1],
  ['target_roas.target_roas', 1],
];

/**
 * Orçamento e meta de cada dia que passou, a partir do histórico de alterações.
 *
 * O Google só informa o valor atual. Partindo dele e desfazendo, da mais nova
 * para a mais antiga, cada alteração feita depois de um dia, chega-se ao valor
 * que valia no fim daquele dia. O histórico da API cobre 30 dias.
 */
export function reconstructDaily(
  current: number,
  changes: { date: string; before: number }[],
  days: string[],
): Map<string, number> {
  const sorted = [...changes].sort((a, b) => b.date.localeCompare(a.date));
  const out = new Map<string, number>();
  let value = current;
  let i = 0;
  for (const day of [...days].sort().reverse()) {
    while (i < sorted.length && sorted[i].date > day) value = sorted[i++].before;
    out.set(day, value);
  }
  return out;
}

function describeChanges(ev: any) {
  const raw = ev.changedFields;
  const list: string[] = !raw ? [] : typeof raw === 'string' ? raw.split(',') : (raw.paths || raw);
  const out: { f: string; de: string; para: string }[] = [];
  for (const p of list) {
    const path = String(p).trim();
    if (!path) continue;
    const before = valueAt(ev.oldResource, path);
    const after = valueAt(ev.newResource, path);
    if (before === undefined && after === undefined) continue;
    // O webhook traduz pelo nome em snake_case (amount_micros → "valor").
    out.push({ f: path.split('.').map(toSnake).join('.'), de: formatValue(before), para: formatValue(after) });
  }
  return out;
}

/**
 * Guarda cada alteração do histórico de forma estruturada. É por ela que a
 * análise sabe quando uma sugestão foi aplicada no Google (lib/analysis/track.ts)
 * — a anotação em daily_metrics.notes é só texto.
 */
async function saveChanges(rows: any[], productIdFor: (cid: string) => string | undefined, errors: string[]) {
  const out = new Map<string, any>();
  for (const r of rows) {
    const ev = r.changeEvent || {};
    const cid = String(ev.campaign || '').split('/').pop() || '';
    const pid = productIdFor(cid);
    const at = String(ev.changeDateTime || '').split('.')[0];
    if (!pid || !at || !ev.changeResourceName) continue;
    const row = {
      product_id: pid, changed_at: at,
      resource_type: ev.changeResourceType || null,
      operation: ev.resourceChangeOperation || null,
      resource_name: ev.changeResourceName,
      fields: describeChanges(ev),
      new_resource: ev.newResource || null,
    };
    out.set(`${pid}|${row.resource_name}|${at}`, row);
  }
  if (!out.size) return;
  const list = [...out.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await supabaseAdmin().from('google_ads_changes')
      .upsert(list.slice(i, i + 500), { onConflict: 'product_id, resource_name, changed_at', ignoreDuplicates: true });
    // Antes de migration_analise_ia.sql a tabela não existe; a coleta segue.
    if (error) { if (!/google_ads_changes/.test(error.message)) errors.push(`alterações: ${error.message}`); return; }
  }
}

// ── coleta ──────────────────────────────────────────────────────────────────

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function syncAccount(
  account: AccountRow,
  refreshToken: string,
  opts: { deep?: boolean; usage?: { calls: number } } = {},
): Promise<SyncSummary> {
  const ctx: AdsContext = { refreshToken, customerId: account.customer_id, loginCustomerId: account.login_customer_id };
  const today = todayIn(account.time_zone);
  const start = addDays(today, -(LOOKBACK_DAYS - 1));
  const deepStart = addDays(today, -DEEP_DAYS_BACK);
  const deep = !!opts.deep;
  let apiCalls = 0;
  // A consulta conta na cota mesmo quando falha; o contador de fora sobrevive
  // a um erro no meio da coleta.
  const usage = opts.usage || { calls: 0 };
  const q = async (gaql: string) => { apiCalls++; usage.calls++; return search(ctx, gaql); };
  const optional = async (label: string, gaql: string, errors: string[]) => {
    try { return await q(gaql); } catch (e: any) { errors.push(`${label}: ${e.message}`); return []; }
  };

  const summary: SyncSummary = {
    account: account.name, campaigns: 0, days_written: 0, days_unchanged: 0, deep,
    api_calls: 0, enabled_campaigns: 0, cost_today: 0, errors: [],
  };
  const errors = summary.errors;

  // 1. Estado atual de cada campanha. Sem segments.date, então vem também a
  //    campanha pausada que não gastou nada — é assim que o status dela chega.
  // O essencial vai sempre; o resto só se existir nesta versão da API — as
  // datas, por exemplo, mudaram de nome (start_date → start_date_time).
  const optionalCampaignFields = [
    'campaign.target_cpa.target_cpa_micros', 'campaign.target_roas.target_roas',
    'campaign.maximize_conversions.target_cpa_micros', 'campaign.maximize_conversion_value.target_roas',
    'campaign.advertising_channel_type', 'campaign.advertising_channel_sub_type',
    'campaign.start_date', 'campaign.end_date', 'campaign.start_date_time', 'campaign.end_date_time',
    'campaign.optimization_score', 'campaign.campaign_budget',
  ];
  const available = await selectableFields(refreshToken, optionalCampaignFields, usage);
  const statusRows = await q(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status,
           campaign.primary_status, campaign.primary_status_reasons,
           campaign.bidding_strategy_type, campaign_budget.amount_micros,
           ${optionalCampaignFields.filter(f => available.has(f)).map(f => `${f}, `).join('')}
           customer.currency_code, customer.status
    FROM campaign`);

  // 2. Métricas por dia da janela inteira, numa consulta só. A lista de campos
  //    vem da própria API: pedir uma métrica que a versão não tem derruba a
  //    consulta inteira, e o Google muda esse conjunto a cada versão.
  const metricFields = await campaignMetricFields(refreshToken, usage);
  const metricRows = await q(`
    SELECT campaign.id, segments.date, ${metricFields.join(', ')}
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${today}'`);

  // 3. Diagnóstico profundo, só dos últimos dias e só quando for a vez.
  const range = `segments.date BETWEEN '${deepStart}' AND '${today}'`;
  // Cada visão do Google aceita um conjunto de métricas; pede-se o bloco
  // completo que ela tiver, para as colunas e filtros do painel.
  const BASE = ['metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.conversions'];
  const metricsFor = async (resource: string) =>
    [...new Set([...BASE, ...(await metricFieldsFor(refreshToken, resource, DIMENSION_STORED_METRICS, usage))])];
  const bags: Record<string, string[]> = {};
  if (deep) {
    for (const r of ['search_term_view', 'age_range_view', 'gender_view', 'income_range_view', 'campaign', 'geographic_view']) {
      bags[r] = await metricsFor(r);
    }
  }
  const m = (resource: string) => (bags[resource] || BASE).join(', ');
  // Algumas métricas não combinam com certos segmentos (dispositivo, por
  // exemplo). Se o Google recusar a consulta completa, refaz só com o básico
  // e o dado não se perde.
  const rich = async (label: string, resource: string, build: (metrics: string) => string) => {
    try { return await q(build(m(resource))); } catch (e: any) {
      if (!bags[resource] || bags[resource].length === BASE.length) { errors.push(`${label}: ${e.message}`); return []; }
      console.warn(`[google-ads] ${label}: métricas extras recusadas, seguiu com o básico — ${e.message}`);
      bags[resource] = BASE;
      return optional(label, build(BASE.join(', ')), errors);
    }
  };
  // Termo com a palavra-chave que o acionou, o grupo e o status. Se o Google
  // recusar esses campos, cai para o termo sozinho, como antes.
  const TERM_KW = 'search_term_view.status, segments.search_term_match_type, segments.keyword.info.text, segments.keyword.info.match_type, ad_group.name';
  let termsWithKeyword = true;
  const termsQuery = async () => {
    const build = (mt: string, kw: boolean) =>
      `SELECT campaign.id, segments.date, search_term_view.search_term, ${kw ? `${TERM_KW}, ` : ''}${mt} FROM search_term_view WHERE ${range} AND metrics.impressions > 0`;
    try { return await q(build(m('search_term_view'), true)); } catch (e1: any) {
      try {
        const rows = await q(build(BASE.join(', '), true));
        console.warn(`[google-ads] termos: métricas extras recusadas, seguiu com o básico — ${e1.message}`);
        bags.search_term_view = BASE;
        return rows;
      } catch (e2: any) {
        termsWithKeyword = false;
        bags.search_term_view = BASE;
        errors.push(`termos (sem palavra-chave): ${e2.message}`);
        return optional('termos', build(BASE.join(', '), false), errors);
      }
    }
  };
  const [adRows, stRows, ageRows, genderRows, incomeRows, deviceRows, geoRows, changeRows] = deep
    ? await Promise.all([
        optional('url', `SELECT campaign.id, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'`, errors),
        termsQuery(),
        rich('idade', 'age_range_view', mt => `SELECT campaign.id, segments.date, ad_group_criterion.age_range.type, ${mt} FROM age_range_view WHERE ${range} AND metrics.impressions > 0`),
        rich('gênero', 'gender_view', mt => `SELECT campaign.id, segments.date, ad_group_criterion.gender.type, ${mt} FROM gender_view WHERE ${range} AND metrics.impressions > 0`),
        rich('renda', 'income_range_view', mt => `SELECT campaign.id, segments.date, ad_group_criterion.income_range.type, ${mt} FROM income_range_view WHERE ${range} AND metrics.impressions > 0`),
        rich('dispositivo', 'campaign', mt => `SELECT campaign.id, segments.date, segments.device, ${mt} FROM campaign WHERE ${range} AND metrics.impressions > 0`),
        rich('local', 'geographic_view', mt => `SELECT campaign.id, segments.date, geographic_view.country_criterion_id, geographic_view.location_type, ${mt} FROM geographic_view WHERE ${range} AND metrics.impressions > 0`),
        optional('histórico', `SELECT change_event.change_date_time, change_event.change_resource_type, change_event.change_resource_name, change_event.resource_change_operation, change_event.user_email, change_event.changed_fields, change_event.old_resource, change_event.new_resource, change_event.campaign FROM change_event WHERE change_event.change_date_time >= '${deepStart} 00:00:00' AND change_event.change_date_time <= '${today} 23:59:59' ORDER BY change_event.change_date_time DESC LIMIT 2000`, errors),
      ])
    : [[], [], [], [], [], [], [], []];
  const bagOf = (resource: string, r: any) => normalizeMetrics(r.metrics, bags[resource] || BASE);

  // Conversões por ação (Checkout, Compra…), por campanha e dia, na janela
  // inteira: o Google conta conversão com atraso, e dia antigo também muda.
  // null = consulta não rodou; aí o que está gravado fica como está.
  const [campaignActionRows, termActionRows] = deep
    ? await Promise.all([
        optional('ações de conversão', `SELECT campaign.id, segments.date, ${ACTION_SELECT} FROM campaign WHERE segments.date BETWEEN '${start}' AND '${today}' AND ${ACTION_WHERE}`, errors),
        optional('termos (ações de conversão)', `SELECT campaign.id, segments.date, search_term_view.search_term, ${termsWithKeyword ? 'segments.keyword.info.text, segments.keyword.info.match_type, ' : ''}${ACTION_SELECT} FROM search_term_view WHERE ${range} AND ${ACTION_WHERE}`, errors),
      ])
    : [null, null];
  const campaignActions = new Map<string, ActionCounts>();
  for (const r of campaignActionRows || []) addActionRow(campaignActions, `${r.campaign.id}|${r.segments.date}`, r);
  const actionsQueried = deep && !errors.some(e => e.startsWith('ações de conversão'));
  const termKey = (r: any) => `${r.searchTermView?.searchTerm}|${r.segments?.keyword?.info?.text || ''}|${r.segments?.keyword?.info?.matchType || ''}`;
  const termActions = new Map<string, ActionCounts>();
  for (const r of termActionRows || []) addActionRow(termActions, `${r.campaign.id}|${r.segments.date}|${termKey(r)}`, r);

  // Nome dos países que não estão no dicionário local.
  const unknownGeo = [...new Set(geoRows.map((r: any) => String(r.geographicView?.countryCriterionId || '')))]
    .filter(id => id && !geoCache.has(id));
  if (unknownGeo.length) {
    const rows = await optional('nomes de país',
      `SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (${unknownGeo.join(',')})`, errors);
    for (const r of rows) geoCache.set(String(r.geoTargetConstant?.id), r.geoTargetConstant?.name);
  }

  // ── Organiza por campanha|dia ─────────────────────────────────────────────
  const key = (cid: any, date: string) => `${cid}|${date}`;
  const campaigns = new Map<string, any>();
  let accountStatus = 'UNKNOWN';
  let currency = account.currency_code || 'BRL';
  for (const r of statusRows) {
    campaigns.set(String(r.campaign.id), r);
    accountStatus = r.customer?.status || accountStatus;
    currency = r.customer?.currencyCode || currency;
  }
  summary.campaigns = campaigns.size;

  const finalUrls = new Map<string, string>();
  for (const r of adRows) {
    const cid = String(r.campaign?.id);
    const url = r.adGroupAd?.ad?.finalUrls?.[0];
    if (url && !finalUrls.has(cid)) finalUrls.set(cid, url);
  }

  const searchTerms = new Map<string, Map<string, any>>();
  for (const r of stRows) {
    const k = key(r.campaign.id, r.segments.date);
    const term = r.searchTermView?.searchTerm;
    if (!term) continue;
    if (!searchTerms.has(k)) searchTerms.set(k, new Map());
    const m = searchTerms.get(k)!;
    const tk = termKey(r);
    const kwInfo = r.segments?.keyword?.info || {};
    const cur = m.get(tk) || {
      t: term, i: 0, cl: 0, c: 0, cv: 0, g: null,
      kw: kwInfo.text || '', km: kwInfo.matchType || '',
      ag: r.adGroup?.name || null, st: r.searchTermView?.status || null, tm: r.segments?.searchTermMatchType || null,
      ca: termActions.get(`${k}|${tk}`) || (termActionRows ? {} : undefined),
    };
    cur.i += n(r.metrics?.impressions);
    cur.cl += n(r.metrics?.clicks);
    cur.c += n(r.metrics?.costMicros);
    cur.cv += n(r.metrics?.conversions);
    const g = bagOf('search_term_view', r);
    cur.g = cur.g ? mergeGoogleMetrics(cur.g, g) : g;
    m.set(tk, cur);
  }

  const audiences = new Map<string, Map<string, any>>();
  const addAudience = (r: any, tp: string, name: string | undefined, resource: string) => {
    if (!name) return;
    const k = key(r.campaign.id, r.segments.date);
    if (!audiences.has(k)) audiences.set(k, new Map());
    const m = audiences.get(k)!;
    const cur = m.get(`${tp}|${name}`) || { tp, n: name, i: 0, cl: 0, c: 0, cv: 0, g: null };
    cur.i += n(r.metrics?.impressions);
    cur.cl += n(r.metrics?.clicks);
    cur.c += n(r.metrics?.costMicros);
    cur.cv += n(r.metrics?.conversions);
    const g = bagOf(resource, r);
    cur.g = cur.g ? mergeGoogleMetrics(cur.g, g) : g;
    m.set(`${tp}|${name}`, cur);
  };
  for (const r of ageRows) addAudience(r, 'Age', r.adGroupCriterion?.ageRange?.type, 'age_range_view');
  for (const r of genderRows) addAudience(r, 'Gender', r.adGroupCriterion?.gender?.type, 'gender_view');
  for (const r of incomeRows) addAudience(r, 'Income', r.adGroupCriterion?.incomeRange?.type, 'income_range_view');
  for (const r of deviceRows) addAudience(r, 'Device', r.segments?.device, 'campaign');

  // Por país fica só a linha com mais impressões: o Google repete o país por
  // tipo de localização (presença / interesse) e somar duplicaria.
  const locations = new Map<string, Map<string, any>>();
  for (const r of geoRows) {
    const k = key(r.campaign.id, r.segments.date);
    const countryId = String(r.geographicView?.countryCriterionId || '');
    if (!countryId) continue;
    if (!locations.has(k)) locations.set(k, new Map());
    const m = locations.get(k)!;
    const impr = n(r.metrics?.impressions);
    if (!m.has(countryId) || impr > m.get(countryId).i) {
      m.set(countryId, {
        tp: 'Country',
        n: geoCache.get(countryId) || `País ${countryId}`,
        i: impr,
        cl: n(r.metrics?.clicks),
        c: Math.round(n(r.metrics?.costMicros) / 1000), // mesma unidade do script
        cv: n(r.metrics?.conversions),
        g: bagOf('geographic_view', r),
      });
    }
  }

  const history = new Map<string, any[]>();
  for (const r of changeRows) {
    const ev = r.changeEvent || {};
    const cid = String(ev.campaign || '').split('/').pop();
    const [date, timeRaw = ''] = String(ev.changeDateTime || '').split(' ');
    if (!cid || !date) continue;
    const k = key(cid, date);
    if (!history.has(k)) history.set(k, []);
    history.get(k)!.push({
      time: timeRaw.split('.')[0],
      type: ev.changeResourceType || '',
      op: ev.resourceChangeOperation || '',
      user: ev.userEmail || '',
      fields: describeChanges(ev),
    });
  }

  // ── O que já está gravado, para não regravar dia antigo igual ─────────────
  const db = supabaseAdmin();
  const campaignIds = [...new Set([...campaigns.keys(), ...metricRows.map((r: any) => String(r.campaign.id))])];
  const productByCampaign = new Map<string, string>();
  for (let i = 0; i < campaignIds.length; i += 200) {
    const { data } = await db.from('products').select('id, google_ads_campaign_id')
      .eq('user_id', account.user_id).in('google_ads_campaign_id', campaignIds.slice(i, i + 200));
    for (const p of data || []) productByCampaign.set(String(p.google_ads_campaign_id), p.id);
  }
  // O que já está gravado, para não regravar dia que não mudou. Conversões
  // entram na comparação: o Google as conta com atraso, e um dia antigo com
  // os mesmos cliques e custo ainda pode ganhar conversões.
  const stored = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; actions: string | null; budget: number; target: number }>();
  const productIds = [...new Set(productByCampaign.values())];
  let storedCols = 'product_id, date, impressions, clicks, cost, budget_micros, target_cpa, google_conversions, google_conversion_actions';
  for (let i = 0; i < productIds.length; i += 100) {
    for (let page = 0; ; page++) {
      let { data, error } = await db.from('daily_metrics').select(storedCols)
        .in('product_id', productIds.slice(i, i + 100)).gte('date', start).lte('date', today)
        .range(page * 1000, page * 1000 + 999);
      if (error && storedCols.includes('google_conversion_actions')) {
        // Antes de migration_termos_conversoes.sql.
        storedCols = 'product_id, date, impressions, clicks, cost, budget_micros, target_cpa, google_conversions';
        ({ data, error } = await db.from('daily_metrics').select(storedCols)
          .in('product_id', productIds.slice(i, i + 100)).gte('date', start).lte('date', today)
          .range(page * 1000, page * 1000 + 999));
      }
      for (const d of (data || []) as any[]) stored.set(`${d.product_id}|${d.date}`, {
        impressions: n(d.impressions), clicks: n(d.clicks), cost: n(d.cost), conversions: n(d.google_conversions),
        actions: 'google_conversion_actions' in d ? stableActions(d.google_conversion_actions) : null,
        budget: n(d.budget_micros), target: n(d.target_cpa),
      });
      if (!data || data.length < 1000) break;
    }
  }

  // ── Monta os dias no formato do script ────────────────────────────────────
  const payloads: any[] = [];
  const withActivityToday = new Set<string>();

  const buildPayload = (cid: string, date: string, m: any) => {
    const c = campaigns.get(cid) || {};
    const camp = c.campaign || {};
    const recent = date >= deepStart;
    const k = key(cid, date);
    const target = campaignTarget(camp);

    return {
      script_version: 'api',
      user_id: account.user_id,
      campaign_name: camp.name || `Campanha ${cid}`,
      campaign_id: cid,
      date,
      account_name: account.name,
      mcc_name: account.mcc_name || 'Sem MCC',
      currency_code: currency,
      metrics: {
        impressions: n(m?.impressions),
        clicks: n(m?.clicks),
        ctr: n(m?.ctr),
        average_cpc: n(m?.averageCpc),
        cost_micros: n(m?.costMicros),
        search_impression_share: m?.searchImpressionShare,
        search_top_impression_share: m?.searchTopImpressionShare,
        search_abs_top_share: m?.searchAbsoluteTopImpressionShare,
        bidding_strategy_type: camp.biddingStrategyType,
        budget_micros: n(c.campaignBudget?.amountMicros),
        status: camp.status || 'UNKNOWN',
        serving_status: camp.servingStatus || '',
        primary_status: camp.primaryStatus || '',
        status_reasons: (camp.primaryStatusReasons || []).join(','),
        account_status: accountStatus,
        final_url: finalUrls.get(cid) || '',
        target_value: target,
        // Bloco completo do Google, já normalizado (micros convertidos).
        google_metrics: normalizeMetrics(m, metricFields),
        ...(actionsQueried ? { google_conversion_actions: campaignActions.get(k) || {} } : {}),
      },
      campaign_settings: {
        channel_type: camp.advertisingChannelType || null,
        channel_sub_type: camp.advertisingChannelSubType || null,
        start_date: camp.startDate || String(camp.startDateTime || '').slice(0, 10) || null,
        end_date: camp.endDate || String(camp.endDateTime || '').slice(0, 10) || null,
        optimization_score: n(camp.optimizationScore) || null,
      },
      // Os de mais impressões, e nunca corta um termo que converteu.
      search_terms: recent && searchTerms.has(k)
        ? [...searchTerms.get(k)!.values()].sort((a, b) => b.i - a.i)
            .filter((t, idx) => idx < TOP_SEARCH_TERMS || t.cv > 0 || Object.keys(t.ca || {}).length > 0)
        : [],
      audiences: recent && audiences.has(k) ? [...audiences.get(k)!.values()] : [],
      locations: recent && locations.has(k)
        ? [...locations.get(k)!.values()].sort((a, b) => b.i - a.i).slice(0, 5)
        : [],
      history: recent ? history.get(k) || [] : [],
    };
  };

  for (const r of metricRows) {
    const cid = String(r.campaign.id);
    const date = r.segments.date;
    const m = r.metrics || {};
    const hasActivity = n(m.impressions) > 0 || n(m.clicks) > 0 || n(m.costMicros) > 0;
    if (!hasActivity) continue;
    if (date === today) {
      withActivityToday.add(cid);
      summary.cost_today += n(m.costMicros) / 1e6;
    }

    // Dia fora da janela do diagnóstico e idêntico ao gravado: nada a fazer.
    const pid = productByCampaign.get(cid);
    const prev = pid ? stored.get(`${pid}|${date}`) : undefined;
    if (date < deepStart && prev
        && prev.impressions === n(m.impressions)
        && prev.clicks === n(m.clicks)
        && Math.abs(prev.cost - n(m.costMicros) / 1e6) < 0.005
        && Math.abs(prev.conversions - n(m.conversions)) < 0.001
        && (!actionsQueried || prev.actions === null || prev.actions === stableActions(campaignActions.get(key(cid, date)) || {}))) {
      summary.days_unchanged++;
      continue;
    }
    payloads.push(buildPayload(cid, date, m));
  }

  // Campanha sem gasto hoje: manda só o status, como o script faz, para uma
  // pausa ou suspensão aparecer no painel mesmo sem atividade.
  for (const [cid, c] of campaigns) {
    const status = c.campaign?.status;
    if (status === 'ENABLED') summary.enabled_campaigns++;
    if (status === 'REMOVED' || withActivityToday.has(cid)) continue;
    // Só interessa se o painel já conhece a campanha ou se ela está ligada.
    if (!productByCampaign.has(cid) && status !== 'ENABLED') continue;
    payloads.push(buildPayload(cid, today, null));
  }

  payloads.sort((a, b) => a.date.localeCompare(b.date));

  // Três etapas, por causa de corridas no ingest:
  // 1. campanha nova, um dia só e em série — senão o produto nasce duplicado;
  // 2. dias anteriores, em paralelo;
  // 3. hoje por último, para o status atual não ser sobrescrito por um dia
  //    antigo que terminou de gravar depois.
  const firstOfNew = new Map<string, any>();
  for (const p of payloads) {
    if (!productByCampaign.has(p.campaign_id) && !firstOfNew.has(p.campaign_id)) firstOfNew.set(p.campaign_id, p);
  }
  const ingestOne = async (p: any) => {
    const res = await ingestCampaignDay(p, { keepExistingMcc: true, customerId: account.customer_id, today });
    if (res.status !== 200) errors.push(`${p.campaign_name} ${p.date}: ${res.body?.error || res.body?.message}`);
    else {
      summary.days_written++;
      for (const e of res.body?.diag?.errors || []) errors.push(`${p.campaign_name} ${p.date}: ${e}`);
    }
  };
  for (const p of firstOfNew.values()) await ingestOne(p);
  const firsts = new Set(firstOfNew.values());
  const rest = payloads.filter(p => !firsts.has(p));
  await runPool(rest.filter(p => p.date !== today), INGEST_CONCURRENCY, ingestOne);
  await runPool(rest.filter(p => p.date === today), INGEST_CONCURRENCY, ingestOne);

  // Dias passados sem orçamento ou meta: reconstrói pelo histórico de
  // alterações. Só preenche o que está vazio — valor gravado quando o dia era
  // "hoje" é o registro mais fiel e fica como está.
  const backfillBudgetAndTarget = async () => {
    const missing = new Map<string, string[]>(); // campanha → dias
    for (const [cid] of campaigns) {
      const pid = productByCampaign.get(cid);
      if (!pid) continue;
      for (const [k, v] of stored) {
        const [p, date] = k.split('|');
        if (p !== pid || date >= today || (v.budget && v.target)) continue;
        if (!missing.has(cid)) missing.set(cid, []);
        missing.get(cid)!.push(date);
      }
    }
    if (!missing.size) return;
    const events = await optional('histórico de orçamento', `SELECT change_event.change_date_time, change_event.change_resource_type, change_event.change_resource_name, change_event.changed_fields, change_event.old_resource, change_event.campaign FROM change_event WHERE change_event.change_date_time >= '${start} 00:00:00' AND change_event.change_date_time <= '${today} 23:59:59' AND change_event.change_resource_type IN ('CAMPAIGN_BUDGET', 'CAMPAIGN') ORDER BY change_event.change_date_time DESC LIMIT 10000`, errors);
    const budgetChanges = new Map<string, { date: string; before: number }[]>(); // orçamento → alterações
    const targetChanges = new Map<string, { date: string; before: number }[]>(); // campanha → alterações
    for (const r of events) {
      const ev = r.changeEvent || {};
      const date = String(ev.changeDateTime || '').slice(0, 10);
      const raw = ev.changedFields;
      const fields: string[] = !raw ? [] : typeof raw === 'string' ? raw.split(',') : (raw.paths || raw);
      const has = (path: string) => fields.some(f => String(f).trim().replace(/[A-Z]/g, m => '_' + m.toLowerCase()) === path);
      if (ev.changeResourceType === 'CAMPAIGN_BUDGET' && has('amount_micros')) {
        const before = valueAt(ev.oldResource, 'amount_micros');
        if (before === undefined) continue;
        const list = budgetChanges.get(ev.changeResourceName) || [];
        list.push({ date, before: n(before) });
        budgetChanges.set(ev.changeResourceName, list);
      }
      if (ev.changeResourceType === 'CAMPAIGN') {
        const cid = String(ev.campaign || ev.changeResourceName || '').split('/').pop() || '';
        for (const [path, div] of TARGET_PATHS) {
          if (!has(path)) continue;
          const list = targetChanges.get(cid) || [];
          list.push({ date, before: n(valueAt(ev.oldResource, path)) / div });
          targetChanges.set(cid, list);
          break;
        }
      }
    }
    let filled = 0;
    for (const [cid, days] of missing) {
      const c = campaigns.get(cid);
      const pid = productByCampaign.get(cid)!;
      const budgets = reconstructDaily(n(c?.campaignBudget?.amountMicros), budgetChanges.get(c?.campaign?.campaignBudget) || [], days);
      const targets = reconstructDaily(campaignTarget(c?.campaign), targetChanges.get(cid) || [], days);
      for (const date of days) {
        const prev = stored.get(`${pid}|${date}`)!;
        const patch: Record<string, number> = {};
        if (!prev.budget && budgets.get(date)) patch.budget_micros = budgets.get(date)!;
        if (!prev.target && targets.get(date)) patch.target_cpa = targets.get(date)!;
        if (!Object.keys(patch).length) continue;
        const { error } = await db.from('daily_metrics').update(patch).eq('product_id', pid).eq('date', date);
        if (!error) filled++;
      }
    }
    summary.backfilled_days = filled;
  };

  if (deep) {
    // Campanhas que ganharam produto agora, no ingest acima.
    const missing = campaignIds.filter(cid => !productByCampaign.has(cid));
    for (let i = 0; i < missing.length; i += 200) {
      const { data } = await db.from('products').select('id, google_ads_campaign_id')
        .eq('user_id', account.user_id).in('google_ads_campaign_id', missing.slice(i, i + 200));
      for (const p of data || []) productByCampaign.set(String(p.google_ads_campaign_id), p.id);
    }
    // Janela inteira na primeira vez e uma vez por dia (conversões chegam
    // atrasadas); nas outras rodadas, só os dias que mais mudam.
    const fullEntities = !account.entities_synced_at
      || Date.now() - new Date(account.entities_synced_at).getTime() >= 24 * 60 * 60 * 1000;
    summary.entities_full = fullEntities;
    if (fullEntities) await backfillBudgetAndTarget();
    await saveChanges(changeRows, cid => productByCampaign.get(cid), errors);
    summary.entities = await syncEntities(q, {
      start: fullEntities ? start : deepStart,
      end: today,
      productIdFor: cid => productByCampaign.get(cid),
      selectable: fields => selectableFields(refreshToken, fields, usage),
      metricsFor: resource => metricFieldsFor(refreshToken, resource, DIMENSION_STORED_METRICS, usage),
      errors,
    });
    if (summary.entities.ran) {
      summary.assets = await syncAssets(q, {
        start: fullEntities ? start : deepStart,
        end: today,
        productIdFor: cid => productByCampaign.get(cid),
        selectable: fields => selectableFields(refreshToken, fields, usage),
        errors,
      });
    }
  }

  summary.api_calls = apiCalls;
  summary.cost_today = Math.round(summary.cost_today * 100) / 100;
  return summary;
}

// ── orquestração ────────────────────────────────────────────────────────────

// De hora em hora, a mesma frequência do script do Google Ads — é o ritmo que
// o painel já tinha e que as decisões do dia a dia seguem. Cada rodada traz
// tudo: custo, status e o diagnóstico (termos, públicos, locais, histórico).
const SYNC_INTERVAL_MIN = Number(process.env.GOOGLE_ADS_SYNC_INTERVAL_MIN) || 60;
const IDLE_INTERVAL_MIN = Number(process.env.GOOGLE_ADS_IDLE_INTERVAL_MIN) || 360;
const DEEP_INTERVAL_MIN = Number(process.env.GOOGLE_ADS_DEEP_INTERVAL_MIN) || 60;
/** Limite diário do nível de acesso do projeto: Explorer 2.880, Basic 15.000. */
export const DAILY_QUOTA = Number(process.env.GOOGLE_ADS_DAILY_QUOTA) || 2880;

function minutesSince(ts?: string | null) {
  return ts ? (Date.now() - new Date(ts).getTime()) / 60000 : Infinity;
}

/** A cota do Google vira à meia-noite do Pacífico. */
export function quotaDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

export async function usageToday(): Promise<number> {
  const { data } = await supabaseAdmin().from('google_ads_usage').select('api_calls').eq('day', quotaDay()).maybeSingle();
  return n(data?.api_calls);
}

export async function addUsage(calls: number) {
  if (!calls) return;
  await supabaseAdmin().rpc('gads_add_usage', { p_day: quotaDay(), p_calls: calls });
}

/** Conta sem campanha ligada e sem gasto: consultar a cada 15 min só gasta cota. */
function isIdle(acc: any) {
  const s = acc.last_sync_summary;
  return s && s.enabled_campaigns === 0 && !s.cost_today;
}

export function isDue(acc: any) {
  const interval = isIdle(acc) ? IDLE_INTERVAL_MIN : SYNC_INTERVAL_MIN;
  return minutesSince(acc.last_sync_at) >= interval;
}

/**
 * Sincroniza uma conta e grava o resultado nela. Erros de uma conta não
 * derrubam as outras; token revogado marca a conexão para reconectar.
 *
 * allowDeep = false quando a cota do dia está acabando: segue só o custo e o
 * status (2 consultas) e deixa termos/públicos/histórico para depois.
 */
export async function syncAccountRecord(
  acc: any,
  opts: { forceDeep?: boolean; allowDeep?: boolean } = {},
): Promise<SyncSummary | { account: string; error: string }> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: conn } = await db.from('google_ads_connections').select('id, refresh_token_enc').eq('id', acc.connection_id).single();
  if (!conn) return { account: acc.name, error: 'Conexão não encontrada' };

  const status = String(acc.status || '').toUpperCase();
  if (status && status !== 'ENABLED' && status !== 'UNKNOWN') {
    // Conta suspensa/cancelada não responde; o status dela vem da descoberta.
    await db.from('google_ads_accounts').update({ last_sync_at: now, last_sync_status: 'ignorada', last_sync_error: `Conta ${status}` }).eq('id', acc.id);
    return { account: acc.name, error: `Conta ${status} — ignorada` };
  }

  const deep = opts.forceDeep || (opts.allowDeep !== false && minutesSince(acc.last_deep_sync_at) >= DEEP_INTERVAL_MIN);
  const usage = { calls: 0 };
  try {
    const summary = await syncAccount(acc, decryptSecret(conn.refresh_token_enc), { deep, usage });
    await db.from('google_ads_accounts').update({
      last_sync_at: now,
      ...(deep ? { last_deep_sync_at: now } : {}),
      ...(summary.entities?.ran && summary.entities_full && !summary.errors.some(e => /^(ad_group|ad|keyword)(:| \((itens|métricas)\))/.test(e)) ? { entities_synced_at: now } : {}),
      last_sync_status: summary.errors.length ? 'parcial' : 'ok',
      last_sync_error: summary.errors.length ? summary.errors.slice(0, 10).join(' | ').slice(0, 2000) : null,
      last_sync_summary: summary,
    }).eq('id', acc.id);
    return summary;
  } catch (e: any) {
    const expired = e instanceof GoogleAdsError && e.code === 'invalid_grant';
    await db.from('google_ads_accounts').update({ last_sync_at: now, last_sync_status: 'erro', last_sync_error: String(e.message).slice(0, 2000) }).eq('id', acc.id);
    if (expired) {
      await db.from('google_ads_connections').update({ status: 'expirada', last_error: e.message }).eq('id', acc.connection_id);
    }
    return { account: acc.name, error: e.message };
  } finally {
    await addUsage(usage.calls).catch(() => {});
  }
}
