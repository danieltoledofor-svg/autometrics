"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Alertas no Telegram: liga a conversa do usuário ao bot do Autometrics.
 * A pessoa abre o bot pelo link (que já leva o código), toca em Iniciar e
 * volta aqui para conferir. Rota: /api/telegram.
 */

async function api(body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/telegram', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export function TelegramCard({ isDark }: { isDark: boolean }) {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => { const { body } = await api(); setState(body); }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (action: string, extra: any = {}, done?: string) => {
    setBusy(action);
    setMessage(null);
    const { ok, body } = await api({ action, ...extra });
    if (!ok) setMessage({ ok: false, text: body.error || 'Não deu certo.' });
    else { if (body.ready) setState(body); if (done) setMessage({ ok: true, text: done }); }
    setBusy('');
  };

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const head = isDark ? 'text-white' : 'text-slate-900';
  const muted = 'text-slate-500';
  const line = isDark ? 'border-slate-800' : 'border-slate-200';
  const ghost = `px-3 py-1.5 rounded-lg border ${line} text-xs font-bold ${muted} hover:text-indigo-400 disabled:opacity-50`;
  const solid = 'bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5';
  const spin = (a: string) => busy === a && <Loader2 size={12} className="animate-spin" />;

  if (!state) return null;
  const link = state.bot && state.code ? `https://t.me/${state.bot}?start=${state.code}` : '';

  return (
    <div className={`${card} border rounded-xl p-4 mb-6`}>
      <div className="flex items-center gap-2 mb-1">
        <Send size={15} className="text-sky-500" />
        <span className={`text-sm font-bold ${head}`}>Alertas no Telegram</span>
        {state.linked && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${state.enabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>{state.enabled ? 'Ligado' : 'Pausado'}</span>}
      </div>
      <div className={`text-xs ${muted} mb-3`}>
        Aviso no seu Telegram quando uma campanha gasta bem acima do normal no dia. Cada campanha avisa no máximo uma vez por dia em cada caso.
      </div>

      {!state.ready && <div className="text-sm text-amber-500">{state.error}</div>}
      {state.ready && !state.configured && <div className="text-sm text-amber-500">O bot do Telegram ainda não foi configurado no servidor do Autometrics.</div>}

      {state.ready && state.configured && !state.linked && (
        <div className="space-y-3">
          {!state.code ? (
            <button onClick={() => run('code')} disabled={!!busy} className={solid}>{spin('code')} Ligar o meu Telegram</button>
          ) : (
            <>
              <ol className={`text-[13px] ${head} space-y-1.5 list-decimal pl-5`}>
                <li>Abra o bot: <a href={link} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline break-all">{link}</a></li>
                <li>No Telegram, toque em <b>Iniciar</b>. Se o botão não aparecer, envie a mensagem <b className="font-mono">{state.code}</b>.</li>
                <li>Volte aqui e clique em conferir.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => run('check', {}, 'Telegram ligado. Mandei uma mensagem de confirmação para você.')} disabled={!!busy} className={solid}>{spin('check')} Já enviei, conferir</button>
                <button onClick={() => run('code')} disabled={!!busy} className={ghost}>Gerar outro código</button>
              </div>
              <div className={`text-[11px] ${muted}`}>O código vale 30 minutos.</div>
            </>
          )}
        </div>
      )}

      {state.ready && state.configured && state.linked && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[13px] ${head} mr-auto`}>Conversa: <b>{state.chat_name || 'Telegram'}</b></span>
          <button onClick={() => run('test', {}, 'Mensagem de teste enviada.')} disabled={!!busy} className={solid}>{spin('test')} Enviar teste</button>
          <button onClick={() => run('toggle', { enabled: !state.enabled })} disabled={!!busy} className={ghost}>{state.enabled ? 'Pausar alertas' : 'Voltar a avisar'}</button>
          <button onClick={() => run('unlink', {}, 'Ligação desfeita.')} disabled={!!busy} className={ghost}>Desligar</button>
        </div>
      )}

      {message && <div className={`text-xs mt-3 ${message.ok ? 'text-emerald-500' : 'text-rose-500'}`}>{message.text}</div>}
    </div>
  );
}
