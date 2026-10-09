"use client";

import React, { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Loader2, Plus, X } from 'lucide-react';
import type { Ui } from '@/app/components/metrics/ColumnPicker';

/**
 * Montagem da campanha pelas abas (grupos, anúncios, palavras-chave, termos e
 * locais): os formulários e a conversa com /api/google-ads/manage.
 *
 * Só aparece para os logins liberados. Cada pedido passa por um ensaio no
 * Google antes de valer; a resposta (feito, ou o motivo da recusa) fica
 * escrita no próprio formulário.
 */

export interface ManageGroup { id: string; nome: string; status: string; meta_cpa: number | null }
export type Result = { ok: boolean; text: string } | null;

export function useManage(supabase: SupabaseClient, productId: string, enabled = true) {
  const [allowed, setAllowed] = useState(false);
  const [groups, setGroups] = useState<ManageGroup[]>([]);
  const [currency, setCurrency] = useState('USD');

  const call = useCallback(async (path: string, body?: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) as any };
  }, [supabase]);

  const loadGroups = useCallback(async () => {
    const { ok, body } = await call(`/api/google-ads/manage?product_id=${productId}&ver=grupos`);
    setAllowed(ok && body.allowed === true && !body.error);
    if (ok && body.groups) { setGroups(body.groups); setCurrency(body.currency || 'USD'); }
  }, [call, productId]);
  useEffect(() => { if (enabled && productId) loadGroups(); }, [enabled, productId, loadGroups]);

  /** Faz uma alteração. Devolve o que escrever na tela e a resposta inteira. */
  const send = useCallback(async (action: string, payload: Record<string, any>, route = 'manage') => {
    const { ok, body } = await call(`/api/google-ads/${route}`, { product_id: productId, action, ...payload });
    return { ok: ok && body.success !== false, body, text: ok ? String(body.target || 'Feito.') : String(body.error || 'Não deu certo. Tente de novo.') };
  }, [call, productId]);

  return { allowed, groups, currency, call, send, loadGroups };
}
export type Manage = ReturnType<typeof useManage>;

const count = (text: string) => [...String(text || '').replace(/\{KeyWord:([^}]*)\}/gi, '$1')].length;

function styles(ui: Ui) {
  const { isDark, borderCol } = ui;
  return {
    box: `${ui.bgCard} border rounded-xl p-4 space-y-3`,
    input: `rounded-lg border ${borderCol} px-3 py-1.5 text-[13px] outline-none focus:border-indigo-500 ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-white text-slate-800'}`,
    solid: 'bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5',
    ghost: `px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5 ${isDark ? 'border-slate-700 text-slate-200 hover:border-indigo-400' : 'border-slate-300 text-slate-700 hover:border-indigo-500'}`,
  };
}

/** O botão "+ …" da barra da tabela. */
export function AddButton({ label, onClick, ui }: { label: string; onClick: () => void; ui: Ui }) {
  return <button onClick={onClick} className={styles(ui).solid}><Plus size={13} /> {label}</button>;
}
/** Ação de uma linha da tabela, como link. */
export function RowAction({ label, onClick, busy, danger }: { label: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return <button onClick={onClick} disabled={busy} className={`text-xs font-semibold hover:underline disabled:opacity-40 whitespace-nowrap ${danger ? 'text-amber-400' : 'text-indigo-400'}`}>{busy ? '…' : label}</button>;
}
export function ResultLine({ result }: { result: Result }) {
  return result ? <div className={`text-xs ${result.ok ? 'text-emerald-500' : 'text-rose-500'}`}>{result.text}</div> : null;
}
function Frame({ title, onClose, ui, children }: { title: string; onClose: () => void; ui: Ui; children: React.ReactNode }) {
  return (
    <div className={styles(ui).box}>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-sm font-bold ${ui.textHead}`}>{title}</div>
        <button onClick={onClose} aria-label="Fechar" className={`${ui.textMuted} hover:text-indigo-400`}><X size={15} /></button>
      </div>
      {children}
    </div>
  );
}
const GroupSelect = ({ groups, value, onChange, cls }: { groups: ManageGroup[]; value: string; onChange: (id: string) => void; cls: string }) => (
  <select value={value} onChange={e => onChange(e.target.value)} aria-label="Grupo de anúncios" className={cls}>
    {groups.map(g => <option key={g.id} value={g.id}>No grupo {g.nome}{g.status !== 'ENABLED' ? ' (pausado)' : ''}</option>)}
  </select>
);

// ── Grupo novo, cópia de grupo e nome do grupo ───────────────────────────────

export function GroupForm({ manage, ui, copyFrom, rename, onClose, onDone }: { manage: Manage; ui: Ui; copyFrom?: ManageGroup; rename?: ManageGroup; onClose: () => void; onDone: () => void }) {
  const s = styles(ui);
  const [name, setName] = useState(rename ? rename.nome : copyFrom ? `${copyFrom.nome} (cópia)` : '');
  const [target, setTarget] = useState('');
  const [copy, setCopy] = useState(!!copyFrom);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const symbol = manage.currency === 'BRL' ? 'R$' : manage.currency === 'EUR' ? '€' : 'US$';

  const submit = async () => {
    setBusy(true); setResult(null);
    const r = rename ? await manage.send('grupo_nome', { group_id: rename.id, name })
      : await manage.send('grupo_novo', { name, target: Number(target.replace(',', '.')) || null, copy_from: copy && copyFrom ? copyFrom.id : null, paused });
    setBusy(false);
    setResult({ ok: r.ok, text: r.ok ? `${rename ? 'Grupo renomeado' : 'Grupo criado'}: ${r.text}${!rename && copy ? '. As palavras-chave e os anúncios copiados aparecem nas abas na próxima coleta (até 1 hora).' : ''}` : r.text });
    if (r.ok) { await manage.loadGroups(); onDone(); }
  };
  return (
    <Frame title={rename ? `Renomear o grupo ${rename.nome}` : copyFrom ? `Duplicar o grupo ${copyFrom.nome}` : 'Novo grupo de anúncios'} onClose={onClose} ui={ui}>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome do grupo" aria-label="Nome do grupo" className={`${s.input} flex-1 min-w-[180px]`} />
        {!rename && <label className={`inline-flex items-center gap-1.5 text-xs ${ui.textMuted}`}>{symbol}
          <input value={target} onChange={e => setTarget(e.target.value)} inputMode="decimal" placeholder="meta de CPA" aria-label="Meta de CPA do grupo" className={`${s.input} w-32`} /></label>}
      </div>
      {!rename && (
        <div className={`flex flex-wrap gap-x-5 gap-y-1 text-xs ${ui.textHead}`}>
          {copyFrom && <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={copy} onChange={e => setCopy(e.target.checked)} /> Copiar as palavras-chave e os anúncios de {copyFrom.nome}</label>}
          <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> Criar pausado</label>
        </div>
      )}
      {!rename && <div className={`text-[11px] ${ui.textMuted}`}>Meta em branco: {copyFrom ? `usa a do grupo copiado${copyFrom.meta_cpa ? ` (${symbol} ${copyFrom.meta_cpa.toFixed(2).replace('.', ',')})` : ', que segue a da campanha'}` : 'o grupo segue a meta da campanha'}. A meta do grupo só vale se a campanha também tiver meta de CPA.{!copyFrom ? ' Grupo novo nasce vazio: inclua palavras-chave e um anúncio depois.' : ''}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={submit} disabled={busy || !name.trim()} className={s.solid}>{busy && <Loader2 size={13} className="animate-spin" />} {rename ? 'Renomear' : 'Criar grupo'}</button>
        <button onClick={onClose} className={s.ghost}>{result?.ok ? 'Fechar' : 'Cancelar'}</button>
      </div>
      <ResultLine result={result} />
    </Frame>
  );
}

// ── Palavras-chave novas (também a partir de um termo de pesquisa) ───────────

export function KeywordForm({ manage, ui, initial, groupId, onClose, onDone }: { manage: Manage; ui: Ui; initial?: string; groupId?: string; onClose: () => void; onDone: () => void }) {
  const s = styles(ui);
  const [text, setText] = useState(initial || '');
  const [match, setMatch] = useState('PHRASE');
  const [group, setGroup] = useState(groupId || manage.groups.find(g => g.status === 'ENABLED')?.id || manage.groups[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  useEffect(() => { if (!group && manage.groups[0]) setGroup(manage.groups[0].id); }, [group, manage.groups]);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const submit = async () => {
    setBusy(true); setResult(null);
    const r = await manage.send('palavra_nova', { group_id: group, texts: lines, match });
    setBusy(false);
    setResult({ ok: r.ok, text: r.ok ? `Incluída: ${r.text}${r.body.skipped ? `. ${r.body.skipped} já ${r.body.skipped === 1 ? 'estava' : 'estavam'} no grupo.` : ''}` : r.text });
    if (r.ok) { setText(''); onDone(); }
  };
  return (
    <Frame title={initial ? 'Incluir o termo como palavra-chave' : 'Novas palavras-chave'} onClose={onClose} ui={ui}>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={initial ? 1 : 3} placeholder="Uma palavra-chave por linha" aria-label="Palavras-chave novas" className={`${s.input} w-full font-mono`} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={match} onChange={e => setMatch(e.target.value)} aria-label="Tipo de correspondência" className={s.input}>
          <option value="PHRASE">Frase: &quot;palavra&quot;</option><option value="EXACT">Exata: [palavra]</option><option value="BROAD">Ampla: palavra</option>
        </select>
        <GroupSelect groups={manage.groups} value={group} onChange={setGroup} cls={`${s.input} max-w-[260px]`} />
        <button onClick={submit} disabled={busy || !lines.length || !group} className={s.solid}>{busy && <Loader2 size={13} className="animate-spin" />} Incluir {lines.length > 1 ? `${lines.length} palavras-chave` : 'palavra-chave'}</button>
      </div>
      <div className={`text-[11px] ${ui.textMuted}`}>Escreva só o texto, sem aspas nem colchetes: o tipo escolhido cuida disso. A palavra-chave entra ativa.</div>
      <ResultLine result={result} />
    </Frame>
  );
}

// ── Anúncio novo ou cópia de um anúncio ──────────────────────────────────────

export interface AdSeed { titulos: string[]; descricoes: string[]; url: string; caminho1: string; caminho2: string; group_id: string }

export function AdForm({ manage, ui, seed, onClose, onDone }: { manage: Manage; ui: Ui; seed?: AdSeed; onClose: () => void; onDone: () => void }) {
  const s = styles(ui);
  const pad = (list: string[], n: number) => [...list, ...Array(Math.max(0, n - list.length)).fill('')];
  const [titles, setTitles] = useState<string[]>(pad(seed?.titulos || [], 15).slice(0, 15));
  const [descs, setDescs] = useState<string[]>(pad(seed?.descricoes || [], 4).slice(0, 4));
  const [url, setUrl] = useState(seed?.url || '');
  const [path1, setPath1] = useState(seed?.caminho1 || '');
  const [path2, setPath2] = useState(seed?.caminho2 || '');
  const [group, setGroup] = useState(seed?.group_id || manage.groups.find(g => g.status === 'ENABLED')?.id || manage.groups[0]?.id || '');
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  useEffect(() => { if (!group && manage.groups[0]) setGroup(manage.groups[0].id); }, [group, manage.groups]);

  const filledTitles = titles.filter(t => t.trim()), filledDescs = descs.filter(t => t.trim());
  const tooLong = titles.some(t => count(t) > 30) || descs.some(t => count(t) > 90) || count(path1) > 15 || count(path2) > 15;
  const missing = filledTitles.length < 3 ? 'Faltam títulos: o anúncio precisa de pelo menos 3.' : filledDescs.length < 2 ? 'Faltam descrições: o anúncio precisa de pelo menos 2.' : !/^https:\/\//i.test(url.trim()) ? 'A página precisa começar com https://' : tooLong ? 'Há texto acima do limite de letras.' : '';
  const set = (list: string[], apply: (l: string[]) => void, i: number, v: string) => apply(list.map((x, j) => (j === i ? v : x)));
  const counter = (text: string, max: number) => <span className={`text-[11px] tabular-nums w-10 text-right ${count(text) > max ? 'text-rose-500 font-bold' : ui.textMuted}`}>{count(text)}/{max}</span>;

  const submit = async () => {
    setBusy(true); setResult(null);
    const r = await manage.send('anuncio_novo', { group_id: group, titulos: filledTitles, descricoes: filledDescs, url: url.trim(), caminho1: path1.trim(), caminho2: path2.trim(), paused });
    setBusy(false);
    setResult({ ok: r.ok, text: r.ok ? `Anúncio criado${paused ? ', pausado' : ''}: ${r.text}. O Google ainda vai analisar o texto.` : r.text });
    if (r.ok) onDone();
  };
  return (
    <Frame title={seed?.titulos.length ? 'Duplicar o anúncio: mude o que quiser antes de criar' : 'Novo anúncio de pesquisa'} onClose={onClose} ui={ui}>
      <div className="grid lg:grid-cols-2 gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <div className={`text-xs font-bold ${ui.textHead}`}>Títulos ({filledTitles.length} de 15, mínimo 3)</div>
          {titles.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={t} onChange={e => set(titles, setTitles, i, e.target.value)} placeholder={`Título ${i + 1}`} aria-label={`Título ${i + 1}`} className={`${s.input} flex-1 min-w-0`} />{counter(t, 30)}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className={`text-xs font-bold ${ui.textHead}`}>Descrições ({filledDescs.length} de 4, mínimo 2)</div>
          {descs.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <textarea value={t} onChange={e => set(descs, setDescs, i, e.target.value)} rows={2} placeholder={`Descrição ${i + 1}`} aria-label={`Descrição ${i + 1}`} className={`${s.input} flex-1 min-w-0`} />{counter(t, 90)}
            </div>
          ))}
          <div className={`text-xs font-bold pt-2 ${ui.textHead}`}>Página do anúncio</div>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… (com os parâmetros de rastreamento)" aria-label="Página do anúncio" className={`${s.input} w-full`} />
          <div className="flex items-center gap-2">
            <span className={`text-xs ${ui.textMuted}`}>Caminho</span>
            <input value={path1} onChange={e => setPath1(e.target.value)} placeholder="caminho 1" aria-label="Caminho 1" className={`${s.input} w-32`} />{counter(path1, 15)}
            <input value={path2} onChange={e => setPath2(e.target.value)} placeholder="caminho 2" aria-label="Caminho 2" className={`${s.input} w-32`} />{counter(path2, 15)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <GroupSelect groups={manage.groups} value={group} onChange={setGroup} cls={`${s.input} max-w-[260px]`} />
        <label className={`inline-flex items-center gap-1.5 text-xs cursor-pointer ${ui.textHead}`}><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> Criar pausado</label>
        <button onClick={submit} disabled={busy || !!missing || !group} className={s.solid}>{busy && <Loader2 size={13} className="animate-spin" />} Criar anúncio</button>
        <button onClick={onClose} className={s.ghost}>{result?.ok ? 'Fechar' : 'Cancelar'}</button>
        {missing && <span className="text-xs text-amber-500">{missing}</span>}
      </div>
      <div className={`text-[11px] ${ui.textMuted}`}>{seed?.titulos.length ? 'O anúncio de origem não muda: se a cópia for para o lugar dele, pause o antigo depois. ' : ''}O Google confere o anúncio antes de criar; se recusar, o motivo aparece aqui.</div>
      <ResultLine result={result} />
    </Frame>
  );
}

// ── Locais da campanha ───────────────────────────────────────────────────────

export function LocationsBox({ manage, ui, productId }: { manage: Manage; ui: Ui; productId: string }) {
  const s = styles(ui);
  const [locations, setLocations] = useState<{ id: string; nome: string; excluido: boolean }[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ id: string; nome: string; tipo: string }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Result>(null);

  useEffect(() => {
    if (!manage.allowed) return;
    manage.call(`/api/google-ads/manage?product_id=${productId}&ver=locais`).then(({ ok, body }) => { if (ok && body.locations) setLocations(body.locations); else setError(body.error || 'O Google não respondeu.'); });
  }, [manage.allowed, productId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!manage.allowed) return null;

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true); setFound(null); setResult(null);
    const { ok, body } = await manage.call(`/api/campaign-builder?local=${encodeURIComponent(query.trim())}`);
    setSearching(false);
    if (ok) setFound(body.places || []); else setResult({ ok: false, text: body.error || 'A busca de locais não respondeu.' });
  };
  const run = async (key: string, action: string, payload: Record<string, any>) => {
    setBusy(key); setResult(null);
    let r = await manage.send(action, payload);
    // Tirar o único local incluído põe a campanha no mundo todo: só com a confirmação de quem pediu.
    if (!r.ok && r.body.confirm === 'mundo') {
      if (!window.confirm(`${r.body.error}\n\nTirar mesmo assim?`)) { setBusy(''); return; }
      r = await manage.send(action, { ...payload, confirmar_mundo: true });
    }
    setBusy('');
    setResult({ ok: r.ok, text: r.ok ? `Feito: ${r.text}.` : r.text });
    if (r.ok && r.body.locations) { setLocations(r.body.locations); setFound(null); setQuery(''); }
  };
  const included = (locations || []).filter(l => !l.excluido).length;
  const pill = (excluded: boolean) => `px-2 py-0.5 rounded-md text-[11px] font-bold ${excluded ? (ui.isDark ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-700') : (ui.isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700')}`;

  return (
    <div className={s.box}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={`text-sm font-bold ${ui.textHead}`}>Locais da campanha no Google</div>
        <div className={`text-[11px] ${ui.textMuted}`}>lido do Google agora · a tabela abaixo mostra de onde vieram os cliques</div>
      </div>
      {error ? <div className="text-xs text-rose-500">{error}</div> : !locations ? <div className={`text-xs ${ui.textMuted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> lendo os locais…</div> : (
        <>
          {!included && <div className="text-xs text-amber-500">Nenhum local incluído: a campanha aparece no mundo todo{locations.length ? ', menos nos locais excluídos' : ''}.</div>}
          <div className="flex flex-wrap gap-2">
            {locations.map(l => (
              <span key={l.id} className={`inline-flex items-center gap-2 rounded-lg border ${ui.borderCol} px-2 py-1 text-[13px] ${ui.textHead}`}>
                <span className={pill(l.excluido)}>{l.excluido ? 'excluído' : 'incluído'}</span>{l.nome}
                <RowAction label="Tirar" busy={busy === `t${l.id}`} onClick={() => run(`t${l.id}`, 'local_remover', { id: l.id })} danger />
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} placeholder="Buscar país, estado ou cidade" aria-label="Buscar local" className={`${s.input} flex-1 min-w-[200px]`} />
            <button onClick={search} disabled={searching || query.trim().length < 2} className={s.ghost}>{searching && <Loader2 size={13} className="animate-spin" />} Buscar</button>
          </div>
          {found && (found.length ? found.map(p => {
            const have = locations.find(l => l.id === p.id);
            return (
              <div key={p.id} className={`flex flex-wrap items-center justify-between gap-2 border-t ${ui.borderCol} pt-2 text-[13px] ${ui.textHead}`}>
                <span>{p.nome}</span>
                {have ? <span className={`text-xs ${ui.textMuted}`}>já está {have.excluido ? 'excluído' : 'incluído'}</span> : (
                  <span className="inline-flex gap-3">
                    <RowAction label="Incluir" busy={busy === `i${p.id}`} onClick={() => run(`i${p.id}`, 'local_novo', { geo_id: p.id, excluir: false })} />
                    <RowAction label="Excluir" busy={busy === `e${p.id}`} onClick={() => run(`e${p.id}`, 'local_novo', { geo_id: p.id, excluir: true })} danger />
                  </span>
                )}
              </div>
            );
          }) : <div className={`text-xs ${ui.textMuted}`}>Nenhum local encontrado com esse nome.</div>)}
        </>
      )}
      <ResultLine result={result} />
    </div>
  );
}
