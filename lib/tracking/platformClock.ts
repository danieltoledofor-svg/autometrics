/**
 * Relógio de cada plataforma de venda.
 *
 * A venda entra no dia em que aconteceu no relógio da plataforma, para o dia do
 * Autometrics fechar igual ao relatório dela. Cada usuário escolhe o relógio de
 * cada plataforma em Rastreamento → Instalação (user_settings.platform_clocks);
 * sem escolha, vale o padrão abaixo. Serve no servidor e no navegador.
 *
 * O valor é um fuso que o Intl entende. Nos fixos o sinal é invertido:
 * "Etc/GMT+4" é GMT−4.
 */

const fixed = (offset: number) => (offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset < 0 ? '+' : '-'}${Math.abs(offset)}`);

/** Horário de Brasília, que não muda no verão. */
export const BRASILIA_CLOCK = fixed(-3);

/** Padrão de cada plataforma. A BuyGoods trabalha em GMT−4; as outras ficam em Brasília até serem ajustadas. */
const DEFAULT_CLOCKS: Record<string, string> = { buygoods: fixed(-4) };

export const CLOCK_OPTIONS: { value: string; label: string }[] = [
  ...Array.from({ length: 27 }, (_, i) => i - 12).map(o => ({
    value: fixed(o),
    label: `GMT${o === 0 ? '' : o < 0 ? `−${-o}` : `+${o}`}${o === -3 ? ' (Brasília)' : ''}`,
  })),
  { value: 'America/New_York', label: 'Nova York (muda sozinho no horário de verão)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (muda sozinho no horário de verão)' },
  { value: 'Europe/Berlin', label: 'Berlim (muda sozinho no horário de verão)' },
];

/** "BuyGoods", "buygoods" e "Buy Goods" são a mesma plataforma. */
export const platformKey = (source: string) => String(source || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const valid = (zone: unknown): zone is string => {
  if (typeof zone !== 'string' || !zone) return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); return true; } catch { return false; }
};

/** O relógio de uma plataforma: o escolhido pelo usuário, ou o padrão. */
export function clockOf(source: string, saved?: Record<string, unknown> | null): string {
  const key = platformKey(source);
  const chosen = saved?.[key];
  return valid(chosen) ? chosen : DEFAULT_CLOCKS[key] || BRASILIA_CLOCK;
}

/** O dia (AAAA-MM-DD) de um instante num relógio. */
export function dayInClock(zone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** A hora de agora num relógio, para conferir na tela. */
export function timeInClock(zone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: zone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at).replace(',', '');
}
