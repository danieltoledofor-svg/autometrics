import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser, decryptSecret } from '@/lib/googleAds/server';
import { setCampaignStatus, search } from '@/lib/googleAds/client';
import { resolveEffectiveStatus } from '@/lib/campaignStatus';

/**
 * Pausa ou ativa uma campanha direto no Google Ads.
 *
 * Mexe em dinheiro de verdade: confere que o produto é do usuário, confirma
 * no Google o status que ficou valendo e registra cada tentativa em
 * google_ads_actions.
 */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });

  const { product_id, status } = await request.json().catch(() => ({}));
  if (!product_id || (status !== 'ENABLED' && status !== 'PAUSED')) {
    return NextResponse.json({ error: 'Informe a campanha e o status (ENABLED ou PAUSED).' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: product } = await db.from('products')
    .select('id, name, user_id, google_ads_campaign_id, google_ads_customer_id, account_name, google_status')
    .eq('id', product_id).eq('user_id', user.id).single();
  if (!product) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

  const campaignId = product.google_ads_campaign_id;
  if (!campaignId || campaignId === 'undefined') {
    return NextResponse.json({ error: 'Esta campanha não tem ID do Google Ads.' }, { status: 400 });
  }

  // Conta dona da campanha: gravada pela coleta da API; para produtos que só
  // vieram pelo script, cai no nome da conta.
  let accQuery = db.from('google_ads_accounts')
    .select('customer_id, login_customer_id, connection_id, name').eq('user_id', user.id);
  accQuery = product.google_ads_customer_id
    ? accQuery.eq('customer_id', product.google_ads_customer_id)
    : accQuery.eq('name', product.account_name);
  const { data: accounts } = await accQuery.limit(2);
  if (!accounts?.length) {
    return NextResponse.json({ error: 'A conta desta campanha não está conectada pela API do Google Ads. Conecte em Integração.' }, { status: 409 });
  }
  if (accounts.length > 1) {
    return NextResponse.json({ error: `Há mais de uma conta chamada "${product.account_name}". Rode uma sincronização pela API para identificar a conta certa.` }, { status: 409 });
  }
  const acc = accounts[0];

  const { data: conn } = await db.from('google_ads_connections')
    .select('refresh_token_enc').eq('id', acc.connection_id).single();
  if (!conn) return NextResponse.json({ error: 'Conexão com o Google não encontrada.' }, { status: 409 });

  const ctx = { refreshToken: decryptSecret(conn.refresh_token_enc), customerId: acc.customer_id, loginCustomerId: acc.login_customer_id };
  const log = (ok: boolean, extra: Record<string, any>) => db.from('google_ads_actions').insert({
    user_id: user.id, product_id: product.id, customer_id: acc.customer_id, campaign_id: campaignId,
    action: status === 'PAUSED' ? 'pausar' : 'ativar', new_status: status, ok, ...extra,
  });

  try {
    const [before] = await search(ctx, `SELECT campaign.status FROM campaign WHERE campaign.id = ${Number(campaignId)}`);
    if (!before) {
      await log(false, { error: 'Campanha não encontrada na conta' });
      return NextResponse.json({ error: `Campanha ${campaignId} não encontrada na conta ${acc.name}.` }, { status: 404 });
    }
    const previous = before.campaign?.status || null;
    if (previous === 'REMOVED') {
      await log(false, { previous_status: previous, error: 'Campanha removida' });
      return NextResponse.json({ error: 'Campanha removida no Google Ads não pode ser reativada.' }, { status: 409 });
    }

    if (previous !== status) await setCampaignStatus(ctx, campaignId, status);

    // Confirma no Google em vez de supor que deu certo, e já pega o status
    // de veiculação para o painel não mostrar "Ativo" numa campanha que o
    // Google segura por outro motivo.
    const [after] = await search(ctx, `
      SELECT campaign.status, campaign.serving_status, campaign.primary_status, campaign.primary_status_reasons
      FROM campaign WHERE campaign.id = ${Number(campaignId)}`);
    const c = after?.campaign || {};
    const effective = resolveEffectiveStatus({ status: c.status, servingStatus: c.servingStatus, primaryStatus: c.primaryStatus });
    const reasons = (c.primaryStatusReasons || []).join(',') || null;

    await db.from('products').update({
      status: c.status === 'ENABLED' ? 'active' : 'paused',
      google_status: effective,
      google_status_reasons: reasons,
      // google_status_date fica como está: a data do servidor (UTC) pode estar
      // um dia à frente do fuso da conta e travaria as próximas coletas.
      google_ads_customer_id: acc.customer_id,
    }).eq('id', product.id);
    await log(c.status === status, { previous_status: previous, confirmed_status: c.status });

    return NextResponse.json({ success: c.status === status, status: c.status, effective_status: effective, reasons });
  } catch (e: any) {
    await log(false, { error: String(e.message).slice(0, 1000) });
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
