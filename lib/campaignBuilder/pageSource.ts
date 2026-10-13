import { fetchPageHtml, htmlToText } from '@/lib/analysis/page';

/**
 * Leitura da página pelo código-fonte, para a IA do criador de campanhas.
 *
 * Em vez de só o texto que aparece na tela, a IA recebe o que o código da
 * página carrega: o título e as descrições do cabeçalho, os dados de produto
 * que a página declara (preço, moeda, oferta), os botões com os links, os
 * textos das imagens e os trechos de código onde aparecem preço, garantia ou
 * frete. Muita página de oferta só mostra o preço por código, e esse valor não
 * existe no texto visível.
 *
 * O código pode vir de dois lugares: o servidor baixa a página, ou o usuário
 * cola o código-fonte (Ctrl+U no navegador) quando a página recusa o servidor.
 */

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
const squeeze = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? squeeze(m[2] ?? m[3] ?? m[4] ?? '') : ''; };
const uniq = (list: string[]) => [...new Set(list.filter(Boolean))];

/** Sinais de oferta dentro de código: preço, moeda, garantia, frete, desconto. */
const OFFER = /(price|pre[cç]o|amount|currency|guarantee|garantia|money.?back|shipping|frete|discount|desconto|\bsave\b|[$€£]\s?\d|R\$\s?\d|\d+\s?(days?|dias))/i;

/** O que o código-fonte diz, organizado em blocos com nome, do mais confiável para o menos. */
export function digestSource(html: string, max = 30_000): string {
  const src = html.slice(0, 3_000_000);
  const parts: string[] = [];
  const block = (title: string, lines: string[], limit: number) => { const text = uniq(lines).join('\n').slice(0, limit); if (text) parts.push(`## ${title}\n${text}`); };

  const lang = attr(src.match(/<html\b[^>]*>/i)?.[0] || '', 'lang');
  const title = squeeze(src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const metas = [...src.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]).map(tag => {
    const name = attr(tag, 'name') || attr(tag, 'property') || attr(tag, 'itemprop'), content = attr(tag, 'content');
    return name && content && /description|title|og:|twitter:|product|price|currency|keywords|site_name|locale/i.test(name) ? `${name}: ${content}` : '';
  });
  block('CABEÇALHO DA PÁGINA', [lang && `idioma declarado: ${lang}`, title && `título: ${title}`, ...metas], 2500);

  // Dados de produto que a página declara para o Google (preço, moeda, oferta, avaliações).
  const structured = [...src.matchAll(/<script\b[^>]*type\s*=\s*["']application\/(ld\+json|json)["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[2].replace(/\s+/g, ' ').trim()).filter(t => t.length > 20);
  block('DADOS DECLARADOS NO CÓDIGO', structured.map(t => t.slice(0, 4000)), 7000);

  block('TEXTO DA PÁGINA (na ordem do código)', [htmlToText(src, 14_000)], 14_000);

  const links = [...src.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(m => {
    const text = squeeze(m[3].replace(/<[^>]+>/g, ' ')), href = attr(`<a ${m[2]}>`, 'href');
    return text && text.length <= 120 && (href || m[1].toLowerCase() === 'button') ? `${text}${href && !href.startsWith('#') && !/^javascript:/i.test(href) ? ` → ${href.split('?')[0].slice(0, 160)}` : ''}` : '';
  });
  block('BOTÕES E LINKS', links, 3000);

  const images = [...src.matchAll(/<img\b[^>]*>/gi)].map(m => attr(m[0], 'alt')).filter(t => t.length > 3);
  block('TEXTOS DAS IMAGENS', images, 1500);

  // Trechos de código (não de biblioteca) em que aparece preço, garantia, frete ou desconto.
  const snippets: string[] = [];
  for (const m of src.matchAll(/<script\b(?![^>]*\bsrc\s*=)(?![^>]*application\/(?:ld\+)?json)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const code = m[1];
    if (code.length > 200_000) continue;
    for (const hit of code.matchAll(new RegExp(OFFER.source, 'gi'))) {
      const at = hit.index || 0;
      snippets.push(code.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, ' ').trim());
      if (snippets.length >= 40) break;
    }
    if (snippets.length >= 40) break;
  }
  block('TRECHOS DO CÓDIGO COM PREÇO, GARANTIA OU FRETE', snippets, 4000);

  return parts.join('\n\n').slice(0, max);
}

/** Baixa a página e devolve o resumo do código-fonte. `pasted` = código colado pelo usuário, que vale no lugar do download. */
export async function readPageSource(url: string, pasted = ''): Promise<string> {
  const html = pasted.trim().length > 200 ? pasted : await fetchPageHtml(url);
  return digestSource(html);
}
