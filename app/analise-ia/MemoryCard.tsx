"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileUp, Loader2, Save, Trash2 } from 'lucide-react';

/**
 * Memória da IA: decisões, observações e materiais (.md / .txt) que o usuário
 * guarda para a IA levar em conta nas leituras e nas respostas. Rota: /api/memory.
 */

const KINDS = [
  { key: 'decisao', label: 'Decisão' },
  { key: 'observacao', label: 'Observação' },
  { key: 'material', label: 'Material (aula, guia)' },
];
const KIND_LABEL: Record<string, string> = { decisao: 'Decisão', observacao: 'Observação', material: 'Material' };

interface Styles { card: string; head: string; muted: string; line: string; soft: string; title: string }
type Api = (path: string, init?: RequestInit) => Promise<{ ok: boolean; body: any }>;

export function MemoryCard({ api, tags, css, reloadKey }: { api: Api; tags: { tag: string }[]; css: Styles; reloadKey: number }) {
  const { card, head, muted, line, soft, title } = css;
  const [state, setState] = useState<{ ready: boolean; items: any[]; error?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('decisao');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [scope, setScope] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { body } = await api('/api/memory');
    setState({ ready: !!body.ready, items: body.items || [], error: body.error });
  }, [api]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const pickFile = async (f?: File | null) => {
    if (!f) return;
    if (f.size > 2_000_000) { setMessage('Arquivo grande demais (máximo de 2 MB).'); return; }
    setText(await f.text());
    setName(n => n || f.name.replace(/\.(md|txt|markdown)$/i, ''));
    setKind('material');
    setMessage('');
  };

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setMessage('');
    const { ok, body } = await api('/api/memory', { method: 'POST', body: JSON.stringify({ kind, title: name, content: text, scope }) });
    if (!ok) setMessage(body.error || 'Não foi possível guardar.');
    else {
      setMessage(body.summarized ? `Guardado. O texto era longo: a IA vai usar um resumo dele${body.cut ? ' (só o começo coube no resumo)' : ''}.` : 'Guardado.');
      setName(''); setText(''); setScope('');
      await load();
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    await api(`/api/memory?id=${id}`, { method: 'DELETE' });
    await load();
  };

  const field = `rounded-lg border ${line} ${soft} ${head} px-2.5 py-1.5 text-[13px] outline-none focus:border-indigo-500`;

  return (
    <div className={`${card} border rounded-xl p-4 space-y-3`}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full text-left">
        {open ? <ChevronDown size={14} className={muted} /> : <ChevronRight size={14} className={muted} />}
        <span className={title}>Memória da IA</span>
        <span className={`text-xs ${muted}`}>{state?.ready ? `${state.items.length} ${state.items.length === 1 ? 'item guardado' : 'itens guardados'}` : ''}</span>
      </button>

      {open && state && !state.ready && <div className="text-sm text-amber-500">{state.error || 'A memória ainda não está disponível.'}</div>}

      {open && state?.ready && (<>
        <div className={`text-xs ${muted}`}>
          Guarde aqui decisões que você tomou, regras suas e materiais de estudo. A IA lê isto antes de escrever a leitura de cada campanha, a leitura do grupo e as respostas às suas perguntas. Só você vê.
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={e => setKind(e.target.value)} className={`${field} font-bold`}>
            {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Título" maxLength={160} className={`${field} flex-1 min-w-[180px]`} />
          <select value={scope} onChange={e => setScope(e.target.value)} className={field} title="Para quais campanhas esta anotação vale">
            <option value="">Vale para todas as campanhas</option>
            {tags.map(t => <option key={t.tag} value={t.tag}>Só campanhas {t.tag}</option>)}
          </select>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
          placeholder="Ex.: Em campanha [WL], só subo o orçamento depois de 3 dias seguidos com CPA abaixo de US$ 120."
          className={`${field} w-full resize-y`} />
        <div className="flex flex-wrap items-center gap-2">
          <input ref={file} type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" className="hidden"
            onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button onClick={() => file.current?.click()} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${line} text-xs font-bold ${muted} hover:text-indigo-400`}>
            <FileUp size={13} /> Enviar arquivo .md ou .txt
          </button>
          {text && <span className={`text-[11px] ${muted}`}>{text.length.toLocaleString('pt-BR')} caracteres</span>}
          <div className="flex-1" />
          <button onClick={save} disabled={saving || !text.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar na memória
          </button>
        </div>
        {message && <div className={`text-xs ${/Guardado/.test(message) ? 'text-emerald-500' : 'text-rose-500'}`}>{message}</div>}

        {state.items.length > 0 && (
          <div>
            {state.items.map(m => (
              <div key={m.id} className={`py-2 border-t ${line}`}>
                <div className="flex items-start gap-2">
                  <button onClick={() => setExpanded(x => (x === m.id ? null : m.id))} className="flex-1 min-w-0 text-left">
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${soft} ${muted} mr-2`}>{KIND_LABEL[m.kind] || 'Observação'}</span>
                    <span className={`text-[13px] font-medium ${head}`}>{m.title}</span>
                    <span className={`text-[11px] ${muted}`}> · {String(m.created_at).slice(0, 10).split('-').reverse().join('/')}{m.scope ? ` · só ${m.scope}` : ''}{m.summarized ? ` · resumo de ${m.chars.toLocaleString('pt-BR')} caracteres` : ''}</span>
                  </button>
                  <button onClick={() => remove(m.id)} title="Apagar" className={`${muted} hover:text-rose-500 shrink-0`}><Trash2 size={13} /></button>
                </div>
                {expanded === m.id && <div className={`mt-2 rounded-lg border ${line} ${soft} p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap`}>{m.summary}</div>}
              </div>
            ))}
          </div>
        )}
      </>)}
    </div>
  );
}
