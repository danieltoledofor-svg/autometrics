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
 *   2. se não achar, pergunta ao Google, uma conta e um dia por consulta, com um teto por rodada:
 *      primeiro as contas das campanhas que usam a palavra-chave da venda, voltando 35 dias
 *      (quem compra muitas vezes clicou dias antes); depois as outras contas com gasto, 3 dias;
 *   3. achou: o postback é repetido com a campanha certa, no dia da venda.
 * A procura no que já está guardado se repete por 72 horas; a pergunta ao Google para quando todas as
 * contas e dias foram vistos. O que foi feito em cada postback fica escrito em `note`.
 */

const MAX_AGE_HOURS = 72, CALLS_PER_RUN = 40, PAIRS_PER_TRY = 20;
/** Quem compra muitas vezes clicou dias antes: nas contas mais prováveis a busca volta este tanto de dias. */
const DAYS_BACK_LIKELY = 35, DAYS_BACK_OTHERS = 2;
/** gclid, gbraid ou wbraid: texto longo só com letras, números, "-" e "_", que não é sessão de rastreador. */
const looksLikeGclid = (v: string) => v.length >= 40 && /^[A-Za-z0-9_-]+$/.test(v) && !/^(ftsession_|v\d_|track_|vst_)/i.test(v);

export async function retryUnmatched(deadline: number) {
  const db = supabaseAdmin();
  const report = { pending: 0, resolved: 0, calls: 0, errors: [] as string[] };
  const { data: rows, error } = await db.from('postback_unmatched').select('*').is('resolved_at', null)
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

  /** Grava o andamento. Antes de a coluna `note` existir, grava sem ela. */
  const save = async (id: string, patch: Record<string, any>) => {
    const { error: e } = await db.from('postback_unmatched').update(patch).eq('id', id);
    if (e && 'note' in patch) { const { note: _note, ...rest } = patch; await db.from('postback_unmatched').update(rest).eq('id', id); }
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
      // 2. Perguntando ao Google: uma consulta por conta e por dia. `tries` guarda quantos lotes já foram vistos.
      const saleDay = serverDay(new Date(row.created_at));
      let note = '';
      if (!campaignId && canAsk && gclids.length && report.calls < CALLS_PER_RUN && (row.event_type === 'sale' || row.event_type === 'refund')) {
        const accounts = await spendingAccounts(row.user_id);
        // Contas mais prováveis: as das campanhas com cliques guardados na palavra-chave que veio no postback.
        const words = refs.filter(v => !looksLikeGclid(v) && !/^(ftsession_|v\d_|track_|vst_)/i.test(v) && /[a-z]/i.test(v) && v.length <= 80);
        const likely = new Set<string>();
        if (words.length) {
          const { data: byWord } = await db.from('google_ads_clicks').select('product_id').in('keyword_text', words).gte('date', addDays(saleDay, -DAYS_BACK_LIKELY)).limit(2000);
          const ids = [...new Set((byWord || []).map(r => r.product_id))].slice(0, 100);
          const { data: owners } = ids.length ? await db.from('products').select('google_ads_customer_id').eq('user_id', row.user_id).in('id', ids) : { data: [] as any[] };
          for (const o of owners || []) likely.add(String(o.google_ads_customer_id).replace(/\D/g, ''));
        }
        const pairs: { acc: any; day: string }[] = [];
        for (let back = 0; back <= DAYS_BACK_LIKELY; back++) for (const acc of accounts) if (likely.has(acc.customerId)) pairs.push({ acc, day: addDays(saleDay, -back) });
        for (let back = 0; back <= DAYS_BACK_OTHERS; back++) for (const acc of accounts) if (!likely.has(acc.customerId)) pairs.push({ acc, day: addDays(saleDay, -back) });
        const start = (Number(row.tries) || 0) * PAIRS_PER_TRY, batch = pairs.slice(start, start + PAIRS_PER_TRY);
        let asked = 0, failed = '';
        note = batch.length ? '' : `Google: nada em ${accounts.length} contas (${likely.size} prováveis, até ${DAYS_BACK_LIKELY} dias atrás).`;
        search: for (const { acc, day } of batch) {
          if (report.calls >= CALLS_PER_RUN || Date.now() > deadline) break search;
          report.calls++; asked++;
          const found = await search({ refreshToken: decryptSecret(acc.enc), customerId: acc.customerId, loginCustomerId: acc.loginCustomerId },
            `SELECT click_view.gclid, campaign.id, ad_group.id, click_view.keyword_info.text, click_view.keyword_info.match_type, segments.device FROM click_view WHERE segments.date = '${day}' AND click_view.gclid = '${gclids[0]}'`)
            .catch((e: any) => { failed = String(e.message).slice(0, 160); report.errors.push(failed); return [] as any[]; });
          const hit = found.find(r => r.campaign?.id);
          if (!hit) continue;
          const { data: p } = await db.from('products').select('id').eq('user_id', row.user_id).eq('google_ads_campaign_id', String(hit.campaign.id)).maybeSingle();
          note = `Google: clique de ${day} na campanha ${hit.campaign.id}${p ? '' : ', que não está cadastrada aqui'}.`;
          if (p) {
            productId = p.id; campaignId = String(hit.campaign.id);
            // Guarda o clique: a próxima venda desse gclid já acha a campanha na hora.
            await db.from('google_ads_clicks').upsert({ gclid: gclids[0], product_id: p.id, date: day, keyword_text: hit.clickView?.keywordInfo?.text || null,
              match_type: hit.clickView?.keywordInfo?.matchType || null, ad_group_id: hit.adGroup?.id ? String(hit.adGroup.id) : null, device: hit.segments?.device || null }, { onConflict: 'gclid' }).then(() => null, () => null);
          }
          break search;                                          // o gclid é desta conta, com ou sem campanha cadastrada aqui
        }
        if (!note && batch.length) note = `Google: ${Math.min(pairs.length, start + asked)} de ${pairs.length} consultas feitas (${likely.size} contas prováveis)${failed ? `. Último erro: ${failed}` : ''}.`;
        // Lote não concluído (teto da rodada): a próxima rodada repete este mesmo lote.
        if (asked < batch.length && !campaignId) { await save(row.id, { last_try_at: new Date().toISOString(), note }); continue; }
      } else if (!campaignId) note = !gclids.length ? 'O postback não trouxe gclid.' : !canAsk ? 'Cota do Google quase no fim: só procurando no que já está guardado.' : '';

      if (campaignId && productId) {
        const params = new URLSearchParams(row.query || '');
        params.set('campaign_id', campaignId);
        const res = await processPostback(params, row.user_id, { day: saleDay });
        if (res.status === 200) {
          await save(row.id, { resolved_at: new Date().toISOString(), product_id: productId, tries: (Number(row.tries) || 0) + 1, note: note || 'Clique achado no que a coleta do Google já tinha guardado.' });
          report.resolved++;
          continue;
        }
        report.errors.push(`repetição do postback: ${res.status}`);
      }
      await save(row.id, { tries: (Number(row.tries) || 0) + 1, last_try_at: new Date().toISOString(), ...(note ? { note } : {}) });
    } catch (e: any) { report.errors.push(String(e.message).slice(0, 160)); }
  }
  if (report.calls) await addUsage(report.calls).catch(() => {});
  return report;
}
