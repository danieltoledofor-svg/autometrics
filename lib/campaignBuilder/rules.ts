
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
 * - TOPO de funil — segue a parte de recursos da skill "auditor-congruencia-funil"
 *   e a regra de ouro da "master-copywriter": dor + linha de solução na mesma
 *   frase. Cada título liga a palavra-chave à VSL e à página; nada de título
 *   genérico, de causa ou de "por quê" (pedido do usuário em 19/10/2026): o foco
 *   é tratamento, resultado e "como". Remédio nenhum é citado pelo nome.
 *   Os ângulos (TOP_ANGLES) são as referências da skill, escolhidas na tela.
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

/**
 * Ângulos do topo de funil, tirados das skills "master-copywriter" (fórmula dor +
 * solução e engenharia de ganchos) e "analisador-vsl" (headlines sem produto e
 * sem oferta). Os ganchos de causa e de "por quê" ficaram de fora a pedido do
 * usuário. 0 = mistura padrão.
 */
export const TOP_ANGLES: Record<number, { nome: string; tom: string }> = {
  0: { nome: 'Mistura padrão', tom: 'dor + solução, "como", tratamento natural e resultado, distribuídos pelo pacote' },
  1: { nome: 'Dor + solução', tom: 'o sintoma ou o medo de quem busca e a linha de solução (tratamento, natural, caseiro) na mesma frase' },
  2: { nome: 'Como fazer', tom: '"como" + o resultado que a pessoa quer ("How to Lower Blood Pressure Fast")' },
  3: { nome: 'Tratamento natural', tom: 'remédio natural, caseiro, receita ou rotina que a VSL ensina, sem citar remédio pelo nome' },
  4: { nome: 'Resultado', tom: 'o que muda no corpo ou no dia a dia, como a VSL conta, sem prazo garantido nem promessa de cura' },
  5: { nome: 'Tentou e não funcionou', tom: 'filtro de dor: quem já tentou de tudo e encontra o jeito que a VSL mostra ("Tried Everything? Try This")' },
  6: { nome: 'O passo que falta', tom: 'quebra de padrão sem "por quê": a versão completa, o passo que falta, o jeito certo de fazer' },
  7: { nome: 'Especialista revela', tom: 'autoridade + mecanismo: um especialista mostra o método (sem nome de pessoa famosa)' },
  8: { nome: 'Experiência real', tom: 'prova pela experiência: o que aconteceu depois de fazer o que a VSL ensina' },
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
  pagina?: string;               // o que o código-fonte da página diz (lib/campaignBuilder/pageSource)
  vsl?: string;                  // transcrição da VSL
  /** Ângulos escolhidos (TOP_ANGLES). Vazio = mistura padrão. */
  angulos?: number[];
  /** Anúncios das campanhas do mesmo mecanismo (ativas, pausadas e suspensas), já separados pela varredura. */
  modelos?: { copiar: AdModel[]; evitar: AdModel[] };
}

/** Um anúncio lido na varredura: os textos e o que ele fez, em palavras. */
export interface AdModel { situacao: string; resultado: string; titulos: string[]; descricoes: string[] }

/** Pedido de reescrita: a direção que o usuário deu (texto ou áudio) e o material que ele tem na tela. */
export interface Rewrite { direcao: string; titulos: string[]; descricoes: string[]; escolhidos: string[] }

export interface Item { texto: string; pt: string; bloco?: string; grupo?: string }
export interface Sitelink { tema: string; texto: Item; desc1: Item; desc2: Item }
export interface ResourcePack { funnel: Funnel; titulos: Item[]; descricoes: Item[]; sitelinks: Sitelink[]; destaques: Item[]; descartados: number }

// ── Regras fixas do usuário, nos dois modelos ───────────────────────────────

/** Remédios de receita que nunca entram em copy. A conferência é por código, depois da IA. */
const PRESCRIPTION = /\b(ozempic|wegovy|mounjaro|zepbound|rybelsus|saxenda|victoza|trulicity|semaglutid[ea]|tirzepatid[ea]|liraglutid[ea]|dulaglutid[ea]|metformin[a]?|phentermine|adderall|viagra|cialis|sildenafil[a]?|tadalafil[a]?|losartan[a]?|valsartan[a]?|olmesartan[a]?|lisinopril|enalapril|amlodipin[ea]|anlodipino|metoprolol|atenolol|propranolol|hydrochlorothiazide|hidroclorotiazida|furosemid[ea]|atorvastatin[a]?|simvastatin[a]?|rosuvastatin[a]?|lipitor|crestor|gabapentin[a]?|pregabalin[a]?|lyrica|donepezil[a]?|aricept|memantin[ea]|namenda|levothyroxine|levotiroxina|omeprazol[e]?|ibuprofen[o]?|advil|tylenol|aspirin[a]?)\b/i;
/** Título de topo que fala de causa ou de "por quê": o usuário quer tratamento, resultado e "como" (19/10/2026). */
const WHY = /\b(why|cause[sd]?|causing|reasons?|causa[sm]?|causando|motivos?|por ?qu[eê])\b/i;
/** Promessa de cura ou de resultado garantido. */
const CURE = /\b(cure[sd]?|cura[rs]?|curou|reverse[sd]? (diabetes|disease)|revert[ea] (a |o )?(diabetes|doença)|guaranteed results?|resultado garantido|miracle|milagr[eo]s?[ao]?)\b/i;

const FIXED_RULES = `Regras fixas, sem exceção:
- Nunca cite remédio pelo nome, de receita ou de farmácia (Ozempic, Mounjaro, losartana, estatina, diurético e parecidos), nem mesmo quando a VSL cita. Falar de "remédio natural" ou "caseiro" pode.
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
    : `Você escreve os recursos de um anúncio de Pesquisa do Google Ads de TOPO de funil, que leva para uma página com vídeo de vendas (VSL). Quem busca ainda não conhece o produto: tem uma dor ou um medo e procura um jeito de resolver.

A regra de ouro: DOR + LINHA DE SOLUÇÃO juntas. Só a dor não diz ao Google para onde a pessoa vai; só a solução cai no leilão caro. Quando a dor do anúncio, a linha de solução, a página e o vídeo batem, o Google entende quem você quer alcançar.

Como escrever os títulos:
- Nada de título genérico. Cada título liga três coisas: uma palavra-chave da campanha (ou um termo que já converteu), o que a VSL conta (a descoberta, o método, o jeito de tratar, as palavras dela) e o que a página mostra. Título que serviria para qualquer produto do mesmo assunto está errado.
- Foque em tratamento, resultado e "como": como baixar, como aliviar, o que fazer, o que muda. Não escreva sobre a causa do problema nem "por quê" (why, cause, reason, por que, causa, motivo): esses títulos estão proibidos.
- Use as palavras de quem busca e as da VSL, não termos técnicos.
- Cada recurso atende a UM dos grupos de busca do pedido e continua o mesmo assunto. Diga no campo "grupo" a qual ele atende. Distribua entre os grupos, com mais peso nos primeiros.
- O que o anúncio promete tem de existir na página e no vídeo. Não prometa o que a página não entrega.
- Não cite o nome do produto, preço, desconto nem oferta: nesta etapa a pessoa busca informação.
- Sem urgência inventada, sem título feito só para chamar clique, sem ataque a marca.
- Distribua os ângulos pedidos pelo pacote inteiro.

Descrições: emoção primeiro, lógica depois. Comece pela dor ou pelo desejo de quem busca e termine com o que o vídeo mostra (o método, o tratamento, o resultado), convidando a assistir.`;
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
  const angles = [...new Set(c.angulos?.length ? c.angulos : [0])].filter(n => TOP_ANGLES[n]).map(n => `- ${TOP_ANGLES[n].nome}: ${TOP_ANGLES[n].tom}`);
  const groups = c.grupos.slice(0, 8).map((g, i) => `${i + 1}. ${g.nome}: ${g.termos.slice(0, 8).join(' · ')}`);
  return [
    `IDIOMA DO ANÚNCIO: ${c.idioma}`, `PAÍS: ${c.pais}`,
    `GRUPOS DE BUSCA (do mais importante para o menos):\n${groups.join('\n') || '(não vieram separados: monte você de 3 a 6 grupos pela intenção de quem busca, a partir das palavras-chave e dos termos abaixo)'}`,
    `PALAVRAS-CHAVE DA CAMPANHA:\n${(c.palavras || []).slice(0, 30).join(' · ') || '(não informadas)'}`,
    `TERMOS DE PESQUISA QUE MAIS CONVERTERAM EM CAMPANHAS PARECIDAS:\n${(c.termos || []).slice(0, 40).join(' · ') || '(sem histórico)'}`,
    `PÁGINA (código-fonte, separado em blocos: cabeçalho, dados declarados, texto, botões, imagens):\n${String(c.pagina || '(não enviada)').slice(0, 16000)}`,
    `VSL (transcrição, começo):\n${String(c.vsl || '(não enviada)').slice(0, 9000)}`,
    `ÂNGULOS PEDIDOS:\n${angles.join('\n')}`,
    models(c.modelos),
  ].filter(Boolean).join('\n\n');
}

/** Anúncios do mesmo mecanismo nas campanhas do afiliado, em palavras. Sem nome de campanha: só os textos e o resultado. */
function models(m?: TopContext['modelos']): string {
  if (!m || (!m.copiar.length && !m.evitar.length)) return '';
  const ad = (a: AdModel) => `- (${a.situacao}; ${a.resultado})\n  Títulos: ${a.titulos.slice(0, 15).join(' | ')}\n  Descrições: ${a.descricoes.slice(0, 4).join(' | ')}`;
  return [
    m.copiar.length ? `ANÚNCIOS DO MESMO ASSUNTO QUE VENDERAM BEM (use como referência de assunto, de palavras e de estilo; não copie igual e siga as regras acima mesmo que eles não sigam):\n${m.copiar.slice(0, 6).map(ad).join('\n')}` : '',
    m.evitar.length ? `ANÚNCIOS DO MESMO ASSUNTO QUE GASTARAM E NÃO VENDERAM (não repita estes títulos nem este jeito de escrever):\n${m.evitar.slice(0, 4).map(ad).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * O que vai no fim de qualquer pedido: as preferências de escrita que o
 * afiliado guardou e, numa reescrita, a direção dele com o material da tela.
 */
export function extrasFor(memory?: string, rewrite?: Rewrite | null): string {
  const parts: string[] = [];
  if (memory) parts.push(`PREFERÊNCIAS DE ESCRITA DO AFILIADO (direções que ele deu e textos que ele escolheu antes; siga sempre que não contrariarem as regras):\n${memory}`);
  if (rewrite?.direcao) {
    parts.push([
      `REESCRITA PEDIDA PELO AFILIADO. Siga esta direção à risca; ela vale acima dos ângulos e dos tons:\n${rewrite.direcao}`,
      rewrite.titulos.length ? `TÍTULOS QUE ESTÃO NA TELA:\n${rewrite.titulos.slice(0, 30).map(t => `- ${t}`).join('\n')}` : '',
      rewrite.descricoes.length ? `DESCRIÇÕES QUE ESTÃO NA TELA:\n${rewrite.descricoes.slice(0, 10).map(t => `- ${t}`).join('\n')}` : '',
      rewrite.escolhidos.length ? `O QUE ELE JÁ ESCOLHEU PARA A CAMPANHA (mantenha o estilo destes):\n${rewrite.escolhidos.slice(0, 20).map(t => `- ${t}`).join('\n')}` : '',
      'Devolva o pacote inteiro de novo, já reescrito com a direção.',
    ].filter(Boolean).join('\n\n'));
  }
  return parts.join('\n\n');
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
  if (PRESCRIPTION.test(t)) return 'cita remédio pelo nome';
  if (CURE.test(t)) return 'promete cura ou resultado garantido';
  if (f === 'topo' && kind === 'titulo' && WHY.test(t)) return 'fala de causa ou de "por quê"; o topo foca em tratamento, resultado e "como"';
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
