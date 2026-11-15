import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/analysis/compute';
import { dayInClock, platformKey } from './platformClock';

/**
 * Troca do relógio de uma plataforma: as vendas que já chegaram mudam de dia
 * também no painel.
 *
 * O postback soma cada venda em daily_metrics no dia do relógio daquele
 * momento. A aba Vendas recalcula o dia pelo relógio atual, mas a Dashboard lê
 * o total guardado. Sem isto, ao trocar o relógio a venda ia para ontem em
 * Vendas e ficava em hoje na Dashboard.
 *
 * Para cada evento da plataforma em que o dia no relógio antigo (`from`) é
 * diferente do dia no novo (`to`), tira do dia antigo e põe no novo: venda,
 * valor, checkout, visita e reembolso. O lançamento manual (QuickEntry) do dia
 * não é tocado: só o que o evento somou sai e entra.
 */

const DAYS_BACK = 120;

type Delta = { conversions: number; conversion_value: number; checkouts: number; visits: number; refunds: number };
const empty = (): Delta => ({ conversions: 0, conversion_value: 0, checkouts: 0, visits: 0, refunds: 0 });

async function usdBrl(): Promise<number> {
  try {
    const fx = await (await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')).json();
    return parseFloat(fx?.USDBRL?.bid || '6.00') || 6;
  } catch { return 6; }
}

export async function refileClock(db: SupabaseClient, userId: string, platform: string, from: string, to: string) {
  const key = platformKey(platform);
  if (!key || from === to) return { moved: 0 };

  const { data: products } = await db.from('products').select('id, currency').eq('user_id', userId);
  const currencyOf = new Map((products || []).map(p => [p.id, String(p.currency || 'BRL').toUpperCase()]));
  const ids = [...currencyOf.keys()];
  if (!ids.length) return { moved: 0 };

  const since = new Date(Date.now() - DAYS_BACK * 86400000).toISOString();
  const events: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    events.push(...await fetchAll((a, b) => db.from('postback_events')
      .select('product_id, event_type, amount, currency, source, created_at')
      .in('product_id', chunk).gte('created_at', since).order('created_at').range(a, b)));
  }

  let rate: number | null = null;
  // product|dia → o que muda naquele dia
  const deltas = new Map<string, Delta>();
  const add = (pid: string, day: string, field: keyof Delta, v: number) => {
    const k = `${pid}|${day}`;
    if (!deltas.has(k)) deltas.set(k, empty());
    deltas.get(k)![field] += v;
  };
  let moved = 0;
  for (const e of events) {
    if (platformKey(e.source || '') !== key) continue;
    const at = new Date(e.created_at);
    const oldDay = dayInClock(from, at);
    const newDay = dayInClock(to, at);
    if (oldDay === newDay) continue;

    let value = Number(e.amount) || 0;
    const cur = String(e.currency || '').toUpperCase();
    const pcur = currencyOf.get(e.product_id) || 'BRL';
    if (cur && cur !== pcur && value > 0) {
      rate ??= await usdBrl();
      if (cur === 'USD' && pcur === 'BRL') value *= rate;
      if (cur === 'BRL' && pcur === 'USD') value /= rate;
    }
    const move = (field: keyof Delta, v: number) => { add(e.product_id, oldDay, field, -v); add(e.product_id, newDay, field, v); };
    if (e.event_type === 'sale') { move('conversions', 1); move('conversion_value', value); }
    else if (e.event_type === 'checkout') move('checkouts', 1);
    else if (e.event_type === 'click') move('visits', 1);
    else if (e.event_type === 'refund') move('refunds', value);
    else continue;
    moved++;
  }

  for (const [k, d] of deltas) {
    const [pid, date] = k.split('|');
    const { data: row } = await db.from('daily_metrics')
      .select('conversions, conversion_value, checkouts, visits, refunds')
      .eq('product_id', pid).eq('date', date).maybeSingle();
    const next = (field: keyof Delta) => Math.max(0, Number((row as any)?.[field] ?? 0) + d[field]);
    const { error } = await db.from('daily_metrics').upsert({
      product_id: pid, date, currency: currencyOf.get(pid),
      conversions: next('conversions'), conversion_value: next('conversion_value'),
      checkouts: next('checkouts'), visits: next('visits'), refunds: next('refunds'),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id, date' });
    if (error) throw new Error(error.message);
  }
  return { moved };
}
