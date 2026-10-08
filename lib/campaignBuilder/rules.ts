
/**
 * Recursos de uma campanha de Pesquisa (títulos, descrições, sitelinks e
 * frases de destaque) escritos pela IA no criador de campanhas.
 *
 * Dois modelos, escolhidos pelo usuário ao criar:
 *
 * - FUNDO de funil — segue a skill "gerador-recursos-fundo-de-funil" dele: quem
 *   busca já conhece a oferta. A copy gira em prova concreta (preço, garantia,
 *   frete), remoção de objeção (site oficial) e urgência. Os valores são os da
 *   página ou os informados: nada é calculado, convertido ou arredondado.
 * - TOPO de funil — segue a parte de recursos da skill "auditor-congruencia-funil":
 *   cada recurso atende a um grupo de intenção de busca (receita, causa,
 *   sintoma, prevenção, dúvida se funciona) e continua esse assunto até a
 *   página e a VSL.
 *
 * Nos dois, a contagem de letras é feita por código (nunca pela IA) e o que
 * sai fora do limite é reescrito uma vez; o que continuar fora não é entregue.
 */

export type Funnel = 'fundo' | 'topo';
export type ResourceKind = 'titulo' | 'descricao' | 'sitelink' | 'sitelink_desc' | 'destaque';

/**
 * Limites de letras, os mesmos do Google: título 30, descrição 90, texto do
 * sitelink 25, cada linha de descrição do sitelink 35, frase de destaque 25.
 * Decisão do usuário (08/10/2026): só o máximo vale; título curto é aceito.
 */
const GOOGLE: Record<ResourceKind, { min: number; max: number }> = {
  titulo: { min: 1, max: 30 }, descricao: { min: 1, max: 90 }, sitelink: { min: 1, max: 25 }, sitelink_desc: { min: 1, max: 35 }, destaque: { min: 1, max: 25 },
};
export const LIMITS: Record<Funnel, Record<ResourceKind, { min: number; max: number }>> = { fundo: GOOGLE, topo: GOOGLE };

/** Quanto de cada coisa o pacote traz. O anúncio usa até 15 títulos e 4 descrições; o resto fica como banco para trocar. */
export const PACKAGE = {
  fundo: {
    titulos: [
      { bloco: 'Produto + [benefício]', regra: 'nome do produto seguido do benefício entre colchetes', n: 10 },
      { bloco: 'Produto em posição livre', regra: 'nome do produto no começo, no meio ou no fim', n: 10 },
      { bloco: 'Produto + benefício', regra: 'nome do produto e benefício, sem colchetes', n: 10 },
      { bloco: 'Sem o nome do produto', regra: 'sem citar o nome do produto', n: 25 },
    ],
    descricoes: 6, sitelinks: 10, destaques: 15,
  },
  topo: {
    titulos: [{ bloco: 'Por grupo de busca', regra: 'cada título atende a um grupo de intenção e diz qual', n: 20 }],
    descricoes: 6, sitelinks: 10, destaques: 15,
  },
} as const;

/** Tons do fundo de funil. 0 = temas padrão; 9 = a IA escolhe três entre 1 e 8. */
export const VARIATIONS: Record<number, { nome: string; tom: string }> = {
  0: { nome: 'Temas padrão', tom: 'preço, valor do desconto, % de desconto, frete, garantia (se houver), site oficial, loja oficial, direto do fabricante' },
  1: { nome: 'Escassez', tom: 'estoque limitado e prazo curtíssimo ("últimas unidades hoje")' },
  2: { nome: 'Urgência', tom: 'ação imediata sem citar estoque ("aproveite agora")' },
  3: { nome: 'Exclusividade', tom: '"somente aqui", "exclusivo", "apenas no site oficial"' },
  4: { nome: 'Preço e desconto', tom: 'os valores EXATOS informados, nunca inventados' },
  5: { nome: 'Garantia', tom: 'reforça o prazo informado ("garantia de X dias")' },
  6: { nome: 'Frete grátis', tom: 'entrega sem custo ou rápida' },
  7: { nome: 'Oficialidade', tom: 'autenticidade e procedência ("produto original", "site oficial")' },
  8: { nome: 'Educativo', tom: 'convite para conhecer ("veja como funciona")' },
  9: { nome: 'Aleatório', tom: 'três tons distintos entre 1 e 8, à escolha' },
};

/** Como o preço aparece em cada mercado. País fora da tabela: o usuário informa o formato. */
export const MONEY_FORMAT: Record<string, { moeda: string; exemplo: string }> = {
  BR: { moeda: 'BRL', exemplo: 'R$ 39,98' }, US: { moeda: 'USD', exemplo: '$39.98' }, GB: { moeda: 'GBP', exemplo: '£39.98' },
  FR: { moeda: 'EUR', exemplo: '39,98 €' }, DE: { moeda: 'EUR', exemplo: '39,98 €' }, ES: { moeda: 'EUR', exemplo: '39,98 €' }, IT: { moeda: 'EUR', exemplo: '39,98 €' }, PT: { moeda: 'EUR', exemplo: '39,98 €' },
  CA: { moeda: 'CAD', exemplo: 'CA$39.98 (inglês) ou 39,98 $ (francês)' }, MX: { moeda: 'MXN', exemplo: '$39.98 MXN' }, AU: { moeda: 'AUD', exemplo: 'A$39.98' },
};

/** Dados da oferta no fundo de funil. Vazio = não informado: a IA não pode usar nem inventar. */
export interface Offer {
  produto: string;
  idioma: string;                // idioma do anúncio (pode ser diferente do da página)
  pais: string;
  moeda: string;
  formato_moeda?: string;        // exemplo de como escrever o preço
  preco?: string;                // já no formato do mercado
  preco_original?: string;
  desconto_valor?: string;
  desconto_pct?: string;
  frete?: 'gratis' | 'rapido' | 'imediato' | 'expresso' | '';
  garantia_dias?: number | null;
  oficial?: boolean;
  variacoes: number[];
}

/** O que a IA do topo de funil recebe além da página. */
export interface TopContext {
  idioma: string;
  pais: string;
  grupos: { nome: string; termos: string[] }[];     // grupos de intenção de busca, quando já vêm separados
  /** Termos de pesquisa que mais converteram nas campanhas parecidas; a IA separa em grupos de intenção. */
  termos?: string[];
  /** Palavras-chave da campanha nova. */
  palavras?: string[];
  pagina?: string;               // texto da página
  vsl?: string;                  // transcrição da VSL
}

export interface Item { texto: string; pt: string; bloco?: string; grupo?: string }
export interface Sitelink { tema: string; texto: Item; desc1: Item; desc2: Item }
export interface ResourcePack { funnel: Funnel; titulos: Item[]; descricoes: Item[]; sitelinks: Sitelink[]; destaques: Item[]; descartados: number }

// ── Regras fixas do usuário, nos dois modelos ───────────────────────────────

/** Remédios de receita que nunca entram em copy. A conferência é por código, depois da IA. */
const PRESCRIPTION = /\b(ozempic|wegovy|mounjaro|zepbound|rybelsus|saxenda|victoza|trulicity|semaglutid[ea]|tirzepatid[ea]|liraglutid[ea]|dulaglutid[ea]|metformin[a]?|phentermine|adderall|viagra|cialis|sildenafil[a]?|tadalafil[a]?)\b/i;
/** Promessa de cura ou de resultado garantido. */
const CURE = /\b(cure[sd]?|cura[rs]?|curou|reverse[sd]? (diabetes|disease)|revert[ea] (a |o )?(diabetes|doença)|guaranteed results?|resultado garantido|miracle|milagr[eo]s?[ao]?)\b/i;

const FIXED_RULES = `Regras fixas, sem exceção:
- Nunca use nome de remédio de receita (Ozempic, Mounjaro, semaglutida e parecidos).
- Sem promessa de cura, de reversão garantida ou de resultado garantido. Sem comparação com marca ou celebridade pelo nome.
- Cada item vem em par: "texto" no idioma do anúncio e "pt" com a tradução em português do Brasil. Nunca misture idiomas no "texto". Nunca traduza o nome do produto.
- Respeite os limites de letras de cada formato, contando espaços e símbolos. Na dúvida, escreva mais curto.
- Nada de frase repetida nem de duas frases que só trocam uma palavra.`;

const OUTPUT = `Responda só com JSON, neste formato:
{"titulos": [{"bloco": "nome do bloco", "grupo": "grupo de busca, se houver", "texto": "...", "pt": "..."}],
 "descricoes": [{"texto": "...", "pt": "..."}],
 "sitelinks": [{"tema": "nome curto do tema", "texto": {"texto": "...", "pt": "..."}, "desc1": {"texto": "...", "pt": "..."}, "desc2": {"texto": "...", "pt": "..."}}],
 "destaques": [{"texto": "...", "pt": "..."}]}`;

const limitsText = (f: Funnel) => {
  const l = LIMITS[f], span = (x: { min: number; max: number }) => (x.min > 1 ? `de ${x.min} a ${x.max}` : `até ${x.max}`);
  return `Aproveite o espaço: prefira títulos perto de 30 letras e descrições perto de 90, sem passar.
Limites de letras: título ${span(l.titulo)} · descrição ${span(l.descricao)} · texto do sitelink ${span(l.sitelink)} · cada linha de descrição do sitelink ${span(l.sitelink_desc)} · frase de destaque ${span(l.destaque)}.`;
};

export function systemFor(f: Funnel): string {
  const p = PACKAGE[f];
  const titles = p.titulos.map(t => `- ${t.n} títulos no bloco "${t.bloco}": ${t.regra}.`).join('\n');
  const head = f === 'fundo'
    ? `Você escreve os recursos de um anúncio de Pesquisa do Google Ads de FUNDO de funil: quem busca já conhece o produto e está perto de comprar. A copy não desperta curiosidade nem ensina sobre o problema. Ela gira em três coisas: prova concreta (preço, garantia, frete), remoção de objeção (site oficial, garantia) e urgência real.

Valores, inegociável:
- Use exatamente os valores que vierem no pedido. Proibido calcular, converter, arredondar ou alterar.
- "Economize {valor}" só se o valor do desconto veio no pedido. "-{%}" só se o percentual veio. "De X por Y" só se os dois preços vieram.
- Dado que veio vazio não existe: não cite garantia, frete, desconto ou site oficial que não foram informados.
- Escreva o preço sempre no formato de moeda informado, o mesmo em todo o pacote.
- Todas as descrições começam pelo nome do produto.
- Distribua os tons pedidos pelo pacote inteiro.`
    : `Você escreve os recursos de um anúncio de Pesquisa do Google Ads de TOPO de funil, que leva para uma página com vídeo de vendas (VSL). Quem busca ainda não conhece o produto: procura uma receita, uma causa, um sintoma, um jeito de prevenir ou quer saber se algo funciona.

Como escrever:
- Cada recurso atende a UM dos grupos de busca do pedido e continua o mesmo assunto que a pessoa buscou. Diga no campo "grupo" a qual ele atende. Distribua os recursos entre os grupos, com mais peso nos primeiros.
- O que o anúncio promete tem de existir na página e no vídeo do pedido: use o assunto, o mecanismo e as palavras que aparecem ali. Não prometa o que a página não entrega.
- Não cite o nome do produto, preço nem desconto: nesta etapa a pessoa busca informação.
- Sem urgência inventada e sem título feito só para chamar clique.`;
  return `${head}

O pacote:
${titles}
- ${p.descricoes} descrições.
- ${p.sitelinks} sitelinks, cada um com um tema diferente: texto do link e duas linhas de descrição.
- ${p.destaques} frases de destaque.

${limitsText(f)}

${FIXED_RULES}

${OUTPUT}`;
}

export function userForOffer(o: Offer): string {
  const tones = [...new Set(o.variacoes.length ? o.variacoes : [0])].filter(n => VARIATIONS[n]).map(n => `- ${VARIATIONS[n].nome}: ${VARIATIONS[n].tom}`);
  const line = (label: string, v: any) => `${label}: ${v === undefined || v === null || v === '' ? '(não informado — não usar)' : v}`;
  return [
    line('PRODUTO', o.produto), line('IDIOMA DO ANÚNCIO', o.idioma), line('PAÍS', o.pais), line('MOEDA', o.moeda),
    line('COMO ESCREVER PREÇOS NESTE MERCADO (só o formato; o número abaixo é um exemplo, não é o preço)', o.formato_moeda || MONEY_FORMAT[o.pais.toUpperCase()]?.exemplo),
    line('PREÇO', o.preco), line('PREÇO ORIGINAL (de)', o.preco_original), line('VALOR DO DESCONTO', o.desconto_valor), line('PERCENTUAL DE DESCONTO', o.desconto_pct),
    line('FRETE', o.frete === 'gratis' ? 'grátis' : o.frete ? `envio ${o.frete}` : ''),
    line('GARANTIA', o.garantia_dias ? `${o.garantia_dias} dias` : ''), line('SITE OFICIAL', o.oficial ? 'sim' : ''),
    `TONS PEDIDOS:\n${tones.join('\n')}`,
  ].join('\n');
}

export function userForTop(c: TopContext): string {
  const groups = c.grupos.slice(0, 8).map((g, i) => `${i + 1}. ${g.nome}: ${g.termos.slice(0, 8).join(' · ')}`);
  return [
    `IDIOMA DO ANÚNCIO: ${c.idioma}`, `PAÍS: ${c.pais}`,
    `GRUPOS DE BUSCA (do mais importante para o menos):\n${groups.join('\n') || '(não vieram separados: monte você de 3 a 6 grupos pela intenção de quem busca, a partir das palavras-chave e dos termos abaixo)'}`,
    `PALAVRAS-CHAVE DA CAMPANHA:\n${(c.palavras || []).slice(0, 30).join(' · ') || '(não informadas)'}`,
    `TERMOS DE PESQUISA QUE MAIS CONVERTERAM EM CAMPANHAS PARECIDAS:\n${(c.termos || []).slice(0, 40).join(' · ') || '(sem histórico)'}`,
    `PÁGINA (começo):\n${String(c.pagina || '(não enviada)').slice(0, 6000)}`,
    `VSL (transcrição, começo):\n${String(c.vsl || '(não enviada)').slice(0, 9000)}`,
  ].join('\n\n');
}

// ── Conferência por código ──────────────────────────────────────────────────

/** Letras como o Google conta: cada símbolo vale um, espaços inclusos. */
export const count = (text: string) => [...String(text || '')].length;

/** Por que um texto não pode ir ao ar, ou null quando pode. */
export function problemOf(f: Funnel, kind: ResourceKind, text: string): string | null {
  const t = String(text || '').trim(), n = count(t), l = LIMITS[f][kind];
  if (!t) return 'vazio';
  if (n > l.max) return `${n} letras, o máximo é ${l.max}`;
  if (n < l.min) return `${n} letras, o mínimo é ${l.min}`;
  if (PRESCRIPTION.test(t)) return 'cita remédio de receita';
  if (CURE.test(t)) return 'promete cura ou resultado garantido';
  return null;
}

const clean = (x: any, extra: Record<string, any> = {}): Item => ({ texto: String(x?.texto || '').trim(), pt: String(x?.pt || '').trim(), ...extra });

/** Separa o que passou do que precisa ser reescrito. Repetidos saem. */
export function review(f: Funnel, raw: any) {
  const seen = new Set<string>();
  const fresh = (text: string) => { const k = text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; };
  const good: Omit<ResourcePack, 'funnel' | 'descartados'> = { titulos: [], descricoes: [], sitelinks: [], destaques: [] };
  const bad: { onde: string; texto: string; problema: string }[] = [];
  const take = (list: any, kind: ResourceKind, into: Item[], where: string) => {
    for (const x of Array.isArray(list) ? list : []) {
      const item = clean(x, { ...(x?.bloco ? { bloco: String(x.bloco) } : {}), ...(x?.grupo ? { grupo: String(x.grupo) } : {}) });
      const problem = problemOf(f, kind, item.texto);
      if (problem) bad.push({ onde: where, texto: item.texto, problema: problem });
      else if (fresh(item.texto)) into.push(item);
    }
  };
  take(raw?.titulos, 'titulo', good.titulos, 'título');
  take(raw?.descricoes, 'descricao', good.descricoes, 'descrição');
  take(raw?.destaques, 'destaque', good.destaques, 'frase de destaque');
  for (const s of Array.isArray(raw?.sitelinks) ? raw.sitelinks : []) {
    const link: Sitelink = { tema: String(s?.tema || '').trim(), texto: clean(s?.texto), desc1: clean(s?.desc1), desc2: clean(s?.desc2) };
    const problems = [problemOf(f, 'sitelink', link.texto.texto), problemOf(f, 'sitelink_desc', link.desc1.texto), problemOf(f, 'sitelink_desc', link.desc2.texto)];
    const first = problems.findIndex(Boolean);
    if (first >= 0) bad.push({ onde: `sitelink "${link.tema}"`, texto: [link.texto, link.desc1, link.desc2][first].texto, problema: problems[first]! });
    else if (fresh(link.texto.texto)) good.sitelinks.push(link);
  }
  return { good, bad };
}
