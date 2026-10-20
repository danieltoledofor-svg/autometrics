"use client";

import React, { useState } from 'react';
import { BookmarkPlus, Check, ChevronDown, ChevronRight, Loader2, Plus, ScanSearch, Sparkles, Trash2, Undo2, Wand2, X } from 'lucide-react';
import { AD_MAX, adProblems, keywordProblem, type Draft } from '@/lib/campaignBuilder/draft';
import { LIMITS, TOP_ANGLES, VARIATIONS, count, problemOf, type Item, type Offer, type ResourceKind } from '@/lib/campaignBuilder/rules';
import type { Similar, SimilarRow } from '@/lib/campaignBuilder/similar';
import type { Sweep, SweepAd, SweepText } from '@/lib/campaignBuilder/sweep';
import { VoiceButton } from '@/app/components/VoiceButton';
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
  return <span className={`text-[11px] tabular-nums shrink-0 w-12 text-right ${n > max ? 'text-neg font-medium' : css.muted}`}>{n}/{max}</span>;
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
            className={`flex-1 rounded-lg border ${count(t) > limit ? 'border-neg/70' : css.line} ${css.soft} ${css.head} px-3 py-1.5 text-[13px] outline-none focus:border-brand`} />
          <Counter text={t} max={limit} css={css} />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remover ${add.toLowerCase()} ${i + 1}`} className={`${css.muted} hover:text-neg`}><X size={14} aria-hidden="true" /></button>
        </div>
      ))}
      {items.length < max
        ? <button onClick={() => onChange([...items, ''])} className={`text-xs font-medium inline-flex items-center gap-1 ${css.muted} hover:text-ink`}><Plus size={13} aria-hidden="true" /> {add}</button>
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
    ? 'bg-pos/10 border-pos/60 text-pos hover:bg-pos/15'
    : full ? `${css.line} ${css.muted} opacity-50 cursor-not-allowed`
      : 'border-line-strong text-ink hover:border-brand hover:text-brand-text';
  const label = on ? 'Na campanha' : full ? 'Limite cheio' : 'Usar';
  return (
    <button onClick={onClick} disabled={!on && !!full} aria-pressed={on}
      title={on ? 'Está na campanha nova. Clique para tirar.' : full ? 'O limite deste tipo foi atingido. Tire um para usar este.' : 'Não está na campanha nova. Clique para usar.'}
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border text-left ${wide ? 'w-full' : 'shrink-0'} ${children ? '' : 'font-medium'} ${tone}`}>
      {on ? <Check size={13} aria-hidden="true" className="shrink-0" /> : <Plus size={13} aria-hidden="true" className="shrink-0" />}{children || label}
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
  /** As palavras-chave que estavam na campanha antes do último "Limpar todas", para poder voltar atrás. */
  const [cleared, setCleared] = useState<Draft['palavras'] | null>(null);
  /** Código-fonte colado pelo usuário, para quando a página recusa a leitura. Não fica guardado no rascunho. */
  const [source, setSource] = useState('');
  const [pasting, setPasting] = useState(false);
  /** Varredura dos anúncios do mecanismo (topo de funil): vai junto em cada pedido de recursos. */
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepFilter, setSweepFilter] = useState<'todos' | 'venderam' | 'sem'>('todos');
  const [sweepMore, setSweepMore] = useState(false);
  /** Direção do usuário para a IA reescrever títulos e descrições (texto ou áudio). */
  const [direction, setDirection] = useState('');
  const [saved, setSaved] = useState('');
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const setAd = (patch: Partial<Draft['anuncio']>) => setDraft(d => ({ ...d, anuncio: { ...d.anuncio, ...patch } }));
  const setIa = (patch: Partial<Draft['ia']>) => setDraft(d => ({ ...d, ia: { ...d.ia, ...patch } }));
  const setOffer = (patch: Partial<Offer>) => setDraft(d => ({ ...d, ia: { ...d.ia, oferta: { ...d.ia.oferta, ...patch } } }));
  const money = (v: number | null) => (v === null ? '—' : `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const problems = adProblems(draft);
  const field = `rounded-lg border ${line} ${soft} ${head} px-3 py-1.5 text-[13px] outline-none focus:border-brand`;
  const small = `text-[11px] font-medium px-2 py-1 rounded border ${line} ${muted} hover:text-ink disabled:opacity-40`;
  const solid = 'bg-brand hover:bg-brand-hover text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5';
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
    const { ok, body } = await api('/api/campaign-builder', { action: 'oferta', url: draft.ia.url, fonte: source });
    if (body.blocked) setPasting(true);
    if (!ok || !body.offer) return `${body.error || 'Não foi possível ler a página.'}${body.blocked ? ' Cole o código-fonte dela no campo abaixo e leia de novo.' : ''}`;
    // O que a página não diz continua como estava (ou em branco): a IA não pode inventar.
    const read = Object.fromEntries(Object.entries(body.offer).filter(([k, v]) => k !== 'idioma_pagina' && v !== '' && v !== null && v !== false));
    setOffer(read as Partial<Offer>);
  });
  const runSweep = () => run('varredura', async () => {
    const { ok, body } = await api(`/api/campaign-builder?varredura=${encodeURIComponent(draft.ia.parecidas.trim())}`);
    if (!ok || !body.sweep) return body.error || 'Não foi possível varrer os anúncios.';
    setSweep(body.sweep); setSweepOpen(false); setSweepMore(false);
  });
  // Só os textos e o resultado vão para a IA, sem nome de campanha.
  const asModel = (a: SweepAd) => ({ situacao: a.situacao, resultado: a.resultado, titulos: a.titulos, descricoes: a.descricoes });
  const generate = (rewrite = false) => run(rewrite ? 'reescrita' : 'recursos', async () => {
    const reescrita = rewrite && pack ? {
      direcao: direction.trim(), titulos: pack.titulos.map(t => t.texto), descricoes: pack.descricoes.map(t => t.texto),
      escolhidos: [...draft.anuncio.titulos, ...draft.anuncio.descricoes].filter(Boolean),
    } : undefined;
    const payload = draft.funil === 'fundo'
      ? { action: 'recursos', funil: 'fundo', oferta: { ...o, idioma: draft.ia.idioma, pais: draft.ia.pais }, reescrita }
      : { action: 'recursos', funil: 'topo', reescrita, topo: {
        url: draft.ia.url, fonte: source, idioma: draft.ia.idioma, pais: draft.ia.pais, vsl: draft.ia.vsl, palavras: draft.palavras.map(keyword), termos: (similar?.termos || []).map(t => t.texto),
        angulos: draft.ia.angulos || [0], modelos: sweep ? { copiar: sweep.copiar.map(asModel), evitar: sweep.evitar.map(asModel) } : undefined,
      } };
    const { ok, body } = await api('/api/campaign-builder', payload);
    if (!ok || !body.pack) return body.error || 'A IA não respondeu. Tente de novo.';
    set({ sugestoes: body.pack });
    setSaved('');
    if (draft.funil === 'topo' && body.page_read === false && draft.ia.url.trim()) { setPasting(true); return 'O código da página não pôde ser baixado; a IA escreveu só com as palavras-chave, os termos e a transcrição. Cole o código-fonte no campo abaixo e gere de novo.'; }
  });

  /** Guarda a direção e os títulos e descrições da campanha nova na memória de escrita da IA. */
  const remember = () => run('memoria', async () => {
    const { ok, body } = await api('/api/campaign-builder', { action: 'memoria', funil: draft.funil, direcao: direction.trim(), titulos: draft.anuncio.titulos.filter(Boolean), descricoes: draft.anuncio.descricoes.filter(Boolean) });
    if (!ok) return body.error || 'Não foi possível guardar na memória.';
    setSaved('Guardado. A IA vai seguir isto nos próximos recursos de todas as suas campanhas de ' + (draft.funil === 'fundo' ? 'fundo' : 'topo') + ' de funil. Você vê e apaga em Análise de IA › Memória da IA.');
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
    <div className={`rounded-lg border border-pos/30 bg-pos/5 px-3 py-2 text-xs ${head} flex flex-wrap gap-x-4 gap-y-1`}>
      <b>Na campanha nova agora:</b>
      <span>{draft.palavras.length} {draft.palavras.length === 1 ? 'palavra-chave' : 'palavras-chave'}</span>
      <span className={titlesFull ? 'text-warn font-medium' : ''}>{draft.anuncio.titulos.length} de {AD_MAX.titulos} títulos</span>
      <span className={descsFull ? 'text-warn font-medium' : ''}>{draft.anuncio.descricoes.length} de {AD_MAX.descricoes} descrições</span>
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
        <div className={`text-[13px] ${on ? 'text-pos' : head}`}>{item.texto}</div>
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
          <button onClick={findSimilar} disabled={busy !== '' || draft.ia.parecidas.trim().length < 2} className={solid}>{busy === 'parecidas' && <Loader2 size={12} aria-hidden="true" className="animate-spin" />} Buscar</button>
        </div>
        {similar && (
          <div className="space-y-4">
            <div className={`text-xs ${muted}`}>{similar.campanhas} {similar.campanhas === 1 ? 'campanha' : 'campanhas'} com "{similar.trecho}" no nome{!similar.palavras.length && !similar.anuncios.length ? '. Nenhuma teve conversão contada pelo Google nos últimos 30 dias.' : '. Escolha abaixo o que vai para a campanha nova.'}</div>
            {(similar.palavras.length > 0 || similar.anuncios.length > 0) && <>{tally}{legend}</>}
            {similar.palavras.length > 0 && (
              <div><div className={`${label} mb-1`}>Palavras-chave que mais converteram</div>
                {similar.palavras.slice(0, 10).map(k => (
                  <div key={`${k.texto}|${k.tipo}`} className={`flex flex-wrap items-center gap-2 py-1.5 border-t ${line} text-[13px]`}>
                    <span className={`flex-1 min-w-[160px] ${hasKeyword(k) ? 'text-pos' : head}`}>{keyword(k)} <span className={`text-xs ${muted}`}>· {MATCH[k.tipo || ''] || 'ampla'}</span></span>
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
                    <span className="flex-1 min-w-[200px]"><span className={used.s.has(x.texto) ? 'text-pos' : head}>{x.texto}</span> <span className={`text-xs ${muted}`}>· {[x.extra?.desc1, x.extra?.desc2].filter(Boolean).join(' / ')}</span></span>
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
            <span key={i} title={keywordProblem(k.texto) || undefined} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${keywordProblem(k.texto) ? 'border-neg/70' : line} ${head}`}>{keyword(k)} <span className={muted}>· {MATCH[k.tipo] || k.tipo}</span>
              {keywordProblem(k.texto) && <span className="sr-only">({keywordProblem(k.texto)})</span>}
              <button onClick={() => set({ palavras: draft.palavras.filter((_, j) => j !== i) })} aria-label={`Remover a palavra-chave ${k.texto}`} className={`${muted} hover:text-neg`}><X size={12} aria-hidden="true" /></button></span>
          ))}
          {!draft.palavras.length && <span className={`text-xs ${muted}`}>nenhuma</span>}
        </div>
        {(draft.palavras.length > 0 || cleared) && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {draft.palavras.length > 0 && (
              <button onClick={() => { setCleared(draft.palavras); set({ palavras: [] }); }} className={`font-medium inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${line} ${muted} hover:text-neg hover:border-neg/60`}>
                <Trash2 size={13} aria-hidden="true" /> Limpar todas ({draft.palavras.length})
              </button>
            )}
            {cleared && !draft.palavras.length && (
              <>
                <span className={muted}>{cleared.length} {cleared.length === 1 ? 'palavra-chave foi tirada' : 'palavras-chave foram tiradas'}.</span>
                <button onClick={() => { set({ palavras: cleared }); setCleared(null); }} className="font-medium inline-flex items-center gap-1 text-brand-text hover:underline"><Undo2 size={13} aria-hidden="true" /> Desfazer</button>
              </>
            )}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea value={newKeywords} onChange={e => setNewKeywords(e.target.value)} rows={2} placeholder={'baking soda recipe\n"baking soda shot"\n[fizzclean]'} aria-label="Novas palavras-chave" className={`flex-1 resize-y ${field}`} />
          <button onClick={() => { addKeywords(parseKeywords(newKeywords)); setNewKeywords(''); setCleared(null); }} disabled={!newKeywords.trim()} className={`px-3 py-2 rounded-lg border ${line} text-xs font-medium ${muted} hover:text-ink disabled:opacity-40`}>Adicionar</button>
        </div>
      </Block>

      <Block css={css} title={`Recursos escritos pela IA · ${draft.funil === 'fundo' ? 'fundo de funil' : 'topo de funil'}`}
        hint={draft.funil === 'fundo' ? 'A página é lida pelo código-fonte, para achar preço, garantia e frete mesmo quando não estão no texto. A IA usa só os valores abaixo: o que ficar em branco não entra no anúncio e nada é calculado. Cada pedido é uma consulta paga à IA (poucos centavos).' : 'A IA lê o código-fonte da página, a transcrição da VSL, as palavras-chave, os termos que mais converteram nas campanhas parecidas (busque acima antes), os anúncios do mesmo mecanismo e o que você guardou na memória dela. Cada pedido é uma consulta paga à IA (poucos centavos).'}>
        <div className="flex gap-2">
          <input value={draft.ia.url} onChange={e => setIa({ url: e.target.value })} placeholder={draft.funil === 'fundo' ? 'Página do produto: https://…' : 'Página do anúncio: https://…'} aria-label="Página para a IA ler" className={`flex-1 ${field}`} />
          {draft.funil === 'fundo' && <button onClick={readOffer} disabled={busy !== '' || !/^https?:\/\//i.test(draft.ia.url.trim())} className={`px-3 rounded-lg border ${line} text-xs font-medium ${muted} hover:text-ink disabled:opacity-40 inline-flex items-center gap-1.5`}>{busy === 'oferta' && <Loader2 size={12} aria-hidden="true" className="animate-spin" />} Ler a página</button>}
        </div>
        {pasting ? (
          <div className="space-y-1">
            <textarea value={source} onChange={e => setSource(e.target.value.slice(0, 3_000_000))} rows={3} spellCheck={false} placeholder="Cole aqui o código-fonte da página. No navegador: abra a página, aperte Ctrl+U (no Mac, ⌥⌘U), selecione tudo, copie e cole." aria-label="Código-fonte da página" className={`w-full resize-y font-mono !text-[11px] ${field}`} />
            <div className={`text-xs ${muted}`}>{source.trim().length > 200 ? `Código colado (${Math.round(source.length / 1000).toLocaleString('pt-BR')} mil letras): a leitura usa este código, e não baixa a página.` : 'Em branco, o Autometrics baixa o código da página sozinho.'} <button onClick={() => { setSource(''); setPasting(false); }} className="text-brand-text hover:underline">{source ? 'Apagar e fechar' : 'Fechar'}</button></div>
          </div>
        ) : <button onClick={() => setPasting(true)} className={`text-xs ${muted} hover:text-ink underline decoration-dotted text-left`}>A página bloqueia a leitura? Cole o código-fonte dela</button>}
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
              <select value={o.frete || ''} onChange={e => setOffer({ frete: e.target.value as Offer['frete'] })} aria-label="Frete" className={`${field} !bg-surface-2`}>
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
                  return <button key={n} title={v.tom} aria-pressed={on} onClick={() => setOffer({ variacoes: on ? list.filter(x => x !== num) : [...list, num] })}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border ${on ? 'bg-brand/15 border-brand/60 text-ink' : `${line} ${muted}`}`}>{v.nome}</button>;
                })}
              </div>
            </div>
          </>
        ) : (
          <>
            <textarea value={draft.ia.vsl} onChange={e => setIa({ vsl: e.target.value })} rows={3} maxLength={20000} placeholder="Transcrição da VSL (opcional, mas é o que faz o anúncio falar a mesma língua do vídeo)" aria-label="Transcrição da VSL" className={`w-full resize-y ${field}`} />
            <div>
              <div className={`${label} mb-1.5`}>Ângulos dos títulos</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(TOP_ANGLES).map(([n, v]) => {
                  const num = Number(n), list = draft.ia.angulos?.length ? draft.ia.angulos : [0], on = list.includes(num);
                  return <button key={n} title={v.tom} aria-pressed={on} onClick={() => setIa({ angulos: on ? list.filter(x => x !== num) : [...list, num] })}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border ${on ? 'bg-brand/15 border-brand text-brand-text' : 'bg-surface-2 border-line-strong text-ink-subtle hover:text-ink'}`}>{v.nome}</button>;
                })}
              </div>
              <div className={`text-[11px] ${muted} mt-1`}>Passe o mouse para ver cada um. Os títulos ligam a palavra-chave ao vídeo e à página, falam de tratamento, resultado e "como", e nunca de causa, "por quê" ou remédio pelo nome.</div>
            </div>
            <div className={`rounded-lg border ${line} p-3 space-y-2`}>
              <div className={`text-xs ${head}`}><b>Anúncios do mesmo mecanismo</b> <span className={muted}>· lê os anúncios das suas campanhas com este trecho no nome (ativas, pausadas e suspensas, últimos 180 dias). O Jev separa os que vale copiar dos que é melhor evitar, e a IA usa isso ao escrever.</span></div>
              <div className="flex gap-2">
                <input value={draft.ia.parecidas} onChange={e => setIa({ parecidas: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && draft.ia.parecidas.trim().length >= 2) runSweep(); }} placeholder="Trecho do nome: [BP], [WL]…" aria-label="Trecho do nome das campanhas do mesmo mecanismo" className={`flex-1 ${field}`} />
                <button onClick={runSweep} disabled={busy !== '' || draft.ia.parecidas.trim().length < 2} className={solid}>{busy === 'varredura' ? <Loader2 size={12} aria-hidden="true" className="animate-spin" /> : <ScanSearch size={13} aria-hidden="true" />} Varrer anúncios</button>
              </div>
              {busy === 'varredura' && <div className={`text-xs ${muted}`}>Lendo os anúncios e perguntando ao Jev; leva alguns segundos.</div>}
              {sweep && (() => {
                const total = sweep.campanhas.ativo + sweep.campanhas.pausado + sweep.campanhas.suspenso;
                const keep = (t: SweepText) => (sweepFilter === 'venderam' ? t.conversoes > 0 : sweepFilter === 'sem' ? t.conversoes <= 0 : true);
                const titles = sweep.titulos.filter(keep), descs = sweep.descricoes.filter(keep);
                const show = sweepMore ? 80 : 12;
                const tag = (t: SweepText) => (t.conversoes > 0
                  ? <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-pos/10 text-pos">{String(t.conversoes).replace('.', ',')} {t.conversoes === 1 ? 'conversão' : 'conversões'} · CPA {money(t.cpa)}</span>
                  : <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-neg/10 text-neg">sem conversão · gastou {money(t.custo)}</span>);
                const row = (t: SweepText, on: boolean, full: boolean, toggle: () => void, kind: 'titulo' | 'descricao') => {
                  const off = problemOf('topo', kind, t.texto);
                  return (
                    <div key={t.texto} className={`flex items-start gap-2 py-1.5 border-t ${line}`}>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[13px] ${on ? 'text-pos' : head}`}>{t.texto}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          {tag(t)}
                          <span className={`text-[11px] ${muted}`}>em {t.anuncios} {t.anuncios === 1 ? 'anúncio' : 'anúncios'}, {t.campanhas} {t.campanhas === 1 ? 'campanha' : 'campanhas'}</span>
                          {off && <span className="text-[11px] text-warn" title={off}>· fora da regra do topo ({off.split(';')[0]})</span>}
                        </div>
                      </div>
                      <Pick on={on} full={full} css={css} onClick={toggle} />
                    </div>
                  );
                };
                const filterBtn = (key: typeof sweepFilter, text: string) => (
                  <button key={key} onClick={() => setSweepFilter(key)} aria-pressed={sweepFilter === key}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border ${sweepFilter === key ? 'bg-brand/15 border-brand text-brand-text' : 'bg-surface-2 border-line-strong text-ink-subtle hover:text-ink'}`}>{text}</button>
                );
                return (
                  <div className="space-y-3">
                    <div className={`text-xs ${muted}`}>{total} campanhas com "{sweep.trecho}": {sweep.campanhas.ativo} ativas, {sweep.campanhas.pausado} pausadas, {sweep.campanhas.suspenso} suspensas ou sem veicular · {sweep.anuncios} anúncios diferentes nos últimos {sweep.dias} dias.</div>
                    {sweep.titulos.length > 0 && (
                      <>
                        {tally}
                        <div className={`text-xs ${muted}`}>Clique em <b className={head}>Usar</b> para levar o título ou a descrição para a campanha nova. Ao lado de cada um está quanto venderam os anúncios em que ele apareceu (o Google não conta venda por título): <span className="text-pos font-medium">verde vendeu</span>, <span className="text-neg font-medium">vermelho gastou sem vender</span>.</div>
                        <div className="flex flex-wrap gap-1.5">{filterBtn('todos', 'Todos')}{filterBtn('venderam', 'Só os que venderam')}{filterBtn('sem', 'Só os sem conversão')}</div>
                        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
                          <div><div className={`${label} mb-1`}>Títulos ({titles.length})</div>
                            {titles.slice(0, show).map(t => row(t, used.t.has(t.texto), titlesFull, () => toggleTitle(t.texto), 'titulo'))}
                            {!titles.length && <div className={`text-xs ${muted}`}>Nenhum neste filtro.</div>}</div>
                          <div><div className={`${label} mb-1`}>Descrições ({descs.length})</div>
                            {descs.slice(0, show).map(t => row(t, used.d.has(t.texto), descsFull, () => toggleDescription(t.texto), 'descricao'))}
                            {!descs.length && <div className={`text-xs ${muted}`}>Nenhuma neste filtro.</div>}</div>
                        </div>
                        {(titles.length > 12 || descs.length > 12) && <button onClick={() => setSweepMore(v => !v)} className="text-xs font-medium text-brand-text hover:underline">{sweepMore ? 'Mostrar menos' : `Mostrar todos (${titles.length} títulos, ${descs.length} descrições)`}</button>}
                      </>
                    )}
                    {(sweep.copiar.length > 0 || sweep.evitar.length > 0) && (
                      <div className={`rounded-lg ${soft} px-3 py-2 text-xs ${muted}`}>
                        <b className={head}>Isto vai sozinho para a IA:</b> {sweep.copiar.length} anúncios inteiros como exemplo do que vendeu e {sweep.evitar.length} como exemplo do que não vendeu
                        {sweep.analisados > 0 && ` (separados ${sweep.jev ? `pelo Jev${sweep.jev < sweep.analisados ? ' e pela regra do CPA, onde ele não respondeu' : ''}` : 'pela regra do CPA; o Jev não respondeu'})`}. Você não precisa fazer nada com eles.
                        <button onClick={() => setSweepOpen(v => !v)} className="ml-2 inline-flex items-center gap-0.5 text-brand-text hover:underline">{sweepOpen ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}{sweepOpen ? 'Esconder' : 'Ver quais'}</button>
                        {sweepOpen && (['copiar', 'evitar'] as const).map(kind => sweep[kind].length > 0 && (
                          <div key={kind} className="mt-2"><div className={`${label} mb-1`}>{kind === 'copiar' ? 'Exemplos do que vendeu' : 'Exemplos do que não vendeu'}</div>
                            {sweep[kind].map((a, i) => (
                              <div key={i} className={`py-1.5 border-t ${line}`}>
                                <div className={head}>{a.titulos.slice(0, 6).join(' · ')}{a.titulos.length > 6 ? ' …' : ''}</div>
                                <div>{a.resultado} · {a.situacao}</div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => generate()} disabled={busy !== '' || (draft.funil === 'fundo' && !String(o.produto || '').trim())} className={solid}>{busy === 'recursos' ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : <Sparkles size={13} aria-hidden="true" />} {pack ? 'Gerar de novo' : 'Gerar recursos'}</button>
          {busy === 'recursos' && <span className={`text-xs ${muted}`}>A IA está escrevendo e as letras estão sendo conferidas; leva até um minuto.</span>}
          {pack && busy === '' && <span className={`text-xs ${muted}`}>{pack.titulos.length} títulos, {pack.descricoes.length} descrições, {pack.sitelinks.length} sitelinks e {pack.destaques.length} frases{pack.descartados ? ` · ${pack.descartados} fora da regra foram descartados` : ''}</span>}
        </div>
        {error && <div className="text-xs text-neg">{error}</div>}
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
                      <div className="flex-1 min-w-0"><div className={`text-[13px] ${used.s.has(x.texto.texto) ? 'text-pos' : head}`}>{x.texto.texto}</div><div className={`text-[11px] ${muted}`}>{x.desc1.texto} / {x.desc2.texto}</div><div className={`text-[11px] ${muted}`}>{x.texto.pt}</div></div>
                      <Pick on={used.s.has(x.texto.texto)} full={draft.sitelinks.length >= AD_MAX.sitelinks} css={css} onClick={() => toggleSitelink({ texto: x.texto.texto, desc1: x.desc1.texto, desc2: x.desc2.texto })} />
                    </div>
                  ))}</div>
                <div><div className={`${label} mb-1`}>Frases de destaque sugeridas</div>{pack.destaques.map((t, i) => suggest(t, i, used.c.has(t.texto), draft.destaques.length >= AD_MAX.destaques, () => toggleCallout(t.texto), 25))}</div>
              </div>
            </div>
            <div className={`rounded-lg border ${line} p-3 space-y-2`}>
              <div className={`text-xs ${head}`}><b>Peça mudanças à IA</b> <span className={muted}>· diga o que mudar nos títulos e descrições, escrevendo ou falando. A IA reescreve o pacote seguindo isto.</span></div>
              <div className="flex gap-2 items-start">
                <textarea value={direction} onChange={e => setDirection(e.target.value.slice(0, 1500))} rows={2} placeholder='Ex.: "Mais títulos com como baixar a pressão sem remédio; descrições mais curtas, falando do vídeo do médico."' aria-label="Direção para a IA reescrever os títulos e descrições" className={`flex-1 resize-y ${field}`} />
                <VoiceButton onText={t => setDirection(p => (p.trim() ? `${p.trim()} ${t}` : t).slice(0, 1500))} disabled={busy !== ''} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => generate(true)} disabled={busy !== '' || !direction.trim()} className={solid}>{busy === 'reescrita' ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : <Wand2 size={13} aria-hidden="true" />} Reescrever com esta direção</button>
                <button onClick={remember} disabled={busy !== '' || (!direction.trim() && !draft.anuncio.titulos.some(Boolean) && !draft.anuncio.descricoes.some(Boolean))}
                  title="Guarda a direção e os títulos e descrições que estão na campanha nova. A IA segue isso nos próximos recursos de todas as suas campanhas deste tipo de funil."
                  className="px-3 py-2 rounded-lg border bg-brand/15 border-brand text-brand-text hover:bg-brand/25 text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5">{busy === 'memoria' ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : <BookmarkPlus size={13} aria-hidden="true" />} Guardar na memória da IA</button>
                {busy === 'reescrita' && <span className={`text-xs ${muted}`}>A IA está reescrevendo; leva até um minuto.</span>}
              </div>
              {saved ? <div className="text-xs text-pos">{saved}</div> : <div className={`text-[11px] ${muted}`}>Guardar leva a direção e os {draft.anuncio.titulos.filter(Boolean).length} títulos e {draft.anuncio.descricoes.filter(Boolean).length} descrições que estão na campanha nova. Cada reescrita é uma consulta paga à IA (poucos centavos).</div>}
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
                <button onClick={() => set({ sitelinks: draft.sitelinks.filter((_, j) => j !== i) })} aria-label={`Remover o sitelink ${i + 1}`} className={`${muted} hover:text-neg`}><X size={14} aria-hidden="true" /></button>
              </div>
              <div className="flex items-center gap-2"><input value={s.desc1} onChange={e => patch({ desc1: e.target.value })} placeholder="Linha de descrição 1" aria-label={`Descrição 1 do sitelink ${i + 1}`} className={`flex-1 ${field}`} /><Counter text={s.desc1} max={35} css={css} /><span className="w-[14px]" /></div>
              <div className="flex items-center gap-2"><input value={s.desc2} onChange={e => patch({ desc2: e.target.value })} placeholder="Linha de descrição 2" aria-label={`Descrição 2 do sitelink ${i + 1}`} className={`flex-1 ${field}`} /><Counter text={s.desc2} max={35} css={css} /><span className="w-[14px]" /></div>
            </div>
          );
        })}
        {draft.sitelinks.length < AD_MAX.sitelinks && <button onClick={() => set({ sitelinks: [...draft.sitelinks, { texto: '', desc1: '', desc2: '' }] })} className={`text-xs font-medium inline-flex items-center gap-1 ${muted} hover:text-ink`}><Plus size={13} aria-hidden="true" /> Sitelink</button>}
      </Block>

      <Block css={css} title={`Frases de destaque (${draft.destaques.length})`} hint="Criadas no nível da campanha. Até 25 letras cada.">
        <Lines items={draft.destaques} onChange={list => set({ destaques: list })} kind="destaque" max={AD_MAX.destaques} funil={draft.funil} css={css} placeholder="Frase de destaque" add="Frase" />
      </Block>

      <div className={`${card} border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="text-xs space-y-0.5">
          {problems.length ? problems.map(p => <div key={p} className="text-warn">{p}</div>) : <div className={muted}>Anúncio completo. Nada foi enviado ao Google.</div>}
        </div>
        <button onClick={onNext} disabled={problems.length > 0} className={solid}>Seguir para Onde subir</button>
      </div>
    </div>
  );
}
