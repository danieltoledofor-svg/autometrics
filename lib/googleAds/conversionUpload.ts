import { supabaseAdmin, decryptSecret } from '@/lib/googleAds/server';
import { search, createUploadConversionAction, ingestSale, type AdsContext } from '@/lib/googleAds/client';
import { addUsage } from '@/lib/googleAds/sync';
import { fetchAll } from '@/lib/analysis/compute';

/**
 * Envio das vendas ao Google pelo clique (Etapa 3 do rastreamento).
 *
 * Cada venda que o postback ligou a um clique vira uma conversão na conta do
 * Google onde o clique aconteceu, numa ação de conversão própria ("Venda
 * Autometrics", do tipo importar cliques). Só roda para quem ligou em
 * Integração, e só com as vendas feitas depois de ligar.
 *
 * A ação é criada na conta dona das conversões — a própria conta ou a MCC,
 * quando a MCC centraliza as conversões. Por padrão ela nasce como observação
 * (não entra nos lances), para rodar ao lado do que já envia vendas hoje sem
 * contar em dobro.
 *
 * A venda entra pela Data Manager API (o Google fechou o caminho antigo para
 * integrações novas). Ela pede uma permissão própria: quem ligou a conta do
 * Google antes disso precisa autorizar de novo, pelo cartão do envio.
 */

export const DEFAULT_ACTION = 'Venda Autometrics';
const RETRY_HOURS = 2;
const GIVE_UP_DAYS = 5;

/** O Google ainda não enxerga o clique ou a ação recém-criada: tenta de novo depois. */
const RETRY = new Set(['SEM_PERMISSAO', 'SERVICE_DISABLED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'CLICK_NOT_FOUND', 'TOO_RECENT_CONVERSION_ACTION', 'TOO_RECENT_EVENT', 'CONVERSION_ACTION_NOT_FOUND', 'INTERNAL_ERROR', 'TRANSIENT_ERROR']);
/** A venda já está lá. */
const ALREADY = new Set(['ORDER_ID_ALREADY_IN_USE', 'CLICK_CONVERSION_ALREADY_EXISTS', 'DUPLICATE_ORDER_ID']);
const REASON: Record<string, string> = {
  SEM_PERMISSAO: 'Falta autorizar o envio de vendas nesta conta do Google. Use o botão "Autorizar o envio" logo acima.',
  SERVICE_DISABLED: 'O serviço de envio de vendas do Google ainda não está ligado no projeto do Autometrics.',
  PERMISSION_DENIED: 'O Google negou o envio para esta conta. Confira se o e-mail autorizado tem acesso a ela.',
  INVALID_ARGUMENT: 'O Google recusou os dados desta venda.',
  CLICK_NOT_FOUND: 'O Google ainda não encontrou este clique.',
  TOO_RECENT_CONVERSION_ACTION: 'A ação de conversão foi criada há pouco; o Google leva algumas horas para aceitar vendas nela.',
  TOO_RECENT_EVENT: 'O clique é recente demais para o Google aceitar a venda.',
  CONVERSION_ACTION_NOT_FOUND: 'O Google ainda não liberou a ação de conversão.',
  EXPIRED_EVENT: 'O clique é antigo demais para o Google aceitar a venda.',
  CONVERSION_PRECEDES_EVENT: 'A venda aparece com horário anterior ao do clique.',
  INVALID_CUSTOMER_FOR_CLICK: 'O clique é de outra conta do Google.',
  CUSTOMER_NOT_ACCEPTED_CUSTOMER_DATA_TERMS: 'A conta precisa aceitar os termos de dados do cliente no Google Ads.',
  CONVERSION_TRACKING_NOT_ENABLED_AT_IMPRESSION_TIME: 'A conta não tinha conversões ligadas na hora do clique.',
};

const googleTime = (iso: string) => `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

type Target = { conversionCustomerId: string; actionResource: string; ctx: AdsContext };

/**
 * Onde a venda de uma conta deve ser enviada: descobre a conta dona das
 * conversões, acha a ação pelo nome e cria quando não existe.
 */
async function resolveTarget(db: any, userId: string, account: any, refreshToken: string, settings: any, usage: { calls: number }): Promise<Target> {
  const name = settings.action_name || DEFAULT_ACTION;
  const { data: saved } = await db.from('google_conversion_targets').select('conversion_customer_id, action_resource')
    .eq('user_id', userId).eq('customer_id', account.customer_id).eq('action_name', name).maybeSingle();
  const base = { refreshToken, loginCustomerId: account.login_customer_id };
  if (saved) return { conversionCustomerId: saved.conversion_customer_id, actionResource: saved.action_resource, ctx: { ...base, customerId: saved.conversion_customer_id } };

  usage.calls++;
  const rows = await search({ ...base, customerId: account.customer_id },
    'SELECT customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer LIMIT 1');
  const owner = String(rows[0]?.customer?.conversionTrackingSetting?.googleAdsConversionCustomer || '').split('/')[1] || account.customer_id;
  const ctx: AdsContext = { ...base, customerId: owner };

  usage.calls++;
  const found = await search(ctx,
    `SELECT conversion_action.resource_name, conversion_action.type, conversion_action.status FROM conversion_action WHERE conversion_action.name = '${name.replace(/['\\]/g, '')}'`);
  const usable = found.find((r: any) => r.conversionAction?.type === 'UPLOAD_CLICKS' && r.conversionAction?.status === 'ENABLED');
  if (found.length && !usable) throw new Error(`Já existe no Google uma ação chamada "${name}" que não aceita vendas enviadas. Escolha outro nome.`);

  let resource = usable?.conversionAction?.resourceName || '';
  const created = !resource;
  if (created) {
    usage.calls++;
    resource = await createUploadConversionAction(ctx, name, !!settings.counts_for_bidding);
    if (!resource) throw new Error('O Google não devolveu a ação de conversão criada.');
  }
  await db.from('google_conversion_targets').upsert({
    user_id: userId, customer_id: account.customer_id, action_name: name,
    conversion_customer_id: owner, action_resource: resource, created_by_us: created,
  }, { onConflict: 'user_id, customer_id, action_name' });
  return { conversionCustomerId: owner, actionResource: resource, ctx };
}

/** Vendas ligadas a clique que ainda não foram enviadas, de um usuário. */
async function pendingSales(db: any, userId: string, startAt: string) {
  const since = new Date(Math.max(Date.parse(startAt), Date.now() - 60 * 86400000)).toISOString();
  const products = await fetchAll((a, b) => db.from('products').select('id, google_ads_customer_id').eq('user_id', userId).order('id').range(a, b));
  const customerOf = new Map<string, string>(products.map((p: any) => [p.id, p.google_ads_customer_id || '']));
  const events = (await fetchAll((a, b) => db.from('postback_events')
    .select('id, product_id, transaction_id, amount, currency, click_id, created_at')
    .eq('event_type', 'sale').not('click_id', 'is', null).gte('created_at', since).order('created_at').range(a, b)))
    .filter((e: any) => customerOf.has(e.product_id));
  if (!events.length) return [];

  const done = new Map<string, any>();
  for (let i = 0; i < events.length; i += 200) {
    const { data } = await db.from('google_conversion_uploads').select('event_id, status, attempts, next_try_at, created_at')
      .in('event_id', events.slice(i, i + 200).map((e: any) => e.id));
    for (const u of data || []) done.set(u.event_id, u);
  }
  const now = Date.now();
  const todo = events.filter((e: any) => {
    const u = done.get(e.id);
    return !u || (u.status === 'aguardando' && (!u.next_try_at || Date.parse(u.next_try_at) <= now));
  });

  const clicks = new Map<string, any>();
  const ids = [...new Set(todo.map((e: any) => e.click_id))];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from('tracking_clicks').select('click_id, gclid, gbraid, wbraid').eq('user_id', userId).in('click_id', ids.slice(i, i + 100));
    for (const c of data || []) clicks.set(c.click_id, c);
  }
  return todo.map((e: any) => ({ event: e, prev: done.get(e.id) || null, click: clicks.get(e.click_id) || null, customerId: customerOf.get(e.product_id) || '' }));
}

/**
 * Roda no agendador: envia o que está pendente de todos os usuários que
 * ligaram o envio. Para quando o prazo acaba; o resto sai na próxima chamada.
 */
export async function runConversionUploads(deadline: number) {
  const db = supabaseAdmin();
  const report = { sent: 0, waiting: 0, failed: 0, skipped: 0, errors: [] as string[] };
  const { data: all, error } = await db.from('google_conversion_settings').select('*').eq('enabled', true);
  if (error) return report;                                       // antes de migration_envio_google.sql

  const usage = { calls: 0 };
  for (const settings of all || []) {
    if (Date.now() > deadline) break;
    const userId = settings.user_id;
    try {
      const sales = await pendingSales(db, userId, settings.start_at || new Date().toISOString());
      if (!sales.length) continue;

      const { data: accounts } = await db.from('google_ads_accounts').select('customer_id, login_customer_id, connection_id, status').eq('user_id', userId);
      const accountOf = new Map<string, any>((accounts || []).map((a: any) => [a.customer_id, a]));
      const tokens = new Map<string, string>();
      const tokenFor = async (connectionId: string) => {
        if (!tokens.has(connectionId)) {
          const { data } = await db.from('google_ads_connections').select('refresh_token_enc').eq('id', connectionId).eq('status', 'ok').maybeSingle();
          tokens.set(connectionId, data ? decryptSecret(data.refresh_token_enc) : '');
        }
        return tokens.get(connectionId)!;
      };

      const record = async (s: any, fields: Record<string, any>) => {
        const attempts = (s.prev?.attempts || 0) + (fields.status === 'ignorada' ? 0 : 1);
        await db.from('google_conversion_uploads').upsert({
          user_id: userId, event_id: s.event.id, product_id: s.event.product_id, customer_id: s.customerId || null,
          click_id: s.event.click_id, amount: Number(s.event.amount) || 0, currency: String(s.event.currency || 'USD').toUpperCase(),
          order_id: s.event.transaction_id || null, conversion_at: s.event.created_at,
          reason: null, error_code: null, next_try_at: null, sent_at: null, attempts, ...fields,
        }, { onConflict: 'event_id' });
        if (fields.status === 'enviada') report.sent++;
        else if (fields.status === 'aguardando') report.waiting++;
        else if (fields.status === 'falhou') report.failed++;
        else report.skipped++;
      };
      /** Tenta de novo mais tarde, até desistir. */
      const later = (s: any, code: string, reason: string) => {
        const firstTry = s.prev?.created_at ? Date.parse(s.prev.created_at) : Date.now();
        return Date.now() - firstTry > GIVE_UP_DAYS * 86400000
          ? record(s, { status: 'falhou', error_code: code, reason })
          : record(s, { status: 'aguardando', error_code: code, reason, next_try_at: hoursFromNow(RETRY_HOURS) });
      };

      // Agrupa por conta do clique; o que não tem como ir fica registrado com o motivo.
      const byCustomer = new Map<string, any[]>();
      for (const s of sales) {
        const id = s.click?.gclid || s.click?.gbraid || s.click?.wbraid;
        if (!id) { await record(s, { status: 'ignorada', reason: 'O clique desta venda não tem o identificador do Google.' }); continue; }
        if (!s.customerId || !accountOf.has(s.customerId)) { await record(s, { status: 'ignorada', reason: 'A conta do Google desta campanha não está ligada pela API.' }); continue; }
        if (!byCustomer.has(s.customerId)) byCustomer.set(s.customerId, []);
        byCustomer.get(s.customerId)!.push(s);
      }

      for (const [customerId, list] of byCustomer) {
        if (Date.now() > deadline) break;
        const account = accountOf.get(customerId);
        let target: Target;
        try {
          const token = await tokenFor(account.connection_id);
          if (!token) throw new Error('A ligação com o Google expirou. Reconecte a conta em Integração.');
          target = await resolveTarget(db, userId, account, token, settings, usage);
        } catch (e: any) {
          for (const s of list) await later(s, 'ALVO', e.message || 'Não foi possível preparar a ação de conversão.');
          report.errors.push(`${customerId}: ${e.message}`);
          continue;
        }
        const where = { conversionCustomerId: target.conversionCustomerId, loginCustomerId: account.login_customer_id, actionId: target.actionResource.split('/').pop() || '' };
        for (const s of list) {
          if (Date.now() > deadline) break;
          try {
            usage.calls++;
            await ingestSale(target.ctx.refreshToken, where, {
              ...(s.click.gclid ? { gclid: s.click.gclid } : s.click.gbraid ? { gbraid: s.click.gbraid } : { wbraid: s.click.wbraid }),
              at: s.event.created_at, value: Number(s.event.amount) || 0, currency: String(s.event.currency || 'USD').toUpperCase(),
              ...(s.event.transaction_id ? { orderId: String(s.event.transaction_id).slice(0, 64) } : {}),
            });
            await record(s, { status: 'enviada', sent_at: new Date().toISOString() });
          } catch (e: any) {
            // 403 por falta da permissão nova: o token desta conta é de antes do envio de vendas.
            const code = /scope/i.test(`${e.code} ${e.message}`) ? 'SEM_PERMISSAO' : String(e.code || 'ENVIO');
            if (ALREADY.has(code)) await record(s, { status: 'enviada', sent_at: new Date().toISOString() });
            else if (RETRY.has(code) || Number(e.status) >= 500) await later(s, code, REASON[code] || e.message || 'O Google não respondeu.');
            else await record(s, { status: 'falhou', error_code: code, reason: REASON[code] ? `${REASON[code]} (${e.message})`.slice(0, 500) : e.message || 'O Google recusou o envio.' });
            if (code !== 'SEM_PERMISSAO') report.errors.push(`${customerId}: ${e.message}`);
          }
        }
      }
    } catch (e: any) {
      report.errors.push(`${userId}: ${e.message}`);
    }
  }
  await addUsage(usage.calls).catch(() => {});
  return { ...report, api_calls: usage.calls };
}
