import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode, emailFromIdToken, GOOGLE_ADS_SCOPE, DATA_MANAGER_SCOPE } from '@/lib/googleAds/client';
import { refreshConnectionAccounts } from '@/lib/googleAds/accounts';
import {
  supabaseAdmin, verifyState, encryptSecret, redirectUri, appUrl, OAUTH_NONCE_COOKIE,
} from '@/lib/googleAds/server';

/** O Google volta para cá depois do consentimento. */
export async function GET(request: Request) {
  let base = appUrl();
  const back = (params: Record<string, string>) => {
    const res = NextResponse.redirect(`${base}/integration?${new URLSearchParams({ tab: 'google', ...params })}`);
    res.cookies.delete(OAUTH_NONCE_COOKIE);
    return res;
  };

  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return back({ gads_error: error === 'access_denied' ? 'Autorização cancelada.' : error });

  const cookieStore = await cookies();
  const state = verifyState(url.searchParams.get('state') || '', cookieStore.get(OAUTH_NONCE_COOKIE)?.value);
  if (!state) return back({ gads_error: 'Link de autorização expirado ou aberto em outro navegador. Tente de novo.' });
  base = state.base;

  const code = url.searchParams.get('code');
  if (!code) return back({ gads_error: 'O Google não devolveu o código de autorização.' });

  try {
    const tokens = await exchangeCode(code, redirectUri(base));
    if (!tokens.scope?.includes(GOOGLE_ADS_SCOPE)) {
      return back({ gads_error: 'Marque a permissão do Google Ads na tela do Google.' });
    }
    if (!tokens.refresh_token) {
      return back({ gads_error: 'O Google não enviou o token permanente. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.' });
    }

    const email = emailFromIdToken(tokens.id_token) || 'desconhecido';
    const db = supabaseAdmin();
    const now = new Date().toISOString();
    const { data: conn, error: dbError } = await db.from('google_ads_connections')
      .upsert({
        user_id: state.userId,
        google_email: email,
        refresh_token_enc: encryptSecret(tokens.refresh_token),
        status: 'ok',
        last_error: null,
        updated_at: now,
      }, { onConflict: 'user_id,google_email' })
      .select('id, user_id, refresh_token_enc')
      .single();
    if (dbError || !conn) throw new Error(dbError?.message || 'Falha ao salvar a conexão');

    // Autorizou o envio de vendas: o que esperava por essa permissão sai no próximo ciclo, sem aguardar a nova tentativa.
    if (tokens.scope?.includes(DATA_MANAGER_SCOPE)) {
      await db.from('google_conversion_uploads').update({ next_try_at: null })
        .eq('user_id', state.userId).eq('status', 'aguardando').eq('error_code', 'SEM_PERMISSAO').then(() => null, () => null);
    }

    const { accounts } = await refreshConnectionAccounts(conn);
    return back({ gads_connected: email, gads_accounts: String(accounts.length) });
  } catch (e: any) {
    return back({ gads_error: e.message || 'Falha ao conectar' });
  }
}
