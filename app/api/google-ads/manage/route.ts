import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { addUsage } from '@/lib/googleAds/sync';
import { GoogleAdsError, search } from '@/lib/googleAds/client';
import { campaignAccess, canEdit, setKeywordStatus } from '@/lib/googleAds/edit';
import { addCampaignAsset, addKeywords, addLocation, createAd, createGroup, readAdDetail, readAds, readCampaignAssets, readLocations, Refused, removeCampaignAsset, removeLocation, renameGroup, setAdStatus, setGroupStatus, updateAd, type Match } from '@/lib/googleAds/manage';
import { adviseAd } from '@/lib/googleAds/adAdvice';
import { aiEnabled } from '@/lib/ai/openrouter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Montagem da campanha pelo Autometrics, dentro do Google Ads.
 *
 * GET  ?product_id=…&ver=grupos     os grupos de anúncios da campanha, como estão no Google agora
 * GET  ?product_id=…&ver=anuncios   os anúncios com o texto inteiro (para copiar)
 * GET  ?product_id=…&ver=locais     os locais incluídos e excluídos
 * GET  ?product_id=…&ver=anuncio&ad=grupo~anúncio   um anúncio com o que cada título e descrição rendeu em 30 dias
 * GET  ?product_id=…&ver=recursos   sitelinks e frases de destaque da campanha, com impressões e cliques
 * POST { product_id, action, … }
 *   palavra_nova     { group_id, texts[], match }          inclui palavras-chave num grupo (também a partir de um termo de pesquisa)
 *   palavra_status   { keyword: "grupo~palavra", status }  pausa ou reativa uma palavra-chave
 *   grupo_novo       { name, target?, copy_from?, paused? } cria um grupo; com copy_from leva palavras-chave e anúncios
 *   grupo_status     { group_id, status }
 *   grupo_nome       { group_id, name }
 *   anuncio_novo     { group_id, titulos[], descricoes[], url, caminho1?, caminho2?, paused? }
 *   anuncio_status   { ad: "grupo~anúncio", status }
 *   anuncio_editar   { ad, titulos[], descricoes[], url, caminho1?, caminho2? }   troca os textos do anúncio que já existe
 *   anuncio_ia       { ad }                                 a IA lê o desempenho de cada texto e sugere o que trocar (não altera nada)
 *   recurso_novo     { tipo: 'sitelink' | 'destaque', texto, desc1?, desc2?, url? }
 *   recurso_remover  { resource }
 *   local_novo       { geo_id, excluir }
 *   local_remover    { id, confirmar_mundo? }
 *
 * Cada pedido passa por um ensaio no Google antes de valer e fica registrado em google_ads_actions.
 * Só para os logins liberados (lib/googleAds/editors).
 */

async function open(request: Request, productId: string) {
  const user = await getRequestUser(request);
  if (!user) return { fail: NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 }) };
  if (!canEdit(user.email)) return { fail: NextResponse.json({ allowed: false, error: 'A alteração pelo Autometrics ainda não está liberada para este login.' }, { status: 403 }) };
  const access = await campaignAccess(user.id, productId);
  if ('error' in access) return { fail: NextResponse.json({ allowed: true, error: access.error }, { status: 409 }) };
  return { user, access };
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const o = await open(request, q.get('product_id') || '');
  if ('fail' in o) return o.fail;
  const { ctx, campaignId } = o.access;
  try {
    const what = q.get('ver');
    if (what === 'anuncios') { const ads = await readAds(ctx, campaignId); await addUsage(1).catch(() => {}); return NextResponse.json({ allowed: true, ads }); }
    if (what === 'anuncio') { const ad = await readAdDetail(ctx, campaignId, q.get('ad') || ''); await addUsage(ad.calls).catch(() => {}); return NextResponse.json({ allowed: true, ad, ai: aiEnabled() }); }
    if (what === 'recursos') { const r = await readCampaignAssets(ctx, campaignId); await addUsage(r.calls).catch(() => {}); return NextResponse.json({ allowed: true, assets: r.assets }); }
    if (what === 'locais') { const r = await readLocations(ctx, campaignId); await addUsage(r.calls).catch(() => {}); return NextResponse.json({ allowed: true, locations: r.locations }); }
    const rows = await search(ctx, `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.target_cpa_micros FROM ad_group WHERE campaign.id = ${Number(campaignId)} AND ad_group.status != 'REMOVED'`);
    await addUsage(1).catch(() => {});
    return NextResponse.json({
      allowed: true, currency: o.access.currency,
      groups: rows.map(r => r.adGroup || {}).filter(g => g.id).map(g => ({ id: String(g.id), nome: String(g.name || `Grupo ${g.id}`), status: String(g.status || ''), meta_cpa: g.targetCpaMicros ? Math.round(Number(g.targetCpaMicros) / 10000) / 100 : null }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    });
  } catch (e: any) {
    return NextResponse.json({ allowed: true, error: `O Google não respondeu: ${e.message}` }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const productId = String(body.product_id || '');
  const o = await open(request, productId);
  if ('fail' in o) return o.fail;
  const { user, access } = o, { ctx, campaignId } = access;
  const action = String(body.action || '');
  const status = body.status === 'ENABLED' ? 'ENABLED' : 'PAUSED';
  const list = (v: any, max: number) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map(x => String(x ?? '')).slice(0, max);
  let kind = action, target = '', key = '', calls = 0, extra: Record<string, any> = {};

  const save = (ok: boolean, error: string | null) => supabaseAdmin().from('google_ads_actions').insert({
    user_id: user.id, product_id: productId, customer_id: access.account.customer_id, campaign_id: campaignId,
    action: 'alterar', kind, target: target.slice(0, 300), target_key: key || null, ok, error,
    ...(action.endsWith('_status') ? { new_status: status } : {}),
  }).then(() => null, () => null);

  // Espelho do que a tela mostra (google_ads_entities): a mudança aparece na hora, sem esperar a próxima coleta.
  const db = supabaseAdmin(), now = new Date().toISOString();
  const mirror = (rows: { level: string; entity_id: string; ad_group_id: string; name: string; status: string; details: any }[]) => (rows.length
    ? db.from('google_ads_entities').upsert(rows.map(r => ({ ...r, product_id: productId, updated_at: now })), { onConflict: 'product_id, level, entity_id' }).then(() => null, () => null) : null);
  const patch = (level: string, entityId: string, change: Record<string, any>) =>
    db.from('google_ads_entities').update({ ...change, updated_at: now }).eq('product_id', productId).eq('level', level).eq('entity_id', entityId).then(() => null, () => null);

  try {
    if (action === 'palavra_nova') {
      const match = (['EXACT', 'PHRASE', 'BROAD'].includes(body.match) ? body.match : 'PHRASE') as Match;
      const r = await addKeywords(ctx, campaignId, String(body.group_id || ''), list(body.texts, 60), match);
      target = `${r.added.slice(0, 6).join(', ')}${r.added.length > 6 ? ` e mais ${r.added.length - 6}` : ''} (grupo ${r.group})`; calls = r.calls; extra = { added: r.added.length, skipped: r.skipped };
      await mirror(r.items.map(k => ({ level: 'keyword', entity_id: k.key, ad_group_id: k.key.split('~')[0], name: k.text, status: 'ENABLED', details: { match_type: k.match } })));
    } else if (action === 'palavra_status') {
      const r = await setKeywordStatus(ctx, campaignId, String(body.keyword || ''), status);
      kind = status === 'PAUSED' ? 'pausar_palavra' : 'ativar_palavra'; target = r.label; key = r.resource; calls = r.calls;
      await patch('keyword', String(body.keyword), { status });
    } else if (action === 'grupo_novo') {
      const r = await createGroup(ctx, campaignId, { name: String(body.name || ''), target: Number(body.target) > 0 ? Number(body.target) : null, copyFrom: body.copy_from ? String(body.copy_from) : undefined, paused: body.paused === true });
      target = `${r.label}${r.copied ? ` (cópia de ${r.copied}: ${r.keywords} palavras-chave, ${r.ads} ${r.ads === 1 ? 'anúncio' : 'anúncios'})` : ''}`; key = r.group_id || ''; calls = r.calls; extra = r;
      if (r.group_id) await mirror([{ level: 'ad_group', entity_id: r.group_id, ad_group_id: r.group_id, name: r.label, status: body.paused === true ? 'PAUSED' : 'ENABLED', details: { type: 'SEARCH_STANDARD', target_cpa: r.target } }]);
    } else if (action === 'grupo_status') {
      const r = await setGroupStatus(ctx, campaignId, String(body.group_id || ''), status);
      kind = status === 'PAUSED' ? 'pausar_grupo' : 'ativar_grupo'; target = r.label; key = String(body.group_id); calls = r.calls;
      await patch('ad_group', String(body.group_id), { status });
    } else if (action === 'grupo_nome') {
      const r = await renameGroup(ctx, campaignId, String(body.group_id || ''), String(body.name || ''));
      target = `${r.before} → ${r.label}`; key = String(body.group_id); calls = r.calls;
      await patch('ad_group', String(body.group_id), { name: r.label });
    } else if (action === 'anuncio_novo') {
      const r = await createAd(ctx, campaignId, String(body.group_id || ''), {
        titulos: list(body.titulos, 20), descricoes: list(body.descricoes, 8), url: String(body.url || ''),
        caminho1: String(body.caminho1 || '').trim(), caminho2: String(body.caminho2 || '').trim(), paused: body.paused === true,
      });
      target = r.label; key = r.ad || ''; calls = r.calls;
      if (r.ad && /^\d+~\d+$/.test(r.ad)) await mirror([{ level: 'ad', entity_id: r.ad, ad_group_id: r.ad.split('~')[0], name: r.titles[0], status: body.paused === true ? 'PAUSED' : 'ENABLED', details: {
        ad_id: r.ad.split('~')[1], type: 'RESPONSIVE_SEARCH_AD', ad_strength: 'PENDING', approval: 'UNDER_REVIEW', final_url: String(body.url || '').trim(),
        path1: String(body.caminho1 || '').trim() || null, path2: String(body.caminho2 || '').trim() || null, headlines: r.titles.map(text => ({ text })), descriptions: r.descs.map(text => ({ text })),
      } }]);
    } else if (action === 'anuncio_status') {
      const r = await setAdStatus(ctx, campaignId, String(body.ad || ''), status);
      kind = status === 'PAUSED' ? 'pausar_anuncio' : 'ativar_anuncio'; target = r.label; key = r.resource; calls = r.calls;
      await patch('ad', String(body.ad), { status });
    } else if (action === 'anuncio_editar') {
      const r = await updateAd(ctx, campaignId, String(body.ad || ''), {
        titulos: list(body.titulos, 20), descricoes: list(body.descricoes, 8), url: String(body.url || ''), caminho1: String(body.caminho1 || '').trim(), caminho2: String(body.caminho2 || '').trim(),
      });
      target = r.label; key = String(body.ad); calls = r.calls;
      // No espelho: os textos novos, e a análise do Google recomeça.
      const { data: old } = await db.from('google_ads_entities').select('details').eq('product_id', productId).eq('level', 'ad').eq('entity_id', String(body.ad)).maybeSingle();
      await patch('ad', String(body.ad), { name: r.titles[0], details: { ...(old?.details || {}), final_url: String(body.url || '').trim(), path1: String(body.caminho1 || '').trim() || null, path2: String(body.caminho2 || '').trim() || null,
        headlines: r.titles.map(text => ({ text })), descriptions: r.descs.map(text => ({ text })), approval: 'UNDER_REVIEW', ad_strength: 'PENDING' } });
    } else if (action === 'anuncio_ia') {
      // Só lê e sugere: não altera nada no Google e não entra no registro de alterações.
      if (!aiEnabled()) return NextResponse.json({ error: 'A IA está desligada no servidor.' }, { status: 409 });
      const [ad, assets] = await Promise.all([readAdDetail(ctx, campaignId, String(body.ad || '')), readCampaignAssets(ctx, campaignId)]);
      await addUsage(ad.calls + assets.calls).catch(() => {});
      const name = String(access.product.name || '');
      const advice = await adviseAd({ userId: user.id, productId }, { funnel: /\[(FF|FUNDO)\]/i.test(name) ? 'fundo' : 'topo', campaign: name, group: ad.group, titulos: ad.titulos, descricoes: ad.descricoes, tem_numeros: ad.tem_numeros, assets: assets.assets });
      return NextResponse.json({ success: true, advice });
    } else if (action === 'recurso_novo') {
      const r = await addCampaignAsset(ctx, campaignId, { tipo: body.tipo === 'destaque' ? 'destaque' : 'sitelink', texto: String(body.texto || ''), desc1: String(body.desc1 || ''), desc2: String(body.desc2 || ''), url: String(body.url || '') });
      target = r.label; calls = r.calls; extra = { assets: r.assets };
    } else if (action === 'recurso_remover') {
      const r = await removeCampaignAsset(ctx, campaignId, String(body.resource || ''));
      target = r.label; key = String(body.resource); calls = r.calls; extra = { assets: r.assets };
    } else if (action === 'local_novo') {
      const r = await addLocation(ctx, campaignId, String(body.geo_id || ''), body.excluir === true);
      target = r.label; key = String(body.geo_id); calls = r.calls; extra = { locations: r.locations };
    } else if (action === 'local_remover') {
      const r = await removeLocation(ctx, campaignId, String(body.id || ''), body.confirmar_mundo === true);
      target = r.label; key = String(body.id); calls = r.calls; extra = { locations: r.locations };
    } else return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });

    await save(true, null);
    await addUsage(calls).catch(() => {});
    return NextResponse.json({ success: true, target, ...extra });
  } catch (e: any) {
    // Tirar o último local incluído faz a campanha rodar no mundo todo: a tela pede a confirmação.
    if (e instanceof Refused && e.message === 'MUNDO') return NextResponse.json({ confirm: 'mundo', error: 'Este é o único local incluído. Sem ele, a campanha passa a aparecer no mundo todo (menos os locais excluídos).' }, { status: 409 });
    const refused = e instanceof GoogleAdsError || e instanceof Refused;
    if (refused) await save(false, String(e.message).slice(0, 1000));
    return NextResponse.json({ error: refused ? `O Google recusou: ${e.message}` : e.message }, { status: refused ? 502 : 400 });
  }
}
