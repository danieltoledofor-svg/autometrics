"use client";

import React, { useRef } from 'react';
import { Rows3, Rows4, RotateCcw } from 'lucide-react';
import type { Density, TablePrefsApi } from './useTablePrefs';

/**
 * Visual comum das tabelas de análise.
 *
 * Número é o que se lê: fica claro (quase branco no escuro, quase preto no
 * claro), com dígitos de largura fixa. Cor só quando carrega significado —
 * custo, receita, lucro/ROI positivo ou negativo. Cinza fica para "—",
 * cabeçalhos e textos de apoio.
 */

export interface TableTone {
  text: string;
  head: string;
  muted: string;
  cost: string;
  revenue: string;
  pos: string;
  neg: string;
  warn: string;
  accent: string;
  line: string;
  headerBg: string;
  totalBg: string;
  /** Fundo opaco das linhas (a primeira coluna é fixa e precisa cobrir o que rola por baixo). */
  rowBg: (index: number) => string;
  rowHover: string;
}

export function tableTone(isDark: boolean): TableTone {
  return isDark ? {
    text: 'text-slate-100',
    head: 'text-slate-400',
    muted: 'text-slate-400',
    cost: 'text-orange-300',
    revenue: 'text-sky-300',
    pos: 'text-green-400',
    neg: 'text-rose-400',
    warn: 'text-amber-400',
    accent: 'text-indigo-300',
    line: 'border-slate-800',
    headerBg: 'bg-slate-950',
    totalBg: 'bg-slate-950',
    rowBg: i => (i % 2 ? 'bg-[#111a2b]' : 'bg-slate-900'),
    rowHover: 'group-hover:bg-slate-800',
  } : {
    text: 'text-slate-900',
    head: 'text-slate-600',
    muted: 'text-slate-500',
    cost: 'text-orange-700',
    revenue: 'text-sky-700',
    pos: 'text-green-700',
    neg: 'text-rose-700',
    warn: 'text-amber-700',
    accent: 'text-indigo-600',
    line: 'border-slate-200',
    headerBg: 'bg-slate-100',
    totalBg: 'bg-slate-100',
    rowBg: i => (i % 2 ? 'bg-slate-50' : 'bg-white'),
    rowHover: 'group-hover:bg-indigo-50',
  };
}

/** Cor de um valor conforme o que ele significa. */
export function valueClass(key: string, v: number | null | undefined, tone: TableTone): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return tone.muted;
  if (key === 'cost') return `${tone.cost} font-medium`;
  if (key === 'revenue') return `${tone.revenue} font-medium`;
  if (key === 'profit' || key === 'roi' || key === 'lucro') return `${v >= 0 ? tone.pos : tone.neg} font-medium`;
  if ((key === 'conversions' || key === 'g_conversions') && v > 0) return `${tone.pos} font-medium`;
  return tone.text;
}

/** Espaçamento de cada célula na densidade escolhida. */
export function cellPad(density: Density): string {
  return density === 'compact' ? 'px-2.5 py-1.5' : 'px-3.5 py-3';
}

/** Largura fixada pelo usuário; o conteúdo que não couber vira reticências. */
export function widthStyle(w?: number): React.CSSProperties | undefined {
  return w ? { width: w, minWidth: w, maxWidth: w, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined;
}

/**
 * Cabeçalho com alça de ajuste na borda direita: arraste para mudar a
 * largura, duplo clique volta ao tamanho do conteúdo.
 */
export function Th({ colKey, prefs, className = '', style, title, children }: {
  colKey: string;
  prefs: TablePrefsApi;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLTableCellElement>(null);
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = ref.current;
    if (!th) return;
    const x0 = e.clientX;
    const w0 = th.offsetWidth;
    let last = w0;
    const move = (ev: MouseEvent) => {
      last = Math.max(48, w0 + ev.clientX - x0);
      th.style.width = th.style.minWidth = th.style.maxWidth = `${last}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      prefs.setWidth(colKey, last);
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  return (
    <th ref={ref} title={title} className={`relative ${className}`} style={{ ...style, ...widthStyle(prefs.widths[colKey]) }}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar largura da coluna"
        onMouseDown={start}
        onDoubleClick={e => { e.stopPropagation(); prefs.setWidth(colKey, null); }}
        onClick={e => e.stopPropagation()}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500/70"
      />
    </th>
  );
}

/** Densidade e "restaurar larguras", para a barra de cada tabela. */
export function TableControls({ prefs, isDark }: { prefs: TablePrefsApi; isDark: boolean }) {
  const border = isDark ? 'border-slate-700' : 'border-slate-300';
  const idle = isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100';
  const on = 'bg-indigo-600 text-white';
  const hasWidths = Object.keys(prefs.widths).length > 0;
  return (
    <div className="flex items-center gap-2">
      <div className={`inline-flex rounded-lg border ${border} overflow-hidden`}>
        <button title="Compacto" onClick={() => prefs.setDensity('compact')}
          className={`px-2 py-1.5 ${prefs.density === 'compact' ? on : idle}`}><Rows4 size={14} /></button>
        <button title="Confortável" onClick={() => prefs.setDensity('comfortable')}
          className={`px-2 py-1.5 ${prefs.density === 'comfortable' ? on : idle}`}><Rows3 size={14} /></button>
      </div>
      {hasWidths && (
        <button onClick={prefs.resetWidths} title="Voltar as colunas ao tamanho do conteúdo"
          className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border ${border} ${idle}`}>
          <RotateCcw size={12} /> Larguras
        </button>
      )}
    </div>
  );
}
