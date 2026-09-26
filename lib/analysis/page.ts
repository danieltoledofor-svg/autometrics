import { createHash } from 'crypto';
import { askJson } from '@/lib/ai/openrouter';
import { languageProblems } from './actions';
import type { Computed, Row, Status } from './compute';
import { formatMoney } from './labels';

/**
 * Item 8 — o anúncio conversa com a página e com a VSL?
 *
 * Segue a skill "auditor-congruencia-funil", só a parte do diagnóstico: agrupa
 * as buscas por intenção, olha o que a página mostra primeiro e onde o assunto
 * aparece na VSL. Não cria títulos nem descrições.
 *
 * A IA só agrupa e compara textos. Gasto e vendas de cada grupo são somados
 * aqui, a partir dos termos — número nenhum vem da IA.
 */

export interface PageResult {
  url: string;
  checked_at: string;
  resumo: string;
  grupos: { nome: string; termos: string[]; gasto3: number; vendas3: number; abre: string; vsl: string; conversa: 'sim' | 'nao' | 'em_parte' }[];
  achados: { nivel: 'urgente' | 'alerta' | 'ok'; titulo: string; texto: string; ponto: string | null }[];
  error?: string;
}

export function landingUrl(c: Computed): string | null {
  const count = new Map<string, number>();
  for (const a of c.ads) {
    const u = a.details?.final_url;
    if (u) count.set(u, (count.get(u) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** Texto da página com as marcas de seção (id/classe) que dizem a intenção do trecho. */
export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    // Página de afiliado costuma recusar o que não parece navegador.
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`a página respondeu ${res.status}`);
  const html = (await res.text()).slice(0, 2_000_000);
  return html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(section|div|article|header|footer)\b[^>]*\bid="([^"]+)"[^>]*>/gi, '\n[seção $2]\n')
    .replace(/<h([1-3])\b[^>]*>/gi, (_m, l) => `\n${'#'.repeat(Number(l))} `)
    .replace(/<\/(p|div|section|h[1-6]|li|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
    .slice(0, 14_000);
}

export function pageHash(pageText: string, transcript: string, c: Computed): string {
  const topTerms = [...c.termRows].sort((a, b) => b.cost7 - a.cost7).slice(0, 15).map(r => r.key).sort().join('|');
  const ads = c.ads.map(a => (a.details?.headlines || []).map((h: any) => h.text).join('/')).sort().join('|');
  return createHash('sha256').update(`${pageText}\n${transcript}\n${topTerms}\n${ads}`).digest('hex');
}

const SYSTEM = `Você analisa se os anúncios do Google, a página (bridge) e a VSL de um afiliado de saúde falam da mesma coisa.

Método:
1. Junte os termos de pesquisa em grupos pela intenção de quem buscou (receita, causa, sintoma, prevenção, dúvida se funciona, comparação com marca ou remédio). Não pela palavra literal.
2. Para cada grupo, diga o que a página mostra primeiro para essa pessoa (título, primeira seção) e em que ponto da VSL o assunto aparece (minuto aproximado ou trecho). Se não aparece, diga "não aparece".
3. Diga se o grupo conversa com a página: "sim", "nao" ou "em_parte".
4. Liste os achados do mais grave ao mais leve. Cada achado cita a evidência: o termo, o título da página, o trecho ou minuto da VSL.

Linguagem, obrigatória:
- Português simples e direto, para um afiliado. Nada de nome técnico ou em inglês (não use "mismatch", "cluster", "compliance", "congruência", "persona", "funil"). Siglas CPA, CPC e CTR podem.
- Títulos dos achados em frase comum, por exemplo "A busca pede uma coisa e a página abre com outra", "A prova chega tarde na página", "A página e a VSL explicam o problema de jeitos diferentes", "A pessoa chega em outro momento do problema".
- Nunca dê ordem. Proibido: sugiro, recomendo, considere, tente, pause, ative, melhore, otimize, aumente, diminua, reduza, você deve, vale a pena, faz sentido.
- O campo "ponto" descreve o elemento concreto onde está a alteração, como substantivo: "Título da página para quem chega pelo sal rosa". Não escreva títulos, descrições ou textos novos.
- Não invente números: gasto e vendas são calculados fora. Fale de termos, textos e minutos.

Responda só com JSON:
{"resumo": "1 ou 2 frases com a maior quebra de hoje",
 "grupos": [{"nome": "nome curto em português", "termos": ["termo exatamente como veio"], "abre": "o que a página mostra primeiro", "vsl": "minuto ou trecho, ou não aparece", "conversa": "sim|nao|em_parte"}],
 "achados": [{"nivel": "urgente|alerta|ok", "titulo": "...", "texto": "... com a evidência", "ponto": "... ou null se nivel for ok"}]}`;

export async function analyzePage(
  c: Computed,
  opts: { url: string; pageText: string; transcript: string; userId: string },
): Promise<PageResult> {
  const money = (v: number) => formatMoney(v, c.reference.currency);
  const terms = [...c.termRows].filter(r => r.cost7 > 0).sort((a, b) => b.cost7 - a.cost7).slice(0, 60);
  const termLines = terms.map(r => `- "${r.key}" · gasto 7d ${money(r.cost7)} · vendas 7d ${r.conv7}`).join('\n');
  const adLines = c.ads.slice(0, 6).map((a, i) =>
    `Anúncio ${i + 1}: títulos: ${(a.details?.headlines || []).map((h: any) => h.text).join(' | ')} · descrições: ${(a.details?.descriptions || []).map((d: any) => d.text).join(' | ')}`).join('\n');

  const user = `Campanha: ${c.product.name}
Página: ${opts.url}

TERMOS DE PESQUISA (7 dias):
${termLines || '(sem termos)'}

ANÚNCIOS ATIVOS:
${adLines || '(sem anúncios)'}

PÁGINA (texto, na ordem do HTML; [seção x] marca o id da seção):
${opts.pageText}

TRANSCRIÇÃO DA VSL:
${opts.transcript.slice(0, 20_000)}`;

  let out: any = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    const r = await askJson({ fn: 'pagina', userId: opts.userId, productId: c.product.id, system: SYSTEM, user: attempt ? `${user}\n\nATENÇÃO: a resposta anterior usou palavras proibidas. Reescreva seguindo a linguagem obrigatória.` : user, maxTokens: 3000 });
    const text = JSON.stringify(r);
    if (!languageProblems(text).length || attempt === 1) out = r;
  }

  // Números de cada grupo: soma dos termos que a IA colocou nele.
  const byTerm = new Map<string, Row>(c.termRows.map(r => [r.key.toLowerCase(), r]));
  const grupos = (Array.isArray(out?.grupos) ? out.grupos : []).map((g: any) => {
    const list: string[] = (Array.isArray(g.termos) ? g.termos : []).map((t: any) => String(t));
    let gasto3 = 0, vendas3 = 0;
    for (const t of list) {
      const r = byTerm.get(t.toLowerCase());
      if (r) { gasto3 += r.cost3; vendas3 += r.conv3; }
    }
    const conversa = ['sim', 'nao', 'em_parte'].includes(g.conversa) ? g.conversa : 'em_parte';
    return { nome: String(g.nome || 'Grupo'), termos: list, gasto3: Math.round(gasto3 * 100) / 100, vendas3: Math.round(vendas3 * 100) / 100, abre: String(g.abre || ''), vsl: String(g.vsl || ''), conversa };
  }).sort((a: any, b: any) => b.gasto3 - a.gasto3);

  const achados = (Array.isArray(out?.achados) ? out.achados : []).map((a: any) => ({
    nivel: ['urgente', 'alerta', 'ok'].includes(a.nivel) ? a.nivel : 'alerta',
    titulo: String(a.titulo || ''),
    texto: String(a.texto || ''),
    ponto: a.ponto && a.nivel !== 'ok' ? String(a.ponto) : null,
  })).filter((a: any) => a.titulo && !languageProblems(`${a.titulo} ${a.texto} ${a.ponto || ''}`).length);

  return { url: opts.url, checked_at: new Date().toISOString(), resumo: String(out?.resumo || ''), grupos, achados };
}

export function pageStatus(p: PageResult | null): Status {
  if (!p || p.error) return 'sem_dado';
  if (p.achados.some(a => a.nivel === 'urgente')) return 'urgente';
  if (p.achados.some(a => a.nivel === 'alerta')) return 'alerta';
  return 'ok';
}
