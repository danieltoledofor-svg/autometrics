"use client";

import React, { useState } from 'react';
import { Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { AD_MAX, adProblems, type Draft } from '@/lib/campaignBuilder/draft';
import { LIMITS, VARIATIONS, count, type Item, type Offer, type ResourceKind } from '@/lib/campaignBuilder/rules';
import type { Similar, SimilarRow } from '@/lib/campaignBuilder/similar';
import { Block, type Css } from './StepCampaign';

/**
 * Passo 3 do criador: o anúncio. Palavras-chave, caminho de exibição, títulos,
 * descrições, sitelinks e frases de destaque (estes sempre no nível da
 * campanha). Dois apoios: o que mais converteu nas campanhas parecidas do
 * próprio usuário, e os recursos escritos pela IA pela regra de fundo ou de
 * topo de funil. Tudo é editável e as letras são contadas na hora.
 */

type Api = (path: string, body?: Record<string, any>) => Promise<{ ok: boolean; body: any }>;
const MATCH: Record<string, string> = { EXACT: 'exata', PHRASE: 'frase', BROAD: 'ampla' };
const keyword = (k: { texto: string; tipo?: string }) => (k.tipo === 'EXACT' ? `[${k.texto}]` : k.tipo === 'PHRASE' ? `"${k.texto}"` : k.texto);
const parseKeywords = (text: string) => text.split(/[\n,]/).map(x => x.trim()).filter(Boolean).map(raw => {
  const exact = raw.match(/^\[(.+)\]$/), phrase = raw.match(/^"(.+)"$/);
  return { texto: (exact?.[1] || phrase?.[1] || raw).trim().toLowerCase(), tipo: exact ? 'EXACT' : phrase ? 'PHRASE' : 'BROAD' };
});

/** Contador de letras ao lado do campo: vermelho quando passa do limite do Google. */
function Counter({ text, max, css }: { text: string; max: number; css: Css }) {
  const n = count(text);
  return <span className={`text-[11px] tabular-nums shrink-0 w-12 text-right ${n > max ? 'text-rose-500 font-bold' : css.muted}`}>{n}/{max}</span>;
}

/** Lista de textos de uma linha (títulos, descrições, frases de destaque). */
function Lines({ items, onChange, kind, max, funil, css, placeholder, add }: {
  items: string[]; onChange: (list: string[]) => void; kind: ResourceKind; max: number; funil: Draft['funil']; css: Css; placeholder: string; add: string;
}) {
  const limit = LIMITS[funil][kind].max;
  return (
    <div className="space-y-1.5">
      {items.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={t} onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder} aria-label={`${add} ${i + 1}`}
            className={`flex-1 rounded-lg border ${count(t) > limit ? 'border-rose-500/70' : css.line} ${css.soft} ${css.head} px-3 py-1.5 text-[13px] outline-none focus:border-indigo-500`} />
          <Counter text={t} max={limit} css={css} />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remover ${add.toLowerCase()} ${i + 1}`} className={`${css.muted} hover:text-rose-400`}><X size={14} /></button>
        </div>
      ))}
      {items.length < max
        ? <button onClick={() => onChange([...items, ''])} className={`text-xs font-bold inline-flex items-center gap-1 ${css.muted} hover:text-indigo-400`}><Plus size={13} /> {add}</button>
        : <div className={`text-xs ${css.muted}`}>Limite de {max} atingido.</div>}
    </div>
  );
}

/**
 * Botão de escolher: verde com ✓ quando o item já está na campanha nova (clicar
 * tira), neutro com + quando não está (clicar põe). `full` = o limite daquele
 * tipo foi atingido, então os que estão fora ficam travados até tirar um.
 */
function Pick({ on, full, onClick, css, wide, children }: { on: boolean; full?: boolean; onClick: () => void; css: Css; wide?: boolean; children?: React.ReactNode }) {
  const tone = on
    ? (css.isDark ? 'bg-emerald-500/15 border-emerald-500/70 text-emerald-300 hover:bg-emerald-500/25' : 'bg-emerald-50 border-emerald-500 text-emerald-800 hover:bg-emerald-100')
    : full ? `${css.line} ${css.muted} opacity-50 cursor-not-allowed`
      : (css.isDark ? 'border-slate-600 text-slate-100 hover:border-indigo-400 hover:text-indigo-300' : 'border-slate-300 text-slate-800 hover:border-indigo-500 hover:text-indigo-700');
  const label = on ? 'Na campanha' : full ? 'Limite cheio' : 'Usar';
  return (
    <button onClick={onClick} disabled={!on && !!full} aria-pressed={on}
      title={on ? 'Está na campanha nova. Clique para tirar.' : full ? 'O limite deste tipo foi atingido. Tire um para usar este.' : 'Não está na campanha nova. Clique para usar.'}
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border text-left ${wide ? 'w-full' : 'shrink-0'} ${children ? '' : 'font-bold'} ${tone}`}>
      {on ? <Check size={13} className="shrink-0" /> : <Plus size={13} className="shrink-0" />}{children || label}
    </button>
  );
}

const conv = (r: SimilarRow, money: (v: number | null) => string) => `${String(r.conversoes).replace('.', ',')} conversões · CPA ${money(r.cpa)} · ${r.campanhas} ${r.campanhas === 1 ? 'campanha' : 'campanhas'}`;

export function StepAd({ draft, setDraft, symbol, css, api, onNext }: {
  draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; symbol: string; css: Css; api: Api; onNext: () => void;
}) {
  const { isDark, card, head, muted, line, soft, label } = css;
  const [similar, setSimilar] = useState<Similar | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const setAd = (patch: Partial<Draft['anuncio']>) => setDraft(d => ({ ...d, anuncio: { ...d.anuncio, ...patch } }));
  const setIa = (patch: Partial<Draft['ia']>) => setDraft(d => ({ ...d, ia: { ...d.ia, ...patch } }));
  const setOffer = (patch: Partial<Offer>) => setDraft(d => ({ ...d, ia: { ...d.ia, oferta: { ...d.ia.oferta, ...patch } } }));
  const money = (v: number | null) => (v === null ? '—' : `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const problems = adProblems(draft);
  const field = `rounded-lg border ${line} ${soft} ${head} px-3 py-1.5 text-[13px] outline-none focus:border-indigo-500`;
  const small = `text-[11px] font-bold px-2 py-1 rounded border ${line} ${muted} hover:text-indigo-400 disabled:opacity-40`;
  const solid = 'bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5';
  const o = draft.ia.oferta;

  const run = async (key: string, work: () => Promise<string | void>) => {
    setBusy(key); setError('');
    const problem = await work().catch((e: any) => String(e?.message || e));
    if (problem) setError(problem);
    setBusy('');
  };
  const findSimilar = () => run('parecidas', async () => {
    const { ok, body } = await api(`/api/campaign-builder?parecidas=${encodeURIComponent(draft.ia.parecidas.trim())}`);
    if (!ok || !body.similar) return body.error || 'Não foi possível buscar as campanhas parecidas.';
    setSimilar(body.similar);
  });
  const readOffer = () => run('oferta', async () => {
    const { ok, body } = await api('/api/campaign-builder', { action: 'oferta', url: draft.ia.url });
    if (!ok || !body.offer) return body.error || 'Não foi possível ler a página.';
    // O que a página não diz continua como estava (ou em branco): a IA não pode inventar.
    const read = Object.fromEntries(Object.entries(body.offer).filter(([k, v]) => k !== 'idioma_pagina' && v !== '' && v !== null && v !== false));
    setOffer(read as Partial<Offer>);
  });
  const generate = () => run('recursos', async () => {
    const payload = draft.funil === 'fundo'
      ? { action: 'recursos', funil: 'fundo', oferta: { ...o, idioma: draft.ia.idioma, pais: draft.ia.pais } }
      : { action: 'recursos', funil: 'topo', topo: { url: draft.ia.url, idioma: draft.ia.idioma, pais: draft.ia.pais, vsl: draft.ia.vsl, palavras: draft.palavras.map(keyword), termos: (similar?.termos || []).map(t => t.texto) } };
    const { ok, body } = await api('/api/campaign-builder', payload);
    if (!ok || !body.pack) return body.error || 'A IA não respondeu. Tente de novo.';
    set({ sugestoes: body.pack });
    if (draft.funil === 'topo' && body.page_read === false && draft.ia.url.trim()) return 'A página não pôde ser lida; a IA escreveu só com as palavras-chave, os termos e a transcrição.';
  });

  const addKeywords = (list: { texto: string; tipo: string }[]) => setDraft(d => {
    const seen = new Set(d.palavras.map(k => `${k.texto}|${k.tipo}`));
    return { ...d, palavras: [...d.palavras, ...list.filter(k => !seen.has(`${k.texto}|${k.tipo}`))] };
  });
  const toggleKeyword = (k: { texto: string; tipo: string }) => setDraft(d => (d.palavras.some(x => x.texto === k.texto && x.tipo === k.tipo)
    ? { ...d, palavras: d.palavras.filter(x => !(x.texto === k.texto && x.tipo === k.tipo)) } : { ...d, palavras: [...d.palavras, k] }));
  const toggleTitle = (t: string) => setDraft(d => (d.anuncio.titulos.includes(t) ? { ...d, anuncio: { ...d.anuncio, titulos: d.anuncio.titulos.filter(x => x !== t) } }
    : d.anuncio.titulos.length >= AD_MAX.titulos ? d : { ...d, anuncio: { ...d.anuncio, titulos: [...d.anuncio.titulos, t] } }));
  const toggleDescription = (t: string) => setDraft(d => (d.anuncio.descricoes.includes(t) ? { ...d, anuncio: { ...d.anuncio, descricoes: d.anuncio.descricoes.filter(x => x !== t) } }
    : d.anuncio.descricoes.length >= AD_MAX.descricoes ? d : { ...d, anuncio: { ...d.anuncio, descricoes: [...d.anuncio.descricoes, t] } }));
  const toggleSitelink = (x: { texto: string; desc1: string; desc2: string }) => setDraft(d => (d.sitelinks.some(y => y.texto === x.texto) ? { ...d, sitelinks: d.sitelinks.filter(y => y.texto !== x.texto) }
    : d.sitelinks.length >= AD_MAX.sitelinks ? d : { ...d, sitelinks: [...d.sitelinks, x] }));
  const toggleCallout = (t: string) => setDraft(d => (d.destaques.includes(t) ? { ...d, destaques: d.destaques.filter(x => x !== t) }
    : d.destaques.length >= AD_MAX.destaques ? d : { ...d, destaques: [...d.destaques, t] }));
  const titlesFull = draft.anuncio.titulos.length >= AD_MAX.titulos, descsFull = draft.anuncio.descricoes.length >= AD_MAX.descricoes;
  const hasKeyword = (k: { texto: string; tipo?: string }) => draft.palavras.some(x => x.texto === k.texto && x.tipo === (k.tipo || 'BROAD'));
  /** O que já está na campanha nova, para o usuário não perder a conta enquanto escolhe. */
  const tally = (
    <div className={`rounded-lg border ${css.isDark ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-emerald-300 bg-emerald-50'} px-3 py-2 text-xs ${head} flex flex-wrap gap-x-4 gap-y-1`}>
      <b>Na campanha nova agora:</b>
      <span>{draft.palavras.length} {draft.palavras.length === 1 ? 'palavra-chave' : 'palavras-chave'}</span>
      <span className={titlesFull ? 'text-amber-500 font-bold' : ''}>{draft.anuncio.titulos.length} de {AD_MAX.titulos} títulos</span>
      <span className={descsFull ? 'text-amber-500 font-bold' : ''}>{draft.anuncio.descricoes.length} de {AD_MAX.descricoes} descrições</span>
      <span>{draft.sitelinks.length} sitelinks</span>
      <span>{draft.destaques.length} frases de destaque</span>
    </div>
  );
  const legend = (
    <div className={`text-xs ${muted} flex flex-wrap items-center gap-x-4 gap-y-1`}>
      <span className="inline-flex items-center gap-1.5"><Pick on css={css} onClick={() => {}} /> está na campanha nova; clique para tirar</span>
      <span className="inline-flex items-center gap-1.5"><Pick on={false} css={css} onClick={() => {}} /> não está; clique para pôr</span>
      <span>Tudo o que você puser pode ser editado mais abaixo.</span>
    </div>
  );
  const pack = draft.sugestoes;
  const used = { t: new Set(draft.anuncio.titulos), d: new Set(draft.anuncio.descricoes), s: new Set(draft.sitelinks.map(s => s.texto)), c: new Set(draft.destaques) };
  const suggest = (item: Item, key: React.Key, on: boolean, full: boolean, onToggle: () => void, max: number) => (
    <div key={key} className={`flex items-start gap-2 py-1.5 border-t ${line}`}>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] ${on ? (css.isDark ? 'text-emerald-300' : 'text-emerald-800') : head}`}>{item.texto}</div>
        {item.pt && <div className={`text-[11px] ${muted}`}>{item.pt}{item.grupo ? ` · ${item.grupo}` : ''}</div>}
      </div>
      <Counter text={item.texto} max={max} css={css} />
      <Pick on={on} full={full} css={css} onClick={onToggle} />
    </div>
  );

  return (
    <div className="space-y-4">
      <Block css={css} title="O que mais converteu nas suas campanhas parecidas" hint="Aqui você escolhe o que copiar das suas campanhas que já venderam. Só as suas campanhas, últimos 30 dias, com as conversões que o Google contou. O Google não informa conversão por título, então os títulos aparecem dentro dos anúncios que mais converteram.">
        <div className="flex gap-2">
          <input value={draft.ia.parecidas} onChange={e => setIa({ parecidas: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') findSimilar(); }} placeholder="Trecho do nome: [WL], ALKAMELT…" aria-label="Trecho do nome das campanhas parecidas" className={`flex-1 ${field}`} />
          <button onClick={findSimilar} disabled={busy !== '' || draft.ia.parecidas.trim().length < 2} className={solid}>{busy === 'parecidas' && <Loader2 size={12} className="animate-spin" />} Buscar</button>
        </div>
        {similar && (
          <div className="space-y-4">
            <div className={`text-xs ${muted}`}>{similar.campanhas} {similar.campanhas === 1 ? 'campanha' : 'campanhas'} com "{similar.trecho}" no nome{!similar.palavras.length && !similar.anuncios.length ? '. Nenhuma teve conversão contada pelo Google nos últimos 30 dias.' : '. Escolha abaixo o que vai para a campanha nova.'}</div>
            {(similar.palavras.length > 0 || similar.anuncios.length > 0) && <>{tally}{legend}</>}
            {similar.palavras.length > 0 && (
              <div><div className={`${label} mb-1`}>Palavras-chave que mais converteram</div>
                {similar.palavras.slice(0, 10).map(k => (
                  <div key={`${k.texto}|${k.tipo}`} className={`flex flex-wrap items-center gap-2 py-1.5 border-t ${line} text-[13px]`}>
                    <span className={`flex-1 min-w-[160px] ${hasKeyword(k) ? (css.isDark ? 'text-emerald-300' : 'text-emerald-800') : head}`}>{keyword(k)} <span className={`text-xs ${muted}`}>· {MATCH[k.tipo || ''] || 'ampla'}</span></span>
                    <span className={`text-xs ${muted}`}>{conv(k, money)}</span>
                    <Pick on={hasKeyword(k)} css={css} onClick={() => toggleKeyword({ texto: k.texto, tipo: k.tipo || 'BROAD' })} />
                  </div>
                ))}</div>
            )}
            {similar.anuncios.length > 0 && (
              <div><div className={`${label} mb-1`}>Anúncios que mais converteram · clique em cada título ou descrição que quiser levar</div>
                {similar.anuncios.map((a, i) => (
                  <div key={i} className={`py-2.5 border-t ${line} space-y-2`}>
                    <div className={`text-xs ${head}`}><b>{a.campanha}</b> <span className={muted}>· {String(a.conversoes).replace('.', ',')} conversões · gasto {money(a.custo)}</span></div>
                    <div><div className={`text-[11px] ${muted} mb-1`}>Títulos deste anúncio</div>
                      <div className="flex flex-wrap gap-1.5">{a.titulos.map(t => <Pick key={t} on={used.t.has(t)} full={titlesFull} css={css} onClick={() => toggleTitle(t)}>{t}</Pick>)}</div></div>
                    <div><div className={`text-[11px] ${muted} mb-1`}>Descrições deste anúncio</div>
                      <div className="space-y-1.5">{a.descricoes.map(t => <Pick key={t} wide on={used.d.has(t)} full={descsFull} css={css} onClick={() => toggleDescription(t)}>{t}</Pick>)}</div></div>
                  </div>
                ))}</div>
            )}
            {similar.sitelinks.length > 0 && (
              <div><div className={`${label} mb-1`}>Sitelinks que mais converteram</div>
                {similar.sitelinks.map(x => (
                  <div key={x.texto} className={`flex flex-wrap items-center gap-2 py-1.5 border-t ${line} text-[13px]`}>
                    <span className="flex-1 min-w-[200px]"><span className={used.s.has(x.texto) ? (css.isDark ? 'text-emerald-300' : 'text-emerald-800') : head}>{x.texto}</span> <span className={`text-xs ${muted}`}>· {[x.extra?.desc1, x.extra?.desc2].filter(Boolean).join(' / ')}</span></span>
                    <span className={`text-xs ${muted} shrink-0`}>{String(x.conversoes).replace('.', ',')} conversões</span>
                    <Pick on={used.s.has(x.texto)} full={draft.sitelinks.length >= AD_MAX.sitelinks} css={css} onClick={() => toggleSitelink({ texto: x.texto, desc1: x.extra?.desc1 || '', desc2: x.extra?.desc2 || '' })} />
                  </div>
                ))}</div>
            )}
            {similar.destaques.length > 0 && (
              <div><div className={`${label} mb-1`}>Frases de destaque que mais converteram</div>
                <div className="flex flex-wrap gap-1.5">{similar.destaques.map(c => <Pick key={c.texto} on={used.c.has(c.texto)} full={draft.destaques.length >= AD_MAX.destaques} css={css} onClick={() => toggleCallout(c.texto)}>{c.texto} <span className="opacity-70">· {String(c.conversoes).replace('.', ',')} conv.</span></Pick>)}</div></div>
            )}
          </div>
        )}
      </Block>

      <Block css={css} title={`Palavras-chave (${draft.palavras.length})`} hint='Valem para todos os grupos. Uma por linha ou separadas por vírgula: [colchetes] para exata, "aspas" para frase; sem nada, ampla.'>
        <div className="flex flex-wrap gap-1.5">
          {draft.palavras.map((k, i) => (
            <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${line} ${head}`}>{keyword(k)} <span className={muted}>· {MATCH[k.tipo] || k.tipo}</span>
              <button onClick={() => set({ palavras: draft.palavras.filter((_, j) => j !== i) })} aria-label={`Remover a palavra-chave ${k.texto}`} className={`${muted} hover:text-rose-400`}><X size={12} /></button></span>
          ))}
          {!draft.palavras.length && <span className={`text-xs ${muted}`}>nenhuma</span>}
        </div>
        <div className="flex gap-2 items-end">
          <textarea value={newKeywords} onChange={e => setNewKeywords(e.target.value)} rows={2} placeholder={'baking soda recipe\n"baking soda shot"\n[fizzclean]'} aria-label="Novas palavras-chave" className={`flex-1 resize-y ${field}`} />
          <button onClick={() => { addKeywords(parseKeywords(newKeywords)); setNewKeywords(''); }} disabled={!newKeywords.trim()} className={`px-3 py-2 rounded-lg border ${line} text-xs font-bold ${muted} hover:text-indigo-400 disabled:opacity-40`}>Adicionar</button>
        </div>
      </Block>

      <Block css={css} title={`Recursos escritos pela IA · ${draft.funil === 'fundo' ? 'fundo de funil' : 'topo de funil'}`}
        hint={draft.funil === 'fundo' ? 'A IA usa só os valores abaixo: o que ficar em branco não entra no anúncio e nada é calculado. Cada pedido é uma consulta paga à IA (poucos centavos).' : 'A IA lê a página, a transcrição da VSL, as palavras-chave e os termos que mais converteram nas campanhas parecidas (busque acima antes). Cada pedido é uma consulta paga à IA (poucos centavos).'}>
        <div className="flex gap-2">
          <input value={draft.ia.url} onChange={e => setIa({ url: e.target.value })} placeholder={draft.funil === 'fundo' ? 'Página do produto: https://…' : 'Página do anúncio: https://…'} aria-label="Página para a IA ler" className={`flex-1 ${field}`} />
          {draft.funil === 'fundo' && <button onClick={readOffer} disabled={busy !== '' || !/^https?:\/\//i.test(draft.ia.url.trim())} className={`px-3 rounded-lg border ${line} text-xs font-bold ${muted} hover:text-indigo-400 disabled:opacity-40 inline-flex items-center gap-1.5`}>{busy === 'oferta' && <Loader2 size={12} className="animate-spin" />} Ler a página</button>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={draft.ia.idioma} onChange={e => setIa({ idioma: e.target.value })} placeholder="Idioma do anúncio: inglês" aria-label="Idioma do anúncio" className={field} />
          <input value={draft.ia.pais} onChange={e => setIa({ pais: e.target.value })} placeholder={draft.funil === 'fundo' ? 'País (sigla): US, CA, BR…' : 'País: Estados Unidos'} aria-label="País do anúncio" className={field} />
        </div>
        {draft.funil === 'fundo' ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <input value={o.produto || ''} onChange={e => setOffer({ produto: e.target.value })} placeholder="Nome do produto" aria-label="Nome do produto" className={field} />
              <input value={o.moeda || ''} onChange={e => setOffer({ moeda: e.target.value })} placeholder="Moeda: USD" aria-label="Moeda" className={field} />
              <input value={o.preco || ''} onChange={e => setOffer({ preco: e.target.value })} placeholder="Preço: $49.00" aria-label="Preço" className={field} />
              <input value={o.preco_original || ''} onChange={e => setOffer({ preco_original: e.target.value })} placeholder="Preço de antes (se houver)" aria-label="Preço original" className={field} />
              <input value={o.desconto_valor || ''} onChange={e => setOffer({ desconto_valor: e.target.value })} placeholder="Valor do desconto (se houver)" aria-label="Valor do desconto" className={field} />
              <input value={o.desconto_pct || ''} onChange={e => setOffer({ desconto_pct: e.target.value })} placeholder="% de desconto (se houver)" aria-label="Percentual de desconto" className={field} />
              <select value={o.frete || ''} onChange={e => setOffer({ frete: e.target.value as Offer['frete'] })} aria-label="Frete" className={`${field} ${isDark ? '!bg-slate-950' : '!bg-white'}`}>
                <option value="">Frete: não citar</option><option value="gratis">Frete grátis</option><option value="rapido">Envio rápido</option><option value="imediato">Envio imediato</option><option value="expresso">Envio expresso</option>
              </select>
              <input value={o.garantia_dias ?? ''} onChange={e => setOffer({ garantia_dias: Number(e.target.value.replace(/\D/g, '')) || null })} inputMode="numeric" placeholder="Garantia em dias (se houver)" aria-label="Dias de garantia" className={field} />
              <label className={`flex items-center gap-2 text-[13px] cursor-pointer ${head}`}><input type="checkbox" checked={!!o.oficial} onChange={e => setOffer({ oficial: e.target.checked })} /> É o site oficial</label>
            </div>
            <div>
              <div className={`${label} mb-1.5`}>Tons</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(VARIATIONS).map(([n, v]) => {
                  const num = Number(n), list = o.variacoes || [0], on = list.includes(num);
                  return <button key={n} title={v.tom} onClick={() => setOffer({ variacoes: on ? list.filter(x => x !== num) : [...list, num] })}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : `${line} ${muted}`}`}>{v.nome}</button>;
                })}
              </div>
            </div>
          </>
        ) : (
          <textarea value={draft.ia.vsl} onChange={e => setIa({ vsl: e.target.value })} rows={3} maxLength={20000} placeholder="Transcrição da VSL (opcional, mas é o que faz o anúncio falar a mesma língua do vídeo)" aria-label="Transcrição da VSL" className={`w-full resize-y ${field}`} />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={generate} disabled={busy !== '' || (draft.funil === 'fundo' && !String(o.produto || '').trim())} className={solid}>{busy === 'recursos' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {pack ? 'Gerar de novo' : 'Gerar recursos'}</button>
          {busy === 'recursos' && <span className={`text-xs ${muted}`}>A IA está escrevendo e as letras estão sendo conferidas; leva até um minuto.</span>}
          {pack && busy === '' && <span className={`text-xs ${muted}`}>{pack.titulos.length} títulos, {pack.descricoes.length} descrições, {pack.sitelinks.length} sitelinks e {pack.destaques.length} frases{pack.descartados ? ` · ${pack.descartados} fora da regra foram descartados` : ''}</span>}
        </div>
        {error && <div className="text-xs text-rose-500">{error}</div>}
        {pack && (
          <>
            {tally}{legend}
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
              <div><div className={`${label} mb-1`}>Títulos sugeridos</div>{pack.titulos.map((t, i) => suggest(t, i, used.t.has(t.texto), titlesFull, () => toggleTitle(t.texto), 30))}</div>
              <div className="space-y-4">
                <div><div className={`${label} mb-1`}>Descrições sugeridas</div>{pack.descricoes.map((t, i) => suggest(t, i, used.d.has(t.texto), descsFull, () => toggleDescription(t.texto), 90))}</div>
                <div><div className={`${label} mb-1`}>Sitelinks sugeridos</div>
                  {pack.sitelinks.map((x, i) => (
                    <div key={i} className={`flex items-start gap-2 py-1.5 border-t ${line}`}>
                      <div className="flex-1 min-w-0"><div className={`text-[13px] ${used.s.has(x.texto.texto) ? (css.isDark ? 'text-emerald-300' : 'text-emerald-800') : head}`}>{x.texto.texto}</div><div className={`text-[11px] ${muted}`}>{x.desc1.texto} / {x.desc2.texto}</div><div className={`text-[11px] ${muted}`}>{x.texto.pt}</div></div>
                      <Pick on={used.s.has(x.texto.texto)} full={draft.sitelinks.length >= AD_MAX.sitelinks} css={css} onClick={() => toggleSitelink({ texto: x.texto.texto, desc1: x.desc1.texto, desc2: x.desc2.texto })} />
                    </div>
                  ))}</div>
                <div><div className={`${label} mb-1`}>Frases de destaque sugeridas</div>{pack.destaques.map((t, i) => suggest(t, i, used.c.has(t.texto), draft.destaques.length >= AD_MAX.destaques, () => toggleCallout(t.texto), 25))}</div>
              </div>
            </div>
          </>
        )}
      </Block>

      <Block css={css} title="Anúncio da campanha nova" hint="É isto que vai ao Google: o que você escolheu acima aparece aqui e pode ser editado, apagado ou completado à mão. A página de destino é informada no passo Onde subir.">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className={muted}>Caminho de exibição: seusite.com /</span>
          <input value={draft.anuncio.caminho1} onChange={e => setAd({ caminho1: e.target.value.replace(/\s/g, '') })} maxLength={15} placeholder="caminho" aria-label="Caminho de exibição 1" className={`w-36 ${field}`} />
          <span className={muted}>/</span>
          <input value={draft.anuncio.caminho2} onChange={e => setAd({ caminho2: e.target.value.replace(/\s/g, '') })} maxLength={15} placeholder="opcional" aria-label="Caminho de exibição 2" className={`w-36 ${field}`} />
        </div>
        <div><div className={`${label} mb-1.5`}>Títulos ({draft.anuncio.titulos.length}/{AD_MAX.titulos})</div>
          <Lines items={draft.anuncio.titulos} onChange={list => setAd({ titulos: list })} kind="titulo" max={AD_MAX.titulos} funil={draft.funil} css={css} placeholder="Título, até 30 letras" add="Título" /></div>
        <div><div className={`${label} mb-1.5`}>Descrições ({draft.anuncio.descricoes.length}/{AD_MAX.descricoes})</div>
          <Lines items={draft.anuncio.descricoes} onChange={list => setAd({ descricoes: list })} kind="descricao" max={AD_MAX.descricoes} funil={draft.funil} css={css} placeholder="Descrição, até 90 letras" add="Descrição" /></div>
      </Block>

      <Block css={css} title={`Sitelinks (${draft.sitelinks.length})`} hint="Criados no nível da campanha, para irem junto em cada cópia. Todos apontam para a página da campanha. As duas linhas de descrição vão juntas, ou nenhuma.">
        {draft.sitelinks.map((s, i) => {
          const patch = (p: Partial<typeof s>) => set({ sitelinks: draft.sitelinks.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          return (
            <div key={i} className={`rounded-lg border ${line} p-2.5 space-y-1.5`}>
              <div className="flex items-center gap-2">
                <input value={s.texto} onChange={e => patch({ texto: e.target.value })} placeholder="Texto do sitelink" aria-label={`Texto do sitelink ${i + 1}`} className={`flex-1 ${field}`} /><Counter text={s.texto} max={25} css={css} />
                <button onClick={() => set({ sitelinks: draft.sitelinks.filter((_, j) => j !== i) })} aria-label={`Remover o sitelink ${i + 1}`} className={`${muted} hover:text-rose-400`}><X size={14} /></button>
              </div>
              <div className="flex items-center gap-2"><input value={s.desc1} onChange={e => patch({ desc1: e.target.value })} placeholder="Linha de descrição 1" aria-label={`Descrição 1 do sitelink ${i + 1}`} className={`flex-1 ${field}`} /><Counter text={s.desc1} max={35} css={css} /><span className="w-[14px]" /></div>
              <div className="flex items-center gap-2"><input value={s.desc2} onChange={e => patch({ desc2: e.target.value })} placeholder="Linha de descrição 2" aria-label={`Descrição 2 do sitelink ${i + 1}`} className={`flex-1 ${field}`} /><Counter text={s.desc2} max={35} css={css} /><span className="w-[14px]" /></div>
            </div>
          );
        })}
        {draft.sitelinks.length < AD_MAX.sitelinks && <button onClick={() => set({ sitelinks: [...draft.sitelinks, { texto: '', desc1: '', desc2: '' }] })} className={`text-xs font-bold inline-flex items-center gap-1 ${muted} hover:text-indigo-400`}><Plus size={13} /> Sitelink</button>}
      </Block>

      <Block css={css} title={`Frases de destaque (${draft.destaques.length})`} hint="Criadas no nível da campanha. Até 25 letras cada.">
        <Lines items={draft.destaques} onChange={list => set({ destaques: list })} kind="destaque" max={AD_MAX.destaques} funil={draft.funil} css={css} placeholder="Frase de destaque" add="Frase" />
      </Block>

      <div className={`${card} border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="text-xs space-y-0.5">
          {problems.length ? problems.map(p => <div key={p} className="text-amber-500">{p}</div>) : <div className={muted}>Anúncio completo. Nada foi enviado ao Google.</div>}
        </div>
        <button onClick={onNext} disabled={problems.length > 0} className={solid}>Seguir para Onde subir</button>
      </div>
    </div>
  );
}
