import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { syncAccountRecord, isDue, usageToday, DAILY_QUOTA } from '@/lib/googleAds/sync';
import { refreshConnectionAccounts } from '@/lib/googleAds/accounts';
import { isReconcileDue, reconcileAccountRecord, reconcileReady } from '@/lib/googleAds/reconcile';

// A coleta demora mais que o padrão de uma rota comum.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TIME_BUDGET_MS = (Number(process.env.GOOGLE_ADS_SYNC_BUDGET_SEC) || 50) * 1000;
const DISCOVERY_INTERVAL_MIN = 6 * 60;

function isCron(request: Request): boolean {
  const secret = process.env.GOOGLE_ADS_CRON_SECRET;
  if (!secret) return false;
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Agendador (pg_cron do Supabase, a cada 5 minutos).
 *
 * Cada chamada tem ~50s: pega as contas mais atrasadas que já venceram o
 * intervalo e para quando o tempo acaba. As que sobrarem saem na próxima
 * chamada — assim nenhum pedido estoura o tempo limite do proxy.
 */
async function runCron() {
  const db = supabaseAdmin();
  const started = Date.now();
  const report: any = { discovery: [], synced: [], skipped_not_due: 0 };

  const { data: conns } = await db.from('google_ads_connections')
    .select('id, user_id, refresh_token_enc, last_discovery_at').eq('status', 'ok');
  for (const c of conns || []) {
    const age = c.last_discovery_at ? (Date.now() - new Date(c.last_discovery_at).getTime()) / 60000 : Infinity;
    if (age < DISCOVERY_INTERVAL_MIN) continue;
    try {
      const r = await refreshConnectionAccounts(c);
      report.discovery.push({ connection: c.id, accounts: r.accounts.length });
    } catch (e: any) {
      report.discovery.push({ connection: c.id, error: e.message });
      await db.from('google_ads_connections').update({ last_error: e.message }).eq('id', c.id);
    }
  }

  // Cota do dia: acima de 80% só custo e status; acima de 95% para tudo até
  // a virada (meia-noite do Pacífico). O botão "Sincronizar" continua valendo.
  let used = await usageToday();
  report.quota = { used, limit: DAILY_QUOTA };
  if (used >= DAILY_QUOTA * 0.95) {
    report.quota.paused = true;
    report.elapsed_ms = Date.now() - started;
    return report;
  }

  const okConnections = new Set((conns || []).map(c => c.id));
  const { data: accounts } = await db.from('google_ads_accounts')
    .select('*').eq('sync_enabled', true)
    .order('last_sync_at', { ascending: true, nullsFirst: true });

  for (const acc of accounts || []) {
    if (!okConnections.has(acc.connection_id)) continue;
    if (!isDue(acc)) { report.skipped_not_due++; continue; }
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (used >= DAILY_QUOTA * 0.95) { report.quota.paused = true; break; }
    const result = await syncAccountRecord(acc, { allowDeep: used < DAILY_QUOTA * 0.8 });
    report.synced.push(result);
    used += 'api_calls' in result ? result.api_calls : 2;
  }
  // Conferência diária com o Google (Etapa 0): no tempo que sobrou, as contas
  // que não foram conferidas nas últimas 24h. Duas consultas cada.
  report.reconciled = [];
  const canReconcile = await reconcileReady();
  for (const acc of canReconcile ? accounts || [] : []) {
    if (!okConnections.has(acc.connection_id)) continue;
    const status = String(acc.status || '').toUpperCase();
    if (status && status !== 'ENABLED' && status !== 'UNKNOWN') continue;
    if (!isReconcileDue(acc)) continue;
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (used >= DAILY_QUOTA * 0.8) break;
    const result = await reconcileAccountRecord(acc);
    report.reconciled.push({ account: acc.name, ...result });
    used += 'api_calls' in result ? result.api_calls : 2;
  }

  report.quota.used = used;
  report.elapsed_ms = Date.now() - started;
  return report;
}

export async function GET(request: Request) {
  if (!isCron(request)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  return NextResponse.json(await runCron());
}

/**
 * Com a chave do agendador: mesmo que o GET.
 * Com o login do painel: sincroniza a conta pedida agora, com diagnóstico
 * completo (botão "Sincronizar agora").
 */
export async function POST(request: Request) {
  if (isCron(request)) return NextResponse.json(await runCron());

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const { account_id } = await request.json().catch(() => ({}));
  if (!account_id) return NextResponse.json({ error: 'Informe a conta.' }, { status: 400 });

  const { data: acc } = await supabaseAdmin().from('google_ads_accounts')
    .select('*').eq('id', account_id).eq('user_id', user.id).single();
  if (!acc) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

  const result = await syncAccountRecord(acc, { forceDeep: true });
  return NextResponse.json(result, { status: 'error' in result ? 502 : 200 });
}
