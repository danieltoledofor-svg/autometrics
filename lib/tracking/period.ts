/**
 * Período das telas de rastreamento, nos dias de Brasília.
 * ?period=today|d3|d7|custom[&from=AAAA-MM-DD&to=AAAA-MM-DD]
 */

const BRT = 3 * 3600000;                                          // Brasília = UTC−3, sem horário de verão
const DAY = 86400000;
const validDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) + BRT;
const today = () => new Date(Date.now() - BRT).toISOString().slice(0, 10);

export function readPeriod(q: URLSearchParams): { from: string; to: string; since: string; until: string } | { error: string } {
  const period = q.get('period') || 'd7';
  let from = today(), to = today();
  if (period === 'custom') {
    if (!validDay(q.get('from')) || !validDay(q.get('to'))) return { error: 'Informe as duas datas.' };
    from = q.get('from')!; to = q.get('to')!;
    if (from > to) [from, to] = [to, from];
    if (dayStart(to) - dayStart(from) > 92 * DAY) return { error: 'Escolha um período de até 3 meses.' };
  } else {
    const back = period === 'today' ? 0 : period === 'd3' ? 2 : 6;
    from = new Date(dayStart(to) - BRT - back * DAY).toISOString().slice(0, 10);
  }
  return { from, to, since: new Date(dayStart(from)).toISOString(), until: new Date(dayStart(to) + DAY).toISOString() };
}
