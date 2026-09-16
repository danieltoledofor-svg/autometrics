/**
 * Ordenação das campanhas por métrica financeira.
 *
 * O padrão é custo decrescente: o que mais consome orçamento é o que precisa
 * ser visto primeiro. Receita e lucro ficam disponíveis para as outras leituras.
 */

export type MetricSort = 'cost' | 'revenue' | 'profit';

export const METRIC_SORTS: { key: MetricSort; label: string; color: string }[] = [
  { key: 'cost', label: 'Custo', color: 'text-orange-500' },
  { key: 'revenue', label: 'Receita', color: 'text-blue-500' },
  { key: 'profit', label: 'Lucro', color: 'text-emerald-500' },
];

const STORAGE_KEY = 'autometrics_metric_sort';

export function loadMetricSort(): MetricSort {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'cost' || saved === 'revenue' || saved === 'profit') return saved;
  } catch (e) { /* localStorage indisponível */ }
  return 'cost';
}

export function saveMetricSort(sort: MetricSort) {
  try { localStorage.setItem(STORAGE_KEY, sort); } catch (e) { /* ignora */ }
}

/**
 * Maior primeiro. Lucro pode ser negativo, então a comparação é numérica pura —
 * campanha no prejuízo cai para o fim da lista, que é onde se espera encontrá-la.
 */
export function sortByMetric<T>(items: T[], sort: MetricSort, pick: (item: T) => Partial<Record<MetricSort, number>>): T[] {
  return [...items].sort((a, b) => (Number(pick(b)[sort]) || 0) - (Number(pick(a)[sort]) || 0));
}
