import type { SupabaseClient } from '@supabase/supabase-js';
import { processPostback } from './postback';
import { clockStamp, inDays, userClocks } from './eventDays';

type Days = { from: string; to: string };

/**
 * Venda ligada à mão a uma visita.
 *
 * Quando o postback chega sem nada que diga de qual clique veio (sem gclid, sem
 * sessão conhecida), a venda fica em postback_unmatched e aparece na aba Vendas
 * como "sem campanha". Na aba Visitas o usuário aponta a visita que gerou a
 * venda: ela entra na campanha da visita, ligada ao clique, como se o postback
 * tivesse chegado completo — soma no painel e vai ao Google pelo envio
 * automático (lib/googleAds/conversionUpload.ts), quando ele está ligado.
 *
 * Também dá para registrar uma venda que o postback nem avisou, com valor e
 * número do pedido digitados.
 */

const PENDING_DAYS = 30;
const productOf = (query: string) => { try { return new URLSearchParams(query || '').get('product') || ''; } catch { return ''; } };

/** Vendas sem campanha ainda não ligadas. Com `days`, só as do período (relógio da plataforma). */
export async function unmatchedSales(db: SupabaseClient, userId: string, days?: Days) {
  const { data, error } = await db.from('postback_unmatched').select('id, amount, currency, transaction_id, source, query, created_at')
    .eq('user_id', userId).eq('event_type', 'sale').is('resolved_at', null)
    .gte('created_at', new Date(Date.now() - PENDING_DAYS * 86400000).toISOString()).order('created_at', { ascending: false }).limit(200);
  if (error || !data) return [];                                   // antes de migration_postback_sem_campanha.sql
  const clocks = await userClocks(db, userId);
  return data.filter(r => !days || inDays(r, clocks, days.from, days.to)).map(r => ({
    id: r.id, at: r.created_at, at_text: clockStamp(r, clocks), amount: Number(r.amount) || 0, currency: String(r.currency || 'USD').toUpperCase(),
    order: r.transaction_id || '', source: r.source || '', product: productOf(r.query),
  }));
}

export interface LinkInput { clickId: string; unmatchedId?: string; amount?: number; currency?: string; order?: string }

/** Liga uma venda à visita. Devolve o erro em texto simples ou o resultado. */
export async function linkSaleToVisit(db: SupabaseClient, userId: string, input: LinkInput): Promise<{ error: string } | { ok: true; campaign: string; googleOn: boolean }> {
  const { data: click } = await db.from('tracking_clicks').select('click_id, product_id, created_at').eq('user_id', userId).eq('click_id', input.clickId).maybeSingle();
  if (!click) return { error: 'Visita não encontrada.' };
  if (!click.product_id) return { error: 'Esta visita não tem campanha ligada, então não dá para saber em qual campanha somar a venda.' };
  const { data: product } = await db.from('products').select('id, name, google_ads_campaign_name, google_ads_campaign_id').eq('id', click.product_id).eq('user_id', userId).maybeSingle();
  if (!product) return { error: 'A campanha desta visita não é deste login.' };
  const campaign = product.google_ads_campaign_name || product.name || 'a campanha';

  let params: URLSearchParams, at: string, row: any = null;
  if (input.unmatchedId) {
    ({ data: row } = await db.from('postback_unmatched').select('id, query, created_at, transaction_id, resolved_at').eq('id', input.unmatchedId).eq('user_id', userId).maybeSingle());
    if (!row) return { error: 'Venda não encontrada.' };
    if (row.resolved_at) return { error: 'Esta venda já foi ligada a uma campanha.' };
    params = new URLSearchParams(row.query || '');
    at = row.created_at;
    // Sem número do pedido a venda não seria guardada nem enviada ao Google.
    if (!row.transaction_id) params.set('orderid', `am-${String(row.id).slice(0, 8)}`);
  } else {
    const amount = Number(input.amount);
    if (!(amount > 0)) return { error: 'Informe o valor da venda.' };
    const order = String(input.order || '').trim().slice(0, 80) || `am-${Date.now().toString(36)}`;
    params = new URLSearchParams({ event: 'sale', amount: String(amount), cy: String(input.currency || 'USD').toUpperCase().slice(0, 3), orderid: order, source: 'Marcada à mão' });
    at = new Date().toISOString();
  }
  if (Date.parse(at) < Date.parse(click.created_at)) return { error: 'A venda aconteceu antes desta visita. Escolha uma visita anterior à venda.' };

  // O mesmo pedido já está em alguma campanha: não soma de novo.
  const tid = params.get('orderid') || params.get('tid') || params.get('order_id') || params.get('transid');
  if (tid) {
    const { data: same } = await db.from('postback_events').select('product_id').eq('transaction_id', tid).eq('event_type', 'sale').limit(20);
    const ids = (same || []).map(s => s.product_id);
    if (ids.length) {
      const { data: owned } = await db.from('products').select('name, google_ads_campaign_name').eq('user_id', userId).in('id', ids).limit(1);
      if (owned?.[0]) return { error: `O pedido ${tid} já está registrado em ${owned[0].google_ads_campaign_name || owned[0].name}.` };
    }
  }

  const res = await processPostback(params, userId, { at, productId: product.id, clickId: click.click_id });
  if (res.status !== 200) return { error: 'Não foi possível registrar a venda. Tente de novo.' };
  if (row) {
    await db.from('postback_unmatched').update({ resolved_at: new Date().toISOString(), product_id: product.id, note: `Ligada à mão à visita ${click.click_id}.` }).eq('id', row.id)
      .then(r => r.error ? db.from('postback_unmatched').update({ resolved_at: new Date().toISOString(), product_id: product.id }).eq('id', row.id) : r);
  }
  const { data: upload } = await db.from('google_conversion_settings').select('enabled').eq('user_id', userId).maybeSingle();
  return { ok: true, campaign, googleOn: !!upload?.enabled };
}
