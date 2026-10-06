"use client";

import React, { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  MAIN_BLOCK, MAIN_BLOCK_NAME, blockOf, matchesGroup, parseTerms,
  type CampaignGroup, type CampaignGroupsState,
} from '@/lib/campaignGroups';

/**
 * Barra de grupos do painel: marca e desmarca os blocos com um clique e
 * abre a janela de criar ou editar um grupo. A regra de cada grupo está em
 * lib/campaignGroups.
 */

interface Props {
  groups: CampaignGroupsState;
  onChange: (next: CampaignGroupsState) => void;
  /** Nomes das campanhas do usuário, para contar quantas entram em cada grupo. */
  campaignNames: string[];
  isDark: boolean;
}

type Draft = { id: string | null; name: string; terms: string };

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

export function CampaignGroupsBar({ groups, onChange, campaignNames, isDark }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { [MAIN_BLOCK]: 0 };
    groups.list.forEach(g => { c[g.id] = 0; });
    campaignNames.forEach(name => { c[blockOf(name, groups.list)]++; });
    return c;
  }, [campaignNames, groups.list]);

  const draftCount = useMemo(() => {
    if (!draft) return 0;
    const g = { id: '', name: '', terms: parseTerms(draft.terms) };
    return g.terms.length ? campaignNames.filter(n => matchesGroup(n, g)).length : 0;
  }, [draft, campaignNames]);

  const save = () => {
    if (!draft) return;
    const terms = parseTerms(draft.terms);
    const name = draft.name.trim();
    if (!name || !terms.length) return;
    const group: CampaignGroup = { id: draft.id || `g${Date.now().toString(36)}`, name, terms };
    const list = draft.id ? groups.list.map(g => (g.id === draft.id ? group : g)) : [...groups.list, group];
    onChange({ ...groups, list });
    setDraft(null);
  };

  const remove = () => {
    if (!draft?.id) return;
    onChange({ list: groups.list.filter(g => g.id !== draft.id), hidden: groups.hidden.filter(x => x !== draft.id) });
    setDraft(null);
  };

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const muted = 'text-slate-500';
  const head = isDark ? 'text-white' : 'text-slate-900';
  const chipOn = isDark ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-700';
  const chipOff = isDark ? 'border-slate-800 text-slate-500 hover:text-slate-300' : 'border-slate-200 text-slate-400 hover:text-slate-600';
  const field = `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-300 text-slate-900'}`;

  const chip = (id: string, label: string, on: boolean, onClick: () => void, group?: CampaignGroup) => (
    <span key={id} className={`inline-flex items-center rounded-lg border text-xs font-bold transition-colors ${on ? chipOn : chipOff}`}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5">
        <Check size={12} className={on ? '' : 'opacity-0'} />
        <span>{label}</span>
        <span className="opacity-60 font-medium tabular-nums">{counts[id] ?? 0}</span>
      </button>
      {group && (
        <button type="button" title={`Editar o grupo ${group.name}`}
          onClick={() => setDraft({ id: group.id, name: group.name, terms: group.terms.join(', ') })}
          className="pr-2 py-1.5 opacity-50 hover:opacity-100">
          <Pencil size={11} />
        </button>
      )}
    </span>
  );

  return (
    <>
      <div className={`flex items-center gap-2 flex-wrap p-2 rounded-xl border mb-3 ${card}`}>
        <span className={`text-[11px] font-bold uppercase tracking-wide px-1 ${muted}`}>Grupos</span>
        {groups.list.length > 0 && chip(MAIN_BLOCK, MAIN_BLOCK_NAME, !groups.hidden.includes(MAIN_BLOCK), () => onChange({ ...groups, hidden: toggle(groups.hidden, MAIN_BLOCK) }))}
        {groups.list.map(g => chip(g.id, g.name, !groups.hidden.includes(g.id), () => onChange({ ...groups, hidden: toggle(groups.hidden, g.id) }), g))}
        {groups.list.length === 0 && <span className={`text-xs ${muted}`}>Separe as campanhas pelo que está escrito no nome.</span>}
        <button type="button" onClick={() => setDraft({ id: null, name: '', terms: '' })}
          className={`ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
          <Plus size={12} /> Criar grupo
        </button>
      </div>

      {draft && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setDraft(null)}>
          <div className={`w-full max-w-md rounded-2xl border p-5 space-y-4 ${card}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className={`text-base font-bold ${head}`}>{draft.id ? 'Editar grupo' : 'Novo grupo'}</h2>
              <button type="button" onClick={() => setDraft(null)} className={muted}><X size={18} /></button>
            </div>
            <label className="block space-y-1">
              <span className={`text-xs font-bold ${muted}`}>Nome do grupo</span>
              <input autoFocus className={field} value={draft.name} placeholder="Fundo de funil"
                onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className={`text-xs font-bold ${muted}`}>O nome da campanha contém</span>
              <input className={field} value={draft.terms} placeholder="[FF], fundo de funil"
                onChange={e => setDraft({ ...draft, terms: e.target.value })} />
              <span className={`block text-[11px] ${muted}`}>Separe por vírgula. Vale para todas as MCCs e contas.</span>
            </label>
            <div className={`text-sm ${muted}`}>
              {parseTerms(draft.terms).length
                ? `${draftCount} ${draftCount === 1 ? 'campanha entra' : 'campanhas entram'} neste grupo`
                : 'Escreva um trecho do nome para ver quantas campanhas entram.'}
            </div>
            <div className="flex items-center gap-2">
              {draft.id && (
                <button type="button" onClick={remove} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-rose-500 hover:bg-rose-500/10">
                  <Trash2 size={13} /> Apagar grupo
                </button>
              )}
              <div className="flex-1" />
              <button type="button" onClick={() => setDraft(null)} className={`px-3 py-2 rounded-lg text-xs font-bold ${muted}`}>Cancelar</button>
              <button type="button" onClick={save} disabled={!draft.name.trim() || !parseTerms(draft.terms).length}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
                Salvar grupo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
