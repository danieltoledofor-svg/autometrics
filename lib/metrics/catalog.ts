/**
 * Catálogo das métricas do Google usado pelo servidor (o que coletar) e pelas
 * telas (como exibir e como somar um período).
 *
 * Cada métrica tem duas regras de soma, porque as tabelas somam de jeitos
 * diferentes:
 *
 * agg — Visão Geral, uma linha por dia: 'sum' soma o período, 'avg' tira a
 *       média das linhas.
 * dim — grupos, anúncios, palavras-chave, termos, públicos e locais, onde o
 *       período inteiro vira uma linha por item e dá para ser exato:
 *       'sum'     soma;
 *       'derived' recalcula a partir das somas (custo ÷ conversões...);
 *       'share'   parcela de impressões: média ponderada pelas impressões
 *                 qualificadas de cada dia (impressões ÷ parcela), que é como
 *                 o Google chega ao número do período;
 *       'wavg'    média ponderada pelas impressões.
 *
 * money: converte junto com o custo quando a moeda de exibição muda.
 * rate:  a API devolve fração (0,45); as telas exibem 45,00%.
 */

export type DimAgg = 'sum' | 'derived' | 'share' | 'wavg';

export interface GoogleMetricDef {
  m: string;
  label: string;
  cat: string;
  agg: 'sum' | 'avg';
  dim: DimAgg;
  money?: boolean;
  rate?: boolean;
  /** Para 'share': qual volume define o peso de cada dia. */
  weightBy?: 'impressions' | 'clicks';
}

export const GOOGLE_METRICS_CATALOG: GoogleMetricDef[] = [
  // Conversões medidas pelo Google
  { m: 'conversions', label: 'Conversões (Google)', cat: 'Google · Conversões', agg: 'sum', dim: 'sum' },
  { m: 'conversions_value', label: 'Valor de conversão', cat: 'Google · Conversões', agg: 'sum', dim: 'sum', money: true },
  { m: 'conversions_from_interactions_rate', label: 'Taxa de conversão', cat: 'Google · Conversões', agg: 'avg', dim: 'derived', rate: true },
  { m: 'cost_per_conversion', label: 'Custo por conversão', cat: 'Google · Conversões', agg: 'avg', dim: 'derived', money: true },
  { m: 'value_per_conversion', label: 'Valor por conversão', cat: 'Google · Conversões', agg: 'avg', dim: 'derived', money: true },
  { m: 'all_conversions', label: 'Todas as conversões', cat: 'Google · Conversões', agg: 'sum', dim: 'sum' },
  { m: 'all_conversions_value', label: 'Valor de todas as conv.', cat: 'Google · Conversões', agg: 'sum', dim: 'sum', money: true },
  { m: 'all_conversions_from_interactions_rate', label: 'Taxa de todas as conv.', cat: 'Google · Conversões', agg: 'avg', dim: 'derived', rate: true },
  { m: 'cost_per_all_conversions', label: 'Custo por todas as conv.', cat: 'Google · Conversões', agg: 'avg', dim: 'derived', money: true },
  { m: 'view_through_conversions', label: 'Conversões por visualização', cat: 'Google · Conversões', agg: 'sum', dim: 'sum' },

  // Tráfego e custo
  { m: 'interactions', label: 'Interações', cat: 'Google · Tráfego', agg: 'sum', dim: 'sum' },
  { m: 'interaction_rate', label: 'Taxa de interação', cat: 'Google · Tráfego', agg: 'avg', dim: 'derived', rate: true },
  { m: 'average_cpm', label: 'CPM médio', cat: 'Google · Tráfego', agg: 'avg', dim: 'derived', money: true },
  { m: 'average_cost', label: 'Custo médio', cat: 'Google · Tráfego', agg: 'avg', dim: 'derived', money: true },
  { m: 'invalid_clicks', label: 'Cliques inválidos', cat: 'Google · Tráfego', agg: 'sum', dim: 'sum' },
  { m: 'invalid_click_rate', label: 'Taxa de cliques inválidos', cat: 'Google · Tráfego', agg: 'avg', dim: 'derived', rate: true },

  // Leilão — o que existe na API (o relatório de insights de leilão não é exposto)
  { m: 'search_impression_share', label: 'Parcela de impressões', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_top_impression_share', label: 'Parcela no topo', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_absolute_top_impression_share', label: 'Parcela no topo absoluto', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_budget_lost_impression_share', label: 'Perdida por orçamento', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_budget_lost_top_impression_share', label: 'Perdida no topo (orçamento)', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_budget_lost_absolute_top_impression_share', label: 'Perdida no topo abs. (orçamento)', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_rank_lost_impression_share', label: 'Perdida por classificação', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_rank_lost_top_impression_share', label: 'Perdida no topo (classificação)', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_rank_lost_absolute_top_impression_share', label: 'Perdida no topo abs. (classificação)', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_exact_match_impression_share', label: 'Parcela em correspondência exata', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true },
  { m: 'search_click_share', label: 'Parcela de cliques', cat: 'Google · Leilão', agg: 'avg', dim: 'share', rate: true, weightBy: 'clicks' },
  { m: 'absolute_top_impression_percentage', label: '% no topo absoluto', cat: 'Google · Leilão', agg: 'avg', dim: 'wavg', rate: true },
  { m: 'top_impression_percentage', label: '% no topo', cat: 'Google · Leilão', agg: 'avg', dim: 'wavg', rate: true },

  // Display e vídeo
  { m: 'content_impression_share', label: 'Parcela na rede de display', cat: 'Google · Display e vídeo', agg: 'avg', dim: 'share', rate: true },
  { m: 'content_budget_lost_impression_share', label: 'Display perdida (orçamento)', cat: 'Google · Display e vídeo', agg: 'avg', dim: 'share', rate: true },
  { m: 'content_rank_lost_impression_share', label: 'Display perdida (classificação)', cat: 'Google · Display e vídeo', agg: 'avg', dim: 'share', rate: true },
  { m: 'video_views', label: 'Visualizações de vídeo', cat: 'Google · Display e vídeo', agg: 'sum', dim: 'sum' },
  { m: 'video_view_rate', label: 'Taxa de visualização', cat: 'Google · Display e vídeo', agg: 'avg', dim: 'wavg', rate: true },
  { m: 'average_cpv', label: 'CPV médio', cat: 'Google · Display e vídeo', agg: 'avg', dim: 'derived', money: true },
  { m: 'engagements', label: 'Engajamentos', cat: 'Google · Display e vídeo', agg: 'sum', dim: 'sum' },
  { m: 'engagement_rate', label: 'Taxa de engajamento', cat: 'Google · Display e vídeo', agg: 'avg', dim: 'derived', rate: true },
];

/** Prefixo g_ separa a métrica do Google da coluna de mesmo nome do painel. */
export const GOOGLE_COLUMN_KEY = (m: string) => `g_${m}`;

/**
 * Métricas que vale guardar por dia em grupos, anúncios, palavras-chave,
 * termos, públicos e locais: as somáveis e as parcelas. As derivadas saem
 * delas na tela, então guardá-las seria só repetir.
 */
export const DIMENSION_STORED_METRICS = [
  'metrics.impressions',
  'metrics.clicks',
  'metrics.cost_micros',
  ...GOOGLE_METRICS_CATALOG.filter(c => c.dim !== 'derived').map(c => `metrics.${c.m}`),
];

/** Parcela de impressões na rede de display usa o peso da rede de display. */
export function shareWeightSource(m: string): string {
  return m.startsWith('content_') ? 'content_impression_share' : 'search_impression_share';
}

/**
 * Junta dois blocos de métricas do mesmo dia — o Google devolve termo e
 * público por grupo de anúncios, e o painel guarda um por campanha. Somáveis
 * somam; parcelas e percentuais viram média ponderada pelas impressões.
 */
export function mergeGoogleMetrics(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  const ia = Number(a.impressions) || 0;
  const ib = Number(b.impressions) || 0;
  for (const [k, v] of Object.entries(b)) {
    const def = GOOGLE_METRICS_CATALOG.find(c => c.m === k);
    if (out[k] === undefined) out[k] = v;
    else if (def && (def.dim === 'share' || def.dim === 'wavg')) {
      out[k] = ia + ib ? (out[k] * ia + v * ib) / (ia + ib) : (out[k] + v) / 2;
    } else out[k] = out[k] + v;
  }
  return out;
}
