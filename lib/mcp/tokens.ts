import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Chaves do MCP (migration_mcp.sql). A chave vai no link que o usuário cola no
 * Claude (…/api/mcp/<chave>); no banco só fica o hash. Revogar = marcar
 * revoked_at: o link para de funcionar na hora.
 */

const PREFIX = 'amk_';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createToken(db: SupabaseClient, userId: string, label: string) {
  const token = `${PREFIX}${randomBytes(24).toString('base64url')}`;
  const { data, error } = await db.from('mcp_tokens')
    .insert({ user_id: userId, token_hash: hashToken(token), label: label.slice(0, 60) || null })
    .select('id, label, created_at').single();
  if (error) throw new Error(error.message);
  return { token, row: data };
}

/** Dono da chave, ou null (chave errada ou revogada). Anota o último uso. */
export async function userOfToken(db: SupabaseClient, token: string): Promise<string | null> {
  if (!token.startsWith(PREFIX) || token.length < 20 || token.length > 100) return null;
  const { data } = await db.from('mcp_tokens').select('id, user_id, revoked_at, last_used_at')
    .eq('token_hash', hashToken(token)).maybeSingle();
  if (!data || data.revoked_at) return null;
  // No máximo uma escrita por minuto por chave.
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 60_000) {
    await db.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => null, () => null);
  }
  return String(data.user_id);
}
