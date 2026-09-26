import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { reconcileAccountRecord, reconcileReady } from '@/lib/googleAds/reconcile';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * Botão "Conferir agora": compara a conta com o Google na hora, sem esperar a
 * conferência diária. { account_id } — ou { all: true } para todas as contas
 * que o usuário coleta.
 */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const { account_id, all } = await request.json().catch(() => ({}));
  if (!account_id && !all) return NextResponse.json({ error: 'Informe a conta.' }, { status: 400 });
  if (!(await reconcileReady())) return NextResponse.json({ error: 'Rode migration_conferencia.sql no Supabase para ligar a conferência.' }, { status: 409 });

  let query = supabaseAdmin().from('google_ads_accounts').select('*').eq('user_id', user.id).eq('sync_enabled', true);
  if (account_id) query = query.eq('id', account_id);
  const { data: accounts } = await query;
  if (!accounts?.length) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

  const results = [];
  for (const acc of accounts) {
    const status = String(acc.status || '').toUpperCase();
    if (status && status !== 'ENABLED' && status !== 'UNKNOWN') continue;
    results.push({ account: acc.name, account_id: acc.id, ...(await reconcileAccountRecord(acc)) });
  }
  return NextResponse.json({ results });
}
