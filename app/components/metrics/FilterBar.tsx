"use client";

import React, { useState } from 'react';
import { Filter, Plus, X } from 'lucide-react';
import type { Ui } from './ColumnPicker';

export interface FilterField {
  key: string;
  label: string;
  type: 'number' | 'text';
  /** Unidade que o usuário digita: % para taxas, moeda da tela para dinheiro. */
  unit?: string;
}

export type FilterOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'contains' | 'not_contains' | 'is';

export interface ActiveFilter {
  id: string;
  key: string;
  op: FilterOp;
  value: string;
}

const NUMBER_OPS: [FilterOp, string][] = [['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['eq', '='], ['neq', '≠']];
const TEXT_OPS: [FilterOp, string][] = [['contains', 'contém'], ['not_contains', 'não contém'], ['is', 'é igual a']];
const OP_LABEL = Object.fromEntries([...NUMBER_OPS, ...TEXT_OPS]) as Record<FilterOp, string>;

/** Aceita "1.234,5" e "0.5". */
const toNumber = (s: string) => {
  const t = String(s).trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

/** A linha passa em todos os filtros? Valores null só passam em "≠". */
export function matchesFilters(
  filters: ActiveFilter[],
  get: (key: string) => number | string | null | undefined,
): boolean {
  return filters.every(f => {
    const v = get(f.key);
    if (['contains', 'not_contains', 'is'].includes(f.op)) {
      const text = String(v ?? '').toLowerCase();
      const q = f.value.trim().toLowerCase();
      if (f.op === 'contains') return text.includes(q);
      if (f.op === 'not_contains') return !text.includes(q);
      return text === q;
    }
    const target = toNumber(f.value);
    if (!Number.isFinite(target)) return true;
    if (v === null || v === undefined || v === '') return f.op === 'neq';
    const n = Number(v);
    const eps = 1e-9;
    switch (f.op) {
      case 'gt': return n > target + eps;
      case 'gte': return n >= target - eps;
      case 'lt': return n < target - eps;
      case 'lte': return n <= target + eps;
      case 'eq': return Math.abs(n - target) < 0.005;
      case 'neq': return Math.abs(n - target) >= 0.005;
      default: return true;
    }
  });
}

export function FilterBar({ fields, filters, onChange, ui }: {
  fields: FilterField[];
  filters: ActiveFilter[];
  onChange: (f: ActiveFilter[]) => void;
  ui: Ui;
}) {
  const { isDark, borderCol, textMuted } = ui;
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(fields.find(f => f.type === 'number')?.key || fields[0]?.key || '');
  const [op, setOp] = useState<FilterOp>('gt');
  const [value, setValue] = useState('');

  const field = fields.find(f => f.key === key);
  const ops = field?.type === 'text' ? TEXT_OPS : NUMBER_OPS;
  const labelOf = (k: string) => fields.find(f => f.key === k)?.label || k;
  const selectCls = `text-sm rounded-lg px-2 py-1.5 border ${borderCol} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'}`;

  const apply = () => {
    if (!field || !value.trim()) return;
    onChange([...filters, { id: `${Date.now()}`, key, op, value: value.trim() }]);
    setValue('');
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter size={14} className={textMuted} />
      {filters.map(f => {
        const unit = fields.find(x => x.key === f.key)?.unit;
        return (
          <span key={f.id} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${isDark ? 'bg-indigo-950/50 border-indigo-800 text-indigo-200' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
            {labelOf(f.key)} {OP_LABEL[f.op]} {f.value}{unit === '%' ? '%' : ''}
            <button onClick={() => onChange(filters.filter(x => x.id !== f.id))} className="hover:text-rose-400"><X size={12} /></button>
          </span>
        );
      })}
      {adding ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <select value={key} onChange={e => {
            const k = e.target.value;
            setKey(k);
            setOp(fields.find(f => f.key === k)?.type === 'text' ? 'contains' : 'gt');
          }} className={`${selectCls} max-w-[220px]`}>
            {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select value={op} onChange={e => setOp(e.target.value as FilterOp)} className={selectCls}>
            {ops.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
          </select>
          <input autoFocus value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') setAdding(false); }}
            placeholder={field?.type === 'number' ? (field.unit === '%' ? 'ex.: 5 (%)' : 'ex.: 10') : 'texto'}
            className={`${selectCls} w-28`} />
          <button onClick={apply} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">Aplicar</button>
          <button onClick={() => setAdding(false)} className={`text-xs ${textMuted} hover:text-rose-400`}>Cancelar</button>
        </span>
      ) : (
        <button onClick={() => setAdding(true)} className={`inline-flex items-center gap-1 text-xs font-semibold ${textMuted} hover:text-indigo-400`}>
          <Plus size={13} /> Adicionar filtro
        </button>
      )}
      {filters.length > 1 && !adding && (
        <button onClick={() => onChange([])} className={`text-xs ${textMuted} hover:text-rose-400`}>Limpar</button>
      )}
    </div>
  );
}
