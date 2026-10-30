import { createClient } from '@supabase/supabase-js';
import { notifySaleNow, notifyUnmatchedSale } from '@/lib/alerts/saleNow';
import { clockOf, dayInClock } from './platformClock';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** O dia em que o servidor grava a venda (mesma conta do postback original). */
export function serverDay(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * O evento que cada plataforma avisa, no nome do Autometrics: sale, checkout, click ou refund.
 *
 *   Clickbank: Purchase, Upsell; Order Form Impression (checkout)
 *   Buygoods: frontend, upsell, downsell (às vezes numerados, ex.: upsell1), InitiateCheckout
 *   Digistore: payment, refund, chargeback (vêm em {transaction_type})
 *   JVZoo: SALE, BILL (renovação), RFND, CGBK (em {transaction_type}); initiated (checkout)
 *
 * Redes que avisam a situação da venda em {status} (SmartAdv, MediaScalers):
 * recusada não entra; devolvida vira reembolso.
 */
export function mapEvent(raw: string, status = ''): { event: string; rejected: boolean } {
    let event = raw.trim().toLowerCase();
    if (event === 'purchase' || event === 'combined conversion' || event === 'sale' || event === 'frontend' || event === 'payment' ||
        event === 'bill' || event.startsWith('upsell') || event.startsWith('downsell')) event = 'sale';
    if (event === 'order_impression' || event === 'initiatecheckout' || event === 'initiated' ||
        /^(initial[ _])?order[ _]?form[ _]impression$/.test(event)) event = 'checkout';
    if (event === 'chargeback' || event === 'refund' || event === 'rfnd' || event === 'cgbk') event = 'refund';
    const rejected = event === 'sale' && /reject|declin|cancel|invalid|fail/.test(status);
    if (event === 'sale' && /refund|chargeback|revers/.test(status)) event = 'refund';
    return { event, rejected };
}

/**
 * Chave do checkout: conta um por clique, para quem recarrega a página do checkout não virar
 * vários (e para ele aparecer na aba Checkouts, que lê postback_events).
 *
 * Tem que ser o que identifica a pessoa, nunca o primeiro subid que vier: ele pode ser a
 * palavra-chave ou a campanha, e aí a segunda pessoa da mesma campanha era tratada como repetição
 * e perdia o checkout. Sem nada de clique (campanha achada só pelo nome), um por visita da
 * plataforma (JVZoo: {session_id}).
 */
export function checkoutKey(clickId: string | null, subIds: string[], order: string, campaignId: string): string {
    const longest = [...subIds].sort((a, b) => b.length - a.length)[0];
    const ref = clickId || subIds.find(id => id.startsWith('ftsession_')) || longest;
    return (ref ? `checkout:${ref}` : order ? `checkout:visita:${order}` : campaignId ? `checkout:${campaignId}` : '').slice(0, 200);
}

/**
 * Processa um postback de venda, checkout, clique ou reembolso: acha a campanha, grava o evento e soma no dia.
 *
 * A venda entra no dia em que aconteceu no relógio da plataforma (lib/tracking/platformClock.ts).
 *
 * `replay` é a segunda tentativa de um postback que não tinha achado a campanha
 * (lib/tracking/unmatched.ts): `at` é a hora em que a venda chegou, e se a campanha
 * continuar sem ser achada nada é guardado de novo. Na venda ligada à mão a uma visita
 * (lib/tracking/manualSale.ts), `productId` e `clickId` dizem a campanha e o clique.
 */
export async function processPostback(searchParams: URLSearchParams, userId: string, replay?: { at: string; productId?: string; clickId?: string }): Promise<Response> {
    try {

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
        const rawEvent = (param('event') || param('CONV_TYPE')).toLowerCase();
        const status = param('status').toLowerCase();
        const { event, rejected } = mapEvent(rawEvent, status);

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
        // O checkout não tem pedido: a chave é checkoutKey, definida depois de achar o clique.
        const order = param('tid') || param('orderid') || param('order_id') || param('transid');
        let tid = event !== 'checkout' ? order : checkoutKey(null, subIds, order, campaignId);

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

        // Sem nenhum identificador a campanha não tem como ser achada; a venda e o
        // reembolso seguem assim mesmo, para ficarem guardados entre as vendas sem campanha.
        if (!candidateIds.length && !campaignName && !replay?.productId && event !== 'sale' && event !== 'refund') return ignore('sem identificador de campanha');

        // ── 1. Localizar o produto ──────────────────────────────────────
        let product: { id: string; currency: string } | null = null;

        // Venda ligada à mão: a campanha é a da visita escolhida.
        if (replay?.productId) {
            const { data } = await supabase.from('products').select('id, currency').eq('id', replay.productId).eq('user_id', userId).maybeSingle();
            product = data;
            trace.push(`campanha escolhida: ${data ? 'encontrada' : 'não'}`);
        }

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
        let clickId: string | null = replay?.clickId || null;
        if (!clickId && candidateIds.length) {
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

        // Clique que o próprio Google informou (click_view, guardado na coleta): liga o gclid à campanha
        // mesmo quando a página não tem o script de rastreamento.
        if (!product && candidateIds.length) {
            const { data: known } = await supabase.from('google_ads_clicks').select('gclid, product_id').in('gclid', candidateIds).limit(1);
            if (known?.[0]) {
                const { data } = await supabase.from('products').select('id, currency').eq('id', known[0].product_id).eq('user_id', userId).maybeSingle();
                product = data;
                trace.push(`gclid no Google (click_view): ${data ? 'campanha encontrada' : 'de outra conta'}`);
            } else trace.push('gclid no Google (click_view): não');
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

        if (event === 'checkout') tid = checkoutKey(clickId, subIds, order, campaignId);

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
            if (replay) return new Response('NOT_FOUND', { status: 404, headers: corsHeaders });
            // Fica guardado (migration_postback_sem_campanha.sql) e é tentado de novo pelo agendador: o Google
            // leva alguns minutos para informar o clique. Antes da migração a tabela não existe e nada muda.
            if (event === 'sale' || event === 'refund') {
                // A plataforma pode reenviar o mesmo pedido: guarda uma vez só.
                const { data: seen } = tid
                    ? await supabase.from('postback_unmatched').select('id').eq('user_id', userId).eq('transaction_id', tid).eq('event_type', event).limit(1)
                    : { data: null };
                if (!seen?.length) {
                    const { error: keepError } = await supabase.from('postback_unmatched').insert({
                        user_id: userId, event_type: event, amount, currency, transaction_id: tid || null,
                        source: searchParams.has('CONV_TYPE') ? 'BuyGoods' : searchParams.get('source') || null,
                        ref_ids: candidateIds, campaign_name: campaignName || null, query: searchParams.toString().slice(0, 4000),
                    });
                    // A venda é avisada mesmo sem a campanha: ela aparece na aba Vendas para ser ligada a uma visita.
                    if (!keepError && event === 'sale') await notifyUnmatchedSale(userId, amount, currency, tid).catch((e: any) => console.warn('[Postback] Aviso de venda sem campanha:', e?.message));
                }
            }
            return new Response('OK', { status: 200, headers: corsHeaders });
        }

        // Detecção da plataforma de origem
        const source =
            searchParams.get('source') ||
            (searchParams.has('CONV_TYPE') ? 'BuyGoods' :
            searchParams.has('aff_sub5') || searchParams.has('aff_sub1') ? 'Clickbank' :
            searchParams.has('COMMISSION_AMOUNT') ? 'MaxWeb' :
            searchParams.has('amount_affiliate') ? 'Cartpanda' :
            searchParams.has('sid5') || searchParams.has('sid1') ? 'Digistore' :
            'Plataforma');

        // O dia da venda é o do relógio da plataforma. Antes de migration_relogio_plataformas.sql
        // a coluna não existe e vale o padrão de cada plataforma.
        const { data: settings } = await supabase.from('user_settings').select('platform_clocks').eq('user_id', userId).maybeSingle();
        const today = dayInClock(clockOf(source, settings?.platform_clocks), replay ? new Date(replay.at) : new Date());

        // ── 2. Deduplicação ────────────────────────────────────────────
        if (tid) {
            const row = { product_id: product.id, transaction_id: tid, event_type: event, amount, currency, source };
            // click_id e ref_ids ligam a venda ao clique; antes de
            // migration_rastreamento_vendas.sql as colunas não existem.
            // Na repetição a venda fica com a hora em que chegou, não a de agora (o Google recebe essa hora).
            let { error: dupError } = await supabase.from('postback_events').insert({ ...row, click_id: clickId, ref_ids: candidateIds, ...(replay ? { created_at: replay.at } : {}) });
            if (dupError && dupError.code !== '23505' && /click_id|ref_ids/.test(dupError.message || '')) {
                ({ error: dupError } = await supabase.from('postback_events').insert({ ...row, ...(replay ? { created_at: replay.at } : {}) }));
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
            // A venda já estava guardada: sem desfazer, o reenvio da plataforma seria tratado como
            // repetido e a venda nunca somaria na campanha.
            if (tid) await supabase.from('postback_events').delete().eq('product_id', product.id).eq('transaction_id', tid).eq('event_type', event).then(() => null, () => null);
            return new Response('DB_ERROR', { status: 500, headers: corsHeaders });
        }

        // Aviso de venda no Telegram na hora, sem esperar a rodada do agendador. Falha de aviso não derruba o postback.
        if (event === 'sale') await notifySaleNow(userId, product.id, today).catch((e: any) => console.warn('[Postback] Aviso de venda:', e?.message));

        return new Response('OK', { status: 200, headers: corsHeaders });

    } catch (err: any) {
        console.error('[Postback] Erro inesperado:', err.message);
        return new Response('SERVER_ERROR', { status: 500, headers: corsHeaders });
    }
}

