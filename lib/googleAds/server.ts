import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Peças de servidor da integração com a Google Ads API: cliente Supabase com
 * a service role, identificação do usuário logado e a criptografia do token.
 *
 * Nada daqui pode ir para o navegador — o refresh token dá acesso total às
 * contas do Google Ads de quem conectou.
 */

let _admin: SupabaseClient | null = null;

/** Cliente com a service role: ignora RLS, por isso só existe no servidor. */
export function supabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.');
    _admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

/**
 * Usuário dono da requisição, pelo token do Supabase no header Authorization.
 *
 * A sessão do painel vive no localStorage, não em cookie, então as telas
 * enviam `Authorization: Bearer <access_token>` explicitamente.
 */
export async function getRequestUser(request: Request): Promise<{ id: string; email?: string } | null> {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}

// ── Criptografia do refresh token ───────────────────────────────────────────

function secretKey(): Buffer {
  const raw = process.env.GOOGLE_ADS_TOKEN_KEY;
  if (!raw || raw.length < 16) {
    throw new Error('GOOGLE_ADS_TOKEN_KEY ausente ou curta demais (mínimo 16 caracteres).');
  }
  // Aceita qualquer texto longo: o SHA-256 dele vira a chave de 32 bytes.
  return createHash('sha256').update(raw).digest();
}

/** AES-256-GCM. Formato: iv.tag.cifra, cada parte em base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map(p => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ── state do OAuth ──────────────────────────────────────────────────────────

const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * O state leva o usuário que iniciou a conexão e um nonce que também fica num
 * cookie do navegador dele. Sem o cookie, alguém poderia gerar um link de
 * autorização com a própria conta e fazer outra pessoa aprová-lo — as contas
 * do Google Ads dela cairiam no painel de quem gerou o link.
 */
export function signState(userId: string, nonce: string, base: string): string {
  const body = Buffer.from(JSON.stringify({ u: userId, n: nonce, t: Date.now(), b: base })).toString('base64url');
  const sig = createHmac('sha256', secretKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(state: string, cookieNonce: string | undefined): { userId: string; base: string } | null {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig || !cookieNonce) return null;
  const expected = createHmac('sha256', secretKey()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (data.n !== cookieNonce) return null;
    if (Date.now() - Number(data.t) > STATE_TTL_MS) return null;
    const base = ALLOWED_BASES.includes(data.b) ? data.b : appUrl();
    return { userId: String(data.u), base };
  } catch {
    return null;
  }
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}

export const OAUTH_NONCE_COOKIE = 'gads_oauth_nonce';

/** Endereço público do app — atrás do proxy da Hostinger, request.url é localhost. */
export function appUrl(): string {
  return (process.env.APP_URL || 'https://autometrics.cloud').replace(/\/$/, '');
}

// Mesmos domínios do middleware. A volta do Google precisa cair no domínio
// em que a pessoa está (com ou sem www), senão o cookie do nonce não vai junto.
const ALLOWED_BASES = [
  'https://autometrics.cloud',
  'https://www.autometrics.cloud',
  'https://staging.autometrics.cloud',
  'http://localhost:3000',
];

/** Domínio de origem do pedido, se for um dos nossos. */
export function baseFromRequest(request: Request): string {
  const origin = request.headers.get('origin') || '';
  return ALLOWED_BASES.includes(origin) ? origin : appUrl();
}

/** Precisa estar cadastrado em "URIs de redirecionamento autorizados" no Google Cloud. */
export function redirectUri(base: string = appUrl()): string {
  return `${base}/api/google-ads/oauth/callback`;
}
