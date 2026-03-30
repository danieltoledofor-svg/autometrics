import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Busca o VTURB_API_TOKEN do banco (user_settings) para o userId informado.
 * Fallback: variável de ambiente VTURB_API_TOKEN.
 */
async function getToken(userId?: string | null): Promise<string | null> {
    // Tenta .env primeiro (mais rápido, sem round-trip ao banco)
    if (process.env.VTURB_API_TOKEN) return process.env.VTURB_API_TOKEN;

    if (!userId) return null;

    const { data } = await supabaseAdmin
        .from('user_settings')
        .select('vturb_api_token')
        .eq('user_id', userId)
        .maybeSingle();

    return data?.vturb_api_token ?? null;
}

/**
 * POST /api/vturb
 * Proxy seguro para a API do VTurb Analytics.
 *
 * Body: { endpoint: string, body: object, userId: string }
 */
export async function POST(request: Request) {
    let body: { endpoint: string; body: Record<string, any>; userId?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }

    const { endpoint, body: vturbBody, userId } = body;
    if (!endpoint) {
        return NextResponse.json({ error: 'endpoint é obrigatório' }, { status: 400 });
    }

    const apiToken = await getToken(userId);
    if (!apiToken) {
        return NextResponse.json(
            { error: 'VTURB_API_TOKEN não configurado. Configure na página de Integração.' },
            { status: 503 }
        );
    }

    try {
        const res = await fetch(`https://analytics.vturb.net/${endpoint}`, {
            method: 'POST',
            headers: {
                'X-Api-Token': apiToken,
                'X-Api-Version': 'v1',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(vturbBody || {}),
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (err: any) {
        console.error('[VTurb Proxy] Erro:', err.message);
        return NextResponse.json({ error: 'Erro ao contactar a API do VTurb' }, { status: 502 });
    }
}

/**
 * GET /api/vturb?endpoint=players/list&userId=xxx
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint');
    const userId = searchParams.get('userId');

    if (!endpoint) {
        return NextResponse.json({ error: 'endpoint é obrigatório' }, { status: 400 });
    }

    const apiToken = await getToken(userId);
    if (!apiToken) {
        return NextResponse.json(
            { error: 'VTURB_API_TOKEN não configurado. Configure na página de Integração.' },
            { status: 503 }
        );
    }

    try {
        const res = await fetch(`https://analytics.vturb.net/${endpoint}`, {
            headers: {
                'X-Api-Token': apiToken,
                'X-Api-Version': 'v1',
            },
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (err: any) {
        console.error('[VTurb Proxy GET] Erro:', err.message);
        return NextResponse.json({ error: 'Erro ao contactar a API do VTurb' }, { status: 502 });
    }
}
