import { searchFields } from './client';

/**
 * Quais métricas existem na versão da API em uso.
 *
 * Um único campo inválido derruba a consulta inteira — e a lista de métricas
 * muda a cada versão do Google. Em vez de manter uma lista fixa e torcer, o
 * google_ads_field diz o que o recurso aceita, e pedimos só a interseção com o
 * que sabemos usar. Quando o Google criar uma métrica nova, basta acrescentá-la
 * em WANTED.
 */

/** Métricas de campanha que o painel usa, na ordem em que fazem sentido. */
export const WANTED_CAMPAIGN_METRICS = [
  // Volume e custo
  'metrics.impressions',
  'metrics.clicks',
  'metrics.ctr',
  'metrics.average_cpc',
  'metrics.average_cpm',
  'metrics.cost_micros',
  'metrics.average_cost',
  'metrics.interactions',
  'metrics.interaction_rate',
  'metrics.invalid_clicks',
  'metrics.invalid_click_rate',

  // Conversões medidas pelo Google (não confundir com a receita do postback)
  'metrics.conversions',
  'metrics.conversions_value',
  'metrics.conversions_from_interactions_rate',
  'metrics.cost_per_conversion',
  'metrics.value_per_conversion',
  'metrics.all_conversions',
  'metrics.all_conversions_value',
  'metrics.all_conversions_from_interactions_rate',
  'metrics.cost_per_all_conversions',
  'metrics.view_through_conversions',

  // Leilão: o que dá para saber sem o relatório de insights de leilão
  'metrics.search_impression_share',
  'metrics.search_top_impression_share',
  'metrics.search_absolute_top_impression_share',
  'metrics.search_budget_lost_impression_share',
  'metrics.search_budget_lost_top_impression_share',
  'metrics.search_budget_lost_absolute_top_impression_share',
  'metrics.search_rank_lost_impression_share',
  'metrics.search_rank_lost_top_impression_share',
  'metrics.search_rank_lost_absolute_top_impression_share',
  'metrics.search_exact_match_impression_share',
  'metrics.search_click_share',
  'metrics.absolute_top_impression_percentage',
  'metrics.top_impression_percentage',

  // Rede de display e vídeo, para quem roda PMax ou YouTube
  'metrics.content_impression_share',
  'metrics.content_budget_lost_impression_share',
  'metrics.content_rank_lost_impression_share',
  'metrics.video_views',
  'metrics.video_view_rate',
  'metrics.average_cpv',
  'metrics.engagements',
  'metrics.engagement_rate',
] as const;

/** Valores em micros: viram unidade de moeda ao gravar. */
const MICROS = new Set([
  'average_cpc', 'average_cpm', 'cost_micros', 'average_cost', 'cost_per_conversion',
  'value_per_conversion', 'cost_per_all_conversions', 'average_cpv',
]);

const CACHE_MS = 24 * 60 * 60 * 1000;
let cache: { fields: Set<string>; at: number } | null = null;

/** Métricas que o recurso `campaign` aceita nesta versão da API. */
export async function campaignMetricFields(refreshToken: string, usage?: { calls: number }): Promise<string[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    if (usage) usage.calls++;
    try {
      const [row] = await searchFields(refreshToken, "SELECT metrics WHERE name = 'campaign'");
      const disponiveis: string[] = row?.metrics || [];
      cache = { fields: new Set(disponiveis), at: Date.now() };
    } catch {
      // Sem a lista, fica no básico que existe desde sempre.
      cache = { fields: new Set(['metrics.impressions', 'metrics.clicks', 'metrics.ctr', 'metrics.average_cpc', 'metrics.cost_micros']), at: Date.now() };
    }
  }
  return WANTED_CAMPAIGN_METRICS.filter(f => cache!.fields.has(f));
}

/**
 * Normaliza o bloco de métricas de uma linha: nomes em snake_case, micros já
 * convertidos e sem o sufixo. É o que vai para a coluna google_metrics.
 */
export function normalizeMetrics(metrics: any, fields: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of fields) {
    const snake = field.replace('metrics.', '');
    const camel = snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const raw = metrics?.[camel];
    if (raw === undefined || raw === null) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (MICROS.has(snake)) out[snake.replace(/_micros$/, '')] = value / 1_000_000;
    else out[snake] = value;
  }
  return out;
}

/**
 * Campos de atributo (campaign.*, ad_group.*…) que existem nesta versão.
 *
 * O Google renomeia campos entre versões — campaign.start_date virou
 * campaign.start_date_time — e um único nome desconhecido derruba a consulta
 * inteira. Pergunta-se ao googleAdsFields só pelos nomes ainda não vistos; a
 * resposta fica guardada por um dia.
 */
const attrCache = new Map<string, boolean>();
let attrCacheAt = 0;

export async function selectableFields(
  refreshToken: string,
  fields: string[],
  usage?: { calls: number },
): Promise<Set<string>> {
  if (Date.now() - attrCacheAt > CACHE_MS) { attrCache.clear(); attrCacheAt = Date.now(); }
  const unknown = [...new Set(fields)].filter(f => !attrCache.has(f));
  if (unknown.length) {
    if (usage) usage.calls++;
    try {
      const list = unknown.map(f => `'${f}'`).join(', ');
      const rows = await searchFields(refreshToken, `SELECT name, selectable WHERE name IN (${list})`);
      const found = new Map(rows.map((r: any) => [r.googleAdsField?.name ?? r.name, !!(r.googleAdsField?.selectable ?? r.selectable)]));
      for (const f of unknown) attrCache.set(f, found.get(f) === true);
    } catch {
      // Sem a lista, tenta com tudo — o erro, se houver, aparece na conta.
      return new Set(fields.filter(f => attrCache.get(f) !== false));
    }
  }
  return new Set(fields.filter(f => attrCache.get(f)));
}
