"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, CreditCard, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Aba Cartões (LootRush) de Metas: mês a mês, o gasto que o Google informou em
 * cada conta ao lado do que foi cobrado nos cartões por esse gasto. A conta vem
 * do número que o Google escreve no nome da cobrança.
 *
 * O mês começa no dia 1º, mas as cobranças do dia 1º pagam o que sobrou do mês
 * anterior: aparecem no quadro "Fechamento", não nas cobranças do mês.
 *
 * Rota: /api/lootrush?mes=AAAA-MM
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
  bate: { text: 'bate', tone: 'good' }, a_cobrar: { text: 'a cobrar', tone: 'plain' }, credito: { text: 'crédito na conta', tone: 'plain' }, credito_parado: { text: 'crédito a devolver', tone: 'warn' },
  falta_cobrar: { text: 'faltou cobrar', tone: 'warn' }, outra_moeda: { text: 'outra moeda', tone: 'plain' }, fora: { text: 'fora do Autometrics', tone: 'bad' },
};
const ACCOUNT_STATUS: Record<string, string> = { SUSPENDED: 'suspensa', CANCELED: 'cancelada', CANCELLED: 'cancelada', CLOSED: 'encerrada' };
const STATUS: Record<string, string> = { on_hold: 'em espera', settled: 'fechada', declined: 'recusada', reversed: 'desfeita' };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const ddmm = (day: string) => day.slice(5).split('-').reverse().join('/');
/** O mês de hoje em Brasília e os cinco anteriores. */
function lastMonths() {
  const now = new Date(Date.now() - 3 * 3600000), out: string[] = [];
  for (let i = 0; i < 6; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}

export function LootrushPanel({ isDark }: { isDark: boolean }) {
  const months = lastMonths();
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    const { body } = await api(`?mes=${month}`);
    setData(body);
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const head = isDark ? 'text-white' : 'text-slate-900', muted = 'text-slate-500', line = isDark ? 'border-slate-800' : 'border-slate-200';
  const soft = isDark ? 'bg-slate-950/60' : 'bg-slate-50';
  const tone = {
    good: isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700',
    warn: isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700',
    bad: isDark ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-700',
    plain: isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600',
  };
  const select = `rounded-lg border px-3 py-1.5 text-[13px] ${isDark ? 'bg-slate-950 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'}`;
  const readNow = async () => { setReading(true); await api('', { action: 'ler' }); await load(); setReading(false); };

  const check = data?.check;
  const accounts: any[] = check?.accounts || [];
  const issues = accounts.filter(a => a.state === 'credito_parado' || a.state === 'falta_cobrar' || a.state === 'fora');
  const shown = onlyIssues ? issues : accounts;
  const t = check?.total;
  const outside = (check?.others || []).length, toReview = issues.length + (t?.declined || 0) + outside;
  const stoppedCount = accounts.filter(a => a.state === 'credito_parado').length;
  const reviewText = t ? [stoppedCount && `${usd(t.credit_stopped)} de crédito em ${stoppedCount} conta${stoppedCount > 1 ? 's' : ''} parada${stoppedCount > 1 ? 's' : ''}`, (issues.length - stoppedCount) > 0 && `${issues.length - stoppedCount} conta${issues.length - stoppedCount > 1 ? 's' : ''} para ver`, t.declined && `${t.declined} recusada${t.declined > 1 ? 's' : ''}`, outside && `${outside} fora do Google`].filter(Boolean).join(' · ') : '';
  const c = check?.closing;

  return (
    <div className="space-y-4 mb-8">
      <div className={`${card} border rounded-xl p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={`text-lg font-bold inline-flex items-center gap-2 ${head}`}><CreditCard size={18} /> Cartões · LootRush</div>
            <div className={`text-xs ${muted}`}>{data?.groups?.length ? `${data.groups.length === 1 ? 'Grupo' : 'Grupos'} ${data.groups.map((g: any) => g.name).join(', ')}` : ''}{data ? ` · ${ago(data.last_sync_at)} · ` : ''}
              {data && <button onClick={readNow} disabled={reading} className="text-indigo-400 hover:underline disabled:opacity-50">{reading ? 'lendo…' : 'ler agora'}</button>}
            </div>
          </div>
          <select value={month} onChange={e => setMonth(e.target.value)} aria-label="Mês da conferência" className={select}>
            {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>
        {data?.status === 'erro' && data.last_error && <div className="text-xs text-rose-500 mt-2">{data.last_error}</div>}
        {data?.error && <div className="text-xs text-rose-500 mt-2">{data.error}</div>}

        {!check ? <div className={`text-xs mt-4 ${muted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> carregando…</div> : (
          <>
            <div className={`text-xs mt-3 ${muted}`}>
              Gasto no Google de {ddmm(check.first)} a {ddmm(check.last)}, ao lado das cobranças que pagam esse gasto: do dia 2 até o dia 1º do mês seguinte. As cobranças do dia 1º ficam no fechamento do mês anterior.
              {check.oldest_day && check.oldest_day > check.first && <span className="text-amber-500"> As cobranças guardadas começam em {ddmm(check.oldest_day)}: antes disso este mês está incompleto.</span>}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              <div className={`${soft} rounded-lg p-3`}>
                <div className={`text-xs ${muted}`}>Gasto no Google no mês</div>
                <div className={`text-xl font-bold ${head}`}>{usd(t.google)}</div>
                <div className={`text-[11px] ${muted}`}>{accounts.filter(a => a.diff !== null).length} contas em dólar destes cartões</div>
              </div>
              <div className={`${soft} rounded-lg p-3`}>
                <div className={`text-xs ${muted}`}>Cobrado nos cartões</div>
                <div className={`text-xl font-bold ${head}`}>{usd(t.compared_charged)}</div>
                <div className={`text-[11px] ${muted}`}>{t.pending ? `${usd(t.pending)} ainda em espera` : 'pelo gasto deste mês'}</div>
              </div>
              <div className={`${soft} rounded-lg p-3`}>
                <div className={`text-xs ${muted}`}>Crédito nas contas</div>
                <div className={`text-xl font-bold ${head}`}>{usd(t.credit)}</div>
                <div className={`text-[11px] ${muted}`}>pago e ainda não gasto{t.to_charge > 0 ? ` · ${usd(t.to_charge)} ${check.closed ? 'gasto sem cobrança' : 'gasto a cobrar'}` : ''}</div>
              </div>
              <div className={`rounded-lg p-3 ${toReview ? tone.bad : soft}`}>
                <div className={`text-xs ${toReview ? '' : muted}`}>Para conferir</div>
                <div className={`text-xl font-bold ${toReview ? '' : head}`}>{toReview}</div>
                <div className={`text-[11px] ${toReview ? '' : muted}`}>{reviewText || 'nada fora do esperado'}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {check && c && c.done && (
        <div className={`${card} border rounded-xl p-5`}>
          <div className={`text-sm font-bold ${head}`}>Fechamento de {monthName(c.month)} (cobrado no dia 1º)</div>
          {!c.complete ? (
            <div className={`text-[13px] mt-2 ${muted}`}>No dia 1º foram cobrados <b className={head}>{usd(c.charged_day1)}</b>. Não dá para conferir com o que sobrou de {monthName(c.month)}: as cobranças guardadas começam em {check.oldest_day ? ddmm(check.oldest_day) : '—'}, depois do começo daquele mês.</div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3 text-[13px]">
              <div><div className={`text-xs ${muted}`}>Gasto em {MONTHS[Number(c.month.slice(5)) - 1]}</div><div className={`font-bold ${head}`}>{usd(c.spent)}</div></div>
              <div><div className={`text-xs ${muted}`}>Cobrado durante o mês</div><div className={`font-bold ${head}`}>{usd(c.charged_before)}</div></div>
              <div><div className={`text-xs ${muted}`}>Sobrou para o dia 1º</div><div className={`font-bold ${head}`}>{usd(c.left)}</div></div>
              <div><div className={`text-xs ${muted}`}>Cobrado no dia 1º</div><div className={`font-bold ${head}`}>{usd(c.charged_day1)}</div>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${Math.abs(c.charged_day1 - c.left) <= Math.max(50, c.spent * 0.02) ? tone.good : tone.warn}`}>
                  {Math.abs(c.charged_day1 - c.left) <= Math.max(50, c.spent * 0.02) ? 'bate' : `diferença de ${usd(c.charged_day1 - c.left)}`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {check && check.codes.length > 0 && (
        <div className={`rounded-xl px-4 py-3 text-[13px] space-y-1 ${tone.warn}`}>
          <div className="font-bold"><KeyRound size={14} className="inline mr-1.5 -mt-0.5" />Códigos de verificação do Google neste mês</div>
          {check.codes.slice(0, 12).map((x: any) => <div key={x.id}><b>{x.code}</b> · cartão final {x.card_last4 || '????'}{x.card_name ? ` (${x.card_name})` : ''} · {when(x.charged_at)}</div>)}
        </div>
      )}

      {check && (
        <div className={`${card} border rounded-xl p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`text-sm font-bold ${head}`}>Conta por conta</div>
            {issues.length > 0 && <label className={`text-xs inline-flex items-center gap-1.5 cursor-pointer ${muted}`}><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} /> só as {issues.length} para conferir</label>}
          </div>
          {!accounts.length ? <div className={`text-[13px] mt-3 ${muted}`}>Nenhum gasto e nenhuma cobrança nestes cartões neste mês.</div> : (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-[13px]">
                <thead><tr className={`text-left text-[11px] uppercase tracking-wide ${muted}`}>
                  <th className="py-1.5 pr-3 font-semibold">Conta do Google</th><th className="py-1.5 px-3 font-semibold text-right">Gasto no Google</th>
                  <th className="py-1.5 px-3 font-semibold text-right">Cobrado</th><th className="py-1.5 px-3 font-semibold text-right">Cobrado − gasto</th><th className="py-1.5 pl-3 font-semibold">Situação</th>
                </tr></thead>
                <tbody>
                  {shown.map(a => {
                    const s = STATE[a.state] || STATE.bate;
                    return (
                      <tr key={a.customer_id} className={`border-t ${line}`}>
                        <td className="py-2 pr-3">
                          <div className={head}>{a.name || `Conta ${dashed(a.customer_id)}`}</div>
                          <div className={`text-[11px] ${a.known ? muted : 'text-rose-500'}`}>
                            {a.known ? `${dashed(a.customer_id)}${a.mcc ? ` · ${a.mcc}` : ''}${a.state === 'credito_parado' ? ` · conta ${ACCOUNT_STATUS[String(a.status).toUpperCase()] || 'parada'}` : ''}` : 'ainda não está nas suas contas do Autometrics'}
                            {a.cards.length ? ` · ${a.cards.length === 1 ? 'final' : 'finais'} ${a.cards.join(', ')}` : ''}{a.declined ? ` · ${a.declined} recusada${a.declined > 1 ? 's' : ''}` : ''}
                          </div>
                        </td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap ${a.google_cost === null ? muted : head}`}>
                          {a.google_cost === null ? 'sem dado' : a.state === 'outra_moeda' ? `${a.currency || ''} ${a.google_cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : usd(a.google_cost)}
                        </td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap ${head}`}>{usd(a.charged)}<div className={`text-[11px] ${muted}`}>{a.charges} {a.charges === 1 ? 'cobrança' : 'cobranças'}</div></td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap ${muted}`}>{a.diff === null ? '—' : `${a.diff > 0 ? '+' : a.diff < 0 ? '−' : ''}${Math.abs(a.diff).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                        <td className="py-2 pl-3"><span className={`px-2 py-0.5 rounded-md text-[11px] font-bold whitespace-nowrap ${tone[s.tone]}`}>{s.text}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className={`text-[11px] mt-3 space-y-1 ${muted}`}>
            <div>&quot;Crédito na conta&quot;: ao cadastrar o cartão o Google cobra um valor (US$ 10, 20, 40…) que fica como crédito e é gasto quando a conta roda. &quot;Crédito a devolver&quot;: a conta foi suspensa ou cancelada com crédito sobrando; o Google devolve esse valor para o cartão{t.returned > 0 ? ` (neste mês já voltaram ${usd(t.returned)})` : ''}.</div>
            <div>&quot;Bate&quot; é diferença de até 10% do gasto (ou US$ 50). &quot;A cobrar&quot; é gasto do mês em andamento acima do que já foi pago. &quot;Faltou cobrar&quot; só aparece em mês fechado. Conta em outra moeda aparece sem diferença.</div>
            {t.added_elsewhere > 0 && <div>O cartão foi cadastrado em {t.added_elsewhere} {t.added_elsewhere === 1 ? 'conta que ainda não está' : 'contas que ainda não estão'} no Autometrics (cobrança de US$ 0, só para o Google conferir o cartão).</div>}
            {t.elsewhere_accounts > 0 && <div>{t.elsewhere_accounts} {t.elsewhere_accounts === 1 ? 'conta sua gastou' : 'contas suas gastaram'} {usd(t.elsewhere_cost)} neste mês e nunca {t.elsewhere_accounts === 1 ? 'foi cobrada' : 'foram cobradas'} nestes cartões: {t.elsewhere_accounts === 1 ? 'deve estar' : 'devem estar'} em outro cartão.</div>}
          </div>

          {check.others.length > 0 && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${tone.bad}`}>
              <b>Cobranças que não são do Google nestes cartões:</b>
              {check.others.slice(0, 10).map((x: any) => <div key={x.id} className="text-xs mt-0.5">{when(x.charged_at)} · {x.merchant} · {usd(x.amount)} · final {x.card_last4 || '????'} · {STATUS[x.status] || x.status}</div>)}
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
                  {check.charges.map((x: any) => (
                    <tr key={x.id} className={`border-t ${line}`}>
                      <td className={`py-1.5 pr-3 whitespace-nowrap ${muted}`}>{when(x.charged_at)}</td>
                      <td className={`py-1.5 px-3 ${head}`}>{x.merchant}{x.code ? ` · código ${x.code}` : ''}</td>
                      <td className={`py-1.5 px-3 whitespace-nowrap ${muted}`}>final {x.card_last4 || '????'}{x.card_name ? ` · ${x.card_name}` : ''}</td>
                      <td className={`py-1.5 px-3 text-right whitespace-nowrap ${head}`}>{usd(x.polarity === 'credit' ? -Math.abs(x.amount) : x.amount)}</td>
                      <td className={`py-1.5 pl-3 whitespace-nowrap ${x.status === 'declined' ? 'text-rose-500' : muted}`}>{STATUS[x.status] || x.status}{x.reason ? ` · ${x.reason}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {check.more > 0 && <div className={`text-[11px] mt-2 ${muted}`}>Mais {check.more} cobranças neste mês que não cabem na lista.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
