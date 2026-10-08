"use client";

import React, { useState } from 'react';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
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
  const addTitle = (t: string) => setDraft(d => (d.anuncio.titulos.includes(t) || d.anuncio.titulos.length >= AD_MAX.titulos ? d : { ...d, anuncio: { ...d.anuncio, titulos: [...d.anuncio.titulos, t] } }));
  const addDescription = (t: string) => setDraft(d => (d.anuncio.descricoes.includes(t) || d.anuncio.descricoes.length >= AD_MAX.descricoes ? d : { ...d, anuncio: { ...d.anuncio, descricoes: [...d.anuncio.descricoes, t] } }));
  const addSitelink = (s: { texto: string; desc1: string; desc2: string }) => setDraft(d => (d.sitelinks.some(x => x.texto === s.texto) || d.sitelinks.length >= AD_MAX.sitelinks ? d : { ...d, sitelinks: [...d.sitelinks, s] }));
  const addCallout = (t: string) => setDraft(d => (d.destaques.includes(t) || d.destaques.length >= AD_MAX.destaques ? d : { ...d, destaques: [...d.destaques, t] }));
  const pack = draft.sugestoes;
  const used = { t: new Set(draft.anuncio.titulos), d: new Set(draft.anuncio.descricoes), s: new Set(draft.sitelinks.map(s => s.texto)), c: new Set(draft.destaques) };
  const Suggest = ({ item, isUsed, full, onAdd, max }: { item: Item; isUsed: boolean; full: boolean; onAdd: () => void; max: number }) => (
    <div className={`flex items-start gap-2 py-1 border-t ${line}`}>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] ${head}`}>{item.texto}</div>
        {item.pt && <div className={`text-[11px] ${muted}`}>{item.pt}{item.grupo ? ` · ${item.grupo}` : ''}</div>}
      </div>
      <Counter text={item.texto} max={max} css={css} />
      <button onClick={onAdd} disabled={isUsed || full} className={small}>{isUsed ? 'no anúncio' : 'Usar'}</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <Block css={css} title="O que mais converteu nas suas campanhas parecidas" hint="Só as suas campanhas, últimos 30 dias. As conversões são as que o Google contou. O Google não informa conversão por título: os títulos vêm dos anúncios que mais converteram.">
        <div className="flex gap-2">
          <input value={draft.ia.parecidas} onChange={e => setIa({ parecidas: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') findSimilar(); }} placeholder="Trecho do nome: [WL], ALKAMELT…" aria-label="Trecho do nome das campanhas parecidas" className={`flex-1 ${field}`} />
          <button onClick={findSimilar} disabled={busy !== '' || draft.ia.parecidas.trim().length < 2} className={solid}>{busy === 'parecidas' && <Loader2 size={12} className="animate-spin" />} Buscar</button>
        </div>
        {similar && (
          <div className="space-y-3">
            <div className={`text-xs ${muted}`}>{similar.campanhas} {similar.campanhas === 1 ? 'campanha' : 'campanhas'} com "{similar.trecho}" no nome{!similar.palavras.length && !similar.anuncios.length ? '. Nenhuma teve conversão contada pelo Google nos últimos 30 dias.' : '.'}</div>
            {similar.palavras.length > 0 && (
              <div><div className={`${label} mb-1`}>Palavras-chave</div>
                {similar.palavras.slice(0, 10).map(k => (
                  <div key={`${k.texto}|${k.tipo}`} className={`flex items-center gap-2 py-1 border-t ${line} text-[13px]`}>
                    <span className={`flex-1 ${head}`}>{keyword(k)} <span className={`text-xs ${muted}`}>· {MATCH[k.tipo || ''] || 'ampla'}</span></span>
                    <span className={`text-xs ${muted}`}>{conv(k, money)}</span>
                    <button onClick={() => addKeywords([{ texto: k.texto, tipo: k.tipo || 'BROAD' }])} disabled={draft.palavras.some(x => x.texto === k.texto && x.tipo === (k.tipo || 'BROAD'))} className={small}>Usar</button>
                  </div>
                ))}</div>
            )}
            {similar.anuncios.length > 0 && (
              <div><div className={`${label} mb-1`}>Anúncios que mais converteram</div>
                {similar.anuncios.map((a, i) => (
                  <div key={i} className={`py-2 border-t ${line} space-y-1.5`}>
                    <div className={`text-xs ${muted}`}>{a.campanha} · {String(a.conversoes).replace('.', ',')} conversões · gasto {money(a.custo)}</div>
                    <div className="flex flex-wrap gap-1.5">{a.titulos.map(t => <button key={t} onClick={() => addTitle(t)} disabled={used.t.has(t) || draft.anuncio.titulos.length >= AD_MAX.titulos} title="Usar este título" className={`text-xs px-2 py-1 rounded border ${line} ${used.t.has(t) ? muted : head} hover:border-indigo-500 disabled:opacity-50`}>{t}</button>)}</div>
                    <div className="space-y-1">{a.descricoes.map(t => <button key={t} onClick={() => addDescription(t)} disabled={used.d.has(t) || draft.anuncio.descricoes.length >= AD_MAX.descricoes} title="Usar esta descrição" className={`block text-left text-xs ${used.d.has(t) ? muted : head} hover:text-indigo-400 disabled:opacity-50`}>{t}</button>)}</div>
                  </div>
                ))}</div>
            )}
            {similar.sitelinks.length > 0 && (
              <div><div className={`${label} mb-1`}>Sitelinks</div>
                {similar.sitelinks.map(s => (
                  <div key={s.texto} className={`flex items-center gap-2 py-1 border-t ${line} text-[13px]`}>
                    <span className="flex-1 min-w-0"><span className={head}>{s.texto}</span> <span className={`text-xs ${muted}`}>· {[s.extra?.desc1, s.extra?.desc2].filter(Boolean).join(' / ')}</span></span>
                    <span className={`text-xs ${muted} shrink-0`}>{String(s.conversoes).replace('.', ',')} conv.</span>
                    <button onClick={() => addSitelink({ texto: s.texto, desc1: s.extra?.desc1 || '', desc2: s.extra?.desc2 || '' })} disabled={used.s.has(s.texto)} className={small}>Usar</button>
                  </div>
                ))}</div>
            )}
            {similar.destaques.length > 0 && (
              <div><div className={`${label} mb-1`}>Frases de destaque</div>
                <div className="flex flex-wrap gap-1.5">{similar.destaques.map(c => <button key={c.texto} onClick={() => addCallout(c.texto)} disabled={used.c.has(c.texto)} title={`${String(c.conversoes).replace('.', ',')} conversões`} className={`text-xs px-2 py-1 rounded border ${line} ${used.c.has(c.texto) ? muted : head} hover:border-indigo-500 disabled:opacity-50`}>{c.texto} · {String(c.conversoes).replace('.', ',')}</button>)}</div></div>
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
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
            <div><div className={`${label} mb-1`}>Títulos sugeridos</div>{pack.titulos.map((t, i) => <Suggest key={i} item={t} max={30} isUsed={used.t.has(t.texto)} full={draft.anuncio.titulos.length >= AD_MAX.titulos} onAdd={() => addTitle(t.texto)} />)}</div>
            <div className="space-y-4">
              <div><div className={`${label} mb-1`}>Descrições sugeridas</div>{pack.descricoes.map((t, i) => <Suggest key={i} item={t} max={90} isUsed={used.d.has(t.texto)} full={draft.anuncio.descricoes.length >= AD_MAX.descricoes} onAdd={() => addDescription(t.texto)} />)}</div>
              <div><div className={`${label} mb-1`}>Sitelinks sugeridos</div>
                {pack.sitelinks.map((s, i) => (
                  <div key={i} className={`flex items-start gap-2 py-1 border-t ${line}`}>
                    <div className="flex-1 min-w-0"><div className={`text-[13px] ${head}`}>{s.texto.texto}</div><div className={`text-[11px] ${muted}`}>{s.desc1.texto} / {s.desc2.texto}</div><div className={`text-[11px] ${muted}`}>{s.texto.pt}</div></div>
                    <button onClick={() => addSitelink({ texto: s.texto.texto, desc1: s.desc1.texto, desc2: s.desc2.texto })} disabled={used.s.has(s.texto.texto)} className={small}>{used.s.has(s.texto.texto) ? 'na campanha' : 'Usar'}</button>
                  </div>
                ))}</div>
              <div><div className={`${label} mb-1`}>Frases de destaque sugeridas</div>{pack.destaques.map((t, i) => <Suggest key={i} item={t} max={25} isUsed={used.c.has(t.texto)} full={draft.destaques.length >= AD_MAX.destaques} onAdd={() => addCallout(t.texto)} />)}</div>
            </div>
          </div>
        )}
      </Block>

      <Block css={css} title="Anúncio" hint="A página de destino é informada no passo Onde subir, uma por campanha. O que você vê aqui vai igual para todas.">
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
