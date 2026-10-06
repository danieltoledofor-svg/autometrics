import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/analysis/compute';

/**
 * Do clique à venda em todas as campanhas de um usuário, entre dois instantes.
 * Cliques e páginas vêm do script das páginas; as vendas, do postback da
 * plataforma. A venda conta quando aconteceu e é atribuída ao clique que a
 * gerou, mesmo que ele seja de antes do período. Só lê do banco.
 */

const DEVICE: Record<string, string> = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet' };

type Row = { key: string; id?: string; clicks: number; video: number; checkout: number; sales: number; value: number };

export async function trackingOverview(db: SupabaseClient, userId: string, since: string, until: string) {
  let clicks: any[], pages: any[], events: any[], products: any[];
  try {
    [clicks, pages, events, products] = await Promise.all([
      fetchAll((a, b) => db.from('tracking_clicks')
        .select('click_id, product_id, gclid, keyword, device, created_at')
        .eq('user_id', userId).gte('created_at', since).lt('created_at', until).order('created_at').range(a, b)),
      fetchAll((a, b) => db.from('tracking_pageviews')
        .select('click_id, url, kind, created_at')
        .eq('user_id', userId).gte('created_at', since).order('created_at').range(a, b)),
      // postback_events não tem o dono: filtra depois pelas campanhas do usuário.
      fetchAll((a, b) => db.from('postback_events')
        .select('click_id, product_id, event_type, amount, currency, source, created_at')
        .in('event_type', ['sale', 'checkout']).gte('created_at', since).lt('created_at', until).order('created_at').range(a, b)),
      fetchAll((a, b) => db.from('products').select('id, name, google_ads_campaign_name').eq('user_id', userId).order('id').range(a, b)),
    ]);
  } catch {
    return null;                                                  // tabelas do rastreamento ainda não criadas
  }

  const productName = new Map<string, string>(products.map(p => [p.id, p.google_ads_campaign_name || p.name || 'Campanha sem nome']));
  events = events.filter(e => productName.has(e.product_id));
  const sales = events.filter(e => e.event_type === 'sale');

  // Cliques de antes do período que venderam dentro dele.
  const byId = new Map<string, any>(clicks.map(c => [c.click_id, c]));
  const older = [...new Set(sales.map(s => s.click_id).filter((id: string) => id && !byId.has(id)))];
  const olderPages: any[] = [];
  for (let i = 0; i < older.length; i += 100) {
    const chunk = older.slice(i, i + 100);
    const [c, p] = await Promise.all([
      db.from('tracking_clicks').select('click_id, product_id, gclid, keyword, device, created_at').eq('user_id', userId).in('click_id', chunk),
      db.from('tracking_pageviews').select('click_id, url, kind, created_at').eq('user_id', userId).in('click_id', chunk).lt('created_at', since).order('created_at'),
    ]);
    for (const row of c.data || []) byId.set(row.click_id, row);
    olderPages.push(...(p.data || []));
  }

  const path = new Map<string, { urls: Set<string>; checkout: boolean }>();
  for (const p of [...olderPages, ...pages]) {
    if (!byId.has(p.click_id)) continue;
    if (!path.has(p.click_id)) path.set(p.click_id, { urls: new Set(), checkout: false });
    const entry = path.get(p.click_id)!;
    if (p.kind === 'checkout') entry.checkout = true; else entry.urls.add(p.url);
  }
  for (const e of events) if (e.event_type === 'checkout' && e.click_id && path.has(e.click_id)) path.get(e.click_id)!.checkout = true;

  const groups = { campaign: new Map<string, Row>(), keyword: new Map<string, Row>(), device: new Map<string, Row>() };
  const row = (map: Map<string, Row>, key: string, id?: string) => {
    if (!map.has(key)) map.set(key, { key, id, clicks: 0, video: 0, checkout: 0, sales: 0, value: 0 });
    return map.get(key)!;
  };
  const keysOf = (productId: string | null, click: any | null) => [
    row(groups.campaign, (productId && productName.get(productId)) || 'Sem campanha ligada', productId && productName.has(productId) ? productId : undefined),
    row(groups.keyword, click ? click.keyword || 'Sem palavra-chave' : 'Venda sem clique ligado'),
    row(groups.device, click ? DEVICE[click.device] || 'Não identificado' : 'Venda sem clique ligado'),
  ];

  const totals = { clicks: clicks.length, with_gclid: 0, video: 0, checkout: 0, sales: sales.length, unlinked: 0 };
  for (const c of clicks) {
    const p = path.get(c.click_id);
    const video = !!p && p.urls.size > 1, checkout = !!p && p.checkout;
    if (c.gclid) totals.with_gclid++;
    if (video) totals.video++;
    if (checkout) totals.checkout++;
    for (const r of keysOf(c.product_id, c)) { r.clicks++; if (video) r.video++; if (checkout) r.checkout++; }
  }

  const value: Record<string, number> = {};
  for (const s of sales) {
    const click = s.click_id ? byId.get(s.click_id) || null : null;
    if (!click) totals.unlinked++;
    const amount = Number(s.amount) || 0;
    const currency = String(s.currency || 'USD').toUpperCase();
    value[currency] = (value[currency] || 0) + amount;
    for (const r of keysOf(s.product_id, click)) { r.sales++; r.value += amount; }
  }
  // Moeda da tela: a que mais vendeu no período.
  const currency = Object.entries(value).sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';

  const sorted = (map: Map<string, Row>) => [...map.values()].sort((a, b) => b.sales - a.sales || b.clicks - a.clicks).slice(0, 200);
  const last = sales.slice(-30).reverse().map(s => {
    const click = s.click_id ? byId.get(s.click_id) || null : null;
    const p = click ? path.get(click.click_id) : null;
    return {
      at: s.created_at, amount: Number(s.amount) || 0, currency: String(s.currency || 'USD').toUpperCase(), source: s.source || '',
      product_id: s.product_id, campaign: productName.get(s.product_id) || '',
      linked: !!click, keyword: click?.keyword || '', device: click ? DEVICE[click.device] || '' : '',
      click_at: click?.created_at || null, pages: p ? p.urls.size : 0, checkout: !!p?.checkout,
    };
  });

  return {
    currency, totals, value,
    campaigns: sorted(groups.campaign), keywords: sorted(groups.keyword), devices: sorted(groups.device),
    sales: last,
  };
}
