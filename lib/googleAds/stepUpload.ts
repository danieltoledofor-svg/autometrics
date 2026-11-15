import { supabaseAdmin, decryptSecret } from '@/lib/googleAds/server';
import { ingestSale } from '@/lib/googleAds/client';
import { addUsage } from '@/lib/googleAds/sync';
import { fetchAll } from '@/lib/analysis/compute';
import { shortClickId } from '@/lib/tracking/shortId';
import { resolveTarget, RETRY, ALREADY, REASON, RETRY_HOURS, GIVE_UP_DAYS, type ActionSpec, type Target } from './conversionUpload';

/**
 * Envio das etapas do funil ao Google pelo clique.
 *
 * Além da venda, duas etapas que separam comprador de curioso (medido nos dados de 14 dias até 15/11/2026):
 *   checkout  a pessoa clicou para ir ao checkout: perto de 1 em cada 5 compra
 *   tempo10   ficou 10 minutos ou mais no site: perto de 1 em cada 25 compra (a média é 1 em 140)
 * Página vista, rolagem e tempo curto não entram: não separam quem compra e levariam o Google
 * a buscar visitas baratas.
 *
 * Cada etapa vai numa ação própria ("AM - Checkout", "AM - 10 min no site"), sempre só como
 * observação: aparece em "Todas as conversões" e não muda os lances. Usar nos lances é uma
 * escolha feita no Google Ads, campanha a campanha. O valor de cada etapa é o que ela rendeu
 * em vendas, em média, nos últimos 30 dias deste login; com poucas vendas, vale o número medido.
 *
 * Roda no agendador, depois do envio das vendas. Para quando o prazo acaba; o resto sai na próxima.
 */

type StepKey = 'checkout' | 'tempo10';
export const STEPS: Record<StepKey, ActionSpec & { label: string; fallback: number }> = {
  checkout: { label: 'Foi ao checkout', name: 'AM - Checkout', primary: false, category: 'BEGIN_CHECKOUT', countingType: 'ONE_PER_CLICK', fallback: 39 },
  tempo10: { label: '10 min no site', name: 'AM - 10 min no site', primary: false, category: 'ENGAGEMENT', countingType: 'ONE_PER_CLICK', fallback: 9 },
};
const TEN_MINUTES = 600;
/** Etapas mais antigas que isso não são procuradas: elas acontecem durante a visita. */
const LOOK_BACK_HOURS = 72;
/** Abaixo disso de vendas na etapa, o valor medido em 15/11/2026 vale mais que a conta do mês. */
const MIN_SALES_FOR_VALUE = 10;
const PER_RUN = 150;

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

/** Quanto cada etapa rende em vendas, em média, nos últimos 30 dias (US$ por clique que fez a etapa). */
export async function stepValues(db: any, userId: string): Promise<Record<StepKey, { value: number; clicks: number; sales: number }>> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [long, out, sales] = await Promise.all([
    fetchAll((a, b) => db.from('tracking_clicks').select('click_id').eq('user_id', userId).eq('is_bot', false)
      .gte('seconds', TEN_MINUTES).gte('created_at', since).order('created_at').range(a, b)),
    fetchAll((a, b) => db.from('tracking_pageviews').select('click_id').eq('user_id', userId).eq('kind', 'checkout')
      .gte('created_at', since).order('created_at').range(a, b)),
    fetchAll((a, b) => db.from('postback_events').select('click_id, amount, currency').eq('event_type', 'sale')
      .not('click_id', 'is', null).gte('created_at', since).order('created_at').range(a, b)),
  ]);
  const paid = new Map<string, number>();
  for (const s of sales) if (String(s.currency || 'USD').toUpperCase() === 'USD') paid.set(s.click_id, (paid.get(s.click_id) || 0) + (Number(s.amount) || 0));
  const measure = (ids: Set<string>, fallback: number) => {
    let n = 0, total = 0;
    for (const id of ids) if (paid.has(id)) { n++; total += paid.get(id)!; }
    const value = n >= MIN_SALES_FOR_VALUE && ids.size ? Math.round(total / ids.size * 100) / 100 : fallback;
    return { value, clicks: ids.size, sales: n };
  };
  return {
    checkout: measure(new Set(out.map((r: any) => r.click_id)), STEPS.checkout.fallback),
    tempo10: measure(new Set(long.map((r: any) => r.click_id)), STEPS.tempo10.fallback),
  };
}

/** Acha as etapas novas dos cliques de anúncio e guarda para envio. */
async function discover(db: any, userId: string, startAt: string) {
  const since = new Date(Math.max(Date.parse(startAt), Date.now() - LOOK_BACK_HOURS * 3600000)).toISOString();
  const [long, out] = await Promise.all([
    fetchAll((a, b) => db.from('tracking_clicks').select('click_id, created_at').eq('user_id', userId).eq('is_bot', false)
      .not('product_id', 'is', null).gte('seconds', TEN_MINUTES).gte('created_at', since).order('created_at').range(a, b)),
    fetchAll((a, b) => db.from('tracking_pageviews').select('click_id, created_at').eq('user_id', userId).eq('kind', 'checkout')
      .gte('created_at', since).order('created_at').range(a, b)),
  ]);
  const found: { click_id: string; step: StepKey; step_at: string }[] = [];
  // O minuto em que a pessoa completou 10 minutos não é guardado: vale o início da visita + 10 minutos (nunca antes do clique).
  for (const c of long) found.push({ click_id: c.click_id, step: 'tempo10', step_at: new Date(Date.parse(c.created_at) + TEN_MINUTES * 1000).toISOString() });
  const firstOut = new Map<string, string>();
  for (const p of out) if (!firstOut.has(p.click_id)) firstOut.set(p.click_id, p.created_at);
  for (const [click_id, step_at] of firstOut) found.push({ click_id, step: 'checkout', step_at });
  if (!found.length) return 0;

  // Só o que ainda não está guardado (a busca volta 72 horas a cada rodada).
  const known = new Set<string>();
  const ids = [...new Set(found.map(f => f.click_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('google_step_uploads').select('click_id, step').eq('user_id', userId).in('click_id', ids.slice(i, i + 200));
    for (const r of data || []) known.add(`${r.click_id}|${r.step}`);
  }
  const fresh = found.filter(f => !known.has(`${f.click_id}|${f.step}`));
  if (!fresh.length) return 0;

  // Campanha e conta de cada clique; checkout de visita sem campanha ou de robô fica de fora.
  const clickOf = new Map<string, any>();
  const freshIds = [...new Set(fresh.map(f => f.click_id))];
  for (let i = 0; i < freshIds.length; i += 200) {
    const { data } = await db.from('tracking_clicks').select('click_id, product_id, is_bot').eq('user_id', userId).in('click_id', freshIds.slice(i, i + 200));
    for (const c of data || []) clickOf.set(c.click_id, c);
  }
  const productIds = [...new Set([...clickOf.values()].map(c => c.product_id).filter(Boolean))];
  const customerOf = new Map<string, string>();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data } = await db.from('products').select('id, google_ads_customer_id').eq('user_id', userId).in('id', productIds.slice(i, i + 200));
    for (const p of data || []) customerOf.set(p.id, String(p.google_ads_customer_id || '').replace(/\D/g, ''));
  }
  const values = await stepValues(db, userId);
  const rows = fresh.filter(f => clickOf.get(f.click_id)?.product_id && !clickOf.get(f.click_id)?.is_bot).map(f => {
    const productId = clickOf.get(f.click_id).product_id;
    return { user_id: userId, click_id: f.click_id, step: f.step, product_id: productId, customer_id: customerOf.get(productId) || null,
      value: values[f.step].value, currency: 'USD', step_at: f.step_at, status: 'aguardando' };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('google_step_uploads').upsert(rows.slice(i, i + 500), { onConflict: 'user_id, click_id, step', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/** Roda no agendador: guarda as etapas novas e envia o que está pendente, de quem ligou o envio das etapas. */
export async function runStepUploads(deadline: number) {
  const db = supabaseAdmin();
  const report = { found: 0, sent: 0, waiting: 0, failed: 0, skipped: 0, errors: [] as string[] };
  const { data: all, error } = await db.from('google_conversion_settings').select('*').eq('steps_enabled', true);
  if (error) return report;                                       // antes de migration_envio_etapas.sql

  const usage = { calls: 0 };
  for (const settings of all || []) {
    if (Date.now() > deadline) break;
    const userId = settings.user_id;
    try {
      report.found += await discover(db, userId, settings.steps_start_at || new Date().toISOString());
      if (Date.now() > deadline) break;

      const now = new Date().toISOString();
      const { data: pending } = await db.from('google_step_uploads').select('*').eq('user_id', userId).eq('status', 'aguardando')
        .or(`next_try_at.is.null,next_try_at.lte.${now}`).order('step_at').limit(PER_RUN);
      if (!pending?.length) continue;

      const clicks = new Map<string, any>();
      const ids = [...new Set(pending.map(p => p.click_id))];
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await db.from('tracking_clicks').select('click_id, gclid, gbraid, wbraid').eq('user_id', userId).in('click_id', ids.slice(i, i + 100));
        for (const c of data || []) clicks.set(c.click_id, c);
      }
      const { data: accounts } = await db.from('google_ads_accounts').select('customer_id, login_customer_id, connection_id').eq('user_id', userId);
      const accountOf = new Map<string, any>((accounts || []).map((a: any) => [a.customer_id, a]));
      const tokens = new Map<string, string>();
      const tokenFor = async (connectionId: string) => {
        if (!tokens.has(connectionId)) {
          const { data } = await db.from('google_ads_connections').select('refresh_token_enc').eq('id', connectionId).eq('status', 'ok').maybeSingle();
          tokens.set(connectionId, data ? decryptSecret(data.refresh_token_enc) : '');
        }
        return tokens.get(connectionId)!;
      };

      const record = async (row: any, fields: Record<string, any>) => {
        const attempts = (row.attempts || 0) + (fields.status === 'ignorada' ? 0 : 1);
        await db.from('google_step_uploads').update({ reason: null, error_code: null, next_try_at: null, attempts, ...fields }).eq('id', row.id);
        if (fields.status === 'enviada') report.sent++;
        else if (fields.status === 'aguardando') report.waiting++;
        else if (fields.status === 'falhou') report.failed++;
        else report.skipped++;
      };
      const later = (row: any, code: string, reason: string) => Date.now() - Date.parse(row.created_at) > GIVE_UP_DAYS * 86400000
        ? record(row, { status: 'falhou', error_code: code, reason })
        : record(row, { status: 'aguardando', error_code: code, reason, next_try_at: hoursFromNow(RETRY_HOURS) });

      // Por conta e por etapa: cada uma tem a sua ação de conversão.
      const groups = new Map<string, any[]>();
      for (const row of pending) {
        const c = clicks.get(row.click_id);
        if (!(c?.gclid || c?.gbraid || c?.wbraid)) { await record(row, { status: 'ignorada', reason: 'O clique não tem o identificador do Google.' }); continue; }
        if (!row.customer_id || !accountOf.has(row.customer_id)) { await record(row, { status: 'ignorada', reason: 'A conta do Google desta campanha não está ligada pela API.' }); continue; }
        const key = `${row.customer_id}|${row.step}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      for (const [key, list] of groups) {
        if (Date.now() > deadline) break;
        const [customerId, step] = key.split('|') as [string, StepKey];
        const account = accountOf.get(customerId);
        let target: Target;
        try {
          const token = await tokenFor(account.connection_id);
          if (!token) throw new Error('A ligação com o Google expirou. Reconecte a conta em Integração.');
          target = await resolveTarget(db, userId, account, token, STEPS[step], usage);
        } catch (e: any) {
          for (const row of list) await later(row, 'ALVO', e.message || 'Não foi possível preparar a ação de conversão.');
          report.errors.push(`${customerId}: ${e.message}`);
          continue;
        }
        const where = { conversionCustomerId: target.conversionCustomerId, loginCustomerId: account.login_customer_id, actionId: target.actionResource.split('/').pop() || '' };
        for (const row of list) {
          if (Date.now() > deadline) break;
          const c = clicks.get(row.click_id);
          try {
            usage.calls++;
            await ingestSale(target.ctx.refreshToken, where, {
              ...(c.gclid ? { gclid: c.gclid } : c.gbraid ? { gbraid: c.gbraid } : { wbraid: c.wbraid }),
              at: row.step_at, value: Number(row.value) || 0, currency: row.currency || 'USD',
              orderId: `${step}-${shortClickId(row.click_id)}`,
            });
            await record(row, { status: 'enviada', sent_at: new Date().toISOString() });
          } catch (e: any) {
            const code = /scope/i.test(`${e.code} ${e.message}`) ? 'SEM_PERMISSAO' : String(e.code || 'ENVIO');
            if (ALREADY.has(code)) await record(row, { status: 'enviada', sent_at: new Date().toISOString() });
            else if (RETRY.has(code) || Number(e.status) >= 500) await later(row, code, REASON[code] || e.message || 'O Google não respondeu.');
            else await record(row, { status: 'falhou', error_code: code, reason: (REASON[code] ? `${REASON[code]} (${e.message})` : e.message || 'O Google recusou o envio.').slice(0, 500) });
            if (code !== 'SEM_PERMISSAO') report.errors.push(`${customerId}: ${e.message}`);
          }
        }
      }
    } catch (e: any) {
      report.errors.push(`${userId}: ${e.message}`);
    }
  }
  if (usage.calls) await addUsage(usage.calls).catch(() => {});
  return { ...report, api_calls: usage.calls };
}
