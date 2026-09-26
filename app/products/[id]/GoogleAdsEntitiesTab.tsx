"use client";

import React, { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { DimensionTable, DimColumn, DimItem } from '@/app/components/metrics/DimensionTable';
import type { Ui } from '@/app/components/metrics/ColumnPicker';
import type { CustomColumnsApi } from '@/app/components/metrics/useCustomColumns';
import type { CampaignDay, DayRow } from '@/lib/metrics/dimension';

/**
 * Abas de grupos de anúncios, anúncios e palavras-chave.
 *
 * Os itens vêm de google_ads_entities (como estão hoje no Google) e o
 * desempenho de google_ads_entity_metrics (por dia), somado no período da tela.
 * Os dois são gravados pela coleta da API — o script antigo não traz este nível.
 */

export type EntityLevel = 'ad_group' | 'ad' | 'keyword';

interface Props {
  supabase: SupabaseClient;
  productId: string;
  level: EntityLevel;
  startDate: string;
  endDate: string;
  /** Converte o dinheiro da moeda da conta para a moeda da tela. */
  fx: number;
  campaignDays: Map<string, CampaignDay>;
  formatMoney: (v: number) => string;
  custom: CustomColumnsApi;
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
const MATCH_PT: Record<string, string> = { EXACT: 'Exata', PHRASE: 'Frase', BROAD: 'Ampla' };
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

export function GoogleAdsEntitiesTab(props: Props) {
  const { supabase, productId, level, startDate, endDate, fx, formatMoney, ui } = props;
  const { isDark, borderCol, textMuted, textHead } = ui;

  const [entities, setEntities] = useState<Entity[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'with_data' | 'all'>('active');

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
    const loadMetrics = (cols: string) => fetchAll(() => supabase.from('google_ads_entity_metrics')
      .select(cols).eq('product_id', productId).gte('date', startDate).lte('date', endDate).order('id'));
    const base = 'level, entity_id, date, impressions, clicks, cost, conversions, conversions_value';
    Promise.all([
      fetchAll(() => supabase.from('google_ads_entities')
        .select('level, entity_id, ad_group_id, name, status, details')
        .eq('product_id', productId).order('id')),
      // Antes da migration de colunas, google_metrics não existe.
      loadMetrics(`${base}, google_metrics, conversion_actions`)
        .catch(() => loadMetrics(`${base}, google_metrics`))
        .catch(() => loadMetrics(base)),
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

  const dayRows: DayRow[] = useMemo(() => metrics
    .filter(m => m.level === level)
    .map(m => ({
      key: m.entity_id, date: m.date,
      impressions: m.impressions, clicks: m.clicks, cost: m.cost,
      conversions: m.conversions, conversions_value: m.conversions_value,
      google_metrics: m.google_metrics,
      conversion_actions: m.conversion_actions,
    })), [metrics, level]);

  const withData = useMemo(() => new Set(dayRows.filter(d => Number(d.impressions) > 0).map(d => d.key)), [dayRows]);

  const items: DimItem[] = useMemo(() => entities
    .filter(e => e.level === level)
    .filter(e => !props.adGroupFilter || level === 'ad_group' || e.ad_group_id === props.adGroupFilter)
    .filter(e => statusFilter === 'all' || (statusFilter === 'active' ? e.status === 'ENABLED' : withData.has(e.entity_id)))
    .map(e => ({
      ...e,
      key: e.entity_id,
      searchText: (e.details?.headlines || []).map((h: any) => h.text).join(' '),
    })), [entities, level, props.adGroupFilter, statusFilter, withData]);

  const statusBadge = (status: string) => (
    <span className={`inline-flex items-center gap-1.5 text-xs ${status === 'ENABLED' ? 'text-emerald-400' : status === 'PAUSED' ? 'text-amber-400' : textMuted}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'ENABLED' ? 'bg-emerald-400' : status === 'PAUSED' ? 'bg-amber-400' : 'bg-slate-500'}`} />
      {STATUS_PT[status] || status}
    </span>
  );

  const dims: DimColumn[] = [];
  if (level !== 'ad_group') dims.push({
    key: 'ad_group', label: 'Grupo',
    value: i => adGroupName.get(i.ad_group_id) || '',
    render: i => <span className={`text-xs ${textMuted} block max-w-[160px] truncate`} title={adGroupName.get(i.ad_group_id) || ''}>{adGroupName.get(i.ad_group_id) || '—'}</span>,
  });
  dims.push({ key: 'status', label: 'Status', value: i => STATUS_PT[i.status] || i.status, render: i => statusBadge(i.status) });
  if (level === 'ad_group') dims.push({
    key: 'bid', label: 'Lance / meta', align: 'right',
    render: i => {
      const d = i.details || {};
      return <span className={`text-xs ${textMuted}`}>
        {d.target_cpa ? `CPA ${formatMoney(d.target_cpa * fx)}` : d.target_roas ? `ROAS ${(d.target_roas * 100).toFixed(0)}%` : d.cpc_bid ? `CPC ${formatMoney(d.cpc_bid * fx)}` : '—'}
      </span>;
    },
  });
  if (level === 'ad') {
    dims.push({
      key: 'strength', label: 'Força', value: i => STRENGTH_PT[i.details?.ad_strength]?.[0] || '',
      render: i => <span className={`text-xs ${STRENGTH_PT[i.details?.ad_strength]?.[1] || textMuted}`}>{STRENGTH_PT[i.details?.ad_strength]?.[0] || '—'}</span>,
    });
    dims.push({
      key: 'approval', label: 'Aprovação', value: i => APPROVAL_PT[i.details?.approval]?.[0] || '',
      render: i => <span className={`text-xs ${APPROVAL_PT[i.details?.approval]?.[1] || textMuted}`}>{APPROVAL_PT[i.details?.approval]?.[0] || '—'}</span>,
    });
  }
  if (level === 'keyword') {
    dims.push({
      key: 'match', label: 'Correspondência', value: i => MATCH_PT[i.details?.match_type] || '',
      render: i => <span className={`text-xs ${textMuted}`}>{MATCH_PT[i.details?.match_type] || '—'}</span>,
    });
    dims.push({
      key: 'quality', label: 'Qualidade', align: 'right', value: i => i.details?.quality_score ?? null,
      render: i => {
        const d = i.details || {};
        return (
          <span title={[
            `CTR esperada: ${QUALITY_PT[d.expected_ctr] || '—'}`,
            `Relevância do anúncio: ${QUALITY_PT[d.creative_quality] || '—'}`,
            `Experiência na página: ${QUALITY_PT[d.landing_page_quality] || '—'}`,
          ].join('\n')}>
            {d.quality_score
              ? <span className={`font-bold ${d.quality_score >= 7 ? 'text-emerald-400' : d.quality_score >= 5 ? 'text-amber-400' : 'text-rose-400'}`}>{d.quality_score}/10</span>
              : <span className={textMuted}>—</span>}
          </span>
        );
      },
    });
    dims.push({
      key: 'max_cpc', label: 'CPC máx.', align: 'right',
      value: i => (i.details?.cpc_bid || i.details?.effective_cpc_bid || 0) * fx || null,
      render: i => {
        const v = i.details?.cpc_bid || i.details?.effective_cpc_bid;
        return <span className={`text-xs ${textMuted}`}>{v ? formatMoney(v * fx) : '—'}</span>;
      },
    });
  }

  const renderName = (i: DimItem, open: boolean, toggle: () => void) => {
    const d = i.details || {};
    if (level === 'ad_group') return (
      <div>
        <div className="font-medium">{i.name}</div>
        <div className="flex gap-3 mt-1 text-xs">
          <button onClick={() => props.onOpenAdGroup(i.entity_id, 'ad')} className="text-indigo-400 hover:underline">Anúncios</button>
          <button onClick={() => props.onOpenAdGroup(i.entity_id, 'keyword')} className="text-indigo-400 hover:underline">Palavras-chave</button>
        </div>
      </div>
    );
    if (level === 'keyword') return <span className="font-medium font-mono text-[13px]">{keywordLabel(i.name, d.match_type)}</span>;
    return (
      <button onClick={toggle} className="text-left w-full">
        <div className="flex items-start gap-1.5">
          {open ? <ChevronDown size={14} className="mt-0.5 flex-shrink-0" /> : <ChevronRight size={14} className="mt-0.5 flex-shrink-0" />}
          <div className="min-w-0">
            <div className="font-medium text-indigo-400 truncate">
              {(d.headlines || []).slice(0, 3).map((h: any) => h.text).join(' | ') || i.name}
            </div>
            {d.descriptions?.[0]?.text && <div className={`text-xs ${textMuted} truncate`}>{d.descriptions[0].text}</div>}
            <div className={`text-[11px] ${textMuted} mt-0.5`}>{AD_TYPE_PT[d.type] || d.type}</div>
          </div>
        </div>
      </button>
    );
  };

  const expandRender = (i: DimItem) => {
    const d = i.details || {};
    return (
      <div className="grid md:grid-cols-2 gap-6 text-sm">
        <div>
          <div className={`text-xs font-bold uppercase ${textMuted} mb-2`}>Títulos ({(d.headlines || []).length})</div>
          <ul className="space-y-1">
            {(d.headlines || []).map((h: any, idx: number) => (
              <li key={idx} className={textHead}>
                {h.text}
                {h.pin && <span className={`ml-2 text-[10px] ${textMuted}`}>fixado {String(h.pin).replace('HEADLINE_', 'na posição ')}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className={`text-xs font-bold uppercase ${textMuted} mb-2`}>Descrições ({(d.descriptions || []).length})</div>
          <ul className="space-y-1">
            {(d.descriptions || []).map((h: any, idx: number) => (
              <li key={idx} className={textHead}>
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
    );
  };

  const selectCls = `text-sm rounded-lg px-3 py-1.5 border ${borderCol} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'}`;
  const hasAny = entities.some(e => e.level === level);
  const isPmax = props.channelType === 'PERFORMANCE_MAX';

  let empty: string | null = null;
  if (error) empty = /google_ads_entit/.test(error)
    ? 'As tabelas deste recurso ainda não existem. Rode migration_google_ads_estrutura.sql no Supabase.'
    : `Erro ao carregar: ${error}`;
  else if (!loading && !hasAny) empty = isPmax
    ? 'Campanhas Performance Max não têm grupos de anúncios nem palavras-chave: o Google organiza em grupos de recursos.'
    : 'Nada coletado ainda. Este nível vem pela conexão com a API (Integração → Google Ads) e chega na próxima coleta completa, em até uma hora.';

  return (
    <DimensionTable
      tableId={level}
      title={TITLES[level]}
      nameLabel={level === 'ad_group' ? 'Grupo' : level === 'ad' ? 'Anúncio' : 'Palavra-chave'}
      items={items}
      dayRows={dayRows}
      fx={fx}
      campaignDays={props.campaignDays}
      formatMoney={formatMoney}
      custom={props.custom}
      ui={ui}
      dimensionColumns={dims}
      renderName={renderName}
      expandRender={level === 'ad' ? expandRender : undefined}
      rowClassName={i => (i.status === 'REMOVED' ? 'opacity-60' : '')}
      loading={loading}
      empty={empty}
      footnote="Conversões (Google) são as que o Google mede. As colunas com ≈ distribuem as vendas reais do dia (postback e lançamento manual) pelas conversões do Google de cada item, ou pelos cliques quando o Google ainda não contou nenhuma."
      toolbar={<>
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
      </>}
    />
  );
}
