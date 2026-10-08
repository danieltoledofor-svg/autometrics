import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser, encryptSecret, decryptSecret } from '@/lib/googleAds/server';
import { cardGroups as allCardGroups, plainLootrushError } from '@/lib/lootrush/client';
import { lootrushCheck, syncLootrush } from '@/lib/lootrush/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * LootRush (banco dos cartões): cada usuário liga a própria chave, só de leitura,
 * e escolhe os grupos de cartões que quer acompanhar.
 *
 * GET                          situação da ligação e os grupos escolhidos
 * GET ?grupos=1                grupos de cartões que a chave enxerga na LootRush
 * GET ?from=AAAA-MM-DD&to=…    conferência do período: cobrado no cartão × gasto no Google, por conta
 * POST { action: 'ligar', key }        confere a chave na LootRush e guarda criptografada
 * POST { action: 'grupos', groups }    escolhe os grupos e faz a primeira leitura
 * POST { action: 'ler' }               lê agora, sem esperar o agendador
 * POST { action: 'desligar' }          apaga a chave e as cobranças guardadas
 */

/**
 * A mesma chave serve aos dois logins do dono, mas cada login acompanha só o grupo dele:
 * o outro grupo nem aparece para escolher. Os demais usuários veem todos os grupos da própria chave.
 */
const GROUP_LOCK: Record<string, string[]> = {
  'dcalmeida431@gmail.com': ['topo de funil'],
  'daniel.camiloalm@gmail.com': ['cristiane'],
};
async function cardGroups(key: string, email?: string) {
  const lock = GROUP_LOCK[String(email || '').toLowerCase()];
  const groups = await allCardGroups(key);
  return lock ? groups.filter(g => lock.includes(g.name.trim().toLowerCase())) : groups;
}

const MISSING = 'Falta rodar migration_lootrush.sql no Supabase.';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function connection(userId: string) {
  const { data, error } = await supabaseAdmin().from('lootrush_connections').select('*').eq('user_id', userId).maybeSingle();
  return { conn: data, missing: !!error };
}
const publicStatus = (conn: any) => ({
  connected: !!conn, groups: conn?.groups || [], status: conn?.status || null, last_error: conn?.last_error || null,
  last_sync_at: conn?.last_sync_at || null, ready: !!conn?.baseline_at,
});

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const { conn, missing } = await connection(user.id);
  if (missing) return NextResponse.json({ connected: false, migration: true, error: MISSING });

  if (q.get('grupos')) {
    if (!conn) return NextResponse.json({ error: 'Ligue a LootRush primeiro.' }, { status: 409 });
    try { return NextResponse.json({ available: await cardGroups(decryptSecret(conn.key_enc), user.email), ...publicStatus(conn) }); }
    catch (e: any) { return NextResponse.json({ error: plainLootrushError(e) }, { status: 502 }); }
  }

  const from = q.get('from') || '', to = q.get('to') || '';
  if (from || to) {
    if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
    if (!conn) return NextResponse.json({ ...publicStatus(conn), check: null });
    try { return NextResponse.json({ ...publicStatus(conn), check: await lootrushCheck(user.id, from, to) }); }
    catch (e: any) { return NextResponse.json({ ...publicStatus(conn), error: e.message }, { status: 500 }); }
  }
  return NextResponse.json(publicStatus(conn));
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const db = supabaseAdmin();
  const fail = (error: string, code = 400) => NextResponse.json({ error }, { status: code });
  const now = new Date().toISOString();

  if (body.action === 'ligar') {
    const key = String(body.key || '').trim();
    if (key.length < 20 || /\s/.test(key)) return fail('Cole a chave inteira da LootRush, sem espaços.');
    let available;
    try { available = await cardGroups(key, user.email); } catch (e: any) { return fail(plainLootrushError(e), 502); }
    // Chave nova no lugar da antiga: os grupos escolhidos continuam, se ainda existirem.
    const { conn, missing } = await connection(user.id);
    if (missing) return fail(MISSING, 409);
    const kept = (conn?.groups || []).filter((g: any) => available.some(a => a.id === g.id));
    const { data, error } = await db.from('lootrush_connections').upsert({
      user_id: user.id, key_enc: encryptSecret(key), groups: kept, status: 'ok', last_error: null, updated_at: now,
    }, { onConflict: 'user_id' }).select('*').maybeSingle();
    if (error) return fail(/lootrush_connections/.test(error.message) ? MISSING : error.message, 500);
    return NextResponse.json({ ...publicStatus(data), available });
  }

  const { conn, missing } = await connection(user.id);
  if (missing) return fail(MISSING, 409);

  if (body.action === 'desligar') {
    await db.from('lootrush_charges').delete().eq('user_id', user.id);
    await db.from('lootrush_connections').delete().eq('user_id', user.id);
    return NextResponse.json(publicStatus(null));
  }
  if (!conn) return fail('Ligue a LootRush primeiro.', 409);

  if (body.action === 'grupos') {
    const wanted = new Set((Array.isArray(body.groups) ? body.groups : []).map(String));
    let available;
    try { available = await cardGroups(decryptSecret(conn.key_enc), user.email); } catch (e: any) { return fail(plainLootrushError(e), 502); }
    const groups = available.filter(g => wanted.has(g.id)).map(g => ({ id: g.id, name: g.name }));
    // Grupo que saiu da escolha leva as cobranças guardadas dele; a leitura recomeça do zero para os que ficaram.
    const keep = groups.map(g => g.id);
    const drop = db.from('lootrush_charges').delete().eq('user_id', user.id);
    await (keep.length ? drop.not('group_id', 'in', `(${keep.map(id => `"${id}"`).join(',')})`) : drop);
    const { data, error } = await db.from('lootrush_connections').update({ groups, baseline_at: null, updated_at: now }).eq('user_id', user.id).select('*').maybeSingle();
    if (error || !data) return fail(error?.message || 'Não foi possível gravar.', 500);
    const result = await syncLootrush(data);
    const fresh = await connection(user.id);
    return NextResponse.json({ ...publicStatus(fresh.conn), available, result });
  }

  if (body.action === 'ler') {
    const result = await syncLootrush(conn);
    const fresh = await connection(user.id);
    return NextResponse.json({ ...publicStatus(fresh.conn), result });
  }
  return fail('Ação desconhecida.');
}
