"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, RefreshCw, Check, X, AlertTriangle, Minus, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Ui } from '@/app/components/metrics/ColumnPicker';
import { ACTIONS } from '@/lib/analysis/actions';
import { formatMoney } from '@/lib/analysis/labels';

/**
 * Aba "Análise": checklist fixo de 8 itens, sempre na mesma ordem.
 *
 * Os números vêm prontos de /api/analysis (calculados no servidor a cada
 * coleta). A tela só organiza: resumo, linha de números, checklist com a
 * tabela e os pontos de alteração de cada item, e o resultado das sugestões
 * anteriores desta campanha.
 */

type Status = 'ok' | 'alerta' | 'urgente' | 'sem_dado';

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

const ddmm = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const pctText = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);

function timeAgo(ts?: string | null) {
  if (!ts) return 'nunca';
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

const FIELD_PT: Record<string, string> = {
  cpc_bid_micros: 'lance', bid_modifier: 'ajuste', status: 'status', negative: 'negativa', text: 'texto',
  amount_micros: 'orçamento', target_cpa_micros: 'meta de CPA',
};

export function AnalysisTab({ productId, ui, onOpenVturb }: { productId: string; ui: Ui; onOpenVturb?: () => void }) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const { ok, body } = await api(`/api/analysis?product_id=${productId}`);
    if (!ok) setError(body.error || 'Não foi possível carregar a análise.');
    else {
      setError(null);
      setData(body);
      // Abre sozinho o primeiro item com problema.
      const items: any[] = body.analysis?.checklist || [];
      const first = items.find(i => i.status === 'urgente') || items.find(i => i.status === 'alerta');
      if (first) setOpen(o => (Object.keys(o).length ? o : { [first.key]: true }));
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  const rerun = async () => {
    setRunning(true);
    const { ok, body } = await api('/api/analysis', { method: 'POST', body: JSON.stringify({ product_id: productId }) });
    if (!ok) setError(body.error || 'A análise falhou.');
    await load();
    setRunning(false);
  };

  const mark = async (id: string, status: 'ignorada' | 'nao_faz_sentido') => {
    await api('/api/analysis', { method: 'PATCH', body: JSON.stringify({ id, status }) });
    await load();
  };


  // ── cores ────────────────────────────────────────────────────────────────
  const tone = {
    ok: isDark ? 'text-emerald-400' : 'text-emerald-600',
    alerta: isDark ? 'text-orange-400' : 'text-orange-600',
    urgente: isDark ? 'text-rose-400' : 'text-rose-600',
    sem_dado: textMuted,
  } as Record<Status, string>;
  const pill = {
    ok: isDark ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700',
    alerta: isDark ? 'bg-orange-500/10 border-orange-500/40 text-orange-400' : 'bg-orange-50 border-orange-300 text-orange-700',
    urgente: isDark ? 'bg-rose-500/10 border-rose-500/40 text-rose-400' : 'bg-rose-50 border-rose-300 text-rose-700',
    sem_dado: isDark ? 'bg-slate-500/10 border-slate-500/30 text-slate-400' : 'bg-slate-100 border-slate-300 text-slate-500',
  } as Record<Status, string>;
  const soft = isDark ? 'bg-slate-950' : 'bg-slate-50';
  const Pill = ({ s, children }: { s: Status; children: React.ReactNode }) => (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${pill[s]}`}>{children}</span>
  );
  const Icon = ({ s, big }: { s: Status; big?: boolean }) => {
    const size = big ? 22 : 13;
    const box = big ? 'w-12 h-12 rounded-xl' : 'w-6 h-6 rounded-full';
    const inner = s === 'ok' ? <Check size={size} strokeWidth={3} /> : s === 'urgente' ? <X size={size} strokeWidth={3} /> : s === 'alerta' ? <AlertTriangle size={size} strokeWidth={2.5} /> : <Minus size={size} strokeWidth={3} />;
    return <span className={`${box} shrink-0 grid place-items-center border ${pill[s]}`}>{inner}</span>;
  };

  if (loading) return <div className={`flex items-center gap-2 ${textMuted} text-sm`}><Loader2 size={16} className="animate-spin" /> Carregando a análise…</div>;
  if (data && data.ready === false) return <div className={`${bgCard} border ${borderCol} rounded-xl p-6 text-sm ${textMuted}`}>{data.error}</div>;

  const a = data?.analysis;
  const ref = a?.reference;
  const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(Number(v), ref?.currency));
  const statusLabel = (s: Status, r?: any) =>
    s === 'ok' ? (r && r.conv3 === 0 && r.cost3 > 0 ? 'abaixo do limite' : 'ok') : s === 'sem_dado' ? 'sem dado' : s;

  if (!a) {
    return (
      <div className="space-y-5 max-w-6xl">
      <div className={`${bgCard} border ${borderCol} rounded-xl p-6 space-y-3`}>
        <div className={`font-bold ${textHead}`}>Esta campanha ainda não foi analisada</div>
        <div className={`text-sm ${textMuted}`}>A análise roda sozinha depois de cada coleta, para campanhas com gasto nos últimos 7 dias.</div>
        {error && <div className="text-sm text-rose-500">{error}</div>}
        <button onClick={rerun} disabled={running} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-60">
          {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Analisar agora
        </button>
      </div>
      </div>
    );
  }

  // Item 8 antigo (página e vídeo) agora é a análise da aba VTurb.
  const items: any[] = (a.checklist || []).filter((i: any) => i.key !== 'pagina');
  const topo = a.summary?.topo;
  const suggestions: any[] = data.suggestions || [];
  const history: any[] = data.history || [];
  const counts = items.reduce((acc, i) => {
    acc.urgente += i.status === 'urgente' ? 1 : 0;
    acc.alerta += i.status === 'alerta' ? 1 : 0;
    acc.ok += i.status === 'ok' ? 1 : 0;
    return acc;
  }, { urgente: 0, alerta: 0, ok: 0 });
  const d3 = a.numbers?.d3 || {}, d7 = a.numbers?.d7 || {};
  const summary = a.summary || {};
  const summaryStatus: Status = summary.status || 'sem_dado';

  // ── números ──────────────────────────────────────────────────────────────
  const delta = (now: number | null, before: number | null, lowerIsBetter: boolean, pp = false) => {
    if (now === null || before === null || now === undefined || before === undefined) return null;
    const diff = pp ? (now - before) * 100 : before ? ((now - before) / before) * 100 : null;
    if (diff === null || Math.abs(diff) < (pp ? 0.1 : 1)) return <span className={textMuted}>igual</span>;
    const good = lowerIsBetter ? diff < 0 : diff > 0;
    return <span className={good ? tone.ok : tone.urgente}>{diff > 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(pp ? 1 : 0).replace('.', ',')}{pp ? ' pp' : '%'}</span>;
  };
  const cpaTone = d3.cpa === null || !ref?.value ? textHead : d3.cpa > ref.urgent ? tone.urgente : d3.cpa >= ref.warn ? tone.alerta : tone.ok;
  const numbers = [
    { l: 'CPA', v: money(d3.cpa), c: `7d ${money(d7.cpa)}`, d: delta(d3.cpa, d7.cpa, true), t: cpaTone },
    { l: 'Gasto/dia', v: money(d3.cost_day), c: `7d ${money(d7.cost_day)}`, d: delta(d3.cost_day, d7.cost_day, true), t: textHead },
    { l: 'Vendas/dia', v: String(d3.sales_day ?? '—').replace('.', ','), c: `7d ${String(d7.sales_day ?? '—').replace('.', ',')}`, d: delta(d3.sales_day, d7.sales_day, false), t: tone.ok },
    { l: 'CTR', v: pctText(d3.ctr), c: `7d ${pctText(d7.ctr)}`, d: delta(d3.ctr, d7.ctr, false, true), t: textHead },
    { l: 'CPC', v: money(d3.cpc), c: `7d ${money(d7.cpc)}`, d: delta(d3.cpc, d7.cpc, true), t: textHead },
    { l: 'Visibilidade', v: pctText(d3.visibility), c: `7d ${pctText(d7.visibility)}`, d: delta(d3.visibility, d7.visibility, false, true), t: textHead },
  ];

  // ── tabelas de cada item ─────────────────────────────────────────────────
  const th = `px-3 py-2 text-[10.5px] uppercase tracking-wider font-bold ${textMuted} ${soft} whitespace-nowrap border-b ${borderCol}`;
  const td = `px-3 py-2 text-[13px] whitespace-nowrap border-b ${borderCol}`;
  const conv = (v: number, approx = false) => <span className={v > 0 ? `${tone.ok} font-bold` : textMuted}>{approx && v > 0 ? '≈ ' : ''}{String(v).replace('.', ',')}</span>;
  const cpa = (r: any) => (r.cpa3 === null ? <span className={textMuted}>—</span> : <span className={tone[r.status as Status] || ''}>{r.approx ? '≈ ' : ''}{money(r.cpa3)}</span>);
  const pctRef = (r: any) => r.pct === null ? <span className={textMuted}>—</span>
    : <span className={tone[r.status as Status] || ''}>{Math.round(r.pct * 100)}%{r.conv3 === 0 ? ' sem venda' : ''}</span>;

  type Col = { h: string; n?: boolean; r: (row: any) => React.ReactNode };
  const nameCol = (h: string): Col => ({
    h, r: row => <span className={`font-medium ${textHead}`}>{row.label}{row.tag && <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${soft} ${textMuted}`}>{row.tag}</span>}</span>,
  });
  const base: Col[] = [
    { h: 'Custo 3d', n: true, r: row => money(row.cost3) },
    { h: 'Vendas 3d', n: true, r: row => conv(row.conv3, row.approx) },
    { h: 'CPA 3d', n: true, r: cpa },
    { h: 'CPA 7d', n: true, r: row => <span className={textMuted}>{row.approx && row.cpa7 !== null ? '≈ ' : ''}{money(row.cpa7)}</span> },
    { h: `% ${ref?.of || ''}`, n: true, r: pctRef },
  ];
  const statusCol: Col = { h: 'Status', r: row => <Pill s={row.status}>{row.extra?.mirror ? 'igual à campanha' : statusLabel(row.status, row)}</Pill> };
  const columns: Record<string, Col[]> = {
    termos: [nameCol('Termo'), ...base, { h: 'Palavra-chave', r: row => <span className={textMuted}>{row.extra?.keyword || '—'}</span> }, statusCol],
    palavras_chave: [nameCol('Palavra-chave'), { h: 'Índ. qualidade', n: true, r: row => row.extra?.quality ?? '—' },
      { h: 'CPC 3d', n: true, r: row => money(row.extra?.cpc3) }, { h: 'CPC 7d', n: true, r: row => <span className={textMuted}>{money(row.extra?.cpc7)}</span> }, ...base, statusCol],
    dispositivos: [nameCol('Dispositivo'),
      { h: '% dos cliques 7d → 3d', r: row => {
        const s7 = row.extra?.share7, s3 = row.extra?.share3;
        const moved = s7 !== null && s3 !== null ? (s3 - s7) * 100 : 0;
        return <span>{pctText(s7)} → {pctText(s3)}{Math.abs(moved) >= 3 && <span className={`ml-2 text-[11px] ${moved < 0 ? tone.urgente : tone.ok}`}>{moved < 0 ? 'perdendo espaço' : 'ganhando espaço'}</span>}</span>;
      } },
      ...base, { h: 'Conv. 3d', n: true, r: row => pctText(row.extra?.convRate3) }, statusCol],
    publicos: [nameCol('Público'), ...base, statusCol],
    locais: [nameCol('Local'), ...base, statusCol],
    anuncios: [nameCol('Anúncio'), { h: 'CTR 3d', n: true, r: row => pctText(row.extra?.ctr3) }, ...base, statusCol],
    sitelinks: [nameCol('Recurso'), { h: 'Cliques 3d', n: true, r: row => row.extra?.clicks3 ?? '—' }, ...base, statusCol],
  };

  const Table = ({ item }: { item: any }) => {
    const cols = columns[item.key];
    if (!cols || !item.rows?.length) return <div className={`text-sm italic ${textMuted}`}>Sem gasto nos últimos 7 dias.</div>;
    return (
      <div className={`overflow-x-auto rounded-lg border ${borderCol}`}>
        <table className="w-full border-collapse tabular-nums">
          <thead><tr>{cols.map(c => <th key={c.h} className={`${th} ${c.n ? 'text-right' : 'text-left'}`}>{c.h}</th>)}</tr></thead>
          <tbody>
            {item.rows.map((row: any) => (
              <tr key={row.key}>{cols.map(c => <td key={c.h} className={`${td} ${c.n ? 'text-right' : ''}`}>{c.r(row)}</td>)}</tr>
            ))}
            {item.others && (
              <tr className={soft}>
                <td className={`${td} ${textMuted}`}>Outros {item.others.count}</td>
                {cols.slice(1).map(c => (
                  <td key={c.h} className={`${td} text-right ${textMuted}`}>
                    {c.h === 'Custo 3d' ? money(item.others.cost3) : c.h === 'Vendas 3d' ? String(item.others.conv3).replace('.', ',') : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        {item.rows.some((r: any) => r.approx) && (
          <div className={`px-3 py-1.5 text-[11px] ${textMuted} ${soft}`}>≈ vendas reais da campanha divididas entre os itens pelas conversões do Google, ou pelos cliques quando não há conversão.</div>
        )}
      </div>
    );
  };

  const tracking = (s: any) => {
    const b = s.baseline || {};
    const v = b.vturb;
    const vturbPage = v && (s.action === 'ajuste_pagina' || s.action === 'ajuste_vsl');
    const since = `Registrado em ${ddmm(s.created_at?.slice(0, 10))}${v?.metric === 'fuga' ? ` com fuga de ${pctText(v.d3)}` : v?.metric === 'pitch' ? ` com chegada ao pitch em ${pctText(v.d3)}` : b.cpa3 ? ` com CPA de ${money(b.cpa3)}` : b.cost3 ? ` com ${money(b.cost3)} gastos sem venda` : ''}.`;
    if (s.status !== 'aplicada') {
      return vturbPage
        ? <>{since} A mudança é percebida quando {s.action === 'ajuste_pagina' ? 'a página muda (relida 1 vez por dia, sem IA), ' : ''}o vídeo ou o player é trocado. Resultado pela {v.metric === 'pitch' ? 'chegada ao pitch' : 'fuga da página'} 3 e 7 dias depois.</>
        : <>{since} Ainda não há mudança no Google.</>;
    }
    const ch = s.change || {};
    const fields = (ch.fields || []).slice(0, 2).map((f: any) => {
      const name = FIELD_PT[String(f.f).split('.').pop() || ''] || String(f.f).split('.').pop();
      return f.de && f.de !== f.para ? `${name} de ${f.de} para ${f.para}` : `${name} ${f.para}`;
    }).join(', ');
    const day = String(ch.changed_at || '').slice(0, 10);
    const e3 = s.eval_3d;
    return (
      <>
        {since} <span className={tone.ok}>Mudança vista {ch.type === 'PAGINA' ? 'na página' : ch.type === 'PLAYER' ? 'no player' : ch.type === 'VIDEO' ? 'no vídeo do player' : 'no Google'} em {ddmm(day)}{fields ? ` (${fields})` : ''}.</span>{' '}
        {e3 ? (e3.metric
          ? <>Em 3 dias: {e3.metric === 'pitch' ? 'chegada ao pitch' : 'fuga da página'} {pctText(e3.metric_before)} → {pctText(e3.metric_after)}. Resultado final 7 dias depois.</>
          : <>Em 3 dias: CPA {money(e3.cpa_before)} → {money(e3.cpa_after)}. Resultado final 7 dias depois.</>)
          : <>Primeira conferência 3 dias depois.</>}
      </>
    );
  };

  const Points = ({ list }: { list: any[] }) => (
    <div className="space-y-2 mt-3">
      {list.map(s => (
        <div key={s.id} className={`rounded-r-lg border-l-[3px] border-blue-400 ${soft} px-3 py-2`}>
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-[220px]">
              <div className={`text-[10.5px] uppercase tracking-wider font-bold ${textMuted}`}>✦ Ponto de alteração · {s.target_label}</div>
              <div className={`text-[13px] ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{s.text}</div>
            </div>
            {s.status === 'aberta' && (
              <div className="flex gap-1.5">
                <button onClick={() => mark(s.id, 'ignorada')} className={`text-[11px] px-2 py-1 rounded border ${borderCol} ${textMuted} hover:text-indigo-400`}>Ignorar</button>
                <button onClick={() => mark(s.id, 'nao_faz_sentido')} className={`text-[11px] px-2 py-1 rounded border ${borderCol} ${textMuted} hover:text-rose-400`}>Não faz sentido</button>
              </div>
            )}
          </div>
          <div className={`text-[11.5px] mt-1 ${textMuted}`}>⟳ {tracking(s)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5 max-w-6xl">
      {error && <div className="text-sm text-rose-500">{error}</div>}
      {!data.ai && <div className={`text-xs ${textMuted}`}>IA desligada no servidor (OPENROUTER_API_KEY). Números e checklist funcionam; os textos usam o modelo padrão.</div>}

      {/* 1. Resumo */}
      <div className={`${bgCard} border ${borderCol} rounded-xl p-4 md:p-5 grid grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_auto] gap-4 items-center`}>
        <Icon s={summaryStatus} big />
        <div className="min-w-0">
          <div className={`text-base font-extrabold ${textHead}`}>{summary.source === 'ia' ? '✦ ' : ''}{summary.title || 'Leitura da campanha'}</div>
          {summary.text && <div className={`text-[13px] mt-0.5 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{summary.text}</div>}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {counts.urgente > 0 && <Pill s="urgente">{counts.urgente} {counts.urgente === 1 ? 'urgente' : 'urgentes'}</Pill>}
            {counts.alerta > 0 && <Pill s="alerta">{counts.alerta} em alerta</Pill>}
            <Pill s="ok">{counts.ok} {counts.ok === 1 ? 'item ok' : 'itens ok'}</Pill>
          </div>
        </div>
        <div className={`col-span-2 lg:col-span-1 text-[11.5px] ${textMuted} lg:text-right leading-relaxed`}>
          {ref?.mode === 'nenhuma' ? <>Sem referência: {ref.basis}</> : <>
            {ref?.mode === 'venda' ? 'Venda média' : ref?.mode === 'meta_cpa' ? 'Meta de CPA' : 'CPA de 7 dias'} {money(ref?.value)} · alerta ≥ {money(ref?.warn)} · urgente &gt; {money(ref?.urgent)}
            <br /><span title={ref?.basis}>{ref?.basis}</span></>}
          <br />3 dias ({ddmm(a.period?.d3?.[0])}–{ddmm(a.period?.d3?.[1])}) × 7 dias ({ddmm(a.period?.d7?.[0])}–{ddmm(a.period?.d7?.[1])})
          <br />Atualizado {timeAgo(a.computed_at)} ·{' '}
          <button onClick={rerun} disabled={running} className="text-indigo-400 hover:underline inline-flex items-center gap-1 disabled:opacity-60">
            {running && <Loader2 size={11} className="animate-spin" />}reanalisar
          </button>
          <br /><a href="/analise-ia" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Análise de IA das campanhas parecidas</a>
        </div>
      </div>

      {/* 2. Números */}
      <div className={`${bgCard} border ${borderCol} rounded-xl grid grid-cols-3 lg:grid-cols-6 overflow-hidden tabular-nums`}>
        {numbers.map((x, i) => (
          <div key={x.l} className={`px-4 py-3 ${i % 3 !== 2 ? `border-r ${borderCol}` : ''} lg:border-r ${i < 3 ? `border-b lg:border-b-0 ${borderCol}` : ''} ${i === 5 ? 'lg:border-r-0' : ''}`}>
            <div className={`text-[10.5px] uppercase tracking-wider font-bold ${textMuted}`}>{x.l}</div>
            <div className={`text-lg font-extrabold ${x.t}`}>{x.v}</div>
            <div className={`text-[11.5px] ${textMuted}`}>{x.c} {x.d}</div>
          </div>
        ))}
      </div>

      {/* 3. Checklist */}
      <div>
        <div className={`flex items-center gap-2 text-[11px] uppercase tracking-wider font-extrabold ${textMuted} mb-2`}>
          Verificação da campanha <span className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
        </div>
        <div className={`${bgCard} border ${borderCol} rounded-xl overflow-hidden`}>
          {items.map((item, idx) => {
            const isOpen = !!open[item.key];
            const points = suggestions.filter(s => s.item === item.key);
            const c = item.counts || {};
            const badge = item.status === 'urgente' ? `${c.urgente} ${c.urgente === 1 ? 'urgente' : 'urgentes'}`
              : item.status === 'alerta' ? `${c.alerta} ${c.alerta === 1 ? 'alerta' : 'alertas'}` : statusLabel(item.status);
            return (
              <div key={item.key} className={idx < items.length - 1 ? `border-b ${borderCol}` : ''}>
                <button onClick={() => setOpen(o => ({ ...o, [item.key]: !o[item.key] }))}
                  className={`w-full grid grid-cols-[24px_1fr_14px] md:grid-cols-[24px_220px_1fr_auto_14px] gap-3 items-center px-4 py-3 text-left transition-colors ${isDark ? 'hover:bg-slate-950' : 'hover:bg-slate-50'}`}>
                  <Icon s={item.status} />
                  <span className={`font-bold text-sm ${textHead}`}>{idx + 1}. {item.title}</span>
                  <span className={`hidden md:block text-[13px] truncate ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{item.headline}</span>
                  <span className="hidden md:block"><Pill s={item.status}>{badge}</Pill></span>
                  <ChevronRight size={14} className={`${textMuted} transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className={`md:hidden col-start-2 col-span-2 text-[12.5px] ${textMuted}`}>{item.headline}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 md:pl-[52px]">
                    <Table item={item} />
                    {points.length > 0 && <Points list={points} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Topo de funil em alerta: só a ligação, a análise fica na aba VTurb. */}
        {topo && (topo.status === 'alerta' || topo.status === 'urgente') && (
          <div className={`mt-2 ${bgCard} border ${borderCol} rounded-xl px-4 py-2.5 flex items-center gap-2.5 flex-wrap text-[13px]`}>
            <Icon s={topo.status} />
            <span className={textHead}>Página e vídeo: {topo.headline || topo.title}</span>
            {onOpenVturb && <button onClick={onOpenVturb} className="ml-auto text-xs text-indigo-400 hover:underline">ver na aba VTurb</button>}
          </div>
        )}
      </div>

      {/* 4. Resultado das sugestões anteriores */}
      <div>
        <div className={`flex items-center gap-2 text-[11px] uppercase tracking-wider font-extrabold ${textMuted} mb-2`}>
          Resultado das sugestões anteriores · esta campanha <span className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
        </div>
        {history.length === 0 ? (
          <div className={`text-[13px] ${textMuted}`}>
            Ainda não há resultado. Cada sugestão é registrada com os números do momento. Quando a mudança aparece no histórico do Google, o resultado é conferido 3 e 7 dias depois.
          </div>
        ) : (
          <div className={`${bgCard} border ${borderCol} rounded-xl overflow-x-auto`}>
            <table className="w-full border-collapse tabular-nums">
              <thead><tr>{['Sugestão', 'Feita em', 'CPA antes', 'CPA depois', 'Resultado'].map((h, i) =>
                <th key={h} className={`${th} ${i === 2 || i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>{history.map(h => {
                const res: [Status, string] = h.status === 'nao_faz_sentido' ? ['sem_dado', 'não fazia sentido']
                  : h.outcome === 'funcionou' ? ['ok', '✓ funcionou'] : h.outcome === 'piorou' ? ['urgente', '✗ piorou'] : ['sem_dado', '– sem efeito'];
                return (
                  <tr key={h.id}>
                    <td className={`${td} whitespace-normal`}><span className={textHead}>{h.target_label}</span> <span className={`text-[11.5px] ${textMuted}`}>· {ACTIONS[h.action] || h.action}{h.eval?.metric ? ` · ${h.eval.metric === 'pitch' ? 'pitch' : 'fuga'} ${pctText(h.eval.metric_before)} → ${pctText(h.eval.metric_after)}` : ''}</span></td>
                    <td className={td}>{h.change_at ? ddmm(h.change_at.slice(0, 10)) : '—'}</td>
                    <td className={`${td} text-right`}>{h.eval?.cpa_before === null || h.eval?.cpa_before === undefined ? <span className={textMuted}>sem venda</span> : money(h.eval.cpa_before)}</td>
                    <td className={`${td} text-right`}>{h.eval?.cpa_after === null || h.eval?.cpa_after === undefined ? <span className={textMuted}>sem venda</span>
                      : <span className={h.outcome === 'funcionou' ? tone.ok : h.outcome === 'piorou' ? tone.urgente : ''}>{money(h.eval.cpa_after)}</span>}</td>
                    <td className={td}><Pill s={res[0]}>{res[1]}</Pill></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
