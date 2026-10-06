import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { trackingOverview } from '@/lib/tracking/overview';

export const dynamic = 'force-dynamic';

/**
 * Tela de Rastreamento: do clique à venda, em todas as campanhas do usuário.
 *
 * GET ?period=today|d3|d7|custom[&from=AAAA-MM-DD&to=AAAA-MM-DD]
 *
 * Os dias são os de Brasília.
 */

const BRT = 3 * 3600000;                                          // Brasília = UTC−3, sem horário de verão
const DAY = 86400000;
const validDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) + BRT;
const today = () => new Date(Date.now() - BRT).toISOString().slice(0, 10);

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });

  const period = q.get('period') || 'd7';
  let from = today(), to = today();
  if (period === 'custom') {
    if (!validDay(q.get('from')) || !validDay(q.get('to'))) return NextResponse.json({ error: 'Informe as duas datas.' }, { status: 400 });
    from = q.get('from')!; to = q.get('to')!;
    if (from > to) [from, to] = [to, from];
    if (dayStart(to) - dayStart(from) > 92 * DAY) return NextResponse.json({ error: 'Escolha um período de até 3 meses.' }, { status: 400 });
  } else {
    const back = period === 'today' ? 0 : period === 'd3' ? 2 : 6;
    from = new Date(dayStart(to) - BRT - back * DAY).toISOString().slice(0, 10);
  }
  const since = new Date(dayStart(from)).toISOString();
  const until = new Date(dayStart(to) + DAY).toISOString();

  const overview = await trackingOverview(supabaseAdmin(), user.id, since, until);
  if (!overview) return NextResponse.json({ ready: false, error: 'O rastreamento ainda não foi ligado nesta conta.' });
  return NextResponse.json({ ready: true, from, to, ...overview });
}
