/**
 * Catálogo dos alertas do Telegram: o que cada um faz, se já vem ligado e os
 * números que o usuário pode ajustar. A tela (Integração → Telegram) e a
 * rotina (lib/alerts/run.ts) leem daqui.
 */

export type AlertKey = 'gasto' | 'suspensa' | 'sem_venda' | 'cpa' | 'venda' | 'parou' | 'ajuste' | 'resumo' | 'coleta';

export interface AlertParam { key: string; label: string; unit: string; min: number; max: number; step: number; value: number | null }
export interface AlertInfo { key: AlertKey; title: string; when: string; on: boolean; params: AlertParam[] }

export const ALERTS: AlertInfo[] = [
  { key: 'gasto', title: 'Gasto acima do normal', on: true,
    when: 'A campanha já gastou bem mais que um dia normal dela, ou está no ritmo de fechar o dia muito acima.',
    params: [
      { key: 'mult', label: 'Avisar quando já gastou', unit: '× um dia normal', min: 1.1, max: 5, step: 0.1, value: 1.5 },
      { key: 'pace', label: 'Ou quando o ritmo aponta para', unit: '× um dia normal', min: 1.2, max: 6, step: 0.1, value: 2 },
    ] },
  { key: 'suspensa', title: 'Campanha parou de aparecer', on: true,
    when: 'Conta suspensa, campanha suspensa ou campanha que o Google deixou de mostrar, entre as que gastaram nos últimos 7 dias. A mensagem diz qual é o caso e o motivo.', params: [] },
  { key: 'sem_venda', title: 'Gasto sem venda', on: true,
    when: 'A campanha gastou hoje mais que o valor de uma venda dela e não vendeu.',
    params: [{ key: 'mult', label: 'Avisar quando o gasto do dia passar de', unit: '× o valor de uma venda', min: 0.5, max: 5, step: 0.1, value: 1 }] },
  { key: 'cpa', title: 'CPA acima do limite', on: false,
    when: 'O CPA dos últimos 3 dias fechados passou do valor que você definir. Só funciona com o limite preenchido.',
    params: [{ key: 'limit', label: 'Limite de CPA', unit: 'na moeda da conta', min: 1, max: 100000, step: 1, value: null }] },
  { key: 'venda', title: 'Venda nova', on: false,
    when: 'Cada vez que entram vendas novas numa campanha, com o total do dia.', params: [] },
  { key: 'parou', title: 'Campanha parou de gastar', on: true,
    when: 'Gastou em pelo menos 5 dos últimos 7 dias, está ativa e hoje não gastou nada até o horário escolhido.',
    params: [{ key: 'hour', label: 'Conferir a partir das', unit: 'horas', min: 6, max: 22, step: 1, value: 12 }] },
  { key: 'ajuste', title: 'Resultado de um ajuste', on: true,
    when: 'Saiu a conferência de 3 ou de 7 dias de uma alteração feita na campanha: melhorou, piorou ou ficou igual.', params: [] },
  { key: 'resumo', title: 'Resumo do dia', on: true,
    when: 'Uma mensagem por dia com custo, vendas, CPA e resultado de todas as campanhas.',
    params: [{ key: 'hour', label: 'Enviar às', unit: 'horas', min: 6, max: 23, step: 1, value: 21 }] },
  { key: 'coleta', title: 'Problema na coleta do Google', on: true,
    when: 'Uma conta sua deu erro ao ser lida do Google.', params: [] },
];

export interface AlertSettings {
  quiet: { on: boolean; from: number; to: number };
  alerts: Record<AlertKey, { on: boolean; [param: string]: any }>;
}

const clamp = (v: any, p: AlertParam) => {
  if (v === null || v === undefined || v === '') return p.value;
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(p.max, Math.max(p.min, x)) : p.value;
};
const hour = (v: any, fallback: number) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) && x >= 0 && x <= 23 ? x : fallback;
};

/** Preferências gravadas + padrão de cada alerta, com os números dentro do permitido. */
export function resolveSettings(raw: any): AlertSettings {
  const saved = raw?.alerts || {};
  const alerts = {} as AlertSettings['alerts'];
  for (const a of ALERTS) {
    const s = saved[a.key] || {};
    alerts[a.key] = { on: typeof s.on === 'boolean' ? s.on : a.on };
    for (const p of a.params) alerts[a.key][p.key] = clamp(s[p.key], p);
  }
  const q = raw?.quiet || {};
  return { quiet: { on: q.on !== false, from: hour(q.from, 23), to: hour(q.to, 7) }, alerts };
}

/** Dentro do horário de silêncio? Aceita faixa que vira o dia (23h às 7h). */
export function isQuiet(s: AlertSettings, hourNow: number) {
  if (!s.quiet.on || s.quiet.from === s.quiet.to) return false;
  return s.quiet.from < s.quiet.to ? hourNow >= s.quiet.from && hourNow < s.quiet.to : hourNow >= s.quiet.from || hourNow < s.quiet.to;
}
