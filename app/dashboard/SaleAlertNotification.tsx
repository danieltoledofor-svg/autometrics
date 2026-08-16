"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { X, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

interface SaleNotification {
  id: string;
  platform: string;
  amount: number;
  currency: string;
  campaignName: string;
}

interface Props {
  products: any[];
  isDark: boolean;
}

export default function SaleAlertNotification({ products, isDark }: Props) {
  const [notifications, setNotifications] = useState<SaleNotification[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  useEffect(() => {
    if (!products.length) return;

    const productMap = new Map(products.map(p => [p.id, p]));
    const productIds = new Set(products.map(p => p.id));

    const channel = supabase
      .channel('sale-alerts')
      .on(
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'postback_events' },
        (payload: any) => {
          const row = payload.new;
          if (row.event_type !== 'sale') return;
          if (!productIds.has(row.product_id)) return;

          const product = productMap.get(row.product_id);
          setNotifications(prev =>
            [
              {
                id: row.id ?? `${Date.now()}-${Math.random()}`,
                platform: row.source || 'Plataforma',
                amount: Number(row.amount ?? 0),
                currency: (row.currency || 'BRL').toUpperCase(),
                campaignName: product?.name || 'Campanha Desconhecida',
              },
              ...prev,
            ].slice(0, 5)
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [products]);

  if (!notifications.length) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 w-80 pointer-events-none">
      {notifications.map(n => (
        <NotificationCard key={n.id} notification={n} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: SaleNotification;
  onDismiss: (id: string) => void;
}) {
  const fmt = new Intl.NumberFormat(
    notification.currency === 'BRL' ? 'pt-BR' : notification.currency === 'EUR' ? 'de-DE' : 'en-US',
    { style: 'currency', currency: notification.currency }
  ).format(notification.amount);

  return (
    <>
      <style>{`
        @keyframes sale-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.6), 0 20px 40px -8px rgba(16,185,129,0.3); }
          50%       { box-shadow: 0 0 0 7px rgba(16,185,129,0),  0 20px 40px -8px rgba(16,185,129,0.3); }
        }
        .sale-alert { animation: sale-pulse 1.2s ease-in-out 4; }
      `}</style>
      <div className="sale-alert pointer-events-auto flex items-start gap-3 p-4 rounded-2xl bg-emerald-950 border border-emerald-500 shadow-xl">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <TrendingUp size={18} className="text-emerald-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
              Nova Venda!
            </span>
            <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
              {notification.platform}
            </span>
          </div>
          <p className="text-xl font-bold text-white leading-tight">{fmt}</p>
          <p className="text-xs text-emerald-300/60 truncate mt-0.5">{notification.campaignName}</p>
        </div>

        <button
          onClick={() => onDismiss(notification.id)}
          className="shrink-0 mt-0.5 p-1 rounded-lg text-emerald-500/50 hover:text-white hover:bg-emerald-500/20 transition-colors"
          title="Fechar"
        >
          <X size={14} />
        </button>
      </div>
    </>
  );
}
