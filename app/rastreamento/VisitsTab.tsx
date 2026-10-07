"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api, qty, money, when, clock, lasted, place, path, DEVICE, TRAFFIC, type Ui } from './shared';

/**
 * Aba Visitas: cada visita às páginas, com de onde veio (anúncio, palavra-chave,
 * local, aparelho) e até onde chegou. Clicar numa linha abre a visita inteira:
 * tudo o que veio na URL, o visitante e a linha do tempo até a venda.
 *
 * Rota: /api/tracking/visits.
 */

const REACHED: Record<string, { label: string; cls: string }> = {
  venda: { label: 'Venda', cls: 'bg-emerald-500/15 text-emerald-500' },
  checkout: { label: 'Checkout', cls: 'bg-amber-500/15 text-amber-500' },
  video: { label: 'Segunda página', cls: 'bg-indigo-500/15 text-indigo-400' },
  entrada: { label: 'Só a entrada', cls: '' },
};
/** Nome simples de cada campo que chega na URL do anúncio. */
const PARAM: Record<string, string> = {
  gclid: 'Clique do Google', gbraid: 'Clique do Google (iPhone)', wbraid: 'Clique do Google (app)', ftgid: 'Clique do Google (via FlowTracking)',
  utm_id: 'Campanha (número)', gad_campaignid: 'Campanha (número, do Google)', utm_campaign: 'Campanha (nome)', utm_source: 'Origem',
  utm_medium: 'Grupo de anúncios', utm_content: 'Anúncio', utm_term: 'Palavra-chave', keyword: 'Palavra-chave', matchtype: 'Tipo de correspondência',
  network: 'Rede', device: 'Aparelho (pelo Google)', gad_source: 'Origem (do Google)', ft_sid: 'Sessão da FlowTracking', src: 'Marcação da página',
  loc_physical_ms: 'Local (número do Google)', devicemodel: 'Modelo do aparelho', extensionid: 'Extensão clicada', placement: 'Site onde o anúncio apareceu',
};

export function VisitsTab({ ui, period, campaigns }: { ui: Ui; period: string; campaigns: { id?: string; key: string }[] }) {
  const [filters, setFilters] = useState({ product_id: '', traffic: '', device: '', q: '', bought: false, bots: false });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<any>(null);
  const [opening, setOpening] = useState('');
  const request = useRef(0);

  const query = `${period}&page=${page}&product_id=${filters.product_id}&traffic=${filters.traffic}&device=${filters.device}&q=${encodeURIComponent(filters.q)}${filters.bought ? '&bought=1' : ''}${filters.bots ? '&bots=1' : ''}`;
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    const { ok, body } = await api(`/api/tracking/visits?${query}`);
    if (id !== request.current) return;
    if (!ok || body.ready === false) { setError(body.error || 'Não foi possível carregar.'); setData(null); }
    else setData(body);
    setLoading(false);
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const change = (patch: Partial<typeof filters>) => { setFilters(f => ({ ...f, ...patch })); setPage(0); };
  const show = async (clickId: string) => {
    if (open?.click_id === clickId) { setOpen(null); return; }
    setOpening(clickId);
    const { ok, body } = await api(`/api/tracking/visits?id=${encodeURIComponent(clickId)}`);
    setOpen(ok ? body : null);
    setOpening('');
  };

  const { card, head, muted, line, th, td, title, field } = ui;
  const chip = (on: boolean) => `px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${on ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400' : `${line} ${muted} hover:text-indigo-400`}`;
  const info = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 text-[13px]"><span className={muted}>{label}</span><span className={`${head} text-right break-all`}>{value || <span className={muted}>—</span>}</span></div>
  );

  const detail = open && (
    <div className={`${card} border rounded-xl p-4 space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-bold ${head}`}>Visita de {when(open.created_at)}{place(open) ? ` · ${place(open)}` : ''}</div>
          <div className={`text-xs mt-0.5 ${muted}`}>{open.campaign || 'Sem campanha ligada'}</div>
        </div>
        <button onClick={() => setOpen(null)} aria-label="Fechar a visita" className={muted}><X size={18} /></button>
      </div>
      <div className="grid md:grid-cols-3 gap-x-6 gap-y-4">
        <div>
          <div className={title}>Anúncio</div>
          {info('Origem', TRAFFIC[open.traffic] || '')}
          {info('Palavra-chave', open.keyword)}
          {info('Correspondência', open.match_type)}
          {info('Grupo de anúncios', open.ad_group_id)}
          {info('Anúncio', open.ad_id)}
          {info('Rede', open.network === 'g' ? 'Pesquisa do Google' : open.network === 's' ? 'Parceiros de pesquisa' : open.network === 'd' ? 'Display' : open.network)}
          {info('Página de entrada', path(open.landing_url || ''))}
          {info('Veio de', open.referrer ? path(open.referrer) : '')}
        </div>
        <div>
          <div className={title}>Visitante</div>
          {info('País', open.country)}
          {info('Estado', open.region)}
          {info('Cidade', open.city)}
          {info('IP', open.ip)}
          {info('Aparelho', DEVICE[open.device] || '')}
          {info('Sistema', open.os)}
          {info('Navegador', open.browser)}
          {info('Tela', open.screen ? open.screen.replace('x', ' × ') : '')}
          {info('Idioma', open.language)}
          {open.is_bot && <div className="text-xs text-amber-500 mt-1">Parece um robô, não uma pessoa.</div>}
        </div>
        <div>
          <div className={title}>Na página</div>
          {info('Tempo', open.seconds ? lasted(open.seconds) : '')}
          {info('Rolou até', open.max_scroll ? `${open.max_scroll}%` : '')}
          {info('Última atividade', when(open.last_seen_at))}
          <div className={`${title} mt-3`}>Caminho</div>
          <div className="mt-1 space-y-1">
            {open.timeline.map((t: any, i: number) => (
              <div key={i} className="text-[13px] flex gap-2">
                <span className={`tabular-nums shrink-0 ${muted}`}>{clock(t.at)}</span>
                <span className={`min-w-0 break-all ${t.kind === 'sale' ? 'text-emerald-500 font-bold' : t.kind === 'checkout' || t.kind === 'saida' ? 'text-amber-500' : head}`}>
                  {t.kind === 'pagina' ? `abriu ${path(t.text)}`
                    : t.kind === 'saida' ? `saiu para comprar em ${path(t.text)}`
                    : t.kind === 'checkout' ? `checkout${t.text ? ` na ${t.text}` : ''}`
                    : t.kind === 'sale' ? `venda de ${money(t.amount, t.currency)}${t.text ? ` na ${t.text}` : ''}${t.google ? ` · Google: ${t.google.status}` : ''}`
                    : t.kind === 'refund' ? `reembolso de ${money(t.amount, t.currency)}` : t.kind}
                </span>
              </div>
            ))}
            {open.timeline.length === 0 && <div className={`text-[13px] ${muted}`}>Nenhuma página registrada.</div>}
          </div>
        </div>
      </div>
      {open.params && Object.keys(open.params).length > 0 && (
        <div>
          <div className={title}>Tudo o que veio na URL do anúncio</div>
          <div className="grid md:grid-cols-2 gap-x-6 mt-1">
            {Object.entries(open.params as Record<string, string>).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-1 text-[13px]">
                <span className={muted}>{PARAM[k] || k}</span><span className={`${head} text-right break-all max-w-[60%]`}>{String(v).length > 60 ? `${String(v).slice(0, 28)}…${String(v).slice(-12)}` : String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className={`${card} border rounded-xl p-3 flex flex-wrap items-center gap-2`}>
        <select value={filters.product_id} onChange={e => change({ product_id: e.target.value })} className={`${field} max-w-[260px]`}>
          <option value="">Todas as campanhas</option>
          {campaigns.filter(c => c.id).map(c => <option key={c.id} value={c.id}>{c.key}</option>)}
        </select>
        <select value={filters.traffic} onChange={e => change({ traffic: e.target.value })} className={field}>
          <option value="">Toda origem</option>
          {Object.entries(TRAFFIC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.device} onChange={e => change({ device: e.target.value })} className={field}>
          <option value="">Todo aparelho</option>
          {Object.entries(DEVICE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input defaultValue={filters.q} placeholder="Palavra-chave, cidade, país ou IP"
          onKeyDown={e => { if (e.key === 'Enter') change({ q: (e.target as HTMLInputElement).value.trim() }); }}
          onBlur={e => { const v = e.target.value.trim(); if (v !== filters.q) change({ q: v }); }}
          className={`${field} w-56`} />
        <button onClick={() => change({ bought: !filters.bought })} className={chip(filters.bought)}>Só quem comprou</button>
        <button onClick={() => change({ bots: !filters.bots })} className={chip(filters.bots)}>Mostrar robôs</button>
        {loading && <Loader2 size={14} className={`animate-spin ${muted}`} />}
      </div>

      {error && <div className={`${card} border rounded-xl p-4 text-sm text-rose-500`}>{error}</div>}
      {detail}

      {data && (
        <div className={`${card} border rounded-xl overflow-hidden ${loading ? 'opacity-60' : ''}`}>
          <div className={`px-3 py-2 text-xs ${muted}`}>{qty(data.total)} {data.total === 1 ? 'visita' : 'visitas'}{filters.bought ? ' de quem comprou no período' : ''}. Clique numa linha para ver a visita inteira.</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Quando</th>
                  <th className={`${th} text-left`}>Local</th>
                  <th className={`${th} text-left`}>Aparelho</th>
                  <th className={`${th} text-left`}>Origem</th>
                  <th className={`${th} text-left`}>Palavra-chave</th>
                  <th className={`${th} text-left`}>Campanha</th>
                  <th className={`${th} text-right`}>Páginas</th>
                  <th className={`${th} text-right`}>Tempo</th>
                  <th className={`${th} text-left`}>Chegou até</th>
                </tr>
              </thead>
              <tbody>
                {data.visits.map((v: any) => (
                  <tr key={v.click_id} onClick={() => show(v.click_id)}
                    className={`cursor-pointer transition-colors ${open?.click_id === v.click_id ? (ui.isDark ? 'bg-slate-800/60' : 'bg-indigo-50') : ui.isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{opening === v.click_id ? <Loader2 size={13} className="animate-spin" /> : when(v.created_at)}</td>
                    <td className={`${td} ${head} max-w-[200px] truncate`} title={place(v)}>{place(v) || <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{[DEVICE[v.device], v.os, v.browser].filter(Boolean).join(' · ') || <span className={muted}>—</span>}{v.is_bot ? <span className="text-amber-500"> · robô</span> : null}</td>
                    <td className={`${td} whitespace-nowrap`}>{TRAFFIC[v.traffic] || <span className={muted}>—</span>}</td>
                    <td className={`${td} ${head} max-w-[220px] truncate`} title={v.keyword || ''}>{v.keyword || <span className={muted}>—</span>}</td>
                    <td className={`${td} max-w-[220px] truncate`} title={v.campaign}>{v.campaign || <span className={muted}>—</span>}</td>
                    <td className={`${td} text-right tabular-nums`}>{v.pages || <span className={muted}>—</span>}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{v.seconds ? lasted(v.seconds) : <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {v.reached === 'entrada' ? <span className={muted}>Só a entrada</span>
                        : <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${REACHED[v.reached].cls}`}>{REACHED[v.reached].label}{v.sale ? ` ${money(v.sale.amount, v.sale.currency)}` : ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.visits.length === 0 && <div className={`p-6 text-sm ${muted}`}>Nenhuma visita com esses filtros neste período.</div>}
          <div className={`flex items-center justify-between gap-3 px-3 py-2 text-xs ${muted}`}>
            <span>Localização por IP: <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="hover:underline">DB-IP</a>. A cidade é aproximada.</span>
            {data.pages > 1 && (
              <span className="flex items-center gap-2">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="font-bold disabled:opacity-40 hover:text-indigo-400">Anterior</button>
                <span className="tabular-nums">{page + 1} de {data.pages}</span>
                <button disabled={page + 1 >= data.pages} onClick={() => setPage(p => p + 1)} className="font-bold disabled:opacity-40 hover:text-indigo-400">Próxima</button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
