import { supabaseAdmin, appUrl } from '@/lib/googleAds/server';

/**
 * IA pelo OpenRouter. Cada chamada fica registrada em ai_usage (tokens e custo
 * em dólar, informado pelo próprio OpenRouter) — é daí que sai o painel de
 * consumo do dono e, mais tarde, os créditos por plano.
 *
 * Sem OPENROUTER_API_KEY a análise segue só com os números e os textos padrão.
 */

export type AiFunction = 'leitura' | 'pagina';

/** Padrão barato de cada função; o dono troca em /ia sem precisar publicar. */
export const DEFAULT_MODELS: Record<AiFunction, string> = {
  leitura: process.env.AI_MODEL_LEITURA || 'deepseek/deepseek-v4.1-flash',
  pagina: process.env.AI_MODEL_PAGINA || 'google/gemini-3.5-flash-lite',
};

export const FUNCTION_LABELS: Record<AiFunction, { label: string; when: string }> = {
  leitura: { label: 'Texto da leitura (resumo e pontos de alteração)', when: 'quando algum item muda de status e 1 vez por dia' },
  pagina: { label: 'Anúncio × página × VSL', when: 'quando a página, a VSL ou os termos principais mudam, e 1 vez por semana' },
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

/** Dono do Autometrics: e-mails em AUTOMETRICS_OWNER_EMAILS, separados por vírgula. */
export function isOwner(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.AUTOMETRICS_OWNER_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

export interface AiCall {
  fn: AiFunction;
  userId: string;
  productId?: string | null;
  system: string;
  user: string;
  maxTokens?: number;
}

/** Chama o modelo pedindo JSON. Devolve o objeto ou lança erro (já registrado). */
export async function askJson<T = any>(call: AiCall): Promise<T> {
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
        temperature: 0.2,
        max_tokens: call.maxTokens || 2500,
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json().catch(() => ({}));
    usage = body.usage || {};
    if (!res.ok) throw new Error(body?.error?.message || `OpenRouter ${res.status}`);
    const content = String(body.choices?.[0]?.message?.content || '');
    const parsed = parseJson(content);
    if (!parsed) throw new Error('Resposta da IA sem JSON válido');
    await logUsage(call, model, usage, true, null);
    return parsed as T;
  } catch (e: any) {
    await logUsage(call, model, usage, false, `${e.message} (${Date.now() - started} ms)`);
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
