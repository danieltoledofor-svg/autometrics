import { supabaseAdmin } from './server';

/**
 * Sitelinks, frases de destaque, promoções e snippets ligados à campanha.
 *
 * Uma consulta por conta (campaign_asset × dia), gravada nas mesmas tabelas de
 * grupos, anúncios e palavras-chave com level = 'asset'. entity_id é
 * "TIPO~id do recurso", porque o mesmo recurso pode servir como sitelink numa
 * campanha e aparecer de novo em outra.
 *
 * Recurso ligado à conta inteira (customer_asset) não entra: o Google não
 * separa o desempenho dele por campanha.
 */

const FIELD_TYPES = ['SITELINK', 'CALLOUT', 'PROMOTION', 'STRUCTURED_SNIPPET'];

const FIELDS = [
  'campaign.id',
  'asset.id',
  'asset.type',
  'campaign_asset.field_type',
  'campaign_asset.status',
  'asset.sitelink_asset.link_text',
  'asset.sitelink_asset.description1',
  'asset.sitelink_asset.description2',
  'asset.callout_asset.callout_text',
  'asset.promotion_asset.promotion_target',
  'asset.structured_snippet_asset.header',
  'asset.structured_snippet_asset.values',
];

const n = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function describe(r: any): { name: string; details: Record<string, any> } {
  const a = r.asset || {};
  const type = r.campaignAsset?.fieldType || a.type || 'ASSET';
  if (type === 'SITELINK') {
    const s = a.sitelinkAsset || {};
    return { name: s.linkText || `Sitelink ${a.id}`, details: { field_type: type, description1: s.description1 || null, description2: s.description2 || null } };
  }
  if (type === 'CALLOUT') return { name: a.calloutAsset?.calloutText || `Frase ${a.id}`, details: { field_type: type } };
  if (type === 'PROMOTION') return { name: a.promotionAsset?.promotionTarget || `Promoção ${a.id}`, details: { field_type: type } };
  const sn = a.structuredSnippetAsset || {};
  return { name: sn.header ? `${sn.header}: ${(sn.values || []).join(', ')}` : `Recurso ${a.id}`, details: { field_type: type } };
}

export async function syncAssets(
  q: (gaql: string) => Promise<any[]>,
  opts: {
    start: string;
    end: string;
    productIdFor: (campaignId: string) => string | undefined;
    selectable: (fields: string[]) => Promise<Set<string>>;
    errors: string[];
  },
): Promise<number> {
  const available = await opts.selectable(FIELDS);
  if (!available.has('campaign_asset.field_type')) return 0;
  let rows: any[];
  try {
    rows = await q(`SELECT ${FIELDS.filter(f => available.has(f)).join(', ')}, segments.date,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
      FROM campaign_asset
      WHERE segments.date BETWEEN '${opts.start}' AND '${opts.end}'
        AND campaign_asset.field_type IN (${FIELD_TYPES.map(t => `'${t}'`).join(', ')})
        AND metrics.impressions > 0`);
  } catch (e: any) {
    opts.errors.push(`sitelinks: ${e.message}`);
    return 0;
  }

  const now = new Date().toISOString();
  const entities = new Map<string, any>();
  const metrics = new Map<string, any>();
  for (const r of rows) {
    const pid = opts.productIdFor(String(r.campaign?.id || ''));
    const assetId = r.asset?.id;
    const date = r.segments?.date;
    if (!pid || !assetId || !date) continue;
    const type = r.campaignAsset?.fieldType || r.asset?.type || 'ASSET';
    const entityId = `${type}~${assetId}`;
    const { name, details } = describe(r);
    entities.set(`${pid}|${entityId}`, {
      product_id: pid, level: 'asset', entity_id: entityId, ad_group_id: null,
      name, status: r.campaignAsset?.status || 'UNKNOWN', details, updated_at: now,
    });
    const mk = `${pid}|${entityId}|${date}`;
    const cur = metrics.get(mk) || {
      product_id: pid, level: 'asset', entity_id: entityId, date,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, updated_at: now,
    };
    cur.impressions += n(r.metrics?.impressions);
    cur.clicks += n(r.metrics?.clicks);
    cur.cost += n(r.metrics?.costMicros) / 1e6;
    cur.conversions += n(r.metrics?.conversions);
    cur.conversions_value += n(r.metrics?.conversionsValue);
    metrics.set(mk, cur);
  }

  const db = supabaseAdmin();
  const ent = [...entities.values()];
  for (let i = 0; i < ent.length; i += 500) {
    const { error } = await db.from('google_ads_entities').upsert(ent.slice(i, i + 500), { onConflict: 'product_id, level, entity_id' });
    if (error) { opts.errors.push(`sitelinks (itens): ${error.message}`); return 0; }
  }
  const met = [...metrics.values()];
  for (let i = 0; i < met.length; i += 500) {
    const { error } = await db.from('google_ads_entity_metrics').upsert(met.slice(i, i + 500), { onConflict: 'product_id, level, entity_id, date' });
    if (error) { opts.errors.push(`sitelinks (métricas): ${error.message}`); return 0; }
  }
  return ent.length;
}
