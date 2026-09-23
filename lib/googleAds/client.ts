/**
 * Cliente mínimo da Google Ads API via REST.
 *
 * REST em vez da biblioteca oficial (gRPC): o que o Autometrics usa cabe em
 * três chamadas — searchStream, campaigns:mutate e listAccessibleCustomers —
 * e evita uma dependência nativa pesada no servidor da Hostinger.
 *
 * Acesso: desde 09/09/2026 o Google não emite mais developer token. O nível de
 * acesso (Explorer/Basic/Standard) vem do projeto do Google Cloud que gerou o
 * Client ID do OAuth. O header developer-token só é enviado se ainda estiver
 * configurado — hoje o Google o aceita e ignora.
 */

export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v25';
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

export class GoogleAdsError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function oauthClient() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET não configurados no servidor.');
  }
  return { clientId, clientSecret };
}

/** Link da tela de consentimento do Google. */
export function buildAuthUrl(state: string, redirectUri: string): string {
  const { clientId } = oauthClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `${GOOGLE_ADS_SCOPE} openid email`,
    // offline + consent: garante o refresh_token mesmo se a pessoa já
    // tiver autorizado antes.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = oauthClient();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new GoogleAdsError(data.error_description || data.error || 'Falha no OAuth', res.status, data.error);
  return data as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope: string };
}

/** E-mail da conta Google, lido do id_token devolvido na troca do código. */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.email || null;
  } catch {
    return null;
  }
}

export async function revokeToken(token: string) {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch { /* revogar é cortesia: a conexão é apagada de qualquer forma */ }
}

// Access tokens duram 1h. Guardar em memória evita um POST ao Google por
// chamada; se o processo reiniciar, basta pedir outro.
const tokenCache = new Map<string, { token: string; expires: number }>();

export async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const { clientId, clientSecret } = oauthClient();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId,
      client_secret: clientSecret, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant = acesso revogado, senha trocada ou app OAuth em modo
    // "Teste" (tokens expiram em 7 dias). A única saída é reconectar.
    const msg = data.error === 'invalid_grant'
      ? 'Autorização do Google expirou ou foi revogada — reconecte a conta em Integração.'
      : (data.error_description || data.error || 'Falha ao renovar o token');
    throw new GoogleAdsError(msg, res.status, data.error);
  }
  tokenCache.set(refreshToken, { token: data.access_token, expires: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

export interface AdsContext {
  refreshToken: string;
  /** Conta que recebe a consulta. */
  customerId: string;
  /** Gerenciador pelo qual o acesso acontece (header login-customer-id). */
  loginCustomerId?: string | null;
}

async function headers(ctx: { refreshToken: string; loginCustomerId?: string | null }) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${await getAccessToken(ctx.refreshToken)}`,
    'Content-Type': 'application/json',
  };
  if (ctx.loginCustomerId) h['login-customer-id'] = ctx.loginCustomerId;
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) h['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  return h;
}

/** Mensagem legível do erro da API, que vem aninhado em details[].errors[]. */
async function readError(res: Response): Promise<GoogleAdsError> {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text);
    const err = Array.isArray(parsed) ? parsed[0]?.error : parsed.error;
    const inner = err?.details?.[0]?.errors?.[0];
    if (inner) {
      const codeObj = inner.errorCode || {};
      code = String(Object.values(codeObj)[0] || '');
      message = inner.message || message;
    } else if (err?.message) {
      message = err.message;
      code = err.status;
    }
  } catch {
    if (text) message = text.slice(0, 300);
  }
  return new GoogleAdsError(message, res.status, code);
}

/** Executa GAQL e devolve todas as linhas (searchStream não pagina). */
export async function search<T = any>(ctx: AdsContext, query: string): Promise<T[]> {
  const res = await fetch(`${API_BASE}/customers/${ctx.customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: await headers(ctx),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw await readError(res);
  const batches = await res.json();
  const rows: T[] = [];
  for (const b of Array.isArray(batches) ? batches : [batches]) {
    if (b?.results) rows.push(...b.results);
  }
  return rows;
}

/**
 * Metadados da API: quais campos cada recurso aceita nesta versão.
 *
 * Fica num serviço à parte (googleAdsFields), com consulta sem FROM e sem
 * conta — não dá para pedir isso pelo searchStream.
 */
export async function searchFields(refreshToken: string, query: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/googleAdsFields:search`, {
    method: 'POST',
    headers: await headers({ refreshToken }),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  return data.results || [];
}

/** IDs que o usuário do OAuth acessa diretamente (sem passar por gerenciador). */
export async function listAccessibleCustomers(refreshToken: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/customers:listAccessibleCustomers`, {
    headers: await headers({ refreshToken }),
  });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  return (data.resourceNames || []).map((r: string) => r.split('/')[1]);
}

export async function setCampaignStatus(ctx: AdsContext, campaignId: string, status: 'ENABLED' | 'PAUSED') {
  const res = await fetch(`${API_BASE}/customers/${ctx.customerId}/campaigns:mutate`, {
    method: 'POST',
    headers: await headers(ctx),
    body: JSON.stringify({
      operations: [{
        updateMask: 'status',
        update: { resourceName: `customers/${ctx.customerId}/campaigns/${campaignId}`, status },
      }],
    }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

/** Remove os hífens de "123-456-7890". */
export function cleanCustomerId(id: string | number): string {
  return String(id).replace(/\D/g, '');
}
