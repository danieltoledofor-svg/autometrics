import { supabaseAdmin } from '@/lib/googleAds/server';
import { addDays } from './compute';
import { recordLearning } from './memory';

/**
 * Acompanhamento das sugestões.
 *
 * 1. Procura no histórico do Google (google_ads_changes) a alteração que a
 *    sugestão apontou, feita depois dela. Não depende de o usuário marcar nada.
 * 2. Três e sete dias depois da alteração, compara com os sete dias antes:
 *    CPA da campanha e, quando o item gastava sem vender, o gasto dele.
 * 3. O resultado de 7 dias vai para a memória geral.
 *
 * Regras do resultado:
 * - item que gastava sem venda: funcionou se o gasto dele caiu pela metade e o
 *   CPA da campanha não subiu mais de 10%; piorou se o CPA subiu mais de 10%;
 * - item com venda: funcionou se o CPA da campanha caiu 5% ou mais sem perder
 *   mais de 30% das vendas por dia; piorou se subiu 5% ou mais, ou se as
 *   vendas por dia caíram mais de 30%.
 */

const num = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

function matches(s: any, ch: any): boolean {
  const type = String(ch.resource_type || '');
  const res = String(ch.resource_name || '');
  const blob = JSON.stringify(ch.new_resource || {}) + JSON.stringify(ch.fields || []);
  const tail = (id: string) => res.endsWith(`/${id}`) || res.endsWith(`~${id}`);
  switch (s.action) {
    case 'negativa': {
      if (!['AD_GROUP_CRITERION', 'CAMPAIGN_CRITERION', 'SHARED_CRITERION'].includes(type) || ch.operation !== 'CREATE') return false;
      if (type !== 'SHARED_CRITERION' && !/"negative":\s*true/.test(blob)) return false;
      const text = blob.match(/"text":\s*"([^"]+)"/)?.[1];
      if (!text) return false;
      const t = norm(text), term = norm(s.target_key);
      return !!t && (` ${term} `.includes(` ${t} `) || term === t);
    }
    case 'lance_palavra':
    case 'pausar_palavra': {
      const id = s.baseline?.keyword_entity_id || (s.item === 'palavras_chave' ? s.target_key : null);
      return type === 'AD_GROUP_CRITERION' && ch.operation === 'UPDATE' && !!id && tail(id);
    }
    case 'ajuste_dispositivo':
      return /CRITERION|BID_MODIFIER/.test(type) && blob.includes(`"${s.target_key}"`) && /device/i.test(blob);
    case 'ajuste_publico':
    case 'excluir_publico': {
      const code = String(s.target_key).split('|')[1];
      return /CRITERION|BID_MODIFIER/.test(type) && !!code && blob.includes(`"${code}"`);
    }
    case 'ajuste_local':
    case 'excluir_local':
      return type === 'CAMPAIGN_CRITERION' && /location|geoTarget/i.test(blob);
    case 'pausar_anuncio':
    case 'trocar_texto': {
      const adId = String(s.target_key).split('~').pop()!;
      return (type === 'AD_GROUP_AD' || type === 'AD') && tail(adId);
    }
    case 'trocar_sitelink':
    case 'remover_sitelink': {
      const assetId = String(s.target_key).split('~').pop()!;
      return (type === 'CAMPAIGN_ASSET' || type === 'ASSET') && res.includes(assetId);
    }
    default:
      return false;
  }
}

/** Sugestões abertas que já foram feitas no Google. */
export async function detectApplied(productId: string, timeZone: string | null) {
  const db = supabaseAdmin();
  const { data: open } = await db.from('analysis_suggestions').select('*')
    .eq('product_id', productId).eq('status', 'aberta').neq('action', 'ajuste_pagina');
  if (!open?.length) return 0;
  const since = open.map(s => localDate(s.created_at, timeZone)).sort()[0];
  const { data: changes, error } = await db.from('google_ads_changes')
    .select('changed_at, resource_type, operation, resource_name, fields, new_resource')
    .eq('product_id', productId).gte('changed_at', `${since} 00:00:00`).order('changed_at');
  if (error || !changes?.length) return 0;
  let applied = 0;
  for (const s of open) {
    const created = localDateTime(s.created_at, timeZone);
    const ch = changes.find(c => c.changed_at >= created && matches(s, c));
    if (!ch) continue;
    await db.from('analysis_suggestions').update({
      status: 'aplicada',
      change_at: new Date(`${ch.changed_at.replace(' ', 'T')}Z`).toISOString(),
      change: { changed_at: ch.changed_at, type: ch.resource_type, operation: ch.operation, fields: ch.fields },
      updated_at: new Date().toISOString(),
    }).eq('id', s.id);
    applied++;
  }
  return applied;
}

/** Mudança na página: quem aplica é a releitura da página (run.ts). */
export async function markPageApplied(productId: string, checkedAt: string) {
  await supabaseAdmin().from('analysis_suggestions').update({
    status: 'aplicada', change_at: checkedAt,
    change: { changed_at: checkedAt.slice(0, 19).replace('T', ' '), type: 'PAGINA', operation: 'UPDATE' },
    updated_at: new Date().toISOString(),
  }).eq('product_id', productId).eq('status', 'aberta').eq('action', 'ajuste_pagina');
}

function localDateTime(iso: string, tz: string | null) {
  const d = new Date(iso);
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d);
    const g = (t: string) => p.find(x => x.type === t)?.value || '00';
    return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:${g('second')}`;
  } catch {
    return iso.slice(0, 19).replace('T', ' ');
  }
}
const localDate = (iso: string, tz: string | null) => localDateTime(iso, tz).slice(0, 10);

// ── avaliação ───────────────────────────────────────────────────────────────

async function campaignWindow(productId: string, from: string, to: string, source: string) {
  const { data } = await supabaseAdmin().from('daily_metrics')
    .select('date, cost, conversions, google_conversions')
    .eq('product_id', productId).gte('date', from).lte('date', to);
  const days = Math.max(1, (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000 + 1);
  const cost = (data || []).reduce((s, d) => s + num(d.cost), 0);
  const sales = (data || []).reduce((s, d) => s + num(source === 'real' ? d.conversions : d.google_conversions), 0);
  return { cost, sales, days, cpa: sales > 0 ? cost / sales : null, cost_day: cost / days, sales_day: sales / days };
}

async function itemWindow(s: any, from: string, to: string) {
  const db = supabaseAdmin();
  const days = Math.max(1, (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000 + 1);
  let rows: any[] = [];
  const base = (table: string, cols = 'cost, conversions') => db.from(table).select(cols).eq('product_id', s.product_id).gte('date', from).lte('date', to);
  if (s.item === 'termos') rows = (await base('search_terms').eq('search_term', s.target_key)).data || [];
  else if (s.item === 'palavras_chave') rows = (await base('google_ads_entity_metrics').eq('level', 'keyword').eq('entity_id', s.target_key)).data || [];
  else if (s.item === 'anuncios') rows = (await base('google_ads_entity_metrics').eq('level', 'ad').eq('entity_id', s.target_key)).data || [];
  else if (s.item === 'sitelinks') rows = (await base('google_ads_entity_metrics').eq('level', 'asset').eq('entity_id', s.target_key)).data || [];
  else if (s.item === 'dispositivos') rows = (await base('audiences').eq('audience_type', 'Device').eq('audience_name', s.target_key)).data || [];
  else if (s.item === 'publicos') {
    const [type, code] = String(s.target_key).split('|');
    rows = (await base('audiences').eq('audience_type', type).eq('audience_name', code)).data || [];
  } else if (s.item === 'locais') rows = (await base('locations').eq('location_name', s.target_key)).data || [];
  const cost = rows.reduce((a, r) => a + num(r.cost), 0);
  const conv = rows.reduce((a, r) => a + num(r.conversions), 0);
  return { cost, conv, cost_day: cost / days };
}

const change = (before: number | null, after: number | null) =>
  before !== null && after !== null && before > 0 ? ((after - before) / before) * 100 : null;

function judge(s: any, before: any, after: any, itemBefore: any, itemAfter: any) {
  const cpaChange = change(before.cpa, after.cpa);
  const salesChange = change(before.sales_day, after.sales_day);
  const wasteChange = change(itemBefore.cost_day, itemAfter.cost_day);
  let outcome: 'funcionou' | 'piorou' | 'sem_efeito' = 'sem_efeito';
  if (!s.situation?.com_venda) {
    if (cpaChange !== null && cpaChange > 10) outcome = 'piorou';
    else if (wasteChange !== null && wasteChange <= -50) outcome = 'funcionou';
  } else {
    if ((salesChange !== null && salesChange < -30) || (cpaChange !== null && cpaChange >= 5)) outcome = 'piorou';
    else if (cpaChange !== null && cpaChange <= -5) outcome = 'funcionou';
  }
  const r = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
  return {
    outcome,
    cpa_before: before.cpa === null ? null : Math.round(before.cpa * 100) / 100,
    cpa_after: after.cpa === null ? null : Math.round(after.cpa * 100) / 100,
    cpa_change: r(cpaChange), sales_change: r(salesChange), waste_change: r(wasteChange),
    item_cost_day_before: Math.round(itemBefore.cost_day * 100) / 100,
    item_cost_day_after: Math.round(itemAfter.cost_day * 100) / 100,
  };
}

/** Avalia as aplicadas que já completaram 3 ou 7 dias. */
export async function evaluateApplied(productId: string, today: string) {
  const db = supabaseAdmin();
  const { data: list } = await db.from('analysis_suggestions').select('*')
    .eq('product_id', productId).eq('status', 'aplicada');
  let evaluated = 0;
  for (const s of list || []) {
    const d = String(s.change?.changed_at || s.change_at || '').slice(0, 10);
    if (!d) continue;
    const source = s.baseline?.sales_source || 'real';
    const before = await campaignWindow(productId, addDays(d, -7), addDays(d, -1), source);
    const itemBefore = await itemWindow(s, addDays(d, -7), addDays(d, -1));
    const patch: any = { updated_at: new Date().toISOString() };
    if (!s.eval_3d && today > addDays(d, 3)) {
      const to = addDays(d, 3);
      patch.eval_3d = judge(s, before, await campaignWindow(productId, addDays(d, 1), to, source), itemBefore, await itemWindow(s, addDays(d, 1), to));
    }
    if (today > addDays(d, 7)) {
      const to = addDays(d, 7);
      const ev = judge(s, before, await campaignWindow(productId, addDays(d, 1), to, source), itemBefore, await itemWindow(s, addDays(d, 1), to));
      patch.eval_7d = ev;
      patch.outcome = ev.outcome;
      patch.status = 'avaliada';
      await recordLearning({ id: s.id, item: s.item, action: s.action, situation: s.situation, outcome: ev.outcome, cpa_change: ev.cpa_change, waste_change: ev.waste_change });
    }
    if (Object.keys(patch).length > 1) {
      await db.from('analysis_suggestions').update(patch).eq('id', s.id);
      evaluated++;
    }
  }
  return evaluated;
}
