"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, LayoutGrid, Loader2, LogOut, Moon, Package, Send, Settings, Sparkles, Sun, Target } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import { Logo } from '@/app/components/Logo';

/**
 * Análise de IA: o que se repete nas campanhas parecidas do usuário (mesma
 * marcação no nome), em cinco períodos, e o resultado de cada campanha no
 * período todo. Os números vêm de /api/patterns, calculados sem IA; a leitura
 * da IA é pedida pelo botão e fica guardada no navegador até o dia seguinte.
 * No campo de pergunta, a IA responde em cima dos dados do conjunto escolhido.
 */

const PERIODS = [
  { key: 'today', label: 'Hoje' }, { key: 'd2', label: '2 dias' }, { key: 'd3', label: '3 dias' },
  { key: 'd7', label: '7 dias' }, { key: 'all', label: 'Todo o período' }, { key: 'custom', label: 'Personalizado' },
];
const dayStr = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const NAV = [
  { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', short: 'Dashboard' },
  { href: '/planning', Icon: Target, label: 'Metas', short: 'Metas' },
  { href: '/products', Icon: Package, label: 'Campanhas', short: 'Campanhas' },
  { href: '/analise-ia', Icon: Sparkles, label: 'Análise de IA', short: 'Análise IA' },
  { href: '/integration', Icon: Settings, label: 'Integração', short: 'Integração' },
];
const MAIN = 'main';
const SAVED = 'autometrics_padroes';

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, ...(init.headers || {}) },
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

const ddmm = (d?: string | null) => (d ? d.slice(5).split('-').reverse().join('/') : '');
const qty = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');

export default function PatternsPage() {
  const { authChecked } = useAuthGuard();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [tag, setTag] = useState('');
  const [period, setPeriod] = useState('d7');
  const [blocks, setBlocks] = useState<string[]>([MAIN]);
  const [mcc, setMcc] = useState('');
  const [from, setFrom] = useState(dayStr(-7));
  const [to, setTo] = useState(dayStr(-1));
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reading, setReading] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string; missing?: string }[]>([]);
  const [answering, setAnswering] = useState(false);
  const [askError, setAskError] = useState('');
  const request = useRef(0);
  const [email, setEmail] = useState('');

  useEffect(() => {
    const t = localStorage.getItem('autometrics_theme') as 'dark' | 'light' | null;
    if (t) setTheme(t);
    try {
      const s = JSON.parse(localStorage.getItem(SAVED) || '{}');
      if (typeof s.tag === 'string') setTag(s.tag);
      if (PERIODS.some(p => p.key === s.period)) setPeriod(s.period);
      if (Array.isArray(s.blocks) && s.blocks.length) setBlocks(s.blocks);
      if (typeof s.mcc === 'string') setMcc(s.mcc);
      if (validDay(s.from) && validDay(s.to)) { setFrom(s.from); setTo(s.to); }
    } catch { /* primeira vez */ }
    setReady(true);
    supabase.auth.getSession().then(({ data: { session } }) => setEmail(session?.user?.email || ''));
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);

  const custom = period === 'custom';
  const datesOk = !custom || (validDay(from) && validDay(to));
  const query = `tag=${encodeURIComponent(tag)}&period=${period}&blocks=${encodeURIComponent(blocks.join(','))}&mcc=${encodeURIComponent(mcc)}${custom ? `&from=${from}&to=${to}` : ''}`;
  const selection = { tag, period, blocks: blocks.join(','), mcc, ...(custom ? { from, to } : {}) };
  const readingKey = `${SAVED}_ia_${query}`;

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    const { ok, body } = await api(`/api/patterns?${query}`);
    if (id !== request.current) return;
    if (!ok) setError(body.error || 'Não foi possível carregar.');
    else setData(body);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    // Data pela metade enquanto é digitada: espera ficar completa.
    if (!authChecked || !ready || !datesOk) return;
    try { localStorage.setItem(SAVED, JSON.stringify({ tag, period, blocks, mcc, from, to })); } catch { /* sem armazenamento */ }
    setAiError('');
    try {
      const saved = JSON.parse(localStorage.getItem(readingKey) || 'null');
      setReading(saved && saved.day === new Date().toDateString() ? saved.reading : null);
    } catch { setReading(null); }
    load();
  }, [authChecked, ready, load, datesOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const askAi = async () => {
    setAsking(true);
    setAiError('');
    const { ok, body } = await api('/api/patterns', { method: 'POST', body: JSON.stringify(selection) });
    if (!ok) setAiError(body.error || 'A IA não respondeu.');
    else {
      setReading(body.reading);
      try { localStorage.setItem(readingKey, JSON.stringify({ day: new Date().toDateString(), reading: body.reading })); } catch { /* sem armazenamento */ }
    }
    setAsking(false);
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || answering) return;
    setAnswering(true);
    setAskError('');
    const { ok, body } = await api('/api/patterns', {
      method: 'POST',
      body: JSON.stringify({ ...selection, question: q, history: chat.map(c => ({ q: c.q, a: c.a })) }),
    });
    if (!ok) setAskError(body.error || 'A IA não respondeu.');
    else { setChat(c => [...c, { q, a: body.answer.text, missing: body.answer.missing }]); setQuestion(''); }
    setAnswering(false);
  };

  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const head = isDark ? 'text-white' : 'text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const line = isDark ? 'border-slate-800' : 'border-slate-200';
  const soft = isDark ? 'bg-slate-950' : 'bg-slate-50';
  const good = 'text-emerald-500', bad = 'text-rose-500', warn = 'text-amber-500';
  const chipOn = isDark ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700';
  const chipOff = isDark ? 'border-slate-800 text-slate-500 hover:text-slate-300' : 'border-slate-200 text-slate-400 hover:text-slate-600';
  const th = `px-3 py-2 text-[10.5px] uppercase tracking-wider font-bold ${muted} ${soft} whitespace-nowrap border-b ${line}`;
  const td = `px-3 py-2 text-[13px] border-b ${line}`;
  const title = `text-[11px] uppercase tracking-wider font-extrabold ${muted}`;

  const money = (v: number | null | undefined) => v === null || v === undefined ? '—'
    : `${data?.currency === 'BRL' ? 'R$' : data?.currency === 'EUR' ? '€' : 'US$'} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signed = (v: number | null | undefined) => v === null || v === undefined ? <span className={muted}>—</span>
    : <span className={v >= 0 ? good : bad}>{v >= 0 ? '+' : '−'}{money(Math.abs(v))}</span>;

  const MARK: Record<string, { label: string; cls: string }> = {
    funciona: { label: 'Funciona', cls: 'bg-emerald-500/15 text-emerald-500' },
    desperdicio: { label: 'Desperdício', cls: 'bg-rose-500/15 text-rose-500' },
    atencao: { label: 'Atenção', cls: 'bg-amber-500/15 text-amber-500' },
  };
  const VERDICT: Record<string, { label: string; cls: string }> = {
    manter: { label: 'Manter', cls: 'bg-emerald-500/15 text-emerald-500' },
    ajustar: { label: 'Ajustar', cls: 'bg-amber-500/15 text-amber-500' },
    pausar: { label: 'Pausar', cls: 'bg-rose-500/15 text-rose-500' },
    cedo: { label: 'Cedo para dizer', cls: isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500' },
  };
  const Pill = ({ m }: { m: { label: string; cls: string } }) =>
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${m.cls}`}>{m.label}</span>;
  const cpaTone = (mark: string | null) => (mark === 'funciona' ? good : mark === 'desperdicio' ? bad : mark === 'atencao' ? warn : '');

  // Os que mais venderam em cima; embaixo, os que mais gastaram sem vender.
  const TermTable = ({ best, waste, label, first }: { best: any[]; waste: any[]; label: string; first: string }) => {
    const row = (r: any) => (
      <tr key={r.text}>
        <td className={`${td} font-medium ${head}`}>{r.text}</td>
        <td className={`${td} text-right`}>{r.campaigns}</td>
        <td className={`${td} text-right whitespace-nowrap`}>{money(r.cost)}</td>
        <td className={`${td} text-right whitespace-nowrap`}>{data.approx && r.conv > 0 ? '≈ ' : ''}{qty(r.conv)}</td>
        <td className={`${td} text-right whitespace-nowrap font-bold ${cpaTone(r.mark)}`}>{r.cpa === null ? 'sem venda' : money(r.cpa)}</td>
      </tr>
    );
    return (
      <div className={`${card} border rounded-xl overflow-hidden`}>
        <div className={`px-4 pt-4 pb-2 ${title}`}>{label}</div>
        {!best?.length && !waste?.length ? <div className={`px-4 pb-4 text-sm ${muted}`}>Sem dados neste período.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse tabular-nums">
              <thead><tr>
                <th className={`${th} text-left`}>{first}</th>
                <th className={`${th} text-right`}>Camp.</th>
                <th className={`${th} text-right`}>Custo</th>
                <th className={`${th} text-right`}>Vendas</th>
                <th className={`${th} text-right`}>CPA</th>
              </tr></thead>
              <tbody>
                {best.length === 0 && <tr><td colSpan={5} className={`${td} ${muted}`}>Nenhum com venda neste período.</td></tr>}
                {best.map(row)}
                {waste.length > 0 && <tr><td colSpan={5} className={`${th} text-left`}>Gastaram sem vender</td></tr>}
                {waste.map(row)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  if (!authChecked) return <div className="min-h-screen bg-black" />;

  const d = data && !data.empty ? data : null;
  const fewSales = d && d.totals.sales < 5;
  const toggleBlock = (id: string) => setBlocks(b => {
    const next = b.includes(id) ? b.filter(x => x !== id) : [...b, id];
    return next.length ? next : b;
  });

  return (
    <div className={`legivel min-h-screen font-sans flex ${bgMain}`}>

      {/* Menu lateral, igual ao do Dashboard */}
      <aside className={`hidden md:flex md:w-64 shrink-0 border-r flex-col sticky top-0 h-screen z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        <div className="h-20 flex items-center justify-start px-6 border-b border-inherit overflow-hidden shrink-0">
          <Logo />
        </div>
        <nav className="flex-1 px-2 py-4 space-y-2">
          {NAV.map(({ href, Icon, label }) => (
            <Link key={href} href={href}
              className={href === '/analise-ia'
                ? 'w-full flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20'
                : `w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}>
              <Icon size={20} /> <span className="font-medium">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-inherit">
          <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/'; }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-rose-500 hover:bg-rose-500/10">
            <LogOut size={20} /> <span className="font-medium">Sair ({email.split('@')[0]})</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-24 md:pb-0">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className={`text-2xl font-bold ${head}`}>Análise de IA</h1>
            <div className={`text-sm ${muted}`}>O que se repete nas suas campanhas parecidas, e perguntas sobre elas</div>
          </div>
          <button onClick={() => { const t = isDark ? 'light' : 'dark'; setTheme(t); localStorage.setItem('autometrics_theme', t); }} className={muted}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* Conjunto, período e blocos */}
        {(data?.options?.mccs || []).length > 1 && (
          <div className="flex flex-wrap gap-2">
            {[{ name: '', label: 'Todas as MCCs', count: data.options.mccs.reduce((n: number, m: any) => n + m.count, 0) },
              ...data.options.mccs.map((m: any) => ({ name: m.name, label: m.name, count: m.count }))].map((m: any) => (
              <button key={m.name || 'todas'} onClick={() => setMcc(m.name)}
                className={`text-left rounded-xl border px-3.5 py-2.5 min-w-[130px] transition-colors ${mcc === m.name ? chipOn : `${card} ${muted} hover:border-indigo-500/40`}`}>
                <div className={`text-[13px] font-bold ${mcc === m.name ? '' : head}`}>{m.label}</div>
                <div className="text-[11px] opacity-70 tabular-nums">{m.count} {m.count === 1 ? 'campanha' : 'campanhas'}</div>
              </button>
            ))}
          </div>
        )}

        <div className={`${card} border rounded-xl p-3 space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <select value={(data?.options?.tags || []).some((t: any) => t.tag.toLowerCase() === tag.toLowerCase()) ? tag.toUpperCase() : tag ? '__outro' : ''}
              onChange={e => { if (e.target.value !== '__outro') setTag(e.target.value); }}
              className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] font-bold`}>
              <option value="">Todas as campanhas</option>
              {(data?.options?.tags || []).map((t: any) => <option key={t.tag} value={t.tag}>{t.tag} · {t.count}</option>)}
              {tag && !(data?.options?.tags || []).some((t: any) => t.tag.toLowerCase() === tag.toLowerCase()) && <option value="__outro">Contém “{tag}”</option>}
            </select>
            <input defaultValue="" placeholder="ou um trecho do nome" key={tag}
              onKeyDown={e => { if (e.key === 'Enter') setTag((e.target as HTMLInputElement).value.trim()); }}
              onBlur={e => { const v = e.target.value.trim(); if (v) setTag(v); }}
              className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] w-44 outline-none focus:border-indigo-500`} />
            <div className={`flex items-center gap-1 p-1 rounded-lg border ${line} ml-auto flex-wrap`}>
              {PERIODS.map(p => (
                <button key={p.key} onClick={() => setPeriod(p.key)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${period === p.key ? (isDark ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-900') : `${muted} hover:text-slate-300`}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {custom && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-bold uppercase tracking-wide ${muted}`}>Período</span>
              <input type="date" value={from} max={dayStr(0)} onChange={e => setFrom(e.target.value)}
                className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} />
              <span className={`text-xs ${muted}`}>até</span>
              <input type="date" value={to} max={dayStr(0)} onChange={e => setTo(e.target.value)}
                className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} />
            </div>
          )}
          {(data?.options?.blocks || []).length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-bold uppercase tracking-wide ${muted}`}>Grupos que entram</span>
              {data.options.blocks.map((b: any) => {
                const on = blocks.includes(b.id);
                return (
                  <button key={b.id} onClick={() => toggleBlock(b.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${on ? chipOn : chipOff}`}>
                    <Check size={12} className={on ? '' : 'opacity-0'} /> {b.name} <span className="opacity-60 font-medium tabular-nums">{b.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {loading && !data && <div className={`flex items-center gap-2 text-sm ${muted}`}><Loader2 size={16} className="animate-spin" /> Calculando…</div>}
        {error && <div className="text-sm text-rose-500">{error}</div>}
        {data?.empty && <div className={`${card} border rounded-xl p-6 text-sm ${muted}`}>Nenhuma campanha com esse nome nos grupos marcados.</div>}

        {d && (
          <div className={`space-y-5 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            <div className={`text-xs ${muted}`}>
              {d.set_size} {d.set_size === 1 ? 'campanha' : 'campanhas'} no conjunto
              {data.mcc ? ` · MCC ${data.mcc}` : ''}
              {d.period.from ? ` · ${ddmm(d.period.from)}${d.period.from !== d.period.to ? ` a ${ddmm(d.period.to)}` : ''}` : ' · desde o primeiro dia de cada campanha'}
              {d.period.key === 'today' ? ' · dia ainda em andamento' : ''}
              {d.other_currency > 0 ? ` · ${d.other_currency} em outra moeda ficaram de fora` : ''}
              {d.sales_source === 'google' ? ' · vendas pelas conversões do Google' : ''}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 tabular-nums">
              {[
                { l: 'Campanhas com gasto', v: String(d.totals.campaigns) },
                { l: 'Custo', v: money(d.totals.cost) },
                { l: 'Vendas', v: qty(d.totals.sales) },
                { l: 'CPA do grupo', v: money(d.totals.cpa) },
                { l: 'Resultado', v: signed(d.totals.result) },
              ].map(x => (
                <div key={x.l} className={`${card} border rounded-xl px-4 py-3`}>
                  <div className={`text-[10.5px] uppercase tracking-wider font-bold ${muted}`}>{x.l}</div>
                  <div className={`text-xl font-extrabold ${head}`}>{x.v}</div>
                </div>
              ))}
            </div>

            {/* O que se repete */}
            <div className={`${card} border rounded-xl p-4 space-y-3`}>
              <div className="flex items-center gap-2 flex-wrap">
                <div className={title}>O que se repete{tag ? ` nas campanhas ${tag}` : ''}</div>
                {data.ai && (
                  <button onClick={askAi} disabled={asking || !d.totals.cost}
                    className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5">
                    {asking ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {reading ? 'Refazer leitura da IA' : 'Pedir leitura da IA'}
                  </button>
                )}
              </div>
              {fewSales && <div className={`text-xs ${warn}`}>Poucas vendas neste período ({qty(d.totals.sales)}): os números ainda são pequenos para concluir.</div>}
              {aiError && <div className="text-xs text-rose-500">{aiError}</div>}
              {reading && (
                <div className={`rounded-lg border ${line} ${soft} p-3 space-y-2`}>
                  <div className={`text-[10.5px] uppercase tracking-wider font-bold ${muted}`}>✦ Leitura da IA</div>
                  {reading.title && <div className={`text-sm font-bold ${head}`}>{reading.title}</div>}
                  {reading.points.map((p: any, i: number) => (
                    <div key={i} className="flex gap-2.5 text-[13px] items-start"><Pill m={MARK[p.mark] || MARK.atencao} /><span>{p.text}</span></div>
                  ))}
                </div>
              )}
              {d.highlights.length === 0 && !reading && <div className={`text-sm ${muted}`}>Nada se destacou neste período.</div>}
              {d.highlights.map((h: any, i: number) => (
                <div key={i} className={`flex gap-2.5 text-[13px] items-start pt-2 border-t ${line}`}><Pill m={MARK[h.mark]} /><span>{h.text}</span></div>
              ))}
            </div>

            {/* Pergunta para a IA */}
            {data.ai && (
              <div className={`${card} border rounded-xl p-4 space-y-3`}>
                <div className={title}>Pergunte à IA sobre este conjunto</div>
                {chat.map((c, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className={`text-[13px] font-bold ${head}`}>{c.q}</div>
                    <div className={`rounded-lg border ${line} ${soft} p-3 text-[13px] leading-relaxed whitespace-pre-wrap`}>{c.a}</div>
                    {c.missing && <div className={`text-[11px] ${muted}`}>Faltou para responder melhor: {c.missing}</div>}
                  </div>
                ))}
                {askError && <div className="text-xs text-rose-500">{askError}</div>}
                <div className="flex gap-2 items-end">
                  <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} maxLength={1000}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                    placeholder="Qual campanha piorou mais nesta semana e em qual termo?"
                    className={`flex-1 rounded-lg border ${line} ${soft} ${head} px-3 py-2 text-[13px] outline-none focus:border-indigo-500 resize-y`} />
                  <button onClick={ask} disabled={answering || !question.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5">
                    {answering ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Perguntar
                  </button>
                </div>
                <div className={`text-[11px] ${muted}`}>
                  A IA recebe os dados do conjunto e do período escolhidos acima: cada campanha, dia a dia, termos, dispositivos, idade, gênero, locais e vídeo. Ela vê os melhores termos e palavras-chave, e a situação de cada campanha. Para olhar uma campanha só, escreva o nome dela no campo de trecho do nome.
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TermTable best={d.terms_best} waste={d.terms_waste} label="Termos de pesquisa que mais vendem" first="Termo" />
              <TermTable best={d.keywords_best} waste={d.keywords_waste} label="Palavras-chave com melhor rendimento" first="Palavra-chave" />
            </div>
            <div className={`text-[11px] ${muted} -mt-2`}>
              Camp. é em quantas campanhas do conjunto o termo ou a palavra-chave apareceu. CPA em verde está pelo menos 20% abaixo da média da própria tabela: {money(d.term_cpa)} nos termos e {money(d.keyword_cpa)} nas palavras-chave. A média dos termos é menor porque o Google não informa todos os termos; as palavras-chave vêm da lista de cada campanha, com o gasto inteiro{d.keyword_listed < d.totals.campaigns ? ` (${d.keyword_listed} de ${d.totals.campaigns} campanhas têm a lista; nas outras, vale a palavra-chave anotada no termo)` : ''}.
              {d.approx ? ' ≈ vendas reais de cada campanha divididas entre os termos pelas conversões do Google, ou pelos cliques quando não há conversão.' : ''}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className={`${card} border rounded-xl overflow-hidden`}>
                <div className={`px-4 pt-4 pb-2 ${title}`}>Dispositivos</div>
                {!d.devices.length ? <div className={`px-4 pb-4 text-sm ${muted}`}>Sem dados neste período.</div> : (
                  <table className="w-full border-collapse tabular-nums">
                    <thead><tr>
                      <th className={`${th} text-left`}>Dispositivo</th><th className={`${th} text-right`}>% do custo</th>
                      <th className={`${th} text-right`}>Custo</th><th className={`${th} text-right`}>Vendas</th><th className={`${th} text-right`}>CPA</th>
                    </tr></thead>
                    <tbody>{d.devices.map((r: any) => (
                      <tr key={r.text}>
                        <td className={`${td} font-medium ${head}`}>{r.text}</td>
                        <td className={`${td} text-right`}>{Math.round(r.share * 100)}%</td>
                        <td className={`${td} text-right`}>{money(r.cost)}</td>
                        <td className={`${td} text-right`}>{d.approx && r.conv > 0 ? '≈ ' : ''}{qty(r.conv)}</td>
                        <td className={`${td} text-right font-bold ${cpaTone(r.mark)}`}>{r.cpa === null ? 'sem venda' : money(r.cpa)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              <div className={`${card} border rounded-xl overflow-hidden`}>
                <div className={`px-4 pt-4 pb-2 ${title}`}>Vídeo de vendas</div>
                <table className="w-full border-collapse tabular-nums">
                  <thead><tr>
                    <th className={`${th} text-left`}>Chegou à oferta</th><th className={`${th} text-right`}>Camp.</th><th className={`${th} text-right`}>CPA</th>
                  </tr></thead>
                  <tbody>
                    {d.video.rows.map((r: any) => (
                      <tr key={r.label}>
                        <td className={`${td} ${r.campaigns ? head : muted}`}>{r.label}</td>
                        <td className={`${td} text-right ${r.campaigns ? '' : muted}`}>{r.campaigns}</td>
                        <td className={`${td} text-right`}>{money(r.cpa)}</td>
                      </tr>
                    ))}
                    <tr><td className={`${td} ${muted}`}>Sem vídeo ligado</td><td className={`${td} text-right ${muted}`}>{d.video.without}</td><td className={`${td} text-right ${muted}`}>—</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Vale a pena manter? */}
            <div className={`${card} border rounded-xl overflow-hidden`}>
              <div className={`px-4 pt-4 pb-1 ${title}`}>Vale a pena manter? · todo o período de cada campanha</div>
              <div className={`px-4 pb-3 text-xs ${muted}`}>
                Campanhas com gasto nos últimos 7 dias, com a situação de hoje ao lado do nome. O período escolhido acima não muda esta tabela.
                {d.verdicts.length > 0 && ` ${d.verdict_counts.manter} para manter · ${d.verdict_counts.ajustar} para ajustar · ${d.verdict_counts.pausar} para pausar · ${d.verdict_counts.cedo} cedo para dizer.`}
              </div>
              {!d.verdicts.length ? <div className={`px-4 pb-4 text-sm ${muted}`}>Nenhuma campanha do conjunto gastou nos últimos 7 dias.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse tabular-nums">
                    <thead><tr>
                      <th className={`${th} text-left`}>Campanha</th>
                      <th className={`${th} text-right`}>Dias</th>
                      <th className={`${th} text-right`}>Custo</th>
                      <th className={`${th} text-right`}>Vendas</th>
                      <th className={`${th} text-right`}>CPA</th>
                      <th className={`${th} text-right`}>Resultado</th>
                      <th className={`${th} text-right`}>Últimos 7 dias</th>
                      <th className={`${th} text-left`}>Veredito</th>
                    </tr></thead>
                    <tbody>{d.verdicts.map((v: any) => (
                      <tr key={v.id}>
                        <td className={`${td} max-w-[320px]`}>
                          <Link href={`/products/${v.id}`} target="_blank" className={`font-medium ${head} hover:text-indigo-400 hover:underline`}>{v.name}</Link>
                          {v.status && (
                            <span title={v.status.hint} className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wide align-middle ${v.status.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${v.status.dot}`} />{v.status.label}
                            </span>
                          )}
                          <div className={`text-[11px] ${muted} whitespace-normal`}>{v.reason}</div>
                        </td>
                        <td className={`${td} text-right align-top`}>{v.days}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap`}>{money(v.cost)}</td>
                        <td className={`${td} text-right align-top`}>{qty(v.sales)}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap`}>{money(v.cpa)}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap font-bold`}>{signed(v.result)}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap`}>{signed(v.result7)}</td>
                        <td className={`${td} align-top`}><Pill m={VERDICT[v.verdict]} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </main>

      {/* Menu do celular */}
      <nav className={`fixed bottom-0 inset-x-0 md:hidden z-40 border-t backdrop-blur-md ${isDark ? 'bg-slate-950/95 border-slate-900' : 'bg-white/95 border-slate-200'}`}>
        <div className="flex justify-around items-center px-2 pt-2 pb-5">
          {NAV.map(({ href, Icon, short }) => {
            const active = href === '/analise-ia';
            return (
              <Link key={href} href={href}
                className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-xl transition-colors ${active ? 'text-indigo-500' : isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                <Icon size={22} />
                <span className="text-[9px] font-bold tracking-wide">{short}</span>
                {active && <div className="w-1 h-1 rounded-full bg-indigo-500" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
