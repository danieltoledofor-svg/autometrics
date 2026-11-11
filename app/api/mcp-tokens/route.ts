import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser, appUrl } from '@/lib/googleAds/server';
import { createToken } from '@/lib/mcp/tokens';

export const dynamic = 'force-dynamic';

/**
 * Links do MCP do usuário (Integração → Claude).
 *
 * GET                       os links gerados (sem a chave) e o endereço base
 * POST { label }            gera um link; a chave só aparece nesta resposta
 * POST { revoke: id }       revoga um link: para de funcionar na hora
 */

const NEEDS_MIGRATION = 'Rode migration_mcp.sql no Supabase para gerar o link.';

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const { data, error } = await supabaseAdmin().from('mcp_tokens')
    .select('id, label, created_at, last_used_at').eq('user_id', user.id).is('revoked_at', null).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ready: false, error: NEEDS_MIGRATION, tokens: [] });
  return NextResponse.json({ ready: true, base: `${appUrl()}/api/mcp/`, tokens: data || [] });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (body.revoke) {
    const { error } = await db.from('mcp_tokens').update({ revoked_at: new Date().toISOString() })
      .eq('id', String(body.revoke)).eq('user_id', user.id);
    if (error) return NextResponse.json({ error: 'Não foi possível revogar.' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { count } = await db.from('mcp_tokens').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('revoked_at', null);
  if ((count || 0) >= 10) return NextResponse.json({ error: 'Já há 10 links ativos. Revogue um antes de gerar outro.' }, { status: 400 });
  try {
    const { token, row } = await createToken(db, user.id, String(body.label || '').trim());
    return NextResponse.json({ ok: true, url: `${appUrl()}/api/mcp/${token}`, token: row });
  } catch {
    return NextResponse.json({ error: NEEDS_MIGRATION }, { status: 500 });
  }
}
