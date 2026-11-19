import { supabaseAdmin } from './server';
import { languageName, placeName } from '@/lib/campaignBuilder/names';

/**
 * Configuração de cada campanha que as outras coletas não guardam: idiomas, negativas (da campanha
 * e dos grupos), públicos dos grupos (idade, gênero, renda), locais configurados, aparelhos, horários, redes, tipo de local, rastreamento e a
 * meta de conversão.
 *
 * Fica em google_ads_entities com level = 'campaign' (uma linha por campanha, entity_id = id da
 * campanha). Serve para copiar ou duplicar a campanha quando o Google não deixa mais ler — conta
 * suspensa (lib/campaignBuilder/storedTemplate).
 *
 * Roda com a lista da estrutura: uma vez por dia e quando o histórico da conta mostra alteração.
 * Cada consulta é independente: se uma falhar, a campanha não ganha linha nova nesta rodada (o
 * que estava gravado continua), para não gravar configuração pela metade.
 */

export interface CampaignSettings {
  idiomas: { id: string; nome: string }[];
  locais: { id: string; nome: string; excluido: boolean; ajuste: number }[];
  negativas: { texto: string; tipo: string }[];
  /** Negativas de cada grupo, pelo id do grupo. */
  negativas_grupo: Record<string, { texto: string; tipo: string }[]>;
  /** Públicos de cada grupo (idade, gênero, renda), pelo id do grupo. Desde 19/11/2026. */
  publicos_grupo?: Record<string, { tipo: string; faixa: string; ajuste: number; excluido: boolean }[]>;
  aparelhos: { tipo: string; ajuste: number }[];
  horarios: { dia: string; inicio: string; fim: string; ajuste: number }[];
  redes: { pesquisa: boolean; parceiros: boolean; display: boolean };
  local_incluir: string;
  local_excluir: string;
  modelo_rastreamento: string | null;
  sufixo_url: string | null;
  meta_conversao: { nivel: string; id: string | null; nome: string | null } | null;
}

const pct = (modifier: any) => (modifier === undefined || modifier === null || Number(modifier) === 0 ? 0 : Math.round((Number(modifier) - 1) * 100));
const hhmm = (h: any, m: any) => `${String(h ?? 0).padStart(2, '0')}:${{ ZERO: '00', FIFTEEN: '15', THIRTY: '30', FORTY_FIVE: '45' }[String(m)] || '00'}`;
const last = (resource: any) => String(resource || '').split('/').pop() || '';
const MAX_PLACES = 500;

export async function syncCampaignSettings(
  q: (gaql: string) => Promise<any[]>,
  opts: { productIdFor: (campaignId: string) => string | undefined; errors: string[] },
): Promise<number> {
  const fail = (label: string) => (e: any) => { opts.errors.push(`configuração (${label}): ${e.message}`); return null; };
  const [camps, criteria, groupNegatives, audiences, goalConfig, goals] = await Promise.all([
    q(`SELECT campaign.id, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,
              campaign.network_settings.target_content_network, campaign.geo_target_type_setting.positive_geo_target_type,
              campaign.geo_target_type_setting.negative_geo_target_type, campaign.tracking_url_template, campaign.final_url_suffix
       FROM campaign WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type = 'SEARCH'`).catch(fail('campanhas')),
    q(`SELECT campaign.id, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.bid_modifier, campaign_criterion.criterion_id,
              campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant, campaign_criterion.device.type,
              campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
              campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute,
              campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute
       FROM campaign_criterion
       WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type = 'SEARCH'
         AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE', 'DEVICE', 'KEYWORD', 'AD_SCHEDULE')`).catch(fail('critérios')),
    q(`SELECT campaign.id, ad_group.id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
       FROM ad_group_criterion
       WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type = 'SEARCH' AND ad_group.status != 'REMOVED'
         AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = TRUE AND ad_group_criterion.status != 'REMOVED'`).catch(fail('negativas dos grupos')),
    q(`SELECT campaign.id, ad_group.id, ad_group_criterion.type, ad_group_criterion.negative, ad_group_criterion.bid_modifier,
              ad_group_criterion.age_range.type, ad_group_criterion.gender.type, ad_group_criterion.income_range.type
       FROM ad_group_criterion
       WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type = 'SEARCH' AND ad_group.status != 'REMOVED'
         AND ad_group_criterion.type IN ('AGE_RANGE', 'GENDER', 'INCOME_RANGE') AND ad_group_criterion.status != 'REMOVED'`).catch(fail('públicos dos grupos')),
    q(`SELECT campaign.id, conversion_goal_campaign_config.goal_config_level, conversion_goal_campaign_config.custom_conversion_goal
       FROM conversion_goal_campaign_config WHERE campaign.status != 'REMOVED'`).catch(fail('meta de conversão')),
    q(`SELECT custom_conversion_goal.id, custom_conversion_goal.name FROM custom_conversion_goal`).catch(fail('metas da conta')),
  ]);
  if (!camps || !criteria || !groupNegatives) return 0;

  // Nomes dos locais e dos idiomas, numa consulta cada.
  const geoIds = [...new Set(criteria.map(r => r.campaignCriterion?.location?.geoTargetConstant).filter(Boolean))].slice(0, 2000);
  const langIds = [...new Set(criteria.map(r => r.campaignCriterion?.language?.languageConstant).filter(Boolean))];
  const [geoRows, langRows] = await Promise.all([
    geoIds.length ? q(`SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.target_type
       FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${geoIds.map(g => `'${g}'`).join(',')})`).catch(fail('nomes dos locais')) : [],
    langIds.length ? q(`SELECT language_constant.resource_name, language_constant.name, language_constant.code
       FROM language_constant WHERE language_constant.resource_name IN (${langIds.map(g => `'${g}'`).join(',')})`).catch(fail('nomes dos idiomas')) : [],
  ]);
  const geoName = new Map((geoRows || []).map(r => [r.geoTargetConstant?.resourceName, placeName(r.geoTargetConstant || {})]));
  const langName = new Map((langRows || []).map(r => [r.languageConstant?.resourceName, languageName(r.languageConstant?.code, r.languageConstant?.name)]));
  const goalName = new Map((goals || []).map(r => [String(r.customConversionGoal?.id), r.customConversionGoal?.name || null]));

  const byCampaign = new Map<string, CampaignSettings>();
  for (const r of camps) {
    const c = r.campaign || {};
    byCampaign.set(String(c.id), {
      idiomas: [], locais: [], negativas: [], negativas_grupo: {}, publicos_grupo: {}, aparelhos: [], horarios: [],
      redes: { pesquisa: c.networkSettings?.targetGoogleSearch !== false, parceiros: !!c.networkSettings?.targetSearchNetwork, display: !!c.networkSettings?.targetContentNetwork },
      local_incluir: c.geoTargetTypeSetting?.positiveGeoTargetType || 'PRESENCE_OR_INTEREST',
      local_excluir: c.geoTargetTypeSetting?.negativeGeoTargetType || 'PRESENCE',
      modelo_rastreamento: c.trackingUrlTemplate || null,
      sufixo_url: c.finalUrlSuffix || null,
      meta_conversao: null,
    });
    if (!audiences) delete byCampaign.get(String(c.id))!.publicos_grupo;
  }
  for (const r of criteria) {
    const s = byCampaign.get(String(r.campaign?.id)), cc = r.campaignCriterion || {};
    if (!s) continue;
    if (cc.type === 'LOCATION' && s.locais.length < MAX_PLACES) s.locais.push({ id: last(cc.location?.geoTargetConstant), nome: geoName.get(cc.location?.geoTargetConstant) || `Local ${cc.criterionId}`, excluido: !!cc.negative, ajuste: pct(cc.bidModifier) });
    else if (cc.type === 'LANGUAGE') s.idiomas.push({ id: last(cc.language?.languageConstant), nome: langName.get(cc.language?.languageConstant) || `Idioma ${cc.criterionId}` });
    else if (cc.type === 'DEVICE') s.aparelhos.push({ tipo: cc.device?.type || '', ajuste: pct(cc.bidModifier) });
    else if (cc.type === 'KEYWORD' && cc.negative) s.negativas.push({ texto: cc.keyword?.text || '', tipo: cc.keyword?.matchType || '' });
    else if (cc.type === 'AD_SCHEDULE') s.horarios.push({ dia: cc.adSchedule?.dayOfWeek || '', inicio: hhmm(cc.adSchedule?.startHour, cc.adSchedule?.startMinute), fim: hhmm(cc.adSchedule?.endHour, cc.adSchedule?.endMinute), ajuste: pct(cc.bidModifier) });
  }
  for (const r of groupNegatives) {
    const s = byCampaign.get(String(r.campaign?.id)), k = r.adGroupCriterion?.keyword;
    if (!s || !k?.text) continue;
    (s.negativas_grupo[String(r.adGroup?.id || '')] ||= []).push({ texto: k.text, tipo: k.matchType || '' });
  }
  for (const r of audiences || []) {
    const s = byCampaign.get(String(r.campaign?.id)), c = r.adGroupCriterion || {};
    if (!s) continue;
    (s.publicos_grupo![String(r.adGroup?.id || '')] ||= []).push({ tipo: c.type, faixa: c.ageRange?.type || c.gender?.type || c.incomeRange?.type || '', ajuste: pct(c.bidModifier), excluido: !!c.negative });
  }
  for (const r of goalConfig || []) {
    const s = byCampaign.get(String(r.campaign?.id)), cfg = r.conversionGoalCampaignConfig;
    if (!s || !cfg) continue;
    const id = last(cfg.customConversionGoal) || null;
    s.meta_conversao = { nivel: cfg.goalConfigLevel || '', id, nome: id ? goalName.get(id) || null : null };
  }

  const now = new Date().toISOString();
  const rows: any[] = [];
  for (const [cid, s] of byCampaign) {
    const pid = opts.productIdFor(cid);
    if (!pid) continue;
    s.negativas.sort((a, b) => a.texto.localeCompare(b.texto));
    rows.push({ product_id: pid, level: 'campaign', entity_id: cid, ad_group_id: null, name: 'Configuração da campanha', status: 'ENABLED', details: s, updated_at: now });
  }
  const db = supabaseAdmin();
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('google_ads_entities').upsert(rows.slice(i, i + 200), { onConflict: 'product_id, level, entity_id' });
    if (error) { opts.errors.push(`configuração (gravar): ${error.message}`); return 0; }
  }
  return rows.length;
}
