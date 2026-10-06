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

        // Modo teste: resolve a campanha e responde em JSON o que seria gravado,
        // sem tocar em postback_events nem daily_metrics.
        const dryRun = searchParams.get('dry_run') === '1';
        const trace: string[] = [];

        // O teste de postback das plataformas dispara a URL sem substituir as
        // macros, então chega o texto "{CONV_TYPE}" literal. Vale como vazio.
        const param = (key: string) => {
            const v = searchParams.get(key) || '';
            return /^\{.*\}$/.test(v.trim()) ? '' : v;
        };

        // Buygoods usa CONV_TYPE; outros usam event
        let event = (param('event') || param('CONV_TYPE')).toLowerCase();
        const rawEvent = event;

        // Mapeamento automático de eventos
        // Clickbank: Purchase, Upsell | Buygoods: Sale, InitiateCheckout | Genérico: chargeback
        // Buygoods: frontend, upsell, downsell (às vezes numerados, ex.: upsell1)
        // Digistore: payment, refund, chargeback (vêm em {transaction_type})
        if (event === 'purchase' || event === 'combined conversion' || event === 'sale' || event === 'frontend' || event === 'payment' ||
            event.startsWith('upsell') || event.startsWith('downsell')) event = 'sale';
        if (event === 'order_impression' || event === 'initiatecheckout') event = 'checkout';
        if (event === 'chargeback' || event === 'refund') event = 'refund';

        // Redes que avisam a situação da venda em {status} (SmartAdv, MediaScalers):
        // recusada não entra; devolvida vira reembolso.
        const status = param('status').toLowerCase();
        const rejected = event === 'sale' && /reject|declin|cancel|invalid|fail/.test(status);
        if (event === 'sale' && /refund|chargeback|revers/.test(status)) event = 'refund';

        // Resolução do campaign_id: várias plataformas usam nomes diferentes
        //   Buygoods/MaxWeb: campaign_id={SUBID1} no postback configurado
        //   Fallback 1: utm_id (Google/Meta padrão)
        //   Fallback 2: gad_campaignid (Google Ads nativo)
        //   Fallback 3: subid1–subid5 — trackers como a FlowTracking ocupam todos os
        //     subids (ftsession_XXX, gclid...), resolvidos via click_sessions
        const campaignId =
            param('campaign_id') ||
            param('utm_id') ||
            param('gad_campaignid') ||
            '';
        //   cid: onde a Digistore devolve o gclid
        const subIds = ['subid1', 'subid2', 'subid3', 'subid4', 'subid5', 'cid']
            .map(k => param(k))
            .filter(Boolean);
        const candidateIds = [...new Set([campaignId, ...subIds].filter(Boolean))];
        const campaignName = param('utm_campaign');    // Nome da campanha (fallback)
        const amount = parseFloat(param('amount') || '0') || 0;
        const currency = (param('cy') || param('currency') || 'BRL').toUpperCase();
        // Aceita tid (Clickbank), orderid (Cartpanda/MaxWeb/Buygoods) ou transid como alias
        const tid = param('tid') || param('orderid') || param('order_id') || param('transid');

        // ── Validação básica ────────────────────────────────────────────
        // Nada aqui devolve erro: o teste de postback da plataforma exige 200,
        // e um 400 faria a plataforma reenviar ou recusar a URL. O motivo vai
        // no corpo da resposta e no log.
        const ignore = (motivo: string) => {
            console.warn(`[Postback] Ignorado (${motivo}). user_id=${userId} evento=${rawEvent || '-'} candidatos=${candidateIds.join(',') || '-'}`);
            if (dryRun) {
                return Response.json(
                    { dry_run: true, ignorado: motivo, event: rawEvent, amount, currency, orderid: tid, candidates: candidateIds, product_id: null },
                    { headers: corsHeaders }
                );
            }
            return new Response(`OK (${motivo})`, { status: 200, headers: corsHeaders });
        };

        if (!userId || !event) return ignore('sem evento');

        const validEvents = ['sale', 'checkout', 'click', 'refund'];
        if (!validEvents.includes(event)) return ignore(`evento desconhecido: ${rawEvent}`);
        if (rejected) return ignore(`venda recusada: ${status}`);

        // Precisa de pelo menos um identificador de campanha
        if (!candidateIds.length && !campaignName) return ignore('sem identificador de campanha');

        // ── 1. Localizar o produto ──────────────────────────────────────
        let product: { id: string; currency: string } | null = null;

        // 1a. Busca direta pelo campaign_id numérico
        for (const id of candidateIds) {
            if (product) break;
            const { data } = await supabase
                .from('products')
                .select('id, currency')
                .eq('user_id', userId)
                .eq('google_ads_campaign_id', id)
                .maybeSingle();
            product = data;
            trace.push(`campanha ${id}: ${data ? 'encontrada' : 'não'}`);
        }

        // 1b. Reverse lookup via click_sessions (resolve vst_XXX, ftsession_XXX, gclid)
        //     Ativado quando nenhum candidato é um ID numérico reconhecido
        for (const id of candidateIds) {
            if (product) break;
            const { data: session } = await supabase
                .from('click_sessions')
                .select('utm_id, gad_campaignid, utm_campaign')
                .eq('user_id', userId)
                .eq('session_id', id)
                .maybeSingle();
            trace.push(`sessão ${id}: ${session ? `utm_id=${session.utm_id || '-'} gad=${session.gad_campaignid || '-'}` : 'não'}`);

            if (session) {
                const resolvedId   = session.utm_id || session.gad_campaignid || '';
                const resolvedName = session.utm_campaign || '';

                if (resolvedId) {
                    const { data } = await supabase
                        .from('products')
                        .select('id, currency')
                        .eq('user_id', userId)
                        .eq('google_ads_campaign_id', resolvedId)
                        .single();
                    product = data;
                    trace.push(`  → campanha ${resolvedId} cadastrada: ${data ? 'sim' : 'não'}`);
                }

                if (!product && resolvedName) {
                    const { data } = await supabase
                        .from('products')
                        .select('id, currency')
                        .eq('user_id', userId)
                        .ilike('google_ads_campaign_name', resolvedName.trim())
                        .single();
                    product = data;
                }
            }
        }

        // Clique que gerou a venda (script de rastreamento): pelo gclid ou pela
        // sessão da FlowTracking. Também resolve a campanha quando nada acima achou.
        let clickId: string | null = null;
        if (candidateIds.length) {
            const pickClick = async (column: 'click_id' | 'gclid' | 'ft_sid', values: string[]) => {
                if (!values.length) return null;
                const { data } = await supabase.from('tracking_clicks').select('click_id, product_id')
                    .eq('user_id', userId).in(column, values).order('created_at', { ascending: false }).limit(1);
                return data?.[0] || null;
            };
            const click = await pickClick('click_id', candidateIds)
                || await pickClick('gclid', candidateIds)
                || await pickClick('ft_sid', candidateIds.filter(i => i.startsWith('ftsession_')).map(i => i.slice('ftsession_'.length)));
            if (click) {
                clickId = click.click_id;
                trace.push(`clique rastreado: ${clickId}`);
                if (!product && click.product_id) {
                    const { data } = await supabase.from('products').select('id, currency').eq('id', click.product_id).eq('user_id', userId).maybeSingle();
                    product = data;
                    trace.push(`  → campanha do clique: ${data ? 'encontrada' : 'não'}`);
                }
            }
        }

        // 1c. Fallback: busca pelo nome da campanha (utm_campaign)
        if (!product && campaignName) {
            const { data } = await supabase
                .from('products')
                .select('id, currency')
                .eq('user_id', userId)
                .ilike('google_ads_campaign_name', campaignName.trim())
                .single();
            product = data;
            trace.push(`nome ${campaignName}: ${data ? 'encontrado' : 'não'}`);
        }

        if (dryRun) {
            return Response.json(
                { dry_run: true, event: rawEvent, mapped_event: event, amount, currency, orderid: tid, candidates: candidateIds, trace, click_id: clickId, product_id: product?.id ?? null },
                { headers: corsHeaders }
            );
        }

        if (!product) {
            // Campanha não encontrada — retorna OK (plataforma não tentará reenviar)
            console.warn(
                `[Postback] Produto não encontrado. user_id=${userId} candidatos=${candidateIds.join(',')} utm_campaign=${campaignName}`
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
        // Detecção da plataforma de origem
        const source =
            searchParams.get('source') ||
            (searchParams.has('CONV_TYPE') ? 'BuyGoods' :
            searchParams.has('aff_sub5') || searchParams.has('aff_sub1') ? 'Clickbank' :
            searchParams.has('COMMISSION_AMOUNT') ? 'MaxWeb' :
            searchParams.has('amount_affiliate') ? 'Cartpanda' :
            searchParams.has('sid5') || searchParams.has('sid1') ? 'Digistore' :
            'Plataforma');

        if (tid) {
            const row = { product_id: product.id, transaction_id: tid, event_type: event, amount, currency, source };
            // click_id e ref_ids ligam a venda ao clique; antes de
            // migration_rastreamento_vendas.sql as colunas não existem.
            let { error: dupError } = await supabase.from('postback_events').insert({ ...row, click_id: clickId, ref_ids: candidateIds });
            if (dupError && dupError.code !== '23505' && /click_id|ref_ids/.test(dupError.message || '')) {
                ({ error: dupError } = await supabase.from('postback_events').insert(row));
            }

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
