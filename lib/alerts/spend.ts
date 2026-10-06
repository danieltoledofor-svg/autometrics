import { supabaseAdmin, appUrl } from '@/lib/googleAds/server';
import { escapeHtml, sendTelegram, telegramEnabled } from '@/lib/telegram';
import { formatMoney } from '@/lib/analysis/labels';
import { addDays, fetchAll } from '@/lib/analysis/compute';
import { spendAlert } from './spendRule';

/**
 * Alertas de gasto pelo Telegram. Roda a cada chamada do agendador (5 min):
 * olha as campanhas de quem ligou o Telegram e manda mensagem quando o gasto
 * de hoje passa do normal (lib/alerts/spendRule). Cada alerta sai uma vez por
 * campanha por dia — o registro em alert_log é gravado antes do envio.
 *
 * O dia e a hora seguem o horário de Brasília.
 */

const TZ = 'America/Sao_Paulo';

function nowIn(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || '00';
  const hour = Number(g('hour')) % 24;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, dayPart: (hour * 60 + Number(g('minute'))) / 1440 };
}

export async function runSpendAlerts() {
  const report = { users: 0, sent: 0, errors: [] as string[] };
  if (!telegramEnabled()) return report;
  const db = supabaseAdmin();
  const { data: links, error } = await db.from('telegram_links').select('user_id, chat_id').eq('enabled', true).not('chat_id', 'is', null);
  if (error || !links?.length) return report;
  const { day, dayPart } = nowIn(TZ);

  for (const link of links) {
    report.users++;
    try {
      const products = await fetchAll((a, b) => db.from('products').select('id, name, currency').eq('user_id', link.user_id).range(a, b));
      const ids = products.map(p => p.id);
      const rows: any[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        rows.push(...await fetchAll((a, b) => db.from('daily_metrics').select('product_id, date, cost, conversions')
          .in('product_id', ids.slice(i, i + 150)).gte('date', addDays(day, -7)).lte('date', day).gt('cost', 0).range(a, b)));
      }
      const by = new Map<string, { today: number; sales: number; past: number; days: number }>();
      for (const r of rows) {
        if (!by.has(r.product_id)) by.set(r.product_id, { today: 0, sales: 0, past: 0, days: 0 });
        const p = by.get(r.product_id)!;
        if (r.date === day) { p.today += Number(r.cost || 0); p.sales += Number(r.conversions || 0); }
        else { p.past += Number(r.cost || 0); p.days++; }
      }
      for (const [id, p] of by) {
        const alert = spendAlert(p.today, p.past, p.days, dayPart);
        if (!alert) continue;
        const product = products.find(x => x.id === id)!;
        const kind = `gasto_${alert.kind}`;
        // Grava antes de enviar: se já existe (mesma campanha, dia e tipo), não repete.
        const { error: dup } = await db.from('alert_log').insert({ user_id: link.user_id, product_id: id, day, kind, details: { today: p.today, normal: alert.normal, pace: alert.pace, sales: p.sales } });
        if (dup) { if (dup.code !== '23505') report.errors.push(dup.message); continue; }
        const money = (v: number) => formatMoney(v, product.currency);
        const line = alert.kind === 'passou'
          ? `Já gastou <b>${money(p.today)}</b> hoje, ${Math.round((alert.over - 1) * 100)}% acima de um dia normal (${money(alert.normal)}).`
          : `Gastou <b>${money(p.today)}</b> até agora: no ritmo de fechar o dia em ${money(alert.pace)}, contra ${money(alert.normal)} de um dia normal.`;
        const sales = p.sales > 0 ? `${String(p.sales).replace('.', ',')} ${p.sales === 1 ? 'venda' : 'vendas'} hoje.` : 'Nenhuma venda hoje.';
        await sendTelegram(link.chat_id, `⚠️ <b>Gasto acima do normal</b>\n${escapeHtml(String(product.name || ''))}\n\n${line}\n${sales}\n\n<a href="${appUrl()}/products/${id}">Abrir a campanha</a>`);
        report.sent++;
      }
    } catch (e: any) {
      report.errors.push(String(e.message).slice(0, 200));
    }
  }
  return report;
}
