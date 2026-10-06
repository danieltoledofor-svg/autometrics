import { supabaseAdmin } from '@/lib/googleAds/server';
import { addDays, fetchAll, loadProduct, todayIn } from './compute';
import { audienceLabel, deviceLabel, formatMoney, keywordLabel } from './labels';

/**
 * Alterações feitas na campanha e o que aconteceu depois — sem IA.
 *
 * Lê o histórico do Google (google_ads_changes), junta as alterações de cada
 * dia num evento só e compara os 7 dias antes com os 3 e os 7 dias depois:
 * CPA, vendas por dia, gasto por dia e resultado por dia.
 *
 * O resultado é da campanha inteira, não de cada alteração: quando o mesmo
 * dia tem várias mudanças, ou outra mudança cai dentro dos dias seguintes, o
 * número não separa uma da outra — a tela avisa quando isso acontece.
 *
 * Regra do resultado (a mesma das sugestões, em track.ts):
 * - com venda antes: melhorou se o CPA caiu 10% ou mais sem perder mais de
 *   30% das vendas por dia; piorou se o CPA subiu 10% ou mais ou as vendas
 *   por dia caíram mais de 30%;
 * - sem venda antes: melhorou se passou a vender; piorou se o gasto por dia
 *   subiu 20% ou mais e continuou sem venda.
 */

export type ChangeArea = 'campanha' | 'grupos' | 'palavras' | 'anuncios' | 'recursos' | 'segmentacao';
export type ChangeOutcome = 'melhorou' | 'piorou' | 'igual' | 'aguardando' | 'sem_base';

export interface ChangeItem { area: ChangeArea; text: string; /** Tipo do ajuste, para somar entre campanhas (KIND_LABEL). */ kind: string }
export interface Window { days: number; cost_day: number; sales_day: number; cpa: number | null; result_day: number | null }
export interface ChangeEvent {
  date: string;
  items: ChangeItem[];
  areas: ChangeArea[];
  count: number;
  created: boolean;
  before: Window | null;
  after3: Window | null;
  after7: Window | null;
  outcome: ChangeOutcome;
  /** Quando sai a próxima conferência (3 ou 7 dias depois). */
  next_check: string | null;
  /** Outra alteração caiu dentro dos dias comparados. */
  mixed: boolean;
  text: string;
}

const num = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round = (x: number) => Math.round(x * 100) / 100;
const ASSET_PT: Record<string, string> = { SITELINK: 'sitelink', CALLOUT: 'frase de destaque', STRUCTURED_SNIPPET: 'snippet estruturado', CALL: 'telefone', PRICE: 'preço', PROMOTION: 'promoção', BUSINESS_NAME: 'nome da empresa', BUSINESS_LOGO: 'logotipo', IMAGE: 'imagem' };

/** Junta textos iguais: "3 palavras-chave incluídas (a, b, c)". */
class Bucket {
  private map = new Map<string, { area: ChangeArea; kind: string; one: string; many: string; names: string[] }>();
  add(area: ChangeArea, kind: string, one: string, many: string, name?: string | null) {
    const k = `${area}|${one}`;
    if (!this.map.has(k)) this.map.set(k, { area, kind, one, many, names: [] });
    const b = this.map.get(k)!;
    b.names.push(name || '');
  }
  items(): ChangeItem[] {
    return [...this.map.values()].map(b => {
      const named = [...new Set(b.names.filter(Boolean))];
      const list = named.length ? ` (${named.slice(0, 4).join(', ')}${named.length > 4 ? ` e mais ${named.length - 4}` : ''})` : '';
      return { area: b.area, kind: b.kind, text: b.names.length === 1 ? `${b.one}${named[0] ? ` ${named[0]}` : ''}` : `${b.names.length} ${b.many}${list}` };
    });
  }
}

function describe(changes: any[], currency: string): { items: ChangeItem[]; created: boolean } {
  const bucket = new Bucket();
  const direct: ChangeItem[] = [];
  let created = false;
  const money = (v: any) => formatMoney(num(v), currency);
  // Para onde o valor foi: é o que separa "orçamento aumentado" de "reduzido".
  const dir = (f: any) => (!f.de ? 'definida' : !f.para ? 'retirada' : num(f.para) > num(f.de) ? 'subiu' : num(f.para) < num(f.de) ? 'desceu' : 'definida');
  const fromTo = (f: any, fmt: (v: any) => string = String) => (f.de && f.para ? `de ${fmt(f.de)} para ${fmt(f.para)}` : f.para ? `para ${fmt(f.para)}` : `retirado (era ${fmt(f.de)})`);
  const onOff = (f: any, what: 'Grupo' | 'Anúncio' | 'Palavra-chave', area: ChangeArea, name?: string | null) => {
    const fem = what === 'Palavra-chave';
    const many = fem ? 'palavras-chave' : `${what.toLowerCase()}s`;
    const verb = f.para === 'PAUSED' ? 'pausad' : f.para === 'ENABLED' ? 'reativad' : f.para === 'REMOVED' ? 'removid' : '';
    if (verb) bucket.add(area, `${fem ? 'palavra' : what === 'Grupo' ? 'grupo' : 'anuncio'}_${verb}`, `${what} ${verb}${fem ? 'a' : 'o'}`, `${many} ${verb}${fem ? 'as' : 'os'}`, name);
  };

  for (const c of changes) {
    const type = String(c.resource_type || ''), op = String(c.operation || '');
    const fields: any[] = Array.isArray(c.fields) ? c.fields : [];
    const get = (name: string) => fields.find(f => f.f === name || String(f.f).endsWith(`.${name}`));
    const val = (name: string) => { const f = get(name); return f ? String(f.para || f.de || '') : ''; };

    if (type === 'CAMPAIGN' && op === 'CREATE') { created = true; continue; }
    if (type === 'CAMPAIGN_BUDGET') {
      const f = get('amount_micros');
      if (op === 'UPDATE' && f) direct.push({ area: 'campanha', kind: `orcamento_${dir(f)}`, text: `Orçamento ${fromTo(f, money)}` });
      continue;
    }
    if (type === 'CAMPAIGN' && op === 'UPDATE') {
      for (const f of fields) {
        if (f.f === 'status') direct.push({ area: 'campanha', kind: f.para === 'PAUSED' ? 'campanha_pausada' : 'campanha_reativada', text: f.para === 'PAUSED' ? 'Campanha pausada' : f.para === 'ENABLED' ? 'Campanha reativada' : `Campanha ${String(f.para).toLowerCase()}` });
        else if (/target_cpa_micros$/.test(f.f)) direct.push({ area: 'campanha', kind: `meta_cpa_${dir(f)}`, text: `Meta de CPA ${fromTo(f, money)}` });
        else if (/target_roas$/.test(f.f)) direct.push({ area: 'campanha', kind: `meta_roas_${dir(f)}`, text: `Meta de ROAS ${fromTo(f)}` });
        else if (/cpc_bid_ceiling_micros$/.test(f.f)) direct.push({ area: 'campanha', kind: `limite_cpc_${dir(f)}`, text: `Limite de CPC ${fromTo(f, money)}` });
        else if (/bidding_strategy_type$/.test(f.f)) direct.push({ area: 'campanha', kind: 'estrategia', text: `Estratégia de lances ${fromTo(f)}` });
        else if (/^network_settings\./.test(f.f)) bucket.add('campanha', 'redes', 'Redes da campanha alteradas', 'ajustes nas redes da campanha');
        else if (/geo_target_type/.test(f.f)) direct.push({ area: 'segmentacao', kind: 'regra_local', text: `Regra de local ${f.para === 'PRESENCE' ? 'só quem está no local' : 'quem está ou tem interesse no local'}` });
      }
      continue;
    }
    if (type === 'AD_GROUP') {
      if (op === 'CREATE') { bucket.add('grupos', 'grupo_criado', 'Grupo de anúncios criado:', 'grupos de anúncios criados', val('name')); continue; }
      for (const f of fields) {
        if (f.f === 'status') onOff(f, 'Grupo', 'grupos');
        else if (/target_cpa_micros$/.test(f.f)) direct.push({ area: 'grupos', kind: `meta_cpa_${dir(f)}`, text: `Meta de CPA do grupo ${fromTo(f, money)}` });
        else if (/cpc_bid_micros$/.test(f.f)) direct.push({ area: 'grupos', kind: `lance_grupo_${dir(f)}`, text: `Lance do grupo ${fromTo(f, money)}` });
      }
      continue;
    }
    if (type === 'AD_GROUP_CRITERION' || type === 'CAMPAIGN_CRITERION' || type === 'SHARED_CRITERION') {
      const text = val('text');
      const negative = get('negative') ? String(get('negative').para || get('negative').de) === 'true' : type === 'SHARED_CRITERION';
      if (text) {
        const label = keywordLabel(text, val('match_type'));
        if (op === 'CREATE') negative ? bucket.add('palavras', 'negativa_incluida', 'Negativa incluída:', 'negativas incluídas', label) : bucket.add('palavras', 'palavra_incluida', 'Palavra-chave incluída:', 'palavras-chave incluídas', label);
        else if (op === 'REMOVE') negative ? bucket.add('palavras', 'negativa_removida', 'Negativa removida:', 'negativas removidas', label) : bucket.add('palavras', 'palavra_removida', 'Palavra-chave removida:', 'palavras-chave removidas', label);
        continue;
      }
      const status = get('status'), bid = get('bid_modifier');
      if (op === 'UPDATE' && bid) { direct.push({ area: type === 'AD_GROUP_CRITERION' ? 'palavras' : 'segmentacao', kind: `ajuste_lance_${dir(bid)}`, text: `Ajuste de lance ${fromTo(bid, v => `${Math.round((num(v) - 1) * 100)}%`)}` }); continue; }
      if (op === 'UPDATE' && status && type === 'AD_GROUP_CRITERION') { onOff(status, 'Palavra-chave', 'palavras'); continue; }
      const age = val('age_range.type') || val('type');
      if (get('age_range.type')) { bucket.add('segmentacao', 'idade', op === 'REMOVE' ? 'Faixa de idade removida:' : 'Faixa de idade ajustada:', 'faixas de idade ajustadas', audienceLabel('Age', age)); continue; }
      if (get('gender.type')) { bucket.add('segmentacao', 'genero', 'Gênero ajustado:', 'ajustes de gênero', audienceLabel('Gender', val('gender.type'))); continue; }
      if (get('income_range.type')) { bucket.add('segmentacao', 'renda', 'Faixa de renda ajustada', 'faixas de renda ajustadas'); continue; }
      bucket.add('segmentacao', 'segmentacao', op === 'REMOVE' ? 'Segmentação removida' : op === 'CREATE' ? 'Segmentação incluída (local, público ou idioma)' : 'Segmentação alterada', op === 'REMOVE' ? 'segmentações removidas' : op === 'CREATE' ? 'segmentações incluídas (local, público ou idioma)' : 'segmentações alteradas');
      continue;
    }
    if (type === 'AD_GROUP_BID_MODIFIER') {
      const bid = get('bid_modifier');
      if (op !== 'REMOVE' && bid) direct.push({ area: 'segmentacao', kind: `lance_dispositivo_${num(bid.para) < 1 ? 'desceu' : 'subiu'}`, text: `Ajuste de lance em ${deviceLabel(val('type'))}: ${Math.round((num(bid.para) - 1) * 100)}%` });
      else bucket.add('segmentacao', 'lance_dispositivo_retirada', 'Ajuste de lance por dispositivo removido', 'ajustes de lance por dispositivo removidos');
      continue;
    }
    if (type === 'AD_GROUP_AD') {
      if (op === 'CREATE') bucket.add('anuncios', 'anuncio_criado', 'Anúncio criado', 'anúncios criados');
      else if (op === 'REMOVE') bucket.add('anuncios', 'anuncio_removid', 'Anúncio removido', 'anúncios removidos');
      else if (get('status')) onOff(get('status'), 'Anúncio', 'anuncios');
      continue;
    }
    if (type === 'AD') {
      if (fields.some(f => /headlines|descriptions/.test(f.f))) bucket.add('anuncios', 'anuncio_texto', 'Títulos ou descrições do anúncio alterados', 'anúncios com títulos ou descrições alterados');
      else if (fields.some(f => /final_urls/.test(f.f))) bucket.add('anuncios', 'anuncio_pagina', 'Página do anúncio alterada', 'anúncios com a página alterada');
      continue;
    }
    if (type === 'CAMPAIGN_ASSET' || type === 'AD_GROUP_ASSET' || type === 'ASSET') {
      const kind = ASSET_PT[val('field_type')] ? ` (${ASSET_PT[val('field_type')]})` : '';
      if (op === 'REMOVE') bucket.add('recursos', 'recurso_removido', `Recurso removido${kind}`, `recursos removidos${kind}`);
      else if (op === 'CREATE') bucket.add('recursos', 'recurso_incluido', `Recurso incluído${kind}`, `recursos incluídos${kind}`);
      else bucket.add('recursos', 'recurso_alterado', 'Recurso alterado', 'recursos alterados');
      continue;
    }
  }
  return { items: [...direct, ...bucket.items()], created };
}

function judge(before: Window, after: Window): 'melhorou' | 'piorou' | 'igual' {
  const change = (b: number | null, a: number | null) => (b !== null && a !== null && b > 0 ? (a - b) / b : null);
  if (before.cpa !== null) {
    const cpa = change(before.cpa, after.cpa), sales = change(before.sales_day, after.sales_day);
    if (after.cpa === null) return after.cost_day > 0 ? 'piorou' : 'igual';
    if ((sales !== null && sales < -0.3) || (cpa !== null && cpa >= 0.1)) return 'piorou';
    if (cpa !== null && cpa <= -0.1) return 'melhorou';
    return 'igual';
  }
  if (after.cpa !== null) return 'melhorou';
  const cost = change(before.cost_day, after.cost_day);
  return cost !== null && cost >= 0.2 ? 'piorou' : 'igual';
}

export async function changeReview(productId: string, limit = 40): Promise<ChangeEvent[]> {
  const loaded = await loadProduct(productId);
  if (!loaded) return [];
  const { product, timeZone } = loaded;
  const db = supabaseAdmin();
  const today = todayIn(timeZone);
  const [changes, days] = await Promise.all([
    fetchAll((a, b) => db.from('google_ads_changes').select('changed_at, resource_type, operation, fields')
      .eq('product_id', productId).order('changed_at', { ascending: false }).range(a, b)).catch(() => []),
    fetchAll((a, b) => db.from('daily_metrics').select('date, cost, conversions, google_conversions, conversion_value, refunds')
      .eq('product_id', productId).gte('date', addDays(today, -120)).order('date').range(a, b)),
  ]);
  return buildEvents(changes, days, String(product.currency || 'USD').toUpperCase(), today, limit);
}

/** A conta em si, com os dados já lidos: serve a uma campanha ou a todas de uma vez. */
function buildEvents(changes: any[], days: any[], currency: string, today: string, limit: number): ChangeEvent[] {
  if (!changes.length) return [];
  const money = (v: number) => formatMoney(v, currency);
  const real = days.some(d => num(d.conversions) > 0);

  const window = (from: string, to: string): Window | null => {
    const list = days.filter(d => d.date >= from && d.date <= to);
    const n = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const cost = list.reduce((s, d) => s + num(d.cost), 0);
    if (!list.some(d => num(d.cost) > 0)) return null;
    const sales = list.reduce((s, d) => s + num(real ? d.conversions : d.google_conversions), 0);
    const revenue = list.reduce((s, d) => s + num(d.conversion_value) - num(d.refunds), 0);
    return { days: n, cost_day: round(cost / n), sales_day: Math.round((sales / n) * 10) / 10, cpa: sales > 0 ? round(cost / sales) : null, result_day: real ? round((revenue - cost) / n) : null };
  };

  const byDay = new Map<string, any[]>();
  for (const c of changes) {
    const d = String(c.changed_at || '').slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(c);
  }
  const changeDays = [...byDay.keys()].sort();

  const events: ChangeEvent[] = [];
  for (const date of [...changeDays].reverse().slice(0, limit)) {
    const { items, created } = describe(byDay.get(date)!, currency);
    if (!items.length && !created) continue; // só troca de nome e afins
    const before = created ? null : window(addDays(date, -7), addDays(date, -1));
    const after3 = today > addDays(date, 3) ? window(addDays(date, 1), addDays(date, 3)) : null;
    const after7 = today > addDays(date, 7) ? window(addDays(date, 1), addDays(date, 7)) : null;
    const after = after7 || after3;
    const until = addDays(date, after7 ? 7 : 3);
    const mixed = changeDays.some(d => d > date && d <= until);

    let outcome: ChangeOutcome, text: string, next: string | null = null;
    const span = after7 ? '7 dias' : '3 dias';
    const cpaText = (w: Window) => (w.cpa === null ? `${money(w.cost_day)} por dia sem venda` : `CPA de ${money(w.cpa)}`);
    if (created) {
      outcome = 'sem_base'; text = 'Dia em que a campanha foi criada: não há dias anteriores para comparar.';
    } else if (!before) {
      outcome = 'sem_base'; text = 'Sem gasto nos 7 dias antes: não há base para comparar.';
    } else if (today <= addDays(date, 3)) {
      outcome = 'aguardando'; next = addDays(date, 4);
      text = `Antes: ${cpaText(before)}. A primeira conferência sai com 3 dias completos depois da alteração.`;
    } else if (!after) {
      outcome = 'igual'; text = `Antes: ${cpaText(before)}. Depois: sem gasto nos ${span} seguintes.`;
    } else if (before.cpa === null && after.cpa === null && before.cost_day * before.days + after.cost_day * after.days < 30) {
      // Centavos por dia sem venda dos dois lados: qualquer variação é ruído.
      outcome = 'sem_base'; text = `Gasto pequeno demais para concluir: ${money(before.cost_day)} por dia antes e ${money(after.cost_day)} depois, sem venda.`;
    } else {
      outcome = judge(before, after);
      const sales = `vendas por dia ${String(before.sales_day).replace('.', ',')} → ${String(after.sales_day).replace('.', ',')}`;
      const res = before.result_day !== null && after.result_day !== null ? ` · resultado por dia ${money(before.result_day)} → ${money(after.result_day)}` : '';
      text = `${span} depois: ${cpaText(before)} → ${cpaText(after)} · ${sales} · gasto por dia ${money(before.cost_day)} → ${money(after.cost_day)}${res}.`;
      if (!after7) next = addDays(date, 8);
    }
    events.push({
      date, items: items.slice(0, 12), areas: [...new Set(items.map(i => i.area))], count: byDay.get(date)!.length, created,
      before, after3, after7, outcome, next_check: next, mixed: mixed && outcome !== 'sem_base' && outcome !== 'aguardando', text,
    });
  }
  return events;
}

// ── O que os ajustes mostraram, somando todas as campanhas do usuário ────────

const KIND_LABEL: Record<string, string> = {
  orcamento_subiu: 'Orçamento aumentado', orcamento_desceu: 'Orçamento reduzido',
  meta_cpa_subiu: 'Meta de CPA aumentada', meta_cpa_desceu: 'Meta de CPA reduzida', meta_cpa_definida: 'Meta de CPA definida', meta_cpa_retirada: 'Meta de CPA retirada',
  meta_roas_subiu: 'Meta de ROAS aumentada', meta_roas_desceu: 'Meta de ROAS reduzida',
  limite_cpc_subiu: 'Limite de CPC aumentado', limite_cpc_desceu: 'Limite de CPC reduzido', limite_cpc_definida: 'Limite de CPC definido', limite_cpc_retirada: 'Limite de CPC retirado',
  estrategia: 'Estratégia de lances trocada', redes: 'Redes da campanha alteradas', regra_local: 'Regra de local alterada',
  campanha_pausada: 'Campanha pausada', campanha_reativada: 'Campanha reativada',
  grupo_criado: 'Grupo de anúncios criado', grupo_pausad: 'Grupo pausado', grupo_reativad: 'Grupo reativado', grupo_removid: 'Grupo removido',
  lance_grupo_subiu: 'Lance do grupo aumentado', lance_grupo_desceu: 'Lance do grupo reduzido',
  palavra_incluida: 'Palavras-chave incluídas', palavra_removida: 'Palavras-chave removidas', palavra_pausad: 'Palavras-chave pausadas', palavra_reativad: 'Palavras-chave reativadas', palavra_removid: 'Palavras-chave removidas',
  negativa_incluida: 'Negativas incluídas', negativa_removida: 'Negativas removidas',
  ajuste_lance_subiu: 'Ajuste de lance aumentado', ajuste_lance_desceu: 'Ajuste de lance reduzido', ajuste_lance_definida: 'Ajuste de lance definido', ajuste_lance_retirada: 'Ajuste de lance retirado',
  lance_dispositivo_subiu: 'Lance por dispositivo aumentado', lance_dispositivo_desceu: 'Lance por dispositivo reduzido', lance_dispositivo_retirada: 'Ajuste por dispositivo retirado',
  idade: 'Faixas de idade ajustadas', genero: 'Gênero ajustado', renda: 'Faixas de renda ajustadas', segmentacao: 'Segmentação alterada (local, público ou idioma)',
  anuncio_criado: 'Anúncio criado', anuncio_removid: 'Anúncio removido', anuncio_pausad: 'Anúncio pausado', anuncio_reativad: 'Anúncio reativado',
  anuncio_texto: 'Títulos ou descrições trocados', anuncio_pagina: 'Página do anúncio trocada',
  recurso_incluido: 'Recursos incluídos', recurso_removido: 'Recursos removidos', recurso_alterado: 'Recursos alterados',
};

export interface AdjustmentRow {
  kind: string;
  label: string;
  /** Vezes em que já deu para conferir o depois. */
  times: number;
  melhorou: number; piorou: number; igual: number;
  /** Dessas, quantas foram o único tipo de ajuste do dia, sem outro nos dias seguintes. */
  alone: number; alone_melhorou: number; alone_piorou: number;
  /** Variação média do CPA, em %, quando havia venda antes e depois. */
  cpa_change: number | null;
  waiting: number;
  campaigns: number;
}

const summaryCache = new Map<string, { at: number; rows: AdjustmentRow[] }>();

/**
 * Cada tipo de ajuste, em todas as campanhas do usuário: quantas vezes foi
 * feito e o que aconteceu depois. É a base para a IA aprender com o que o
 * próprio usuário faz — orçamento, meta de CPA e lance se comportam de forma
 * parecida de uma campanha para outra. Fica guardado por 30 minutos.
 */
export async function adjustmentSummary(userId: string): Promise<AdjustmentRow[]> {
  const hit = summaryCache.get(userId);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.rows;
  const db = supabaseAdmin();
  const products = await fetchAll((a, b) => db.from('products').select('id, currency').eq('user_id', userId).range(a, b));
  const ids = products.map(p => p.id);
  const today = todayIn('America/Sao_Paulo');
  const chunked = async (build: (chunk: string[], a: number, b: number) => any) => {
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += 150) out.push(...await fetchAll((a, b) => build(ids.slice(i, i + 150), a, b)));
    return out;
  };
  const changes = await chunked((chunk, a, b) => db.from('google_ads_changes').select('product_id, changed_at, resource_type, operation, fields')
    .in('product_id', chunk).order('changed_at', { ascending: false }).range(a, b)).catch(() => []);
  const withChanges = [...new Set(changes.map(c => c.product_id))];
  const days: any[] = [];
  for (let i = 0; i < withChanges.length; i += 150) {
    days.push(...await fetchAll((a, b) => db.from('daily_metrics').select('product_id, date, cost, conversions, google_conversions, conversion_value, refunds')
      .in('product_id', withChanges.slice(i, i + 150)).gte('date', addDays(today, -120)).order('date').range(a, b)));
  }

  const rows = new Map<string, AdjustmentRow & { cpa: number[]; set: Set<string> }>();
  for (const id of withChanges) {
    const currency = String(products.find(p => p.id === id)?.currency || 'USD').toUpperCase();
    const events = buildEvents(changes.filter(c => c.product_id === id), days.filter(d => d.product_id === id), currency, today, 200);
    for (const e of events) {
      if (e.outcome === 'sem_base') continue;
      // Campanha pausada fica de fora: depois da pausa não há gasto para comparar.
      const kinds = [...new Set(e.items.map(i => i.kind))].filter(k => KIND_LABEL[k] && k !== 'campanha_pausada');
      for (const kind of kinds) {
        if (!rows.has(kind)) rows.set(kind, { kind, label: KIND_LABEL[kind], times: 0, melhorou: 0, piorou: 0, igual: 0, alone: 0, alone_melhorou: 0, alone_piorou: 0, cpa_change: null, waiting: 0, campaigns: 0, cpa: [], set: new Set() });
        const r = rows.get(kind)!;
        if (e.outcome === 'aguardando') { r.waiting++; continue; }
        r.set.add(id);
        r.times++;
        r[e.outcome]++;
        const after = e.after7 || e.after3;
        if (e.before?.cpa && after?.cpa) r.cpa.push(((after.cpa - e.before.cpa) / e.before.cpa) * 100);
        if (kinds.length === 1 && !e.mixed) {
          r.alone++;
          if (e.outcome === 'melhorou') r.alone_melhorou++;
          if (e.outcome === 'piorou') r.alone_piorou++;
        }
      }
    }
  }
  const out = [...rows.values()].map(({ cpa, set, ...r }) => ({
    ...r, campaigns: set.size, cpa_change: cpa.length ? Math.round(cpa.reduce((s, x) => s + x, 0) / cpa.length) : null,
  })).sort((a, b) => b.times - a.times || b.waiting - a.waiting);
  summaryCache.set(userId, { at: Date.now(), rows: out });
  return out;
}

/** O mesmo resumo, em linhas, para o pedido à IA. */
export function adjustmentBlock(rows: AdjustmentRow[]): string {
  const lines = rows.filter(r => r.times > 0).slice(0, 25).map(r => {
    const alone = r.alone ? `; quando foi o único ajuste do dia: ${r.alone} (melhorou ${r.alone_melhorou}, piorou ${r.alone_piorou})` : '';
    const cpa = r.cpa_change === null ? '' : `; CPA em média ${r.cpa_change > 0 ? '+' : ''}${r.cpa_change}%`;
    return `- ${r.label}: ${r.times}× em ${r.campaigns} ${r.campaigns === 1 ? 'campanha' : 'campanhas'} (melhorou ${r.melhorou}, piorou ${r.piorou}, ficou igual ${r.igual}${cpa}${alone})`;
  });
  return lines.length
    ? `O QUE OS AJUSTES DO PRÓPRIO AFILIADO MOSTRARAM, somando todas as campanhas dele (7 dias antes × 3 ou 7 dias depois; o resultado é da campanha inteira, e dias com vários ajustes misturam o efeito):\n${lines.join('\n')}`
    : '';
}
