import { askJson } from '@/lib/ai/openrouter';
import { supabaseAdmin } from '@/lib/googleAds/server';
import { count, problemOf, type Funnel } from '@/lib/campaignBuilder/rules';
import type { AdText, CampaignAsset } from './manage';

/**
 * A IA olha um anúncio com o que cada título e descrição rendeu e diz o que trocar.
 *
 * Ela recebe os textos com impressões, cliques e a nota do Google, as palavras-chave do grupo e os
 * termos que mais trouxeram clique, e devolve em português simples: uma leitura curta, as trocas
 * (qual texto sai, por quê e o texto novo) e textos a mais para as vagas livres. As letras são
 * contadas por código, não pela IA: o que passar do limite ou repetir um texto que já existe é descartado.
 */

export interface AdAdvice {
  leitura: string;
  trocas: { tipo: 'titulo' | 'descricao'; atual: string; motivo: string; novo: string; pt: string }[];
  novos: { tipo: 'titulo' | 'descricao' | 'sitelink' | 'destaque'; novo: string; pt: string; motivo: string; desc1?: string; desc2?: string }[];
  descartados: number;
}

const SYSTEM = `Você é especialista em anúncios de pesquisa do Google (anúncio responsivo) para afiliados. Recebe um anúncio com o desempenho de cada título e de cada descrição e devolve o que trocar para melhorar.

Como ler os números: o Google monta o anúncio combinando os textos. "Impressões" é quantas vezes o texto entrou numa combinação mostrada; texto com muito menos impressões que os outros está sendo preterido pelo Google. Entre textos com impressões parecidas, o que tem menos cliques por impressão rende menos. A nota do Google, quando vem, vale mais que a sua conta: "baixo" deve ser trocado, "melhor" e "bom" ficam. Sem números (anúncio novo ou com poucas impressões), não invente pior ou melhor: avalie pelo texto — repetição de ideia, falta de palavra-chave, falta de oferta concreta, falta de chamada para ação.

Regras dos textos novos:
- No MESMO idioma dos textos atuais do anúncio. A explicação ("motivo", "leitura", "pt") é em português do Brasil, simples, sem termos em inglês.
- Título: até 30 letras. Descrição: até 90 letras. Sitelink: até 25 letras, com duas linhas de descrição de até 35 cada. Frase de destaque: até 25 letras. Conte as letras; texto no limite vale mais que texto que estoura.
- Não repita nem parafraseie de perto um texto que o anúncio já tem. Cada texto novo traz uma ideia diferente.
- Use as palavras-chave e os termos de pesquisa informados quando couberem com naturalidade.
- Não cite remédio de receita, não prometa cura nem resultado garantido, não invente preço, desconto, prazo ou garantia que não esteja nos textos atuais.
- Não proponha trocar texto com nota "melhor" ou "bom", nem o que está entre os de mais impressões.

Responda só com JSON:
{"leitura": "2 a 4 frases: o que está bom, o que está fraco e por quê, citando os números",
 "trocas": [{"tipo": "titulo" ou "descricao", "atual": "o texto atual, copiado exatamente", "motivo": "uma frase", "novo": "texto novo", "pt": "tradução do texto novo para português"}],
 "novos": [{"tipo": "titulo", "descricao", "sitelink" ou "destaque", "novo": "texto", "desc1": "só em sitelink", "desc2": "só em sitelink", "pt": "tradução", "motivo": "uma frase"}]}
No máximo 6 trocas. Em "novos", até o número de vagas livres informado para cada tipo, e no máximo 4 sitelinks e 4 frases de destaque.`;

export async function adviseAd(ids: { userId: string; productId: string }, ad: {
  funnel: Funnel; campaign: string; group: string; titulos: AdText[]; descricoes: AdText[]; tem_numeros: boolean; assets: CampaignAsset[];
}): Promise<AdAdvice> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [{ data: keywords }, { data: terms }] = await Promise.all([
    db.from('google_ads_entities').select('name, status, details').eq('product_id', ids.productId).eq('level', 'keyword').eq('status', 'ENABLED').limit(60),
    db.from('search_terms').select('search_term, clicks, conversions').eq('product_id', ids.productId).gte('date', since).gt('clicks', 0).order('clicks', { ascending: false }).limit(300),
  ]);
  const termSum = new Map<string, { c: number; v: number }>();
  for (const t of terms || []) { const cur = termSum.get(t.search_term) || { c: 0, v: 0 }; cur.c += Number(t.clicks) || 0; cur.v += Number(t.conversions) || 0; termSum.set(t.search_term, cur); }
  const topTerms = [...termSum].sort((a, b) => b[1].v - a[1].v || b[1].c - a[1].c).slice(0, 25);
  const line = (t: AdText) => `- "${t.texto}" (${count(t.texto)} letras) · impressões ${t.impressoes} · cliques ${t.cliques}${t.conversoes ? ` · conversões ${Math.round(t.conversoes * 10) / 10}` : ''}${t.nota ? ` · nota do Google: ${t.nota}` : ''}${t.pin ? ' · fixado numa posição' : ''}`;
  const sitelinks = ad.assets.filter(a => a.tipo === 'sitelink'), callouts = ad.assets.filter(a => a.tipo === 'destaque');
  const user = [
    `CAMPANHA: ${ad.campaign} (${ad.funnel === 'fundo' ? 'fundo de funil: quem busca já conhece o produto; vale prova concreta, oferta, site oficial e urgência' : 'topo de funil: quem busca tem um problema ou uma dúvida; o texto continua o assunto da busca e leva à página'})`,
    `GRUPO: ${ad.group}`,
    ad.tem_numeros ? 'NÚMEROS: últimos 30 dias.' : 'NÚMEROS: o Google ainda não informou desempenho por texto neste anúncio. Avalie só pelo texto.',
    `TÍTULOS (${ad.titulos.length} de 15, ${15 - ad.titulos.length} vagas livres):\n${ad.titulos.map(line).join('\n')}`,
    `DESCRIÇÕES (${ad.descricoes.length} de 4, ${4 - ad.descricoes.length} vagas livres):\n${ad.descricoes.map(line).join('\n')}`,
    `SITELINKS DA CAMPANHA (${sitelinks.length}):\n${sitelinks.map(s => `- "${s.texto}"${s.desc1 ? ` | ${s.desc1} | ${s.desc2}` : ''} · impressões ${s.impressoes} · cliques ${s.cliques}`).join('\n') || '- nenhum'}`,
    `FRASES DE DESTAQUE DA CAMPANHA (${callouts.length}):\n${callouts.map(s => `- "${s.texto}" · impressões ${s.impressoes}`).join('\n') || '- nenhuma'}`,
    `PALAVRAS-CHAVE ATIVAS DO GRUPO E DA CAMPANHA: ${(keywords || []).map(k => k.name).slice(0, 40).join(', ') || 'não informadas'}`,
    `TERMOS DE PESQUISA QUE MAIS TROUXERAM CLIQUE (30 dias): ${topTerms.map(([t, n]) => `${t} (${n.c} cliques${n.v ? `, ${Math.round(n.v * 10) / 10} conversões` : ''})`).join('; ') || 'ainda não há'}`,
  ].join('\n\n');

  const raw = await askJson<any>({ fn: 'recursos', userId: ids.userId, productId: ids.productId, system: SYSTEM, user, maxTokens: 3500, temperature: 0.7 });
  const text = (v: any, max = 300) => String(v ?? '').trim().slice(0, max);
  const have = new Set([...ad.titulos, ...ad.descricoes].map(t => t.texto.trim().toLowerCase()).concat(ad.assets.map(a => a.texto.trim().toLowerCase())));
  const current = new Map([...ad.titulos.map(t => ['titulo', t] as const), ...ad.descricoes.map(t => ['descricao', t] as const)].map(([tipo, t]) => [`${tipo}|${t.texto.trim().toLowerCase()}`, t.texto]));
  let discarded = 0;
  const valid = (tipo: string, novo: string) => {
    const kind = tipo === 'titulo' ? 'titulo' : tipo === 'descricao' ? 'descricao' : tipo === 'sitelink' ? 'sitelink' : tipo === 'destaque' ? 'destaque' : null;
    if (!kind || !novo || have.has(novo.toLowerCase()) || problemOf(ad.funnel, kind, novo)) { discarded++; return false; }
    have.add(novo.toLowerCase());
    return true;
  };
  const trocas: AdAdvice['trocas'] = [];
  for (const t of Array.isArray(raw?.trocas) ? raw.trocas : []) {
    const tipo = t?.tipo === 'descricao' ? 'descricao' : 'titulo', atual = current.get(`${tipo}|${text(t?.atual).toLowerCase()}`), novo = text(t?.novo, 120);
    if (!atual) { discarded++; continue; }                     // a IA citou um texto que o anúncio não tem
    if (valid(tipo, novo)) trocas.push({ tipo, atual, motivo: text(t?.motivo), novo, pt: text(t?.pt, 200) });
  }
  const novos: AdAdvice['novos'] = [];
  for (const n of Array.isArray(raw?.novos) ? raw.novos : []) {
    const tipo = ['titulo', 'descricao', 'sitelink', 'destaque'].includes(n?.tipo) ? n.tipo : '', novo = text(n?.novo, 120);
    const d1 = text(n?.desc1, 60), d2 = text(n?.desc2, 60);
    if (tipo === 'sitelink' && ((d1 || d2) && (problemOf(ad.funnel, 'sitelink_desc', d1) || problemOf(ad.funnel, 'sitelink_desc', d2)))) { discarded++; continue; }
    if (valid(tipo, novo)) novos.push({ tipo, novo, pt: text(n?.pt, 200), motivo: text(n?.motivo), ...(tipo === 'sitelink' && d1 && d2 ? { desc1: d1, desc2: d2 } : {}) });
  }
  return { leitura: text(raw?.leitura, 900), trocas: trocas.slice(0, 6), novos, descartados: discarded };
}
