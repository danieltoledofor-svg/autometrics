import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { addUsage } from '@/lib/googleAds/sync';
import { campaignAccess, canEdit } from '@/lib/googleAds/edit';
import { readTemplate } from '@/lib/campaignBuilder/template';
import { search, suggestLocations, type AdsContext } from '@/lib/googleAds/client';
import { languageName } from '@/lib/campaignBuilder/names';
import { similarCampaigns } from '@/lib/campaignBuilder/similar';
import { extractOffer, generateResources, type Funnel, type Offer } from '@/lib/campaignBuilder/resources';
import { fetchPageText } from '@/lib/analysis/page';
import { aiEnabled } from '@/lib/ai/openrouter';
import { createCampaign } from '@/lib/campaignBuilder/create';
import type { Draft } from '@/lib/campaignBuilder/draft';
import { decryptSecret } from '@/lib/googleAds/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Criador de campanhas (por enquanto só a leitura do modelo).
 *
 * GET                      campanhas do usuário ligadas ao Google e os modelos já lidos
 * GET ?product_id=…        lê a campanha inteira do Google e guarda como modelo
 * GET ?template=<id>       devolve um modelo guardado, sem consultar o Google
 * GET ?local=<texto>       locais do Google que batem com o texto (país, estado, cidade)
 * GET ?idiomas=1           idiomas que o Google aceita, com o nome em português
 * GET ?contas=1            contas ativas do usuário, com a MCC e as campanhas que estão rodando em cada uma
 * GET ?metas=<conta>       metas de conversão personalizadas que aquela conta enxerga
 * GET ?parecidas=<trecho>  o que mais converteu nas campanhas do usuário com esse trecho no nome
 * POST { action: 'oferta', url }                 lê a página do produto (preço, garantia, frete…) com a IA
 * POST { action: 'recursos', funil, … }          títulos, descrições, sitelinks e frases de destaque pela IA
 * POST { action: 'criar', draft, linha, ensaio }  ensaia (ou cria, pausada) uma campanha em uma conta
 *
 * Só para os logins liberados (lib/googleAds/edit).
 */
/** Acesso a uma conta do usuário (ou à primeira com ligação ativa, quando qualquer uma serve). */
async function accountContext(userId: string, customerId?: string): Promise<AdsContext | null> {
  const db = supabaseAdmin();
  let query = db.from('google_ads_accounts').select('customer_id, login_customer_id, connection_id').eq('user_id', userId);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data: accounts } = await query.limit(customerId ? 1 : 25);
  for (const acc of accounts || []) {
    const { data: conn } = await db.from('google_ads_connections').select('refresh_token_enc, status').eq('id', acc.connection_id).maybeSingle();
    if (conn?.status === 'ok') return { refreshToken: decryptSecret(conn.refresh_token_enc), customerId: acc.customer_id, loginCustomerId: acc.login_customer_id };
  }
  return null;
}

/**
 * Contas que o usuário ocultou dentro da MCC, no próprio Google Ads. O Google as dá como ativas, mas
 * quem ocultou não quer usar: ficam fora da lista do criador. Uma consulta por gerenciador, guardada
 * por 10 minutos. Se a consulta falhar, ninguém é escondido.
 */
const hiddenCache = new Map<string, { at: number; ids: Set<string> }>();
async function hiddenAccounts(userId: string, accounts: { customer_id: string; login_customer_id: string | null; connection_id: string }[]): Promise<{ ids: Set<string>; calls: number }> {
  const hit = hiddenCache.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return { ids: hit.ids, calls: 0 };
  const db = supabaseAdmin();
  const managers = new Map<string, string>();                    // gerenciador → ligação
  for (const a of accounts) if (a.login_customer_id && a.login_customer_id !== a.customer_id && !managers.has(a.login_customer_id)) managers.set(a.login_customer_id, a.connection_id);
  const { data: conns } = await db.from('google_ads_connections').select('id, refresh_token_enc, status').in('id', [...new Set(managers.values())]);
  const token = new Map((conns || []).filter(c => c.status === 'ok').map(c => [c.id, c.refresh_token_enc]));
  const ids = new Set<string>();
  let calls = 0;
  await Promise.all([...managers].map(async ([manager, connection]) => {
    const enc = token.get(connection);
    if (!enc) return;
    calls++;
    try {
      const rows = await search({ refreshToken: decryptSecret(enc), customerId: manager, loginCustomerId: manager },
        'SELECT customer_client.id, customer_client.hidden FROM customer_client WHERE customer_client.level >= 1 AND customer_client.hidden = TRUE');
      for (const r of rows) if (r.customerClient?.id) ids.add(String(r.customerClient.id).replace(/\D/g, ''));
    } catch { /* sem a resposta deste gerenciador, as contas dele aparecem todas */ }
  }));
  hiddenCache.set(userId, { at: Date.now(), ids });
  return { ids, calls };
}

let languageCache: { at: number; list: { id: string; nome: string }[] } | null = null;

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  if (!canEdit(user.email)) return NextResponse.json({ allowed: false });
  const q = new URL(request.url).searchParams;
  const db = supabaseAdmin();

  if (q.get('template')) {
    const { data } = await db.from('campaign_templates').select('id, name, funnel, data, updated_at').eq('id', q.get('template')!).eq('user_id', user.id).maybeSingle();
    return data ? NextResponse.json({ allowed: true, template: data.data, saved: { id: data.id, funnel: data.funnel, updated_at: data.updated_at } })
      : NextResponse.json({ allowed: true, error: 'Modelo não encontrado.' }, { status: 404 });
  }

  const place = (q.get('local') || '').trim().slice(0, 80);
  if (place) {
    // Qualquer ligação ativa do usuário serve: a lista de locais é a mesma para todas as contas.
    const { data: conns } = await db.from('google_ads_connections').select('refresh_token_enc').eq('user_id', user.id).eq('status', 'ok').limit(1);
    if (!conns?.length) return NextResponse.json({ allowed: true, error: 'Nenhuma ligação ativa com o Google. Reconecte em Integração.' }, { status: 409 });
    try {
      const places = await suggestLocations(decryptSecret(conns[0].refresh_token_enc), place);
      await addUsage(1).catch(() => {});
      return NextResponse.json({ allowed: true, places: places.slice(0, 12) });
    } catch (e: any) {
      return NextResponse.json({ allowed: true, error: `O Google não respondeu: ${e.message}` }, { status: 502 });
    }
  }

  if (q.get('parecidas')) {
    try { return NextResponse.json({ allowed: true, similar: await similarCampaigns(user.id, q.get('parecidas')!) }); }
    catch (e: any) { return NextResponse.json({ allowed: true, error: e.message }, { status: 500 }); }
  }

  if (q.get('idiomas')) {
    if (languageCache && Date.now() - languageCache.at < 24 * 3600 * 1000) return NextResponse.json({ allowed: true, languages: languageCache.list });
    const ctx = await accountContext(user.id);
    if (!ctx) return NextResponse.json({ allowed: true, error: 'Nenhuma ligação ativa com o Google. Reconecte em Integração.' }, { status: 409 });
    try {
      const rows = await search(ctx, 'SELECT language_constant.id, language_constant.code, language_constant.name FROM language_constant WHERE language_constant.targetable = TRUE');
      await addUsage(1).catch(() => {});
      const list = rows.map(r => r.languageConstant || {}).filter(l => l.id)
        .map(l => ({ id: String(l.id), nome: languageName(l.code, l.name) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      languageCache = { at: Date.now(), list };
      return NextResponse.json({ allowed: true, languages: list });
    } catch (e: any) {
      return NextResponse.json({ allowed: true, error: `O Google não respondeu: ${e.message}` }, { status: 502 });
    }
  }

  if (q.get('contas')) {
    // Conta suspensa ou cancelada não recebe campanha: fica fora da lista.
    const [{ data: accounts }, { data: running }] = await Promise.all([
      db.from('google_ads_accounts').select('customer_id, login_customer_id, connection_id, name, mcc_name, status').eq('user_id', user.id).eq('status', 'ENABLED').order('mcc_name').order('name').limit(2000),
      db.from('products').select('google_ads_customer_id, google_ads_campaign_name, name, status, mcc_name').eq('user_id', user.id).not('google_ads_customer_id', 'is', null).limit(5000),
    ]);
    // Campanhas rodando em cada conta, para não subir duas na mesma conta sem querer.
    // E a MCC como aparece na tela de Campanhas: uma conta que o Google também entrega por outro
    // gerenciador (ou direto) fica guardada com o nome desse outro, e sumiria do grupo certo.
    const active = new Map<string, string[]>(), mccOf = new Map<string, string>();
    for (const p of running || []) {
      const id = String(p.google_ads_customer_id).replace(/\D/g, '');
      if (p.mcc_name && !mccOf.has(id)) mccOf.set(id, p.mcc_name);
      if (p.status !== 'active') continue;
      if (!active.has(id)) active.set(id, []);
      active.get(id)!.push(p.google_ads_campaign_name || p.name || 'Campanha');
    }
    // Um nome só por gerenciador: o mais usado nas campanhas das contas dele (a tela de Campanhas escreve
    // "MCC TOPO 03" onde o Google diz "MCC Topo 03", e sem isso a mesma MCC viraria dois grupos).
    const votes = new Map<string, Map<string, number>>();
    for (const a of accounts || []) {
      const name = mccOf.get(a.customer_id);
      if (!name || !a.login_customer_id || a.login_customer_id === a.customer_id) continue;
      if (!votes.has(a.login_customer_id)) votes.set(a.login_customer_id, new Map());
      const v = votes.get(a.login_customer_id)!;
      v.set(name, (v.get(name) || 0) + 1);
    }
    const managerName = (login: string) => [...(votes.get(login) || new Map<string, number>()).entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const groupOf = (a: { customer_id: string; login_customer_id: string | null; mcc_name: string | null }) => (a.login_customer_id && a.login_customer_id !== a.customer_id
      ? managerName(a.login_customer_id) || a.mcc_name || `MCC ${a.login_customer_id}`
      : mccOf.get(a.customer_id) || a.mcc_name || 'Sem MCC');           // conta acessada direto: vale a MCC das campanhas dela
    const hiddenInGoogle = await hiddenAccounts(user.id, accounts || []).catch(() => ({ ids: new Set<string>(), calls: 0 }));
    if (hiddenInGoogle.calls) await addUsage(hiddenInGoogle.calls).catch(() => {});
    const visible = (accounts || []).filter(a => !hiddenInGoogle.ids.has(a.customer_id));
    return NextResponse.json({
      allowed: true,
      hidden_in_google: (accounts || []).length - visible.length,
      accounts: visible.map(a => ({
        id: a.customer_id, nome: a.name || `Conta ${a.customer_id}`,
        mcc: groupOf(a),
        ativas: active.get(a.customer_id) || [],
      })),
    });
  }

  const goalsOf = (q.get('metas') || '').replace(/\D/g, '');
  if (goalsOf) {
    const ctx = await accountContext(user.id, goalsOf);
    if (!ctx) return NextResponse.json({ allowed: true, error: 'Esta conta não está ligada, ou a ligação expirou. Reconecte em Integração.' }, { status: 409 });
    try {
      const rows = await search(ctx, 'SELECT custom_conversion_goal.id, custom_conversion_goal.name, custom_conversion_goal.status FROM custom_conversion_goal');
      await addUsage(1).catch(() => {});
      return NextResponse.json({ allowed: true, goals: rows.map(r => r.customConversionGoal || {}).filter(g => g.id && g.status !== 'REMOVED').map(g => ({ id: String(g.id), nome: g.name || `Meta ${g.id}` })) });
    } catch (e: any) {
      return NextResponse.json({ allowed: true, error: `O Google não respondeu: ${e.message}` }, { status: 502 });
    }
  }

  const productId = q.get('product_id');
  if (!productId) {
    const [{ data: products }, templates] = await Promise.all([
      db.from('products').select('id, name, google_ads_campaign_name, account_name, mcc_name, status').eq('user_id', user.id)
        .not('google_ads_campaign_id', 'is', null).not('google_ads_customer_id', 'is', null).order('name').limit(2000),
      db.from('campaign_templates').select('id, name, funnel, source_product_id, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(100)
        .then(r => (r.error ? null : r.data)),
    ]);
    return NextResponse.json({
      allowed: true,
      campaigns: (products || []).map(p => ({ id: p.id, name: p.google_ads_campaign_name || p.name, account: p.account_name || '', mcc: p.mcc_name || '', status: p.status || '' })),
      templates: templates || [], migration: templates === null,
    });
  }

  const access = await campaignAccess(user.id, productId);
  if ('error' in access) return NextResponse.json({ allowed: true, error: access.error }, { status: 409 });
  try {
    const { template, calls } = await readTemplate(access.ctx, access.campaignId);
    await addUsage(calls).catch(() => {});
    // Guarda como modelo. Antes de migration_criador.sql a tabela não existe: o modelo só aparece na tela.
    const { data: saved, error } = await db.from('campaign_templates').upsert({
      user_id: user.id, source_product_id: productId, name: template.origem.nome || 'Modelo', data: template, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,source_product_id' }).select('id, funnel, updated_at').maybeSingle();
    return NextResponse.json({ allowed: true, template, currency: access.currency, saved: error ? null : saved, migration: !!error });
  } catch (e: any) {
    return NextResponse.json({ allowed: true, error: `O Google não respondeu: ${e.message}` }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  if (!canEdit(user.email)) return NextResponse.json({ error: 'O criador de campanhas ainda não está liberado para este login.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));

  // Ensaio ou criação de UMA campanha em UMA conta. A tela chama uma vez por campanha do lançamento.
  if (body.action === 'criar') {
    const draft = body.draft as Draft, line = body.linha || {};
    const accountId = String(line.conta_id || '').replace(/\D/g, '');
    if (!draft?.grupos || !accountId) return NextResponse.json({ error: 'Pedido incompleto.' }, { status: 400 });
    const ctx = await accountContext(user.id, accountId);
    if (!ctx) return NextResponse.json({ error: 'Esta conta não está ligada, ou a ligação expirou. Reconecte em Integração.' }, { status: 409 });
    const ensaio = body.ensaio !== false;
    const name = String(line.nome || '').trim().slice(0, 250);
    try {
      const result = await createCampaign(ctx, draft, { url: String(line.url || '').trim(), nome: name, conta_id: accountId, meta_id: line.meta_id ? String(line.meta_id) : null }, ensaio);
      await addUsage(result.calls).catch(() => {});
      if (!ensaio) {
        await supabaseAdmin().from('google_ads_actions').insert({
          user_id: user.id, customer_id: accountId, campaign_id: result.campanha_id, action: 'criar', kind: 'campanha', target: name,
          new_status: result.ok ? 'PAUSED' : null, ok: result.ok, error: result.ok ? (result.avisos.join(' | ') || null) : result.problemas.map(p => `${p.onde}: ${p.texto}`).join(' | ').slice(0, 1000),
        }).then(() => null, () => null);
      }
      return NextResponse.json({ result });
    } catch (e: any) {
      return NextResponse.json({ result: { ok: false, ensaio, campanha_id: null, problemas: [{ onde: 'Google', texto: String(e.message).slice(0, 300) }], avisos: [], calls: 0, itens: 0 } });
    }
  }

  if (!aiEnabled()) return NextResponse.json({ error: 'A IA está desligada no servidor.' }, { status: 409 });
  const pageOf = async (url: any) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return '';
    return fetchPageText(u.split('?')[0]);
  };

  try {
    if (body.action === 'oferta') {
      const text = await pageOf(body.url);
      if (!text) return NextResponse.json({ error: 'Informe o endereço da página do produto, começando com https://' }, { status: 400 });
      return NextResponse.json({ offer: await extractOffer({ userId: user.id }, text) });
    }
    if (body.action === 'recursos') {
      const funil: Funnel = body.funil === 'fundo' ? 'fundo' : 'topo';
      const text = (v: any, max = 120) => String(v ?? '').trim().slice(0, max);
      if (funil === 'fundo') {
        const o = body.oferta || {};
        if (!text(o.produto)) return NextResponse.json({ error: 'Informe o nome do produto.' }, { status: 400 });
        const offer: Offer = {
          produto: text(o.produto, 60), idioma: text(o.idioma, 40) || 'inglês', pais: text(o.pais, 40) || 'US', moeda: text(o.moeda, 10) || 'USD',
          formato_moeda: text(o.formato_moeda, 40) || undefined, preco: text(o.preco, 30), preco_original: text(o.preco_original, 30),
          desconto_valor: text(o.desconto_valor, 30), desconto_pct: text(o.desconto_pct, 10),
          frete: ['gratis', 'rapido', 'imediato', 'expresso'].includes(o.frete) ? o.frete : '', garantia_dias: Number(o.garantia_dias) > 0 ? Math.round(Number(o.garantia_dias)) : null,
          oficial: o.oficial === true, variacoes: (Array.isArray(o.variacoes) ? o.variacoes : [0]).map(Number).filter((n: number) => n >= 0 && n <= 9).slice(0, 9),
        };
        return NextResponse.json({ pack: await generateResources({ userId: user.id }, 'fundo', offer) });
      }
      const t = body.topo || {};
      const page = await pageOf(t.url).catch(() => '');
      const list = (v: any, max: number) => (Array.isArray(v) ? v : []).map(x => text(x, 80)).filter(Boolean).slice(0, max);
      return NextResponse.json({
        page_read: !!page,
        pack: await generateResources({ userId: user.id }, 'topo', {
          idioma: text(t.idioma, 40) || 'inglês', pais: text(t.pais, 60) || 'Estados Unidos', grupos: [],
          palavras: list(t.palavras, 30), termos: list(t.termos, 40), pagina: page, vsl: text(t.vsl, 20000),
        }),
      });
    }
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'A IA não respondeu. Tente de novo.' }, { status: 502 });
  }
}
