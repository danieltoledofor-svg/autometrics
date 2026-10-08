import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { computeFunnel } from '@/lib/vturb/funnel';
import { computeScreen } from '@/lib/vturb/screen';
import { syncProductVturb } from '@/lib/vturb/sync';
import { playerIdFrom } from '@/lib/vturb/client';
import { buildTopo, type Funnel } from '@/lib/vturb/topo';
import { runAnalysis, analysisTablesReady } from '@/lib/analysis/run';

/** Item do checklist do topo de funil a que cada sugestão pertence. */
const topoKeyOf = (targetKey: string) =>
  targetKey === 'vturb:fuga' ? 'fuga' : targetKey === 'vturb:pitch' ? 'retencao' : targetKey.startsWith('vturb:kw:') ? 'palavras' : 'congruencia';

/** Funil + análise do topo de funil (checklist, resumo, sugestões, histórico). */
async function vturbView(productId: string, range: { start?: string | null; end?: string | null } = {}) {
  const funnel: any = await computeFunnel(productId);
  if (!funnel?.ready) return funnel;
  // Período da tela: funil em sete etapas, cruzamentos e alterações. Se falhar, a aba segue com o resto.
  funnel.screen = await computeScreen(productId, range.start || null, range.end || null).catch(() => null);
  const db = supabaseAdmin();
  const [{ data: product }, analysis, { data: sugg }] = await Promise.all([
    db.from('products').select('vsl_transcript').eq('id', productId).maybeSingle(),
    (await analysisTablesReady()) ? db.from('campaign_analyses').select('summary, page, computed_at').eq('product_id', productId).maybeSingle().then(r => r.data) : Promise.resolve(null),
    db.from('analysis_suggestions')
      .select('id, target_key, target_label, action, text, severity, status, outcome, change_at, change, eval_3d, eval_7d, baseline, created_at')
      .eq('product_id', productId).eq('item', 'pagina').in('status', ['aberta', 'aplicada', 'avaliada', 'nao_faz_sentido']).order('created_at', { ascending: false }).limit(40)
      .then(r => r, () => ({ data: [] as any[] })),
  ]);
  const transcript = String(product?.vsl_transcript || '').trim();
  const page = analysis?.page || null;
  const topo = buildTopo(funnel as Funnel, page, transcript);
  const list = sugg || [];
  const slim = (x: any) => ({
    id: x.id, topo_key: topoKeyOf(String(x.target_key)), target_label: x.target_label, action: x.action, text: x.text,
    severity: x.severity, status: x.status, outcome: x.outcome, change_at: x.change_at, change: x.change, eval_3d: x.eval_3d,
    eval: x.eval_7d || x.eval_3d || null, created_at: x.created_at,
    baseline: { vturb: x.baseline?.vturb ? { metric: x.baseline.vturb.metric ?? null, d3: x.baseline.vturb.d3 ?? null } : null, cpa3: x.baseline?.row?.cpa3 ?? null },
  });
  return {
    ...funnel,
    topo: {
      ...topo,
      summary: analysis?.summary?.topo || { ...funnel.summary, source: 'modelo' },
      computed_at: analysis?.computed_at || null,
      page,
      suggestions: list.filter(x => x.status === 'aberta' || x.status === 'aplicada').map(slim),
      history: list.filter(x => x.status === 'avaliada' || x.status === 'nao_faz_sentido').map(slim),
    },
  };
}

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Aba VTurb da campanha. Lê do banco — a coleta grava de hora em hora — e
 * nunca repassa o token para o navegador.
 *
 * GET  ?product_id=…&start=…&end=…          do clique à venda no período da tela, cruzamentos, retenção
 * POST { product_id, action: 'sync' }       lê a VTurb agora
 * POST { product_id, action: 'link', player } vincula o player (ID ou URL) e lê
 */

async function ownProduct(request: Request, productId: string | null) {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 }) };
  if (!productId) return { error: NextResponse.json({ error: 'Informe a campanha.' }, { status: 400 }) };
  const { data } = await supabaseAdmin().from('products').select('id').eq('id', productId).eq('user_id', user.id).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 }) };
  return { user };
}

async function tablesReady() {
  const { error } = await supabaseAdmin().from('vturb_daily').select('product_id').limit(1);
  return !error;
}
const NOT_READY = { ready: false, error: 'Rode migration_vturb.sql no Supabase.' };

export async function GET(request: Request) {
  const productId = new URL(request.url).searchParams.get('product_id');
  const own = await ownProduct(request, productId);
  if ('error' in own) return own.error;
  if (!(await tablesReady())) return NextResponse.json(NOT_READY);
  const q = new URL(request.url).searchParams;
  return NextResponse.json(await vturbView(productId!, { start: q.get('start'), end: q.get('end') }));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const own = await ownProduct(request, body.product_id || null);
  if ('error' in own) return own.error;
  if (!(await tablesReady())) return NextResponse.json(NOT_READY, { status: 409 });

  if (body.action === 'analyze') {
    if (await analysisTablesReady()) await runAnalysis(body.product_id, { force: true });
    return NextResponse.json(await vturbView(body.product_id, body));
  }
  if (body.action === 'link') {
    const pid = playerIdFrom(body.player);
    if (!pid) return NextResponse.json({ error: 'Não achei o ID do player. Cole a URL do player ou o ID de 24 caracteres.' }, { status: 400 });
    await supabaseAdmin().from('products').update({ vturb_player_id: pid, vturb_synced_at: null, vturb_sync_error: null }).eq('id', body.product_id);
  } else if (body.action !== 'sync') {
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  }
  const result = await syncProductVturb(body.product_id, { force: true });
  const funnel = await vturbView(body.product_id, body);
  return NextResponse.json({ ...funnel, sync: result }, { status: 'error' in result && body.action === 'link' ? 400 : 200 });
}
