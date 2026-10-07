import { search, listAccessibleCustomers, cleanCustomerId, GoogleAdsError } from './client';
import { supabaseAdmin, decryptSecret } from './server';
import { resolveEffectiveStatus } from '@/lib/campaignStatus';

export interface DiscoveredAccount {
  customer_id: string;
  /** Gerenciador pelo qual a conta é acessada; a própria conta se for direta. */
  login_customer_id: string;
  name: string;
  mcc_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  status: string;
}

/**
 * Todas as contas de anúncio que o login do Google enxerga, direto ou por
 * qualquer gerenciador.
 *
 * customer_client lista também as contas suspensas e canceladas — as mesmas
 * que o AdsManagerApp.accounts() do script escondia —, então o status delas
 * chega ao painel sem precisar de rota especial.
 */
export async function discoverAccounts(refreshToken: string): Promise<{ accounts: DiscoveredAccount[]; errors: string[] }> {
  const direct = await listAccessibleCustomers(refreshToken);
  const found = new Map<string, DiscoveredAccount>();
  const errors: string[] = [];

  // Gerenciadores primeiro: uma conta visível pela MCC e também direto deve
  // ser acessada pela MCC, que é como o painel agrupa.
  const infos: { id: string; manager: boolean; name: string; currency: string | null; tz: string | null; status: string }[] = [];
  for (const id of direct) {
    try {
      const [row] = await search({ refreshToken, customerId: id, loginCustomerId: id },
        'SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code, customer.time_zone, customer.status FROM customer LIMIT 1');
      const c = row?.customer || {};
      infos.push({ id, manager: !!c.manager, name: c.descriptiveName || id, currency: c.currencyCode || null, tz: c.timeZone || null, status: c.status || 'UNKNOWN' });
    } catch (e: any) {
      // Conta cancelada direto no login: não responde nem ao próprio customer.
      if (e instanceof GoogleAdsError && /NOT_ENABLED|CUSTOMER_NOT_ENABLED/i.test(`${e.code} ${e.message}`)) {
        infos.push({ id, manager: false, name: id, currency: null, tz: null, status: 'CANCELED' });
      } else {
        errors.push(`${id}: ${e.message}`);
      }
    }
  }
  infos.sort((a, b) => Number(b.manager) - Number(a.manager));

  for (const info of infos) {
    if (!info.manager) {
      if (!found.has(info.id)) {
        found.set(info.id, {
          customer_id: info.id, login_customer_id: info.id, name: info.name, mcc_name: null,
          currency_code: info.currency, time_zone: info.tz, status: info.status,
        });
      }
      continue;
    }
    try {
      const rows = await search({ refreshToken, customerId: info.id, loginCustomerId: info.id }, `
        SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
               customer_client.status, customer_client.currency_code, customer_client.time_zone
        FROM customer_client
        WHERE customer_client.level >= 1`);
      for (const r of rows) {
        const cc = r.customerClient || {};
        if (cc.manager) continue; // gerenciador não tem campanha
        const id = cleanCustomerId(cc.id);
        if (found.has(id)) continue;
        found.set(id, {
          customer_id: id, login_customer_id: info.id, name: cc.descriptiveName || id, mcc_name: info.name,
          currency_code: cc.currencyCode || null, time_zone: cc.timeZone || null, status: cc.status || 'UNKNOWN',
        });
      }
    } catch (e: any) {
      errors.push(`${info.name}: ${e.message}`);
    }
  }

  await nameDirectManagers(refreshToken, [...found.values()], infos, errors);
  return { accounts: [...found.values()], errors };
}

/**
 * Gerenciador das contas que não vieram por nenhuma MCC acessível.
 *
 * Sem isto, todas caem num balde "Sem gerenciador" — o que, em quem tem
 * dezenas de contas, esconde justamente a informação usada para achar a conta.
 * customer_manager_link responde na própria conta cliente; quando o
 * gerenciador não é um dos acessíveis, resta o número dele, que já agrupa.
 */
async function nameDirectManagers(
  refreshToken: string,
  accounts: DiscoveredAccount[],
  infos: { id: string; name: string }[],
  errors: string[],
) {
  const conhecidos = new Map(infos.map(i => [i.id, i.name]));
  const soltas = accounts.filter(a => !a.mcc_name && a.status !== 'CANCELED' && a.status !== 'CLOSED');
  let semVinculo = 0;

  for (const conta of soltas) {
    try {
      const rows = await search({ refreshToken, customerId: conta.customer_id, loginCustomerId: conta.customer_id },
        `SELECT customer_manager_link.manager_customer, customer_manager_link.status
         FROM customer_manager_link WHERE customer_manager_link.status = 'ACTIVE'`);
      const link = rows[0]?.customerManagerLink?.managerCustomer;
      if (!link) continue;
      const id = cleanCustomerId(String(link).split('/').pop() || '');
      if (!id) continue;
      // O acesso continua direto pela própria conta: o gerenciador achado aqui
      // é só o nome do grupo. Trocar o login por um gerenciador que este e-mail
      // não acessa faz o Google negar todas as consultas da conta.
      if (conhecidos.has(id)) conta.login_customer_id = id;
      conta.mcc_name = conhecidos.get(id) || `Gerenciador ${id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}`;
    } catch {
      // Conta sem permissão para ler o vínculo: fica em "Sem gerenciador".
      // Uma linha por conta encheria o aviso da conexão sem ajudar ninguém.
      semVinculo++;
    }
  }

  if (semVinculo) errors.push(`gerenciador não identificado em ${semVinculo} conta(s)`);
}

/**
 * Atualiza a lista de contas de uma conexão e marca como suspensas as
 * campanhas das contas que o Google suspendeu ou encerrou.
 */
export async function refreshConnectionAccounts(connection: { id: string; user_id: string; refresh_token_enc: string }) {
  const db = supabaseAdmin();
  const refreshToken = decryptSecret(connection.refresh_token_enc);
  const { accounts, errors } = await discoverAccounts(refreshToken);
  const now = new Date().toISOString();

  if (accounts.length) {
    // Conta suspensa ou cancelada nasce com a coleta desligada: ela não responde
    // e cada tentativa ainda consome cota. Conta que já existe mantém a escolha
    // do usuário, exceto quando o Google a derrubou — aí desliga.
    const { data: existentes } = await db.from('google_ads_accounts')
      .select('customer_id').eq('user_id', connection.user_id);
    const jaExiste = new Set((existentes || []).map(e => e.customer_id));
    const base = (a: DiscoveredAccount) => ({ ...a, user_id: connection.user_id, connection_id: connection.id, updated_at: now });

    const novas = accounts.filter(a => !jaExiste.has(a.customer_id)).map(a => ({ ...base(a), sync_enabled: a.status === 'ENABLED' }));
    const antigasMortas = accounts.filter(a => jaExiste.has(a.customer_id) && a.status !== 'ENABLED').map(a => ({ ...base(a), sync_enabled: false }));
    const antigasVivas = accounts.filter(a => jaExiste.has(a.customer_id) && a.status === 'ENABLED').map(base);

    for (const lote of [novas, antigasMortas, antigasVivas]) {
      if (!lote.length) continue;
      const { error } = await db.from('google_ads_accounts').upsert(lote, { onConflict: 'user_id,customer_id' });
      if (error) throw new Error('Erro ao salvar contas: ' + error.message);
    }
  }

  await markClosedAccounts(connection.user_id, accounts);

  await db.from('google_ads_connections')
    .update({ last_discovery_at: now, status: 'ok', last_error: errors.length ? errors.join(' | ').slice(0, 1000) : null, updated_at: now })
    .eq('id', connection.id);

  return { accounts, errors };
}

/** Mesmo efeito da rota /api/webhook/google-ads/accounts do script. */
async function markClosedAccounts(userId: string, accounts: DiscoveredAccount[]) {
  const db = supabaseAdmin();
  const hoje = new Date().toISOString().slice(0, 10);
  for (const a of accounts) {
    const status = resolveEffectiveStatus({ accountStatus: a.status });
    if (status !== 'CONTA_SUSPENSA' && status !== 'CONTA_ENCERRADA') continue;
    const patch = {
      google_status: status,
      google_status_reasons: `conta ${a.status}`,
      google_status_date: hoje,
      status: 'paused',
    };
    // Produtos já ligados à conta pelo ID e, para os antigos, pelo nome.
    await db.from('products').update(patch).eq('user_id', userId).eq('google_ads_customer_id', a.customer_id);
    await db.from('products').update(patch).eq('user_id', userId).eq('account_name', a.name).is('google_ads_customer_id', null);
  }
}
