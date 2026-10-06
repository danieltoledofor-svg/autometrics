import { supabaseAdmin, appUrl } from '@/lib/googleAds/server';
import { escapeHtml, sendTelegram, telegramEnabled } from '@/lib/telegram';
import { formatMoney } from '@/lib/analysis/labels';
import { addDays, fetchAll } from '@/lib/analysis/compute';
import { userChangeEvents } from '@/lib/analysis/changes';
import { explainReasons, resolveProductStatus } from '@/lib/campaignStatus';
import { spendAlert } from './spendRule';
import { isQuiet, resolveSettings, type AlertSettings } from './catalog';
import { isOwner } from '@/lib/ai/openrouter';
import { usageToday, DAILY_QUOTA } from '@/lib/googleAds/sync';

/**
 * Alertas pelo Telegram. Roda a cada chamada do agendador (5 min) para quem
 * ligou o Telegram, com os alertas e limites que cada um escolheu
 * (lib/alerts/catalog). Lê só o que a coleta já gravou.
 *
 * Cada alerta tem uma chave no dia (alert_log): o registro é gravado antes do
 * envio, então o mesmo aviso não se repete. No horário de silêncio nada é
 * enviado nem registrado — o que continuar valendo sai quando o silêncio acaba.
 *
 * O dia e a hora seguem o horário de Brasília.
 */

const TZ = 'America/Sao_Paulo';
const num = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
// O alerta de "suspensa" cobre tudo o que impede a campanha de aparecer; cada caso com o nome certo.
const STOPPED: Record<string, { title: string; text: string }> = {
  CONTA_SUSPENSA: { title: 'Conta do Google Ads suspensa', text: 'O Google suspendeu a conta. Nenhuma campanha dela aparece até a conta ser liberada.' },
  CONTA_ENCERRADA: { title: 'Conta do Google Ads encerrada', text: 'A conta foi cancelada ou encerrada. As campanhas dela não aparecem mais.' },
  SUSPENSA: { title: 'Campanha suspensa pelo Google', text: 'O Google parou de mostrar esta campanha.' },
  COM_ERRO: { title: 'Campanha com erro de configuração', text: 'Alguma configuração impede a campanha de aparecer.' },
  NAO_ELEGIVEL: { title: 'Campanha não está aparecendo', text: 'A campanha está ligada, mas o Google não está mostrando os anúncios. Ela não foi suspensa.' },
};

/** Erro da leitura do Google em português simples; o texto técnico não vai para o usuário. */
function syncProblem(raw: string) {
  if (/invalid_grant|expired|revoked/i.test(raw)) return 'A ligação com o Google venceu. Reconecte a conta em Integração.';
  if (/NOT_ENABLED|SUSPENDED|CANCELED|CLOSED|deactivated/i.test(raw)) return 'A conta não está ativa no Google Ads (suspensa, cancelada ou encerrada).';
  if (/PERMISSION|ACCESS|NOT_AUTHORIZED|authoriz/i.test(raw)) return 'O login ligado não tem mais acesso a esta conta no Google Ads.';
  if (/quota|RESOURCE_EXHAUSTED|rate/i.test(raw)) return 'O limite diário de consultas ao Google foi atingido. A leitura volta sozinha depois.';
  if (/timeout|timed out|ECONN|fetch failed|network/i.test(raw)) return 'O Google demorou demais para responder. A próxima leitura tenta de novo.';
  return 'O Google recusou a leitura desta conta. Abra Integração para ver o detalhe.';
}

const OUTCOME_PT: Record<string, string> = { melhorou: '✅ Melhorou', piorou: '🔻 Piorou', igual: '➖ Ficou igual' };

function nowIn(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || '00';
  const hour = Number(g('hour')) % 24;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hour, dayPart: (hour * 60 + Number(g('minute'))) / 1440 };
}
const ddmm = (d: string) => d.slice(5).split('-').reverse().join('/');

export async function runAlerts() {
  const report = { users: 0, sent: 0, quiet: 0, errors: [] as string[] };
  if (!telegramEnabled()) return report;
  const db = supabaseAdmin();
  const { data: links, error } = await db.from('telegram_links').select('*').eq('enabled', true).not('chat_id', 'is', null);
  if (error || !links?.length) return report;
  const now = nowIn(TZ);
  for (const link of links) {
    report.users++;
    const settings = resolveSettings(link.settings);
    if (isQuiet(settings, now.hour)) { report.quiet++; continue; }
    try {
      report.sent += await userAlerts(link, settings, now, report.errors);
    } catch (e: any) {
      report.errors.push(String(e.message).slice(0, 200));
    }
  }
  return report;
}

async function userAlerts(link: any, settings: AlertSettings, now: ReturnType<typeof nowIn>, errors: string[]) {
  const db = supabaseAdmin();
  const userId: string = link.user_id;
  const on = settings.alerts;
  const { day, hour, dayPart } = now;
  let sent = 0;

  /** Registra e envia; devolve false se esse aviso já saiu. */
  const notify = async (kind: string, key: string, productId: string | null, html: string, details: any = {}) => {
    let { error } = await db.from('alert_log').insert({ user_id: userId, product_id: productId, day, kind, key, details });
    // Antes de migration_telegram_alertas.sql a coluna "key" não existe: grava do jeito antigo.
    if (error && /key/.test(error.message) && error.code !== '23505' && productId) {
      ({ error } = await db.from('alert_log').insert({ user_id: userId, product_id: productId, day, kind, details }));
    }
    if (error) { if (error.code !== '23505') errors.push(`${kind}: ${error.message}`.slice(0, 200)); return false; }
    // Falha de envio não derruba os outros avisos do usuário.
    try { await sendTelegram(link.chat_id, html); sent++; }
    catch (e: any) { errors.push(`${kind}: ${e.message}`.slice(0, 200)); }
    return true;
  };
  const link_ = (id: string) => `<a href="${appUrl()}/products/${id}">Abrir a campanha</a>`;

  const products = await fetchAll((a, b) => db.from('products')
    .select('id, name, currency, status, google_status, google_status_reasons').eq('user_id', userId).range(a, b));
  if (!products.length) return 0;
  const byId = new Map(products.map(p => [p.id, p]));
  const ids = products.map(p => p.id);
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    rows.push(...await fetchAll((a, b) => db.from('daily_metrics')
      .select('product_id, date, cost, conversions, conversion_value, refunds, lost_budget:google_metrics->search_budget_lost_impression_share')
      .in('product_id', ids.slice(i, i + 150)).gte('date', addDays(day, -30)).lte('date', day).or('cost.gt.0,conversions.gt.0,refunds.gt.0').range(a, b)));
  }

  interface Camp { today: number; sales: number; revenue: number; refunds: number; past7: number; days7: number; cost3: number; sales3: number; sales30: number; revenue30: number; lostYesterday: number }
  const camps = new Map<string, Camp>();
  const d7 = addDays(day, -7), d3 = addDays(day, -3);
  for (const r of rows) {
    if (!camps.has(r.product_id)) camps.set(r.product_id, { today: 0, sales: 0, revenue: 0, refunds: 0, past7: 0, days7: 0, cost3: 0, sales3: 0, sales30: 0, revenue30: 0, lostYesterday: 0 });
    const c = camps.get(r.product_id)!;
    if (r.date === addDays(day, -1)) c.lostYesterday = num(r.lost_budget);
    const cost = num(r.cost), sales = num(r.conversions);
    c.sales30 += sales; c.revenue30 += num(r.conversion_value);
    if (r.date === day) { c.today += cost; c.sales += sales; c.revenue += num(r.conversion_value); c.refunds += num(r.refunds); continue; }
    if (r.date >= d7 && cost > 0) { c.past7 += cost; c.days7++; }
    if (r.date >= d3) { c.cost3 += cost; c.sales3 += sales; }
  }
  const allSales = [...camps.values()].reduce((s, c) => s + c.sales30, 0), allRevenue = [...camps.values()].reduce((s, c) => s + c.revenue30, 0);
  const userSale = allSales > 0 ? allRevenue / allSales : 0;

  // O que já foi avisado nos últimos dias (para o que não deve repetir todo dia).
  const { data: recent } = await db.from('alert_log').select('kind, product_id, day, details').eq('user_id', userId).gte('day', addDays(day, -14));
  const warned = (kind: string, productId: string, days: number) => (recent || []).some(r => r.kind === kind && r.product_id === productId && r.day >= addDays(day, -days));

  for (const [id, c] of camps) {
    const p = byId.get(id);
    if (!p) continue;
    const name = escapeHtml(String(p.name || ''));
    const money = (v: number) => formatMoney(v, p.currency);
    const salesToday = c.sales > 0 ? `${String(c.sales).replace('.', ',')} ${c.sales === 1 ? 'venda' : 'vendas'} hoje.` : 'Nenhuma venda hoje.';
    const status = resolveProductStatus(p);

    if (on.gasto.on) {
      const a = spendAlert(c.today, c.past7, c.days7, dayPart, on.gasto.mult, on.gasto.pace);
      if (a) {
        const line = a.kind === 'passou'
          ? `Já gastou <b>${money(c.today)}</b> hoje, ${Math.round((a.over - 1) * 100)}% acima de um dia normal (${money(a.normal)}).`
          : `Gastou <b>${money(c.today)}</b> até agora: no ritmo de fechar o dia em ${money(a.pace)}, contra ${money(a.normal)} de um dia normal.`;
        await notify(`gasto_${a.kind}`, id, id, `⚠️ <b>Gasto acima do normal</b>\n${name}\n\n${line}\n${salesToday}\n\n${link_(id)}`, { today: c.today, normal: a.normal });
      }
    }

    if (on.suspensa.on && status.key === 'suspenso' && (c.days7 > 0 || c.today > 0) && !warned('suspensa', id, 14)) {
      const stop = STOPPED[String(p.google_status || '').toUpperCase()] || STOPPED.SUSPENSA;
      const reasons = explainReasons(p.google_status_reasons);
      const why = reasons.length ? `\nMotivo informado pelo Google: ${reasons.join('; ')}.` : '';
      await notify('suspensa', id, id, `⛔ <b>${stop.title}</b>\n${name}\n\n${stop.text}${escapeHtml(why)}\n\n${link_(id)}`);
    }

    if (on.sem_venda.on && c.sales <= 0) {
      const sale = c.sales30 > 0 && c.revenue30 > 0 ? c.revenue30 / c.sales30 : userSale;
      if (sale > 0 && c.today >= sale * on.sem_venda.mult) {
        await notify('sem_venda', id, id, `💸 <b>Gasto sem venda hoje</b>\n${name}\n\nJá gastou <b>${money(c.today)}</b> hoje sem vender. Uma venda vale em média ${money(sale)}.\n\n${link_(id)}`, { today: c.today, sale });
      }
    }

    if (on.cpa.on && on.cpa.limit && c.sales3 > 0 && c.cost3 / c.sales3 > on.cpa.limit) {
      await notify('cpa', id, id, `📈 <b>CPA acima do limite</b>\n${name}\n\nCPA de <b>${money(c.cost3 / c.sales3)}</b> nos últimos 3 dias (${String(c.sales3).replace('.', ',')} vendas, ${money(c.cost3)} de custo). Seu limite é ${money(on.cpa.limit)}.\n\n${link_(id)}`);
    }

    if (on.venda.on && c.sales > 0) {
      // Avisa quando o total do dia sobe além do último avisado.
      const last = Math.max(0, ...(recent || []).filter(r => r.kind === 'venda' && r.product_id === id && r.day === day).map(r => num(r.details?.count)));
      if (c.sales > last) {
        const added = c.sales - last;
        await notify('venda', `${id}:${c.sales}`, id, `💰 <b>${added === 1 ? 'Venda nova' : `${String(added).replace('.', ',')} vendas novas`}</b>\n${name}\n\nHoje: ${String(c.sales).replace('.', ',')} ${c.sales === 1 ? 'venda' : 'vendas'}, ${money(c.revenue)} de receita e ${money(c.today)} de custo.`, { count: c.sales });
      }
    }

    // Campanha de centavos por dia (aquecimento) não conta: o normal dela precisa ser de pelo menos 5 por dia.
    if (on.primeira_venda.on && c.sales > 0 && c.sales30 === c.sales && !warned('primeira_venda', id, 14)) {
      await notify('primeira_venda', id, id, `🎉 <b>Primeira venda da campanha</b>\n${name}\n\nVendeu hoje pela primeira vez nos últimos 30 dias: ${String(c.sales).replace('.', ',')} ${c.sales === 1 ? 'venda' : 'vendas'}, ${money(c.revenue)} de receita, com ${money(c.today)} de custo no dia.\n\n${link_(id)}`);
    }

    if (on.reembolso.on && c.refunds > 0) {
      // Avisa quando o total de reembolso do dia sobe além do último avisado.
      const last = Math.max(0, ...(recent || []).filter(r => r.kind === 'reembolso' && r.product_id === id && r.day === day).map(r => num(r.details?.amount)));
      if (c.refunds > last + 0.005) {
        await notify('reembolso', `${id}:${Math.round(c.refunds * 100)}`, id, `↩️ <b>Reembolso registrado</b>\n${name}\n\nEntrou ${money(c.refunds - last)} de reembolso${last > 0 ? ` (${money(c.refunds)} no dia)` : ' hoje'}. Receita do dia: ${money(c.revenue)}.\n\n${link_(id)}`, { amount: c.refunds });
      }
    }

    if (on.orcamento.on && c.lostYesterday * 100 >= on.orcamento.lost && c.sales3 > 0 && !warned('orcamento', id, 7)) {
      const sale = c.sales30 > 0 && c.revenue30 > 0 ? c.revenue30 / c.sales30 : userSale;
      const cpa3 = c.cost3 / c.sales3;
      if (sale > 0 && cpa3 <= sale * 0.8) {
        await notify('orcamento', id, id, `📦 <b>Orçamento segurando campanha boa</b>\n${name}\n\nOntem ela deixou de aparecer em ${Math.round(c.lostYesterday * 100)}% das vezes por falta de orçamento. O CPA dos últimos 3 dias está em ${money(cpa3)}, e uma venda vale em média ${money(sale)}.\n\n${link_(id)}`, { lost: c.lostYesterday, cpa3 });
      }
    }

    if (on.parou.on && hour >= on.parou.hour && c.today <= 0 && c.days7 >= 5 && c.past7 / c.days7 >= 5 && status.key === 'ativo') {
      await notify('parou', id, id, `🛑 <b>Campanha parou de gastar</b>\n${name}\n\nGastou em ${c.days7} dos últimos 7 dias (média de ${money(c.past7 / c.days7)} por dia) e hoje ainda não gastou nada, mesmo ativa.\n\n${link_(id)}`);
    }
  }

  // ── Resultado de um ajuste: no dia em que sai a conferência de 3 ou de 7 dias ──
  if (on.ajuste.on) {
    for (const camp of await userChangeEvents(userId).catch(() => [])) {
      for (const e of camp.events) {
        const span = day === addDays(e.date, 8) ? 7 : day === addDays(e.date, 4) ? 3 : 0;
        if (!span || !OUTCOME_PT[e.outcome]) continue;
        const what = e.items.slice(0, 4).map(i => i.text).join(' · ') + (e.items.length > 4 ? ` · e mais ${e.items.length - 4}` : '');
        await notify('ajuste', `${camp.productId}:${e.date}:${span}`, camp.productId,
          `🔎 <b>Resultado do ajuste de ${ddmm(e.date)}</b> · ${OUTCOME_PT[e.outcome]}\n${escapeHtml(camp.name)}\n\n${escapeHtml(what)}\n\n${escapeHtml(e.text)}${e.mixed ? '\nHouve outra alteração dentro desses dias, então o efeito não é só desta.' : ''}\n\n${link_(camp.productId)}`);
      }
    }
  }

  // ── Resumo do dia, uma vez, a partir do horário escolhido ───────────────────
  if (on.resumo.on && hour >= on.resumo.hour) {
    const byCurrency = new Map<string, { cost: number; sales: number; revenue: number; refunds: number; n: number }>();
    for (const [id, c] of camps) {
      if (c.today <= 0 && c.sales <= 0) continue;
      const cur = String(byId.get(id)?.currency || 'BRL');
      if (!byCurrency.has(cur)) byCurrency.set(cur, { cost: 0, sales: 0, revenue: 0, refunds: 0, n: 0 });
      const t = byCurrency.get(cur)!;
      t.cost += c.today; t.sales += c.sales; t.revenue += c.revenue; t.refunds += c.refunds; t.n++;
    }
    if (byCurrency.size) {
      const lines = [...byCurrency].map(([cur, t]) => {
        const m = (v: number) => formatMoney(v, cur);
        const result = t.revenue - t.refunds - t.cost;
        return `${t.n} ${t.n === 1 ? 'campanha' : 'campanhas'} com gasto\nCusto: <b>${m(t.cost)}</b>\nVendas: <b>${String(t.sales).replace('.', ',')}</b> · receita ${m(t.revenue)}\nCPA: ${t.sales > 0 ? m(t.cost / t.sales) : 'sem venda'}\nResultado: <b>${result >= 0 ? '+' : '−'}${m(Math.abs(result))}</b>`;
      });
      await notify('resumo', 'dia', null, `📊 <b>Resumo de hoje, ${ddmm(day)}</b>\n\n${lines.join('\n\n')}\n\n<a href="${appUrl()}/dashboard">Abrir o painel</a>`);
    }
  }

  // ── Conta que deu erro na leitura do Google ────────────────────────────────
  if (on.coleta.on) {
    const { data: accounts } = await db.from('google_ads_accounts').select('id, name, last_sync_error').eq('user_id', userId).eq('sync_enabled', true).eq('last_sync_status', 'erro');
    for (const acc of accounts || []) {
      await notify('coleta', acc.id, null, `🔌 <b>Conta com erro na leitura do Google</b>\n${escapeHtml(String(acc.name || ''))}\n\n${syncProblem(String(acc.last_sync_error || ''))}\n\n<a href="${appUrl()}/integration">Abrir Integração</a>`);
    }
  }

  // ── Limite diário de consultas ao Google: só para a conta principal ─────────
  if (on.cota.on) {
    const { data: who } = await db.auth.admin.getUserById(userId).catch(() => ({ data: null as any }));
    if (isOwner(who?.user?.email)) {
      const used = await usageToday().catch(() => 0);
      const pct = DAILY_QUOTA > 0 ? (used / DAILY_QUOTA) * 100 : 0;
      if (pct >= on.cota.pct) {
        const n = (v: number) => v.toLocaleString('pt-BR');
        await notify('cota', 'dia', null, `📶 <b>Limite de consultas ao Google em ${Math.round(pct)}%</b>\n\nO Autometrics já usou ${n(used)} das ${n(DAILY_QUOTA)} consultas de hoje. Acima de 80%, a leitura detalhada das campanhas (termos, públicos, histórico) para; custo e status continuam. O limite zera de madrugada, por volta das 4h de Brasília.`);
      }
    }
  }
  return sent;
}
