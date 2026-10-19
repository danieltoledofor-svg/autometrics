import { supabase } from '@/lib/supabaseClient';

/** O que as abas do Rastreamento têm em comum: chamada à API, textos e cores. */

export async function api(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export async function post(path: string, payload: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export const qty = (v: number) => Number(v || 0).toLocaleString('pt-BR');
export const money = (v: number, currency?: string) =>
  `${currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : 'US$'} ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stamp = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts }).replace(',', '');
export const when = (iso?: string | null) => (iso ? stamp(iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
export const clock = (iso?: string | null) => (iso ? stamp(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
export const lasted = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
};
export const gap = (from: string, to: string) => {
  const min = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.round(min / 1440)} dias`;
};

export const DEVICE: Record<string, string> = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet' };
export const TRAFFIC: Record<string, string> = { pago: 'Anúncio', organico: 'Busca', social: 'Rede social', referencia: 'Outro site', direto: 'Direto' };
export const place = (v: any) => [v?.city, v?.region, v?.country].filter(Boolean).join(', ');
export const path = (url: string) => { try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + u.pathname; } catch { return url || ''; } };

/** Estilo do guia visual (DESIGN.md): as cores vêm dos tokens e seguem o tema sozinhas. */
export function styles(isDark: boolean) {
  const muted = 'text-ink-subtle';
  const line = 'border-line';
  const soft = 'bg-surface-2';
  return {
    isDark, muted, line, soft,
    card: 'bg-surface-1 border-line',
    head: 'text-ink',
    th: `px-3 py-2 text-xs font-medium ${muted} ${soft} whitespace-nowrap border-b ${line}`,
    td: `px-3 py-2 text-[13px] border-b ${line}`,
    title: 'text-sm font-medium text-ink',
    tabOn: 'bg-surface-3 text-ink',
    field: `rounded-lg border ${line} bg-surface-2 text-ink px-2 py-1.5 text-[13px] outline-none focus:border-brand`,
  };
}
export type Ui = ReturnType<typeof styles>;
