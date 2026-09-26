"use client";

import React, { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DimensionTable, DimColumn, DimItem } from '@/app/components/metrics/DimensionTable';
import type { Ui } from '@/app/components/metrics/ColumnPicker';
import type { CustomColumnsApi } from '@/app/components/metrics/useCustomColumns';
import type { CampaignDay, DayRow } from '@/lib/metrics/dimension';

/**
 * Termos de pesquisa, públicos e locais, no período da tela.
 *
 * Vêm das tabelas search_terms, audiences e locations, que o script e a API
 * preenchem. Só a API traz o bloco google_metrics; linhas do script ficam com
 * impressões, cliques, custo e conversões.
 */

export type SegmentKind = 'search_terms' | 'audiences' | 'locations';

interface Props {
  supabase: SupabaseClient;
  productId: string;
  kind: SegmentKind;
  startDate: string;
  endDate: string;
  fx: number;
  campaignDays: Map<string, CampaignDay>;
  formatMoney: (v: number) => string;
  custom: CustomColumnsApi;
  ui: Ui;
}

const AUDIENCE_TYPES: { id: string; label: string }[] = [
  { id: 'Age', label: 'Idade' },
  { id: 'Gender', label: 'Gênero' },
  { id: 'Device', label: 'Dispositivo' },
  { id: 'Income', label: 'Renda familiar' },
];

const AUDIENCE_PT: Record<string, string> = {
  MALE: 'Masculino', FEMALE: 'Feminino',
  MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet', CONNECTED_TV: 'TV conectada', OTHER: 'Outros',
  AGE_RANGE_65_UP: '65 ou mais',
  // O Google numera a renda de baixo para cima: 0_50 são os 50% de menor renda.
  INCOME_RANGE_0_50: '50% com menor renda',
  INCOME_RANGE_50_60: '41–50% superiores',
  INCOME_RANGE_60_70: '31–40% superiores',
  INCOME_RANGE_70_80: '21–30% superiores',
  INCOME_RANGE_80_90: '11–20% superiores',
  INCOME_RANGE_90_UP: '10% com maior renda',
};

function audienceLabel(name: string) {
  if (AUDIENCE_PT[name]) return AUDIENCE_PT[name];
  if (/UNDETERMINED|UNKNOWN/.test(name)) return 'Desconhecido';
  const age = name.match(/^AGE_RANGE_(\d+)_(\d+)$/);
  if (age) return `${age[1]}–${age[2]} anos`;
  return name;
}

const MATCH_PT: Record<string, string> = { EXACT: 'Exata', PHRASE: 'Frase', BROAD: 'Ampla' };
/** Como o termo casou com a palavra-chave (inclui as variações próximas). */
const TERM_MATCH_PT: Record<string, string> = {
  EXACT: 'Exata', NEAR_EXACT: 'Exata (variação próxima)',
  PHRASE: 'Frase', NEAR_PHRASE: 'Frase (variação próxima)',
  BROAD: 'Ampla', AUTO: 'Automática',
};
const TERM_STATUS_PT: Record<string, string> = {
  ADDED: 'Adicionado', EXCLUDED: 'Excluído', ADDED_EXCLUDED: 'Adicionado e excluído', NONE: 'Nenhum',
};

function keywordLabel(text: string, matchType?: string | null) {
  if (!text) return '';
  if (matchType === 'EXACT') return `[${text}]`;
  if (matchType === 'PHRASE') return `"${text}"`;
  return text;
}

type TermView = 'term_keyword' | 'term' | 'keyword';

const TABLES: Record<SegmentKind, { table: string; name: string; type?: string }> = {
  search_terms: { table: 'search_terms', name: 'search_term' },
  audiences: { table: 'audiences', name: 'audience_name', type: 'audience_type' },
  locations: { table: 'locations', name: 'location_name', type: 'location_type' },
};

const cache = new Map<string, { at: number; rows: any[] }>();

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

export function SegmentTab(props: Props) {
  const { supabase, productId, kind, startDate, endDate, ui } = props;
  const { isDark, borderCol, textMuted } = ui;
  const cfg = TABLES[kind];

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audienceType, setAudienceType] = useState('Age');
  const [termView, setTermView] = useState<TermView>('term_keyword');

  useEffect(() => {
    if (!productId || !startDate || !endDate) return;
    const key = `${kind}|${productId}|${startDate}|${endDate}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) { setRows(hit.rows); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    const base = `date, ${cfg.name}, ${cfg.type ? `${cfg.type}, ` : ''}impressions, clicks, cost, conversions`;
    const load = (cols: string) => fetchAll(() => supabase.from(cfg.table).select(cols)
      .eq('product_id', productId).gte('date', startDate).lte('date', endDate).order('id'));
    // Colunas novas só existem depois das migrations: tenta da mais nova para a mais antiga.
    const termCols = kind === 'search_terms' ? ', keyword, keyword_match_type, ad_group_name, term_status, term_match_type, conversion_actions' : '';
    load(`${base}, google_metrics${termCols}`)
      .catch(() => load(`${base}, google_metrics`))
      .catch(() => load(base))
      .then(data => {
        if (cancelled) return;
        cache.set(key, { at: Date.now(), rows: data });
        setRows(data); setError(null);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Erro ao carregar'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supabase, productId, kind, startDate, endDate, cfg]);

  const scoped = useMemo(() => {
    if (kind === 'audiences') return rows.filter(r => r.audience_type === audienceType);
    if (kind !== 'search_terms') return rows;
    // Enquanto o script roda junto, o mesmo dia pode ter o termo sem
    // palavra-chave (script) e com (API). Vale o da API.
    const withKeyword = new Set(rows.filter(r => r.keyword).map(r => r.date));
    return rows.filter(r => r.keyword || !withKeyword.has(r.date));
  }, [rows, kind, audienceType]);

  const keyOf = (r: any) => {
    if (kind === 'audiences') return `${r.audience_type}|${r.audience_name}`;
    if (kind === 'search_terms') {
      const kw = `${r.keyword || ''}|${r.keyword_match_type || ''}`;
      if (termView === 'keyword') return kw;
      if (termView === 'term_keyword') return `${r.search_term}|${kw}`;
    }
    return String(r[cfg.name]);
  };

  const dayRows: DayRow[] = useMemo(() => scoped.map(r => ({
    key: keyOf(r),
    date: r.date,
    impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions,
    google_metrics: r.google_metrics,
    conversion_actions: r.conversion_actions,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [scoped, termView]);

  const items: DimItem[] = useMemo(() => {
    const seen = new Map<string, DimItem>();
    for (const r of scoped) {
      const k = keyOf(r);
      const cur = seen.get(k);
      if (cur) {
        // Contagens para as visões agrupadas; o último dia define grupo e status.
        cur.terms.add(r.search_term);
        if (r.keyword) cur.keywords.add(`${r.keyword}|${r.keyword_match_type}`);
        if (r.date >= cur.lastDate) Object.assign(cur, { lastDate: r.date, adGroup: r.ad_group_name || cur.adGroup, status: r.term_status || cur.status, termMatch: r.term_match_type || cur.termMatch });
        continue;
      }
      const raw = String(r[cfg.name]);
      const kwLabel = keywordLabel(r.keyword || '', r.keyword_match_type);
      seen.set(k, {
        key: k,
        name: kind === 'audiences' ? audienceLabel(raw) : kind === 'search_terms' && termView === 'keyword' ? (kwLabel || '(sem palavra-chave)') : raw,
        raw,
        keyword: kwLabel,
        keywordMatch: r.keyword_match_type || '',
        adGroup: r.ad_group_name || '',
        status: r.term_status || '',
        termMatch: r.term_match_type || '',
        lastDate: r.date,
        terms: new Set([r.search_term]),
        keywords: new Set(r.keyword ? [`${r.keyword}|${r.keyword_match_type}`] : []),
      });
    }
    return [...seen.values()];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, termView]);

  const hasKeywords = kind === 'search_terms' && rows.some(r => r.keyword);
  const muted = (text: string) => <span className={`text-xs ${textMuted}`}>{text || '—'}</span>;
  const dims: DimColumn[] = [];
  if (hasKeywords && termView === 'term_keyword') {
    dims.push({ key: 'keyword', label: 'Palavra-chave', value: i => i.keyword, render: i => <span className="font-mono text-[13px] text-indigo-300">{i.keyword || '—'}</span> });
    dims.push({ key: 'kw_match', label: 'Corresp. da palavra', value: i => MATCH_PT[i.keywordMatch] || '', render: i => muted(MATCH_PT[i.keywordMatch]) });
    dims.push({ key: 'term_match', label: 'Corresp. do termo', value: i => TERM_MATCH_PT[i.termMatch] || i.termMatch, render: i => muted(TERM_MATCH_PT[i.termMatch] || i.termMatch) });
    dims.push({ key: 'ad_group', label: 'Grupo', value: i => i.adGroup, render: i => <span className={`text-xs ${textMuted} block max-w-[160px] truncate`} title={i.adGroup}>{i.adGroup || '—'}</span> });
    dims.push({ key: 'term_status', label: 'Status do termo', value: i => TERM_STATUS_PT[i.status] || i.status,
      render: i => <span className={`text-xs ${i.status === 'ADDED' ? 'text-emerald-400' : i.status === 'EXCLUDED' ? 'text-rose-400' : textMuted}`}>{TERM_STATUS_PT[i.status] || '—'}</span> });
  }
  if (hasKeywords && termView === 'term') {
    dims.push({ key: 'n_keywords', label: 'Palavras-chave', align: 'right', value: i => i.keywords.size, render: i => muted(String(i.keywords.size)) });
  }
  if (hasKeywords && termView === 'keyword') {
    dims.push({ key: 'kw_match', label: 'Correspondência', value: i => MATCH_PT[i.keywordMatch] || '', render: i => muted(MATCH_PT[i.keywordMatch]) });
    dims.push({ key: 'n_terms', label: 'Termos', align: 'right', value: i => i.terms.size, render: i => muted(String(i.terms.size)) });
  }

  const titles: Record<SegmentKind, [string, string]> = {
    search_terms: ['Termos de pesquisa', termView === 'keyword' ? 'Palavra-chave' : 'Termo de pesquisa'],
    audiences: [`Públicos · ${AUDIENCE_TYPES.find(t => t.id === audienceType)?.label}`, AUDIENCE_TYPES.find(t => t.id === audienceType)?.label || 'Público'],
    locations: ['Locais', 'País'],
  };

  const empty = error
    ? `Erro ao carregar: ${error}`
    : !loading && !rows.length
      ? 'Nada coletado neste período. Termos, públicos e locais cobrem os últimos dias de cada coleta — escolha um período mais recente ou confira se a conta está conectada.'
      : null;

  return (
    <DimensionTable
      tableId={kind === 'search_terms' ? `search_terms_${termView}` : kind}
      dimensionColumns={dims}
      title={titles[kind][0]}
      nameLabel={titles[kind][1]}
      items={items}
      dayRows={dayRows}
      fx={props.fx}
      campaignDays={props.campaignDays}
      formatMoney={props.formatMoney}
      custom={props.custom}
      ui={ui}
      loading={loading}
      empty={empty}
      toolbar={kind === 'search_terms' && hasKeywords ? (
        <select value={termView} onChange={e => setTermView(e.target.value as TermView)}
          className={`text-sm rounded-lg px-3 py-1.5 border ${borderCol} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'}`}>
          <option value="term_keyword">Termo + palavra-chave</option>
          <option value="term">Só o termo</option>
          <option value="keyword">Por palavra-chave</option>
        </select>
      ) : kind === 'audiences' ? (
        <div className={`flex rounded-lg border ${borderCol} overflow-hidden`}>
          {AUDIENCE_TYPES.map(t => (
            <button key={t.id} onClick={() => setAudienceType(t.id)}
              className={`px-3 py-1.5 text-sm font-semibold ${audienceType === t.id ? 'bg-indigo-600 text-white' : `${textMuted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}`}>
              {t.label}
            </button>
          ))}
        </div>
      ) : undefined}
      footnote={kind === 'search_terms'
        ? 'Até 200 termos por campanha e por dia, os de mais impressões. As colunas com ≈ distribuem as vendas reais do dia pelas conversões do Google de cada termo (ou pelos cliques).'
        : 'As colunas com ≈ distribuem as vendas reais do dia pelas conversões do Google de cada linha (ou pelos cliques quando o Google ainda não contou nenhuma).'}
    />
  );
}
