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

const EXTRACT_SYSTEM = `Você lê o texto de uma página de produto e devolve só o que está ESCRITO nela. Não calcule, não deduza e não invente: o que não estiver escrito de forma literal volta vazio.

Responda só com JSON:
{"produto": "nome do produto", "idioma_pagina": "idioma em que a página está escrita", "preco": "preço atual como aparece", "preco_original": "preço de antes, só se aparecer", "desconto_valor": "valor do desconto, só se escrito", "desconto_pct": "percentual, só se escrito", "frete": "gratis | rapido | vazio", "garantia_dias": número ou null, "oficial": true ou false}`;

/** O que a página revela sozinha; o resto (país, idioma do anúncio, moeda, tons) o usuário confirma na tela. */
export async function extractOffer(ids: { userId: string }, pageText: string): Promise<Partial<Offer> & { idioma_pagina?: string }> {
  const raw = await askJson<any>({ fn: 'recursos', userId: ids.userId, system: EXTRACT_SYSTEM, user: `PÁGINA:\n${pageText.slice(0, 12000)}`, maxTokens: 800 });
  const text = (v: any) => String(v ?? '').trim().slice(0, 80);
  const days = Number(raw?.garantia_dias);
  return {
    produto: text(raw?.produto), idioma_pagina: text(raw?.idioma_pagina), preco: text(raw?.preco), preco_original: text(raw?.preco_original),
    desconto_valor: text(raw?.desconto_valor), desconto_pct: text(raw?.desconto_pct),
    frete: raw?.frete === 'gratis' || raw?.frete === 'rapido' ? raw.frete : '',
    garantia_dias: Number.isFinite(days) && days > 0 ? days : null, oficial: raw?.oficial === true,
  };
}
