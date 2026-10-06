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

export interface ChangeItem { area: ChangeArea; text: string }
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
  private map = new Map<string, { area: ChangeArea; one: string; many: string; names: string[] }>();
  add(area: ChangeArea, one: string, many: string, name?: string | null) {
    const k = `${area}|${one}`;
    if (!this.map.has(k)) this.map.set(k, { area, one, many, names: [] });
    const b = this.map.get(k)!;
    b.names.push(name || '');
  }
  items(): ChangeItem[] {
    return [...this.map.values()].map(b => {
      const named = [...new Set(b.names.filter(Boolean))];
      const list = named.length ? ` (${named.slice(0, 4).join(', ')}${named.length > 4 ? ` e mais ${named.length - 4}` : ''})` : '';
      return { area: b.area, text: b.names.length === 1 ? `${b.one}${named[0] ? ` ${named[0]}` : ''}` : `${b.names.length} ${b.many}${list}` };
    });
  }
}

function describe(changes: any[], currency: string): { items: ChangeItem[]; created: boolean } {
  const bucket = new Bucket();
  const direct: ChangeItem[] = [];
  let created = false;
  const money = (v: any) => formatMoney(num(v), currency);
  const fromTo = (f: any, fmt: (v: any) => string = String) => (f.de && f.para ? `de ${fmt(f.de)} para ${fmt(f.para)}` : f.para ? `para ${fmt(f.para)}` : `retirado (era ${fmt(f.de)})`);
  const onOff = (f: any, what: 'Grupo' | 'Anúncio' | 'Palavra-chave', area: ChangeArea, name?: string | null) => {
    const fem = what === 'Palavra-chave';
    const many = fem ? 'palavras-chave' : `${what.toLowerCase()}s`;
    const verb = f.para === 'PAUSED' ? 'pausad' : f.para === 'ENABLED' ? 'reativad' : f.para === 'REMOVED' ? 'removid' : '';
    if (verb) bucket.add(area, `${what} ${verb}${fem ? 'a' : 'o'}`, `${many} ${verb}${fem ? 'as' : 'os'}`, name);
  };

  for (const c of changes) {
    const type = String(c.resource_type || ''), op = String(c.operation || '');
    const fields: any[] = Array.isArray(c.fields) ? c.fields : [];
    const get = (name: string) => fields.find(f => f.f === name || String(f.f).endsWith(`.${name}`));
    const val = (name: string) => { const f = get(name); return f ? String(f.para || f.de || '') : ''; };

    if (type === 'CAMPAIGN' && op === 'CREATE') { created = true; continue; }
    if (type === 'CAMPAIGN_BUDGET') {
      const f = get('amount_micros');
      if (op === 'UPDATE' && f) direct.push({ area: 'campanha', text: `Orçamento ${fromTo(f, money)}` });
      continue;
    }
    if (type === 'CAMPAIGN' && op === 'UPDATE') {
      for (const f of fields) {
        if (f.f === 'status') direct.push({ area: 'campanha', text: f.para === 'PAUSED' ? 'Campanha pausada' : f.para === 'ENABLED' ? 'Campanha reativada' : `Campanha ${String(f.para).toLowerCase()}` });
        else if (/target_cpa_micros$/.test(f.f)) direct.push({ area: 'campanha', text: `Meta de CPA ${fromTo(f, money)}` });
        else if (/target_roas$/.test(f.f)) direct.push({ area: 'campanha', text: `Meta de ROAS ${fromTo(f)}` });
        else if (/cpc_bid_ceiling_micros$/.test(f.f)) direct.push({ area: 'campanha', text: `Limite de CPC ${fromTo(f, money)}` });
        else if (/bidding_strategy_type$/.test(f.f)) direct.push({ area: 'campanha', text: `Estratégia de lances ${fromTo(f)}` });
        else if (/^network_settings\./.test(f.f)) bucket.add('campanha', 'Redes da campanha alteradas', 'ajustes nas redes da campanha');
        else if (/geo_target_type/.test(f.f)) direct.push({ area: 'segmentacao', text: `Regra de local ${f.para === 'PRESENCE' ? 'só quem está no local' : 'quem está ou tem interesse no local'}` });
      }
      continue;
    }
    if (type === 'AD_GROUP') {
      if (op === 'CREATE') { bucket.add('grupos', 'Grupo de anúncios criado:', 'grupos de anúncios criados', val('name')); continue; }
      for (const f of fields) {
        if (f.f === 'status') onOff(f, 'Grupo', 'grupos');
        else if (/target_cpa_micros$/.test(f.f)) direct.push({ area: 'grupos', text: `Meta de CPA do grupo ${fromTo(f, money)}` });
        else if (/cpc_bid_micros$/.test(f.f)) direct.push({ area: 'grupos', text: `Lance do grupo ${fromTo(f, money)}` });
      }
      continue;
    }
    if (type === 'AD_GROUP_CRITERION' || type === 'CAMPAIGN_CRITERION' || type === 'SHARED_CRITERION') {
      const text = val('text');
      const negative = get('negative') ? String(get('negative').para || get('negative').de) === 'true' : type === 'SHARED_CRITERION';
      if (text) {
        const label = keywordLabel(text, val('match_type'));
        if (op === 'CREATE') negative ? bucket.add('palavras', 'Negativa incluída:', 'negativas incluídas', label) : bucket.add('palavras', 'Palavra-chave incluída:', 'palavras-chave incluídas', label);
        else if (op === 'REMOVE') negative ? bucket.add('palavras', 'Negativa removida:', 'negativas removidas', label) : bucket.add('palavras', 'Palavra-chave removida:', 'palavras-chave removidas', label);
        continue;
      }
      const status = get('status'), bid = get('bid_modifier');
      if (op === 'UPDATE' && bid) { direct.push({ area: type === 'AD_GROUP_CRITERION' ? 'palavras' : 'segmentacao', text: `Ajuste de lance ${fromTo(bid, v => `${Math.round((num(v) - 1) * 100)}%`)}` }); continue; }
      if (op === 'UPDATE' && status && type === 'AD_GROUP_CRITERION') { onOff(status, 'Palavra-chave', 'palavras'); continue; }
      const age = val('age_range.type') || val('type');
      if (get('age_range.type')) { bucket.add('segmentacao', op === 'REMOVE' ? 'Faixa de idade removida:' : 'Faixa de idade ajustada:', 'faixas de idade ajustadas', audienceLabel('Age', age)); continue; }
      if (get('gender.type')) { bucket.add('segmentacao', 'Gênero ajustado:', 'ajustes de gênero', audienceLabel('Gender', val('gender.type'))); continue; }
      if (get('income_range.type')) { bucket.add('segmentacao', 'Faixa de renda ajustada', 'faixas de renda ajustadas'); continue; }
      bucket.add('segmentacao', op === 'REMOVE' ? 'Segmentação removida' : op === 'CREATE' ? 'Segmentação incluída (local, público ou idioma)' : 'Segmentação alterada', op === 'REMOVE' ? 'segmentações removidas' : op === 'CREATE' ? 'segmentações incluídas (local, público ou idioma)' : 'segmentações alteradas');
      continue;
    }
    if (type === 'AD_GROUP_BID_MODIFIER') {
      const bid = get('bid_modifier');
      if (op !== 'REMOVE' && bid) direct.push({ area: 'segmentacao', text: `Ajuste de lance em ${deviceLabel(val('type'))}: ${Math.round((num(bid.para) - 1) * 100)}%` });
      else bucket.add('segmentacao', 'Ajuste de lance por dispositivo removido', 'ajustes de lance por dispositivo removidos');
      continue;
    }
    if (type === 'AD_GROUP_AD') {
      if (op === 'CREATE') bucket.add('anuncios', 'Anúncio criado', 'anúncios criados');
      else if (op === 'REMOVE') bucket.add('anuncios', 'Anúncio removido', 'anúncios removidos');
      else if (get('status')) onOff(get('status'), 'Anúncio', 'anuncios');
      continue;
    }
    if (type === 'AD') {
      if (fields.some(f => /headlines|descriptions/.test(f.f))) bucket.add('anuncios', 'Títulos ou descrições do anúncio alterados', 'anúncios com títulos ou descrições alterados');
      else if (fields.some(f => /final_urls/.test(f.f))) bucket.add('anuncios', 'Página do anúncio alterada', 'anúncios com a página alterada');
      continue;
    }
    if (type === 'CAMPAIGN_ASSET' || type === 'AD_GROUP_ASSET' || type === 'ASSET') {
      const kind = ASSET_PT[val('field_type')] ? ` (${ASSET_PT[val('field_type')]})` : '';
      if (op === 'REMOVE') bucket.add('recursos', `Recurso removido${kind}`, `recursos removidos${kind}`);
      else if (op === 'CREATE') bucket.add('recursos', `Recurso incluído${kind}`, `recursos incluídos${kind}`);
      else bucket.add('recursos', 'Recurso alterado', 'recursos alterados');
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
  if (!changes.length) return [];
  const currency = String(product.currency || 'USD').toUpperCase();
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
