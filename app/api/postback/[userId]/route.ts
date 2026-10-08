import { corsHeaders, processPostback } from '@/lib/tracking/postback';

/** Postback das plataformas de venda. A lógica fica em lib/tracking/postback.ts, para o agendador poder repetir um postback. */
export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    return processPostback(new URL(request.url).searchParams, (await params).userId);
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    return processPostback(new URL(request.url).searchParams, (await params).userId);
}
