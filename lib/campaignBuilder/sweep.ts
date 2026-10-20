import { supabaseAdmin } from '@/lib/googleAds/server';
import { resolveProductStatus, type StatusKey } from '@/lib/campaignStatus';
import { jevChoose, jevEnabled } from '@/lib/ai/jev';
import type { AdModel } from './rules';

/**
 * Varredura dos anúncios de um mecanismo, para a IA escrever os recursos novos.
 *
 * Lê todos os anúncios das campanhas do usuário com o trecho no nome (a
 * marcação dele, como [BP]) — ativas, pausadas e suspensas — nos últimos 180
 * dias. Anúncio com os mesmos títulos em várias campanhas (campanha duplicada)
 * conta como um modelo só, com os números somados.
 *
 * Quem separa "copiar" de "evitar" é o Jev (TypeSafe), com a situação em
 * palavras (ele erra conta com número cru: a conta é feita aqui). Sem o Jev, ou
 * quando ele não responde, vale a regra do código. Aquecimento e EST 1% ficam
 * de fora, a não ser que o trecho seja deles. Nada é gravado.
 */

const DAYS = 180;
const n = (v: any) => Number(v) || 0;

export interface SweepAd extends AdModel { campanhas: string[]; conversoes: number; custo: number; cpa: number | null; ctr: number | null; por: 'jev' | 'regra' }
/**
 * Um título ou uma descrição, com a soma dos anúncios em que apareceu. O Google
 * não conta conversão por título: o número é o dos anúncios que o usaram.
 */
export interface SweepText {
  texto: string; conversoes: number; custo: number; cpa: number | null; anuncios: number; campanhas: number;
  /** O que o Jev (ou a regra) disse dos anúncios que usaram este texto: algum para copiar, ou só para evitar. */
  veredito?: 'copiar' | 'evitar' | null;
  desc1?: string; desc2?: string;      // sitelink
}
export interface Sweep {
  trecho: string; dias: number;
  campanhas: Record<StatusKey, number>;
  anuncios: number;          // modelos de anúncio diferentes lidos
  analisados: number;        // com dados suficientes para julgar
  jev: number;               // quantos o Jev julgou
  copiar: SweepAd[]; evitar: SweepAd[];
  /** Cada título e cada descrição usados, dos que mais converteram para os que nada converteram. */
  titulos: SweepText[]; descricoes: SweepText[];
  /** Sitelinks e frases de destaque dessas campanhas, cada um com o próprio número (o Google conta por recurso). */
  sitelinks: SweepText[]; destaques: SweepText[];
}

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

const SITUATION: Record<StatusKey, string> = { ativo: 'ativa', pausado: 'pausada', suspenso: 'suspensa ou sem veicular' };
const SITUATION_EN: Record<StatusKey, string> = { ativo: 'active', pausado: 'paused by the advertiser', suspenso: 'suspended or not serving' };

function salesBucket(c: number) {
  if (c <= 0) return 'no sales';
  if (c < 1.5) return 'about 1 sale';
  if (c < 4) return 'a few sales (2-3)';
  if (c < 10) return 'several sales (4-9)';
  return 'many sales (10 or more)';
}
function cpaBucket(cpa: number | null, avg: number | null, cost: number) {
  if (!avg) return 'no average to compare';
  if (cpa === null) return cost >= 2 * avg ? 'spent more than two average sales without selling' : cost >= avg ? 'spent about one average sale without selling' : 'spent less than one average sale without selling';
  const r = cpa / avg;
  if (r < 0.8) return 'cost per sale clearly below the average of the niche (good)';
  if (r <= 1.2) return 'cost per sale close to the average of the niche';
  if (r <= 2) return 'cost per sale above the average of the niche';
  return 'cost per sale far above the average of the niche (bad)';
}
function ctrBucket(ctr: number | null, avg: number | null) {
  if (ctr === null || !avg) return 'unknown';
  const r = ctr / avg;
  return r < 0.7 ? 'click rate well below the niche average' : r <= 1.3 ? 'click rate close to the niche average' : 'click rate well above the niche average';
}

const QUESTIONS = {
  modelo: {
    type: 'choice',
    instructions: 'An affiliate is writing a new Google Search ad for this niche and wants to learn from the ads of older campaigns of the same niche (active, paused or suspended). Should the headlines and descriptions of this ad be used as a model, avoided, or treated as neutral?',
    criteria: {
      copiar: 'Use as a model: it sold with a cost per sale at or below the niche average, with enough data to trust it.',
      evitar: 'Avoid: it spent a meaningful amount without selling, or its cost per sale is far above the niche average.',
      neutro: 'Neutral: results close to average, or too little data to tell.',
    },
  },
};

export async function sweepAds(userId: string, piece: string): Promise<Sweep> {
  const db = supabaseAdmin();
  const trecho = piece.trim().slice(0, 60);
  const empty: Sweep = { trecho, dias: DAYS, campanhas: { ativo: 0, pausado: 0, suspenso: 0 }, anuncios: 0, analisados: 0, jev: 0, copiar: [], evitar: [], titulos: [], descricoes: [], sitelinks: [], destaques: [] };
  if (trecho.length < 2) return empty;
  const safe = trecho.replace(/[%_\\]/g, m => `\\${m}`).replace(/[,()]/g, ' ');
  const { data: products } = await db.from('products').select('id, name, google_ads_campaign_name, status, google_status, google_status_reasons').eq('user_id', userId)
    .or(`google_ads_campaign_name.ilike.%${safe}%,name.ilike.%${safe}%`).limit(400);
  const low = trecho.toLowerCase();
  const apart = (name: string) => /\[(aq|aquecimento|est 1%)\]/i.test(name) && !/\[(aq|aquecimento|est 1%)\]/i.test(trecho);
  const mine = (products || []).map(p => ({ ...p, label: p.google_ads_campaign_name || p.name || '' }))
    .filter(p => `${p.label} ${p.name || ''}`.toLowerCase().includes(low) && !apart(p.label));
  if (!mine.length) return empty;
  const statusOf = new Map(mine.map(p => [p.id, resolveProductStatus(p).key]));
  const nameOf = new Map(mine.map(p => [p.id, p.label]));
  const campanhas = { ...empty.campanhas };
  for (const s of statusOf.values()) campanhas[s]++;

  const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const ids = mine.map(p => p.id), metrics: any[] = [], entities: any[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const [m, e] = await Promise.all([
      all((a, b) => db.from('google_ads_entity_metrics').select('product_id, level, entity_id, impressions, clicks, cost, conversions').in('product_id', chunk).in('level', ['ad', 'asset']).gte('date', since).range(a, b)),
      all((a, b) => db.from('google_ads_entities').select('product_id, level, entity_id, name, details').in('product_id', chunk).in('level', ['ad', 'asset']).range(a, b)),
    ]);
    metrics.push(...m); entities.push(...e);
  }

  // Um modelo = o mesmo conjunto de títulos, em qualquer campanha.
  type Acc = { titulos: string[]; descricoes: string[]; strength: string; products: Set<string>; imp: number; clicks: number; cost: number; conv: number };
  const models = new Map<string, Acc>(), modelOf = new Map<string, string>();
  // Sitelinks e frases de destaque: o Google conta cada um, então o número é dele mesmo.
  type Asset = { texto: string; desc1: string; desc2: string; conv: number; cost: number; products: Set<string> };
  const links = new Map<string, Asset>(), callouts = new Map<string, Asset>(), assetOf = new Map<string, [Map<string, Asset>, string]>();
  for (const e of entities) {
    if (e.level !== 'asset') continue;
    const type = e.details?.field_type, into = type === 'SITELINK' ? links : type === 'CALLOUT' ? callouts : null, text = String(e.name || '').trim();
    if (!into || !text) continue;
    const k = text.toLowerCase();
    if (!into.has(k)) into.set(k, { texto: text, desc1: String(e.details?.description1 || ''), desc2: String(e.details?.description2 || ''), conv: 0, cost: 0, products: new Set() });
    assetOf.set(`${e.product_id}|${e.entity_id}`, [into, k]);
  }
  for (const e of entities) {
    if (e.level !== 'ad') continue;
    const titulos = (e.details?.headlines || []).map((h: any) => String(h.text || '').trim()).filter(Boolean);
    if (!titulos.length) continue;
    const key = [...titulos].map(t => t.toLowerCase()).sort().join('|');
    if (!models.has(key)) models.set(key, { titulos, descricoes: (e.details?.descriptions || []).map((h: any) => String(h.text || '').trim()).filter(Boolean), strength: String(e.details?.ad_strength || ''), products: new Set(), imp: 0, clicks: 0, cost: 0, conv: 0 });
    modelOf.set(`${e.product_id}|${e.entity_id}`, key);
  }
  for (const m of metrics) {
    if (m.level === 'asset') {
      const hit = assetOf.get(`${m.product_id}|${m.entity_id}`);
      if (hit) { const y = hit[0].get(hit[1])!; y.conv += n(m.conversions); y.cost += n(m.cost); y.products.add(m.product_id); }
      continue;
    }
    const key = modelOf.get(`${m.product_id}|${m.entity_id}`);
    if (!key) continue;
    const x = models.get(key)!;
    x.products.add(m.product_id); x.imp += n(m.impressions); x.clicks += n(m.clicks); x.cost += n(m.cost); x.conv += n(m.conversions);
  }
  const used = [...models.values()].filter(x => x.imp > 0);
  const tot = used.reduce((a, x) => ({ cost: a.cost + x.cost, conv: a.conv + x.conv, clicks: a.clicks + x.clicks, imp: a.imp + x.imp }), { cost: 0, conv: 0, clicks: 0, imp: 0 });
  const texts = (pick: (x: Acc) => string[]): SweepText[] => {
    const map = new Map<string, { texto: string; conv: number; cost: number; ads: number; products: Set<string> }>();
    for (const x of used) for (const t of new Set(pick(x))) {
      const k = t.toLowerCase();
      if (!map.has(k)) map.set(k, { texto: t, conv: 0, cost: 0, ads: 0, products: new Set() });
      const y = map.get(k)!;
      y.conv += x.conv; y.cost += x.cost; y.ads++; x.products.forEach(p => y.products.add(p));
    }
    return [...map.values()].sort((a, b) => b.conv - a.conv || a.cost - b.cost).map(y => ({
      texto: y.texto, conversoes: Math.round(y.conv * 10) / 10, custo: Math.round(y.cost * 100) / 100,
      cpa: y.conv > 0 ? Math.round((y.cost / y.conv) * 100) / 100 : null, anuncios: y.ads, campanhas: y.products.size,
    }));
  };
  const avgCpa = tot.conv > 0 ? tot.cost / tot.conv : null, avgCtr = tot.imp > 0 ? tot.clicks / tot.imp : null;

  // Dados suficientes: 30 cliques ou o gasto de meia venda média. Os de mais gasto primeiro; até 60 vão ao Jev.
  const judged = used.filter(x => x.clicks >= 30 || (avgCpa !== null && x.cost >= avgCpa / 2)).sort((a, b) => b.cost - a.cost).slice(0, 60);
  const rule = (x: Acc, cpa: number | null) => {
    if (avgCpa === null) return 'neutro';
    if (x.conv >= 2 && cpa !== null && cpa <= avgCpa * 1.2) return 'copiar';
    if ((x.conv === 0 && x.cost >= avgCpa) || (cpa !== null && cpa > avgCpa * 2)) return 'evitar';
    return 'neutro';
  };
  let byJev = 0;
  const out: (SweepAd & { verdict: string })[] = [];
  const queue = [...judged];
  const worker = async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      const cpa = x.conv > 0 ? x.cost / x.conv : null, ctr = x.imp > 0 ? x.clicks / x.imp : null;
      const statuses = [...x.products].map(p => statusOf.get(p)!);
      const best: StatusKey = statuses.includes('ativo') ? 'ativo' : statuses.includes('pausado') ? 'pausado' : 'suspenso';
      const answer = jevEnabled() ? await jevChoose({ userId, productId: [...x.products][0] }, {
        item_type: 'search ad text (headlines and descriptions)',
        campaign_status: SITUATION_EN[best],
        used_in_campaigns: x.products.size,
        sales: salesBucket(x.conv),
        versus_average: cpaBucket(cpa, avgCpa, x.cost),
        click_rate: ctrBucket(ctr, avgCtr),
        ad_strength: x.strength.toLowerCase() || 'unknown',
      }, QUESTIONS, 'modelo', ['copiar', 'evitar', 'neutro']) : null;
      if (answer) byJev++;
      const counts = (['ativo', 'pausado', 'suspenso'] as StatusKey[]).map(k => [k, statuses.filter(s => s === k).length] as const).filter(([, c]) => c);
      const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      out.push({
        verdict: answer?.choice || rule(x, cpa), por: answer ? 'jev' : 'regra',
        situacao: `em ${x.products.size} ${x.products.size === 1 ? 'campanha' : 'campanhas'}: ${counts.map(([k, c]) => `${c} ${SITUATION[k]}`).join(', ')}`,
        resultado: `${Math.round(x.conv * 10) / 10} conversões, ${cpa === null ? 'sem CPA' : `CPA ${money(cpa)}`}${avgCpa ? ` (média do mecanismo ${money(avgCpa)})` : ''}, CTR ${ctr === null ? '—' : `${(ctr * 100).toFixed(1).replace('.', ',')}%`}`,
        titulos: x.titulos, descricoes: x.descricoes, campanhas: [...x.products].map(p => nameOf.get(p) || '').filter(Boolean),
        conversoes: Math.round(x.conv * 10) / 10, custo: Math.round(x.cost * 100) / 100, cpa: cpa === null ? null : Math.round(cpa * 100) / 100, ctr: ctr === null ? null : Math.round(ctr * 10000) / 100,
      });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  // Texto usado em algum anúncio para copiar vale copiar; usado só em anúncios para evitar, evitar.
  const verdictOf = new Map<string, Set<string>>();
  for (const a of out) for (const t of [...a.titulos, ...a.descricoes]) {
    const k = t.toLowerCase();
    if (!verdictOf.has(k)) verdictOf.set(k, new Set());
    verdictOf.get(k)!.add(a.verdict);
  }
  const judge = (t: SweepText): SweepText => {
    const v = verdictOf.get(t.texto.toLowerCase());
    return { ...t, veredito: v?.has('copiar') ? 'copiar' : v && v.size === 1 && v.has('evitar') ? 'evitar' : null };
  };
  const assets = (map: Map<string, Asset>): SweepText[] => [...map.values()].filter(y => y.products.size).sort((a, b) => b.conv - a.conv || a.cost - b.cost).map(y => ({
    texto: y.texto, desc1: y.desc1, desc2: y.desc2, conversoes: Math.round(y.conv * 10) / 10, custo: Math.round(y.cost * 100) / 100,
    cpa: y.conv > 0 ? Math.round((y.cost / y.conv) * 100) / 100 : null, anuncios: 0, campanhas: y.products.size,
  }));
  const strip = ({ verdict: _v, ...ad }: SweepAd & { verdict: string }): SweepAd => ad;
  return {
    trecho, dias: DAYS, campanhas, anuncios: used.length, analisados: judged.length, jev: byJev,
    copiar: out.filter(a => a.verdict === 'copiar').sort((a, b) => b.conversoes - a.conversoes).slice(0, 8).map(strip),
    evitar: out.filter(a => a.verdict === 'evitar').sort((a, b) => b.custo - a.custo).slice(0, 6).map(strip),
    titulos: texts(x => x.titulos).slice(0, 80).map(judge), descricoes: texts(x => x.descricoes).slice(0, 30).map(judge),
    sitelinks: assets(links).slice(0, 30), destaques: assets(callouts).slice(0, 30),
  };
}
