import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { isOwner, DEFAULT_MODELS, FUNCTION_LABELS, clearModelCache, aiEnabled, type AiFunction } from '@/lib/ai/openrouter';

export const dynamic = 'force-dynamic';

/**
 * Painel do dono do Autometrics: modelo de cada função e consumo da IA.
 * Só para os e-mails em AUTOMETRICS_OWNER_EMAILS.
 *
 * GET  modelos em uso, lista do OpenRouter com preços e consumo do mês
 * PUT  { function, model } troca o modelo de uma função
 */

async function owner(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 }) };
  if (!isOwner(user.email)) return { error: NextResponse.json({ owner: false }, { status: 403 }) };
  return { user };
}

let modelsCache: { at: number; list: any[] } | null = null;

/** Modelos do OpenRouter que respondem em JSON, do mais barato ao mais caro. */
async function openRouterModels() {
  if (modelsCache && Date.now() - modelsCache.at < 60 * 60 * 1000) return modelsCache.list;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    const list = (body.data || [])
      .filter((m: any) => (m.supported_parameters || []).some((p: string) => p === 'response_format' || p === 'structured_outputs'))
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        input: Number(m.pricing?.prompt || 0) * 1e6,
        output: Number(m.pricing?.completion || 0) * 1e6,
        context: m.context_length,
      }))
      .filter((m: any) => m.input > 0 && !m.id.endsWith(':batch'))
      .sort((a: any, b: any) => a.input + a.output / 4 - (b.input + b.output / 4));
    modelsCache = { at: Date.now(), list };
    return list;
  } catch {
    return modelsCache?.list || [];
  }
}

export async function GET(request: Request) {
  const own = await owner(request);
  if ('error' in own) return own.error;
  // ?check=1: só para a Integração saber se mostra o link desta tela.
  if (new URL(request.url).searchParams.get('check')) return NextResponse.json({ owner: true });
  const db = supabaseAdmin();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const usage: any[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db.from('ai_usage')
      .select('user_id, product_id, function, model, input_tokens, output_tokens, cost_usd, ok, created_at')
      .gte('created_at', monthStart < weekAgo ? monthStart : weekAgo)
      .range(page * 1000, page * 1000 + 999);
    if (error) return NextResponse.json({ error: 'Rode migration_analise_ia.sql no Supabase.' }, { status: 409 });
    usage.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const month = usage.filter(u => u.created_at >= monthStart);
  const week = usage.filter(u => u.created_at >= weekAgo);
  const sum = (l: any[], k: string) => l.reduce((s, u) => s + Number(u[k] || 0), 0);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

  const byUser = new Map<string, any>();
  for (const u of month) {
    const cur = byUser.get(u.user_id) || { user_id: u.user_id, calls: 0, errors: 0, campaigns: new Set<string>(), leitura: 0, pagina: 0, total: 0 };
    cur.calls++;
    if (!u.ok) cur.errors++;
    if (u.product_id) cur.campaigns.add(u.product_id);
    cur[u.function] = (cur[u.function] || 0) + Number(u.cost_usd || 0);
    cur.total += Number(u.cost_usd || 0);
    byUser.set(u.user_id, cur);
  }
  const users = await Promise.all([...byUser.values()].map(async u => {
    const { data } = await db.auth.admin.getUserById(u.user_id).catch(() => ({ data: null as any }));
    return { ...u, campaigns: u.campaigns.size, email: data?.user?.email || u.user_id, you: u.user_id === own.user.id };
  }));

  const { data: settings } = await db.from('ai_settings').select('function, model, updated_at');
  const current = Object.fromEntries((Object.keys(DEFAULT_MODELS) as AiFunction[]).map(fn => [
    fn, settings?.find(s => s.function === fn)?.model || DEFAULT_MODELS[fn],
  ]));

  return NextResponse.json({
    owner: true,
    ai: aiEnabled(),
    functions: (Object.keys(FUNCTION_LABELS) as AiFunction[]).map(fn => ({ id: fn, ...FUNCTION_LABELS[fn], model: current[fn], default: DEFAULT_MODELS[fn] })),
    models: await openRouterModels(),
    month: {
      cost: sum(month, 'cost_usd'),
      calls: month.length,
      errors: month.filter(u => !u.ok).length,
      tokens: sum(month, 'input_tokens') + sum(month, 'output_tokens'),
      projection: (sum(week, 'cost_usd') / 7) * daysInMonth,
    },
    users: users.sort((a, b) => b.total - a.total),
  });
}

export async function PUT(request: Request) {
  const own = await owner(request);
  if ('error' in own) return own.error;
  const { function: fn, model } = await request.json().catch(() => ({}));
  if (!(fn in DEFAULT_MODELS) || !model || typeof model !== 'string') {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const { error } = await supabaseAdmin().from('ai_settings')
    .upsert({ function: fn, model, updated_at: new Date().toISOString() }, { onConflict: 'function' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  clearModelCache();
  return NextResponse.json({ ok: true });
}
