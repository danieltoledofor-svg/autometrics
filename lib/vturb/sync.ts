import { supabaseAdmin } from '@/lib/googleAds/server';
import { addDays, loadProduct, todayIn } from '@/lib/analysis/compute';
import { vturb, vturbToken, listPlayers, playerIdFrom, decodeTerm, type VturbPlayer } from './client';

/**
 * Coleta da VTurb para o banco, uma vez por hora por campanha com player.
 *
 * Por rodada:
 * - números por dia dos últimos 8 dias (1 consulta);
 * - os mesmos números por utm_term (1 consulta);
 * - uma linha por gclid de hoje e de ontem, mais até 3 dias antigos que ainda
 *   não têm (1 consulta por dia) — é o que liga visita e venda à palavra-chave;
 * - curva de retenção dos 7 dias fechados, 1 vez por dia (1 consulta).
 *
 * As datas seguem o fuso da conta do Google, para bater com os cliques.
 */

const INTERVAL_MIN = Number(process.env.VTURB_INTERVAL_MIN) || 60;
const DAYS_BACK = 8;
const RETENTION_MAX_AGE_MS = 20 * 60 * 60 * 1000;
const GCLID_BACKFILL_PER_RUN = 3;

const playerCache = new Map<string, { at: number; players: VturbPlayer[] }>();
async function playersFor(token: string) {
  const hit = playerCache.get(token);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.players;
  const players = await listPlayers(token);
  playerCache.set(token, { at: Date.now(), players });
  return players;
}

const int = (v: any) => Math.round(Number(v) || 0);
const stats = (r: any) => ({
  viewed: int(r.total_viewed_session_uniq),
  started: int(r.total_started_session_uniq),
  over_pitch: int(r.total_over_pitch),
  under_pitch: int(r.total_under_pitch),
  conversions: int(r.total_conversions),
});

async function upsertChunks(table: string, rows: any[], onConflict: string) {
  const db = supabaseAdmin();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** "% ainda assistindo" a cada 30 s, a partir de quantos saíram em cada segundo. */
export function retentionCurve(grouped: { timed: number; total_users: number }[], duration: number): [number, number][] {
  const total = grouped.reduce((s, g) => s + (Number(g.total_users) || 0), 0);
  if (!total) return [];
  const sorted = [...grouped].sort((a, b) => a.timed - b.timed);
  const out: [number, number][] = [];
  let gone = 0, i = 0;
  for (let t = 0; t <= duration; t += 30) {
    while (i < sorted.length && sorted[i].timed < t) gone += Number(sorted[i++].total_users) || 0;
    out.push([t, Math.round(((total - gone) / total) * 1000) / 10]);
  }
  return out;
}

export async function syncProductVturb(productId: string, opts: { force?: boolean } = {}) {
  const db = supabaseAdmin();
  const loaded = await loadProduct(productId);
  if (!loaded) return { error: 'Campanha não encontrada' };
  const { product, timeZone } = loaded;
  const playerId = playerIdFrom(product.vturb_player_id);
  const fail = async (error: string) => {
    await db.from('products').update({ vturb_synced_at: new Date().toISOString(), vturb_sync_error: error }).eq('id', productId);
    return { error };
  };
  if (!playerId) return fail('Nenhum player vinculado.');
  const token = await vturbToken(String(product.user_id));
  if (!token) return fail('Salve o token da VTurb em Integração → VTurb.');

  let calls = 0;
  const call = (endpoint: string, body: Record<string, any>) => { calls++; return vturb(token, endpoint, body); };
  try {
    calls++;
    const player = (await playersFor(token)).find(p => p.id === playerId);
    if (!player) return fail('Player não encontrado na conta da VTurb deste token.');
    const tz = timeZone || 'America/Sao_Paulo';
    const today = todayIn(tz);
    const start = addDays(today, -(DAYS_BACK - 1));
    const base = {
      player_id: playerId, start_date: `${start} 00:00:00`, end_date: `${today} 23:59:59`, timezone: tz,
      video_duration: player.duration, ...(player.pitch_time ? { pitch_time: player.pitch_time } : {}),
    };
    const inRange = (d: string) => d >= start && d <= today;
    const now = new Date().toISOString();

    // 1. Por dia.
    const byDay = await call('sessions/stats_by_day', base);
    const dailyRows = (Array.isArray(byDay) ? byDay : []).filter((r: any) => inRange(String(r.date_key))).map((r: any) => ({
      product_id: productId, player_id: playerId, date: r.date_key, ...stats(r),
      finished: int(r.total_finished_session_uniq), clicked: int(r.total_clicked_session_uniq),
      amount_usd: Math.round(Number(r.total_amount_usd) || 0) / 100, updated_at: now,
    }));
    await upsertChunks('vturb_daily', dailyRows, 'product_id,player_id,date');

    // 2. Por utm_term. Termos que decodificam igual somam numa linha só.
    const byTerm = await call('traffic_origin/stats_by_day', { ...base, query_keys: ['utm_term'] });
    const terms = new Map<string, any>();
    for (const r of Array.isArray(byTerm) ? byTerm : []) {
      if (r.query_key !== 'utm_term' || !inRange(String(r.date_key))) continue;
      const term = decodeTerm(r.grouped_field);
      if (!term || /^\{.*\}$/.test(term)) continue; // {keyword} sem substituir
      const k = `${r.date_key}|${term}`;
      const cur = terms.get(k) || { product_id: productId, player_id: playerId, date: r.date_key, term, viewed: 0, started: 0, over_pitch: 0, under_pitch: 0, conversions: 0, updated_at: now };
      const s = stats(r);
      for (const f of ['viewed', 'started', 'over_pitch', 'under_pitch', 'conversions'] as const) cur[f] += s[f];
      terms.set(k, cur);
    }
    await upsertChunks('vturb_daily_by_term', [...terms.values()], 'product_id,player_id,date,term');

    // 3. Por gclid: hoje, ontem e dias antigos que ainda faltam.
    const { data: haveGclid } = await db.from('vturb_gclid').select('date').eq('product_id', productId).eq('player_id', playerId).gte('date', start);
    const have = new Set((haveGclid || []).map(r => String(r.date)));
    const gclidDays = [today, addDays(today, -1)];
    for (const r of [...dailyRows].reverse()) {
      if (gclidDays.length >= 2 + GCLID_BACKFILL_PER_RUN) break;
      if (r.viewed > 0 && !have.has(r.date) && !gclidDays.includes(r.date)) gclidDays.push(r.date);
    }
    for (const day of gclidDays) {
      const rows = await call('traffic_origin/stats', { ...base, start_date: `${day} 00:00:00`, end_date: `${day} 23:59:59`, query_key: 'gclid' });
      const out = (Array.isArray(rows) ? rows : []).filter((r: any) => r.grouped_field).map((r: any) => ({
        product_id: productId, player_id: playerId, date: day, gclid: String(r.grouped_field), ...stats(r), updated_at: now,
      }));
      await upsertChunks('vturb_gclid', out, 'product_id,player_id,date,gclid');
    }

    // 4. Retenção dos 7 dias fechados, 1 vez por dia.
    const { data: ret } = await db.from('vturb_retention').select('updated_at, end_date').eq('product_id', productId).eq('player_id', playerId).maybeSingle();
    const retEnd = addDays(today, -1), retStart = addDays(today, -7);
    const retStale = !ret || String(ret.end_date) !== retEnd || Date.now() - new Date(ret.updated_at).getTime() > RETENTION_MAX_AGE_MS;
    if ((retStale || opts.force) && player.duration > 0) {
      const eng = await call('times/user_engagement', {
        player_id: playerId, video_duration: player.duration, start_date: `${retStart} 00:00:00`, end_date: `${retEnd} 23:59:59`, timezone: tz,
      });
      const curve = retentionCurve(Array.isArray(eng?.grouped_timed) ? eng.grouped_timed : [], player.duration);
      await upsertChunks('vturb_retention', [{
        product_id: productId, player_id: playerId, start_date: retStart, end_date: retEnd, duration: player.duration,
        pitch_time: player.pitch_time, average_watched: int(eng?.average_watched_time), curve, updated_at: now,
      }], 'product_id,player_id');
      // Uma curva por semana fechada fica guardada, para comparar antes e depois de cada mudança.
      // Antes de migration_vturb_historico.sql a tabela não existe; a coleta segue.
      await db.from('vturb_retention_history').upsert({
        product_id: productId, player_id: playerId, start_date: retStart, end_date: retEnd, duration: player.duration,
        pitch_time: player.pitch_time, curve, updated_at: now,
      }, { onConflict: 'product_id,player_id,end_date' }).then(() => null, () => null);
    }

    await db.from('products').update({
      vturb_player_id: playerId, vturb_duration: player.duration, vturb_pitch_time: player.pitch_time, vturb_player_name: player.name,
      vturb_synced_at: now, vturb_sync_error: null,
    }).eq('id', productId);
    return { ok: true, calls, days: dailyRows.length, terms: terms.size, gclid_days: gclidDays.length };
  } catch (e: any) {
    return { ...(await fail(String(e.message).slice(0, 500))), calls };
  }
}

/** Agendador: campanhas com player cuja leitura venceu, da mais atrasada para a mais nova. */
export async function runDueVturb(deadline: number) {
  const report: any[] = [];
  const { data, error } = await supabaseAdmin().from('products').select('id, name, vturb_synced_at')
    .not('vturb_player_id', 'is', null).order('vturb_synced_at', { ascending: true, nullsFirst: true });
  if (error) return report; // antes de migration_vturb.sql
  for (const p of data || []) {
    if (Date.now() > deadline) break;
    const age = p.vturb_synced_at ? (Date.now() - new Date(p.vturb_synced_at).getTime()) / 60000 : Infinity;
    if (age < INTERVAL_MIN) continue;
    report.push({ product: p.name, ...(await syncProductVturb(p.id)) });
  }
  return report;
}
