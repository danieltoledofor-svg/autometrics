"use client";

import React, { useState } from 'react';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { LANGUAGES, campaignProblems, type Draft } from '@/lib/campaignBuilder/draft';
import { TRACKERS } from '@/lib/campaignBuilder/url';

/**
 * Passo 2 do criador: a configuração da campanha. Funil, lance, orçamento,
 * redes, locais (incluir e excluir), quem conta como no local, idiomas, IA Max
 * (desligada por padrão), ajuste por aparelho, grupos com meta de CPA própria,
 * negativas e o rastreador da URL. Nada aqui vai ao Google ainda.
 */

export interface Css { isDark: boolean; card: string; head: string; muted: string; line: string; soft: string; label: string }
const DEVICE: Record<string, string> = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet' };
const PLACE: Record<string, string> = { Country: 'país', State: 'estado', Province: 'província', Region: 'região', City: 'cidade', County: 'condado', 'Postal Code': 'CEP', DMA: 'região de mídia' };

const toNumber = (text: string) => { const v = Number(String(text).replace(',', '.')); return text.trim() === '' || !Number.isFinite(v) ? null : v; };

/** Fora do componente de propósito: definido lá dentro, cada letra digitada recriaria o bloco e o campo perderia o cursor. */
function Block({ title, hint, css, children }: { title: string; hint?: string; css: Css; children: React.ReactNode }) {
  return (
    <div className={`${css.card} border rounded-xl p-4 space-y-3`}>
      <div><div className={`text-sm font-bold ${css.head}`}>{title}</div>{hint && <div className={`text-xs ${css.muted} mt-0.5`}>{hint}</div>}</div>
      {children}
    </div>
  );
}

/** Campo de número que aceita vírgula e fica em branco quando não há valor. */
function NumberField({ value, onChange, css, width = 'w-28', placeholder, label }: { value: number | null; onChange: (v: number | null) => void; css: Css; width?: string; placeholder?: string; label: string }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value).replace('.', ','));
  return (
    <input value={text} inputMode="decimal" placeholder={placeholder} aria-label={label}
      onChange={e => { setText(e.target.value); onChange(toNumber(e.target.value)); }}
      className={`${width} rounded-lg border ${css.line} ${css.soft} ${css.head} px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none focus:border-indigo-500`} />
  );
}

export function StepCampaign({ draft, setDraft, symbol, css, findPlaces, onNext }: {
  draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; symbol: string; css: Css;
  findPlaces: (text: string) => Promise<{ places?: { id: string; nome: string; tipo: string }[]; error?: string }>; onNext: () => void;
}) {
  const { isDark, card, head, muted, line, soft, label } = css;
  const [placeText, setPlaceText] = useState('');
  const [places, setPlaces] = useState<{ id: string; nome: string; tipo: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [negatives, setNegatives] = useState('');
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const problems = campaignProblems(draft);

  const search = async () => {
    if (placeText.trim().length < 2) return;
    setSearching(true); setPlaceError('');
    const res = await findPlaces(placeText.trim());
    setPlaces(res.places || []);
    setPlaceError(res.error || (res.places?.length ? '' : 'Nenhum local com esse nome.'));
    setSearching(false);
  };
  const addPlace = (p: { id: string; nome: string }, excluido: boolean) => {
    setDraft(d => ({ ...d, locais: [...d.locais.filter(l => l.id !== p.id), { id: p.id, nome: p.nome, excluido, ajuste: 0 }] }));
    setPlaces([]); setPlaceText('');
  };
  const addNegatives = () => {
    const list = negatives.split(/[\n,]/).map(x => x.trim()).filter(Boolean).map(raw => {
      const exact = raw.match(/^\[(.+)\]$/), phrase = raw.match(/^"(.+)"$/);
      return { texto: (exact?.[1] || phrase?.[1] || raw).trim(), tipo: exact ? 'EXACT' : phrase ? 'PHRASE' : 'BROAD' };
    });
    setDraft(d => {
      const seen = new Set(d.negativas.map(n => `${n.texto.toLowerCase()}|${n.tipo}`));
      return { ...d, negativas: [...d.negativas, ...list.filter(n => !seen.has(`${n.texto.toLowerCase()}|${n.tipo}`))] };
    });
    setNegatives('');
  };

  const choice = (on: boolean) => `px-3 py-1.5 text-xs font-semibold rounded-lg border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : `${line} ${muted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}`;
  const check = (on: boolean, text: string, onChange: (v: boolean) => void, disabled = false) => (
    <label className={`flex items-start gap-2 text-[13px] ${disabled ? 'opacity-50' : 'cursor-pointer'} ${head}`}>
      <input type="checkbox" className="mt-0.5" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} /> <span>{text}</span>
    </label>
  );
  const keyword = (k: { texto: string; tipo: string }) => (k.tipo === 'EXACT' ? `[${k.texto}]` : k.tipo === 'PHRASE' ? `"${k.texto}"` : k.texto);
  const included = draft.locais.filter(l => !l.excluido), excluded = draft.locais.filter(l => l.excluido);

  return (
    <div className="space-y-4">
      <Block css={css} title="Tipo e nome" hint={draft.origem ? `Copiado de ${draft.origem}. O nome de cada campanha é ajustado no passo "Onde subir".` : 'Campanha nova, do zero.'}>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => set({ funil: 'topo' })} className={choice(draft.funil === 'topo')}>Topo de funil</button>
          <button onClick={() => set({ funil: 'fundo' })} className={choice(draft.funil === 'fundo')}>Fundo de funil</button>
          <span className={`text-xs ${muted}`}>{draft.funil === 'fundo' ? 'Quem busca já conhece o produto: recursos com preço, garantia, frete e site oficial.' : 'Quem busca ainda não conhece o produto: recursos pelo assunto buscado, até a página e a VSL.'}</span>
        </div>
        <input value={draft.nome} onChange={e => set({ nome: e.target.value })} placeholder="[WL] SITE - PRODUTO - 08/10" aria-label="Nome da campanha"
          className={`w-full rounded-lg border ${line} ${soft} ${head} px-3 py-2 text-[13px] outline-none focus:border-indigo-500`} />
      </Block>

      <Block css={css} title="Lance e orçamento">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => set({ lance: { ...draft.lance, estrategia: 'MAXIMIZE_CONVERSIONS' } })} className={choice(draft.lance.estrategia === 'MAXIMIZE_CONVERSIONS')}>Conversões, com meta de CPA</button>
          <button onClick={() => set({ lance: { ...draft.lance, estrategia: 'TARGET_SPEND' } })} className={choice(draft.lance.estrategia === 'TARGET_SPEND')}>Cliques, com limite de CPC</button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          {draft.lance.estrategia === 'MAXIMIZE_CONVERSIONS'
            ? <span className={`inline-flex items-center gap-2 ${head}`}>Meta de CPA {symbol} <NumberField key="cpa" label="Meta de CPA" value={draft.lance.meta_cpa} onChange={v => set({ lance: { ...draft.lance, meta_cpa: v } })} css={css} placeholder="sem meta" /></span>
            : <span className={`inline-flex items-center gap-2 ${head}`}>Limite de CPC {symbol} <NumberField key="cpc" label="Limite de CPC" value={draft.lance.limite_cpc} onChange={v => set({ lance: { ...draft.lance, limite_cpc: v } })} css={css} placeholder="sem limite" /></span>}
          <span className={`inline-flex items-center gap-2 ${head}`}>Orçamento diário {symbol} <NumberField label="Orçamento diário" value={draft.orcamento_diario} onChange={v => set({ orcamento_diario: v })} css={css} /></span>
        </div>
        <div className={`text-xs ${muted}`}>Em branco, a campanha maximiza conversões sem meta. A meta de conversão é escolhida conta a conta, no passo "Onde subir".</div>
      </Block>

      <Block css={css} title="Grupos de anúncios" hint="Todos os grupos levam as mesmas palavras-chave e o mesmo anúncio. O que muda é a meta de CPA de cada um; em branco, o grupo segue a meta da campanha.">
        {draft.grupos.map((g, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input value={g.nome} onChange={e => setDraft(d => ({ ...d, grupos: d.grupos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) }))} aria-label={`Nome do grupo ${i + 1}`}
              className={`flex-1 min-w-[180px] rounded-lg border ${line} ${soft} ${head} px-3 py-1.5 text-[13px] outline-none focus:border-indigo-500`} />
            <span className={`text-xs ${muted}`}>meta de CPA {symbol}</span>
            <NumberField key={`g${i}-${draft.grupos.length}`} label={`Meta de CPA do grupo ${i + 1}`} value={g.meta_cpa} css={css} placeholder="da campanha"
              onChange={v => setDraft(d => ({ ...d, grupos: d.grupos.map((x, j) => (j === i ? { ...x, meta_cpa: v } : x)) }))} />
            {draft.grupos.length > 1 && <button onClick={() => setDraft(d => ({ ...d, grupos: d.grupos.filter((_, j) => j !== i) }))} aria-label={`Remover o grupo ${g.nome}`} className={`${muted} hover:text-rose-400`}><X size={15} /></button>}
          </div>
        ))}
        <button onClick={() => setDraft(d => ({ ...d, grupos: [...d.grupos, { nome: `Grupo ${String(d.grupos.length + 1).padStart(2, '0')}`, meta_cpa: null }] }))} className={`text-xs font-bold inline-flex items-center gap-1 ${muted} hover:text-indigo-400`}><Plus size={13} /> Outro grupo</button>
      </Block>

      <Block css={css} title="Redes">
        {check(true, 'Pesquisa do Google', () => {}, true)}
        {check(draft.redes.parceiros, 'Parceiros de pesquisa do Google', v => set({ redes: { ...draft.redes, parceiros: v } }))}
        {check(draft.redes.display, 'Rede de Display', v => set({ redes: { ...draft.redes, display: v } }))}
      </Block>

      <Block css={css} title="Locais" hint="Sem nenhum local incluído, a campanha roda em todos os países, menos os excluídos.">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => set({ local_incluir: 'PRESENCE' })} className={choice(draft.local_incluir === 'PRESENCE')}>Presença: só quem está no local</button>
          <button onClick={() => set({ local_incluir: 'PRESENCE_OR_INTEREST' })} className={choice(draft.local_incluir === 'PRESENCE_OR_INTEREST')}>Presença ou interesse</button>
        </div>
        {[['Incluídos', included, 'todos os países'] as const, ['Excluídos', excluded, 'nenhum'] as const].map(([title, list, none]) => (
          <div key={title}>
            <div className={`${label} mb-1.5`}>{title}</div>
            <div className="flex flex-wrap gap-1.5">
              {list.map(l => (
                <span key={l.id} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${line} ${head}`}>
                  {l.nome}
                  {!l.excluido && <><NumberField key={l.id} label={`Ajuste de lance de ${l.nome}`} value={l.ajuste || null} css={css} width="w-14" placeholder="0"
                    onChange={v => setDraft(d => ({ ...d, locais: d.locais.map(x => (x.id === l.id ? { ...x, ajuste: v || 0 } : x)) }))} />%</>}
                  <button onClick={() => setDraft(d => ({ ...d, locais: d.locais.filter(x => x.id !== l.id) }))} aria-label={`Remover ${l.nome}`} className={`${muted} hover:text-rose-400`}><X size={12} /></button>
                </span>
              ))}
              {!list.length && <span className={`text-xs ${muted}`}>{none}</span>}
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${muted}`} />
            <input value={placeText} onChange={e => setPlaceText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} placeholder="País, estado ou cidade" aria-label="Procurar local"
              className={`w-full rounded-lg border ${line} ${soft} ${head} pl-9 pr-3 py-2 text-[13px] outline-none focus:border-indigo-500`} />
          </div>
          <button onClick={search} disabled={searching || placeText.trim().length < 2} className={`px-3 rounded-lg border ${line} text-xs font-bold ${muted} hover:text-indigo-400 disabled:opacity-40 inline-flex items-center gap-1.5`}>
            {searching && <Loader2 size={12} className="animate-spin" />} Procurar
          </button>
        </div>
        {placeError && <div className="text-xs text-amber-500">{placeError}</div>}
        {places.length > 0 && (
          <div className={`rounded-lg border ${line} divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
            {places.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                <span className={head}>{p.nome} <span className={`text-xs ${muted}`}>· {PLACE[p.tipo] || p.tipo.toLowerCase()}</span></span>
                <span className="flex gap-1.5 shrink-0">
                  <button onClick={() => addPlace(p, false)} className={`text-[11px] font-bold px-2 py-1 rounded border ${line} ${muted} hover:text-emerald-400`}>Incluir</button>
                  <button onClick={() => addPlace(p, true)} className={`text-[11px] font-bold px-2 py-1 rounded border ${line} ${muted} hover:text-rose-400`}>Excluir</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block css={css} title="Idiomas" hint="Sem nenhum marcado, vale para todos os idiomas.">
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map(l => {
            const on = draft.idiomas.some(i => i.id === l.id);
            return <button key={l.id} onClick={() => set({ idiomas: on ? draft.idiomas.filter(i => i.id !== l.id) : [...draft.idiomas, l] })} className={choice(on)}>{l.nome}</button>;
          })}
          {draft.idiomas.filter(i => !LANGUAGES.some(l => l.id === i.id)).map(i => (
            <button key={i.id} onClick={() => set({ idiomas: draft.idiomas.filter(x => x.id !== i.id) })} className={choice(true)}>{i.nome}</button>
          ))}
        </div>
      </Block>

      <Block css={css} title="IA Max do Google" hint="Desligada por padrão. Ligada, o Google amplia as pesquisas em que o anúncio aparece. As duas opções abaixo deixam o Google reescrever o seu texto e trocar a página de destino.">
        {check(draft.ia_max.ligada, 'Ligar a IA Max nesta campanha', v => set({ ia_max: v ? { ...draft.ia_max, ligada: true } : { ligada: false, personalizar_texto: false, expandir_url: false } }))}
        {check(draft.ia_max.personalizar_texto, 'Personalização do texto: o Google cria títulos e descrições novos', v => set({ ia_max: { ...draft.ia_max, personalizar_texto: v, expandir_url: v ? draft.ia_max.expandir_url : false } }), !draft.ia_max.ligada)}
        {check(draft.ia_max.expandir_url, 'Expansão de URL final: o Google pode levar o clique a outra página do site', v => set({ ia_max: { ...draft.ia_max, expandir_url: v } }), !draft.ia_max.ligada || !draft.ia_max.personalizar_texto)}
      </Block>

      <Block css={css} title="Ajuste de lance por aparelho" hint="De −100% a +900%. Em branco, sem ajuste.">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {draft.aparelhos.map(a => (
            <span key={a.tipo} className={`inline-flex items-center gap-2 text-[13px] ${head}`}>{DEVICE[a.tipo]}
              <NumberField label={`Ajuste de ${DEVICE[a.tipo]}`} value={a.ajuste || null} css={css} width="w-20" placeholder="0"
                onChange={v => setDraft(d => ({ ...d, aparelhos: d.aparelhos.map(x => (x.tipo === a.tipo ? { ...x, ajuste: v || 0 } : x)) }))} />%</span>
          ))}
        </div>
      </Block>

      <Block css={css} title={`Negativas da campanha (${draft.negativas.length})`} hint='Uma por linha ou separadas por vírgula. Use [colchetes] para exata e "aspas" para frase; sem nada, ampla.'>
        <div className="flex flex-wrap gap-1.5">
          {draft.negativas.slice(0, 80).map((n, i) => (
            <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${line} ${head}`}>{keyword(n)}
              <button onClick={() => setDraft(d => ({ ...d, negativas: d.negativas.filter((_, j) => j !== i) }))} aria-label={`Remover a negativa ${n.texto}`} className={`${muted} hover:text-rose-400`}><X size={12} /></button></span>
          ))}
          {draft.negativas.length > 80 && <span className={`text-xs ${muted} px-2 py-1`}>e mais {draft.negativas.length - 80}</span>}
        </div>
        <div className="flex gap-2 items-end">
          <textarea value={negatives} onChange={e => setNegatives(e.target.value)} rows={2} placeholder={'free\n[baking soda uses]\n"how to clean"'} aria-label="Novas negativas"
            className={`flex-1 rounded-lg border ${line} ${soft} ${head} px-3 py-2 text-[13px] outline-none focus:border-indigo-500 resize-y`} />
          <button onClick={addNegatives} disabled={!negatives.trim()} className={`px-3 py-2 rounded-lg border ${line} text-xs font-bold ${muted} hover:text-indigo-400 disabled:opacity-40`}>Adicionar</button>
        </div>
      </Block>

      <Block css={css} title="Rastreador da URL" hint="Vale para o anúncio e para os sitelinks. Você cola só a página; os campos do rastreador entram sozinhos.">
        <div className="space-y-1.5">
          {TRACKERS.map(t => (
            <label key={t.id} className={`flex items-start gap-2 text-[13px] cursor-pointer ${head}`}>
              <input type="radio" className="mt-0.5" checked={draft.rastreador === t.id} onChange={() => set({ rastreador: t.id })} />
              <span>{t.nome} <span className={`text-xs ${muted}`}>· {t.resumo}</span></span>
            </label>
          ))}
        </div>
      </Block>

      <div className={`${card} border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="text-xs space-y-0.5">
          {problems.length ? problems.map(p => <div key={p} className="text-amber-500">{p}</div>) : <div className={muted}>Configuração completa. Nada foi enviado ao Google.</div>}
        </div>
        <button onClick={onNext} disabled={problems.length > 0} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">Seguir para o anúncio</button>
      </div>
    </div>
  );
}
