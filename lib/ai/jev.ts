import { supabaseAdmin } from '@/lib/googleAds/server';

/**
 * Jev (TypeSafe): modelo rápido de escolha. Responde "mexer agora" ou
 * "esperar" para cada sugestão nova da análise, em cerca de 0,3 s e por menos
 * de um milésimo de centavo cada.
 *
 * Por que só isso: no teste de 17/10/2026 (scripts/jev-teste.mjs, 401
 * sugestões), dos itens que voltaram ao normal sem ninguém mexer ele mandou
 * esperar em 73%, e nas 4 alterações que pioraram a campanha ele tinha dito
 * esperar. Na escolha de QUAL alteração ele foi pior que a regra do código
 * (chegou a mandar excluir o país principal), então essa escolha continua
 * com a IA de leitura e com guardAction.
 *
 * O Jev lê melhor palavras que números: a conta é feita aqui e vai em faixas.
 * Sem TYPESAFE_API_KEY, ou se ele não responder em 6 s, a sugestão nasce sem
 * a marca — nada mais depende dele.
 */

const MODEL = process.env.JEV_MODEL || 'jev-1.14.0';
const USD_PER_M_INPUT = 0.042;

export const jevEnabled = () => !!process.env.TYPESAFE_API_KEY;

export interface JevVerdict { choice: 'esperar' | 'mudar_agora'; confidence: number; model: string }

const ITEM_EN: Record<string, string> = {
  termos: 'search term', palavras_chave: 'keyword', dispositivos: 'device', publicos: 'audience segment (age, gender)',
  locais: 'location', anuncios: 'ad', sitelinks: 'ad asset',
};

function salesBucket(n: number) {
  if (!n || n <= 0) return 'no sales';
  if (n < 1.5) return 'about 1 sale';
  if (n < 4) return 'a few sales (2-3)';
  return 'many sales (4 or more)';
}
function cpaVsTarget(row: any) {
  const p = row.pct;
  if (p === null || p === undefined) return 'unknown';
  if (row.conv3 > 0) {
    if (p < 0.9) return 'cost per sale clearly below the target (good)';
    if (p <= 1.1) return 'cost per sale close to the target';
    if (p <= 1.5) return 'cost per sale somewhat above the target';
    return 'cost per sale far above the target (bad)';
  }
  if (p < 0.5) return 'spent less than half of one target sale without selling';
  if (p <= 1) return 'spent between half and one full target sale without selling';
  if (p <= 2) return 'spent between one and two target sales without selling';
  return 'spent more than two target sales without selling';
}
function vsCampaign(rowCpa: number | null, campCpa: number) {
  if (rowCpa === null || rowCpa === undefined || !campCpa) return 'not comparable';
  const r = rowCpa / campCpa;
  if (r < 0.9) return 'better than the campaign average';
  if (r <= 1.1) return 'about the same as the campaign average';
  if (r <= 1.5) return 'somewhat worse than the campaign average';
  return 'much worse than the campaign average';
}
function share(cost: number, total: number) {
  const s = total > 0 ? cost / total : 0;
  return s < 0.1 ? 'small (under 10% of campaign spend)' : s <= 0.25 ? 'medium (10-25% of campaign spend)' : 'large (over 25% of campaign spend)';
}
function trend(row: any) {
  // 7 dias inclui os 3. Os 4 dias de antes = 7d − 3d.
  const costBefore = row.cost7 - row.cost3, convBefore = row.conv7 - row.conv3;
  if (costBefore <= 0) return 'no data before the last 3 days (new)';
  if (convBefore <= 0 && row.conv3 <= 0) return 'no sales in the whole week';
  if (convBefore <= 0) return 'sold in the last 3 days but not in the 4 days before';
  if (row.conv3 <= 0) return 'sold in the 4 days before but stopped selling in the last 3 days';
  const before = costBefore / convBefore, now = row.cpa3;
  if (now < before * 0.9) return 'cost per sale improving';
  if (now > before * 1.1) return 'cost per sale getting worse';
  return 'cost per sale stable';
}

/** A mesma situação do teste (scripts/jev-teste.mjs), montada a partir do item e da campanha. */
function stateFor(item: string, row: any, camp: { cost?: any; sales?: any; cpa?: any }, refMode: string, keyword?: string | null) {
  const campCost = Number(camp.cost) || 0, campSales = Number(camp.sales) || 0;
  const st: Record<string, any> = {
    item_type: ITEM_EN[item],
    item_name: row.label,
    target_mode: ({ venda: 'target = sale commission', meta_cpa: 'target = CPA goal', cpa_7d: 'target = 7-day campaign CPA' } as Record<string, string>)[refMode] || refMode,
    last_3_days: {
      sales: salesBucket(row.conv3),
      versus_target: cpaVsTarget(row),
      versus_campaign: vsCampaign(row.cpa3, Number(camp.cpa) || 0),
      share_of_spend: share(row.cost3, campCost),
    },
    last_7_days: { sales: salesBucket(row.conv7) },
    trend: trend(row),
    campaign_last_3_days: { sales: salesBucket(campSales), status: campSales > 0 ? 'campaign is selling' : 'campaign has no sales' },
    sales_are_estimated: !!row.approx,
  };
  if (item === 'termos' && keyword) st.triggered_by_keyword = keyword;
  if (item === 'termos' && row.tag) st.match_type = row.tag;
  if (item === 'anuncios' && row.extra?.strength) st.ad_strength = String(row.extra.strength).toLowerCase();
  if (item === 'sitelinks' && row.tag) st.asset_type = row.tag;
  return st;
}

const QUESTIONS = {
  agir: {
    type: 'choice',
    instructions: 'A Google Ads affiliate is looking at this item flagged by an automatic check. Should they change it now, or wait a few more days because the numbers are too small or too close to normal to be sure?',
    criteria: {
      mudar_agora: 'Change now: the problem is clear and the item is losing money with enough data to be confident.',
      esperar: 'Wait: little data, close to the target, a recent change, or the item is still selling; it may return to normal on its own.',
    },
  },
};

/** Mexer agora ou esperar, para uma sugestão. null quando o Jev está desligado ou não respondeu. */
export async function jevWaitOrAct(args: {
  userId: string; productId: string; item: string; row: any;
  campaign: { cost?: any; sales?: any; cpa?: any }; refMode: string; keyword?: string | null;
}): Promise<JevVerdict | null> {
  if (!jevEnabled() || !ITEM_EN[args.item] || !args.row) return null;
  const started = Date.now();
  try {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state: stateFor(args.item, args.row, args.campaign, args.refMode, args.keyword), questions: QUESTIONS }),
      signal: AbortSignal.timeout(6_000),
    });
    const body = await res.json().catch(() => ({}));
    const a = body?.answers?.agir;
    const ok = res.ok && (a?.choice === 'esperar' || a?.choice === 'mudar_agora');
    await log(args, body, ok, ok ? null : `Jev ${res.status}: ${JSON.stringify(body).slice(0, 200)} (${Date.now() - started} ms)`);
    if (!ok) return null;
    return { choice: a.choice, confidence: Number(a.confidence) || 0, model: String(body.model || MODEL) };
  } catch (e: any) {
    await log(args, {}, false, `${e.message} (${Date.now() - started} ms)`);
    return null;
  }
}

/** Entra no mesmo registro de consumo da IA (painel /ia do dono). */
async function log(args: { userId: string; productId: string }, body: any, ok: boolean, error: string | null) {
  const input = Number(body?.usage?.input_tokens) || 0;
  const { error: dbError } = await supabaseAdmin().from('ai_usage').insert({
    user_id: args.userId, product_id: args.productId, function: 'jev', model: String(body?.model || MODEL),
    input_tokens: input, output_tokens: 0, cost_usd: (input / 1e6) * USD_PER_M_INPUT, ok, error,
  });
  if (dbError) console.warn('[jev] consumo não registrado:', dbError.message);
}
