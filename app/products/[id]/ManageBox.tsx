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

// ── Anúncio: novo, cópia ou edição, com a ajuda da IA ────────────────────────

export interface AdSeed { titulos: string[]; descricoes: string[]; url: string; caminho1: string; caminho2: string; group_id: string }
interface TextStat { impressoes: number; cliques: number; conversoes: number; nota: string | null; pin: string | null }
interface Advice {
  leitura: string; descartados: number;
  trocas: { tipo: 'titulo' | 'descricao'; atual: string; motivo: string; novo: string; pt: string }[];
  novos: { tipo: 'titulo' | 'descricao' | 'sitelink' | 'destaque'; novo: string; pt: string; motivo: string; desc1?: string; desc2?: string }[];
}
const n = (v: number) => Math.round(v).toLocaleString('pt-BR');

/**
 * `mode`: 'novo' cria do zero, 'copia' cria outro anúncio a partir de `seed`, 'editar' troca os textos do
 * anúncio `adKey`. Em cópia e edição, `adKey` é o anúncio de origem: é dele o desempenho de cada texto
 * (30 dias) e é sobre ele que a IA opina.
 */
export function AdForm({ manage, ui, productId, mode, seed, adKey, onClose, onDone }: { manage: Manage; ui: Ui; productId: string; mode: 'novo' | 'copia' | 'editar'; seed?: AdSeed; adKey?: string; onClose: () => void; onDone: () => void }) {
  const s = styles(ui);
  const pad = (list: string[], size: number) => [...list, ...Array(Math.max(0, size - list.length)).fill('')].slice(0, size);
  const [titles, setTitles] = useState<string[]>(pad(mode === 'novo' ? [] : seed?.titulos || [], 15));
  const [descs, setDescs] = useState<string[]>(pad(mode === 'novo' ? [] : seed?.descricoes || [], 4));
  const [url, setUrl] = useState(seed?.url || '');
  const [path1, setPath1] = useState(seed?.caminho1 || '');
  const [path2, setPath2] = useState(seed?.caminho2 || '');
  const [group, setGroup] = useState(seed?.group_id || manage.groups.find(g => g.status === 'ENABLED')?.id || manage.groups[0]?.id || '');
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  // Desempenho de cada texto do anúncio de origem, lido do Google ao abrir.
  const [stats, setStats] = useState<Map<string, TextStat> | null>(null);
  const [hasNumbers, setHasNumbers] = useState(false);
  const [canAi, setCanAi] = useState(false);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState('');
  const [used, setUsed] = useState<string[]>([]);
  useEffect(() => { if (!group && manage.groups[0]) setGroup(manage.groups[0].id); }, [group, manage.groups]);
  useEffect(() => {
    if (!adKey) return;
    manage.call(`/api/google-ads/manage?product_id=${productId}&ver=anuncio&ad=${adKey}`).then(({ ok, body }) => {
      if (!ok || !body.ad) { setStats(new Map()); return; }
      const map = new Map<string, TextStat>();
      for (const t of [...body.ad.titulos, ...body.ad.descricoes]) map.set(String(t.texto).trim().toLowerCase(), t);
      setStats(map); setHasNumbers(!!body.ad.tem_numeros); setCanAi(!!body.ai);
      // Em edição vale o que está no Google agora, não o que a coleta guardou.
      if (mode === 'editar') { setTitles(pad(body.ad.titulos.map((t: any) => t.texto), 15)); setDescs(pad(body.ad.descricoes.map((t: any) => t.texto), 4)); setUrl(body.ad.url); setPath1(body.ad.caminho1); setPath2(body.ad.caminho2); }
    });
  }, [adKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filledTitles = titles.filter(t => t.trim()), filledDescs = descs.filter(t => t.trim());
  const tooLong = titles.some(t => count(t) > 30) || descs.some(t => count(t) > 90) || count(path1) > 15 || count(path2) > 15;
  const missing = filledTitles.length < 3 ? 'Faltam títulos: o anúncio precisa de pelo menos 3.' : filledDescs.length < 2 ? 'Faltam descrições: o anúncio precisa de pelo menos 2.' : !/^https:\/\//i.test(url.trim()) ? 'A página precisa começar com https://' : tooLong ? 'Há texto acima do limite de letras.' : '';
  const set = (list: string[], apply: (l: string[]) => void, i: number, v: string) => apply(list.map((x, j) => (j === i ? v : x)));
  const counter = (text: string, max: number) => <span className={`text-[11px] tabular-nums w-10 text-right flex-shrink-0 ${count(text) > max ? 'text-rose-500 font-bold' : ui.textMuted}`}>{count(text)}/{max}</span>;
  const NOTE_TONE: Record<string, string> = { melhor: 'text-emerald-400', bom: 'text-emerald-400', baixo: 'text-rose-400' };
  const maxImp = stats ? Math.max(0, ...[...stats.values()].map(x => x.impressoes)) : 0;
  const stat = (text: string) => {
    const st = stats?.get(text.trim().toLowerCase());
    if (!text.trim()) return null;
    if (!st) return adKey && stats ? <div className="text-[11px] text-indigo-400">texto novo</div> : null;
    const weak = hasNumbers && maxImp >= 200 && st.impressoes < maxImp * 0.1;
    return (
      <div className={`text-[11px] ${ui.textMuted}`}>
        {hasNumbers ? `${n(st.impressoes)} impressões · ${n(st.cliques)} cliques${st.conversoes ? ` · ${n(st.conversoes)} conversões` : ''}` : 'sem números ainda'}
        {st.nota && <span className={`ml-1.5 font-bold ${NOTE_TONE[st.nota] || ''}`}>· Google: {st.nota}</span>}
        {!st.nota && weak && <span className="ml-1.5 font-bold text-amber-400">· pouco mostrado</span>}
        {st.pin && <span className="ml-1.5">· fixado</span>}
      </div>
    );
  };

  const askAi = async () => {
    setAsking(true); setAiError(''); setAdvice(null); setUsed([]);
    const r = await manage.send('anuncio_ia', { ad: adKey });
    setAsking(false);
    if (r.ok && r.body.advice) setAdvice(r.body.advice); else setAiError(r.text);
  };
  /** Põe o texto sugerido no lugar do atual, ou na primeira vaga livre. */
  const use = (tipo: 'titulo' | 'descricao', novo: string, atual?: string) => {
    const [list, apply] = tipo === 'titulo' ? [titles, setTitles] as const : [descs, setDescs] as const;
    let at = atual ? list.findIndex(t => t.trim().toLowerCase() === atual.trim().toLowerCase()) : -1;
    if (at < 0) at = list.findIndex(t => !t.trim());
    if (at < 0) { setAiError(`Não há vaga livre para ${tipo === 'titulo' ? 'outro título' : 'outra descrição'}: apague um antes.`); return; }
    apply(list.map((x, j) => (j === at ? novo : x)));
    setUsed(u => [...u, novo]);
  };
  const addAsset = async (item: Advice['novos'][number]) => {
    const r = await manage.send('recurso_novo', { tipo: item.tipo, texto: item.novo, desc1: item.desc1 || '', desc2: item.desc2 || '', url: url.trim() });
    if (r.ok) setUsed(u => [...u, item.novo]); else setAiError(r.text);
  };

  const submit = async () => {
    setBusy(true); setResult(null);
    const texts = { titulos: filledTitles, descricoes: filledDescs, url: url.trim(), caminho1: path1.trim(), caminho2: path2.trim() };
    const r = mode === 'editar' ? await manage.send('anuncio_editar', { ad: adKey, ...texts }) : await manage.send('anuncio_novo', { group_id: group, ...texts, paused });
    setBusy(false);
    setResult({ ok: r.ok, text: r.ok ? `${mode === 'editar' ? 'Anúncio alterado' : `Anúncio criado${paused ? ', pausado' : ''}`}: ${r.text}. O Google ainda vai analisar o texto.` : r.text });
    if (r.ok) onDone();
  };
  const TYPE: Record<string, string> = { titulo: 'Título', descricao: 'Descrição', sitelink: 'Sitelink', destaque: 'Frase de destaque' };
  const useLink = (label: string, onClick: () => void, text: string) => (used.includes(text) ? <span className="text-xs text-emerald-500 whitespace-nowrap">feito</span> : <RowAction label={label} onClick={onClick} />);

  return (
    <Frame title={mode === 'editar' ? 'Editar o anúncio' : mode === 'copia' ? 'Duplicar o anúncio: mude o que quiser antes de criar' : 'Novo anúncio de pesquisa'} onClose={onClose} ui={ui}>
      {adKey && (
        <div className={`rounded-lg border ${ui.borderCol} p-3 space-y-2`}>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={askAi} disabled={asking || !canAi} className={s.ghost}>{asking && <Loader2 size={13} className="animate-spin" />} {asking ? 'A IA está lendo o anúncio…' : advice ? 'Pedir outra leitura à IA' : 'Pedir à IA o que melhorar'}</button>
            <span className={`text-[11px] ${ui.textMuted}`}>{!stats ? 'lendo o desempenho de cada texto no Google…' : !canAi ? 'A IA está desligada no servidor.' : hasNumbers ? 'Ela vê as impressões e os cliques de cada texto nos últimos 30 dias. Só sugere: nada muda sem você salvar.' : 'O Google ainda não tem números por texto neste anúncio: a IA avalia só pela escrita.'}</span>
          </div>
          {aiError && <div className="text-xs text-rose-500">{aiError}</div>}
          {advice && (
            <div className="space-y-2">
              {advice.leitura && <div className={`text-[13px] ${ui.textHead}`}>{advice.leitura}</div>}
              {advice.trocas.length > 0 && <div className={`text-xs font-bold ${ui.textHead}`}>Trocar</div>}
              {advice.trocas.map((t, i) => (
                <div key={`t${i}`} className={`flex flex-wrap items-start justify-between gap-2 border-t ${ui.borderCol} pt-2 text-[13px]`}>
                  <div className="min-w-0">
                    <div className={ui.textMuted}><span className="font-bold">{TYPE[t.tipo]}:</span> <s>{t.atual}</s></div>
                    <div className={ui.textHead}>→ {t.novo} <span className={`text-[11px] ${ui.textMuted}`}>({count(t.novo)} letras)</span></div>
                    <div className={`text-[11px] ${ui.textMuted}`}>{t.pt ? `"${t.pt}". ` : ''}{t.motivo}</div>
                  </div>
                  {useLink('Usar no lugar', () => use(t.tipo, t.novo, t.atual), t.novo)}
                </div>
              ))}
              {advice.novos.length > 0 && <div className={`text-xs font-bold pt-1 ${ui.textHead}`}>Incluir</div>}
              {advice.novos.map((x, i) => (
                <div key={`n${i}`} className={`flex flex-wrap items-start justify-between gap-2 border-t ${ui.borderCol} pt-2 text-[13px]`}>
                  <div className="min-w-0">
                    <div className={ui.textHead}><span className={`font-bold ${ui.textMuted}`}>{TYPE[x.tipo]}:</span> {x.novo}{x.desc1 ? ` | ${x.desc1} | ${x.desc2}` : ''} <span className={`text-[11px] ${ui.textMuted}`}>({count(x.novo)} letras)</span></div>
                    <div className={`text-[11px] ${ui.textMuted}`}>{x.pt ? `"${x.pt}". ` : ''}{x.motivo}</div>
                  </div>
                  {x.tipo === 'titulo' || x.tipo === 'descricao' ? useLink('Usar numa vaga', () => use(x.tipo as any, x.novo), x.novo) : useLink('Incluir na campanha', () => addAsset(x), x.novo)}
                </div>
              ))}
              {!advice.trocas.length && !advice.novos.length && <div className={`text-xs ${ui.textMuted}`}>A IA não sugeriu nenhuma troca.</div>}
              {advice.descartados > 0 && <div className={`text-[11px] ${ui.textMuted}`}>{advice.descartados} {advice.descartados === 1 ? 'sugestão ficou' : 'sugestões ficaram'} de fora por passar do limite de letras ou repetir um texto.</div>}
            </div>
          )}
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <div className={`text-xs font-bold ${ui.textHead}`}>Títulos ({filledTitles.length} de 15, mínimo 3)</div>
          {titles.map((t, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <input value={t} onChange={e => set(titles, setTitles, i, e.target.value)} placeholder={`Título ${i + 1}`} aria-label={`Título ${i + 1}`} className={`${s.input} flex-1 min-w-0`} />{counter(t, 30)}
              </div>
              {stat(t)}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className={`text-xs font-bold ${ui.textHead}`}>Descrições ({filledDescs.length} de 4, mínimo 2)</div>
          {descs.map((t, i) => (
            <div key={i}>
              <div className="flex items-start gap-2">
                <textarea value={t} onChange={e => set(descs, setDescs, i, e.target.value)} rows={2} placeholder={`Descrição ${i + 1}`} aria-label={`Descrição ${i + 1}`} className={`${s.input} flex-1 min-w-0`} />{counter(t, 90)}
              </div>
              {stat(t)}
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
        {mode !== 'editar' && <GroupSelect groups={manage.groups} value={group} onChange={setGroup} cls={`${s.input} max-w-[260px]`} />}
        {mode !== 'editar' && <label className={`inline-flex items-center gap-1.5 text-xs cursor-pointer ${ui.textHead}`}><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> Criar pausado</label>}
        <button onClick={submit} disabled={busy || !!missing || (mode !== 'editar' && !group) || (mode === 'editar' && !stats)} className={s.solid}>{busy && <Loader2 size={13} className="animate-spin" />} {mode === 'editar' ? 'Salvar no anúncio' : 'Criar anúncio'}</button>
        <button onClick={onClose} className={s.ghost}>{result?.ok ? 'Fechar' : 'Cancelar'}</button>
        {missing && <span className="text-xs text-amber-500">{missing}</span>}
      </div>
      <div className={`text-[11px] ${ui.textMuted}`}>
        {mode === 'editar' ? 'Ao salvar, o Google analisa o anúncio de novo e a contagem dos textos trocados recomeça do zero; os textos que não mudaram continuam com o histórico. '
          : mode === 'copia' ? 'O anúncio de origem não muda: se a cópia for para o lugar dele, pause o antigo depois. ' : ''}
        O Google confere o pedido antes de valer; se recusar, o motivo aparece aqui.
      </div>
      <ResultLine result={result} />
    </Frame>
  );
}

// ── Sitelinks e frases de destaque da campanha ──────────────────────────────

interface Asset { resource: string; tipo: 'sitelink' | 'destaque'; texto: string; desc1: string; desc2: string; url: string; impressoes: number; cliques: number }

export function AssetsBox({ manage, ui, productId, defaultUrl, onClose }: { manage: Manage; ui: Ui; productId: string; defaultUrl: string; onClose: () => void }) {
  const s = styles(ui);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [link, setLink] = useState({ texto: '', desc1: '', desc2: '', url: defaultUrl });
  const [callout, setCallout] = useState('');
  useEffect(() => {
    manage.call(`/api/google-ads/manage?product_id=${productId}&ver=recursos`).then(({ ok, body }) => { if (ok && body.assets) setAssets(body.assets); else setError(body.error || 'O Google não respondeu.'); });
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, action: string, payload: Record<string, any>, after?: () => void) => {
    setBusy(key); setResult(null);
    const r = await manage.send(action, payload);
    setBusy('');
    setResult({ ok: r.ok, text: r.ok ? `Feito: ${r.text}.` : r.text });
    if (r.ok && r.body.assets) { setAssets(r.body.assets); after?.(); }
  };
  const counter = (text: string, max: number) => <span className={`text-[11px] tabular-nums w-10 text-right flex-shrink-0 ${count(text) > max ? 'text-rose-500 font-bold' : ui.textMuted}`}>{count(text)}/{max}</span>;
  const links = (assets || []).filter(a => a.tipo === 'sitelink'), callouts = (assets || []).filter(a => a.tipo === 'destaque');
  const linkOk = link.texto.trim() && count(link.texto) <= 25 && count(link.desc1) <= 35 && count(link.desc2) <= 35 && !!link.desc1.trim() === !!link.desc2.trim() && /^https:\/\//i.test(link.url.trim());
  const row = (a: Asset) => (
    <div key={a.resource} className={`flex flex-wrap items-center justify-between gap-2 border-t ${ui.borderCol} py-1.5 text-[13px]`}>
      <div className="min-w-0">
        <span className={ui.textHead}>{a.texto}</span>{a.desc1 && <span className={`text-xs ${ui.textMuted}`}> · {a.desc1} · {a.desc2}</span>}
        <div className={`text-[11px] ${ui.textMuted}`}>{n(a.impressoes)} impressões{a.tipo === 'sitelink' ? ` · ${n(a.cliques)} cliques` : ''} em 30 dias</div>
      </div>
      <RowAction label="Tirar" busy={busy === a.resource} danger onClick={() => { if (window.confirm(`Tirar "${a.texto}" da campanha?`)) run(a.resource, 'recurso_remover', { resource: a.resource }); }} />
    </div>
  );
  return (
    <Frame title="Sitelinks e frases de destaque da campanha" onClose={onClose} ui={ui}>
      {error ? <div className="text-xs text-rose-500">{error}</div> : !assets ? <div className={`text-xs ${ui.textMuted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> lendo no Google…</div> : (
        <div className="grid lg:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <div className={`text-xs font-bold ${ui.textHead} mb-1`}>Sitelinks ({links.length})</div>
            {links.length ? links.map(row) : <div className={`text-xs ${ui.textMuted}`}>Nenhum sitelink na campanha.</div>}
            <div className="space-y-1.5 mt-3">
              <div className="flex items-center gap-2"><input value={link.texto} onChange={e => setLink({ ...link, texto: e.target.value })} placeholder="Texto do sitelink" aria-label="Texto do sitelink" className={`${s.input} flex-1 min-w-0`} />{counter(link.texto, 25)}</div>
              <div className="flex items-center gap-2"><input value={link.desc1} onChange={e => setLink({ ...link, desc1: e.target.value })} placeholder="Linha 1 da descrição (opcional)" aria-label="Linha 1 da descrição" className={`${s.input} flex-1 min-w-0`} />{counter(link.desc1, 35)}</div>
              <div className="flex items-center gap-2"><input value={link.desc2} onChange={e => setLink({ ...link, desc2: e.target.value })} placeholder="Linha 2 da descrição (opcional)" aria-label="Linha 2 da descrição" className={`${s.input} flex-1 min-w-0`} />{counter(link.desc2, 35)}</div>
              <input value={link.url} onChange={e => setLink({ ...link, url: e.target.value })} placeholder="https://… página do sitelink" aria-label="Página do sitelink" className={`${s.input} w-full`} />
              <button onClick={() => run('link', 'recurso_novo', { tipo: 'sitelink', ...link }, () => setLink({ texto: '', desc1: '', desc2: '', url: link.url }))} disabled={!!busy || !linkOk} className={s.solid}>{busy === 'link' && <Loader2 size={13} className="animate-spin" />} Incluir sitelink</button>
            </div>
          </div>
          <div>
            <div className={`text-xs font-bold ${ui.textHead} mb-1`}>Frases de destaque ({callouts.length})</div>
            {callouts.length ? callouts.map(row) : <div className={`text-xs ${ui.textMuted}`}>Nenhuma frase de destaque na campanha.</div>}
            <div className="flex items-center gap-2 mt-3">
              <input value={callout} onChange={e => setCallout(e.target.value)} placeholder="Frase de destaque" aria-label="Frase de destaque" className={`${s.input} flex-1 min-w-0`} />{counter(callout, 25)}
              <button onClick={() => run('callout', 'recurso_novo', { tipo: 'destaque', texto: callout }, () => setCallout(''))} disabled={!!busy || !callout.trim() || count(callout) > 25} className={s.solid}>{busy === 'callout' && <Loader2 size={13} className="animate-spin" />} Incluir</button>
            </div>
          </div>
        </div>
      )}
      <div className={`text-[11px] ${ui.textMuted}`}>Valem para a campanha inteira, não para um anúncio só. O Google só mostra sitelinks quando há pelo menos 2. Para mudar um texto, inclua o novo e tire o antigo. Aqui aparecem só os da campanha: os que estão no nível da conta ou do grupo não entram na lista.</div>
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
