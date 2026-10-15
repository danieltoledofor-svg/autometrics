"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LayoutGrid, Loader2, LogOut, Moon, Package, Route, Settings, Sparkles, Sun, Target } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import { Logo } from '@/app/components/Logo';
import { Inter } from 'next/font/google';
import { styles } from './shared';
import { VisitsTab } from './VisitsTab';
import { EventsTab } from './EventsTab';
import { InstallTab } from './InstallTab';

/**
 * Rastreamento: do clique à venda em todas as campanhas. Os cliques e as
 * páginas vêm do script das páginas; as vendas, do postback da plataforma.
 *
 * Abas: Visão geral (números prontos de /api/tracking/overview), Visitas,
 * Vendas, Checkouts e Instalação (script, postbacks e envio ao Google).
 */

const TABS = [
  { key: 'overview', label: 'Visão geral' }, { key: 'visits', label: 'Visitas' }, { key: 'sales', label: 'Vendas' },
  { key: 'checkouts', label: 'Checkouts' }, { key: 'install', label: 'Instalação' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const PERIODS = [
  { key: 'today', label: 'Hoje' }, { key: 'yesterday', label: 'Ontem' }, { key: 'd3', label: '3 dias' }, { key: 'd7', label: '7 dias' }, { key: 'custom', label: 'Personalizado' },
];
const VIEWS = [
  { key: 'campaigns', label: 'Por campanha', column: 'Campanha' },
  { key: 'keywords', label: 'Por palavra-chave', column: 'Palavra-chave' },
  { key: 'devices', label: 'Por aparelho', column: 'Aparelho' },
] as const;
const NAV = [
  { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', short: 'Dashboard' },
  { href: '/planning', Icon: Target, label: 'Metas', short: 'Metas' },
  { href: '/products', Icon: Package, label: 'Campanhas', short: 'Campanhas' },
  { href: '/analise-ia', Icon: Sparkles, label: 'Análise de IA', short: 'Análise IA' },
  { href: '/rastreamento', Icon: Route, label: 'Rastreamento', short: 'Rastreio' },
  { href: '/integration', Icon: Settings, label: 'Integração', short: 'Integração' },
];
// Fonte do guia visual (DESIGN.md), nas telas já migradas.
const inter = Inter({ subsets: ['latin'], display: 'swap' });

const SAVED = 'autometrics_rastreamento';
const dayStr = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const qty = (v: number) => Number(v || 0).toLocaleString('pt-BR');
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '');
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const gap = (from: string, to: string) => {
  const min = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.round(min / 1440)} dias`;
};

export default function TrackingPage() {
  const { authChecked } = useAuthGuard();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [period, setPeriod] = useState('d7');
  const [from, setFrom] = useState(dayStr(-7));
  const [to, setTo] = useState(dayStr(0));
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('campaigns');
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const request = useRef(0);

  useEffect(() => {
    const t = localStorage.getItem('autometrics_theme') as 'dark' | 'light' | null;
    if (t) setTheme(t);
    try {
      const s = JSON.parse(localStorage.getItem(SAVED) || '{}');
      if (PERIODS.some(p => p.key === s.period)) setPeriod(s.period);
      if (VIEWS.some(v => v.key === s.view)) setView(s.view);
      if (validDay(s.from) && validDay(s.to)) { setFrom(s.from); setTo(s.to); }
    } catch { /* primeira vez */ }
    // Link vindo da Integração: /rastreamento?aba=instalacao
    const aba = new URLSearchParams(window.location.search).get('aba');
    if (aba === 'instalacao') setTab('install');
    else if (aba === 'visitas') setTab('visits');
    setReady(true);
    supabase.auth.getSession().then(({ data: { session } }) => { setEmail(session?.user?.email || ''); setUserId(session?.user?.id || ''); });
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);

  const custom = period === 'custom';
  const datesOk = !custom || (validDay(from) && validDay(to));
  const query = `period=${period}${custom ? `&from=${from}&to=${to}` : ''}`;

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/tracking/overview?${query}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
    const body = await res.json().catch(() => ({}));
    if (id !== request.current) return;
    if (!res.ok || body.ready === false) { setError(body.error || 'Não foi possível carregar.'); setData(null); }
    else setData(body);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    // Data pela metade enquanto é digitada: espera ficar completa.
    if (!authChecked || !ready || !datesOk) return;
    try { localStorage.setItem(SAVED, JSON.stringify({ period, view, from, to })); } catch { /* sem armazenamento */ }
    load();
  }, [authChecked, ready, load, datesOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem(SAVED, JSON.stringify({ period, view, from, to })); } catch { /* sem armazenamento */ }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDark = theme === 'dark';
  const bgMain = 'bg-canvas text-ink-muted';
  const card = 'bg-surface-1 border-line';
  const head = 'text-ink';
  const muted = 'text-ink-subtle';
  const line = 'border-line';
  const soft = 'bg-surface-2';
  const th = `px-3 py-2 text-xs font-medium ${muted} ${soft} whitespace-nowrap border-b ${line}`;
  const td = `px-3 py-2 text-[13px] border-b ${line}`;
  const title = 'text-sm font-medium text-ink';
  const tabOn = 'bg-surface-3 text-ink';
  const navItem = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const ui = styles(isDark);

  const symbol = (c?: string) => (c === 'BRL' ? 'R$' : c === 'EUR' ? '€' : 'US$');
  const money = (v: number, c?: string) => `${symbol(c || data?.currency)} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!authChecked) return <div className="min-h-screen bg-canvas" />;

  const t = data?.totals;
  const values: [string, number][] = data ? Object.entries(data.value as Record<string, number>).sort((a, b) => b[1] - a[1]) : [];
  const rows: any[] = data?.[view] || [];
  const column = VIEWS.find(v => v.key === view)!.column;
  const stat = (label: string, value: React.ReactNode, hint: string) => (
    <div className={`${card} border rounded-xl p-4`}>
      <div className={`text-xs font-medium ${muted}`}>{label}</div>
      <div className={`text-lg sm:text-xl font-semibold mt-1 tabular-nums whitespace-nowrap ${head}`}>{value}</div>
      <div className={`text-[11px] mt-1 ${muted}`}>{hint || ' '}</div>
    </div>
  );

  return (
    <div className={`${inter.className} legivel min-h-screen font-sans flex ${bgMain}`}>

      {/* Menu lateral, igual ao do Dashboard */}
      <aside className="hidden md:flex md:w-60 shrink-0 border-r border-line bg-surface-1 flex-col sticky top-0 h-screen z-20">
        <div className="h-16 flex items-center justify-start px-5 border-b border-line overflow-hidden shrink-0">
          <Logo />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, Icon, label }) => (
            <Link key={href} href={href} aria-current={href === '/rastreamento' ? 'page' : undefined}
              className={href === '/rastreamento' ? `${navItem} bg-surface-2 text-ink` : `${navItem} text-ink-subtle hover:bg-surface-2 hover:text-ink`}>
              <Icon size={18} aria-hidden="true" className={href === '/rastreamento' ? 'text-brand-text' : ''} /> <span>{label}</span>
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-ink">Rastreamento</h1>
            <div className={`text-sm ${muted}`}>Do clique no anúncio até a venda, em todas as suas campanhas</div>
          </div>
          {/* No celular, os períodos vão para uma linha própria, abaixo do título (order-last + w-full). */}
          {tab !== 'install' && <div className={`order-last w-full sm:order-none sm:w-auto flex items-center gap-1 p-1 rounded-lg border ${line} flex-wrap`}>
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${period === p.key ? tabOn : `${muted} hover:text-ink`}`}>
                {p.label}
              </button>
            ))}
          </div>}
          <button onClick={() => { const next = isDark ? 'light' : 'dark'; setTheme(next); localStorage.setItem('autometrics_theme', next); }} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
            {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>

        <div className={`flex gap-1 border-b ${line} overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
              className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-brand text-ink' : `border-transparent ${muted} hover:text-ink`}`}>
              {t.label}
            </button>
          ))}
        </div>

        {custom && tab !== 'install' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium ${muted}`}>Período</span>
            <input type="date" aria-label="Data inicial" value={from} max={dayStr(0)} onChange={e => setFrom(e.target.value)}
              className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] dark:[&::-webkit-calendar-picker-indicator]:invert`} />
            <span className={`text-xs ${muted}`}>até</span>
            <input type="date" aria-label="Data final" value={to} max={dayStr(0)} onChange={e => setTo(e.target.value)}
              className={`rounded-lg border ${line} ${soft} ${head} px-2 py-1.5 text-[13px] dark:[&::-webkit-calendar-picker-indicator]:invert`} />
          </div>
        )}

        {tab === 'visits' && datesOk && <VisitsTab ui={ui} period={query} campaigns={data?.campaigns || []} />}
        {tab === 'sales' && datesOk && <EventsTab ui={ui} period={query} type="sale" />}
        {tab === 'checkouts' && datesOk && <EventsTab ui={ui} period={query} type="checkout" />}
        {tab === 'install' && userId && <InstallTab isDark={isDark} userId={userId} />}

        <div aria-live="polite">{tab === 'overview' && error && <div className={`${card} border rounded-xl p-4 text-sm text-neg`}>{error}</div>}</div>
        {tab === 'overview' && loading && !data && <div className={`flex items-center gap-2 text-sm ${muted}`}><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Carregando…</div>}

        {tab === 'overview' && data && t && (
          <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {t.clicks === 0 && t.sales === 0 ? (
              <div className={`${card} border rounded-xl p-6 text-sm ${muted}`}>
                Nenhum clique rastreado neste período. O script das páginas fica na aba{' '}
                <button onClick={() => setTab('install')} className="text-brand-text hover:underline">Instalação</button>.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                  {stat('Visitas', qty(t.clicks), t.clicks ? `${pct(t.with_gclid, t.clicks)} com gclid` : '')}
                  {stat('Foram para o vídeo', qty(t.video), t.clicks ? `${pct(t.video, t.clicks)} das visitas` : '')}
                  {stat('Foram para o checkout', t.checkout ? qty(t.checkout) : <span className={muted}>—</span>,
                    t.checkout ? `${pct(t.checkout, t.clicks)} das visitas` : 'conta após trocar o script nas páginas')}
                  {stat('Vendas', qty(t.sales), t.sales && t.clicks ? `1 a cada ${qty(Math.round(t.clicks / t.sales))} visitas` : '')}
                  {stat('Valor vendido', values.length ? values.map(([c, v]) => money(v, c)).join(' + ') : money(0),
                    t.unlinked ? `${t.unlinked} ${t.unlinked === 1 ? 'venda' : 'vendas'} sem clique ligado` : t.sales ? 'todas ligadas ao clique' : '')}
                </div>

                <div className={`${card} border rounded-xl overflow-hidden`}>
                  <div className="flex flex-wrap items-center gap-1 p-3">
                    {VIEWS.map(v => (
                      <button key={v.key} onClick={() => setView(v.key)} aria-pressed={view === v.key}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === v.key ? tabOn : `${muted} hover:text-ink`}`}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className={`${th} text-left`}>{column}</th>
                          <th className={`${th} text-right`}>Visitas</th>
                          <th className={`${th} text-right`}>Vídeo</th>
                          <th className={`${th} text-right`}>Checkout</th>
                          <th className={`${th} text-right`}>Vendas</th>
                          <th className={`${th} text-right`}>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.key}>
                            <td className={`${td} ${head} min-w-[13rem] max-w-[17rem] xl:max-w-[420px] xl:truncate`} title={r.key}>
                              {r.id ? <Link href={`/products/${r.id}`} className="hover:text-brand-text hover:underline">{r.key}</Link> : r.key}
                            </td>
                            <td className={`${td} text-right tabular-nums`}>{qty(r.clicks)}</td>
                            <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{qty(r.video)} <span className={`text-[11px] ${muted}`}>{pct(r.video, r.clicks)}</span></td>
                            <td className={`${td} text-right tabular-nums`}>{r.checkout ? qty(r.checkout) : <span className={muted}>—</span>}</td>
                            <td className={`${td} text-right tabular-nums font-medium ${r.sales ? head : muted}`}>{r.sales || '—'}</td>
                            <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{r.value ? money(r.value) : <span className={muted}>—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={`${card} border rounded-xl p-4`}>
                  <div className={title}>Últimas vendas e o caminho de cada uma</div>
                  {data.sales.length === 0 && <div className={`text-sm mt-3 ${muted}`}>Nenhuma venda neste período.</div>}
                  {data.sales.map((s: any, i: number) => (
                    <div key={i} className={`py-3 ${i ? `border-t ${line}` : 'mt-1'}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <div className="min-w-0 text-[13px]">
                          <span className={`font-medium tabular-nums ${head}`}>{money(s.amount, s.currency)}</span>
                          <span className={muted}> · </span>
                          <Link href={`/products/${s.product_id}`} className={`${head} hover:text-brand-text hover:underline`}>{s.campaign}</Link>
                        </div>
                        <div className={`text-xs tabular-nums ${muted}`}>{s.at_text || when(s.at)}{s.source ? ` · ${s.source}` : ''}</div>
                      </div>
                      <div className={`text-xs mt-1 ${muted}`}>
                        {s.linked
                          ? [s.keyword || 'sem palavra-chave', s.device, `clique em ${when(s.click_at)}`,
                            `${s.pages} ${s.pages === 1 ? 'página' : 'páginas'}${s.checkout ? ' e checkout' : ''}`, `comprou ${gap(s.click_at, s.at)} depois`].filter(Boolean).join(' · ')
                          : 'Sem clique ligado: a plataforma não devolveu um identificador que o script tenha guardado.'}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      </main>

      {/* Menu do celular */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden z-40 border-t border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex justify-around items-center px-2 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {NAV.map(({ href, Icon, short }) => {
            const active = href === '/rastreamento';
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
