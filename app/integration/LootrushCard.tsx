"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Aba Cartões da Integração: liga a LootRush do usuário.
 *
 * 1. Ele cola a chave gerada na LootRush (só com "MCP → Read"). O servidor
 *    confere a chave e guarda criptografada; ela não volta para a tela.
 * 2. Escolhe os grupos de cartões que quer acompanhar. A primeira leitura
 *    guarda os últimos 30 dias, sem avisos.
 *
 * As cobranças aparecem em Metas e os avisos saem pelo Telegram. Rota: /api/lootrush.
 */

async function api(path = '', body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/lootrush${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}
const money = (v: number | null) => (v === null ? '' : `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não');

export function LootrushCard({ isDark }: { isDark: boolean }) {
  const [state, setState] = useState<any>(null);
  const [available, setAvailable] = useState<{ id: string; name: string; cards: number; spend30: number | null }[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const head = isDark ? 'text-white' : 'text-slate-900', muted = 'text-slate-500';
  const solid = 'bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-2';
  const ghost = `px-4 py-2 rounded-lg border text-xs font-bold disabled:opacity-40 inline-flex items-center gap-2 ${isDark ? 'border-slate-700 text-slate-200 hover:border-indigo-400' : 'border-slate-300 text-slate-700 hover:border-indigo-500'}`;
  const input = `flex-1 min-w-0 rounded-lg border px-3 py-2 text-[13px] ${isDark ? 'bg-slate-950 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'}`;
  const spin = (name: string) => busy === name && <Loader2 size={13} className="animate-spin" />;

  const apply = (body: any) => {
    setState(body);
    if (body.available) setAvailable(body.available);
    if (Array.isArray(body.groups)) setPicked(body.groups.map((g: any) => g.id));
  };
  const load = useCallback(async () => {
    const { body } = await api();
    apply(body);
    if (body.connected) { const groups = await api('?grupos=1'); if (groups.ok) setAvailable(groups.body.available); else setMessage({ ok: false, text: groups.body.error || 'A LootRush não respondeu.' }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (action: string, extra: any, done: (body: any) => string) => {
    setBusy(action); setMessage(null);
    const { ok, body } = await api('', { action, ...extra });
    setBusy('');
    if (!ok) { setMessage({ ok: false, text: body.error || 'Não deu certo. Tente de novo.' }); return; }
    apply(body);
    setMessage(body.result?.error ? { ok: false, text: body.result.error } : { ok: true, text: done(body) });
  };
  const connect = () => run('ligar', { key }, () => 'Chave conferida. Agora escolha os grupos de cartões.').then(() => { setKey(''); setChanging(false); });
  const saveGroups = () => run('grupos', { groups: picked }, b => (picked.length ? `Grupos salvos. Primeira leitura feita: ${b.result?.read ?? 0} cobranças dos últimos 30 dias.` : 'Nenhum grupo marcado: nada será lido.'));
  const disconnect = () => { if (window.confirm('Desligar a LootRush? A chave e as cobranças guardadas aqui são apagadas. Nada muda na LootRush.')) run('desligar', {}, () => 'LootRush desligada.').then(() => setAvailable(null)); };

  if (!state) return <div className={`${card} border rounded-xl p-5 text-sm ${muted}`}><Loader2 size={14} className="inline animate-spin mr-2" />Carregando…</div>;
  const savedIds = (state.groups || []).map((g: any) => g.id).sort().join(','), dirty = [...picked].sort().join(',') !== savedIds;

  return (
    <div className={`${card} border rounded-xl p-5 space-y-4`}>
      <div>
        <div className={`text-base font-bold flex items-center gap-2 ${head}`}><CreditCard size={17} /> LootRush</div>
        <div className={`text-[13px] mt-1 ${muted}`}>
          Acompanha as cobranças dos seus cartões: avisa no Telegram cada cobrança, cobrança recusada e código de verificação do Google, e confere em Metas o cobrado com o gasto de cada conta do Google.
        </div>
      </div>

      {state.migration && <div className="text-xs text-amber-500">{state.error}</div>}

      {!state.migration && (!state.connected || changing) && (
        <div className="space-y-2">
          <ol className={`text-xs ${muted} list-decimal pl-5 space-y-1`}>
            <li>Na LootRush, abra Configurações → API Key e crie uma chave.</li>
            <li>Marque só <b className={head}>MCP → Read</b>. Deixe desmarcados Write, Withdraw e &quot;MCP card reveal&quot;: o Autometrics não precisa do número do cartão.</li>
            <li>Deixe a lista de IPs em branco e cole a chave aqui.</li>
          </ol>
          <div className="flex gap-2">
            <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="Chave da LootRush" aria-label="Chave da LootRush" className={input} />
            <button onClick={connect} disabled={!!busy || key.trim().length < 20} className={solid}>{spin('ligar')} {changing ? 'Trocar chave' : 'Ligar'}</button>
            {changing && <button onClick={() => { setChanging(false); setKey(''); }} className={ghost}>Cancelar</button>}
          </div>
          <div className={`text-[11px] ${muted}`}>A chave fica guardada criptografada no servidor e não aparece mais em tela nenhuma.</div>
        </div>
      )}

      {state.connected && !changing && (
        <>
          <div className={`text-[13px] ${head}`}>
            Ligada. Última leitura: <b>{when(state.last_sync_at)}</b>
            {state.status === 'erro' && state.last_error && <div className="text-xs text-rose-500 mt-1">{state.last_error}</div>}
          </div>
          <div>
            <div className={`text-xs font-bold mb-1 ${head}`}>Grupos de cartões para acompanhar</div>
            {!available ? <div className={`text-xs ${muted}`}><Loader2 size={12} className="inline animate-spin mr-1" /> lendo os grupos na LootRush…</div>
              : !available.length ? <div className="text-xs text-amber-500">Esta chave não enxerga nenhum grupo de cartões. Crie o grupo na LootRush e volte aqui.</div>
                : available.map(g => (
                  <label key={g.id} className={`flex items-center gap-2 py-1.5 text-[13px] cursor-pointer ${head}`}>
                    <input type="checkbox" checked={picked.includes(g.id)} onChange={e => setPicked(p => (e.target.checked ? [...p, g.id] : p.filter(id => id !== g.id)))} />
                    <span>{g.name}</span>
                    <span className={`text-xs ${muted}`}>· {g.cards} {g.cards === 1 ? 'cartão' : 'cartões'}{g.spend30 !== null ? ` · ${money(g.spend30)} em 30 dias` : ''}</span>
                  </label>
                ))}
            <div className={`text-[11px] mt-1 ${muted}`}>Cartão novo que entrar num grupo marcado passa a ser acompanhado sozinho. A leitura acontece a cada 5 minutos.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={saveGroups} disabled={!!busy || !available || !dirty} className={solid}>{spin('grupos')} Salvar grupos</button>
            <button onClick={() => run('ler', {}, b => `Leitura feita: ${b.result?.fresh ?? 0} cobranças novas.`)} disabled={!!busy || !state.groups?.length} className={ghost}>{spin('ler')} Ler agora</button>
            <button onClick={() => setChanging(true)} disabled={!!busy} className={ghost}>Trocar chave</button>
            <button onClick={disconnect} disabled={!!busy} className={ghost}>{spin('desligar')} Desligar</button>
          </div>
          <div className={`text-[11px] ${muted}`}>Os avisos destes cartões são ligados e desligados na aba Telegram, em Alertas. A conferência fica em Metas.</div>
        </>
      )}
      {message && <div className={`text-xs ${message.ok ? 'text-emerald-500' : 'text-rose-500'}`}>{message.text}</div>}
    </div>
  );
}
