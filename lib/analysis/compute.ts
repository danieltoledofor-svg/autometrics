import { supabaseAdmin } from '@/lib/googleAds/server';
import { audienceLabel, deviceLabel, keywordLabel, TERM_MATCH_TAG, ASSET_TAG, formatMoney } from './labels';

/**
 * Leitura da campanha pelos números — sem IA.
 *
 * Segue a skill "analisador-campanha-dados": últimos 3 dias fechados contra os
 * últimos 7 dias fechados, item a item, com o semáforo pela referência:
 *
 * - com venda nos últimos 30 dias, a referência é o valor médio da venda:
 *   alerta com CPA a partir de 80% dela, urgente acima de 90%, e urgente
 *   também quando o gasto sem venda passa de 50%;
 * - sem venda, vale a meta de CPA da campanha (ou o CPA de 7 dias, se não
 *   houver meta): alerta a partir de 15% acima, urgente a partir de 25% acima,
 *   tanto no CPA quanto no gasto sem venda.
 *
 * Vendas: com venda real (postback ou lançamento) nos últimos 30 dias, a
 * campanha usa as vendas reais e os itens recebem essas vendas rateadas — pelas
 * conversões do Google do item ou, quando a janela não tem conversão, pelos
 * cliques. É o mesmo rateio das colunas "≈" do painel. Sem venda real, tudo
 * usa as conversões do Google.
 */

export type ItemKey = 'termos' | 'palavras_chave' | 'dispositivos' | 'publicos' | 'locais' | 'anuncios' | 'sitelinks' | 'pagina';
export type Status = 'ok' | 'alerta' | 'urgente' | 'sem_dado';

export const ITEMS: { key: ItemKey; title: string; one: string; many: string }[] = [
  { key: 'termos', title: 'Termos de pesquisa', one: 'termo', many: 'termos' },
  { key: 'palavras_chave', title: 'Palavras-chave', one: 'palavra-chave', many: 'palavras-chave' },
  { key: 'dispositivos', title: 'Dispositivos', one: 'dispositivo', many: 'dispositivos' },
  { key: 'publicos', title: 'Públicos', one: 'público', many: 'públicos' },
  { key: 'locais', title: 'Locais', one: 'local', many: 'locais' },
  { key: 'anuncios', title: 'Anúncios', one: 'anúncio', many: 'anúncios' },
  { key: 'sitelinks', title: 'Sitelinks e frases de destaque', one: 'recurso', many: 'recursos' },
  { key: 'pagina', title: 'Anúncio × página × VSL', one: 'ponto', many: 'pontos' },
];

export interface Reference {
  mode: 'venda' | 'meta_cpa' | 'cpa_7d' | 'nenhuma';
  value: number;
  warn: number;
  urgent: number;
  /** Gasto sem venda: null = sem nível de alerta (modo venda só tem urgente). */
  noSaleWarn: number | null;
  noSaleUrgent: number;
  /** "da venda", "da meta de CPA"… — para "87% da venda". */
  of: string;
  basis: string;
  currency: string;
}

export interface Row {
  key: string;
  label: string;
  tag?: string | null;
  cost3: number; conv3: number; cpa3: number | null;
  cost7: number; conv7: number; cpa7: number | null;
  /** CPA (ou gasto sem venda) sobre a referência: 1.12 = 112%. */
  pct: number | null;
  status: Status;
  /** Vendas rateadas das vendas reais (mostradas com ≈). */
  approx?: boolean;
  extra?: Record<string, any>;
}

export interface Item {
  key: ItemKey;
  title: string;
  status: Status;
  counts: { urgente: number; alerta: number; ok: number };
  headline: string;
  rows: Row[];
  others?: { count: number; cost3: number; conv3: number } | null;
}

export interface Numbers {
  d3: Record<string, number | null>;
  d7: Record<string, number | null>;
  salesSource: 'real' | 'google';
}

export interface Computed {
  product: any;
  timeZone: string | null;
  today: string;
  period: { d3: [string, string]; d7: [string, string]; today: string };
  reference: Reference;
  numbers: Numbers;
  campaignStatus: Status;
  items: Item[];
  /** Dados de apoio para a leitura da página e o acompanhamento. */
  termRows: Row[];
  keywordByTerm: Map<string, { text: string; match: string }>;
  keywordEntities: Map<string, string>; // "texto|MATCH" → entity_id
  ads: any[];
}

const num = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function todayIn(timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'America/Sao_Paulo' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** "41%", "< 10%" (script) ou 0.41 (API) → fração. */
function shareOf(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (s.startsWith('<')) return 0.1;
  if (s.startsWith('>')) return 0.9;
  const x = parseFloat(s.replace('%', '').replace(',', '.'));
  if (!Number.isFinite(x)) return null;
  return s.includes('%') || x > 1 ? x / 100 : x;
}

/** Todas as linhas, página a página (o Supabase devolve no máximo 1000). */
async function fetchAll(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await build(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function classify(ref: Reference, cost: number, conv: number): { status: Status; pct: number | null } {
  if (ref.mode === 'nenhuma') return { status: cost > 0 ? 'sem_dado' : 'ok', pct: null };
  if (conv > 0) {
    const cpa = cost / conv;
    return { status: cpa > ref.urgent ? 'urgente' : cpa >= ref.warn ? 'alerta' : 'ok', pct: cpa / ref.value };
  }
  if (cost <= 0) return { status: 'ok', pct: null };
  const status = cost > ref.noSaleUrgent ? 'urgente' : ref.noSaleWarn !== null && cost >= ref.noSaleWarn ? 'alerta' : 'ok';
  return { status, pct: cost / ref.value };
}

const RANK: Record<Status, number> = { urgente: 3, alerta: 2, sem_dado: 1, ok: 0 };
export const worst = (list: Status[]): Status => list.reduce<Status>((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');

interface Acc { cost3: number; conv3: number; cost7: number; conv7: number; clicks3: number; clicks7: number; impr3: number; impr7: number }
const newAcc = (): Acc => ({ cost3: 0, conv3: 0, cost7: 0, conv7: 0, clicks3: 0, clicks7: 0, impr3: 0, impr7: 0 });

function addTo(acc: Acc, date: string, d3start: string, r: { cost?: any; conversions?: any; clicks?: any; impressions?: any }) {
  const cost = num(r.cost), conv = num(r.conversions), clicks = num(r.clicks), impr = num(r.impressions);
  acc.cost7 += cost; acc.conv7 += conv; acc.clicks7 += clicks; acc.impr7 += impr;
  if (date >= d3start) { acc.cost3 += cost; acc.conv3 += conv; acc.clicks3 += clicks; acc.impr3 += impr; }
}

/**
 * Troca as conversões do Google de um grupo de itens pelas vendas reais da
 * campanha, rateadas. Cada janela (3 e 7 dias) é rateada à parte.
 */
function attribute(accs: Acc[], real: { d3: number; d7: number }) {
  for (const w of ['3', '7'] as const) {
    const convKey = `conv${w}` as 'conv3' | 'conv7';
    const clickKey = `clicks${w}` as 'clicks3' | 'clicks7';
    const sales = w === '3' ? real.d3 : real.d7;
    const g = accs.reduce((s, a) => s + a[convKey], 0);
    const c = accs.reduce((s, a) => s + a[clickKey], 0);
    for (const a of accs) {
      const weight = g > 0 ? a[convKey] / g : c > 0 ? a[clickKey] / c : 0;
      a[convKey] = Math.round(sales * weight * 100) / 100;
    }
  }
}

function toRow(ref: Reference, key: string, label: string, a: Acc, tag?: string | null, extra?: Record<string, any>, approx = false): Row {
  const { status, pct } = classify(ref, a.cost3, a.conv3);
  return {
    key, label, tag: tag || null, approx,
    cost3: round(a.cost3), conv3: round(a.conv3), cpa3: a.conv3 > 0 ? round(a.cost3 / a.conv3) : null,
    cost7: round(a.cost7), conv7: round(a.conv7), cpa7: a.conv7 > 0 ? round(a.cost7 / a.conv7) : null,
    pct: pct === null ? null : Math.round(pct * 1000) / 1000,
    status, extra,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/**
 * Segmento que concentra quase todo o gasto (um país só, 95% no celular)
 * repete o resultado da campanha: marcá-lo não aponta nada que o resumo já
 * não mostre, e "excluir Estados Unidos" não é alteração. Fica sem status,
 * com a marca de espelho.
 */
function markMirrors(rows: Row[], groupOf: (r: Row) => string = () => '') {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(groupOf(r), (totals.get(groupOf(r)) || 0) + r.cost3);
  for (const r of rows) {
    const total = totals.get(groupOf(r)) || 0;
    if (total > 0 && r.cost3 / total >= 0.9 && (r.status === 'urgente' || r.status === 'alerta')) {
      r.status = 'sem_dado';
      r.extra = { ...(r.extra || {}), mirror: true };
    }
  }
  return rows;
}

/** Frase de uma linha do item, montada pelo código (a IA não mexe em número). */
function headline(meta: typeof ITEMS[number], rows: Row[], ref: Reference): string {
  const money = (v: number) => formatMoney(v, ref.currency);
  const active = rows.filter(r => r.cost7 > 0);
  if (!active.length) return 'Sem dados nos últimos 7 dias';
  const mirror = rows.find(r => r.extra?.mirror);
  const flagged = rows.filter(r => r.status === 'urgente' || r.status === 'alerta');
  if (flagged.length === 1) {
    const r = flagged[0];
    const pct = r.pct !== null ? ` (${Math.round(r.pct * 100)}% ${ref.of})` : '';
    return r.conv3 > 0
      ? `${r.label}: CPA de ${money(r.cpa3!)} em 3 dias${pct}`
      : `${r.label}: ${money(r.cost3)} gastos sem venda em 3 dias${pct}`;
  }
  if (flagged.length > 1) {
    const total = flagged.reduce((s, r) => s + r.cost3, 0);
    return `${flagged.length} ${meta.many} acima do limite custaram ${money(total)} em 3 dias`;
  }
  if (mirror && active.length === 1) return `Só ${mirror.label} com gasto: o resultado é o mesmo da campanha`;
  if (ref.mode === 'nenhuma') return `${active.length} ${active.length === 1 ? meta.one : meta.many} com gasto · sem referência para comparar`;
  return `Nada acima do limite em ${active.length} ${active.length === 1 ? meta.one : meta.many} com gasto`;
}

const API_ONLY: ItemKey[] = ['palavras_chave', 'anuncios', 'sitelinks'];

function buildItem(key: ItemKey, rows: Row[], ref: Reference, others?: Item['others'], viaApi = true): Item {
  const meta = ITEMS.find(i => i.key === key)!;
  const counts = { urgente: 0, alerta: 0, ok: 0 };
  for (const r of rows) {
    if (r.status === 'urgente') counts.urgente++;
    else if (r.status === 'alerta') counts.alerta++;
    else if (r.status === 'ok' && r.cost7 > 0) counts.ok++;
  }
  const status = rows.some(r => r.cost7 > 0) ? worst(rows.map(r => (r.extra?.mirror ? 'ok' : r.status))) : 'sem_dado';
  const text = !rows.length && !viaApi && API_ONLY.includes(key)
    ? 'Só com a conta conectada pela API do Google (Integração)'
    : headline(meta, rows, ref);
  return { key, title: meta.title, status, counts, headline: text, rows, others: others || null };
}

/** Linhas para a tela: as de maior gasto e sempre as sinalizadas. */
function keepTop(rows: Row[], limit: number): { rows: Row[]; others: Item['others'] } {
  const sorted = [...rows].filter(r => r.cost7 > 0).sort((a, b) => b.cost3 - a.cost3 || b.cost7 - a.cost7);
  const kept = sorted.filter((r, i) => i < limit || r.status === 'urgente' || r.status === 'alerta');
  const rest = sorted.filter(r => !kept.includes(r));
  return {
    rows: kept,
    others: rest.length ? {
      count: rest.length,
      cost3: round(rest.reduce((s, r) => s + r.cost3, 0)),
      conv3: round(rest.reduce((s, r) => s + r.conv3, 0)),
    } : null,
  };
}

export async function loadProduct(productId: string) {
  const db = supabaseAdmin();
  const { data: product } = await db.from('products').select('*').eq('id', productId).single();
  if (!product) return null;
  let timeZone: string | null = null;
  if (product.google_ads_customer_id) {
    const { data: acc } = await db.from('google_ads_accounts').select('time_zone')
      .eq('user_id', product.user_id).eq('customer_id', String(product.google_ads_customer_id).replace(/-/g, '')).maybeSingle();
    timeZone = acc?.time_zone || null;
  }
  return { product, timeZone };
}

export async function computeAnalysis(productId: string): Promise<Computed | null> {
  const loaded = await loadProduct(productId);
  if (!loaded) return null;
  const { product, timeZone } = loaded;
  const db = supabaseAdmin();
  const today = todayIn(timeZone);
  const d7start = addDays(today, -7), d3start = addDays(today, -3), end = addDays(today, -1);
  const d30start = addDays(today, -30);

  const [days, terms, audiences, locations, entityMetrics, entities] = await Promise.all([
    fetchAll((a, b) => db.from('daily_metrics')
      .select('date, cost, clicks, impressions, conversions, conversion_value, google_conversions, target_cpa, bidding_strategy, search_impression_share, currency')
      .eq('product_id', productId).gte('date', d30start).lte('date', end).order('date').range(a, b)),
    fetchAll((a, b) => db.from('search_terms')
      .select('date, search_term, keyword, keyword_match_type, term_match_type, cost, clicks, impressions, conversions')
      .eq('product_id', productId).gte('date', d7start).lte('date', end).range(a, b)),
    fetchAll((a, b) => db.from('audiences')
      .select('date, audience_name, audience_type, cost, clicks, impressions, conversions')
      .eq('product_id', productId).in('audience_type', ['Device', 'Age', 'Gender']).gte('date', d7start).lte('date', end).range(a, b)),
    fetchAll((a, b) => db.from('locations')
      .select('date, location_name, cost, clicks, impressions, conversions')
      .eq('product_id', productId).gte('date', d7start).lte('date', end).range(a, b)),
    fetchAll((a, b) => db.from('google_ads_entity_metrics')
      .select('level, entity_id, date, cost, clicks, impressions, conversions')
      .eq('product_id', productId).in('level', ['keyword', 'ad', 'asset']).gte('date', d7start).lte('date', end).range(a, b))
      .catch(() => []),
    fetchAll((a, b) => db.from('google_ads_entities')
      .select('level, entity_id, name, status, details')
      .eq('product_id', productId).in('level', ['keyword', 'ad', 'asset']).range(a, b))
      .catch(() => []),
  ]);

  // ── Referência ──────────────────────────────────────────────────────────
  const currency = (product.currency || days.find(d => d.currency)?.currency || 'USD').toUpperCase();
  const sales30 = days.reduce((s, d) => s + num(d.conversions), 0);
  const revenue30 = days.reduce((s, d) => s + num(d.conversion_value), 0);
  const salesSource: 'real' | 'google' = sales30 > 0 ? 'real' : 'google';
  const last7 = days.filter(d => d.date >= d7start);
  const isRoas = (d: any) => /ROAS|CONVERSION_VALUE/i.test(String(d.bidding_strategy || ''));
  const target = [...last7].reverse().find(d => num(d.target_cpa) > 0 && !isRoas(d));
  const cost7 = last7.reduce((s, d) => s + num(d.cost), 0);
  const conv7 = last7.reduce((s, d) => s + num(salesSource === 'real' ? d.conversions : d.google_conversions), 0);

  let reference: Reference;
  if (sales30 > 0 && revenue30 > 0) {
    const v = revenue30 / sales30;
    reference = { mode: 'venda', value: round(v), warn: round(v * 0.8), urgent: round(v * 0.9), noSaleWarn: null, noSaleUrgent: round(v * 0.5), of: 'da venda', basis: `média de ${sales30} ${sales30 === 1 ? 'venda' : 'vendas'} em 30 dias`, currency };
  } else if (target) {
    const t = num(target.target_cpa);
    reference = { mode: 'meta_cpa', value: round(t), warn: round(t * 1.15), urgent: round(t * 1.25), noSaleWarn: round(t * 1.15), noSaleUrgent: round(t * 1.25), of: 'da meta de CPA', basis: 'meta de CPA da campanha (sem venda em 30 dias)', currency };
  } else if (conv7 > 0) {
    const t = cost7 / conv7;
    reference = { mode: 'cpa_7d', value: round(t), warn: round(t * 1.15), urgent: round(t * 1.25), noSaleWarn: round(t * 1.15), noSaleUrgent: round(t * 1.25), of: 'do CPA de 7 dias', basis: 'CPA dos últimos 7 dias (sem venda em 30 dias e sem meta)', currency };
  } else {
    reference = { mode: 'nenhuma', value: 0, warn: 0, urgent: 0, noSaleWarn: null, noSaleUrgent: 0, of: '', basis: 'sem venda, sem meta de CPA e sem conversão em 7 dias', currency };
  }

  // ── Números da campanha ─────────────────────────────────────────────────
  const window = (from: string, count: number) => {
    const list = days.filter(d => d.date >= from);
    const cost = list.reduce((s, d) => s + num(d.cost), 0);
    const clicks = list.reduce((s, d) => s + num(d.clicks), 0);
    const impr = list.reduce((s, d) => s + num(d.impressions), 0);
    const sales = list.reduce((s, d) => s + num(salesSource === 'real' ? d.conversions : d.google_conversions), 0);
    let shareW = 0, shareI = 0;
    for (const d of list) {
      const sh = shareOf(d.search_impression_share);
      if (sh !== null && num(d.impressions) > 0) { shareW += sh * num(d.impressions); shareI += num(d.impressions); }
    }
    return {
      cpa: sales > 0 ? round(cost / sales) : null,
      cost_day: round(cost / count),
      sales_day: Math.round((sales / count) * 10) / 10,
      ctr: impr > 0 ? clicks / impr : null,
      cpc: clicks > 0 ? round(cost / clicks) : null,
      visibility: shareI > 0 ? shareW / shareI : null,
      cost: round(cost), sales,
    };
  };
  const numbers: Numbers = { d3: window(d3start, 3), d7: window(d7start, 7), salesSource };
  // 3 dias, como os itens; e 7 dias sem nenhuma venda também pesa no resumo.
  const campaignStatus: Status = reference.mode === 'nenhuma' ? 'sem_dado'
    : worst([
      classify(reference, num(numbers.d3.cost), num(numbers.d3.sales)).status,
      num(numbers.d7.sales) === 0 ? classify(reference, num(numbers.d7.cost), 0).status : 'ok',
    ]);

  const approx = salesSource === 'real';
  const real = { d3: num(numbers.d3.sales), d7: num(numbers.d7.sales) };
  const share = (accs: Acc[]) => { if (approx) attribute(accs, real); };
  const row = (key: string, label: string, a: Acc, tag?: string | null, extra?: Record<string, any>) =>
    toRow(reference, key, label, a, tag, extra, approx);

  // ── 1. Termos ───────────────────────────────────────────────────────────
  const termAcc = new Map<string, Acc>();
  const termMatch = new Map<string, Map<string, number>>();
  const termKeyword = new Map<string, Map<string, number>>();
  for (const t of terms) {
    const k = String(t.search_term || '');
    if (!k) continue;
    if (!termAcc.has(k)) termAcc.set(k, newAcc());
    addTo(termAcc.get(k)!, t.date, d3start, t);
    const bump = (map: Map<string, Map<string, number>>, v: string) => {
      if (!v) return;
      if (!map.has(k)) map.set(k, new Map());
      map.get(k)!.set(v, (map.get(k)!.get(v) || 0) + num(t.cost) + 0.0001);
    };
    bump(termMatch, t.term_match_type || '');
    bump(termKeyword, t.keyword ? `${t.keyword}|${t.keyword_match_type || ''}` : '');
  }
  const top = (m?: Map<string, number>) => (m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined);
  share([...termAcc.values()]);
  const keywordByTerm = new Map<string, { text: string; match: string }>();
  const termRows: Row[] = [];
  for (const [term, acc] of termAcc) {
    const kw = top(termKeyword.get(term));
    if (kw) { const [text, match] = kw.split('|'); keywordByTerm.set(term, { text, match }); }
    const match = top(termMatch.get(term));
    termRows.push(row(term, term, acc, match ? TERM_MATCH_TAG[match] || match.toLowerCase() : null,
      kw ? { keyword: keywordLabel(kw.split('|')[0], kw.split('|')[1]) } : undefined));
  }
  const termsView = keepTop(termRows, 12);

  // ── 2, 6, 7. Palavras-chave, anúncios, sitelinks ────────────────────────
  const entityInfo = new Map<string, any>();
  for (const e of entities) entityInfo.set(`${e.level}|${e.entity_id}`, e);
  const keywordEntities = new Map<string, string>();
  for (const e of entities) if (e.level === 'keyword') keywordEntities.set(`${e.name}|${e.details?.match_type || ''}`, e.entity_id);

  const byEntity = new Map<string, Acc>();
  for (const m of entityMetrics) {
    const k = `${m.level}|${m.entity_id}`;
    if (!byEntity.has(k)) byEntity.set(k, newAcc());
    addTo(byEntity.get(k)!, m.date, d3start, m);
  }
  for (const level of ['keyword', 'ad', 'asset']) share([...byEntity].filter(([k]) => k.startsWith(`${level}|`)).map(([, a]) => a));
  const entityRows = (level: string) => {
    const rows: Row[] = [];
    for (const [k, acc] of byEntity) {
      if (!k.startsWith(`${level}|`)) continue;
      const id = k.slice(level.length + 1);
      const e = entityInfo.get(k) || {};
      const d = e.details || {};
      if (level === 'keyword') {
        rows.push(row(id, keywordLabel(e.name || id, d.match_type), acc, null, {
          quality: d.quality_score ?? null,
          cpc3: acc.clicks3 > 0 ? round(acc.cost3 / acc.clicks3) : null,
          cpc7: acc.clicks7 > 0 ? round(acc.cost7 / acc.clicks7) : null,
          status: e.status || null,
        }));
      } else if (level === 'ad') {
        rows.push(row(id, e.name || `Anúncio ${id}`, acc, null, {
          ctr3: acc.impr3 > 0 ? acc.clicks3 / acc.impr3 : null,
          strength: d.ad_strength || null, status: e.status || null,
        }));
      } else {
        rows.push(row(id, e.name || id, acc, ASSET_TAG[d.field_type] || null, {
          clicks3: acc.clicks3, status: e.status || null,
        }));
      }
    }
    return rows;
  };
  const kwView = keepTop(entityRows('keyword'), 12);
  const adView = keepTop(entityRows('ad'), 12);
  const assetView = keepTop(entityRows('asset'), 20);

  // ── 3, 4. Dispositivos e públicos ───────────────────────────────────────
  const audAcc = new Map<string, Acc>();
  for (const a of audiences) {
    const k = `${a.audience_type}|${a.audience_name}`;
    if (!audAcc.has(k)) audAcc.set(k, newAcc());
    addTo(audAcc.get(k)!, a.date, d3start, a);
  }
  for (const type of ['Device', 'Age', 'Gender']) share([...audAcc].filter(([k]) => k.startsWith(`${type}|`)).map(([, a]) => a));
  const deviceClicks = { d3: 0, d7: 0 };
  for (const [k, acc] of audAcc) if (k.startsWith('Device|')) { deviceClicks.d3 += acc.clicks3; deviceClicks.d7 += acc.clicks7; }
  const deviceRows: Row[] = [];
  const audienceRows: Row[] = [];
  for (const [k, acc] of audAcc) {
    const [type, code] = k.split('|');
    if (type === 'Device') {
      deviceRows.push(row(code, deviceLabel(code), acc, null, {
        share7: deviceClicks.d7 > 0 ? acc.clicks7 / deviceClicks.d7 : null,
        share3: deviceClicks.d3 > 0 ? acc.clicks3 / deviceClicks.d3 : null,
        convRate3: acc.clicks3 > 0 ? acc.conv3 / acc.clicks3 : null,
      }));
    } else {
      audienceRows.push(row(k, audienceLabel(type, code), acc, null, { type, code }));
    }
  }

  // ── 5. Locais ───────────────────────────────────────────────────────────
  const locAcc = new Map<string, Acc>();
  for (const l of locations) {
    const k = String(l.location_name || '');
    if (!locAcc.has(k)) locAcc.set(k, newAcc());
    addTo(locAcc.get(k)!, l.date, d3start, l);
  }
  share([...locAcc.values()]);
  const locationRows = [...locAcc].map(([k, acc]) => row(k, k, acc));

  const viaApi = entities.length > 0 || !!product.google_ads_customer_id;
  const sortCost = (rows: Row[]) => rows.filter(r => r.cost7 > 0).sort((a, b) => b.cost3 - a.cost3 || b.cost7 - a.cost7);
  const items: Item[] = [
    buildItem('termos', termsView.rows, reference, termsView.others),
    buildItem('palavras_chave', kwView.rows, reference, kwView.others, viaApi),
    buildItem('dispositivos', markMirrors(sortCost(deviceRows)), reference),
    buildItem('publicos', markMirrors(sortCost(audienceRows), r => r.extra?.type || ''), reference),
    buildItem('locais', markMirrors(sortCost(locationRows)), reference),
    buildItem('anuncios', adView.rows, reference, adView.others, viaApi),
    buildItem('sitelinks', assetView.rows, reference, assetView.others, viaApi),
  ];

  const ads = entities.filter(e => e.level === 'ad' && e.status === 'ENABLED');

  return {
    product, timeZone, today,
    period: { d3: [d3start, end], d7: [d7start, end], today },
    reference, numbers, campaignStatus, items,
    termRows, keywordByTerm, keywordEntities, ads,
  };
}
