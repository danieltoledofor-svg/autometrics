"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, UploadCloud } from 'lucide-react';
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
  enviada: { label: 'Enviada', cls: 'bg-pos/10 text-pos' },
  aguardando: { label: 'Aguardando o Google', cls: 'bg-warn/10 text-warn' },
  falhou: { label: 'Recusada', cls: 'bg-neg/10 text-neg' },
  ignorada: { label: 'Não enviada', cls: 'bg-surface-3 text-ink-subtle' },
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

  // Leva ao Google para autorizar o envio de vendas (permissão nova), com o mesmo e-mail da conta.
  const authorize = async () => {
    setBusy(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/google-ads/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ conversions: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) window.location.href = body.url;
    else { setError(body.error || 'Não foi possível abrir a autorização do Google.'); setBusy(false); }
  };

  const card = 'bg-surface-1 border-line';
  const head = 'text-ink';
  const muted = 'text-ink-subtle';
  const line = 'border-line';

  if (!state) return null;
  const on = !!state.enabled;
  const t = state.totals || {};

  return (
    <div className={`rounded-xl p-6 border ${card}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={`text-sm font-semibold flex items-center gap-2 ${head}`}>
            <UploadCloud size={18} aria-hidden="true" className="text-brand-text" /> Enviar as vendas ao Google
          </h3>
          <p className={`text-xs mt-2 ${muted}`}>
            Cada venda ligada a um clique é enviada à conta do Google onde o clique aconteceu, com o valor da comissão.
            Ela entra numa ação de conversão própria, chamada <strong>{state.action_name}</strong>, criada sozinha em cada conta.
          </p>
        </div>
        {state.ready !== false && (
          <button type="button" role="switch" aria-checked={on} aria-label="Enviar as vendas ao Google" onClick={toggle} disabled={busy}
            className={`relative w-10 h-[22px] rounded-full shrink-0 transition-colors disabled:opacity-60 ${on ? 'bg-brand' : 'bg-surface-3'}`}>
            <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
          </button>
        )}
      </div>

      {state.ready === false && <p className="text-xs mt-3 text-warn">Falta rodar a migração do envio ao Google no Supabase.</p>}
      {error && <p className="text-xs mt-3 text-neg">{error}</p>}
      {busy && <p className={`text-xs mt-3 flex items-center gap-1.5 ${muted}`}><Loader2 size={12} aria-hidden="true" className="animate-spin" /> Salvando…</p>}

      {state.ready !== false && on && (
        <div className={`mt-4 p-3 rounded-lg border ${state.needs_auth ? 'border-warn/40 bg-warn/5' : line}`}>
          <p className={`text-xs ${state.needs_auth ? 'text-warn' : muted}`}>
            {state.needs_auth ? 'Há vendas esperando: o Google pede uma autorização própria para receber vendas.' : 'O Google pede uma autorização própria para receber vendas.'}{' '}
            Autorize com cada e-mail do Google que tem contas vendendo. Nada mais muda na ligação que já existe.
          </p>
          <button onClick={authorize} disabled={busy} className="mt-2 bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">Autorizar o envio</button>
          {(state.emails || []).length > 0 && (
            <div className={`mt-3 pt-3 border-t ${line} space-y-1.5`}>
              {state.emails.map((e: any) => (
                <div key={e.email} className="flex flex-wrap items-center gap-x-2 text-xs">
                  {e.authorized
                    ? <span className="inline-flex items-center gap-1 text-pos font-medium"><Check size={13} aria-hidden="true" /> Autorizado</span>
                    : <span className="text-warn font-medium">Falta autorizar</span>}
                  <span className={head}>{e.email}</span>
                  {e.note && <span className={muted}>· {e.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {state.ready !== false && (
        <ul className={`space-y-1 text-xs mt-4 ${muted} list-disc list-inside`}>
          <li>A ação nasce só como <strong>observação</strong>: aparece em “Todas as conversões” e <strong>não muda os lances</strong>. Assim ela roda ao lado do que já envia vendas hoje, sem contar em dobro.</li>
          <li>Quando você quiser que ela valha para os lances, marque-a como principal no Google Ads e tire a antiga.</li>
          <li>Valem as vendas feitas depois de ligar{on && state.start_at ? ` (ligado em ${when(state.start_at)})` : ''}. O envio sai em até 5 minutos; numa conta nova o Google pode levar algumas horas para aceitar.</li>
          {state.accounts === 0 && <li className="text-warn">Nenhuma conta do Google ligada pela API: ligue na aba Google Ads.</li>}
        </ul>
      )}

      {state.ready !== false && (t.enviada || t.aguardando || t.falhou || t.ignorada) ? (
        <>
          <div className="flex flex-wrap gap-2 mt-4 text-xs">
            {Object.keys(STATUS).filter(k => t[k]).map(k => (
              <span key={k} className={`px-2 py-1 rounded-lg font-medium ${STATUS[k].cls}`}>{STATUS[k].label}: {t[k]}</span>
            ))}
            <span className={`px-2 py-1 ${muted}`}>últimos 30 dias</span>
          </div>
          <div className={`mt-3 border-t ${line}`}>
            {state.last.map((u: any, i: number) => (
              <div key={i} className={`py-2 text-xs border-b ${line}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`min-w-0 truncate ${head}`}>
                    <span className="font-medium tabular-nums">{u.currency === 'BRL' ? 'R$' : 'US$'} {Number(u.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    <span className={muted}> · </span>{u.campaign}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`tabular-nums ${muted}`}>{when(u.conversion_at)}</span>
                    <span className={`px-1.5 py-0.5 rounded font-medium ${STATUS[u.status]?.cls || ''}`}>{STATUS[u.status]?.label || u.status}</span>
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
