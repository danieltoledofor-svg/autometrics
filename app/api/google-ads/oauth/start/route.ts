import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/googleAds/client';
import { getRequestUser, newNonce, signState, redirectUri, baseFromRequest, OAUTH_NONCE_COOKIE } from '@/lib/googleAds/server';

/**
 * Devolve o link da tela de consentimento do Google.
 *
 * É um POST com o token do painel (e não um link direto) porque o servidor
 * precisa saber quem está conectando antes de mandar a pessoa para o Google.
 */
export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });

    const nonce = newNonce();
    const base = baseFromRequest(request);
    // { conversions: true } pede também a permissão de enviar vendas ao Google.
    const body = await request.json().catch(() => ({}));
    const url = buildAuthUrl(signState(user.id, nonce, base), redirectUri(base), !!body?.conversions);
    const res = NextResponse.json({ url });
    res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true, secure: base.startsWith('https'), sameSite: 'lax', path: '/api/google-ads/oauth', maxAge: 15 * 60,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
