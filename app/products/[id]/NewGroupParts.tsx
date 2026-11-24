"use client";

import { useEffect, useMemo, useState } from 'react';
import { Copy, Loader2, Sparkles } from 'lucide-react';
import type { Ui } from '@/app/components/metrics/ColumnPicker';

/**
 * Peças do grupo novo e do anúncio novo nas abas da campanha:
 *
 * - KeywordsField: as palavras-chave do grupo novo (obrigatórias), escritas ou copiadas de outros grupos da campanha.
 * - AiWriter: a IA escreve títulos, descrições, sitelinks e frases de destaque com as mesmas regras do criador de
 *   campanhas (topo de funil: skills auditor-congruencia-funil + master-copywriter; fundo de funil: skill
 *   gerador-recursos-fundo-de-funil), respondendo às palavras-chave do grupo.
 *
 * Quem usa passa `call` (a conversa com o servidor) e as classes de estilo do formulário.
 */

type Call = (path: string, body?: any) => Promise<{ ok: boolean; status: number; body: any }>;
export interface Cls { input: string; solid: string; ghost: string }
export type Match = 'EXACT' | 'PHRASE' | 'BROAD';
export interface Kw { text: string; match: Match }
export interface AssetPick { tipo: 'sitelink' | 'destaque'; texto: string; desc1: string; desc2: string }

const count = (text: string) => [...String(text || '').replace(/\{KeyWord:([^}]*)\}/gi, '$1')].length;
const label = (k: Kw) => (k.match === 'PHRASE' ? `"${k.text}"` : k.match === 'EXACT' ? `[${k.text}]` : k.text);
const keyOf = (k: Kw) => `${k.text.toLowerCase()}|${k.match}`;

/** Uma palavra-chave por linha: "frase", [exata] ou só o texto, que pega o tipo escolhido no seletor. */
export function parseKeywords(text: string, plain: Match): Kw[] {
  const out = new Map<string, Kw>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let k: Kw;
    if (/^".*"$/.test(line) && line.length > 2) k = { text: line.slice(1, -1).trim(), match: 'PHRASE' };
    else if (/^\[.*\]$/.test(line) && line.length > 2) k = { text: line.slice(1, -1).trim(), match: 'EXACT' };
    else k = { text: line.replace(/^\+/, '').trim(), match: plain };
    k.text = k.text.replace(/\s+/g, ' ');
    if (k.text) out.set(keyOf(k), k);
  }
  return [...out.values()];
}
export function keywordProblem(t: string): string | null {
  if (count(t) > 80) return `"${t.slice(0, 40)}" passa de 80 letras`;
  if (t.split(' ').length > 10) return `"${t.slice(0, 40)}" tem mais de 10 palavras`;
  const sym = t.match(/[!@%^*()={};~`<>?\\|]/);
  return sym ? `"${t.slice(0, 40)}" tem o símbolo ${sym[0]}, que o Google não aceita` : null;
}

// ── Palavras-chave do grupo novo ─────────────────────────────────────────────

interface GroupKw { id: string; nome: string; status: string; palavras: { texto: string; tipo: Match; status: string; cliques: number; conversoes: number; custo: number }[] }

export function KeywordsField({ call, productId, ui, cls, text, setText, plain, setPlain }: {
  call: Call; productId: string; ui: Ui; cls: Cls; text: string; setText: (v: string) => void; plain: Match; setPlain: (m: Match) => void;
}) {
  const [groups, setGroups] = useState<GroupKw[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<string>('');
  const list = useMemo(() => parseKeywords(text, plain), [text, plain]);
  const have = new Set(list.map(keyOf));
  const problem = list.map(k => keywordProblem(k.text)).find(Boolean);

  const load = async () => {
    setOpen(o => !o);
    if (groups || loading) return;
    setLoading(true); setError('');
    const { ok, body } = await call(`/api/google-ads/manage?product_id=${productId}&ver=palavras`);
    setLoading(false);
    if (ok && body.groups) { setGroups(body.groups); setShown(body.groups[0]?.id || ''); } else setError(body.error || 'O Google não respondeu.');
  };
  /** Junta as palavras à lista (as que já estão ficam como estão). */
  const add = (items: Kw[]) => {
    const fresh = items.filter(k => !have.has(keyOf(k)));
    if (!fresh.length) return;
    setText([text.trimEnd(), ...fresh.map(label)].filter(Boolean).join('\n'));
  };
  const remove = (k: Kw) => {
    const lines = text.split('\n').filter(l => { const p = parseKeywords(l, plain)[0]; return !p || keyOf(p) !== keyOf(k); });
    setText(lines.join('\n'));
  };
  const asKw = (p: GroupKw['palavras'][number]): Kw => ({ text: p.texto, match: p.tipo });
  const g = groups?.find(x => x.id === shown);

  return (
    <div className="space-y-2">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
        placeholder={'Uma por linha. Ex.:\n"natural remedy for neuropathy"\n[neuropathy treatment]'} aria-label="Palavras-chave do grupo" className={`${cls.input} w-full font-mono`} />
      <div className="flex flex-wrap items-center gap-2">
        <label className={`text-xs ${ui.textMuted} inline-flex items-center gap-1.5`}>Linha sem sinal entra como
          <select value={plain} onChange={e => setPlain(e.target.value as Match)} aria-label="Tipo das linhas sem sinal" className={cls.input}>
            <option value="PHRASE">Frase</option><option value="EXACT">Exata</option><option value="BROAD">Ampla</option>
          </select>
        </label>
        <button type="button" onClick={load} className={cls.ghost}>{loading ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Copiar de outro grupo</button>
        <span className={`text-xs ${list.length ? 'text-pos' : 'text-warn'}`}>{list.length ? `${list.length} ${list.length === 1 ? 'palavra-chave' : 'palavras-chave'}` : 'Nenhuma palavra-chave ainda: obrigatório.'}</span>
      </div>
      {problem && <div className="text-xs text-neg">{problem}.</div>}
      <div className={`text-[11px] ${ui.textMuted}`}>&quot;entre aspas&quot; = frase · [entre colchetes] = exata · sem sinal = o tipo escolhido ao lado.</div>
      {open && (
        <div className={`rounded-lg border ${ui.borderCol} p-3 space-y-2`}>
          {error && <div className="text-xs text-neg">{error}</div>}
          {loading && <div className={`text-xs ${ui.textMuted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> lendo as palavras-chave dos grupos no Google…</div>}
          {groups && !groups.length && <div className={`text-xs ${ui.textMuted}`}>Nenhum grupo da campanha tem palavras-chave.</div>}
          {groups && groups.length > 0 && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {groups.map(x => (
                  <button key={x.id} type="button" onClick={() => setShown(x.id)}
                    className={`px-2 py-1 rounded-md text-xs border ${x.id === shown ? 'border-brand text-brand-text bg-brand/10' : `${ui.borderCol} ${ui.textHead}`}`}>
                    {x.nome}{x.status !== 'ENABLED' ? ' (pausado)' : ''} · {x.palavras.length}
                  </button>
                ))}
              </div>
              {g && (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => add(g.palavras.filter(p => p.status === 'ENABLED').map(asKw))} className={cls.solid}>Copiar as {g.palavras.filter(p => p.status === 'ENABLED').length} ativas</button>
                    {g.palavras.some(p => p.conversoes > 0) && <button type="button" onClick={() => add(g.palavras.filter(p => p.conversoes > 0).map(asKw))} className={cls.ghost}>Só as que converteram ({g.palavras.filter(p => p.conversoes > 0).length})</button>}
                    <span className={`text-[11px] ${ui.textMuted}`}>ou clique em cada uma · números dos últimos 30 dias</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {g.palavras.map(p => {
                      const k = asKw(p), on = have.has(keyOf(k));
                      return (
                        <button key={keyOf(k)} type="button" onClick={() => (on ? remove(k) : add([k]))}
                          className={`w-full flex flex-wrap items-center justify-between gap-2 border-t ${ui.borderCol} py-1.5 text-left text-[13px]`}>
                          <span className={`font-mono ${on ? 'text-brand-text font-medium' : ui.textHead}`}>{on ? '✓ ' : '+ '}{label(k)}{p.status !== 'ENABLED' ? <span className={`ml-1.5 text-[11px] ${ui.textMuted}`}>(pausada)</span> : null}</span>
                          <span className={`text-[11px] ${p.conversoes > 0 ? 'text-pos font-medium' : ui.textMuted}`}>
                            {p.conversoes > 0 ? `${(Math.round(p.conversoes * 10) / 10).toLocaleString('pt-BR')} conv. · ` : ''}{p.cliques.toLocaleString('pt-BR')} cliques
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── A IA escreve os recursos ─────────────────────────────────────────────────

interface Item { texto: string; pt: string }
interface Pack { titulos: Item[]; descricoes: Item[]; sitelinks: { tema: string; texto: Item; desc1: Item; desc2: Item }[]; destaques: Item[]; descartados: number }
interface OfferRead { produto?: string; moeda?: string; preco?: string; preco_original?: string; desconto_valor?: string; desconto_pct?: string; frete?: string; garantia_dias?: number | null; oficial?: boolean }

/**
 * `assets`: 'grupo' marca os sitelinks e frases para entrarem junto com o grupo novo (onToggleAsset);
 * 'campanha' inclui na campanha na hora (onAddAsset).
 */
export function AiWriter({ call, ui, cls, campaignName, url, keywords, isOn, onPick, onFill, assets, isAssetOn, onToggleAsset, onAddAsset }: {
  call: Call; ui: Ui; cls: Cls; campaignName?: string; url: string; keywords: string[];
  isOn: (kind: 'titulo' | 'descricao', text: string) => boolean;
  onPick: (kind: 'titulo' | 'descricao', text: string) => void;
  onFill: (titulos: string[], descricoes: string[]) => void;
  assets: 'grupo' | 'campanha';
  isAssetOn?: (a: AssetPick) => boolean;
  onToggleAsset?: (a: AssetPick) => void;
  onAddAsset?: (a: AssetPick) => Promise<string | null>;
}) {
  const [funil, setFunil] = useState<'topo' | 'fundo'>(/\[(FF|FUNDO)\]/i.test(campaignName || '') ? 'fundo' : 'topo');
  const [idioma, setIdioma] = useState('inglês');
  const [pais, setPais] = useState('Estados Unidos');
  const [offer, setOffer] = useState<OfferRead | null>(null);
  const [produto, setProduto] = useState('');
  const [vsl, setVsl] = useState('');
  const [showVsl, setShowVsl] = useState(false);
  const [direcao, setDirecao] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pack, setPack] = useState<Pack | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => { setOffer(null); }, [url]);

  const page = url.trim().split('?')[0];
  const generate = async () => {
    setError('');
    if (!/^https:\/\//i.test(page)) { setError('Preencha a página do anúncio (https://…) antes: a IA lê a página para escrever.'); return; }
    let o = offer, name = produto.trim();
    if (funil === 'fundo' && !o) {
      setBusy('Lendo a página do produto…');
      const r = await call('/api/campaign-builder', { action: 'oferta', url: page });
      if (r.ok && r.body.offer) {
        o = Object.fromEntries(Object.entries(r.body.offer).filter(([, v]) => v !== '' && v !== null && v !== false)) as OfferRead;
        setOffer(o);
        if (!name && o.produto) { name = o.produto; setProduto(o.produto); }
      } else if (!name) { setBusy(''); setError(`${r.body.error || 'Não deu para ler a página.'} Escreva o nome do produto e tente de novo.`); return; }
    }
    if (funil === 'fundo' && !name) { setBusy(''); setError('Escreva o nome do produto: a página não disse.'); return; }
    setBusy('A IA está escrevendo…');
    const reescrita = direcao.trim() && pack ? { direcao: direcao.trim(), titulos: pack.titulos.map(t => t.texto), descricoes: pack.descricoes.map(t => t.texto), escolhidos: [] } : undefined;
    const payload = funil === 'fundo'
      ? { action: 'recursos', funil, reescrita, oferta: { ...(o || {}), produto: name, idioma, pais, variacoes: [0], palavras: keywords } }
      : { action: 'recursos', funil, reescrita, topo: { url: page, idioma, pais, vsl, palavras: keywords, angulos: [0] } };
    const r = await call('/api/campaign-builder', payload);
    setBusy('');
    if (!r.ok || !r.body.pack) { setError(r.body.error || 'A IA não respondeu. Tente de novo.'); return; }
    setPack(r.body.pack); setAdded([]);
    if (funil === 'topo' && r.body.page_read === false) setError('A página não pôde ser lida: a IA escreveu só com as palavras-chave' + (vsl ? ' e a transcrição' : '') + '.');
  };
  const addCampaign = async (a: AssetPick) => {
    if (!onAddAsset) return;
    setBusy(`+${a.texto}`);
    const problem = await onAddAsset(a);
    setBusy('');
    if (problem) setError(problem); else setAdded(x => [...x, `${a.tipo}|${a.texto}`]);
  };

  const row = (kind: 'titulo' | 'descricao', it: Item) => {
    const on = isOn(kind, it.texto), max = kind === 'titulo' ? 30 : 90;
    return (
      <button key={it.texto} type="button" onClick={() => onPick(kind, it.texto)}
        className={`w-full text-left border-t ${ui.borderCol} py-1.5 text-[13px]`}>
        <span className={on ? 'text-brand-text font-medium' : ui.textHead}>{on ? '✓ ' : '+ '}{it.texto}</span>
        <span className={`ml-1.5 text-[11px] ${count(it.texto) > max ? 'text-neg' : ui.textMuted}`}>({count(it.texto)})</span>
        {it.pt && <div className={`text-[11px] ${ui.textMuted}`}>{it.pt}</div>}
      </button>
    );
  };
  const assetRow = (a: AssetPick, pt: string, extra?: string) => {
    const k = `${a.tipo}|${a.texto}`;
    const on = assets === 'grupo' ? !!isAssetOn?.(a) : added.includes(k);
    return (
      <div key={k} className={`flex items-start justify-between gap-2 border-t ${ui.borderCol} py-1.5 text-[13px]`}>
        <div className="min-w-0">
          <span className={on ? 'text-brand-text font-medium' : ui.textHead}>{a.texto}</span>{extra && <span className={`text-xs ${ui.textMuted}`}> · {extra}</span>}
          {pt && <div className={`text-[11px] ${ui.textMuted}`}>{pt}</div>}
        </div>
        {assets === 'grupo'
          ? <button type="button" onClick={() => onToggleAsset?.(a)} className={`text-xs font-semibold whitespace-nowrap ${on ? 'text-pos' : 'text-brand-text'} hover:underline`}>{on ? '✓ no grupo' : '+ no grupo'}</button>
          : on ? <span className="text-xs text-pos whitespace-nowrap">incluído</span>
            : <button type="button" disabled={!!busy} onClick={() => addCampaign(a)} className="text-xs font-semibold text-brand-text hover:underline whitespace-nowrap disabled:opacity-40">{busy === `+${a.texto}` ? '…' : 'Incluir na campanha'}</button>}
      </div>
    );
  };

  return (
    <div className={`rounded-lg border ${ui.borderCol} p-3 space-y-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={14} className="text-brand-text" />
        <span className={`text-[13px] font-semibold ${ui.textHead}`}>Escrever com a IA</span>
        <div className="inline-flex rounded-lg border border-line-strong overflow-hidden ml-1">
          {(['topo', 'fundo'] as const).map(f => (
            <button key={f} type="button" onClick={() => { setFunil(f); setPack(null); }} className={`px-2.5 py-1 text-xs font-medium ${funil === f ? 'bg-brand text-white' : ui.textHead}`}>{f === 'topo' ? 'Topo de funil' : 'Fundo de funil'}</button>
          ))}
        </div>
        <input value={idioma} onChange={e => setIdioma(e.target.value)} aria-label="Idioma do anúncio" placeholder="idioma" className={`${cls.input} w-24`} />
        <input value={pais} onChange={e => setPais(e.target.value)} aria-label="País" placeholder="país" className={`${cls.input} w-36`} />
        {funil === 'fundo' && <input value={produto} onChange={e => setProduto(e.target.value)} aria-label="Nome do produto" placeholder="produto (lido da página)" className={`${cls.input} w-44`} />}
      </div>
      <div className={`text-[11px] ${ui.textMuted}`}>
        {funil === 'fundo'
          ? 'Fundo de funil: segue a skill gerador-recursos-fundo-de-funil. Lê preço, garantia e frete da página do anúncio, sem inventar valores.'
          : 'Topo de funil: segue as regras de recursos da auditor-congruencia-funil e da master-copywriter (dor + solução na mesma frase). Lê a página do anúncio e, se colar, a VSL.'}
        {' '}Escreve para as {keywords.length || 'palavras-chave'} {keywords.length === 1 ? 'palavra-chave' : 'palavras-chave'} {keywords.length ? 'informadas' : '(inclua antes, para os textos responderem a elas)'}.
      </div>
      {funil === 'topo' && (showVsl
        ? <textarea value={vsl} onChange={e => setVsl(e.target.value)} rows={3} placeholder="Transcrição da VSL (opcional)" aria-label="Transcrição da VSL" className={`${cls.input} w-full`} />
        : <button type="button" onClick={() => setShowVsl(true)} className="text-xs font-semibold text-brand-text hover:underline">+ colar a transcrição da VSL (opcional)</button>)}
      {offer && funil === 'fundo' && (
        <div className={`text-[11px] ${ui.textMuted}`}>Lido na página: {[offer.produto, offer.preco && `preço ${offer.preco}`, offer.preco_original && `de ${offer.preco_original}`, offer.garantia_dias && `garantia de ${offer.garantia_dias} dias`, offer.frete && `frete ${offer.frete}`, offer.oficial && 'site oficial'].filter(Boolean).join(' · ') || 'nada além do texto'}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {pack && <input value={direcao} onChange={e => setDirecao(e.target.value)} placeholder="Direção para reescrever (opcional): ex. mais urgência, citar a garantia…" aria-label="Direção para a IA" className={`${cls.input} flex-1 min-w-[220px]`} />}
        <button type="button" onClick={generate} disabled={!!busy} className={cls.solid}>{busy && !busy.startsWith('+') ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {busy && !busy.startsWith('+') ? busy : pack ? (direcao.trim() ? 'Reescrever' : 'Escrever de novo') : 'Escrever com a IA'}</button>
      </div>
      {error && <div className="text-xs text-neg">{error}</div>}
      {pack && (
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => onFill(pack.titulos.map(t => t.texto), pack.descricoes.map(t => t.texto))} className={cls.ghost}>Preencher as vagas vazias do anúncio</button>
            <span className={`text-[11px] ${ui.textMuted}`}>Ou clique em cada texto para pôr (ou tirar) do anúncio.{pack.descartados > 0 ? ` ${pack.descartados} ficaram de fora por passar do limite de letras.` : ''}</span>
          </div>
          <div className="grid lg:grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <div className={`text-xs font-medium ${ui.textHead}`}>Títulos ({pack.titulos.length})</div>
              <div className="max-h-72 overflow-y-auto">{pack.titulos.map(t => row('titulo', t))}</div>
            </div>
            <div>
              <div className={`text-xs font-medium ${ui.textHead}`}>Descrições ({pack.descricoes.length})</div>
              <div className="max-h-72 overflow-y-auto">{pack.descricoes.map(t => row('descricao', t))}</div>
            </div>
            <div>
              <div className={`text-xs font-medium ${ui.textHead}`}>Sitelinks ({pack.sitelinks.length})</div>
              <div className="max-h-72 overflow-y-auto">{pack.sitelinks.map(x => assetRow({ tipo: 'sitelink', texto: x.texto.texto, desc1: x.desc1.texto, desc2: x.desc2.texto }, x.texto.pt, `${x.desc1.texto} · ${x.desc2.texto}`))}</div>
            </div>
            <div>
              <div className={`text-xs font-medium ${ui.textHead}`}>Frases de destaque ({pack.destaques.length})</div>
              <div className="max-h-72 overflow-y-auto">{pack.destaques.map(x => assetRow({ tipo: 'destaque', texto: x.texto, desc1: '', desc2: '' }, x.pt))}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
