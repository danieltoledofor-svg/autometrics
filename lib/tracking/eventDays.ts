import type { SupabaseClient } from '@supabase/supabase-js';
import { clockOf, dayInClock, timeInClock } from './platformClock';

/**
 * As vendas e os checkouts da tela de Rastreamento contam no dia do relógio da
 * plataforma (lib/tracking/platformClock.ts), o mesmo dia em que entram no
 * painel. Assim as duas telas mostram as mesmas vendas em cada dia.
 */

export type Clocks = Record<string, unknown> | null;

/** Os relógios escolhidos pelo usuário. Antes de migration_relogio_plataformas.sql, só os padrões. */
export async function userClocks(db: SupabaseClient, userId: string): Promise<Clocks> {
  const { data } = await db.from('user_settings').select('platform_clocks').eq('user_id', userId).maybeSingle();
  return data?.platform_clocks && typeof data.platform_clocks === 'object' ? data.platform_clocks : null;
}

/**
 * Janela de busca no banco para um período: um dia a mais de cada lado, porque
 * o dia de uma plataforma começa e termina em outra hora que o de Brasília.
 * Depois `inDays` deixa só o que é do período.
 */
export function widen(since: string, until: string) {
  return { since: new Date(Date.parse(since) - 86400000).toISOString(), until: new Date(Date.parse(until) + 86400000).toISOString() };
}

type Event = { source?: string | null; created_at: string };

/** O evento aconteceu entre os dias `from` e `to`, no relógio da plataforma dele? */
export function inDays(e: Event, clocks: Clocks, from: string, to: string) {
  const day = dayInClock(clockOf(e.source || '', clocks), new Date(e.created_at));
  return day >= from && day <= to;
}

/** Dia e hora do evento no relógio da plataforma dele, para mostrar na tela. */
export const clockStamp = (e: Event, clocks: Clocks) => timeInClock(clockOf(e.source || '', clocks), new Date(e.created_at));
