import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { botUsername, sendTelegram, telegramEnabled, tg } from '@/lib/telegram';
import { ALERTS, resolveSettings } from '@/lib/alerts/catalog';

export const dynamic = 'force-dynamic';

/**
 * Ligação do usuário com o bot do Telegram (Integração → Alertas no Telegram).
 *
 * GET   situação: bot configurado, conversa ligada, alertas ligados
 * POST  { action }
 *   code    gera o código que a pessoa manda para o bot (vale 30 minutos)
 *   check   procura esse código nas mensagens recebidas pelo bot e liga a conversa
 *   test    manda uma mensagem de teste
 *   toggle  { enabled } liga ou desliga os alertas, sem desfazer a ligação
 *   unlink  desfaz a ligação
 *   settings { settings } quais alertas estão ligados, os limites e o horário de silêncio
 */

const MISSING = 'Falta rodar migration_telegram.sql no Supabase.';
const CODE_MINUTES = 30;

async function status(userId: string) {
  const { data, error } = await supabaseAdmin().from('telegram_links').select('*').eq('user_id', userId).maybeSingle();
  if (error) return { ready: false as const, error: MISSING };
  const configured = telegramEnabled();
  const bot = configured ? await botUsername().catch(() => '') : '';
  const fresh = data?.code && data.code_at && Date.now() - new Date(data.code_at).getTime() < CODE_MINUTES * 60 * 1000;
  return {
    ready: true as const, configured, bot,
    linked: !!data?.chat_id, chat_name: data?.chat_name || null, enabled: data?.enabled !== false,
    code: !data?.chat_id && fresh ? data.code : null,
    // Alertas disponíveis e as escolhas do usuário (com o padrão no que ele não mexeu).
    catalog: ALERTS, settings: resolveSettings(data?.settings),
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  return NextResponse.json(await status(user.id));
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const fail = (error: string, code = 400) => NextResponse.json({ error }, { status: code });
  if (!telegramEnabled()) return fail('O bot do Telegram ainda não foi configurado no servidor.', 409);

  if (body.action === 'code') {
    const code = randomBytes(4).toString('hex').toUpperCase();
    const { error } = await db.from('telegram_links').upsert({ user_id: user.id, code, code_at: now, updated_at: now }, { onConflict: 'user_id' });
    if (error) return fail(MISSING, 409);
    return NextResponse.json(await status(user.id));
  }

  const { data: link, error } = await db.from('telegram_links').select('*').eq('user_id', user.id).maybeSingle();
  if (error) return fail(MISSING, 409);

  if (body.action === 'check') {
    if (!link?.code) return fail('Gere o código primeiro.');
    if (Date.now() - new Date(link.code_at).getTime() > CODE_MINUTES * 60 * 1000) return fail('O código venceu. Gere outro.');
    // As últimas mensagens recebidas pelo bot; só interessa a que traz o código deste usuário.
    let updates: any[];
    try { updates = await tg<any[]>('getUpdates', { limit: 100, allowed_updates: ['message'] }); }
    catch (e: any) { return fail(`O Telegram não respondeu: ${e.message}`, 502); }
    const hit = [...updates].reverse().find(u => String(u.message?.text || '').toUpperCase().includes(link.code));
    if (!hit) return fail('Ainda não achei a sua mensagem. Abra o bot, toque em Iniciar (ou envie o código) e confira de novo.', 404);
    const chat = hit.message.chat;
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || chat.username || '';
    await db.from('telegram_links').update({ chat_id: String(chat.id), chat_name: name, code: null, linked_at: now, enabled: true, updated_at: now }).eq('user_id', user.id);
    await sendTelegram(String(chat.id), '✅ <b>Autometrics ligado.</b>\nOs alertas das suas campanhas chegam por aqui.').catch(() => {});
    return NextResponse.json(await status(user.id));
  }

  if (body.action === 'settings') {
    // Passa pelo mesmo filtro da leitura: só entram alertas e números válidos.
    const settings = resolveSettings(body.settings);
    const { error: saveError } = await db.from('telegram_links').upsert({ user_id: user.id, settings, updated_at: now }, { onConflict: 'user_id' });
    if (saveError) return fail('Falta rodar migration_telegram_alertas.sql no Supabase.', 409);
    return NextResponse.json(await status(user.id));
  }

  if (!link?.chat_id) return fail('O Telegram ainda não está ligado.');

  if (body.action === 'test') {
    try { await sendTelegram(link.chat_id, '🔔 <b>Teste do Autometrics</b>\nSe você está lendo isto, os alertas chegam nesta conversa.'); }
    catch (e: any) { return fail(`O Telegram recusou a mensagem: ${e.message}`, 502); }
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'toggle') {
    await db.from('telegram_links').update({ enabled: !!body.enabled, updated_at: now }).eq('user_id', user.id);
    return NextResponse.json(await status(user.id));
  }
  if (body.action === 'unlink') {
    await db.from('telegram_links').update({ chat_id: null, chat_name: null, code: null, updated_at: now }).eq('user_id', user.id);
    return NextResponse.json(await status(user.id));
  }
  return fail('Pedido inválido.');
}
