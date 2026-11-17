/**
 * Troca da página da campanha (anúncios e sitelinks de uma vez): a regra de
 * como cada endereço fica. Sem nada do servidor, para a prévia na tela e o
 * envio ao Google usarem exatamente a mesma conta.
 *
 * "Endereço base" é o domínio com o caminho (sem parâmetros e sem #âncora).
 * - Igual à página antiga, letra por letra: vira a página nova inteira.
 * - Mesmo endereço base, com algo próprio (#âncora, parâmetro que a antiga não
 *   tinha ou com outro valor): vira a página nova e mantém o que é próprio.
 * - Outro endereço base: fica como está (na prévia dá para marcar; aí vira a
 *   página nova inteira).
 *
 * Tudo em texto, sem new URL(), para não estragar {gclid}, {keyword} e afins.
 */

interface Parts { base: string; params: [string, string][]; hash: string | null }

function parts(url: string): Parts {
  const u = url.trim();
  const h = u.indexOf('#');
  const noHash = h < 0 ? u : u.slice(0, h), hash = h < 0 ? null : u.slice(h + 1);
  const q = noHash.indexOf('?');
  const base = q < 0 ? noHash : noHash.slice(0, q), query = q < 0 ? '' : noHash.slice(q + 1);
  const params = query.split('&').filter(Boolean).map(p => {
    const i = p.indexOf('=');
    return (i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]) as [string, string];
  });
  return { base, params, hash };
}

/** Domínio em minúsculas, sem a barra do fim: https://Site.com/vsl/ e https://site.com/vsl são o mesmo endereço. */
export const baseOf = (url: string) => parts(url).base.replace(/^(https?:\/\/[^/]+)/i, m => m.toLowerCase()).replace(/\/+$/, '');

export const validPage = (url: string) => /^https:\/\/[^\s/?#]+\.[^\s/?#]+[^\s]*$/i.test(url.trim()) && url.trim().length <= 2048;

/**
 * Como `url` fica quando a página `oldUrl` vira `newUrl`. null = outro endereço
 * base, não é a mesma página.
 */
export function swapUrl(url: string, oldUrl: string, newUrl: string): string | null {
  const u = url.trim(), from = oldUrl.trim(), to = newUrl.trim();
  if (!u || !from || !to) return null;
  if (u === from) return to;
  if (baseOf(u) !== baseOf(from)) return null;
  const item = parts(u), old = parts(from), next = parts(to);
  const oldValue = new Map(old.params);
  const params = [...next.params];
  for (const [k, v] of item.params) {
    if (oldValue.has(k) && oldValue.get(k) === v) continue;          // igual à página antiga: vale o da nova
    const at = params.findIndex(([nk]) => nk === k);
    if (at >= 0) params[at] = [k, v]; else params.push([k, v]);       // próprio deste item: fica
  }
  const hash = item.hash !== null ? item.hash : next.hash;
  const query = params.map(([k, v]) => (v === '' && !/=/.test(k) ? k : `${k}=${v}`)).join('&');
  return `${next.base}${query ? `?${query}` : ''}${hash !== null ? `#${hash}` : ''}`;
}

/** Um lugar onde a página aparece: um anúncio ou um sitelink (da campanha ou de um grupo). */
export interface PagePlace {
  id: string;                       // ad:grupo~anúncio · cs:<campaign_asset> · gs:<ad_group_asset>
  tipo: 'anuncio' | 'sitelink';
  nivel: 'campanha' | 'grupo' | null;
  nome: string;                     // primeiro título do anúncio ou o texto do sitelink
  grupo: string;
  status: string;
  url: string;
  celular: string;                  // página para celular, quando existe
  editavel: boolean;
  motivo: string;                   // por que não dá para trocar
  outros: number;                   // em quantos outros lugares (outras campanhas, grupos, a conta) o mesmo sitelink está
}

/** O que acontece com cada lugar, para a prévia e para o envio. */
export function planOf(place: PagePlace, oldUrl: string, newUrl: string, chosen: boolean | undefined) {
  const swapped = swapUrl(place.url, oldUrl, newUrl);
  const same = swapped !== null;
  const marked = chosen === undefined ? same : chosen;
  const depois = !place.editavel || !marked ? place.url : (swapped ?? newUrl.trim());
  const celular = place.celular && marked && place.editavel ? (swapUrl(place.celular, oldUrl, newUrl) ?? place.celular) : place.celular;
  return { same, marked: marked && place.editavel, depois, celular, muda: place.editavel && marked && (depois !== place.url || celular !== place.celular) };
}

/** As páginas dos anúncios de hoje, a mais usada primeiro (anúncios ativos contam antes). */
export function currentPages(places: PagePlace[]) {
  const count = new Map<string, { url: string; ativos: number; total: number }>();
  for (const p of places) {
    if (p.tipo !== 'anuncio' || !p.url) continue;
    const c = count.get(p.url) || { url: p.url, ativos: 0, total: 0 };
    c.total++; if (p.status === 'ENABLED') c.ativos++;
    count.set(p.url, c);
  }
  return [...count.values()].sort((a, b) => b.ativos - a.ativos || b.total - a.total);
}
