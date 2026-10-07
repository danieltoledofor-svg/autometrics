import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { readPeriod } from '@/lib/tracking/period';
import { listVisits, visitDetail } from '@/lib/tracking/lists';

export const dynamic = 'force-dynamic';

/**
 * Visitas da tela de Rastreamento.
 *
 * GET ?id=<clique>                         uma visita inteira
 * GET ?period=…&page=0[&product_id=&traffic=&device=&q=&bought=1&bots=1]   a lista, 50 por página
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const db = supabaseAdmin();

  const id = q.get('id');
  if (id) {
    const visit = await visitDetail(db, user.id, id);
    return visit ? NextResponse.json(visit) : NextResponse.json({ error: 'Visita não encontrada.' }, { status: 404 });
  }

  const period = readPeriod(q);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });
  const result = await listVisits(db, user.id, period.since, period.until, {
    productId: q.get('product_id') || undefined, traffic: q.get('traffic') || undefined, device: q.get('device') || undefined,
    q: q.get('q') || undefined, bought: q.get('bought') === '1', bots: q.get('bots') === '1', page: Number(q.get('page')) || 0,
  });
  if (!result.ready) return NextResponse.json({ ready: false, error: 'Falta rodar a migração das visitas no Supabase.' });
  return NextResponse.json({ from: period.from, to: period.to, ...result });
}
