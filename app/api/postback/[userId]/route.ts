import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

        let event = (searchParams.get('event') || '').toLowerCase();
        
        // Mapeamento automático de eventos (ex: Clickbank usa "Purchase", "Upsell", etc)
        if (event === 'purchase' || event === 'upsell' || event === 'combined conversion') event = 'sale';
        if (event === 'order_impression') event = 'checkout';
        if (event === 'chargeback') event = 'refund';
        const campaignId = searchParams.get('campaign_id') || '';     // ID numérico (utm_id)
        const campaignName = searchParams.get('utm_campaign') || '';    // Nome da campanha (fallback)
        const amount = parseFloat(searchParams.get('amount') || '0');
        const currency = (searchParams.get('cy') || 'BRL').toUpperCase();
        // Aceita tid (Clickbank), orderid (Cartpanda/MaxWeb/Buygoods) ou transid como alias
        const tid = searchParams.get('tid') || searchParams.get('orderid') || searchParams.get('transid') || '';

        // ── Validação básica ────────────────────────────────────────────
        if (!userId || !event) {
            return new Response('MISSING_PARAMS', { status: 400, headers: corsHeaders });
        }

        const validEvents = ['sale', 'checkout', 'click', 'refund'];
        if (!validEvents.includes(event)) {
            return new Response('INVALID_EVENT', { status: 400, headers: corsHeaders });
        }

        // Precisa de pelo menos um identificador de campanha
        if (!campaignId && !campaignName) {
            return new Response('MISSING_CAMPAIGN_IDENTIFIER', { status: 400, headers: corsHeaders });
        }

        // ── 1. Localizar o produto ──────────────────────────────────────
        // Prioridade: campaign_id numérico → fallback: campaign_name (google_ads_campaign_name)
        let product: { id: string; currency: string } | null = null;

        if (campaignId) {
            const { data } = await supabase
                .from('products')
                .select('id, currency')
                .eq('user_id', userId)
                .eq('google_ads_campaign_id', campaignId)
                .single();
            product = data;
        }

        // Fallback: busca pelo nome da campanha (google_ads_campaign_name)
        if (!product && campaignName) {
            const { data } = await supabase
                .from('products')
                .select('id, currency')
                .eq('user_id', userId)
                .ilike('google_ads_campaign_name', campaignName.trim())
                .single();
            product = data;
        }

        if (!product) {
            // Campanha não encontrada — retorna OK (plataforma não tentará reenviar)
            console.warn(
                `[Postback] Produto não encontrado. user_id=${userId} campaign_id=${campaignId} utm_campaign=${campaignName}`
            );
            return new Response('OK', { status: 200, headers: corsHeaders });
        }

        const today = (() => {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        })();

        // ── 2. Deduplicação ────────────────────────────────────────────
        if (tid) {
            const { error: dupError } = await supabase
                .from('postback_events')
                .insert({ product_id: product.id, transaction_id: tid, event_type: event, amount, currency });

            if (dupError) {
                if (dupError.code === '23505') return new Response('OK', { status: 200, headers: corsHeaders }); // duplicata
                console.error('[Postback] Erro ao inserir postback_event:', dupError.message);
                return new Response('DB_ERROR', { status: 500, headers: corsHeaders });
            }
        }

        // ── 3. Conversão de moeda ──────────────────────────────────────
        let finalAmount = amount;
        const productCurrency = (product.currency || 'BRL').toUpperCase();

        if (currency !== productCurrency && amount > 0) {
            try {
                const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
                const fx = await res.json();
                const rate = parseFloat(fx?.USDBRL?.bid || '6.00');
                if (currency === 'USD' && productCurrency === 'BRL') finalAmount = amount * rate;
                if (currency === 'BRL' && productCurrency === 'USD') finalAmount = amount / rate;
            } catch (_) { /* usa valor original se API falhar */ }
        }

        // ── 4. Somar campos em daily_metrics ──────────────────────────
        const { data: existing } = await supabase
            .from('daily_metrics')
            .select('id, conversions, conversion_value, checkouts, visits, refunds')
            .eq('product_id', product.id)
            .eq('date', today)
            .single();

        const prev = {
            conversions: Number(existing?.conversions ?? 0),
            conversion_value: Number(existing?.conversion_value ?? 0),
            checkouts: Number(existing?.checkouts ?? 0),
            visits: Number(existing?.visits ?? 0),
            refunds: Number(existing?.refunds ?? 0),
        };

        const updatePayload: Record<string, any> = {
            product_id: product.id,
            date: today,
            currency: productCurrency,
            updated_at: new Date().toISOString(),
        };

        if (event === 'sale') {
            updatePayload.conversions = prev.conversions + 1;
            updatePayload.conversion_value = prev.conversion_value + finalAmount;
        } else if (event === 'checkout') {
            updatePayload.checkouts = prev.checkouts + 1;
        } else if (event === 'click') {
            updatePayload.visits = prev.visits + 1;
        } else if (event === 'refund') {
            updatePayload.refunds = prev.refunds + finalAmount;
        }

        const { error: upsertError } = await supabase
            .from('daily_metrics')
            .upsert(updatePayload, { onConflict: 'product_id, date' });

        if (upsertError) {
            console.error('[Postback] Erro no upsert:', upsertError.message);
            return new Response('DB_ERROR', { status: 500, headers: corsHeaders });
        }

        return new Response('OK', { status: 200, headers: corsHeaders });

    } catch (err: any) {
        console.error('[Postback] Erro inesperado:', err.message);
        return new Response('SERVER_ERROR', { status: 500, headers: corsHeaders });
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
