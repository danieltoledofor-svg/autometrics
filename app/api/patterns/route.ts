import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/googleAds/server';
import { computePatterns, PERIODS, type PeriodKey, type Patterns } from '@/lib/analysis/patterns';
import { aiEnabled, askJson } from '@/lib/ai/openrouter';
import { languageProblems } from '@/lib/analysis/actions';
import { formatMoney } from '@/lib/analysis/labels';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * Tela "Padrões": o que se repete nas campanhas parecidas do próprio usuário.
 *
 * GET   ?tag=&period=&blocks=   números e padrões, calculados na hora, sem IA
 * POST  { tag, period, blocks } leitura da IA em cima desses mesmos números
 *
 * Só entram campanhas de quem está logado.
 */

function options(tag: any, period: any, blocks: any) {
  return {
    tag: String(tag || '').slice(0, 80),
    period: (PERIODS.some(p => p.key === period) ? period : 'd7') as PeriodKey,
    blocks: String(blocks || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 30),
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const q = new URL(request.url).searchParams;
  try {
    const data = await computePatterns(user.id, options(q.get('tag'), q.get('period'), q.get('blocks')));
    return NextResponse.json({ ...data, ai: aiEnabled() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const SYSTEM = `Você lê os números de um grupo de campanhas parecidas do Google Ads, todas do mesmo afiliado, e aponta o que se repete entre elas.

Regras de linguagem, obrigatórias:
- Português simples e direto. Frases curtas. Nada de termo técnico ou em inglês (proibido: mismatch, cluster, compliance, congruência, insight, performance, funil, "custo por ação"). Use as siglas CPA, CPC, CTR como o afiliado usa.
- Você só aponta, quem decide é o afiliado. Proibido: sugiro, recomendo, considere, tente, pause, ative, melhore, otimize, aumente, diminua, reduza, você deve, vale a pena, faz sentido, seria bom.
- Não invente números. Use só os que vierem no pedido, sem refazer conta.
- Fale "nas campanhas do grupo". Não escreva "outras campanhas", "outras contas" nem "outros usuários".
- Não repita o que já está em JÁ APONTADO; traga o que ainda não foi dito ou junte dois números que se explicam.
- Período com poucas vendas: diga que o número ainda é pequeno para concluir.

Responda só com JSON:
{"titulo": "frase de até 100 caracteres com o principal do grupo, com número",
 "pontos": [{"tipo": "funciona" | "desperdicio" | "atencao", "texto": "até 200 caracteres, com o número que sustenta"}]}
No máximo 5 pontos.`;

function prompt(p: Extract<Patterns, { empty: false }>, tag: string) {
  const money = (v: number | null) => (v === null ? '—' : formatMoney(v, p.currency));
  const line = (r: any) => `- ${r.text}: ${r.campaigns} campanhas · custo ${money(r.cost)} · vendas ${r.conv} · CPA ${money(r.cpa)}`;
  const label = PERIODS.find(x => x.key === p.period.key)!.label;
  return `Grupo: campanhas com "${tag || 'todas'}" no nome · período: ${label}${p.period.from ? ` (${p.period.from} a ${p.period.to})` : ''}
${p.approx ? 'As vendas de termo e de dispositivo são as vendas reais de cada campanha divididas entre os itens (valor aproximado).' : 'As vendas são as conversões do Google.'}

TOTAL DO GRUPO: ${p.totals.campaigns} campanhas com gasto · custo ${money(p.totals.cost)} · vendas ${p.totals.sales} · CPA ${money(p.totals.cpa)}${p.totals.result !== null ? ` · resultado ${money(p.totals.result)}` : ''}
CPA médio dos termos informados pelo Google: ${money(p.term_cpa)}

EXPRESSÕES QUE SE REPETEM NOS TERMOS:
${p.pairs.map(line).join('\n') || '(sem dados)'}

PALAVRAS QUE SE REPETEM NOS TERMOS:
${p.words.map(line).join('\n') || '(sem dados)'}

DISPOSITIVOS:
${p.devices.map(line).join('\n') || '(sem dados)'}

VÍDEO (quem chega à oferta × CPA):
${p.video.rows.filter(r => r.campaigns > 0).map(r => `- ${r.label}: ${r.campaigns} campanhas · CPA ${money(r.cpa)}`).join('\n') || '(sem vídeo ligado)'}

CAMPANHAS RODANDO, PERÍODO TODO: ${p.verdict_counts.manter} no lucro no total e na semana · ${p.verdict_counts.ajustar} com total e semana em sentidos opostos · ${p.verdict_counts.pausar} no prejuízo no total e na semana · ${p.verdict_counts.cedo} com pouco gasto para dizer

JÁ APONTADO:
${p.highlights.map(h => `- ${h.text}`).join('\n') || '(nada)'}`;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  if (!aiEnabled()) return NextResponse.json({ error: 'A IA está desligada no servidor.' }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  const opts = options(body.tag, body.period, body.blocks);
  try {
    const p = await computePatterns(user.id, opts);
    if (p.empty || !p.totals.cost) return NextResponse.json({ error: 'Sem gasto neste período para a IA ler.' }, { status: 400 });
    const raw = await askJson<any>({ fn: 'padroes', userId: user.id, system: SYSTEM, user: prompt(p, opts.tag), maxTokens: 1500 });
    const points = (Array.isArray(raw?.pontos) ? raw.pontos : [])
      .map((x: any) => ({ mark: ['funciona', 'desperdicio', 'atencao'].includes(x?.tipo) ? x.tipo : 'atencao', text: String(x?.texto || '').trim().slice(0, 260) }))
      .filter((x: any) => x.text && !languageProblems(x.text).length).slice(0, 5);
    const title = String(raw?.titulo || '').trim().slice(0, 140);
    if (!points.length) return NextResponse.json({ error: 'A IA não devolveu uma leitura aproveitável. Tente de novo.' }, { status: 502 });
    return NextResponse.json({ reading: { title: languageProblems(title).length ? '' : title, points, generated_at: new Date().toISOString() } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
