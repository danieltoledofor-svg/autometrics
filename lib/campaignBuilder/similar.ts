import { supabaseAdmin } from '@/lib/googleAds/server';

/**
 * O que funcionou nas campanhas parecidas do próprio usuário, para o passo do
 * anúncio no criador: palavras-chave, termos de pesquisa, sitelinks e frases de
 * destaque com mais conversões, e os anúncios que mais converteram.
 *
 * "Parecida" é a campanha cujo nome contém o trecho informado (a marcação de
 * nicho dele, como [WL]). Só campanhas do mesmo login; nada de outras contas.
 * Tudo sai do banco, dos últimos 30 dias.
 *
 * O Google não informa conversão por título ou descrição: os títulos vêm dos
 * anúncios que mais converteram, inteiros.
 */

const n = (v: any) => Number(v) || 0;
const DAYS = 30;

async function all(build: (a: number, b: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let p = 0; p < 40; p++) {
    const { data, error } = await build(p * 1000, p * 1000 + 999);
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export interface SimilarRow { texto: string; tipo?: string; campanhas: number; conversoes: number; custo: number; cpa: number | null; extra?: Record<string, string> }
export interface Similar {
  trecho: string; campanhas: number; dias: number;
  palavras: SimilarRow[]; termos: SimilarRow[]; sitelinks: SimilarRow[]; destaques: SimilarRow[];
  anuncios: { campanha: string; conversoes: number; custo: number; titulos: string[]; descricoes: string[] }[];
}

export async function similarCampaigns(userId: string, piece: string): Promise<Similar> {
  const db = supabaseAdmin();
  const trecho = piece.trim().slice(0, 60);
  const empty: Similar = { trecho, campanhas: 0, dias: DAYS, palavras: [], termos: [], sitelinks: [], destaques: [], anuncios: [] };
  if (trecho.length < 2) return empty;
  const safe = trecho.replace(/[%_\\]/g, m => `\\${m}`);
  const { data: products } = await db.from('products').select('id, name, google_ads_campaign_name').eq('user_id', userId)
    .or(`google_ads_campaign_name.ilike.%${safe.replace(/[,()]/g, ' ')}%,name.ilike.%${safe.replace(/[,()]/g, ' ')}%`).limit(400);
  // O filtro do banco troca vírgula e parêntese por espaço; aqui vale o trecho exato.
  const mine = (products || []).filter(p => `${p.google_ads_campaign_name || ''} ${p.name || ''}`.toLowerCase().includes(trecho.toLowerCase()));
  if (!mine.length) return empty;
  const ids = mine.map(p => p.id), nameOf = new Map(mine.map(p => [p.id, p.google_ads_campaign_name || p.name || '']));
  const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
  const metrics: any[] = [], entities: any[] = [], terms: any[] = [];
  for (const chunk of chunks) {
    const [m, e, t] = await Promise.all([
      all((a, b) => db.from('google_ads_entity_metrics').select('product_id, level, entity_id, cost, conversions').in('product_id', chunk).in('level', ['keyword', 'ad', 'asset']).gte('date', since).range(a, b)),
      all((a, b) => db.from('google_ads_entities').select('product_id, level, entity_id, name, details').in('product_id', chunk).in('level', ['keyword', 'ad', 'asset']).range(a, b)),
      all((a, b) => db.from('search_terms').select('product_id, search_term, cost, conversions').in('product_id', chunk).gte('date', since).gt('conversions', 0).range(a, b)),
    ]);
    metrics.push(...m); entities.push(...e); terms.push(...t);
  }
  const entity = new Map(entities.map(e => [`${e.product_id}|${e.level}|${e.entity_id}`, e]));

  type Acc = { texto: string; tipo?: string; products: Set<string>; conv: number; cost: number; extra?: Record<string, string> };
  const rank = (map: Map<string, Acc>, top: number): SimilarRow[] => [...map.values()].filter(x => x.conv > 0)
    .sort((a, b) => b.conv - a.conv || a.cost - b.cost).slice(0, top)
    .map(x => ({ texto: x.texto, tipo: x.tipo, campanhas: x.products.size, conversoes: Math.round(x.conv * 10) / 10, custo: Math.round(x.cost * 100) / 100, cpa: x.conv > 0 ? Math.round((x.cost / x.conv) * 100) / 100 : null, extra: x.extra }));
  const add = (map: Map<string, Acc>, key: string, base: Omit<Acc, 'products' | 'conv' | 'cost'>, productId: string, conv: number, cost: number) => {
    if (!map.has(key)) map.set(key, { ...base, products: new Set(), conv: 0, cost: 0 });
    const x = map.get(key)!;
    x.products.add(productId); x.conv += conv; x.cost += cost;
  };

  const keywords = new Map<string, Acc>(), sitelinks = new Map<string, Acc>(), callouts = new Map<string, Acc>(), termMap = new Map<string, Acc>();
  const ads = new Map<string, { product: string; conv: number; cost: number; e: any }>();
  for (const m of metrics) {
    const e = entity.get(`${m.product_id}|${m.level}|${m.entity_id}`);
    if (!e) continue;
    const conv = n(m.conversions), cost = n(m.cost);
    if (m.level === 'keyword') add(keywords, `${String(e.name).toLowerCase()}|${e.details?.match_type || ''}`, { texto: String(e.name).toLowerCase(), tipo: e.details?.match_type || '' }, m.product_id, conv, cost);
    else if (m.level === 'asset' && e.details?.field_type === 'SITELINK') add(sitelinks, String(e.name).toLowerCase(), { texto: e.name, extra: { desc1: e.details?.description1 || '', desc2: e.details?.description2 || '' } }, m.product_id, conv, cost);
    else if (m.level === 'asset' && e.details?.field_type === 'CALLOUT') add(callouts, String(e.name).toLowerCase(), { texto: e.name }, m.product_id, conv, cost);
    else if (m.level === 'ad') {
      const k = `${m.product_id}|${m.entity_id}`;
      if (!ads.has(k)) ads.set(k, { product: m.product_id, conv: 0, cost: 0, e });
      const a = ads.get(k)!; a.conv += conv; a.cost += cost;
    }
  }
  for (const t of terms) add(termMap, String(t.search_term).toLowerCase(), { texto: String(t.search_term).toLowerCase() }, t.product_id, n(t.conversions), n(t.cost));

  return {
    trecho, campanhas: mine.length, dias: DAYS,
    palavras: rank(keywords, 20), termos: rank(termMap, 40), sitelinks: rank(sitelinks, 12), destaques: rank(callouts, 15),
    anuncios: [...ads.values()].filter(a => a.conv > 0 && (a.e.details?.headlines || []).length).sort((a, b) => b.conv - a.conv).slice(0, 4).map(a => ({
      campanha: nameOf.get(a.product) || '', conversoes: Math.round(a.conv * 10) / 10, custo: Math.round(a.cost * 100) / 100,
      titulos: (a.e.details.headlines || []).map((h: any) => String(h.text || '')).filter(Boolean),
      descricoes: (a.e.details.descriptions || []).map((h: any) => String(h.text || '')).filter(Boolean),
    })),
  };
}
