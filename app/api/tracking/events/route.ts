import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { readPeriod } from '@/lib/tracking/period';
import { listEvents } from '@/lib/tracking/lists';
import { linkSaleToVisit, unmatchedSales } from '@/lib/tracking/manualSale';

export const dynamic = 'force-dynamic';

/**
 * Vendas e checkouts da tela de Rastreamento, com o clique de cada um.
 *
 * GET ?type=sale|checkout&period=…   a lista; nas vendas, também as que chegaram sem campanha
 * GET ?type=unmatched                 as vendas sem campanha ainda não ligadas (últimos 30 dias)
 * POST { click_id, unmatched_id? | amount, currency, order }   liga a venda à visita (lib/tracking/manualSale.ts)
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const db = supabaseAdmin();
  if (q.get('type') === 'unmatched') return NextResponse.json({ sales: await unmatchedSales(db, user.id) });
  const period = readPeriod(q);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });
  const type = q.get('type') === 'checkout' ? 'checkout' : 'sale';
  const [result, unmatched] = await Promise.all([
    listEvents(db, user.id, period.since, period.until, period, type),
    type === 'sale' ? unmatchedSales(db, user.id, period) : Promise.resolve([]),
  ]);
  return NextResponse.json({ from: period.from, to: period.to, ...result, unmatched });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body.click_id) return NextResponse.json({ error: 'Escolha a visita.' }, { status: 400 });
  const result = await linkSaleToVisit(supabaseAdmin(), user.id, {
    clickId: String(body.click_id), unmatchedId: body.unmatched_id ? String(body.unmatched_id) : undefined,
    amount: Number(body.amount), currency: body.currency ? String(body.currency) : undefined, order: body.order ? String(body.order) : undefined,
  });
  return 'error' in result ? NextResponse.json(result, { status: 400 }) : NextResponse.json(result);
}
