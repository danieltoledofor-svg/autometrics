import { GOOGLE_METRICS_CATALOG, GOOGLE_COLUMN_KEY, shareWeightSource } from './catalog';

/**
 * Soma do período para as tabelas por item (grupos, anúncios, palavras-chave,
 * termos, públicos, locais) e rateio das vendas reais.
 *
 * Vendas reais: o postback e o lançamento manual só existem por campanha e
 * por dia. Cada dia é distribuído entre os itens na proporção das conversões
 * do Google daquele item; quando o Google ainda não contou nenhuma conversão
 * no dia (ele atrasa), a proporção é a dos cliques. É estimativa — as telas
 * marcam essas colunas com ≈. A atribuição exata por gclid vem depois.
 */

export type ColumnFormat = 'int' | 'dec' | 'money' | 'pct' | 'ratio';

export interface MetricColumn {
  key: string;
  label: string;
  category: string;
  format: ColumnFormat;
  defaultOn?: boolean;
  /** Valor rateado das vendas reais. */
  estimate?: boolean;
  desc?: string;
}

export const REAL_CATEGORY = 'Vendas reais (rateio)';

export const METRIC_COLUMNS: MetricColumn[] = [
  { key: 'impressions', label: 'Impressões', category: 'Desempenho', format: 'int', defaultOn: true },
  { key: 'clicks', label: 'Cliques', category: 'Desempenho', format: 'int', defaultOn: true },
  { key: 'ctr', label: 'CTR', category: 'Desempenho', format: 'pct', defaultOn: true },
  { key: 'avg_cpc', label: 'CPC médio', category: 'Desempenho', format: 'money', defaultOn: true },
  { key: 'cost', label: 'Custo', category: 'Desempenho', format: 'money', defaultOn: true },

  { key: 'conversions', label: 'Vendas', category: REAL_CATEGORY, format: 'dec', defaultOn: true, estimate: true,
    desc: 'Vendas do postback e do lançamento manual, distribuídas pelas conversões do Google (ou pelos cliques)' },
  { key: 'revenue', label: 'Receita', category: REAL_CATEGORY, format: 'money', defaultOn: true, estimate: true },
  { key: 'refunds', label: 'Reembolso', category: REAL_CATEGORY, format: 'money', estimate: true },
  { key: 'profit', label: 'Lucro', category: REAL_CATEGORY, format: 'money', defaultOn: true, estimate: true },
  { key: 'roi', label: 'ROI', category: REAL_CATEGORY, format: 'pct', defaultOn: true, estimate: true },
  { key: 'cpa', label: 'CPA real', category: REAL_CATEGORY, format: 'money', defaultOn: true, estimate: true },
  { key: 'roas', label: 'ROAS', category: REAL_CATEGORY, format: 'ratio', estimate: true },
  { key: 'conv_rate', label: 'Taxa de venda', category: REAL_CATEGORY, format: 'pct', estimate: true },

  ...GOOGLE_METRICS_CATALOG.map(c => ({
    key: GOOGLE_COLUMN_KEY(c.m),
    label: c.label,
    category: c.cat,
    format: (c.money ? 'money' : c.rate ? 'pct' : c.dim === 'sum' && /conversions/.test(c.m) ? 'dec' : 'int') as ColumnFormat,
    defaultOn: c.m === 'conversions' || c.m === 'cost_per_conversion',
  })),
];

/** Um dia de um item, como vem do banco. Dinheiro na moeda da conta. */
export interface DayRow {
  key: string;
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value?: number;
  google_metrics?: Record<string, number> | null;
}

/** O dia da campanha: vendas reais (já na moeda da tela) e o total do Google. */
export interface CampaignDay {
  conversions: number;
  revenue: number;
  refunds: number;
  g_conversions: number;
  clicks: number;
}

const SUMS = GOOGLE_METRICS_CATALOG.filter(c => c.dim === 'sum').map(c => c.m);
const MONEY_SUMS = new Set(GOOGLE_METRICS_CATALOG.filter(c => c.dim === 'sum' && c.money).map(c => c.m));
const SHARES = GOOGLE_METRICS_CATALOG.filter(c => c.dim === 'share');
const WAVGS = GOOGLE_METRICS_CATALOG.filter(c => c.dim === 'wavg').map(c => c.m);

interface Acc {
  impressions: number;
  clicks: number;
  cost: number;
  sums: Record<string, number>;
  wnum: Record<string, number>;
  wden: Record<string, number>;
  real: { conversions: number; revenue: number; refunds: number };
}

const newAcc = (): Acc => ({ impressions: 0, clicks: 0, cost: 0, sums: {}, wnum: {}, wden: {}, real: { conversions: 0, revenue: 0, refunds: 0 } });
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function add(acc: Acc, r: DayRow, fx: number, campaign?: CampaignDay) {
  const g = r.google_metrics || {};
  const impr = num(r.impressions);
  const clicks = num(r.clicks);
  acc.impressions += impr;
  acc.clicks += clicks;
  acc.cost += num(r.cost) * fx;

  for (const m of SUMS) {
    let v: number | undefined = g[m];
    // Linhas do script, sem o bloco do Google, ainda têm conversões e valor.
    if (v === undefined && m === 'conversions') v = r.conversions;
    if (v === undefined && m === 'conversions_value') v = r.conversions_value;
    if (v === undefined) continue;
    acc.sums[m] = (acc.sums[m] || 0) + num(v) * (MONEY_SUMS.has(m) ? fx : 1);
  }
  for (const s of SHARES) {
    const v = g[s.m];
    if (v === undefined || v === null) continue;
    let w: number;
    if (s.weightBy === 'clicks') w = num(v) > 0 ? clicks / num(v) : 0;
    else {
      const base = num(g[shareWeightSource(s.m)]);
      w = base > 0 ? impr / base : impr;
    }
    acc.wnum[s.m] = (acc.wnum[s.m] || 0) + num(v) * w;
    acc.wden[s.m] = (acc.wden[s.m] || 0) + w;
  }
  for (const m of WAVGS) {
    const v = g[m];
    if (v === undefined || v === null) continue;
    acc.wnum[m] = (acc.wnum[m] || 0) + num(v) * impr;
    acc.wden[m] = (acc.wden[m] || 0) + impr;
  }

  if (campaign) {
    const gconv = num(g.conversions ?? r.conversions);
    const w = campaign.g_conversions > 0
      ? gconv / campaign.g_conversions
      : campaign.clicks > 0 ? clicks / campaign.clicks : 0;
    const share = Math.min(1, Math.max(0, w));
    acc.real.conversions += campaign.conversions * share;
    acc.real.revenue += campaign.revenue * share;
    acc.real.refunds += campaign.refunds * share;
  }
}

const div = (a: number, b: number) => (b ? a / b : null);

function finish(acc: Acc): Record<string, number | null> {
  const s = acc.sums;
  const out: Record<string, number | null> = {
    impressions: acc.impressions,
    clicks: acc.clicks,
    cost: acc.cost,
    ctr: acc.impressions ? (acc.clicks / acc.impressions) * 100 : 0,
    avg_cpc: div(acc.cost, acc.clicks),
  };

  const r = acc.real;
  const profit = r.revenue - r.refunds - acc.cost;
  out.conversions = r.conversions;
  out.revenue = r.revenue;
  out.refunds = r.refunds;
  out.profit = profit;
  out.roi = acc.cost ? (profit / acc.cost) * 100 : null;
  out.cpa = div(acc.cost, r.conversions);
  out.roas = div(r.revenue, acc.cost);
  out.conv_rate = acc.clicks ? (r.conversions / acc.clicks) * 100 : null;

  const conv = s.conversions || 0;
  const allConv = s.all_conversions || 0;
  const interactions = s.interactions || acc.clicks;
  const pct = (v: number | null) => (v === null ? null : v * 100);
  const derived: Record<string, number | null> = {
    conversions_from_interactions_rate: pct(div(conv, interactions)),
    cost_per_conversion: div(acc.cost, conv),
    value_per_conversion: div(s.conversions_value || 0, conv),
    all_conversions_from_interactions_rate: pct(div(allConv, interactions)),
    cost_per_all_conversions: div(acc.cost, allConv),
    interaction_rate: pct(div(interactions, acc.impressions)),
    average_cpm: acc.impressions ? (acc.cost / acc.impressions) * 1000 : null,
    average_cost: div(acc.cost, interactions),
    invalid_click_rate: s.invalid_clicks !== undefined ? pct(div(s.invalid_clicks, acc.clicks + s.invalid_clicks)) : null,
    average_cpv: s.video_views ? acc.cost / s.video_views : null,
    engagement_rate: s.engagements !== undefined ? pct(div(s.engagements, acc.impressions)) : null,
  };

  for (const c of GOOGLE_METRICS_CATALOG) {
    const key = GOOGLE_COLUMN_KEY(c.m);
    if (c.dim === 'sum') out[key] = s[c.m] ?? (c.m === 'conversions' ? 0 : null);
    else if (c.dim === 'derived') out[key] = derived[c.m] ?? null;
    else {
      const v = acc.wden[c.m] ? acc.wnum[c.m] / acc.wden[c.m] : null;
      out[key] = v === null ? null : v * 100;
    }
  }
  return out;
}

/**
 * Soma cada item no período. keyOf permite juntar linhas de itens diferentes
 * (ex.: '__total' para a linha de total).
 */
export function aggregate(
  rows: DayRow[],
  opts: { fx: number; campaignDays?: Map<string, CampaignDay>; keyOf?: (r: DayRow) => string },
): Map<string, Record<string, number | null>> {
  const accs = new Map<string, Acc>();
  for (const r of rows) {
    const k = opts.keyOf ? opts.keyOf(r) : r.key;
    let acc = accs.get(k);
    if (!acc) { acc = newAcc(); accs.set(k, acc); }
    add(acc, r, opts.fx, opts.campaignDays?.get(r.date));
  }
  const out = new Map<string, Record<string, number | null>>();
  for (const [k, acc] of accs) out.set(k, finish(acc));
  return out;
}

/** Valores de um item sem nenhum dia no período. */
export const EMPTY_VALUES = finish(newAcc());

export function formatMetric(v: number | null | undefined, format: ColumnFormat, formatMoney: (n: number) => string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  switch (format) {
    case 'int': return Math.round(v).toLocaleString('pt-BR');
    case 'dec': return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    case 'money': return formatMoney(v);
    case 'pct': return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    case 'ratio': return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
  }
}

/** Variáveis que as fórmulas conhecem, com o nome que o usuário vê. */
export const FORMULA_VARIABLES: { key: string; label: string; category: string }[] = [
  ...METRIC_COLUMNS.map(c => ({ key: c.key, label: c.label, category: c.category })),
  { key: 'visits', label: 'Visitas pág. (só Visão Geral)', category: 'Funil' },
  { key: 'checkouts', label: 'Checkout geral (só Visão Geral)', category: 'Funil' },
  { key: 'vsl_clicks', label: 'Cliques VSL (só Visão Geral)', category: 'Funil' },
  { key: 'vsl_checkouts', label: 'Checkout VSL (só Visão Geral)', category: 'Funil' },
  { key: 'budget', label: 'Orçamento diário (só Visão Geral)', category: 'Funil' },
];
