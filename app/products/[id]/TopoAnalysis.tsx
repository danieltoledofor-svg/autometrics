"use client";

import React, { useEffect, useState } from 'react';
import { ChevronRight, Check, X, AlertTriangle, Minus, Loader2 } from 'lucide-react';
import type { Ui } from '@/app/components/metrics/ColumnPicker';
import { ACTIONS } from '@/lib/analysis/actions';

/**
 * Análise do topo de funil, no alto da aba VTurb: resumo, checklist fixo de
 * 5 itens (fuga, play, retenção até o pitch, palavras-chave, anúncio ×
 * página × VSL), pontos de alteração e resultado das sugestões anteriores.
 * Tudo vem pronto de /api/vturb (campo "topo").
 */

type Status = 'ok' | 'alerta' | 'urgente' | 'sem_dado';

const ddmm = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
function timeAgo(ts?: string | null) {
  if (!ts) return 'nunca';
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

export function TopoAnalysis({ data, ui, money, running, onAnalyze, onMark }: {
  data: any; ui: Ui; money: (v: number | null | undefined) => string; running: boolean;
  onAnalyze: () => void; onMark: (id: string, status: 'ignorada' | 'nao_faz_sentido') => void;
}) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const topo = data.topo;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Abre sozinho o primeiro item com problema.
  useEffect(() => {
    const first = topo?.items?.find((i: any) => i.status === 'urgente') || topo?.items?.find((i: any) => i.status === 'alerta');
    if (first) setOpen(o => (Object.keys(o).length ? o : { [first.key]: true }));
  }, [topo]);
  if (!topo) return null;

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
  const label = (s: Status) => (s === 'sem_dado' ? 'sem dado' : s);
  const Pill = ({ s, children }: { s: Status; children: React.ReactNode }) => (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${pill[s]}`}>{children}</span>
  );
  const Icon = ({ s }: { s: Status }) => {
    const inner = s === 'ok' ? <Check size={13} strokeWidth={3} /> : s === 'urgente' ? <X size={13} strokeWidth={3} /> : s === 'alerta' ? <AlertTriangle size={13} strokeWidth={2.5} /> : <Minus size={13} strokeWidth={3} />;
    return <span className={`w-6 h-6 rounded-full shrink-0 grid place-items-center border ${pill[s]}`}>{inner}</span>;
  };
  const th = `text-[11px] font-semibold uppercase tracking-wide ${textMuted} px-3 py-2 border-b ${borderCol} whitespace-nowrap`;
  const td = `text-[13px] px-3 py-2 border-b ${borderCol} tabular-nums whitespace-nowrap`;
  const sumStatus: Status = topo.status;
  const c = topo.counts;

  const tracking = (s: any) => {
    const v = s.baseline?.vturb;
    const since = `Registrado em ${ddmm(s.created_at?.slice(0, 10))}${v?.metric === 'fuga' ? ` com fuga de ${pct(v.d3)}` : v?.metric === 'pitch' ? ` com chegada ao pitch em ${pct(v.d3)}` : s.baseline?.cpa3 ? ` com CPA de ${money(s.baseline.cpa3)}` : ''}.`;
    const page = s.action === 'ajuste_pagina' || s.action === 'ajuste_vsl';
    if (s.status !== 'aplicada') {
      return page
        ? <>{since} A mudança é percebida quando {s.action === 'ajuste_pagina' ? 'a página muda, ' : ''}o vídeo ou o player é trocado. Resultado pela {v?.metric === 'pitch' ? 'chegada ao pitch' : 'fuga da página'} 3 e 7 dias depois.</>
        : <>{since} Ainda não há mudança no Google.</>;
    }
    const ch = s.change || {};
    const where = ch.type === 'PAGINA' ? 'na página' : ch.type === 'PLAYER' ? 'no player' : ch.type === 'VIDEO' ? 'no vídeo do player' : 'no Google';
    const e3 = s.eval_3d;
    return (
      <>
        {since} <span className={tone.ok}>Mudança vista {where} em {ddmm(String(ch.changed_at || s.change_at || '').slice(0, 10))}.</span>{' '}
        {e3 ? (e3.metric
          ? <>Em 3 dias: {e3.metric === 'pitch' ? 'chegada ao pitch' : 'fuga da página'} {pct(e3.metric_before)} → {pct(e3.metric_after)}. Resultado final 7 dias depois.</>
          : <>Em 3 dias: CPA {money(e3.cpa_before)} → {money(e3.cpa_after)}. Resultado final 7 dias depois.</>)
          : <>Primeira conferência 3 dias depois.</>}
      </>
    );
  };

  const Points = ({ list }: { list: any[] }) => (
    <div className="space-y-2">
      {list.map(s => (
        <div key={s.id} className={`rounded-r-lg border-l-[3px] border-blue-400 ${soft} px-3 py-2`}>
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-[220px]">
              <div className={`text-[10.5px] uppercase tracking-wider font-bold ${textMuted}`}>✦ Ponto de alteração · {s.target_label}</div>
              <div className={`text-[13px] ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{s.text}</div>
            </div>
            {s.status === 'aberta' && (
              <div className="flex gap-1.5">
                <button onClick={() => onMark(s.id, 'ignorada')} className={`text-[11px] px-2 py-1 rounded border ${borderCol} ${textMuted} hover:text-indigo-400`}>Ignorar</button>
                <button onClick={() => onMark(s.id, 'nao_faz_sentido')} className={`text-[11px] px-2 py-1 rounded border ${borderCol} ${textMuted} hover:text-rose-400`}>Não faz sentido</button>
              </div>
            )}
          </div>
          <div className={`text-[11.5px] mt-1 ${textMuted}`}>⟳ {tracking(s)}</div>
        </div>
      ))}
    </div>
  );

  const d3 = data.d3, d7 = data.d7;
  const detail = (key: string) => {
    if (key === 'fuga') {
      return <div className={`text-[12.5px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
        {d3.clicks.toLocaleString('pt-BR')} cliques no anúncio → {d3.viewed.toLocaleString('pt-BR')} carregaram o vídeo. Custo por vídeo carregado {data.extra.costPerView[0]} (7d {data.extra.costPerView[1]}).
      </div>;
    }
    if (key === 'play') {
      return <div className={`text-[12.5px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
        {d3.started.toLocaleString('pt-BR')} de {d3.viewed.toLocaleString('pt-BR')} pessoas que carregaram o vídeo deram play ({pct(d3.play)}; 7d {pct(d7.play)}).
      </div>;
    }
    if (key === 'retencao') {
      return (
        <div className="space-y-2">
          {data.curve?.notes?.length > 0 && <div className={`text-[12.5px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{data.curve.notes.join(' · ')}</div>}
          {topo.drops?.length > 0 && (
            <div className={`overflow-x-auto rounded-lg border ${borderCol}`}>
              <table className="w-full border-collapse">
                <thead><tr><th className={`${th} text-left`}>Trecho com mais saída</th><th className={`${th} text-right`}>Saíram</th><th className={`${th} text-left`}>O que a VSL diz ali</th></tr></thead>
                <tbody>{topo.drops.map((d: any) => (
                  <tr key={d.label}>
                    <td className={`${td} ${textHead}`}>{d.label}</td>
                    <td className={`${td} text-right`}>{d.left}</td>
                    <td className={`${td} whitespace-normal min-w-[260px] ${d.vsl ? (isDark ? 'text-slate-300' : 'text-slate-700') : textMuted}`}>{d.vsl ? `≈ ${d.vsl}` : 'Envie a transcrição da VSL no topo da aba'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className={`text-[11.5px] ${textMuted}`}>O trecho da VSL é estimado pela posição no texto (≈), porque .txt e .md não têm horário.</div>
        </div>
      );
    }
    if (key === 'palavras') {
      const rows = (data.keywords?.rows || []).filter((r: any) => !r.small);
      const small = (data.keywords?.rows || []).filter((r: any) => r.small);
      if (!rows.length && !small.length) return null;
      return (
        <div className="space-y-1.5">
          <div className={`overflow-x-auto rounded-lg border ${borderCol}`}>
            <table className="w-full border-collapse">
              <thead><tr>{['Palavra-chave', 'Carregaram', 'Fuga', 'Chegada ao pitch', '× campanha', 'Vendas', 'Status'].map((h, i) =>
                <th key={h} className={`${th} ${i === 0 || i === 6 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.key}>
                    <td className={`${td} ${textHead}`}>{r.label}</td>
                    <td className={`${td} text-right`}>{r.viewed.toLocaleString('pt-BR')}</td>
                    <td className={`${td} text-right`}>{r.leak === null ? <span className={textMuted}>—</span> : pct(r.leak)}</td>
                    <td className={`${td} text-right`}>{pct(r.pitch)}</td>
                    <td className={`${td} text-right ${textMuted}`}>{r.pitchVs === null ? '—' : `${r.pitchVs > 0 ? '▲' : '▼'} ${Math.round(Math.abs(r.pitchVs) * 100)}%`}</td>
                    <td className={`${td} text-right`}>{r.sales}</td>
                    <td className={td}><Pill s={r.status}>{label(r.status)}</Pill></td>
                  </tr>
                ))}
                {small.length > 0 && (
                  <tr><td colSpan={7} className={`${td} ${textMuted}`}>{small.length} com menos de 30 visitas {small.length === 1 ? 'fica' : 'ficam'} fora · {small.reduce((s: number, r: any) => s + r.viewed, 0)} visitas, {small.reduce((s: number, r: any) => s + r.sales, 0)} vendas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    // congruencia
    const p = topo.page;
    if (!data.transcript_chars) return <div className={`text-[12.5px] ${textMuted}`}>Envie a transcrição da VSL no topo da aba para ler anúncio × página × VSL.</div>;
    if (!p) return <div className={`text-[12.5px] ${textMuted}`}>A página é lida na próxima análise.</div>;
    const conversa: Record<string, [Status, string]> = { sim: ['ok', 'sim'], nao: ['urgente', 'não'], em_parte: ['alerta', 'em parte'] };
    return (
      <div className="space-y-2.5">
        <div className={`text-[11.5px] ${textMuted}`}>
          {p.url && <>Página lida: <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline break-all">{p.url}</a> · </>}
          {p.checked_at && `em ${ddmm(p.checked_at.slice(0, 10))} · `}relida quando a página, a VSL ou os termos principais mudam, e no mínimo 1 vez por semana
        </div>
        {p.error && <div className={`text-sm ${tone.urgente}`}>{p.error}</div>}
        {p.resumo && <div className={`rounded-lg ${soft} border ${borderCol} px-3 py-2 text-[13px] ${textHead}`}><b>Resumo:</b> {p.resumo}</div>}
        {p.grupos?.length > 0 && (
          <div className={`overflow-x-auto rounded-lg border ${borderCol}`}>
            <table className="w-full border-collapse">
              <thead><tr>{['Grupo de buscas', 'Gasto 3d', 'Vendas 3d', 'Página abre com', 'Na VSL', 'Conversa?'].map((h, i) =>
                <th key={h} className={`${th} ${i === 1 || i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>{p.grupos.map((g: any) => (
                <tr key={g.nome}>
                  <td className={td} title={g.termos?.join('\n')}><span className={`font-medium ${textHead}`}>{g.nome}</span> <span className={`text-[11px] ${textMuted}`}>{g.termos?.length} termos</span></td>
                  <td className={`${td} text-right`}>{money(g.gasto3)}</td>
                  <td className={`${td} text-right`}>{String(g.vendas3).replace('.', ',')}</td>
                  <td className={`${td} whitespace-normal min-w-[160px]`}>{g.abre}</td>
                  <td className={`${td} whitespace-normal min-w-[120px]`}>{g.vsl}</td>
                  <td className={td}><Pill s={(conversa[g.conversa] || conversa.em_parte)[0]}>{(conversa[g.conversa] || conversa.em_parte)[1]}</Pill></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {p.achados?.filter((f: any) => f.nivel !== 'ok').map((f: any, i: number) => (
          <div key={i} className="flex gap-2 text-[13px]">
            <Icon s={f.nivel} />
            <div><b className={textHead}>{f.titulo}.</b> <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{f.texto}</span></div>
          </div>
        ))}
      </div>
    );
  };

  const history = topo.history || [];
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-[11px] uppercase tracking-wider font-extrabold ${textMuted}`}>
        Análise do topo de funil · depois do clique <span className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
      </div>

      <div className={`${bgCard} border ${borderCol} rounded-xl px-5 py-4 flex justify-between items-center gap-4 flex-wrap`}>
        <div className="min-w-0 flex-1">
          <div className={`text-base font-bold ${textHead}`}>
            {(sumStatus === 'alerta' || sumStatus === 'urgente') && <span className={tone[sumStatus]}>✦ </span>}{topo.summary.title}
          </div>
          {topo.summary.text && <div className={`text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'} mt-1`}>{topo.summary.text}</div>}
          <div className={`text-[11.5px] ${textMuted} mt-1.5`}>
            {data.period && <>3 dias ({ddmm(data.period.d3[0])}–{ddmm(data.period.d3[1])}) × 7 dias ({ddmm(data.period.d7[0])}–{ddmm(data.period.d7[1])}) · </>}
            atualizado {timeAgo(topo.computed_at)} ·{' '}
            <button onClick={onAnalyze} disabled={running} className="underline hover:text-indigo-400 disabled:opacity-50">
              {running ? <><Loader2 size={11} className="inline animate-spin" /> analisando</> : 'reanalisar'}
            </button>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {c.urgente > 0 && <Pill s="urgente">{c.urgente} {c.urgente === 1 ? 'urgente' : 'urgentes'}</Pill>}
          {c.alerta > 0 && <Pill s="alerta">{c.alerta} em alerta</Pill>}
          <span className={`text-[11px] ${textMuted}`}>{c.ok} {c.ok === 1 ? 'item ok' : 'itens ok'}{c.sem_dado ? ` · ${c.sem_dado} sem dado` : ''}</span>
        </div>
      </div>

      <div className={`${bgCard} border ${borderCol} rounded-xl overflow-hidden`}>
        {topo.items.map((item: any, idx: number) => {
          const isOpen = !!open[item.key];
          const points = (topo.suggestions || []).filter((s: any) => s.topo_key === item.key);
          const body = detail(item.key);
          return (
            <div key={item.key} className={idx < topo.items.length - 1 ? `border-b ${borderCol}` : ''}>
              <button onClick={() => setOpen(o => ({ ...o, [item.key]: !o[item.key] }))}
                className={`w-full grid grid-cols-[24px_1fr_14px] md:grid-cols-[24px_220px_1fr_auto_14px] gap-3 items-center px-4 py-3 text-left transition-colors ${isDark ? 'hover:bg-slate-950' : 'hover:bg-slate-50'}`}>
                <Icon s={item.status} />
                <span className={`font-bold text-sm ${textHead}`}>{idx + 1}. {item.title}</span>
                <span className={`hidden md:block text-[13px] truncate ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{item.headline}</span>
                <span className="hidden md:block"><Pill s={item.status}>{label(item.status)}</Pill></span>
                <ChevronRight size={14} className={`${textMuted} transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <span className={`md:hidden col-start-2 col-span-2 text-[12.5px] ${textMuted}`}>{item.headline}</span>
              </button>
              {isOpen && (body || points.length > 0) && (
                <div className="px-4 pb-4 md:pl-[52px] space-y-3">
                  {body}
                  {points.length > 0 && <Points list={points} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {history.length > 0 && (
        <div className="space-y-2">
          <div className={`text-[11px] uppercase tracking-wider font-bold ${textMuted}`}>Resultado das sugestões anteriores · topo de funil</div>
          <div className={`${bgCard} border ${borderCol} rounded-xl overflow-x-auto`}>
            <table className="w-full border-collapse">
              <thead><tr>{['Sugestão', 'Feita em', 'Antes', 'Depois', 'Resultado'].map((h, i) =>
                <th key={h} className={`${th} ${i === 2 || i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>{history.map((h: any) => {
                const res: [Status, string] = h.status === 'nao_faz_sentido' ? ['sem_dado', 'não fazia sentido']
                  : h.outcome === 'funcionou' ? ['ok', '✓ funcionou'] : h.outcome === 'piorou' ? ['urgente', '✗ piorou'] : ['sem_dado', '– sem efeito'];
                const e = h.eval || {};
                const show = (x: number | null | undefined) => (e.metric ? pct(x) : money(x));
                return (
                  <tr key={h.id}>
                    <td className={`${td} whitespace-normal`}><span className={textHead}>{h.target_label}</span> <span className={`text-[11.5px] ${textMuted}`}>· {ACTIONS[h.action] || h.action}{e.metric ? ` · ${e.metric === 'pitch' ? 'pitch' : 'fuga'}` : ' · CPA'}</span></td>
                    <td className={td}>{h.change_at ? ddmm(h.change_at.slice(0, 10)) : '—'}</td>
                    <td className={`${td} text-right`}>{show(e.metric ? e.metric_before : e.cpa_before)}</td>
                    <td className={`${td} text-right`}>{show(e.metric ? e.metric_after : e.cpa_after)}</td>
                    <td className={td}><Pill s={res[0]}>{res[1]}</Pill></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
