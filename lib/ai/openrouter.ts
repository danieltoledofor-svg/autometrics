import { supabaseAdmin, appUrl } from '@/lib/googleAds/server';

/**
 * IA pelo OpenRouter. Cada chamada fica registrada em ai_usage (tokens e custo
 * em dólar, informado pelo próprio OpenRouter) — é daí que sai o painel de
 * consumo do dono e, mais tarde, os créditos por plano.
 *
 * Sem OPENROUTER_API_KEY a análise segue só com os números e os textos padrão.
 */

export type AiFunction = 'leitura' | 'pagina' | 'padroes' | 'recursos';

/**
 * Padrão de cada função; o dono troca em /ia sem precisar publicar. As leituras
 * usam modelo barato. A escrita dos anúncios (recursos) usa um modelo forte em
 * redação: ali o texto é o que vai ao ar, e cada pacote é pedido poucas vezes.
 */
export const DEFAULT_MODELS: Record<AiFunction, string> = {
  leitura: process.env.AI_MODEL_LEITURA || 'deepseek/deepseek-v4.1-flash',
  pagina: process.env.AI_MODEL_PAGINA || 'google/gemini-3.5-flash-lite',
  padroes: process.env.AI_MODEL_PADROES || 'deepseek/deepseek-v4.1-flash',
  recursos: process.env.AI_MODEL_RECURSOS || 'anthropic/claude-sonnet-5.5',
};

export const FUNCTION_LABELS: Record<AiFunction, { label: string; when: string }> = {
  leitura: { label: 'Texto da leitura (resumo e pontos de alteração)', when: 'quando algum item muda de status e 1 vez por dia' },
  pagina: { label: 'Anúncio × página × VSL', when: 'quando a página, a VSL ou os termos principais mudam, e 1 vez por semana' },
  padroes: { label: 'Análise de IA (leitura do grupo e perguntas)', when: 'só quando o usuário pede a leitura ou faz uma pergunta na tela Análise de IA' },
  recursos: { label: 'Títulos, descrições, sitelinks e frases de destaque', when: 'só quando o usuário pede os recursos ao criar uma campanha' },
};

export const aiEnabled = () => !!process.env.OPENROUTER_API_KEY;

let modelCache: { at: number; models: Record<string, string> } | null = null;

export async function modelFor(fn: AiFunction): Promise<string> {
  if (!modelCache || Date.now() - modelCache.at > 5 * 60 * 1000) {
    const { data } = await supabaseAdmin().from('ai_settings').select('function, model');
    modelCache = { at: Date.now(), models: Object.fromEntries((data || []).map(r => [r.function, r.model])) };
  }
  return modelCache.models[fn] || DEFAULT_MODELS[fn];
}

export function clearModelCache() {
  modelCache = null;
}

/**
 * Dono do Autometrics: uma conta só, fixa no código. É a única que abre o
 * painel de consumo e troca o modelo de cada função — modelo caro escolhido
 * por engano (ou por outra pessoa) vira gasto na hora. Não vem de variável
 * de ambiente de propósito: ninguém mais entra na lista sem mudar o código.
 */
const OWNER_EMAIL = 'dcalmeida431@gmail.com';

export function isOwner(email?: string | null): boolean {
  return !!email && email.trim().toLowerCase() === OWNER_EMAIL;
}

export interface AiCall {
  fn: AiFunction;
  userId: string;
  productId?: string | null;
  system: string;
  user: string;
  maxTokens?: number;
  /** Campo de texto principal: se a resposta vier cortada, aproveita o que chegou dele. */
  textField?: string;
  /** Quanto a IA varia o texto. Leitura de números fica em 0,2 (padrão); escrita de anúncio pede mais variedade. */
  temperature?: number;
}

/**
 * Chama o modelo pedindo JSON. Devolve o objeto ou lança erro (já registrado).
 *
 * Resposta que bate no limite de tamanho chega cortada no meio e deixa de ser
 * JSON: nesse caso pede de novo, uma vez, com o dobro do espaço. Se ainda vier
 * cortada e houver um campo de texto principal, devolve o que chegou dele.
 */
export async function askJson<T = any>(call: AiCall): Promise<T> {
  try {
    return await askOnce<T>(call, call.maxTokens || 2500, false);
  } catch (e: any) {
    if (!(e instanceof CutShort)) throw e;
    return askOnce<T>(call, (call.maxTokens || 2500) * 2, true);
  }
}

class CutShort extends Error {}
/** Erro que leva junto um pedaço do que a IA devolveu, só para o registro de consumo. */
class Detail extends Error {
  constructor(message: string, public content: string) { super(message); }
}

async function askOnce<T>(call: AiCall, maxTokens: number, lastTry: boolean): Promise<T> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');
  const model = await modelFor(call.fn);
  const started = Date.now();
  let usage: any = {};
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': appUrl(),
        'X-Title': 'Autometrics',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: call.system }, { role: 'user', content: call.user }],
        response_format: { type: 'json_object' },
        temperature: call.temperature ?? 0.2,
        max_tokens: maxTokens,
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json().catch(() => ({}));
    usage = body.usage || {};
    if (!res.ok) throw new Error(body?.error?.message || `OpenRouter ${res.status}`);
    const content = String(body.choices?.[0]?.message?.content || '');
    let parsed = parseJson(content);
    if (!parsed && body.choices?.[0]?.finish_reason === 'length') {
      if (!lastTry) throw new CutShort('Resposta da IA cortada no limite de tamanho');
      const partial = call.textField ? partialText(content, call.textField) : '';
      if (partial) parsed = { [call.textField!]: `${partial}…\n\n(A resposta ficou longa e foi cortada aqui. Para ver o resto, faça uma pergunta mais específica.)` };
      else throw new Detail('A IA não conseguiu terminar a resposta. Tente de novo.', content);
    }
    if (!parsed) throw new Detail('A IA respondeu fora do formato esperado. Tente de novo.', content);
    await logUsage(call, model, usage, true, null);
    return parsed as T;
  } catch (e: any) {
    const seen = e instanceof Detail ? ` · ${e.content.length} caracteres, começo: ${JSON.stringify(e.content.slice(0, 160))}, fim: ${JSON.stringify(e.content.slice(-60))}` : '';
    await logUsage(call, model, usage, false, `${e.message} (${Date.now() - started} ms)${seen}`);
    throw e;
  }
}

function parseJson(text: string): any {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(clean); } catch { /* segue */ }
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch { /* segue */ }
  }
  return null;
}

/** O que chegou de um campo de texto num JSON cortado no meio. */
function partialText(content: string, field: string): string {
  const start = new RegExp(`"${field}"\\s*:\\s*"`).exec(content);
  if (!start) return '';
  let raw = content.slice(start.index + start[0].length);
  const end = /(^|[^\\])(\\\\)*"/.exec(raw);                       // aspas que fecham, se o corte veio depois
  if (end) raw = raw.slice(0, end.index + end[0].length - 1);
  raw = raw.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, '');     // sequência cortada no fim
  try { return String(JSON.parse(`"${raw}"`)).trim(); } catch { return ''; }
}

async function logUsage(call: AiCall, model: string, usage: any, ok: boolean, error: string | null) {
  const { error: dbError } = await supabaseAdmin().from('ai_usage').insert({
    user_id: call.userId,
    product_id: call.productId || null,
    function: call.fn,
    model,
    input_tokens: Number(usage.prompt_tokens) || 0,
    output_tokens: Number(usage.completion_tokens) || 0,
    cost_usd: Number(usage.cost) || 0,
    ok,
    error,
  });
  if (dbError) console.warn('[ia] consumo não registrado:', dbError.message);
}
