import { supabaseAdmin } from '@/lib/googleAds/server';
import { addDays, fetchAll, loadProduct, todayIn, worst, type Status } from '@/lib/analysis/compute';
import { formatMoney, keywordLabel } from '@/lib/analysis/labels';
import { playerIdFrom, decodeTerm } from './client';

/**
 * Do clique à venda: Google (cliques, custo, vendas do postback) cruzado com
 * a VTurb (carregaram o vídeo, play, pitch), 3 dias × 7 dias, como a Análise.
 *
 * Semáforo:
 * - fuga da página: ALERTA a partir de 5 pontos acima da média de 7 dias,
 *   URGENTE a partir de 10;
 * - chegada ao pitch: ALERTA a partir de 15% abaixo da média, URGENTE a
 *   partir de 25%;
 * - com menos de 30 vídeos carregados não há semáforo.
 *
 * Por palavra-chave, a ligação é pelo gclid (conta pela API: click_view);
 * sem ela, pelo utm_term que a VTurb recebe na URL.
 */

export const MIN_VIEWS = 30;

interface Totals { clicks: number; cost: number; sales: number; viewed: number; started: number; over: number; pitchBase: number; vturbSales: number }
const empty = (): Totals => ({ clicks: 0, cost: 0, sales: 0, viewed: 0, started: 0, over: 0, pitchBase: 0, vturbSales: 0 });
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const n = (v: any) => Number(v) || 0;

function rates(t: Totals) {
  const loaded = ratio(t.viewed, t.clicks);
  return {
    ...t,
    leak: loaded === null ? null : Math.max(0, 1 - loaded),       // fuga da página
    play: ratio(t.started, t.viewed),
    pitch: ratio(t.over, t.pitchBase),                              // de quem deu play
    salesPerPitch: ratio(t.sales, t.over),
    cpa: t.sales > 0 ? t.cost / t.sales : null,
    costPerView: ratio(t.cost, t.viewed),
    costPerPitch: ratio(t.cost, t.over),
  };
}
export type Rates = ReturnType<typeof rates>;

function leakStatus(d3: Rates, d7: Rates): Status {
  if (d3.viewed < MIN_VIEWS || d3.leak === null || d7.leak === null) return 'sem_dado';
  const pp = (d3.leak - d7.leak) * 100;
  return pp >= 10 ? 'urgente' : pp >= 5 ? 'alerta' : 'ok';
}
function pitchStatus(d3: Rates, d7: Rates): Status {
  if (d3.viewed < MIN_VIEWS || d3.pitch === null || !d7.pitch) return 'sem_dado';
  const drop = (d7.pitch - d3.pitch) / d7.pitch;
  return drop >= 0.25 ? 'urgente' : drop >= 0.15 ? 'alerta' : 'ok';
}

export const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const int = (x: number) => Math.round(x).toLocaleString('pt-BR');
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export async function computeFunnel(productId: string) {
  const db = supabaseAdmin();
  const loaded = await loadProduct(productId);
  if (!loaded) return null;
  const { product, timeZone } = loaded;
  const playerId = playerIdFrom(product.vturb_player_id);
  const today = todayIn(timeZone || 'America/Sao_Paulo');
  const d7start = addDays(today, -7), d3start = addDays(today, -3), end = addDays(today, -1);
  const base = {
    player: playerId ? { id: playerId, name: product.vturb_player_name || null, duration: product.vturb_duration || null, pitch_time: product.vturb_pitch_time || null } : null,
    synced_at: product.vturb_synced_at || null, sync_error: product.vturb_sync_error || null,
    transcript_chars: product.vsl_transcript ? String(product.vsl_transcript).length : null,
    period: { d3: [d3start, end], d7: [d7start, end] },
  };
  if (!playerId) return { ...base, ready: false };

  const [days, vdays, terms, gclids, retention, kwMetrics, kwEntities] = await Promise.all([
    fetchAll((a, b) => db.from('daily_metrics').select('date, clicks, cost, conversions, currency').eq('product_id', productId).gte('date', d7start).lte('date', end).range(a, b)),
    fetchAll((a, b) => db.from('vturb_daily').select('*').eq('product_id', productId).eq('player_id', playerId).gte('date', d7start).lte('date', end).range(a, b)),
    fetchAll((a, b) => db.from('vturb_daily_by_term').select('date, term, viewed, started, over_pitch, under_pitch, conversions').eq('product_id', productId).eq('player_id', playerId).gte('date', d7start).lte('date', end).range(a, b)),
    fetchAll((a, b) => db.from('vturb_gclid').select('gclid, viewed, started, over_pitch, under_pitch, conversions').eq('product_id', productId).eq('player_id', playerId).gte('date', d7start).lte('date', end).range(a, b)),
    db.from('vturb_retention').select('*').eq('product_id', productId).eq('player_id', playerId).maybeSingle().then(r => r.data),
    fetchAll((a, b) => db.from('google_ads_entity_metrics').select('entity_id, clicks, cost').eq('product_id', productId).eq('level', 'keyword').gte('date', d7start).lte('date', end).range(a, b)).catch(() => []),
    fetchAll((a, b) => db.from('google_ads_entities').select('entity_id, name, details').eq('product_id', productId).eq('level', 'keyword').range(a, b)).catch(() => []),
  ]);

  const currency = String(product.currency || days.find(d => d.currency)?.currency || 'USD').toUpperCase();
  const money = (v: number | null) => (v === null ? '—' : formatMoney(v, currency));

  // ── Campanha ──────────────────────────────────────────────────────────────
  const t3 = empty(), t7 = empty();
  for (const d of days) for (const t of d.date >= d3start ? [t3, t7] : [t7]) { t.clicks += n(d.clicks); t.cost += n(d.cost); t.sales += n(d.conversions); }
  for (const v of vdays) for (const t of v.date >= d3start ? [t3, t7] : [t7]) {
    t.viewed += n(v.viewed); t.started += n(v.started); t.over += n(v.over_pitch); t.pitchBase += n(v.over_pitch) + n(v.under_pitch); t.vturbSales += n(v.conversions);
  }
  const d3 = rates(t3), d7 = rates(t7);
  const status = { leak: leakStatus(d3, d7), pitch: pitchStatus(d3, d7) };
  const overall = worst([status.leak, status.pitch].filter(s => s !== 'sem_dado') as Status[]);

  let title: string, text: string;
  if (d3.viewed < MIN_VIEWS) {
    title = d3.viewed ? `Só ${int(d3.viewed)} vídeos carregados nos últimos 3 dias` : 'Nenhum vídeo carregado nos últimos 3 dias';
    text = `Com menos de ${MIN_VIEWS}, os números ficam sem semáforo.`;
  } else if (status.leak !== 'ok' && (status.leak === 'urgente' || status.pitch === 'ok' || status.pitch === 'sem_dado')) {
    title = `Fuga da página em ${pct(d3.leak)} nos últimos 3 dias, contra ${pct(d7.leak)} na média de 7 dias`;
    text = `De ${int(d3.clicks)} cliques no anúncio, ${int(d3.viewed)} carregaram o vídeo. Play em ${pct(d3.play)} (7d ${pct(d7.play)}) e chegada ao pitch em ${pct(d3.pitch)} (7d ${pct(d7.pitch)}).`;
  } else if (status.pitch !== 'ok' && status.pitch !== 'sem_dado') {
    title = `Chegada ao pitch em ${pct(d3.pitch)} nos últimos 3 dias, contra ${pct(d7.pitch)} na média de 7 dias`;
    text = `${int(d3.over)} de ${int(d3.pitchBase)} pessoas que deram play chegaram ao pitch. Fuga da página em ${pct(d3.leak)} (7d ${pct(d7.leak)}).`;
  } else {
    title = `Do clique à venda sem mudança: fuga ${pct(d3.leak)}, pitch ${pct(d3.pitch)}`;
    text = `De ${int(d3.clicks)} cliques, ${int(d3.viewed)} carregaram o vídeo, ${int(d3.over)} chegaram ao pitch e ${int(d3.sales)} compraram.`;
  }

  // ── Retenção ─────────────────────────────────────────────────────────────
  let curve: any = null;
  if (retention?.curve?.length) {
    const pts: [number, number][] = retention.curve;
    const at = (s: number) => { let v = pts[0][1]; for (const [t, p] of pts) { if (t > s) break; v = p; } return v; };
    const pitchT = retention.pitch_time ? Number(retention.pitch_time) : null;
    // Maior queda em 3 minutos, fora do começo (10 min, onde a saída é natural)
    // e do pitch em diante.
    let drop: { from: number; to: number; a: number; b: number } | null = null;
    for (const [t] of pts) {
      if (t < 600 || t + 180 > (pitchT ?? retention.duration)) continue;
      const a = at(t), b = at(t + 180);
      if (!drop || a - b > drop.a - drop.b) drop = { from: t, to: t + 180, a, b };
    }
    const notes = [`${Math.round(100 - at(60))}% saem no 1º minuto`];
    if (drop && drop.a - drop.b >= 2) notes.push(`Queda de ${Math.round(drop.a)}% para ${Math.round(drop.b)}% entre ${mmss(drop.from)} e ${mmss(drop.to)}`);
    if (pitchT) notes.push(`${Math.round(at(pitchT))}% chegam ao pitch · ${Math.round(at(pitchT + 60))}% seguem 1 minuto depois dele`);
    const marks = [60, 300, ...(drop ? [drop.from, drop.to] : []), ...(pitchT ? [pitchT + 60] : [])]
      .filter((s, i, all) => s <= retention.duration && all.indexOf(s) === i).map(s => ({ t: s, pct: at(s), label: `${s % 60 ? mmss(s) : `${s / 60} min`} · ${Math.round(at(s))}%` }));
    curve = { drop: drop && drop.a - drop.b >= 2 ? drop : null, points: pts, duration: retention.duration, pitch_time: pitchT, pitch_pct: pitchT ? at(pitchT) : null, marks, notes, period: [retention.start_date, retention.end_date], updated_at: retention.updated_at };
  }

  // ── Por palavra-chave ────────────────────────────────────────────────────
  const kwName = new Map<string, { text: string; match: string }>();
  for (const e of kwEntities) kwName.set(e.entity_id, { text: String(e.name || '').toLowerCase(), match: e.details?.match_type || '' });
  const google = new Map<string, { clicks: number; cost: number }>(); // "texto|MATCH"
  const googleByText = new Map<string, { clicks: number; cost: number }>();
  for (const m of kwMetrics) {
    const kw = kwName.get(m.entity_id);
    if (!kw) continue;
    for (const [map, k] of [[google, `${kw.text}|${kw.match}`], [googleByText, kw.text]] as const) {
      const cur = map.get(k) || { clicks: 0, cost: 0 };
      cur.clicks += n(m.clicks); cur.cost += n(m.cost);
      map.set(k, cur);
    }
  }

  const visitsWithGclid = gclids.reduce((s, g) => s + n(g.viewed), 0);
  let source: 'gclid' | 'utm_term' | 'nenhuma' = 'nenhuma';
  const rows = new Map<string, { label: string; google: { clicks: number; cost: number } | null; t: Totals }>();
  const add = (key: string, label: string, g: { clicks: number; cost: number } | null, r: any) => {
    const cur = rows.get(key) || { label, google: g, t: empty() };
    cur.t.viewed += n(r.viewed); cur.t.started += n(r.started); cur.t.over += n(r.over_pitch);
    cur.t.pitchBase += n(r.over_pitch) + n(r.under_pitch); cur.t.vturbSales += n(r.conversions);
    rows.set(key, cur);
  };

  // gclid: só vale quando a maior parte das visitas achou o clique no Google.
  let matched = 0;
  if (gclids.length) {
    const map = new Map<string, any>();
    const list = gclids.map(g => g.gclid);
    // Lotes pequenos: cada gclid tem perto de 90 letras, e um lote grande estoura o tamanho do endereço da consulta.
    for (let i = 0; i < list.length; i += 40) {
      const { data } = await db.from('google_ads_clicks').select('gclid, keyword_text, match_type').in('gclid', list.slice(i, i + 40));
      for (const c of data || []) map.set(c.gclid, c);
    }
    const byKw: [string, string, any][] = [];
    for (const g of gclids) {
      const c = map.get(g.gclid);
      if (!c?.keyword_text) continue;
      matched += n(g.viewed);
      const text = String(c.keyword_text).toLowerCase();
      byKw.push([`${text}|${c.match_type || ''}`, keywordLabel(text, c.match_type), g]);
    }
    if (visitsWithGclid > 0 && matched / visitsWithGclid >= 0.5) {
      source = 'gclid';
      for (const [k, label, g] of byKw) add(k, label, google.get(k) || null, g);
    }
  }
  const termVisits = terms.reduce((s, t) => s + n(t.viewed), 0);
  if (source === 'nenhuma' && termVisits > 0) {
    source = 'utm_term';
    for (const t of terms) {
      const text = decodeTerm(t.term);
      add(text, text, googleByText.get(text) || null, t);
    }
  }

  // Palavra-chave × campanha (7 dias): mesmos limites, só com 30 visitas ou mais.
  const kwStatus = (x: Rates): { status: Status; pitchVs: number | null; leakVs: number | null } => {
    const pitchVs = x.pitch !== null && d7.pitch ? (x.pitch - d7.pitch) / d7.pitch : null;
    const leakVs = x.leak !== null && d7.leak !== null ? (x.leak - d7.leak) * 100 : null;
    if (x.viewed < MIN_VIEWS) return { status: 'sem_dado', pitchVs, leakVs };
    const p: Status = pitchVs === null ? 'sem_dado' : pitchVs <= -0.25 ? 'urgente' : pitchVs <= -0.15 ? 'alerta' : 'ok';
    const l: Status = leakVs === null ? 'sem_dado' : leakVs >= 10 ? 'urgente' : leakVs >= 5 ? 'alerta' : 'ok';
    const known = [p, l].filter(s => s !== 'sem_dado') as Status[];
    return { status: known.length ? worst(known) : 'sem_dado', pitchVs, leakVs };
  };

  const keywords = [...rows.entries()].map(([key, r]) => {
    const t = { ...r.t, clicks: r.google?.clicks || 0, cost: r.google?.cost || 0, sales: r.t.vturbSales };
    const x = rates(r.google ? t : { ...t, clicks: 0 });
    return {
      key, label: r.label, small: r.t.viewed < MIN_VIEWS, ...kwStatus(x),
      clicks: r.google ? r.google.clicks : null, cost: r.google ? r.google.cost : null,
      viewed: x.viewed, leak: r.google ? x.leak : null, play: x.play, over: x.over, pitch: x.pitch,
      sales: x.vturbSales, cpa: r.google && x.vturbSales > 0 ? r.google.cost / x.vturbSales : null,
    };
  }).sort((a, b) => b.viewed - a.viewed).slice(0, 50);

  return {
    ...base, ready: true, today, currency,
    d3, d7, status, overall: d3.viewed < MIN_VIEWS ? 'sem_dado' as Status : overall,
    summary: { title, text },
    extra: {
      costPerPitch: [money(d3.costPerPitch), money(d7.costPerPitch)],
      costPerView: [money(d3.costPerView), money(d7.costPerView)],
      cpa: money(d3.cpa),
    },
    curve,
    keywords: {
      source, rows: keywords,
      visits: { gclid: visitsWithGclid, matched, utm_term: termVisits },
    },
  };
}
