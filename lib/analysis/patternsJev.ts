import { jevChoose, jevEnabled } from '@/lib/ai/jev';
import type { Patterns } from './patterns';

/**
 * O Jev (TypeSafe) na Análise de IA, para o cruzamento entre campanhas.
 *
 * Os números e as marcas (funciona, desperdício, atenção) continuam do código.
 * O Jev acrescenta duas leituras rápidas, que a IA e a tela usam:
 *
 * - termo de pesquisa e palavra-chave: "padrão firme" (se repete com dado
 *   suficiente) ou "pode ser acaso" (pouca venda, pouco gasto ou uma campanha só);
 * - campanha que o código mandou ajustar ou pausar: "mexer agora" ou "esperar",
 *   a mesma pergunta que ele já responde nas sugestões de cada campanha.
 *
 * Ele lê melhor palavras do que números: a conta é feita aqui e vai em faixas.
 * Sem o Jev, ou se ele não responder, nada muda. A resposta fica guardada por
 * 10 minutos para o mesmo conjunto, para a tela e a pergunta à IA não pagarem duas vezes.
 */

export type JevPattern = 'firme' | 'acaso';
export type JevMove = 'mexer_agora' | 'esperar';

const cache = new Map<string, { at: number; terms: Map<string, JevPattern>; moves: Map<string, JevMove> }>();

const salesBucket = (c: number) => (c <= 0 ? 'no sales' : c < 1.5 ? 'about 1 sale' : c < 4 ? 'a few sales (2-3)' : c < 10 ? 'several sales (4-9)' : 'many sales (10 or more)');
const campaignsBucket = (n: number) => (n <= 1 ? 'only 1 campaign' : n <= 3 ? '2-3 campaigns' : '4 or more campaigns');
function costBucket(cost: number, ref: number | null) {
  if (!ref) return 'no average to compare';
  const r = cost / ref;
  return r < 0.5 ? 'spent less than half of one average sale' : r < 1 ? 'spent about one average sale' : r < 3 ? 'spent 1 to 3 average sales' : 'spent more than 3 average sales';
}
function cpaBucket(cpa: number | null, ref: number | null) {
  if (cpa === null || !ref) return 'no cost per sale';
  const r = cpa / ref;
  return r < 0.8 ? 'cost per sale clearly below the group average' : r <= 1.2 ? 'cost per sale close to the group average' : r <= 2 ? 'cost per sale above the group average' : 'cost per sale far above the group average';
}
const resultBucket = (v: number | null) => (v === null ? 'unknown' : v > 0 ? 'profit' : v < 0 ? 'loss' : 'break-even');

const PATTERN = {
  padrao: {
    type: 'choice',
    instructions: 'An affiliate compares a group of similar Google Ads campaigns. Is the result of this item a reliable pattern of the group, or could it be chance?',
    criteria: {
      firme: 'Reliable pattern: enough spend and sales, and it shows up in more than one campaign, so it is safe to use when deciding.',
      acaso: 'Could be chance: few sales, little spend, or only one campaign; it may not repeat.',
    },
  },
};
const MOVE = {
  agir: {
    type: 'choice',
    instructions: 'An automatic check says this Google Ads campaign should be adjusted or paused. Should the affiliate act now, or wait a few more days because the numbers are still too small or may recover?',
    criteria: {
      mudar_agora: 'Act now: the loss is clear and there is enough data to be confident.',
      esperar: 'Wait: little data, recent change, or the last days are better; it may recover on its own.',
    },
  },
};

type Full = Extract<Patterns, { empty: false }>;
type TermRow = Full['terms_best'][number] & { jev?: JevPattern | null };
type VerdictRow = Full['verdicts'][number] & { jev?: JevMove | null };

/** Acrescenta a leitura do Jev nas linhas (no próprio objeto). Devolve quantas ele respondeu. */
export async function addJev(userId: string, p: Full, key: string): Promise<{ asked: number; answered: number }> {
  if (!jevEnabled()) return { asked: 0, answered: 0 };
  const terms: [TermRow, string, number | null][] = [
    ...p.terms_best.map(r => [r, 'search term', p.term_cpa] as [TermRow, string, number | null]),
    ...p.terms_waste.map(r => [r, 'search term', p.term_cpa] as [TermRow, string, number | null]),
    ...p.keywords_best.map(r => [r, 'keyword', p.keyword_cpa] as [TermRow, string, number | null]),
    ...p.keywords_waste.map(r => [r, 'keyword', p.keyword_cpa] as [TermRow, string, number | null]),
  ];
  const moves = (p.verdicts as VerdictRow[]).filter(v => v.verdict === 'ajustar' || v.verdict === 'pausar').slice(0, 30);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
    for (const [r, kind] of terms) r.jev = hit.terms.get(`${kind}|${r.text}`) || null;
    for (const v of moves) v.jev = hit.moves.get(v.id) || null;
    return { asked: terms.length + moves.length, answered: hit.terms.size + hit.moves.size };
  }

  const termOut = new Map<string, JevPattern>(), moveOut = new Map<string, JevMove>();
  const jobs: (() => Promise<void>)[] = [
    ...terms.map(([r, kind, ref]) => async () => {
      const a = await jevChoose({ userId, productId: null }, {
        item_type: kind, sales: salesBucket(r.conv), spend: costBucket(r.cost, ref), versus_average: cpaBucket(r.cpa, ref),
        found_in: campaignsBucket(r.campaigns), sales_are_estimated: p.approx,
      }, PATTERN, 'padrao', ['firme', 'acaso']);
      r.jev = (a?.choice as JevPattern) || null;
      if (r.jev) termOut.set(`${kind}|${r.text}`, r.jev);
    }),
    ...moves.map(v => async () => {
      const a = await jevChoose({ userId, productId: v.id }, {
        item_type: 'campaign', automatic_check: v.verdict === 'pausar' ? 'pause' : 'adjust',
        whole_life: { result: resultBucket(v.result), sales: salesBucket(v.sales), days_with_spend: v.days < 7 ? 'less than a week' : v.days < 30 ? '1 to 4 weeks' : 'more than a month' },
        last_7_days: { result: resultBucket(v.result7), sales: salesBucket(v.sales7) },
        status_today: v.status?.key || 'unknown',
      }, MOVE, 'agir', ['mudar_agora', 'esperar']);
      v.jev = a ? (a.choice === 'mudar_agora' ? 'mexer_agora' : 'esperar') : null;
      if (v.jev) moveOut.set(v.id, v.jev);
    }),
  ];
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 10 }, async () => { for (let job = queue.shift(); job; job = queue.shift()) await job(); }));
  cache.set(key, { at: Date.now(), terms: termOut, moves: moveOut });
  return { asked: jobs.length, answered: termOut.size + moveOut.size };
}

export const JEV_PATTERN_PT: Record<JevPattern, string> = { firme: 'padrão firme', acaso: 'pode ser acaso' };
export const JEV_MOVE_PT: Record<JevMove, string> = { mexer_agora: 'mexer agora', esperar: 'esperar' };
