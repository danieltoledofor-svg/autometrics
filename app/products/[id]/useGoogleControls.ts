"use client";

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/**
 * O que dá para alterar na campanha dentro do Google Ads (meta de CPA da
 * campanha e dos grupos, limite de CPC, orçamento e ajustes de lance), lido do
 * Google na hora, e as funções de alterar, negativar, pausar e desfazer.
 * Rota: /api/google-ads/edit.
 *
 * As abas da campanha dividem a mesma leitura por um minuto, para trocar de
 * aba não gastar consultas do Google à toa.
 */

export interface GoogleControl { kind: string; key: string; label: string; value: number | null; editable: boolean; note?: string; mixed?: boolean }
export interface ControlsState { allowed: boolean; loading: boolean; error: string; currency: string; controls: GoogleControl[]; history: any[] }

/** Alterar um valor, desfazer, negativar um termo ou pausar uma palavra-chave. `suggestion_id` marca a sugestão da IA como feita. */
export type ChangeBody = ({ kind: string; key: string; value: number } | { undo: string } | { action: 'negativa'; text: string; match: 'EXACT' | 'PHRASE' } | { action: 'pausar_palavra'; keyword: string }) & { suggestion_id?: string };

const cache = new Map<string, { at: number; state: ControlsState }>();
const listeners = new Map<string, Set<(s: ControlsState) => void>>();
const EMPTY: ControlsState = { allowed: false, loading: true, error: '', currency: 'USD', controls: [], history: [] };

async function call(productId: string, body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(body ? '/api/google-ads/edit' : `/api/google-ads/edit?product_id=${productId}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify({ product_id: productId, ...body }) : undefined,
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

function publish(productId: string, state: ControlsState) {
  cache.set(productId, { at: Date.now(), state });
  listeners.get(productId)?.forEach(fn => fn(state));
}

export function useGoogleControls(productId: string, enabled = true) {
  const [state, setState] = useState<ControlsState>(() => cache.get(productId)?.state || EMPTY);

  useEffect(() => {
    if (!productId || !enabled) return;
    if (!listeners.has(productId)) listeners.set(productId, new Set());
    listeners.get(productId)!.add(setState);
    const hit = cache.get(productId);
    if (hit && Date.now() - hit.at < 60_000) setState(hit.state);
    else {
      call(productId).then(({ body }) => publish(productId, {
        allowed: !!body.allowed, loading: false, error: body.error || '', currency: body.currency || 'USD',
        controls: body.controls || [], history: body.history || [],
      }));
    }
    return () => { listeners.get(productId)?.delete(setState); };
  }, [productId, enabled]);

  /** Altera um item (ou desfaz uma alteração). Devolve a mensagem de erro, ou '' se deu certo. */
  const change = useCallback(async (body: ChangeBody): Promise<string> => {
    const { ok, body: res } = await call(productId, body);
    const current = cache.get(productId)?.state || EMPTY;
    if (res.controls || res.history) publish(productId, { ...current, controls: res.controls || current.controls, history: res.history || current.history });
    return ok && res.success ? '' : res.error || 'O Google não confirmou a alteração.';
  }, [productId]);

  return { ...state, change };
}

/** −20 → "−20%"; 0 → "—" (sem ajuste, como o Google mostra). */
export const adjustText = (v: number | null | undefined, mixed?: boolean) =>
  mixed ? 'varia entre os grupos' : !v ? '—' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
