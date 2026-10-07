import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { readPeriod } from '@/lib/tracking/period';
import { listEvents } from '@/lib/tracking/lists';

export const dynamic = 'force-dynamic';

/**
 * Vendas e checkouts da tela de Rastreamento, com o clique de cada um.
 *
 * GET ?type=sale|checkout&period=…
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const period = readPeriod(q);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });
  const type = q.get('type') === 'checkout' ? 'checkout' : 'sale';
  return NextResponse.json({ from: period.from, to: period.to, ...(await listEvents(supabaseAdmin(), user.id, period.since, period.until, type)) });
}
