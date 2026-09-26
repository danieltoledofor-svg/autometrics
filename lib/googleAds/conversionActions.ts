import type { ActionCounts } from '@/lib/metrics/dimension';

/**
 * Conversões do Google separadas por ação de conversão (Checkout, Compra…).
 *
 * É o que a coluna personalizada do Google faz quando filtra "Todas as
 * conversões" por uma ação. Pela API, o mesmo sai do segmento
 * segments.conversion_action_name — que só aceita métricas de conversão, por
 * isso vem numa consulta à parte da de impressões e cliques.
 */

export const ACTION_SELECT = 'segments.conversion_action_name, metrics.all_conversions, metrics.conversions, metrics.all_conversions_value';
export const ACTION_WHERE = 'metrics.all_conversions > 0';

const n = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Soma a linha da API no mapa chave → ações. */
export function addActionRow(map: Map<string, ActionCounts>, key: string, r: any) {
  const name = r.segments?.conversionActionName;
  if (!name) return;
  const actions = map.get(key) || {};
  const cur = actions[name] || { a: 0, c: 0, v: 0 };
  cur.a = n(cur.a) + n(r.metrics?.allConversions);
  cur.c = n(cur.c) + n(r.metrics?.conversions);
  cur.v = n(cur.v) + n(r.metrics?.allConversionsValue);
  actions[name] = cur;
  map.set(key, actions);
}

/** Forma comparável, para saber se o dia mudou desde a última gravação. */
export function stableActions(ca: ActionCounts | null | undefined): string {
  if (!ca) return '';
  return Object.keys(ca).sort().map(k => {
    const v = ca[k] || {};
    return `${k}:${n(v.a).toFixed(3)}/${n(v.c).toFixed(3)}/${n(v.v).toFixed(2)}`;
  }).join('|');
}
