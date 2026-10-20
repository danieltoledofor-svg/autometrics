"use client";

import React, { useState } from 'react';
import { Check, Loader2, Plus, ScanSearch } from 'lucide-react';
import type { Sweep, SweepText } from '@/lib/campaignBuilder/sweep';

/**
 * Sugestões tiradas das campanhas do usuário com um trecho no nome (a marcação
 * dele, como [BP]): ativas, pausadas e suspensas, últimos 180 dias. É a mesma
 * varredura do criador de campanhas (/api/campaign-builder?varredura=), em que o
 * Jev separa os anúncios que vale copiar dos que é melhor evitar.
 *
 * `kinds` diz o que mostrar: títulos e descrições (edição do anúncio) ou
 * sitelinks e frases de destaque. Cada item vem com o que vendeu e o CPA, e um
 * botão para usar.
 */

export type PickKind = 'titulo' | 'descricao' | 'sitelink' | 'destaque';
type Api = (path: string) => Promise<{ ok: boolean; body: any }>;

export function SweepPicker({ api, initial, kinds, symbol, isOn, onPick, full }: {
  api: Api; initial: string; kinds: 'textos' | 'recursos'; symbol: string;
  isOn: (kind: PickKind, text: string) => boolean;
  onPick: (kind: PickKind, item: SweepText) => void;
  full?: (kind: PickKind) => boolean;
}) {
  const [piece, setPiece] = useState(initial);
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'todos' | 'venderam' | 'sem'>('todos');
  const [more, setMore] = useState(false);

  const search = async () => {
    if (piece.trim().length < 2) return;
    setBusy(true); setError('');
    const { ok, body } = await api(`/api/campaign-builder?varredura=${encodeURIComponent(piece.trim())}`).catch(() => ({ ok: false, body: {} as any }));
    setBusy(false);
    if (!ok || !body.sweep) { setError(body.error || 'Não foi possível buscar.'); return; }
    setSweep(body.sweep); setMore(false);
  };

  const money = (v: number | null) => (v === null ? '—' : `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const keep = (t: SweepText) => (filter === 'venderam' ? t.conversoes > 0 : filter === 'sem' ? t.conversoes <= 0 : true);
  const columns: { kind: PickKind; title: string; list: SweepText[] }[] = !sweep ? [] : kinds === 'textos'
    ? [{ kind: 'titulo', title: 'Títulos', list: sweep.titulos }, { kind: 'descricao', title: 'Descrições', list: sweep.descricoes }]
    : [{ kind: 'sitelink', title: 'Sitelinks', list: sweep.sitelinks || [] }, { kind: 'destaque', title: 'Frases de destaque', list: sweep.destaques || [] }];
  const show = more ? 80 : 10;
  const total = sweep ? sweep.campanhas.ativo + sweep.campanhas.pausado + sweep.campanhas.suspenso : 0;
  const pill = (on: boolean) => `px-2.5 py-1 text-xs font-medium rounded-lg border ${on ? 'bg-brand/15 border-brand text-brand-text' : 'bg-surface-2 border-line-strong text-ink-subtle hover:text-ink'}`;

  const row = (kind: PickKind, t: SweepText) => {
    const on = isOn(kind, t.texto), locked = !on && !!full?.(kind);
    return (
      <div key={t.texto} className="flex items-start gap-2 py-1.5 border-t border-line">
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] ${on ? 'text-pos' : 'text-ink'}`}>{t.texto}</div>
          {t.desc1 && <div className="text-[11px] text-ink-subtle">{t.desc1} · {t.desc2}</div>}
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {t.conversoes > 0
              ? <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-pos/10 text-pos">{String(t.conversoes).replace('.', ',')} {t.conversoes === 1 ? 'conversão' : 'conversões'} · CPA {money(t.cpa)}</span>
              : <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-neg/10 text-neg">sem conversão · gastou {money(t.custo)}</span>}
            {t.veredito === 'copiar' && <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-brand/15 text-brand-text">Jev: vale copiar</span>}
            {t.veredito === 'evitar' && <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-warn/10 text-warn">Jev: melhor evitar</span>}
            <span className="text-[11px] text-ink-subtle">{t.anuncios ? `em ${t.anuncios} ${t.anuncios === 1 ? 'anúncio' : 'anúncios'}, ` : 'em '}{t.campanhas} {t.campanhas === 1 ? 'campanha' : 'campanhas'}</span>
          </div>
        </div>
        <button onClick={() => onPick(kind, t)} disabled={locked} aria-pressed={on}
          title={on ? 'Já está aqui.' : locked ? 'Não há vaga livre: tire um antes.' : 'Usar este'}
          className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border ${on ? 'bg-pos/10 border-pos/60 text-pos' : locked ? 'border-line text-ink-subtle opacity-50 cursor-not-allowed' : 'bg-brand hover:bg-brand-hover border-brand text-white'}`}>
          {on ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}{on ? 'Já está' : locked ? 'Sem vaga' : 'Usar'}
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-line p-3 space-y-2">
      <div className="text-xs text-ink"><b>{kinds === 'textos' ? 'Títulos e descrições que melhor converteram' : 'Sitelinks e frases de destaque que melhor converteram'}</b>{' '}
        <span className="text-ink-subtle">· nas suas campanhas com este trecho no nome (ativas, pausadas e suspensas, últimos 180 dias), com o Jev marcando o que vale copiar.</span></div>
      <div className="flex gap-2">
        <input value={piece} onChange={e => setPiece(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} placeholder="Trecho do nome: [BP], bloodpril…" aria-label="Trecho do nome das campanhas"
          className="flex-1 rounded-lg border border-line px-3 py-1.5 text-[13px] outline-none focus:border-brand bg-surface-2 text-ink" />
        <button onClick={search} disabled={busy || piece.trim().length < 2} className="bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5">
          {busy ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : <ScanSearch size={13} aria-hidden="true" />} Buscar
        </button>
      </div>
      {error && <div className="text-xs text-neg">{error}</div>}
      {sweep && (
        <>
          <div className="text-xs text-ink-subtle">{total} campanhas com "{sweep.trecho}": {sweep.campanhas.ativo} ativas, {sweep.campanhas.pausado} pausadas, {sweep.campanhas.suspenso} suspensas ou sem veicular.
            {kinds === 'textos' ? ' Ao lado de cada texto, quanto venderam os anúncios em que ele apareceu (o Google não conta venda por título).' : ' Ao lado de cada um, quanto ele mesmo vendeu.'}{' '}
            <span className="text-pos font-medium">Verde vendeu</span>, <span className="text-neg font-medium">vermelho gastou sem vender</span>.</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setFilter('todos')} aria-pressed={filter === 'todos'} className={pill(filter === 'todos')}>Todos</button>
            <button onClick={() => setFilter('venderam')} aria-pressed={filter === 'venderam'} className={pill(filter === 'venderam')}>Só os que venderam</button>
            <button onClick={() => setFilter('sem')} aria-pressed={filter === 'sem'} className={pill(filter === 'sem')}>Só os sem conversão</button>
          </div>
          <div className="grid lg:grid-cols-2 gap-x-6 gap-y-3">
            {columns.map(c => {
              const list = c.list.filter(keep);
              return (
                <div key={c.kind}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle mb-1">{c.title} ({list.length})</div>
                  {list.slice(0, show).map(t => row(c.kind, t))}
                  {!list.length && <div className="text-xs text-ink-subtle">Nenhum neste filtro.</div>}
                </div>
              );
            })}
          </div>
          {columns.some(c => c.list.filter(keep).length > 10) && <button onClick={() => setMore(v => !v)} className="text-xs font-medium text-brand-text hover:underline">{more ? 'Mostrar menos' : 'Mostrar todos'}</button>}
        </>
      )}
    </div>
  );
}
