import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll, addDays, todayIn, computeAnalysis } from '@/lib/analysis/compute';
import { computePatterns, type PeriodKey } from '@/lib/analysis/patterns';
import { resolveProductStatus } from '@/lib/campaignStatus';
import { normalizeLocations } from '@/lib/geoNames';
import { loadTrackedSales } from '@/lib/tracking/trackedSales';
import { listEvents } from '@/lib/tracking/lists';
import { adGroupKey, adKey, countryKey, deviceKey, keywordKey, type KeyOf } from '@/lib/metrics/itemSales';

/**
 * Ferramentas do MCP do Autometrics — só leitura. Cada uma recebe o usuário
 * dono da chave e só enxerga as campanhas dele.
 *
 * Números com as regras do painel: lucro = receita − reembolso − custo, na
 * moeda da campanha; vendas são as reais (postback e lançamento manual); por
 * item, só a venda ligada ao clique, inteira, sem rateio.
 */

type Args = Record<string, any>;
interface Ctx { db: SupabaseClient; userId: string }

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  run: (ctx: Ctx, args: Args) => Promise<any>;
}

/** Erro que vira resposta para o Claude (não é falha do servidor). */
export class UserError extends Error {}

const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const div = (a: number, b: number) => (b ? r2(a / b) : null);

// ── Período ──────────────────────────────────────────────────────────────
const PERIOD_SCHEMA = {
  periodo: { type: 'string', enum: ['hoje', 'ontem', '3d', '7d', '14d', '30d', '90d', 'personalizado'], description: 'Período. "7d" = últimos 7 dias contando hoje. Padrão: 7d.' },
  de: { type: 'string', description: 'Início no formato AAAA-MM-DD (só com periodo "personalizado").' },
  ate: { type: 'string', description: 'Fim no formato AAAA-MM-DD (só com periodo "personalizado").' },
};
const isDay = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function period(args: Args): { from: string; to: string } {
  const today = todayIn('America/Sao_Paulo');
  const p = String(args.periodo || '7d');
  if (p === 'personalizado' || (isDay(args.de) && isDay(args.ate))) {
    if (!isDay(args.de) || !isDay(args.ate)) throw new UserError('Informe "de" e "ate" no formato AAAA-MM-DD.');
    let [from, to] = [args.de, args.ate];
    if (from > to) [from, to] = [to, from];
    if (Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new UserError('Escolha um período de até 1 ano.');
    return { from, to };
  }
  if (p === 'hoje') return { from: today, to: today };
  if (p === 'ontem') { const d = addDays(today, -1); return { from: d, to: d }; }
  const n = Number(p.replace('d', '')) || 7;
  return { from: addDays(today, -(n - 1)), to: today };
}

// ── Campanhas ────────────────────────────────────────────────────────────
const PRODUCT_COLS = 'id, name, google_ads_campaign_name, currency, status, google_status, google_status_reasons, mcc_name, account_name';
const nameOf = (p: any) => String(p.google_ads_campaign_name || p.name || '');

async function products(ctx: Ctx) {
  return fetchAll((a, b) => ctx.db.from('products').select(PRODUCT_COLS).eq('user_id', ctx.userId).order('name').range(a, b));
}

/** Uma campanha pelo id ou por um trecho do nome. Várias parecidas: pede para escolher. */
async function oneCampaign(ctx: Ctx, query: any) {
  const q = String(query || '').trim();
  if (!q) throw new UserError('Informe a campanha (id ou parte do nome). Use a ferramenta "campanhas" para ver a lista.');
  const all = await products(ctx);
  const byId = all.find(p => p.id === q);
  if (byId) return byId;
  const low = q.toLowerCase();
  const exact = all.filter(p => nameOf(p).toLowerCase() === low || String(p.name || '').toLowerCase() === low);
  if (exact.length === 1) return exact[0];
  const found = all.filter(p => nameOf(p).toLowerCase().includes(low) || String(p.name || '').toLowerCase().includes(low));
  if (found.length === 1) return found[0];
  if (!found.length) throw new UserError(`Nenhuma campanha com "${q}" no nome.`);
  throw new UserError(`${found.length} campanhas com "${q}" no nome. Escolha uma pelo id:\n${found.slice(0, 15).map(p => `- ${p.id} · ${nameOf(p)}`).join('\n')}`);
}

function totalsOf(rows: any[]) {
  const t = { custo: 0, vendas: 0, receita: 0, reembolso: 0, cliques: 0, impressoes: 0, conversoes_google: 0, checkouts: 0 };
  for (const d of rows) {
    t.custo += num(d.cost); t.vendas += num(d.conversions); t.receita += num(d.conversion_value); t.reembolso += num(d.refunds);
    t.cliques += num(d.clicks); t.impressoes += num(d.impressions); t.conversoes_google += num(d.google_conversions); t.checkouts += num(d.checkouts);
  }
  const lucro = t.receita - t.reembolso - t.custo;
  return {
    custo: r2(t.custo), vendas: t.vendas, receita: r2(t.receita), reembolso: r2(t.reembolso), lucro: r2(lucro),
    roi_pct: t.custo ? r2((lucro / t.custo) * 100) : null, cpa: div(t.custo, t.vendas),
    cliques: t.cliques, impressoes: t.impressoes, ctr_pct: t.impressoes ? r2((t.cliques / t.impressoes) * 100) : null,
    cpc: div(t.custo, t.cliques), conversoes_google: r2(t.conversoes_google), checkouts: t.checkouts,
  };
}

const METRIC_COLS = 'product_id, date, cost, clicks, impressions, conversions, conversion_value, refunds, google_conversions, checkouts, currency, campaign_status, target_cpa, budget_micros';

async function dailyRows(ctx: Ctx, ids: string[], from: string, to: string) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    out.push(...await fetchAll((a, b) => ctx.db.from('daily_metrics').select(METRIC_COLS)
      .in('product_id', chunk).gte('date', from).lte('date', to).order('date').range(a, b)));
  }
  return out;
}

const campanhas: Tool = {
  name: 'campanhas',
  description: 'Lista as campanhas do Autometrics com o resultado no período: custo, vendas reais, receita, reembolso, lucro, ROI, CPA, cliques e conversões do Google, e o status (ativa, pausada, suspensa). Valores na moeda de cada campanha; o total sai separado por moeda. Use primeiro para achar o id de uma campanha.',
  inputSchema: {
    type: 'object',
    properties: {
      ...PERIOD_SCHEMA,
      busca: { type: 'string', description: 'Trecho do nome para filtrar (ex.: "[WL]", "ALKAMELT").' },
      mcc: { type: 'string', description: 'Só as campanhas desta MCC.' },
      incluir_sem_gasto: { type: 'boolean', description: 'Também as campanhas sem custo nem venda no período. Padrão: false.' },
      ordenar_por: { type: 'string', enum: ['custo', 'lucro', 'vendas', 'cpa', 'nome'], description: 'Padrão: custo.' },
    },
  },
  async run(ctx, args) {
    const { from, to } = period(args);
    const busca = String(args.busca || '').trim().toLowerCase();
    const mcc = String(args.mcc || '').trim().toLowerCase();
    const list = (await products(ctx))
      .filter(p => !busca || nameOf(p).toLowerCase().includes(busca) || String(p.name || '').toLowerCase().includes(busca))
      .filter(p => !mcc || String(p.mcc_name || '').toLowerCase().includes(mcc));
    const rows = await dailyRows(ctx, list.map(p => p.id), from, to);
    const byProduct = new Map<string, any[]>();
    for (const r of rows) { if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []); byProduct.get(r.product_id)!.push(r); }
    let out = list.map(p => {
      const days = byProduct.get(p.id) || [];
      const latest = days[days.length - 1];
      const st = resolveProductStatus({ ...p, latest_campaign_status: latest?.campaign_status });
      return { id: p.id, nome: nameOf(p), mcc: p.mcc_name || null, conta: p.account_name || null, status: st.label, moeda: (latest?.currency || p.currency || 'BRL').toUpperCase(), ...totalsOf(days) };
    });
    if (!args.incluir_sem_gasto) out = out.filter(c => c.custo > 0 || c.vendas > 0);
    const key = String(args.ordenar_por || 'custo');
    out.sort((a: any, b: any) => key === 'nome' ? a.nome.localeCompare(b.nome)
      : key === 'cpa' ? (a.cpa ?? Infinity) - (b.cpa ?? Infinity) : num(b[key === 'vendas' ? 'vendas' : key]) - num(a[key === 'vendas' ? 'vendas' : key]));
    const totals: Record<string, any> = {};
    for (const cur of new Set(out.map(c => c.moeda))) {
      totals[cur] = totalsOf(out.filter(c => c.moeda === cur).map(c => ({ cost: c.custo, conversions: c.vendas, conversion_value: c.receita, refunds: c.reembolso, clicks: c.cliques, impressions: c.impressoes, google_conversions: c.conversoes_google, checkouts: c.checkouts })));
    }
    return { periodo: { de: from, ate: to }, campanhas: out.length, total_por_moeda: totals, lista: out.slice(0, 150) };
  },
};

const campanhaDiaADia: Tool = {
  name: 'campanha_dia_a_dia',
  description: 'Resultado de uma campanha dia a dia no período (custo, vendas reais, receita, lucro, CPA, cliques, conversões do Google, meta de CPA e orçamento), com o total.',
  inputSchema: {
    type: 'object',
    properties: { campanha: { type: 'string', description: 'Id ou trecho do nome da campanha.' }, ...PERIOD_SCHEMA },
    required: ['campanha'],
  },
  async run(ctx, args) {
    const p = await oneCampaign(ctx, args.campanha);
    const { from, to } = period(args);
    const rows = await dailyRows(ctx, [p.id], from, to);
    return {
      campanha: nameOf(p), id: p.id, moeda: (rows[rows.length - 1]?.currency || p.currency || 'BRL').toUpperCase(),
      periodo: { de: from, ate: to }, total: totalsOf(rows),
      dias: rows.map(d => ({ dia: d.date, ...totalsOf([d]), meta_cpa: num(d.target_cpa) || null, orcamento_dia: num(d.budget_micros) ? r2(num(d.budget_micros) / 1e6) : null })),
    };
  },
};

// ── Vendas por item ──────────────────────────────────────────────────────
type Level = 'grupo' | 'anuncio' | 'palavra_chave' | 'dispositivo' | 'pais' | 'termo';
const ENTITY_LEVEL: Record<string, string> = { grupo: 'ad_group', anuncio: 'ad', palavra_chave: 'keyword' };
const DEVICE_PT: Record<string, string> = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet', CONNECTED_TV: 'TV conectada', OTHER: 'Outros' };
const MATCH_PT: Record<string, string> = { EXACT: 'exata', PHRASE: 'frase', BROAD: 'ampla' };

const vendasPorItem: Tool = {
  name: 'vendas_por_item',
  description: 'Uma campanha quebrada por grupo, anúncio, palavra-chave, dispositivo, país ou termo de pesquisa: custo, cliques, conversões do Google e as vendas reais exatas de cada linha (só a venda ligada ao clique, inteira, sem rateio). O termo de pesquisa não vem no clique: nele "vendas" fica null e vale a conversão do Google. Diz também quantas vendas da campanha não trouxeram o dado e por isso não aparecem nas linhas.',
  inputSchema: {
    type: 'object',
    properties: {
      campanha: { type: 'string', description: 'Id ou trecho do nome da campanha.' },
      nivel: { type: 'string', enum: ['grupo', 'anuncio', 'palavra_chave', 'dispositivo', 'pais', 'termo'] },
      ...PERIOD_SCHEMA,
      limite: { type: 'number', description: 'Quantas linhas, pelas de maior custo. Padrão: 30, máximo 200.' },
    },
    required: ['campanha', 'nivel'],
  },
  async run(ctx, args) {
    const p = await oneCampaign(ctx, args.campanha);
    const level = String(args.nivel) as Level;
    if (!['grupo', 'anuncio', 'palavra_chave', 'dispositivo', 'pais', 'termo'].includes(level)) throw new UserError('Nível inválido.');
    const { from, to } = period(args);
    const limit = Math.min(200, Math.max(1, Number(args.limite) || 30));
    const db = ctx.db;
    const ranged = (q: any) => q.eq('product_id', p.id).gte('date', from).lte('date', to);

    const rows = new Map<string, { nome: string; extra?: Record<string, any>; custo: number; cliques: number; impressoes: number; conversoes_google: number }>();
    const bump = (k: string, nome: string, r: any, extra?: Record<string, any>) => {
      const cur = rows.get(k) || { nome, extra, custo: 0, cliques: 0, impressoes: 0, conversoes_google: 0 };
      cur.custo += num(r.cost); cur.cliques += num(r.clicks); cur.impressoes += num(r.impressions);
      cur.conversoes_google += num(r.google_metrics?.conversions ?? r.conversions);
      rows.set(k, cur);
    };
    let keyOf: KeyOf | null = null;

    if (ENTITY_LEVEL[level]) {
      const lv = ENTITY_LEVEL[level];
      const [ents, mets] = await Promise.all([
        fetchAll((a, b) => db.from('google_ads_entities').select('level, entity_id, ad_group_id, name, status, details').eq('product_id', p.id).eq('level', lv).range(a, b)),
        fetchAll((a, b) => ranged(db.from('google_ads_entity_metrics').select('entity_id, date, cost, clicks, impressions, conversions, google_metrics').eq('level', lv)).range(a, b)),
      ]);
      const groups = level === 'grupo' ? new Map<string, string>() : new Map((await fetchAll((a, b) => db.from('google_ads_entities').select('entity_id, name').eq('product_id', p.id).eq('level', 'ad_group').range(a, b))).map((g: any) => [g.entity_id, g.name]));
      const info = new Map(ents.map((e: any) => [e.entity_id, e]));
      for (const m of mets) {
        const e: any = info.get(m.entity_id) || {};
        const nome = level === 'palavra_chave' ? `${e.name || m.entity_id}${e.details?.match_type ? ` (${MATCH_PT[e.details.match_type] || e.details.match_type})` : ''}` : String(e.name || m.entity_id);
        bump(m.entity_id, nome, m, { status: e.status || null, ...(level !== 'grupo' && e.ad_group_id ? { grupo: groups.get(e.ad_group_id) || e.ad_group_id } : {}) });
      }
      keyOf = level === 'grupo' ? adGroupKey : level === 'anuncio' ? adKey(ents) : keywordKey(ents);
    } else if (level === 'dispositivo') {
      const aud = await fetchAll((a, b) => ranged(db.from('audiences').select('audience_name, cost, clicks, impressions, conversions, google_metrics').eq('audience_type', 'Device')).range(a, b));
      for (const r of aud) bump(`Device|${r.audience_name}`, DEVICE_PT[r.audience_name] || r.audience_name, r);
      keyOf = deviceKey;
    } else if (level === 'pais') {
      const locs = normalizeLocations(await fetchAll((a, b) => ranged(db.from('locations').select('product_id, date, location_name, cost, clicks, impressions, conversions, google_metrics')).range(a, b)));
      for (const r of locs) bump(String(r.location_name), String(r.location_name), r);
      keyOf = countryKey;
    } else {
      const terms = await fetchAll((a, b) => ranged(db.from('search_terms').select('search_term, keyword, keyword_match_type, cost, clicks, impressions, conversions, google_metrics')).range(a, b));
      for (const r of terms) bump(String(r.search_term), String(r.search_term), r, r.keyword ? { palavra_chave: `${r.keyword}${r.keyword_match_type ? ` (${MATCH_PT[r.keyword_match_type] || r.keyword_match_type})` : ''}` } : undefined);
    }

    // Vendas exatas pelo clique.
    const events = keyOf ? await loadTrackedSales(db, ctx.userId, [p.id], from, to) : [];
    const sales = new Map<string, { vendas: number; receita: number; reembolso: number }>();
    let semDado = 0, totalVendas = 0;
    for (const e of events) {
      if (e.kind === 'sale') totalVendas++;
      const k = e.linked && keyOf ? keyOf(e) : null;
      if (!k || !rows.has(k)) { if (e.kind === 'sale') semDado++; continue; }
      const s = sales.get(k) || { vendas: 0, receita: 0, reembolso: 0 };
      if (e.kind === 'sale') { s.vendas++; s.receita += e.amount; } else s.reembolso += e.amount;
      sales.set(k, s);
    }

    const list = [...rows].map(([k, r]) => {
      const s = keyOf ? sales.get(k) || { vendas: 0, receita: 0, reembolso: 0 } : null;
      return {
        nome: r.nome, ...(r.extra || {}),
        custo: r2(r.custo), cliques: r.cliques, impressoes: r.impressoes, conversoes_google: r2(r.conversoes_google),
        custo_por_conversao_google: div(r.custo, r.conversoes_google),
        vendas: s ? s.vendas : null, cpa_real: s ? div(r.custo, s.vendas) : null,
        receita: s ? r2(s.receita) : null, lucro: s ? r2(s.receita - s.reembolso - r.custo) : null,
      };
    }).sort((a, b) => b.custo - a.custo);
    const cut = list.slice(0, limit);
    return {
      campanha: nameOf(p), id: p.id, nivel: level, periodo: { de: from, ate: to },
      origem_das_vendas: keyOf
        ? `Vendas reais ligadas ao clique, inteiras. ${totalVendas - semDado} de ${totalVendas} vendas do período aparecem nas linhas; ${semDado} não trouxeram este dado no clique e contam só no total da campanha.`
        : 'O clique não informa o termo de pesquisa: "vendas" fica null; use conversoes_google.',
      linhas: cut,
      ...(list.length > limit ? { outras_linhas: { quantidade: list.length - limit, custo: r2(list.slice(limit).reduce((s, r) => s + r.custo, 0)) } } : {}),
    };
  },
};

// ── Vendas e checkouts ───────────────────────────────────────────────────
const vendas: Tool = {
  name: 'vendas',
  description: 'Lista as vendas (ou os checkouts) do período, da mais recente para a mais antiga: hora no relógio da plataforma, campanha, valor, plataforma, pedido e o clique (palavra-chave, país, aparelho). Inclui o total por moeda.',
  inputSchema: {
    type: 'object',
    properties: {
      ...PERIOD_SCHEMA,
      tipo: { type: 'string', enum: ['venda', 'checkout'], description: 'Padrão: venda.' },
      campanha: { type: 'string', description: 'Só desta campanha (id ou trecho do nome).' },
      limite: { type: 'number', description: 'Quantas, das mais recentes. Padrão: 50, máximo 300.' },
    },
  },
  async run(ctx, args) {
    const { from, to } = period(args);
    const BRT = 3 * 3600000;
    const since = new Date(Date.parse(`${from}T00:00:00Z`) + BRT).toISOString();
    const until = new Date(Date.parse(`${to}T00:00:00Z`) + BRT + 86400000).toISOString();
    const type = args.tipo === 'checkout' ? 'checkout' : 'sale';
    const res: any = await listEvents(ctx.db, ctx.userId, since, until, { from, to } as any, type);
    let events = res.events || [];
    if (args.campanha) { const p = await oneCampaign(ctx, args.campanha); events = events.filter((e: any) => e.product_id === p.id); }
    const limit = Math.min(300, Math.max(1, Number(args.limite) || 50));
    const total: Record<string, number> = {};
    for (const e of events) total[e.currency] = r2((total[e.currency] || 0) + e.amount);
    return {
      periodo: { de: from, ate: to }, tipo: type === 'sale' ? 'venda' : 'checkout',
      quantidade: events.length, com_clique: events.filter((e: any) => e.click).length, total_por_moeda: total,
      lista: events.slice(0, limit).map((e: any) => ({
        hora: e.at_text, campanha: e.campaign, valor: e.amount, moeda: e.currency, plataforma: e.source || null, pedido: e.order || null,
        palavra_chave: e.click?.keyword || null, pais: e.click?.country || null, aparelho: e.click?.device || null,
        ...(type === 'sale' && e.google ? { envio_google: e.google.status } : {}),
      })),
    };
  },
};

// ── Análises ─────────────────────────────────────────────────────────────
const analiseCampanha: Tool = {
  name: 'analise_campanha',
  description: 'A leitura da campanha que o painel faz (aba Análise): últimos 3 dias fechados contra 7 dias, a referência de CPA, e cada item (termos, palavras-chave, dispositivos, públicos, locais, anúncios, sitelinks) com semáforo ok/alerta/urgente e as linhas que pedem atenção.',
  inputSchema: {
    type: 'object',
    properties: { campanha: { type: 'string', description: 'Id ou trecho do nome da campanha.' } },
    required: ['campanha'],
  },
  async run(ctx, args) {
    const p = await oneCampaign(ctx, args.campanha);
    const c = await computeAnalysis(p.id);
    if (!c) throw new UserError('Campanha não encontrada.');
    return {
      campanha: nameOf(p), id: p.id, periodo: { tres_dias: c.period.d3, sete_dias: c.period.d7 },
      referencia: { modo: c.reference.mode, valor: c.reference.value, alerta_a_partir_de: c.reference.warn, urgente_acima_de: c.reference.urgent, base: c.reference.basis, moeda: c.reference.currency },
      numeros: { tres_dias: c.numbers.d3, sete_dias: c.numbers.d7, origem_das_vendas: c.numbers.salesSource === 'real' ? 'vendas reais' : 'conversões do Google' },
      status_da_campanha: c.campaignStatus,
      itens: c.items.map(i => ({
        item: i.title, status: i.status, resumo: i.headline,
        ...(i.uncovered ? { vendas_sem_o_dado: i.uncovered } : {}),
        linhas: i.rows.slice(0, 15).map(r => ({
          nome: r.label, tipo: r.tag || undefined, status: r.status,
          custo_3d: r.cost3, vendas_3d: r.conv3, cpa_3d: r.cpa3, custo_7d: r.cost7, vendas_7d: r.conv7, cpa_7d: r.cpa7,
          origem_das_vendas: r.source === 'rastreada' ? 'venda real ligada ao clique' : 'conversões do Google',
          ...(r.extra?.keyword ? { palavra_chave: r.extra.keyword } : {}),
        })),
      })),
    };
  },
};

const padroes: Tool = {
  name: 'padroes_entre_campanhas',
  description: 'O que se repete entre campanhas parecidas (tela Análise IA): total do grupo, termos e palavras-chave que mais vendem e que gastam sem vender, dispositivos, e o veredito de cada campanha (manter, ajustar, pausar, cedo). Filtra por uma marcação no nome, como "[WL]".',
  inputSchema: {
    type: 'object',
    properties: {
      marcacao: { type: 'string', description: 'Trecho que o nome da campanha precisa ter (ex.: "[WL]"). Vazio = todas.' },
      periodo: { type: 'string', enum: ['hoje', '2d', '3d', '7d', 'tudo', 'personalizado'], description: 'Padrão: 7d.' },
      de: PERIOD_SCHEMA.de, ate: PERIOD_SCHEMA.ate,
      mcc: { type: 'string', description: 'Só as campanhas desta MCC (nome exato).' },
      todos_os_blocos: { type: 'boolean', description: 'Também as campanhas fora do bloco "Principais" do painel. Padrão: false.' },
    },
  },
  async run(ctx, args) {
    const map: Record<string, PeriodKey> = { hoje: 'today', '2d': 'd2', '3d': 'd3', '7d': 'd7', tudo: 'all', personalizado: 'custom' };
    const key = map[String(args.periodo || '7d')] || 'd7';
    let blocks: string[] = [];
    if (args.todos_os_blocos) {
      const opt: any = await computePatterns(ctx.userId, { tag: '', period: key, blocks: [], optionsOnly: true });
      blocks = (opt.options?.blocks || []).map((b: any) => b.id);
    }
    const p: any = await computePatterns(ctx.userId, { tag: String(args.marcacao || ''), period: key, blocks, mcc: args.mcc ? String(args.mcc) : undefined, from: args.de, to: args.ate });
    if (p.empty) return { periodo: p.period, campanhas_no_grupo: p.set_size || 0, aviso: 'Nenhuma campanha com essa marcação no período.' };
    return {
      periodo: p.period, moeda: p.currency, campanhas_no_grupo: p.set_size, total: p.totals,
      origem_das_vendas: p.tracked
        ? `Palavra-chave e dispositivo: vendas reais ligadas ao clique (${p.tracked.keywords} de ${p.tracked.sales} vendas com palavra-chave; ${p.tracked.devices} com dispositivo). Termos: conversões do Google.`
        : 'Conversões do Google.',
      destaques: p.highlights.map((h: any) => `${h.mark}: ${h.text}`),
      termos_que_vendem: p.terms_best, termos_sem_venda: p.terms_waste,
      palavras_chave_que_vendem: p.keywords_best, palavras_chave_sem_venda: p.keywords_waste,
      cpa_medio_termos: p.term_cpa, cpa_medio_palavras_chave: p.keyword_cpa,
      dispositivos: p.devices, video: p.video,
      vereditos: p.verdicts.slice(0, 40).map((v: any) => ({ campanha: v.name, status: v.status?.label, veredito: v.verdict, motivo: v.reason, custo_7d: v.cost7, vendas_7d: v.sales7, cpa_7d: v.cpa7, resultado_7d: v.result7 })),
    };
  },
};

export const TOOLS: Tool[] = [campanhas, campanhaDiaADia, vendasPorItem, vendas, analiseCampanha, padroes];
