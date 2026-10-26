"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pencil, Plus, RotateCcw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Template } from '@/lib/campaignBuilder/template';
import type { CreateResult, Problem } from '@/lib/campaignBuilder/create';
import { applyFix, editProblem, editable, exemptible, fixNote, present, removeProblem, type Fix, type Ref } from '@/lib/campaignBuilder/fixes';
import { droppedAdjustments, duplicateProblems, duplicateSettings, lineSettings, needsGoal, usesTargetSpend, valueProblems, type DuplicateSettings } from '@/lib/campaignBuilder/duplicate';
import { Block, NumberField, type Css } from './StepCampaign';
import { AccountPicker, HIDDEN, REMEMBER, dashed, running, type Account } from './StepWhere';

/**
 * Duplicar campanha: ao lado do criador, mas separado dele. Escolhe uma
 * campanha que já está rodando, lê tudo dela do Google e copia para a mesma
 * conta, para outras contas ou para contas de outras MCCs. Na cópia o usuário
 * só muda orçamento e CPA; os ajustes de lance da original não passam
 * (lib/campaignBuilder/duplicate). Antes de criar, o Google ensaia cada cópia.
 * Com uma cópia, orçamento e CPA ficam num bloco só; com duas ou mais, cada
 * linha da lista de contas tem o seu, começando pelos valores da original.
 * O que o Google recusar no ensaio ou na criação se corrige ali mesmo: tirar,
 * trocar o texto ou pedir exceção, e ensaiar de novo (lib/campaignBuilder/fixes).
 */

type Api = (path: string, body?: Record<string, any>) => Promise<{ ok: boolean; body: any }>;
type Goals = { list?: { id: string; nome: string }[]; error?: string; loading?: boolean };
type State = { fase: 'ensaiando' | 'criando' } | { fase: 'aceita' | 'recusada' | 'criada' | 'falhou'; result: CreateResult };
interface Target {
  id: string; nome: string; mcc: string; moeda: string | null; campanha: string; meta_id: string | null; meta_nome: string | null;
  /** Orçamento e CPA (ou limite de CPC) desta cópia, quando há duas ou mais. Ausente = os do bloco geral. */
  orcamento?: number | null; cpa?: number | null;
}
const CREATED = 'autometrics_duplicar_criadas';
const symbolOf = (c?: string | null) => (c === 'BRL' ? 'R$' : c === 'EUR' ? '€' : c === 'USD' || !c ? 'US$' : c);

export function Duplicate({ campaigns, css, api }: { campaigns: { id: string; name: string; account: string; mcc: string }[]; css: Css; api: Api }) {
  const { card, head, muted, line, soft, label } = css;
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [t, setT] = useState<Template | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [s, setS] = useState<DuplicateSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Target[]>([]);
  const [goals, setGoals] = useState<Record<string, Goals>>({});
  const asked = useRef(new Set<string>());
  const [states, setStates] = useState<Record<string, State>>({});
  const [created, setCreated] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'ensaio' | 'criar'>('');
  const [agreed, setAgreed] = useState(false);
  const [stale, setStale] = useState(false);
  /** Campos com texto que não é número: 'geral|orcamento', '<conta>|cpa'… */
  const [notNumber, setBad] = useState<Set<string>>(new Set());
  /** Correções feitas na cópia por causa das recusas do Google, em português, na ordem. */
  const [fixes, setFixes] = useState<string[]>([]);
  const markBad = (k: string, on: boolean) => setBad(b => { if (b.has(k) === on) return b; const next = new Set(b); if (on) next.add(k); else next.delete(k); return next; });

  useEffect(() => {
    try { setHidden(new Set(JSON.parse(localStorage.getItem(HIDDEN) || '[]'))); } catch { /* sem lembrança */ }
    try { setCreated(JSON.parse(localStorage.getItem(CREATED) || '{}')); } catch { /* sem lembrança */ }
  }, []);
  useEffect(() => { if (t && !accounts) api('/api/campaign-builder?contas=1').then(({ body }) => setAccounts(body.accounts || [])); }, [t, accounts, api]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (f ? campaigns.filter(c => `${c.name} ${c.account} ${c.mcc}`.toLowerCase().includes(f)) : campaigns).slice(0, 40);
  }, [campaigns, filter]);

  const read = async () => {
    setReading(true); setError(''); setT(null); setS(null); setTargets([]); setStates({}); setStale(false); setFixes([]);
    const { ok, body } = await api(`/api/campaign-builder?product_id=${picked}`);
    if (!ok || !body.template) setError(body.error || 'Não foi possível ler a campanha.');
    else { setT(body.template); setCurrency(body.currency || 'USD'); setS(duplicateSettings(body.template)); }
    setReading(false);
  };

  // Metas de cada conta escolhida, uma consulta por conta, uma de cada vez.
  useEffect(() => {
    const next = targets.find(x => !asked.current.has(x.id));
    if (!next || !t) return;
    asked.current.add(next.id);
    setGoals(g => ({ ...g, [next.id]: { loading: true } }));
    api(`/api/campaign-builder?metas=${next.id}`).then(({ ok, body }) => {
      const list: { id: string; nome: string }[] = ok ? body.goals || [] : [];
      setGoals(g => ({ ...g, [next.id]: ok ? { list } : { error: body.error || 'O Google não respondeu.' } }));
      // Na mesma conta, a meta da original; em outra, a meta com o mesmo nome; senão a usada da última vez nesta conta.
      const original = t.campanha.meta_conversao;
      let remembered: string | null = null;
      try { remembered = JSON.parse(localStorage.getItem(REMEMBER) || '{}')[next.id] || null; } catch { /* sem lembrança */ }
      const hit = (needsGoal(t) && next.id === t.origem.conta_id ? list.find(x => x.id === original?.id) : null)
        || (needsGoal(t) && original?.nome ? list.find(x => x.nome.trim().toLowerCase() === original.nome!.trim().toLowerCase()) : null)
        || (needsGoal(t) ? list.find(x => x.id === remembered) || (list.length === 1 ? list[0] : null) : null);
      if (hit) setTargets(ts => ts.map(x => (x.id === next.id && !x.meta_id ? { ...x, meta_id: hit.id, meta_nome: hit.nome } : x)));
    });
  }, [targets, t, api]);

  // Voltou a uma cópia só: os valores dela passam para o bloco geral, que volta a aparecer.
  const multi = targets.length > 1;
  useEffect(() => {
    setBad(b => new Set([...b].filter(k => k.startsWith('grupo|'))));
    if (multi || targets.length !== 1) return;
    const [x] = targets;
    if (x.orcamento === undefined && x.cpa === undefined) return;
    const spend = !!t && usesTargetSpend(t);
    setS(v => v && { ...v, ...(x.orcamento !== undefined ? { orcamento_diario: x.orcamento } : {}), ...(x.cpa !== undefined ? (spend ? { limite_cpc: x.cpa } : { meta_cpa: x.cpa }) : {}) });
    setTargets(ts => ts.map(y => ({ ...y, orcamento: undefined, cpa: undefined })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi]);

  const byId = useMemo(() => new Map((accounts || []).map(a => [a.id, a])), [accounts]);
  const toggle = (list: Account[], on: boolean) => setTargets(ts => {
    const ids = new Set(list.map(a => a.id));
    if (!on) return ts.filter(x => !ids.has(x.id));
    const add = list.filter(a => !ts.some(x => x.id === a.id)).map(a => ({
      id: a.id, nome: a.nome, mcc: a.mcc, moeda: a.moeda || null, meta_id: null, meta_nome: null,
      campanha: t && a.id === t.origem.conta_id ? `${t.origem.nome} (cópia)` : t?.origem.nome || '',
    }));
    return [...ts, ...add];
  });
  const hide = (id: string, on: boolean) => setHidden(h => {
    const next = new Set(h);
    if (on) next.add(id); else next.delete(id);
    try { localStorage.setItem(HIDDEN, JSON.stringify([...next])); } catch { /* sem armazenamento */ }
    return next;
  });
  const setTarget = (id: string, patch: Partial<Target>) => setTargets(ts => ts.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const setGoal = (id: string, goalId: string) => {
    const goal = goals[id]?.list?.find(g => g.id === goalId) || null;
    setTarget(id, { meta_id: goal?.id || null, meta_nome: goal?.nome || null });
    try { const all = JSON.parse(localStorage.getItem(REMEMBER) || '{}'); if (goal) all[id] = goal.id; else delete all[id]; localStorage.setItem(REMEMBER, JSON.stringify(all)); } catch { /* sem armazenamento */ }
  };

  // Mudou orçamento, CPA ou as contas depois do ensaio: o ensaio deixa de valer.
  const signature = JSON.stringify({ s, targets, origem: t?.origem.campanha_id });
  useEffect(() => { setStates(x => { if (Object.keys(x).length) setStale(true); return {}; }); setAgreed(false); }, [signature]);

  if (!t || !s) {
    return (
      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        <div className={`text-sm font-semibold ${head}`}>Escolha a campanha que vai ser duplicada</div>
        <div className={`text-xs ${muted}`}>O Autometrics lê do Google a campanha inteira (grupos, palavras-chave, anúncios, negativas, locais, idiomas, sitelinks e frases de destaque) e copia para as contas que você escolher. Você muda o orçamento e o CPA; os ajustes de lance da original não vão para a cópia. Ler não altera nada na campanha.</div>
        <div className="relative">
          <Search size={14} aria-hidden="true" className={`absolute left-3 top-1/2 -translate-y-1/2 ${muted}`} />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Nome da campanha, da conta ou da MCC" aria-label="Procurar campanha para duplicar"
            className={`w-full rounded-lg border ${line} ${soft} ${head} pl-9 pr-3 py-2 text-[13px] outline-none focus:border-brand`} />
        </div>
        <div className={`max-h-64 overflow-y-auto rounded-lg border ${line} divide-y divide-line`}>
          {shown.map(c => (
            <button key={c.id} onClick={() => setPicked(c.id)} aria-pressed={picked === c.id} className={`w-full text-left px-3 py-2 text-[13px] ${picked === c.id ? 'bg-surface-3' : 'hover:bg-surface-2'}`}>
              <span className={head}>{c.name}</span>
              <span className={`block text-xs ${muted}`}>{[c.account, c.mcc].filter(Boolean).join(' · ') || 'conta sem nome'}</span>
            </button>
          ))}
          {!shown.length && <div className={`px-3 py-3 text-xs ${muted}`}>Nenhuma campanha ligada ao Google com esse nome.</div>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={!picked || reading} onClick={read} className="bg-brand hover:bg-brand-hover text-white px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-2">
            {reading && <Loader2 size={13} aria-hidden="true" className="animate-spin" />} Ler do Google
          </button>
          {campaigns.length > 40 && !filter && <span className={`text-xs ${muted}`}>Mostrando 40 de {campaigns.length}; use a busca.</span>}
        </div>
        <div aria-live="polite">{error && <div className="text-xs text-neg">{error}</div>}</div>
      </div>
    );
  }

  const symbol = symbolOf(currency);
  const spend = usesTargetSpend(t);
  const dropped = droppedAdjustments(t);
  const ads = t.grupos.flatMap(g => g.anuncios);
  const keywords = t.grupos.reduce((n, g) => n + g.palavras.length, 0);
  const negatives = t.negativas.length + t.grupos.reduce((n, g) => n + g.negativas.length, 0);
  const goalNeeded = needsGoal(t);
  const keyOf = (x: Target) => `${t.origem.campanha_id}|${x.id}|${x.campanha.trim().toLowerCase()}`;
  // Os valores de cada cópia: os da linha, quando há duas ou mais; senão os do bloco geral.
  const own = (x: Target) => {
    const budget = x.orcamento !== undefined ? x.orcamento : s.orcamento_diario;
    const cpa = x.cpa !== undefined ? x.cpa : spend ? s.limite_cpc : s.meta_cpa;
    return { orcamento_diario: budget, meta_cpa: spend ? null : cpa, limite_cpc: spend ? cpa : null };
  };
  const cpaName = spend ? 'o limite de CPC' : 'a meta de CPA';
  const problems: string[] = [];
  if (multi) {
    problems.push(...duplicateProblems(t, { ...s, orcamento_diario: 1, meta_cpa: null, limite_cpc: null }));
    for (const x of targets) {
      const where = `Cópia em ${x.nome}`;
      if (notNumber.has(`${x.id}|orcamento`)) problems.push(`${where}: o orçamento diário não é um número. Use só números, como 50 ou 49,90.`);
      if (notNumber.has(`${x.id}|cpa`)) problems.push(`${where}: ${cpaName} não é um número. Use só números, como 25 ou 24,50, ou deixe em branco.`);
      if (!notNumber.has(`${x.id}|orcamento`) && !notNumber.has(`${x.id}|cpa`)) problems.push(...valueProblems(lineSettings(s, own(x))).map(p => `${where}: ${p.charAt(0).toLowerCase()}${p.slice(1)}`));
    }
  } else {
    problems.push(...duplicateProblems(t, s));
    if (notNumber.has('geral|orcamento')) problems.push('O orçamento diário não é um número. Use só números, como 50 ou 49,90.');
    if (notNumber.has('geral|cpa')) problems.push(`${spend ? 'O limite de CPC' : 'A meta de CPA'} não é um número. Use só números, como 25 ou 24,50, ou deixe em branco.`);
  }
  if ([...notNumber].some(k => k.startsWith('grupo|'))) problems.push('A meta de CPA de um grupo não é um número. Use só números, como 25 ou 24,50, ou deixe em branco.');
  if (!targets.length) problems.push('Escolha pelo menos uma conta para receber a cópia.');
  if (targets.some(x => !x.campanha.trim())) problems.push('Toda cópia precisa de um nome.');
  if (targets.some(x => x.id === t.origem.conta_id && x.campanha.trim().toLowerCase() === t.origem.nome.trim().toLowerCase())) problems.push('Na mesma conta da original, a cópia precisa de outro nome.');
  if (goalNeeded && targets.some(x => !x.meta_id)) problems.push('Escolha a meta de conversão de cada conta.');
  const pending = targets.filter(x => !created[keyOf(x)]);
  const accepted = pending.filter(x => states[keyOf(x)]?.fase === 'aceita');
  const set = (k: string, st: State) => setStates(x => ({ ...x, [k]: st }));

  const send = async (x: Target, ensaio: boolean, model: Template = t): Promise<CreateResult> => {
    const { body } = await api('/api/campaign-builder', { action: 'duplicar', ensaio, modelo: model, ajustes: s, linha: { conta_id: x.id, nome: x.campanha, meta_id: x.meta_id, ...(multi ? own(x) : {}) } });
    return body.result || { ok: false, ensaio, campanha_id: null, situacao: null, problemas: [{ onde: 'pedido', texto: body.error || 'O servidor não respondeu.' }], avisos: [], calls: 0, itens: 0 };
  };
  const rehearse = async (model: Template = t) => {
    setBusy('ensaio'); setStale(false);
    for (const x of pending) {
      const k = keyOf(x);
      set(k, { fase: 'ensaiando' });
      const result = await send(x, true, model);
      set(k, { fase: result.ok ? 'aceita' : 'recusada', result });
    }
    setBusy('');
  };
  const create = async () => {
    setBusy('criar');
    for (const x of accepted) {
      const k = keyOf(x);
      set(k, { fase: 'criando' });
      const result = await send(x, false);
      set(k, { fase: result.ok ? 'criada' : 'falhou', result });
      if (result.ok) setCreated(c => { const next = { ...c, [k]: `${result.campanha_id || 'criada'}${result.situacao === 'PAUSED' ? '|pausada' : '|ativa'}` }; try { localStorage.setItem(CREATED, JSON.stringify(next)); } catch { /* sem armazenamento */ } return next; });
    }
    setBusy(''); setAgreed(false);
  };

  // Corrigir na cópia o que o Google recusou. A cópia mudou: o que estava aceito precisa ser ensaiado de novo;
  // as recusas continuam na tela, marcadas como corrigidas, até o próximo ensaio.
  const correct = (list: { refs: Ref[]; fix: Fix }[], thenRehearse = false) => {
    let model = t;
    const notes: string[] = [];
    for (const { refs, fix } of list) {
      const live = refs.filter(r => present(model, r));
      if (!live.length) continue;
      model = applyFix(model, live, fix);
      notes.push(fixNote(live[0], fix, new Set(live.map(r => ('grupo' in r ? r.grupo : null))).size));
    }
    if (!notes.length) return;
    setT(model); setFixes(f => [...f, ...notes]); setAgreed(false);
    setStates(x => Object.fromEntries(Object.entries(x).filter(([, st]) => st.fase !== 'aceita')));
    if (thenRehearse) rehearse(model);
  };
  const unresolved = (p: Problem) => (p.refs || []).filter(r => present(t, r));
  const fixed = (st?: State) => !!st && 'result' in st && st.result.problemas.some(p => p.refs?.length && !unresolved(p).length);

  const money = (v: number | null) => (v === null ? 'sem valor' : `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const field = `rounded-lg border ${line} ${soft} ${head} px-3 py-2 text-[13px] outline-none focus:border-brand`;
  const good = 'text-pos', bad = 'text-neg', warn = 'text-warn';
  const chip = 'bg-pos/10 border-pos/50 text-pos';
  const items = Object.values(states).map(st => ('result' in st ? st.result.itens : 0)).find(n => n > 0) || 0;

  return (
    <div className="space-y-4">
      <div className={`${card} border rounded-xl p-4 space-y-2`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className={`text-base font-semibold ${head}`}>{t.origem.nome}</div>
          <button onClick={() => { setT(null); setS(null); setTargets([]); setFixes([]); }} className={`text-xs ${muted} hover:text-ink`}>Escolher outra campanha</button>
        </div>
        <div className={`text-xs ${muted}`}>conta {dashed(t.origem.conta_id)} · lida em {new Date(t.origem.lido_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
        <div className={`text-[13px] ${head}`}>
          A cópia leva {t.grupos.length} {t.grupos.length === 1 ? 'grupo' : 'grupos'}, {keywords} palavras-chave, {ads.length} {ads.length === 1 ? 'anúncio' : 'anúncios'}, {negatives} negativas, {t.locais.length} {t.locais.length === 1 ? 'local' : 'locais'}, {t.idiomas.length} {t.idiomas.length === 1 ? 'idioma' : 'idiomas'}, {t.recursos.sitelinks.length} sitelinks e {t.recursos.destaques.length} frases de destaque{t.horarios.length ? `, e os ${t.horarios.length} horários de veiculação` : ''}.
          {(t.campanha.modelo_rastreamento || t.campanha.sufixo_url) && ' O modelo de rastreamento e o sufixo da URL também vão.'}
          {t.campanha.ia_max.ligada && ' A IA Max vai ligada, como na original.'}
        </div>
        <div className={`text-xs ${muted}`}>Sitelinks e frases de destaque entram no nível da campanha, mesmo os que na original estavam no grupo ou na conta.{t.recursos.nome_empresa ? ' O nome da empresa não é copiado.' : ''}</div>
        {fixes.length > 0 && (
          <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs space-y-0.5">
            <div className={`font-medium ${head}`}>Correções feitas na cópia por causa do Google ({fixes.length})</div>
            {fixes.map((f, i) => <div key={i} className={head}>{f}</div>)}
            <div className={muted}>Valem para todas as cópias desta duplicação. A campanha original não muda. Para desfazer, leia a campanha de novo.</div>
          </div>
        )}
        {t.avisos.length > 0 && <div className="text-xs text-warn space-y-0.5"><div className="font-medium">O Google não devolveu tudo na leitura</div>{t.avisos.map((a, i) => <div key={i}>{a}</div>)}</div>}
      </div>

      <Block title="Ajustes de lance que NÃO vão para a cópia" hint="A campanha nova começa limpa: sem ajuste por aparelho, local, horário, idade, gênero ou renda. Os locais e horários entram, só sem o ajuste." css={css}>
        {dropped.length
          ? <div className="flex flex-wrap gap-1.5">{dropped.map((x, i) => <span key={i} className={`text-xs px-2 py-1 rounded border ${line} ${muted} line-through decoration-neg/60`}>{x}</span>)}</div>
          : <div className={`text-xs ${muted}`}>A original não tem ajuste de lance.</div>}
      </Block>

      <Block title={multi ? 'CPA dos grupos' : 'Orçamento e CPA da cópia'} hint={multi
        ? `Com mais de uma cópia, o orçamento e ${cpaName} de cada uma ficam na lista de contas abaixo, começando com os valores da original (${symbol}).${!spend && t.grupos.length ? ' As metas de CPA dos grupos valem para todas as cópias.' : ''}`
        : `Começa com os valores da original (${symbol}). Se você escolher mais de uma conta, cada cópia ganha o próprio orçamento e CPA na lista de contas.`} css={css}>
        {!multi && <div className="flex flex-wrap gap-4">
          <label className="space-y-1"><div className={label}>Orçamento diário</div>
            <div className="flex items-center gap-2"><span className={`text-xs ${muted}`}>{symbol}</span><NumberField value={s.orcamento_diario} onChange={v => setS(x => x && { ...x, orcamento_diario: v })} onBad={b => markBad('geral|orcamento', b)} css={css} label="Orçamento diário da cópia" /></div>
            <div className={`text-[11px] ${muted}`}>original: {money(t.campanha.orcamento_diario)}</div>
          </label>
          {spend ? (
            <label className="space-y-1"><div className={label}>Limite de CPC</div>
              <div className="flex items-center gap-2"><span className={`text-xs ${muted}`}>{symbol}</span><NumberField value={s.limite_cpc} onChange={v => setS(x => x && { ...x, limite_cpc: v })} onBad={b => markBad('geral|cpa', b)} css={css} placeholder="sem limite" label="Limite de CPC da cópia" /></div>
              <div className={`text-[11px] ${muted}`}>original: {money(t.campanha.lance.limite_cpc)}</div>
            </label>
          ) : (
            <label className="space-y-1"><div className={label}>Meta de CPA da campanha</div>
              <div className="flex items-center gap-2"><span className={`text-xs ${muted}`}>{symbol}</span><NumberField value={s.meta_cpa} onChange={v => setS(x => x && { ...x, meta_cpa: v })} onBad={b => markBad('geral|cpa', b)} css={css} placeholder="sem meta" label="Meta de CPA da cópia" /></div>
              <div className={`text-[11px] ${muted}`}>original: {money(t.campanha.lance.meta_cpa)}</div>
            </label>
          )}
        </div>}
        {!spend && t.grupos.length > 0 && (
          <div className="space-y-1.5">
            <div className={label}>Meta de CPA de cada grupo <span className="font-normal">(em branco, o grupo segue a meta da campanha)</span></div>
            {t.grupos.map(g => (
              <div key={g.id} className={`flex flex-wrap items-center gap-2 py-1 border-t ${line} text-[13px]`}>
                <span className={`flex-1 min-w-[180px] ${head}`}>{g.nome}{g.status === 'PAUSED' && <span className={`ml-1.5 text-xs ${muted}`}>· pausado, vai pausado</span>}</span>
                <span className={`text-xs ${muted}`}>original: {money(g.meta_cpa)}</span>
                <span className={`text-xs ${muted}`}>{symbol}</span>
                <NumberField value={s.grupos[g.id] ?? null} onChange={v => setS(x => x && { ...x, grupos: { ...x.grupos, [g.id]: v } })} onBad={b => markBad(`grupo|${g.id}`, b)} css={css} placeholder="da campanha" label={`Meta de CPA do grupo ${g.nome}`} />
              </div>
            ))}
          </div>
        )}
        {t.campanha.lance.compartilhada && <div className={`text-xs ${warn}`}>A original usa uma estratégia de lance compartilhada; a cópia recebe uma estratégia própria, com os valores acima.</div>}
      </Block>

      <Block title="Para onde duplicar" hint="Marque a mesma conta, outras contas ou contas de outras MCCs: sai uma cópia por conta marcada." css={css}>
        <div className="flex flex-wrap gap-1.5 items-center">
          {targets.map(x => (
            <span key={x.id} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${chip}`}>
              <Check size={12} aria-hidden="true" /> {x.mcc ? `${x.mcc} › ` : ''}{x.nome}{x.id === t.origem.conta_id ? ' (mesma conta da original)' : ''}
              <button onClick={() => toggle([{ id: x.id } as Account], false)} aria-label={`Tirar a conta ${x.nome}`} className="hover:text-neg"><X size={12} aria-hidden="true" /></button>
            </span>
          ))}
          <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="text-xs font-medium px-2.5 py-1 rounded border inline-flex items-center gap-1 border-line-strong text-ink hover:border-brand">
            {open ? 'Fechar a lista de contas' : <><Plus size={13} aria-hidden="true" /> Escolher MCC e contas</>}
          </button>
        </div>
        {open && (accounts
          ? <AccountPicker accounts={accounts} picked={new Set(targets.map(x => x.id))} elsewhere={new Map()} hidden={hidden} onHide={hide} css={css} onToggle={toggle} />
          : <div className={`text-xs ${muted} flex items-center gap-2`}><Loader2 size={13} aria-hidden="true" className="animate-spin" /> Carregando as contas…</div>)}

        {targets.length > 0 && (
          <div className="space-y-2">
            {targets.map(x => {
              const g = goals[x.id], k = keyOf(x), st = states[k], done = created[k], a = byId.get(x.id);
              const otherCurrency = x.moeda && x.moeda !== currency;
              return (
                <div key={x.id} className={`rounded-lg border ${line} ${soft} p-3 space-y-2`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className={`text-xs ${muted}`}>{x.mcc} › <span className={head}>{x.nome}</span> · {dashed(x.id)}{a && a.ativas.length > 0 && <span className={`ml-1.5 ${warn}`}>· {running(a)}</span>}</div>
                    <div className="text-xs font-medium inline-flex items-center gap-1.5" aria-live="polite">
                      {done ? <span className={done.endsWith('|pausada') ? warn : good}><Check size={13} aria-hidden="true" className="inline" /> criada{done.endsWith('|pausada') ? ', mas pausada' : ', ativa'}{/^\d/.test(done) ? ` · nº ${done.split('|')[0]}` : ''}</span>
                        : !st ? <span className={muted}>ainda não ensaiada</span>
                          : st.fase === 'ensaiando' ? <span className={muted}><Loader2 size={12} aria-hidden="true" className="inline animate-spin" /> ensaiando…</span>
                            : st.fase === 'criando' ? <span className={muted}><Loader2 size={12} aria-hidden="true" className="inline animate-spin" /> criando…</span>
                              : st.fase === 'aceita' ? <span className={good}><Check size={13} aria-hidden="true" className="inline" /> o Google aceita</span>
                                : <span className={bad}><X size={13} aria-hidden="true" className="inline" /> {st.fase === 'recusada' ? 'recusada no ensaio' : 'não foi criada'}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={x.campanha} onChange={e => setTarget(x.id, { campanha: e.target.value })} disabled={!!done} aria-label={`Nome da cópia em ${x.nome}`} placeholder="Nome da campanha no Google" className={`flex-1 min-w-[240px] ${field}`} />
                    {g?.loading || !g ? <span className={`text-xs ${muted} inline-flex items-center gap-1.5`}><Loader2 size={12} aria-hidden="true" className="animate-spin" /> lendo as metas…</span>
                      : g.error ? <span className="text-xs text-neg max-w-[320px]">{g.error}</span>
                        : g.list?.length ? (
                          <select value={x.meta_id || ''} onChange={e => setGoal(x.id, e.target.value)} disabled={!!done} aria-label={`Meta de conversão em ${x.nome}`}
                            className={`rounded-lg border ${!x.meta_id && goalNeeded ? 'border-warn/70' : line} bg-surface-2 text-ink px-2 py-1.5 text-[13px]`}>
                            <option value="">{goalNeeded ? 'Escolha a meta' : 'Metas da conta (como a original)'}</option>
                            {g.list.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                          </select>
                        ) : <span className={`text-xs ${goalNeeded ? warn : muted}`}>{goalNeeded ? 'Esta conta não tem meta personalizada. Crie a meta no Google Ads antes de duplicar.' : 'Usa as metas da conta, como a original.'}</span>}
                  </div>
                  {multi && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <label className={`inline-flex items-center gap-2 text-xs ${muted}`}>Orçamento diário {symbol}
                        <NumberField key={`${x.id}|orcamento`} value={own(x).orcamento_diario} onChange={v => setTarget(x.id, { orcamento: v })} onBad={b => markBad(`${x.id}|orcamento`, b)} css={css} label={`Orçamento diário da cópia em ${x.nome}`} />
                      </label>
                      <label className={`inline-flex items-center gap-2 text-xs ${muted}`}>{spend ? 'Limite de CPC' : 'Meta de CPA'} {symbol}
                        <NumberField key={`${x.id}|cpa`} value={spend ? own(x).limite_cpc : own(x).meta_cpa} onChange={v => setTarget(x.id, { cpa: v })} onBad={b => markBad(`${x.id}|cpa`, b)} css={css} placeholder={spend ? 'sem limite' : 'sem meta'} label={`${spend ? 'Limite de CPC' : 'Meta de CPA'} da cópia em ${x.nome}`} />
                      </label>
                      <span className={`text-[11px] ${muted}`}>original: {money(t.campanha.orcamento_diario)} · {money(spend ? t.campanha.lance.limite_cpc : t.campanha.lance.meta_cpa)}</span>
                    </div>
                  )}
                  {otherCurrency && <div className={`text-xs ${warn}`}>Esta conta usa {symbolOf(x.moeda)}, não {symbol}: o orçamento e o CPA entram nela como {symbolOf(x.moeda)} com os mesmos números.</div>}
                  {st && 'result' in st && st.result.problemas.map((p, j) => (
                    <Refusal key={`${j}|${p.onde}`} p={p} live={unresolved(p)} t={t} busy={busy !== ''} onFix={(refs, fix) => correct([{ refs, fix }])} css={css} />
                  ))}
                  {st && 'result' in st && (() => {
                    // Várias recusas de uma vez: um botão tira tudo o que dá para tirar e já pede ao Google para conferir de novo.
                    const removable = st.result.problemas.map(unresolved).filter(refs => refs.length && refs.every(r => !removeProblem(t, r)));
                    const left = st.result.problemas.filter(p => unresolved(p).length).length;
                    if (!removable.length && !fixed(st)) return null;
                    return (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {removable.length > 0 && (
                          <button onClick={() => correct(removable.map(refs => ({ refs, fix: { acao: 'tirar' } as Fix })), true)} disabled={busy !== ''}
                            className="bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5">
                            <Trash2 size={13} aria-hidden="true" /> Tirar {removable.length === 1 ? 'o item recusado' : `os ${removable.length} itens recusados`} e ensaiar de novo
                          </button>
                        )}
                        {fixed(st) && (
                          <button onClick={() => rehearse()} disabled={busy !== ''}
                            className={`${removable.length ? `border border-line-strong ${head} hover:border-brand` : 'bg-brand hover:bg-brand-hover text-white'} px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5`}>
                            <RotateCcw size={13} aria-hidden="true" /> Ensaiar de novo no Google{left ? ` (${left} ainda sem correção)` : ''}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {st && 'result' in st && st.result.avisos.map((av, j) => <div key={j} className={`text-xs ${warn}`}>{av}</div>)}
                </div>
              );
            })}
          </div>
        )}
        {goalNeeded && targets.length > 0 && <div className={`text-xs ${muted}`}>A original otimiza para a meta “{t.campanha.meta_conversao?.nome || 'personalizada'}”. Em cada conta já vem marcada a meta de mesmo nome, quando existe.</div>}
      </Block>

      <div className={`${card} border rounded-xl p-4 space-y-3`}>
        {problems.length > 0 && <div className="text-xs space-y-0.5">{problems.map(p => <div key={p} className={warn}>{p}</div>)}</div>}
        {targets.length > 0 && pending.length === 0 ? (
          <div className={`text-sm ${good} font-medium`}>Todas as cópias escolhidas já foram criadas no Google Ads.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => rehearse()} disabled={busy !== '' || problems.length > 0} className="px-4 py-2 rounded-lg border text-xs font-medium inline-flex items-center gap-2 disabled:opacity-40 border-line-strong text-ink hover:border-brand">
                {busy === 'ensaio' && <Loader2 size={13} aria-hidden="true" className="animate-spin" />} 1. Ensaiar no Google ({pending.length})
              </button>
              <span className={`text-xs ${stale ? warn : muted}`}>{stale ? 'Algo mudou depois do último ensaio: ensaie de novo. ' : ''}{accepted.length ? `${accepted.length} de ${pending.length} aceitas.` : 'O ensaio não cria nada.'}{items ? ` Cada cópia leva ${items} itens; o ensaio e a criação contam na cota diária do Google.` : ''}</span>
            </div>
            {accepted.length > 0 && (
              <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 space-y-2">
                <label className={`flex items-start gap-2 text-[13px] cursor-pointer ${head}`}>
                  <input type="checkbox" className="mt-0.5" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                  <span>Entendi: isto cria {accepted.length} {accepted.length === 1 ? 'campanha de verdade' : 'campanhas de verdade'} nas contas acima, e elas já nascem ATIVAS: começam a gastar assim que o Google aprovar os anúncios. A campanha original não muda. Não dá para desfazer por aqui; para pausar ou apagar, é no Google Ads ou na tela de Campanhas.</span>
                </label>
                <button onClick={create} disabled={!agreed || busy !== ''} className="bg-brand hover:bg-brand-hover text-white px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-2">
                  {busy === 'criar' && <Loader2 size={13} aria-hidden="true" className="animate-spin" />} 2. Criar {accepted.length === 1 ? 'a cópia aceita' : `as ${accepted.length} cópias aceitas`}, já ativas
                </button>
              </div>
            )}
          </>
        )}
        <div className={`text-xs ${muted}`}>A mesma oferta com os mesmos textos em muitas contas é um dos motivos de suspensão no Google; a escolha de quantas contas usar é sua.</div>
      </div>
    </div>
  );
}

/**
 * Um item que o Google recusou, com o que dá para fazer ali mesmo: tirar da
 * cópia, trocar o texto ou, quando o Google aceita, pedir exceção da política.
 */
function Refusal({ p, live, t, busy, onFix, css }: { p: Problem; live: Ref[]; t: Template; busy: boolean; onFix: (refs: Ref[], fix: Fix) => void; css: Css }) {
  const { head, muted, line, soft } = css;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const first = live[0];
  const done = !!p.refs?.length && !live.length;
  const edit = first ? editable(first) : null;
  const cantRemove = first ? live.map(r => removeProblem(t, r)).find(Boolean) || null : null;
  const canExempt = !!p.excecao && !!first && exemptible(first);
  const bad = editing && first ? editProblem(first, text) : null;
  const button = `px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40`;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs space-y-1 ${done ? 'border-pos/30 bg-pos/5' : 'border-neg/30 bg-neg/5'}`}>
      <div className={`font-medium ${done ? 'text-pos' : 'text-neg'}`}>{done && <Check size={12} aria-hidden="true" className="inline mr-1" />}{p.onde}{done ? ' · corrigido, falta ensaiar de novo' : ''}</div>
      {!done && <>
        <div className={head}>{p.texto}</div>
        {p.corrigir && <div className={head}><b>Como corrigir:</b> {p.corrigir}</div>}
        {!p.corrigir && p.google && <div className={muted}>Resposta do Google: {p.google}</div>}
        {p.codigo && <div className={muted}>código do Google: {p.codigo}</div>}
        {first && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => onFix(live, { acao: 'tirar' })} disabled={busy || !!cantRemove} title={cantRemove || undefined}
              className={`${button} bg-neg/10 border border-neg/40 text-neg hover:bg-neg/20`}>
              <Trash2 size={12} aria-hidden="true" /> Tirar da cópia{live.length > 1 ? ` (${live.length} grupos)` : ''}
            </button>
            {edit && !editing && (
              <button onClick={() => { setText(first.texto); setEditing(true); }} disabled={busy} className={`${button} bg-surface-2 border border-line-strong ${head} hover:border-brand`}>
                <Pencil size={12} aria-hidden="true" /> Trocar o texto
              </button>
            )}
            {canExempt && (
              <button onClick={() => onFix(live, { acao: 'excecao', chave: p.excecao! })} disabled={busy}
                title="O item vai assim mesmo e o Google revisa antes de veicular. Ele pode reprovar depois."
                className={`${button} bg-surface-2 border border-line-strong ${head} hover:border-brand`}>
                <ShieldCheck size={12} aria-hidden="true" /> Pedir exceção ao Google
              </button>
            )}
            {cantRemove && <span className={muted}>{cantRemove}</span>}
          </div>
        )}
        {first && editing && edit && (
          <div className="space-y-1 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <input value={text} onChange={e => setText(e.target.value)} autoFocus aria-label={`Novo texto: ${edit.nome}`}
                onKeyDown={e => { if (e.key === 'Enter' && !bad) { onFix(live, { acao: 'trocar', texto: text }); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
                className={`flex-1 min-w-[220px] rounded-lg border ${line} ${soft} ${head} px-3 py-1.5 text-[13px] outline-none focus:border-brand`} />
              {edit.max && <span className={`tabular-nums ${[...text].length > edit.max ? 'text-neg' : muted}`}>{[...text].length}/{edit.max}</span>}
              <button onClick={() => { onFix(live, { acao: 'trocar', texto: text }); setEditing(false); }} disabled={busy || !!bad} className={`${button} bg-brand hover:bg-brand-hover text-white`}>
                <Check size={12} aria-hidden="true" /> Trocar{live.length > 1 ? ` nos ${live.length} grupos` : ''}
              </button>
              <button onClick={() => setEditing(false)} className={`${muted} hover:text-ink`}>cancelar</button>
            </div>
            {bad && text.trim() !== first.texto.trim() && <div className="text-warn">{bad}</div>}
          </div>
        )}
      </>}
    </div>
  );
}
