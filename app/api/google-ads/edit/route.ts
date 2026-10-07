import { NextResponse } from 'next/server';
import { supabaseAdmin, getRequestUser } from '@/lib/googleAds/server';
import { addUsage } from '@/lib/googleAds/sync';
import { applyControl, campaignAccess, canEdit, checkValue, readControls, type Control } from '@/lib/googleAds/edit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Alterações na campanha feitas pelo Autometrics dentro do Google Ads.
 *
 * GET  ?product_id=…            o que dá para alterar, com os valores que estão no Google agora, e as últimas alterações
 * POST { product_id, kind, key, value }   altera um item (ensaio no Google, depois de verdade) e confere o resultado
 * POST { product_id, undo: <id> }         desfaz uma alteração, devolvendo o valor anterior
 *
 * Só para os logins liberados (lib/googleAds/edit).
 */

const history = async (productId: string) => {
  const { data } = await supabaseAdmin().from('google_ads_actions')
    .select('id, kind, target, previous_value, new_value, ok, error, created_at, undone_at, undo_of')
    .eq('product_id', productId).not('kind', 'is', null).order('created_at', { ascending: false }).limit(20);
  return data || [];
};

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
    return NextResponse.json({ allowed: true, currency: access.currency, strategy, controls: controls.map(({ resources, ...c }) => c), history: await history(productId) });
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
    const { data: old, error } = await db.from('google_ads_actions').select('id, kind, target_key, previous_value, ok, undone_at')
      .eq('id', String(body.undo)).eq('user_id', user.id).eq('product_id', productId).maybeSingle();
    if (error) return NextResponse.json({ error: 'Falta rodar a migração da edição no Supabase.' }, { status: 409 });
    if (!old || !old.ok || old.undone_at || old.previous_value === null) return NextResponse.json({ error: 'Esta alteração não pode ser desfeita.' }, { status: 400 });
    kind = old.kind; key = old.target_key; value = Number(old.previous_value); undoOf = old.id;
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
    const ok = !!now && now.value !== null && Math.abs(now.value - value) < 0.011;
    const { error: logError } = await log(ok, { error: ok ? null : `O Google ficou com ${now?.value ?? 'outro valor'}` });
    if (undoOf && ok) await db.from('google_ads_actions').update({ undone_at: new Date().toISOString() }).eq('id', undoOf);
    await addUsage(calls).catch(() => {});
    return NextResponse.json({
      success: ok, previous: control.value, value: now?.value ?? null, logged: !logError,
      controls: after.controls.map(({ resources, ...c }) => c), history: await history(productId),
      ...(ok ? {} : { error: 'O Google aceitou o pedido, mas o valor conferido depois é diferente do pedido.' }),
    });
  } catch (e: any) {
    await log(false, { error: String(e.message).slice(0, 1000) }).then(() => null, () => null);
    await addUsage(calls).catch(() => {});
    return NextResponse.json({ error: `O Google recusou a alteração: ${e.message}` }, { status: 502 });
  }
}
