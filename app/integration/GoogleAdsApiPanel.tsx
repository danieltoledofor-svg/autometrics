"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plug, RefreshCw, Trash2, CheckCircle2, AlertCircle, Loader2, ShieldCheck, Folder, Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

interface Connection {
  id: string;
  google_email: string;
  status: string;
  last_error: string | null;
  last_discovery_at: string | null;
}

interface Account {
  id: string;
  connection_id: string;
  customer_id: string;
  name: string;
  mcc_name: string | null;
  currency_code: string | null;
  status: string | null;
  sync_enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_sync_summary: any;
}

async function api(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

const fmtCustomer = (id: string) => id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');

function timeAgo(ts: string | null) {
  if (!ts) return 'nunca';
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

/**
 * Conexão direta com a Google Ads API: conectar a conta Google, ver as contas
 * encontradas e sincronizar.
 */
export function GoogleAdsApiPanel({ isDark }: { isDark: boolean }) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [syncAll, setSyncAll] = useState<{ done: number; total: number } | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);

  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const muted = 'text-slate-500';
  const rowBorder = isDark ? 'border-slate-800' : 'border-slate-100';
  const btnGhost = `px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50 ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`;

  const load = useCallback(async () => {
    const { ok, body } = await api('/api/google-ads/connections');
    if (!ok) {
      setSetupError(body.error || 'Falha ao carregar');
    } else {
      setSetupError(null);
      setConfigured(body.configured);
      setConnections(body.connections);
      setAccounts(body.accounts);
      setQuota(body.quota || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Volta do Google: mostra o resultado e limpa a URL.
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('gads_connected');
    const error = params.get('gads_error');
    if (connected) setNotice({ kind: 'ok', text: `Conta ${connected} conectada — ${params.get('gads_accounts') || 0} conta(s) de anúncio encontradas.` });
    if (error) setNotice({ kind: 'error', text: error });
    if (connected || error) window.history.replaceState(null, '', '/integration');
  }, [load]);

  const connect = async () => {
    setBusy('connect');
    const { ok, body } = await api('/api/google-ads/oauth/start', { method: 'POST' });
    if (ok && body.url) {
      window.location.href = body.url;
      return;
    }
    setNotice({ kind: 'error', text: body.error || 'Não foi possível iniciar a conexão.' });
    setBusy(null);
  };

  const refreshAccounts = async (id: string) => {
    setBusy(`refresh-${id}`);
    const { ok, body } = await api('/api/google-ads/connections', { method: 'POST', body: JSON.stringify({ id }) });
    setNotice(ok
      ? { kind: 'ok', text: `${body.accounts} conta(s) encontradas.${body.errors?.length ? ' Avisos: ' + body.errors.join(' | ') : ''}` }
      : { kind: 'error', text: body.error });
    await load();
    setBusy(null);
  };

  const disconnect = async (c: Connection) => {
    if (!confirm(`Desconectar ${c.google_email}? A coleta pela API para; os dados já coletados continuam no painel.`)) return;
    setBusy(`del-${c.id}`);
    const { ok, body } = await api(`/api/google-ads/connections?id=${c.id}`, { method: 'DELETE' });
    if (!ok) setNotice({ kind: 'error', text: body.error });
    await load();
    setBusy(null);
  };

  const toggleSync = async (a: Account) => {
    setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, sync_enabled: !a.sync_enabled } : x));
    const { ok, body } = await api('/api/google-ads/accounts', { method: 'PATCH', body: JSON.stringify({ id: a.id, sync_enabled: !a.sync_enabled }) });
    if (!ok) {
      setNotice({ kind: 'error', text: body.error });
      await load();
    }
  };

  const syncOne = async (a: Account) => {
    const { ok, body } = await api('/api/google-ads/sync', { method: 'POST', body: JSON.stringify({ account_id: a.id }) });
    return { ok, body };
  };

  const syncAccount = async (a: Account) => {
    setBusy(`sync-${a.id}`);
    const { ok, body } = await syncOne(a);
    setNotice(ok
      ? { kind: 'ok', text: `${a.name}: ${body.days_written} dia(s) gravados, ${body.days_unchanged} sem mudança${body.errors?.length ? ` — ${body.errors.length} aviso(s)` : ''}.` }
      : { kind: 'error', text: `${a.name}: ${body.error}` });
    await load();
    setBusy(null);
  };

  // Uma conta por requisição: nenhuma chamada estoura o tempo limite do servidor.
  const syncEverything = async () => {
    const list = accounts.filter(a => a.sync_enabled && (a.status || 'ENABLED') === 'ENABLED');
    setSyncAll({ done: 0, total: list.length });
    let fails = 0;
    for (let i = 0; i < list.length; i++) {
      const { ok } = await syncOne(list[i]);
      if (!ok) fails++;
      setSyncAll({ done: i + 1, total: list.length });
    }
    setSyncAll(null);
    setNotice(fails
      ? { kind: 'error', text: `${list.length - fails} conta(s) sincronizadas, ${fails} com erro — veja cada conta abaixo.` }
      : { kind: 'ok', text: `${list.length} conta(s) sincronizadas.` });
    await load();
  };

  const groups = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const a of accounts) {
      const g = a.mcc_name || 'Contas diretas';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(a);
    }
    return [...map.entries()];
  }, [accounts]);

  if (loading) {
    return <div className={`${card} rounded-xl p-6 border flex items-center gap-2 text-sm ${muted}`}><Loader2 size={16} className="animate-spin" /> Carregando conexão com o Google Ads…</div>;
  }

  return (
    <div className={`${card} rounded-xl border overflow-hidden`}>
      <div className={`p-6 border-b ${rowBorder} flex flex-col md:flex-row md:items-center justify-between gap-4`}>
        <div>
          <h3 className={`font-bold flex items-center gap-2 ${textHead}`}>
            <Plug size={18} className="text-indigo-500" /> Google Ads API
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">Recomendado</span>
          </h3>
          <p className={`text-sm mt-1 ${muted}`}>
            Conexão direta: custo relido a cada 15 min (com revisões do Google), pausar/ativar campanhas pelo painel e sem script para colar.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {accounts.length > 0 && (
            <button onClick={syncEverything} disabled={!!syncAll || !!busy} className={btnGhost + ' flex items-center gap-1.5'}>
              <RefreshCw size={14} className={syncAll ? 'animate-spin' : ''} />
              {syncAll ? `${syncAll.done}/${syncAll.total}` : 'Sincronizar tudo'}
            </button>
          )}
          <button onClick={connect} disabled={!configured || !!setupError || busy === 'connect'}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-2 disabled:opacity-50">
            {busy === 'connect' ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
            {connections.length ? 'Conectar outra conta Google' : 'Conectar Google Ads'}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`mx-6 mt-4 p-3 rounded-lg text-sm flex items-start gap-2 ${notice.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
          {notice.kind === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1 break-words">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs opacity-70 hover:opacity-100">fechar</button>
        </div>
      )}

      {(setupError || !configured) && (
        <div className="mx-6 mt-4 p-3 rounded-lg text-sm bg-amber-500/10 text-amber-500 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{setupError || 'Faltam as credenciais do Google no servidor (GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET e GOOGLE_ADS_TOKEN_KEY).'}</span>
        </div>
      )}

      <div className="p-6 space-y-6">
        {quota && connections.length > 0 && (
          <p className={`text-xs ${quota.used >= quota.limit * 0.8 ? 'text-amber-500' : muted}`}>
            Consultas à API hoje: {quota.used.toLocaleString('pt-BR')} de {quota.limit.toLocaleString('pt-BR')}
            {quota.used >= quota.limit * 0.8 && ' — perto do limite: a coleta automática desacelera até a virada do dia.'}
          </p>
        )}

        {connections.length === 0 && !setupError && (
          <p className={`text-sm ${muted}`}>Nenhuma conta Google conectada. Use o login que tem acesso às suas MCCs — todas as subcontas entram de uma vez.</p>
        )}

        {connections.map(c => (
          <div key={c.id} className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${rowBorder}`}>
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck size={16} className={c.status === 'ok' ? 'text-emerald-500' : 'text-rose-500'} />
              <span className={`text-sm font-bold truncate ${textHead}`}>{c.google_email}</span>
              {c.status !== 'ok' && <span className="text-xs text-rose-500 font-bold">autorização expirada — reconecte</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => refreshAccounts(c.id)} disabled={!!busy} className={btnGhost}>
                {busy === `refresh-${c.id}` ? 'Buscando…' : 'Atualizar contas'}
              </button>
              <button onClick={() => disconnect(c)} disabled={!!busy} className={`${btnGhost} hover:!text-rose-500`} title="Desconectar">
                <Trash2 size={14} />
              </button>
            </div>
            {c.last_error && <p className="w-full text-xs text-amber-500 break-words">{c.last_error}</p>}
          </div>
        ))}

        {groups.map(([group, list]) => (
          <div key={group}>
            <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2 ${muted}`}>
              <Folder size={14} /> {group} <span className="bg-slate-500/10 px-2 py-0.5 rounded-full">{list.length}</span>
            </h4>
            <div className={`rounded-lg border divide-y ${rowBorder} ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
              {list.map(a => {
                const closed = a.status && a.status !== 'ENABLED';
                const s = a.last_sync_summary;
                const statusColor = a.last_sync_status === 'ok' ? 'text-emerald-500' : a.last_sync_status === 'parcial' ? 'text-amber-500' : a.last_sync_status === 'erro' ? 'text-rose-500' : muted;
                return (
                  <div key={a.id} className="p-3 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer" title={a.sync_enabled ? 'Coleta ligada' : 'Coleta desligada'}>
                      <input type="checkbox" checked={a.sync_enabled} onChange={() => toggleSync(a)} className="accent-indigo-600 w-4 h-4" />
                    </label>
                    <div className="flex-1 min-w-[180px]">
                      <p className={`text-sm font-bold ${textHead} ${closed ? 'opacity-60' : ''}`}>
                        {a.name}
                        {closed && <span className="ml-2 text-[10px] font-bold uppercase text-rose-500">{a.status}</span>}
                      </p>
                      <p className={`text-[11px] font-mono ${muted}`}>{fmtCustomer(a.customer_id)} · {a.currency_code || '—'}</p>
                    </div>
                    <div className={`text-xs text-right ${muted}`}>
                      <p className={`flex items-center justify-end gap-1 ${statusColor}`}>
                        <Clock size={12} /> {timeAgo(a.last_sync_at)}{a.last_sync_status ? ` · ${a.last_sync_status}` : ''}
                      </p>
                      {s && typeof s.cost_today === 'number' && (
                        <p>{s.enabled_campaigns} ativa(s) · hoje {a.currency_code} {s.cost_today.toFixed(2)}</p>
                      )}
                    </div>
                    <button onClick={() => syncAccount(a)} disabled={!!busy || !!syncAll || !!closed} className={btnGhost} title="Sincronizar agora">
                      <RefreshCw size={14} className={busy === `sync-${a.id}` ? 'animate-spin' : ''} />
                    </button>
                    {a.last_sync_error && (
                      <p className={`w-full text-[11px] break-words ${a.last_sync_status === 'erro' ? 'text-rose-500' : 'text-amber-500'}`}>{a.last_sync_error}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
