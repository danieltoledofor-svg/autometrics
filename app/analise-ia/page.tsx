"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, LayoutGrid, Loader2, LogOut, Moon, Package, Send, Settings, Sparkles, Sun, Target, Route } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import { Logo } from '@/app/components/Logo';
import { MemoryCard } from './MemoryCard';
import { Inter } from 'next/font/google';
import { VoiceButton } from '@/app/components/VoiceButton';

// Fonte do guia visual (DESIGN.md), nas telas já migradas.
const inter = Inter({ subsets: ['latin'], display: 'swap' });

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
  { href: '/rastreamento', Icon: Route, label: 'Rastreamento', short: 'Rastreio' },
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
  // opts: só as opções dos filtros, lidas ao abrir. data: a análise, só quando a pessoa pede.
  const [opts, setOpts] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string; missing?: string; period?: string }[]>([]);
  const [answering, setAnswering] = useState(false);
  const [askError, setAskError] = useState('');
  const [memoryTick, setMemoryTick] = useState(0);
  const [kept, setKept] = useState<number[]>([]);
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

  // Ao abrir e a cada troca de filtro, só as opções (rápido). A análise do
  // conjunto e a leitura da IA saem apenas quando a pessoa pede.
  const loadOptions = useCallback(async () => {
    const id = ++request.current;
    setError('');
    const { ok, body } = await api(`/api/patterns?${query}&only=options`);
    if (id !== request.current) return;
    if (!ok) setError(body.error || 'Não foi possível carregar.');
    else setOpts(body);
  }, [query]);

  const load = async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    const { ok, body } = await api(`/api/patterns?${query}`);
    if (id !== request.current) return;
    if (!ok) setError(body.error || 'Não foi possível carregar.');
    else { setData(body); setOpts(body); }
    setLoading(false);
  };

  useEffect(() => {
    // Data pela metade enquanto é digitada: espera ficar completa.
    if (!authChecked || !ready || !datesOk) return;
    try { localStorage.setItem(SAVED, JSON.stringify({ tag, period, blocks, mcc, from, to })); } catch { /* sem armazenamento */ }
    setAiError('');
    setData(null);
    setReading(null);
    setLoading(false);
    loadOptions();
  }, [authChecked, ready, loadOptions, datesOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const askAi = async () => {
    setAsking(true);
    setAiError('');
    const { ok, body } = await api('/api/patterns', { method: 'POST', body: JSON.stringify(selection) });
    if (!ok) setAiError(body.error || 'A IA não respondeu.');
    else {
      setReading(body.reading);
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
    else { setChat(c => [...c, { q, a: body.answer.text, missing: body.answer.missing, period: body.answer.period }]); setQuestion(''); }
    setAnswering(false);
  };

  // Resposta que vale guardar vira uma decisão na memória da IA.
  const keep = async (i: number) => {
    const c = chat[i];
    const { ok, body } = await api('/api/memory', { method: 'POST', body: JSON.stringify({ kind: 'decisao', title: c.q.slice(0, 160), content: c.a, scope: (meta?.options?.tags || []).some((t: any) => t.tag.toLowerCase() === tag.toLowerCase()) ? tag.toUpperCase() : '' }) });
    if (!ok) setAskError(body.error || 'Não foi possível guardar.');
    else { setKept(k => [...k, i]); setMemoryTick(t => t + 1); }
  };

  const isDark = theme === 'dark';
  // Visual pelo guia (DESIGN.md, direção Linear): cores pelos tokens do tema.
  const bgMain = 'bg-canvas text-ink-muted';
  const card = 'bg-surface-1 border-line';
  const head = 'text-ink';
  const muted = 'text-ink-subtle';
  const line = 'border-line';
  const soft = 'bg-surface-2';
  const good = 'text-pos', bad = 'text-neg', warn = 'text-warn';
  const chipOn = 'bg-surface-3 border-line-strong text-ink';
  const chipOff = 'bg-surface-1 border-line text-ink-subtle hover:text-ink';
  const th = `px-3 py-2 text-xs font-medium ${muted} ${soft} whitespace-nowrap border-b ${line}`;
  const td = `px-3 py-2 text-[13px] border-b ${line}`;
  const title = 'text-sm font-medium text-ink';
  const brandBtn = 'bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors';
  const navItem = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';

  const money = (v: number | null | undefined) => v === null || v === undefined ? '—'
    : `${data?.currency === 'BRL' ? 'R$' : data?.currency === 'EUR' ? '€' : 'US$'} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signed = (v: number | null | undefined) => v === null || v === undefined ? <span className={muted}>—</span>
    : <span className={v >= 0 ? good : bad}>{v >= 0 ? '+' : '−'}{money(Math.abs(v))}</span>;

  const MARK: Record<string, { label: string; cls: string }> = {
    funciona: { label: 'Funciona', cls: 'bg-pos/10 text-pos' },
    desperdicio: { label: 'Desperdício', cls: 'bg-neg/10 text-neg' },
    atencao: { label: 'Atenção', cls: 'bg-warn/10 text-warn' },
  };
  const VERDICT: Record<string, { label: string; cls: string }> = {
    manter: { label: 'Manter', cls: 'bg-pos/10 text-pos' },
    ajustar: { label: 'Ajustar', cls: 'bg-warn/10 text-warn' },
    pausar: { label: 'Pausar', cls: 'bg-neg/10 text-neg' },
    cedo: { label: 'Cedo para dizer', cls: 'bg-surface-3 text-ink-subtle' },
  };
  const Pill = ({ m }: { m: { label: string; cls: string } }) =>
    <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${m.cls}`}>{m.label}</span>;
  const cpaTone = (mark: string | null) => (mark === 'funciona' ? good : mark === 'desperdicio' ? bad : mark === 'atencao' ? warn : '');

  // Os que mais venderam em cima; embaixo, os que mais gastaram sem vender.
  const TermTable = ({ best, waste, label, first }: { best: any[]; waste: any[]; label: string; first: string }) => {
    const row = (r: any) => (
      <tr key={r.text}>
        <td className={`${td} font-medium ${head}`}>{r.text}{r.jev && <span title={r.jev === 'firme' ? 'O Jev vê este resultado se repetir com dado suficiente.' : 'Pouca venda, pouco gasto ou uma campanha só: o resultado pode não se repetir.'}
          className={`ml-2 inline-block text-[11px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap align-middle ${r.jev === 'firme' ? 'bg-brand/15 text-brand-text' : 'bg-surface-3 text-ink-subtle'}`}>Jev: {r.jev === 'firme' ? 'padrão firme' : 'pode ser acaso'}</span>}</td>
        <td className={`${td} text-right`}>{r.campaigns}</td>
        <td className={`${td} text-right whitespace-nowrap`}>{money(r.cost)}</td>
        <td className={`${td} text-right whitespace-nowrap`}>{data.approx && r.conv > 0 ? '≈ ' : ''}{qty(r.conv)}</td>
        <td className={`${td} text-right whitespace-nowrap font-medium ${cpaTone(r.mark)}`}>{r.cpa === null ? 'sem venda' : money(r.cpa)}</td>
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
  const meta = data || opts;
  const fewSales = d && d.totals.sales < 5;
  const toggleBlock = (id: string) => setBlocks(b => {
    const next = b.includes(id) ? b.filter(x => x !== id) : [...b, id];
    return next.length ? next : b;
  });

  return (
    <div className={`${inter.className} legivel min-h-screen font-sans flex ${bgMain}`}>

      {/* Menu lateral, igual ao do Dashboard */}
      <aside className="hidden md:flex md:w-60 shrink-0 border-r border-line bg-surface-1 flex-col sticky top-0 h-screen z-20">
        <div className="h-16 flex items-center justify-start px-5 border-b border-line overflow-hidden shrink-0">
          <Logo />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, Icon, label }) => (
            <Link key={href} href={href} aria-current={href === '/analise-ia' ? 'page' : undefined}
              className={href === '/analise-ia' ? `${navItem} bg-surface-2 text-ink` : `${navItem} text-ink-subtle hover:bg-surface-2 hover:text-ink`}>
              <Icon size={18} aria-hidden="true" className={href === '/analise-ia' ? 'text-brand-text' : ''} /> <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-line">
          <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/'; }}
            className={`${navItem} text-ink-subtle hover:text-neg hover:bg-neg/10`}>
            <LogOut size={18} aria-hidden="true" /> <span className="truncate">Sair ({email.split('@')[0]})</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-24 md:pb-0">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-ink">Análise de IA</h1>
            <div className={`text-sm ${muted}`}>O que se repete nas suas campanhas parecidas, e perguntas sobre elas</div>
          </div>
          <button onClick={() => { const t = isDark ? 'light' : 'dark'; setTheme(t); localStorage.setItem('autometrics_theme', t); }} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
            {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>

        {/* Conjunto, período e blocos */}
        {(meta?.options?.mccs || []).length > 1 && (
          // No celular, uma linha que rola para o lado; a partir do tablet, quebra em várias linhas.
          <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
            {[{ name: '', label: 'Todas as MCCs', count: meta.options.mccs.reduce((n: number, m: any) => n + m.count, 0) },
              ...meta.options.mccs.map((m: any) => ({ name: m.name, label: m.name, count: m.count }))].map((m: any) => (
              <button key={m.name || 'todas'} onClick={() => setMcc(m.name)} aria-pressed={mcc === m.name}
                className={`shrink-0 md:shrink text-left rounded-xl border px-3.5 py-2.5 min-w-[130px] transition-colors ${mcc === m.name ? chipOn : `${card} ${muted} hover:border-line-strong`}`}>
                <div className={`text-[13px] font-medium ${mcc === m.name ? '' : head}`}>{m.label}</div>
                <div className="text-[11px] text-ink-subtle tabular-nums">{m.count} {m.count === 1 ? 'campanha' : 'campanhas'}</div>
              </button>
            ))}
          </div>
        )}

        <div className={`${card} border rounded-xl p-3 space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <select value={(meta?.options?.tags || []).some((t: any) => t.tag.toLowerCase() === tag.toLowerCase()) ? tag.toUpperCase() : tag ? '__outro' : ''}
              onChange={e => { if (e.target.value !== '__outro') setTag(e.target.value); }}
              aria-label="Conjunto de campanhas"
              className={`rounded-lg border border-line-strong bg-surface-1 ${head} px-2 py-1.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand`}>
              <option value="">Todas as campanhas</option>
              {(meta?.options?.tags || []).map((t: any) => <option key={t.tag} value={t.tag}>{t.tag} · {t.count}</option>)}
              {tag && !(meta?.options?.tags || []).some((t: any) => t.tag.toLowerCase() === tag.toLowerCase()) && <option value="__outro">Contém “{tag}”</option>}
            </select>
            <input defaultValue="" placeholder="ou um trecho do nome" aria-label="Trecho do nome da campanha (Enter para usar)" key={tag}
              onKeyDown={e => { if (e.key === 'Enter') setTag((e.target as HTMLInputElement).value.trim()); }}
              onBlur={e => { const v = e.target.value.trim(); if (v) setTag(v); }}
              className={`rounded-lg border border-line-strong bg-surface-1 ${head} px-2 py-1.5 text-[13px] w-44 outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-brand`} />
            <div className={`flex items-center gap-1 p-1 rounded-lg border ${line} bg-surface-1 ml-auto flex-wrap`}>
              {PERIODS.map(p => (
                <button key={p.key} onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${period === p.key ? 'bg-surface-3 text-ink' : `${muted} hover:text-ink`}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {custom && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-medium ${muted}`}>Período</span>
              <input type="date" aria-label="Data inicial" value={from} max={dayStr(0)} onChange={e => setFrom(e.target.value)}
                className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} />
              <span className={`text-xs ${muted}`}>até</span>
              <input type="date" aria-label="Data final" value={to} max={dayStr(0)} onChange={e => setTo(e.target.value)}
                className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} />
            </div>
          )}
          {(meta?.options?.blocks || []).length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-medium ${muted}`}>Grupos que entram</span>
              {meta.options.blocks.map((b: any) => {
                const on = blocks.includes(b.id);
                return (
                  <button key={b.id} onClick={() => toggleBlock(b.id)} aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${on ? chipOn : chipOff}`}>
                    <Check size={12} aria-hidden="true" className={on ? '' : 'opacity-0'} /> {b.name} <span className="opacity-60 font-medium tabular-nums">{b.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!meta && !error && <div className={`flex items-center gap-2 text-sm ${muted}`}><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Carregando…</div>}
        <div aria-live="polite">{error && <div className="text-sm text-neg">{error}</div>}</div>
        {meta?.empty && !meta?.pending && <div className={`${card} border rounded-xl p-6 text-sm ${muted}`}>Nenhuma campanha com esse nome nos grupos marcados.</div>}

        {meta?.pending && !d && (
          <div className={`${card} border rounded-xl p-4 flex flex-wrap items-center gap-3`}>
            <div className={`flex-1 min-w-[220px] text-sm ${muted}`}>
              {meta.set_size} {meta.set_size === 1 ? 'campanha' : 'campanhas'} neste conjunto. Os números, termos e padrões só são calculados quando você pedir.
            </div>
            <button onClick={load} disabled={loading} className={`h-9 px-4 ${brandBtn}`}>
              {loading ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : <Sparkles size={13} aria-hidden="true" />} {loading ? 'Calculando…' : 'Analisar este conjunto'}
            </button>
          </div>
        )}

          {/* Pergunta para a IA */}
          {meta?.ai && !(meta.empty && !meta.pending) && (
            <div className={`${card} border rounded-xl p-4 space-y-3`}>
              <div className={title}>Pergunte à IA sobre este conjunto</div>
              {/* As respostas chegam sozinhas: o leitor de tela lê quando aparecem. */}
              <div aria-live="polite" className="space-y-3">
              {chat.map((c, i) => (
                <div key={i} className="space-y-1.5">
                  <div className={`text-[13px] font-medium ${head}`}>{c.q}</div>
                  <div className={`rounded-lg border ${line} ${soft} p-3 text-[13px] leading-relaxed whitespace-pre-wrap`}>{c.a}</div>
                  {c.period && <div className={`text-[11px] ${muted}`}>Números calculados para {c.period}, como pedido na pergunta.</div>}
                  {c.missing && <div className={`text-[11px] ${muted}`}>Faltou para responder melhor: {c.missing}</div>}
                  {kept.includes(i)
                    ? <div className="text-[11px] text-pos">Guardado na memória da IA.</div>
                    : <button onClick={() => keep(i)} className="text-[11px] text-brand-text hover:underline">Guardar esta resposta na memória da IA</button>}
                </div>
              ))}
              </div>
              <div aria-live="polite">{askError && <div className="text-xs text-neg">{askError}</div>}</div>
              <div className="flex gap-2 items-end">
                <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} maxLength={1000} aria-label="Pergunta para a IA (Enter envia, Shift+Enter quebra a linha)"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                  placeholder="Qual campanha piorou mais nesta semana e em qual termo?"
                  className={`flex-1 rounded-lg border border-line-strong bg-surface-1 ${head} px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-brand resize-y`} />
                <VoiceButton onText={t => setQuestion(p => (p.trim() ? `${p.trim()} ${t}` : t))} />
                <button onClick={ask} disabled={answering || !question.trim()}
                  className={`px-3 py-2 ${brandBtn}`}>
                  {answering ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : <Send size={13} aria-hidden="true" />} Perguntar
                </button>
              </div>
              <div className={`text-[11px] ${muted}`}>
                A IA recebe os dados do conjunto e do período escolhidos acima: cada campanha, dia a dia, termos, dispositivos, idade, gênero, locais e vídeo. Ela vê os melhores termos e palavras-chave, e a situação de cada campanha. Para olhar uma campanha só, escreva o nome dela no campo de trecho do nome.
              </div>
            </div>
          )}

          <MemoryCard api={api} tags={meta?.options?.tags || []} reloadKey={memoryTick} css={{ card, head, muted, line, soft, title }} />

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

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 tabular-nums">
              {[
                { l: 'Campanhas com gasto', v: String(d.totals.campaigns) },
                { l: 'Custo', v: money(d.totals.cost) },
                { l: 'Vendas', v: qty(d.totals.sales) },
                { l: 'CPA do grupo', v: money(d.totals.cpa) },
                { l: 'Resultado', v: signed(d.totals.result) },
              ].map(x => (
                <div key={x.l} className={`${card} border rounded-xl px-4 py-3`}>
                  <div className={`text-xs font-medium ${muted}`}>{x.l}</div>
                  <div className={`text-lg sm:text-xl font-semibold whitespace-nowrap tabular-nums ${head}`}>{x.v}</div>
                </div>
              ))}
            </div>

            {/* O que se repete */}
            <div className={`${card} border rounded-xl p-4 space-y-3`}>
              <div className="flex items-center gap-2 flex-wrap">
                <div className={title}>O que se repete{tag ? ` nas campanhas ${tag}` : ''}</div>
                {data.ai && (
                  <button onClick={askAi} disabled={asking || !d.totals.cost}
                    className={`ml-auto h-8 px-3 ${brandBtn}`}>
                    {asking ? <Loader2 size={12} aria-hidden="true" className="animate-spin" /> : <Sparkles size={12} aria-hidden="true" />} {reading ? 'Refazer leitura da IA' : 'Pedir leitura da IA'}
                  </button>
                )}
              </div>
              {fewSales && <div className={`text-xs ${warn}`}>Poucas vendas neste período ({qty(d.totals.sales)}): os números ainda são pequenos para concluir.</div>}
              <div aria-live="polite">{aiError && <div className="text-xs text-neg">{aiError}</div>}</div>
              {reading && (
                <div className={`rounded-lg border ${line} ${soft} p-3 space-y-2`}>
                  <div className={`text-xs font-medium ${muted}`}>✦ Leitura da IA</div>
                  {reading.title && <div className={`text-sm font-medium ${head}`}>{reading.title}</div>}
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


            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
                        <td className={`${td} text-right font-medium ${cpaTone(r.mark)}`}>{r.cpa === null ? 'sem venda' : money(r.cpa)}</td>
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

            {/* O que os ajustes mostraram, em todas as campanhas */}
            {(data.adjustments || []).length > 0 && (
              <div className={`${card} border rounded-xl overflow-hidden`}>
                <div className={`px-4 pt-4 pb-1 ${title}`}>O que os seus ajustes mostraram · todas as suas campanhas</div>
                <div className={`px-4 pb-3 text-xs ${muted}`}>
                  Cada tipo de ajuste feito no Google, somando todas as campanhas, e o que aconteceu com a campanha depois (7 dias antes contra 3 ou 7 dias depois). A IA lê esta tabela antes de sugerir e de responder. Não muda com o conjunto nem com o período escolhidos acima.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse tabular-nums">
                    <thead><tr>
                      <th className={`${th} text-left`}>Ajuste</th>
                      <th className={`${th} text-right`}>Conferidos</th>
                      <th className={`${th} text-right`}>Melhorou</th>
                      <th className={`${th} text-right`}>Piorou</th>
                      <th className={`${th} text-right`}>Ficou igual</th>
                      <th className={`${th} text-right`}>CPA em média</th>
                      <th className={`${th} text-right`}>Aguardando</th>
                    </tr></thead>
                    <tbody>{data.adjustments.map((r: any) => (
                      <tr key={r.kind}>
                        <td className={`${td} font-medium ${head}`}>{r.label}</td>
                        <td className={`${td} text-right`}>{r.times}</td>
                        <td className={`${td} text-right ${r.melhorou ? good : muted}`}>{r.melhorou}</td>
                        <td className={`${td} text-right ${r.piorou ? bad : muted}`}>{r.piorou}</td>
                        <td className={`${td} text-right ${muted}`}>{r.igual}</td>
                        <td className={`${td} text-right ${r.cpa_change === null ? muted : r.cpa_change <= 0 ? good : bad}`}>{r.cpa_change === null ? '—' : `${r.cpa_change > 0 ? '+' : ''}${Number(r.cpa_change).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</td>
                        <td className={`${td} text-right ${muted}`}>{r.waiting}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className={`px-4 py-2 text-[11px] ${muted}`}>
                  O resultado é da campanha inteira: no dia com vários ajustes, todos levam o mesmo resultado. Com poucas repetições ainda não dá para tirar regra.
                </div>
              </div>
            )}

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
                          <Link href={`/products/${v.id}`} target="_blank" rel="noopener noreferrer" className={`font-medium ${head} hover:text-brand-text hover:underline`}>{v.name}</Link>
                          {v.status && (
                            <span title={v.status.hint} className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium align-middle ${v.status.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${v.status.dot}`} />{v.status.label}
                              {v.status.hint && <span className="sr-only">: {v.status.hint}</span>}
                            </span>
                          )}
                          <div className={`text-[11px] ${muted} whitespace-normal`}>{v.reason}</div>
                        </td>
                        <td className={`${td} text-right align-top`}>{v.days}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap`}>{money(v.cost)}</td>
                        <td className={`${td} text-right align-top`}>{qty(v.sales)}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap`}>{money(v.cpa)}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap font-medium`}>{signed(v.result)}</td>
                        <td className={`${td} text-right align-top whitespace-nowrap`}>{signed(v.result7)}</td>
                        <td className={`${td} align-top`}><Pill m={VERDICT[v.verdict]} />
                          {v.jev && <div title={v.jev === 'esperar' ? 'O Jev acha que ainda pode se recuperar sozinha.' : 'O Jev vê dado suficiente para decidir agora.'} className={`mt-1 text-[11px] font-medium whitespace-nowrap ${v.jev === 'esperar' ? 'text-ink-subtle' : 'text-brand-text'}`}>Jev: {v.jev === 'esperar' ? 'esperar' : 'mexer agora'}</div>}</td>
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
      <nav className="fixed bottom-0 inset-x-0 md:hidden z-40 border-t border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex justify-around items-center px-2 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {NAV.map(({ href, Icon, short }) => {
            const active = href === '/analise-ia';
            return (
              <Link key={href} href={href}
                aria-current={active ? 'page' : undefined} className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-lg transition-colors ${active ? 'text-brand-text' : 'text-ink-subtle'}`}>
                <Icon size={22} aria-hidden="true" />
                <span className="text-[10px] font-medium">{short}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
