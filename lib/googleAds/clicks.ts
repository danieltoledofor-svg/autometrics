import { search, AdsContext } from './client';
import { supabaseAdmin } from './server';
import { addDays, todayIn } from '@/lib/analysis/compute';
import type { AccountRow } from './sync';

/**
 * gclid → palavra-chave, pelo click_view do Google.
 *
 * Só para campanhas com player da VTurb: é o que liga cada visita (e cada
 * venda) da VTurb à palavra-chave exata. O click_view aceita um dia por
 * consulta: hoje e ontem a cada coleta, mais até 3 dias antigos que faltam.
 */

const DAYS_BACK = 8;
const BACKFILL_PER_RUN = 3;

export async function syncClicks(account: AccountRow, refreshToken: string, usage: { calls: number }, errors: string[]) {
  const db = supabaseAdmin();
  const { data: products, error } = await db.from('products').select('id, google_ads_campaign_id, google_ads_customer_id')
    .eq('user_id', account.user_id).not('vturb_player_id', 'is', null).not('google_ads_campaign_id', 'is', null);
  if (error) return 0;
  const mine = (products || []).filter(p => String(p.google_ads_customer_id || '').replace(/-/g, '') === account.customer_id);
  if (!mine.length) return 0;
  const productByCampaign = new Map(mine.map(p => [String(p.google_ads_campaign_id), p.id]));

  const today = todayIn(account.time_zone);
  const start = addDays(today, -(DAYS_BACK - 1));
  const { data: have, error: haveErr } = await db.from('google_ads_clicks').select('date').in('product_id', mine.map(p => p.id)).gte('date', start);
  if (haveErr) return 0; // antes de migration_vturb.sql
  const haveDays = new Set((have || []).map(r => String(r.date)));
  const days = [today, addDays(today, -1)];
  for (let d = addDays(today, -2); d >= start && days.length < 2 + BACKFILL_PER_RUN; d = addDays(d, -1)) {
    if (!haveDays.has(d)) days.push(d);
  }

  const ctx: AdsContext = { refreshToken, customerId: account.customer_id, loginCustomerId: account.login_customer_id };
  const ids = [...productByCampaign.keys()].join(',');
  let saved = 0;
  for (const day of days) {
    let rows: any[];
    try {
      usage.calls++;
      rows = await search(ctx, `
        SELECT click_view.gclid, click_view.keyword_info.text, click_view.keyword_info.match_type,
               ad_group.id, campaign.id, segments.device
        FROM click_view
        WHERE segments.date = '${day}' AND campaign.id IN (${ids})`);
    } catch (e: any) {
      errors.push(`cliques (gclid) ${day}: ${e.message}`);
      break;
    }
    const out = rows.filter(r => r.clickView?.gclid).map(r => ({
      gclid: String(r.clickView.gclid),
      product_id: productByCampaign.get(String(r.campaign?.id)),
      date: day,
      keyword_text: r.clickView?.keywordInfo?.text || null,
      match_type: r.clickView?.keywordInfo?.matchType || null,
      ad_group_id: r.adGroup?.id ? String(r.adGroup.id) : null,
      device: r.segments?.device || null,
    })).filter(r => r.product_id);
    for (let i = 0; i < out.length; i += 500) {
      const { error: e } = await db.from('google_ads_clicks').upsert(out.slice(i, i + 500), { onConflict: 'gclid' });
      if (e) { errors.push(`cliques (gclid): ${e.message}`); return saved; }
    }
    saved += out.length;
  }
  return saved;
}
