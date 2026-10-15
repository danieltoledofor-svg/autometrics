"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { SALE_EVENT, closeSale, startSaleAlerts, usePendingSales, type PendingSale } from '@/lib/saleAlerts';

/**
 * Aviso de venda em qualquer tela (fica no layout). A venda que chega com o
 * Autometrics aberto ganha um cartão e o som; as que chegaram com ele fechado
 * viram um lembrete que leva à Dashboard, onde a lista completa fica no alto.
 * A lógica mora em lib/saleAlerts.ts.
 */

const SOUND_URL = '/sounds/nova-venda.mp3';
const SOUND_THROTTLE_MS = 3000;   // várias vendas juntas não viram barulho
const MAX_CARDS = 5;

export const saleMoney = (amount: number, currency: string, digits = 2) => {
  try {
    return new Intl.NumberFormat(currency === 'BRL' ? 'pt-BR' : currency === 'EUR' ? 'de-DE' : 'en-US',
      { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch { return `${currency} ${amount.toFixed(digits)}`; }   // moeda que o navegador não conhece
};

export default function SaleAlerts() {
  const pending = usePendingSales();
  const pathname = usePathname();
  const [reminderClosed, setReminderClosed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSoundRef = useRef(0);

  useEffect(() => startSaleAlerts(), []);


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
    window.addEventListener(SALE_EVENT, playSound);
    return () => window.removeEventListener(SALE_EVENT, playSound);
  }, [playSound]);

  const cards = pending.filter(s => s.fresh).slice(0, MAX_CARDS);
  // Vendas que chegaram com o Autometrics fechado: a lista está no alto da Dashboard.
  const waiting = pending.length - cards.length;
  const showReminder = waiting > 0 && !reminderClosed && pathname !== '/dashboard';
  if (!cards.length && !showReminder) return null;

  return (
    <div aria-live="polite" className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 flex flex-col gap-3 w-[19rem] md:w-[21rem] pointer-events-none">
      {showReminder && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-pos/30 bg-surface-1 shadow-lg px-4 py-3">
          <span className="text-xl leading-none" aria-hidden="true">🎉</span>
          <Link href="/dashboard" className="flex-1 min-w-0 text-[13px] font-medium leading-snug text-ink hover:underline">
            {waiting === 1 ? '1 venda nova para ver' : `${waiting} vendas novas para ver`}
            <span className="block text-xs font-normal text-ink-subtle">Abrir a Dashboard</span>
          </Link>
          <button onClick={() => setReminderClosed(true)} title="Fechar" aria-label="Fechar o aviso de vendas novas"
            className="p-1 rounded-lg transition-colors text-ink-subtle hover:text-ink hover:bg-surface-2">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      {cards.map(s => <SaleCard key={s.id} sale={s} />)}
    </div>
  );
}

// As cores vêm dos tokens do guia (DESIGN.md) e seguem o <html data-theme> sozinhas.
function SaleCard({ sale }: { sale: PendingSale }) {
  // Sem fechamento automático: o cartão fica até o usuário clicar no ✕, e fechar marca a venda como vista.

  // Valor cheio no bloco verde só cabe até 6 dígitos; acima disso, sem centavos.
  const amountText = saleMoney(sale.amount, sale.currency, sale.amount >= 10000 ? 0 : 2);

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
        className="sale-alert pointer-events-auto flex rounded-xl overflow-hidden border border-pos/30 bg-surface-1 shadow-lg"
      >
        {/* Bloco do valor */}
        <div className="shrink-0 w-[6.5rem] px-2 py-3 flex flex-col items-center justify-center text-center bg-pos text-white">
          <span className="text-2xl leading-none mb-1 sale-emoji" aria-hidden="true">🎉</span>
          <span className="text-[11px] font-medium text-white/80">Venda</span>
          <b className="text-lg font-semibold tabular-nums leading-tight break-all">{amountText}</b>
        </div>

        {/* Dados */}
        <div className="flex-1 min-w-0 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-pos">Nova venda</span>
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-surface-3 text-ink-subtle">
              {sale.platform}
            </span>
            <button
              onClick={() => closeSale(sale.id)}
              className="ml-auto -mt-1 -mr-1 p-1 rounded-lg transition-colors text-ink-subtle hover:text-ink hover:bg-surface-2"
              title="Fechar"
              aria-label={`Fechar o aviso da venda de ${sale.productName}`}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>

          <p className="text-[13px] font-medium leading-snug break-words text-ink">
            {sale.productName}
          </p>
          {sale.campaignName && sale.campaignName !== sale.productName && (
            <p className="text-xs leading-snug mt-0.5 break-words text-ink-subtle">
              {sale.campaignName}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
