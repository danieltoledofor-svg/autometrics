"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

interface SaleNotification {
  id: string;
  platform: string;
  amount: number;
  currency: string;
  productName: string;
  campaignName: string;
}

interface Props {
  products: any[];
  isDark: boolean;
}

const SOUND_URL = '/sounds/nova-venda.mp3';
const AUTO_DISMISS_MS = 12000;
const SOUND_THROTTLE_MS = 3000;   // várias vendas juntas não viram barulho

export default function SaleAlertNotification({ products, isDark }: Props) {
  const [notifications, setNotifications] = useState<SaleNotification[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSoundRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // O navegador só libera áudio depois de alguma interação na página, então o
  // primeiro clique/tecla destrava o som em silêncio.
  useEffect(() => {
    const audio = new Audio(SOUND_URL);
    audio.volume = 0.5;
    audio.preload = 'auto';
    audioRef.current = audio;

    const unlock = () => {
      audio.muted = true;
      audio.play()
        .then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; })
        .catch(() => { audio.muted = false; });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const playSound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const now = Date.now();
    if (now - lastSoundRef.current < SOUND_THROTTLE_MS) return;
    lastSoundRef.current = now;
    audio.currentTime = 0;
    audio.play().catch(() => { /* navegador ainda não liberou o áudio */ });
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
                productName: product?.name || 'Produto desconhecido',
                campaignName: product?.google_ads_campaign_name || '',
              },
              ...prev,
            ].slice(0, 5)
          );
          playSound();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [products, playSound]);

  if (!notifications.length) return null;

  return (
    <div className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 flex flex-col gap-3 w-[19rem] md:w-[21rem] pointer-events-none">
      {notifications.map(n => (
        <NotificationCard key={n.id} notification={n} onDismiss={dismiss} isDark={isDark} />
      ))}
    </div>
  );
}

function NotificationCard({
  notification,
  onDismiss,
  isDark,
}: {
  notification: SaleNotification;
  onDismiss: (id: string) => void;
  isDark: boolean;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(notification.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [notification.id, onDismiss]);

  // Valor cheio no bloco verde só cabe até 6 dígitos; acima disso, sem centavos.
  const fmt = (digits: number) =>
    new Intl.NumberFormat(
      notification.currency === 'BRL' ? 'pt-BR' : notification.currency === 'EUR' ? 'de-DE' : 'en-US',
      { style: 'currency', currency: notification.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }
    ).format(notification.amount);
  const amountText = notification.amount >= 10000 ? fmt(0) : fmt(2);

  return (
    <>
      <style>{`
        @keyframes sale-in {
          from { opacity: 0; transform: translateY(14px) scale(.97); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes sale-emoji {
          0%, 100% { transform: rotate(0deg) scale(1); }
          30%      { transform: rotate(-12deg) scale(1.15); }
          60%      { transform: rotate(10deg) scale(1.1); }
        }
        .sale-alert  { animation: sale-in .45s cubic-bezier(.16,1,.3,1); }
        .sale-emoji  { animation: sale-emoji 1s ease-in-out 3; display: inline-block; }
      `}</style>

      <div
        className={`sale-alert pointer-events-auto flex rounded-2xl overflow-hidden border shadow-2xl ${
          isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
        }`}
      >
        {/* Bloco do valor */}
        <div className="shrink-0 w-[6.5rem] px-2 py-3 flex flex-col items-center justify-center text-center bg-gradient-to-b from-emerald-500 to-emerald-600">
          <span className="text-2xl leading-none mb-1 sale-emoji">🎉</span>
          <span className="text-[9px] font-extrabold tracking-[0.14em] text-emerald-950/80">VENDA</span>
          <b className="text-lg font-extrabold tracking-tight text-emerald-950 leading-tight break-all">{amountText}</b>
        </div>

        {/* Dados */}
        <div className="flex-1 min-w-0 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-emerald-500">NOVA VENDA</span>
            <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border ${
              isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'
            }`}>
              {notification.platform}
            </span>
            <button
              onClick={() => onDismiss(notification.id)}
              className={`ml-auto -mt-1 -mr-1 p-1 rounded-lg transition-colors ${
                isDark ? 'text-slate-600 hover:text-white hover:bg-slate-800' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Fechar"
            >
              <X size={13} />
            </button>
          </div>

          <p className={`text-[13px] font-bold leading-snug break-words ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {notification.productName}
          </p>
          {notification.campaignName && (
            <p className="text-[11.5px] leading-snug mt-0.5 break-words text-slate-500">
              {notification.campaignName}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
