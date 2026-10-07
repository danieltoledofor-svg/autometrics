"use client";

import React, { useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { adjustText, type GoogleControl } from './useGoogleControls';

/**
 * Coluna "Ajuste de lance" das tabelas de aparelho, idade, gênero e local:
 * mostra o ajuste que está no Google e deixa alterar ali mesmo, em dois
 * passos (digitar e confirmar). A alteração vale no Google Ads.
 */
export function BidCell({ control, isDark, onChange }: { control?: GoogleControl; isDark: boolean; onChange: (value: number) => Promise<string> }) {
  const [step, setStep] = useState<'ver' | 'digitar' | 'confirmar' | 'enviando'>('ver');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const muted = isDark ? 'text-slate-500' : 'text-slate-400';

  if (!control) return <span className={`text-xs ${muted}`} title="O Google não tem ajuste de lance para esta linha nesta campanha.">—</span>;

  const value = Number(text.replace(',', '.'));
  const min = control.kind === 'aparelho' ? -100 : -90;
  const valid = text.trim() !== '' && Number.isFinite(value) && value >= min && value <= 900;
  const field = `w-16 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-indigo-500 ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`;
  const small = 'text-[11px] font-bold px-1.5 py-0.5 rounded';

  if (step === 'ver') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`text-xs tabular-nums ${control.value ? (control.value > 0 ? 'text-emerald-400' : 'text-rose-400') : muted}`}>{adjustText(control.value, control.mixed)}</span>
        <button onClick={e => { e.stopPropagation(); setText(control.value ? String(control.value) : ''); setError(''); setStep('digitar'); }}
          aria-label={`Alterar o ajuste de lance de ${control.label}`} className={`${muted} hover:text-indigo-400`}><Pencil size={12} /></button>
        {error && <span className="text-[11px] text-rose-500 max-w-[220px] truncate" title={error}>{error}</span>}
      </span>
    );
  }
  if (step === 'digitar') {
    return (
      <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <input autoFocus value={text} onChange={e => setText(e.target.value)} inputMode="decimal" placeholder="0"
          onKeyDown={e => { if (e.key === 'Enter' && valid) setStep('confirmar'); if (e.key === 'Escape') setStep('ver'); }} className={field} aria-label="Novo ajuste em %" />
        <span className={`text-xs ${muted}`}>%</span>
        <button disabled={!valid} onClick={() => setStep('confirmar')} className={`${small} bg-indigo-600 text-white disabled:opacity-40`}>OK</button>
        <button onClick={() => setStep('ver')} className={`${small} ${muted}`}>Cancelar</button>
        {text.trim() !== '' && !valid && <span className="text-[11px] text-amber-500">de {min}% a +900%</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <span className="text-[11px] text-amber-500 whitespace-nowrap">{control.label}: de {adjustText(control.value, control.mixed)} para {adjustText(value) === '—' ? 'sem ajuste' : adjustText(value)}</span>
      <button disabled={step === 'enviando'} className={`${small} bg-amber-500 text-black disabled:opacity-60 inline-flex items-center gap-1`}
        onClick={async () => { setStep('enviando'); const problem = await onChange(value); setError(problem); setStep('ver'); }}>
        {step === 'enviando' && <Loader2 size={10} className="animate-spin" />} Alterar no Google
      </button>
      {step !== 'enviando' && <button onClick={() => setStep('ver')} className={`${small} ${muted}`}>Cancelar</button>}
    </span>
  );
}
