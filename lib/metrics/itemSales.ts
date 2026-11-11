import { countryLabel } from '@/lib/geoNames';

/**
 * Vendas reais por item (grupo, anúncio, palavra-chave, aparelho, país), sem
 * rateio: só conta a venda ligada a um clique rastreado, e só no item que o
 * clique informou. A venda inteira (1) vai para aquele item.
 *
 * Venda sem clique ligado, ou clique sem o dado da tabela (o termo de pesquisa,
 * a idade, o gênero e a renda nunca vêm no clique), não entra em item nenhum:
 * continua só no total da campanha. Melhor mostrar menos do que estimar.
 */

/** Uma venda ou um reembolso do período, com o que o clique trouxe. */
export interface TrackedEvent {
  kind: 'sale' | 'refund';
  /** Valor na moeda da tela. */
  amount: number;
  ad_group_id: string | null;
  ad_id: string | null;
  /** ID da palavra-chave no Google (do targetid "kwd-…"), quando veio. */
  criterion_id: string | null;
  keyword: string | null;
  match_type: string | null;
  device: string | null;
  country: string | null;
}

export interface RealSales { conversions: number; revenue: number; refunds: number }

/** O que a tabela recebe: vendas por item, ou null quando a tabela não tem como ligar venda a item. */
export interface ItemSales {
  byKey: Map<string, RealSales>;
  /** Vendas do período com chave nesta tabela. */
  linked: number;
  /** Vendas do período com clique rastreado (qualquer dado). */
  tracked: number;
  /** Vendas do período sem clique ligado: só contam na campanha. */
  untracked: number;
}

/** Resposta de /api/tracking/item-sales. */
export interface ItemSalesPayload {
  events: (Omit<TrackedEvent, 'amount'> & { amount: number; currency: string | null })[];
  /** Vendas do período sem clique ligado. */
  untracked: number;
}

const MATCH: Record<string, string> = { e: 'EXACT', exact: 'EXACT', p: 'PHRASE', phrase: 'PHRASE', b: 'BROAD', broad: 'BROAD' };
export const matchTypeOf = (v: string | null | undefined) => MATCH[String(v || '').trim().toLowerCase()] || '';
const norm = (v: string | null | undefined) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** O que as abas recebem da página: os eventos na moeda da tela e as vendas sem clique. */
export interface TrackedSales { events: TrackedEvent[]; untracked: number }

/** Chave do item na tabela para um evento; null quando o clique não traz o dado. */
export type KeyOf = (e: TrackedEvent) => string | null;

export function groupSales(events: TrackedEvent[], keyOf: KeyOf, untracked = 0): ItemSales {
  const byKey = new Map<string, RealSales>();
  let linked = 0, tracked = 0;
  for (const e of events) {
    if (e.kind === 'sale') tracked++;
    const k = keyOf(e);
    if (!k) continue;
    const cur = byKey.get(k) || { conversions: 0, revenue: 0, refunds: 0 };
    if (e.kind === 'sale') { cur.conversions += 1; cur.revenue += e.amount; linked++; }
    else cur.refunds += e.amount;
    byKey.set(k, cur);
  }
  return { byKey, linked, tracked, untracked };
}

/** Grupos: pelo ID do grupo do clique. */
export const adGroupKey: KeyOf = e => e.ad_group_id || null;

/** Anúncios: entity_id é "grupo~anúncio". */
export function adKey(ads: { entity_id: string; ad_group_id: string | null }[]): KeyOf {
  const byAd = new Map<string, string>();
  for (const a of ads) byAd.set(a.entity_id.split('~')[1], a.entity_id);
  return e => {
    if (!e.ad_id) return null;
    if (e.ad_group_id) return `${e.ad_group_id}~${e.ad_id}`;
    return byAd.get(e.ad_id) || null;
  };
}

/**
 * Uma chave por texto quando ele é único: sem a correspondência no clique (o
 * normal: {matchtype} quase nunca vem), o texto só basta se não houver a
 * mesma palavra em outra correspondência. Ambíguo fica de fora, sem chutar.
 */
function textIndex(entries: { text: string; match: string; key: string }[]) {
  const exact = new Map<string, string>();
  const byText = new Map<string, string | null>();
  for (const { text, match, key } of entries) {
    exact.set(`${text}|${match}`, key);
    const cur = byText.get(text);
    byText.set(text, cur === undefined || cur === key ? key : null);
  }
  return (text: string, match: string) => (match ? exact.get(`${text}|${match}`) : byText.get(text)) || null;
}

/**
 * Palavras-chave: entity_id é "grupo~critério". Pelo targetid quando veio;
 * senão pelo texto (e correspondência, se veio) dentro do grupo do clique.
 */
export function keywordKey(keywords: { entity_id: string; ad_group_id: string | null; name: string; details?: any }[]): KeyOf {
  const byCriterion = new Map<string, string>();
  for (const k of keywords) byCriterion.set(k.entity_id.split('~')[1], k.entity_id);
  const find = textIndex(keywords.map(k => ({ text: `${k.ad_group_id}|${norm(k.name)}`, match: k.details?.match_type || '', key: k.entity_id })));
  return e => {
    if (e.criterion_id && byCriterion.has(e.criterion_id)) return byCriterion.get(e.criterion_id)!;
    if (!e.ad_group_id || !e.keyword) return null;
    return find(`${e.ad_group_id}|${norm(e.keyword)}`, matchTypeOf(e.match_type));
  };
}

/** Termos, vista "por palavra-chave": a chave da tela é "texto|correspondência". */
export function searchKeywordKey(rows: { keyword?: string | null; keyword_match_type?: string | null }[]): KeyOf {
  const find = textIndex(rows.filter(r => r.keyword).map(r => ({
    text: norm(r.keyword), match: r.keyword_match_type || '', key: `${r.keyword}|${r.keyword_match_type || ''}`,
  })));
  return e => (e.keyword ? find(norm(e.keyword), matchTypeOf(e.match_type)) : null);
}

/** Públicos · Dispositivo: MOBILE, DESKTOP, TABLET. */
export const deviceKey: KeyOf = e => (e.device ? `Device|${e.device}` : null);

/** Locais: o nome do país em português, como a aba mostra. */
export const countryKey: KeyOf = e => (e.country ? countryLabel(e.country) : null);

/** Valor em USD/BRL convertido para a moeda da tela pelo dólar manual (mesma regra da Visão Geral). */
export function toView(payload: ItemSalesPayload, viewCurrency: string, dollar: number): TrackedEvent[] {
  return payload.events.map(e => {
    let amount = Number(e.amount) || 0;
    const cur = (e.currency || 'USD').toUpperCase();
    if (viewCurrency === 'BRL' && cur === 'USD') amount *= dollar;
    else if (viewCurrency !== 'BRL' && cur === 'BRL') amount /= dollar;
    return { ...e, amount };
  });
}
