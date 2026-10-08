import { search, type AdsContext } from '@/lib/googleAds/client';
import { selectableFields } from '@/lib/googleAds/fields';

/**
 * Modelo de campanha: tudo o que uma campanha de Pesquisa tem no Google, lido
 * na hora, para servir de base no criador de campanhas — configuração, meta de
 * conversão, locais, idiomas, negativas, grupos, palavras-chave, anúncios,
 * sitelinks e frases de destaque.
 *
 * Só lê. Cada bloco é uma consulta separada: se o Google recusar um deles, o
 * resto do modelo vem assim mesmo e o bloco que faltou entra em `avisos`.
 */

export interface Template {
  origem: { campanha_id: string; conta_id: string; nome: string; lido_em: string };
  campanha: {
    tipo: string;
    lance: { estrategia: string; meta_cpa: number | null; limite_cpc: number | null; compartilhada: boolean };
    orcamento_diario: number | null;
    redes: { pesquisa: boolean; parceiros: boolean; display: boolean };
    /** Quem conta como "no local": PRESENCE = só quem está lá; PRESENCE_OR_INTEREST = quem está ou tem interesse. */
    local_incluir: string;
    local_excluir: string;
    /** IA Max do Google. null = esta versão da API não informou. No criador as três opções nascem desligadas. */
    ia_max: { ligada: boolean | null; personalizar_texto: boolean | null; expandir_url: boolean | null };
    anuncio_politico_ue: boolean | null;
    modelo_rastreamento: string | null;
    sufixo_url: string | null;
    meta_conversao: { nivel: string; id: string | null; nome: string | null } | null;
  };
  locais: { id: string; nome: string; excluido: boolean; ajuste: number }[];
  idiomas: { id: string; nome: string }[];
  aparelhos: { tipo: string; ajuste: number }[];
  horarios: { dia: string; inicio: string; fim: string; ajuste: number }[];
  negativas: { texto: string; tipo: string }[];
  grupos: {
    id: string; nome: string; status: string; meta_cpa: number | null;
    palavras: { texto: string; tipo: string; status: string }[];
    negativas: { texto: string; tipo: string }[];
    publicos: { tipo: string; faixa: string; ajuste: number; excluido: boolean }[];
    anuncios: { id: string; status: string; urls: string[]; caminho1: string; caminho2: string; titulos: { texto: string; fixo: string | null }[]; descricoes: { texto: string; fixo: string | null }[] }[];
  }[];
  recursos: {
    sitelinks: { texto: string; desc1: string; desc2: string; urls: string[]; nivel: string }[];
    destaques: { texto: string; nivel: string }[];
    nome_empresa: string | null;
  };
  /** Metas personalizadas que existem na conta, para escolher ao criar. */
  metas_da_conta: { id: string; nome: string }[];
  avisos: string[];
}

const money = (micros: any) => (micros === undefined || micros === null || micros === '' ? null : Math.round(Number(micros) / 10000) / 100);
/** 0,8 no Google = −20% na tela; sem valor = sem ajuste. */
const pct = (modifier: any) => (modifier === undefined || modifier === null || Number(modifier) === 0 ? 0 : Math.round((Number(modifier) - 1) * 100));
const hhmm = (h: any, m: any) => `${String(h ?? 0).padStart(2, '0')}:${{ ZERO: '00', FIFTEEN: '15', THIRTY: '30', FORTY_FIVE: '45' }[String(m)] || '00'}`;
const last = (resource: any) => String(resource || '').split('/').pop() || '';

export async function readTemplate(ctx: AdsContext, campaignId: string): Promise<{ template: Template; calls: number }> {
  const id = Number(campaignId);
  const avisos: string[] = [];
  let calls = 0;
  const q = async (label: string, gaql: string): Promise<any[]> => {
    calls++;
    try { return await search(ctx, gaql); } catch (e: any) { avisos.push(`${label}: ${String(e.message).slice(0, 200)}`); return []; }
  };

  // Campos novos do Google (IA Max, anúncio político) só entram se esta versão da API tiver.
  const OPTIONAL = ['campaign.ai_max_setting.enable_ai_max', 'campaign.asset_automation_settings', 'campaign.contains_eu_political_advertising'];
  calls++;
  const has = await selectableFields(ctx.refreshToken, OPTIONAL).catch(() => new Set<string>());
  const extra = OPTIONAL.filter(f => has.has(f));

  const [camp, criteria, groups, groupCriteria, ads, campAssets, groupAssets, accountAssets, goalConfig, goals] = await Promise.all([
    q('campanha', `
      SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.bidding_strategy,
             campaign.maximize_conversions.target_cpa_micros, campaign.target_cpa.target_cpa_micros, campaign.target_spend.cpc_bid_ceiling_micros,
             campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network,
             campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type,
             campaign.tracking_url_template, campaign.final_url_suffix, campaign_budget.amount_micros${extra.map(f => `, ${f}`).join('')}
      FROM campaign WHERE campaign.id = ${id}`),
    q('locais, idiomas e negativas', `
      SELECT campaign_criterion.type, campaign_criterion.negative, campaign_criterion.bid_modifier, campaign_criterion.criterion_id,
             campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant, campaign_criterion.device.type,
             campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
             campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute,
             campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute
      FROM campaign_criterion
      WHERE campaign.id = ${id} AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE', 'DEVICE', 'KEYWORD', 'AD_SCHEDULE')`),
    q('grupos', `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.target_cpa_micros FROM ad_group WHERE campaign.id = ${id} AND ad_group.status != 'REMOVED'`),
    q('palavras-chave e públicos', `
      SELECT ad_group.id, ad_group_criterion.type, ad_group_criterion.negative, ad_group_criterion.status, ad_group_criterion.bid_modifier,
             ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             ad_group_criterion.age_range.type, ad_group_criterion.gender.type, ad_group_criterion.income_range.type
      FROM ad_group_criterion
      WHERE campaign.id = ${id} AND ad_group.status != 'REMOVED' AND ad_group_criterion.status != 'REMOVED'
        AND ad_group_criterion.type IN ('KEYWORD', 'AGE_RANGE', 'GENDER', 'INCOME_RANGE')`),
    q('anúncios', `
      SELECT ad_group.id, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.final_urls,
             ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
             ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2
      FROM ad_group_ad
      WHERE campaign.id = ${id} AND ad_group.status != 'REMOVED' AND ad_group_ad.status != 'REMOVED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`),
    q('recursos da campanha', `
      SELECT campaign_asset.field_type, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
             asset.callout_asset.callout_text, asset.text_asset.text
      FROM campaign_asset
      WHERE campaign.id = ${id} AND campaign_asset.status = 'ENABLED' AND campaign_asset.field_type IN ('SITELINK', 'CALLOUT', 'BUSINESS_NAME')`),
    q('recursos dos grupos', `
      SELECT ad_group_asset.field_type, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
             asset.callout_asset.callout_text
      FROM ad_group_asset
      WHERE campaign.id = ${id} AND ad_group_asset.status = 'ENABLED' AND ad_group_asset.field_type IN ('SITELINK', 'CALLOUT')`),
    q('recursos da conta', `
      SELECT customer_asset.field_type, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
             asset.callout_asset.callout_text, asset.text_asset.text
      FROM customer_asset
      WHERE customer_asset.status = 'ENABLED' AND customer_asset.field_type IN ('SITELINK', 'CALLOUT', 'BUSINESS_NAME')`),
    q('meta de conversão da campanha', `
      SELECT conversion_goal_campaign_config.goal_config_level, conversion_goal_campaign_config.custom_conversion_goal
      FROM conversion_goal_campaign_config WHERE campaign.id = ${id}`),
    q('metas da conta', `SELECT custom_conversion_goal.id, custom_conversion_goal.name, custom_conversion_goal.status FROM custom_conversion_goal`),
  ]);

  const row = camp[0];
  if (!row) throw new Error(avisos[0] || 'Campanha não encontrada no Google Ads.');
  const c = row.campaign || {};

  // Nomes dos locais e dos idiomas.
  const geoIds = [...new Set(criteria.map(r => r.campaignCriterion?.location?.geoTargetConstant).filter(Boolean))].slice(0, 400);
  const langIds = [...new Set(criteria.map(r => r.campaignCriterion?.language?.languageConstant).filter(Boolean))];
  const [geoRows, langRows] = await Promise.all([
    geoIds.length ? q('nomes dos locais', `SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${geoIds.map(g => `'${g}'`).join(',')})`) : [],
    langIds.length ? q('nomes dos idiomas', `SELECT language_constant.resource_name, language_constant.name FROM language_constant WHERE language_constant.resource_name IN (${langIds.map(g => `'${g}'`).join(',')})`) : [],
  ]);
  const geoName = new Map(geoRows.map(r => [r.geoTargetConstant?.resourceName, r.geoTargetConstant?.canonicalName]));
  const langName = new Map(langRows.map(r => [r.languageConstant?.resourceName, r.languageConstant?.name]));

  const t: Template = {
    origem: { campanha_id: String(campaignId), conta_id: ctx.customerId, nome: c.name || '', lido_em: new Date().toISOString() },
    campanha: {
      tipo: c.advertisingChannelType || '',
      lance: {
        estrategia: c.biddingStrategyType || '', compartilhada: !!c.biddingStrategy,
        meta_cpa: money(c.biddingStrategyType === 'TARGET_CPA' ? c.targetCpa?.targetCpaMicros : c.maximizeConversions?.targetCpaMicros) || null,
        limite_cpc: money(c.targetSpend?.cpcBidCeilingMicros) || null,
      },
      orcamento_diario: money(row.campaignBudget?.amountMicros),
      redes: { pesquisa: c.networkSettings?.targetGoogleSearch !== false, parceiros: !!c.networkSettings?.targetSearchNetwork, display: !!c.networkSettings?.targetContentNetwork },
      local_incluir: c.geoTargetTypeSetting?.positiveGeoTargetType || 'PRESENCE_OR_INTEREST',
      local_excluir: c.geoTargetTypeSetting?.negativeGeoTargetType || 'PRESENCE',
      ia_max: (() => {
        const auto: any[] = Array.isArray(c.assetAutomationSettings) ? c.assetAutomationSettings : [];
        const opted = (type: string) => { const a = auto.find(x => x.assetAutomationType === type); return a ? a.assetAutomationStatus === 'OPTED_IN' : null; };
        return {
          ligada: has.has(OPTIONAL[0]) ? !!c.aiMaxSetting?.enableAiMax : null,
          personalizar_texto: has.has(OPTIONAL[1]) ? opted('TEXT_ASSET_AUTOMATION') : null,
          expandir_url: has.has(OPTIONAL[1]) ? opted('FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION') : null,
        };
      })(),
      anuncio_politico_ue: has.has(OPTIONAL[2]) ? /^CONTAINS/.test(String(c.containsEuPoliticalAdvertising)) : null,
      modelo_rastreamento: c.trackingUrlTemplate || null,
      sufixo_url: c.finalUrlSuffix || null,
      meta_conversao: null,
    },
    locais: [], idiomas: [], aparelhos: [], horarios: [], negativas: [], grupos: [],
    recursos: { sitelinks: [], destaques: [], nome_empresa: null },
    metas_da_conta: goals.map(r => r.customConversionGoal || {}).filter(g => g.id && g.status !== 'REMOVED').map(g => ({ id: String(g.id), nome: g.name || `Meta ${g.id}` })),
    avisos,
  };

  const cfg = goalConfig[0]?.conversionGoalCampaignConfig;
  if (cfg) {
    const goalId = last(cfg.customConversionGoal) || null;
    t.campanha.meta_conversao = { nivel: cfg.goalConfigLevel || '', id: goalId, nome: goalId ? t.metas_da_conta.find(g => g.id === goalId)?.nome || null : null };
  }

  for (const r of criteria) {
    const cc = r.campaignCriterion || {};
    if (cc.type === 'LOCATION') t.locais.push({ id: last(cc.location?.geoTargetConstant), nome: geoName.get(cc.location?.geoTargetConstant) || `Local ${cc.criterionId}`, excluido: !!cc.negative, ajuste: pct(cc.bidModifier) });
    else if (cc.type === 'LANGUAGE') t.idiomas.push({ id: last(cc.language?.languageConstant), nome: langName.get(cc.language?.languageConstant) || `Idioma ${cc.criterionId}` });
    else if (cc.type === 'DEVICE') t.aparelhos.push({ tipo: cc.device?.type || '', ajuste: pct(cc.bidModifier) });
    else if (cc.type === 'KEYWORD' && cc.negative) t.negativas.push({ texto: cc.keyword?.text || '', tipo: cc.keyword?.matchType || '' });
    else if (cc.type === 'AD_SCHEDULE') t.horarios.push({ dia: cc.adSchedule?.dayOfWeek || '', inicio: hhmm(cc.adSchedule?.startHour, cc.adSchedule?.startMinute), fim: hhmm(cc.adSchedule?.endHour, cc.adSchedule?.endMinute), ajuste: pct(cc.bidModifier) });
  }
  t.negativas.sort((a, b) => a.texto.localeCompare(b.texto));

  const byGroup = new Map<string, Template['grupos'][number]>();
  for (const r of groups) {
    const g = r.adGroup || {};
    byGroup.set(String(g.id), { id: String(g.id), nome: g.name || '', status: g.status || '', meta_cpa: money(g.targetCpaMicros) || null, palavras: [], negativas: [], publicos: [], anuncios: [] });
  }
  for (const r of groupCriteria) {
    const g = byGroup.get(String(r.adGroup?.id)), k = r.adGroupCriterion || {};
    if (!g) continue;
    if (k.type === 'KEYWORD' && k.negative) g.negativas.push({ texto: k.keyword?.text || '', tipo: k.keyword?.matchType || '' });
    else if (k.type === 'KEYWORD') g.palavras.push({ texto: k.keyword?.text || '', tipo: k.keyword?.matchType || '', status: k.status || '' });
    else g.publicos.push({ tipo: k.type, faixa: k.ageRange?.type || k.gender?.type || k.incomeRange?.type || '', ajuste: pct(k.bidModifier), excluido: !!k.negative });
  }
  for (const r of ads) {
    const g = byGroup.get(String(r.adGroup?.id)), a = r.adGroupAd || {}, rsa = a.ad?.responsiveSearchAd || {};
    if (!g) continue;
    const texts = (list: any) => (Array.isArray(list) ? list : []).map((x: any) => ({ texto: String(x.text || ''), fixo: x.pinnedField || null }));
    g.anuncios.push({ id: String(a.ad?.id || ''), status: a.status || '', urls: a.ad?.finalUrls || [], caminho1: rsa.path1 || '', caminho2: rsa.path2 || '', titulos: texts(rsa.headlines), descricoes: texts(rsa.descriptions) });
  }
  t.grupos = [...byGroup.values()].sort((a, b) => a.nome.localeCompare(b.nome));

  const seen = new Set<string>();
  const assets = (rows: any[], link: string, nivel: string) => {
    for (const r of rows) {
      const type = r[link]?.fieldType, a = r.asset || {};
      if (type === 'SITELINK' && a.sitelinkAsset?.linkText && !seen.has(`s|${a.sitelinkAsset.linkText}`)) {
        seen.add(`s|${a.sitelinkAsset.linkText}`);
        t.recursos.sitelinks.push({ texto: a.sitelinkAsset.linkText, desc1: a.sitelinkAsset.description1 || '', desc2: a.sitelinkAsset.description2 || '', urls: a.finalUrls || [], nivel });
      } else if (type === 'CALLOUT' && a.calloutAsset?.calloutText && !seen.has(`c|${a.calloutAsset.calloutText}`)) {
        seen.add(`c|${a.calloutAsset.calloutText}`);
        t.recursos.destaques.push({ texto: a.calloutAsset.calloutText, nivel });
      } else if (type === 'BUSINESS_NAME' && a.textAsset?.text && !t.recursos.nome_empresa) t.recursos.nome_empresa = a.textAsset.text;
    }
  };
  // Como o Google usa: os do grupo valem primeiro, depois os da campanha, depois os da conta.
  assets(groupAssets, 'adGroupAsset', 'grupo');
  assets(campAssets, 'campaignAsset', 'campanha');
  assets(accountAssets, 'customerAsset', 'conta');

  if (t.campanha.tipo && t.campanha.tipo !== 'SEARCH') avisos.push('Esta campanha não é de Pesquisa. O criador, por enquanto, só monta campanhas de Pesquisa.');
  return { template: t, calls };
}
