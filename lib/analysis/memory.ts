import { supabaseAdmin } from '@/lib/googleAds/server';
import type { ItemKey, Reference, Row } from './compute';
import { ACTIONS } from './actions';

/**
 * Memória geral da IA.
 *
 * Cada sugestão avaliada vira uma linha em ai_learnings com a situação em
 * termos gerais (faixa do CPA, tipo de correspondência, dispositivo…) e o
 * resultado. Não entra nome de campanha, termo, conta nem usuário. Para a IA
 * volta só a contagem por situação — ela não tem como saber, nem citar, de
 * onde veio.
 */

export interface Situation {
  item: ItemKey;
  mode: Reference['mode'];
  faixa: string;          // faixa do CPA ou do gasto sem venda sobre a referência
  com_venda: boolean;
  tipo: string | null;    // correspondência do termo, dispositivo, faixa de público, tipo do recurso
  peso: string;           // parte do gasto da campanha em 3 dias
}

export function situationFor(item: ItemKey, row: Row, ref: Reference, campaignCost3: number): Situation {
  const p = row.pct ?? 0;
  const faixa = row.conv3 > 0
    ? (p < 0.9 ? '80-90%' : p <= 1.1 ? '90-110%' : p <= 1.5 ? '110-150%' : 'acima de 150%')
    : (p < 0.5 ? 'sem venda, até 50%' : p <= 1 ? 'sem venda, 50-100%' : 'sem venda, acima de 100%');
  const share = campaignCost3 > 0 ? row.cost3 / campaignCost3 : 0;
  let tipo: string | null = null;
  if (item === 'termos') tipo = row.tag || null;
  else if (item === 'dispositivos') tipo = row.key;
  else if (item === 'publicos') tipo = /UNDETERMINED|UNKNOWN/.test(row.extra?.code || '') ? `${row.extra?.type} desconhecido` : row.extra?.type || null;
  else if (item === 'sitelinks') tipo = row.tag || null;
  return {
    item, mode: ref.mode, faixa, com_venda: row.conv3 > 0, tipo,
    peso: share < 0.1 ? 'menos de 10% do gasto' : share <= 0.25 ? '10-25% do gasto' : 'mais de 25% do gasto',
  };
}

export async function recordLearning(s: {
  id: string; item: string; action: string; situation: any; outcome: string; cpa_change?: number | null; waste_change?: number | null;
}) {
  await supabaseAdmin().from('ai_learnings').upsert({
    item: s.item, action: s.action, situation: s.situation, outcome: s.outcome,
    cpa_change: s.cpa_change ?? null, waste_change: s.waste_change ?? null, source_id: s.id,
  }, { onConflict: 'source_id' });
}

const OUTCOME_PT: Record<string, string> = { funcionou: 'funcionou', piorou: 'piorou', sem_efeito: 'sem efeito', recusada: 'recusada pelo usuário' };

/**
 * Resumo da memória para o prompt: por item e alteração, e dentro disso pela
 * faixa da situação. Só contagens e médias.
 */
export async function learningsFor(items: ItemKey[]): Promise<string[]> {
  if (!items.length) return [];
  const { data } = await supabaseAdmin().from('ai_learnings')
    .select('item, action, situation, outcome, cpa_change')
    .in('item', items).order('created_at', { ascending: false }).limit(3000);
  if (!data?.length) return [];

  const groups = new Map<string, { n: number; out: Record<string, number>; cpa: number[] }>();
  for (const r of data) {
    const s = r.situation || {};
    const key = [r.item, r.action, s.faixa || '', s.tipo || ''].join(' · ');
    const g = groups.get(key) || { n: 0, out: {}, cpa: [] };
    g.n++;
    g.out[r.outcome] = (g.out[r.outcome] || 0) + 1;
    if (r.cpa_change !== null && r.cpa_change !== undefined && r.outcome !== 'recusada') g.cpa.push(Number(r.cpa_change));
    groups.set(key, g);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 40)
    .map(([key, g]) => {
      const [item, action, ...rest] = key.split(' · ');
      const outs = Object.entries(g.out).map(([o, c]) => `${OUTCOME_PT[o] || o} ${c}`).join(', ');
      const cpa = g.cpa.length ? `; CPA da campanha em média ${fmtPct(avg(g.cpa))}` : '';
      return `${item} · ${ACTIONS[action] || action} · ${rest.filter(Boolean).join(' · ') || 'geral'}: ${g.n}× (${outs}${cpa})`;
    });
}

/** Resultados desta campanha — esses podem citar nome, porque são do próprio usuário. */
export async function campaignHistory(productId: string, limit = 20) {
  const { data } = await supabaseAdmin().from('analysis_suggestions')
    .select('id, item, target_label, action, text, status, outcome, change_at, change, eval_7d, eval_3d, baseline, created_at')
    .eq('product_id', productId)
    .in('status', ['aplicada', 'avaliada', 'nao_faz_sentido'])
    .order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

const avg = (l: number[]) => l.reduce((s, x) => s + x, 0) / l.length;
const fmtPct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x)}%`;
