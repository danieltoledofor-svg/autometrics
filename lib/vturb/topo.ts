import { createHash } from 'crypto';
import { worst, type Status } from '@/lib/analysis/compute';
import { pageStatus, type PageResult } from '@/lib/analysis/page';
import { languageProblems } from '@/lib/analysis/actions';
import { askJson } from '@/lib/ai/openrouter';
import { pct, mmss, MIN_VIEWS, type computeFunnel } from './funnel';

/**
 * Análise do topo de funil (aba VTurb): o que acontece depois do clique.
 *
 * Checklist fixo, sempre nesta ordem:
 * 1. Fuga da página      — limites: +5 pp alerta, +10 pp urgente (7 dias)
 * 2. Play                — só informa, sem limite
 * 3. Retenção até o pitch — limites: -15% alerta, -25% urgente; trechos de
 *                          maior saída com o que a VSL diz ali (≈)
 * 4. Palavras-chave      — mesmos limites, 30 visitas ou mais
 * 5. Anúncio × página × VSL — leitura da página com a transcrição
 *
 * Números por código; a IA só escreve o resumo, quando algo muda ou 1 vez
 * por dia (função "pagina", o modelo barato da leitura de página).
 */

export type Funnel = Extract<NonNullable<Awaited<ReturnType<typeof computeFunnel>>>, { keywords: any }>;
export type TopoKey = 'fuga' | 'play' | 'retencao' | 'palavras' | 'congruencia';

const known = (l: Status[]) => l.filter(s => s !== 'sem_dado');

/** Trecho da transcrição entre dois tempos, pela posição no texto (≈): .txt não tem horário. */
export function excerpt(transcript: string, duration: number, from: number, to: number, maxWords = 45): string | null {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (!words.length || !duration) return null;
  const a = Math.max(0, Math.floor((from / duration) * words.length));
  const b = Math.min(words.length, Math.max(a + 1, Math.ceil((to / duration) * words.length)));
  const slice = words.slice(a, b);
  return `${a > 0 ? '…' : ''}${slice.slice(0, maxWords).join(' ')}${slice.length > maxWords || b < words.length ? '…' : ''}`;
}

function curveAt(points: [number, number][], s: number) {
  let v = points[0]?.[1] ?? 0;
  for (const [t, p] of points) { if (t > s) break; v = p; }
  return v;
}

/** Trechos de maior saída: 1º minuto, a maior queda do meio e o minuto do pitch. */
export function dropRows(f: Funnel, transcript: string) {
  const c = f.curve;
  if (!c) return [];
  const rows: { from: number; to: number; label: string; left: string; vsl: string | null }[] = [];
  const add = (from: number, to: number, label: string) => {
    const left = Math.max(0, curveAt(c.points, from) - curveAt(c.points, to));
    rows.push({ from, to, label, left: from === 0 ? `${Math.round(100 - curveAt(c.points, to))}%` : `${Math.round(left)} pp`, vsl: transcript ? excerpt(transcript, c.duration, from, to) : null });
  };
  add(0, 60, '0:00 – 1:00');
  if (c.drop) add(c.drop.from, c.drop.to, `${mmss(c.drop.from)} – ${mmss(c.drop.to)}`);
  if (c.pitch_time) add(c.pitch_time, c.pitch_time + 60, `${mmss(c.pitch_time)} – ${mmss(c.pitch_time + 60)} (pitch)`);
  return rows;
}

export function buildTopo(f: Funnel, page: PageResult | null, transcript: string) {
  const enough = f.d3.viewed >= MIN_VIEWS;
  const kws = f.keywords.rows.filter((r: any) => !r.small);
  const smallCount = f.keywords.rows.length - kws.length;
  const kwBad = kws.filter((r: any) => r.status === 'alerta' || r.status === 'urgente');
  const kwStatus: Status = kws.length ? (known(kws.map((r: any) => r.status)).length ? worst(known(kws.map((r: any) => r.status))) : 'sem_dado') : 'sem_dado';
  const pageS: Status = transcript ? pageStatus(page) : 'sem_dado';
  const drop = f.curve?.drop;

  const items: { key: TopoKey; title: string; status: Status; headline: string }[] = [
    {
      key: 'fuga', title: 'Fuga da página', status: enough ? f.status.leak : 'sem_dado',
      headline: f.d3.leak === null ? 'Sem cliques do Google nos últimos 3 dias'
        : `${pct(f.d3.leak)} em 3 dias (7d ${pct(f.d7.leak)})${f.d7.leak !== null ? ` · ${f.d3.leak >= f.d7.leak ? '▲' : '▼'} ${Math.abs((f.d3.leak - f.d7.leak) * 100).toFixed(1).replace('.', ',')} pp` : ''}`,
    },
    {
      key: 'play', title: 'Play', status: enough && f.d3.play !== null ? 'ok' : 'sem_dado',
      headline: `${pct(f.d3.play)} de quem carregou (7d ${pct(f.d7.play)})`,
    },
    {
      key: 'retencao', title: 'Retenção até o pitch', status: enough ? f.status.pitch : 'sem_dado',
      headline: `${pct(f.d3.pitch)} chegam ao pitch (7d ${pct(f.d7.pitch)})${drop ? ` · maior queda entre ${mmss(drop.from)} e ${mmss(drop.to)}` : ''}`,
    },
    {
      key: 'palavras', title: 'Palavras-chave', status: kwStatus,
      headline: kwBad.length
        ? `${kwBad[0].label}: ${kwBad[0].pitchVs !== null && kwBad[0].pitchVs <= -0.15 ? `chegada ao pitch ${Math.round(-kwBad[0].pitchVs * 100)}% abaixo da campanha` : `fuga da página em ${pct(kwBad[0].leak)}`}`
        : kws.length ? `${kws.length} com 30 visitas ou mais, nenhuma fora do limite${smallCount ? ` · ${smallCount} com menos de 30` : ''}`
          : f.keywords.source === 'nenhuma' ? 'Nenhuma visita com utm_term ou gclid' : 'Nenhuma palavra-chave com 30 visitas ou mais',
    },
    {
      key: 'congruencia', title: 'Anúncio × página × VSL', status: pageS,
      headline: !transcript ? 'Precisa da transcrição da VSL'
        : page?.error ? page.error
          : !page ? 'Aguardando a primeira leitura da página'
            : page.grupos.some(g => g.conversa !== 'sim')
              ? `Quem busca "${page.grupos.find(g => g.conversa !== 'sim')!.nome.toLowerCase()}" ${page.grupos.find(g => g.conversa !== 'sim')!.conversa === 'nao' ? 'não encontra o assunto no começo da página' : 'encontra o assunto só em parte'}`
              : 'Os grupos de busca principais encontram o assunto na página e na VSL',
    },
  ];
  const counts = {
    urgente: items.filter(i => i.status === 'urgente').length,
    alerta: items.filter(i => i.status === 'alerta').length,
    ok: items.filter(i => i.status === 'ok').length,
    sem_dado: items.filter(i => i.status === 'sem_dado').length,
  };
  const ks = known(items.map(i => i.status));
  return { status: (ks.length ? worst(ks) : 'sem_dado') as Status, counts, items, drops: dropRows(f, transcript) };
}

export function topoHash(f: Funnel, page: PageResult | null, transcript: string) {
  const t = buildTopo(f, page, transcript);
  return createHash('sha256').update(JSON.stringify([t.items.map(i => [i.key, i.status]), transcript.length, page?.checked_at || null])).digest('hex').slice(0, 32);
}

const SYSTEM = `Você escreve o resumo do topo de funil de uma campanha do Google Ads para um afiliado: o que acontece depois do clique (página, vídeo, VSL), a partir de números já calculados.

Regras de linguagem, obrigatórias:
- Português simples e direto. Frases curtas. Nada de termo técnico ou em inglês (proibido: mismatch, cluster, compliance, congruência, insight, performance, funil, engajamento). Siglas CPA, CPC, CTR ficam.
- Você só aponta, quem decide é o afiliado. Proibido: sugiro, recomendo, considere, tente, pause, ative, melhore, otimize, aumente, diminua, reduza, você deve, vale a pena, faz sentido, seria bom.
- Não invente números. Use só os que vierem no pedido. Nunca mencione outras campanhas, contas ou usuários.

Responda só com JSON: {"title": "frase de até 90 caracteres com o principal de hoje, com o número", "text": "1 ou 2 frases explicando de onde veio"}`;

export async function writeTopoText(f: Funnel, page: PageResult | null, transcript: string, ids: { userId: string; productId: string }) {
  const t = buildTopo(f, page, transcript);
  const user = `NÚMEROS (3 dias × média de 7 dias):
cliques ${f.d3.clicks} · carregaram o vídeo ${f.d3.viewed} · deram play ${f.d3.started} · chegaram ao pitch ${f.d3.over} · vendas ${f.d3.sales}

CHECKLIST:
${t.items.map((i, n) => `${n + 1}. ${i.title}: ${i.status} · ${i.headline}`).join('\n')}
${f.curve?.notes?.length ? `\nRETENÇÃO (7 dias): ${f.curve.notes.join(' · ')}` : ''}
${t.drops.some(d => d.vsl) ? `\nO QUE A VSL DIZ NOS TRECHOS DE MAIS SAÍDA (estimado pela posição no texto):\n${t.drops.filter(d => d.vsl).map(d => `- ${d.label} (saíram ${d.left}): ${d.vsl}`).join('\n')}` : ''}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r: any = await askJson({ fn: 'pagina', userId: ids.userId, productId: ids.productId, system: SYSTEM, user: attempt ? `${user}\n\nATENÇÃO: a resposta anterior usou palavras proibidas. Reescreva seguindo as regras.` : user, maxTokens: 400 });
    const title = String(r?.title || '').trim(), text = String(r?.text || '').trim();
    if (title && !languageProblems(`${title} ${text}`).length) return { title: title.slice(0, 140), text: text.slice(0, 400) };
  }
  return null;
}
