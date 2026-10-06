import { supabaseAdmin } from '@/lib/googleAds/server';
import { MAIN_BLOCK, MAIN_BLOCK_NAME, blockOf, normalizeGroups, type CampaignGroup } from '@/lib/campaignGroups';
import { addDays, todayIn, fetchAll } from './compute';
import { audienceLabel, deviceLabel, formatMoney, keywordLabel } from './labels';
import { resolveProductStatus } from '@/lib/campaignStatus';

/**
 * Análise de IA entre campanhas parecidas — a parte dos números, sem IA.
 *
 * Junta as campanhas do usuário que têm a mesma marcação no nome ("[WL]",
 * "[MEM]"…) e mostra o que se repete nelas: os termos de pesquisa e as
 * palavras-chave que mais vendem, dispositivos, vídeo e o resultado de cada
 * campanha no período todo. Dá para olhar uma MCC só.
 *
 * Só as campanhas do próprio usuário entram. Os grupos do painel
 * (lib/campaignGroups) valem aqui também: por padrão só o bloco "Principais"
 * entra, para aquecimento e testes não misturarem com o resto.
 *
 * Vendas: da campanha são as vendas reais (postback ou lançamento), quando o
 * usuário tem alguma. Termo e dispositivo recebem essas vendas rateadas, campanha
 * por campanha — pelas conversões do Google do item ou, sem conversão, pelos
 * cliques. É o mesmo rateio "≈" da análise da campanha (compute.ts).
 */

export type PeriodKey = 'today' | 'd2' | 'd3' | 'd7' | 'all' | 'custom';
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'd2', label: '2 dias' },
  { key: 'd3', label: '3 dias' },
  { key: 'd7', label: '7 dias' },
  { key: 'all', label: 'Todo o período' },
  { key: 'custom', label: 'Personalizado' },
];

export type Verdict = 'manter' | 'ajustar' | 'pausar' | 'cedo';
export type Mark = 'funciona' | 'desperdicio' | 'atencao' | null;

const num = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round = (x: number) => Math.round(x * 100) / 100;
const cpaOf = (cost: number, sales: number) => (sales > 0 ? round(cost / sales) : null);

async function byChunks(ids: string[], build: (chunk: string[], from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    out.push(...await fetchAll((a, b) => build(chunk, a, b)));
  }
  return out;
}

const isDay = (v?: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const NO_MCC = 'Contas Individuais';

function periodRange(key: PeriodKey, today: string, from?: string, to?: string): [string | null, string] {
  if (key === 'custom') {
    // Datas trocadas ou no futuro são acertadas; sem data, vale 7 dias.
    if (!isDay(from) || !isDay(to)) return [addDays(today, -7), addDays(today, -1)];
    const a = from! <= to! ? from! : to!, b = from! <= to! ? to! : from!;
    return [a > today ? today : a, b > today ? today : b];
  }
  if (key === 'today') return [today, today];
  if (key === 'all') return [null, today];
  const days = key === 'd2' ? 2 : key === 'd3' ? 3 : 7;
  return [addDays(today, -days), addDays(today, -1)];
}

export interface PatternsOptions {
  /** Trecho que o nome da campanha precisa conter; vazio = todas. */
  tag: string;
  period: PeriodKey;
  /** Blocos do painel que entram (MAIN_BLOCK e ids dos grupos). */
  blocks: string[];
  /** Só as campanhas desta MCC (NO_MCC = contas sem MCC); vazio = todas. */
  mcc?: string;
  /** Período personalizado, AAAA-MM-DD. */
  from?: string;
  to?: string;
  /** Dados a mais para a IA responder perguntas: campanha a campanha, dia a dia, termos, idade, gênero e locais. */
  detail?: boolean;
}

export async function computePatterns(userId: string, opts: PatternsOptions) {
  const db = supabaseAdmin();
  const [allProducts, prefsRow] = await Promise.all([
    fetchAll((a, b) => db.from('products').select('id, name, currency, vturb_player_id, mcc_name, google_status, google_status_reasons, status').eq('user_id', userId).range(a, b)),
    db.from('user_ui_prefs').select('prefs').eq('user_id', userId).maybeSingle(),
  ]);
  const groups: CampaignGroup[] = normalizeGroups(prefsRow.data?.prefs?.campaignGroups).list;

  // ── MCCs: a escolhida vale para tudo o que vem depois, inclusive as opções ──
  const mccOf = (p: any) => (String(p.mcc_name || '').trim() ? String(p.mcc_name).trim() : NO_MCC);
  const mccCount = new Map<string, number>();
  for (const p of allProducts) mccCount.set(mccOf(p), (mccCount.get(mccOf(p)) || 0) + 1);
  const mccs = [...mccCount].sort((a, b) => (a[0] === NO_MCC ? 1 : b[0] === NO_MCC ? -1 : b[1] - a[1])).map(([name, count]) => ({ name, count }));
  const mcc = opts.mcc && mccCount.has(opts.mcc) ? opts.mcc : '';
  const products = mcc ? allProducts.filter(p => mccOf(p) === mcc) : allProducts;

  // ── Opções da tela: marcações entre colchetes que se repetem e os blocos ──
  const groupTerms = new Set(groups.flatMap(g => g.terms.map(t => t.toUpperCase())));
  const tagCount = new Map<string, number>();
  const blockCount = new Map<string, number>();
  for (const p of products) {
    const name = String(p.name || '');
    blockCount.set(blockOf(name, groups), (blockCount.get(blockOf(name, groups)) || 0) + 1);
    for (const t of new Set((name.match(/\[[^\]]{1,24}\]/g) || []).map(s => s.toUpperCase()))) {
      if (!groupTerms.has(t)) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }
  }
  const tags = [...tagCount].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tag, count]) => ({ tag, count }));
  const blockOptions = [MAIN_BLOCK, ...groups.map(g => g.id)].map(id => ({
    id, name: id === MAIN_BLOCK ? MAIN_BLOCK_NAME : groups.find(g => g.id === id)!.name, count: blockCount.get(id) || 0,
  }));

  // ── Campanhas do conjunto ────────────────────────────────────────────────
  const wanted = new Set(opts.blocks.length ? opts.blocks : [MAIN_BLOCK]);
  const tag = opts.tag.trim().toLowerCase();
  const matching = products.filter(p => {
    const name = String(p.name || '');
    return (!tag || name.toLowerCase().includes(tag)) && wanted.has(blockOf(name, groups));
  });
  // Uma moeda só: somar dólar com real daria um número sem sentido.
  const byCurrency = new Map<string, number>();
  for (const p of matching) byCurrency.set(p.currency || 'BRL', (byCurrency.get(p.currency || 'BRL') || 0) + 1);
  const currency = [...byCurrency].sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';
  const set = matching.filter(p => (p.currency || 'BRL') === currency);
  const otherCurrency = matching.length - set.length;
  const ids = set.map(p => p.id);
  const nameOf = new Map(set.map(p => [p.id, String(p.name || '')]));
  const productOf = new Map(set.map(p => [p.id, p]));

  const today = todayIn('America/Sao_Paulo');
  const [from, to] = periodRange(opts.period, today, opts.from, opts.to);
  const inPeriod = (date: string) => (!from || date >= from) && date <= to;
  const money = (v: number) => formatMoney(v, currency);
  const base = {
    options: { tags, blocks: blockOptions, mccs },
    mcc,
    period: { key: opts.period, from, to, today },
    currency, other_currency: otherCurrency, set_size: set.length,
  };
  if (!ids.length) return { ...base, empty: true as const };

  // ── Dias de cada campanha (a vida inteira, para o veredito) ──────────────
  const days = await byChunks(ids, (chunk, a, b) => db.from('daily_metrics')
    .select('product_id, date, cost, clicks, conversions, google_conversions, conversion_value, refunds')
    .in('product_id', chunk).lte('date', today).order('date').range(a, b));
  const hasReal = days.some(d => num(d.conversions) > 0);
  const salesOf = (d: any) => num(hasReal ? d.conversions : d.google_conversions);

  interface Camp { cost: number; sales: number; revenue: number; refunds: number; clicks: number }
  const zero = (): Camp => ({ cost: 0, sales: 0, revenue: 0, refunds: 0, clicks: 0 });
  const add = (c: Camp, d: any) => { c.cost += num(d.cost); c.sales += salesOf(d); c.revenue += num(d.conversion_value); c.refunds += num(d.refunds); c.clicks += num(d.clicks); };
  const result = (c: Camp) => round(c.revenue - c.refunds - c.cost);

  const d7from = addDays(today, -7), d7to = addDays(today, -1);
  const life = new Map<string, Camp & { first: string; activeDays: number }>();
  const inWindow = new Map<string, Camp>();
  const last7 = new Map<string, Camp>();
  for (const d of days) {
    if (!life.has(d.product_id)) life.set(d.product_id, { ...zero(), first: d.date, activeDays: 0 });
    const l = life.get(d.product_id)!;
    add(l, d);
    if (num(d.cost) > 0) l.activeDays++;
    if (inPeriod(d.date)) { if (!inWindow.has(d.product_id)) inWindow.set(d.product_id, zero()); add(inWindow.get(d.product_id)!, d); }
    if (d.date >= d7from && d.date <= d7to) { if (!last7.has(d.product_id)) last7.set(d.product_id, zero()); add(last7.get(d.product_id)!, d); }
  }

  const total = zero();
  let active = 0;
  for (const c of inWindow.values()) {
    if (c.cost <= 0 && c.sales <= 0) continue;
    if (c.cost > 0) active++;
    total.cost += c.cost; total.sales += c.sales; total.revenue += c.revenue; total.refunds += c.refunds; total.clicks += c.clicks;
  }
  const totals = {
    campaigns: active, cost: round(total.cost), sales: round(total.sales), cpa: cpaOf(total.cost, total.sales),
    revenue: round(total.revenue), result: hasReal ? result(total) : null,
  };

  // ── Vale a pena manter? — campanhas com gasto nos últimos 7 dias ou hoje ──
  const lifeTotal = zero();
  for (const l of life.values()) add(lifeTotal, { cost: l.cost, conversions: l.sales, google_conversions: l.sales, conversion_value: l.revenue, refunds: l.refunds, clicks: l.clicks });
  const groupSale = lifeTotal.sales > 0 && lifeTotal.revenue > 0 ? lifeTotal.revenue / lifeTotal.sales : 0;
  const todayCost = new Map<string, number>();
  for (const d of days) if (d.date === today) todayCost.set(d.product_id, num(d.cost));

  const verdicts = [...life].map(([id, l]) => {
    const w = last7.get(id) || zero();
    if (w.cost <= 0 && !(todayCost.get(id)! > 0)) return null;
    const sale = l.sales > 0 && l.revenue > 0 ? l.revenue / l.sales : groupSale;
    const lifeResult = result(l), weekResult = result(w);
    let verdict: Verdict, reason: string;
    if (!hasReal || !sale) {
      verdict = 'cedo'; reason = 'Sem venda registrada para calcular o resultado.';
    } else if (l.cost < sale * 2 && l.sales < 3) {
      verdict = 'cedo'; reason = `Gastou ${money(l.cost)} até agora, menos que o valor de duas vendas (${money(sale * 2)}).`;
    } else if (lifeResult >= 0 && weekResult >= 0) {
      verdict = 'manter'; reason = `Lucro de ${money(lifeResult)} no período todo e de ${money(weekResult)} nos últimos 7 dias.`;
    } else if (lifeResult >= 0) {
      verdict = 'ajustar'; reason = `Lucro de ${money(lifeResult)} no período todo, mas prejuízo de ${money(-weekResult)} nos últimos 7 dias.`;
    } else if (weekResult > 0) {
      verdict = 'ajustar'; reason = `Prejuízo de ${money(-lifeResult)} no período todo, mas lucro de ${money(weekResult)} nos últimos 7 dias.`;
    } else {
      verdict = 'pausar'; reason = `Prejuízo de ${money(-lifeResult)} no período todo e de ${money(-weekResult)} nos últimos 7 dias.`;
    }
    // Estado atual da campanha (ativa, pausada, conta suspensa), o mesmo do painel.
    const st = resolveProductStatus(productOf.get(id) || {});
    return {
      id, name: nameOf.get(id) || '', since: l.first, days: l.activeDays,
      status: { key: st.key, label: st.label, badge: st.badge, dot: st.dot, hint: st.hint },
      cost: round(l.cost), sales: round(l.sales), cpa: cpaOf(l.cost, l.sales), result: hasReal ? lifeResult : null,
      cost7: round(w.cost), sales7: round(w.sales), cpa7: cpaOf(w.cost, w.sales), result7: hasReal ? weekResult : null,
      verdict, reason,
    };
  }).filter((v): v is NonNullable<typeof v> => !!v).sort((a, b) => b.cost7 - a.cost7);

  // ── Termos e dispositivos do período ─────────────────────────────────────
  const ranged = (q: any) => (from ? q.gte('date', from) : q).lte('date', to);
  const [terms, devices, vturb] = await Promise.all([
    byChunks(ids, (chunk, a, b) => ranged(db.from('search_terms').select('product_id, date, search_term, keyword, keyword_match_type, cost, clicks, conversions').in('product_id', chunk)).gt('cost', 0).range(a, b)),
    byChunks(ids, (chunk, a, b) => ranged(db.from('audiences').select('product_id, date, audience_name, cost, clicks, conversions').in('product_id', chunk).eq('audience_type', 'Device')).range(a, b)),
    byChunks(ids, (chunk, a, b) => ranged(db.from('vturb_daily').select('product_id, over_pitch, under_pitch').in('product_id', chunk)).range(a, b)).catch(() => []),
  ]);

  // Linha com custo impossível para um dia (há registros antigos gravados em
  // outra unidade): fica de fora para não distorcer a soma.
  const sane = (r: any) => num(r.cost) <= 20000;
  // Vendas reais de cada campanha, dia a dia, rateadas entre as linhas daquele
  // dia. Dia sem linha (termo não informado pelo Google) não entra na conta.
  const salesByDay = new Map<string, number>();
  for (const d of days) if (inPeriod(d.date)) salesByDay.set(`${d.product_id}|${d.date}`, salesOf(d));
  const shareSales = (rows: any[]) => {
    if (!hasReal) return;
    const sum = new Map<string, { conv: number; clicks: number }>();
    const key = (r: any) => `${r.product_id}|${r.date}`;
    for (const r of rows) {
      if (!sum.has(key(r))) sum.set(key(r), { conv: 0, clicks: 0 });
      const t = sum.get(key(r))!;
      t.conv += num(r.conversions); t.clicks += num(r.clicks);
    }
    for (const r of rows) {
      const t = sum.get(key(r))!, sales = salesByDay.get(key(r)) || 0;
      const part = sales * (t.conv > 0 ? num(r.conversions) / t.conv : t.clicks > 0 ? num(r.clicks) / t.clicks : 0);
      // Uma linha não pode ter mais venda do que clique: o que passar disso fica sem dono.
      r.conversions = Math.min(part, num(r.clicks));
    }
  };
  const termRowsIn = terms.filter(sane), deviceRowsIn = devices.filter(sane);
  shareSales(termRowsIn);
  shareSales(deviceRowsIn);

  // ── Dados a mais, só para as perguntas à IA ──────────────────────────────
  let detail: any = null;
  if (opts.detail) {
    const [people, places] = await Promise.all([
      byChunks(ids, (chunk, a, b) => ranged(db.from('audiences').select('product_id, date, audience_type, audience_name, cost, clicks, conversions').in('product_id', chunk).in('audience_type', ['Age', 'Gender'])).range(a, b)),
      byChunks(ids, (chunk, a, b) => ranged(db.from('locations').select('product_id, date, location_name, cost, clicks, conversions').in('product_id', chunk)).range(a, b)),
    ]);
    const ages = people.filter(r => r.audience_type === 'Age' && sane(r)), genders = people.filter(r => r.audience_type === 'Gender' && sane(r)), locs = places.filter(sane);
    [ages, genders, locs].forEach(shareSales);
    const group = (rows: any[], nameOfRow: (r: any) => string, limit: number) => {
      const m = new Map<string, { cost: number; conv: number; campaigns: Set<string> }>();
      for (const r of rows) {
        const k = nameOfRow(r);
        if (!m.has(k)) m.set(k, { cost: 0, conv: 0, campaigns: new Set() });
        const a = m.get(k)!;
        a.cost += num(r.cost); a.conv += num(r.conversions); a.campaigns.add(r.product_id);
      }
      return [...m].filter(([, a]) => a.cost > 0).sort((a, b) => b[1].cost - a[1].cost).slice(0, limit)
        .map(([text, a]) => ({ text, campaigns: a.campaigns.size, cost: round(a.cost), conv: round(a.conv), cpa: cpaOf(a.cost, a.conv) }));
    };
    // Dia a dia; no período todo, mês a mês.
    const monthly = !from || (Date.parse(to) - Date.parse(from)) / 86400000 > 45;
    const bucket = (date: string) => (monthly ? date.slice(0, 7) : date);
    const series = new Map<string, Camp>();
    for (const d of days) {
      if (!inPeriod(d.date)) continue;
      if (!series.has(bucket(d.date))) series.set(bucket(d.date), zero());
      add(series.get(bucket(d.date))!, d);
    }
    detail = {
      monthly,
      campaigns: [...inWindow].filter(([, c]) => c.cost > 0).sort((a, b) => b[1].cost - a[1].cost).slice(0, 50)
        .map(([id, c]) => ({ name: nameOf.get(id) || '', cost: round(c.cost), sales: round(c.sales), cpa: cpaOf(c.cost, c.sales), clicks: c.clicks, result: hasReal ? result(c) : null })),
      series: [...series].sort((a, b) => a[0].localeCompare(b[0])).slice(-36)
        .map(([when, c]) => ({ when, cost: round(c.cost), sales: round(c.sales), cpa: cpaOf(c.cost, c.sales), result: hasReal ? result(c) : null })),
      terms: group(termRowsIn, r => String(r.search_term || ''), 40),
      ages: group(ages, r => audienceLabel('Age', String(r.audience_name || '')), 10),
      genders: group(genders, r => audienceLabel('Gender', String(r.audience_name || '')), 5),
      locations: group(locs, r => String(r.location_name || ''), 15),
    };
  }

  interface Agg { cost: number; conv: number; clicks: number; campaigns: Set<string> }
  const bump = (map: Map<string, Agg>, key: string, t: any) => {
    if (!map.has(key)) map.set(key, { cost: 0, conv: 0, clicks: 0, campaigns: new Set() });
    const a = map.get(key)!;
    a.cost += num(t.cost); a.conv += num(t.conversions); a.clicks += num(t.clicks); a.campaigns.add(t.product_id);
  };
  // Termo inteiro e palavra-chave inteira, como estão no Google: é o que dá
  // para copiar e usar em outra campanha.
  const byTerm = new Map<string, Agg>();
  const byKeyword = new Map<string, Agg>();
  let termCost = 0, termConv = 0;
  for (const t of termRowsIn) {
    termCost += num(t.cost); termConv += num(t.conversions);
    const term = String(t.search_term || '').trim().toLowerCase();
    if (term) bump(byTerm, term, t);
    if (t.keyword) bump(byKeyword, keywordLabel(String(t.keyword).trim().toLowerCase(), t.keyword_match_type), t);
  }
  const termCpa = cpaOf(termCost, termConv);
  const mark = (cost: number, conv: number, ref: number | null): Mark => {
    if (!ref) return null;
    // Venda quase de graça é sobra do rateio, não padrão: precisa ter gasto de verdade.
    if (conv >= 2 && cost >= ref * 0.5 && cost / conv <= ref * 0.8) return 'funciona';
    if (conv <= 0 && cost >= ref) return 'desperdicio';
    if (conv > 0 && cost / conv >= ref * 1.25) return 'atencao';
    return null;
  };
  const termCampaigns = new Set(termRowsIn.map(t => t.product_id)).size;
  const toRow = ([text, a]: [string, Agg]) => ({ text, campaigns: a.campaigns.size, cost: round(a.cost), clicks: a.clicks, conv: round(a.conv), cpa: cpaOf(a.cost, a.conv), mark: mark(a.cost, a.conv, termCpa) });
  // Melhores: os que mais venderam; no empate, o de menor CPA.
  const best = (map: Map<string, Agg>, limit: number) => [...map].filter(([, a]) => a.conv >= 0.5)
    .sort((a, b) => b[1].conv - a[1].conv || a[1].cost / a[1].conv - b[1].cost / b[1].conv).slice(0, limit).map(toRow);
  const waste = (map: Map<string, Agg>, limit: number) => [...map].filter(([, a]) => a.conv <= 0 && a.cost > 0)
    .sort((a, b) => b[1].cost - a[1].cost).slice(0, limit).map(toRow);
  const terms_best = best(byTerm, 15), terms_waste = waste(byTerm, 8);
  const keywords_best = best(byKeyword, 15), keywords_waste = waste(byKeyword, 8);

  const dev = new Map<string, Agg>();
  for (const d of deviceRowsIn) bump(dev, String(d.audience_name || ''), d);
  const devCost = [...dev.values()].reduce((s, a) => s + a.cost, 0), devConv = [...dev.values()].reduce((s, a) => s + a.conv, 0);
  const devCpa = cpaOf(devCost, devConv);
  const deviceRows = [...dev].filter(([, a]) => a.cost > 0).sort((a, b) => b[1].cost - a[1].cost).map(([code, a]) => ({
    text: deviceLabel(code), campaigns: a.campaigns.size, cost: round(a.cost), conv: round(a.conv), cpa: cpaOf(a.cost, a.conv),
    share: devCost > 0 ? a.cost / devCost : 0, mark: mark(a.cost, a.conv, devCpa),
  }));

  // ── Vídeo: quem chega à oferta × CPA da campanha ─────────────────────────
  const pitch = new Map<string, { over: number; base: number }>();
  for (const v of vturb) {
    if (!pitch.has(v.product_id)) pitch.set(v.product_id, { over: 0, base: 0 });
    const p = pitch.get(v.product_id)!;
    p.over += num(v.over_pitch); p.base += num(v.over_pitch) + num(v.under_pitch);
  }
  const buckets = [
    { label: 'Acima de 25%', min: 0.25, max: Infinity }, { label: 'De 15% a 25%', min: 0.15, max: 0.25 }, { label: 'Abaixo de 15%', min: -1, max: 0.15 },
  ].map(b => ({ ...b, campaigns: 0, cost: 0, sales: 0 }));
  let withVideo = 0;
  for (const [id, p] of pitch) {
    if (p.base <= 0) continue;
    withVideo++;
    const rate = p.over / p.base, c = inWindow.get(id) || zero();
    const b = buckets.find(x => rate >= x.min && rate < x.max)!;
    b.campaigns++; b.cost += c.cost; b.sales += c.sales;
  }
  const video = {
    rows: buckets.map(b => ({ label: b.label, campaigns: b.campaigns, cost: round(b.cost), cpa: cpaOf(b.cost, b.sales) })),
    without: Math.max(0, active - withVideo),
  };

  // ── O que se repete: frases montadas pelo código (a IA não mexe em número) ─
  const highlights: { mark: Exclude<Mark, null>; text: string }[] = [];
  const inCampaigns = (n: number) => (n === 1 ? 'em 1 campanha' : `em ${n} campanhas`);
  const sales = (v: number) => `${hasReal ? '≈ ' : ''}${(Math.round(v * 10) / 10).toLocaleString('pt-BR')} ${v === 1 ? 'venda' : 'vendas'}`;
  for (const r of terms_best.filter(r => r.mark === 'funciona').slice(0, 2)) {
    highlights.push({ mark: 'funciona', text: `Termo "${r.text}": ${sales(r.conv)} com CPA de ${money(r.cpa!)}, ${Math.round((1 - r.cpa! / termCpa!) * 100)}% abaixo da média dos termos, ${inCampaigns(r.campaigns)}.` });
  }
  for (const r of keywords_best.filter(r => r.mark === 'funciona').slice(0, 1)) {
    highlights.push({ mark: 'funciona', text: `Palavra-chave ${r.text}: ${sales(r.conv)} com CPA de ${money(r.cpa!)}, ${inCampaigns(r.campaigns)}.` });
  }
  for (const r of terms_waste.filter(r => r.mark === 'desperdicio').slice(0, 2)) {
    highlights.push({ mark: 'desperdicio', text: `Termo "${r.text}": ${money(r.cost)} gastos sem venda, ${inCampaigns(r.campaigns)}.` });
  }
  const strong = deviceRows.filter(r => r.conv >= 2 && r.cpa !== null).sort((a, b) => a.cpa! - b.cpa!);
  if (strong.length >= 2 && strong[strong.length - 1].cpa! >= strong[0].cpa! * 1.25) {
    const best = strong[0], worstDev = strong[strong.length - 1];
    highlights.push({ mark: 'atencao', text: `${worstDev.text}: CPA de ${money(worstDev.cpa!)}, ${Math.round((worstDev.cpa! / best.cpa! - 1) * 100)}% acima de ${best.text} (${money(best.cpa!)}).` });
  }
  const counts = { manter: 0, ajustar: 0, pausar: 0, cedo: 0 };
  for (const v of verdicts) counts[v.verdict]++;

  return {
    ...base, empty: false as const,
    sales_source: hasReal ? 'real' as const : 'google' as const,
    totals, highlights,
    // Com vendas reais, as vendas de termo e dispositivo são rateadas (≈).
    approx: hasReal,
    terms_best, terms_waste, keywords_best, keywords_waste, term_cpa: termCpa, term_campaigns: termCampaigns,
    devices: deviceRows, video,
    verdicts: verdicts.slice(0, 80), verdict_counts: counts,
    detail,
  };
}

export type Patterns = Awaited<ReturnType<typeof computePatterns>>;
