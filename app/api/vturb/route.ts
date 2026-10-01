import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { computeFunnel } from '@/lib/vturb/funnel';
import { syncProductVturb } from '@/lib/vturb/sync';
import { playerIdFrom } from '@/lib/vturb/client';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Aba VTurb da campanha. Lê do banco — a coleta grava de hora em hora — e
 * nunca repassa o token para o navegador.
 *
 * GET  ?product_id=…                        do clique à venda, retenção e palavras-chave
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
  return NextResponse.json(await computeFunnel(productId!));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const own = await ownProduct(request, body.product_id || null);
  if ('error' in own) return own.error;
  if (!(await tablesReady())) return NextResponse.json(NOT_READY, { status: 409 });

  if (body.action === 'link') {
    const pid = playerIdFrom(body.player);
    if (!pid) return NextResponse.json({ error: 'Não achei o ID do player. Cole a URL do player ou o ID de 24 caracteres.' }, { status: 400 });
    await supabaseAdmin().from('products').update({ vturb_player_id: pid, vturb_synced_at: null, vturb_sync_error: null }).eq('id', body.product_id);
  } else if (body.action !== 'sync') {
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  }
  const result = await syncProductVturb(body.product_id, { force: true });
  const funnel = await computeFunnel(body.product_id);
  return NextResponse.json({ ...funnel, sync: result }, { status: 'error' in result && body.action === 'link' ? 400 : 200 });
}
