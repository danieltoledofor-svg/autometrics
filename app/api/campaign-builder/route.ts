import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { addUsage } from '@/lib/googleAds/sync';
import { campaignAccess, canEdit } from '@/lib/googleAds/edit';
import { readTemplate } from '@/lib/campaignBuilder/template';
import { search, suggestLocations, type AdsContext } from '@/lib/googleAds/client';
import { languageName } from '@/lib/campaignBuilder/names';
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
 * GET ?contas=1            contas do usuário ligadas ao Google, com a MCC de cada uma
 * GET ?metas=<conta>       metas de conversão personalizadas que aquela conta enxerga
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
    const { data: accounts } = await db.from('google_ads_accounts').select('customer_id, login_customer_id, name, mcc_name, status').eq('user_id', user.id).order('mcc_name').order('name').limit(2000);
    return NextResponse.json({
      allowed: true,
      accounts: (accounts || []).map(a => ({ id: a.customer_id, nome: a.name || `Conta ${a.customer_id}`, mcc: a.mcc_name || (a.login_customer_id && a.login_customer_id !== a.customer_id ? `MCC ${a.login_customer_id}` : 'Sem MCC'), status: a.status || '' })),
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
