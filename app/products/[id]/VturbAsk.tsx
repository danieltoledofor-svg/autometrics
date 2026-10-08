"use client";

import React, { useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Ui } from '@/app/components/metrics/ColumnPicker';

/**
 * "Pergunte à IA" da aba VTurb. A IA recebe o que a aba mostra desta campanha
 * no período da tela (clique à venda, aparelho, grupo, palavra-chave, retenção,
 * trecho da VSL, leitura da página e alterações) e responde em português simples.
 * Cada pergunta é uma consulta paga à IA; a conversa fica só nesta tela.
 */

const IDEAS = [
  'O que eu posso melhorar nesta campanha, do mais importante para o menos?',
  'Onde estou perdendo mais gente entre o clique e a venda?',
  'Qual palavra-chave traz gente que assiste e qual só gasta?',
  'O que o vídeo diz no ponto em que mais gente sai?',
  'Depois das últimas alterações, o que mudou nos números?',
];

const ddmm = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');

async function api(path: string, body: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify(body) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export function VturbAsk({ productId, startDate, endDate, period, ui }: { productId: string; startDate: string; endDate: string; period: [string, string] | null; ui: Ui }) {
  const { isDark, bgCard, borderCol, textHead, textMuted } = ui;
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string; missing: string; kept?: boolean }[]>([]);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState('');
  const soft = isDark ? 'bg-slate-950' : 'bg-slate-50';

  const ask = async (text?: string) => {
    const q = (text ?? question).trim();
    if (!q || answering) return;
    setAnswering(true);
    setError('');
    const { ok, body } = await api('/api/vturb', { product_id: productId, action: 'ask', question: q, start: startDate, end: endDate, history: chat.map(c => ({ q: c.q, a: c.a })) });
    if (!ok || !body.answer) setError(body.error || 'A IA não respondeu. Tente de novo.');
    else { setChat(c => [...c, { q, a: body.answer.text, missing: body.answer.missing || '' }]); setQuestion(''); }
    setAnswering(false);
  };
  // A resposta guardada vale só para esta campanha: a IA passa a ler nas próximas análises dela.
  const keep = async (i: number) => {
    const c = chat[i];
    const { ok, body } = await api('/api/memory', { kind: 'decisao', title: c.q.slice(0, 160), content: c.a, product_id: productId });
    if (!ok) setError(body.error || 'Não foi possível guardar.');
    else setChat(list => list.map((x, j) => (j === i ? { ...x, kept: true } : x)));
  };

  return (
    <div className={`${bgCard} border rounded-xl p-4 space-y-3`}>
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <div className={`text-sm font-bold ${textHead} inline-flex items-center gap-1.5`}><Sparkles size={14} className="text-indigo-400" /> Pergunte à IA sobre esta campanha</div>
        {period && <div className={`text-xs ${textMuted}`}>ela lê o período da tela: {ddmm(period[0])} a {ddmm(period[1])}, e os últimos 3 e 7 dias</div>}
      </div>
      {chat.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {IDEAS.map(idea => (
            <button key={idea} onClick={() => ask(idea)} disabled={answering}
              className={`text-xs text-left px-2.5 py-1.5 rounded-lg border ${borderCol} ${textMuted} hover:text-indigo-400 hover:border-indigo-500/50 disabled:opacity-50`}>{idea}</button>
          ))}
        </div>
      )}
      {chat.map((c, i) => (
        <div key={i} className="space-y-1.5">
          <div className={`text-[13px] font-bold ${textHead}`}>{c.q}</div>
          <div className={`rounded-lg border ${borderCol} ${soft} p-3 text-[13px] leading-relaxed whitespace-pre-wrap ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{c.a}</div>
          {c.missing && <div className={`text-[11px] ${textMuted}`}>Faltou para responder melhor: {c.missing}</div>}
          {c.kept
            ? <div className="text-[11px] text-emerald-500">Guardado na memória da IA, para esta campanha.</div>
            : <button onClick={() => keep(i)} className="text-[11px] text-indigo-400 hover:underline">Guardar esta resposta na memória da IA</button>}
        </div>
      ))}
      {answering && <div className={`flex items-center gap-2 text-xs ${textMuted}`}><Loader2 size={13} className="animate-spin" /> A IA está lendo os números…</div>}
      {error && <div className="text-xs text-rose-500">{error}</div>}
      <div className="flex gap-2 items-end">
        <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} maxLength={1000} aria-label="Pergunta para a IA"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder="O celular vale o que custa nesta campanha?"
          className={`flex-1 rounded-lg border ${borderCol} ${soft} ${textHead} px-3 py-2 text-[13px] outline-none focus:border-indigo-500 resize-y`} />
        <button onClick={() => ask()} disabled={answering || !question.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5">
          {answering ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Perguntar
        </button>
      </div>
      <div className={`text-[11px] ${textMuted}`}>
        A IA recebe o que esta aba mostra: o caminho do clique à venda, aparelho, grupo de anúncios, palavra-chave, a retenção do vídeo com o trecho da VSL onde mais gente sai, a leitura da página e as alterações do período. Ela não altera nada na campanha. Cada pergunta é uma consulta à IA e entra no consumo.
      </div>
    </div>
  );
}
