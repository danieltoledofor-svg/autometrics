import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

async function handleRequest(
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const { userId } = await params;

        const sessionId = searchParams.get('session_id') || '';
        if (!userId || !sessionId) {
            return new Response('', { status: 204, headers: corsHeaders });
        }

        const utmId       = searchParams.get('utm_id') || '';
        const gadId       = searchParams.get('gad_campaignid') || '';
        const utmCampaign = searchParams.get('utm_campaign') || '';
        const utmSource   = searchParams.get('utm_source') || '';
        const utmMedium   = searchParams.get('utm_medium') || '';

        // Nada de útil para armazenar — ignora silenciosamente
        if (!utmId && !gadId && !utmCampaign) {
            return new Response('', { status: 204, headers: corsHeaders });
        }

        await supabase
            .from('click_sessions')
            .upsert(
                { user_id: userId, session_id: sessionId, utm_id: utmId, gad_campaignid: gadId, utm_campaign: utmCampaign, utm_source: utmSource, utm_medium: utmMedium },
                { onConflict: 'user_id, session_id' }
            );

        return new Response('', { status: 204, headers: corsHeaders });
    } catch {
        return new Response('', { status: 204, headers: corsHeaders });
    }
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    return handleRequest(request, { params });
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    return handleRequest(request, { params });
}
