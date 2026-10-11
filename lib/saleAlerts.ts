"use client";

import { useSyncExternalStore } from 'react';
import { supabase } from './supabaseClient';

/**
 * Vendas que chegaram e o usuário ainda não marcou como vistas.
 *
 * Vale em qualquer tela: app/components/SaleAlerts.tsx (no layout) liga a
 * escuta e mostra o cartão da venda; a Dashboard mostra a lista no alto. A
 * venda fica pendente até ser fechada, mesmo que tenha chegado com o
 * Autometrics fechado — o que já foi visto fica guardado no navegador.
 *
 * A venda chega pelo aviso do banco na hora (postback_events) e, por garantia,
 * por uma olhada a cada 30 segundos: aviso perdido numa queda de conexão
 * aparece na olhada seguinte.
 */

export interface PendingSale {
  id: string;
  at: string;
  amount: number;
  currency: string;
  platform: string;
  productId: string;
  productName: string;
  campaignName: string;
  /** Chegou com esta tela aberta: ganha cartão e som. */
  fresh: boolean;
}

/** Disparado na janela quando chega venda nova, para as telas atualizarem os números na hora. */
export const SALE_EVENT = 'autometrics:sale';

const LOOK_BACK_MS = 72 * 3600 * 1000;   // venda mais antiga que isso não volta a ser avisada
const NONE: PendingSale[] = [];

let pending: PendingSale[] = NONE;
let userId = '';
let ack = { since: '', closed: [] as string[] };
let firstLook = true, busy = false, again = false;
const names = new Map<string, { name: string; campaign: string }>();
const listeners = new Set<() => void>();

const emit = (next: PendingSale[]) => { pending = next.length ? next : NONE; listeners.forEach(l => l()); };
const ackKey = () => `autometrics_sales_ack_${userId}`;
const saveAck = () => { try { localStorage.setItem(ackKey(), JSON.stringify(ack)); } catch { /* sem armazenamento */ } };
const loadAck = () => {
  ack = { since: new Date().toISOString(), closed: [] };          // primeira vez: só o que chegar daqui para a frente
  try {
    const saved = JSON.parse(localStorage.getItem(ackKey()) || 'null');
    if (saved && typeof saved.since === 'string' && !Number.isNaN(Date.parse(saved.since))) ack = { since: saved.since, closed: Array.isArray(saved.closed) ? saved.closed.map(String) : [] };
    else saveAck();
  } catch { /* sem armazenamento */ }
};

async function look() {
  if (!userId) return;
  if (busy) { again = true; return; }
  busy = true;
  const uid = userId;
  try {
    const floor = new Date(Date.now() - LOOK_BACK_MS).toISOString();
    // O banco só devolve as vendas das campanhas do próprio usuário.
    const { data, error } = await supabase.from('postback_events')
      .select('id, product_id, amount, currency, source, created_at')
      .eq('event_type', 'sale').gt('created_at', ack.since > floor ? ack.since : floor)
      .order('created_at', { ascending: false }).limit(50);
    if (error || uid !== userId) return;
    const closed = new Set(ack.closed);
    const rows = (data || []).filter(r => !closed.has(String(r.id)));

    const unknown = [...new Set(rows.map(r => r.product_id).filter(id => id && !names.has(id)))];
    if (unknown.length) {
      const { data: products } = await supabase.from('products').select('id, name, google_ads_campaign_name').in('id', unknown);
      for (const p of products || []) names.set(p.id, { name: p.name || '', campaign: p.google_ads_campaign_name || '' });
      if (uid !== userId) return;
    }

    const before = new Map(pending.map(s => [s.id, s]));
    const next: PendingSale[] = rows.map(r => {
      const id = String(r.id), product = names.get(r.product_id);
      return {
        id, at: r.created_at, amount: Number(r.amount) || 0, currency: String(r.currency || 'USD').toUpperCase(), platform: r.source || 'Plataforma',
        productId: r.product_id, productName: product?.name || product?.campaign || 'Campanha', campaignName: product?.campaign || '',
        fresh: before.get(id)?.fresh ?? !firstLook,
      };
    });
    const arrived = next.some(s => !before.has(s.id)) && !firstLook;
    firstLook = false;
    if (next.length !== pending.length || next.some((s, i) => s.id !== pending[i].id)) emit(next);
    if (arrived) window.dispatchEvent(new Event(SALE_EVENT));
  } finally {
    busy = false;
    if (again) { again = false; look(); }
  }
}

/** Liga a escuta de vendas. Chamado uma vez, pelo layout. Devolve como desligar. */
export function startSaleAlerts(): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const setUser = (id: string) => {
    if (id === userId) return;
    if (channel) { supabase.removeChannel(channel); channel = null; }
    userId = id; firstLook = true; names.clear(); emit(NONE);
    if (!id) return;
    loadAck();
    channel = supabase.channel(`sale-alerts-${id}`)
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'postback_events' },
        (payload: any) => { if (payload.new?.event_type === 'sale') look(); })
      .subscribe();
    look();
  };

  supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user?.id || ''));
  const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user?.id || ''));
  const visible = () => { if (!document.hidden) look(); };
  const timer = setInterval(visible, 30 * 1000);
  document.addEventListener('visibilitychange', visible);

  return () => {
    auth.subscription.unsubscribe();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visible);
    if (channel) supabase.removeChannel(channel);
    userId = ''; emit(NONE);
  };
}

/** Marca uma venda como vista: ela some do cartão e da lista da Dashboard. */
export function closeSale(id: string) {
  if (!ack.closed.includes(id)) ack.closed = [...ack.closed, id].slice(-300);
  saveAck();
  emit(pending.filter(s => s.id !== id));
}

/** Marca todas como vistas. */
export function closeAllSales() {
  ack.closed = [...new Set([...ack.closed, ...pending.map(s => s.id)])].slice(-300);
  saveAck();
  emit(NONE);
}

export function usePendingSales(): PendingSale[] {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => pending,
    () => NONE,
  );
}
