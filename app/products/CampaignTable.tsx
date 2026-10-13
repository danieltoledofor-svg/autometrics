"use client";

import React, { useMemo } from 'react';
import { ArrowDown, ArrowUp, CheckSquare, EyeOff, Square } from 'lucide-react';
import { resolveProductStatus } from '@/lib/campaignStatus';

/**
 * Tabela do Gerenciador de Campanhas, no jeito do Google Ads: uma linha por
 * campanha, todas as contas na mesma lista, a conta e a MCC em coluna. Os
 * números (impressões, cliques, CPC médio, custo, receita e lucro) são do
 * período escolhido na tela. Não há coluna de status: a bolinha antes do nome
 * diz a situação, com o motivo ao passar o mouse.
 *
 * A mesma tabela serve para ver por conta ou por MCC: cada linha passa a ser
 * a soma das campanhas daquela conta (ou MCC).
 */

export type Level = 'campaigns' | 'accounts' | 'mccs';
export type SortKey = 'name' | 'budget' | 'impressions' | 'clicks' | 'cpc' | 'cost' | 'revenue' | 'profit';
export interface Sort { key: SortKey; desc: boolean }
export const LEVELS: { key: Level; label: string }[] = [{ key: 'campaigns', label: 'Campanhas' }, { key: 'accounts', label: 'Contas' }, { key: 'mccs', label: 'MCCs' }];

const SORT_KEY = 'autometrics_products_sort', LEVEL_KEY = 'autometrics_products_level';
const SORTS: SortKey[] = ['name', 'budget', 'impressions', 'clicks', 'cpc', 'cost', 'revenue', 'profit'];
export function loadSort(): Sort {
  try { const s = JSON.parse(localStorage.getItem(SORT_KEY) || 'null'); if (s && SORTS.includes(s.key)) return { key: s.key, desc: s.desc !== false }; } catch { /* sem lembrança */ }
  return { key: 'cost', desc: true };
}
export function saveSort(s: Sort) { try { localStorage.setItem(SORT_KEY, JSON.stringify(s)); } catch { /* sem armazenamento */ } }
export function loadLevel(): Level {
  try { const l = localStorage.getItem(LEVEL_KEY); if (l === 'campaigns' || l === 'accounts' || l === 'mccs') return l; } catch { /* sem lembrança */ }
  return 'campaigns';
}
export function saveLevel(l: Level) { try { localStorage.setItem(LEVEL_KEY, l); } catch { /* sem armazenamento */ } }

type Tone = 'ativo' | 'pausado' | 'suspenso' | 'sem_veicular';
const DOT: Record<Tone, string> = { ativo: 'bg-emerald-500', pausado: 'bg-slate-500', suspenso: 'bg-rose-500', sem_veicular: 'bg-amber-500' };
const TONE_LABEL: Record<Tone, [string, string]> = { ativo: ['ativa', 'ativas'], pausado: ['pausada', 'pausadas'], suspenso: ['suspensa', 'suspensas'], sem_veicular: ['sem veicular', 'sem veicular'] };
/** Ativas primeiro, depois o que pede atenção, pausadas por último: é o desempate da ordenação. */
const TONE_ORDER: Record<Tone, number> = { ativo: 0, sem_veicular: 1, suspenso: 2, pausado: 3 };

function toneOf(product: any): { tone: Tone; title: string } {
  const st = resolveProductStatus(product);
  const tone: Tone = st.key === 'suspenso' ? (st.label === 'Sem veicular' ? 'sem_veicular' : 'suspenso') : st.key;
  return { tone, title: `${st.label}: ${st.hint}` };
}

interface Nums { impressions: number; clicks: number; cost: number; revenue: number; profit: number; budget: number }
const numsOf = (p: any): Nums => {
  const m = p.metrics7d || {};
  const cost = Number(m.cost) || 0, revenue = Number(m.revenue) || 0;
  return { impressions: Number(m.impressions) || 0, clicks: Number(m.clicks) || 0, cost, revenue, profit: revenue - cost, budget: Number(m.budget) || 0 };
};
const MONEY: (keyof Nums)[] = ['cost', 'revenue', 'profit', 'budget'];

export function CampaignTable({ products, level, sort, onSort, rates, isDark, selected, onToggleSelect, onSelectAll, onOpen, onPickAccount, onPickMcc, actions }: {
  /** Campanhas já filtradas pela busca, pela conta escolhida e por ocultas. */
  products: any[]; level: Level; sort: Sort; onSort: (s: Sort) => void; rates: { USD: number; EUR: number }; isDark: boolean;
  selected: string[]; onToggleSelect: (id: string, e: React.MouseEvent) => void; onSelectAll: (ids: string[]) => void;
  onOpen: (product: any) => void; onPickAccount: (mcc: string, account: string) => void; onPickMcc: (mcc: string) => void;
  actions: (product: any) => React.ReactNode;
}) {
  const head = isDark ? 'text-white' : 'text-slate-900';
  const text = isDark ? 'text-slate-200' : 'text-slate-800';
  const muted = 'text-slate-500';
  const zero = isDark ? 'text-slate-600' : 'text-slate-400';
  const line = isDark ? 'border-slate-800' : 'border-slate-200';
  const link = isDark ? 'text-indigo-300' : 'text-indigo-700';
  const hover = isDark ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50';

  const toBRL = (value: number, currency?: string) => (currency === 'USD' ? value * rates.USD : currency === 'EUR' ? value * rates.EUR : value);
  const money = (v: number, currency = 'BRL') => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v);
  const int = (v: number) => Math.round(v).toLocaleString('pt-BR');

  /** Soma de várias campanhas. Moedas diferentes na mesma soma: tudo vira real, pela cotação do painel. */
  const sum = (list: any[]): Nums & { currency: string } => {
    const currencies = new Set(list.map(p => p.currency || 'BRL'));
    const currency = currencies.size === 1 ? [...currencies][0] : 'BRL';
    const out = { impressions: 0, clicks: 0, cost: 0, revenue: 0, profit: 0, budget: 0, currency };
    for (const p of list) {
      const n = numsOf(p), active = toneOf(p).tone === 'ativo';
      for (const k of Object.keys(n) as (keyof Nums)[]) {
        if (k === 'budget' && !active) continue;                    // orçamento somado: só o das campanhas que estão rodando
        out[k] += MONEY.includes(k) && currencies.size > 1 ? toBRL(n[k], p.currency) : n[k];
      }
    }
    return out;
  };
  const cpc = (n: Nums) => (n.clicks > 0 ? n.cost / n.clicks : 0);
  /** Valor de ordenação, em real quando é dinheiro, para comparar contas de moedas diferentes. */
  const sortValue = (n: Nums, currency: string) => (sort.key === 'cpc' ? toBRL(cpc(n), currency) : sort.key === 'name' ? 0 : MONEY.includes(sort.key as keyof Nums) ? toBRL(n[sort.key as keyof Nums], currency) : n[sort.key as keyof Nums]);

  const rows = useMemo(() => {
    const list = products.map(p => ({ p, n: numsOf(p), ...toneOf(p) }));
    return list.sort((a, b) => {
      const d = sort.key === 'name' ? a.p.name.localeCompare(b.p.name, 'pt-BR') : sortValue(a.n, a.p.currency) - sortValue(b.n, b.p.currency);
      return (sort.desc ? -d : d) || TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.p.name.localeCompare(b.p.name, 'pt-BR');
    });
    // sortValue e toBRL dependem só de sort e rates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, sort, rates]);

  const groups = useMemo(() => {
    if (level === 'campaigns') return [];
    const map = new Map<string, { name: string; mcc: string; id: string; list: any[] }>();
    for (const p of products) {
      const mcc = p.mcc_name || 'Outras', account = p.account_name || 'Sem Conta';
      const key = level === 'mccs' ? mcc : `${mcc}|${account}`;
      if (!map.has(key)) map.set(key, { name: level === 'mccs' ? mcc : account, mcc, id: String(p.google_ads_customer_id || ''), list: [] });
      map.get(key)!.list.push(p);
    }
    return [...map.values()].map(g => {
      const tones = g.list.map(p => toneOf(p).tone);
      const count = (t: Tone) => tones.filter(x => x === t).length;
      const tone: Tone = count('suspenso') ? 'suspenso' : count('ativo') ? 'ativo' : count('sem_veicular') ? 'sem_veicular' : 'pausado';
      return { ...g, n: sum(g.list), tone, active: count('ativo'), accounts: new Set(g.list.map(p => p.account_name || 'Sem Conta')).size };
    }).sort((a, b) => {
      const d = sort.key === 'name' ? a.name.localeCompare(b.name, 'pt-BR') : sortValue(a.n, a.n.currency) - sortValue(b.n, b.n.currency);
      return (sort.desc ? -d : d) || a.name.localeCompare(b.name, 'pt-BR');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, level, sort, rates]);

  const total = useMemo(() => sum(products), [products, rates]); // eslint-disable-line react-hooks/exhaustive-deps
  const tally = useMemo(() => {
    const c: Record<Tone, number> = { ativo: 0, sem_veicular: 0, suspenso: 0, pausado: 0 };
    for (const p of products) c[toneOf(p).tone]++;
    return c;
  }, [products]);
  const mixed = new Set(products.map(p => p.currency || 'BRL')).size > 1;

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right', sep = false) => (
    <th className={`px-3 py-2.5 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${sep ? `border-l ${line}` : ''}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button onClick={() => onSort({ key, desc: sort.key === key ? !sort.desc : key !== 'name' })} title={`Ordenar por ${label.toLowerCase()}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wider ${sort.key === key ? head : `${muted} hover:text-indigo-400`}`}>
        {align === 'right' && sort.key === key && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}{label}{align === 'left' && sort.key === key && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );
  const num = (value: number, shown: string, sep = false, extra = '') => <td className={`px-3 text-right tabular-nums ${sep ? `border-l ${line}` : ''} ${value ? text : zero} ${extra}`}>{shown}</td>;
  const profit = (n: Nums, currency: string) => <td className={`px-3 text-right tabular-nums font-semibold ${n.profit > 0 ? 'text-emerald-500' : n.profit < 0 ? 'text-rose-500' : zero}`}>{money(n.profit, currency)}</td>;
  /** As seis colunas de número, iguais nas três visões: tráfego e, depois da divisória, dinheiro. */
  const numbers = (n: Nums, currency: string) => (
    <>
      {num(n.impressions, int(n.impressions), true)}
      {num(n.clicks, int(n.clicks))}
      {num(n.clicks, n.clicks ? money(cpc(n), currency) : '—')}
      {num(n.cost, money(n.cost, currency), true)}
      {num(n.revenue, money(n.revenue, currency))}
      {profit(n, currency)}
    </>
  );
  const numberHeads = <>{th('impressions', 'Impr.', 'right', true)}{th('clicks', 'Cliques')}{th('cpc', 'CPC méd.')}{th('cost', 'Custo', 'right', true)}{th('revenue', 'Receita')}{th('profit', 'Lucro')}</>;
  const numberCols = <><col className="w-[76px]" /><col className="w-[72px]" /><col className="w-[88px]" /><col className="w-[110px]" /><col className="w-[110px]" /><col className="w-[110px]" /></>;
  const dot = (tone: Tone, title: string) => <span className={`inline-block w-2 h-2 rounded-full ${DOT[tone]}`} title={title} role="img" aria-label={title} />;
  const ids = rows.map(r => r.p.id), allSelected = ids.length > 0 && ids.every(id => selected.includes(id));
  const totalLabel = `Total${mixed ? ' em R$' : ''}`;

  return (
    <div className="space-y-2 pb-32">
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${muted} px-1`}>
        <span className={head}>{products.length} {products.length === 1 ? 'campanha' : 'campanhas'}</span>
        {(Object.keys(tally) as Tone[]).filter(t => tally[t]).map(t => (
          <span key={t} className="inline-flex items-center gap-1.5">{dot(t, TONE_LABEL[t][1])}{tally[t]} {TONE_LABEL[t][tally[t] === 1 ? 0 : 1]}</span>
        ))}
      </div>
      <div className={`border rounded-xl overflow-x-auto ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
        {level === 'campaigns' ? (
          <table className="w-full table-fixed border-collapse text-[13px] min-w-[1080px]">
            <colgroup><col className="w-10" /><col className="w-6" /><col /><col className="w-[140px]" /><col className="w-[112px]" />{numberCols}<col className="w-[124px]" /></colgroup>
            <thead>
              <tr className={`text-[11px] border-b ${line} ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
                <th className="py-2.5 text-center"><button onClick={() => onSelectAll(ids)} aria-label="Selecionar todas" className="text-slate-400 hover:text-indigo-500 align-middle">{allSelected ? <CheckSquare size={15} /> : <Square size={15} />}</button></th>
                <th />
                {th('name', 'Campanha', 'left')}
                <th className={`px-3 py-2.5 text-left font-semibold uppercase tracking-wider ${muted}`}>Conta</th>
                {th('budget', 'Orçam./dia')}
                {numberHeads}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, n, tone, title }) => {
                const isSelected = selected.includes(p.id);
                return (
                  <tr key={p.id} onClick={() => onOpen(p)} className={`h-12 border-b ${line} cursor-pointer transition-colors ${isSelected ? (isDark ? 'bg-indigo-500/10' : 'bg-indigo-50') : hover} ${p.is_hidden ? 'opacity-60' : ''}`}>
                    <td className="text-center" onClick={e => e.stopPropagation()}><button onClick={e => onToggleSelect(p.id, e)} aria-label={`Selecionar ${p.name}`} className={`align-middle ${isSelected ? 'text-indigo-500' : 'text-slate-400 hover:text-slate-300'}`}>{isSelected ? <CheckSquare size={15} /> : <Square size={15} />}</button></td>
                    <td className="text-center">{dot(tone, title)}</td>
                    <td className="px-3"><div className="flex items-center gap-1.5 min-w-0"><span className={`line-clamp-2 leading-tight break-words font-medium ${link}`} title={`${p.name}${p.campaign_id ? ` · nº ${p.campaign_id}` : ''}`}>{p.name}</span>{p.is_hidden && <EyeOff size={12} className="text-amber-500 shrink-0" aria-label="Oculta" />}</div></td>
                    <td className="px-3" onClick={e => e.stopPropagation()}>
                      <button onClick={() => onPickAccount(p.mcc_name || 'Outras', p.account_name || 'Sem Conta')} title="Ver só esta conta" className={`block w-full text-left truncate ${text} hover:text-indigo-400`}>{p.account_name || 'Sem Conta'}</button>
                      <div className={`text-[11px] truncate ${muted}`}>{p.mcc_name || 'Outras'}</div>
                    </td>
                    {num(n.budget, n.budget ? money(n.budget, p.currency) : '—')}
                    {numbers(n, p.currency)}
                    <td className="px-2" onClick={e => e.stopPropagation()}><div className="flex justify-end gap-1">{actions(p)}</div></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={`h-11 font-semibold ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}`}>
                <td /><td /><td className={`px-3 ${head}`}>{totalLabel}</td><td />
                {num(total.budget, total.budget ? money(total.budget, total.currency) : '—')}
                {numbers(total, total.currency)}
                <td />
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="w-full table-fixed border-collapse text-[13px] min-w-[900px]">
            <colgroup><col className="w-9" /><col /><col className="w-[140px]" /><col className="w-[120px]" />{numberCols}</colgroup>
            <thead>
              <tr className={`text-[11px] border-b ${line} ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
                <th />
                {th('name', level === 'mccs' ? 'MCC' : 'Conta', 'left')}
                <th className={`px-3 py-2.5 text-right font-semibold uppercase tracking-wider ${muted}`}>Campanhas</th>
                {th('budget', 'Orçam./dia')}
                {numberHeads}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={`${g.mcc}|${g.name}`} onClick={() => (level === 'mccs' ? onPickMcc(g.mcc) : onPickAccount(g.mcc, g.name))} title={level === 'mccs' ? 'Ver as contas desta MCC' : 'Ver as campanhas desta conta'}
                  className={`h-12 border-b ${line} cursor-pointer transition-colors ${hover}`}>
                  <td className="text-center">{dot(g.tone, TONE_LABEL[g.tone][0])}</td>
                  <td className="px-3">
                    <div className={`truncate font-medium ${link}`}>{g.name}</div>
                    <div className={`text-[11px] truncate ${muted}`}>{level === 'mccs' ? `${g.accounts} ${g.accounts === 1 ? 'conta' : 'contas'}` : [g.id, g.mcc].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className={`px-3 text-right tabular-nums ${g.active ? text : zero}`}>{g.active} de {g.list.length} {g.active === 1 ? 'ativa' : 'ativas'}</td>
                  {num(g.n.budget, g.n.budget ? money(g.n.budget, g.n.currency) : '—')}
                  {numbers(g.n, g.n.currency)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={`h-11 font-semibold ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}`}>
                <td /><td className={`px-3 ${head}`}>{totalLabel}</td>
                <td className={`px-3 text-right tabular-nums ${text}`}>{tally.ativo} de {products.length} ativas</td>
                {num(total.budget, total.budget ? money(total.budget, total.currency) : '—')}
                {numbers(total, total.currency)}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <div className={`text-[11px] ${muted} px-1`}>Clique no título de uma coluna para ordenar. O orçamento das contas e das MCCs soma só as campanhas ativas.{mixed ? ' Somas com mais de uma moeda aparecem em reais, pela cotação do painel.' : ''}</div>
    </div>
  );
}
