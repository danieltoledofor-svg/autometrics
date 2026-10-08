import { search, mutate, type AdsContext } from '@/lib/googleAds/client';
import { supabaseAdmin, decryptSecret } from '@/lib/googleAds/server';

/**
 * Alterações feitas pelo Autometrics dentro do Google Ads.
 *
 * Meta de CPA, limite de CPC e orçamento da campanha, meta de CPA de cada grupo
 * de anúncios, ajustes de lance por aparelho, idade, gênero, renda e local,
 * negativa de termo e pausa de palavra-chave. Os valores são lidos do Google na
 * hora (nunca do que a coleta guardou) e cada alteração passa antes por um
 * ensaio (validateOnly): se o Google recusar o ensaio, nada muda.
 *
 * Por enquanto só para os logins de lib/googleAds/editors.
 */

export { canEdit } from './editors';

export type Kind = 'meta_cpa' | 'meta_cpa_grupo' | 'limite_cpc' | 'orcamento' | 'aparelho' | 'idade' | 'genero' | 'renda' | 'local';
/**
 * Dinheiro na moeda da conta; ajustes em % (−20 = 20% a menos, 0 = sem ajuste).
 * `creates` são os grupos de anúncios onde a faixa ainda não tem linha no
 * Google: o ajuste é criado neles na primeira alteração.
 */
export interface Control { kind: Kind; key: string; label: string; value: number | null; editable: boolean; note?: string; resources: string[]; creates?: string[]; mixed?: boolean }

const DEVICE: Record<string, string> = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet', CONNECTED_TV: 'TV conectada', OTHER: 'Outros' };
const DEVICE_ID: Record<string, string> = { DESKTOP: '30000', MOBILE: '30001', TABLET: '30002', CONNECTED_TV: '30004' };
const AGE: Record<string, string> = {
  AGE_RANGE_18_24: '18 a 24', AGE_RANGE_25_34: '25 a 34', AGE_RANGE_35_44: '35 a 44', AGE_RANGE_45_54: '45 a 54',
  AGE_RANGE_55_64: '55 a 64', AGE_RANGE_65_UP: '65 ou mais', AGE_RANGE_UNDETERMINED: 'Idade desconhecida',
};
const GENDER: Record<string, string> = { MALE: 'Homens', FEMALE: 'Mulheres', UNDETERMINED: 'Gênero desconhecido' };
// O Google numera a renda de baixo para cima: 0_50 são os 50% de menor renda.
const INCOME: Record<string, string> = {
  INCOME_RANGE_90_UP: '10% com maior renda', INCOME_RANGE_80_90: '11–20% superiores', INCOME_RANGE_70_80: '21–30% superiores',
  INCOME_RANGE_60_70: '31–40% superiores', INCOME_RANGE_50_60: '41–50% superiores', INCOME_RANGE_0_50: '50% com menor renda',
  INCOME_RANGE_UNDETERMINED: 'Renda desconhecida',
};
const PEOPLE_FIELD: Record<string, string> = { idade: 'ageRange', genero: 'gender', renda: 'incomeRange' };
const money = (micros: any) => (micros === undefined || micros === null || micros === '' ? null : Math.round(Number(micros) / 10000) / 100);
const micros = (value: number) => String(Math.round(value * 100) * 10000);
/** 0,8 no Google = −20% na tela; sem valor (ou 1) = sem ajuste. */
const pct = (modifier: any) => (modifier === undefined || modifier === null ? 0 : Math.round((Number(modifier) - 1) * 100));
const modifier = (percent: number) => Math.round((1 + percent / 100) * 100) / 100;

/** Conta e acesso da campanha, só quando ela é do usuário. */
export async function campaignAccess(userId: string, productId: string) {
  const db = supabaseAdmin();
  const { data: product } = await db.from('products').select('id, name, google_ads_campaign_id, google_ads_customer_id, currency')
    .eq('id', productId).eq('user_id', userId).maybeSingle();
  if (!product) return { error: 'Campanha não encontrada.' as const };
  const campaignId = String(product.google_ads_campaign_id || '');
  if (!/^\d+$/.test(campaignId) || !product.google_ads_customer_id) return { error: 'Esta campanha não está ligada ao Google Ads pela API.' as const };
  const { data: acc } = await db.from('google_ads_accounts').select('customer_id, login_customer_id, connection_id, name, currency_code')
    .eq('user_id', userId).eq('customer_id', product.google_ads_customer_id).maybeSingle();
  if (!acc) return { error: 'A conta do Google desta campanha não está ligada. Ligue em Integração.' as const };
  const { data: conn } = await db.from('google_ads_connections').select('refresh_token_enc, status').eq('id', acc.connection_id).maybeSingle();
  if (!conn || conn.status !== 'ok') return { error: 'A ligação com o Google expirou. Reconecte em Integração.' as const };
  const ctx: AdsContext = { refreshToken: decryptSecret(conn.refresh_token_enc), customerId: acc.customer_id, loginCustomerId: acc.login_customer_id };
  return { product, campaignId, account: acc, ctx, currency: String(acc.currency_code || product.currency || 'USD') };
}

/** Tudo o que dá para alterar na campanha, com o valor que está no Google agora. */
export async function readControls(ctx: AdsContext, campaignId: string): Promise<{ strategy: string; controls: Control[]; api_calls: number }> {
  const cid = ctx.customerId, id = Number(campaignId);
  const [campRows, criteria, people, groups] = await Promise.all([
    search(ctx, `
      SELECT campaign.resource_name, campaign.bidding_strategy_type, campaign.bidding_strategy,
             campaign.maximize_conversions.target_cpa_micros, campaign.target_cpa.target_cpa_micros,
             campaign.target_spend.cpc_bid_ceiling_micros,
             campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.reference_count
      FROM campaign WHERE campaign.id = ${id}`),
    search(ctx, `
      SELECT campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.negative,
             campaign_criterion.bid_modifier, campaign_criterion.device.type, campaign_criterion.location.geo_target_constant
      FROM campaign_criterion WHERE campaign.id = ${id} AND campaign_criterion.type IN ('DEVICE', 'LOCATION')`),
    search(ctx, `
      SELECT ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.type, ad_group_criterion.negative, ad_group_criterion.bid_modifier,
             ad_group_criterion.age_range.type, ad_group_criterion.gender.type, ad_group_criterion.income_range.type
      FROM ad_group_criterion
      WHERE campaign.id = ${id} AND ad_group_criterion.type IN ('AGE_RANGE', 'GENDER', 'INCOME_RANGE')
        AND ad_group.status != 'REMOVED' AND ad_group_criterion.status != 'REMOVED'`),
    search(ctx, `
      SELECT ad_group.id, ad_group.name, ad_group.resource_name, ad_group.target_cpa_micros
      FROM ad_group WHERE campaign.id = ${id} AND ad_group.status != 'REMOVED'`),
  ]);
  let calls = 4;
  const row = campRows[0];
  if (!row) throw new Error('Campanha não encontrada no Google Ads.');
  const c = row.campaign || {}, b = row.campaignBudget || {};
  const strategy = String(c.biddingStrategyType || '');
  const shared = !!c.biddingStrategy;                             // estratégia de portfólio: a meta mora nela, não na campanha
  const controls: Control[] = [];

  if (strategy === 'MAXIMIZE_CONVERSIONS' || strategy === 'TARGET_CPA') {
    controls.push({
      kind: 'meta_cpa', key: 'campanha', label: 'Meta de CPA', resources: [c.resourceName],
      value: money(strategy === 'TARGET_CPA' ? c.targetCpa?.targetCpaMicros : c.maximizeConversions?.targetCpaMicros),
      editable: !shared, note: shared ? 'A meta vem de uma estratégia de lances compartilhada entre campanhas; altere no Google Ads.' : strategy,
    });
  }
  if (strategy === 'TARGET_SPEND') {
    controls.push({
      kind: 'limite_cpc', key: 'campanha', label: 'Limite de CPC', resources: [c.resourceName],
      value: money(c.targetSpend?.cpcBidCeilingMicros), editable: !shared,
      note: shared ? 'O limite vem de uma estratégia de lances compartilhada entre campanhas; altere no Google Ads.' : undefined,
    });
  }
  // Meta de CPA de cada grupo de anúncios: quando tem valor, vale no lugar da meta da campanha.
  const usesCpa = strategy === 'MAXIMIZE_CONVERSIONS' || strategy === 'TARGET_CPA';
  const adGroups = groups.map(r => r.adGroup || {}).filter(g => g.id).sort((a, z) => String(a.name).localeCompare(String(z.name)));
  for (const g of adGroups) {
    controls.push({
      kind: 'meta_cpa_grupo', key: String(g.id), label: g.name || `Grupo ${g.id}`, resources: [g.resourceName],
      value: money(g.targetCpaMicros) || null, editable: usesCpa,
      note: usesCpa ? undefined : 'A campanha não usa meta de CPA, então o grupo não tem meta própria.',
    });
  }
  const others = Number(b.referenceCount || 1) - 1;
  controls.push({
    kind: 'orcamento', key: 'campanha', label: 'Orçamento diário', resources: [b.resourceName], value: money(b.amountMicros), editable: !!b.resourceName,
    note: b.explicitlyShared && others > 0 ? `Este orçamento é dividido com mais ${others} ${others === 1 ? 'campanha' : 'campanhas'}: a alteração vale para todas.` : undefined,
  });

  // Aparelhos: os três sempre aparecem; sem linha no Google, o ajuste é criado na primeira alteração.
  const deviceRows = new Map<string, any>();
  const locations: any[] = [];
  for (const r of criteria) {
    const cc = r.campaignCriterion || {};
    if (cc.type === 'DEVICE' && cc.device?.type) deviceRows.set(cc.device.type, cc);
    if (cc.type === 'LOCATION' && !cc.negative) locations.push(cc);
  }
  for (const type of ['MOBILE', 'DESKTOP', 'TABLET']) {
    const cc = deviceRows.get(type);
    controls.push({
      kind: 'aparelho', key: type, label: DEVICE[type], value: pct(cc?.bidModifier), editable: true,
      resources: [cc?.resourceName || `customers/${cid}/campaignCriteria/${campaignId}~${DEVICE_ID[type]}`],
      note: cc ? undefined : 'novo',
    });
  }

  // Idade, gênero e renda ficam em cada grupo de anúncios: a mesma faixa é alterada em todos os grupos da
  // campanha. Todas as faixas aparecem; onde o Google ainda não tem a linha, ela é criada na primeira alteração.
  const groupIds = adGroups.map(g => String(g.id));
  const group = (kind: 'idade' | 'genero' | 'renda', labels: Record<string, string>, typeOf: (g: any) => string) => {
    const by = new Map<string, { on: any[]; off: Set<string> }>();
    for (const r of people) {
      const g = r.adGroupCriterion || {};
      const type = typeOf(g);
      if (!type) continue;
      if (!by.has(type)) by.set(type, { on: [], off: new Set() });
      const groupId = String(r.adGroup?.id || '');
      if (g.negative) by.get(type)!.off.add(groupId);
      else by.get(type)!.on.push({ ...g, groupId });
    }
    for (const type of Object.keys(labels)) {
      const hit = by.get(type) || { on: [], off: new Set<string>() };
      const have = new Set(hit.on.map(g => g.groupId));
      const creates = groupIds.filter(g => !have.has(g) && !hit.off.has(g));
      if (!hit.on.length && !creates.length) {
        controls.push({ kind, key: type, label: labels[type], value: null, editable: false, resources: [], note: 'Esta faixa está excluída da campanha no Google, então não há lance para ajustar.' });
        continue;
      }
      const values = [...new Set([...hit.on.map(g => pct(g.bidModifier)), ...(creates.length ? [0] : [])])];
      controls.push({ kind, key: type, label: labels[type], value: values.length === 1 ? values[0] : null, mixed: values.length > 1, editable: true, resources: hit.on.map(g => g.resourceName), creates });
    }
  };
  group('idade', AGE, g => (g.type === 'AGE_RANGE' ? g.ageRange?.type : ''));
  group('genero', GENDER, g => (g.type === 'GENDER' ? g.gender?.type : ''));
  group('renda', INCOME, g => (g.type === 'INCOME_RANGE' ? g.incomeRange?.type : ''));

  if (locations.length) {
    const names = new Map<string, string>();
    const geos = [...new Set(locations.map(l => l.location?.geoTargetConstant).filter(Boolean))].slice(0, 200);
    if (geos.length) {
      calls++;
      const rows = await search(ctx, `SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${geos.map(g => `'${g}'`).join(',')})`).catch(() => []);
      for (const r of rows) names.set(r.geoTargetConstant?.resourceName, r.geoTargetConstant?.canonicalName || '');
    }
    for (const l of locations.slice(0, 200)) {
      controls.push({ kind: 'local', key: String(l.criterionId), label: names.get(l.location?.geoTargetConstant) || `Local ${l.criterionId}`, value: pct(l.bidModifier), editable: true, resources: [l.resourceName] });
    }
  }
  return { strategy, controls, api_calls: calls };
}

/** Limites de cada alteração, antes de chegar ao Google. */
export function checkValue(kind: Kind, value: number): string | null {
  if (!Number.isFinite(value)) return 'Informe um número.';
  if (kind === 'meta_cpa' || kind === 'limite_cpc' || kind === 'orcamento') return value > 0 && value < 1e7 ? null : 'Informe um valor maior que zero.';
  if (kind === 'meta_cpa_grupo') return value >= 0 && value < 1e7 ? null : 'Informe um valor maior que zero.';   // 0 = volta a usar a meta da campanha
  if (kind === 'aparelho') return value >= -100 && value <= 900 ? null : 'O ajuste de aparelho vai de −100% a +900%.';
  return value >= -90 && value <= 900 ? null : 'O ajuste vai de −90% a +900%.';
}

/**
 * Faz uma alteração: primeiro o ensaio, depois de verdade. Devolve quantas
 * chamadas gastou. Lança o erro do Google se o ensaio ou a alteração falharem.
 */
export async function applyControl(ctx: AdsContext, campaignId: string, control: Control, strategy: string, value: number): Promise<number> {
  let service = 'campaigns', operations: any[];
  if (control.kind === 'meta_cpa') {
    const field = strategy === 'TARGET_CPA' ? 'targetCpa' : 'maximizeConversions';
    const mask = strategy === 'TARGET_CPA' ? 'target_cpa.target_cpa_micros' : 'maximize_conversions.target_cpa_micros';
    operations = [{ update: { resourceName: control.resources[0], [field]: { targetCpaMicros: micros(value) } }, updateMask: mask }];
  } else if (control.kind === 'meta_cpa_grupo') {
    service = 'adGroups';
    // Sem valor no pedido, o Google limpa a meta do grupo e ele volta a seguir a da campanha.
    operations = [{ update: { resourceName: control.resources[0], ...(value > 0 ? { targetCpaMicros: micros(value) } : {}) }, updateMask: 'target_cpa_micros' }];
  } else if (control.kind === 'limite_cpc') {
    operations = [{ update: { resourceName: control.resources[0], targetSpend: { cpcBidCeilingMicros: micros(value) } }, updateMask: 'target_spend.cpc_bid_ceiling_micros' }];
  } else if (control.kind === 'orcamento') {
    service = 'campaignBudgets';
    operations = [{ update: { resourceName: control.resources[0], amountMicros: micros(value) }, updateMask: 'amount_micros' }];
  } else if (control.kind === 'aparelho' && control.note === 'novo') {
    service = 'campaignCriteria';
    operations = [{ create: { campaign: `customers/${ctx.customerId}/campaigns/${campaignId}`, device: { type: control.key }, bidModifier: modifier(value) } }];
  } else {
    service = control.kind === 'aparelho' || control.kind === 'local' ? 'campaignCriteria' : 'adGroupCriteria';
    operations = control.resources.map(resourceName => ({ update: { resourceName, bidModifier: modifier(value) }, updateMask: 'bid_modifier' }));
    const field = PEOPLE_FIELD[control.kind];
    if (field && value !== 0) {
      for (const groupId of control.creates || []) {
        operations.push({ create: { adGroup: `customers/${ctx.customerId}/adGroups/${groupId}`, [field]: { type: control.key }, bidModifier: modifier(value) } });
      }
    }
    if (!operations.length) return 0;                             // faixa sem linha no Google e pedido de "sem ajuste": já está assim
  }
  await mutate(ctx, service, operations, true);                   // ensaio: o Google confere e não muda nada
  await mutate(ctx, service, operations, false);
  return 2;
}

// ── Negativa de termo e pausa de palavra-chave ──────────────────────────────

const quote = (text: string) => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export const negativeLabel = (text: string, match: string) => (match === 'PHRASE' ? `"${text}"` : `[${text}]`);

/** Cria a negativa na campanha (exata ou de frase). Devolve o nome do item no Google, que serve para desfazer. */
export async function addNegative(ctx: AdsContext, campaignId: string, rawText: string, match: 'EXACT' | 'PHRASE'): Promise<{ resource: string; calls: number }> {
  const text = rawText.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 80) throw new Error('O termo precisa ter entre 1 e 80 letras.');
  const existing = await search(ctx, `
    SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign.id = ${Number(campaignId)} AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE
      AND campaign_criterion.keyword.text = '${quote(text)}'`);
  if (existing.some(r => r.campaignCriterion?.keyword?.matchType === match)) throw new Error('Esta negativa já existe na campanha.');
  const operations = [{ create: { campaign: `customers/${ctx.customerId}/campaigns/${campaignId}`, negative: true, keyword: { text, matchType: match } } }];
  await mutate(ctx, 'campaignCriteria', operations, true);
  const done = await mutate(ctx, 'campaignCriteria', operations, false);
  const resource = done?.results?.[0]?.resourceName;
  if (!resource) throw new Error('O Google não devolveu a negativa criada.');
  return { resource, calls: 3 };
}

export async function removeNegative(ctx: AdsContext, resource: string): Promise<number> {
  const operations = [{ remove: resource }];
  await mutate(ctx, 'campaignCriteria', operations, true);
  await mutate(ctx, 'campaignCriteria', operations, false);
  return 2;
}

/** Pausa (ou reativa) uma palavra-chave da campanha. `entityId` é grupo~palavra, como a coleta guarda. */
export async function setKeywordStatus(ctx: AdsContext, campaignId: string, entityId: string, status: 'PAUSED' | 'ENABLED'): Promise<{ resource: string; label: string; calls: number }> {
  if (!/^\d+~\d+$/.test(entityId)) throw new Error('Palavra-chave não reconhecida.');
  const resource = `customers/${ctx.customerId}/adGroupCriteria/${entityId}`;
  const read = () => search(ctx, `
    SELECT ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
    FROM ad_group_criterion
    WHERE campaign.id = ${Number(campaignId)} AND ad_group_criterion.resource_name = '${resource}' AND ad_group_criterion.type = 'KEYWORD'`);
  const before = (await read())[0]?.adGroupCriterion;
  if (!before || before.status === 'REMOVED') throw new Error('Esta palavra-chave não existe mais na campanha.');
  const kw = before.keyword || {};
  const label = kw.matchType === 'BROAD' || !kw.text ? String(kw.text || entityId) : negativeLabel(kw.text, kw.matchType);
  if (before.status === status) throw new Error(status === 'PAUSED' ? 'Esta palavra-chave já está pausada.' : 'Esta palavra-chave já está ativa.');
  const operations = [{ update: { resourceName: resource, status }, updateMask: 'status' }];
  await mutate(ctx, 'adGroupCriteria', operations, true);
  await mutate(ctx, 'adGroupCriteria', operations, false);
  const after = (await read())[0]?.adGroupCriterion;
  if (after?.status !== status) throw new Error('O Google aceitou o pedido, mas a palavra-chave continua como estava.');
  return { resource, label, calls: 4 };
}
