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

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Nome de país (em português ou em inglês) → sigla. Montado uma vez, a partir dos nomes que o próprio JavaScript conhece. */
let countryIndex: Map<string, string> | null = null;
const ALIASES: Record<string, string> = { eua: 'US', usa: 'US', 'estados unidos da america': 'US', uk: 'GB', inglaterra: 'GB', 'gra bretanha': 'GB', 'great britain': 'GB', england: 'GB', holanda: 'NL', holland: 'NL', 'coreia': 'KR', korea: 'KR', russia: 'RU', 'emirados arabes': 'AE', uae: 'AE', 'republica tcheca': 'CZ', 'czech republic': 'CZ', turquia: 'TR', turkey: 'TR' };

/** "Estados Unidos", "united states", "EUA" ou "US" → "US". Vazio quando o texto não é um país conhecido. */
export function countryCode(text?: string | null): string {
  const raw = String(text || '').trim();
  if (!countryIndex) {
    countryIndex = new Map();
    let english: Intl.DisplayNames | null = null;
    try { english = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* sem nomes em inglês */ }
    // A primeira sigla de cada nome é a que vale: "Reino Unido" é GB, e UK é só um apelido que o JavaScript também aceita.
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of letters) for (const b of letters) {
      const code = a + b;
      for (const names of [regions, english]) { try { const n = names?.of(code); if (n && n !== code && !countryIndex.has(fold(n))) countryIndex.set(fold(n), code); } catch { /* sigla que não é país */ } }
    }
    for (const [name, code] of Object.entries(ALIASES)) countryIndex.set(name, code);
  }
  const byName = countryIndex.get(fold(raw));
  if (byName) return byName;
  return /^[A-Za-z]{2}$/.test(raw) && countryName(raw) ? raw.toUpperCase() : '';
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
