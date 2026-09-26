"use client";

import React, { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DimensionTable, DimItem } from '@/app/components/metrics/DimensionTable';
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
    // Antes da migration de colunas, google_metrics não existe.
    load(`${base}, google_metrics`).catch(() => load(base))
      .then(data => {
        if (cancelled) return;
        cache.set(key, { at: Date.now(), rows: data });
        setRows(data); setError(null);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Erro ao carregar'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supabase, productId, kind, startDate, endDate, cfg]);

  const scoped = useMemo(
    () => (kind === 'audiences' ? rows.filter(r => r.audience_type === audienceType) : rows),
    [rows, kind, audienceType],
  );

  const keyOf = (r: any) => (kind === 'audiences' ? `${r.audience_type}|${r.audience_name}` : String(r[cfg.name]));

  const dayRows: DayRow[] = useMemo(() => scoped.map(r => ({
    key: keyOf(r),
    date: r.date,
    impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions,
    google_metrics: r.google_metrics,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [scoped]);

  const items: DimItem[] = useMemo(() => {
    const seen = new Map<string, DimItem>();
    for (const r of scoped) {
      const k = keyOf(r);
      if (seen.has(k)) continue;
      const raw = String(r[cfg.name]);
      seen.set(k, { key: k, name: kind === 'audiences' ? audienceLabel(raw) : raw, raw });
    }
    return [...seen.values()];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped]);

  const titles: Record<SegmentKind, [string, string]> = {
    search_terms: ['Termos de pesquisa', 'Termo de pesquisa'],
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
      tableId={kind}
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
      toolbar={kind === 'audiences' ? (
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
