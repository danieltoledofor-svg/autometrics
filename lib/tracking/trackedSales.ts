import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/analysis/compute';
import { clockOf, dayInClock } from './platformClock';
import { userClocks, widen } from './eventDays';
import type { TrackedEvent } from '@/lib/metrics/itemSales';

/**
 * Vendas e reembolsos de campanhas num período, com o clique de cada um:
 * grupo, anúncio, palavra-chave, aparelho e país. Base das vendas exatas por
 * item nas tabelas (/api/tracking/item-sales) e na análise da IA.
 *
 * O dia de cada evento é o do relógio da plataforma, o mesmo da Visão Geral.
 * Reembolso sem clique herda o clique da venda do mesmo pedido.
 */

export interface DbTrackedEvent extends TrackedEvent {
  product_id: string;
  day: string;
  currency: string | null;
  /** false = venda sem clique ligado: só conta na campanha. */
  linked: boolean;
}

const CLICK_COLUMNS = 'click_id, ad_group_id, ad_id, keyword, match_type, device, country, params';

export async function loadTrackedSales(db: SupabaseClient, userId: string, productIds: string[], from: string, to: string): Promise<DbTrackedEvent[]> {
  if (!productIds.length) return [];
  const window = widen(`${from}T00:00:00Z`, `${to}T23:59:59Z`);
  const clocks = await userClocks(db, userId);
  const raw: any[] = [];
  for (let i = 0; i < productIds.length; i += 150) {
    const chunk = productIds.slice(i, i + 150);
    raw.push(...await fetchAll((a, b) => db.from('postback_events')
      .select('product_id, event_type, amount, currency, source, transaction_id, click_id, created_at')
      .in('product_id', chunk).in('event_type', ['sale', 'refund'])
      .gte('created_at', window.since).lte('created_at', window.until).order('created_at').range(a, b))
      .catch(() => [] as any[]));
  }
  const events = raw
    .map(e => ({ ...e, day: dayInClock(clockOf(e.source || '', clocks), new Date(e.created_at)) }))
    .filter(e => e.day >= from && e.day <= to);

  // Reembolso sem clique: o clique da venda do mesmo pedido (que pode ser de antes do período).
  const orphanTids = [...new Set(events.filter(e => e.event_type === 'refund' && !e.click_id && e.transaction_id).map(e => e.transaction_id))];
  const clickOfTid = new Map<string, string>();
  for (let i = 0; i < orphanTids.length; i += 200) {
    const { data } = await db.from('postback_events').select('product_id, transaction_id, click_id')
      .in('product_id', productIds).eq('event_type', 'sale').in('transaction_id', orphanTids.slice(i, i + 200)).not('click_id', 'is', null);
    for (const s of data || []) clickOfTid.set(`${s.product_id}|${s.transaction_id}`, s.click_id);
  }
  const clickIdOf = (e: any): string | null => e.click_id || (e.transaction_id && clickOfTid.get(`${e.product_id}|${e.transaction_id}`)) || null;

  const ids = [...new Set(events.map(clickIdOf).filter(Boolean))] as string[];
  const clicks = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('tracking_clicks').select(CLICK_COLUMNS).eq('user_id', userId).in('click_id', ids.slice(i, i + 200));
    for (const c of data || []) clicks.set(c.click_id, c);
  }

  return events.map(e => {
    const c = clicks.get(clickIdOf(e) || '');
    const target = String(c?.params?.targetid || '');
    return {
      product_id: e.product_id,
      day: e.day,
      kind: e.event_type,
      amount: Number(e.amount) || 0,
      currency: e.currency || null,
      linked: !!c,
      ad_group_id: c?.ad_group_id || null,
      ad_id: c?.ad_id || null,
      criterion_id: target.match(/kwd-(\d+)/)?.[1] || null,
      keyword: c?.keyword || null,
      match_type: c?.match_type || null,
      device: c?.device || null,
      country: c?.country || null,
    };
  });
}
