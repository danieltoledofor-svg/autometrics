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

/** Cores das tabelas pelo guia visual (DESIGN.md): os tokens já seguem o tema. */
export function tableTone(_isDark?: boolean): TableTone {
  return {
    text: 'text-ink',
    head: 'text-ink-subtle',
    muted: 'text-ink-subtle',
    cost: 'text-ink',
    revenue: 'text-ink',
    pos: 'text-pos',
    neg: 'text-neg',
    warn: 'text-warn',
    accent: 'text-brand-text',
    line: 'border-line',
    headerBg: 'bg-surface-2',
    totalBg: 'bg-surface-2',
    // Sem listras: fundo opaco igual em todas (a primeira coluna é fixa), divisória e hover.
    rowBg: () => 'bg-surface-1',
    rowHover: 'group-hover:bg-surface-2',
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
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-brand/70"
      />
    </th>
  );
}

/** Densidade e "restaurar larguras", para a barra de cada tabela. */
/** tokens: estilo do guia visual (DESIGN.md), nas telas já migradas. */
export function TableControls({ prefs, isDark, tokens = false }: { prefs: TablePrefsApi; isDark: boolean; tokens?: boolean }) {
  const border = tokens ? 'border-line' : isDark ? 'border-slate-700' : 'border-slate-300';
  const idle = tokens ? 'text-ink-subtle hover:text-ink hover:bg-surface-2' : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100';
  const on = tokens ? 'bg-surface-3 text-ink' : 'bg-indigo-600 text-white';
  const hasWidths = Object.keys(prefs.widths).length > 0;
  return (
    <div className="flex items-center gap-2">
      <div className={`inline-flex rounded-lg border ${border} overflow-hidden`}>
        <button title="Compacto" aria-label="Tabela compacta" aria-pressed={prefs.density === 'compact'} onClick={() => prefs.setDensity('compact')}
          className={`px-2 py-1.5 ${prefs.density === 'compact' ? on : idle}`}><Rows4 size={14} aria-hidden="true" /></button>
        <button title="Confortável" aria-label="Tabela confortável" aria-pressed={prefs.density === 'comfortable'} onClick={() => prefs.setDensity('comfortable')}
          className={`px-2 py-1.5 ${prefs.density === 'comfortable' ? on : idle}`}><Rows3 size={14} aria-hidden="true" /></button>
      </div>
      {hasWidths && (
        <button onClick={prefs.resetWidths} title="Voltar as colunas ao tamanho do conteúdo"
          className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border ${border} ${idle}`}>
          <RotateCcw size={12} aria-hidden="true" /> Larguras
        </button>
      )}
    </div>
  );
}
