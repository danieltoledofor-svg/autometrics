import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/analysis/compute';
import { geoReady, lookup } from '@/lib/tracking/geo';

/**
 * Listas da tela de Rastreamento: as visitas uma a uma, o detalhe de uma
 * visita, e as vendas e os checkouts com o clique de cada um. Só lê do banco
 * (menos fillPendingGeo, que completa o local das visitas).
 */

const PAGE = 50;
const VISIT_COLUMNS = 'click_id, product_id, gclid, keyword, match_type, device, network, landing_url, referrer, created_at, ip, country_code, country, region, city, os, browser, traffic, is_bot, seconds, max_scroll, last_seen_at';
const clean = (v: string) => v.replace(/[%,()*\\]/g, ' ').trim().slice(0, 80);

async function productNames(db: SupabaseClient, userId: string) {
  const products = await fetchAll((a, b) => db.from('products').select('id, name, google_ads_campaign_name').eq('user_id', userId).order('id').range(a, b));
  return new Map<string, string>(products.map((p: any) => [p.id, p.google_ads_campaign_name || p.name || 'Campanha sem nome']));
}

export interface VisitFilters { productId?: string; traffic?: string; device?: string; q?: string; bought?: boolean; bots?: boolean; page?: number }

export async function listVisits(db: SupabaseClient, userId: string, since: string, until: string, f: VisitFilters) {
  const names = await productNames(db, userId);
  const page = Math.max(0, Math.floor(f.page || 0));

  // "Só quem comprou": parte das vendas do período e volta para os cliques delas.
  let buyers: string[] | null = null;
  if (f.bought) {
    const sales = await fetchAll((a, b) => db.from('postback_events').select('click_id, product_id')
      .eq('event_type', 'sale').not('click_id', 'is', null).gte('created_at', since).lt('created_at', until).order('created_at').range(a, b));
    buyers = [...new Set(sales.filter((s: any) => names.has(s.product_id)).map((s: any) => s.click_id as string))].slice(0, 300);
    if (!buyers.length) return { ready: true, total: 0, page, pages: 0, visits: [] };
  }

  let query = db.from('tracking_clicks').select(VISIT_COLUMNS, { count: 'exact' }).eq('user_id', userId);
  query = buyers ? query.in('click_id', buyers) : query.gte('created_at', since).lt('created_at', until);
  if (f.productId) query = query.eq('product_id', f.productId);
  if (f.traffic) query = query.eq('traffic', f.traffic);
  if (f.device) query = query.eq('device', f.device);
  if (!f.bots) query = query.eq('is_bot', false);
  const q = clean(f.q || '');
  if (q) query = query.or(['keyword', 'city', 'region', 'country', 'ip', 'landing_url'].map(c => `${c}.ilike.%${q}%`).join(','));
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (error) return { ready: false };                             // antes de migration_rastreamento_visitas.sql

  const ids = (data || []).map((c: any) => c.click_id);
  const pagesOf = new Map<string, { urls: Set<string>; checkout: boolean }>();
  const saleOf = new Map<string, { amount: number; currency: string }>();
  if (ids.length) {
    const [pv, ev] = await Promise.all([
      fetchAll((a, b) => db.from('tracking_pageviews').select('click_id, url, kind').eq('user_id', userId).in('click_id', ids).order('created_at').range(a, b)),
      db.from('postback_events').select('click_id, event_type, amount, currency').in('click_id', ids).in('event_type', ['sale', 'checkout']).then(r => r.data || []),
    ]);
    for (const p of pv) {
      if (!pagesOf.has(p.click_id)) pagesOf.set(p.click_id, { urls: new Set(), checkout: false });
      const entry = pagesOf.get(p.click_id)!;
      if (p.kind === 'checkout') entry.checkout = true; else entry.urls.add(p.url);
    }
    for (const e of ev) {
      if (e.event_type === 'checkout') { if (!pagesOf.has(e.click_id)) pagesOf.set(e.click_id, { urls: new Set(), checkout: true }); else pagesOf.get(e.click_id)!.checkout = true; continue; }
      const cur = saleOf.get(e.click_id) || { amount: 0, currency: String(e.currency || 'USD').toUpperCase() };
      cur.amount += Number(e.amount) || 0;
      saleOf.set(e.click_id, cur);
    }
  }

  const visits = (data || []).map((c: any) => {
    const p = pagesOf.get(c.click_id);
    const sale = saleOf.get(c.click_id) || null;
    const pages = p ? p.urls.size : 0;
    return {
      ...c, campaign: (c.product_id && names.get(c.product_id)) || '', pages, sale,
      reached: sale ? 'venda' : p?.checkout ? 'checkout' : pages > 1 ? 'video' : 'entrada',
    };
  });
  return { ready: true, total: count || 0, page, pages: Math.ceil((count || 0) / PAGE), visits };
}

/** Uma visita inteira: tudo o que veio na URL, o visitante e a linha do tempo. */
export async function visitDetail(db: SupabaseClient, userId: string, clickId: string) {
  const { data: click, error } = await db.from('tracking_clicks').select('*').eq('user_id', userId).eq('click_id', clickId).maybeSingle();
  if (error || !click) return null;
  const [pv, ev, product] = await Promise.all([
    db.from('tracking_pageviews').select('url, kind, created_at').eq('user_id', userId).eq('click_id', clickId).order('created_at').limit(300).then(r => r.data || []),
    db.from('postback_events').select('id, event_type, amount, currency, source, transaction_id, created_at').eq('click_id', clickId).order('created_at').then(r => r.data || []),
    click.product_id ? db.from('products').select('id, name, google_ads_campaign_name, user_id').eq('id', click.product_id).maybeSingle().then(r => r.data) : Promise.resolve(null),
  ]);
  const mine = product && product.user_id === userId;
  const events = mine || !click.product_id ? ev : [];
  const uploads = new Map<string, any>();
  if (events.length) {
    const { data } = await db.from('google_conversion_uploads').select('event_id, status, reason, sent_at').in('event_id', events.map((e: any) => e.id));
    for (const u of data || []) uploads.set(u.event_id, u);
  }
  const timeline = [
    ...pv.map((p: any) => ({ at: p.created_at, kind: p.kind === 'checkout' ? 'saida' : 'pagina', text: p.url })),
    ...events.map((e: any) => ({
      at: e.created_at, kind: e.event_type, text: e.source || '', amount: Number(e.amount) || 0, currency: String(e.currency || 'USD').toUpperCase(),
      order: e.transaction_id || '', google: uploads.get(e.id) || null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const { user_agent, ...rest } = click;
  return { ...rest, user_agent, campaign: mine ? product.google_ads_campaign_name || product.name : '', timeline };
}

/** Vendas ou checkouts do período, cada um com o clique que o gerou. */
export async function listEvents(db: SupabaseClient, userId: string, since: string, until: string, type: 'sale' | 'checkout') {
  const names = await productNames(db, userId);
  const events = (await fetchAll((a, b) => db.from('postback_events')
    .select('id, click_id, product_id, amount, currency, source, transaction_id, created_at')
    .eq('event_type', type).gte('created_at', since).lt('created_at', until).order('created_at', { ascending: false }).range(a, b)))
    .filter((e: any) => names.has(e.product_id));
  const shown = events.slice(0, 300);

  const clicks = new Map<string, any>();
  const ids = [...new Set(shown.map((e: any) => e.click_id).filter(Boolean))] as string[];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    let { data, error } = await db.from('tracking_clicks').select('click_id, gclid, keyword, device, created_at, country, region, city, os, browser').eq('user_id', userId).in('click_id', chunk);
    if (error) ({ data } = await db.from('tracking_clicks').select('click_id, gclid, keyword, device, created_at').eq('user_id', userId).in('click_id', chunk) as any);
    for (const c of data || []) clicks.set(c.click_id, c);
  }
  const uploads = new Map<string, any>();
  if (type === 'sale') {
    for (let i = 0; i < shown.length; i += 200) {
      const { data } = await db.from('google_conversion_uploads').select('event_id, status, reason').in('event_id', shown.slice(i, i + 200).map((e: any) => e.id));
      for (const u of data || []) uploads.set(u.event_id, u);
    }
  }
  const value: Record<string, number> = {};
  for (const e of events) { const c = String(e.currency || 'USD').toUpperCase(); value[c] = (value[c] || 0) + (Number(e.amount) || 0); }
  return {
    ready: true, total: events.length, linked: events.filter((e: any) => e.click_id).length, value,
    events: shown.map((e: any) => ({
      at: e.created_at, amount: Number(e.amount) || 0, currency: String(e.currency || 'USD').toUpperCase(), source: e.source || '',
      order: e.transaction_id || '', product_id: e.product_id, campaign: names.get(e.product_id) || '',
      click: e.click_id ? clicks.get(e.click_id) || null : null, google: uploads.get(e.id) || null,
    })),
  };
}

/**
 * Agendador: procura o local das visitas que chegaram antes de a base de
 * localização estar pronta no servidor.
 */
export async function fillPendingGeo(db: SupabaseClient, limit = 400) {
  const { data, error } = await db.from('tracking_clicks').select('id, ip').not('ip', 'is', null).is('geo_at', null).order('created_at', { ascending: false }).limit(limit);
  if (error || !data?.length) return { filled: 0 };
  if (!(await geoReady().catch(() => false))) return { filled: 0, waiting: data.length };
  const byIp = new Map<string, string[]>();
  for (const r of data) { if (!byIp.has(r.ip)) byIp.set(r.ip, []); byIp.get(r.ip)!.push(r.id); }
  const now = new Date().toISOString();
  let filled = 0;
  for (const [ip, ids] of byIp) {
    const place = lookup(ip);
    await db.from('tracking_clicks').update({
      country_code: place?.country_code || null, country: place?.country || null, region: place?.region || null, city: place?.city || null, geo_at: now,
    }).in('id', ids);
    filled += ids.length;
  }
  return { filled };
}

/**
 * Agendador: liga à campanha as visitas que chegaram sem ela.
 *
 * 1. A visita trouxe o número da campanha, mas a campanha ainda não estava no
 *    Autometrics (conta ligada depois, campanha criada na hora): liga quando
 *    ela aparece.
 * 2. A visita trouxe só o gclid: procura a campanha no que o Google informa
 *    de cada clique (google_ads_clicks, hoje só nas campanhas com player).
 */
export async function relinkVisits(db: SupabaseClient, limit = 500) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await db.from('tracking_clicks').select('id, user_id, campaign_id, gclid')
    .is('product_id', null).gte('created_at', since).or('campaign_id.not.is.null,gclid.not.is.null').order('created_at', { ascending: false }).limit(limit);
  if (error || !data?.length) return { linked: 0 };
  let linked = 0;

  const byCampaign = new Map<string, string[]>();
  for (const r of data) if (r.campaign_id) { const k = `${r.user_id}|${r.campaign_id}`; if (!byCampaign.has(k)) byCampaign.set(k, []); byCampaign.get(k)!.push(r.id); }
  const solved = new Set<string>();
  for (const [key, ids] of byCampaign) {
    const [userId, campaignId] = key.split('|');
    const { data: product } = await db.from('products').select('id').eq('user_id', userId).eq('google_ads_campaign_id', campaignId).limit(1);
    if (!product?.[0]) continue;
    await db.from('tracking_clicks').update({ product_id: product[0].id }).in('id', ids);
    ids.forEach(id => solved.add(id));
    linked += ids.length;
  }

  const byGclid = data.filter(r => r.gclid && !solved.has(r.id));
  for (let i = 0; i < byGclid.length; i += 200) {
    const chunk = byGclid.slice(i, i + 200);
    const { data: known, error: e } = await db.from('google_ads_clicks').select('gclid, product_id').in('gclid', chunk.map(r => r.gclid));
    if (e || !known?.length) continue;
    const productOf = new Map(known.map(k => [k.gclid, k.product_id]));
    const owners = new Map<string, string>();
    const { data: products } = await db.from('products').select('id, user_id, google_ads_campaign_id').in('id', [...new Set(known.map(k => k.product_id))]);
    for (const p of products || []) owners.set(p.id, `${p.user_id}|${p.google_ads_campaign_id || ''}`);
    for (const r of chunk) {
      const productId = productOf.get(r.gclid);
      const [owner, campaignId] = (productId && owners.get(productId) || '|').split('|');
      if (!productId || owner !== r.user_id) continue;             // só campanha do mesmo dono
      await db.from('tracking_clicks').update({ product_id: productId, campaign_id: r.campaign_id || campaignId || null }).eq('id', r.id);
      linked++;
    }
  }
  return { linked };
}
