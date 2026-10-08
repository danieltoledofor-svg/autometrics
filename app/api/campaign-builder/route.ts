import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { addUsage } from '@/lib/googleAds/sync';
import { campaignAccess, canEdit } from '@/lib/googleAds/edit';
import { readTemplate } from '@/lib/campaignBuilder/template';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Criador de campanhas (por enquanto só a leitura do modelo).
 *
 * GET                      campanhas do usuário ligadas ao Google e os modelos já lidos
 * GET ?product_id=…        lê a campanha inteira do Google e guarda como modelo
 * GET ?template=<id>       devolve um modelo guardado, sem consultar o Google
 *
 * Só para os logins liberados (lib/googleAds/edit).
 */
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
