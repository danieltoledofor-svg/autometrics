"use client";

import React, { useMemo, useRef, useState } from 'react';
import { Check, Columns, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { CUSTOM_KEY, CustomColumn, parseFormula } from '@/lib/metrics/formula';
import { FORMULA_VARIABLES } from '@/lib/metrics/dimension';
import type { CustomColumnsApi } from './useCustomColumns';

export interface PickerColumn {
  key: string;
  label: string;
  category: string;
  estimate?: boolean;
}

export interface Ui {
  isDark: boolean;
  bgCard: string;
  borderCol: string;
  textHead: string;
  textMuted: string;
}

interface Props {
  columns: PickerColumn[];
  visible: string[];
  onChange: (visible: string[]) => void;
  onReset?: () => void;
  onClose: () => void;
  custom: CustomColumnsApi;
  ui: Ui;
}

const FORMAT_LABEL: Record<CustomColumn['format'], string> = {
  number: 'Número',
  money: 'Moeda',
  percent: 'Percentual',
};

/** Modal "Modificar colunas", como no Google, com as colunas personalizadas. */
export function ColumnPicker({ columns, visible, onChange, onReset, onClose, custom, ui }: Props) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<(Omit<CustomColumn, 'id'> & { id?: string }) | null>(null);

  const toggle = (key: string) =>
    onChange(visible.includes(key) ? visible.filter(k => k !== key) : [...visible, key]);

  const term = search.trim().toLowerCase();
  const categories = useMemo(() => {
    const out = new Map<string, PickerColumn[]>();
    for (const c of columns) {
      if (term && !c.label.toLowerCase().includes(term)) continue;
      if (!out.has(c.category)) out.set(c.category, []);
      out.get(c.category)!.push(c);
    }
    return [...out.entries()];
  }, [columns, term]);
  const customList = custom.columns.filter(c => !term || c.name.toLowerCase().includes(term));

  const checkbox = (on: boolean) => (
    <div className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${on ? 'bg-indigo-600 border-indigo-600' : 'bg-transparent border-slate-600'}`}>
      {on && <Check size={13} className="text-white" />}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`${bgCard} border rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl`} onClick={e => e.stopPropagation()}>
        <div className={`p-5 border-b flex justify-between items-center gap-4 ${borderCol}`}>
          <h2 className={`text-lg font-bold ${textHead} flex items-center gap-2`}><Columns size={20} className="text-indigo-500" /> Modificar colunas</h2>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border ${borderCol} ${isDark ? 'bg-slate-950' : 'bg-white'}`}>
              <Search size={14} className={textMuted} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar coluna"
                className={`bg-transparent outline-none text-sm w-40 ${isDark ? 'text-slate-200' : 'text-slate-800'}`} />
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={22} /></button>
          </div>
        </div>

        {editing ? (
          <FormulaEditor
            initial={editing}
            extraVars={columns}
            ui={ui}
            onCancel={() => setEditing(null)}
            onSave={async col => {
              const { error, column } = await custom.save(col);
              if (error) return error;
              // A coluna recém-criada já entra visível.
              if (!col.id && column) onChange([...visible, CUSTOM_KEY(column.id)]);
              setEditing(null);
              return null;
            }}
          />
        ) : (
          <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-6">
            <div>
              <div className={`flex items-center justify-between border-b ${borderCol} pb-2 mb-3`}>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Colunas personalizadas</h3>
                {!custom.error && (
                  <button onClick={() => setEditing({ name: '', formula: '', format: 'number' })}
                    className="inline-flex items-center gap-1 text-xs font-bold text-indigo-400 hover:text-indigo-300">
                    <Plus size={14} /> Nova coluna
                  </button>
                )}
              </div>
              {custom.error ? (
                <p className="text-xs text-amber-400">{custom.error}</p>
              ) : customList.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {customList.map(c => {
                    const key = CUSTOM_KEY(c.id);
                    const on = visible.includes(key);
                    return (
                      <div key={c.id} className={`flex items-center gap-3 p-2 rounded-lg ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                        <button onClick={() => toggle(key)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                          {checkbox(on)}
                          <span className="min-w-0">
                            <span className={`block truncate text-sm ${on ? `${textHead} font-medium` : 'text-slate-400'}`}>{c.name}</span>
                            <span className={`block truncate text-[11px] font-mono ${textMuted}`}>{c.formula}</span>
                          </span>
                        </button>
                        <button onClick={() => setEditing(c)} title="Editar" className={`${textMuted} hover:text-indigo-400`}><Pencil size={14} /></button>
                        <button onClick={async () => {
                          if (!confirm(`Excluir a coluna "${c.name}"? Ela some de todas as abas.`)) return;
                          const err = await custom.remove(c.id);
                          if (err) alert(err);
                        }} title="Excluir" className={`${textMuted} hover:text-rose-400`}><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={`text-xs ${textMuted}`}>
                  Crie colunas com fórmula, como no Google Ads — por exemplo <span className="font-mono">profit / clicks</span> (lucro por clique). Valem em todas as abas.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {categories.map(([category, cols]) => (
                <div key={category}>
                  <h3 className={`text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b ${borderCol} pb-2`}>{category}</h3>
                  <div className="space-y-1">
                    {cols.map(col => {
                      const on = visible.includes(col.key);
                      return (
                        <button key={col.key} onClick={() => toggle(col.key)}
                          className={`flex items-center gap-3 w-full p-2 rounded-lg text-left text-sm ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                          {checkbox(on)}
                          <span className={on ? `${textHead} font-medium` : 'text-slate-400'}>{col.estimate ? '≈ ' : ''}{col.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!editing && (
          <div className={`p-4 border-t ${borderCol} flex justify-between items-center`}>
            <span className={`text-xs ${textMuted}`}>{visible.length} coluna(s) visíveis · ≈ = vendas reais distribuídas por estimativa</span>
            <div className="flex gap-2">
              {onReset && <button onClick={onReset} className={`px-4 py-2 rounded-lg text-sm font-semibold border ${borderCol} ${textMuted} hover:text-indigo-400`}>Restaurar padrão</button>}
              <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-500">Concluir</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FormulaEditor({ initial, extraVars, ui, onCancel, onSave }: {
  initial: Omit<CustomColumn, 'id'> & { id?: string };
  /** Colunas desta tabela que não estão no catálogo fixo (ações de conversão). */
  extraVars: PickerColumn[];
  ui: Ui;
  onCancel: () => void;
  onSave: (col: Omit<CustomColumn, 'id'> & { id?: string }) => Promise<string | null>;
}) {
  const { isDark, borderCol, textHead, textMuted } = ui;
  const [name, setName] = useState(initial.name);
  const [formula, setFormula] = useState(initial.formula);
  const [format, setFormat] = useState<CustomColumn['format']>(initial.format);
  const [varSearch, setVarSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const variables = useMemo(() => {
    const fixed = new Set(FORMULA_VARIABLES.map(v => v.key));
    return [...FORMULA_VARIABLES, ...extraVars.filter(c => !fixed.has(c.key) && /^ca_/.test(c.key))
      .map(c => ({ key: c.key, label: c.label, category: c.category }))];
  }, [extraVars]);
  const parsed = useMemo(() => parseFormula(formula), [formula]);
  const known = useMemo(() => new Set(variables.map(v => v.key)), [variables]);
  // Ação de conversão de outra campanha também vale: aqui ela só dá "—".
  const unknown = parsed.vars.filter(v => !known.has(v) && !/^ca_[a-z0-9_]+_(all|conv|value|cost)$/.test(v));
  const labelOf = useMemo(() => new Map(variables.map(v => [v.key, v.label])), [variables]);

  const insert = (text: string) => {
    const el = ref.current;
    if (!el) { setFormula(f => `${f}${text}`); return; }
    const start = el.selectionStart ?? formula.length;
    const end = el.selectionEnd ?? formula.length;
    const next = formula.slice(0, start) + text + formula.slice(end);
    setFormula(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + text.length; });
  };

  const vt = varSearch.trim().toLowerCase();
  const groups = useMemo(() => {
    const out = new Map<string, typeof FORMULA_VARIABLES>();
    for (const v of variables) {
      if (vt && !v.label.toLowerCase().includes(vt) && !v.key.includes(vt)) continue;
      if (!out.has(v.category)) out.set(v.category, []);
      out.get(v.category)!.push(v);
    }
    return [...out.entries()];
  }, [vt, variables]);

  const valid = name.trim() && parsed.ok && !unknown.length;
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border ${borderCol} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'} outline-none focus:border-indigo-500`;

  return (
    <div className="p-5 overflow-y-auto custom-scrollbar flex-1 grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4">
        <div>
          <label className={`block text-xs font-bold uppercase mb-1 ${textMuted}`}>Nome da coluna</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Lucro por clique" className={inputCls} />
        </div>
        <div>
          <label className={`block text-xs font-bold uppercase mb-1 ${textMuted}`}>Fórmula</label>
          <textarea ref={ref} value={formula} onChange={e => setFormula(e.target.value)} rows={4}
            placeholder="Ex.: profit / clicks" className={`${inputCls} font-mono`} />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {['+', '-', '*', '/', '(', ')', '100'].map(op => (
              <button key={op} onClick={() => insert(op === '(' || op === ')' ? op : ` ${op} `)}
                className={`px-2.5 py-1 rounded font-mono text-sm border ${borderCol} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'} ${textHead}`}>{op}</button>
            ))}
          </div>
          <div className="mt-3 text-xs min-h-[1.25rem]">
            {!formula.trim() ? <span className={textMuted}>Clique nas métricas ao lado para montar a fórmula.</span>
              : !parsed.ok ? <span className="text-rose-400">{parsed.error}</span>
              : unknown.length ? <span className="text-rose-400">Métrica desconhecida: {unknown.join(', ')}</span>
              : <span className="text-emerald-400">Fórmula válida: {parsed.vars.map(v => labelOf.get(v) || v).join(', ') || 'só números'}</span>}
          </div>
        </div>
        <div>
          <label className={`block text-xs font-bold uppercase mb-1 ${textMuted}`}>Formato</label>
          <div className="flex gap-2">
            {(Object.keys(FORMAT_LABEL) as CustomColumn['format'][]).map(f => (
              <button key={f} onClick={() => setFormat(f)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${format === f ? 'bg-indigo-600 border-indigo-600 text-white' : `${borderCol} ${textMuted}`}`}>{FORMAT_LABEL[f]}</button>
            ))}
          </div>
          <p className={`text-xs mt-2 ${textMuted}`}>
            Percentual multiplica o resultado por 100 (cliques / impressões vira 5,00%). CTR, ROI e taxas já estão em %; dinheiro já vem na moeda da tela. A fórmula é aplicada ao total do período de cada linha, como no Google.
          </p>
        </div>
        {saveError && <p className="text-sm text-rose-400">{saveError}</p>}
        <div className="flex gap-2 pt-2">
          <button disabled={!valid || saving} onClick={async () => {
            setSaving(true);
            const err = await onSave({ id: initial.id, name, formula, format });
            setSaving(false);
            if (err) setSaveError(err);
          }} className="px-5 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40">
            {saving ? 'Salvando…' : initial.id ? 'Salvar alterações' : 'Criar coluna'}
          </button>
          <button onClick={onCancel} className={`px-4 py-2 rounded-lg text-sm font-semibold border ${borderCol} ${textMuted}`}>Cancelar</button>
        </div>
      </div>

      <div className={`border ${borderCol} rounded-xl flex flex-col max-h-[60vh]`}>
        <div className={`p-2 border-b ${borderCol}`}>
          <input value={varSearch} onChange={e => setVarSearch(e.target.value)} placeholder="Buscar métrica" className={inputCls} />
        </div>
        <div className="overflow-y-auto custom-scrollbar p-2 space-y-3">
          {groups.map(([cat, vars]) => (
            <div key={cat}>
              <div className="text-[10px] font-bold uppercase text-slate-500 px-1 mb-1">{cat}</div>
              {vars.map(v => (
                <button key={v.key} onClick={() => insert(v.key)}
                  className={`w-full text-left px-2 py-1 rounded text-xs ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                  <span className={textHead}>{v.label}</span>
                  <span className={`block font-mono text-[10px] ${textMuted}`}>{v.key}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
