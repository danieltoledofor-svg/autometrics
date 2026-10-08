"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, EyeOff, Loader2, Plus, Search, X } from 'lucide-react';
import { launchPlan, whereProblems, type Draft } from '@/lib/campaignBuilder/draft';
import { trackedUrl } from '@/lib/campaignBuilder/url';
import type { Css } from './StepCampaign';

/**
 * Passo "Onde subir": cada cartão é uma página com o nome da campanha e as
 * contas que vão recebê-la (escolhidas por MCC). Sai uma campanha por conta
 * marcada no cartão. Só aparecem contas ativas, com as campanhas que já estão
 * rodando em cada uma. A meta de conversão é escolhida conta a conta, porque a
 * lista de metas muda de uma conta para outra; a escolha fica lembrada.
 */

interface Account { id: string; nome: string; mcc: string; ativas: string[] }
type Goals = { list?: { id: string; nome: string }[]; error?: string; loading?: boolean };
const REMEMBER = 'autometrics_criador_metas';
const HIDDEN = 'autometrics_criador_contas_ocultas';
const dashed = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);
const running = (a: Account) => (a.ativas.length ? `${a.ativas.length} ${a.ativas.length === 1 ? 'campanha ativa' : 'campanhas ativas'}` : '');

/** Lista de contas por MCC para um cartão. Fora do passo de propósito: guarda a própria busca sem redesenhar o resto. */
function AccountPicker({ accounts, picked, elsewhere, onToggle, hidden, onHide, css }: {
  accounts: Account[]; picked: Set<string>; elsewhere: Map<string, number>; onToggle: (list: Account[], on: boolean) => void;
  /** Contas que o usuário escondeu à mão (o Google ainda as dá como ativas). */
  hidden: Set<string>; onHide: (id: string, hide: boolean) => void; css: Css;
}) {
  const { isDark, head, muted, line, soft } = css;
  const [filter, setFilter] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const map = new Map<string, Account[]>();
    for (const a of accounts) {
      if (onlyFree && a.ativas.length) continue;
      if (hidden.has(a.id) && !showHidden) continue;
      if (f && !`${a.nome} ${a.mcc} ${a.id} ${dashed(a.id)}`.toLowerCase().includes(f)) continue;
      if (!map.has(a.mcc)) map.set(a.mcc, []);
      map.get(a.mcc)!.push(a);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [accounts, filter, onlyFree, hidden, showHidden]);
  const warn = isDark ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-amber-50 text-amber-800 border-amber-300';
  return (
    <div className={`rounded-lg border ${line} ${soft} p-2.5 space-y-2`}>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${muted}`} />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Nome da MCC, da conta ou o número" aria-label="Procurar MCC ou conta"
            className={`w-full rounded-lg border ${line} ${isDark ? 'bg-slate-900' : 'bg-white'} ${head} pl-9 pr-3 py-1.5 text-[13px] outline-none focus:border-indigo-500`} />
        </div>
        <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${head}`}><input type="checkbox" checked={onlyFree} onChange={e => setOnlyFree(e.target.checked)} /> Só contas sem campanha ativa</label>
        {hidden.size > 0 && <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${head}`}><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} /> Mostrar as {hidden.size} que escondi</label>}
      </div>
      <div className={`max-h-72 overflow-y-auto rounded-lg border ${line} ${isDark ? 'bg-slate-900' : 'bg-white'} divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
        {groups.map(([mcc, list]) => (
          <div key={mcc} className="px-3 py-2">
            <label className={`flex items-center gap-2 text-xs font-bold cursor-pointer ${head}`}>
              <input type="checkbox" checked={list.every(a => picked.has(a.id))} onChange={e => onToggle(list.filter(a => !hidden.has(a.id) || picked.has(a.id)), e.target.checked)} /> {mcc}
              <span className={`font-normal ${muted}`}>· {list.length} {list.length === 1 ? 'conta' : 'contas'} · marcar todas</span>
            </label>
            <div className="mt-1.5 grid md:grid-cols-2 gap-x-4 gap-y-1 pl-5">
              {list.map(a => (
                <div key={a.id} className={`group flex items-center gap-2 text-[13px] ${hidden.has(a.id) ? 'opacity-60' : ''} ${head}`}>
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                    <input type="checkbox" checked={picked.has(a.id)} onChange={e => onToggle([a], e.target.checked)} />
                    <span className="min-w-0 truncate">{a.nome} <span className={`text-xs ${muted}`}>{dashed(a.id)}</span></span>
                  </label>
                  {a.ativas.length > 0 && <span title={`Rodando agora: ${a.ativas.slice(0, 6).join(' · ')}`} className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border ${warn}`}>{running(a)}</span>}
                  {(elsewhere.get(a.id) || 0) > 0 && <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border ${line} ${muted}`}>outra página deste lançamento</span>}
                  <button onClick={() => onHide(a.id, !hidden.has(a.id))} title={hidden.has(a.id) ? 'Voltar a mostrar esta conta' : 'Esconder esta conta da lista (por exemplo, se ela está suspensa)'}
                    className={`shrink-0 text-[11px] inline-flex items-center gap-1 ${muted} hover:text-rose-400 ${hidden.has(a.id) ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
                    <EyeOff size={12} /> {hidden.has(a.id) ? 'mostrar' : 'esconder'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!groups.length && <div className={`px-3 py-3 text-xs ${muted}`}>Nenhuma conta ativa com esse filtro.</div>}
      </div>
    </div>
  );
}

export function StepWhere({ draft, setDraft, css, api, onNext }: {
  draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; css: Css;
  api: (path: string) => Promise<{ ok: boolean; body: any }>; onNext: () => void;
}) {
  const { isDark, card, head, muted, line, soft } = css;
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [hiddenInGoogle, setHiddenInGoogle] = useState(0);
  const [open, setOpen] = useState<number | null>(0);
  const [goals, setGoals] = useState<Record<string, Goals>>({});
  const asked = useRef(new Set<string>());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => { try { setHidden(new Set(JSON.parse(localStorage.getItem(HIDDEN) || '[]'))); } catch { /* sem lembrança */ } }, []);
  const hide = (id: string, on: boolean) => setHidden(h => {
    const next = new Set(h);
    if (on) next.add(id); else next.delete(id);
    try { localStorage.setItem(HIDDEN, JSON.stringify([...next])); } catch { /* sem armazenamento */ }
    return next;
  });
  const problems = whereProblems(draft);
  const plan = launchPlan(draft);
  const byId = useMemo(() => new Map((accounts || []).map(a => [a.id, a])), [accounts]);

  useEffect(() => { api('/api/campaign-builder?contas=1').then(({ body }) => { setAccounts(body.accounts || []); setHiddenInGoogle(Number(body.hidden_in_google) || 0); }); }, [api]);
  // Sempre há pelo menos um cartão para preencher.
  useEffect(() => { if (!draft.paginas.length) setDraft(d => (d.paginas.length ? d : { ...d, paginas: [{ url: '', nome: d.nome, contas: [] }] })); }, [draft.paginas.length, setDraft]);

  // Metas de cada conta usada, uma consulta por conta, uma de cada vez.
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

  /** Muda as páginas e mantém a lista de contas do lançamento igual à união das contas dos cartões. */
  const setPages = (fn: (pages: Draft['paginas']) => Draft['paginas']) => setDraft(d => {
    const paginas = fn(d.paginas);
    const used = new Set(paginas.flatMap(p => p.contas));
    const contas = [...used].map(id => d.contas.find(c => c.id === id) || { id, nome: byId.get(id)?.nome || `Conta ${dashed(id)}`, mcc: byId.get(id)?.mcc || '', meta_id: null, meta_nome: null });
    return { ...d, paginas, contas };
  });
  const toggle = (page: number, list: { id: string }[], on: boolean) => setPages(pages => pages.map((p, i) => {
    if (i !== page) return p;
    const ids = new Set(list.map(a => a.id));
    return { ...p, contas: on ? [...p.contas.filter(c => !ids.has(c)), ...ids] : p.contas.filter(c => !ids.has(c)) };
  }));
  const setGoal = (accountId: string, goalId: string) => {
    const goal = goals[accountId]?.list?.find(g => g.id === goalId) || null;
    setDraft(d => ({ ...d, contas: d.contas.map(c => (c.id === accountId ? { ...c, meta_id: goal?.id || null, meta_nome: goal?.nome || null } : c)) }));
    try { const all = JSON.parse(localStorage.getItem(REMEMBER) || '{}'); if (goal) all[accountId] = goal.id; else delete all[accountId]; localStorage.setItem(REMEMBER, JSON.stringify(all)); } catch { /* sem armazenamento */ }
  };
  const field = `rounded-lg border ${line} ${soft} ${head} px-3 py-2 text-[13px] outline-none focus:border-indigo-500`;
  const needGoal = draft.lance.estrategia === 'MAXIMIZE_CONVERSIONS';
  const chip = isDark ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300' : 'bg-emerald-50 border-emerald-500 text-emerald-800';
  const warn = isDark ? 'text-amber-300' : 'text-amber-700';
  const tracker = draft.rastreador === 'nenhum' ? 'nenhum' : draft.rastreador === 'autometrics' ? 'Autometrics' : 'FlowTracking';

  return (
    <div className="space-y-4">
      <div className={`${card} border rounded-xl p-4 space-y-1`}>
        <div className={`text-sm font-bold ${head}`}>Onde cada campanha vai subir</div>
        <div className={`text-xs ${muted}`}>Cada cartão abaixo é uma página. Em cada um você diz o endereço, o nome da campanha e marca a MCC e as contas que recebem aquela página: sai uma campanha por conta marcada. Todas levam a mesma configuração e o mesmo anúncio. Cole só o endereço da página; o rastreador ({tracker}) entra sozinho.</div>
        <div className={`text-xs ${muted}`}>{accounts ? `${accounts.length} contas que o Google dá como ativas. Não aparecem as suspensas, as canceladas${hiddenInGoogle ? ` nem as ${hiddenInGoogle} que você ocultou na MCC, no Google Ads` : ' nem as que você ocultou na MCC, no Google Ads'}. Para tirar mais alguma daqui, passe o mouse nela e clique em "esconder".` : 'Carregando as contas…'}</div>
      </div>

      {draft.paginas.map((p, i) => {
        const picked = new Set(p.contas);
        const elsewhere = new Map<string, number>();
        draft.paginas.forEach((x, j) => { if (j !== i) for (const c of x.contas) elsewhere.set(c, (elsewhere.get(c) || 0) + 1); });
        return (
          <div key={i} className={`${card} border rounded-xl p-4 space-y-3`}>
            <div className="flex items-center justify-between gap-3">
              <div className={`text-sm font-bold ${head}`}>Página {i + 1} <span className={`text-xs font-normal ${muted}`}>· {p.contas.length ? `${p.contas.length} ${p.contas.length === 1 ? 'campanha' : 'campanhas'}` : 'nenhuma conta escolhida'}</span></div>
              {draft.paginas.length > 1 && <button onClick={() => { setPages(pages => pages.filter((_, j) => j !== i)); setOpen(null); }} className={`text-xs inline-flex items-center gap-1 ${muted} hover:text-rose-400`}><X size={13} /> Tirar esta página</button>}
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              <div><div className={`text-xs ${muted} mb-1`}>Endereço da página</div>
                <input value={p.url} placeholder="https://seusite.com/pagina/" aria-label={`Endereço da página ${i + 1}`} className={`w-full ${field}`} onChange={e => setPages(pages => pages.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} /></div>
              <div><div className={`text-xs ${muted} mb-1`}>Nome da campanha no Google</div>
                <input value={p.nome} placeholder="[WL] SITE - PRODUTO - 08/10" aria-label={`Nome da campanha da página ${i + 1}`} className={`w-full ${field}`} onChange={e => setPages(pages => pages.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} /></div>
            </div>
            {p.url.trim() && draft.rastreador !== 'nenhum' && <div className={`text-[11px] ${muted} break-all`}>Vai ao Google assim: {trackedUrl(p.url, draft.rastreador)}</div>}

            <div>
              <div className={`text-xs ${muted} mb-1.5`}>Contas que recebem esta página</div>
              <div className="flex flex-wrap gap-1.5 items-center">
                {p.contas.map(id => {
                  const a = byId.get(id), c = draft.contas.find(x => x.id === id);
                  return (
                    <span key={id} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${chip}`}>
                      <Check size={12} /> {c?.mcc ? `${c.mcc} › ` : ''}{c?.nome || dashed(id)}
                      {a && a.ativas.length > 0 && <span className={warn} title={`Rodando agora: ${a.ativas.slice(0, 6).join(' · ')}`}>· {running(a)}</span>}
                      <button onClick={() => toggle(i, [{ id }], false)} aria-label={`Tirar a conta ${c?.nome || id}`} className="hover:text-rose-400"><X size={12} /></button>
                    </span>
                  );
                })}
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}
                  className={`text-xs font-bold px-2.5 py-1 rounded border inline-flex items-center gap-1 ${isDark ? 'border-slate-600 text-slate-100 hover:border-indigo-400' : 'border-slate-300 text-slate-800 hover:border-indigo-500'}`}>
                  {open === i ? 'Fechar a lista de contas' : <><Plus size={13} /> Escolher MCC e contas</>}
                </button>
              </div>
            </div>
            {open === i && (accounts
              ? <AccountPicker accounts={accounts} picked={picked} elsewhere={elsewhere} hidden={hidden} onHide={hide} css={css} onToggle={(list, on) => toggle(i, list, on)} />
              : <div className={`text-xs ${muted} flex items-center gap-2`}><Loader2 size={13} className="animate-spin" /> Carregando as contas…</div>)}
          </div>
        );
      })}
      <button onClick={() => { setPages(pages => [...pages, { url: '', nome: draft.nome, contas: [] }]); setOpen(draft.paginas.length); }}
        className={`w-full rounded-xl border border-dashed ${line} py-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 ${muted} hover:text-indigo-400 hover:border-indigo-500`}><Plus size={14} /> Outra página, para outras contas</button>

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
                        className={`rounded-lg border ${!c.meta_id && needGoal ? 'border-amber-500/70' : line} ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'} px-2 py-1.5 text-[13px]`}>
                        <option value="">Escolha a meta</option>
                        {g.list.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                    ) : <span className="text-xs text-amber-500">Esta conta não tem meta personalizada. Crie a meta no Google Ads antes de subir a campanha.</span>}
              </div>
            );
          })}
        </div>
      )}

      {plan.length > 0 && (
        <div className={`${card} border rounded-xl p-4 space-y-2`}>
          <div className={`text-sm font-bold ${head}`}>O que este lançamento cria <span className={`text-xs font-normal ${muted}`}>· {plan.length} {plan.length === 1 ? 'campanha' : 'campanhas'}, todas pausadas</span></div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead><tr className={`text-left text-[11px] uppercase tracking-wide ${muted}`}><th className="py-1.5 pr-3 font-semibold">Campanha</th><th className="py-1.5 pr-3 font-semibold">MCC › conta</th><th className="py-1.5 pr-3 font-semibold">Meta</th><th className="py-1.5 font-semibold">Página</th></tr></thead>
              <tbody>
                {plan.slice(0, 60).map((r, i) => {
                  const a = byId.get(r.conta.id);
                  return (
                    <tr key={i} className={`border-t ${line}`}>
                      <td className={`py-1.5 pr-3 ${head}`}>{r.nome}</td>
                      <td className={`py-1.5 pr-3 ${head}`}>{r.conta.mcc} › {r.conta.nome}{a && a.ativas.length > 0 && <span className={`ml-1.5 text-xs ${warn}`}>· {running(a)}</span>}</td>
                      <td className={`py-1.5 pr-3 ${r.conta.meta_nome ? head : 'text-amber-500'}`}>{r.conta.meta_nome || (needGoal ? 'falta escolher' : 'não usa')}</td>
                      <td className={`py-1.5 ${muted} break-all`}>{r.url.replace(/^https?:\/\//, '')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {plan.length > 60 && <div className={`text-xs ${muted}`}>e mais {plan.length - 60}</div>}
        </div>
      )}

      <div className={`${card} border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="text-xs space-y-0.5">
          {problems.length ? problems.map(p => <div key={p} className="text-amber-500">{p}</div>) : <div className={muted}>Tudo definido. Nada foi enviado ao Google.</div>}
          <div className={muted}>A mesma oferta com os mesmos textos em muitas contas é um dos motivos de suspensão no Google; a escolha de quantas contas usar é sua.</div>
        </div>
        <button onClick={onNext} disabled={problems.length > 0} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">Seguir para a conferência</button>
      </div>
    </div>
  );
}
