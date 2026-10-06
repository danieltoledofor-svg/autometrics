import { supabaseAdmin } from './server';
import { normalizeMetrics } from './fields';
import { ACTION_SELECT, ACTION_WHERE, addActionRow } from './conversionActions';
import type { ActionCounts } from '@/lib/metrics/dimension';

/**
 * Grupos de anúncios, anúncios e palavras-chave.
 *
 * Cada nível custa duas consultas por conta:
 *
 * - a configuração atual de todos os itens não removidos, sem métricas. É ela
 *   que mostra o grupo pausado ou a palavra-chave que nunca teve impressão —
 *   com segments.date, o Google só devolve linha com atividade;
 * - as métricas por dia na janela, com os mesmos campos de configuração. Item
 *   removido que ainda gastou na janela aparece só aqui, e entra como REMOVED.
 *
 * Roda junto da coleta profunda (termos, públicos, histórico), de hora em
 * hora. Seis consultas a mais por conta ficam folgadas no acesso Básico.
 */

export type EntityLevel = 'ad_group' | 'ad' | 'keyword';

const BASE_METRICS = ['metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.conversions', 'metrics.conversions_value'];

/** Só o que identifica o item — a consulta de ações de conversão não precisa do resto. */
const ID_FIELDS: Record<EntityLevel, string> = {
  ad_group: 'campaign.id, ad_group.id',
  ad: 'campaign.id, ad_group.id, ad_group_ad.ad.id',
  keyword: 'campaign.id, ad_group.id, ad_group_criterion.criterion_id',
};

const FIELDS: Record<EntityLevel, { from: string; fields: string[]; where: string }> = {
  ad_group: {
    from: 'ad_group',
    fields: [
      'campaign.id',
      'ad_group.id',
      'ad_group.name',
      'ad_group.status',
      'ad_group.type',
      'ad_group.cpc_bid_micros',
      'ad_group.target_cpa_micros',
      'ad_group.target_roas',
    ],
    where: `ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
  },
  ad: {
    from: 'ad_group_ad',
    fields: [
      'campaign.id',
      'ad_group.id',
      'ad_group_ad.ad.id',
      'ad_group_ad.ad.name',
      'ad_group_ad.ad.type',
      'ad_group_ad.status',
      'ad_group_ad.ad_strength',
      'ad_group_ad.policy_summary.approval_status',
      'ad_group_ad.ad.final_urls',
      'ad_group_ad.ad.responsive_search_ad.headlines',
      'ad_group_ad.ad.responsive_search_ad.descriptions',
      'ad_group_ad.ad.responsive_search_ad.path1',
      'ad_group_ad.ad.responsive_search_ad.path2',
    ],
    where: `ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
  },
  keyword: {
    from: 'keyword_view',
    fields: [
      'campaign.id',
      'ad_group.id',
      'ad_group_criterion.criterion_id',
      'ad_group_criterion.keyword.text',
      'ad_group_criterion.keyword.match_type',
      'ad_group_criterion.status',
      'ad_group_criterion.approval_status',
      'ad_group_criterion.cpc_bid_micros',
      'ad_group_criterion.effective_cpc_bid_micros',
      'ad_group_criterion.quality_info.quality_score',
      'ad_group_criterion.quality_info.creative_quality_score',
      'ad_group_criterion.quality_info.post_click_quality_score',
      'ad_group_criterion.quality_info.search_predicted_ctr',
    ],
    where: `ad_group_criterion.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
  },
};

interface Entity {
  campaignId: string;
  level: EntityLevel;
  entity_id: string;
  ad_group_id: string;
  name: string;
  status: string;
  details: Record<string, any>;
}

const n = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const micros = (v: any) => (v === undefined || v === null ? null : n(v) / 1e6);
const texts = (list: any) => (Array.isArray(list) ? list : [])
  .map((a: any) => ({ text: a?.text || '', pin: a?.pinnedField || null }))
  .filter((a: any) => a.text);

/** Uma linha da API vira o item no formato da tabela. */
function toEntity(level: EntityLevel, r: any): Entity | null {
  const campaignId = String(r.campaign?.id || '');
  const adGroupId = String(r.adGroup?.id || '');
  if (!campaignId || !adGroupId) return null;

  if (level === 'ad_group') {
    const g = r.adGroup;
    return {
      campaignId, level, entity_id: adGroupId, ad_group_id: adGroupId,
      name: g.name || `Grupo ${adGroupId}`,
      status: g.status || 'UNKNOWN',
      details: {
        type: g.type || null,
        cpc_bid: micros(g.cpcBidMicros),
        target_cpa: micros(g.targetCpaMicros),
        target_roas: g.targetRoas ?? null,
      },
    };
  }

  if (level === 'ad') {
    const aga = r.adGroupAd || {};
    const ad = aga.ad || {};
    if (!ad.id) return null;
    const rsa = ad.responsiveSearchAd || {};
    const headlines = texts(rsa.headlines);
    return {
      campaignId, level, entity_id: `${adGroupId}~${ad.id}`, ad_group_id: adGroupId,
      name: ad.name || headlines[0]?.text || `Anúncio ${ad.id}`,
      status: aga.status || 'UNKNOWN',
      details: {
        ad_id: String(ad.id),
        type: ad.type || null,
        ad_strength: aga.adStrength || null,
        approval: aga.policySummary?.approvalStatus || null,
        final_url: ad.finalUrls?.[0] || null,
        path1: rsa.path1 || null,
        path2: rsa.path2 || null,
        headlines,
        descriptions: texts(rsa.descriptions),
      },
    };
  }

  const c = r.adGroupCriterion || {};
  if (!c.criterionId) return null;
  const q = c.qualityInfo || {};
  return {
    campaignId, level, entity_id: `${adGroupId}~${c.criterionId}`, ad_group_id: adGroupId,
    name: c.keyword?.text || `Palavra-chave ${c.criterionId}`,
    status: c.status || 'UNKNOWN',
    details: {
      match_type: c.keyword?.matchType || null,
      approval: c.approvalStatus || null,
      cpc_bid: micros(c.cpcBidMicros),
      effective_cpc_bid: micros(c.effectiveCpcBidMicros),
      quality_score: q.qualityScore ?? null,
      creative_quality: q.creativeQualityScore || null,
      landing_page_quality: q.postClickQualityScore || null,
      expected_ctr: q.searchPredictedCtr || null,
    },
  };
}

/** Sem a migration, a coleta segue sem este bloco — e sem gastar cota com ele. */
let tablesChecked: { ok: boolean; at: number } | null = null;
async function tablesReady(): Promise<boolean> {
  if (tablesChecked && Date.now() - tablesChecked.at < 10 * 60 * 1000) return tablesChecked.ok;
  const { error } = await supabaseAdmin().from('google_ads_entity_metrics').select('id').limit(1);
  tablesChecked = { ok: !error, at: Date.now() };
  return tablesChecked.ok;
}

async function inChunks<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

export interface EntitySyncResult {
  ran: boolean;
  entities: number;
  metric_rows: number;
}

/**
 * Busca e grava os três níveis de uma conta.
 *
 * productIdFor devolve o produto do painel de cada campanha; campanha sem
 * produto (removida antes de ter atividade) é ignorada.
 */
export async function syncEntities(
  q: (gaql: string) => Promise<any[]>,
  opts: {
    start: string;
    end: string;
    productIdFor: (campaignId: string) => string | undefined;
    /** Quais dos campos existem nesta versão da API (ver selectableFields). */
    selectable: (fields: string[]) => Promise<Set<string>>;
    /** Métricas que vão no bloco google_metrics, conforme o recurso aceita. */
    metricsFor: (resource: string) => Promise<string[]>;
    /**
     * Relê a lista completa de itens (inclusive os sem impressão) e marca os
     * removidos. Sem isso, só as métricas do período — que já trazem os dados
     * de cada item que apareceu.
     */
    withConfig?: boolean;
    /** A conta não tem conversão na janela: as consultas por ação voltariam vazias. */
    skipActions?: boolean;
    errors: string[];
  },
): Promise<EntitySyncResult> {
  const result: EntitySyncResult = { ran: false, entities: 0, metric_rows: 0 };
  if (!(await tablesReady())) return result;
  result.ran = true;

  const withConfig = opts.withConfig !== false;
  const levels: EntityLevel[] = ['ad_group', 'ad', 'keyword'];
  // Um campo renomeado pelo Google derrubaria a consulta do nível inteiro.
  const available = await opts.selectable(levels.flatMap(l => FIELDS[l].fields));
  const fetched = await Promise.all(levels.map(async level => {
    const f = FIELDS[level];
    const fields = f.fields.filter(x => available.has(x)).join(', ');
    const metricList = [...new Set([...BASE_METRICS, ...(await opts.metricsFor(f.from))])];
    const metrics = metricList.join(', ');
    const dailyQuery = (list: string) => q(`SELECT ${fields}, segments.date, ${list} FROM ${f.from}
         WHERE segments.date BETWEEN '${opts.start}' AND '${opts.end}'
           AND metrics.impressions > 0`);
    let usedMetrics = metricList;
    // Conversões por ação (Checkout, Compra…). Se falhar, o resto segue sem elas.
    const actionsQuery = opts.skipActions ? Promise.resolve([] as any[]) : q(`SELECT ${ID_FIELDS[f.from === 'ad_group' ? 'ad_group' : f.from === 'ad_group_ad' ? 'ad' : 'keyword']}, segments.date, ${ACTION_SELECT}
         FROM ${f.from} WHERE segments.date BETWEEN '${opts.start}' AND '${opts.end}' AND ${ACTION_WHERE}`)
      .catch((e: any) => { opts.errors.push(`${level} (ações de conversão): ${e.message}`); return null; });
    const [config, daily] = await Promise.all([
      withConfig ? q(`SELECT ${fields} FROM ${f.from} WHERE ${f.where}`) : Promise.resolve([] as any[]),
      // Métrica extra recusada pelo Google: refaz com o básico em vez de perder o nível.
      dailyQuery(metrics).catch((e: any) => {
        if (metricList.length === BASE_METRICS.length) throw e;
        console.warn(`[google-ads] ${level}: métricas extras recusadas, seguiu com o básico — ${e.message}`);
        usedMetrics = BASE_METRICS;
        return dailyQuery(BASE_METRICS.join(', '));
      }),
    ]).catch((e: any) => {
      opts.errors.push(`${level}: ${e.message}`);
      return [null, null] as const;
    });
    return { level, config, daily, metricList: usedMetrics, actionRows: await actionsQuery };
  }));

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  for (const { level, config, daily, metricList, actionRows } of fetched) {
    if (!config || !daily) continue;

    const entities = new Map<string, Entity>();
    for (const r of config) {
      const e = toEntity(level, r);
      if (e) entities.set(`${e.campaignId}|${e.entity_id}`, e);
    }
    const current = new Set(entities.keys());

    // Ações por item e dia; chave campanha|item|dia.
    const actions = new Map<string, ActionCounts>();
    for (const r of actionRows || []) {
      const e = toEntity(level, r);
      if (e) addActionRow(actions, `${e.campaignId}|${e.entity_id}|${r.segments?.date}`, r);
    }
    const withActions = new Set<string>();

    const metricRows: any[] = [];
    for (const r of daily) {
      const e = toEntity(level, r);
      if (!e) continue;
      const pid = opts.productIdFor(e.campaignId);
      if (!pid) continue;
      const k = `${e.campaignId}|${e.entity_id}`;
      // Fora da lista atual = removido no Google, mas gastou na janela. Sem a
      // lista, vale o que a própria linha traz.
      if (!entities.has(k)) entities.set(k, withConfig ? { ...e, status: 'REMOVED' } : e);
      metricRows.push({
        product_id: pid, level, entity_id: e.entity_id, date: r.segments?.date,
        impressions: n(r.metrics?.impressions),
        clicks: n(r.metrics?.clicks),
        cost: n(r.metrics?.costMicros) / 1e6,
        conversions: n(r.metrics?.conversions),
        conversions_value: n(r.metrics?.conversionsValue),
        google_metrics: normalizeMetrics(r.metrics, metricList),
        // {} quando a consulta de ações rodou e não achou nada: limpa o que estava gravado.
        ...(actionRows ? { conversion_actions: actions.get(`${k}|${r.segments?.date}`) || {} } : {}),
        updated_at: now,
      });
      withActions.add(`${k}|${r.segments?.date}`);
    }
    // Conversão num dia sem impressão (clique de um dia, conversão contada em outro).
    for (const [ak, ca] of actions) {
      if (withActions.has(ak)) continue;
      const [campaignId, entityId, date] = ak.split('|');
      const pid = opts.productIdFor(campaignId);
      if (!pid || !entities.has(`${campaignId}|${entityId}`)) continue;
      metricRows.push({
        product_id: pid, level, entity_id: entityId, date,
        impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0,
        google_metrics: {}, conversion_actions: ca, updated_at: now,
      });
    }

    const entityRows: any[] = [];
    const products = new Set<string>();
    for (const e of entities.values()) {
      const pid = opts.productIdFor(e.campaignId);
      if (!pid) continue;
      products.add(pid);
      entityRows.push({
        product_id: pid, level, entity_id: e.entity_id, ad_group_id: e.ad_group_id,
        name: e.name, status: e.status, details: e.details, updated_at: now,
      });
    }

    await inChunks(entityRows, 500, async chunk => {
      const { error } = await db.from('google_ads_entities').upsert(chunk, { onConflict: 'product_id, level, entity_id' });
      if (error) opts.errors.push(`${level} (itens): ${error.message}`);
    });
    await inChunks(metricRows, 500, async chunk => {
      let { error } = await db.from('google_ads_entity_metrics').upsert(chunk, { onConflict: 'product_id, level, entity_id, date' });
      // conversion_actions e google_metrics só existem depois das migrations.
      if (error && /conversion_actions/.test(error.message || '')) {
        ({ error } = await db.from('google_ads_entity_metrics').upsert(
          chunk.map(({ conversion_actions, ...rest }) => rest), { onConflict: 'product_id, level, entity_id, date' }));
      }
      if (error && /google_metrics/.test(error.message || '')) {
        ({ error } = await db.from('google_ads_entity_metrics').upsert(
          chunk.map(({ google_metrics, conversion_actions, ...rest }) => rest), { onConflict: 'product_id, level, entity_id, date' }));
      }
      if (error) opts.errors.push(`${level} (métricas): ${error.message}`);
    });

    // O que estava gravado como ativo e sumiu da lista do Google foi removido lá.
    if (!withConfig) { result.entities += entityRows.length; result.metric_rows += metricRows.length; continue; }
    const currentIds = new Set([...current].map(k => k.split('|')[1]));
    const gone: string[] = [];
    await inChunks([...products], 100, async chunk => {
      for (let page = 0; ; page++) {
        const { data } = await db.from('google_ads_entities').select('id, entity_id')
          .in('product_id', chunk).eq('level', level).neq('status', 'REMOVED')
          .range(page * 1000, page * 1000 + 999);
        for (const d of data || []) if (!currentIds.has(d.entity_id)) gone.push(d.id);
        if (!data || data.length < 1000) break;
      }
    });
    await inChunks(gone, 200, async chunk => {
      await db.from('google_ads_entities').update({ status: 'REMOVED', updated_at: now }).in('id', chunk);
    });

    result.entities += entityRows.length;
    result.metric_rows += metricRows.length;
  }

  return result;
}
