"use client";

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useGoogleControls, adjustText, type GoogleControl } from './useGoogleControls';

/**
 * Faixa no topo da campanha: meta de CPA (ou limite de CPC) e orçamento diário
 * como estão no Google agora, com alteração ali mesmo, e o que já foi alterado
 * pelo Autometrics, com desfazer. Só aparece para os logins liberados.
 */

const KIND: Record<string, string> = { meta_cpa: 'Meta de CPA', meta_cpa_grupo: 'Meta de CPA do grupo', limite_cpc: 'Limite de CPC', orcamento: 'Orçamento diário', aparelho: 'Aparelho', idade: 'Idade', genero: 'Gênero', renda: 'Renda', local: 'Local' };
const MONEY = new Set(['meta_cpa', 'limite_cpc', 'orcamento']);
/** Feito ou desfeito, sem valor: negativa de termo e pausa de palavra-chave. */
const DONE: Record<string, [string, string]> = { negativa: ['Negativa criada', 'Negativa removida'], pausar_palavra: ['Palavra-chave pausada', 'Palavra-chave reativada'] };
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');

export function GoogleControlsBar({ productId, ui }: { productId: string; ui: { isDark: boolean; bgCard: string; borderCol: string; textHead: string; textMuted: string } }) {
  const { allowed, loading, error, currency, controls, history, change } = useGoogleControls(productId);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ control: GoogleControl; value: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  // A lista de alterações pode ficar fechada; a escolha vale para todas as campanhas, neste navegador.
  const [closed, setClosed] = useState(false);
  useEffect(() => { try { setClosed(localStorage.getItem('am_alteracoes_fechadas') === '1'); } catch { /* sem armazenamento */ } }, []);
  const toggleClosed = () => setClosed(v => { try { localStorage.setItem('am_alteracoes_fechadas', v ? '0' : '1'); } catch { /* sem armazenamento */ } return !v; });
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;

  if (!allowed) return null;
  const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : 'US$';
  const money = (v: number | null) => (v === null ? 'sem valor' : `${symbol} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const show = (kind: string, v: number | null) => (kind === 'meta_cpa_grupo' ? (v ? money(v) : 'a da campanha') : MONEY.has(kind) ? money(v) : adjustText(v) === '—' ? 'sem ajuste' : adjustText(v));
  const describe = (h: any) => (DONE[h.kind] ? `${DONE[h.kind][h.undo_of ? 1 : 0]}: ${h.target}`
    : `${MONEY.has(h.kind) ? KIND[h.kind] : `${KIND[h.kind] || h.kind} ${h.target}`}: de ${show(h.kind, h.previous_value === null ? null : Number(h.previous_value))} para ${show(h.kind, Number(h.new_value))}${h.undo_of ? ' (desfazendo)' : ''}`);
  const main = controls.filter(c => MONEY.has(c.kind));
  const field = `w-28 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-indigo-500 ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`;
  const solid = 'bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5';
  const ghost = `px-3 py-1.5 rounded-lg border ${borderCol} text-xs font-bold ${textMuted} hover:text-indigo-400 disabled:opacity-40`;

  const send = async (key: string, body: any) => {
    setBusy(key);
    setMessage('');
    const problem = await change(body);
    setMessage(problem);
    setBusy('');
    setConfirm(null);
    if (!problem) setDraft({});
  };
  const shown = showAll ? history : history.slice(0, 3);

  return (
    <div className={`${bgCard} border rounded-xl p-4 mb-6`}>
      <div className="flex flex-wrap items-baseline gap-x-3 mb-3">
        <span className={`text-sm font-bold ${textHead}`}>No Google agora</span>
        <span className={`text-xs ${textMuted}`}>O que você alterar aqui muda a campanha no Google Ads. A meta de cada grupo fica na aba Grupos de Anúncios; os ajustes de lance, nas abas Públicos e Locais.</span>
      </div>
      {loading && <div className={`flex items-center gap-2 text-xs ${textMuted}`}><Loader2 size={14} className="animate-spin" /> Lendo do Google…</div>}
      {error && <div className="text-xs text-amber-500">{error}</div>}

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {main.map(c => {
          const text = draft[c.kind] ?? '';
          const value = Number(text.replace(',', '.'));
          const valid = text.trim() !== '' && Number.isFinite(value) && value > 0 && value !== c.value;
          return (
            <div key={c.kind} className="min-w-[220px]">
              <div className={`text-xs ${textMuted}`}>{c.label}: <b className={textHead}>{money(c.value)}</b></div>
              {c.editable ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-xs ${textMuted}`}>{symbol}</span>
                  <input value={text} onChange={e => setDraft(d => ({ ...d, [c.kind]: e.target.value }))} inputMode="decimal" placeholder="novo valor" className={field} aria-label={`Novo valor de ${c.label}`}
                    onKeyDown={e => { if (e.key === 'Enter' && valid) setConfirm({ control: c, value }); }} />
                  <button disabled={!valid} onClick={() => setConfirm({ control: c, value })} className={ghost}>Alterar</button>
                </div>
              ) : null}
              {c.note && !/^[A-Z_]+$/.test(c.note) && <div className="text-[11px] text-amber-500 mt-1 max-w-[320px]">{c.note}</div>}
            </div>
          );
        })}
      </div>

      {confirm && (() => {
        const before = confirm.control.value, pctChange = before ? Math.round(((confirm.value - before) / before) * 100) : null;
        return (
          <div className="mt-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5">
            <div className="text-xs font-bold text-amber-500">Confirmar a alteração no Google</div>
            <div className={`text-sm mt-1 ${textHead}`}>{confirm.control.label}: de {money(before)} para {money(confirm.value)}{pctChange !== null ? ` (${pctChange > 0 ? '+' : '−'}${Math.abs(pctChange)}%)` : ''}.</div>
            {pctChange !== null && Math.abs(pctChange) > 30 && <div className="text-xs text-amber-500 mt-1">É uma mudança de mais de 30% de uma vez.</div>}
            {confirm.control.kind === 'meta_cpa' && <div className={`text-xs mt-1 ${textMuted}`}>Depois de mudar a meta, a campanha costuma voltar ao aprendizado por alguns dias.</div>}
            {confirm.control.note && confirm.control.kind === 'orcamento' && <div className="text-xs text-amber-500 mt-1">{confirm.control.note}</div>}
            <div className="flex gap-2 mt-2.5">
              <button disabled={!!busy} onClick={() => send('confirm', { kind: confirm.control.kind, key: confirm.control.key, value: confirm.value })} className={solid}>
                {busy === 'confirm' && <Loader2 size={12} className="animate-spin" />} Alterar no Google
              </button>
              <button disabled={!!busy} onClick={() => setConfirm(null)} className={ghost}>Cancelar</button>
            </div>
          </div>
        );
      })()}
      {message && <div className="text-xs text-rose-500 mt-3">{message}</div>}

      {history.length > 0 && (
        <div className={`mt-4 pt-3 border-t ${borderCol}`}>
          <button onClick={toggleClosed} aria-expanded={!closed} className={`w-full flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider font-extrabold ${textMuted} hover:text-indigo-400 ${closed ? '' : 'mb-1'}`}>
            <span>Alterações feitas por aqui ({history.length})</span>
            <span className="normal-case tracking-normal font-bold">{closed ? 'Mostrar' : 'Ocultar'}</span>
          </button>
          {!closed && shown.map(h => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5 text-xs">
              <span className={h.ok ? textHead : textMuted}>
                <span className={`tabular-nums ${textMuted}`}>{when(h.created_at)}</span> · {describe(h)}{!h.ok ? ` · não aplicada: ${h.error || 'o Google recusou'}` : ''}
              </span>
              {h.ok && !h.undone_at && !h.undo_of && (h.previous_value !== null || h.kind === 'meta_cpa_grupo' || DONE[h.kind])
                ? <button disabled={!!busy} onClick={() => send(h.id, { undo: h.id })} className={ghost}>{busy === h.id ? 'Desfazendo…' : 'Desfazer'}</button>
                : h.undone_at ? <span className={textMuted}>desfeita</span> : null}
            </div>
          ))}
          {!closed && history.length > 3 && <button onClick={() => setShowAll(v => !v)} className={`text-xs font-bold mt-1 ${textMuted} hover:text-indigo-400`}>{showAll ? 'Mostrar menos' : `Ver as ${history.length}`}</button>}
        </div>
      )}
    </div>
  );
}
