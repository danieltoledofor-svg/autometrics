import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { fetchAll } from '@/lib/analysis/compute';

export const dynamic = 'force-dynamic';

/**
 * Rastreamento da campanha: os cliques que o script guardou, as páginas que
 * cada pessoa abriu e a venda ligada ao clique. Só lê do banco.
 *
 * GET ?product_id=…&days=3   (days: 1 a 30)
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const productId = q.get('product_id');
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  if (!productId) return NextResponse.json({ error: 'Informe a campanha.' }, { status: 400 });
  const db = supabaseAdmin();
  const { data: product } = await db.from('products').select('id').eq('id', productId).eq('user_id', user.id).maybeSingle();
  if (!product) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

  const days = Math.min(30, Math.max(1, Number(q.get('days')) || 3));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let clicks: any[];
  try {
    clicks = await fetchAll((a, b) => db.from('tracking_clicks')
      .select('click_id, gclid, ft_sid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, keyword, match_type, ad_group_id, ad_id, network, device, landing_url, referrer, params, created_at')
      .eq('product_id', productId).gte('created_at', since).order('created_at', { ascending: false }).range(a, b));
  } catch {
    return NextResponse.json({ ready: false, error: 'Rode migration_rastreamento.sql no Supabase.' });
  }

  const ids = clicks.map(c => c.click_id);
  const pages = new Map<string, { url: string; at: string }[]>();
  const sales = new Map<string, any[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [pv, ev] = await Promise.all([
      fetchAll((a, b) => db.from('tracking_pageviews').select('click_id, url, created_at').eq('user_id', user.id).in('click_id', chunk).order('created_at').range(a, b)),
      // Antes de migration_rastreamento_vendas.sql a coluna click_id não existe.
      db.from('postback_events').select('click_id, event_type, amount, currency, source, transaction_id, created_at').eq('product_id', productId).in('click_id', chunk).then(r => r.data || []),
    ]);
    for (const p of pv) { if (!pages.has(p.click_id)) pages.set(p.click_id, []); pages.get(p.click_id)!.push({ url: p.url, at: p.created_at }); }
    for (const e of ev) { if (!sales.has(e.click_id)) sales.set(e.click_id, []); sales.get(e.click_id)!.push(e); }
  }

  const rows = clicks.map(c => {
    const events = sales.get(c.click_id) || [];
    const path = pages.get(c.click_id) || [];
    return {
      ...c, pages: path, events,
      distinct_pages: new Set(path.map(p => p.url)).size,
      sale: events.some(e => e.event_type === 'sale'),
      checkout: events.some(e => e.event_type === 'checkout'),
    };
  });

  return NextResponse.json({
    ready: true, days,
    totals: {
      clicks: rows.length,
      with_gclid: rows.filter(r => r.gclid).length,
      second_page: rows.filter(r => r.distinct_pages > 1).length,
      checkouts: rows.filter(r => r.checkout).length,
      sales: rows.filter(r => r.sale).length,
    },
    clicks: rows.slice(0, 500),
  });
}
