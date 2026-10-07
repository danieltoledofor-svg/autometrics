import { supabase } from '@/lib/supabaseClient';

/** O que as abas do Rastreamento têm em comum: chamada à API, textos e cores. */

export async function api(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
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

export function styles(isDark: boolean) {
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const line = isDark ? 'border-slate-800' : 'border-slate-200';
  const soft = isDark ? 'bg-slate-950' : 'bg-slate-50';
  return {
    isDark, muted, line, soft,
    card: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200',
    head: isDark ? 'text-white' : 'text-slate-900',
    th: `px-3 py-2 text-[10.5px] uppercase tracking-wider font-bold ${muted} ${soft} whitespace-nowrap border-b ${line}`,
    td: `px-3 py-2 text-[13px] border-b ${line}`,
    title: `text-[11px] uppercase tracking-wider font-extrabold ${muted}`,
    tabOn: isDark ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-900',
    field: `rounded-lg border ${line} ${soft} ${isDark ? 'text-white' : 'text-slate-900'} px-2 py-1.5 text-[13px] outline-none focus:border-indigo-500`,
  };
}
export type Ui = ReturnType<typeof styles>;
