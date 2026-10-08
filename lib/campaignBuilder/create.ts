import { mutate, mutateAll, search, type AdsContext, type MutateProblem } from '@/lib/googleAds/client';
import { adProblems, campaignProblems, type Draft } from './draft';
import { trackedUrl } from './url';

/**
 * Criação de uma campanha de Pesquisa no Google, a partir do rascunho.
 *
 * Tudo vai num pedido só, que ou entra inteiro ou não entra: orçamento,
 * campanha (sempre PAUSADA), locais, idiomas, negativas, grupos, palavras-chave,
 * anúncio e, no nível da campanha, sitelinks e frases de destaque. Com
 * `ensaio`, o Google confere o pedido inteiro e não cria nada.
 *
 * A meta de conversão é aplicada logo depois, em outro pedido: ela só existe
 * depois que a campanha existe. Se esse segundo pedido falhar, a campanha fica
 * criada e pausada, e o aviso diz que a meta ficou por fazer.
 */

export interface Line { url: string; nome: string; conta_id: string; meta_id: string | null }
export interface CreateResult {
  ok: boolean; ensaio: boolean; campanha_id: string | null;
  problemas: { onde: string; texto: string }[];
  avisos: string[]; calls: number;
  /** Quantos itens o pedido leva (campanha, grupos, palavras, anúncio, recursos…): é o que conta na cota diária do Google. */
  itens: number;
}

const micros = (value: number) => String(Math.round(value * 100) * 10000);

/** As operações do pedido, cada uma com um rótulo para dizer onde o Google reclamou. */
export function buildOperations(d: Draft, line: Line, customerId: string): { operations: any[]; labels: string[] } {
  const c = `customers/${customerId}`;
  const operations: any[] = [], labels: string[] = [];
  const add = (label: string, op: any) => { operations.push(op); labels.push(label); };
  let temp = -1;
  const next = () => temp--;
  const budget = `${c}/campaignBudgets/${next()}`, campaign = `${c}/campaigns/${next()}`;
  const finalUrl = trackedUrl(line.url, d.rastreador);

  add('orçamento', { campaignBudgetOperation: { create: {
    resourceName: budget, name: `${line.nome} · orçamento ${Date.now()}`, amountMicros: micros(d.orcamento_diario || 0), deliveryMethod: 'STANDARD', explicitlyShared: false,
  } } });

  const bidding = d.lance.estrategia === 'TARGET_SPEND'
    ? { targetSpend: d.lance.limite_cpc ? { cpcBidCeilingMicros: micros(d.lance.limite_cpc) } : {} }
    : { maximizeConversions: d.lance.meta_cpa ? { targetCpaMicros: micros(d.lance.meta_cpa) } : {} };
  add('campanha', { campaignOperation: { create: {
    resourceName: campaign, name: line.nome, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: budget, ...bidding,
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: d.redes.parceiros, targetContentNetwork: d.redes.display, targetPartnerSearchNetwork: false },
    geoTargetTypeSetting: { positiveGeoTargetType: d.local_incluir, negativeGeoTargetType: 'PRESENCE' },
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    // IA Max: só vai no pedido quando ligada. Desligada é o padrão do Google para campanha criada assim, e o resultado é conferido depois.
    ...(d.ia_max.ligada ? {
      aiMaxSetting: { enableAiMax: true },
      assetAutomationSettings: [
        { assetAutomationType: 'TEXT_ASSET_AUTOMATION', assetAutomationStatus: d.ia_max.personalizar_texto ? 'OPTED_IN' : 'OPTED_OUT' },
        { assetAutomationType: 'FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION', assetAutomationStatus: d.ia_max.expandir_url ? 'OPTED_IN' : 'OPTED_OUT' },
      ],
    } : {}),
  } } });

  for (const l of d.locais) add(`local ${l.nome}`, { campaignCriterionOperation: { create: { campaign, negative: l.excluido, location: { geoTargetConstant: `geoTargetConstants/${l.id}` } } } });
  for (const l of d.idiomas) add(`idioma ${l.nome}`, { campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${l.id}` } } } });
  for (const n of d.negativas) add(`negativa ${n.texto}`, { campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text: n.texto, matchType: n.tipo || 'BROAD' } } } });

  const titles = d.anuncio.titulos.map(t => t.trim()).filter(Boolean), descriptions = d.anuncio.descricoes.map(t => t.trim()).filter(Boolean);
  for (const g of d.grupos) {
    const group = `${c}/adGroups/${next()}`;
    add(`grupo ${g.nome}`, { adGroupOperation: { create: { resourceName: group, campaign, name: g.nome.trim(), status: 'ENABLED', type: 'SEARCH_STANDARD', ...(g.meta_cpa && d.lance.estrategia !== 'TARGET_SPEND' ? { targetCpaMicros: micros(g.meta_cpa) } : {}) } } });
    for (const k of d.palavras) add(`palavra-chave ${k.texto} (grupo ${g.nome})`, { adGroupCriterionOperation: { create: { adGroup: group, status: 'ENABLED', keyword: { text: k.texto, matchType: k.tipo || 'BROAD' } } } });
    add(`anúncio (grupo ${g.nome})`, { adGroupAdOperation: { create: { adGroup: group, status: 'ENABLED', ad: {
      finalUrls: [finalUrl],
      responsiveSearchAd: {
        headlines: titles.map(text => ({ text })), descriptions: descriptions.map(text => ({ text })),
        ...(d.anuncio.caminho1 ? { path1: d.anuncio.caminho1 } : {}), ...(d.anuncio.caminho1 && d.anuncio.caminho2 ? { path2: d.anuncio.caminho2 } : {}),
      },
    } } } });
  }

  // Sitelinks e frases de destaque sempre na campanha, nunca no grupo nem na conta: assim vão junto em cada cópia.
  for (const s of d.sitelinks.filter(x => x.texto.trim())) {
    const asset = `${c}/assets/${next()}`;
    add(`sitelink ${s.texto}`, { assetOperation: { create: { resourceName: asset, finalUrls: [finalUrl], sitelinkAsset: { linkText: s.texto.trim(), ...(s.desc1.trim() && s.desc2.trim() ? { description1: s.desc1.trim(), description2: s.desc2.trim() } : {}) } } } });
    add(`sitelink ${s.texto} na campanha`, { campaignAssetOperation: { create: { campaign, asset, fieldType: 'SITELINK' } } });
  }
  for (const t of d.destaques.map(x => x.trim()).filter(Boolean)) {
    const asset = `${c}/assets/${next()}`;
    add(`frase de destaque ${t}`, { assetOperation: { create: { resourceName: asset, calloutAsset: { calloutText: t } } } });
    add(`frase de destaque ${t} na campanha`, { campaignAssetOperation: { create: { campaign, asset, fieldType: 'CALLOUT' } } });
  }
  return { operations, labels };
}

/** Erros do Google que têm explicação simples. */
const PLAIN: [RegExp, string][] = [
  [/DUPLICATE_CAMPAIGN_NAME|DUPLICATE_NAME/, 'Já existe uma campanha com este nome nesta conta.'],
  [/POLICY_FINDING|POLICY_VIOLATION|PROHIBITED/, 'O Google barrou este texto pela política de anúncios.'],
  [/TOO_LONG|STRING_TOO_LONG/, 'Texto maior que o limite do Google.'],
  [/INVALID_URL|URL_/, 'O Google não aceitou o endereço da página.'],
  [/NOT_ALLOWLISTED|ACTION_NOT_PERMITTED|USER_PERMISSION_DENIED|AUTHORIZATION_ERROR/, 'Esta ligação com o Google não tem permissão para criar nesta conta.'],
  [/CUSTOMER_NOT_ENABLED/, 'A conta não está ativa no Google.'],
];
const explain = (p: MutateProblem, labels: string[]) => {
  const plain = PLAIN.find(([re]) => re.test(p.code) || re.test(p.message))?.[1];
  return { onde: p.operation !== null && labels[p.operation] ? labels[p.operation] : 'pedido', texto: `${plain ? `${plain} ` : ''}${p.message}${p.field ? ` (${p.field})` : ''}`.slice(0, 400) };
};

export async function createCampaign(ctx: AdsContext, d: Draft, line: Line, ensaio: boolean): Promise<CreateResult> {
  const out: CreateResult = { ok: false, ensaio, campanha_id: null, problemas: [], avisos: [], calls: 0, itens: 0 };
  // O servidor confere de novo o que a tela já conferiu: o rascunho vem do navegador.
  const blocking = [...campaignProblems(d), ...adProblems(d)];
  if (!line.nome.trim()) blocking.push('A campanha está sem nome.');
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(line.url.trim())) blocking.push('A página precisa começar com https://');
  if (d.lance.estrategia === 'MAXIMIZE_CONVERSIONS' && !line.meta_id) blocking.push('Falta a meta de conversão desta conta.');
  if (blocking.length) { out.problemas = blocking.map(texto => ({ onde: 'rascunho', texto })); return out; }

  // A meta de conversão precisa existir na conta antes de criar qualquer coisa.
  let goal: string | null = null;
  if (line.meta_id) {
    out.calls++;
    const rows = await search(ctx, 'SELECT custom_conversion_goal.resource_name, custom_conversion_goal.id, custom_conversion_goal.status FROM custom_conversion_goal');
    goal = rows.map(r => r.customConversionGoal || {}).find(g => String(g.id) === String(line.meta_id) && g.status !== 'REMOVED')?.resourceName || null;
    if (!goal) { out.problemas = [{ onde: 'meta de conversão', texto: 'A meta escolhida não existe mais nesta conta. Escolha outra no passo Onde subir.' }]; return out; }
  }

  const { operations, labels } = buildOperations(d, line, ctx.customerId);
  out.itens = operations.length;
  out.calls += operations.length;
  const rehearsal = await mutateAll(ctx, operations, true);
  if (rehearsal.problems.length) { out.problemas = rehearsal.problems.map(p => explain(p, labels)); return out; }
  if (ensaio) { out.ok = true; return out; }

  out.calls += operations.length;
  const done = await mutateAll(ctx, operations, false);
  if (done.problems.length) { out.problemas = done.problems.map(p => explain(p, labels)); return out; }
  const created = done.results.map(r => r.campaignResult?.resourceName).find(Boolean) as string | undefined;
  out.campanha_id = created ? created.split('/').pop() || null : null;
  out.ok = true;
  if (!out.campanha_id) { out.avisos.push('A campanha foi criada, mas o Google não devolveu o número dela. Confira no Google Ads.'); return out; }

  if (goal) {
    out.calls++;
    try {
      await mutate(ctx, 'conversionGoalCampaignConfigs', [{
        update: { resourceName: `customers/${ctx.customerId}/conversionGoalCampaignConfigs/${out.campanha_id}`, goalConfigLevel: 'CAMPAIGN', customConversionGoal: goal },
        updateMask: 'goal_config_level,custom_conversion_goal',
      }]);
    } catch (e: any) {
      out.avisos.push(`A campanha foi criada e está pausada, mas a meta de conversão NÃO foi aplicada: ${String(e.message).slice(0, 200)}. Escolha a meta no Google Ads antes de ativar.`);
    }
  }

  // Confere no Google em vez de supor: situação, meta e IA Max da campanha recém-criada.
  out.calls++;
  try {
    const [row] = await search(ctx, `SELECT campaign.id, campaign.status, campaign.ai_max_setting.enable_ai_max FROM campaign WHERE campaign.id = ${Number(out.campanha_id)}`);
    if (row?.campaign?.status && row.campaign.status !== 'PAUSED') out.avisos.push(`Atenção: a campanha ficou como ${row.campaign.status} no Google, e não pausada.`);
    if (!!row?.campaign?.aiMaxSetting?.enableAiMax !== d.ia_max.ligada) out.avisos.push(`A IA Max ficou ${row?.campaign?.aiMaxSetting?.enableAiMax ? 'ligada' : 'desligada'} no Google, diferente do pedido. Ajuste no Google Ads.`);
  } catch { /* a conferência é um extra: sem ela, vale o que o Google respondeu na criação */ }
  return out;
}
