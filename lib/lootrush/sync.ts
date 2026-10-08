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
 * A primeira leitura só guarda (30 dias); os avisos valem do que chegar depois.
 */

const TZ = 'America/Sao_Paulo';
const WINDOW_DAYS = 7, FIRST_DAYS = 30, MAX_MESSAGES = 10;
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
      : `⚠️ Conta do Google ${dashed(r.customer_id)}: <b>não está entre as suas contas no Autometrics</b>. Confira se a cobrança é sua.`
    : isGoogle(r.merchant) ? '' : '⚠️ Esta cobrança <b>não é do Google</b>.';
  const local = r.local_currency && r.local_currency !== 'USD' && r.local_amount ? ` (${r.local_currency} ${Math.abs(r.local_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})` : '';
  const lines = kind === 'lr_codigo' ? [`🔑 <b>Código de verificação do Google: ${r.code}</b>`, card, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`]
    : kind === 'lr_recusada' ? [`⛔ <b>Cobrança recusada: ${usd(r.amount)}</b>${local}`, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`, card, where, r.reason ? `Motivo: ${escapeHtml(r.reason)}` : '']
    : kind === 'lr_credito' ? [`↩️ <b>${r.status === 'reversed' ? 'Cobrança desfeita' : 'Valor devolvido'}: ${usd(r.amount)}</b>${local}`, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`, card, where]
    : [`💳 <b>Cobrança nova: ${usd(r.amount)}</b>${local}`, `${escapeHtml(r.merchant)} · ${hhmm(r.charged_at)}`, card, where];
  return [...lines.filter(Boolean), `<a href="${appUrl()}/planning">Abrir a conferência</a>`].join('\n');
}

/** Lê os grupos de um usuário, grava o que mudou e manda os avisos. */
export async function syncLootrush(conn: any): Promise<{ read: number; fresh: number; sent: number; error?: string }> {
  const db = supabaseAdmin(), userId: string = conn.user_id;
  const groups: { id: string; name: string }[] = Array.isArray(conn.groups) ? conn.groups : [];
  const out = { read: 0, fresh: 0, sent: 0 } as { read: number; fresh: number; sent: number; error?: string };
  const first = !conn.baseline_at;
  const stamp = (patch: Record<string, any>) => db.from('lootrush_connections').update({ ...patch, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (!groups.length) { await stamp({}); return out; }

  const rows: Row[] = [];
  try {
    const key = decryptSecret(conn.key_enc), since = new Date(Date.now() - (first ? FIRST_DAYS : WINDOW_DAYS) * 86400000);
    for (const g of groups) rows.push(...(await groupTransactions(key, g.id, since, first ? 12 : 4)).rows.map(t => toRow(userId, t)));
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
  /** Cobrado no cartão no período, em dólar: cobranças que valeram, menos o que foi devolvido. */
  charged: number; charges: number; pending: number; declined: number; last_at: string | null; cards: string[];
  /** Gasto que o Google informou no mesmo período, na moeda da conta. Vazio quando a conta não está no Autometrics. */
  google_cost: number | null;
  /** Cobrado menos gasto, só quando a conta é em dólar (a moeda do cartão). */
  diff: number | null;
  state: 'bate' | 'cobrado_a_mais' | 'falta_cobrar' | 'outra_moeda' | 'conta_estranha';
}

/** Folga da conferência: o Google cobra em parcelas, então cobrado e gasto nunca batem no centavo. */
const tolerance = (cost: number) => Math.max(50, cost * 0.1);

/** Conferência do período (dias de Brasília, inclusive): por conta do Google, o cobrado no cartão ao lado do gasto no Google. */
export async function lootrushCheck(userId: string, from: string, to: string) {
  const db = supabaseAdmin();
  const start = new Date(`${from}T00:00:00-03:00`).toISOString(), end = new Date(`${to}T23:59:59.999-03:00`).toISOString();
  const charges: any[] = await fetchAll((a, b) => db.from('lootrush_charges')
    .select('id, group_name, card_last4, card_name, merchant, customer_id, code, amount, local_amount, local_currency, status, polarity, reason, charged_at')
    .eq('user_id', userId).gte('charged_at', start).lte('charged_at', end).order('charged_at', { ascending: false }).range(a, b));

  const ids = [...new Set(charges.map(c => c.customer_id).filter(Boolean))] as string[];
  const [{ data: accounts }, products] = await Promise.all([
    ids.length ? db.from('google_ads_accounts').select('customer_id, name, mcc_name, currency_code').eq('user_id', userId).in('customer_id', ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? fetchAll((a, b) => db.from('products').select('id, google_ads_customer_id').eq('user_id', userId).in('google_ads_customer_id', ids).range(a, b)) : Promise.resolve([] as any[]),
  ]);
  const accountOfProduct = new Map<string, string>(products.map((p: any) => [p.id, String(p.google_ads_customer_id).replace(/\D/g, '')]));
  const cost = new Map<string, number>();
  const productIds = [...accountOfProduct.keys()];
  for (let i = 0; i < productIds.length; i += 150) {
    const rows = await fetchAll((a, b) => db.from('daily_metrics').select('product_id, cost').in('product_id', productIds.slice(i, i + 150)).gte('date', from).lte('date', to).gt('cost', 0).range(a, b));
    for (const r of rows) { const acc = accountOfProduct.get(r.product_id)!; cost.set(acc, (cost.get(acc) || 0) + num(r.cost)); }
  }

  const known = new Map((accounts || []).map(a => [a.customer_id, a]));
  const byAccount = new Map<string, AccountCheck>();
  const others: any[] = [], codes: any[] = [];
  const total = { charged: 0, pending: 0, declined: 0, returned: 0, outside: 0 };
  for (const c of charges) {
    const valid = c.status !== 'declined' && c.status !== 'reversed', signed = c.polarity === 'credit' ? -Math.abs(num(c.amount)) : Math.abs(num(c.amount));
    if (c.code) codes.push(c);
    if (c.status === 'declined') total.declined += Math.abs(num(c.amount));
    else if (!valid || c.polarity === 'credit') total.returned += Math.abs(num(c.amount));
    if (valid) { total.charged += signed; if (c.status === 'on_hold') total.pending += signed; }
    if (!c.customer_id) { if (!c.code) { others.push(c); if (valid) total.outside += signed; } continue; }
    const a = known.get(c.customer_id);
    let row = byAccount.get(c.customer_id);
    if (!row) byAccount.set(c.customer_id, row = { customer_id: c.customer_id, name: a?.name || null, mcc: a?.mcc_name || null, currency: a?.currency_code || null, known: !!a,
      charged: 0, charges: 0, pending: 0, declined: 0, last_at: null, cards: [], google_cost: a ? cost.get(c.customer_id) || 0 : null, diff: null, state: a ? 'bate' : 'conta_estranha' });
    if (valid) { row.charged += signed; row.charges++; if (c.status === 'on_hold') row.pending += signed; }
    if (c.status === 'declined') row.declined++;
    if (!row.last_at || c.charged_at > row.last_at) row.last_at = c.charged_at;
    if (c.card_last4 && !row.cards.includes(c.card_last4)) row.cards.push(c.card_last4);
  }
  let googleUsd = 0;
  for (const row of byAccount.values()) {
    if (!row.known) continue;
    if (String(row.currency || '').toUpperCase() !== 'USD') { row.state = 'outra_moeda'; continue; }
    googleUsd += row.google_cost || 0;
    row.diff = row.charged - (row.google_cost || 0);
    row.state = Math.abs(row.diff) <= tolerance(row.google_cost || 0) ? 'bate' : row.diff > 0 ? 'cobrado_a_mais' : 'falta_cobrar';
  }
  return {
    total: { ...total, google_usd: googleUsd }, codes, others,
    accounts: [...byAccount.values()].sort((x, y) => Number(x.known) - Number(y.known) || y.charged - x.charged),
    charges: charges.slice(0, 300), more: Math.max(0, charges.length - 300),
  };
}
