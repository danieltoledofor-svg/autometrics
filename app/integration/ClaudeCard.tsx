"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Aba Claude da Integração: o link do MCP do Autometrics.
 *
 * O usuário gera um link e cola no Claude (claude.ai → Configurações →
 * Conectores → Adicionar conector personalizado). Depois, no app do Claude no
 * celular, pergunta sobre as campanhas. Só leitura. O link é a senha: aparece
 * uma vez e pode ser revogado aqui. Rota: /api/mcp-tokens.
 */

async function api(body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/mcp-tokens', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca');

const EXAMPLES = [
  'Como foram minhas campanhas ontem? Quais deram lucro?',
  'Quais palavras-chave venderam na campanha ALKAMELT nos últimos 7 dias?',
  'Lista as vendas de hoje com o país e a palavra-chave.',
  'O que se repete entre as campanhas [WL] nesta semana?',
];

export function ClaudeCard({ isDark: _isDark }: { isDark: boolean }) {
  const [state, setState] = useState<{ ready: boolean; tokens: any[]; error?: string } | null>(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const card = 'bg-surface-1 border-line';
  const head = 'text-ink', muted = 'text-ink-subtle';
  const solid = 'bg-brand hover:bg-brand-hover text-white px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-2';
  const ghost = 'px-3 py-1.5 rounded-lg border border-line bg-surface-1 text-ink-muted hover:text-ink hover:bg-surface-2 text-xs font-medium disabled:opacity-40 inline-flex items-center gap-2';
  const input = 'flex-1 min-w-0 rounded-lg border px-3 py-2 text-[13px] bg-surface-2 border-line text-ink outline-none focus:border-brand';

  const load = useCallback(async () => { const { body } = await api(); setState({ ready: !!body.ready, tokens: body.tokens || [], error: body.error }); }, []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy('new'); setMessage(null); setFresh(null); setCopied(false);
    const { ok, body } = await api({ label: label || 'Celular' });
    setBusy('');
    if (!ok) { setMessage({ ok: false, text: body.error || 'Não foi possível gerar o link.' }); return; }
    setFresh(body.url); setLabel('');
    load();
  };
  const revoke = async (id: string, name: string) => {
    if (!window.confirm(`Revogar o link "${name}"? O Claude que usa este link perde o acesso na hora.`)) return;
    setBusy(id); setMessage(null);
    const { ok, body } = await api({ revoke: id });
    setBusy('');
    setMessage(ok ? { ok: true, text: 'Link revogado.' } : { ok: false, text: body.error || 'Não foi possível revogar.' });
    load();
  };
  const copy = async () => {
    if (!fresh) return;
    try { await navigator.clipboard.writeText(fresh); setCopied(true); } catch { /* sem área de transferência */ }
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-5 ${card}`}>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} aria-hidden="true" className="text-brand-text" />
          <h2 className={`text-[15px] font-semibold ${head}`}>Claude no celular</h2>
        </div>
        <p className={`text-[13px] ${muted} mb-4`}>
          Gere um link e ligue o Autometrics ao Claude. Depois, no app do Claude no celular ou no claude.ai, pergunte sobre as campanhas: resultado do dia, vendas, palavras-chave, países, análise. O Claude só lê os dados; ele não muda nada nas campanhas.
        </p>

        {state && !state.ready ? (
          <p className="text-[13px] text-warn">{state.error || 'Rode migration_mcp.sql no Supabase.'}</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Nome do link (ex.: Celular)" maxLength={60} className={input} />
            <button onClick={generate} disabled={busy === 'new' || !state} className={solid}>
              {busy === 'new' && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}Gerar link
            </button>
          </div>
        )}

        {fresh && (
          <div className="mt-4 rounded-lg border border-brand/40 bg-brand/5 p-3 space-y-2">
            <p className={`text-[12px] font-medium ${head}`}>Copie agora: o link só aparece esta vez.</p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 min-w-0 truncate text-[12px] font-mono text-ink bg-surface-2 rounded px-2 py-1.5" title={fresh}>{fresh}</code>
              <button onClick={copy} className={ghost}>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? 'Copiado' : 'Copiar'}</button>
            </div>
            <p className={`text-[12px] ${muted}`}>Quem tiver este link vê os números das suas campanhas. Não mande para ninguém; se vazar, revogue abaixo.</p>
          </div>
        )}
        {message && <p className={`mt-3 text-[13px] ${message.ok ? 'text-pos' : 'text-neg'}`}>{message.text}</p>}
      </div>

      <div className={`rounded-xl border p-5 ${card}`}>
        <h3 className={`text-[14px] font-semibold ${head} mb-2`}>Como ligar (uma vez só)</h3>
        <ol className={`text-[13px] ${muted} list-decimal pl-5 space-y-1`}>
          <li>No computador, abra <span className={head}>claude.ai</span> → Configurações → Conectores.</li>
          <li>Clique em <span className={head}>Adicionar conector personalizado</span>, dê o nome <span className={head}>Autometrics</span> e cole o link.</li>
          <li>Pronto: o conector aparece também no app do Claude no celular, na mesma conta. Ative-o na conversa pelo botão de ferramentas.</li>
        </ol>
        <h3 className={`text-[14px] font-semibold ${head} mt-4 mb-2`}>Perguntas de exemplo</h3>
        <ul className={`text-[13px] ${muted} space-y-1`}>
          {EXAMPLES.map(e => <li key={e}>“{e}”</li>)}
        </ul>
      </div>

      {state?.ready && (
        <div className={`rounded-xl border p-5 ${card}`}>
          <h3 className={`text-[14px] font-semibold ${head} mb-3`}>Links ativos</h3>
          {!state.tokens.length ? (
            <p className={`text-[13px] ${muted}`}>Nenhum link ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {state.tokens.map(t => (
                <li key={t.id} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-medium ${head} truncate`}>{t.label || 'Sem nome'}</div>
                    <div className={`text-[12px] ${muted}`}>Criado em {when(t.created_at)} · último uso: {when(t.last_used_at)}</div>
                  </div>
                  <button onClick={() => revoke(t.id, t.label || 'Sem nome')} disabled={busy === t.id} className={`${ghost} text-neg`}>
                    {busy === t.id && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}Revogar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
