/**
 * Nomes em português para o que o Google devolve em inglês: países e idiomas.
 * O Google manda o código (US, pt) e o nome em inglês; o nome em português sai
 * do próprio JavaScript, sem lista escrita à mão.
 */

const display = (type: 'region' | 'language') => { try { return new Intl.DisplayNames(['pt-BR'], { type }); } catch { return null; } };
const regions = display('region'), languages = display('language');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "US" → "Estados Unidos". */
export function countryName(code?: string | null): string {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  try { const n = regions?.of(c); return n && n !== c ? n : ''; } catch { return ''; }
}

/** País em português; estado ou cidade com o nome do Google e o país em português ("Texas, Estados Unidos"). */
export function placeName(g: { name?: string; canonicalName?: string; countryCode?: string; targetType?: string }): string {
  const country = countryName(g.countryCode);
  if (g.targetType === 'Country') return country || g.name || g.canonicalName || '';
  const own = g.name || String(g.canonicalName || '').split(',')[0];
  return country && own ? `${own}, ${country}` : g.canonicalName || own || '';
}

/** "en" → "Inglês"; "zh_CN" → "Chinês (China)". Sem tradução, fica o nome do Google. */
export function languageName(code?: string | null, fallback = ''): string {
  const c = String(code || '').replace('_', '-');
  if (!c) return fallback;
  try { const n = languages?.of(c); return n && n.toLowerCase() !== c.toLowerCase() ? cap(n) : fallback || c; } catch { return fallback || c; }
}
