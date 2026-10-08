import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { botUsername, sendTelegram, telegramEnabled, tg } from '@/lib/telegram';
import { ALERTS, resolveSettings, sanitizeRule, describeRule, RULE_METRICS, RULE_WINDOWS, RULE_BASES } from '@/lib/alerts/catalog';
import { isOwner, aiEnabled, askJson } from '@/lib/ai/openrouter';

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
 *   settings { settings } quais alertas estão ligados, os limites, as regras próprias e o horário de silêncio
 *   rule_draft { text }  a IA transforma um pedido em português numa regra; nada é salvo aqui
 */

const RULE_SYSTEM = `Você transforma o pedido de um afiliado de Google Ads numa regra de alerta. Responda só com JSON.

Uma regra olha UM número de cada campanha, num período, e avisa quando ele fica acima ou abaixo de um limite.

Campos:
- metric: ${Object.entries(RULE_METRICS).map(([k, v]) => `"${k}" (${v.label})`).join(', ')}
- window: ${Object.entries(RULE_WINDOWS).map(([k, v]) => `"${k}" (${v})`).join(', ')}
- op: "acima" ou "abaixo"
- basis: ${Object.entries(RULE_BASES).map(([k, v]) => `"${k}" (${v})`).join(', ')}. As bases em % só valem para cpa, custo, receita, resultado e cpc.
- value: número. Com basis "valor" é o limite na moeda da conta (ou em % para roi e ctr, ou a quantidade para vendas e cliques). Com basis em %, é a porcentagem (80 = 80%).
- contains: trecho do nome da campanha, se o pedido citar um produto, marcação ou grupo; senão "".
- min_cost: custo mínimo no período para a regra valer, se o pedido citar; senão 0.
- name: nome curto da regra, até 50 caracteres, em português simples.

Se o pedido não disser o período, use "d3" para CPA e retorno, e "hoje" para custo, vendas e cliques.
Se o pedido falar em porcentagem do CPA, da comissão ou do valor da venda, use basis "pct_venda". Se falar em meta de CPA, CPA desejado ou tCPA, use "pct_meta".
Se o pedido precisar de algo que não cabe (mais de um número ao mesmo tempo, palavra-chave, termo, horário, pausar campanha, comparar com outro período), não invente: devolva regra nula e explique em uma frase simples o que não dá e o que mais se aproxima.

Formato: {"regra": {metric, window, op, basis, value, contains, min_cost, name} ou null, "motivo": "só quando regra for null"}`;

const MISSING = 'Falta rodar migration_telegram.sql no Supabase.';
const CODE_MINUTES = 30;

async function status(userId: string, email?: string) {
  const { data, error } = await supabaseAdmin().from('telegram_links').select('*').eq('user_id', userId).maybeSingle();
  if (error) return { ready: false as const, error: MISSING };
  // Os alertas dos cartões só aparecem para quem ligou a LootRush.
  const { data: lootrush } = await supabaseAdmin().from('lootrush_connections').select('user_id').eq('user_id', userId).maybeSingle();
  const configured = telegramEnabled();
  const bot = configured ? await botUsername().catch(() => '') : '';
  const fresh = data?.code && data.code_at && Date.now() - new Date(data.code_at).getTime() < CODE_MINUTES * 60 * 1000;
  return {
    ready: true as const, configured, bot,
    linked: !!data?.chat_id, chat_name: data?.chat_name || null, enabled: data?.enabled !== false,
    code: !data?.chat_id && fresh ? data.code : null,
    // Alertas disponíveis e as escolhas do usuário (com o padrão no que ele não mexeu).
    catalog: ALERTS.filter(a => (!a.ownerOnly || isOwner(email)) && (!a.lootrush || !!lootrush)), settings: resolveSettings(data?.settings),
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  return NextResponse.json(await status(user.id, user.email));
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
    return NextResponse.json(await status(user.id, user.email));
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
    return NextResponse.json(await status(user.id, user.email));
  }

  if (body.action === 'rule_draft') {
    const text = String(body.text || '').trim().slice(0, 600);
    if (!text) return fail('Escreva a regra que você quer.');
    if (!aiEnabled()) return fail('A IA está desligada no servidor.', 409);
    try {
      const raw = await askJson<any>({ fn: 'padroes', userId: user.id, system: RULE_SYSTEM, user: `PEDIDO DO AFILIADO:\n${text}`, maxTokens: 700 });
      const rule = sanitizeRule(raw?.regra);
      if (!rule) return NextResponse.json({ rule: null, reason: String(raw?.motivo || 'Não consegui transformar esse pedido numa regra. Tente dizer qual número, em que período e qual o limite.').slice(0, 400) });
      return NextResponse.json({ rule, description: describeRule(rule) });
    } catch (e: any) { return fail(e.message || 'A IA não respondeu.', 502); }
  }

  if (body.action === 'settings') {
    // Passa pelo mesmo filtro da leitura: só entram alertas e números válidos.
    const settings = resolveSettings(body.settings);
    const { error: saveError } = await db.from('telegram_links').upsert({ user_id: user.id, settings, updated_at: now }, { onConflict: 'user_id' });
    if (saveError) return fail('Falta rodar migration_telegram_alertas.sql no Supabase.', 409);
    return NextResponse.json(await status(user.id, user.email));
  }

  if (!link?.chat_id) return fail('O Telegram ainda não está ligado.');

  if (body.action === 'test') {
    try { await sendTelegram(link.chat_id, '🔔 <b>Teste do Autometrics</b>\nSe você está lendo isto, os alertas chegam nesta conversa.'); }
    catch (e: any) { return fail(`O Telegram recusou a mensagem: ${e.message}`, 502); }
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'toggle') {
    await db.from('telegram_links').update({ enabled: !!body.enabled, updated_at: now }).eq('user_id', user.id);
    return NextResponse.json(await status(user.id, user.email));
  }
  if (body.action === 'unlink') {
    await db.from('telegram_links').update({ chat_id: null, chat_name: null, code: null, updated_at: now }).eq('user_id', user.id);
    return NextResponse.json(await status(user.id, user.email));
  }
  return fail('Pedido inválido.');
}
