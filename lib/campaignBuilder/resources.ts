import { askJson } from '@/lib/ai/openrouter';
import { review, systemFor, userForOffer, userForTop, type Funnel, type Item, type Offer, type ResourcePack, type TopContext } from './rules';

/**
 * A parte que chama a IA para escrever os recursos (só no servidor). As regras,
 * os limites de letras e a conferência por código ficam em ./rules, que a tela
 * também usa.
 */
export * from './rules';

/**
 * Pede o pacote à IA, confere por código e pede uma vez a reescrita do que saiu
 * fora. O que ainda estiver fora depois disso é descartado e contado.
 */
export async function generateResources(ids: { userId: string; productId?: string | null }, f: Funnel, input: Offer | TopContext): Promise<ResourcePack> {
  const system = systemFor(f);
  const user = f === 'fundo' ? userForOffer(input as Offer) : userForTop(input as TopContext);
  const ask = (text: string) => askJson<any>({ fn: 'recursos', userId: ids.userId, productId: ids.productId, system, user: text, maxTokens: 9000, temperature: 0.8 });
  const first = review(f, await ask(user));
  const { good } = first;
  let discarded = 0;
  if (first.bad.length) {
    const fix = `${user}\n\nESTES ITENS SAÍRAM FORA DA REGRA. Reescreva só eles, um novo para cada, no mesmo formato de resposta e dentro dos limites:\n${first.bad.slice(0, 60).map(b => `- ${b.onde}: "${b.texto}" (${b.problema})`).join('\n')}`;
    const second = review(f, await ask(fix).catch(() => ({})));
    const seen = new Set([...good.titulos, ...good.descricoes, ...good.destaques].map(i => i.texto.toLowerCase()));
    const add = (into: Item[], from: Item[]) => { for (const i of from) if (!seen.has(i.texto.toLowerCase())) { seen.add(i.texto.toLowerCase()); into.push(i); } };
    add(good.titulos, second.good.titulos); add(good.descricoes, second.good.descricoes); add(good.destaques, second.good.destaques);
    const themes = new Set(good.sitelinks.map(s => s.texto.texto.toLowerCase()));
    for (const s of second.good.sitelinks) if (!themes.has(s.texto.texto.toLowerCase())) good.sitelinks.push(s);
    discarded = Math.max(0, first.bad.length - (second.good.titulos.length + second.good.descricoes.length + second.good.destaques.length + second.good.sitelinks.length));
  }
  return { funnel: f, ...good, descartados: discarded };
}

// ── Leitura da página do produto (fundo de funil) ───────────────────────────

const EXTRACT_SYSTEM = `Você lê o código-fonte de uma página de produto, já separado em blocos (cabeçalho, dados declarados no código, texto da página, botões, textos das imagens e trechos de código), e devolve só o que está ESCRITO nele. Não calcule, não deduza e não invente: o que não estiver escrito de forma literal volta vazio.

Como ler:
- O preço pode estar só nos dados declarados ou nos trechos de código, e não no texto: vale do mesmo jeito. Se houver vários preços (1, 3 e 6 frascos, por exemplo), use o menor preço por unidade que estiver escrito.
- Garantia só conta com o número de dias escrito. Frete só conta se a página disser.
- "oficial" é true só se a página se apresenta como site oficial ou loja oficial do produto.

Responda só com JSON:
{"produto": "nome do produto", "idioma_pagina": "idioma em que a página está escrita", "moeda": "código da moeda dos preços (USD, EUR, BRL…), só se der para saber pelo símbolo ou pelo código", "preco": "preço atual como aparece", "preco_original": "preço de antes, só se aparecer", "desconto_valor": "valor do desconto, só se escrito", "desconto_pct": "percentual, só se escrito", "frete": "gratis | rapido | imediato | expresso | vazio", "garantia_dias": número ou null, "oficial": true ou false}`;

/** O que a página revela sozinha; o resto (país, idioma do anúncio, tons) o usuário confirma na tela. */
export async function extractOffer(ids: { userId: string }, pageSource: string): Promise<Partial<Offer> & { idioma_pagina?: string }> {
  const raw = await askJson<any>({ fn: 'recursos', userId: ids.userId, system: EXTRACT_SYSTEM, user: `CÓDIGO-FONTE DA PÁGINA:\n${pageSource.slice(0, 30000)}`, maxTokens: 800 });
  const text = (v: any) => String(v ?? '').trim().slice(0, 80);
  const days = Number(raw?.garantia_dias);
  return {
    produto: text(raw?.produto), idioma_pagina: text(raw?.idioma_pagina), moeda: /^[A-Za-z]{3}$/.test(text(raw?.moeda)) ? text(raw?.moeda).toUpperCase() : '',
    preco: text(raw?.preco), preco_original: text(raw?.preco_original),
    desconto_valor: text(raw?.desconto_valor), desconto_pct: text(raw?.desconto_pct),
    frete: ['gratis', 'rapido', 'imediato', 'expresso'].includes(raw?.frete) ? raw.frete : '',
    garantia_dias: Number.isFinite(days) && days > 0 ? days : null, oficial: raw?.oficial === true,
  };
}
