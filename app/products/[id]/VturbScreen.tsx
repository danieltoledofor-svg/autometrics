"use client";

import React, { useState } from 'react';
import type { Ui } from '@/app/components/metrics/ColumnPicker';
import { useGoogleControls } from './useGoogleControls';
import { BidCell, CpaCell } from './BidCell';
import { ApplyBox, type Plan } from './AnalysisTab';

/**
 * Aba VTurb no período da tela: o caminho do clique à venda em sete etapas,
 * quem assiste e quem compra (por aparelho, grupo de anúncios e palavra-chave,
 * com a alteração no Google ao lado) e as alterações feitas nesses dias.
 * Os números vêm prontos de /api/vturb (campo "screen").
 */

const ddmm = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const int = (x: number | null | undefined) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('pt-BR'));
const ratio = (a: number | null, b: number | null) => (a !== null && b ? a / b : null);

type Steps = { clicks: number; cost: number; viewed: number; started: number; pitchBase: number; over: number; button: number; checkout: number | null; sales: number };

/** As sete etapas, cada uma com quantos seguiram da etapa anterior. */
function stepsOf(raw: Steps) {
  // Etapa zerada com venda depois dela não é perda: é etapa que não está sendo medida.
  const t = { ...raw, button: raw.button === 0 && raw.sales > 0 ? null : raw.button, checkout: raw.checkout === 0 && raw.sales > 0 ? null : raw.checkout };
  const afterPitch = t.button ? t.button : t.over;
  return [
    { key: 'clicks', label: 'Cliques no anúncio', n: t.clicks, rate: null as number | null, of: '' },
    { key: 'viewed', label: 'Carregaram o vídeo', n: t.viewed, rate: ratio(t.viewed, t.clicks), of: 'dos cliques' },
    { key: 'started', label: 'Deram play', n: t.started, rate: ratio(t.started, t.viewed), of: 'de quem carregou' },
    { key: 'over', label: 'Chegaram ao pitch', n: t.over, rate: ratio(t.over, t.pitchBase), of: 'de quem deu play' },
    { key: 'button', label: 'Clicaram no botão', n: t.button, rate: ratio(t.button, t.over), of: 'de quem chegou ao pitch' },
    { key: 'checkout', label: 'Abriram o checkout', n: t.checkout, rate: ratio(t.checkout, afterPitch), of: t.button ? 'de quem clicou no botão' : 'de quem chegou ao pitch' },
    { key: 'sales', label: 'Vendas', n: t.sales, rate: ratio(t.sales, t.checkout ? t.checkout : afterPitch), of: t.checkout ? 'de quem abriu o checkout' : t.button ? 'de quem clicou no botão' : 'de quem chegou ao pitch' },
  ];
}

export function Funnel({ screen, ui }: { screen: any; ui: Ui }) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const now = stepsOf(screen.steps), d3 = stepsOf(screen.steps3), d7 = stepsOf(screen.steps7);
  const max = Math.max(1, ...now.map(s => s.n || 0));
  const bad = isDark ? 'text-rose-400' : 'text-rose-600';
  // Maior perda: a etapa em que menos gente seguiu (só entre as que têm número).
  const losses = now.filter(s => s.rate !== null && s.rate <= 1).sort((a, b) => a.rate! - b.rate!);
  const worst = losses[0]?.key, second = losses[1]?.key;
  const rateText = (s: { key: string; rate: number | null }) => (s.rate === null ? '—' : s.key === 'viewed' ? `fuga ${pct(Math.max(0, 1 - s.rate))}` : `${pct(s.rate)} seguem`);
  const th = `text-[11px] font-semibold uppercase tracking-wide ${textMuted} pb-2 whitespace-nowrap`;
  const noCheckout = !screen.steps.checkout && screen.steps.sales > 0;
  const noButton = screen.steps.button === 0 && screen.steps.sales > 0;
  return (
    <div className={`${bgCard} border rounded-xl px-5 py-4`}>
      <div className="flex justify-between items-baseline gap-3 flex-wrap mb-3">
        <div className={`text-sm font-bold ${textHead}`}>Do clique à venda</div>
        <div className={`text-xs ${textMuted}`}>período da tela: {ddmm(screen.period[0])} a {ddmm(screen.period[1])} · ao lado, 3 dias ({ddmm(screen.d3[0])}–{ddmm(screen.d3[1])}) e 7 dias ({ddmm(screen.d7[0])}–{ddmm(screen.d7[1])})</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse tabular-nums min-w-[640px]">
          <thead><tr>
            <th className={`${th} text-left`}>Etapa</th><th className={`${th} text-left w-[34%]`}></th>
            <th className={`${th} text-right`}>No período</th><th className={`${th} text-right`}>Seguiram</th>
            <th className={`${th} text-right`}>3 dias</th><th className={`${th} text-right`}>7 dias</th>
          </tr></thead>
          <tbody>
            {now.map((s, i) => (
              <tr key={s.key} className={`border-t ${borderCol}`}>
                <td className={`py-2 pr-3 text-[13px] whitespace-nowrap ${textHead}`}>{s.label}</td>
                <td className="py-2 pr-3">
                  <div className={`h-4 rounded ${i >= 4 ? 'bg-emerald-500/70' : 'bg-purple-500/70'}`} style={{ width: `${Math.max(s.n ? 1.5 : 0, ((s.n || 0) / max) * 100)}%` }} />
                </td>
                <td className={`py-2 text-right text-[13px] font-semibold ${textHead}`}>{int(s.n)}</td>
                <td className={`py-2 pl-3 text-right text-xs whitespace-nowrap ${s.key === worst || s.key === second ? bad : textMuted}`} title={s.of}>{rateText(s)}</td>
                <td className={`py-2 pl-3 text-right text-xs whitespace-nowrap ${textMuted}`}>{rateText(d3[i])}</td>
                <td className={`py-2 pl-3 text-right text-xs whitespace-nowrap ${textMuted}`}>{rateText(d7[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`text-xs ${textMuted} mt-3 space-y-1`}>
        {worst && <div>Maior perda no período: <b className={textHead}>{now.find(s => s.key === worst)!.label.toLowerCase()}</b>{second ? <>. Segunda: <b className={textHead}>{now.find(s => s.key === second)!.label.toLowerCase()}</b></> : null}.</div>}
        <div>Cada etapa mostra quantos seguiram da etapa anterior. O clique no botão é contado pela VTurb; o checkout, pelo postback e pelo script do Autometrics; as vendas, pelo postback.</div>
        {noButton && <div className={isDark ? 'text-orange-300' : 'text-orange-700'}>A VTurb não registrou clique no botão deste player neste período, então essa etapa fica sem número.</div>}
        {noCheckout && <div className={isDark ? 'text-orange-300' : 'text-orange-700'}>Nenhum checkout chegou neste período. Ele aparece quando o evento de checkout está marcado no postback da plataforma, ou quando a página usa o script do Autometrics.</div>}
      </div>
    </div>
  );
}

type View = 'device' | 'ad_group' | 'keyword';
const VIEWS: { id: View; label: string; name: string }[] = [
  { id: 'device', label: 'Aparelho', name: 'Aparelho' },
  { id: 'ad_group', label: 'Grupo de anúncios', name: 'Grupo' },
  { id: 'keyword', label: 'Palavra-chave', name: 'Palavra-chave' },
];

export function Segments({ screen, productId, money, ui, onChanged }: { screen: any; productId: string; money: (v: number | null) => string; ui: Ui; onChanged: () => Promise<void> | void }) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const [view, setView] = useState<View>('device');
  const [onlyBad, setOnlyBad] = useState(false);
  const [applying, setApplying] = useState<{ key: string; plan: Plan } | null>(null);
  // Lance por aparelho, meta do grupo, pausa e negativa: só para os logins que podem alterar no Google.
  const google = useGoogleControls(productId);
  const symbol = google.currency === 'BRL' ? 'R$' : google.currency === 'EUR' ? '€' : 'US$';
  const seg = screen.segments;
  const all: any[] = seg[view] || [];
  // Fora do limite, contra a campanha no mesmo período: fuga 10 pontos acima ou chegada ao pitch 25% abaixo.
  const t = screen.steps;
  const campLeak = t.clicks > 0 ? Math.max(0, 1 - t.viewed / t.clicks) : null, campPitch = t.pitchBase > 0 ? t.over / t.pitchBase : null;
  const leakBad = (r: any) => !r.small && r.leak !== null && campLeak !== null && (r.leak - campLeak) * 100 >= 10;
  const pitchBad = (r: any) => !r.small && r.pitch !== null && !!campPitch && (r.pitch - campPitch) / campPitch <= -0.25;
  const rows = onlyBad ? all.filter(r => leakBad(r) || pitchBad(r)) : all;
  const badCount = all.filter(r => leakBad(r) || pitchBad(r)).length;

  const bad = isDark ? 'text-rose-400' : 'text-rose-600';
  const dash = <span className={isDark ? 'text-slate-600' : 'text-slate-400'}>—</span>;
  const thBase = `text-[11px] font-semibold uppercase tracking-wide ${textMuted} px-3 py-2.5 border-b ${borderCol} whitespace-nowrap`;
  const tdBase = `text-[13px] px-3 py-2.5 border-b ${borderCol} tabular-nums whitespace-nowrap`;
  const th = `${thBase} text-right`, td = `${tdBase} text-right`;
  const small = `text-[11px] px-2 py-1 rounded border ${borderCol} ${textMuted}`;
  const action = view === 'device' ? 'Ajuste de lance' : view === 'ad_group' ? 'Meta de CPA' : '';

  const cell = (r: any) => {
    if (!google.allowed) return null;
    if (view === 'device') {
      const control = google.controls.find(c => c.kind === 'aparelho' && c.key === r.key);
      return <BidCell control={control} isDark={isDark} onChange={value => google.change({ kind: 'aparelho', key: r.key, value })} />;
    }
    if (view === 'ad_group') {
      const control = google.controls.find(c => c.kind === 'meta_cpa_grupo' && c.key === r.key);
      return control?.editable ? <CpaCell control={control} symbol={symbol} inherited="da campanha" isDark={isDark} onChange={value => google.change({ kind: 'meta_cpa_grupo', key: r.key, value })} /> : dash;
    }
    return (
      <span className="inline-flex gap-1.5">
        {r.paused ? <span className={`text-[11px] ${textMuted}`}>pausada</span>
          : r.entity_id && <button onClick={() => setApplying({ key: r.key, plan: { type: 'pausar' } })} className={`${small} hover:text-amber-400`}>Pausar</button>}
        <button onClick={() => setApplying({ key: r.key, plan: { type: 'negativa' } })} className={`${small} hover:text-rose-400`}>Negativar</button>
      </span>
    );
  };

  return (
    <div className={`${bgCard} border rounded-xl px-5 py-4 space-y-3`}>
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className={`text-sm font-bold ${textHead}`}>Quem assiste e quem compra · {ddmm(screen.period[0])} a {ddmm(screen.period[1])}</div>
        <div className="flex items-center gap-2 flex-wrap">
          {badCount > 0 && (
            <button onClick={() => setOnlyBad(v => !v)} aria-pressed={onlyBad}
              className={`text-xs px-3 py-1.5 rounded-lg border ${onlyBad ? 'border-rose-500/60 text-rose-400' : `${borderCol} ${textMuted}`}`}>
              {onlyBad ? 'Mostrar todas' : `Só as ${badCount} que não assistem`}
            </button>
          )}
          <div className={`flex rounded-lg border ${borderCol} overflow-hidden`}>
            {VIEWS.map(v => (
              <button key={v.id} onClick={() => { setView(v.id); setOnlyBad(false); setApplying(null); }}
                className={`px-3 py-1.5 text-xs font-semibold ${view === v.id ? 'bg-indigo-600 text-white' : `${textMuted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}`}>{v.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className={`text-xs rounded-lg px-3 py-2.5 ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-slate-50 text-slate-600'}`}>
        {seg.visits.gclid > 0
          ? <>Cada visita da VTurb é ligada ao clique do Google pelo gclid: {int(seg.visits.matched)} de {int(seg.visits.gclid)} visitas com gclid acharam o clique. Cliques e custo são do Google; carregaram, pitch e vendas são das visitas ligadas (vendas contadas pela VTurb). Fuga e custo por pessoa no pitch levam em conta as visitas que não acharam o clique.{seg.visits.gclid > 0 && seg.visits.matched / seg.visits.gclid < 0.5 ? ' Menos da metade foi ligada: leia as linhas como amostra.' : ''} Em vermelho, o que está fora do limite contra a campanha (fuga 10 pontos acima ou chegada ao pitch 25% abaixo).</>
          : 'Nenhuma visita deste período chegou com gclid, então não há como ligar a visita ao clique do Google.'}
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <th className={`${thBase} text-left`}>{VIEWS.find(v => v.id === view)!.name}</th><th className={th}>Cliques</th><th className={th}>Custo</th>
              <th className={th}>Carregaram</th><th className={th}>Fuga</th><th className={th}>Play</th><th className={th}>Chegaram ao pitch</th>
              <th className={th}>Vendas</th><th className={th}>Custo por pessoa no pitch</th>
              {google.allowed && <th className={th}>{action}</th>}
            </tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <React.Fragment key={r.key}>
                  <tr className={r.small ? (isDark ? 'text-slate-500' : 'text-slate-400') : textHead}>
                    <td className={`${tdBase} text-left`}><span className="block max-w-[260px] truncate" title={r.label}>{r.label}</span></td>
                    <td className={td}>{r.clicks === null ? dash : int(r.clicks)}</td>
                    <td className={td}>{r.cost === null ? dash : money(r.cost)}</td>
                    <td className={td}>{int(r.viewed)}</td>
                    <td className={`${td} ${leakBad(r) ? bad : ''}`}>{r.leak === null ? dash : pct(r.leak)}</td>
                    <td className={td}>{pct(r.play)}</td>
                    <td className={`${td} ${pitchBad(r) ? bad : ''}`}>{int(r.over)} · {pct(r.pitch)}</td>
                    <td className={td}>{int(r.sales)}</td>
                    <td className={td}>{r.cost_per_pitch === null ? dash : money(r.cost_per_pitch)}</td>
                    {google.allowed && <td className={td}>{cell(r)}</td>}
                  </tr>
                  {applying && applying.key === r.key && (
                    <tr><td colSpan={10} className={`px-3 pb-3 border-b ${borderCol}`}>
                      <ApplyBox ui={ui} plan={applying.plan} change={google.change} onCancel={() => setApplying(null)}
                        s={{ target_key: applying.plan.type === 'pausar' ? r.entity_id : r.text, target_label: r.label, text: r.match === 'PHRASE' ? 'frase' : '' }}
                        onDone={async () => { setApplying(null); await onChanged(); }} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {seg.visits.gclid > 0 && rows.length === 0 && <div className={`text-xs ${textMuted}`}>Nenhuma linha neste período.</div>}
      {rows.length > 0 && <div className={`text-xs ${textMuted}`}>Com menos de 30 visitas a linha fica cinza e não entra na comparação.</div>}
    </div>
  );
}

export function Changes({ screen, ui }: { screen: any; ui: Ui }) {
  const { bgCard, borderCol, textHead, textMuted } = ui;
  const [all, setAll] = useState(false);
  const days: { date: string; lines: { time: string; text: string }[] }[] = screen.changes || [];
  if (!days.length) return null;
  const total = days.reduce((s, d) => s + d.lines.length, 0);
  const shown = all ? days : days.slice(0, 3);
  return (
    <div className={`${bgCard} border rounded-xl px-5 py-4`}>
      <div className="flex justify-between items-baseline gap-3 flex-wrap mb-2">
        <div className={`text-sm font-bold ${textHead}`}>Alterações na campanha · {ddmm(screen.period[0])} a {ddmm(screen.period[1])}</div>
        <div className={`text-xs ${textMuted}`}>{total} {total === 1 ? 'alteração' : 'alterações'} em {days.length} {days.length === 1 ? 'dia' : 'dias'} · para ler junto com os números acima</div>
      </div>
      {shown.map(d => (
        <div key={d.date} className={`grid grid-cols-[52px_1fr] gap-3 py-2 border-t ${borderCol} text-[13px]`}>
          <div className={`font-semibold tabular-nums ${textHead}`}>{ddmm(d.date)}</div>
          <div className="space-y-0.5">
            {(all ? d.lines : d.lines.slice(0, 5)).map((l, i) => <div key={i} className={textHead}><span className={`tabular-nums ${textMuted}`}>{l.time}</span> · {l.text}</div>)}
            {!all && d.lines.length > 5 && <div className={`text-xs ${textMuted}`}>e mais {d.lines.length - 5}</div>}
          </div>
        </div>
      ))}
      {(days.length > 3 || days.some(d => d.lines.length > 5)) && (
        <button onClick={() => setAll(v => !v)} className={`text-xs font-bold mt-2 ${textMuted} hover:text-indigo-400`}>{all ? 'Mostrar menos' : 'Ver todas'}</button>
      )}
    </div>
  );
}
