import { supabaseAdmin } from '@/lib/googleAds/server';
import { escapeHtml, sendTelegram, telegramEnabled } from '@/lib/telegram';
import { formatMoney } from '@/lib/analysis/labels';
import { isQuiet, resolveSettings } from './catalog';

/**
 * Aviso de venda na hora em que o postback chega, em vez de esperar a rodada
 * do agendador (a cada 5 minutos). Usa a mesma chave do aviso do agendador
 * (campanha + total de vendas do dia), então a venda não é avisada duas vezes.
 * No horário de silêncio não envia nem registra: o agendador avisa depois.
 */
export async function notifySaleNow(userId: string, productId: string, day: string): Promise<void> {
  if (!telegramEnabled()) return;
  const db = supabaseAdmin();
  const { data: link } = await db.from('telegram_links').select('chat_id, enabled, settings').eq('user_id', userId).maybeSingle();
  if (!link?.chat_id || link.enabled === false) return;
  const settings = resolveSettings(link.settings);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date())) % 24;
  if (!settings.alerts.venda.on || isQuiet(settings, hour)) return;

  const [{ data: product }, { data: row }, { data: logged }] = await Promise.all([
    db.from('products').select('name, currency').eq('id', productId).maybeSingle(),
    db.from('daily_metrics').select('conversions, conversion_value, cost').eq('product_id', productId).eq('date', day).maybeSingle(),
    db.from('alert_log').select('details').eq('user_id', userId).eq('product_id', productId).eq('kind', 'venda').eq('day', day),
  ]);
  const sales = Number(row?.conversions) || 0;
  const last = Math.max(0, ...(logged || []).map(r => Number(r.details?.count) || 0));
  if (!product || sales <= last) return;

  // O registro vai antes do envio: se o agendador rodar ao mesmo tempo, só um dos dois avisa.
  const { error } = await db.from('alert_log').insert({ user_id: userId, product_id: productId, day, kind: 'venda', key: `${productId}:${sales}`, details: { count: sales, at: 'postback' } });
  if (error) return;
  const added = sales - last, money = (v: number) => formatMoney(v, product.currency), n = (v: number) => String(v).replace('.', ',');
  await sendTelegram(link.chat_id, `💰 <b>${added === 1 ? 'Venda nova' : `${n(added)} vendas novas`}</b>\n${escapeHtml(String(product.name || ''))}\n\nHoje: ${n(sales)} ${sales === 1 ? 'venda' : 'vendas'}, ${money(Number(row?.conversion_value) || 0)} de receita e ${money(Number(row?.cost) || 0)} de custo.`);
}
