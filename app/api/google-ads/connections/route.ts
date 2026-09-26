import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser, decryptSecret } from '@/lib/googleAds/server';
import { revokeToken } from '@/lib/googleAds/client';
import { refreshConnectionAccounts } from '@/lib/googleAds/accounts';
import { usageToday, DAILY_QUOTA } from '@/lib/googleAds/sync';

/** Conexões e contas do usuário — nunca devolve o token. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const db = supabaseAdmin();

  const { data: connections, error } = await db.from('google_ads_connections')
    .select('id, google_email, status, last_error, last_discovery_at, created_at')
    .eq('user_id', user.id).order('created_at');
  if (error) {
    const missing = /relation .* does not exist|google_ads_connections/.test(error.message);
    return NextResponse.json({ error: missing ? 'Tabelas da integração ainda não criadas — rode migration_google_ads_api.sql no Supabase.' : error.message, setup_required: missing }, { status: 500 });
  }

  const cols = 'id, connection_id, customer_id, login_customer_id, name, mcc_name, currency_code, time_zone, status, sync_enabled, last_sync_at, last_sync_status, last_sync_error, last_sync_summary';
  let { data: accounts, error: accError } = await db.from('google_ads_accounts')
    .select(`${cols}, last_reconciled_at, last_reconcile_status, last_reconcile_summary`)
    .eq('user_id', user.id).order('mcc_name').order('name');
  // Antes de migration_conferencia.sql as colunas da conferência não existem.
  if (accError) {
    ({ data: accounts } = await db.from('google_ads_accounts').select(cols)
      .eq('user_id', user.id).order('mcc_name').order('name') as any);
  }

  // Cota é do projeto do Google Cloud, não do usuário — mas quem vê esta tela
  // é quem administra o Autometrics.
  const used = await usageToday().catch(() => 0);

  return NextResponse.json({
    quota: { used, limit: DAILY_QUOTA },
    configured: Boolean(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && process.env.GOOGLE_ADS_TOKEN_KEY),
    connections: connections || [],
    accounts: accounts || [],
  });
}

/** Relê a lista de contas de uma conexão (conta nova, MCC nova, suspensão). */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  const { data: conn } = await supabaseAdmin().from('google_ads_connections')
    .select('id, user_id, refresh_token_enc').eq('id', id).eq('user_id', user.id).single();
  if (!conn) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  try {
    const result = await refreshConnectionAccounts(conn);
    return NextResponse.json({ accounts: result.accounts.length, errors: result.errors });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** Desconecta: revoga no Google e apaga token e contas. Os dados já coletados ficam. */
export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  const db = supabaseAdmin();
  const { data: conn } = await db.from('google_ads_connections')
    .select('id, refresh_token_enc').eq('id', id).eq('user_id', user.id).single();
  if (!conn) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  try { await revokeToken(decryptSecret(conn.refresh_token_enc)); } catch { /* segue apagando */ }
  const { error } = await db.from('google_ads_connections').delete().eq('id', conn.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
