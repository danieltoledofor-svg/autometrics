"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, CreditCard, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Área dos cartões (LootRush) em Metas: no período da tela, o que foi cobrado
 * nos cartões ao lado do gasto que o Google informou, conta por conta. A conta
 * vem do nome da cobrança. Só aparece para quem ligou a LootRush em Integração.
 *
 * Rota: /api/lootrush?from=…&to=…
 */

async function api(path: string, body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/lootrush${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

const usd = (v: number) => `${v < 0 ? '−' : ''}US$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dashed = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const ago = (iso: string | null) => {
  if (!iso) return 'ainda não lido';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 1 ? 'lido agora' : min < 60 ? `lido há ${min} min` : `lido há ${Math.round(min / 60)} h`;
};
const STATE: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' | 'plain' }> = {
  bate: { text: 'bate', tone: 'good' }, cobrado_a_mais: { text: 'cobrado a mais', tone: 'warn' }, falta_cobrar: { text: 'falta cobrar', tone: 'plain' },
  outra_moeda: { text: 'outra moeda', tone: 'plain' }, conta_estranha: { text: 'conta estranha', tone: 'bad' },
};
const STATUS: Record<string, string> = { on_hold: 'em espera', settled: 'fechada', declined: 'recusada', reversed: 'desfeita' };

export function LootrushPanel({ from, to, isDark }: { from: string; to: string; isDark: boolean }) {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    if (!from || !to) return;
    const { body } = await api(`?from=${from}&to=${to}`);
    setData(body);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  // Sem a LootRush ligada (ou sem grupo escolhido), a área não ocupa espaço em Metas.
  if (!data?.connected || !data.groups?.length) return null;

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const head = isDark ? 'text-white' : 'text-slate-900', muted = 'text-slate-500', line = isDark ? 'border-slate-800' : 'border-slate-200';
  const soft = isDark ? 'bg-slate-950/60' : 'bg-slate-50';
  const tone = {
    good: isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700',
    warn: isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700',
    bad: isDark ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-700',
    plain: isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600',
  };
  const check = data.check;
  const accounts: any[] = check?.accounts || [];
  const compared = accounts.filter(a => a.diff !== null);
  const chargedCompared = compared.reduce((s, a) => s + a.charged, 0), googleCompared = compared.reduce((s, a) => s + (a.google_cost || 0), 0);
  const strange = accounts.filter(a => a.state === 'conta_estranha').length, declined = (check?.charges || []).filter((c: any) => c.status === 'declined').length;
  const outside = (check?.others || []).length, toReview = strange + declined + outside;
  const reviewText = [declined && `${declined} recusada${declined > 1 ? 's' : ''}`, strange && `${strange} conta${strange > 1 ? 's' : ''} estranha${strange > 1 ? 's' : ''}`, outside && `${outside} fora do Google`].filter(Boolean).join(' · ');

  const readNow = async () => { setReading(true); await api('', { action: 'ler' }); await load(); setReading(false); };

  return (
    <div className={`${card} border rounded-xl p-5 mb-8`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className={`text-base font-bold inline-flex items-center gap-2 ${head}`}><CreditCard size={17} /> Cartões · LootRush</span>
          <span className={`text-xs ml-2 ${muted}`}>{data.groups.length === 1 ? 'grupo' : 'grupos'} {data.groups.map((g: any) => g.name).join(', ')} · mesmo período da tela</span>
        </div>
        <span className={`text-xs ${muted}`}>
          {ago(data.last_sync_at)} · <button onClick={readNow} disabled={reading} className="text-indigo-400 hover:underline disabled:opacity-50">{reading ? 'lendo…' : 'ler agora'}</button>
        </span>
      </div>
      {data.status === 'erro' && data.last_error && <div className="text-xs text-rose-500 mt-2">{data.last_error}</div>}

      {!check ? <div className={`text-xs mt-3 ${muted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> carregando…</div> : !check.charges.length ? (
        <div className={`text-[13px] mt-3 ${muted}`}>Nenhuma cobrança nestes cartões no período.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            <div className={`${soft} rounded-lg p-3`}>
              <div className={`text-xs ${muted}`}>Cobrado nos cartões</div>
              <div className={`text-xl font-bold ${head}`}>{usd(check.total.charged)}</div>
              <div className={`text-[11px] ${muted}`}>{check.charges.length + check.more} cobranças{check.total.pending ? ` · ${usd(check.total.pending)} em espera` : ''}</div>
            </div>
            <div className={`${soft} rounded-lg p-3`}>
              <div className={`text-xs ${muted}`}>Gasto no Google</div>
              <div className={`text-xl font-bold ${head}`}>{compared.length ? usd(googleCompared) : 'sem dado'}</div>
              <div className={`text-[11px] ${muted}`}>{compared.length} {compared.length === 1 ? 'conta' : 'contas'} em dólar</div>
            </div>
            <div className={`${soft} rounded-lg p-3`}>
              <div className={`text-xs ${muted}`}>{googleCompared - chargedCompared >= 0 ? 'Ainda não cobrado' : 'Cobrado além do gasto'}</div>
              <div className={`text-xl font-bold ${head}`}>{compared.length ? usd(Math.abs(googleCompared - chargedCompared)) : 'sem dado'}</div>
              <div className={`text-[11px] ${muted}`}>gasto menos cobrado, nas mesmas contas</div>
            </div>
            <div className={`rounded-lg p-3 ${toReview ? tone.bad : soft}`}>
              <div className={`text-xs ${toReview ? '' : muted}`}>Para conferir</div>
              <div className={`text-xl font-bold ${toReview ? '' : head}`}>{toReview}</div>
              <div className={`text-[11px] ${toReview ? '' : muted}`}>{reviewText || 'nada fora do esperado'}</div>
            </div>
          </div>

          {check.codes.slice(0, 3).map((c: any) => (
            <div key={c.id} className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${tone.warn}`}>
              <KeyRound size={14} className="inline mr-1.5 -mt-0.5" />Código de verificação do Google: <b>{c.code}</b> · cartão final {c.card_last4 || '????'} · {when(c.charged_at)}
            </div>
          ))}

          <div className="overflow-x-auto mt-4">
            <table className="w-full text-[13px]">
              <thead><tr className={`text-left text-[11px] uppercase tracking-wide ${muted}`}>
                <th className="py-1.5 pr-3 font-semibold">Conta do Google</th><th className="py-1.5 px-3 font-semibold text-right">Cobrado</th>
                <th className="py-1.5 px-3 font-semibold text-right">Gasto no Google</th><th className="py-1.5 px-3 font-semibold text-right">Diferença</th><th className="py-1.5 pl-3 font-semibold">Situação</th>
              </tr></thead>
              <tbody>
                {accounts.map(a => {
                  const s = STATE[a.state] || STATE.bate;
                  return (
                    <tr key={a.customer_id} className={`border-t ${line}`}>
                      <td className="py-2 pr-3">
                        <div className={head}>{a.name || `Conta ${dashed(a.customer_id)}`}</div>
                        <div className={`text-[11px] ${a.known ? muted : 'text-rose-500'}`}>
                          {a.known ? `${dashed(a.customer_id)}${a.mcc ? ` · ${a.mcc}` : ''}` : 'não está nas suas contas do Autometrics'} · {a.cards.length === 1 ? 'final' : 'finais'} {a.cards.join(', ')}
                          {a.declined ? ` · ${a.declined} recusada${a.declined > 1 ? 's' : ''}` : ''}
                        </div>
                      </td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap ${head}`}>{usd(a.charged)}<div className={`text-[11px] ${muted}`}>{a.charges} {a.charges === 1 ? 'cobrança' : 'cobranças'}</div></td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap ${a.google_cost === null ? muted : head}`}>
                        {a.google_cost === null ? 'sem dado' : a.state === 'outra_moeda' ? `${a.currency || ''} ${a.google_cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : usd(a.google_cost)}
                      </td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap ${muted}`}>{a.diff === null ? '—' : `${a.diff > 0 ? '+' : ''}${a.diff.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                      <td className="py-2 pl-3"><span className={`px-2 py-0.5 rounded-md text-[11px] font-bold whitespace-nowrap ${tone[s.tone]}`}>{s.text}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`text-[11px] mt-2 ${muted}`}>
            O Google cobra o cartão em parcelas, conforme o gasto acumula: &quot;bate&quot; é diferença de até 10% do gasto (ou US$ 50). &quot;Falta cobrar&quot; é gasto que ainda vai virar cobrança. Conta em outra moeda aparece sem diferença.
          </div>

          {check.others.length > 0 && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${tone.bad}`}>
              <b>Cobranças que não são do Google nestes cartões:</b>
              {check.others.slice(0, 8).map((c: any) => <div key={c.id} className="text-xs mt-0.5">{when(c.charged_at)} · {c.merchant} · {usd(c.amount)} · final {c.card_last4 || '????'} · {STATUS[c.status] || c.status}</div>)}
            </div>
          )}

          <button onClick={() => setOpen(o => !o)} className={`mt-3 text-xs inline-flex items-center gap-1 ${muted} hover:text-indigo-400`}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {open ? 'Esconder' : 'Ver'} as cobranças uma a uma
          </button>
          {open && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead><tr className={`text-left text-[11px] uppercase tracking-wide ${muted}`}>
                  <th className="py-1.5 pr-3 font-semibold">Quando</th><th className="py-1.5 px-3 font-semibold">Cobrança</th><th className="py-1.5 px-3 font-semibold">Cartão</th>
                  <th className="py-1.5 px-3 font-semibold text-right">Valor</th><th className="py-1.5 pl-3 font-semibold">Situação</th>
                </tr></thead>
                <tbody>
                  {check.charges.map((c: any) => (
                    <tr key={c.id} className={`border-t ${line}`}>
                      <td className={`py-1.5 pr-3 whitespace-nowrap ${muted}`}>{when(c.charged_at)}</td>
                      <td className={`py-1.5 px-3 ${head}`}>{c.merchant}{c.code ? ` · código ${c.code}` : ''}</td>
                      <td className={`py-1.5 px-3 whitespace-nowrap ${muted}`}>final {c.card_last4 || '????'}{c.card_name ? ` · ${c.card_name}` : ''}</td>
                      <td className={`py-1.5 px-3 text-right whitespace-nowrap ${head}`}>{usd(c.polarity === 'credit' ? -Math.abs(c.amount) : c.amount)}</td>
                      <td className={`py-1.5 pl-3 whitespace-nowrap ${c.status === 'declined' ? 'text-rose-500' : muted}`}>{STATUS[c.status] || c.status}{c.reason ? ` · ${c.reason}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {check.more > 0 && <div className={`text-[11px] mt-2 ${muted}`}>Mais {check.more} cobranças no período; diminua o período para ver todas.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
