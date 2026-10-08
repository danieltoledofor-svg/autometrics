import { supabaseAdmin, decryptSecret } from '@/lib/googleAds/server';
import { search } from '@/lib/googleAds/client';
import { addUsage, usageToday, DAILY_QUOTA } from '@/lib/googleAds/sync';
import { addDays } from '@/lib/analysis/compute';
import { processPostback, serverDay } from './postback';

/**
 * Segunda chance para o postback que chegou e não achou a campanha.
 *
 * O postback das plataformas traz o gclid do clique, mas não a campanha. Quando
 * a página não tem o script do Autometrics, quem sabe de qual campanha é o
 * gclid é o próprio Google (click_view). Aqui, a cada rodada do agendador:
 *   1. procura o gclid entre os cliques que a coleta já guardou (google_ads_clicks);
 *   2. se não achar, pergunta ao Google, conta por conta, começando pelas que
 *      mais gastaram nos últimos dias — com um teto de consultas por rodada;
 *   3. achou: o postback é repetido com a campanha certa, no dia da venda.
 * Tenta por 72 horas; depois o postback fica guardado como não resolvido.
 */

const MAX_AGE_HOURS = 72, MAX_TRIES = 8, CALLS_PER_RUN = 40, ACCOUNTS_PER_TRY = 12;
/** gclid, gbraid ou wbraid: texto longo só com letras, números, "-" e "_", que não é sessão de rastreador. */
const looksLikeGclid = (v: string) => v.length >= 40 && /^[A-Za-z0-9_-]+$/.test(v) && !/^(ftsession_|v\d_|track_|vst_)/i.test(v);

export async function retryUnmatched(deadline: number) {
  const db = supabaseAdmin();
  const report = { pending: 0, resolved: 0, calls: 0, errors: [] as string[] };
  const { data: rows, error } = await db.from('postback_unmatched').select('*').is('resolved_at', null).lt('tries', MAX_TRIES)
    .gte('created_at', new Date(Date.now() - MAX_AGE_HOURS * 3600000).toISOString()).order('created_at', { ascending: true }).limit(40);
  if (error || !rows?.length) return report;            // antes da migração, ou nada pendente
  report.pending = rows.length;
  // Com a cota do dia quase no fim, não pergunta ao Google: só procura no que já está guardado.
  const canAsk = (await usageToday().catch(() => DAILY_QUOTA)) < DAILY_QUOTA * 0.8;

  const accountsOf = new Map<string, any[]>();           // por usuário: contas ativas, das que mais gastaram para as que menos
  const spendingAccounts = async (userId: string) => {
    if (accountsOf.has(userId)) return accountsOf.get(userId)!;
    const since = addDays(serverDay(), -4);
    const [{ data: accounts }, { data: conns }, { data: products }] = await Promise.all([
      db.from('google_ads_accounts').select('customer_id, login_customer_id, connection_id, status').eq('user_id', userId).eq('status', 'ENABLED'),
      db.from('google_ads_connections').select('id, refresh_token_enc, status').eq('user_id', userId).eq('status', 'ok'),
      db.from('products').select('id, google_ads_customer_id').eq('user_id', userId).not('google_ads_customer_id', 'is', null).limit(5000),
    ]);
    const accountOfProduct = new Map((products || []).map(p => [p.id, String(p.google_ads_customer_id).replace(/\D/g, '')]));
    const cost = new Map<string, number>(), ids = [...accountOfProduct.keys()];
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await db.from('daily_metrics').select('product_id, cost').in('product_id', ids.slice(i, i + 150)).gte('date', since).gt('cost', 0).limit(5000);
      for (const r of data || []) { const a = accountOfProduct.get(r.product_id)!; cost.set(a, (cost.get(a) || 0) + Number(r.cost)); }
    }
    const token = new Map((conns || []).map(c => [c.id, c.refresh_token_enc]));
    const list = (accounts || []).filter(a => token.has(a.connection_id) && (cost.get(a.customer_id) || 0) > 0)
      .sort((x, y) => (cost.get(y.customer_id) || 0) - (cost.get(x.customer_id) || 0))
      .map(a => ({ customerId: a.customer_id, loginCustomerId: a.login_customer_id, enc: token.get(a.connection_id)! }));
    accountsOf.set(userId, list);
    return list;
  };

  for (const row of rows) {
    if (Date.now() > deadline) break;
    const refs: string[] = (row.ref_ids || []).filter((v: any) => typeof v === 'string' && v);
    const gclids = refs.filter(looksLikeGclid);
    let productId: string | null = null, campaignId: string | null = null;
    try {
      // 1. Entre os cliques que a coleta já guardou.
      if (refs.length) {
        const { data: known } = await db.from('google_ads_clicks').select('product_id').in('gclid', refs).limit(1);
        if (known?.[0]) {
          const { data: p } = await db.from('products').select('id, google_ads_campaign_id').eq('id', known[0].product_id).eq('user_id', row.user_id).maybeSingle();
          if (p?.google_ads_campaign_id) { productId = p.id; campaignId = String(p.google_ads_campaign_id); }
        }
      }
      // 2. Perguntando ao Google: uma consulta por conta e por dia (o dia da venda e o anterior).
      const saleDay = serverDay(new Date(row.created_at));
      if (!campaignId && canAsk && gclids.length && report.calls < CALLS_PER_RUN && (row.event_type === 'sale' || row.event_type === 'refund')) {
        const accounts = await spendingAccounts(row.user_id);
        // Cada tentativa olha um lote de contas; a seguinte continua de onde parou.
        const start = (Number(row.tries) || 0) * ACCOUNTS_PER_TRY % Math.max(1, accounts.length);
        const batch = [...accounts.slice(start), ...accounts.slice(0, start)].slice(0, ACCOUNTS_PER_TRY);
        search: for (const acc of batch) {
          for (const day of [saleDay, addDays(saleDay, -1)]) {
            if (report.calls >= CALLS_PER_RUN || Date.now() > deadline) break search;
            report.calls++;
            const found = await search({ refreshToken: decryptSecret(acc.enc), customerId: acc.customerId, loginCustomerId: acc.loginCustomerId },
              `SELECT click_view.gclid, campaign.id, ad_group.id, click_view.keyword_info.text, click_view.keyword_info.match_type, segments.device FROM click_view WHERE segments.date = '${day}' AND click_view.gclid = '${gclids[0]}'`)
              .catch((e: any) => { report.errors.push(String(e.message).slice(0, 120)); return [] as any[]; });
            const hit = found.find(r => r.campaign?.id);
            if (!hit) continue;
            const { data: p } = await db.from('products').select('id').eq('user_id', row.user_id).eq('google_ads_campaign_id', String(hit.campaign.id)).maybeSingle();
            if (p) {
              productId = p.id; campaignId = String(hit.campaign.id);
              // Guarda o clique: a próxima venda desse gclid já acha a campanha na hora.
              await db.from('google_ads_clicks').upsert({ gclid: gclids[0], product_id: p.id, date: day, keyword_text: hit.clickView?.keywordInfo?.text || null,
                match_type: hit.clickView?.keywordInfo?.matchType || null, ad_group_id: hit.adGroup?.id ? String(hit.adGroup.id) : null, device: hit.segments?.device || null }, { onConflict: 'gclid' }).then(() => null, () => null);
            }
            break search;                                        // o gclid é desta conta, com ou sem campanha cadastrada aqui
          }
        }
      }

      if (campaignId && productId) {
        const params = new URLSearchParams(row.query || '');
        params.set('campaign_id', campaignId);
        const res = await processPostback(params, row.user_id, { day: saleDay });
        if (res.status === 200) {
          await db.from('postback_unmatched').update({ resolved_at: new Date().toISOString(), product_id: productId, tries: (Number(row.tries) || 0) + 1 }).eq('id', row.id);
          report.resolved++;
          continue;
        }
        report.errors.push(`repetição do postback: ${res.status}`);
      }
      await db.from('postback_unmatched').update({ tries: (Number(row.tries) || 0) + 1, last_try_at: new Date().toISOString() }).eq('id', row.id);
    } catch (e: any) { report.errors.push(String(e.message).slice(0, 160)); }
  }
  if (report.calls) await addUsage(report.calls).catch(() => {});
  return report;
}
