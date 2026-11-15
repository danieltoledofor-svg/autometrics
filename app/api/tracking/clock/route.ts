import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { CLOCK_OPTIONS, clockOf, platformKey } from '@/lib/tracking/platformClock';
import { userClocks } from '@/lib/tracking/eventDays';
import { refileClock } from '@/lib/tracking/refileClock';

export const dynamic = 'force-dynamic';

/**
 * Troca o relógio de uma plataforma e leva as vendas que já chegaram para o
 * dia certo no painel (lib/tracking/refileClock.ts).
 *
 * POST { platform, zone }
 */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const platform = platformKey(body.platform || '');
  const zone = String(body.zone || '');
  if (!platform || !CLOCK_OPTIONS.some(o => o.value === zone)) return NextResponse.json({ error: 'Relógio inválido.' }, { status: 400 });

  const db = supabaseAdmin();
  const saved = await userClocks(db, user.id);
  const previous = clockOf(platform, saved);
  const { error } = await db.from('user_settings').upsert({ user_id: user.id, platform_clocks: { ...(saved || {}), [platform]: zone } }, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: 'Não foi possível salvar. Falta rodar o arquivo migration_relogio_plataformas.sql no Supabase.' }, { status: 500 });

  try {
    const { moved } = await refileClock(db, user.id, platform, previous, zone);
    return NextResponse.json({ ok: true, moved });
  } catch (e: any) {
    console.error('[Relógio] Erro ao mudar as vendas de dia:', e?.message);
    return NextResponse.json({ ok: true, moved: 0, warning: 'O relógio foi salvo, mas as vendas que já chegaram não mudaram de dia no painel.' });
  }
}
