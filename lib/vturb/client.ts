import { supabaseAdmin } from '@/lib/googleAds/server';

/**
 * API de Analytics da VTurb (https://vturb.gitbook.io/analytics-api).
 *
 * Só no servidor: o token de cada usuário fica em user_settings e nunca vai
 * para o navegador. Limite do plano básico: 60 a 120 consultas por minuto —
 * a coleta usa de 3 a 7 por player por hora.
 */

const BASE = 'https://analytics.vturb.net';

export class VturbError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export interface VturbPlayer { id: string; name: string; duration: number; pitch_time: number | null }

export async function vturbToken(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from('user_settings').select('vturb_api_token').eq('user_id', userId).maybeSingle();
  return data?.vturb_api_token?.trim() || null;
}

export async function vturb(token: string, endpoint: string, body?: Record<string, any>): Promise<any> {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Api-Token': token, 'X-Api-Version': 'v1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error || data?.message || `VTurb respondeu ${res.status}`;
    throw new VturbError(res.status === 401 || res.status === 403 ? 'Token da VTurb recusado. Confira em Integração → VTurb.' : String(msg), res.status);
  }
  return data;
}

/** Aceita o ID ou a URL do player (app.vturb.com/players/<id>/...). */
export function playerIdFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = String(value).match(/[0-9a-f]{24}/i);
  return m ? m[0].toLowerCase() : null;
}

export async function listPlayers(token: string): Promise<VturbPlayer[]> {
  const data = await vturb(token, 'players/list');
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return list.map((p: any) => ({ id: String(p.id), name: String(p.name || ''), duration: Number(p.duration) || 0, pitch_time: p.pitch_time ? Number(p.pitch_time) : null }));
}

/** utm_term chega como "baking+soda+recipe" ou "baking%20soda". */
export function decodeTerm(raw: string): string {
  const s = String(raw || '').replace(/\+/g, ' ');
  try { return decodeURIComponent(s).trim().toLowerCase(); } catch { return s.trim().toLowerCase(); }
}
