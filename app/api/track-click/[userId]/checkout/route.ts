import { corsHeaders, processPostback } from '@/lib/tracking/postback';

/**
 * Checkout da BuyGoods avisado pelo script do checkout (public/amc.js), que a BuyGoods
 * roda na página do pedido (Funnel pixels → Checkout). Vira um postback de checkout:
 * a campanha é achada pelos mesmos subids, e conta um checkout por clique.
 *
 * Fica dentro de /api/track-click/ porque vem do navegador, de outro site (middleware.ts).
 */
export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const body = await request.json().catch(() => null);
    const ids: string[] = Array.isArray(body?.ids)
        ? [...new Set(body.ids.map((v: unknown) => String(v ?? '').trim().slice(0, 300)).filter(Boolean))] as string[]
        : [];
    if (!ids.length) return new Response(null, { status: 204, headers: corsHeaders });
    const q = new URLSearchParams({ source: 'BuyGoods', event: 'checkout' });
    ids.slice(0, 5).forEach((id, i) => q.set(`subid${i + 1}`, id));
    const gclid = String(body?.gclid ?? '').trim().slice(0, 300);
    if (gclid && !ids.slice(0, 5).includes(gclid)) q.set('cid', gclid);
    return processPostback(q, (await params).userId);
}
