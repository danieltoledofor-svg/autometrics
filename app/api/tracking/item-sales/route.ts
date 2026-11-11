import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { loadTrackedSales } from '@/lib/tracking/trackedSales';
import type { ItemSalesPayload } from '@/lib/metrics/itemSales';

export const dynamic = 'force-dynamic';

/**
 * Vendas e reembolsos da campanha no período, com o clique de cada um, para as
 * tabelas por item (grupos, anúncios, palavras-chave, aparelho, país) contarem a
 * venda inteira no item certo. Só lê do banco.
 *
 * GET ?product_id=…&from=AAAA-MM-DD&to=AAAA-MM-DD
 *
 * Busca em lib/tracking/trackedSales.ts.
 */

const validDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const productId = q.get('product_id');
  const from = q.get('from'), to = q.get('to');
  if (!productId || !validDay(from) || !validDay(to)) return NextResponse.json({ error: 'Informe a campanha e o período.' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: product } = await db.from('products').select('id').eq('id', productId).eq('user_id', user.id).maybeSingle();
  if (!product) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

  const events = await loadTrackedSales(db, user.id, [productId], from, to);
  const payload: ItemSalesPayload = { events: [], untracked: 0 };
  for (const { product_id: _p, day: _d, linked, ...e } of events) {
    if (linked) payload.events.push(e);
    else if (e.kind === 'sale') payload.untracked++;
  }
  return NextResponse.json(payload);
}
