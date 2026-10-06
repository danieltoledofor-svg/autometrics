/**
 * Regra do alerta de gasto, a mesma no Dashboard e no Telegram.
 *
 * O "normal" da campanha é a média dos dias com gasto nos 7 dias anteriores
 * (pelo menos 3). Dois gatilhos:
 * - passou: hoje já gastou 1,5× um dia normal inteiro (e pelo menos 10 a mais);
 * - ritmo: com pelo menos 6 horas de dia, está no ritmo de fechar em 2× ou mais.
 * Valores na moeda da conta.
 */

export interface SpendAlert {
  kind: 'passou' | 'ritmo';
  normal: number;
  /** Projeção do dia inteiro no ritmo atual (0 fora da janela de 6h a 21h36). */
  pace: number;
  /** Quantas vezes o normal: 1.8 = 80% acima. */
  over: number;
}

export function spendAlert(today: number, pastSum: number, pastDays: number, dayPart: number): SpendAlert | null {
  if (pastDays < 3 || today < 10) return null;
  const normal = pastSum / pastDays;
  const pace = dayPart >= 0.25 && dayPart < 0.9 ? today / dayPart : 0;
  if (today >= normal * 1.5 && today - normal >= 10) return { kind: 'passou', normal, pace, over: today / normal };
  if (pace >= normal * 2 && today >= normal * 0.6) return { kind: 'ritmo', normal, pace, over: pace / normal };
  return null;
}
