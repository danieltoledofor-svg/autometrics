import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';

/** Liga/desliga a coleta de uma conta. */
export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const { id, sync_enabled } = await request.json().catch(() => ({}));
  if (!id || typeof sync_enabled !== 'boolean') {
    return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
  }
  const { error } = await supabaseAdmin().from('google_ads_accounts')
    .update({ sync_enabled }).eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
