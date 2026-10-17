/**
 * Duas regras de margem, as mesmas no Telegram (lib/alerts/run.ts) e no aviso
 * da Dashboard. Resultado = receita − reembolsos − custo, na moeda da conta.
 *
 * - custo passando da receita: hoje a campanha já vendeu, mas o custo empatou
 *   com a receita ou passou dela (lucro abaixo de X% do custo). Sem venda no
 *   dia quem avisa é o "Gasto sem venda".
 * - dia apertado seguido de manhã ruim: ontem fechou com lucro pequeno (até X%
 *   do custo) e hoje, a partir do horário escolhido, o custo já passou da receita.
 */

export interface DaySum { cost: number; revenue: number; refunds: number; sales: number }

const result = (d: DaySum) => d.revenue - d.refunds - d.cost;

export interface LossAlert {
  /** perdendo = custo acima da receita; empatado = lucro abaixo da margem escolhida. */
  level: 'perdendo' | 'empatado';
  result: number;
  /** Lucro sobre o custo, em %: −12 = perdeu 12% do que gastou. */
  margin: number;
}

/** marginPct: avisa quando o lucro do dia fica abaixo desta parte do custo (10 = 10%). */
export function lossAlert(today: DaySum, marginPct = 10): LossAlert | null {
  if (today.sales <= 0 || today.cost <= 0) return null;
  const r = result(today);
  const margin = (r / today.cost) * 100;
  if (margin >= marginPct) return null;
  return { level: r < 0 ? 'perdendo' : 'empatado', result: r, margin };
}

export interface TurnAlert { yesterday: number; yesterdayMargin: number; today: number; todayMargin: number }

/**
 * yesterdayPct: até quanto de lucro sobre o custo ontem conta como "apertado".
 * hourNow/fromHour: só confere a partir do horário escolhido (12 = meio-dia).
 * O gasto de hoje precisa ser de pelo menos 20% do de ontem, para não avisar
 * por centavos gastos de madrugada.
 */
export function turnAlert(yesterday: DaySum, today: DaySum, hourNow: number, yesterdayPct = 20, fromHour = 12): TurnAlert | null {
  if (hourNow < fromHour || yesterday.cost <= 0 || yesterday.revenue <= 0 || today.cost <= 0) return null;
  const y = result(yesterday), t = result(today);
  const yMargin = (y / yesterday.cost) * 100;
  if (yMargin < 0 || yMargin > yesterdayPct) return null;
  if (t >= 0 || today.cost < yesterday.cost * 0.2) return null;
  return { yesterday: y, yesterdayMargin: yMargin, today: t, todayMargin: (t / today.cost) * 100 };
}
