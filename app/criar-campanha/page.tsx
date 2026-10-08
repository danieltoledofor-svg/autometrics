"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import type { Template } from '@/lib/campaignBuilder/template';

/**
 * Criador de campanhas de Pesquisa. Por enquanto só o primeiro passo: escolher
 * uma campanha que já existe e ler tudo dela do Google, para servir de modelo.
 * A leitura não altera nada na campanha. Só para os logins liberados.
 */

const STEPS = ['Modelo', 'Campanha', 'Anúncio', 'Onde subir', 'Conferir'];
const MATCH: Record<string, string> = { EXACT: 'exata', PHRASE: 'frase', BROAD: 'ampla' };
const STRATEGY: Record<string, string> = {
  MAXIMIZE_CONVERSIONS: 'Maximizar conversões', TARGET_CPA: 'CPA desejado', MAXIMIZE_CONVERSION_VALUE: 'Maximizar valor das conversões',
  TARGET_ROAS: 'ROAS desejado', TARGET_SPEND: 'Maximizar cliques', MANUAL_CPC: 'CPC manual', TARGET_IMPRESSION_SHARE: 'Parcela de impressões',
};
const DEVICE: Record<string, string> = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet', CONNECTED_TV: 'TV conectada' };
const AUDIENCE: Record<string, string> = { AGE_RANGE: 'Idade', GENDER: 'Gênero', INCOME_RANGE: 'Renda' };
const keyword = (k: { texto: string; tipo: string }) => (k.tipo === 'EXACT' ? `[${k.texto}]` : k.tipo === 'PHRASE' ? `"${k.texto}"` : k.texto);
const adjust = (v: number) => (!v ? 'sem ajuste' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`);
const yesNo = (v: boolean | null) => (v === null ? 'o Google não informou' : v ? 'ligada' : 'desligada');

async function api(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export default function CampaignBuilderPage() {
  const { authChecked } = useAuthGuard();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [list, setList] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ template: Template; currency?: string; migration?: boolean } | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('autometrics_theme') as 'dark' | 'light' | null;
    if (t) setTheme(t);
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { if (authChecked) api('/api/campaign-builder').then(({ body }) => setList(body)); }, [authChecked]);

  const read = useCallback(async (path: string) => {
    setReading(true); setError(''); setResult(null);
    const { ok, body } = await api(path);
    if (!ok || !body.template) setError(body.error || 'Não foi possível ler a campanha.');
    else setResult(body);
    setReading(false);
  }, []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all: any[] = list?.campaigns || [];
    return (f ? all.filter(c => `${c.name} ${c.account} ${c.mcc}`.toLowerCase().includes(f)) : all).slice(0, 40);
  }, [list, filter]);

  const isDark = theme === 'dark';
  const page = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const head = isDark ? 'text-white' : 'text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const line = isDark ? 'border-slate-800' : 'border-slate-200';
  const soft = isDark ? 'bg-slate-950' : 'bg-slate-50';
  const label = `text-[11px] font-semibold tracking-wide uppercase ${muted}`;

  if (!authChecked) return null;
  const t = result?.template;
  const symbol = result?.currency === 'BRL' ? 'R$' : result?.currency === 'EUR' ? '€' : 'US$';
  const money = (v: number | null) => (v === null ? 'sem valor' : `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const Field = ({ name, children }: { name: string; children: React.ReactNode }) => (
    <div className={`${soft} rounded-lg px-3 py-2`}><div className={`text-xs ${muted}`}>{name}</div><div className={`text-[13px] ${head}`}>{children}</div></div>
  );
  const Block = ({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) => (
    <div className={`${card} border rounded-xl p-4 space-y-3`}>
      <div className={`text-sm font-bold ${head}`}>{title}{count !== undefined && <span className={`ml-2 text-xs font-normal ${muted}`}>{count}</span>}</div>
      {children}
    </div>
  );
  const chips = (items: string[], max = 60) => (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, max).map((x, i) => <span key={i} className={`text-xs px-2 py-1 rounded border ${line} ${head}`}>{x}</span>)}
      {items.length > max && <span className={`text-xs px-2 py-1 ${muted}`}>e mais {items.length - max}</span>}
      {!items.length && <span className={`text-xs ${muted}`}>nenhum</span>}
    </div>
  );

  return (
    <div className={`min-h-screen ${page}`}>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/products" aria-label="Voltar para Campanhas" className={`p-2 rounded-lg border ${line} ${muted} hover:text-indigo-400`}><ArrowLeft size={16} /></Link>
          <div>
            <h1 className={`text-xl font-extrabold ${head}`}>Criar campanha</h1>
            <div className={`text-xs ${muted}`}>Rede de Pesquisa · em construção: por enquanto só a leitura do modelo</div>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {STEPS.map((s, i) => (
            <div key={s} className={`rounded-lg border px-3 py-2 text-xs ${i === 0 ? 'border-indigo-500 text-indigo-400' : `${line} ${muted}`}`}>
              <b className="block text-[13px]">{i + 1}. {s}</b>{i === 0 ? 'copiar uma campanha' : 'em breve'}
            </div>
          ))}
        </div>

        {list && list.allowed === false && <div className={`${card} border rounded-xl p-5 text-sm ${muted}`}>O criador de campanhas ainda não está liberado para este login.</div>}

        {list?.allowed && (
          <div className={`${card} border rounded-xl p-4 space-y-3`}>
            <div className={`text-sm font-bold ${head}`}>Escolha a campanha que serve de modelo</div>
            <div className={`text-xs ${muted}`}>O Autometrics lê do Google a configuração, a meta de conversão, os locais, as negativas, os grupos, as palavras-chave, os anúncios, os sitelinks e as frases de destaque. Ler não altera nada na campanha.</div>
            {list.migration && <div className="text-xs text-amber-500">Para guardar os modelos, rode migration_criador.sql no Supabase. Sem ela a leitura funciona, mas o modelo não fica salvo.</div>}
            {list.templates?.length > 0 && (
              <div>
                <div className={`${label} mb-1.5`}>Modelos já lidos</div>
                <div className="flex flex-wrap gap-1.5">
                  {list.templates.map((m: any) => (
                    <button key={m.id} onClick={() => read(`/api/campaign-builder?template=${m.id}`)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${line} ${head} hover:border-indigo-500`}>{m.name}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="relative">
              <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${muted}`} />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Nome da campanha, da conta ou da MCC" aria-label="Procurar campanha"
                className={`w-full rounded-lg border ${line} ${soft} ${head} pl-9 pr-3 py-2 text-[13px] outline-none focus:border-indigo-500`} />
            </div>
            <div className={`max-h-64 overflow-y-auto rounded-lg border ${line} divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
              {shown.map((c: any) => (
                <button key={c.id} onClick={() => setPicked(c.id)} className={`w-full text-left px-3 py-2 text-[13px] ${picked === c.id ? 'bg-indigo-600/15' : ''} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                  <span className={head}>{c.name}</span>
                  <span className={`block text-xs ${muted}`}>{[c.account, c.mcc].filter(Boolean).join(' · ') || 'conta sem nome'}</span>
                </button>
              ))}
              {!shown.length && <div className={`px-3 py-3 text-xs ${muted}`}>Nenhuma campanha ligada ao Google com esse nome.</div>}
            </div>
            <div className="flex items-center gap-3">
              <button disabled={!picked || reading} onClick={() => read(`/api/campaign-builder?product_id=${picked}`)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40 inline-flex items-center gap-2">
                {reading && <Loader2 size={13} className="animate-spin" />} Ler do Google
              </button>
              {(list.campaigns || []).length > 40 && !filter && <span className={`text-xs ${muted}`}>Mostrando 40 de {list.campaigns.length}; use a busca.</span>}
            </div>
            {error && <div className="text-xs text-rose-500">{error}</div>}
          </div>
        )}

        {t && (
          <>
            <div className={`flex items-baseline justify-between gap-3 flex-wrap`}>
              <div className={`text-base font-extrabold ${head}`}>{t.origem.nome}</div>
              <div className={`text-xs ${muted}`}>conta {t.origem.conta_id} · lido em {new Date(t.origem.lido_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            {result?.migration && <div className="text-xs text-amber-500">Este modelo não ficou salvo: rode migration_criador.sql no Supabase.</div>}
            {t.avisos.length > 0 && (
              <div className={`${card} border !border-amber-500/40 rounded-xl p-4 text-xs text-amber-500 space-y-1`}>
                <div className="font-bold">O Google não devolveu tudo</div>
                {t.avisos.map((a, i) => <div key={i}>{a}</div>)}
              </div>
            )}

            <Block title="Campanha">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Field name="Lance">{STRATEGY[t.campanha.lance.estrategia] || t.campanha.lance.estrategia}{t.campanha.lance.meta_cpa ? ` · meta de CPA ${money(t.campanha.lance.meta_cpa)}` : ''}{t.campanha.lance.limite_cpc ? ` · limite de CPC ${money(t.campanha.lance.limite_cpc)}` : ''}{t.campanha.lance.compartilhada ? ' · estratégia compartilhada' : ''}</Field>
                <Field name="Orçamento diário">{money(t.campanha.orcamento_diario)}</Field>
                <Field name="Meta de conversão">{t.campanha.meta_conversao?.nome || (t.campanha.meta_conversao?.nivel === 'CUSTOMER' ? 'padrão da conta' : 'não identificada')}</Field>
                <Field name="Redes">{['Pesquisa do Google', t.campanha.redes.parceiros && 'parceiros de pesquisa', t.campanha.redes.display && 'Display'].filter(Boolean).join(' · ')}</Field>
                <Field name="Quem conta como no local">{t.campanha.local_incluir === 'PRESENCE' ? 'Só quem está no local' : 'Quem está ou tem interesse no local'}</Field>
                <Field name="IA Max">{yesNo(t.campanha.ia_max.ligada)}{t.campanha.ia_max.ligada ? ` · texto ${yesNo(t.campanha.ia_max.personalizar_texto)} · URL ${yesNo(t.campanha.ia_max.expandir_url)}` : ''}</Field>
                <Field name="Idiomas">{t.idiomas.map(i => i.nome).join(', ') || 'todos'}</Field>
                <Field name="Aparelhos">{t.aparelhos.filter(a => a.ajuste).map(a => `${DEVICE[a.tipo] || a.tipo} ${adjust(a.ajuste)}`).join(' · ') || 'sem ajuste'}</Field>
                <Field name="Nome da empresa">{t.recursos.nome_empresa || 'não informado'}</Field>
              </div>
              {(t.campanha.modelo_rastreamento || t.campanha.sufixo_url) && <div className={`text-xs ${muted} break-all`}>{t.campanha.modelo_rastreamento && <>Modelo de rastreamento: {t.campanha.modelo_rastreamento}<br /></>}{t.campanha.sufixo_url && <>Sufixo da URL: {t.campanha.sufixo_url}</>}</div>}
              <div className={`text-xs ${muted}`}>Metas personalizadas desta conta: {t.metas_da_conta.map(g => g.nome).join(', ') || 'nenhuma'}</div>
            </Block>

            <Block title="Locais" count={t.locais.length}>
              {chips(t.locais.map(l => `${l.excluido ? 'excluído: ' : ''}${l.nome}${l.ajuste ? ` (${adjust(l.ajuste)})` : ''}`))}
              {!t.locais.length && <div className={`text-xs ${muted}`}>Sem local definido: a campanha roda em todos os países.</div>}
            </Block>

            <Block title="Negativas da campanha" count={t.negativas.length}>{chips(t.negativas.map(keyword))}</Block>

            {t.grupos.map(g => (
              <Block key={g.id} title={`Grupo: ${g.nome}`}>
                <div className={`text-xs ${muted}`}>{g.status === 'ENABLED' ? 'ativo' : g.status === 'PAUSED' ? 'pausado' : g.status}{g.meta_cpa ? ` · meta de CPA do grupo ${money(g.meta_cpa)}` : ''}</div>
                <div><div className={`${label} mb-1.5`}>Palavras-chave ({g.palavras.length})</div>{chips(g.palavras.map(k => `${keyword(k)} · ${MATCH[k.tipo] || k.tipo}${k.status === 'PAUSED' ? ' · pausada' : ''}`))}</div>
                {g.negativas.length > 0 && <div><div className={`${label} mb-1.5`}>Negativas do grupo ({g.negativas.length})</div>{chips(g.negativas.map(keyword))}</div>}
                {g.publicos.some(p => p.ajuste || p.excluido) && (
                  <div><div className={`${label} mb-1.5`}>Ajustes de público</div>{chips(g.publicos.filter(p => p.ajuste || p.excluido).map(p => `${AUDIENCE[p.tipo] || p.tipo} ${p.faixa.replace(/^(AGE_RANGE_|INCOME_RANGE_)/, '').replace(/_/g, ' ').toLowerCase()}: ${p.excluido ? 'excluído' : adjust(p.ajuste)}`))}</div>
                )}
                {g.anuncios.map(a => (
                  <div key={a.id} className={`rounded-lg border ${line} p-3 space-y-2`}>
                    <div className={`text-xs ${muted} break-all`}>Anúncio {a.status === 'ENABLED' ? 'ativo' : a.status === 'PAUSED' ? 'pausado' : a.status} · {a.urls[0] || 'sem URL'}{a.caminho1 ? ` · caminho /${a.caminho1}${a.caminho2 ? `/${a.caminho2}` : ''}` : ''}</div>
                    <div><div className={`${label} mb-1.5`}>Títulos ({a.titulos.length})</div>{chips(a.titulos.map(x => `${x.texto}${x.fixo ? ` · fixo na posição ${String(x.fixo).replace(/\D/g, '')}` : ''}`))}</div>
                    <div><div className={`${label} mb-1.5`}>Descrições ({a.descricoes.length})</div><div className="space-y-1">{a.descricoes.map((x, i) => <div key={i} className={`text-[13px] ${head}`}>{x.texto}</div>)}</div></div>
                  </div>
                ))}
                {!g.anuncios.length && <div className={`text-xs ${muted}`}>Nenhum anúncio de pesquisa responsivo neste grupo.</div>}
              </Block>
            ))}

            <Block title="Sitelinks" count={t.recursos.sitelinks.length}>
              <div className="grid md:grid-cols-2 gap-2">
                {t.recursos.sitelinks.map((s, i) => (
                  <div key={i} className={`${soft} rounded-lg px-3 py-2 text-[13px]`}>
                    <div className={head}>{s.texto} <span className={`text-xs ${muted}`}>· {s.nivel}</span></div>
                    <div className={`text-xs ${muted}`}>{[s.desc1, s.desc2].filter(Boolean).join(' · ') || 'sem descrição'}</div>
                    {s.urls[0] && <div className={`text-xs ${muted} break-all`}>{s.urls[0]}</div>}
                  </div>
                ))}
              </div>
              {!t.recursos.sitelinks.length && <div className={`text-xs ${muted}`}>nenhum</div>}
            </Block>

            <Block title="Frases de destaque" count={t.recursos.destaques.length}>{chips(t.recursos.destaques.map(d => d.texto))}</Block>
          </>
        )}
      </div>
    </div>
  );
}
