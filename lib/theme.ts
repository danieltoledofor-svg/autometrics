export type Theme = 'dark' | 'light';

/**
 * Espelha o tema no <html data-theme>.
 *
 * O tema vive no estado de cada página, mas os controles nativos (popup do
 * <select>, calendário do <input type="date">) são desenhados pelo sistema e
 * não enxergam classe nenhuma do React — só o `color-scheme` que o CSS aplica
 * a partir deste atributo. Sem ele, no Windows as opções ficam brancas sobre
 * branco.
 */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}
