import { createClient } from '@supabase/supabase-js';
import { geoReady, lookup } from '@/lib/tracking/geo';

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

const ok = () => new Response(null, { status: 204, headers: corsHeaders });
const cut = (v: any, max: number) => String(v ?? '').slice(0, max);

/** Macro que o Google não trocou ("{keyword}") vale como vazio. */
const clean = (v: any) => {
    const s = cut(v, 300).trim();
    return /^\{.*\}$/.test(s) ? '' : s;
};

const DEVICE: Record<string, string> = { m: 'MOBILE', c: 'DESKTOP', t: 'TABLET' };
function deviceOf(param: string, userAgent: string): string {
    if (DEVICE[param.toLowerCase()]) return DEVICE[param.toLowerCase()];
    if (/iPad|Tablet/i.test(userAgent)) return 'TABLET';
    if (/Mobi|Android|iPhone/i.test(userAgent)) return 'MOBILE';
    return userAgent ? 'DESKTOP' : '';
}

const osOf = (ua: string) =>
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
const browserOf = (ua: string) =>
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /FBAN|FBAV|Instagram/.test(ua) ? 'App do Facebook ou Instagram' : /GSA\//.test(ua) ? 'App do Google'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|facebookexternalhit|google-inspectiontool|python|curl|wget|axios|scrapy/i;

/** De onde a visita veio: anúncio, busca, rede social, outro site ou direto. */
function trafficOf(p: Record<string, string>, referrer: string, page: string): string {
    if (p.gclid || p.gbraid || p.wbraid || p.ftgid || p.utm_id || p.gad_campaignid || p.utm_campaign || p.utm_source || p.fbclid || p.msclkid) return 'pago';
    let host = '', own = '';
    try { host = new URL(referrer).hostname.toLowerCase(); } catch { /* sem origem */ }
    try { own = new URL(page).hostname.toLowerCase(); } catch { /* sem página */ }
    if (!host || host === own) return 'direto';
    if (/(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave)\./.test(host)) return 'organico';
    if (/(^|\.)(facebook|instagram|youtube|tiktok|twitter|x|t|pinterest|linkedin|reddit|whatsapp)\.(com|co|net)$/.test(host)) return 'social';
    return 'referencia';
}

function ipOf(request: Request): string {
    const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    return cut(forwarded || request.headers.get('x-real-ip') || '', 60).replace(/^::ffff:/i, '');
}

/** Liga gclid e sessão da FlowTracking à campanha: é o que o postback consulta. */
async function saveSessions(userId: string, ids: string[], f: { utmId: string; gadId: string; utmCampaign: string; utmSource: string; utmMedium: string }) {
    if (!ids.length || (!f.utmId && !f.gadId && !f.utmCampaign)) return null;
    const rows = [...new Set(ids)].map(session_id => ({
        user_id: userId, session_id, utm_id: f.utmId, gad_campaignid: f.gadId,
        utm_campaign: f.utmCampaign, utm_source: f.utmSource, utm_medium: f.utmMedium,
    }));
    const { error } = await supabase.from('click_sessions').upsert(rows, { onConflict: 'user_id, session_id' });
    // Antes a falha de gravação era silenciosa (ex.: RLS bloqueando a chave pública)
    if (error) console.error('[TrackClick] Erro ao gravar sessão:', error.message);
    return error;
}

/**
 * Script único (v2): uma chamada por página aberta, com o clique (gclid ou um
 * identificador próprio), tudo o que veio na URL de entrada e o endereço da
 * página. Grava o clique uma vez (tracking_clicks) e cada página visitada
 * (tracking_pageviews), e mantém click_sessions para o postback.
 */
async function handleV2(userId: string, body: any, request: Request) {
    const clickId = cut(body.c, 200).trim();
    if (!clickId) return ok();
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.p && typeof body.p === 'object' ? body.p : {}).slice(0, 40)) {
        const val = clean(v);
        if (val) p[cut(k, 40)] = val;
    }
    const pick = (...keys: string[]) => keys.map(k => p[k]).find(Boolean) || '';

    const utmId = pick('utm_id'), gadId = pick('gad_campaignid', 'campaignid', 'campaign_id');
    // "nomeCampanha" é o texto de exemplo do modelo de URL da FlowTracking.
    const utmCampaign = pick('utm_campaign') === 'nomeCampanha' ? '' : pick('utm_campaign');
    const utmSource = pick('utm_source'), utmMedium = pick('utm_medium');
    const campaignId = [utmId, gadId].find(v => /^\d+$/.test(v)) || utmId || gadId;
    // O modelo da FlowTracking manda o gclid em ftgid=ftgid_{gclid}_ftgid, o
    // grupo em utm_medium e o anúncio em utm_content.
    const gclid = p.gclid || clean(/^ftgid_(.+)_ftgid$/.exec(p.ftgid || '')?.[1]);
    const digits = (v: string) => (/^\d{6,}$/.test(v) ? v : '');
    const ids = [gclid, p.gbraid, p.wbraid, p.ft_sid ? `ftsession_${p.ft_sid}` : ''].filter(Boolean);
    await saveSessions(userId, ids, { utmId, gadId, utmCampaign, utmSource, utmMedium });

    let productId: string | null = null;
    if (campaignId) {
        const { data } = await supabase.from('products').select('id').eq('user_id', userId).eq('google_ads_campaign_id', campaignId).limit(1);
        productId = data?.[0]?.id || null;
    }

    const page = cut(body.u, 500);
    const userAgent = cut(request.headers.get('user-agent'), 300);

    // e: 't' = só o tempo na página e a rolagem, sem página nova.
    if (body.e === 't') {
        const { error: touchError } = await supabase.rpc('tracking_touch', {
            p_user: userId, p_click: clickId, p_seconds: Math.round(Number(body.t) || 0), p_scroll: Math.round(Number(body.s) || 0),
        });
        // Antes de migration_rastreamento_visitas.sql a função não existe.
        if (touchError && !/tracking_touch/.test(touchError.message || '')) console.error('[TrackClick] Erro ao gravar o tempo:', touchError.message);
        return ok();
    }

    // Quem é o visitante: IP e local, sistema, navegador, tela, idioma e origem.
    const ip = ipOf(request);
    const place = ip && await geoReady().catch(() => false) ? lookup(ip) : null;
    const visitor = {
        ip: ip || null,
        country_code: place?.country_code || null, country: place?.country || null, region: place?.region || null, city: place?.city || null,
        // Sem a base pronta, o local fica para o agendador procurar depois.
        geo_at: ip && place ? new Date().toISOString() : null,
        os: osOf(userAgent) || null, browser: browserOf(userAgent) || null,
        screen: /^\d{2,5}x\d{2,5}$/.test(String(body.s || '')) ? String(body.s) : null,
        language: cut(body.l, 20) || null,
        traffic: trafficOf(p, cut(body.r, 500), page),
        is_bot: !userAgent || BOT.test(userAgent),
        last_seen_at: new Date().toISOString(),
    };

    // O clique é gravado uma vez: a página seguinte não troca os dados da entrada.
    const base = {
        user_id: userId, click_id: clickId, product_id: productId, campaign_id: campaignId || null,
        gclid: gclid || null, gbraid: p.gbraid || null, wbraid: p.wbraid || null, ft_sid: p.ft_sid || null,
        utm_source: utmSource || null, utm_medium: utmMedium || null, utm_campaign: utmCampaign || null,
        utm_term: pick('utm_term') || null, utm_content: pick('utm_content') || null,
        keyword: pick('keyword', 'kw', 'utm_term') || null,
        match_type: pick('matchtype', 'match_type', 'mt') || null,
        ad_group_id: pick('adgroupid', 'adgroup_id', 'ad_group_id') || digits(utmMedium) || null,
        ad_id: pick('creative', 'ad_id', 'adid') || digits(pick('utm_content')) || null,
        network: pick('network') || null,
        device: deviceOf(pick('device'), userAgent) || null,
        landing_url: (body.e ? '' : page) || null, referrer: cut(body.r, 500) || null,
        user_agent: userAgent || null, params: p,
    };
    const options = { onConflict: 'user_id, click_id', ignoreDuplicates: true };
    let { error } = await supabase.from('tracking_clicks').upsert({ ...base, ...visitor }, options);
    // Antes de migration_rastreamento_visitas.sql as colunas novas não existem.
    if (error && /column|schema cache/i.test(error.message || '')) ({ error } = await supabase.from('tracking_clicks').upsert(base, options));
    // Antes de migration_rastreamento.sql as tabelas não existem: o postback segue pelo click_sessions.
    if (error) { console.error('[TrackClick] Erro ao gravar clique:', error.message); return ok(); }

    // A sessão da FlowTracking costuma aparecer só na página seguinte.
    if (p.ft_sid) {
        await supabase.from('tracking_clicks').update({ ft_sid: p.ft_sid }).eq('user_id', userId).eq('click_id', clickId).is('ft_sid', null);
    }

    // e: 'u' = só dados que apareceram depois (sem nova página); 'out' = saída para o checkout.
    if (page && body.e !== 'u') {
        const row = { user_id: userId, click_id: clickId, url: page };
        let { error: pvError } = await supabase.from('tracking_pageviews').insert({ ...row, kind: body.e === 'out' ? 'checkout' : 'page' });
        // Antes de migration_rastreamento_saida.sql não há a coluna kind: a página entra sem ela e a saída fica de fora.
        if (pvError && /kind/.test(pvError.message || '')) {
            pvError = body.e === 'out' ? null : (await supabase.from('tracking_pageviews').insert(row)).error;
        }
        if (pvError) console.error('[TrackClick] Erro ao gravar página:', pvError.message);
        // Página seguinte: marca que a visita continua (antes da migração das visitas a função não existe).
        if (body.e !== 'out') await supabase.rpc('tracking_touch', { p_user: userId, p_click: clickId, p_seconds: 0, p_scroll: 0 }).then(() => null, () => null);
    }
    return ok();
}

async function handleRequest(
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const { userId } = await params;
        if (!userId) return ok();

        if (request.method === 'POST') {
            // sendBeacon manda o JSON como texto.
            const text = await request.text().catch(() => '');
            let body: any = null;
            try { body = text ? JSON.parse(text.slice(0, 20000)) : null; } catch { /* corpo que não é JSON: segue pelo formato antigo */ }
            if (body?.c) return await handleV2(userId, body, request);
        }

        // Formato antigo (script v1): um pedido por identificador, tudo na URL.
        const sessionId = searchParams.get('session_id') || '';
        if (!sessionId) return ok();

        const f = {
            utmId: searchParams.get('utm_id') || '',
            gadId: searchParams.get('gad_campaignid') || '',
            utmCampaign: searchParams.get('utm_campaign') || '',
            utmSource: searchParams.get('utm_source') || '',
            utmMedium: searchParams.get('utm_medium') || '',
        };
        // Nada de útil para armazenar — ignora silenciosamente
        if (!f.utmId && !f.gadId && !f.utmCampaign) return ok();

        const error = await saveSessions(userId, [sessionId], f);

        // debug=1 devolve o resultado da gravação, para testar sem abrir o banco
        if (searchParams.get('debug') === '1') {
            return Response.json({ saved: !error, error: error?.message ?? null, session_id: sessionId, utm_id: f.utmId, gad_campaignid: f.gadId }, { headers: corsHeaders });
        }

        return ok();
    } catch {
        return ok();
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
