"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, Send, Sparkles, Trash2 } from 'lucide-react';
import { describeRule, sanitizeRule, RULE_METRICS, RULE_WINDOWS, RULE_BASES } from '@/lib/alerts/catalog';
import { supabase } from '@/lib/supabaseClient';

/**
 * Aba Telegram da Integração.
 *
 * 1. Liga a conversa do usuário ao bot do Autometrics: ele abre o bot pelo
 *    link (que já leva o código), toca em Iniciar e volta para conferir.
 * 2. Lista os alertas (lib/alerts/catalog): liga e desliga cada um, ajusta os
 *    limites e o horário de silêncio. Cada mudança é salva sozinha.
 *
 * 3. Regras próprias: a pessoa escreve o que quer ser avisada, a IA devolve a
 *    regra em uma frase e ela decide se adiciona. Também dá para montar e
 *    editar a regra na mão, campo a campo, sem depender da IA.
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
  const [ruleText, setRuleText] = useState('');
  const [draft, setDraft] = useState<any>(null);
  const [drafting, setDrafting] = useState(false);
  const [ruleError, setRuleError] = useState('');
  // Formulário manual: null = fechado; index = posição da regra em edição (ou -1 para regra nova).
  const [manual, setManual] = useState<{ index: number; rule: any } | null>(null);

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

  const rules: any[] = settings?.rules || [];
  const setRules = (next: any[]) => change({ ...settings, rules: next });
  // A IA só propõe: a regra entra na lista quando a pessoa clica em adicionar.
  const askRule = async () => {
    const text = ruleText.trim();
    if (!text || drafting) return;
    setDrafting(true);
    setRuleError('');
    setDraft(null);
    const { ok, body } = await api({ action: 'rule_draft', text });
    if (!ok) setRuleError(body.error || 'A IA não respondeu. Tente de novo.');
    else if (!body.rule) setRuleError(body.reason || 'Não consegui montar essa regra.');
    else setDraft(body);
    setDrafting(false);
  };
  const addDraft = () => { setRules([...rules, draft.rule]); setDraft(null); setRuleText(''); };
  const BLANK = { name: '', metric: 'cpa', window: 'd3', op: 'acima', basis: 'pct_venda', value: 80, contains: '', min_cost: '' };
  const setField = (patch: any) => setManual(m => (m ? { ...m, rule: { ...m.rule, ...patch } } : m));
  // A mesma conferência do servidor: o que não couber no formato não entra.
  const manualRule = manual ? sanitizeRule({ ...manual.rule, value: manual.rule.value === '' ? NaN : manual.rule.value }) : null;
  const saveManual = () => {
    if (!manual || !manualRule) return;
    setRules(manual.index >= 0 ? rules.map((r, k) => (k === manual.index ? manualRule : r)) : [...rules, manualRule]);
    setManual(null);
  };

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
                  </div>
                </div>
              </div>
            );
          })}

          {/* ── Regras próprias ── */}
          <div className={`px-5 py-4 border-t ${line}`}>
            <div className={`text-sm font-bold ${head}`}>Suas regras</div>
            <div className={`text-xs ${muted} mb-3`}>
              Escreva do seu jeito o que quer ser avisado. A IA monta a regra e mostra em uma frase; ela só entra na lista quando você adicionar.
              Cada regra avisa uma vez por dia por campanha.
            </div>

            {rules.map((r, i) => (
              <div key={r.id} className="flex items-start gap-3 py-2">
                <Switch on={!!r.on} onClick={() => setRules(rules.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))} label={r.name} />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold ${r.on ? head : muted}`}>{r.name}</div>
                  <div className={`text-xs ${muted}`}>{describeRule(r)}</div>
                </div>
                <button onClick={() => setManual({ index: i, rule: { ...r, min_cost: r.min_cost || '' } })} aria-label={`Editar a regra ${r.name}`} className="p-1.5 rounded text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10"><Pencil size={14} /></button>
                <button onClick={() => setRules(rules.filter((_, k) => k !== i))} aria-label={`Apagar a regra ${r.name}`} className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"><Trash2 size={14} /></button>
              </div>
            ))}

            <div className="mt-2">
              <textarea value={ruleText} onChange={e => setRuleText(e.target.value)} rows={2}
                placeholder="Me avise quando o CPA dos últimos 3 dias passar de 70% do valor da venda nas campanhas BP"
                className={`${field} w-full !py-2 resize-y`} />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button onClick={askRule} disabled={drafting || !ruleText.trim()} className={solid}>
                  {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Montar a regra com a IA
                </button>
                <span className={`text-[11px] ${muted}`}>Dá para pedir CPA, custo, vendas, receita, resultado, retorno, cliques, custo por clique e CTR; em valor fixo ou em % do valor de uma venda ou da meta de CPA.</span>
              </div>
            </div>

            {!manual && (
              <button onClick={() => setManual({ index: -1, rule: BLANK })} className={`mt-2 text-xs font-bold ${muted} hover:text-indigo-400`}>Ou montar a regra na mão</button>
            )}
            {manual && (() => {
              const r = manual.rule;
              const moneyMetric = RULE_METRICS[r.metric as keyof typeof RULE_METRICS]?.money;
              const label = `flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide ${muted}`;
              return (
                <div className={`mt-3 p-3 rounded-lg border ${line}`}>
                  <div className={`text-[11px] uppercase tracking-wider font-extrabold ${muted} mb-2`}>{manual.index >= 0 ? 'Editar a regra' : 'Regra nova, na mão'}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className={label}>Nome da regra
                      <input value={r.name} onChange={e => setField({ name: e.target.value })} maxLength={60} placeholder="CPA alto no BP" className={`${field} font-normal normal-case`} />
                    </label>
                    <label className={label}>Número
                      <select value={r.metric} onChange={e => setField({ metric: e.target.value, ...(RULE_METRICS[e.target.value as keyof typeof RULE_METRICS].money ? {} : { basis: 'valor' }) })} className={`${field} font-normal normal-case`}>
                        {Object.entries(RULE_METRICS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </label>
                    <label className={label}>Período
                      <select value={r.window} onChange={e => setField({ window: e.target.value })} className={`${field} font-normal normal-case`}>
                        {Object.entries(RULE_WINDOWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label className={label}>Avisar quando ficar
                      <select value={r.op} onChange={e => setField({ op: e.target.value })} className={`${field} font-normal normal-case`}>
                        <option value="acima">acima do limite</option>
                        <option value="abaixo">abaixo do limite</option>
                      </select>
                    </label>
                    <label className={label}>Limite
                      <input type="number" inputMode="decimal" step="any" value={r.value} onChange={e => setField({ value: e.target.value === '' ? '' : Number(e.target.value) })} className={`${field} font-normal text-right tabular-nums`} />
                    </label>
                    <label className={label}>O limite é
                      <select value={moneyMetric ? r.basis : 'valor'} disabled={!moneyMetric} onChange={e => setField({ basis: e.target.value })} className={`${field} font-normal normal-case disabled:opacity-60`}>
                        {Object.entries(RULE_BASES).map(([k, v]) => <option key={k} value={k}>{k === 'valor' ? (r.metric === 'roi' || r.metric === 'ctr' ? 'em %' : moneyMetric ? 'valor fixo, na moeda da conta' : 'a quantidade') : v}</option>)}
                      </select>
                    </label>
                    <label className={label}>Só campanhas com este trecho no nome
                      <input value={r.contains} onChange={e => setField({ contains: e.target.value })} maxLength={60} placeholder="vazio = todas" className={`${field} font-normal normal-case`} />
                    </label>
                    <label className={label}>Custo mínimo no período
                      <input type="number" inputMode="decimal" min={0} step="any" value={r.min_cost} onChange={e => setField({ min_cost: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="sem mínimo" className={`${field} font-normal text-right tabular-nums`} />
                    </label>
                  </div>
                  <div className={`text-xs mt-3 ${manualRule ? head : 'text-amber-500'}`}>{manualRule ? describeRule(manualRule) : 'Preencha o limite com um número.'}</div>
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={saveManual} disabled={!manualRule} className={solid}>{manual.index >= 0 ? 'Salvar a regra' : 'Adicionar regra'}</button>
                    <button onClick={() => setManual(null)} className={ghost}>Cancelar</button>
                  </div>
                </div>
              );
            })()}

            {ruleError && <div className="text-xs text-rose-500 mt-2">{ruleError}</div>}
            {draft && (
              <div className={`mt-3 p-3 rounded-lg border ${isDark ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-indigo-200 bg-indigo-50'}`}>
                <div className={`text-[11px] uppercase tracking-wider font-extrabold ${muted}`}>A IA entendeu assim</div>
                <div className={`text-sm font-bold mt-1 ${head}`}>{draft.rule.name}</div>
                <div className={`text-xs ${muted}`}>{draft.description}</div>
                <div className="flex gap-2 mt-2.5">
                  <button onClick={addDraft} className={solid}>Adicionar regra</button>
                  <button onClick={() => setDraft(null)} className={ghost}>Descartar</button>
                </div>
              </div>
            )}
          </div>

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
