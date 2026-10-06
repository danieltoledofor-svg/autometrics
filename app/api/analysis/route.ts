import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { runAnalysis, analysisTablesReady } from '@/lib/analysis/run';
import { campaignHistory, recordLearning } from '@/lib/analysis/memory';
import { aiEnabled } from '@/lib/ai/openrouter';
import { changeReview } from '@/lib/analysis/changes';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * Aba "Análise" da campanha.
 *
 * GET    ?product_id=   leitura gravada, sugestões e resultados desta campanha
 * GET    ?product_id=&only=changes   só as alterações feitas e o que aconteceu depois
 * POST   { product_id } reanalisar agora
 * PATCH  { id, status, correction, general } "Ignorar" ou "Não faz sentido" numa
 *        sugestão; no segundo caso, com o que o usuário faria no lugar
 * PUT    { product_id, vsl_transcript } salvar a transcrição da VSL
 *
 * Tudo passa pelo dono da campanha. A memória geral nunca sai por aqui.
 */

async function ownProduct(request: Request, productId: string | null) {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 }) };
  if (!productId) return { error: NextResponse.json({ error: 'Informe a campanha.' }, { status: 400 }) };
  const { data: product } = await supabaseAdmin().from('products').select('id, user_id')
    .eq('id', productId).eq('user_id', user.id).maybeSingle();
  if (!product) return { error: NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 }) };
  return { user, product };
}

export async function GET(request: Request) {
  const productId = new URL(request.url).searchParams.get('product_id');
  const own = await ownProduct(request, productId);
  if ('error' in own) return own.error;
  if (new URL(request.url).searchParams.get('only') === 'changes') {
    return NextResponse.json({ changes: await changeReview(productId!).catch(() => []) });
  }
  if (!(await analysisTablesReady())) {
    return NextResponse.json({ ready: false, error: 'Rode migration_analise_ia.sql no Supabase.' });
  }
  const db = supabaseAdmin();
  const [{ data: analysis }, { data: open }, history, { data: product }, changes] = await Promise.all([
    db.from('campaign_analyses').select('*').eq('product_id', productId).maybeSingle(),
    db.from('analysis_suggestions')
      .select('id, item, target_key, target_label, action, text, severity, status, change_at, change, eval_3d, baseline, created_at')
      .eq('product_id', productId).in('status', ['aberta', 'aplicada']).order('created_at', { ascending: false }),
    campaignHistory(productId!, 30),
    db.from('products').select('vsl_transcript').eq('id', productId).maybeSingle(),
    changeReview(productId!).catch(() => []),
  ]);
  return NextResponse.json({
    ready: true,
    ai: aiEnabled(),
    analysis,
    changes,
    suggestions: (open || []).filter(s => s.item !== 'pagina').map(s => ({ ...s, baseline: { keyword: s.baseline?.keyword ?? null, cpa3: s.baseline?.row?.cpa3 ?? null, cost3: s.baseline?.row?.cost3 ?? null, vturb: s.baseline?.vturb ? { metric: s.baseline.vturb.metric ?? null, d3: s.baseline.vturb.d3 ?? null } : null } })),
    // O topo de funil (item 'pagina') tem o histórico na aba VTurb.
    history: history.filter(h => h.item !== 'pagina' && (h.status === 'avaliada' || h.status === 'nao_faz_sentido')).map(h => ({
      id: h.id, item: h.item, target_label: h.target_label, action: h.action, text: h.text, status: h.status,
      outcome: h.outcome, change_at: h.change_at, eval: h.eval_7d || h.eval_3d || null, created_at: h.created_at,
      correction: h.change?.correction || null,
    })),
    transcript: product?.vsl_transcript ? { chars: String(product.vsl_transcript).length, text: product.vsl_transcript } : null,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const own = await ownProduct(request, body.product_id || null);
  if ('error' in own) return own.error;
  if (!(await analysisTablesReady())) return NextResponse.json({ error: 'Rode migration_analise_ia.sql no Supabase.' }, { status: 409 });
  const result = await runAnalysis(body.product_id, { force: true });
  return NextResponse.json(result, { status: 'error' in result ? 500 : 200 });
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const { id, status, correction: rawCorrection, general } = await request.json().catch(() => ({}));
  if (!id || !['ignorada', 'nao_faz_sentido'].includes(status)) {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data: s } = await db.from('analysis_suggestions').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Sugestão não encontrada.' }, { status: 404 });
  // O que o usuário faria no lugar fica na própria sugestão (para o histórico
  // desta campanha) e na memória da IA (para as próximas leituras).
  const correction = status === 'nao_faz_sentido' ? String(rawCorrection || '').trim().slice(0, 1000) : '';
  const patch: any = { status, updated_at: new Date().toISOString() };
  if (correction) patch.change = { ...(s.change || {}), correction, corrected_at: new Date().toISOString() };
  await db.from('analysis_suggestions').update(patch).eq('id', id);
  // "Não faz sentido" também ensina: a IA passa a ver que essa alteração, nessa situação, costuma ser recusada.
  if (status === 'nao_faz_sentido' && s.status !== 'nao_faz_sentido') {
    await recordLearning({ id: s.id, item: s.item, action: s.action, situation: s.situation, outcome: 'recusada' });
  }
  let remembered = false;
  if (correction) {
    // Uma anotação por sugestão: corrigir de novo troca o texto, não duplica.
    const title = `Correção · ${String(s.target_label).slice(0, 110)} · ${String(s.id).slice(0, 8)}`;
    const content = `A IA apontou em "${s.target_label}": ${s.text}\nO afiliado disse que não faz sentido. O que ele faria: ${correction}`;
    const row = { user_id: user.id, product_id: general ? null : s.product_id, kind: 'decisao', title, content, summary: content, updated_at: new Date().toISOString() };
    const { data: old, error: readError } = await db.from('ai_memory').select('id').eq('user_id', user.id).eq('title', title).maybeSingle();
    if (!readError) {
      const { error } = old ? await db.from('ai_memory').update(row).eq('id', old.id) : await db.from('ai_memory').insert(row);
      remembered = !error;
    }
  }
  return NextResponse.json({ ok: true, remembered });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const own = await ownProduct(request, body.product_id || null);
  if ('error' in own) return own.error;
  const text = String(body.vsl_transcript || '').trim().slice(0, 60_000);
  const { error } = await supabaseAdmin().from('products').update({ vsl_transcript: text || null }).eq('id', body.product_id);
  if (error) return NextResponse.json({ error: /vsl_transcript/.test(error.message) ? 'Rode migration_analise_ia.sql no Supabase.' : error.message }, { status: 500 });
  return NextResponse.json({ ok: true, chars: text.length });
}
