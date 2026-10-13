"use client";

import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { adProblems, campaignProblems, launchPlan, whereProblems, type Draft } from '@/lib/campaignBuilder/draft';
import type { CreateResult } from '@/lib/campaignBuilder/create';
import type { Css } from './StepCampaign';

/**
 * Passo 5 do criador: conferir e criar. Primeiro o ensaio — o Google confere
 * cada campanha inteira e não cria nada. O que ele recusar aparece explicado
 * (o que é e como corrigir), e palavra-chave recusada pode ser tirada daqui
 * mesmo. Depois, com a confirmação do usuário, a criação das que passaram, uma
 * por vez, já ativas. Campanha já criada por aqui fica marcada neste navegador
 * para não ser criada duas vezes.
 */

type Api = (path: string, body?: Record<string, any>) => Promise<{ ok: boolean; body: any }>;
type State = { fase: 'ensaiando' | 'criando' } | { fase: 'aceita' | 'recusada' | 'criada' | 'falhou'; result: CreateResult };
const CREATED = 'autometrics_criador_criadas';
const dashed = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

export function StepReview({ draft, setDraft, css, api, goTo }: { draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; css: Css; api: Api; goTo: (step: number) => void }) {
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
  const [stale, setStale] = useState(false);
  useEffect(() => { setStates(x => { if (Object.keys(x).length) setStale(true); return {}; }); setAgreed(false); }, [signature]);

  const blocking = [...campaignProblems(draft).map(p => ['Campanha', 1, p] as const), ...adProblems(draft).map(p => ['Anúncio', 2, p] as const), ...whereProblems(draft).map(p => ['Onde subir', 3, p] as const)];
  const pending = plan.filter(r => !created[keyOf(r)]);
  const accepted = pending.filter(r => states[keyOf(r)]?.fase === 'aceita');
  const set = (k: string, s: State) => setStates(x => ({ ...x, [k]: s }));

  const send = async (r: (typeof plan)[number], ensaio: boolean): Promise<CreateResult> => {
    const { body } = await api('/api/campaign-builder', { action: 'criar', ensaio, draft: { ...draft, sugestoes: null }, linha: { url: r.url, nome: r.nome, conta_id: r.conta.id, meta_id: r.conta.meta_id } });
    return body.result || { ok: false, ensaio, campanha_id: null, situacao: null, problemas: [{ onde: 'pedido', texto: body.error || 'O servidor não respondeu.' }], avisos: [], calls: 0, itens: 0 };
  };
  const rehearse = async () => {
    setRunning('ensaio'); setStale(false);
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
      if (result.ok) setCreated(c => { const next = { ...c, [k]: `${result.campanha_id || 'criada'}${result.situacao === 'PAUSED' ? '|pausada' : '|ativa'}` }; try { localStorage.setItem(CREATED, JSON.stringify(next)); } catch { /* sem armazenamento */ } return next; });
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
          <li>Toda campanha já nasce <b className={head}>ativa</b>, com grupos e anúncio prontos: pode começar a gastar assim que o Google aprovar o anúncio. Só fica pausada se a meta de conversão não puder ser aplicada, e a tela avisa. Ela aparece no Autometrics na coleta seguinte, em até uma hora.</li>
        </ol>
        <div className={`text-xs ${muted}`}>O ensaio confere formato, regras e as palavras-chave; a análise de política dos anúncios o Google só termina depois de criar. O que ele recusar aparece abaixo, com o motivo e como corrigir.</div>
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
                  {done ? <span className={done.endsWith('|pausada') ? warn : good}><Check size={13} className="inline" /> criada{done.endsWith('|pausada') ? ', mas pausada' : done.endsWith('|ativa') ? ', ativa' : ''}{/^\d/.test(done) ? ` · nº ${done.split('|')[0]}` : ''}</span>
                    : !s ? <span className={muted}>ainda não ensaiada</span>
                      : s.fase === 'ensaiando' ? <span className={muted}><Loader2 size={12} className="inline animate-spin" /> ensaiando…</span>
                        : s.fase === 'criando' ? <span className={muted}><Loader2 size={12} className="inline animate-spin" /> criando…</span>
                          : s.fase === 'aceita' ? <span className={good}><Check size={13} className="inline" /> o Google aceita</span>
                            : <span className={bad}><X size={13} className="inline" /> {s.fase === 'recusada' ? 'recusada no ensaio' : 'não foi criada'}</span>}
                </div>
              </div>
              <div className={`text-xs ${muted} break-all`}>{r.conta.mcc} › {r.conta.nome} ({dashed(r.conta.id)}) · meta {r.conta.meta_nome || 'não usa'} · {r.url.replace(/^https?:\/\//, '')}</div>
              {s && 'result' in s && s.result.problemas.map((p, j) => (
                <div key={j} className={`rounded-lg border ${isDark ? 'border-rose-500/40 bg-rose-500/5' : 'border-rose-300 bg-rose-50'} px-3 py-2 text-xs space-y-1`}>
                  <div className={`font-bold ${bad}`}>{p.onde}</div>
                  <div className={head}>{p.texto}</div>
                  {p.corrigir && <div className={head}><b>Como corrigir:</b> {p.corrigir}</div>}
                  {!p.corrigir && p.google && <div className={muted}>Resposta do Google: {p.google}</div>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {p.palavra && draft.palavras.some(k => k.texto === p.palavra!.texto && k.tipo === p.palavra!.tipo) && (
                      <button onClick={() => setDraft(d => ({ ...d, palavras: d.palavras.filter(k => !(k.texto === p.palavra!.texto && k.tipo === p.palavra!.tipo)) }))} disabled={running !== ''}
                        className={`font-bold px-2 py-1 rounded border ${line} ${head} hover:border-rose-500 disabled:opacity-40`}>Tirar esta palavra-chave da campanha</button>
                    )}
                    {p.palavra && <button onClick={() => goTo(2)} className="text-indigo-400 hover:underline">editar no passo Anúncio</button>}
                    {p.codigo && <span className={muted}>código do Google: {p.codigo}</span>}
                  </div>
                </div>
              ))}
              {(() => {
                // Várias palavras-chave recusadas de uma vez: um botão tira todas, porque tirar uma já pede novo ensaio.
                const refused = s && 'result' in s ? s.result.problemas.map(p => p.palavra).filter((w): w is { texto: string; tipo: string } => !!w && draft.palavras.some(k => k.texto === w.texto && k.tipo === w.tipo)) : [];
                return refused.length > 1 && (
                  <button onClick={() => setDraft(d => ({ ...d, palavras: d.palavras.filter(k => !refused.some(w => w.texto === k.texto && w.tipo === k.tipo)) }))} disabled={running !== ''}
                    className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border ${line} ${head} hover:border-rose-500 disabled:opacity-40`}>Tirar as {refused.length} palavras-chave recusadas</button>
                );
              })()}
              {s && 'result' in s && s.result.avisos.map((a, j) => <div key={j} className={`text-xs ${warn}`}>{a}</div>)}
            </div>
          );
        })}
      </div>

      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        {pending.length === 0 ? (
          <div className={`text-sm ${good} font-bold`}>Todas as campanhas deste lançamento já foram criadas no Google Ads.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={rehearse} disabled={running !== ''} className={`px-4 py-2 rounded-lg border text-xs font-bold inline-flex items-center gap-2 disabled:opacity-40 ${isDark ? 'border-slate-600 text-slate-100 hover:border-indigo-400' : 'border-slate-300 text-slate-800 hover:border-indigo-500'}`}>
                {running === 'ensaio' && <Loader2 size={13} className="animate-spin" />} 1. Ensaiar no Google ({pending.length})
              </button>
              <span className={`text-xs ${stale ? warn : muted}`}>{stale ? 'O rascunho mudou depois do último ensaio: ensaie de novo. ' : ''}{accepted.length ? `${accepted.length} de ${pending.length} aceitas.` : 'Não cria nada.'}{items ? ` Cada campanha leva ${items} itens; o ensaio e a criação contam na cota diária do Google.` : ''}</span>
            </div>
            {accepted.length > 0 && (
              <div className={`rounded-lg border ${isDark ? 'border-amber-500/40 bg-amber-500/5' : 'border-amber-300 bg-amber-50'} p-3 space-y-2`}>
                <label className={`flex items-start gap-2 text-[13px] cursor-pointer ${head}`}>
                  <input type="checkbox" className="mt-0.5" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                  <span>Entendi: isto cria {accepted.length} {accepted.length === 1 ? 'campanha de verdade' : 'campanhas de verdade'} nas contas acima, e elas já nascem ATIVAS: começam a gastar assim que o Google aprovar os anúncios. Não dá para desfazer por aqui; para pausar ou apagar, é no Google Ads ou na tela de Campanhas.</span>
                </label>
                <button onClick={create} disabled={!agreed || running !== ''} className={solid}>{running === 'criar' && <Loader2 size={13} className="animate-spin" />} 2. Criar {accepted.length === 1 ? 'a campanha aceita' : `as ${accepted.length} aceitas`}, já ativas</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
