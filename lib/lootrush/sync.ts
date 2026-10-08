import { supabaseAdmin, decryptSecret, appUrl } from '@/lib/googleAds/server';
import { escapeHtml, sendTelegram, telegramEnabled } from '@/lib/telegram';
import { isQuiet, resolveSettings } from '@/lib/alerts/catalog';
import { fetchAll } from '@/lib/analysis/compute';
import { groupTransactions, plainLootrushError } from './client';

/**
 * LootRush: leitura das cobranças dos grupos de cartões de cada usuário, os
 * avisos no Telegram e a conferência com o gasto do Google.
 *
 * A LootRush não avisa nada sozinha: o agendador (a cada 5 minutos) relê os
 * últimos dias de cada grupo e grava o que mudou. O nome da cobrança traz a
 * conta do Google ("Google ADS1234567890"), e é por ela que a cobrança é
 * ligada à conta no Autometrics — por código, sem IA: é um número exato.
 *
 * A primeira leitura só guarda (70 dias, para cobrir o mês anterior inteiro); os avisos valem do que chegar depois.
 */

const TZ = 'America/Sao_Paulo';
const WINDOW_DAYS = 7, FIRST_DAYS = 70, MAX_MESSAGES = 10;
/** Primeiras leituras feitas antes desta data guardaram só 30 dias: são refeitas uma vez, para cobrir o mês anterior inteiro. */
const DEEP_SINCE = Date.parse('2026-10-08T18:25:00Z');
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Conta do Google no nome da cobrança: "Google ADS7973609921", "GOOGLE *ADS5586615519". */
export const accountOf = (merchant: string) => merchant.match(/ADS\s*(\d{10})\b/i)?.[1] || null;
/** Código de verificação do Google: cobrança do Google com seis números soltos no nome ("GOOGLE *YBY 719742"). */
export const codeOf = (merchant: string) => (/google/i.test(merchant) && !accountOf(merchant) ? merchant.match(/(?:^|\D)(\d{6})(?:\D|$)/)?.[1] || null : null);
export const isGoogle = (merchant: string) => /google/i.test(merchant);
const dashed = (id: string) => `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;
const usd = (v: number) => `US$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hhmm = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', '');
const hourNow = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24;

type Kind = 'lr_codigo' | 'lr_cobranca' | 'lr_recusada' | 'lr_credito';
const kindOf = (r: { code: string | null; status: string; polarity: string }): Kind =>
  r.code ? 'lr_codigo' : r.status === 'declined' ? 'lr_recusada' : r.polarity === 'credit' || r.status === 'reversed' ? 'lr_credito' : 'lr_cobranca';

function toRow(userId: string, t: any) {
  const merchant = String(t.merchantName || '').trim().replace(/\s+/g, ' ');
  return {
    user_id: userId, id: String(t.id), group_id: t.groupId || null, group_name: t.groupName || null,
    card_last4: t.cardLastFourDigits || null, card_name: t.cardNickname || t.cardName || null,
    merchant, customer_id: accountOf(merchant), code: codeOf(merchant),
    amount: num(t.amount), local_amount: t.localAmount === null || t.localAmount === undefined ? null : num(t.localAmount),
    local_currency: t.localCurrency ? String(t.localCurrency).toUpperCase() : null,
    status: String(t.status || ''), polarity: String(t.polarity || ''), reason: t.statusReason || t.rejectionCode ? String(t.statusReason || t.rejectionCode).slice(0, 200) : null,
    charged_at: t.authorizedAt || t.createdAt, posted_at: t.postedAt || null, updated_at: new Date().toISOString(),
  };
}
type Row = ReturnType<typeof toRow>;

/** A mensagem de cada aviso. `account` é a conta do Google no Autometrics, quando a cobrança bate com uma. */
function message(kind: Kind, r: Row, account: { name: string | null; mcc_name: string | null } | undefined) {
  const card = `Cartão final ${r.card_last4 || '????'}${r.card_name ? ` (${escapeHtml(r.card_name)})` : ''}${r.group_name ? ` · grupo ${escapeHtml(r.group_name)}` : ''}`;
  const where = r.customer_id
    ? account ? `Conta do Google: <b>${escapeHtml(account.name || dashed(r.customer_id))}</b> (${dashed(r.customer_id)}${account.mcc_name ? ` · ${escapeHtml(account.mcc_name)}` : ''})`
      : `⚠️ Conta do Google ${dashed(r.customer_id)}: <b>ainda não está entre as suas contas no Autometrics</b>. Confira se é sua.`
    : isGoogle(r.merchant) ? '' : '⚠️ Esta cobrança <b>não é do Google</b>.';
  const local = r.local_currency && r.local_currency !== 'USD' && r.local_amount ? ` (${r.local_currency} ${Math.abs(r.local_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})` : '';
  const lines = kind === 'lr_codigo' ? [`🔑 <b>Código de verificação do Google: ${r.code}</b>`, card, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`]
    : kind === 'lr_recusada' ? [`⛔ <b>Cobrança recusada: ${usd(r.amount)}</b>${local}`, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`, card, where, r.reason ? `Motivo: ${escapeHtml(r.reason)}` : '']
    : kind === 'lr_credito' ? [`↩️ <b>${r.status === 'reversed' ? 'Cobrança desfeita' : 'O Google devolveu'}: ${usd(r.amount)}</b>${local}`, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`, card, where]
    : r.amount === 0 ? [`🪪 <b>Cartão cadastrado numa conta do Google</b> (cobrança de US$ 0, só para conferir o cartão)`, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`, card, where]
    : [`💳 <b>Cobrança nova: ${usd(r.amount)}</b>${local}`, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`, card, where];
  return [...lines.filter(Boolean), `<a href="${appUrl()}/planning">Abrir a conferência</a>`].join('\n');
}

/** Lê os grupos de um usuário, grava o que mudou e manda os avisos. */
export async function syncLootrush(conn: any): Promise<{ read: number; fresh: number; sent: number; error?: string }> {
  const db = supabaseAdmin(), userId: string = conn.user_id;
  const groups: { id: string; name: string }[] = Array.isArray(conn.groups) ? conn.groups : [];
  const out = { read: 0, fresh: 0, sent: 0 } as { read: number; fresh: number; sent: number; error?: string };
  const first = !conn.baseline_at || new Date(conn.baseline_at).getTime() < DEEP_SINCE;
  const stamp = (patch: Record<string, any>) => db.from('lootrush_connections').update({ ...patch, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (!groups.length) { await stamp({}); return out; }

  const rows: Row[] = [];
  try {
    const key = decryptSecret(conn.key_enc), since = new Date(Date.now() - (first ? FIRST_DAYS : WINDOW_DAYS) * 86400000);
    for (const g of groups) rows.push(...(await groupTransactions(key, g.id, since, first ? 15 : 4)).rows.map(t => toRow(userId, t)));
  } catch (e: any) {
    out.error = plainLootrushError(e);
    await stamp({ status: 'erro', last_error: out.error });
    return out;
  }
  out.read = rows.length;

  // O que já estava guardado, para saber o que é novo e o que mudou de estado.
  const known = new Map<string, { status: string; notified: string | null }>();
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await db.from('lootrush_charges').select('id, status, notified').eq('user_id', userId).in('id', rows.slice(i, i + 200).map(r => r.id));
    if (error) { out.error = /lootrush_charges/.test(error.message) ? 'Falta rodar migration_lootrush.sql no Supabase.' : error.message; return out; }
    for (const k of data || []) known.set(k.id, k);
  }
  const changed = rows.filter(r => known.get(r.id)?.status !== r.status || !known.has(r.id));
  out.fresh = rows.filter(r => !known.has(r.id)).length;
  for (let i = 0; i < changed.length; i += 200) {
    const { error } = await db.from('lootrush_charges').upsert(changed.slice(i, i + 200), { onConflict: 'user_id,id' });
    if (error) { out.error = error.message; await stamp({ status: 'erro', last_error: error.message }); return out; }
  }

  if (first) {
    // Primeira leitura: o histórico entra como já avisado.
    await db.from('lootrush_charges').update({ notified: 'inicio' }).eq('user_id', userId).is('notified', null);
    await stamp({ status: 'ok', last_error: null, baseline_at: new Date().toISOString() });
    return out;
  }

  // Avisos: cobrança que ainda não foi avisada, ou que virou recusada/desfeita depois do aviso.
  const pending = rows.filter(r => { const k = known.get(r.id); return !k || !k.notified || (k.notified !== r.status && k.notified !== 'inicio' && (r.status === 'declined' || r.status === 'reversed')); })
    .sort((a, b) => a.charged_at.localeCompare(b.charged_at));
  if (pending.length) {
    const { data: link } = await db.from('telegram_links').select('chat_id, enabled, settings').eq('user_id', userId).maybeSingle();
    const settings = resolveSettings(link?.settings), canSend = telegramEnabled() && !!link?.chat_id && link.enabled !== false;
    const quiet = isQuiet(settings, hourNow());
    const ids = [...new Set(pending.map(r => r.customer_id).filter((x): x is string => !!x))];
    const { data: accounts } = ids.length ? await db.from('google_ads_accounts').select('customer_id, name, mcc_name').eq('user_id', userId).in('customer_id', ids) : { data: [] as any[] };
    const byId = new Map((accounts || []).map(a => [a.customer_id, a]));
    for (const r of pending) {
      const kind = kindOf(r), on = settings.alerts[kind]?.on !== false;
      // No horário de silêncio a cobrança espera; o código de verificação sai na hora, porque vence.
      if (canSend && on && quiet && kind !== 'lr_codigo') continue;
      if (canSend && on) {
        if (out.sent >= MAX_MESSAGES) break;                       // o resto sai na próxima leitura
        try { await sendTelegram(link!.chat_id, message(kind, r, r.customer_id ? byId.get(r.customer_id) : undefined)); out.sent++; }
        catch { continue; }                                         // falhou o envio: tenta de novo na próxima
      }
      await db.from('lootrush_charges').update({ notified: r.status }).eq('user_id', userId).eq('id', r.id);
    }
  }
  await stamp({ status: 'ok', last_error: null });
  return out;
}

/** Todas as ligações, dentro do tempo que o agendador deu. */
export async function runLootrush(deadline: number) {
  const report = { users: 0, read: 0, fresh: 0, sent: 0, errors: [] as string[] };
  const { data: conns, error } = await supabaseAdmin().from('lootrush_connections').select('*').order('last_sync_at', { ascending: true, nullsFirst: true });
  if (error || !conns?.length) return report;
  for (const conn of conns) {
    if (Date.now() > deadline) break;
    report.users++;
    try {
      const r = await syncLootrush(conn);
      report.read += r.read; report.fresh += r.fresh; report.sent += r.sent;
      if (r.error) report.errors.push(r.error.slice(0, 160));
    } catch (e: any) { report.errors.push(String(e.message).slice(0, 160)); }
  }
  return report;
}

export interface AccountCheck {
  customer_id: string; name: string | null; mcc: string | null; currency: string | null; known: boolean;
  /** Cobrado no cartão pelo gasto deste mês, em dólar: cobranças que valeram, menos o que foi devolvido. */
  charged: number; charges: number; pending: number; declined: number; cards: string[];
  /** Gasto que o Google informou no mês, na moeda da conta. Vazio quando a conta não está no Autometrics. */
  google_cost: number | null;
  /** Cobrado menos gasto, só quando a conta é em dólar (a moeda do cartão). */
  diff: number | null;
  /**
   * credito: pago além do gasto — o depósito que o Google cobra ao cadastrar o cartão (US$ 10, 20, 40…) e que a conta ainda não gastou.
   * credito_parado: o mesmo, numa conta suspensa ou cancelada — o Google devolve esse valor para o cartão.
   */
  state: 'bate' | 'a_cobrar' | 'credito' | 'credito_parado' | 'falta_cobrar' | 'outra_moeda' | 'fora';
  /** Situação da conta no Google (ENABLED, SUSPENDED, CANCELED…). */
  status: string | null;
}

/** Folga da conferência: o Google cobra em parcelas, então cobrado e gasto nunca batem no centavo. */
const tolerance = (cost: number) => Math.max(50, cost * 0.1);
const signedOf = (c: any) => (c.polarity === 'credit' ? -Math.abs(num(c.amount)) : Math.abs(num(c.amount)));
const validOf = (c: any) => c.status !== 'declined' && c.status !== 'reversed';
/** Dia da cobrança no horário de Brasília. */
const dayOf = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const shiftMonth = (month: string, delta: number) => { const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + delta); return d.toISOString().slice(0, 7); };
const lastDay = (month: string) => { const d = new Date(`${shiftMonth(month, 1)}-01T12:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

/**
 * Conferência de um mês (AAAA-MM), conta por conta: o gasto que o Google informou no mês
 * ao lado do que foi cobrado nos cartões por esse gasto.
 *
 * O Google cobra em parcelas enquanto o gasto acumula e, no dia 1º, cobra o que sobrou do
 * mês anterior. Por isso as cobranças de um mês vão do dia 2 até o dia 1º do mês seguinte,
 * e as do dia 1º entram no fechamento do mês anterior — não no mês que começa.
 */
export async function lootrushCheck(userId: string, month: string) {
  const db = supabaseAdmin();
  const prev = shiftMonth(month, -1), next = shiftMonth(month, 1);
  const first = `${month}-01`, last = lastDay(month), nextFirst = `${next}-01`, today = dayOf(new Date().toISOString());
  const closed = today > nextFirst;                                  // o dia 1º seguinte já passou: o mês está fechado

  // Tudo do dia 2 do mês anterior até o dia 1º do mês seguinte: o mês pedido e o fechamento do anterior.
  const start = new Date(`${prev}-02T00:00:00-03:00`).toISOString(), end = new Date(`${nextFirst}T23:59:59.999-03:00`).toISOString();
  const [rows, oldest, everRows] = await Promise.all([
    fetchAll((a, b) => db.from('lootrush_charges')
      .select('id, group_name, card_last4, card_name, merchant, customer_id, code, amount, local_amount, local_currency, status, polarity, reason, charged_at')
      .eq('user_id', userId).gte('charged_at', start).lte('charged_at', end).order('charged_at', { ascending: false }).range(a, b)),
    db.from('lootrush_charges').select('charged_at').eq('user_id', userId).order('charged_at', { ascending: true }).limit(1),
    fetchAll((a, b) => db.from('lootrush_charges').select('customer_id').eq('user_id', userId).not('customer_id', 'is', null).range(a, b)),
  ]);
  const oldestDay = oldest.data?.[0]?.charged_at ? dayOf(oldest.data[0].charged_at) : null;
  const cardAccounts = [...new Set(everRows.map((r: any) => String(r.customer_id)))];   // contas já cobradas nestes cartões, em qualquer data

  const withDay = rows.map((c: any) => ({ ...c, day: dayOf(c.charged_at) }));
  const cycle = withDay.filter(c => c.day > first && c.day <= nextFirst);              // pagam o gasto deste mês
  const closing = withDay.filter(c => c.day === first);                                // dia 1º: pagam o que sobrou do mês anterior
  const prevCycle = withDay.filter(c => c.day > `${prev}-01` && c.day < first);

  const [{ data: accounts }, products] = await Promise.all([
    cardAccounts.length ? db.from('google_ads_accounts').select('customer_id, name, mcc_name, currency_code, status').eq('user_id', userId).in('customer_id', cardAccounts) : Promise.resolve({ data: [] as any[] }),
    fetchAll((a, b) => db.from('products').select('id, google_ads_customer_id').eq('user_id', userId).not('google_ads_customer_id', 'is', null).range(a, b)),
  ]);
  const known = new Map((accounts || []).map(a => [a.customer_id, a]));
  const accountOfProduct = new Map<string, string>(products.map((p: any) => [p.id, String(p.google_ads_customer_id).replace(/\D/g, '')]));
  const cost = new Map<string, number>(), prevCost = new Map<string, number>();
  const productIds = [...accountOfProduct.keys()];
  for (let i = 0; i < productIds.length; i += 150) {
    const list = await fetchAll((a, b) => db.from('daily_metrics').select('product_id, date, cost').in('product_id', productIds.slice(i, i + 150)).gte('date', `${prev}-01`).lte('date', last).gt('cost', 0).range(a, b));
    for (const r of list) { const acc = accountOfProduct.get(r.product_id)!, m = r.date >= first ? cost : prevCost; m.set(acc, (m.get(acc) || 0) + num(r.cost)); }
  }
  const isUsd = (id: string) => String(known.get(id)?.currency_code || '').toUpperCase() === 'USD';

  const byAccount = new Map<string, AccountCheck>();
  const rowOf = (id: string) => {
    let row = byAccount.get(id);
    if (!row) { const a = known.get(id); byAccount.set(id, row = { customer_id: id, name: a?.name || null, mcc: a?.mcc_name || null, currency: a?.currency_code || null, known: !!a,
      charged: 0, charges: 0, pending: 0, declined: 0, cards: [], google_cost: a ? cost.get(id) || 0 : null, diff: null, state: a ? 'bate' : 'fora', status: a?.status || null }); }
    return row;
  };
  const others: any[] = [], codes: any[] = [], added = new Set<string>();
  const total = { charged: 0, pending: 0, declined: 0, google: 0, compared_charged: 0, outside: 0, credit: 0, credit_stopped: 0, to_charge: 0, returned: 0 };
  for (const c of cycle) {
    const valid = validOf(c), value = signedOf(c);
    if (c.code) { codes.push(c); continue; }
    if (!c.customer_id) { others.push(c); if (valid) total.outside += value; continue; }
    if (c.status === 'declined') { total.declined++; rowOf(c.customer_id).declined++; continue; }
    // Cobrança de US$ 0 é o Google conferindo o cartão quando ele é cadastrado numa conta: não é gasto.
    if (valid && value === 0) { if (!known.has(c.customer_id)) { added.add(c.customer_id); continue; } }
    if (!valid) continue;
    if (value < 0) total.returned -= value;
    const row = rowOf(c.customer_id);
    row.charged += value; if (value !== 0) row.charges++;
    if (c.status === 'on_hold') { row.pending += value; total.pending += value; }
    total.charged += value;
    if (c.card_last4 && !row.cards.includes(c.card_last4)) row.cards.push(c.card_last4);
  }
  // Conta que gastou no mês e ainda não teve cobrança neste ciclo também entra: é gasto a cobrar.
  for (const id of cardAccounts) if (known.has(id) && (cost.get(id) || 0) > 0) rowOf(id);
  for (const row of byAccount.values()) {
    if (!row.known) continue;
    if (!isUsd(row.customer_id)) { row.state = 'outra_moeda'; continue; }
    total.google += row.google_cost || 0; total.compared_charged += row.charged;
    row.diff = row.charged - (row.google_cost || 0);
    const ok = Math.abs(row.diff) <= tolerance(row.google_cost || 0);
    const stopped = !!row.status && !/^(ENABLED|UNKNOWN|UNSPECIFIED)$/i.test(row.status);
    row.state = stopped && row.diff >= 1 ? 'credito_parado' : row.diff > 0 && !ok ? 'credito' : closed ? (ok ? 'bate' : 'falta_cobrar') : (ok && row.diff >= 0 ? 'bate' : 'a_cobrar');
    if (row.diff > 0) total.credit += row.diff; else total.to_charge -= row.diff;
    if (row.state === 'credito_parado') total.credit_stopped += row.diff;
  }

  // Gasto de contas que nunca foram cobradas nestes cartões: devem estar em outro cartão.
  const elsewhere = [...cost].filter(([id]) => !cardAccounts.includes(id));
  // Fechamento do mês anterior: o que sobrou dele (gasto menos o já cobrado) contra o que foi cobrado no dia 1º.
  const usdCard = (c: any) => c.customer_id && known.has(c.customer_id) && isUsd(c.customer_id) && validOf(c) && !c.code;
  const prevSpent = cardAccounts.filter(id => known.has(id) && isUsd(id)).reduce((s, id) => s + (prevCost.get(id) || 0), 0);
  const prevCharged = prevCycle.filter(usdCard).reduce((s, c) => s + signedOf(c), 0), closingCharged = closing.filter(usdCard).reduce((s, c) => s + signedOf(c), 0);

  const order: Record<string, number> = { credito_parado: 0, falta_cobrar: 1, fora: 2, credito: 3, a_cobrar: 4, outra_moeda: 5, bate: 6 };
  return {
    month, first, last, closed, oldest_day: oldestDay,
    total: { ...total, added_elsewhere: added.size, elsewhere_accounts: elsewhere.length, elsewhere_cost: elsewhere.reduce((s, [, v]) => s + v, 0) },
    // Só vale quando as cobranças guardadas cobrem o mês anterior inteiro.
    closing: { month: prev, complete: !!oldestDay && oldestDay <= `${prev}-02`, spent: prevSpent, charged_before: prevCharged, left: prevSpent - prevCharged, charged_day1: closingCharged, done: today >= first },
    codes, others,
    accounts: [...byAccount.values()].sort((x, y) => order[x.state] - order[y.state] || (y.google_cost || 0) - (x.google_cost || 0) || y.charged - x.charged),
    charges: cycle.slice(0, 400), more: Math.max(0, cycle.length - 400),
  };
}
