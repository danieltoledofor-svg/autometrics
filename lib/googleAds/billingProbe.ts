import { search } from './client';
import { supabaseAdmin, decryptSecret } from './server';

/**
 * Levantamento de uma vez, só leitura: pergunta ao orçamento de cada conta
 * quanto o Google ajustou (crédito) e quanto veiculou. Vai por partes, um
 * pouco a cada chamada do agendador, com o resultado nas preferências do
 * usuário, porque as chaves do Google só existem no servidor.
 */

const USER_ID = '3ca09caf-3484-433c-89b9-f667e2796591';
const PREF_KEY = 'billing_credits_2026_11';
const TIME_LIMIT_MS = 15000;
const CONCURRENCY = 4;

export async function runBillingProbe() {
  const db = supabaseAdmin();
  const { data: saved, error: readError } = await db.from('user_ui_prefs').select('prefs').eq('user_id', USER_ID).maybeSingle();
  if (readError) return { error: readError.message };
  const state = saved?.prefs?.[PREF_KEY] || { finished: false, results: [] };
  if (state.finished) return { skipped: true };

  const { data: accounts } = await db.from('google_ads_accounts')
    .select('name, customer_id, login_customer_id, connection_id, mcc_name, currency_code, status, last_sync_status')
    .eq('user_id', USER_ID).not('last_sync_status', 'is', null).order('customer_id');
  const seen = new Set(state.results.map((r: any) => r.customer_id));
  const pending = (accounts || []).filter(a => !seen.has(a.customer_id));
  const deadline = Date.now() + TIME_LIMIT_MS;
  const fresh: any[] = [];

  const worker = async () => {
    while (pending.length && Date.now() < deadline) {
      const acc = pending.shift()!;
      const row: any = { name: acc.name, customer_id: acc.customer_id, mcc: acc.mcc_name, currency: acc.currency_code, status: acc.status };
      try {
        const { data: conn } = await db.from('google_ads_connections').select('refresh_token_enc').eq('id', acc.connection_id).single();
        const rows = await search(
          { refreshToken: decryptSecret(conn!.refresh_token_enc), customerId: acc.customer_id, loginCustomerId: acc.login_customer_id },
          'SELECT account_budget.id, account_budget.status, account_budget.total_adjustments_micros, account_budget.amount_served_micros FROM account_budget',
        );
        row.budgets = rows.map((r: any) => ({
          status: r.accountBudget?.status,
          adjustments: Number(r.accountBudget?.totalAdjustmentsMicros || 0) / 1e6,
          served: Number(r.accountBudget?.amountServedMicros || 0) / 1e6,
        }));
      } catch (e: any) {
        row.error = String(e.code || e.message).slice(0, 120);
      }
      fresh.push(row);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const results = [...state.results, ...fresh];
  const { error } = await db.from('user_ui_prefs').upsert({
    user_id: USER_ID,
    prefs: { ...(saved?.prefs || {}), [PREF_KEY]: { finished: !pending.length, at: new Date().toISOString(), results } },
  });
  return { read: fresh.length, left: pending.length, error: error?.message };
}
