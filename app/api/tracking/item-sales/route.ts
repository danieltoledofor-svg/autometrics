import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { fetchAll } from '@/lib/analysis/compute';
import { inDays, userClocks, widen } from '@/lib/tracking/eventDays';
import type { ItemSalesPayload } from '@/lib/metrics/itemSales';

export const dynamic = 'force-dynamic';

/**
 * Vendas e reembolsos da campanha no período, com o clique de cada um, para as
 * tabelas por item (grupos, anúncios, palavras-chave, aparelho, país) contarem a
 * venda inteira no item certo. Só lê do banco.
 *
 * GET ?product_id=…&from=AAAA-MM-DD&to=AAAA-MM-DD
 *
 * O dia de cada evento é o do relógio da plataforma, o mesmo da Visão Geral.
 * Reembolso sem clique herda o clique da venda do mesmo pedido.
 */

const validDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const CLICK_COLUMNS = 'click_id, ad_group_id, ad_id, keyword, match_type, device, country, params';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const productId = q.get('product_id');
  const from = q.get('from'), to = q.get('to');
  if (!productId || !validDay(from) || !validDay(to)) return NextResponse.json({ error: 'Informe a campanha e o período.' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: product } = await db.from('products').select('id').eq('id', productId).eq('user_id', user.id).maybeSingle();
  if (!product) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

  const window = widen(`${from}T00:00:00Z`, `${to}T23:59:59Z`);
  const [clocks, raw] = await Promise.all([
    userClocks(db, user.id),
    fetchAll((a, b) => db.from('postback_events')
      .select('event_type, amount, currency, source, transaction_id, click_id, created_at')
      .eq('product_id', productId).in('event_type', ['sale', 'refund'])
      .gte('created_at', window.since).lte('created_at', window.until).order('created_at').range(a, b))
      .catch(() => [] as any[]),
  ]);
  const events = raw.filter(e => inDays(e, clocks, from, to));

  // Reembolso sem clique: o clique da venda do mesmo pedido (que pode ser de antes do período).
  const orphanTids = [...new Set(events.filter(e => e.event_type === 'refund' && !e.click_id && e.transaction_id).map(e => e.transaction_id))];
  const clickOfTid = new Map<string, string>();
  for (let i = 0; i < orphanTids.length; i += 200) {
    const { data } = await db.from('postback_events').select('transaction_id, click_id')
      .eq('product_id', productId).eq('event_type', 'sale').in('transaction_id', orphanTids.slice(i, i + 200)).not('click_id', 'is', null);
    for (const s of data || []) clickOfTid.set(s.transaction_id, s.click_id);
  }
  const clickIdOf = (e: any): string | null => e.click_id || (e.transaction_id && clickOfTid.get(e.transaction_id)) || null;

  const ids = [...new Set(events.map(clickIdOf).filter(Boolean))] as string[];
  const clicks = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('tracking_clicks').select(CLICK_COLUMNS).eq('user_id', user.id).in('click_id', ids.slice(i, i + 200));
    for (const c of data || []) clicks.set(c.click_id, c);
  }

  const payload: ItemSalesPayload = { events: [], untracked: 0 };
  for (const e of events) {
    const c = clicks.get(clickIdOf(e) || '');
    if (!c) { if (e.event_type === 'sale') payload.untracked++; continue; }
    const target = String(c.params?.targetid || '');
    payload.events.push({
      kind: e.event_type,
      amount: Number(e.amount) || 0,
      currency: e.currency || null,
      ad_group_id: c.ad_group_id || null,
      ad_id: c.ad_id || null,
      criterion_id: target.match(/kwd-(\d+)/)?.[1] || null,
      keyword: c.keyword || null,
      match_type: c.match_type || null,
      device: c.device || null,
      country: c.country || null,
    });
  }
  return NextResponse.json(payload);
}
