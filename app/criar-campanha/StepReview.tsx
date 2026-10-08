"use client";

import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { adProblems, campaignProblems, launchPlan, whereProblems, type Draft } from '@/lib/campaignBuilder/draft';
import type { CreateResult } from '@/lib/campaignBuilder/create';
import type { Css } from './StepCampaign';

/**
 * Passo 5 do criador: conferir e criar. Primeiro o ensaio — o Google confere
 * cada campanha inteira e não cria nada. Depois, com a confirmação do usuário,
 * a criação das que passaram, uma por vez, todas pausadas. Campanha já criada
 * por aqui fica marcada neste navegador para não ser criada duas vezes.
 */

type Api = (path: string, body?: Record<string, any>) => Promise<{ ok: boolean; body: any }>;
type State = { fase: 'ensaiando' | 'criando' } | { fase: 'aceita' | 'recusada' | 'criada' | 'falhou'; result: CreateResult };
const CREATED = 'autometrics_criador_criadas';
const dashed = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

export function StepReview({ draft, css, api, goTo }: { draft: Draft; css: Css; api: Api; goTo: (step: number) => void }) {
  const { isDark, card, head, muted, line, soft } = css;
  const plan = launchPlan(draft);
  const keyOf = (r: (typeof plan)[number]) => `${r.conta.id}|${r.nome.toLowerCase()}`;
  const [states, setStates] = useState<Record<string, State>>({});
  const [created, setCreated] = useState<Record<string, string>>({});       // chave → número da campanha no Google
  const [running, setRunning] = useState<'' | 'ensaio' | 'criar'>('');
  const [agreed, setAgreed] = useState(false);

  useEffect(() => { try { setCreated(JSON.parse(localStorage.getItem(CREATED) || '{}')); } catch { /* sem lembrança */ } }, []);
  // Mudou o rascunho depois do ensaio: o ensaio deixa de valer.
  const signature = JSON.stringify({ ...draft, sugestoes: null, ia: null });
  useEffect(() => { setStates({}); setAgreed(false); }, [signature]);

  const blocking = [...campaignProblems(draft).map(p => ['Campanha', 1, p] as const), ...adProblems(draft).map(p => ['Anúncio', 2, p] as const), ...whereProblems(draft).map(p => ['Onde subir', 3, p] as const)];
  const pending = plan.filter(r => !created[keyOf(r)]);
  const accepted = pending.filter(r => states[keyOf(r)]?.fase === 'aceita');
  const set = (k: string, s: State) => setStates(x => ({ ...x, [k]: s }));

  const send = async (r: (typeof plan)[number], ensaio: boolean): Promise<CreateResult> => {
    const { body } = await api('/api/campaign-builder', { action: 'criar', ensaio, draft: { ...draft, sugestoes: null }, linha: { url: r.url, nome: r.nome, conta_id: r.conta.id, meta_id: r.conta.meta_id } });
    return body.result || { ok: false, ensaio, campanha_id: null, problemas: [{ onde: 'pedido', texto: body.error || 'O servidor não respondeu.' }], avisos: [], calls: 0, itens: 0 };
  };
  const rehearse = async () => {
    setRunning('ensaio');
    for (const r of pending) {
      const k = keyOf(r);
      set(k, { fase: 'ensaiando' });
      const result = await send(r, true);
      set(k, { fase: result.ok ? 'aceita' : 'recusada', result });
    }
    setRunning('');
  };
  const create = async () => {
    setRunning('criar');
    for (const r of accepted) {
      const k = keyOf(r);
      set(k, { fase: 'criando' });
      const result = await send(r, false);
      set(k, { fase: result.ok ? 'criada' : 'falhou', result });
      if (result.ok) setCreated(c => { const next = { ...c, [k]: result.campanha_id || 'criada' }; try { localStorage.setItem(CREATED, JSON.stringify(next)); } catch { /* sem armazenamento */ } return next; });
    }
    setRunning('');
    setAgreed(false);
  };

  const good = isDark ? 'text-emerald-400' : 'text-emerald-700', bad = isDark ? 'text-rose-400' : 'text-rose-600', warn = isDark ? 'text-amber-300' : 'text-amber-700';
  const solid = 'bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-2';
  const items = Object.values(states).map(s => ('result' in s ? s.result.itens : 0)).find(n => n > 0) || 0;

  if (blocking.length) {
    return (
      <div className={`${card} border rounded-xl p-4 space-y-2`}>
        <div className={`text-sm font-bold ${head}`}>Falta completar antes de conferir</div>
        {blocking.map(([where, step, text], i) => (
          <div key={i} className="text-xs text-amber-500">{where}: {text} <button onClick={() => goTo(step)} className="text-indigo-400 hover:underline">ir para lá</button></div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${card} border rounded-xl p-4 space-y-2`}>
        <div className={`text-sm font-bold ${head}`}>Como funciona</div>
        <ol className={`text-xs ${muted} list-decimal pl-5 space-y-1`}>
          <li><b className={head}>Ensaiar no Google</b>: o Google confere cada campanha inteira (orçamento, lance, locais, palavras-chave, anúncio, sitelinks e frases) e diz se aceita. <b className={head}>Nada é criado.</b></li>
          <li><b className={head}>Criar</b>: só as que passaram no ensaio, uma conta por vez. Cada campanha entra inteira ou não entra; se o Google recusar no meio, nada dela fica para trás.</li>
          <li>Toda campanha nasce <b className={head}>pausada</b>, com grupos e anúncio prontos. Você ativa no Google Ads quando quiser. Ela aparece no Autometrics na coleta seguinte, em até uma hora.</li>
        </ol>
        <div className={`text-xs ${muted}`}>O ensaio confere formato e regras; a análise de política dos anúncios o Google só faz depois de criar.</div>
      </div>

      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        <div className={`text-sm font-bold ${head}`}>{plan.length} {plan.length === 1 ? 'campanha' : 'campanhas'} neste lançamento</div>
        {plan.map((r, i) => {
          const k = keyOf(r), s = states[k], done = created[k];
          return (
            <div key={i} className={`rounded-lg border ${line} ${soft} p-3 space-y-1.5`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className={`text-[13px] font-bold ${head}`}>{r.nome}</div>
                <div className="text-xs font-bold inline-flex items-center gap-1.5">
                  {done ? <span className={good}><Check size={13} className="inline" /> criada, pausada{done !== 'criada' ? ` · nº ${done}` : ''}</span>
                    : !s ? <span className={muted}>ainda não ensaiada</span>
                      : s.fase === 'ensaiando' ? <span className={muted}><Loader2 size={12} className="inline animate-spin" /> ensaiando…</span>
                        : s.fase === 'criando' ? <span className={muted}><Loader2 size={12} className="inline animate-spin" /> criando…</span>
                          : s.fase === 'aceita' ? <span className={good}><Check size={13} className="inline" /> o Google aceita</span>
                            : <span className={bad}><X size={13} className="inline" /> {s.fase === 'recusada' ? 'recusada no ensaio' : 'não foi criada'}</span>}
                </div>
              </div>
              <div className={`text-xs ${muted} break-all`}>{r.conta.mcc} › {r.conta.nome} ({dashed(r.conta.id)}) · meta {r.conta.meta_nome || 'não usa'} · {r.url.replace(/^https?:\/\//, '')}</div>
              {s && 'result' in s && s.result.problemas.map((p, j) => <div key={j} className={`text-xs ${bad}`}><b>{p.onde}:</b> {p.texto}</div>)}
              {s && 'result' in s && s.result.avisos.map((a, j) => <div key={j} className={`text-xs ${warn}`}>{a}</div>)}
            </div>
          );
        })}
      </div>

      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        {pending.length === 0 ? (
          <div className={`text-sm ${good} font-bold`}>Todas as campanhas deste lançamento já foram criadas e estão pausadas no Google Ads.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={rehearse} disabled={running !== ''} className={`px-4 py-2 rounded-lg border text-xs font-bold inline-flex items-center gap-2 disabled:opacity-40 ${isDark ? 'border-slate-600 text-slate-100 hover:border-indigo-400' : 'border-slate-300 text-slate-800 hover:border-indigo-500'}`}>
                {running === 'ensaio' && <Loader2 size={13} className="animate-spin" />} 1. Ensaiar no Google ({pending.length})
              </button>
              <span className={`text-xs ${muted}`}>{accepted.length ? `${accepted.length} de ${pending.length} aceitas.` : 'Não cria nada.'}{items ? ` Cada campanha leva ${items} itens; o ensaio e a criação contam na cota diária do Google.` : ''}</span>
            </div>
            {accepted.length > 0 && (
              <div className={`rounded-lg border ${isDark ? 'border-amber-500/40 bg-amber-500/5' : 'border-amber-300 bg-amber-50'} p-3 space-y-2`}>
                <label className={`flex items-start gap-2 text-[13px] cursor-pointer ${head}`}>
                  <input type="checkbox" className="mt-0.5" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                  <span>Entendi: isto cria {accepted.length} {accepted.length === 1 ? 'campanha de verdade' : 'campanhas de verdade'} nas contas acima, todas pausadas. Não dá para desfazer por aqui; para apagar, é no Google Ads.</span>
                </label>
                <button onClick={create} disabled={!agreed || running !== ''} className={solid}>{running === 'criar' && <Loader2 size={13} className="animate-spin" />} 2. Criar {accepted.length === 1 ? 'a campanha aceita' : `as ${accepted.length} aceitas`}, pausadas</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
