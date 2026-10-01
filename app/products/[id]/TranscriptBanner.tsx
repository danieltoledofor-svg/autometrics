"use client";

import React, { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Ui } from '@/app/components/metrics/ColumnPicker';

/**
 * Pedido da transcrição da VSL, no topo das abas Análise e VTurb.
 * Sem transcrição: alerta com "Enviar .txt ou .md" e "Colar o texto".
 * Com transcrição: uma linha com "trocar".
 */
export function TranscriptBanner({ chars, onSave, ui }: { chars: number | null; onSave: (text: string) => Promise<string | null>; ui: Ui }) {
  const { isDark, borderCol, textHead, textMuted } = ui;
  const [changing, setChanging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const save = async (value: string) => {
    if (!value.trim()) { setError('O texto está vazio.'); return; }
    setSaving(true);
    setError(null);
    const err = await onSave(value);
    setSaving(false);
    if (err) setError(err);
    else { setPasting(false); setChanging(false); setText(''); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.(txt|md)$/i.test(f.name)) { setError('Use um arquivo .txt ou .md.'); return; }
    await save(await f.text());
  };

  if (chars && !changing) {
    return (
      <div className={`text-xs ${textMuted} flex items-center gap-1.5`}>
        <span className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>✓</span>
        Transcrição da VSL salva ·{' '}
        <button onClick={() => setChanging(true)} className="text-indigo-400 hover:underline">trocar</button>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border px-4 py-3 space-y-3 ${isDark ? 'border-orange-500/50 bg-orange-500/10' : 'border-orange-300 bg-orange-50'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-sm font-bold flex-1 min-w-[220px] ${isDark ? 'text-orange-300' : 'text-orange-800'}`}>
          {chars ? 'Trocar a transcrição da VSL' : 'Envie a transcrição da VSL desta campanha'}
        </span>
        <input ref={file} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} className="hidden" aria-label="Arquivo da transcrição (.txt ou .md)" />
        <button onClick={() => file.current?.click()} disabled={saving}
          className="text-sm font-bold px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-60 inline-flex items-center gap-1.5">
          {saving && !pasting && <Loader2 size={13} className="animate-spin" />} Enviar .txt ou .md
        </button>
        <button onClick={() => setPasting(p => !p)} disabled={saving}
          className={`text-sm font-semibold px-4 py-2 rounded-lg border ${borderCol} ${textHead}`}>
          Colar o texto
        </button>
        {chars ? <button onClick={() => { setChanging(false); setPasting(false); }} className={`text-xs ${textMuted}`}>cancelar</button> : null}
      </div>
      {pasting && (
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6} autoFocus aria-label="Transcrição da VSL"
            placeholder="Cole aqui a transcrição da VSL"
            className={`w-full rounded-lg border ${borderCol} ${isDark ? 'bg-slate-950' : 'bg-white'} ${textHead} p-3 text-[13px] outline-none focus:border-orange-500`} />
          <button onClick={() => save(text)} disabled={saving}
            className="text-sm font-bold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 inline-flex items-center gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />} Salvar
          </button>
        </div>
      )}
      {error && <div className={`text-xs ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>{error}</div>}
    </div>
  );
}
