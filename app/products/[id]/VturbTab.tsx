"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Ui } from '@/app/components/metrics/ColumnPicker';
import { formatMoney } from '@/lib/analysis/labels';
import { TranscriptBanner } from './TranscriptBanner';
import { TopoAnalysis } from './TopoAnalysis';
import { Funnel, Segments, Changes } from './VturbScreen';

/**
 * Aba "VTurb": a análise do topo de funil (3 dias × 7 dias), o caminho do
 * clique à venda no período da tela, quem assiste e quem compra, as alterações
 * do período e a retenção do vídeo.
 *
 * Tudo vem pronto de /api/vturb, que lê do banco (a coleta grava de hora em
 * hora). A tela não chama a VTurb.
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
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const int = (x: number | null | undefined) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('pt-BR'));
const mmss = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');
function pp(a: number | null, b: number | null) {
  if (a === null || b === null) return '';
  const d = (a - b) * 100;
  if (Math.abs(d) < 0.05) return '=';
  return `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1).replace('.', ',')} pp`;
}
function timeAgo(ts?: string | null) {
  if (!ts) return 'nunca';
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

export function VturbTab({ productId, startDate, endDate, ui }: { productId: string; startDate: string; endDate: string; ui: Ui }) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [playerInput, setPlayerInput] = useState('');

  const load = useCallback(async () => {
    const { ok, body } = await api(`/api/vturb?product_id=${productId}&start=${startDate}&end=${endDate}`);
    if (!ok) setError(body.error || 'Erro ao carregar.');
    else { setData(body); setError(body.error || null); }
    setLoading(false);
  }, [productId, startDate, endDate]);
  useEffect(() => { load(); }, [load]);

  const post = async (payload: Record<string, any>) => {
    setRunning(true);
    setError(null);
    const { ok, body } = await api('/api/vturb', { method: 'POST', body: JSON.stringify({ product_id: productId, start: startDate, end: endDate, ...payload }) });
    if (body && body.player !== undefined) setData(body);
    if (!ok) setError(body.error || body.sync?.error || 'Erro ao ler a VTurb.');
    else if (body.sync?.error) setError(body.sync.error);
    else setEditing(false);
    setRunning(false);
  };

  // Transcrição: salva e já pede a análise (a leitura da página usa a VSL).
  const saveTranscript = async (text: string) => {
    const { ok, body } = await api('/api/analysis', { method: 'PUT', body: JSON.stringify({ product_id: productId, vsl_transcript: text }) });
    if (!ok) return body.error || 'Não foi possível salvar a transcrição.';
    api('/api/analysis', { method: 'POST', body: JSON.stringify({ product_id: productId }) });
    await load();
    return null;
  };
  const mark = async (id: string, status: 'ignorada' | 'nao_faz_sentido') => {
    await api('/api/analysis', { method: 'PATCH', body: JSON.stringify({ id, status }) });
    await load();
  };
  const banner = data && data.ready !== false || data?.player
    ? <TranscriptBanner chars={data?.transcript_chars || null} onSave={saveTranscript} ui={ui} />
    : null;

  const tone = {
    ok: isDark ? 'text-emerald-400' : 'text-emerald-600',
    alerta: isDark ? 'text-orange-400' : 'text-orange-600',
    urgente: isDark ? 'text-rose-400' : 'text-rose-600',
    sem_dado: textMuted,
  } as Record<Status, string>;
  const ring = {
    ok: borderCol, sem_dado: borderCol,
    // "!": o bgCard já traz a cor da borda.
    alerta: isDark ? '!border-orange-500/60' : '!border-orange-300',
    urgente: isDark ? '!border-rose-500/60' : '!border-rose-300',
  } as Record<Status, string>;
  const soft = isDark ? 'bg-slate-950' : 'bg-slate-50';
  const label = `text-[11px] font-semibold tracking-wide uppercase ${textMuted}`;

  if (loading) return <div className={`${bgCard} border rounded-xl p-6 text-sm ${textMuted}`}>Carregando…</div>;
  if (data && data.ready === false && !data.player && data.error) return <div className={`${bgCard} border rounded-xl p-6 text-sm ${textMuted}`}>{data.error}</div>;

  const player = data?.player;
  const linkForm = (
    <div className="flex gap-2 mt-2 flex-wrap">
      <input value={playerInput} onChange={e => setPlayerInput(e.target.value)} placeholder="Cole a URL ou o ID do player da VTurb"
        aria-label="URL ou ID do player da VTurb"
        className={`flex-1 min-w-[260px] text-sm px-3 py-2 rounded-lg border ${borderCol} ${soft} ${textHead}`} />
      <button onClick={() => post({ action: 'link', player: playerInput })} disabled={running || !playerInput.trim()}
        className="text-sm font-semibold px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">
        {running ? 'Lendo…' : 'Vincular'}
      </button>
      {player && <button onClick={() => setEditing(false)} className={`text-sm px-3 py-2 ${textMuted}`}>cancelar</button>}
    </div>
  );

  if (!player) {
    return (
      <div className="space-y-5">
      {banner}
      <div className={`${bgCard} border rounded-xl p-5`}>
        <p className={`text-sm font-bold ${textHead}`}>Player da VTurb</p>
        <p className={`text-xs ${textMuted} mt-1`}>Vincule o player do vídeo desta campanha. Os números passam a ser guardados a cada hora e cruzados com os cliques do Google.</p>
        {linkForm}
        {error && <p className={`text-xs mt-2 ${tone.urgente}`}>{error}</p>}
      </div>
      </div>
    );
  }

  const d3 = data?.d3, d7 = data?.d7, st = data?.status || {};
  const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(v, data?.currency));
  const P = data?.period;

  const Card = ({ title, value, line, lineTone, sub, s = 'ok' as Status }: { title: string; value: string; line?: string; lineTone?: string; sub: string; s?: Status }) => (
    <div className={`${bgCard} border ${ring[s]} rounded-xl p-4 flex flex-col gap-1.5`}>
      <div className={label}>{title}</div>
      <div className={`text-2xl font-bold tabular-nums ${textHead}`}>{value}</div>
      {line && <div className={`text-xs ${lineTone || textMuted}`}>{line}</div>}
      <div className={`text-xs ${textMuted}`}>{sub}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      {banner}
      {data?.topo && d3 && (
        <TopoAnalysis data={data} ui={ui} money={money} running={running} onAnalyze={() => post({ action: 'analyze' })} onMark={mark} />
      )}
      <div className={`flex items-center gap-2 text-[11px] uppercase tracking-wider font-extrabold ${textMuted}`}>
        Números da VTurb <span className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
      </div>
      <div className={`${bgCard} border rounded-xl px-5 py-4 flex justify-between items-center gap-4 flex-wrap`}>
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${textHead} truncate`}>{player.name || player.id}</div>
          <div className={`text-xs ${textMuted} mt-0.5`}>
            {player.duration ? `Vídeo de ${mmss(player.duration)} · ` : ''}{player.pitch_time ? `pitch em ${mmss(player.pitch_time)} (lido da VTurb) · ` : ''}
            dados guardados a cada hora · atualizado {timeAgo(data?.synced_at)} ·{' '}
            <button onClick={() => post({ action: 'sync' })} disabled={running} className="underline hover:text-purple-400 disabled:opacity-50">
              {running ? <><Loader2 size={11} className="inline animate-spin" /> lendo</> : <><RefreshCw size={11} className="inline" /> ler agora</>}
            </button>{' '}
            · <button onClick={() => { setPlayerInput(player.id); setEditing(true); }} className="underline hover:text-purple-400">trocar player</button>
          </div>
          {editing && linkForm}
        </div>
        {P && <div className={`text-xs ${textMuted}`}>3 dias ({ddmm(P.d3[0])}–{ddmm(P.d3[1])}) × 7 dias ({ddmm(P.d7[0])}–{ddmm(P.d7[1])})</div>}
      </div>

      {(error || data?.sync_error) && <div className={`${bgCard} border rounded-xl px-5 py-3 text-sm ${tone.urgente}`}>{error || data.sync_error}</div>}

      {data?.screen && <Funnel screen={data.screen} ui={ui} />}
      {data?.screen && data.screen.segments.visits.gclid > 0 && <Segments screen={data.screen} productId={productId} money={money} ui={ui} onChanged={load} />}
      {data?.screen && <Changes screen={data.screen} ui={ui} />}

      {d3 && !data?.screen && (
        <>
          <div className="space-y-2.5">
            <div className={label}>Do clique à venda · 3 dias</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              <Card title="Cliques no anúncio" value={int(d3.clicks)} sub={`Google · 7d ${int(d7.clicks)}`} />
              <Card title="Carregaram o vídeo" value={int(d3.viewed)} s={st.leak}
                line={`fuga da página ${pct(d3.leak)}`} lineTone={tone[st.leak as Status]}
                sub={`7d ${pct(d7.leak)} ${pp(d3.leak, d7.leak)}`} />
              <Card title="Deram play" value={int(d3.started)}
                line={`${pct(d3.play)} de quem carregou`} sub={`7d ${pct(d7.play)} ${pp(d3.play, d7.play)}`} />
              <Card title="Chegaram ao pitch" value={int(d3.over)} s={st.pitch}
                line={`${pct(d3.pitch)} de quem deu play`} lineTone={tone[st.pitch as Status]}
                sub={`7d ${pct(d7.pitch)} ${pp(d3.pitch, d7.pitch)}`} />
              <Card title="Vendas" value={int(d3.sales)}
                line={`${pct(d3.salesPerPitch)} de quem chegou ao pitch`}
                sub={`7d ${pct(d7.salesPerPitch)} · CPA ${data.extra.cpa}`} />
            </div>
            <div className={`flex gap-6 flex-wrap text-xs ${textMuted} px-1`}>
              <span>Custo por pessoa no pitch <b className={textHead}>{data.extra.costPerPitch[0]}</b> · 7d {data.extra.costPerPitch[1]}</span>
              <span>Custo por vídeo carregado <b className={textHead}>{data.extra.costPerView[0]}</b> · 7d {data.extra.costPerView[1]}</span>
              <span>Vendas: postback do Autometrics ({int(d3.sales)}). A VTurb contou {int(d3.vturbSales)}.</span>
            </div>
          </div>
        </>
      )}

      {data?.curve && <Retention curve={data.curve} before={data.screen?.retention_before || null} history={data.screen ? data.screen.retention_history : true} drops={data.topo?.drops || []} ui={ui} />}

      {data?.keywords && !(data?.screen && data.screen.segments.visits.gclid > 0) && <Keywords kw={data.keywords} money={money} ui={ui} />}
    </div>
  );
}

function Retention({ curve, before, history, drops, ui }: { curve: any; before: any; history: boolean; drops: any[]; ui: Ui }) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const old: [number, number][] | null = before?.points?.length ? before.points : null;
  const W = 1000, H = 210, top = 10;
  const x = (t: number) => (t / curve.duration) * W;
  const y = (p: number) => H - (p / 100) * (H - top);
  const pts: [number, number][] = curve.points;
  const line = pts.map(([t, p]) => `${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `M0,${H} L${line.split(' ').join(' L')} L${x(pts[pts.length - 1][0]).toFixed(1)},${H} Z`;
  const stroke = isDark ? '#a78bfa' : '#7c3aed';
  const grid = isDark ? '#1e293b' : '#e2e8f0';
  const text = isDark ? '#e2e8f0' : '#334155';
  const muted = isDark ? '#94a3b8' : '#64748b';
  const pitchColor = isDark ? '#fb923c' : '#c2410c';
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return (
    <div className={`${bgCard} border rounded-xl px-5 py-4 space-y-3`}>
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <div className={`text-sm font-bold ${textHead}`}>Retenção do vídeo · 7 dias ({ddmm(curve.period[0])}–{ddmm(curve.period[1])})</div>
        <div className={`text-xs ${textMuted}`}>% de quem deu play que ainda está assistindo · semana fechada, atualizada 1 vez por dia (não segue o período da tela)</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full h-auto block" role="img"
        aria-label={`Curva de retenção. ${curve.notes.join('. ')}`}>
        {[top, (H + top) / 2, H].map(v => <line key={v} x1={0} y1={v} x2={W} y2={v} stroke={grid} strokeWidth={1} />)}
        <path d={area} fill={stroke} fillOpacity={0.15} />
        {old && <polyline points={old.filter(([t]) => t <= curve.duration).map(([t, p]) => `${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(' ')} fill="none" stroke={muted} strokeWidth={2} strokeDasharray="6 5" />}
        <polyline points={line} fill="none" stroke={stroke} strokeWidth={2.5} />
        {curve.pitch_time && (
          <>
            <line x1={x(curve.pitch_time)} y1={0} x2={x(curve.pitch_time)} y2={H} stroke={pitchColor} strokeWidth={1.5} strokeDasharray="4 4" />
            <text x={x(curve.pitch_time) - 6} y={24} fill={pitchColor} fontSize={13} textAnchor="end" fontWeight={600}>
              pitch {fmt(curve.pitch_time)} · {Math.round(curve.pitch_pct)}%
            </text>
          </>
        )}
        {curve.marks.map((m: any, i: number) => {
          const cx = x(m.t), cy = y(m.pct);
          const right = cx < W - 140;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={4} fill={stroke} />
              <text x={right ? cx + 8 : cx - 8} y={i % 2 ? cy + 18 : cy - 8} fill={text} fontSize={12} textAnchor={right ? 'start' : 'end'}>{m.label}</text>
            </g>
          );
        })}
        {[0, 1 / 3, 2 / 3, 1].map(f => (
          <text key={f} x={f * W} y={H + 16} fill={muted} fontSize={11} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{fmt(f * curve.duration)}</text>
        ))}
      </svg>
      <div className={`flex gap-6 flex-wrap text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
        {curve.notes.map((n: string) => <span key={n}>{n}</span>)}
      </div>
      {old ? (
        <div className={`text-xs ${textMuted} space-y-1`}>
          <div className="flex gap-5 flex-wrap">
            <span><span className="inline-block w-5 align-middle" style={{ borderTop: `2.5px solid ${stroke}` }} /> esta semana ({ddmm(curve.period[0])}–{ddmm(curve.period[1])})</span>
            <span><span className="inline-block w-5 align-middle" style={{ borderTop: `2px dashed ${muted}` }} /> semana anterior ({ddmm(before.period[0])}–{ddmm(before.period[1])})</span>
          </div>
          {before.changes?.length > 0 && (
            <div>Alterações entre as duas: {before.changes.slice(0, 4).map((c: any) => `${ddmm(c.date)} ${c.text}`).join(' · ')}{before.changes.length > 4 ? ` · e mais ${before.changes.length - 4}` : ''}</div>
          )}
        </div>
      ) : (
        <div className={`text-xs ${textMuted}`}>{history
          ? 'A curva da semana anterior aparece aqui, tracejada, assim que houver uma semana fechada guardada (a primeira leva cerca de 7 dias).'
          : 'Para comparar com a semana anterior, rode migration_vturb_historico.sql no Supabase.'}</div>
      )}
      {drops.some(d => d.vsl) && (
        <div className={`pt-3 border-t ${borderCol} space-y-2`}>
          <div className={`text-[11px] font-semibold tracking-wide uppercase ${textMuted}`}>O que o vídeo diz onde mais gente sai (≈ pela posição na transcrição)</div>
          {drops.filter(d => d.vsl).map(d => (
            <div key={d.label} className="grid grid-cols-[150px_1fr] gap-3 text-xs">
              <div className={textHead}>{d.label}<div className={textMuted}>saem {d.left}</div></div>
              <div className={`italic ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{d.vsl}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Keywords({ kw, money, ui }: { kw: any; money: (v: number | null) => string; ui: Ui }) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const v = kw.visits;
  const note = kw.source === 'gclid'
    ? `Cada visita ligada à palavra-chave pelo gclid: ${int(v.matched)} de ${int(v.gclid)} visitas com gclid acharam o clique no Google. Vendas contadas pela VTurb.`
    : kw.source === 'utm_term'
      ? `Pelo utm_term: ${int(v.utm_term)} visitas chegaram com ele.${v.gclid ? ` ${int(v.gclid)} visitas têm gclid; com a conta conectada pela API do Google, cada uma é ligada à palavra-chave exata.` : ''} Vendas contadas pela VTurb.`
      : v.gclid
        ? `${int(v.gclid)} visitas têm gclid. Com a conta conectada pela API do Google, cada visita e cada venda são ligadas à palavra-chave exata.`
        : 'Nenhuma visita chegou com utm_term ou gclid.';
  const warn = kw.source !== 'gclid';
  const dash = <span className={isDark ? 'text-slate-600' : 'text-slate-400'}>—</span>;
  const thBase = `text-[11px] font-semibold uppercase tracking-wide ${textMuted} px-3 py-2.5 border-b ${borderCol} whitespace-nowrap`;
  const tdBase = `text-[13px] px-3 py-2.5 border-b ${borderCol} tabular-nums whitespace-nowrap`;
  const th = `${thBase} text-right`, td = `${tdBase} text-right`;
  return (
    <div className={`${bgCard} border rounded-xl px-5 py-4 space-y-3`}>
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <div className={`text-sm font-bold ${textHead}`}>Por palavra-chave · 7 dias</div>
        <div className={`text-xs ${textMuted}`}>{kw.source === 'gclid' ? 'ligação clique a clique pelo gclid' : kw.source === 'utm_term' ? 'ligação pelo utm_term' : ''}</div>
      </div>
      <div className={`text-xs rounded-lg px-3 py-2.5 ${warn
        ? (isDark ? 'bg-orange-500/10 text-orange-300' : 'bg-orange-50 text-orange-800')
        : (isDark ? 'bg-slate-950 text-slate-400' : 'bg-slate-50 text-slate-600')}`}>{note}</div>
      {kw.rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={`${thBase} text-left`}>Palavra-chave</th><th className={th}>Cliques</th><th className={th}>Custo</th>
                <th className={th}>Carregaram</th><th className={th}>Fuga</th><th className={th}>Play</th>
                <th className={th}>Chegaram ao pitch</th><th className={th}>Vendas</th><th className={th}>CPA</th>
              </tr></thead>
              <tbody>
                {kw.rows.map((r: any) => (
                  <tr key={r.label} className={r.small ? (isDark ? 'text-slate-500' : 'text-slate-400') : textHead}>
                    <td className={`${tdBase} text-left`}>{r.label}</td>
                    <td className={td}>{r.clicks === null ? dash : int(r.clicks)}</td>
                    <td className={td}>{r.cost === null ? dash : money(r.cost)}</td>
                    <td className={td}>{int(r.viewed)}</td>
                    <td className={td}>{r.leak === null ? dash : pct(r.leak)}</td>
                    <td className={td}>{pct(r.play)}</td>
                    <td className={td}>{int(r.over)} · {pct(r.pitch)}</td>
                    <td className={td}>{int(r.sales)}</td>
                    <td className={td}>{r.cpa === null ? dash : money(r.cpa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`text-xs ${textMuted}`}>Com menos de 30 visitas a linha fica cinza e não entra na análise.</div>
        </>
      )}
    </div>
  );
}
