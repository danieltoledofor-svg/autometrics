"use client";

import React, { useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { adjustText, type GoogleControl } from './useGoogleControls';

/**
 * Coluna "Ajuste de lance" das tabelas de aparelho, idade, gênero, renda e local:
 * mostra o ajuste que está no Google e deixa alterar ali mesmo, em dois
 * passos (digitar e confirmar). A alteração vale no Google Ads.
 */
export function BidCell({ control, isDark, onChange, missing }: { control?: GoogleControl; isDark: boolean; onChange: (value: number) => Promise<string>; missing?: string }) {
  const [step, setStep] = useState<'ver' | 'digitar' | 'confirmar' | 'enviando'>('ver');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const muted = isDark ? 'text-slate-500' : 'text-slate-400';

  if (!control || !control.editable) {
    return <span className={`text-xs ${muted} cursor-help`} title={control?.note || missing || 'O Google não tem ajuste de lance para esta linha nesta campanha.'}>{control ? 'excluído' : missing ? 'fora dos locais' : '—'}</span>;
  }

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

/**
 * Meta de CPA do grupo de anúncios, na coluna "Lance / meta": mostra a meta do
 * grupo (ou a da campanha, quando ele não tem a própria) e deixa alterar ali
 * mesmo. Em branco, o grupo volta a seguir a meta da campanha.
 */
export function CpaCell({ control, symbol, inherited, isDark, onChange }: { control: GoogleControl; symbol: string; inherited: React.ReactNode; isDark: boolean; onChange: (value: number) => Promise<string> }) {
  const [step, setStep] = useState<'ver' | 'digitar' | 'confirmar' | 'enviando'>('ver');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const muted = isDark ? 'text-slate-500' : 'text-slate-400';
  const money = (v: number) => `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const value = text.trim() === '' ? 0 : Number(text.replace(',', '.'));
  const valid = Number.isFinite(value) && value >= 0 && value !== (control.value || 0);
  const field = `w-20 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-indigo-500 ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`;
  const small = 'text-[11px] font-bold px-1.5 py-0.5 rounded';

  if (step === 'ver') {
    return (
      <span className="inline-flex items-center justify-end gap-1.5">
        <span className="text-xs">{control.value ? `CPA ${money(control.value)}` : inherited}</span>
        <button onClick={e => { e.stopPropagation(); setText(control.value ? String(control.value) : ''); setError(''); setStep('digitar'); }}
          aria-label={`Alterar a meta de CPA do grupo ${control.label}`} className={`${muted} hover:text-indigo-400`}><Pencil size={12} /></button>
        {error && <span className="text-[11px] text-rose-500 max-w-[220px] truncate" title={error}>{error}</span>}
      </span>
    );
  }
  if (step === 'digitar') {
    return (
      <span className="inline-flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
        <span className={`text-xs ${muted}`}>{symbol}</span>
        <input autoFocus value={text} onChange={e => setText(e.target.value)} inputMode="decimal" placeholder="da campanha"
          onKeyDown={e => { if (e.key === 'Enter' && valid) setStep('confirmar'); if (e.key === 'Escape') setStep('ver'); }} className={field} aria-label="Nova meta de CPA do grupo" />
        <button disabled={!valid} onClick={() => setStep('confirmar')} className={`${small} bg-indigo-600 text-white disabled:opacity-40`}>OK</button>
        <button onClick={() => setStep('ver')} className={`${small} ${muted}`}>Cancelar</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
      <span className="text-[11px] text-amber-500 whitespace-nowrap">Meta do grupo: de {control.value ? money(control.value) : 'a da campanha'} para {value ? money(value) : 'a da campanha'}</span>
      <button disabled={step === 'enviando'} className={`${small} bg-amber-500 text-black disabled:opacity-60 inline-flex items-center gap-1`}
        onClick={async () => { setStep('enviando'); const problem = await onChange(value); setError(problem); setStep('ver'); }}>
        {step === 'enviando' && <Loader2 size={10} className="animate-spin" />} Alterar no Google
      </button>
      {step !== 'enviando' && <button onClick={() => setStep('ver')} className={`${small} ${muted}`}>Cancelar</button>}
    </span>
  );
}
