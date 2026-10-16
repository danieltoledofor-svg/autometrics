"use client";

import React, { useState } from 'react';
import { Pause, Play, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/** Status em que não há o que pausar ou ativar pelo painel. */
const SEM_ACAO = new Set(['REMOVIDA', 'CONTA_SUSPENSA', 'CONTA_ENCERRADA']);

interface Props {
  product: any;
  isDark: boolean;
  /** Estilo do guia visual (DESIGN.md) nas telas já migradas. */
  tokens?: boolean;
  /** Recebe os campos atualizados do produto depois da mudança. */
  onChanged: (patch: Record<string, any>) => void;
  /**
   * Modo selo: o próprio selo de status ("Ativo", "Pausado") vira o botão.
   * Quando não há o que pausar ou ativar, o selo aparece sem ação.
   */
  badge?: { className: string; content: React.ReactNode; hint?: string };
}

/**
 * Pausa/ativa a campanha no Google Ads pela API.
 *
 * Decide pelo google_status (e não pelo "Ativo/Pausado/Suspenso" exibido):
 * campanha suspensa pelo Google continua ENABLED e pode ser pausada.
 */
export function CampaignStatusToggle({ product, isDark, onChanged, tokens = false, badge }: Props) {
  const [loading, setLoading] = useState(false);

  const campaignId = product.google_ads_campaign_id;
  const status = String(product.google_status || '').toUpperCase();
  if (!campaignId || campaignId === 'undefined' || SEM_ACAO.has(status)) {
    return badge ? <span className={badge.className} title={badge.hint}>{badge.content}</span> : null;
  }

  const isPaused = status === 'PAUSADA' || (!status && product.status === 'paused');
  const target = isPaused ? 'ENABLED' : 'PAUSED';

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const verbo = isPaused ? 'ATIVAR' : 'PAUSAR';
    if (!confirm(`${verbo} a campanha "${product.name}" no Google Ads?\n\nA mudança vale na hora, direto na conta.`)) return;

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/google-ads/campaign-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ product_id: product.id, status: target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        alert(`Não foi possível ${verbo.toLowerCase()}: ${body.error || `o Google manteve o status ${body.status || 'anterior'}`}`);
        return;
      }
      onChanged({
        google_status: body.effective_status,
        google_status_reasons: body.reasons,
        latest_campaign_status: body.status,
        status: body.status === 'ENABLED' ? 'active' : 'paused',
      });
    } catch (err: any) {
      alert('Falha de conexão: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (badge) {
    const acao = isPaused ? 'Clique para ativar' : 'Clique para pausar';
    return (
      <button type="button" onClick={handleClick} disabled={loading}
        className={`${badge.className} cursor-pointer transition-[filter,opacity] hover:ring-1 hover:ring-current disabled:opacity-60`}
        title={`${badge.hint ? `${badge.hint} — ` : ''}${acao} no Google Ads`}
        aria-label={`${isPaused ? 'Ativar' : 'Pausar'} ${product.name} no Google Ads`}>
        {loading ? <><Loader2 size={12} aria-hidden="true" className="animate-spin" /> {isPaused ? 'Ativando…' : 'Pausando…'}</> : badge.content}
        {!loading && (isPaused ? <Play size={10} aria-hidden="true" className="opacity-70" /> : <Pause size={10} aria-hidden="true" className="opacity-70" />)}
      </button>
    );
  }

  const tone = tokens
    ? `${isPaused ? 'text-pos' : 'text-warn'} hover:bg-surface-2`
    : isPaused
    ? (isDark ? 'bg-slate-800 text-emerald-400 hover:bg-emerald-500 hover:text-white' : 'bg-slate-100 text-emerald-600 hover:bg-emerald-100')
    : (isDark ? 'bg-slate-800 text-amber-400 hover:bg-amber-500 hover:text-white' : 'bg-slate-100 text-amber-600 hover:bg-amber-100');

  return (
    <button onClick={handleClick} disabled={loading} className={`p-1.5 rounded-lg transition-colors disabled:opacity-60 ${tone}`}
      title={isPaused ? 'Ativar no Google Ads' : 'Pausar no Google Ads'}
      aria-label={`${isPaused ? 'Ativar' : 'Pausar'} ${product.name} no Google Ads`}>
      {loading ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : isPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
    </button>
  );
}
