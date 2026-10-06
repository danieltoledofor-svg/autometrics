"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Envio das vendas ao Google pelo clique (aba Conversão Automática).
 *
 * Um liga/desliga e o que já foi enviado. Ligado, cada venda que o postback
 * ligou a um clique vira uma conversão na conta do Google onde o clique
 * aconteceu, numa ação própria que nasce só como observação.
 *
 * Rota: /api/google-ads/conversions.
 */

async function api(body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/google-ads/conversions', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '');
const STATUS: Record<string, { label: string; cls: string }> = {
  enviada: { label: 'Enviada', cls: 'bg-emerald-500/15 text-emerald-500' },
  aguardando: { label: 'Aguardando o Google', cls: 'bg-amber-500/15 text-amber-500' },
  falhou: { label: 'Recusada', cls: 'bg-rose-500/15 text-rose-500' },
  ignorada: { label: 'Não enviada', cls: 'bg-slate-500/15 text-slate-400' },
};

export function ConversionUploadCard({ isDark }: { isDark: boolean }) {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => { setState((await api()).body); }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    setBusy(true);
    setError('');
    const { ok, body } = await api({ enabled: !state.enabled });
    if (ok) setState(body); else setError(body.error || 'Não foi possível salvar.');
    setBusy(false);
  };

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const head = isDark ? 'text-white' : 'text-slate-900';
  const muted = 'text-slate-500';
  const line = isDark ? 'border-slate-800' : 'border-slate-200';

  if (!state) return null;
  const on = !!state.enabled;
  const t = state.totals || {};

  return (
    <div className={`rounded-xl p-6 border ${card}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${head}`}>
            <UploadCloud size={18} className="text-indigo-400" /> Enviar as vendas ao Google
          </h3>
          <p className={`text-xs mt-2 ${muted}`}>
            Cada venda ligada a um clique é enviada à conta do Google onde o clique aconteceu, com o valor da comissão.
            Ela entra numa ação de conversão própria, chamada <strong>{state.action_name}</strong>, criada sozinha em cada conta.
          </p>
        </div>
        {state.ready !== false && (
          <button type="button" role="switch" aria-checked={on} aria-label="Enviar as vendas ao Google" onClick={toggle} disabled={busy}
            className={`relative w-10 h-[22px] rounded-full shrink-0 transition-colors disabled:opacity-60 ${on ? 'bg-indigo-600' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`}>
            <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
          </button>
        )}
      </div>

      {state.ready === false && <p className="text-xs mt-3 text-amber-500">Falta rodar a migração do envio ao Google no Supabase.</p>}
      {error && <p className="text-xs mt-3 text-rose-500">{error}</p>}
      {busy && <p className={`text-xs mt-3 flex items-center gap-1.5 ${muted}`}><Loader2 size={12} className="animate-spin" /> Salvando…</p>}

      {state.ready !== false && (
        <ul className={`space-y-1 text-xs mt-4 ${muted} list-disc list-inside`}>
          <li>A ação nasce só como <strong>observação</strong>: aparece em “Todas as conversões” e <strong>não muda os lances</strong>. Assim ela roda ao lado do que já envia vendas hoje, sem contar em dobro.</li>
          <li>Quando você quiser que ela valha para os lances, marque-a como principal no Google Ads e tire a antiga.</li>
          <li>Valem as vendas feitas depois de ligar{on && state.start_at ? ` (ligado em ${when(state.start_at)})` : ''}. O envio sai em até 5 minutos; numa conta nova o Google pode levar algumas horas para aceitar.</li>
          {state.accounts === 0 && <li className="text-amber-500">Nenhuma conta do Google ligada pela API: ligue na aba Google Ads.</li>}
        </ul>
      )}

      {state.ready !== false && (t.enviada || t.aguardando || t.falhou || t.ignorada) ? (
        <>
          <div className="flex flex-wrap gap-2 mt-4 text-xs">
            {Object.keys(STATUS).filter(k => t[k]).map(k => (
              <span key={k} className={`px-2 py-1 rounded-lg font-bold ${STATUS[k].cls}`}>{STATUS[k].label}: {t[k]}</span>
            ))}
            <span className={`px-2 py-1 ${muted}`}>últimos 30 dias</span>
          </div>
          <div className={`mt-3 border-t ${line}`}>
            {state.last.map((u: any, i: number) => (
              <div key={i} className={`py-2 text-xs border-b ${line}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`min-w-0 truncate ${head}`}>
                    <span className="font-bold tabular-nums">{u.currency === 'BRL' ? 'R$' : 'US$'} {Number(u.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    <span className={muted}> · </span>{u.campaign}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`tabular-nums ${muted}`}>{when(u.conversion_at)}</span>
                    <span className={`px-1.5 py-0.5 rounded font-bold ${STATUS[u.status]?.cls || ''}`}>{STATUS[u.status]?.label || u.status}</span>
                  </span>
                </div>
                {u.reason && <div className={`mt-0.5 ${muted}`}>{u.reason}{u.status === 'aguardando' && u.next_try_at ? ` Nova tentativa às ${when(u.next_try_at).slice(-5)}.` : ''}</div>}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
