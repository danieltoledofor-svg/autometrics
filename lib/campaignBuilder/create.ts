import { mutate, mutateAll, search, type AdsContext, type MutateProblem } from '@/lib/googleAds/client';
import { adProblems, campaignProblems, type Draft } from './draft';
import { trackedUrl } from './url';

/**
 * Criação de uma campanha de Pesquisa no Google, a partir do rascunho.
 *
 * Tudo vai num pedido só, que ou entra inteiro ou não entra: orçamento,
 * campanha, locais, idiomas, negativas, grupos, palavras-chave, anúncio e, no
 * nível da campanha, sitelinks e frases de destaque. Com `ensaio`, o Google
 * confere o pedido inteiro e não cria nada.
 *
 * A campanha nasce ATIVA (decisão do usuário em 13/10/2026). Quando ela usa
 * meta de conversão, a ordem é: criar pausada, aplicar a meta, ativar. A meta
 * só pode ser aplicada depois que a campanha existe, e campanha ativa sem a
 * meta certa gastaria otimizando para a conversão errada. Se a meta falhar, a
 * campanha fica pausada e o aviso diz o que ficou por fazer.
 */

export interface Line { url: string; nome: string; conta_id: string; meta_id: string | null }
/** Um item que o Google (ou a conferência do rascunho) recusou, já em português. */
export interface Problem {
  /** Em que parte da campanha está: "palavra-chave", "anúncio", "sitelink"… */
  onde: string;
  /** O que há de errado. */
  texto: string;
  /** Como corrigir, quando dá para dizer. */
  corrigir?: string;
  /** Quando o problema é uma palavra-chave do rascunho: qual, para a tela poder tirá-la. */
  palavra?: { texto: string; tipo: string };
  /** Código do erro no Google, para consulta. */
  codigo?: string;
  /** O que o Google respondeu, em inglês: vai para a IA explicar e não aparece cru na tela quando há explicação. */
  google?: string;
}
export interface CreateResult {
  ok: boolean; ensaio: boolean; campanha_id: string | null;
  /** Como a campanha ficou no Google depois de criada. */
  situacao: 'ENABLED' | 'PAUSED' | null;
  problemas: Problem[];
  avisos: string[]; calls: number;
  /** Quantos itens o pedido leva (campanha, grupos, palavras, anúncio, recursos…): é o que conta na cota diária do Google. */
  itens: number;
}
/** O que cada operação do pedido é, para dizer onde o Google reclamou. */
export interface Label { onde: string; item: string; grupo?: string; palavra?: { texto: string; tipo: string } }

const micros = (value: number) => String(Math.round(value * 100) * 10000);

/** As operações do pedido, cada uma com um rótulo para dizer onde o Google reclamou. */
export function buildOperations(d: Draft, line: Line, customerId: string, status: 'ENABLED' | 'PAUSED' = 'ENABLED'): { operations: any[]; labels: Label[] } {
  const c = `customers/${customerId}`;
  const operations: any[] = [], labels: Label[] = [];
  const add = (onde: string, item: string, op: any, extra: Partial<Label> = {}) => { operations.push(op); labels.push({ onde, item, ...extra }); };
  let temp = -1;
  const next = () => temp--;
  const budget = `${c}/campaignBudgets/${next()}`, campaign = `${c}/campaigns/${next()}`;
  const finalUrl = trackedUrl(line.url, d.rastreador);

  add('orçamento', '', { campaignBudgetOperation: { create: {
    resourceName: budget, name: `${line.nome} · orçamento ${Date.now()}`, amountMicros: micros(d.orcamento_diario || 0), deliveryMethod: 'STANDARD', explicitlyShared: false,
  } } });

  const bidding = d.lance.estrategia === 'TARGET_SPEND'
    ? { targetSpend: d.lance.limite_cpc ? { cpcBidCeilingMicros: micros(d.lance.limite_cpc) } : {} }
    : { maximizeConversions: d.lance.meta_cpa ? { targetCpaMicros: micros(d.lance.meta_cpa) } : {} };
  add('campanha', line.nome, { campaignOperation: { create: {
    resourceName: campaign, name: line.nome, status, advertisingChannelType: 'SEARCH', campaignBudget: budget, ...bidding,
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

  for (const l of d.locais) add('local', l.nome, { campaignCriterionOperation: { create: { campaign, negative: l.excluido, location: { geoTargetConstant: `geoTargetConstants/${l.id}` } } } });
  for (const l of d.idiomas) add('idioma', l.nome, { campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${l.id}` } } } });
  for (const n of d.negativas) add('palavra negativa', n.texto, { campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text: n.texto, matchType: n.tipo || 'BROAD' } } } });

  const titles = d.anuncio.titulos.map(t => t.trim()).filter(Boolean), descriptions = d.anuncio.descricoes.map(t => t.trim()).filter(Boolean);
  for (const g of d.grupos) {
    const group = `${c}/adGroups/${next()}`;
    add('grupo', g.nome, { adGroupOperation: { create: { resourceName: group, campaign, name: g.nome.trim(), status: 'ENABLED', type: 'SEARCH_STANDARD', ...(g.meta_cpa && d.lance.estrategia !== 'TARGET_SPEND' ? { targetCpaMicros: micros(g.meta_cpa) } : {}) } } });
    for (const k of d.palavras) add('palavra-chave', k.texto, { adGroupCriterionOperation: { create: { adGroup: group, status: 'ENABLED', keyword: { text: k.texto, matchType: k.tipo || 'BROAD' } } } }, { grupo: g.nome, palavra: { texto: k.texto, tipo: k.tipo || 'BROAD' } });
    add('anúncio', '', { adGroupAdOperation: { create: { adGroup: group, status: 'ENABLED', ad: {
      finalUrls: [finalUrl],
      responsiveSearchAd: {
        headlines: titles.map(text => ({ text })), descriptions: descriptions.map(text => ({ text })),
        ...(d.anuncio.caminho1 ? { path1: d.anuncio.caminho1 } : {}), ...(d.anuncio.caminho1 && d.anuncio.caminho2 ? { path2: d.anuncio.caminho2 } : {}),
      },
    } } } }, { grupo: g.nome });
  }

  // Sitelinks e frases de destaque sempre na campanha, nunca no grupo nem na conta: assim vão junto em cada cópia.
  for (const s of d.sitelinks.filter(x => x.texto.trim())) {
    const asset = `${c}/assets/${next()}`;
    add('sitelink', s.texto, { assetOperation: { create: { resourceName: asset, finalUrls: [finalUrl], sitelinkAsset: { linkText: s.texto.trim(), ...(s.desc1.trim() && s.desc2.trim() ? { description1: s.desc1.trim(), description2: s.desc2.trim() } : {}) } } } });
    add('sitelink', s.texto, { campaignAssetOperation: { create: { campaign, asset, fieldType: 'SITELINK' } } });
  }
  for (const t of d.destaques.map(x => x.trim()).filter(Boolean)) {
    const asset = `${c}/assets/${next()}`;
    add('frase de destaque', t, { assetOperation: { create: { resourceName: asset, calloutAsset: { calloutText: t } } } });
    add('frase de destaque', t, { campaignAssetOperation: { create: { campaign, asset, fieldType: 'CALLOUT' } } });
  }
  return { operations, labels };
}

/**
 * Erros do Google que têm explicação pronta: o que é e como corrigir. A procura
 * é pelo código e pela mensagem. O que não estiver aqui segue para a IA explicar
 * (lib/campaignBuilder/explain).
 */
const PLAIN: [RegExp, string, string][] = [
  [/KEYWORD_HAS_TOO_MANY_WORDS/, 'A palavra-chave tem palavras demais: o Google aceita até 10.', 'Encurte a palavra-chave para 10 palavras ou menos.'],
  [/KEYWORD_TEXT_TOO_LONG/, 'A palavra-chave é longa demais: o Google aceita até 80 letras.', 'Encurte a palavra-chave para 80 letras ou menos.'],
  [/KEYWORD_HAS_INVALID_CHARS|INVALID_KEYWORD_TEXT/, 'A palavra-chave tem um símbolo que o Google não aceita (como ! @ % * = ; ou parecidos).', 'Tire os símbolos e deixe só letras, números e espaços.'],
  [/DUPLICATE_CAMPAIGN_NAME/, 'Já existe uma campanha com este nome nesta conta.', 'Mude o nome da campanha no passo Onde subir.'],
  [/DUPLICATE_ADGROUP_NAME/, 'Dois grupos têm o mesmo nome.', 'Mude o nome de um dos grupos no passo Campanha.'],
  [/POLICY_FINDING|POLICY_VIOLATION|POLICY_ERROR|PROHIBITED/, 'O Google barrou este texto pela política de anúncios.', 'Troque por outro texto, sem o termo barrado, ou tire o item da campanha.'],
  [/TOO_LONG|STRING_TOO_LONG/, 'O texto é maior que o limite do Google.', 'Encurte o texto.'],
  [/TOO_SHORT|REQUIRED|MISSING/, 'Falta preencher um campo que o Google exige.', 'Preencha o campo indicado.'],
  [/INVALID_URL|URL_|FINAL_URL/, 'O Google não aceitou o endereço da página.', 'Confira o endereço no passo Onde subir: precisa abrir no navegador e começar com https://'],
  [/MONEY_AMOUNT|BUDGET|BID_TOO|TARGET_CPA/, 'O Google não aceitou um valor em dinheiro (orçamento, meta de CPA ou limite de CPC).', 'Confira os valores no passo Campanha: muito baixos ou muito altos o Google recusa.'],
  [/NOT_ALLOWLISTED|ACTION_NOT_PERMITTED|USER_PERMISSION_DENIED|AUTHORIZATION_ERROR/, 'Esta ligação com o Google não tem permissão para criar nesta conta.', 'Confira o acesso da conta em Integração, ou escolha outra conta.'],
  [/CUSTOMER_NOT_ENABLED/, 'A conta não está ativa no Google.', 'Escolha outra conta no passo Onde subir.'],
  [/RESOURCE_EXHAUSTED|QUOTA/, 'O limite diário de pedidos ao Google foi atingido.', 'Tente de novo mais tarde.'],
];

/** Transforma os erros do Google em problemas da campanha. O mesmo erro repetido em cada grupo vira um só. */
function explain(problems: MutateProblem[], labels: Label[]): Problem[] {
  const out = new Map<string, Problem & { grupos: Set<string> }>();
  for (const p of problems) {
    const label = p.operation !== null ? labels[p.operation] : undefined;
    const item = label?.item || p.trigger;
    const key = `${label?.onde || 'pedido'}|${item}|${p.code}`;
    const seen = out.get(key);
    if (seen) { if (label?.grupo) seen.grupos.add(label.grupo); continue; }
    const plain = PLAIN.find(([re]) => re.test(p.code) || re.test(p.message));
    const policy = p.policy?.name ? ` Política do Google: ${p.policy.name}.` : '';
    out.set(key, {
      onde: `${label?.onde || 'pedido'}${item ? ` "${item}"` : ''}`,
      texto: plain ? `${plain[1]}${policy}` : `O Google recusou este item.${policy}`,
      corrigir: plain?.[2],
      ...(label?.palavra ? { palavra: label.palavra } : {}),
      codigo: [p.kind, p.code].filter(Boolean).join(' · ') || undefined,
      google: [p.message, p.trigger && `valor apontado: ${p.trigger}`, p.field && `campo: ${p.field}`, p.policy?.name && `política: ${p.policy.name}`, p.policy?.description, p.policy?.exemptible && 'o Google aceita pedido de exceção para esta política'].filter(Boolean).join(' | ').slice(0, 900),
      grupos: new Set(label?.grupo ? [label.grupo] : []),
    });
  }
  return [...out.values()].map(({ grupos, ...p }) => ({ ...p, onde: grupos.size > 1 ? `${p.onde} (em ${grupos.size} grupos)` : grupos.size === 1 && !p.palavra ? `${p.onde} (grupo ${[...grupos][0]})` : p.onde }));
}

export async function createCampaign(ctx: AdsContext, d: Draft, line: Line, ensaio: boolean): Promise<CreateResult> {
  const out: CreateResult = { ok: false, ensaio, campanha_id: null, situacao: null, problemas: [], avisos: [], calls: 0, itens: 0 };
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
    if (!goal) { out.problemas = [{ onde: 'meta de conversão', texto: 'A meta escolhida não existe mais nesta conta.', corrigir: 'Escolha outra meta no passo Onde subir.' }]; return out; }
  }

  // Com meta de conversão, a campanha entra pausada e só é ativada depois que a meta estiver aplicada.
  const { operations, labels } = buildOperations(d, line, ctx.customerId, goal ? 'PAUSED' : 'ENABLED');
  out.itens = operations.length;
  out.calls += operations.length;
  const rehearsal = await mutateAll(ctx, operations, true);
  if (rehearsal.problems.length) { out.problemas = explain(rehearsal.problems, labels); return out; }
  if (ensaio) { out.ok = true; return out; }

  out.calls += operations.length;
  const done = await mutateAll(ctx, operations, false);
  if (done.problems.length) { out.problemas = explain(done.problems, labels); return out; }
  const created = done.results.map(r => r.campaignResult?.resourceName).find(Boolean) as string | undefined;
  out.campanha_id = created ? created.split('/').pop() || null : null;
  out.ok = true;
  out.situacao = goal ? 'PAUSED' : 'ENABLED';
  if (!out.campanha_id) { out.avisos.push(`A campanha foi criada${goal ? ', pausada e sem a meta de conversão' : ''}, mas o Google não devolveu o número dela. Confira no Google Ads.`); return out; }

  if (goal) {
    out.calls++;
    let applied = false;
    try {
      await mutate(ctx, 'conversionGoalCampaignConfigs', [{
        update: { resourceName: `customers/${ctx.customerId}/conversionGoalCampaignConfigs/${out.campanha_id}`, goalConfigLevel: 'CAMPAIGN', customConversionGoal: goal },
        updateMask: 'goal_config_level,custom_conversion_goal',
      }]);
      applied = true;
    } catch (e: any) {
      out.avisos.push(`A campanha foi criada, mas a meta de conversão NÃO foi aplicada (${String(e.message).slice(0, 200)}). Por isso ela ficou PAUSADA: escolha a meta no Google Ads e ative por lá.`);
    }
    if (applied) {
      out.calls++;
      try {
        await mutate(ctx, 'campaigns', [{ update: { resourceName: `customers/${ctx.customerId}/campaigns/${out.campanha_id}`, status: 'ENABLED' }, updateMask: 'status' }]);
        out.situacao = 'ENABLED';
      } catch (e: any) {
        out.avisos.push(`A campanha foi criada com a meta de conversão, mas o Google não deixou ativar (${String(e.message).slice(0, 200)}). Ela ficou PAUSADA: ative no Google Ads.`);
      }
    }
  }

  // Confere no Google em vez de supor: situação e IA Max da campanha recém-criada.
  out.calls++;
  try {
    const [row] = await search(ctx, `SELECT campaign.id, campaign.status, campaign.ai_max_setting.enable_ai_max FROM campaign WHERE campaign.id = ${Number(out.campanha_id)}`);
    const status = row?.campaign?.status;
    if (status === 'ENABLED' || status === 'PAUSED') {
      if (status !== out.situacao && !out.avisos.length) out.avisos.push(`Atenção: a campanha ficou ${status === 'PAUSED' ? 'PAUSADA' : 'ATIVA'} no Google, diferente do esperado.`);
      out.situacao = status;
    }
    if (!!row?.campaign?.aiMaxSetting?.enableAiMax !== d.ia_max.ligada) out.avisos.push(`A IA Max ficou ${row?.campaign?.aiMaxSetting?.enableAiMax ? 'ligada' : 'desligada'} no Google, diferente do pedido. Ajuste no Google Ads.`);
  } catch { /* a conferência é um extra: sem ela, vale o que o Google respondeu na criação */ }
  return out;
}
