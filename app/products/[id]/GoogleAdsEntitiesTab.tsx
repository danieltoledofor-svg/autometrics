"use client";

import React, { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react';

/**
 * Abas de grupos de anúncios, anúncios e palavras-chave.
 *
 * Os itens vêm de google_ads_entities (como estão hoje no Google) e o
 * desempenho de google_ads_entity_metrics (por dia), somado no período da tela.
 * Os dois são gravados pela coleta da API — o script antigo não traz este nível.
 */

export type EntityLevel = 'ad_group' | 'ad' | 'keyword';

interface Ui {
  isDark: boolean;
  bgCard: string;
  borderCol: string;
  textHead: string;
  textMuted: string;
}

interface Props {
  supabase: SupabaseClient;
  productId: string;
  level: EntityLevel;
  startDate: string;
  endDate: string;
  /** Converte o dinheiro da moeda da conta para a moeda da tela. */
  fx: number;
  formatMoney: (v: number) => string;
  channelType?: string | null;
  adGroupFilter: string;
  onAdGroupFilter: (id: string) => void;
  onOpenAdGroup: (id: string, target: 'ad' | 'keyword') => void;
  ui: Ui;
}

interface Entity {
  level: EntityLevel;
  entity_id: string;
  ad_group_id: string | null;
  name: string;
  status: string;
  details: any;
}

interface Row extends Entity {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  cpc: number;
  cpa: number;
  conv_rate: number;
}

const STATUS_PT: Record<string, string> = { ENABLED: 'Ativo', PAUSED: 'Pausado', REMOVED: 'Removido' };
const STRENGTH_PT: Record<string, [string, string]> = {
  EXCELLENT: ['Excelente', 'text-emerald-400'],
  GOOD: ['Boa', 'text-emerald-400'],
  AVERAGE: ['Média', 'text-amber-400'],
  POOR: ['Baixa', 'text-rose-400'],
  PENDING: ['Pendente', 'text-slate-400'],
  NO_ADS: ['Sem anúncios', 'text-slate-400'],
};
const APPROVAL_PT: Record<string, [string, string]> = {
  APPROVED: ['Aprovado', 'text-emerald-400'],
  APPROVED_LIMITED: ['Aprovado (limitado)', 'text-amber-400'],
  AREA_OF_INTEREST_ONLY: ['Aprovado (limitado)', 'text-amber-400'],
  DISAPPROVED: ['Reprovado', 'text-rose-400'],
  UNDER_REVIEW: ['Em análise', 'text-slate-400'],
  PENDING_REVIEW: ['Em análise', 'text-slate-400'],
};
const QUALITY_PT: Record<string, string> = {
  ABOVE_AVERAGE: 'Acima da média',
  AVERAGE: 'Média',
  BELOW_AVERAGE: 'Abaixo da média',
};
const AD_TYPE_PT: Record<string, string> = {
  RESPONSIVE_SEARCH_AD: 'Pesquisa responsivo',
  RESPONSIVE_DISPLAY_AD: 'Display responsivo',
  EXPANDED_TEXT_AD: 'Texto expandido',
  VIDEO_RESPONSIVE_AD: 'Vídeo responsivo',
  DEMAND_GEN_MULTI_ASSET_AD: 'Geração de demanda',
};

function keywordLabel(text: string, matchType?: string | null) {
  if (matchType === 'EXACT') return `[${text}]`;
  if (matchType === 'PHRASE') return `"${text}"`;
  return text;
}

const TITLES: Record<EntityLevel, string> = {
  ad_group: 'Grupos de anúncios',
  ad: 'Anúncios',
  keyword: 'Palavras-chave',
};

/** Leituras recentes, para trocar de aba sem esperar o banco de novo. */
const cache = new Map<string, { at: number; entities: Entity[]; metrics: any[] }>();

async function fetchAll(query: () => any) {
  const out: any[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await query().range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type SortKey = 'name' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cost' | 'conversions' | 'cpa' | 'conv_rate' | 'conversions_value' | 'quality';

export function GoogleAdsEntitiesTab(props: Props) {
  const { supabase, productId, level, startDate, endDate, fx, formatMoney, ui } = props;
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;

  const [entities, setEntities] = useState<Entity[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'with_data' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'cost', dir: 'desc' });
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!productId || !startDate || !endDate) return;
    const key = `${productId}|${startDate}|${endDate}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) {
      setEntities(hit.entities); setMetrics(hit.metrics); setLoading(false); setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchAll(() => supabase.from('google_ads_entities')
        .select('level, entity_id, ad_group_id, name, status, details')
        .eq('product_id', productId).order('id')),
      fetchAll(() => supabase.from('google_ads_entity_metrics')
        .select('level, entity_id, impressions, clicks, cost, conversions, conversions_value')
        .eq('product_id', productId).gte('date', startDate).lte('date', endDate).order('id')),
    ]).then(([ents, mets]) => {
      if (cancelled) return;
      cache.set(key, { at: Date.now(), entities: ents, metrics: mets });
      setEntities(ents); setMetrics(mets); setError(null);
    }).catch((e: any) => {
      if (!cancelled) setError(e?.message || 'Erro ao carregar');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supabase, productId, startDate, endDate]);

  const adGroups = useMemo(
    () => entities.filter(e => e.level === 'ad_group').sort((a, b) => a.name.localeCompare(b.name)),
    [entities],
  );
  const adGroupName = useMemo(() => new Map(adGroups.map(g => [g.entity_id, g.name])), [adGroups]);

  const rows: Row[] = useMemo(() => {
    const totals = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>();
    for (const m of metrics) {
      if (m.level !== level) continue;
      const t = totals.get(m.entity_id) || { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
      t.impressions += Number(m.impressions) || 0;
      t.clicks += Number(m.clicks) || 0;
      t.cost += (Number(m.cost) || 0) * fx;
      t.conversions += Number(m.conversions) || 0;
      t.conversions_value += (Number(m.conversions_value) || 0) * fx;
      totals.set(m.entity_id, t);
    }
    const term = search.trim().toLowerCase();
    return entities
      .filter(e => e.level === level)
      .filter(e => !props.adGroupFilter || level === 'ad_group' || e.ad_group_id === props.adGroupFilter)
      .map(e => {
        const t = totals.get(e.entity_id) || { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
        return {
          ...e, ...t,
          ctr: t.impressions ? t.clicks / t.impressions : 0,
          cpc: t.clicks ? t.cost / t.clicks : 0,
          cpa: t.conversions ? t.cost / t.conversions : 0,
          conv_rate: t.clicks ? t.conversions / t.clicks : 0,
        };
      })
      .filter(r => {
        if (statusFilter === 'active') return r.status === 'ENABLED';
        if (statusFilter === 'with_data') return r.impressions > 0;
        return true;
      })
      .filter(r => !term || r.name.toLowerCase().includes(term)
        || (r.details?.headlines || []).some((h: any) => String(h.text).toLowerCase().includes(term)))
      .sort((a, b) => {
        const va = sort.key === 'quality' ? (a.details?.quality_score ?? -1) : (a as any)[sort.key];
        const vb = sort.key === 'quality' ? (b.details?.quality_score ?? -1) : (b as any)[sort.key];
        const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
        return (sort.dir === 'asc' ? cmp : -cmp) || b.impressions - a.impressions;
      });
  }, [entities, metrics, level, fx, statusFilter, search, sort, props.adGroupFilter]);

  const total = useMemo(() => {
    const t = rows.reduce((acc, r) => {
      acc.impressions += r.impressions; acc.clicks += r.clicks; acc.cost += r.cost;
      acc.conversions += r.conversions; acc.conversions_value += r.conversions_value;
      return acc;
    }, { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 });
    return {
      ...t,
      ctr: t.impressions ? t.clicks / t.impressions : 0,
      cpc: t.clicks ? t.cost / t.clicks : 0,
      cpa: t.conversions ? t.cost / t.conversions : 0,
      conv_rate: t.clicks ? t.conversions / t.clicks : 0,
    };
  }, [rows]);

  const fmtInt = (v: number) => v.toLocaleString('pt-BR');
  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const fmtConv = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  const toggleSort = (key: SortKey) => setSort(s => s.key === key
    ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: key === 'name' ? 'asc' : 'desc' });

  const th = (label: string, key: SortKey, align: 'left' | 'right' = 'right') => (
    <th className={`px-3 py-3 border-b ${borderCol} whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}>
      <button onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 uppercase hover:text-indigo-400">
        {label}
        {sort.key === key && (sort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );

  const metricCells = (r: { impressions: number; clicks: number; ctr: number; cpc: number; cost: number; conversions: number; cpa: number; conv_rate: number; conversions_value: number }, bold = false) => (
    <>
      <td className={`px-3 py-3 text-right ${bold ? textHead : textMuted}`}>{fmtInt(r.impressions)}</td>
      <td className={`px-3 py-3 text-right ${bold ? textHead : textMuted}`}>{fmtInt(r.clicks)}</td>
      <td className={`px-3 py-3 text-right ${textMuted}`}>{fmtPct(r.ctr)}</td>
      <td className={`px-3 py-3 text-right ${textMuted}`}>{r.clicks ? formatMoney(r.cpc) : '—'}</td>
      <td className="px-3 py-3 text-right text-orange-400">{formatMoney(r.cost)}</td>
      <td className={`px-3 py-3 text-right ${r.conversions > 0 ? 'text-emerald-400 font-bold' : textMuted}`}>{fmtConv(r.conversions)}</td>
      <td className={`px-3 py-3 text-right ${textMuted}`}>{r.conversions ? formatMoney(r.cpa) : '—'}</td>
      <td className={`px-3 py-3 text-right ${textMuted}`}>{fmtPct(r.conv_rate)}</td>
      <td className={`px-3 py-3 text-right ${textMuted}`}>{r.conversions_value ? formatMoney(r.conversions_value) : '—'}</td>
    </>
  );

  const metricHeaders = (
    <>
      {th('Impr.', 'impressions')}
      {th('Cliques', 'clicks')}
      {th('CTR', 'ctr')}
      {th('CPC méd.', 'cpc')}
      {th('Custo', 'cost')}
      {th('Conv. Google', 'conversions')}
      {th('Custo/conv.', 'cpa')}
      {th('Taxa conv.', 'conv_rate')}
      {th('Valor conv.', 'conversions_value')}
    </>
  );

  const statusBadge = (status: string) => (
    <span className={`inline-flex items-center gap-1.5 text-xs ${status === 'ENABLED' ? 'text-emerald-400' : status === 'PAUSED' ? 'text-amber-400' : textMuted}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'ENABLED' ? 'bg-emerald-400' : status === 'PAUSED' ? 'bg-amber-400' : 'bg-slate-500'}`} />
      {STATUS_PT[status] || status}
    </span>
  );

  const selectCls = `text-sm rounded-lg px-3 py-1.5 border ${borderCol} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'}`;
  const hasAny = entities.some(e => e.level === level);
  const isPmax = props.channelType === 'PERFORMANCE_MAX';

  let empty: string | null = null;
  if (loading) empty = 'Carregando…';
  else if (error) empty = /google_ads_entit/.test(error)
    ? 'As tabelas deste recurso ainda não existem. Rode migration_google_ads_estrutura.sql no Supabase.'
    : `Erro ao carregar: ${error}`;
  else if (!hasAny) empty = isPmax
    ? 'Campanhas Performance Max não têm grupos de anúncios nem palavras-chave: o Google organiza em grupos de recursos.'
    : 'Nada coletado ainda. Este nível vem pela conexão com a API (Integração → Google Ads) e chega na próxima coleta completa, em até uma hora.';
  else if (!rows.length) empty = 'Nenhum item com estes filtros.';

  return (
    <div className="space-y-6">
      <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
        <div className={`p-4 border-b ${borderCol} flex flex-col lg:flex-row justify-between lg:items-center gap-3`}>
          <div className="flex items-center gap-3">
            <h3 className={`font-semibold ${textHead}`}>{TITLES[level]}</h3>
            {!loading && <span className={`text-xs ${textMuted} ${isDark ? 'bg-slate-950' : 'bg-slate-100'} px-2 py-1 rounded border ${borderCol}`}>{rows.length}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {level !== 'ad_group' && adGroups.length > 0 && (
              <select value={props.adGroupFilter} onChange={e => props.onAdGroupFilter(e.target.value)} className={`${selectCls} max-w-[240px]`}>
                <option value="">Todos os grupos</option>
                {adGroups.map(g => <option key={g.entity_id} value={g.entity_id}>{g.name}{g.status !== 'ENABLED' ? ` (${(STATUS_PT[g.status] || g.status).toLowerCase()})` : ''}</option>)}
              </select>
            )}
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className={selectCls}>
              <option value="active">Só ativos</option>
              <option value="with_data">Com impressões no período</option>
              <option value="all">Todos, inclusive pausados e removidos</option>
            </select>
            <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border ${borderCol} ${isDark ? 'bg-slate-950' : 'bg-white'}`}>
              <Search size={14} className={textMuted} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar"
                className={`bg-transparent outline-none text-sm w-32 ${isDark ? 'text-slate-200' : 'text-slate-800'}`} />
            </div>
          </div>
        </div>

        {empty ? (
          <div className={`p-10 text-center ${textMuted}`}>{empty}</div>
        ) : (
          <div className="overflow-auto custom-scrollbar max-h-[70vh]">
            <table className="w-full text-sm text-left border-collapse">
              <thead className={`text-xs font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0 z-10`}>
                <tr>
                  {th(level === 'ad_group' ? 'Grupo' : level === 'ad' ? 'Anúncio' : 'Palavra-chave', 'name', 'left')}
                  {level !== 'ad_group' && <th className={`px-3 py-3 border-b ${borderCol} uppercase`}>Grupo</th>}
                  <th className={`px-3 py-3 border-b ${borderCol} uppercase`}>Status</th>
                  {level === 'ad_group' && <th className={`px-3 py-3 border-b ${borderCol} uppercase text-right whitespace-nowrap`}>Lance / meta</th>}
                  {level === 'ad' && <th className={`px-3 py-3 border-b ${borderCol} uppercase whitespace-nowrap`}>Força</th>}
                  {level === 'keyword' && th('Qualidade', 'quality')}
                  {level === 'keyword' && <th className={`px-3 py-3 border-b ${borderCol} uppercase text-right whitespace-nowrap`}>CPC máx.</th>}
                  {metricHeaders}
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                {rows.map(r => {
                  const d = r.details || {};
                  const open = expanded === r.entity_id;
                  return (
                    <React.Fragment key={r.entity_id}>
                      <tr className={`align-top transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'} ${r.status === 'REMOVED' ? 'opacity-60' : ''}`}>
                        <td className={`px-3 py-3 ${textHead} max-w-[380px]`}>
                          {level === 'ad_group' && (
                            <div>
                              <div className="font-medium">{r.name}</div>
                              <div className="flex gap-3 mt-1 text-xs">
                                <button onClick={() => props.onOpenAdGroup(r.entity_id, 'ad')} className="text-indigo-400 hover:underline">Anúncios</button>
                                <button onClick={() => props.onOpenAdGroup(r.entity_id, 'keyword')} className="text-indigo-400 hover:underline">Palavras-chave</button>
                              </div>
                            </div>
                          )}
                          {level === 'ad' && (
                            <button onClick={() => setExpanded(open ? null : r.entity_id)} className="text-left w-full">
                              <div className="flex items-start gap-1.5">
                                {open ? <ChevronDown size={14} className="mt-0.5 flex-shrink-0" /> : <ChevronRight size={14} className="mt-0.5 flex-shrink-0" />}
                                <div className="min-w-0">
                                  <div className="font-medium text-indigo-400 truncate">
                                    {(d.headlines || []).slice(0, 3).map((h: any) => h.text).join(' | ') || r.name}
                                  </div>
                                  {d.descriptions?.[0]?.text && <div className={`text-xs ${textMuted} truncate`}>{d.descriptions[0].text}</div>}
                                  <div className={`text-[11px] ${textMuted} mt-0.5`}>
                                    {AD_TYPE_PT[d.type] || d.type}
                                    {d.approval && APPROVAL_PT[d.approval] && <> · <span className={APPROVAL_PT[d.approval][1]}>{APPROVAL_PT[d.approval][0]}</span></>}
                                  </div>
                                </div>
                              </div>
                            </button>
                          )}
                          {level === 'keyword' && <span className="font-medium font-mono text-[13px]">{keywordLabel(r.name, d.match_type)}</span>}
                        </td>
                        {level !== 'ad_group' && (
                          <td className={`px-3 py-3 text-xs ${textMuted} max-w-[160px] truncate`} title={adGroupName.get(r.ad_group_id || '') || ''}>
                            {adGroupName.get(r.ad_group_id || '') || '—'}
                          </td>
                        )}
                        <td className="px-3 py-3 whitespace-nowrap">{statusBadge(r.status)}</td>
                        {level === 'ad_group' && (
                          <td className={`px-3 py-3 text-right text-xs ${textMuted} whitespace-nowrap`}>
                            {d.target_cpa ? `CPA ${formatMoney(d.target_cpa * fx)}` : d.target_roas ? `ROAS ${(d.target_roas * 100).toFixed(0)}%` : d.cpc_bid ? `CPC ${formatMoney(d.cpc_bid * fx)}` : '—'}
                          </td>
                        )}
                        {level === 'ad' && (
                          <td className={`px-3 py-3 text-xs whitespace-nowrap ${STRENGTH_PT[d.ad_strength]?.[1] || textMuted}`}>
                            {STRENGTH_PT[d.ad_strength]?.[0] || '—'}
                          </td>
                        )}
                        {level === 'keyword' && (
                          <td className="px-3 py-3 text-right whitespace-nowrap"
                            title={[
                              `CTR esperada: ${QUALITY_PT[d.expected_ctr] || '—'}`,
                              `Relevância do anúncio: ${QUALITY_PT[d.creative_quality] || '—'}`,
                              `Experiência na página: ${QUALITY_PT[d.landing_page_quality] || '—'}`,
                            ].join('\n')}>
                            {d.quality_score ? (
                              <span className={`font-bold ${d.quality_score >= 7 ? 'text-emerald-400' : d.quality_score >= 5 ? 'text-amber-400' : 'text-rose-400'}`}>{d.quality_score}/10</span>
                            ) : <span className={textMuted}>—</span>}
                          </td>
                        )}
                        {level === 'keyword' && (
                          <td className={`px-3 py-3 text-right text-xs ${textMuted} whitespace-nowrap`}>
                            {d.cpc_bid ? formatMoney(d.cpc_bid * fx) : d.effective_cpc_bid ? formatMoney(d.effective_cpc_bid * fx) : '—'}
                          </td>
                        )}
                        {metricCells(r)}
                      </tr>
                      {level === 'ad' && open && (
                        <tr className={isDark ? 'bg-slate-950/60' : 'bg-slate-50'}>
                          <td colSpan={13} className="px-6 py-4">
                            <div className="grid md:grid-cols-2 gap-6 text-sm">
                              <div>
                                <div className={`text-xs font-bold uppercase ${textMuted} mb-2`}>Títulos ({(d.headlines || []).length})</div>
                                <ul className="space-y-1">
                                  {(d.headlines || []).map((h: any, i: number) => (
                                    <li key={i} className={textHead}>
                                      {h.text}
                                      {h.pin && <span className={`ml-2 text-[10px] ${textMuted}`}>fixado {String(h.pin).replace('HEADLINE_', 'na posição ')}</span>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <div className={`text-xs font-bold uppercase ${textMuted} mb-2`}>Descrições ({(d.descriptions || []).length})</div>
                                <ul className="space-y-1">
                                  {(d.descriptions || []).map((h: any, i: number) => (
                                    <li key={i} className={textHead}>
                                      {h.text}
                                      {h.pin && <span className={`ml-2 text-[10px] ${textMuted}`}>fixada {String(h.pin).replace('DESCRIPTION_', 'na posição ')}</span>}
                                    </li>
                                  ))}
                                </ul>
                                {d.final_url && (
                                  <a href={d.final_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-4 text-xs text-indigo-400 hover:underline break-all">
                                    <ExternalLink size={12} /> {d.final_url}{d.path1 ? ` (/${d.path1}${d.path2 ? `/${d.path2}` : ''})` : ''}
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot className={`sticky bottom-0 text-xs font-bold ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
                <tr>
                  <td className={`px-3 py-3 ${textHead}`}>Total ({rows.length})</td>
                  {level !== 'ad_group' && <td />}
                  <td />
                  <td />
                  {level === 'keyword' && <td />}
                  {metricCells(total, true)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <p className={`text-xs ${textMuted}`}>
        Conversões e valor são os que o Google mede, não as vendas do postback. Os dados chegam pela API na coleta completa, de hora em hora.
      </p>
    </div>
  );
}
