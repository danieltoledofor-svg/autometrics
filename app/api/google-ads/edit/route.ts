import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { addUsage } from '@/lib/googleAds/sync';
import { GoogleAdsError } from '@/lib/googleAds/client';
import { addNegative, applyControl, campaignAccess, canEdit, checkValue, negativeLabel, readControls, removeNegative, setKeywordStatus, type Control } from '@/lib/googleAds/edit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Alterações na campanha feitas pelo Autometrics dentro do Google Ads.
 *
 * GET  ?product_id=…            o que dá para alterar, com os valores que estão no Google agora, e as últimas alterações
 * POST { product_id, kind, key, value }   altera um item (ensaio no Google, depois de verdade) e confere o resultado
 * POST { product_id, undo: <id> }         desfaz uma alteração, devolvendo o valor anterior
 * POST { product_id, action: 'negativa', text, match }        cria a negativa do termo na campanha
 * POST { product_id, action: 'pausar_palavra', keyword }      pausa a palavra-chave
 *
 * Com suggestion_id, a sugestão da IA que pediu a alteração fica marcada como feita.
 *
 * Só para os logins liberados (lib/googleAds/edit).
 */

const history = async (productId: string) => {
  const { data } = await supabaseAdmin().from('google_ads_actions')
    .select('id, kind, target, previous_value, new_value, ok, error, created_at, undone_at, undo_of')
    .eq('product_id', productId).not('kind', 'is', null).order('created_at', { ascending: false }).limit(20);
  return data || [];
};

const strip = (controls: Control[]) => controls.map(({ resources, creates, ...c }) => c);
const ACTIONS = new Set(['negativa', 'pausar_palavra']);
const adjust = (v: number | null) => (!v ? 'sem ajuste' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`);

/** Sugestão da IA aplicada por aqui: fica marcada na hora, sem esperar o histórico do Google. */
async function markSuggestion(userId: string, productId: string, id: any, fields: { f: string; de?: string; para: string }[]) {
  if (!id) return;
  const now = new Date();
  await supabaseAdmin().from('analysis_suggestions').update({
    status: 'aplicada', change_at: now.toISOString(), updated_at: now.toISOString(),
    change: { changed_at: now.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }), type: 'AUTOMETRICS', operation: 'UPDATE', fields },
  }).eq('id', String(id)).eq('user_id', userId).eq('product_id', productId).eq('status', 'aberta').then(() => null, () => null);
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  if (!canEdit(user.email)) return NextResponse.json({ allowed: false });
  const productId = new URL(request.url).searchParams.get('product_id') || '';
  const access = await campaignAccess(user.id, productId);
  if ('error' in access) return NextResponse.json({ allowed: true, error: access.error });
  try {
    const { strategy, controls, api_calls } = await readControls(access.ctx, access.campaignId);
    await addUsage(api_calls).catch(() => {});
    return NextResponse.json({ allowed: true, currency: access.currency, strategy, controls: strip(controls), history: await history(productId) });
  } catch (e: any) {
    return NextResponse.json({ allowed: true, error: `O Google não respondeu: ${e.message}` });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Faça login novamente.' }, { status: 401 });
  if (!canEdit(user.email)) return NextResponse.json({ error: 'A alteração pelo Autometrics ainda não está liberada para este login.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const productId = String(body.product_id || '');
  const access = await campaignAccess(user.id, productId);
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: 409 });
  const db = supabaseAdmin();

  // Desfazer = aplicar de volta o valor anterior do mesmo item.
  let kind = String(body.kind || ''), key = String(body.key || ''), value = Number(body.value);
  let undoOf: string | null = null;
  if (body.undo) {
    const { data: old, error } = await db.from('google_ads_actions').select('id, kind, target, target_key, previous_value, ok, undone_at, undo_of')
      .eq('id', String(body.undo)).eq('user_id', user.id).eq('product_id', productId).maybeSingle();
    if (error) return NextResponse.json({ error: 'Falta rodar a migração da edição no Supabase.' }, { status: 409 });
    const noValue = !old || (old.previous_value === null && old.kind !== 'meta_cpa_grupo' && !ACTIONS.has(old.kind));
    if (!old || !old.ok || old.undone_at || old.undo_of || noValue) return NextResponse.json({ error: 'Esta alteração não pode ser desfeita.' }, { status: 400 });
    kind = old.kind; key = old.target_key; value = Number(old.previous_value || 0); undoOf = old.id;
    if (ACTIONS.has(kind)) body.target = old.target;
  } else if (body.action) kind = String(body.action);

  // Negativa de termo e pausa de palavra-chave: não têm valor, só feito ou desfeito.
  if (ACTIONS.has(kind)) {
    let target = String(body.target || ''), calls = 0;
    const save = (ok: boolean, error: string | null) => db.from('google_ads_actions').insert({
      user_id: user.id, product_id: productId, customer_id: access.account.customer_id, campaign_id: access.campaignId,
      action: undoOf ? 'desfazer' : 'alterar', kind, target, target_key: key, ok, error, undo_of: undoOf,
    }).then(() => null, () => null);
    try {
      if (kind === 'negativa' && undoOf) calls = await removeNegative(access.ctx, key);
      else if (kind === 'negativa') {
        const match = body.match === 'PHRASE' ? 'PHRASE' : 'EXACT';
        const text = String(body.text || '').trim().replace(/\s+/g, ' ');
        target = negativeLabel(text, match);
        const made = await addNegative(access.ctx, access.campaignId, text, match);
        key = made.resource; calls = made.calls;
        await markSuggestion(user.id, productId, body.suggestion_id, [{ f: 'negative', para: target }]);
      } else {
        const done = await setKeywordStatus(access.ctx, access.campaignId, undoOf ? key.split('/').pop()! : String(body.keyword || ''), undoOf ? 'ENABLED' : 'PAUSED');
        key = done.resource; target = done.label; calls = done.calls;
        if (!undoOf) await markSuggestion(user.id, productId, body.suggestion_id, [{ f: 'status', de: 'ativa', para: 'pausada' }]);
      }
      await save(true, null);
      if (undoOf) await db.from('google_ads_actions').update({ undone_at: new Date().toISOString() }).eq('id', undoOf);
      await addUsage(calls).catch(() => {});
      return NextResponse.json({ success: true, target, history: await history(productId) });
    } catch (e: any) {
      await save(false, String(e.message).slice(0, 1000));
      return NextResponse.json({ error: e instanceof GoogleAdsError ? `O Google recusou a alteração: ${e.message}` : e.message }, { status: 502 });
    }
  }

  let calls = 0;
  let control: Control | undefined;
  const log = (ok: boolean, extra: Record<string, any>) => db.from('google_ads_actions').insert({
    user_id: user.id, product_id: productId, customer_id: access.account.customer_id, campaign_id: access.campaignId,
    action: undoOf ? 'desfazer' : 'alterar', kind, target: control?.label || key, target_key: key,
    previous_value: control?.value ?? null, new_value: value, ok, undo_of: undoOf, ...extra,
  });

  try {
    const before = await readControls(access.ctx, access.campaignId);
    calls += before.api_calls;
    control = before.controls.find(c => c.kind === kind && c.key === key);
    if (!control) return NextResponse.json({ error: 'Este item não existe mais na campanha. Atualize a tela.' }, { status: 404 });
    if (!control.editable) return NextResponse.json({ error: control.note || 'Este item não pode ser alterado por aqui.' }, { status: 409 });
    const problem = checkValue(control.kind, value);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    calls += await applyControl(access.ctx, access.campaignId, control, before.strategy, value);

    // Confere no Google em vez de supor que deu certo.
    const after = await readControls(access.ctx, access.campaignId);
    calls += after.api_calls;
    const now = after.controls.find(c => c.kind === kind && c.key === key);
    // Meta do grupo em 0 = sem meta própria: no Google ela volta vazia.
    const got = now ? now.value ?? (kind === 'meta_cpa_grupo' ? 0 : null) : null;
    const ok = got !== null && Math.abs(got - value) < 0.011;
    if (ok && !undoOf) {
      const money = kind === 'meta_cpa_grupo';
      const show = (v: number | null) => (money ? (v ? v.toFixed(2).replace('.', ',') : 'a da campanha') : adjust(v));
      await markSuggestion(user.id, productId, body.suggestion_id, [{ f: money ? 'target_cpa_micros' : 'bid_modifier', de: show(control.value), para: show(value) }]);
    }
    const { error: logError } = await log(ok, { error: ok ? null : `O Google ficou com ${now?.value ?? 'outro valor'}` });
    if (undoOf && ok) await db.from('google_ads_actions').update({ undone_at: new Date().toISOString() }).eq('id', undoOf);
    await addUsage(calls).catch(() => {});
    return NextResponse.json({
      success: ok, previous: control.value, value: now?.value ?? null, logged: !logError,
      controls: strip(after.controls), history: await history(productId),
      ...(ok ? {} : { error: 'O Google aceitou o pedido, mas o valor conferido depois é diferente do pedido.' }),
    });
  } catch (e: any) {
    await log(false, { error: String(e.message).slice(0, 1000) }).then(() => null, () => null);
    await addUsage(calls).catch(() => {});
    return NextResponse.json({ error: `O Google recusou a alteração: ${e.message}` }, { status: 502 });
  }
}
