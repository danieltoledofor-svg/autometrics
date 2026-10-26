import type { AdsContext } from '@/lib/googleAds/client';
import { submitCampaign, type CreateResult, type Label } from './create';
import type { Ref } from './fixes';
import type { Template } from './template';

/**
 * Duplicar campanha: copia uma campanha de Pesquisa que já está rodando para a
 * mesma conta, para outra conta ou para contas de outras MCCs, a partir do
 * modelo lido do Google (lib/campaignBuilder/template).
 *
 * Diferente do criador, a cópia é fiel: cada grupo leva as próprias
 * palavras-chave, negativas e anúncios (com os títulos fixados e o endereço de
 * cada um), e a campanha leva locais, idiomas, horários, negativas, sitelinks,
 * frases de destaque, modelo de rastreamento e sufixo da URL. O usuário só
 * muda o orçamento, a meta de CPA (ou o limite de CPC) e as metas de CPA dos
 * grupos.
 *
 * Ajuste de lance NÃO passa para a cópia (pedido do usuário em 17/10/2026):
 * aparelho, local, horário, idade, gênero e renda entram sem ajuste. Os
 * públicos (idade, gênero, renda) ficam fora por inteiro, inclusive os
 * excluídos, e os aparelhos também; locais e horários entram, sem o ajuste.
 *
 * Cada operação leva o endereço do item na cópia (lib/campaignBuilder/fixes):
 * o que o Google recusar volta apontado, e a tela tira ou troca ali mesmo.
 * Palavra-chave e anúncio com pedido de exceção da política vão com a chave
 * do pedido, e o Google aceita o item para revisar.
 */

export interface DuplicateSettings {
  orcamento_diario: number | null;
  meta_cpa: number | null;
  limite_cpc: number | null;
  /** Meta de CPA de cada grupo, pelo número do grupo na campanha original. Vazio = segue a da campanha. */
  grupos: Record<string, number | null>;
}
/**
 * Uma cópia. Com duas cópias ou mais, cada linha traz o próprio orçamento e a
 * própria meta de CPA (ou limite de CPC); ausente = vale o dos ajustes gerais.
 */
export interface DuplicateLine {
  conta_id: string; nome: string; meta_id: string | null;
  orcamento_diario?: number | null; meta_cpa?: number | null; limite_cpc?: number | null;
}

/** Os valores desta cópia: os gerais, trocados pelos da linha quando ela traz os seus. */
export function lineSettings(s: DuplicateSettings, line: Pick<DuplicateLine, 'orcamento_diario' | 'meta_cpa' | 'limite_cpc'>): DuplicateSettings {
  return {
    ...s,
    orcamento_diario: line.orcamento_diario !== undefined ? line.orcamento_diario : s.orcamento_diario,
    meta_cpa: line.meta_cpa !== undefined ? line.meta_cpa : s.meta_cpa,
    limite_cpc: line.limite_cpc !== undefined ? line.limite_cpc : s.limite_cpc,
  };
}

/** Estratégias que a cópia sabe montar. As outras precisam ser escolhidas no Google. */
const SUPPORTED = ['MAXIMIZE_CONVERSIONS', 'TARGET_CPA', 'TARGET_SPEND'];
const DEVICE: Record<string, string> = { MOBILE: 'celular', DESKTOP: 'computador', TABLET: 'tablet', CONNECTED_TV: 'TV conectada' };
const AUDIENCE: Record<string, string> = { AGE_RANGE: 'idade', GENDER: 'gênero', INCOME_RANGE: 'renda' };
const DAY: Record<string, string> = { MONDAY: 'segunda', TUESDAY: 'terça', WEDNESDAY: 'quarta', THURSDAY: 'quinta', FRIDAY: 'sexta', SATURDAY: 'sábado', SUNDAY: 'domingo' };
const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
const micros = (value: number) => String(Math.round(value * 100) * 10000);
const MINUTE: Record<string, string> = { '00': 'ZERO', '15': 'FIFTEEN', '30': 'THIRTY', '45': 'FORTY_FIVE' };

export const usesTargetSpend = (t: Template) => t.campanha.lance.estrategia === 'TARGET_SPEND';
/** A campanha original otimiza para uma meta personalizada: a cópia precisa de uma meta em cada conta. */
export const needsGoal = (t: Template) => !usesTargetSpend(t) && t.campanha.meta_conversao?.nivel === 'CAMPAIGN' && !!t.campanha.meta_conversao.id;

/** Valores iniciais: os mesmos da campanha original. */
export function duplicateSettings(t: Template): DuplicateSettings {
  return {
    orcamento_diario: t.campanha.orcamento_diario,
    meta_cpa: usesTargetSpend(t) ? null : t.campanha.lance.meta_cpa,
    limite_cpc: usesTargetSpend(t) ? t.campanha.lance.limite_cpc : null,
    grupos: Object.fromEntries(t.grupos.map(g => [g.id, g.meta_cpa])),
  };
}

/** Os ajustes de lance da original que ficam de fora da cópia, em português, para a tela mostrar. */
export function droppedAdjustments(t: Template): string[] {
  const out: string[] = [];
  for (const a of t.aparelhos) if (a.ajuste) out.push(`Aparelho ${DEVICE[a.tipo] || a.tipo}: ${pct(a.ajuste)}`);
  for (const l of t.locais) if (l.ajuste && !l.excluido) out.push(`Local ${l.nome}: ${pct(l.ajuste)}`);
  for (const h of t.horarios) if (h.ajuste) out.push(`Horário ${DAY[h.dia] || h.dia} ${h.inicio}–${h.fim}: ${pct(h.ajuste)}`);
  for (const g of t.grupos) for (const p of g.publicos) {
    if (!p.ajuste && !p.excluido) continue;
    const faixa = p.faixa.replace(/^(AGE_RANGE_|INCOME_RANGE_)/, '').replace(/_/g, ' ').toLowerCase();
    out.push(`Grupo ${g.nome} · ${AUDIENCE[p.tipo] || p.tipo} ${faixa}: ${p.excluido ? 'excluído' : pct(p.ajuste)}`);
  }
  return out;
}

/** O que impede a cópia (da campanha lida ou dos valores escolhidos). Lista vazia = pode ensaiar. */
export function duplicateProblems(t: Template, s: DuplicateSettings): string[] {
  const out: string[] = [];
  if (t.campanha.tipo && t.campanha.tipo !== 'SEARCH') out.push('Só dá para duplicar campanha da rede de Pesquisa.');
  if (!SUPPORTED.includes(t.campanha.lance.estrategia)) out.push('A estratégia de lance desta campanha ainda não é copiada por aqui (só Maximizar conversões, CPA desejado e Maximizar cliques).');
  if (t.avisos.length) out.push('O Google não devolveu a campanha inteira na leitura. Leia de novo antes de duplicar, para a cópia não sair faltando partes.');
  if (!t.grupos.length) out.push('A campanha original não tem grupo de anúncios.');
  if (!t.grupos.some(g => g.anuncios.length)) out.push('A campanha original não tem anúncio de pesquisa responsivo.');
  return [...out, ...valueProblems(s), ...groupProblems(s)];
}

/** Orçamento e CPA (ou limite de CPC) de uma cópia. */
export function valueProblems(s: Pick<DuplicateSettings, 'orcamento_diario' | 'meta_cpa' | 'limite_cpc'>): string[] {
  const out: string[] = [];
  if (!s.orcamento_diario || s.orcamento_diario <= 0) out.push('Informe o orçamento diário.');
  if (s.meta_cpa !== null && s.meta_cpa <= 0) out.push('A meta de CPA precisa ser maior que zero (ou fique em branco).');
  if (s.limite_cpc !== null && s.limite_cpc <= 0) out.push('O limite de CPC precisa ser maior que zero (ou fique em branco).');
  return out;
}

/** Metas de CPA dos grupos, que valem para todas as cópias. */
export function groupProblems(s: DuplicateSettings): string[] {
  return Object.values(s.grupos).some(v => v !== null && v <= 0) ? ['A meta de CPA de um grupo precisa ser maior que zero (ou fique em branco).'] : [];
}

/** As operações da cópia, num pedido só, cada uma com rótulo para dizer onde o Google reclamou. */
export function buildDuplicateOperations(t: Template, s: DuplicateSettings, line: DuplicateLine, customerId: string, status: 'ENABLED' | 'PAUSED'): { operations: any[]; labels: Label[] } {
  const c = `customers/${customerId}`;
  const operations: any[] = [], labels: Label[] = [];
  const add = (onde: string, item: string, op: any, extra: Partial<Label> = {}) => { operations.push(op); labels.push({ onde, item, ...extra }); };
  let temp = -1;
  const next = () => temp--;
  const budget = `${c}/campaignBudgets/${next()}`, campaign = `${c}/campaigns/${next()}`;
  const k = t.campanha, spend = usesTargetSpend(t);
  const firstUrl = t.grupos.flatMap(g => g.anuncios).find(a => a.urls[0])?.urls[0] || '';

  add('orçamento', '', { campaignBudgetOperation: { create: {
    resourceName: budget, name: `${line.nome} · orçamento ${Date.now()}`, amountMicros: micros(s.orcamento_diario || 0), deliveryMethod: 'STANDARD', explicitlyShared: false,
  } } });

  const bidding = spend
    ? { targetSpend: s.limite_cpc ? { cpcBidCeilingMicros: micros(s.limite_cpc) } : {} }
    : { maximizeConversions: s.meta_cpa ? { targetCpaMicros: micros(s.meta_cpa) } : {} };
  // Erro na campanha só aponta item quando é no rastreamento ou no sufixo; nome e valores já se mudam na tela.
  const campaignRef = (field: string): Ref | null => (/final_url_suffix/.test(field) && k.sufixo_url ? { tipo: 'sufixo', texto: k.sufixo_url }
    : /tracking_url_template/.test(field) && k.modelo_rastreamento ? { tipo: 'rastreamento', texto: k.modelo_rastreamento } : null);
  add('campanha', line.nome, { campaignOperation: { create: {
    resourceName: campaign, name: line.nome, status, advertisingChannelType: 'SEARCH', campaignBudget: budget, ...bidding,
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: k.redes.parceiros, targetContentNetwork: k.redes.display, targetPartnerSearchNetwork: false },
    geoTargetTypeSetting: { positiveGeoTargetType: k.local_incluir === 'PRESENCE' ? 'PRESENCE' : 'PRESENCE_OR_INTEREST', negativeGeoTargetType: k.local_excluir === 'PRESENCE_OR_INTEREST' ? 'PRESENCE_OR_INTEREST' : 'PRESENCE' },
    containsEuPoliticalAdvertising: k.anuncio_politico_ue ? 'CONTAINS_EU_POLITICAL_ADVERTISING' : 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    ...(k.modelo_rastreamento ? { trackingUrlTemplate: k.modelo_rastreamento } : {}),
    ...(k.sufixo_url ? { finalUrlSuffix: k.sufixo_url } : {}),
    ...(k.ia_max.ligada ? {
      aiMaxSetting: { enableAiMax: true },
      assetAutomationSettings: [
        { assetAutomationType: 'TEXT_ASSET_AUTOMATION', assetAutomationStatus: k.ia_max.personalizar_texto ? 'OPTED_IN' : 'OPTED_OUT' },
        { assetAutomationType: 'FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION', assetAutomationStatus: k.ia_max.expandir_url ? 'OPTED_IN' : 'OPTED_OUT' },
      ],
    } : {}),
  } } }, { ref: campaignRef });

  // Locais e horários entram sem o ajuste de lance; aparelhos e públicos ficam de fora.
  for (const l of t.locais) add('local', l.nome, { campaignCriterionOperation: { create: { campaign, negative: l.excluido, location: { geoTargetConstant: `geoTargetConstants/${l.id}` } } } }, { ref: { tipo: 'local', id: l.id, texto: l.nome } });
  for (const l of t.idiomas) add('idioma', l.nome, { campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${l.id}` } } } }, { ref: { tipo: 'idioma', id: l.id, texto: l.nome } });
  for (const h of t.horarios) {
    const [sh, sm] = h.inicio.split(':'), [eh, em] = h.fim.split(':');
    add('horário', `${DAY[h.dia] || h.dia} ${h.inicio}–${h.fim}`, { campaignCriterionOperation: { create: { campaign, adSchedule: {
      dayOfWeek: h.dia, startHour: Number(sh), startMinute: MINUTE[sm] || 'ZERO', endHour: Number(eh), endMinute: MINUTE[em] || 'ZERO',
    } } } }, { ref: { tipo: 'horario', dia: h.dia, inicio: h.inicio, texto: `${DAY[h.dia] || h.dia} ${h.inicio}–${h.fim}` } });
  }
  for (const n of t.negativas) add('palavra negativa', n.texto, { campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text: n.texto, matchType: n.tipo || 'BROAD' } } } }, { ref: { tipo: 'negativa', grupo: null, texto: n.texto, correspondencia: n.tipo } });

  for (const g of t.grupos) {
    const group = `${c}/adGroups/${next()}`;
    const cpa = s.grupos[g.id] ?? null;
    add('grupo', g.nome, { adGroupOperation: { create: {
      resourceName: group, campaign, name: g.nome, status: g.status === 'PAUSED' ? 'PAUSED' : 'ENABLED', type: 'SEARCH_STANDARD',
      ...(cpa && !spend ? { targetCpaMicros: micros(cpa) } : {}),
    } } });
    for (const w of g.palavras) {
      add('palavra-chave', w.texto, { adGroupCriterionOperation: {
        create: { adGroup: group, status: w.status === 'PAUSED' ? 'PAUSED' : 'ENABLED', keyword: { text: w.texto, matchType: w.tipo || 'BROAD' } },
        ...(w.excecoes?.length ? { exemptPolicyViolationKeys: w.excecoes.map(exemptKey) } : {}),
      } }, { grupo: g.nome, ref: { tipo: 'palavra', grupo: g.id, texto: w.texto, correspondencia: w.tipo } });
    }
    for (const n of g.negativas) add('palavra negativa do grupo', n.texto, { adGroupCriterionOperation: { create: { adGroup: group, negative: true, keyword: { text: n.texto, matchType: n.tipo || 'BROAD' } } } }, { grupo: g.nome, ref: { tipo: 'negativa', grupo: g.id, texto: n.texto, correspondencia: n.tipo } });
    for (const a of g.anuncios) {
      const text = (x: { texto: string; fixo: string | null }) => ({ text: x.texto, ...(x.fixo ? { pinnedField: x.fixo } : {}) });
      add('anúncio', '', { adGroupAdOperation: {
        create: { adGroup: group, status: a.status === 'PAUSED' ? 'PAUSED' : 'ENABLED', ad: {
          finalUrls: a.urls.length ? a.urls : [firstUrl],
          responsiveSearchAd: {
            headlines: a.titulos.map(text), descriptions: a.descricoes.map(text),
            ...(a.caminho1 ? { path1: a.caminho1 } : {}), ...(a.caminho1 && a.caminho2 ? { path2: a.caminho2 } : {}),
          },
        } },
        ...(a.excecoes?.length ? { policyValidationParameter: { exemptPolicyViolationKeys: a.excecoes.map(exemptKey) } } : {}),
      } }, { grupo: g.nome, ref: (field, trigger) => adRef(g, a, field, trigger) });
    }
  }

  // Sitelinks e frases de destaque sempre no nível da campanha, mesmo os que na original estavam no grupo ou na conta.
  for (const sl of t.recursos.sitelinks) {
    const asset = `${c}/assets/${next()}`, urls = sl.urls.length ? sl.urls : [firstUrl];
    const sitelinkRef = (field: string): Ref => {
      const u = field.match(/final_urls\[(\d+)\]/);
      if (u && sl.urls[Number(u[1])]) return { tipo: 'sitelink', link: sl.texto, campo: 'url', texto: sl.urls[Number(u[1])] };
      if (/description1/.test(field) && sl.desc1) return { tipo: 'sitelink', link: sl.texto, campo: 'desc1', texto: sl.desc1 };
      if (/description2/.test(field) && sl.desc2) return { tipo: 'sitelink', link: sl.texto, campo: 'desc2', texto: sl.desc2 };
      return { tipo: 'sitelink', link: sl.texto, campo: 'texto', texto: sl.texto };
    };
    add('sitelink', sl.texto, { assetOperation: { create: { resourceName: asset, finalUrls: urls, sitelinkAsset: { linkText: sl.texto, ...(sl.desc1 && sl.desc2 ? { description1: sl.desc1, description2: sl.desc2 } : {}) } } } }, { ref: sitelinkRef });
    add('sitelink', sl.texto, { campaignAssetOperation: { create: { campaign, asset, fieldType: 'SITELINK' } } }, { ref: sitelinkRef });
  }
  for (const d of t.recursos.destaques) {
    const asset = `${c}/assets/${next()}`;
    add('frase de destaque', d.texto, { assetOperation: { create: { resourceName: asset, calloutAsset: { calloutText: d.texto } } } }, { ref: { tipo: 'destaque', texto: d.texto } });
    add('frase de destaque', d.texto, { campaignAssetOperation: { create: { campaign, asset, fieldType: 'CALLOUT' } } }, { ref: { tipo: 'destaque', texto: d.texto } });
  }
  return { operations, labels };
}

const exemptKey = (x: { politica: string; texto: string }) => ({ policyName: x.politica, violatingText: x.texto });

/** Que parte do anúncio o Google recusou: pelo campo que ele apontou ou, sem campo, pelo texto. Sem nenhum dos dois, o anúncio inteiro. */
function adRef(g: Template['grupos'][number], a: Template['grupos'][number]['anuncios'][number], field: string, trigger: string): Ref {
  const base = { grupo: g.id, anuncio: a.id };
  const at = (re: RegExp) => { const m = field.match(re); return m ? Number(m[1]) : -1; };
  const h = at(/headlines\[(\d+)\]/), d = at(/descriptions\[(\d+)\]/), u = at(/final_urls\[(\d+)\]/);
  if (a.titulos[h]) return { ...base, tipo: 'titulo', texto: a.titulos[h].texto };
  if (a.descricoes[d]) return { ...base, tipo: 'descricao', texto: a.descricoes[d].texto };
  if (/path1/.test(field) && a.caminho1) return { ...base, tipo: 'caminho1', texto: a.caminho1 };
  if (/path2/.test(field) && a.caminho2) return { ...base, tipo: 'caminho2', texto: a.caminho2 };
  if (a.urls[u]) return { ...base, tipo: 'url', texto: a.urls[u] };
  const tr = trigger.trim().toLowerCase();
  if (tr) {
    const title = a.titulos.find(x => x.texto.toLowerCase().includes(tr));
    if (title) return { ...base, tipo: 'titulo', texto: title.texto };
    const desc = a.descricoes.find(x => x.texto.toLowerCase().includes(tr));
    if (desc) return { ...base, tipo: 'descricao', texto: desc.texto };
  }
  return { ...base, tipo: 'anuncio', texto: g.nome };
}

export async function duplicateCampaign(ctx: AdsContext, t: Template, general: DuplicateSettings, line: DuplicateLine, ensaio: boolean): Promise<CreateResult> {
  const s = lineSettings(general, line);
  const out: CreateResult = { ok: false, ensaio, campanha_id: null, situacao: null, problemas: [], avisos: [], calls: 0, itens: 0 };
  // O servidor confere de novo o que a tela já conferiu: a campanha lida e os valores vêm do navegador.
  const blocking = duplicateProblems(t, s);
  if (!line.nome.trim()) blocking.push('A cópia está sem nome.');
  if (line.conta_id === t.origem.conta_id && line.nome.trim().toLowerCase() === t.origem.nome.trim().toLowerCase()) blocking.push('Na mesma conta da original, a cópia precisa de outro nome.');
  if (needsGoal(t) && !line.meta_id) blocking.push('Falta a meta de conversão desta conta.');
  if (blocking.length) { out.problemas = blocking.map(texto => ({ onde: 'cópia', texto })); return out; }
  return submitCampaign(ctx, out, status => buildDuplicateOperations(t, s, { ...line, nome: line.nome.trim() }, ctx.customerId, status), line.meta_id, !!t.campanha.ia_max.ligada);
}
