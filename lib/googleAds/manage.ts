import { search, mutate, mutateAll, type AdsContext, type MutateProblem } from '@/lib/googleAds/client';
import { count } from '@/lib/campaignBuilder/rules';
import { placeName } from '@/lib/campaignBuilder/names';

/**
 * Montagem da campanha pelo Autometrics, dentro do Google Ads: grupos de
 * anúncios (novo, cópia, nome, pausar), anúncios (novo, cópia, pausar),
 * palavras-chave (nova, a partir de um termo de pesquisa) e locais (incluir,
 * excluir, tirar).
 *
 * Como em lib/googleAds/edit: tudo é lido do Google na hora, e cada alteração
 * passa antes por um ensaio (validateOnly). Se o Google recusar o ensaio,
 * nada muda. Por enquanto só para os logins de lib/googleAds/editors.
 */

const micros = (value: number) => String(Math.round(value * 100) * 10000);
const money = (m: any) => (m === undefined || m === null || m === '' ? null : Math.round(Number(m) / 10000) / 100);
const clean = (text: any) => String(text ?? '').trim().replace(/\s+/g, ' ');
const MATCH = new Set(['EXACT', 'PHRASE', 'BROAD']);
export type Match = 'EXACT' | 'PHRASE' | 'BROAD';
export const keywordLabel = (text: string, match: string) => (match === 'PHRASE' ? `"${text}"` : match === 'EXACT' ? `[${text}]` : text);

/** Erro com o texto do Google, para a rota devolver como recusa. */
export class Refused extends Error {}
const explain = (problems: MutateProblem[]) => problems.map(p => `${p.message}${p.field ? ` (${p.field})` : ''}`).join(' · ').slice(0, 600);
/** Ensaio e, se aceito, a criação de verdade — tudo num pedido só, que entra inteiro ou não entra. */
async function both(ctx: AdsContext, operations: any[]): Promise<any[]> {
  const rehearsal = await mutateAll(ctx, operations, true);
  if (rehearsal.problems.length) throw new Refused(explain(rehearsal.problems));
  const done = await mutateAll(ctx, operations, false);
  if (done.problems.length) throw new Refused(explain(done.problems));
  return done.results;
}

// ── Palavras-chave ──────────────────────────────────────────────────────────

/** O grupo é da campanha? Devolve o nome dele. */
async function groupOf(ctx: AdsContext, campaignId: string, groupId: string): Promise<{ name: string; resource: string; status: string; target: number | null }> {
  if (!/^\d+$/.test(groupId)) throw new Error('Grupo de anúncios não reconhecido.');
  const rows = await search(ctx, `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.resource_name, ad_group.target_cpa_micros FROM ad_group WHERE campaign.id = ${Number(campaignId)} AND ad_group.id = ${Number(groupId)}`);
  const g = rows[0]?.adGroup;
  if (!g || g.status === 'REMOVED') throw new Error('Este grupo de anúncios não existe mais na campanha.');
  return { name: String(g.name || `Grupo ${groupId}`), resource: g.resourceName, status: g.status, target: money(g.targetCpaMicros) };
}

/** Inclui palavras-chave num grupo. Uma por linha; as que o grupo já tem ficam de fora. */
export async function addKeywords(ctx: AdsContext, campaignId: string, groupId: string, texts: string[], match: Match) {
  if (!MATCH.has(match)) throw new Error('Tipo de correspondência não reconhecido.');
  const wanted = [...new Map(texts.map(clean).filter(Boolean).map(t => [t.toLowerCase(), t])).values()];
  if (!wanted.length) throw new Error('Escreva pelo menos uma palavra-chave.');
  if (wanted.length > 50) throw new Error('No máximo 50 palavras-chave por vez.');
  const bad = wanted.find(t => count(t) > 80 || t.split(' ').length > 10 || /[!@%^*()={};~`<>?\\|]/.test(t));
  if (bad) throw new Error(`"${bad.slice(0, 40)}": a palavra-chave tem até 80 letras e 10 palavras, sem símbolos como ! @ % * ( ).`);
  const group = await groupOf(ctx, campaignId, groupId);
  const existing = await search(ctx, `
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
    FROM ad_group_criterion
    WHERE ad_group.id = ${Number(groupId)} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'`);
  const have = new Set(existing.map(r => `${String(r.adGroupCriterion?.keyword?.text || '').toLowerCase()}|${r.adGroupCriterion?.keyword?.matchType}`));
  const fresh = wanted.filter(t => !have.has(`${t.toLowerCase()}|${match}`));
  if (!fresh.length) throw new Error(wanted.length === 1 ? 'Esta palavra-chave já está no grupo, com esse tipo de correspondência.' : 'Todas essas palavras-chave já estão no grupo.');
  const operations = fresh.map(text => ({ create: { adGroup: group.resource, status: 'ENABLED', keyword: { text, matchType: match } } }));
  await mutate(ctx, 'adGroupCriteria', operations, true);
  const done = await mutate(ctx, 'adGroupCriteria', operations, false);
  // "grupo~palavra" de cada uma, na ordem do pedido: é como a tela identifica a palavra-chave.
  const items = fresh.map((text, i) => ({ text, match, key: String(done?.results?.[i]?.resourceName || '').split('/').pop() || '' })).filter(x => /^\d+~\d+$/.test(x.key));
  return { added: fresh.map(t => keywordLabel(t, match)), items, skipped: wanted.length - fresh.length, group: group.name, calls: 4 };
}

// ── Grupos de anúncios ──────────────────────────────────────────────────────

export async function setGroupStatus(ctx: AdsContext, campaignId: string, groupId: string, status: 'PAUSED' | 'ENABLED') {
  const group = await groupOf(ctx, campaignId, groupId);
  if (group.status === status) throw new Error(status === 'PAUSED' ? 'Este grupo já está pausado.' : 'Este grupo já está ativo.');
  const operations = [{ update: { resourceName: group.resource, status }, updateMask: 'status' }];
  await mutate(ctx, 'adGroups', operations, true);
  await mutate(ctx, 'adGroups', operations, false);
  const after = await groupOf(ctx, campaignId, groupId);
  if (after.status !== status) throw new Error('O Google aceitou o pedido, mas o grupo continua como estava.');
  return { label: group.name, calls: 4 };
}

export async function renameGroup(ctx: AdsContext, campaignId: string, groupId: string, rawName: string) {
  const name = clean(rawName);
  if (!name || count(name) > 255) throw new Error('O nome do grupo precisa ter entre 1 e 255 letras.');
  const group = await groupOf(ctx, campaignId, groupId);
  if (group.name === name) throw new Error('O grupo já tem este nome.');
  const operations = [{ update: { resourceName: group.resource, name }, updateMask: 'name' }];
  await mutate(ctx, 'adGroups', operations, true);
  await mutate(ctx, 'adGroups', operations, false);
  return { before: group.name, label: name, calls: 3 };
}

/**
 * Grupo novo na campanha. Com `copyFrom`, leva junto as palavras-chave (ativas e pausadas, como estão), as
 * negativas do grupo e os anúncios de pesquisa responsivos que não foram removidos. A meta de CPA é a informada,
 * ou a do grupo copiado quando nada é informado; em branco, o grupo segue a meta da campanha.
 */
export async function createGroup(ctx: AdsContext, campaignId: string, input: { name: string; target?: number | null; copyFrom?: string; paused?: boolean }) {
  const name = clean(input.name);
  if (!name || count(name) > 255) throw new Error('Dê um nome ao grupo.');
  const cid = ctx.customerId, id = Number(campaignId);
  let calls = 1;
  const groups = await search(ctx, `SELECT ad_group.id, ad_group.name, ad_group.type, ad_group.target_cpa_micros, campaign.bidding_strategy_type FROM ad_group WHERE campaign.id = ${id} AND ad_group.status != 'REMOVED'`);
  if (groups.some(r => String(r.adGroup?.name || '').toLowerCase() === name.toLowerCase())) throw new Error('Já existe um grupo com este nome na campanha.');
  const strategy = String(groups[0]?.campaign?.biddingStrategyType || '');
  const usesCpa = strategy === 'MAXIMIZE_CONVERSIONS' || strategy === 'TARGET_CPA';
  const source = input.copyFrom ? groups.find(r => String(r.adGroup?.id) === String(input.copyFrom))?.adGroup : null;
  if (input.copyFrom && !source) throw new Error('O grupo a copiar não existe mais na campanha.');
  const target = input.target && input.target > 0 ? input.target : source ? money(source.targetCpaMicros) : null;

  const group = `customers/${cid}/adGroups/-1`;
  const operations: any[] = [{ adGroupOperation: { create: {
    resourceName: group, campaign: `customers/${cid}/campaigns/${campaignId}`, name, status: input.paused ? 'PAUSED' : 'ENABLED', type: source?.type || 'SEARCH_STANDARD',
    ...(target && usesCpa ? { targetCpaMicros: micros(target) } : {}),
  } } }];
  let keywords = 0, ads = 0;
  if (source) {
    calls += 2;
    const [criteria, adRows] = await Promise.all([
      search(ctx, `
        SELECT ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
        FROM ad_group_criterion WHERE ad_group.id = ${Number(source.id)} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`),
      search(ctx, `
        SELECT ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
               ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2
        FROM ad_group_ad WHERE ad_group.id = ${Number(source.id)} AND ad_group_ad.status != 'REMOVED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`),
    ]);
    for (const r of criteria) {
      const c = r.adGroupCriterion || {};
      if (!c.keyword?.text) continue;
      operations.push({ adGroupCriterionOperation: { create: { adGroup: group, keyword: { text: c.keyword.text, matchType: c.keyword.matchType || 'BROAD' },
        ...(c.negative ? { negative: true } : { status: c.status === 'PAUSED' ? 'PAUSED' : 'ENABLED' }) } } });
      if (!c.negative) keywords++;
    }
    for (const r of adRows) {
      const a = r.adGroupAd?.ad || {}, rsa = a.responsiveSearchAd || {};
      if (!rsa.headlines?.length) continue;
      operations.push({ adGroupAdOperation: { create: { adGroup: group, status: r.adGroupAd?.status === 'PAUSED' ? 'PAUSED' : 'ENABLED', ad: {
        finalUrls: a.finalUrls || [],
        responsiveSearchAd: {
          headlines: rsa.headlines.map((h: any) => ({ text: h.text, ...(h.pinnedField ? { pinnedField: h.pinnedField } : {}) })),
          descriptions: (rsa.descriptions || []).map((d: any) => ({ text: d.text, ...(d.pinnedField ? { pinnedField: d.pinnedField } : {}) })),
          ...(rsa.path1 ? { path1: rsa.path1 } : {}), ...(rsa.path1 && rsa.path2 ? { path2: rsa.path2 } : {}),
        },
      } } } });
      ads++;
    }
  }
  const results = await both(ctx, operations);
  calls += operations.length * 2;
  const created = results.map(r => r.adGroupResult?.resourceName).find(Boolean) as string | undefined;
  return { label: name, group_id: created ? created.split('/').pop()! : null, keywords, ads, copied: source ? String(source.name) : null, target: target && usesCpa ? target : null, calls };
}

// ── Anúncios ────────────────────────────────────────────────────────────────

export interface AdInput { titulos: string[]; descricoes: string[]; url: string; caminho1?: string; caminho2?: string; paused?: boolean }

/** Os anúncios de pesquisa responsivos da campanha, com o texto inteiro: é de onde sai a cópia. */
export async function readAds(ctx: AdsContext, campaignId: string) {
  const rows = await search(ctx, `
    SELECT ad_group.id, ad_group.name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
           ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2
    FROM ad_group_ad WHERE campaign.id = ${Number(campaignId)} AND ad_group_ad.status != 'REMOVED' AND ad_group.status != 'REMOVED'`);
  return rows.filter(r => r.adGroupAd?.ad?.type === 'RESPONSIVE_SEARCH_AD').map(r => {
    const a = r.adGroupAd.ad, rsa = a.responsiveSearchAd || {};
    return {
      id: `${r.adGroup?.id}~${a.id}`, group_id: String(r.adGroup?.id || ''), group: String(r.adGroup?.name || ''), status: String(r.adGroupAd.status || ''),
      url: String(a.finalUrls?.[0] || ''), caminho1: String(rsa.path1 || ''), caminho2: String(rsa.path2 || ''),
      titulos: (rsa.headlines || []).map((h: any) => String(h.text || '')), descricoes: (rsa.descriptions || []).map((d: any) => String(d.text || '')),
    };
  });
}

/** O que impede o anúncio de ser criado. As letras são contadas aqui, como o Google conta. */
export function adProblem(input: AdInput): string | null {
  const titles = input.titulos.map(clean).filter(Boolean), descs = input.descricoes.map(clean).filter(Boolean);
  if (titles.length < 3 || titles.length > 15) return 'O anúncio precisa de 3 a 15 títulos.';
  if (descs.length < 2 || descs.length > 4) return 'O anúncio precisa de 2 a 4 descrições.';
  const longTitle = titles.find(t => count(t.replace(/\{KeyWord:([^}]*)\}/gi, '$1')) > 30);
  if (longTitle) return `Título "${longTitle.slice(0, 40)}" passa de 30 letras.`;
  const longDesc = descs.find(t => count(t.replace(/\{KeyWord:([^}]*)\}/gi, '$1')) > 90);
  if (longDesc) return `Descrição "${longDesc.slice(0, 40)}…" passa de 90 letras.`;
  if (new Set(titles.map(t => t.toLowerCase())).size !== titles.length) return 'Há títulos repetidos.';
  if (new Set(descs.map(t => t.toLowerCase())).size !== descs.length) return 'Há descrições repetidas.';
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(clean(input.url))) return 'A página do anúncio precisa começar com https://';
  for (const path of [input.caminho1 || '', input.caminho2 || '']) if (count(path) > 15 || /\s/.test(path)) return 'Cada caminho de exibição tem até 15 letras, sem espaço.';
  if (!input.caminho1 && input.caminho2) return 'Preencha o primeiro caminho de exibição antes do segundo.';
  return null;
}

export async function createAd(ctx: AdsContext, campaignId: string, groupId: string, input: AdInput) {
  const problem = adProblem(input);
  if (problem) throw new Error(problem);
  const group = await groupOf(ctx, campaignId, groupId);
  const titles = input.titulos.map(clean).filter(Boolean), descs = input.descricoes.map(clean).filter(Boolean);
  const operations = [{ create: { adGroup: group.resource, status: input.paused ? 'PAUSED' : 'ENABLED', ad: {
    finalUrls: [clean(input.url)],
    responsiveSearchAd: {
      headlines: titles.map(text => ({ text })), descriptions: descs.map(text => ({ text })),
      ...(input.caminho1 ? { path1: input.caminho1 } : {}), ...(input.caminho1 && input.caminho2 ? { path2: input.caminho2 } : {}),
    },
  } } }];
  await mutate(ctx, 'adGroupAds', operations, true);
  const done = await mutate(ctx, 'adGroupAds', operations, false);
  const resource = String(done?.results?.[0]?.resourceName || '');
  return { label: `${titles[0]} (grupo ${group.name})`, ad: resource.split('/').pop() || null, group: group.name, titles, descs, calls: 3 };
}

/** Pausa (ou reativa) um anúncio. `adKey` é grupo~anúncio. */
export async function setAdStatus(ctx: AdsContext, campaignId: string, adKey: string, status: 'PAUSED' | 'ENABLED') {
  if (!/^\d+~\d+$/.test(adKey)) throw new Error('Anúncio não reconhecido.');
  const resource = `customers/${ctx.customerId}/adGroupAds/${adKey}`;
  const read = () => search(ctx, `
    SELECT ad_group_ad.status, ad_group.name, ad_group_ad.ad.responsive_search_ad.headlines
    FROM ad_group_ad WHERE campaign.id = ${Number(campaignId)} AND ad_group_ad.resource_name = '${resource}'`);
  const before = (await read())[0];
  if (!before?.adGroupAd || before.adGroupAd.status === 'REMOVED') throw new Error('Este anúncio não existe mais na campanha.');
  if (before.adGroupAd.status === status) throw new Error(status === 'PAUSED' ? 'Este anúncio já está pausado.' : 'Este anúncio já está ativo.');
  const operations = [{ update: { resourceName: resource, status }, updateMask: 'status' }];
  await mutate(ctx, 'adGroupAds', operations, true);
  await mutate(ctx, 'adGroupAds', operations, false);
  if ((await read())[0]?.adGroupAd?.status !== status) throw new Error('O Google aceitou o pedido, mas o anúncio continua como estava.');
  const first = before.adGroupAd.ad?.responsiveSearchAd?.headlines?.[0]?.text;
  return { label: `${first || `Anúncio ${adKey.split('~')[1]}`} (grupo ${before.adGroup?.name || ''})`, resource, calls: 4 };
}

// ── Locais ──────────────────────────────────────────────────────────────────

/** Os locais da campanha no Google agora: incluídos e excluídos. Sem nenhum incluído, a campanha roda no mundo todo, menos os excluídos. */
export async function readLocations(ctx: AdsContext, campaignId: string) {
  const rows = await search(ctx, `
    SELECT campaign_criterion.criterion_id, campaign_criterion.negative, campaign_criterion.bid_modifier, campaign_criterion.location.geo_target_constant
    FROM campaign_criterion WHERE campaign.id = ${Number(campaignId)} AND campaign_criterion.type = 'LOCATION'`);
  let calls = 1;
  const geos = [...new Set(rows.map(r => r.campaignCriterion?.location?.geoTargetConstant).filter(Boolean))].slice(0, 300);
  const names = new Map<string, string>();
  if (geos.length) {
    calls++;
    const found = await search(ctx, `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.target_type FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${geos.map(g => `'${g}'`).join(',')})`).catch(() => []);
    for (const r of found) names.set(r.geoTargetConstant?.resourceName, placeName(r.geoTargetConstant || {}));
  }
  const locations = rows.map(r => r.campaignCriterion || {}).filter(c => c.criterionId).map(c => ({
    id: String(c.criterionId), nome: names.get(c.location?.geoTargetConstant) || `Local ${c.criterionId}`, excluido: !!c.negative,
  })).sort((a, b) => Number(a.excluido) - Number(b.excluido) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { locations, calls };
}

/** Inclui ou exclui um local na campanha. `geoId` é o número do local no Google (o mesmo da busca de locais). */
export async function addLocation(ctx: AdsContext, campaignId: string, geoId: string, exclude: boolean) {
  if (!/^\d+$/.test(geoId)) throw new Error('Local não reconhecido.');
  const { locations } = await readLocations(ctx, campaignId);
  const same = locations.find(l => l.id === geoId);
  if (same) throw new Error(same.excluido === exclude ? `Este local já está ${exclude ? 'excluído' : 'incluído'} na campanha.` : `Este local está ${same.excluido ? 'excluído' : 'incluído'} na campanha. Tire-o da lista antes de ${exclude ? 'excluir' : 'incluir'}.`);
  const operations = [{ create: { campaign: `customers/${ctx.customerId}/campaigns/${campaignId}`, negative: exclude, location: { geoTargetConstant: `geoTargetConstants/${geoId}` } } }];
  await mutate(ctx, 'campaignCriteria', operations, true);
  await mutate(ctx, 'campaignCriteria', operations, false);
  const after = await readLocations(ctx, campaignId);
  const made = after.locations.find(l => l.id === geoId);
  if (!made) throw new Error('O Google aceitou o pedido, mas o local não apareceu na campanha.');
  return { label: `${made.nome} (${exclude ? 'excluído' : 'incluído'})`, locations: after.locations, calls: 6 };
}

/** Tira um local da campanha (incluído ou excluído). Não deixa tirar o último incluído sem avisar: a campanha passaria a rodar no mundo todo. */
export async function removeLocation(ctx: AdsContext, campaignId: string, criterionId: string, confirmWorld: boolean) {
  if (!/^\d+$/.test(criterionId)) throw new Error('Local não reconhecido.');
  const { locations } = await readLocations(ctx, campaignId);
  const target = locations.find(l => l.id === criterionId);
  if (!target) throw new Error('Este local não está mais na campanha.');
  const included = locations.filter(l => !l.excluido);
  if (!target.excluido && included.length === 1 && !confirmWorld) throw new Refused('MUNDO');
  const operations = [{ remove: `customers/${ctx.customerId}/campaignCriteria/${campaignId}~${criterionId}` }];
  await mutate(ctx, 'campaignCriteria', operations, true);
  await mutate(ctx, 'campaignCriteria', operations, false);
  const after = await readLocations(ctx, campaignId);
  return { label: `${target.nome} (${target.excluido ? 'deixou de ser excluído' : 'saiu da campanha'})`, locations: after.locations, calls: 6 };
}

// ── Edição do anúncio, com o desempenho de cada texto ────────────────────────

export interface AdText { texto: string; pin: string | null; impressoes: number; cliques: number; conversoes: number; nota: string | null }

/**
 * Um anúncio de pesquisa responsivo com cada título e descrição ao lado do que rendeu nos últimos 30 dias.
 * O Google mostra combinações dos textos: impressões e cliques de cada um dizem quanto ele entra nas
 * combinações e se quem vê clica. A nota do Google (melhor, bom, baixo) vem quando ele ainda a informa.
 */
export async function readAdDetail(ctx: AdsContext, campaignId: string, adKey: string) {
  if (!/^\d+~\d+$/.test(adKey)) throw new Error('Anúncio não reconhecido.');
  const [groupId, adId] = adKey.split('~');
  const where = `campaign.id = ${Number(campaignId)} AND ad_group.id = ${Number(groupId)} AND ad_group_ad.ad.id = ${Number(adId)}`;
  let warning = '';                                              // por que os números por texto não vieram, quando o Google recusa a consulta
  const [adRows, perf, labels] = await Promise.all([
    search(ctx, `
      SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group.name, ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status,
             ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
             ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2
      FROM ad_group_ad WHERE ${where}`),
    search(ctx, `
      SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad_asset_view.field_type, asset.text_asset.text, metrics.impressions, metrics.clicks, metrics.conversions
      FROM ad_group_ad_asset_view WHERE ${where} AND segments.date DURING LAST_30_DAYS`).catch((e: any) => { warning = String(e?.message || e).slice(0, 200); return [] as any[]; }),
    search(ctx, `
      SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label, ad_group_ad_asset_view.enabled, asset.text_asset.text
      FROM ad_group_ad_asset_view WHERE ${where}`).catch(() => [] as any[]),
  ]);
  const row = adRows[0], a = row?.adGroupAd?.ad;
  if (!a || row.adGroupAd.status === 'REMOVED') throw new Error('Este anúncio não existe mais na campanha.');
  if (a.type !== 'RESPONSIVE_SEARCH_AD') throw new Error('Só o anúncio de pesquisa responsivo pode ser editado por aqui.');
  const keyOf = (type: string, text: string) => `${type}|${String(text || '').trim().toLowerCase()}`;
  const numbers = new Map<string, { impressoes: number; cliques: number; conversoes: number }>();
  for (const r of perf) {
    const k = keyOf(r.adGroupAdAssetView?.fieldType, r.asset?.textAsset?.text), cur = numbers.get(k) || { impressoes: 0, cliques: 0, conversoes: 0 };
    cur.impressoes += Number(r.metrics?.impressions) || 0; cur.cliques += Number(r.metrics?.clicks) || 0; cur.conversoes += Number(r.metrics?.conversions) || 0;
    numbers.set(k, cur);
  }
  const NOTE: Record<string, string> = { BEST: 'melhor', GOOD: 'bom', LOW: 'baixo', LEARNING: 'aprendendo', PENDING: 'em análise' };
  const note = new Map<string, string>();
  for (const r of labels) { const l = NOTE[r.adGroupAdAssetView?.performanceLabel]; if (l && r.adGroupAdAssetView?.enabled !== false) note.set(keyOf(r.adGroupAdAssetView?.fieldType, r.asset?.textAsset?.text), l); }
  const rsa = a.responsiveSearchAd || {};
  const texts = (list: any[], type: string): AdText[] => (list || []).map(x => ({
    texto: String(x.text || ''), pin: x.pinnedField || null, nota: note.get(keyOf(type, x.text)) || null,
    ...(numbers.get(keyOf(type, x.text)) || { impressoes: 0, cliques: 0, conversoes: 0 }),
  }));
  return {
    id: adKey, group_id: groupId, group: String(row.adGroup?.name || ''), status: String(row.adGroupAd.status || ''),
    forca: String(row.adGroupAd.adStrength || ''), aprovacao: String(row.adGroupAd.policySummary?.approvalStatus || ''),
    url: String(a.finalUrls?.[0] || ''), caminho1: String(rsa.path1 || ''), caminho2: String(rsa.path2 || ''),
    titulos: texts(rsa.headlines, 'HEADLINE'), descricoes: texts(rsa.descriptions, 'DESCRIPTION'),
    tem_numeros: perf.length > 0, aviso: warning, calls: 3,
  };
}

/** Troca os textos de um anúncio que já existe. O que estava fixado numa posição continua fixado, se o texto for o mesmo. */
export async function updateAd(ctx: AdsContext, campaignId: string, adKey: string, input: AdInput) {
  const problem = adProblem(input);
  if (problem) throw new Error(problem);
  const before = await readAdDetail(ctx, campaignId, adKey);
  const titles = input.titulos.map(clean).filter(Boolean), descs = input.descricoes.map(clean).filter(Boolean);
  const pinOf = new Map([...before.titulos, ...before.descricoes].filter(t => t.pin).map(t => [t.texto.trim().toLowerCase(), t.pin!]));
  const asset = (text: string) => ({ text, ...(pinOf.has(text.toLowerCase()) ? { pinnedField: pinOf.get(text.toLowerCase()) } : {}) });
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const mask: string[] = [], ad: Record<string, any> = { resourceName: `customers/${ctx.customerId}/ads/${adKey.split('~')[1]}` }, rsa: Record<string, any> = {};
  if (!same(titles, before.titulos.map(t => t.texto.trim()))) { rsa.headlines = titles.map(asset); mask.push('responsive_search_ad.headlines'); }
  if (!same(descs, before.descricoes.map(t => t.texto.trim()))) { rsa.descriptions = descs.map(asset); mask.push('responsive_search_ad.descriptions'); }
  const p1 = (input.caminho1 || '').trim(), p2 = p1 ? (input.caminho2 || '').trim() : '';
  if (p1 !== before.caminho1) { rsa.path1 = p1; mask.push('responsive_search_ad.path1'); }
  if (p2 !== before.caminho2) { rsa.path2 = p2; mask.push('responsive_search_ad.path2'); }
  if (clean(input.url) !== before.url) { ad.finalUrls = [clean(input.url)]; mask.push('final_urls'); }
  if (!mask.length) throw new Error('Nada mudou no anúncio.');
  if (Object.keys(rsa).length) ad.responsiveSearchAd = rsa;
  const operations = [{ update: ad, updateMask: mask.join(',') }];
  await mutate(ctx, 'ads', operations, true);
  await mutate(ctx, 'ads', operations, false);
  const removed = before.titulos.filter(t => !titles.includes(t.texto.trim())).length + before.descricoes.filter(t => !descs.includes(t.texto.trim())).length;
  const added = titles.filter(t => !before.titulos.some(b => b.texto.trim() === t)).length + descs.filter(t => !before.descricoes.some(b => b.texto.trim() === t)).length;
  return { label: `${titles[0]} (grupo ${before.group}): ${added} ${added === 1 ? 'texto novo' : 'textos novos'}, ${removed} ${removed === 1 ? 'retirado' : 'retirados'}${mask.includes('final_urls') ? ', página trocada' : ''}`, titles, descs, calls: before.calls + 2 };
}

// ── Sitelinks e frases de destaque da campanha ──────────────────────────────

export interface CampaignAsset { resource: string; tipo: 'sitelink' | 'destaque'; texto: string; desc1: string; desc2: string; url: string; impressoes: number; cliques: number }

// Nas consultas de campaign_asset o Google exige campaign.id no SELECT quando ele está no WHERE.
export async function readCampaignAssets(ctx: AdsContext, campaignId: string): Promise<{ assets: CampaignAsset[]; aviso: string; calls: number }> {
  let warning = '';
  const id = Number(campaignId), types = `campaign_asset.field_type IN ('SITELINK', 'CALLOUT')`;
  const [rows, perf] = await Promise.all([
    search(ctx, `
      SELECT campaign.id, campaign_asset.resource_name, campaign_asset.field_type, campaign_asset.status, asset.final_urls,
             asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text
      FROM campaign_asset WHERE campaign.id = ${id} AND campaign_asset.status != 'REMOVED' AND ${types}`),
    search(ctx, `SELECT campaign.id, campaign_asset.resource_name, campaign_asset.field_type, metrics.impressions, metrics.clicks FROM campaign_asset WHERE campaign.id = ${id} AND ${types} AND segments.date DURING LAST_30_DAYS`).catch((e: any) => { warning = String(e?.message || e).slice(0, 200); return [] as any[]; }),
  ]);
  const numbers = new Map<string, { impressoes: number; cliques: number }>();
  for (const r of perf) { const k = r.campaignAsset?.resourceName, cur = numbers.get(k) || { impressoes: 0, cliques: 0 }; cur.impressoes += Number(r.metrics?.impressions) || 0; cur.cliques += Number(r.metrics?.clicks) || 0; numbers.set(k, cur); }
  const assets = rows.map(r => {
    const ca = r.campaignAsset || {}, as = r.asset || {}, link = ca.fieldType === 'SITELINK';
    return {
      resource: String(ca.resourceName || ''), tipo: (link ? 'sitelink' : 'destaque') as CampaignAsset['tipo'],
      texto: String(link ? as.sitelinkAsset?.linkText || '' : as.calloutAsset?.calloutText || ''), desc1: String(as.sitelinkAsset?.description1 || ''), desc2: String(as.sitelinkAsset?.description2 || ''),
      url: String(as.finalUrls?.[0] || ''), ...(numbers.get(ca.resourceName) || { impressoes: 0, cliques: 0 }),
    };
  }).filter(x => x.resource && x.texto).sort((x, y) => x.tipo.localeCompare(y.tipo) || y.impressoes - x.impressoes || x.texto.localeCompare(y.texto));
  return { assets, aviso: warning, calls: 2 };
}

/** Sitelink ou frase de destaque novo, sempre no nível da campanha (para ir junto em cada cópia). */
export async function addCampaignAsset(ctx: AdsContext, campaignId: string, input: { tipo: 'sitelink' | 'destaque'; texto: string; desc1?: string; desc2?: string; url?: string }) {
  const text = clean(input.texto), d1 = clean(input.desc1), d2 = clean(input.desc2), url = clean(input.url);
  const link = input.tipo === 'sitelink';
  if (!text || count(text) > 25) throw new Error(`O texto ${link ? 'do sitelink' : 'da frase de destaque'} tem de 1 a 25 letras.`);
  if (link) {
    if ((d1 && !d2) || (!d1 && d2)) throw new Error('As duas linhas de descrição do sitelink vão juntas (ou nenhuma).');
    if (count(d1) > 35 || count(d2) > 35) throw new Error('Cada linha de descrição do sitelink tem até 35 letras.');
    if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(url)) throw new Error('A página do sitelink precisa começar com https://');
  }
  const { assets } = await readCampaignAssets(ctx, campaignId);
  if (assets.some(a => a.tipo === input.tipo && a.texto.toLowerCase() === text.toLowerCase())) throw new Error(`A campanha já tem ${link ? 'um sitelink' : 'uma frase de destaque'} com este texto.`);
  const cid = ctx.customerId, asset = `customers/${cid}/assets/-1`;
  await both(ctx, [
    { assetOperation: { create: link ? { resourceName: asset, finalUrls: [url], sitelinkAsset: { linkText: text, ...(d1 && d2 ? { description1: d1, description2: d2 } : {}) } } : { resourceName: asset, calloutAsset: { calloutText: text } } } },
    { campaignAssetOperation: { create: { campaign: `customers/${cid}/campaigns/${campaignId}`, asset, fieldType: link ? 'SITELINK' : 'CALLOUT' } } },
  ]);
  const after = await readCampaignAssets(ctx, campaignId);
  return { label: `${link ? 'Sitelink' : 'Frase de destaque'} "${text}"`, assets: after.assets, calls: 8 };
}

/** Tira um sitelink ou uma frase de destaque da campanha. O recurso continua na conta; só deixa de valer nesta campanha. */
export async function removeCampaignAsset(ctx: AdsContext, campaignId: string, resource: string) {
  if (!new RegExp(`^customers/${ctx.customerId}/campaignAssets/${Number(campaignId)}~\\d+~(SITELINK|CALLOUT)$`).test(resource)) throw new Error('Recurso não reconhecido.');
  const { assets } = await readCampaignAssets(ctx, campaignId);
  const target = assets.find(a => a.resource === resource);
  if (!target) throw new Error('Este recurso não está mais na campanha.');
  const operations = [{ remove: resource }];
  await mutate(ctx, 'campaignAssets', operations, true);
  await mutate(ctx, 'campaignAssets', operations, false);
  const after = await readCampaignAssets(ctx, campaignId);
  return { label: `${target.tipo === 'sitelink' ? 'Sitelink' : 'Frase de destaque'} "${target.texto}" retirado`, assets: after.assets, calls: 6 };
}
