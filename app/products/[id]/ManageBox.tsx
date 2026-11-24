"use client";

import React, { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Loader2, Plus, X } from 'lucide-react';
import type { Ui } from '@/app/components/metrics/ColumnPicker';
import { SweepPicker, type PickKind } from '@/app/components/SweepPicker';
import { currentPages, planOf, validPage, type PagePlace } from '@/lib/googleAds/pageUrl';
import { AiWriter, KeywordsField, parseKeywords, keywordProblem, type AssetPick, type Match } from './NewGroupParts';

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

/** Marcação do nome da campanha ([BP], [WL]…), para já vir no campo de busca das sugestões. */
const tagOf = (name?: string) => (String(name || '').match(/\[[^\]]+\]/) || [''])[0];
const symbolOf = (currency: string) => (currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : 'US$');
/** Vendeu (verde, com o CPA) ou gastou sem vender (vermelho). */
function SaleTag({ conversoes, custo, symbol }: { conversoes: number; custo: number; symbol: string }) {
  const money = (v: number) => `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return conversoes > 0
    ? <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-pos/10 text-pos">{(Math.round(conversoes * 10) / 10).toLocaleString('pt-BR')} {conversoes === 1 ? 'conversão' : 'conversões'}{custo > 0 ? ` · CPA ${money(custo / conversoes)}` : ''}</span>
    : <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-neg/10 text-neg">sem conversão{custo > 0 ? ` · gastou ${money(custo)}` : ''}</span>;
}

const count = (text: string) => [...String(text || '').replace(/\{KeyWord:([^}]*)\}/gi, '$1')].length;

function styles(ui: Ui) {
  const { isDark, borderCol } = ui;
  return {
    box: `${ui.bgCard} border rounded-xl p-4 space-y-3`,
    input: `rounded-lg border ${borderCol} px-3 py-1.5 text-[13px] outline-none focus:border-brand bg-surface-2 text-ink`,
    solid: 'bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5',
    ghost: `px-3 py-1.5 rounded-lg border text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5 border-line-strong text-ink hover:border-brand`,
  };
}

/** O botão "+ …" da barra da tabela. */
export function AddButton({ label, onClick, ui }: { label: string; onClick: () => void; ui: Ui }) {
  return <button onClick={onClick} className={styles(ui).solid}><Plus size={13} /> {label}</button>;
}
/** Ação de uma linha da tabela, como link. */
export function RowAction({ label, onClick, busy, danger }: { label: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return <button onClick={onClick} disabled={busy} className={`text-xs font-semibold hover:underline disabled:opacity-40 whitespace-nowrap ${danger ? 'text-warn' : 'text-brand-text'}`}>{busy ? '…' : label}</button>;
}
export function ResultLine({ result }: { result: Result }) {
  return result ? <div className={`text-xs ${result.ok ? 'text-pos' : 'text-neg'}`}>{result.text}</div> : null;
}
function Frame({ title, onClose, ui, children }: { title: string; onClose: () => void; ui: Ui; children: React.ReactNode }) {
  return (
    <div className={styles(ui).box}>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-sm font-semibold ${ui.textHead}`}>{title}</div>
        <button onClick={onClose} aria-label="Fechar" className={`${ui.textMuted} hover:text-brand-text`}><X size={15} /></button>
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

/** Põe o texto no lugar de `atual`, ou na primeira vaga livre. Sem vaga, devolve null. */
function placeIn(list: string[], text: string, atual?: string): string[] | null {
  let at = atual ? list.findIndex(t => t.trim().toLowerCase() === atual.trim().toLowerCase()) : -1;
  if (at < 0) at = list.findIndex(t => !t.trim());
  return at < 0 ? null : list.map((x, j) => (j === at ? text : x));
}
/** Clicar num texto que já está no anúncio tira; senão põe na primeira vaga livre. */
function toggleIn(list: string[], text: string): string[] | null {
  const at = list.findIndex(t => t.trim().toLowerCase() === text.trim().toLowerCase());
  return at >= 0 ? list.map((x, j) => (j === at ? '' : x)) : placeIn(list, text);
}
/** Preenche as vagas vazias com os textos que ainda não estão no anúncio, na ordem. */
function fillEmpty(list: string[], candidates: string[]): string[] {
  const have = new Set(list.map(t => t.trim().toLowerCase()).filter(Boolean));
  const queue = candidates.filter(t => !have.has(t.trim().toLowerCase()));
  return list.map(x => (x.trim() ? x : queue.shift() || ''));
}

/** A página e os caminhos do anúncio ativo mais comum da campanha: é o ponto de partida de um anúncio novo. */
function useUsualAd(manage: Manage, productId: string, enabled: boolean) {
  const [usual, setUsual] = useState<{ url: string; caminho1: string; caminho2: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    manage.call(`/api/google-ads/manage?product_id=${productId}&ver=anuncios`).then(({ ok, body }) => {
      const ads: any[] = ok && Array.isArray(body.ads) ? body.ads.filter((a: any) => a.url) : [];
      if (!ads.length) return;
      const pool = ads.some(a => a.status === 'ENABLED') ? ads.filter(a => a.status === 'ENABLED') : ads;
      const tally = new Map<string, number>();
      for (const a of pool) tally.set(a.url, (tally.get(a.url) || 0) + 1);
      const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const ad = pool.find(a => a.url === best);
      setUsual({ url: best, caminho1: ad?.caminho1 || '', caminho2: ad?.caminho2 || '' });
    });
  }, [enabled, productId]); // eslint-disable-line react-hooks/exhaustive-deps
  return usual;
}

/** Títulos, descrições, página e caminhos do anúncio, com a varredura das campanhas parecidas. */
function AdFields({ manage, ui, campaignName, titles, setTitles, descs, setDescs, url, setUrl, path1, setPath1, path2, setPath2, onToggle, stat }: {
  manage: Manage; ui: Ui; campaignName?: string;
  titles: string[]; setTitles: (l: string[]) => void; descs: string[]; setDescs: (l: string[]) => void;
  url: string; setUrl: (v: string) => void; path1: string; setPath1: (v: string) => void; path2: string; setPath2: (v: string) => void;
  onToggle: (kind: 'titulo' | 'descricao', text: string) => void; stat?: (text: string) => React.ReactNode;
}) {
  const s = styles(ui);
  const filledTitles = titles.filter(t => t.trim()), filledDescs = descs.filter(t => t.trim());
  const set = (list: string[], apply: (l: string[]) => void, i: number, v: string) => apply(list.map((x, j) => (j === i ? v : x)));
  const counter = (text: string, max: number) => <span className={`text-[11px] tabular-nums w-10 text-right flex-shrink-0 ${count(text) > max ? 'text-neg font-medium' : ui.textMuted}`}>{count(text)}/{max}</span>;
  const freeSlot = (kind: PickKind) => !(kind === 'titulo' ? titles : descs).some(t => !t.trim());
  return (
    <>
      <SweepPicker api={manage.call} initial={tagOf(campaignName)} kinds="textos" symbol={symbolOf(manage.currency)}
        isOn={(kind, text) => (kind === 'titulo' ? titles : descs).some(t => t.trim().toLowerCase() === text.toLowerCase())}
        full={freeSlot} onPick={(kind, item) => onToggle(kind as 'titulo' | 'descricao', item.texto)} />
      <div className="grid lg:grid-cols-2 gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <div className={`text-xs font-medium ${ui.textHead}`}>Títulos ({filledTitles.length} de 15, mínimo 3)</div>
          {titles.map((t, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <input value={t} onChange={e => set(titles, setTitles, i, e.target.value)} placeholder={`Título ${i + 1}`} aria-label={`Título ${i + 1}`} className={`${s.input} flex-1 min-w-0`} />{counter(t, 30)}
              </div>
              {stat?.(t)}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className={`text-xs font-medium ${ui.textHead}`}>Descrições ({filledDescs.length} de 4, mínimo 2)</div>
          {descs.map((t, i) => (
            <div key={i}>
              <div className="flex items-start gap-2">
                <textarea value={t} onChange={e => set(descs, setDescs, i, e.target.value)} rows={2} placeholder={`Descrição ${i + 1}`} aria-label={`Descrição ${i + 1}`} className={`${s.input} flex-1 min-w-0`} />{counter(t, 90)}
              </div>
              {stat?.(t)}
            </div>
          ))}
          <div className={`text-xs font-medium pt-2 ${ui.textHead}`}>Página do anúncio</div>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… (com os parâmetros de rastreamento)" aria-label="Página do anúncio" className={`${s.input} w-full`} />
          <div className="flex items-center gap-2">
            <span className={`text-xs ${ui.textMuted}`}>Caminho</span>
            <input value={path1} onChange={e => setPath1(e.target.value)} placeholder="caminho 1" aria-label="Caminho 1" className={`${s.input} w-32`} />{counter(path1, 15)}
            <input value={path2} onChange={e => setPath2(e.target.value)} placeholder="caminho 2" aria-label="Caminho 2" className={`${s.input} w-32`} />{counter(path2, 15)}
          </div>
        </div>
      </div>
    </>
  );
}
/** O que falta para o anúncio poder ser criado. */
function adMissing(titles: string[], descs: string[], url: string, path1: string, path2: string): string {
  const ft = titles.filter(t => t.trim()), fd = descs.filter(t => t.trim());
  const tooLong = titles.some(t => count(t) > 30) || descs.some(t => count(t) > 90) || count(path1) > 15 || count(path2) > 15;
  return ft.length < 3 ? 'Faltam títulos: o anúncio precisa de pelo menos 3.' : fd.length < 2 ? 'Faltam descrições: o anúncio precisa de pelo menos 2.'
    : new Set(ft.map(t => t.trim().toLowerCase())).size !== ft.length ? 'Há títulos repetidos.'
    : !/^https:\/\//i.test(url.trim()) ? 'A página precisa começar com https://' : tooLong ? 'Há texto acima do limite de letras.' : '';
}
const pad = (list: string[], size: number) => [...list, ...Array(Math.max(0, size - list.length)).fill('')].slice(0, size);

// ── Grupo novo, cópia de grupo e nome do grupo ───────────────────────────────

export function GroupForm({ manage, ui, productId, campaignName, copyFrom, rename, onClose, onDone }: { manage: Manage; ui: Ui; productId: string; campaignName?: string; copyFrom?: ManageGroup; rename?: ManageGroup; onClose: () => void; onDone: () => void }) {
  const s = styles(ui);
  const fresh = !rename && !copyFrom;
  const [name, setName] = useState(rename ? rename.nome : copyFrom ? `${copyFrom.nome} (cópia)` : '');
  const [target, setTarget] = useState('');
  const [copy, setCopy] = useState(!!copyFrom);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const symbol = manage.currency === 'BRL' ? 'R$' : manage.currency === 'EUR' ? '€' : 'US$';
  // Grupo novo: palavras-chave, anúncio e (opcional) sitelinks e frases de destaque do próprio grupo.
  const [kwText, setKwText] = useState('');
  const [plain, setPlain] = useState<Match>('PHRASE');
  const [titles, setTitles] = useState<string[]>(pad([], 15));
  const [descs, setDescs] = useState<string[]>(pad([], 4));
  const [url, setUrl] = useState('');
  const [path1, setPath1] = useState('');
  const [path2, setPath2] = useState('');
  const [assets, setAssets] = useState<AssetPick[]>([]);
  const [linkDraft, setLinkDraft] = useState({ texto: '', desc1: '', desc2: '' });
  const [calloutDraft, setCalloutDraft] = useState('');
  const [note, setNote] = useState('');
  const usual = useUsualAd(manage, productId, fresh);
  useEffect(() => { if (usual && !url) { setUrl(usual.url); setPath1(p => p || usual.caminho1); setPath2(p => p || usual.caminho2); } }, [usual]); // eslint-disable-line react-hooks/exhaustive-deps

  const keywords = parseKeywords(kwText, plain);
  const kwProblem = keywords.map(k => keywordProblem(k.text)).find(Boolean);
  const adGap = adMissing(titles, descs, url, path1, path2);
  const linkCount = assets.filter(a => a.tipo === 'sitelink').length;
  const missing = !name.trim() ? 'Dê um nome ao grupo.' : !fresh ? ''
    : !keywords.length ? 'Inclua pelo menos uma palavra-chave.' : kwProblem ? `Palavra-chave ${kwProblem}.` : adGap ? `Anúncio: ${adGap}` : '';

  const toggle = (kind: 'titulo' | 'descricao', text: string) => {
    const [list, apply] = kind === 'titulo' ? [titles, setTitles] as const : [descs, setDescs] as const;
    const next = toggleIn(list, text);
    if (next) { apply(next); setNote(''); } else setNote(`Não há vaga livre para ${kind === 'titulo' ? 'outro título' : 'outra descrição'}: apague um antes.`);
  };
  const assetKey = (a: AssetPick) => `${a.tipo}|${a.texto.trim().toLowerCase()}`;
  const isAssetOn = (a: AssetPick) => assets.some(x => assetKey(x) === assetKey(a));
  const toggleAsset = (a: AssetPick) => setAssets(list => (list.some(x => assetKey(x) === assetKey(a)) ? list.filter(x => assetKey(x) !== assetKey(a)) : [...list, a]));
  const linkOk = linkDraft.texto.trim() && count(linkDraft.texto) <= 25 && count(linkDraft.desc1) <= 35 && count(linkDraft.desc2) <= 35 && !!linkDraft.desc1.trim() === !!linkDraft.desc2.trim();

  const submit = async () => {
    setBusy(true); setResult(null);
    const page = url.trim();
    const r = rename ? await manage.send('grupo_nome', { group_id: rename.id, name })
      : await manage.send('grupo_novo', {
        name, target: Number(target.replace(',', '.')) || null, copy_from: copy && copyFrom ? copyFrom.id : null, paused,
        ...(fresh ? {
          keywords: keywords.map(k => ({ text: k.text, match: k.match })),
          ad: { titulos: titles.filter(t => t.trim()), descricoes: descs.filter(t => t.trim()), url: page, caminho1: path1.trim(), caminho2: path2.trim() },
          assets: assets.map(a => ({ ...a, url: page })),
        } : {}),
      });
    setBusy(false);
    setResult({ ok: r.ok, text: r.ok ? `${rename ? 'Grupo renomeado' : 'Grupo criado'}: ${r.text}.${!rename && copy ? ' As palavras-chave e os anúncios copiados aparecem nas abas na próxima coleta (até 1 hora).' : ''}${fresh ? ' O Google ainda vai analisar o anúncio.' : ''}` : r.text });
    if (r.ok) { await manage.loadGroups(); onDone(); }
  };
  const step = (n: number, title: string, hint?: string) => (
    <div className={`flex flex-wrap items-baseline gap-2 border-t ${ui.borderCol} pt-3`}>
      <span className="text-xs font-semibold text-brand-text">{n}.</span>
      <span className={`text-[13px] font-semibold ${ui.textHead}`}>{title}</span>
      {hint && <span className={`text-[11px] ${ui.textMuted}`}>{hint}</span>}
    </div>
  );
  const counter = (text: string, max: number) => <span className={`text-[11px] tabular-nums w-10 text-right flex-shrink-0 ${count(text) > max ? 'text-neg font-medium' : ui.textMuted}`}>{count(text)}/{max}</span>;

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
      {!rename && <div className={`text-[11px] ${ui.textMuted}`}>Meta em branco: {copyFrom ? `usa a do grupo copiado${copyFrom.meta_cpa ? ` (${symbol} ${copyFrom.meta_cpa.toFixed(2).replace('.', ',')})` : ', que segue a da campanha'}` : 'o grupo segue a meta da campanha'}. A meta do grupo só vale se a campanha também tiver meta de CPA.</div>}

      {fresh && (
        <>
          {step(1, 'Palavras-chave', 'obrigatório: pelo menos uma')}
          <KeywordsField call={manage.call} productId={productId} ui={ui} cls={s} text={kwText} setText={setKwText} plain={plain} setPlain={setPlain} />

          {step(2, 'Anúncio', 'obrigatório: 3 a 15 títulos e 2 a 4 descrições')}
          <AiWriter call={manage.call} ui={ui} cls={s} campaignName={campaignName} url={url} keywords={[...new Set(keywords.map(k => k.text))]}
            isOn={(kind, text) => (kind === 'titulo' ? titles : descs).some(t => t.trim().toLowerCase() === text.toLowerCase())}
            onPick={toggle} onFill={(t, d) => { setTitles(fillEmpty(titles, t)); setDescs(fillEmpty(descs, d)); }}
            assets="grupo" isAssetOn={isAssetOn} onToggleAsset={toggleAsset} />
          {note && <div className="text-xs text-warn">{note}</div>}
          <AdFields manage={manage} ui={ui} campaignName={campaignName} titles={titles} setTitles={setTitles} descs={descs} setDescs={setDescs}
            url={url} setUrl={setUrl} path1={path1} setPath1={setPath1} path2={path2} setPath2={setPath2} onToggle={toggle} />

          {step(3, 'Sitelinks e frases de destaque do grupo', 'opcional')}
          {assets.length > 0 && (
            <div>
              {assets.map(a => (
                <div key={assetKey(a)} className={`flex items-center justify-between gap-2 border-t ${ui.borderCol} py-1.5 text-[13px]`}>
                  <span className={ui.textHead}><span className={`text-[11px] ${ui.textMuted}`}>{a.tipo === 'sitelink' ? 'Sitelink' : 'Frase de destaque'}:</span> {a.texto}{a.desc1 ? <span className={`text-xs ${ui.textMuted}`}> · {a.desc1} · {a.desc2}</span> : null}</span>
                  <RowAction label="Tirar" danger onClick={() => toggleAsset(a)} />
                </div>
              ))}
            </div>
          )}
          <div className="grid lg:grid-cols-2 gap-x-6 gap-y-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2"><input value={linkDraft.texto} onChange={e => setLinkDraft({ ...linkDraft, texto: e.target.value })} placeholder="Texto do sitelink" aria-label="Texto do sitelink" className={`${s.input} flex-1 min-w-0`} />{counter(linkDraft.texto, 25)}</div>
              <div className="flex items-center gap-2"><input value={linkDraft.desc1} onChange={e => setLinkDraft({ ...linkDraft, desc1: e.target.value })} placeholder="Linha 1 (opcional)" aria-label="Linha 1 do sitelink" className={`${s.input} flex-1 min-w-0`} />{counter(linkDraft.desc1, 35)}</div>
              <div className="flex items-center gap-2"><input value={linkDraft.desc2} onChange={e => setLinkDraft({ ...linkDraft, desc2: e.target.value })} placeholder="Linha 2 (opcional)" aria-label="Linha 2 do sitelink" className={`${s.input} flex-1 min-w-0`} />{counter(linkDraft.desc2, 35)}</div>
              <button type="button" disabled={!linkOk} onClick={() => { toggleAsset({ tipo: 'sitelink', texto: linkDraft.texto.trim(), desc1: linkDraft.desc1.trim(), desc2: linkDraft.desc2.trim() }); setLinkDraft({ texto: '', desc1: '', desc2: '' }); }} className={s.ghost}>+ Sitelink</button>
            </div>
            <div className="flex items-start gap-2">
              <input value={calloutDraft} onChange={e => setCalloutDraft(e.target.value)} placeholder="Frase de destaque" aria-label="Frase de destaque" className={`${s.input} flex-1 min-w-0`} />{counter(calloutDraft, 25)}
              <button type="button" disabled={!calloutDraft.trim() || count(calloutDraft) > 25} onClick={() => { toggleAsset({ tipo: 'destaque', texto: calloutDraft.trim(), desc1: '', desc2: '' }); setCalloutDraft(''); }} className={s.ghost}>+ Frase</button>
            </div>
          </div>
          <SweepPicker api={manage.call} initial={tagOf(campaignName)} kinds="recursos" symbol={symbolOf(manage.currency)}
            isOn={(kind, text) => assets.some(a => a.tipo === kind && a.texto.toLowerCase() === text.toLowerCase())}
            onPick={(kind, item) => toggleAsset(kind === 'sitelink' ? { tipo: 'sitelink', texto: item.texto, desc1: item.desc1 || '', desc2: item.desc2 || '' } : { tipo: 'destaque', texto: item.texto, desc1: '', desc2: '' })} />
          <div className={`text-[11px] ${ui.textMuted}`}>
            Os sitelinks e as frases daqui ficam só neste grupo e abrem a página do anúncio. Quando o grupo tem os próprios, o Google mostra os do grupo no lugar dos da campanha.
            {linkCount === 1 ? ' O Google só mostra sitelinks quando há pelo menos 2.' : ''} Sem nenhum aqui, o grupo usa os da campanha.
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3 border-transparent">
        <button onClick={submit} disabled={busy || !!missing} className={s.solid}>{busy && <Loader2 size={13} className="animate-spin" />} {rename ? 'Renomear' : fresh ? `Criar grupo com ${keywords.length} ${keywords.length === 1 ? 'palavra-chave' : 'palavras-chave'} e o anúncio` : 'Criar grupo'}</button>
        <button onClick={onClose} className={s.ghost}>{result?.ok ? 'Fechar' : 'Cancelar'}</button>
        {missing && <span className="text-xs text-warn">{missing}</span>}
      </div>
      {fresh && <div className={`text-[11px] ${ui.textMuted}`}>Vai tudo num pedido só ao Google: grupo, palavras-chave, anúncio{assets.length ? ', sitelinks e frases' : ''}. Se ele recusar qualquer parte, nada é criado e o motivo aparece aqui.</div>}
      <ResultLine result={result} />
    </Frame>
  );
}

// ── Palavras-chave novas (também a partir de um termo de pesquisa) ───────────

/**
 * `list` e `onList` deixam a lista nas mãos de quem abriu o formulário: na aba de termos, cada clique em
 * "+ Palavra-chave" junta mais um termo à lista, e o pedido ao Google é um só.
 */
export function KeywordForm({ manage, ui, initial, list, onList, groupId, onClose, onDone }: { manage: Manage; ui: Ui; initial?: string; list?: string; onList?: (text: string) => void; groupId?: string; onClose: () => void; onDone: () => void }) {
  const s = styles(ui);
  const [own, setOwn] = useState(initial || '');
  const fromTerms = list !== undefined;
  const text = fromTerms ? list : own;
  const setText = (v: string) => (onList ? onList(v) : setOwn(v));
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
    setResult({ ok: r.ok, text: r.ok ? `${lines.length > 1 ? 'Incluídas' : 'Incluída'}: ${r.text}${r.body.skipped ? `. ${r.body.skipped} já ${r.body.skipped === 1 ? 'estava' : 'estavam'} no grupo.` : ''}` : r.text });
    if (r.ok) { setText(''); onDone(); }
  };
  return (
    <Frame title={fromTerms ? `Incluir termos como palavras-chave${lines.length ? ` · ${lines.length} na lista` : ''}` : initial ? 'Incluir o termo como palavra-chave' : 'Novas palavras-chave'} onClose={onClose} ui={ui}>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={fromTerms ? Math.min(10, Math.max(2, text.split('\n').length)) : initial ? 1 : 3} placeholder="Uma palavra-chave por linha" aria-label="Palavras-chave novas" className={`${s.input} w-full font-mono`} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={match} onChange={e => setMatch(e.target.value)} aria-label="Tipo de correspondência" className={s.input}>
          <option value="PHRASE">Frase: &quot;palavra&quot;</option><option value="EXACT">Exata: [palavra]</option><option value="BROAD">Ampla: palavra</option>
        </select>
        <GroupSelect groups={manage.groups} value={group} onChange={setGroup} cls={`${s.input} max-w-[260px]`} />
        <button onClick={submit} disabled={busy || !lines.length || !group} className={s.solid}>{busy && <Loader2 size={13} className="animate-spin" />} Incluir {lines.length > 1 ? `${lines.length} palavras-chave` : 'palavra-chave'}</button>
      </div>
      <div className={`text-[11px] ${ui.textMuted}`}>{fromTerms ? 'Clique em "+ Palavra-chave" em outros termos da tabela para juntar à lista, ou escreva uma por linha, e peça tudo de uma vez. ' : ''}Escreva só o texto, sem aspas nem colchetes: o tipo escolhido cuida disso. A palavra-chave entra ativa.</div>
      <ResultLine result={result} />
    </Frame>
  );
}

// ── Anúncio: novo, cópia ou edição, com a ajuda da IA ────────────────────────

export interface AdSeed { titulos: string[]; descricoes: string[]; url: string; caminho1: string; caminho2: string; group_id: string }
interface TextStat { impressoes: number; cliques: number; conversoes: number; custo?: number; nota: string | null; pin: string | null }
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
export function AdForm({ manage, ui, productId, campaignName, mode, seed, adKey, onClose, onDone }: { manage: Manage; ui: Ui; productId: string; campaignName?: string; mode: 'novo' | 'copia' | 'editar'; seed?: AdSeed; adKey?: string; onClose: () => void; onDone: () => void }) {
  const s = styles(ui);
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
  const usual = useUsualAd(manage, productId, mode === 'novo');
  // As palavras-chave ativas de cada grupo: a IA escreve para as do grupo escolhido.
  const [kwByGroup, setKwByGroup] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (mode === 'editar') return;
    manage.call(`/api/google-ads/manage?product_id=${productId}&ver=palavras`).then(({ ok, body }) => {
      if (ok && Array.isArray(body.groups)) setKwByGroup(Object.fromEntries(body.groups.map((g: any) => [g.id, g.palavras.filter((p: any) => p.status === 'ENABLED').map((p: any) => String(p.texto))])));
    });
  }, [mode, productId]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupKeywords = [...new Set(kwByGroup[group] || [])];
  useEffect(() => { if (usual && !url) { setUrl(usual.url); setPath1(p => p || usual.caminho1); setPath2(p => p || usual.caminho2); } }, [usual]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!adKey) return;
    manage.call(`/api/google-ads/manage?product_id=${productId}&ver=anuncio&ad=${adKey}`).then(({ ok, body }) => {
      if (!ok || !body.ad) { setStats(new Map()); return; }
      const map = new Map<string, TextStat>();
      for (const t of [...body.ad.titulos, ...body.ad.descricoes]) map.set(String(t.texto).trim().toLowerCase(), t);
      setStats(map); setHasNumbers(!!body.ad.tem_numeros); setCanAi(!!body.ai);
      if (body.ad.aviso) setAiError(`O Google não entregou os números por texto: ${body.ad.aviso}`);
      // Em edição vale o que está no Google agora, não o que a coleta guardou.
      if (mode === 'editar') { setTitles(pad(body.ad.titulos.map((t: any) => t.texto), 15)); setDescs(pad(body.ad.descricoes.map((t: any) => t.texto), 4)); setUrl(body.ad.url); setPath1(body.ad.caminho1); setPath2(body.ad.caminho2); }
    });
  }, [adKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filledTitles = titles.filter(t => t.trim()), filledDescs = descs.filter(t => t.trim());
  const missing = adMissing(titles, descs, url, path1, path2);
  const NOTE_TONE: Record<string, string> = { melhor: 'text-pos', bom: 'text-pos', baixo: 'text-neg' };
  const maxImp = stats ? Math.max(0, ...[...stats.values()].map(x => x.impressoes)) : 0;
  const stat = (text: string) => {
    const st = stats?.get(text.trim().toLowerCase());
    if (!text.trim()) return null;
    if (!st) return adKey && stats ? <div className="text-[11px] text-brand-text">texto novo</div> : null;
    const weak = hasNumbers && maxImp >= 200 && st.impressoes < maxImp * 0.1;
    return (
      <div className={`text-[11px] ${ui.textMuted} flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5`}>
        {hasNumbers && st.impressoes > 0 && <SaleTag conversoes={st.conversoes} custo={st.custo || 0} symbol={symbolOf(manage.currency)} />}
        {hasNumbers ? `${n(st.impressoes)} impressões · ${n(st.cliques)} cliques em 30 dias` : 'sem números ainda'}
        {st.nota && <span className={`ml-1.5 font-medium ${NOTE_TONE[st.nota] || ''}`}>· Google: {st.nota}</span>}
        {!st.nota && weak && <span className="ml-1.5 font-medium text-warn">· pouco mostrado</span>}
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
    const next = placeIn(list, novo, atual);
    if (!next) { setAiError(`Não há vaga livre para ${tipo === 'titulo' ? 'outro título' : 'outra descrição'}: apague um antes.`); return; }
    apply(next);
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
  const pickText = (kind: 'titulo' | 'descricao', text: string) => {
    const [list, apply] = kind === 'titulo' ? [titles, setTitles] as const : [descs, setDescs] as const;
    const next = toggleIn(list, text);
    if (next) apply(next); else setAiError(`Não há vaga livre para ${kind === 'titulo' ? 'outro título' : 'outra descrição'}: apague um antes.`);
  };
  const TYPE: Record<string, string> = { titulo: 'Título', descricao: 'Descrição', sitelink: 'Sitelink', destaque: 'Frase de destaque' };
  const useLink = (label: string, onClick: () => void, text: string) => (used.includes(text) ? <span className="text-xs text-pos whitespace-nowrap">feito</span> : <RowAction label={label} onClick={onClick} />);

  return (
    <Frame title={mode === 'editar' ? 'Editar o anúncio' : mode === 'copia' ? 'Duplicar o anúncio: mude o que quiser antes de criar' : 'Novo anúncio de pesquisa'} onClose={onClose} ui={ui}>
      {adKey && (
        <div className={`rounded-lg border ${ui.borderCol} p-3 space-y-2`}>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={askAi} disabled={asking || !canAi} className={s.ghost}>{asking && <Loader2 size={13} className="animate-spin" />} {asking ? 'A IA está lendo o anúncio…' : advice ? 'Pedir outra leitura à IA' : 'Pedir à IA o que melhorar'}</button>
            <span className={`text-[11px] ${ui.textMuted}`}>{!stats ? 'lendo o desempenho de cada texto no Google…' : !canAi ? 'A IA está desligada no servidor.' : hasNumbers ? 'Ela vê as impressões e os cliques de cada texto nos últimos 30 dias. Só sugere: nada muda sem você salvar.' : 'O Google ainda não tem números por texto neste anúncio: a IA avalia só pela escrita.'}</span>
          </div>
          {aiError && <div className="text-xs text-neg">{aiError}</div>}
          {advice && (
            <div className="space-y-2">
              {advice.leitura && <div className={`text-[13px] ${ui.textHead}`}>{advice.leitura}</div>}
              {advice.trocas.length > 0 && <div className={`text-xs font-medium ${ui.textHead}`}>Trocar</div>}
              {advice.trocas.map((t, i) => (
                <div key={`t${i}`} className={`flex flex-wrap items-start justify-between gap-2 border-t ${ui.borderCol} pt-2 text-[13px]`}>
                  <div className="min-w-0">
                    <div className={ui.textMuted}><span className="font-medium">{TYPE[t.tipo]}:</span> <s>{t.atual}</s></div>
                    <div className={ui.textHead}>→ {t.novo} <span className={`text-[11px] ${ui.textMuted}`}>({count(t.novo)} letras)</span></div>
                    <div className={`text-[11px] ${ui.textMuted}`}>{t.pt ? `"${t.pt}". ` : ''}{t.motivo}</div>
                  </div>
                  {useLink('Usar no lugar', () => use(t.tipo, t.novo, t.atual), t.novo)}
                </div>
              ))}
              {advice.novos.length > 0 && <div className={`text-xs font-medium pt-1 ${ui.textHead}`}>Incluir</div>}
              {advice.novos.map((x, i) => (
                <div key={`n${i}`} className={`flex flex-wrap items-start justify-between gap-2 border-t ${ui.borderCol} pt-2 text-[13px]`}>
                  <div className="min-w-0">
                    <div className={ui.textHead}><span className={`font-medium ${ui.textMuted}`}>{TYPE[x.tipo]}:</span> {x.novo}{x.desc1 ? ` | ${x.desc1} | ${x.desc2}` : ''} <span className={`text-[11px] ${ui.textMuted}`}>({count(x.novo)} letras)</span></div>
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
      {mode !== 'editar' && (
        <AiWriter call={manage.call} ui={ui} cls={s} campaignName={campaignName} url={url} keywords={groupKeywords}
          isOn={(kind, text) => (kind === 'titulo' ? titles : descs).some(t => t.trim().toLowerCase() === text.toLowerCase())}
          onPick={pickText} onFill={(t, d) => { setTitles(fillEmpty(titles, t)); setDescs(fillEmpty(descs, d)); }}
          assets="campanha" onAddAsset={async a => { const r = await manage.send('recurso_novo', { ...a, url: url.trim() }); return r.ok ? null : r.text; }} />
      )}
      {mode !== 'editar' && aiError && !adKey && <div className="text-xs text-warn">{aiError}</div>}
      <AdFields manage={manage} ui={ui} campaignName={campaignName} titles={titles} setTitles={setTitles} descs={descs} setDescs={setDescs}
        url={url} setUrl={setUrl} path1={path1} setPath1={setPath1} path2={path2} setPath2={setPath2} onToggle={pickText} stat={stat} />
      <div className="flex flex-wrap items-center gap-3">
        {mode !== 'editar' && <GroupSelect groups={manage.groups} value={group} onChange={setGroup} cls={`${s.input} max-w-[260px]`} />}
        {mode !== 'editar' && <label className={`inline-flex items-center gap-1.5 text-xs cursor-pointer ${ui.textHead}`}><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> Criar pausado</label>}
        <button onClick={submit} disabled={busy || !!missing || (mode !== 'editar' && !group) || (mode === 'editar' && !stats)} className={s.solid}>{busy && <Loader2 size={13} className="animate-spin" />} {mode === 'editar' ? 'Salvar no anúncio' : 'Criar anúncio'}</button>
        <button onClick={onClose} className={s.ghost}>{result?.ok ? 'Fechar' : 'Cancelar'}</button>
        {missing && <span className="text-xs text-warn">{missing}</span>}
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

interface Asset { resource: string; tipo: 'sitelink' | 'destaque'; texto: string; desc1: string; desc2: string; url: string; impressoes: number; cliques: number; conversoes?: number; custo?: number }

export function AssetsBox({ manage, ui, productId, campaignName, defaultUrl, onClose }: { manage: Manage; ui: Ui; productId: string; campaignName?: string; defaultUrl: string; onClose: () => void }) {
  const s = styles(ui);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [link, setLink] = useState({ texto: '', desc1: '', desc2: '', url: defaultUrl });
  const [callout, setCallout] = useState('');
  useEffect(() => {
    manage.call(`/api/google-ads/manage?product_id=${productId}&ver=recursos`).then(({ ok, body }) => {
      if (ok && body.assets) { setAssets(body.assets); if (body.aviso) setResult({ ok: false, text: `O Google não entregou as impressões e os cliques: ${body.aviso}` }); }
      else setError(body.error || 'O Google não respondeu.');
    });
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, action: string, payload: Record<string, any>, after?: () => void) => {
    setBusy(key); setResult(null);
    const r = await manage.send(action, payload);
    setBusy('');
    setResult({ ok: r.ok, text: r.ok ? `Feito: ${r.text}.` : r.text });
    if (r.ok && r.body.assets) { setAssets(r.body.assets); after?.(); }
  };
  const counter = (text: string, max: number) => <span className={`text-[11px] tabular-nums w-10 text-right flex-shrink-0 ${count(text) > max ? 'text-neg font-medium' : ui.textMuted}`}>{count(text)}/{max}</span>;
  const links = (assets || []).filter(a => a.tipo === 'sitelink'), callouts = (assets || []).filter(a => a.tipo === 'destaque');
  const linkOk = link.texto.trim() && count(link.texto) <= 25 && count(link.desc1) <= 35 && count(link.desc2) <= 35 && !!link.desc1.trim() === !!link.desc2.trim() && /^https:\/\//i.test(link.url.trim());
  const row = (a: Asset) => (
    <div key={a.resource} className={`flex flex-wrap items-center justify-between gap-2 border-t ${ui.borderCol} py-1.5 text-[13px]`}>
      <div className="min-w-0">
        <span className={ui.textHead}>{a.texto}</span>{a.desc1 && <span className={`text-xs ${ui.textMuted}`}> · {a.desc1} · {a.desc2}</span>}
        <div className={`text-[11px] ${ui.textMuted} flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5`}>
          {a.impressoes > 0 && <SaleTag conversoes={a.conversoes || 0} custo={a.custo || 0} symbol={symbolOf(manage.currency)} />}
          {n(a.impressoes)} impressões{a.tipo === 'sitelink' ? ` · ${n(a.cliques)} cliques` : ''} em 30 dias
        </div>
      </div>
      <RowAction label="Tirar" busy={busy === a.resource} danger onClick={() => { if (window.confirm(`Tirar "${a.texto}" da campanha?`)) run(a.resource, 'recurso_remover', { resource: a.resource }); }} />
    </div>
  );
  return (
    <Frame title="Sitelinks e frases de destaque da campanha" onClose={onClose} ui={ui}>
      {error ? <div className="text-xs text-neg">{error}</div> : !assets ? <div className={`text-xs ${ui.textMuted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> lendo no Google…</div> : (
        <div className="grid lg:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <div className={`text-xs font-medium ${ui.textHead} mb-1`}>Sitelinks ({links.length})</div>
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
            <div className={`text-xs font-medium ${ui.textHead} mb-1`}>Frases de destaque ({callouts.length})</div>
            {callouts.length ? callouts.map(row) : <div className={`text-xs ${ui.textMuted}`}>Nenhuma frase de destaque na campanha.</div>}
            <div className="flex items-center gap-2 mt-3">
              <input value={callout} onChange={e => setCallout(e.target.value)} placeholder="Frase de destaque" aria-label="Frase de destaque" className={`${s.input} flex-1 min-w-0`} />{counter(callout, 25)}
              <button onClick={() => run('callout', 'recurso_novo', { tipo: 'destaque', texto: callout }, () => setCallout(''))} disabled={!!busy || !callout.trim() || count(callout) > 25} className={s.solid}>{busy === 'callout' && <Loader2 size={13} className="animate-spin" />} Incluir</button>
            </div>
          </div>
        </div>
      )}
      {assets && (
        <SweepPicker api={manage.call} initial={tagOf(campaignName)} kinds="recursos" symbol={symbolOf(manage.currency)}
          isOn={(kind, text) => (assets || []).some(a => a.tipo === kind && a.texto.toLowerCase() === text.toLowerCase())}
          full={kind => !!busy || (kind === 'sitelink' && !/^https:\/\//i.test((link.url || defaultUrl).trim()))}
          onPick={(kind, item) => {
            if ((assets || []).some(a => a.tipo === kind && a.texto.toLowerCase() === item.texto.toLowerCase())) return;
            run(`s${item.texto}`, 'recurso_novo', kind === 'sitelink'
              ? { tipo: 'sitelink', texto: item.texto, desc1: item.desc1 || '', desc2: item.desc2 || '', url: (link.url || defaultUrl).trim() }
              : { tipo: 'destaque', texto: item.texto });
          }} />
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
  const pill = (excluded: boolean) => `px-2 py-0.5 rounded-md text-[11px] font-medium ${excluded ? ('bg-neg/10 text-neg') : ('bg-pos/10 text-pos')}`;

  return (
    <div className={s.box}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={`text-sm font-semibold ${ui.textHead}`}>Locais da campanha no Google</div>
        <div className={`text-[11px] ${ui.textMuted}`}>lido do Google agora · a tabela abaixo mostra de onde vieram os cliques</div>
      </div>
      {error ? <div className="text-xs text-neg">{error}</div> : !locations ? <div className={`text-xs ${ui.textMuted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> lendo os locais…</div> : (
        <>
          {!included && <div className="text-xs text-warn">Nenhum local incluído: a campanha aparece no mundo todo{locations.length ? ', menos nos locais excluídos' : ''}.</div>}
          <div className="flex flex-wrap gap-2">
            {locations.map(l => (
              <span key={l.id} className={`inline-flex items-center gap-2 rounded-lg border ${ui.borderCol} px-2 py-1 text-[13px] ${ui.textHead}`}>
                <span className={pill(l.excluido)}>{l.excluido ? 'excluído' : 'incluído'}</span>{l.nome}
                <RowAction label="Tirar" busy={busy === `t${l.id}`} onClick={() => { if (window.confirm(`Tirar "${l.nome}" da campanha no Google?`)) run(`t${l.id}`, 'local_remover', { id: l.id }); }} danger />
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

// ── Trocar a página da campanha (anúncios e sitelinks de uma vez) ───────────

const STATUS_LABEL: Record<string, string> = { ENABLED: 'ativo', PAUSED: 'pausado' };

export function PageSwapBox({ manage, ui, productId, onClose, onDone }: { manage: Manage; ui: Ui; productId: string; onClose: () => void; onDone: () => void }) {
  const s = styles(ui), { call } = manage;
  const [places, setPlaces] = useState<PagePlace[] | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // A prévia vale para a página nova que estava escrita quando foi pedida; mudou o texto, pede de novo.
  const [preview, setPreview] = useState<null | { para: string; de: string; pagina: { ok: boolean; texto: string } | null }>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'' | 'previa' | 'trocar'>('');
  const [result, setResult] = useState<Result>(null);

  const load = useCallback(async (testar?: string) => {
    const { ok, body } = await call(`/api/google-ads/manage?product_id=${productId}&ver=paginas${testar ? `&testar=${encodeURIComponent(testar)}` : ''}`);
    if (!ok || !body.places) { setError(body.error || 'O Google não respondeu.'); return null; }
    setError(''); setPlaces(body.places); setAviso(body.aviso || '');
    return body as { places: PagePlace[]; pagina: { ok: boolean; texto: string } | null };
  }, [call, productId]);
  useEffect(() => { load().then(b => { if (b) setFrom(f => f || currentPages(b.places)[0]?.url || ''); }); }, [load]);

  const pages = places ? currentPages(places) : [];
  const valid = validPage(to) && to.trim() !== from.trim();
  const stale = !!preview && (preview.para !== to.trim() || preview.de !== from);

  const askPreview = async () => {
    setBusy('previa'); setResult(null); setChosen({});
    const b = await load(to.trim());
    setBusy('');
    if (b) setPreview({ para: to.trim(), de: from, pagina: b.pagina });
  };

  const rows = preview && places ? places.map(p => ({ p, plan: planOf(p, preview.de, preview.para, chosen[p.id]) })) : [];
  const changing = rows.filter(r => r.plan.muda);
  const nAds = changing.filter(r => r.p.tipo === 'anuncio').length, nLinks = changing.filter(r => r.p.tipo === 'sitelink').length;
  const shared = changing.filter(r => r.p.tipo === 'sitelink' && r.p.outros > 0).length;

  const submit = async () => {
    if (!preview) return;
    const what = [nAds && `${nAds} ${nAds === 1 ? 'anúncio' : 'anúncios'}`, nLinks && `${nLinks} ${nLinks === 1 ? 'sitelink' : 'sitelinks'}`].filter(Boolean).join(' e ');
    if (!window.confirm(`Trocar a página em ${what}?\n\nDe: ${preview.de}\nPara: ${preview.para}\n\nVai tudo num pedido só: se o Google recusar qualquer parte, nada muda.`)) return;
    setBusy('trocar'); setResult(null);
    const r = await manage.send('pagina_trocar', { de: preview.de, para: preview.para, itens: changing.map(x => ({ id: x.p.id, url: x.p.url })) });
    setBusy('');
    setResult({ ok: r.ok, text: r.ok ? `Feito: ${r.text}.` : r.text });
    if (r.ok) { onDone(); setPreview(null); setChosen({}); const b = await load(); if (b) setFrom(preview.para); setTo(''); }
  };

  const section = (tipo: PagePlace['tipo'], title: string) => {
    const list = rows.filter(r => r.p.tipo === tipo);
    if (!list.length) return <div className={`text-xs ${ui.textMuted}`}>{tipo === 'anuncio' ? 'Nenhum anúncio com página nesta campanha.' : 'A campanha não tem sitelinks.'}</div>;
    return (
      <div>
        <div className={`text-xs font-semibold ${ui.textHead} mb-1`}>{title} ({list.filter(r => r.plan.muda).length} de {list.length} mudam)</div>
        {list.map(({ p, plan }) => (
          <label key={p.id} className={`flex items-start gap-2.5 border-t ${ui.borderCol} py-2 text-[13px] ${p.editavel ? 'cursor-pointer' : 'opacity-60'}`}>
            <input type="checkbox" className="mt-1 accent-brand" checked={plan.marked} disabled={!p.editavel || busy !== ''}
              onChange={e => setChosen(c => ({ ...c, [p.id]: e.target.checked }))} aria-label={`Trocar a página de ${p.nome}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className={`font-medium ${ui.textHead}`}>{p.nome}</span>
                <span className={`text-[11px] ${ui.textMuted}`}>
                  {p.tipo === 'sitelink' ? (p.nivel === 'grupo' ? `sitelink do grupo ${p.grupo}` : 'sitelink da campanha') : `grupo ${p.grupo}`}
                  {STATUS_LABEL[p.status] && p.status !== 'ENABLED' ? ` · ${STATUS_LABEL[p.status]}` : ''}
                </span>
              </div>
              {plan.muda ? (
                <div className="mt-0.5 space-y-0.5 font-mono text-[11.5px] break-all">
                  <div className={`${ui.textMuted} line-through`}>{p.url}</div>
                  <div className="text-pos">→ {plan.depois}</div>
                  {p.celular && plan.celular !== p.celular && <div className={ui.textMuted}>celular: {plan.celular}</div>}
                </div>
              ) : (
                <div className={`mt-0.5 font-mono text-[11.5px] break-all ${ui.textMuted}`}>{p.url}</div>
              )}
              <div className={`text-[11px] mt-0.5 ${ui.textMuted}`}>
                {!p.editavel ? p.motivo
                  : !plan.muda && p.url === preview?.para ? 'Já está na página nova.'
                  : !plan.marked && !plan.same ? 'Outra página: fica como está. Marque para trocar pela página nova inteira.'
                  : !plan.marked ? 'Desmarcado: fica como está.'
                  : plan.muda && p.tipo === 'sitelink' && p.outros > 0 ? `Este sitelink também está em ${p.outros} ${p.outros === 1 ? 'outro lugar' : 'outros lugares'} (outra campanha, grupo ou a conta): aqui entra um sitelink novo igual, só com a página nova; o de lá fica como está e os números deste recomeçam.`
                  : plan.muda && plan.depois !== preview?.para ? 'Manteve o que é próprio dele (âncora ou parâmetro).' : ''}
              </div>
            </div>
          </label>
        ))}
      </div>
    );
  };

  return (
    <Frame title="Trocar a página da campanha" onClose={onClose} ui={ui}>
      <div className={`text-xs ${ui.textMuted}`}>Troca a página nos anúncios e nos sitelinks ao mesmo tempo, num pedido só ao Google: entra tudo ou nada.</div>
      {error && <div className="text-xs text-neg">{error}</div>}
      {!places && !error && <div className={`text-xs ${ui.textMuted} inline-flex items-center gap-1.5`}><Loader2 size={13} className="animate-spin" /> Lendo os anúncios e sitelinks no Google…</div>}
      {places && (
        <div className="space-y-2">
          <div>
            <div className={`text-xs font-medium ${ui.textMuted} mb-1`}>Página de hoje</div>
            <select value={from} onChange={e => setFrom(e.target.value)} aria-label="Página de hoje" className={`${s.input} w-full font-mono text-[12px]`}>
              {pages.map(pg => <option key={pg.url} value={pg.url}>{pg.url} ({pg.total} {pg.total === 1 ? 'anúncio' : 'anúncios'}{pg.ativos !== pg.total ? `, ${pg.ativos} ativos` : ''})</option>)}
            </select>
          </div>
          <div>
            <div className={`text-xs font-medium ${ui.textMuted} mb-1`}>Página nova</div>
            <div className="flex flex-wrap gap-2">
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="https://… (com os parâmetros de rastreamento)" aria-label="Página nova" className={`${s.input} flex-1 min-w-[260px] font-mono text-[12px]`} />
              <button onClick={askPreview} disabled={!valid || busy !== ''} className={s.solid}>{busy === 'previa' && <Loader2 size={13} className="animate-spin" />} Ver prévia</button>
            </div>
            {to.trim() && !validPage(to) && <div className="text-xs text-neg mt-1">A página precisa começar com https:// e não pode ter espaços.</div>}
            {to.trim() && to.trim() === from.trim() && <div className="text-xs text-neg mt-1">É a mesma página de hoje.</div>}
          </div>
          {aviso && <div className="text-xs text-warn">{aviso}</div>}
        </div>
      )}
      {preview && !stale && (
        <div className="space-y-3">
          {preview.pagina && <div className={`text-xs ${preview.pagina.ok ? 'text-pos' : 'text-warn'}`}>{preview.pagina.texto}</div>}
          {section('anuncio', 'Anúncios')}
          {section('sitelink', 'Sitelinks')}
          <div className={`border-t ${ui.borderCol} pt-3 flex flex-wrap items-center justify-between gap-3`}>
            <div className={`text-xs ${ui.textMuted} max-w-[60ch]`}>
              {changing.length ? <>Vai mudar: <b className={ui.textHead}>{nAds} {nAds === 1 ? 'anúncio' : 'anúncios'}</b> e <b className={ui.textHead}>{nLinks} {nLinks === 1 ? 'sitelink' : 'sitelinks'}</b>{shared ? ` (${shared} como sitelink novo)` : ''}. Cada anúncio trocado volta para a análise do Google; os números dele continuam.</> : 'Nada marcado para mudar.'}
            </div>
            <button onClick={submit} disabled={!changing.length || busy !== ''} className={s.solid}>{busy === 'trocar' && <Loader2 size={13} className="animate-spin" />} Trocar em {changing.length} {changing.length === 1 ? 'lugar' : 'lugares'}</button>
          </div>
        </div>
      )}
      {preview && stale && <div className={`text-xs ${ui.textMuted}`}>A página mudou: clique em "Ver prévia" de novo.</div>}
      <ResultLine result={result} />
    </Frame>
  );
}
