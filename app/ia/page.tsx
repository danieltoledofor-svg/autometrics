"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Sun, Moon, Save } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';

/**
 * Consumo da IA — só para o dono do Autometrics (AUTOMETRICS_OWNER_EMAILS).
 * Modelo de cada função (lista e preços vêm do OpenRouter) e gasto do mês por usuário.
 */

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, ...(init.headers || {}) },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

const usd = (v: number, digits = 2) => `US$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export default function AiAdminPage() {
  const { authChecked } = useAuthGuard();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('autometrics_theme')) as 'dark' | 'light' | null;
    if (saved) setTheme(saved);
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);

  const load = async () => {
    const { ok, status: code, body } = await api('/api/ai-admin');
    if (code === 403) { setStatus('forbidden'); return; }
    if (!ok) { setStatus('error'); setMessage(body.error || 'Erro ao carregar.'); return; }
    setData(body);
    setChoice(Object.fromEntries(body.functions.map((f: any) => [f.id, f.model])));
    setStatus('ok');
  };
  useEffect(() => { if (authChecked) load(); }, [authChecked]);

  const save = async (fn: string) => {
    setSaving(fn);
    const { ok, body } = await api('/api/ai-admin', { method: 'PUT', body: JSON.stringify({ function: fn, model: choice[fn] }) });
    if (!ok) setMessage(body.error || 'Não foi possível salvar.');
    await load();
    setSaving(null);
  };

  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';
  const soft = isDark ? 'bg-slate-950' : 'bg-slate-50';
  const th = `px-3 py-2 text-[10.5px] uppercase tracking-wider font-bold ${textMuted} ${soft} whitespace-nowrap border-b ${borderCol}`;
  const td = `px-3 py-2 text-[13px] whitespace-nowrap border-b ${borderCol}`;

  const modelById = useMemo(() => new Map((data?.models || []).map((m: any) => [m.id, m])), [data]);

  if (!authChecked) return null;

  return (
    <div className={`legivel min-h-screen font-sans ${bgMain}`}>
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/integration" className={`p-2 rounded-lg border ${bgCard} ${textMuted}`}><ArrowLeft size={18} /></Link>
          <div className="flex-1">
            <h1 className={`text-2xl font-bold ${textHead}`}>Consumo da IA</h1>
            <div className={`text-sm ${textMuted}`}>Visível só para o dono do Autometrics</div>
          </div>
          <button onClick={() => { const t = isDark ? 'light' : 'dark'; setTheme(t); localStorage.setItem('autometrics_theme', t); }} className={textMuted}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {status === 'loading' && <div className={`flex items-center gap-2 text-sm ${textMuted}`}><Loader2 size={16} className="animate-spin" /> Carregando…</div>}
        {status === 'forbidden' && <div className={`${bgCard} border rounded-xl p-6 text-sm ${textMuted}`}>Esta tela é só do dono do Autometrics. O e-mail do dono fica na variável AUTOMETRICS_OWNER_EMAILS do servidor.</div>}
        {status === 'error' && <div className="text-sm text-rose-500">{message}</div>}

        {status === 'ok' && data && (<>
          {!data.ai && <div className="text-sm text-amber-500">OPENROUTER_API_KEY não está configurada no servidor: a análise roda só com números e textos padrão.</div>}
          {message && <div className="text-sm text-rose-500">{message}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
            {[
              { l: 'Este mês', v: usd(data.month.cost), c: `${data.month.calls.toLocaleString('pt-BR')} chamadas · ${(data.month.tokens / 1e6).toFixed(2).replace('.', ',')} mi tokens${data.month.errors ? ` · ${data.month.errors} com erro` : ''}` },
              { l: 'Projeção do mês', v: usd(data.month.projection), c: 'no ritmo dos últimos 7 dias' },
              { l: 'Limite', v: 'Liberado', c: 'fase de testes · créditos por plano depois' },
            ].map(x => (
              <div key={x.l} className={`${bgCard} border rounded-xl px-4 py-3`}>
                <div className={`text-[10.5px] uppercase tracking-wider font-bold ${textMuted}`}>{x.l}</div>
                <div className={`text-2xl font-extrabold ${textHead}`}>{x.v}</div>
                <div className={`text-xs ${textMuted}`}>{x.c}</div>
              </div>
            ))}
          </div>

          <div className={`${bgCard} border rounded-xl p-4 space-y-3`}>
            <div className={`text-[11px] uppercase tracking-wider font-extrabold ${textMuted}`}>Modelo de cada função · lista e preços do OpenRouter</div>
            {data.functions.map((f: any) => {
              const m: any = modelById.get(choice[f.id]);
              return (
                <div key={f.id} className={`rounded-lg border ${borderCol} p-3 space-y-2`}>
                  <div className={`font-bold text-sm ${textHead}`}>{f.label}</div>
                  <div className={`text-xs ${textMuted}`}>Roda {f.when}. Padrão: {f.default}</div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <select value={choice[f.id] || ''} onChange={e => setChoice(c => ({ ...c, [f.id]: e.target.value }))}
                      className={`flex-1 min-w-[260px] rounded-lg border ${borderCol} ${soft} ${textHead} px-2 py-1.5 text-[13px]`}>
                      {!modelById.has(choice[f.id]) && <option value={choice[f.id]}>{choice[f.id]}</option>}
                      {data.models.map((mm: any) => (
                        <option key={mm.id} value={mm.id}>{mm.id} · US$ {mm.input.toFixed(2)} / {mm.output.toFixed(2)} por 1M</option>
                      ))}
                    </select>
                    <button onClick={() => save(f.id)} disabled={saving === f.id || choice[f.id] === f.model}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5">
                      {saving === f.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Salvar
                    </button>
                  </div>
                  {m && <div className={`text-xs ${textMuted}`}>{m.name} · entrada US$ {m.input.toFixed(3)} e saída US$ {m.output.toFixed(3)} por milhão de tokens · contexto {Number(m.context || 0).toLocaleString('pt-BR')}</div>}
                </div>
              );
            })}
          </div>

          <div className={`${bgCard} border rounded-xl overflow-x-auto`}>
            <div className={`px-4 pt-4 pb-2 text-[11px] uppercase tracking-wider font-extrabold ${textMuted}`}>Por usuário · este mês</div>
            {data.users.length === 0 ? <div className={`px-4 pb-4 text-sm ${textMuted}`}>Nenhuma chamada este mês.</div> : (
              <table className="w-full border-collapse tabular-nums">
                <thead><tr>{['Usuário', 'Campanhas', 'Chamadas', 'Leitura', 'Página', 'Total', 'Crédito'].map((h, i) =>
                  <th key={h} className={`${th} ${i === 0 || i === 6 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
                <tbody>{data.users.map((u: any) => (
                  <tr key={u.user_id}>
                    <td className={td}><span className={textHead}>{u.email}</span>{u.you && <span className={`ml-2 text-[11px] ${textMuted}`}>você</span>}</td>
                    <td className={`${td} text-right`}>{u.campaigns}</td>
                    <td className={`${td} text-right`}>{u.calls}{u.errors ? <span className="text-rose-500"> ({u.errors} erro)</span> : null}</td>
                    <td className={`${td} text-right`}>{usd(u.leitura || 0, 4)}</td>
                    <td className={`${td} text-right`}>{usd(u.pagina || 0, 4)}</td>
                    <td className={`${td} text-right font-bold ${textHead}`}>{usd(u.total, 4)}</td>
                    <td className={td}><span className={`text-[11px] px-2 py-0.5 rounded-full border ${borderCol} ${textMuted}`}>ilimitado</span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>)}
      </div>
    </div>
  );
}
