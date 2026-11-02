"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Copy, ExternalLink, Loader2, Plus, RotateCcw, Search } from 'lucide-react';
import { resolveCampaignStatus, type StatusKey } from '@/lib/campaignStatus';
import type { HistoryEvent, HistoryItem } from '@/lib/campaignBuilder/history';
import type { Css } from './StepCampaign';

/**
 * Histórico: as campanhas que o Autometrics já criou ou duplicou, da mais nova
 * para a mais velha, com a situação de hoje e uma linha do tempo curta (como
 * nasceu, os períodos de cada situação com gasto e conversões, as pausas e
 * ativações feitas por aqui). Só para consultar: nada nesta aba altera a
 * campanha; pausar, ativar e editar continuam na página de cada uma.
 */

type Api = (path: string, body?: Record<string, any>) => Promise<{ ok: boolean; body: any }>;
type Kind = 'todas' | 'criar' | 'duplicar';
type Situation = 'todas' | StatusKey | 'recusada';

const symbolOf = (c?: string | null) => (c === 'BRL' ? 'R$' : c === 'EUR' ? '€' : c === 'USD' || !c ? 'US$' : c);
const money = (v: number, c?: string | null) => `${symbolOf(c)} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const number = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const day = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const situationOf = (h: HistoryItem): Situation => (!h.ok ? 'recusada' : resolveCampaignStatus({ effective_status: h.situacao, campaign_status_reasons: h.situacao_motivos }).key);

function Badge({ h }: { h: HistoryItem }) {
  if (!h.ok) return <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded border bg-neg/10 text-neg border-neg/30">Recusada</span>;
  if (!h.situacao) return <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded border bg-surface-3 text-ink-subtle border-line" title="A coleta ainda não trouxe esta campanha">Aguardando coleta</span>;
  const s = resolveCampaignStatus({ effective_status: h.situacao, campaign_status_reasons: h.situacao_motivos });
  return <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded border ${s.badge}`} title={s.hint}>{s.label}</span>;
}

function Timeline({ h, css }: { h: HistoryItem; css: Css }) {
  const dot = (e: HistoryEvent) => (e.status ? resolveCampaignStatus({ effective_status: e.status }).dot : 'bg-neg');
  return (
    <ol className="space-y-2">
      {h.eventos.map((e, i) => (
        <li key={i} className="flex gap-3 text-[13px]">
          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dot(e)}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className={css.head}>{e.texto}</div>
            <div className={`text-xs ${css.muted}`}>
              {e.quando.length > 10 ? when(e.quando) : e.ate && e.ate !== e.quando ? `${day(e.quando)} a ${day(e.ate)}` : day(e.quando)}
              {e.gasto !== undefined && ` · gasto ${money(e.gasto, h.moeda)} · ${number(e.conversoes || 0)} ${e.conversoes === 1 ? 'conversão' : 'conversões'}`}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function History({ css, api }: { css: Css; api: Api }) {
  const { card, head, muted, line } = css;
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<Kind>('todas');
  const [situation, setSituation] = useState<Situation>('todas');
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    const { ok, body } = await api('/api/campaign-builder?historico=1');
    if (!ok || !Array.isArray(body.history)) setError(body.error || 'Não foi possível ler o histórico.');
    else setItems(body.history);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byKind = useMemo(() => (items || []).filter(h => kind === 'todas' || h.tipo === kind), [items, kind]);
  const count = (s: Situation) => (s === 'todas' ? byKind.length : byKind.filter(h => situationOf(h) === s).length);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return byKind.filter(h => (situation === 'todas' || situationOf(h) === situation)
      && (!f || `${h.nome} ${h.conta} ${h.mcc} ${h.origem || ''} ${h.campanha_id || ''}`.toLowerCase().includes(f)));
  }, [byKind, situation, filter]);

  const toggle = (on: boolean) => `px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${on ? 'bg-brand/15 border-brand text-brand-text' : 'bg-surface-2 border-line-strong text-ink-subtle hover:text-ink'}`;
  const situations: [Situation, string][] = [['todas', 'Todas'], ['ativo', 'Ativas'], ['pausado', 'Pausadas'], ['suspenso', 'Suspensas ou sem veicular'], ['recusada', 'Recusadas']];

  return (
    <div className="space-y-4">
      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className={`text-sm font-semibold ${head}`}>Campanhas criadas e duplicadas pelo Autometrics</div>
            <div className={`text-xs ${muted} mt-0.5`}>Só para consultar: nada aqui altera a campanha. A situação é a da última coleta do Google; pausar, ativar e editar continuam na página de cada campanha.</div>
          </div>
          <button onClick={load} disabled={loading} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 border border-line-strong text-ink hover:bg-surface-3 disabled:opacity-60">
            {loading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />} Atualizar
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Como a campanha nasceu">
          {([['todas', 'Criadas e duplicadas'], ['criar', 'Só criadas'], ['duplicar', 'Só duplicadas']] as const).map(([id, name]) => (
            <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)} className={toggle(kind === id)}>
              {name} <span className="opacity-70">{id === 'todas' ? (items || []).length : (items || []).filter(h => h.tipo === id).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Situação">
          {situations.filter(([id]) => id === 'todas' || count(id) > 0).map(([id, name]) => (
            <button key={id} aria-pressed={situation === id} onClick={() => setSituation(id)} className={toggle(situation === id)}>
              {name} <span className="opacity-70">{count(id)}</span>
            </button>
          ))}
        </div>
        <label className={`flex items-center gap-2 rounded-lg border ${line} bg-surface-2 px-3 py-2`}>
          <Search size={14} className={muted} aria-hidden="true" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar por nome, conta, MCC ou campanha de origem"
            className={`w-full bg-transparent outline-none text-[13px] ${head} placeholder:text-ink-faint`} />
        </label>
      </div>

      {error && <div className="rounded-xl border border-neg/30 bg-neg/10 text-neg text-[13px] px-4 py-3">{error}</div>}
      {!items && !error && <div className={`flex items-center gap-2 text-[13px] ${muted}`}><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Lendo o histórico…</div>}
      {items && !items.length && <div className={`${card} border rounded-xl p-5 text-[13px] ${muted}`}>Nenhuma campanha foi criada ou duplicada pelo Autometrics ainda.</div>}
      {items && !!items.length && !shown.length && <div className={`${card} border rounded-xl p-5 text-[13px] ${muted}`}>Nenhuma campanha com esse filtro.</div>}

      {!!shown.length && (
        <div className={`${card} border rounded-xl divide-y divide-line overflow-hidden`}>
          {shown.map(h => {
            const expanded = open === h.id;
            return (
              <div key={h.id}>
                <button onClick={() => setOpen(expanded ? null : h.id)} aria-expanded={expanded}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-2 transition-colors">
                  <span className={`mt-0.5 shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-surface-3 ${muted}`} title={h.tipo === 'duplicar' ? 'Duplicada' : 'Criada'}>
                    {h.tipo === 'duplicar' ? <Copy size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[13px] font-medium ${head} break-words`}>{h.nome}</span>
                      <Badge h={h} />
                    </div>
                    <div className={`text-xs ${muted} mt-0.5`}>
                      {h.tipo === 'duplicar' ? 'Duplicada' : 'Criada'} em {when(h.quando)} · {h.conta}{h.mcc ? ` · ${h.mcc}` : ''}
                      {h.origem && <> · cópia de <span className={head}>{h.origem}</span></>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right hidden sm:block">
                    <div className={`text-[13px] tabular-nums ${head}`}>{money(h.gasto, h.moeda)}</div>
                    <div className={`text-xs tabular-nums ${muted}`}>{number(h.conversoes)} {h.conversoes === 1 ? 'conversão' : 'conversões'}</div>
                  </div>
                  <ChevronDown size={16} className={`mt-1 shrink-0 ${muted} transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {expanded && (
                  <div className="px-4 pb-4 pl-[52px] space-y-3">
                    <div className={`sm:hidden text-xs ${muted}`}>Gasto {money(h.gasto, h.moeda)} · {number(h.conversoes)} {h.conversoes === 1 ? 'conversão' : 'conversões'}</div>
                    {h.erro && <div className="rounded-lg border border-neg/30 bg-neg/10 text-neg text-xs px-3 py-2">{h.erro}</div>}
                    {h.aviso && <div className="rounded-lg border border-warn/30 bg-warn/10 text-warn text-xs px-3 py-2">{h.aviso}</div>}
                    <Timeline h={h} css={css} />
                    {h.ok && h.situacao && h.situacao_motivos && (
                      <div className={`text-xs ${muted}`}>{resolveCampaignStatus({ effective_status: h.situacao, campaign_status_reasons: h.situacao_motivos }).hint}</div>
                    )}
                    <div className={`flex flex-wrap items-center gap-3 text-xs ${muted}`}>
                      {h.campanha_id && <span>Campanha {h.campanha_id} · conta {h.conta_id}</span>}
                      {h.product_id && (
                        <Link href={`/products/${h.product_id}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-brand hover:bg-brand-hover text-white font-medium">
                          Abrir campanha <ExternalLink size={12} aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
