import { askJson } from '@/lib/ai/openrouter';
import { languageProblems } from '@/lib/analysis/actions';
import { formatMoney } from '@/lib/analysis/labels';
import { memoryBlock, memoryFor } from '@/lib/analysis/userMemory';
import { mmss } from './funnel';

/**
 * Perguntas à IA na aba VTurb.
 *
 * A IA recebe o que a aba mostra desta campanha, no período da tela: o caminho
 * do clique à venda (com os últimos 3 e 7 dias ao lado), aparelho, grupo de
 * anúncios e palavra-chave, a retenção do vídeo com o trecho da VSL onde mais
 * gente sai, a leitura da página e as alterações feitas nesses dias. Mais as
 * anotações do próprio afiliado. Nada de outras campanhas.
 */

const SYSTEM = `Você responde perguntas de um afiliado sobre UMA campanha dele no Google Ads que leva para uma página com vídeo de vendas (VSL). Use só os números e textos que vierem no pedido.

Como ler os dados:
- O caminho é: clique no anúncio → carregou o vídeo → deu play → chegou ao pitch (o momento da oferta no vídeo) → clicou no botão → abriu o checkout → venda.
- "Fuga da página" é quem clicou no anúncio e não chegou a carregar o vídeo.
- Etapa marcada como "sem medição" não é perda: só não está sendo contada.
- Nas linhas por aparelho, grupo e palavra-chave, linha com menos de 30 visitas é pouca gente para concluir.

Regras, obrigatórias:
- Português simples e direto. Frases curtas. Nada de termo técnico ou em inglês (proibido: mismatch, cluster, compliance, congruência, insight, performance, funil, engajamento, "custo por ação"). Use CPA, CPC, CTR, VSL e pitch como o afiliado usa.
- Responda primeiro o que foi perguntado, com os números que sustentam. Pode comparar, somar e dividir os números do pedido; mostre a conta quando fizer.
- Quando perguntarem o que dá para melhorar, aponte de 2 a 4 pontos, do maior para o menor, e em cada um diga: onde está a perda (com o número), o que os dados mostram sobre a causa e quais caminhos existem (página, vídeo, palavra-chave, aparelho, lance, meta). A decisão é do afiliado: descreva os caminhos sem dar ordem.
- Não invente número, trecho do vídeo nem palavra-chave. Se o dado necessário não está no pedido, diga qual dado falta em vez de estimar.
- Quando a amostra for pequena (poucas vendas, poucos dias, poucas visitas), diga isso.
- Ao ligar uma mudança de número a uma alteração feita na campanha, diga que foi depois dela, não que foi por causa dela, a não ser que os números deixem claro.
- Fale só desta campanha. Nunca mencione campanhas, contas ou usuários de fora.

Responda só com JSON: {"resposta": "texto em parágrafos curtos; use quebra de linha para separar parágrafos e '- ' para listas", "faltou": "dado que faltou para responder melhor, ou vazio"}`;

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
const int = (x: number | null | undefined) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('pt-BR'));
const ratio = (a: number | null, b: number | null) => (a !== null && b ? a / b : null);
const ddmm = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');

/** O que a aba mostra, em texto, para a IA ler. `view` é o que /api/vturb devolve para a tela. */
export function vturbDataPack(view: any, campaign: string): string {
  const s = view.screen, money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(v, view.currency));
  const block = (title: string, lines: string[]) => `${title}:\n${lines.join('\n') || '(sem dados)'}`;
  const path = (t: any) => {
    const noButton = t.button === 0 && t.sales > 0, noCheckout = !t.checkout && t.sales > 0;
    return [
      `cliques ${int(t.clicks)} (custo ${money(t.cost)})`,
      `carregaram o vídeo ${int(t.viewed)} (fuga da página ${pct(t.clicks > 0 ? Math.max(0, 1 - t.viewed / t.clicks) : null)})`,
      `deram play ${int(t.started)} (${pct(ratio(t.started, t.viewed))} de quem carregou)`,
      `chegaram ao pitch ${int(t.over)} (${pct(ratio(t.over, t.pitchBase))} de quem deu play)`,
      noButton ? 'clique no botão: sem medição' : `clicaram no botão ${int(t.button)}`,
      noCheckout ? 'checkout: sem medição' : `abriram o checkout ${int(t.checkout)}`,
      `vendas ${int(t.sales)} (CPA ${money(t.sales > 0 ? t.cost / t.sales : null)}) · custo por pessoa no pitch ${money(t.over > 0 ? t.cost / t.over : null)}`,
    ].join(' → ');
  };
  const row = (r: any) => `- ${r.label}${r.paused ? ' (pausada)' : ''}: cliques ${int(r.clicks)} · custo ${money(r.cost)} · visitas ligadas ${int(r.viewed)}${r.small ? ' (menos de 30)' : ''} · fuga ${pct(r.leak)} · play ${pct(r.play)} · chegam ao pitch ${pct(r.pitch)} · vendas ${int(r.sales)} · custo por pessoa no pitch ${money(r.cost_per_pitch)}`;
  const out: string[] = [`CAMPANHA: ${campaign}`];
  if (view.player) out.push(`VÍDEO: ${view.player.name || 'sem nome'}${view.player.duration ? ` · duração ${mmss(view.player.duration)}` : ''}${view.player.pitch_time ? ` · pitch em ${mmss(view.player.pitch_time)}` : ''}`);
  if (s) {
    out.push(block('DO CLIQUE À VENDA', [
      `- Período da tela (${ddmm(s.period[0])} a ${ddmm(s.period[1])}): ${path(s.steps)}`,
      `- Últimos 3 dias (${ddmm(s.d3[0])} a ${ddmm(s.d3[1])}): ${path(s.steps3)}`,
      `- Últimos 7 dias (${ddmm(s.d7[0])} a ${ddmm(s.d7[1])}): ${path(s.steps7)}`,
    ]));
    const v = s.segments.visits;
    out.push(`LIGAÇÃO VISITA → CLIQUE DO GOOGLE: ${int(v.matched)} de ${int(v.gclid)} visitas com identificador do clique foram ligadas. As vendas por linha são as que a VTurb contou.`);
    out.push(block('POR APARELHO (período da tela)', s.segments.device.map(row)));
    out.push(block('POR GRUPO DE ANÚNCIOS (período da tela)', s.segments.ad_group.slice(0, 15).map(row)));
    out.push(block('POR PALAVRA-CHAVE (período da tela)', s.segments.keyword.slice(0, 25).map(row)));
    out.push(block('ALTERAÇÕES FEITAS NA CAMPANHA NO PERÍODO', (s.changes || []).slice(0, 12).flatMap((d: any) => d.lines.slice(0, 8).map((l: any) => `- ${ddmm(d.date)} ${l.time}: ${l.text}`))));
  }
  if (view.curve) {
    const c = view.curve;
    const at = (t: number) => { let p = c.points[0]?.[1] ?? 0; for (const [x, y] of c.points) { if (x > t) break; p = y; } return Math.round(p); };
    const marks = [60, 180, 300, 600, 900, 1200, 1500, 1800].filter(t => t < c.duration).map(t => `${mmss(t)} ${at(t)}%`);
    out.push(block(`RETENÇÃO DO VÍDEO (semana de ${ddmm(c.period[0])} a ${ddmm(c.period[1])}; % de quem deu play que ainda assiste)`, [`- ${marks.join(' · ')}`, ...c.notes.map((n: string) => `- ${n}`)]));
    const before = s?.retention_before;
    if (before?.points?.length) {
      const old = (t: number) => { let p = before.points[0][1]; for (const [x, y] of before.points) { if (x > t) break; p = y; } return Math.round(p); };
      out.push(`RETENÇÃO NA SEMANA ANTERIOR (${ddmm(before.period[0])} a ${ddmm(before.period[1])}): ${[60, 300, 600, 900, 1200].filter(t => t < c.duration).map(t => `${mmss(t)} ${old(t)}%`).join(' · ')}${c.pitch_time ? ` · no pitch ${old(c.pitch_time)}% (agora ${at(c.pitch_time)}%)` : ''}`);
    }
  }
  const drops: any[] = view.topo?.drops || [];
  if (drops.length) out.push(block('ONDE MAIS GENTE SAI DO VÍDEO E O QUE A VSL DIZ ALI (trecho aproximado, pela posição no texto)', drops.map(d => `- ${d.label}: saem ${d.left}${d.vsl ? ` · VSL: "${String(d.vsl).slice(0, 420)}"` : ' · sem transcrição'}`)));
  const items: any[] = view.topo?.items || [];
  if (items.length) out.push(block('VERIFICAÇÃO AUTOMÁTICA (3 dias contra 7 dias)', items.map(i => `- ${i.title}: ${i.status === 'sem_dado' ? 'sem dado' : i.status} · ${i.headline}`)));
  const page = view.topo?.page;
  if (page?.grupos?.length) out.push(block('ANÚNCIO × PÁGINA × VSL (o que cada grupo de busca encontra)', page.grupos.slice(0, 8).map((g: any) => `- Quem busca "${g.nome}": ${g.conversa === 'sim' ? 'encontra o assunto' : g.conversa === 'nao' ? 'não encontra o assunto' : 'encontra em parte'}${g.abre ? ` · a página abre com: ${String(g.abre).slice(0, 160)}` : ''}${g.vsl ? ` · na VSL: ${String(g.vsl).slice(0, 160)}` : ''}`)));
  if (page?.achados?.length) out.push(block('O QUE A LEITURA DA PÁGINA ACHOU', page.achados.slice(0, 6).map((a: any) => `- ${a.nivel}: ${a.titulo}. ${String(a.texto || '').slice(0, 260)}`)));
  if (!view.transcript_chars) out.push('TRANSCRIÇÃO DA VSL: não foi enviada, então não há como citar o que o vídeo diz.');
  return out.join('\n\n');
}

export async function askVturb(ids: { userId: string; productId: string }, view: any, campaign: string, question: string, history: any) {
  const past = (Array.isArray(history) ? history : []).slice(-3)
    .map((h: any) => `Pergunta: ${String(h?.q || '').slice(0, 500)}\nResposta: ${String(h?.a || '').slice(0, 1200)}`).join('\n\n');
  const notes = memoryBlock(await memoryFor(ids.userId, { productId: ids.productId, text: campaign }).catch(() => ''));
  const user = `${vturbDataPack(view, campaign)}\n\n${notes ? `${notes}\n\n` : ''}${past ? `CONVERSA ATÉ AQUI:\n${past}\n\n` : ''}PERGUNTA DO AFILIADO:\n${question}`;
  let raw: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await askJson<any>({ fn: 'padroes', userId: ids.userId, productId: ids.productId, system: SYSTEM, user: attempt ? `${user}\n\nATENÇÃO: a resposta anterior usou palavras proibidas. Reescreva em português simples.` : user, maxTokens: 4000, textField: 'resposta' });
    if (!languageProblems(String(raw?.resposta || '')).length) break;
  }
  const text = String(raw?.resposta || '').trim().slice(0, 6000);
  if (!text) throw new Error('A IA não devolveu uma resposta. Tente de novo.');
  return { text, missing: String(raw?.faltou || '').trim().slice(0, 400), at: new Date().toISOString() };
}
