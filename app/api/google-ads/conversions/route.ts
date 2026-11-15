import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser, decryptSecret } from '@/lib/googleAds/server';
import { canSendSales } from '@/lib/googleAds/client';
import { DEFAULT_ACTION } from '@/lib/googleAds/conversionUpload';
import { STEPS, stepValues } from '@/lib/googleAds/stepUpload';

export const dynamic = 'force-dynamic';

/**
 * Envio das vendas ao Google pelo clique: o liga/desliga de cada usuário e o
 * que já foi enviado. O envio em si roda no agendador
 * (lib/googleAds/conversionUpload).
 *
 * GET   estado, totais dos últimos 30 dias e os últimos envios
 * POST  { enabled }   liga (valem as vendas feitas a partir de agora) ou desliga
 * POST  { steps }     liga ou desliga o envio das etapas (checkout, 10 min no site)
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
  // Cada e-mail do Google ligado, e se já tem a autorização de enviar vendas.
  const { data: conns } = await db.from('google_ads_connections').select('google_email, refresh_token_enc, status').eq('user_id', userId).order('google_email');
  const emails = await Promise.all((conns || []).map(async c => {
    if (c.status !== 'ok') return { email: c.google_email, authorized: false, note: 'A ligação com o Google expirou. Reconecte na aba Google Ads da Integração.' };
    try { return { email: c.google_email, authorized: await canSendSales(decryptSecret(c.refresh_token_enc)), note: '' }; }
    catch (e: any) { return { email: c.google_email, authorized: false, note: e.message || 'Não foi possível conferir.' }; }
  }));
  const { count: accounts } = await db.from('google_ads_accounts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  // Etapas do funil: antes de migration_envio_etapas.sql a coluna e a tabela não existem.
  let steps: any = { ready: false };
  const stepsReady = settings ? 'steps_enabled' in settings : !(await db.from('google_conversion_settings').select('steps_enabled').limit(1)).error;
  if (stepsReady) {
    const { data: rows } = await db.from('google_step_uploads').select('step, status').eq('user_id', userId).gte('created_at', since).limit(10000);
    const count: Record<string, Record<string, number>> = {};
    for (const r of rows || []) { count[r.step] ||= {}; count[r.step][r.status] = (count[r.step][r.status] || 0) + 1; }
    const values = await stepValues(db, userId).catch(() => null);
    steps = {
      ready: true, enabled: !!settings?.steps_enabled, start_at: settings?.steps_start_at || null,
      list: (Object.keys(STEPS) as (keyof typeof STEPS)[]).map(k => ({ key: k, label: STEPS[k].label, action: STEPS[k].name,
        value: values?.[k].value ?? STEPS[k].fallback, clicks: values?.[k].clicks ?? 0, sales: values?.[k].sales ?? 0, totals: count[k] || {} })),
    };
  }
  return {
    ready: true,
    enabled: !!settings?.enabled,
    action_name: settings?.action_name || DEFAULT_ACTION,
    start_at: settings?.start_at || null,
    accounts: accounts || 0,
    emails,
    // Alguma venda parou por falta da permissão de envio: a tela pede para autorizar.
    needs_auth: (uploads || []).some(u => u.status === 'aguardando' && u.error_code === 'SEM_PERMISSAO'),
    steps,
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
  // Etapas do funil: liga ou desliga sem mexer no envio das vendas.
  if ('steps' in body) {
    const { data: current, error: readError } = await db.from('google_conversion_settings').select('steps_enabled').eq('user_id', user.id).maybeSingle();
    if (readError) return NextResponse.json({ error: 'Rode migration_envio_etapas.sql no Supabase.' }, { status: 400 });
    const row: Record<string, any> = { user_id: user.id, steps_enabled: !!body.steps, updated_at: new Date().toISOString() };
    if (body.steps && !current?.steps_enabled) row.steps_start_at = row.updated_at;
    const { error } = await db.from('google_conversion_settings').upsert(row, { onConflict: 'user_id' });
    if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 });
    return NextResponse.json(await state(user.id));
  }
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
