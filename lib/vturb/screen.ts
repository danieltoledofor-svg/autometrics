import { supabaseAdmin } from '@/lib/googleAds/server';
import { addDays, fetchAll, loadProduct, todayIn } from '@/lib/analysis/compute';
import { keywordLabel } from '@/lib/analysis/labels';
import { autoLines } from '@/lib/googleAds/changeNotes';
import { playerIdFrom } from './client';
import { MIN_VIEWS } from './funnel';

/**
 * Aba VTurb no período da tela.
 *
 * - Do clique à venda em sete etapas (clique, vídeo carregado, play, pitch,
 *   botão de compra, checkout, venda), no período escolhido e ao lado dos
 *   últimos 3 e 7 dias fechados, como a Análise.
 * - Quem assiste e quem compra por aparelho, por grupo de anúncios e por
 *   palavra-chave: cada visita da VTurb é ligada ao clique do Google pelo gclid.
 * - As alterações feitas na campanha nesses dias.
 * - A curva de retenção da semana anterior, para pôr sobre a atual.
 *
 * Tudo sai do banco; nada aqui chama a VTurb nem o Google.
 */

const n = (v: any) => Number(v) || 0;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE: Record<string, string> = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet', CONNECTED_TV: 'TV conectada', OTHER: 'Outros' };

export interface Steps { clicks: number; cost: number; viewed: number; started: number; pitchBase: number; over: number; button: number; checkout: number | null; sales: number; vturbSales: number }
const emptySteps = (): Steps => ({ clicks: 0, cost: 0, viewed: 0, started: 0, pitchBase: 0, over: 0, button: 0, checkout: 0, sales: 0, vturbSales: 0 });

interface Seg { viewed: number; started: number; over: number; pitchBase: number; sales: number }
const emptySeg = (): Seg => ({ viewed: 0, started: 0, over: 0, pitchBase: 0, sales: 0 });

/**
 * `scale` leva as visitas ligadas pelo gclid ao total de vídeos carregados da campanha: nem toda visita
 * acha o clique, e sem isso a fuga e o custo por pessoa no pitch de cada linha sairiam maiores do que são.
 */
function segmentRow(key: string, label: string, s: Seg, google: { clicks: number; cost: number } | null, scale: number, extra: Record<string, any> = {}) {
  const loaded = google ? ratio(s.viewed * scale, google.clicks) : null;
  return {
    key, label, ...extra,
    small: s.viewed < MIN_VIEWS,
    clicks: google ? google.clicks : null, cost: google ? google.cost : null,
    viewed: s.viewed, leak: loaded === null ? null : Math.min(1, Math.max(0, 1 - loaded)),
    play: ratio(s.started, s.viewed), over: s.over, pitch: ratio(s.over, s.pitchBase),
    sales: s.sales, cost_per_pitch: google && s.over > 0 ? google.cost / (s.over * scale) : null,
  };
}

export async function computeScreen(productId: string, startRaw: string | null, endRaw: string | null) {
  const db = supabaseAdmin();
  const loaded = await loadProduct(productId);
  if (!loaded) return null;
  const { product, timeZone } = loaded;
  const playerId = playerIdFrom(product.vturb_player_id);
  if (!playerId) return null;
  const tz = timeZone || 'America/Sao_Paulo';
  const today = todayIn(tz);
  const yesterday = addDays(today, -1);
  const d3start = addDays(today, -3), d7start = addDays(today, -7);
  // Sem período válido na tela, vale a semana fechada.
  let start = DAY.test(String(startRaw)) ? String(startRaw) : d7start;
  let end = DAY.test(String(endRaw)) ? String(endRaw) : yesterday;
  if (end > today) end = today;
  if (start > end) start = end;
  const from = start < d7start ? start : d7start, to = end > yesterday ? end : yesterday;
  const localDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: tz });
  const soft = <T,>(p: PromiseLike<T>, fallback: T) => Promise.resolve(p).then(v => v, () => fallback);

  const [days, vdays, gclids, deviceRows, entityMetrics, entities, events, retention, previous] = await Promise.all([
    fetchAll((a, b) => db.from('daily_metrics').select('date, clicks, cost, conversions, notes').eq('product_id', productId).gte('date', from).lte('date', to).range(a, b)),
    fetchAll((a, b) => db.from('vturb_daily').select('date, viewed, started, over_pitch, under_pitch, clicked, conversions').eq('product_id', productId).eq('player_id', playerId).gte('date', from).lte('date', to).range(a, b)),
    fetchAll((a, b) => db.from('vturb_gclid').select('gclid, viewed, started, over_pitch, under_pitch, conversions').eq('product_id', productId).eq('player_id', playerId).gte('date', start).lte('date', end).range(a, b)),
    soft(fetchAll((a, b) => db.from('audiences').select('audience_name, clicks, cost').eq('product_id', productId).eq('audience_type', 'Device').gte('date', start).lte('date', end).range(a, b)), [] as any[]),
    soft(fetchAll((a, b) => db.from('google_ads_entity_metrics').select('level, entity_id, clicks, cost').eq('product_id', productId).in('level', ['ad_group', 'keyword']).gte('date', start).lte('date', end).range(a, b)), [] as any[]),
    soft(fetchAll((a, b) => db.from('google_ads_entities').select('level, entity_id, ad_group_id, name, status, details').eq('product_id', productId).in('level', ['ad_group', 'keyword']).range(a, b)), [] as any[]),
    soft(fetchAll((a, b) => db.from('postback_events').select('click_id, event_type, created_at').eq('product_id', productId).eq('event_type', 'checkout')
      .gte('created_at', `${addDays(from, -1)}T00:00:00Z`).lte('created_at', `${addDays(to, 1)}T23:59:59Z`).range(a, b)), null as any[] | null),
    soft(db.from('vturb_retention').select('start_date, end_date').eq('product_id', productId).eq('player_id', playerId).maybeSingle().then(r => r.data), null as any),
    // Antes de migration_vturb_historico.sql a tabela não existe: a comparação só fica sem a curva anterior.
    soft(db.from('vturb_retention_history').select('start_date, end_date, curve, pitch_time, duration').eq('product_id', productId).eq('player_id', playerId)
      .order('end_date', { ascending: false }).limit(40).then(r => (r.error ? null : r.data)), null as any[] | null),
  ]);

  // Saída para o checkout vista pelo script da página (rastreamento próprio), além do postback.
  const checkoutDays: { day: string; id: string }[] | null = events ? events.map((e, i) => ({ day: localDay(e.created_at), id: e.click_id || `sem-clique-${i}` })) : null;
  if (checkoutDays) {
    const pages = await soft(fetchAll((a, b) => db.from('tracking_pageviews').select('click_id, created_at').eq('user_id', product.user_id).eq('kind', 'checkout')
      .gte('created_at', `${addDays(from, -1)}T00:00:00Z`).lte('created_at', `${addDays(to, 1)}T23:59:59Z`).range(a, b)), [] as any[]);
    const ids = [...new Set(pages.map(p => p.click_id).filter(Boolean))];
    const mine = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('tracking_clicks').select('click_id').eq('product_id', productId).in('click_id', ids.slice(i, i + 200));
      for (const c of data || []) mine.add(c.click_id);
    }
    const seen = new Set(checkoutDays.map(c => `${c.day}|${c.id}`));
    for (const p of pages) {
      const k = `${localDay(p.created_at)}|${p.click_id}`;
      if (mine.has(p.click_id) && !seen.has(k)) { seen.add(k); checkoutDays.push({ day: localDay(p.created_at), id: p.click_id }); }
    }
  }

  // ── Do clique à venda ─────────────────────────────────────────────────────
  const windowOf = (a: string, b: string): Steps => {
    const t = emptySteps();
    for (const d of days) if (d.date >= a && d.date <= b) { t.clicks += n(d.clicks); t.cost += n(d.cost); t.sales += n(d.conversions); }
    for (const v of vdays) if (v.date >= a && v.date <= b) {
      t.viewed += n(v.viewed); t.started += n(v.started); t.over += n(v.over_pitch); t.pitchBase += n(v.over_pitch) + n(v.under_pitch);
      t.button += n(v.clicked); t.vturbSales += n(v.conversions);
    }
    t.checkout = checkoutDays ? checkoutDays.filter(c => c.day >= a && c.day <= b).length : null;
    return t;
  };
  const steps = windowOf(start, end);

  // ── Aparelho, grupo de anúncios e palavra-chave (pelo gclid) ──────────────
  // Os cliques do Google do período (e dos 3 dias antes: a visita pode vir depois do clique), lidos pela
  // campanha e pela data. Procurar gclid por gclid estoura o tamanho da consulta.
  const clickOf = new Map<string, any>();
  const clickRows = await soft(fetchAll((a, b) => db.from('google_ads_clicks').select('gclid, keyword_text, match_type, ad_group_id, device')
    .eq('product_id', productId).gte('date', addDays(start, -3)).lte('date', end).order('gclid').range(a, b)), [] as any[]);
  for (const c of clickRows) clickOf.set(c.gclid, c);
  const groupName = new Map<string, string>(), keywordId = new Map<string, { id: string; cost: number; status: string }>();
  const keywordOf = new Map<string, { text: string; match: string; group: string; status: string }>();
  for (const e of entities) {
    if (e.level === 'ad_group') groupName.set(e.entity_id, e.name);
    else keywordOf.set(e.entity_id, { text: String(e.name || '').toLowerCase(), match: e.details?.match_type || '', group: e.ad_group_id || '', status: e.status });
  }
  const googleDevice = new Map<string, { clicks: number; cost: number }>(), googleGroup = new Map<string, { clicks: number; cost: number }>(), googleKeyword = new Map<string, { clicks: number; cost: number }>();
  const sum = (map: Map<string, { clicks: number; cost: number }>, k: string, r: any) => { const cur = map.get(k) || { clicks: 0, cost: 0 }; cur.clicks += n(r.clicks); cur.cost += n(r.cost); map.set(k, cur); };
  for (const r of deviceRows) sum(googleDevice, r.audience_name, r);
  const keywordCost = new Map<string, number>();
  for (const m of entityMetrics) {
    if (m.level === 'ad_group') { sum(googleGroup, m.entity_id, m); continue; }
    const kw = keywordOf.get(m.entity_id);
    if (!kw) continue;
    sum(googleKeyword, `${kw.text}|${kw.match}`, m);
    keywordCost.set(m.entity_id, (keywordCost.get(m.entity_id) || 0) + n(m.cost));
  }
  // A palavra pode existir em mais de um grupo: os botões agem na que mais gastou.
  for (const [id, kw] of keywordOf) {
    const k = `${kw.text}|${kw.match}`, cost = keywordCost.get(id) || 0, cur = keywordId.get(k);
    if (kw.status !== 'REMOVED' && (!cur || cost > cur.cost)) keywordId.set(k, { id, cost, status: kw.status });
  }

  const byDevice = new Map<string, Seg>(), byGroup = new Map<string, Seg>(), byKeyword = new Map<string, Seg>();
  const put = (map: Map<string, Seg>, k: string, g: any) => {
    if (!map.has(k)) map.set(k, emptySeg());
    const s = map.get(k)!;
    s.viewed += n(g.viewed); s.started += n(g.started); s.over += n(g.over_pitch); s.pitchBase += n(g.over_pitch) + n(g.under_pitch); s.sales += n(g.conversions);
  };
  let withGclid = 0, matched = 0;
  for (const g of gclids) {
    withGclid += n(g.viewed);
    const c = clickOf.get(g.gclid);
    if (!c) continue;
    matched += n(g.viewed);
    if (c.device) put(byDevice, c.device, g);
    if (c.ad_group_id) put(byGroup, String(c.ad_group_id), g);
    if (c.keyword_text) put(byKeyword, `${String(c.keyword_text).toLowerCase()}|${c.match_type || ''}`, g);
  }
  const sorted = (rows: ReturnType<typeof segmentRow>[]) => rows.sort((a, b) => b.viewed - a.viewed).slice(0, 50);
  const scale = matched > 0 ? Math.max(1, steps.viewed / matched) : 1;
  const segments = {
    device: sorted([...byDevice].map(([k, s]) => segmentRow(k, DEVICE[k] || k, s, googleDevice.get(k) || null, scale))),
    ad_group: sorted([...byGroup].map(([k, s]) => segmentRow(k, groupName.get(k) || `Grupo ${k}`, s, googleGroup.get(k) || null, scale))),
    keyword: sorted([...byKeyword].map(([k, s]) => {
      const [text, match] = k.split('|');
      const entity = keywordId.get(k);
      return segmentRow(k, keywordLabel(text, match), s, googleKeyword.get(k) || null, scale, { text, match, entity_id: entity?.id || null, paused: entity?.status === 'PAUSED' });
    })),
    visits: { gclid: withGclid, matched, viewed: steps.viewed },
  };

  // ── Alterações do período ────────────────────────────────────────────────
  const changes = days.filter(d => d.date >= start && d.date <= end).map(d => ({ date: d.date, lines: autoLines(d.notes) })).filter(d => d.lines.length)
    .sort((a, b) => b.date.localeCompare(a.date));

  // ── Retenção da semana anterior ──────────────────────────────────────────
  let before: any = null;
  if (retention && previous?.length) {
    const limit = addDays(String(retention.start_date), -1);       // a mais nova que não divide dias com a atual
    const hit = previous.find(p => String(p.end_date) <= limit && Array.isArray(p.curve) && p.curve.length);
    if (hit) {
      before = { points: hit.curve, period: [hit.start_date, hit.end_date], pitch_time: hit.pitch_time, duration: hit.duration };
      before.changes = days.length ? await soft(db.from('daily_metrics').select('date, notes').eq('product_id', productId).gt('date', hit.end_date).lte('date', retention.end_date).not('notes', 'is', null)
        .then(r => (r.data || []).flatMap(d => autoLines(d.notes).map(l => ({ date: d.date, text: l.text })))), [] as any[]) : [];
    }
  }

  return {
    period: [start, end], d3: [d3start, yesterday], d7: [d7start, yesterday],
    steps, steps3: windowOf(d3start, yesterday), steps7: windowOf(d7start, yesterday),
    segments, changes,
    retention_before: before, retention_history: previous !== null,
  };
}
