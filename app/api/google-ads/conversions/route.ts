import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { DEFAULT_ACTION } from '@/lib/googleAds/conversionUpload';

export const dynamic = 'force-dynamic';

/**
 * Envio das vendas ao Google pelo clique: o liga/desliga de cada usuário e o
 * que já foi enviado. O envio em si roda no agendador
 * (lib/googleAds/conversionUpload).
 *
 * GET   estado, totais dos últimos 30 dias e os últimos envios
 * POST  { enabled }   liga (valem as vendas feitas a partir de agora) ou desliga
 */

async function state(userId: string) {
  const db = supabaseAdmin();
  const { data: settings, error } = await db.from('google_conversion_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) return { ready: false };
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: uploads } = await db.from('google_conversion_uploads')
    .select('status, reason, error_code, amount, currency, conversion_at, sent_at, next_try_at, product_id')
    .eq('user_id', userId).gte('created_at', since).order('conversion_at', { ascending: false }).limit(1000);
  const totals = { enviada: 0, aguardando: 0, falhou: 0, ignorada: 0 } as Record<string, number>;
  for (const u of uploads || []) totals[u.status] = (totals[u.status] || 0) + 1;
  const last = (uploads || []).slice(0, 15);
  const ids = [...new Set(last.map(u => u.product_id).filter(Boolean))];
  const { data: products } = ids.length ? await db.from('products').select('id, name, google_ads_campaign_name').in('id', ids) : { data: [] as any[] };
  const nameOf = new Map((products || []).map(p => [p.id, p.google_ads_campaign_name || p.name]));
  const { count: accounts } = await db.from('google_ads_accounts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return {
    ready: true,
    enabled: !!settings?.enabled,
    action_name: settings?.action_name || DEFAULT_ACTION,
    start_at: settings?.start_at || null,
    accounts: accounts || 0,
    // Alguma venda parou por falta da permissão de envio: a tela pede para autorizar.
    needs_auth: (uploads || []).some(u => u.status === 'aguardando' && u.error_code === 'SEM_PERMISSAO'),
    totals,
    last: last.map(u => ({ ...u, campaign: nameOf.get(u.product_id) || '' })),
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  return NextResponse.json(await state(user.id));
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const db = supabaseAdmin();
  const enabled = !!body.enabled;
  const { data: current, error: readError } = await db.from('google_conversion_settings').select('enabled').eq('user_id', user.id).maybeSingle();
  if (readError) return NextResponse.json({ error: 'Rode migration_envio_google.sql no Supabase.' }, { status: 400 });
  const row: Record<string, any> = { user_id: user.id, enabled, updated_at: new Date().toISOString() };
  // Ao ligar, só as vendas dali em diante: o que já foi contado por outro caminho não é reenviado.
  if (enabled && !current?.enabled) row.start_at = row.updated_at;
  const { error } = await db.from('google_conversion_settings').upsert(row, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 });
  return NextResponse.json(await state(user.id));
}
