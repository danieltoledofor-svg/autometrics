"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { whereProblems, type Draft } from '@/lib/campaignBuilder/draft';
import { trackedUrl } from '@/lib/campaignBuilder/url';
import type { Css } from './StepCampaign';

/**
 * Passo "Onde subir": as páginas deste lançamento e as contas (agrupadas por
 * MCC) que vão receber as campanhas. Sai uma campanha por página em cada conta.
 * A meta de conversão é escolhida conta a conta, porque a lista de metas muda
 * de uma conta para outra; a escolha fica lembrada neste navegador.
 */

interface Account { id: string; nome: string; mcc: string; status: string }
type Goals = { list?: { id: string; nome: string }[]; error?: string; loading?: boolean };
const REMEMBER = 'autometrics_criador_metas';
const dashed = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

export function StepWhere({ draft, setDraft, css, api, onNext }: {
  draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; css: Css;
  api: (path: string) => Promise<{ ok: boolean; body: any }>; onNext: () => void;
}) {
  const { isDark, card, head, muted, line, soft, label } = css;
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [filter, setFilter] = useState('');
  const [goals, setGoals] = useState<Record<string, Goals>>({});
  const asked = useRef(new Set<string>());
  const problems = whereProblems(draft);

  useEffect(() => { api('/api/campaign-builder?contas=1').then(({ body }) => setAccounts(body.accounts || [])); }, [api]);

  // Metas de cada conta escolhida, uma consulta por conta, uma de cada vez.
  useEffect(() => {
    const next = draft.contas.find(c => !asked.current.has(c.id));
    if (!next) return;
    asked.current.add(next.id);
    setGoals(g => ({ ...g, [next.id]: { loading: true } }));
    api(`/api/campaign-builder?metas=${next.id}`).then(({ ok, body }) => {
      const list: { id: string; nome: string }[] = ok ? body.goals || [] : [];
      setGoals(g => ({ ...g, [next.id]: ok ? { list } : { error: body.error || 'O Google não respondeu.' } }));
      // Volta a meta usada da última vez nesta conta, se ela ainda existir.
      let remembered: string | null = null;
      try { remembered = JSON.parse(localStorage.getItem(REMEMBER) || '{}')[next.id] || null; } catch { /* sem lembrança */ }
      const hit = list.find(x => x.id === remembered) || (list.length === 1 ? list[0] : null);
      if (hit) setDraft(d => ({ ...d, contas: d.contas.map(c => (c.id === next.id && !c.meta_id ? { ...c, meta_id: hit.id, meta_nome: hit.nome } : c)) }));
    });
  }, [draft.contas, api, setDraft]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const map = new Map<string, Account[]>();
    for (const a of accounts || []) {
      if (f && !`${a.nome} ${a.mcc} ${a.id} ${dashed(a.id)}`.toLowerCase().includes(f)) continue;
      if (!map.has(a.mcc)) map.set(a.mcc, []);
      map.get(a.mcc)!.push(a);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [accounts, filter]);

  const picked = new Set(draft.contas.map(c => c.id));
  const toggle = (list: Account[], on: boolean) => setDraft(d => {
    const ids = new Set(list.map(a => a.id));
    const rest = d.contas.filter(c => !ids.has(c.id));
    return { ...d, contas: on ? [...rest, ...list.map(a => d.contas.find(c => c.id === a.id) || { id: a.id, nome: a.nome, mcc: a.mcc, meta_id: null, meta_nome: null })] : rest };
  });
  const setGoal = (accountId: string, goalId: string) => {
    const goal = goals[accountId]?.list?.find(g => g.id === goalId) || null;
    setDraft(d => ({ ...d, contas: d.contas.map(c => (c.id === accountId ? { ...c, meta_id: goal?.id || null, meta_nome: goal?.nome || null } : c)) }));
    try { const all = JSON.parse(localStorage.getItem(REMEMBER) || '{}'); if (goal) all[accountId] = goal.id; else delete all[accountId]; localStorage.setItem(REMEMBER, JSON.stringify(all)); } catch { /* sem armazenamento */ }
  };
  const setPage = (i: number, patch: Partial<Draft['paginas'][number]>) => setDraft(d => ({ ...d, paginas: d.paginas.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const pages = draft.paginas.length ? draft.paginas : [{ url: '', nome: draft.nome }];
  const total = draft.paginas.filter(p => p.url.trim()).length * draft.contas.length;
  const field = `rounded-lg border ${line} ${soft} ${head} px-3 py-2 text-[13px] outline-none focus:border-indigo-500`;
  const needGoal = draft.lance.estrategia === 'MAXIMIZE_CONVERSIONS';

  return (
    <div className="space-y-4">
      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        <div>
          <div className={`text-sm font-bold ${head}`}>Páginas deste lançamento</div>
          <div className={`text-xs ${muted} mt-0.5`}>Uma campanha por página em cada conta escolhida, todas com a mesma configuração e os mesmos anúncios. Cole só o endereço da página; o rastreador ({draft.rastreador === 'nenhum' ? 'nenhum' : draft.rastreador === 'autometrics' ? 'Autometrics' : 'FlowTracking'}) entra sozinho.</div>
        </div>
        {pages.map((p, i) => (
          <div key={i} className={`rounded-lg border ${line} p-3 space-y-2`}>
            <div className="flex gap-2">
              <input value={p.url} placeholder="https://seusite.com/pagina/" aria-label={`Página ${i + 1}`} className={`flex-1 ${field}`}
                onChange={e => (draft.paginas.length ? setPage(i, { url: e.target.value }) : setDraft(d => ({ ...d, paginas: [{ url: e.target.value, nome: d.nome }] })))} />
              {draft.paginas.length > 1 && <button onClick={() => setDraft(d => ({ ...d, paginas: d.paginas.filter((_, j) => j !== i) }))} aria-label={`Remover a página ${i + 1}`} className={`${muted} hover:text-rose-400`}><X size={15} /></button>}
            </div>
            <input value={p.nome} placeholder="Nome da campanha desta página" aria-label={`Nome da campanha da página ${i + 1}`} className={`w-full ${field}`}
              onChange={e => (draft.paginas.length ? setPage(i, { nome: e.target.value }) : setDraft(d => ({ ...d, paginas: [{ url: '', nome: e.target.value }] })))} />
            {p.url.trim() && draft.rastreador !== 'nenhum' && <div className={`text-[11px] ${muted} break-all`}>Vai ao Google assim: {trackedUrl(p.url, draft.rastreador)}</div>}
          </div>
        ))}
        <button onClick={() => setDraft(d => ({ ...d, paginas: [...(d.paginas.length ? d.paginas : [{ url: '', nome: d.nome }]), { url: '', nome: d.nome }] }))} className={`text-xs font-bold inline-flex items-center gap-1 ${muted} hover:text-indigo-400`}><Plus size={13} /> Outra página</button>
      </div>

      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          <div className={`text-sm font-bold ${head}`}>Contas onde subir</div>
          <div className={`text-xs ${muted}`}>{accounts ? `${accounts.length} contas ligadas · ${draft.contas.length} escolhidas` : 'carregando…'}</div>
        </div>
        <div className="relative">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${muted}`} />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Nome da conta, da MCC ou o número" aria-label="Procurar conta" className={`w-full pl-9 ${field}`} />
        </div>
        <div className={`max-h-80 overflow-y-auto rounded-lg border ${line} divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
          {groups.map(([mcc, list]) => {
            const all = list.every(a => picked.has(a.id));
            return (
              <div key={mcc} className="px-3 py-2">
                <label className={`flex items-center gap-2 text-xs font-bold cursor-pointer ${head}`}>
                  <input type="checkbox" checked={all} onChange={e => toggle(list, e.target.checked)} /> {mcc} <span className={`font-normal ${muted}`}>· {list.length} {list.length === 1 ? 'conta' : 'contas'}</span>
                </label>
                <div className="mt-1.5 grid md:grid-cols-2 gap-x-4 gap-y-1 pl-5">
                  {list.map(a => (
                    <label key={a.id} className={`flex items-center gap-2 text-[13px] cursor-pointer ${head}`}>
                      <input type="checkbox" checked={picked.has(a.id)} onChange={e => toggle([a], e.target.checked)} />
                      <span className="truncate">{a.nome} <span className={`text-xs ${muted}`}>{dashed(a.id)}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {accounts && !groups.length && <div className={`px-3 py-3 text-xs ${muted}`}>Nenhuma conta com esse nome.</div>}
          {!accounts && <div className={`px-3 py-3 text-xs ${muted} flex items-center gap-2`}><Loader2 size={13} className="animate-spin" /> Carregando as contas…</div>}
        </div>
      </div>

      {draft.contas.length > 0 && (
        <div className={`${card} border rounded-xl p-4 space-y-3`}>
          <div>
            <div className={`text-sm font-bold ${head}`}>Meta de conversão de cada conta</div>
            <div className={`text-xs ${muted} mt-0.5`}>As metas são as que cada conta enxerga no Google (da MCC, ou da própria conta). A escolha fica lembrada para a próxima vez.</div>
          </div>
          {draft.contas.map(c => {
            const g = goals[c.id];
            return (
              <div key={c.id} className={`flex flex-wrap items-center gap-2 py-1.5 border-t ${line} text-[13px]`}>
                <div className="flex-1 min-w-[200px]"><span className={head}>{c.nome}</span> <span className={`text-xs ${muted}`}>· {c.mcc} · {dashed(c.id)}</span></div>
                {g?.loading || !g ? <span className={`text-xs ${muted} inline-flex items-center gap-1.5`}><Loader2 size={12} className="animate-spin" /> lendo as metas…</span>
                  : g.error ? <span className="text-xs text-rose-500 max-w-[320px]">{g.error}</span>
                    : g.list?.length ? (
                      <select value={c.meta_id || ''} onChange={e => setGoal(c.id, e.target.value)} aria-label={`Meta de conversão de ${c.nome}`}
                        className={`rounded-lg border ${!c.meta_id && needGoal ? 'border-amber-500/60' : line} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'} px-2 py-1.5 text-[13px]`}>
                        <option value="">Escolha a meta</option>
                        {g.list.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                    ) : <span className="text-xs text-amber-500">Esta conta não tem meta personalizada. Crie a meta no Google Ads antes de subir a campanha.</span>}
                <button onClick={() => toggle([{ id: c.id, nome: c.nome, mcc: c.mcc, status: '' }], false)} aria-label={`Tirar a conta ${c.nome}`} className={`${muted} hover:text-rose-400`}><X size={15} /></button>
              </div>
            );
          })}
        </div>
      )}

      <div className={`${card} border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="text-xs space-y-0.5">
          {problems.length ? problems.map(p => <div key={p} className="text-amber-500">{p}</div>)
            : <div className={muted}>{total} {total === 1 ? 'campanha' : 'campanhas'} neste lançamento ({draft.paginas.filter(p => p.url.trim()).length} × {draft.contas.length}). Todas nascem pausadas. Nada foi enviado ao Google.</div>}
          <div className={`${label} !normal-case !tracking-normal !font-normal`}>A mesma oferta com os mesmos textos em muitas contas é um dos motivos de suspensão no Google; a escolha de quantas contas usar é sua.</div>
        </div>
        <button onClick={onNext} disabled={problems.length > 0} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">Seguir para a conferência</button>
      </div>
    </div>
  );
}
