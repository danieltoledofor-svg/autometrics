import { listInvoices, search } from './client';
import { supabaseAdmin, decryptSecret } from './server';

/**
 * Teste de uma vez, só leitura: em contas onde a cobrança veio menor que o
 * gasto, pergunta ao Google por orçamento da conta e fatura, os dois lugares
 * onde a API pode mostrar crédito ou promoção. O resultado fica nas
 * preferências do usuário, porque as chaves do Google só existem no servidor.
 */

const USER_ID = '3ca09caf-3484-433c-89b9-f667e2796591';
const PREF_KEY = 'billing_probe_2026_11';
const ACCOUNTS = ['MON 06', 'MON 04', 'P3B - 06', 'P5B - 04', 'SPG 03', 'MON 05', '✅ C02', '✅ C02 - WL - TP 03', 'P7B - 03', 'P3B - 02', 'ADFARM', 'EMP 01'];

const failure = (e: any) => ({ error: String(e.message).slice(0, 200), code: e.code || null, status: e.status || null });

export async function runBillingProbe() {
  const db = supabaseAdmin();
  const { data: saved, error: readError } = await db.from('user_ui_prefs').select('prefs').eq('user_id', USER_ID).maybeSingle();
  if (readError) return { error: readError.message };
  if (saved?.prefs?.[PREF_KEY]) return { skipped: true };

  const { data: accounts } = await db.from('google_ads_accounts')
    .select('name, customer_id, login_customer_id, connection_id').eq('user_id', USER_ID).eq('status', 'ENABLED').in('name', ACCOUNTS);
  const results: any[] = [];
  for (const acc of accounts || []) {
    const { data: conn } = await db.from('google_ads_connections').select('refresh_token_enc').eq('id', acc.connection_id).single();
    if (!conn) continue;
    const ctx = { refreshToken: decryptSecret(conn.refresh_token_enc), customerId: acc.customer_id, loginCustomerId: acc.login_customer_id };
    const row: any = { account: acc.name, customer_id: acc.customer_id };
    try {
      const rows = await search(ctx, `SELECT billing_setup.id, billing_setup.status, billing_setup.resource_name FROM billing_setup`);
      row.billing_setups = rows.map((r: any) => ({ id: r.billingSetup?.id, status: r.billingSetup?.status }));
      const setup = rows.find((r: any) => r.billingSetup?.status === 'APPROVED')?.billingSetup?.resourceName;
      if (setup) {
        try {
          row.invoices = await listInvoices(ctx, setup, '2026', 'OCTOBER');
        } catch (e: any) { row.invoices = failure(e); }
      }
    } catch (e: any) { row.billing_setups = failure(e); }
    try {
      const rows = await search(ctx, `SELECT account_budget.id, account_budget.status, account_budget.name, account_budget.total_adjustments_micros, account_budget.amount_served_micros, account_budget.approved_spending_limit_micros, account_budget.adjusted_spending_limit_micros FROM account_budget`);
      row.account_budgets = rows.map((r: any) => r.accountBudget);
    } catch (e: any) { row.account_budgets = failure(e); }
    results.push(row);
  }
  const { error } = await db.from('user_ui_prefs').upsert({
    user_id: USER_ID,
    prefs: { ...(saved?.prefs || {}), [PREF_KEY]: { at: new Date().toISOString(), results } },
  });
  return { accounts: results.length, error: error?.message };
}
