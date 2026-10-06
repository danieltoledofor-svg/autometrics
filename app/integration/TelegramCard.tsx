"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Aba Telegram da Integração.
 *
 * 1. Liga a conversa do usuário ao bot do Autometrics: ele abre o bot pelo
 *    link (que já leva o código), toca em Iniciar e volta para conferir.
 * 2. Lista os alertas (lib/alerts/catalog): liga e desliga cada um, ajusta os
 *    limites e o horário de silêncio. Cada mudança é salva sozinha.
 *
 * Rota: /api/telegram.
 */

async function api(body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/telegram', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function TelegramCard({ isDark }: { isDark: boolean }) {
  const [state, setState] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<'' | 'salvando' | 'salvo' | 'erro'>('');
  const [saveError, setSaveError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { body } = await api();
    setState(body);
    if (body.settings) setSettings(body.settings);
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (action: string, extra: any = {}, done?: string) => {
    setBusy(action);
    setMessage(null);
    const { ok, body } = await api({ action, ...extra });
    if (!ok) setMessage({ ok: false, text: body.error || 'Não deu certo.' });
    else { if (body.ready) setState(body); if (done) setMessage({ ok: true, text: done }); }
    setBusy('');
  };

  // Cada mudança nos alertas é salva um instante depois, sem botão.
  const change = (next: any) => {
    setSettings(next);
    setSaved('salvando');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { ok, body } = await api({ action: 'settings', settings: next });
      if (ok) { setSaved('salvo'); if (body.settings) setSettings(body.settings); }
      else { setSaved('erro'); setSaveError(body.error || 'Não foi possível salvar.'); }
    }, 700);
  };
  const setAlert = (key: string, patch: any) => change({ ...settings, alerts: { ...settings.alerts, [key]: { ...settings.alerts[key], ...patch } } });

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const head = isDark ? 'text-white' : 'text-slate-900';
  const muted = 'text-slate-500';
  const line = isDark ? 'border-slate-800' : 'border-slate-200';
  const field = `rounded-lg border ${line} ${isDark ? 'bg-slate-950 text-white' : 'bg-white text-slate-900'} px-2 py-1 text-[13px] outline-none focus:border-indigo-500`;
  const ghost = `px-3 py-1.5 rounded-lg border ${line} text-xs font-bold ${muted} hover:text-indigo-400 disabled:opacity-50`;
  const solid = 'bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5';
  const spin = (a: string) => busy === a && <Loader2 size={12} className="animate-spin" />;

  if (!state) return <div className={`flex items-center gap-2 text-sm ${muted}`}><Loader2 size={16} className="animate-spin" /> Carregando…</div>;
  const link = state.bot && state.code ? `https://t.me/${state.bot}?start=${state.code}` : '';

  const Switch = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative w-10 h-[22px] rounded-full shrink-0 transition-colors ${on ? 'bg-indigo-600' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`}>
      <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
    </button>
  );

  return (
    <div className="space-y-6">
      {/* ── Ligação com o bot ── */}
      <div className={`${card} border rounded-xl p-5`}>
        <div className="flex items-center gap-2 mb-1">
          <Send size={16} className="text-sky-500" />
          <span className={`text-base font-bold ${head}`}>Telegram</span>
          {state.linked && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${state.enabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>{state.enabled ? 'Ligado' : 'Pausado'}</span>}
        </div>
        <div className={`text-xs ${muted} mb-4`}>Os avisos das suas campanhas chegam numa conversa com o bot do Autometrics. Cada pessoa liga o próprio Telegram e recebe só o que é dela.</div>

        {!state.ready && <div className="text-sm text-amber-500">{state.error}</div>}
        {state.ready && !state.configured && <div className="text-sm text-amber-500">O bot do Telegram ainda não foi configurado no servidor do Autometrics.</div>}

        {state.ready && state.configured && !state.linked && (
          <div className="space-y-3">
            {!state.code ? (
              <button onClick={() => run('code')} disabled={!!busy} className={solid}>{spin('code')} Ligar o meu Telegram</button>
            ) : (
              <>
                <ol className={`text-[13px] ${head} space-y-1.5 list-decimal pl-5`}>
                  <li>Abra o bot: <a href={link} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline break-all">{link}</a></li>
                  <li>No Telegram, toque em <b>Iniciar</b>. Se o botão não aparecer, envie a mensagem <b className="font-mono">{state.code}</b>.</li>
                  <li>Volte aqui e clique em conferir.</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => run('check', {}, 'Telegram ligado. Mandei uma mensagem de confirmação para você.')} disabled={!!busy} className={solid}>{spin('check')} Já enviei, conferir</button>
                  <button onClick={() => run('code')} disabled={!!busy} className={ghost}>Gerar outro código</button>
                </div>
                <div className={`text-[11px] ${muted}`}>O código vale 30 minutos.</div>
              </>
            )}
          </div>
        )}

        {state.ready && state.configured && state.linked && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[13px] ${head} mr-auto`}>Conversa: <b>{state.chat_name || 'Telegram'}</b></span>
            <button onClick={() => run('test', {}, 'Mensagem de teste enviada.')} disabled={!!busy} className={solid}>{spin('test')} Enviar teste</button>
            <button onClick={() => run('toggle', { enabled: !state.enabled })} disabled={!!busy} className={ghost}>{state.enabled ? 'Pausar todos os alertas' : 'Voltar a avisar'}</button>
            <button onClick={() => run('unlink', {}, 'Ligação desfeita.')} disabled={!!busy} className={ghost}>Desligar</button>
          </div>
        )}
        {message && <div className={`text-xs mt-3 ${message.ok ? 'text-emerald-500' : 'text-rose-500'}`}>{message.text}</div>}
      </div>

      {/* ── Alertas ── */}
      {state.ready && settings && (
        <div className={`${card} border rounded-xl overflow-hidden`}>
          <div className="flex items-center gap-2 px-5 pt-5 pb-1">
            <span className={`text-base font-bold ${head}`}>Alertas</span>
            <span className={`text-[11px] ml-auto ${saved === 'erro' ? 'text-rose-500' : saved === 'salvo' ? 'text-emerald-500' : muted}`}>
              {saved === 'salvando' ? 'Salvando…' : saved === 'salvo' ? 'Salvo' : saved === 'erro' ? saveError : ''}
            </span>
          </div>
          <div className={`px-5 pb-4 text-xs ${muted}`}>
            Ligue só o que quer receber e ajuste os limites. A conferência roda a cada 5 minutos; o gasto de cada conta é relido de hora em hora. Os horários são de Brasília.
          </div>

          {(state.catalog || []).map((a: any) => {
            const s = settings.alerts[a.key] || {};
            return (
              <div key={a.key} className={`px-5 py-3.5 border-t ${line}`}>
                <div className="flex items-start gap-3">
                  <Switch on={!!s.on} onClick={() => setAlert(a.key, { on: !s.on })} label={a.title} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-bold ${s.on ? head : muted}`}>{a.title}</div>
                    <div className={`text-xs ${muted}`}>{a.when}</div>
                    {s.on && a.params.length > 0 && (
                      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-2.5">
                        {a.params.map((p: any) => (
                          <label key={p.key} className={`flex items-center gap-2 text-xs ${muted}`}>
                            {p.label}
                            {p.unit === 'horas' ? (
                              <select value={s[p.key] ?? p.value} onChange={e => setAlert(a.key, { [p.key]: Number(e.target.value) })} className={field}>
                                {HOURS.filter(h => h >= p.min && h <= p.max).map(h => <option key={h} value={h}>{h}h</option>)}
                              </select>
                            ) : (
                              <input type="number" inputMode="decimal" min={p.min} max={p.max} step={p.step} value={s[p.key] ?? ''} placeholder={p.value === null ? 'defina' : String(p.value)}
                                onChange={e => setAlert(a.key, { [p.key]: e.target.value === '' ? null : Number(e.target.value) })} className={`${field} w-24 text-right tabular-nums`} />
                            )}
                            {p.unit !== 'horas' && <span>{p.unit}</span>}
                          </label>
                        ))}
                      </div>
                    )}
                    {a.key === 'cpa' && s.on && !s.limit && <div className="text-xs text-amber-500 mt-2">Preencha o limite para este alerta começar a avisar.</div>}
                  </div>
                </div>
              </div>
            );
          })}

          <div className={`px-5 py-3.5 border-t ${line}`}>
            <div className="flex items-start gap-3">
              <Switch on={!!settings.quiet.on} onClick={() => change({ ...settings, quiet: { ...settings.quiet, on: !settings.quiet.on } })} label="Horário de silêncio" />
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold ${settings.quiet.on ? head : muted}`}>Horário de silêncio</div>
                <div className={`text-xs ${muted}`}>Nesse intervalo nada é enviado. O que continuar valendo chega quando o silêncio acaba.</div>
                {settings.quiet.on && (
                  <div className={`flex items-center gap-2 text-xs ${muted} mt-2.5`}>
                    Das
                    <select value={settings.quiet.from} onChange={e => change({ ...settings, quiet: { ...settings.quiet, from: Number(e.target.value) } })} className={field}>{HOURS.map(h => <option key={h} value={h}>{h}h</option>)}</select>
                    às
                    <select value={settings.quiet.to} onChange={e => change({ ...settings, quiet: { ...settings.quiet, to: Number(e.target.value) } })} className={field}>{HOURS.map(h => <option key={h} value={h}>{h}h</option>)}</select>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
