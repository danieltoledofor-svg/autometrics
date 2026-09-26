"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Columns, Search } from 'lucide-react';
import {
  aggregate, CampaignDay, DayRow, emptyValues, formatMetric, METRIC_COLUMNS, MetricColumn, ColumnFormat,
  actionColumns, actionNames,
} from '@/lib/metrics/dimension';
import { customValue } from '@/lib/metrics/formula';
import { ColumnPicker, Ui } from './ColumnPicker';
import { ActiveFilter, FilterBar, FilterField, matchesFilters } from './FilterBar';
import type { CustomColumnsApi } from './useCustomColumns';
import { useTablePrefs } from '@/app/components/table/useTablePrefs';
import { cellPad, TableControls, tableTone, Th, valueClass, widthStyle } from '@/app/components/table/tableUi';

/**
 * Tabela por item com as colunas do Google, vendas reais rateadas, colunas
 * personalizadas, filtros, ordenação e total — a mesma para grupos, anúncios,
 * palavras-chave, termos, públicos e locais.
 */

export interface DimItem {
  key: string;
  name: string;
  [k: string]: any;
}

/** Coluna própria do nível (status, grupo, índice de qualidade…). */
export interface DimColumn {
  key: string;
  label: string;
  render: (item: DimItem) => React.ReactNode;
  /** Valor para ordenar e filtrar. Número vira filtro numérico; texto, filtro de texto. */
  value?: (item: DimItem) => number | string | null;
  align?: 'left' | 'right';
}

interface Props {
  tableId: string;
  title: string;
  nameLabel: string;
  items: DimItem[];
  dayRows: DayRow[];
  fx: number;
  campaignDays: Map<string, CampaignDay>;
  formatMoney: (v: number) => string;
  custom: CustomColumnsApi;
  ui: Ui;
  dimensionColumns?: DimColumn[];
  renderName?: (item: DimItem, expanded: boolean, toggle: () => void) => React.ReactNode;
  expandRender?: (item: DimItem) => React.ReactNode;
  rowClassName?: (item: DimItem) => string;
  toolbar?: React.ReactNode;
  loading?: boolean;
  empty?: string | null;
  footnote?: React.ReactNode;
}

const PAGE = 200;

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}
function writeStore(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem armazenamento */ }
}

const DEFAULT_VISIBLE = METRIC_COLUMNS.filter(c => c.defaultOn).map(c => c.key);

export function DimensionTable(props: Props) {
  const { tableId, items, dayRows, fx, campaignDays, formatMoney, custom, ui } = props;
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const dims = props.dimensionColumns || [];

  // Colunas visíveis, larguras e densidade ficam salvas no usuário.
  const prefs = useTablePrefs(`dim_${tableId}`, { legacyColumnsKey: `autometrics_cols_${tableId}` });
  const tone = tableTone(isDark);
  const pad = cellPad(prefs.density);
  const filterKey = `autometrics_filters_${tableId}`;
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  useEffect(() => {
    setFilters(readStore(filterKey, []));
  }, [filterKey]);
  const visible = prefs.columns || DEFAULT_VISIBLE;
  const changeVisible = (v: string[]) => prefs.setColumns(v);
  const changeFilters = (f: ActiveFilter[]) => { setFilters(f); writeStore(filterKey, f); };

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'cost', dir: 'desc' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // Cada ação de conversão da conta (Checkout, Compra…) vira colunas próprias.
  const actions = useMemo(() => actionNames(dayRows), [dayRows]);
  const allColumns = useMemo(() => [...METRIC_COLUMNS, ...actionColumns(actions)], [actions]);
  const empty = useMemo(() => emptyValues(actions), [actions]);

  // Colunas de métrica visíveis, na ordem do catálogo; personalizadas no fim.
  const metricCols: (MetricColumn & { custom?: boolean })[] = useMemo(() => {
    const base = allColumns.filter(c => visible.includes(c.key));
    const cust = custom.compiled.filter(c => visible.includes(c.key)).map(c => ({
      key: c.key, label: c.name, category: 'Personalizadas',
      format: (c.format === 'money' ? 'money' : c.format === 'percent' ? 'pct' : 'dec') as ColumnFormat,
      custom: true,
    }));
    return [...base, ...cust];
  }, [visible, custom.compiled, allColumns]);

  const withCustom = (v: Record<string, number | null>) => {
    const out = { ...v };
    for (const c of custom.compiled) out[c.key] = customValue(c, name => v[name]);
    return out;
  };

  const values = useMemo(() => aggregate(dayRows, { fx, campaignDays, actionNames: actions }), [dayRows, fx, campaignDays, actions]);

  const allRows = useMemo(() => items.map(item => ({
    item,
    v: withCustom(values.get(item.key) || empty),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [items, values, custom.compiled, empty]);

  const valueOf = (row: { item: DimItem; v: Record<string, number | null> }, key: string): number | string | null => {
    if (key === 'name') return row.item.name;
    const dim = dims.find(d => d.key === key);
    if (dim) return dim.value ? dim.value(row.item) : null;
    return row.v[key] ?? null;
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = allRows
      .filter(r => !term || r.item.name.toLowerCase().includes(term) || String(r.item.searchText || '').toLowerCase().includes(term))
      .filter(r => matchesFilters(filters, k => valueOf(r, k)));
    out.sort((a, b) => {
      const va = valueOf(a, sort.key);
      const vb = valueOf(b, sort.key);
      let cmp: number;
      if (va === null || va === undefined) cmp = vb === null || vb === undefined ? 0 : -1;
      else if (vb === null || vb === undefined) cmp = 1;
      else cmp = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : va - vb;
      return (sort.dir === 'asc' ? cmp : -cmp) || Number(b.v.impressions || 0) - Number(a.v.impressions || 0);
    });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, search, filters, sort, dims]);

  const total = useMemo(() => {
    const keys = new Set(rows.map(r => r.item.key));
    const agg = aggregate(dayRows.filter(d => keys.has(d.key)), { fx, campaignDays, keyOf: () => '__total', actionNames: actions });
    return withCustom(agg.get('__total') || empty);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dayRows, fx, campaignDays, custom.compiled, actions, empty]);

  const filterFields: FilterField[] = useMemo(() => [
    { key: 'name', label: props.nameLabel, type: 'text' },
    ...dims.filter(d => d.value).map(d => {
      const sample = items.map(i => d.value!(i)).find(v => v !== null && v !== undefined);
      return { key: d.key, label: d.label, type: typeof sample === 'number' ? 'number' as const : 'text' as const };
    }),
    ...allColumns.map(c => ({ key: c.key, label: `${c.estimate ? '≈ ' : ''}${c.label}`, type: 'number' as const, unit: c.format === 'pct' ? '%' : undefined })),
    ...custom.compiled.map(c => ({ key: c.key, label: c.name, type: 'number' as const, unit: c.format === 'percent' ? '%' : undefined })),
  ], [dims, items, custom.compiled, props.nameLabel, allColumns]);

  const toggleSort = (key: string) => setSort(s => s.key === key
    ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: key === 'name' ? 'asc' : 'desc' });

  const th = (key: string, label: React.ReactNode, align: 'left' | 'right' = 'right', title?: string, sortable = true) => (
    <Th key={key} colKey={key} prefs={prefs} title={title}
      className={`${pad} border-b ${tone.line} ${tone.headerBg} whitespace-nowrap font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${key === 'name' ? 'sticky left-0 z-20' : ''}`}>
      {sortable ? (
        <button onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 hover:text-indigo-400 ${sort.key === key ? tone.text : ''}`}>
          {label}
          {sort.key === key && (sort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
        </button>
      ) : label}
    </Th>
  );

  const selectCls = `rounded-lg px-3 py-1.5 border ${borderCol} ${isDark ? 'bg-slate-950' : 'bg-white'}`;
  const colSpan = 1 + dims.length + metricCols.length;

  return (
    <div className="space-y-4">
      <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
        <div className={`p-4 border-b ${borderCol} space-y-3`}>
          <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-3">
            <div className="flex items-center gap-3">
              <h3 className={`font-semibold ${textHead}`}>{props.title}</h3>
              {!props.loading && <span className={`text-xs ${textMuted} ${isDark ? 'bg-slate-950' : 'bg-slate-100'} px-2 py-1 rounded border ${borderCol}`}>{rows.length}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {props.toolbar}
              <div className={`flex items-center gap-2 ${selectCls}`}>
                <Search size={14} className={textMuted} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar"
                  className={`bg-transparent outline-none text-sm w-32 ${isDark ? 'text-slate-200' : 'text-slate-800'}`} />
              </div>
              <button onClick={() => setPickerOpen(true)} className={`inline-flex items-center gap-2 text-sm font-semibold ${selectCls} ${textHead} hover:border-indigo-500`}>
                <Columns size={14} className="text-indigo-400" /> Colunas
              </button>
              <TableControls prefs={prefs} isDark={isDark} />
            </div>
          </div>
          <FilterBar fields={filterFields} filters={filters} onChange={changeFilters} ui={ui} />
        </div>

        {props.loading || props.empty || !rows.length ? (
          <div className={`p-10 text-center ${textMuted}`}>
            {props.loading ? 'Carregando…' : props.empty || 'Nenhum item com estes filtros.'}
          </div>
        ) : (
          <div className="overflow-auto custom-scrollbar max-h-[70vh]">
            {/* Largura do conteúdo, não da tela: as colunas ficam juntas e cada uma ajustável. */}
            <table className="w-max min-w-0 text-[13px] text-left border-collapse tabular-nums">
              <thead className={`text-xs ${tone.head} sticky top-0 z-10`}>
                <tr>
                  {th('name', props.nameLabel, 'left')}
                  {dims.map(d => th(d.key, d.label, d.align || 'left', undefined, !!d.value))}
                  {metricCols.map(c => th(c.key, `${c.estimate ? '≈ ' : ''}${c.label}`, 'right', c.estimate ? 'Estimativa: vendas reais do dia distribuídas pelas conversões do Google (ou pelos cliques quando o Google ainda não contou)' : undefined))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r, idx) => {
                  const open = expanded === r.item.key;
                  const toggle = () => setExpanded(open ? null : r.item.key);
                  const bg = `${tone.rowBg(idx)} ${tone.rowHover}`;
                  return (
                    <React.Fragment key={r.item.key}>
                      <tr className={`group align-top ${props.rowClassName?.(r.item) || ''}`}>
                        <td className={`${pad} ${tone.text} ${bg} border-b ${tone.line} sticky left-0 z-[1] max-w-[380px]`} style={widthStyle(prefs.widths.name)}>
                          {props.renderName ? props.renderName(r.item, open, toggle) : <span className="font-medium">{r.item.name}</span>}
                        </td>
                        {dims.map(d => (
                          <td key={d.key} className={`${pad} ${bg} border-b ${tone.line} whitespace-nowrap ${d.align === 'right' ? 'text-right' : ''}`} style={widthStyle(prefs.widths[d.key])}>{d.render(r.item)}</td>
                        ))}
                        {metricCols.map(c => (
                          <td key={c.key} className={`${pad} ${bg} border-b ${tone.line} text-right whitespace-nowrap ${valueClass(c.key, r.v[c.key], tone)}`} style={widthStyle(prefs.widths[c.key])}>
                            {formatMetric(r.v[c.key], c.format, formatMoney)}
                          </td>
                        ))}
                      </tr>
                      {open && props.expandRender && (
                        <tr className={isDark ? 'bg-slate-950/60' : 'bg-slate-50'}>
                          <td colSpan={colSpan} className="px-6 py-4">{props.expandRender(r.item)}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {rows.length > limit && (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-3 text-center">
                      <button onClick={() => setLimit(l => l + PAGE)} className="text-sm font-semibold text-indigo-400 hover:underline">
                        Mostrar mais {Math.min(PAGE, rows.length - limit)} de {rows.length - limit}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr className="font-semibold">
                  <td className={`${pad} ${tone.text} ${tone.totalBg} sticky left-0 z-[1] border-t ${tone.line}`}>Total ({rows.length})</td>
                  {dims.map(d => <td key={d.key} className={`${tone.totalBg} border-t ${tone.line}`} />)}
                  {metricCols.map(c => (
                    <td key={c.key} className={`${pad} ${tone.totalBg} border-t ${tone.line} text-right whitespace-nowrap ${valueClass(c.key, total[c.key], tone)}`} style={widthStyle(prefs.widths[c.key])}>
                      {formatMetric(total[c.key], c.format, formatMoney)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      {props.footnote && <p className={`text-xs ${textMuted}`}>{props.footnote}</p>}

      {pickerOpen && (
        <ColumnPicker
          columns={allColumns}
          visible={visible}
          onChange={changeVisible}
          onReset={() => changeVisible(DEFAULT_VISIBLE)}
          onClose={() => setPickerOpen(false)}
          custom={custom}
          ui={ui}
        />
      )}
    </div>
  );
}
