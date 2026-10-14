import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { trackingOverview } from '@/lib/tracking/overview';
import { readPeriod } from '@/lib/tracking/period';

export const dynamic = 'force-dynamic';

/**
 * Tela de Rastreamento: do clique à venda, em todas as campanhas do usuário.
 *
 * GET ?period=today|yesterday|d3|d7|custom[&from=AAAA-MM-DD&to=AAAA-MM-DD]
 *
 * Os dias das visitas são os de Brasília; os das vendas, os do relógio de cada plataforma.
 */

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });

  const period = readPeriod(q);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });
  const { from, to, since, until } = period;

  const overview = await trackingOverview(supabaseAdmin(), user.id, since, until, { from, to });
  if (!overview) return NextResponse.json({ ready: false, error: 'O rastreamento ainda não foi ligado nesta conta.' });
  return NextResponse.json({ ready: true, from, to, ...overview });
}
