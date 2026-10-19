"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { api, post, qty, money, when, clock, lasted, place, path, DEVICE, TRAFFIC, type Ui } from './shared';

/**
 * Aba Visitas: cada visita às páginas, com de onde veio (anúncio, palavra-chave,
 * local, aparelho) e até onde chegou. Clicar numa linha abre a visita inteira:
 * tudo o que veio na URL, o visitante e a linha do tempo até a venda.
 *
 * Na visita aberta, "Esta visita gerou uma venda" liga a ela uma venda que
 * chegou sem campanha (ou uma digitada): a venda entra na campanha da visita e
 * segue para o Google pelo envio automático.
 *
 * Rotas: /api/tracking/visits e /api/tracking/events (POST, a venda ligada).
 */

export type UnmatchedSale = { id: string; at: string; at_text?: string; amount: number; currency: string; order: string; source: string; product: string };

const REACHED: Record<string, { label: string; cls: string }> = {
  venda: { label: 'Venda', cls: 'bg-pos/10 text-pos' },
  checkout: { label: 'Checkout', cls: 'bg-warn/10 text-warn' },
  video: { label: 'Segunda página', cls: 'bg-brand/15 text-brand-text' },
  entrada: { label: 'Só a entrada', cls: '' },
};
/** Nome simples de cada campo que chega na URL do anúncio. */
const PARAM: Record<string, string> = {
  gclid: 'Clique do Google', gbraid: 'Clique do Google (iPhone)', wbraid: 'Clique do Google (app)', ftgid: 'Clique do Google (via FlowTracking)', amclid: 'Clique do Google (pelo Autometrics)',
  utm_id: 'Campanha (número)', gad_campaignid: 'Campanha (número, do Google)', utm_campaign: 'Campanha (nome)', utm_source: 'Origem',
  utm_medium: 'Grupo de anúncios', utm_content: 'Anúncio', utm_term: 'Palavra-chave', keyword: 'Palavra-chave', matchtype: 'Tipo de correspondência',
  network: 'Rede', device: 'Aparelho (pelo Google)', gad_source: 'Origem (do Google)', ft_sid: 'Sessão da FlowTracking', src: 'Marcação da página',
  loc_physical_ms: 'Local (número do Google)', devicemodel: 'Modelo do aparelho', extensionid: 'Extensão clicada', placement: 'Site onde o anúncio apareceu',
};

export function VisitsTab({ ui, period, linking, onLinkDone }: { ui: Ui; period: string; linking?: UnmatchedSale | null; onLinkDone?: () => void }) {
  const [filters, setFilters] = useState({ product_id: '', traffic: '', device: '', q: '', bought: false, checkout: !!linking, bots: false });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<any>(null);
  // O detalhe abre acima da tabela: ao abrir, a tela rola até ele e o foco vai para lá.
  const detailRef = useRef<HTMLDivElement>(null);
  const openId = open?.click_id;
  useEffect(() => {
    if (!openId || !detailRef.current) return;
    detailRef.current.focus({ preventScroll: true });
    detailRef.current.scrollIntoView({ block: 'start' });
  }, [openId]);
  const [opening, setOpening] = useState('');
  const request = useRef(0);

  const query = `${period}&page=${page}&product_id=${filters.product_id}&traffic=${filters.traffic}&device=${filters.device}&q=${encodeURIComponent(filters.q)}${filters.bought ? '&bought=1' : ''}${filters.checkout ? '&checkout=1' : ''}${filters.bots ? '&bots=1' : ''}`;
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
  // Ligando uma venda: começa pelas visitas que saíram para comprar.
  useEffect(() => { if (linking) change({ checkout: true }); }, [linking?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = async (clickId: string, keep = false) => {
    if (!keep && open?.click_id === clickId) { setOpen(null); return; }
    setOpening(clickId);
    const { ok, body } = await api(`/api/tracking/visits?id=${encodeURIComponent(clickId)}`);
    setOpen(ok ? body : null);
    setOpening('');
  };
  const linked = () => { if (open) show(open.click_id, true); load(); onLinkDone?.(); };

  const { card, head, muted, line, th, td, title, field } = ui;
  const chip = (on: boolean) => `px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${on ? 'bg-surface-3 border-line-strong text-ink' : `${line} ${muted} hover:text-ink`}`;
  const info = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 text-[13px]"><span className={muted}>{label}</span><span className={`${head} text-right break-all`}>{value || <span className={muted}>—</span>}</span></div>
  );

  const detail = open && (
    <div ref={detailRef} tabIndex={-1} aria-label="Detalhe da visita" className={`${card} border rounded-xl p-4 space-y-4 scroll-mt-4 focus:outline-none`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-medium ${head}`}>Visita de {when(open.created_at)}{place(open) ? ` · ${place(open)}` : ''}</div>
          <div className={`text-xs mt-0.5 ${muted}`}>{open.campaign || 'Sem campanha ligada'}</div>
        </div>
        <button onClick={() => setOpen(null)} aria-label="Fechar a visita" className={muted}><X size={18} aria-hidden="true" /></button>
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
          {open.is_bot && <div className="text-xs text-warn mt-1">Parece um robô, não uma pessoa.</div>}
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
                <span className={`min-w-0 break-all ${t.kind === 'sale' ? 'text-pos font-medium' : t.kind === 'checkout' || t.kind === 'saida' ? 'text-warn' : head}`}>
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
      <SaleLinker ui={ui} visit={open} preset={linking || null} onDone={linked} />
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
        <CampaignSearch ui={ui} period={period} value={filters.product_id} onChange={id => change({ product_id: id })} />
        <select value={filters.traffic} onChange={e => change({ traffic: e.target.value })} aria-label="Origem" className={field}>
          <option value="">Toda origem</option>
          {Object.entries(TRAFFIC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.device} onChange={e => change({ device: e.target.value })} aria-label="Aparelho" className={field}>
          <option value="">Todo aparelho</option>
          {Object.entries(DEVICE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input defaultValue={filters.q} placeholder="Palavra-chave, cidade, país ou IP" aria-label="Buscar por palavra-chave, cidade, país ou IP (Enter para buscar)"
          onKeyDown={e => { if (e.key === 'Enter') change({ q: (e.target as HTMLInputElement).value.trim() }); }}
          onBlur={e => { const v = e.target.value.trim(); if (v !== filters.q) change({ q: v }); }}
          className={`${field} w-56`} />
        <button onClick={() => change({ bought: !filters.bought })} aria-pressed={filters.bought} className={chip(filters.bought)}>Só quem comprou</button>
        <button onClick={() => change({ checkout: !filters.checkout })} aria-pressed={filters.checkout} className={chip(filters.checkout)}>Saíram para comprar</button>
        <button onClick={() => change({ bots: !filters.bots })} aria-pressed={filters.bots} className={chip(filters.bots)}>Mostrar robôs</button>
        {loading && <Loader2 size={14} aria-hidden="true" className={`animate-spin ${muted}`} />}
      </div>

      {linking && (
        <div className="border border-brand/40 bg-brand/10 rounded-xl p-3 text-[13px] text-ink flex flex-wrap items-center justify-between gap-2">
          <span>Ligando a venda de <b>{money(linking.amount, linking.currency)}</b> de {linking.at_text || when(linking.at)}{linking.product ? ` (${linking.product})` : ''}. Abra a visita que gerou a venda e use “Esta visita gerou uma venda”.</span>
          <button onClick={onLinkDone} className="text-xs font-medium text-ink-subtle hover:text-ink">Cancelar</button>
        </div>
      )}
      <div aria-live="polite">{error && <div className={`${card} border rounded-xl p-4 text-sm text-neg`}>{error}</div>}</div>
      {detail}

      {data && (
        <div className={`${card} border rounded-xl overflow-hidden ${loading ? 'opacity-60' : ''}`}>
          <div className={`px-3 py-2 text-xs ${muted}`}>{qty(data.total)} {data.total === 1 ? 'visita' : 'visitas'}{filters.bought ? ' de quem comprou no período' : filters.checkout ? ' de quem saiu para comprar no período' : ''}. Clique numa linha para ver a visita inteira.</div>
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
                    className={`cursor-pointer transition-colors ${open?.click_id === v.click_id ? 'bg-surface-3' : 'hover:bg-surface-2'}`}>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{opening === v.click_id ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : (
                      <button type="button" onClick={e => { e.stopPropagation(); show(v.click_id); }} aria-label={`Ver a visita de ${when(v.created_at)}`}
                        className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{when(v.created_at)}</button>
                    )}</td>
                    <td className={`${td} ${head} max-w-[200px] truncate`} title={place(v)}>{place(v) || <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{[DEVICE[v.device], v.os, v.browser].filter(Boolean).join(' · ') || <span className={muted}>—</span>}{v.is_bot ? <span className="text-warn"> · robô</span> : null}</td>
                    <td className={`${td} whitespace-nowrap`}>{TRAFFIC[v.traffic] || <span className={muted}>—</span>}</td>
                    <td className={`${td} ${head} max-w-[220px] truncate`} title={v.keyword || ''}>{v.keyword || <span className={muted}>—</span>}</td>
                    <td className={`${td} max-w-[220px] truncate`} title={v.campaign}>{v.campaign || <span className={muted}>—</span>}</td>
                    <td className={`${td} text-right tabular-nums`}>{v.pages || <span className={muted}>—</span>}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{v.seconds ? lasted(v.seconds) : <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {v.reached === 'entrada' ? <span className={muted}>Só a entrada</span>
                        : <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${REACHED[v.reached].cls}`}>{REACHED[v.reached].label}{v.sale ? ` ${money(v.sale.amount, v.sale.currency)}` : ''}</span>}
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
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="font-medium disabled:opacity-40 hover:text-ink">Anterior</button>
                <span className="tabular-nums">{page + 1} de {data.pages}</span>
                <button disabled={page + 1 >= data.pages} onClick={() => setPage(p => p + 1)} className="font-medium disabled:opacity-40 hover:text-ink">Próxima</button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Busca pelo nome das campanhas que tiveram visita no período. Digitar filtra a
 * lista; escolher uma mostra só as visitas dela.
 */
function CampaignSearch({ ui, period, value, onChange }: { ui: Ui; period: string; value: string; onChange: (id: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string; visits: number }[]>([]);
  const [text, setText] = useState('');
  const [openList, setOpenList] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    api(`/api/tracking/visits?${period}&campaigns=1`).then(({ ok, body }) => { if (alive) setList(ok ? body.campaigns || [] : []); });
    return () => { alive = false; };
  }, [period]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpenList(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const chosen = list.find(c => c.id === value);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = list.filter(c => words.every(w => c.name.toLowerCase().includes(w))).slice(0, 40);
  const pick = (id: string) => { onChange(id); setText(''); setOpenList(false); };
  const { field, muted } = ui;

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search size={13} aria-hidden="true" className={`absolute left-2 top-1/2 -translate-y-1/2 ${muted}`} />
        <input value={openList ? text : chosen?.name || text} placeholder={value && !chosen ? 'Campanha escolhida' : 'Buscar campanha pelo nome'}
          role="combobox" aria-expanded={openList} aria-controls="campaign-options" aria-label="Buscar campanha pelo nome (só as que tiveram visita no período)"
          onFocus={() => { setOpenList(true); setText(''); setActive(0); }}
          onChange={e => { setText(e.target.value); setOpenList(true); setActive(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); pick(shown[active].id); (e.target as HTMLInputElement).blur(); }
            else if (e.key === 'Escape') { setOpenList(false); (e.target as HTMLInputElement).blur(); }
          }}
          className={`${field} w-64 pl-7 ${value ? 'pr-7' : ''}`} />
        {value && <button onClick={() => pick('')} aria-label="Mostrar todas as campanhas" className={`absolute right-2 top-1/2 -translate-y-1/2 ${muted} hover:text-ink`}><X size={13} aria-hidden="true" /></button>}
      </div>
      {openList && (
        <div id="campaign-options" role="listbox" className="absolute z-20 mt-1 w-[min(420px,85vw)] max-h-72 overflow-y-auto rounded-lg border border-line bg-surface-1 shadow-lg py-1">
          <button role="option" aria-selected={!value} onMouseDown={e => e.preventDefault()} onClick={() => pick('')} className={`w-full text-left px-3 py-1.5 text-[13px] ${muted} hover:bg-surface-2`}>Todas as campanhas</button>
          {shown.map((c, i) => (
            <button key={c.id} role="option" aria-selected={c.id === value} onMouseDown={e => e.preventDefault()} onClick={() => pick(c.id)} onMouseEnter={() => setActive(i)}
              className={`w-full flex items-center justify-between gap-3 text-left px-3 py-1.5 text-[13px] text-ink ${i === active ? 'bg-surface-2' : ''}`}>
              <span className="truncate">{c.name}</span><span className={`tabular-nums shrink-0 text-xs ${muted}`}>{qty(c.visits)} {c.visits === 1 ? 'visita' : 'visitas'}</span>
            </button>
          ))}
          {shown.length === 0 && <div className={`px-3 py-2 text-[13px] ${muted}`}>{list.length ? 'Nenhuma campanha com esse nome teve visita no período.' : 'Nenhuma campanha teve visita no período.'}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * "Esta visita gerou uma venda": escolhe uma venda que chegou sem campanha (ou
 * digita valor e pedido) e registra na campanha da visita, ligada ao clique.
 */
function SaleLinker({ ui, visit, preset, onDone }: { ui: Ui; visit: any; preset: UnmatchedSale | null; onDone: () => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [sales, setSales] = useState<UnmatchedSale[] | null>(null);
  const [choice, setChoice] = useState<string>(preset?.id || '');
  const [manual, setManual] = useState({ amount: '', currency: 'USD', order: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Outra visita aberta: começa do zero. Venda escolhida na aba Vendas: já abre com ela marcada.
  useEffect(() => { setOpenForm(!!preset); setMsg(null); setChoice(preset?.id || ''); }, [visit.click_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (preset) { setOpenForm(true); setChoice(preset.id); } }, [preset?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!openForm || sales) return;
    api('/api/tracking/events?type=unmatched').then(({ ok, body }) => {
      const list: UnmatchedSale[] = ok ? body.sales || [] : [];
      setSales(list);
      setChoice(c => c || (list[0]?.id ?? 'manual'));
    });
  }, [openForm, sales]);

  const { title, muted, field } = ui;
  if (!visit.product_id) return (
    <div><div className={title}>Venda</div><p className={`text-[13px] mt-1 ${muted}`}>Esta visita não tem campanha ligada, então não dá para registrar uma venda nela.</p></div>
  );
  const save = async () => {
    setSaving(true); setMsg(null);
    const manualOn = choice === 'manual';
    const { ok, body } = await post('/api/tracking/events', manualOn
      ? { click_id: visit.click_id, amount: Number(manual.amount.replace(',', '.')), currency: manual.currency, order: manual.order }
      : { click_id: visit.click_id, unmatched_id: choice });
    setSaving(false);
    if (!ok) { setMsg({ ok: false, text: body.error || 'Não foi possível registrar a venda.' }); return; }
    setMsg({ ok: true, text: `Venda registrada em ${body.campaign}. ${body.googleOn ? 'Ela vai para o Google na próxima rodada do envio automático (alguns minutos).' : 'O envio automático ao Google está desligado neste login; ligue em Instalação → Conversão Automática para ela ir ao Google.'}` });
    setSales(null); setOpenForm(false);
    onDone();
  };
  const ready = choice === 'manual' ? Number(manual.amount.replace(',', '.')) > 0 : !!choice;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className={title}>Venda</div>
        {!openForm && <button onClick={() => { setOpenForm(true); setMsg(null); }} className="px-2.5 py-1 rounded-lg border border-line text-xs font-medium text-ink hover:bg-surface-2">Esta visita gerou uma venda</button>}
      </div>
      <div aria-live="polite">{msg && <p className={`text-[13px] mt-2 ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.text}</p>}</div>
      {openForm && (
        <div className="mt-2 rounded-lg border border-line p-3 space-y-2">
          <p className={`text-[13px] ${muted}`}>A venda entra em <b className="text-ink">{visit.campaign || 'esta campanha'}</b>, ligada a este clique, e vai para o Google como venda deste clique.</p>
          {!sales ? <div className={`flex items-center gap-2 text-[13px] ${muted}`}><Loader2 size={13} aria-hidden="true" className="animate-spin" /> Procurando vendas sem campanha…</div> : (
            <fieldset className="space-y-1">
              <legend className={`text-xs font-medium ${muted} mb-1`}>{sales.length ? 'Vendas que chegaram sem campanha' : 'Nenhuma venda sem campanha nos últimos 30 dias.'}</legend>
              {sales.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
                  <input type="radio" name="sale" checked={choice === s.id} onChange={() => setChoice(s.id)} />
                  <span className="tabular-nums font-medium">{money(s.amount, s.currency)}</span>
                  <span className={muted}>{s.at_text || when(s.at)}{s.source ? ` · ${s.source}` : ''}{s.product ? ` · ${s.product}` : ''}{s.order ? ` · pedido ${s.order}` : ''}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
                <input type="radio" name="sale" checked={choice === 'manual'} onChange={() => setChoice('manual')} />
                Outra venda (digitar valor e pedido)
              </label>
              {choice === 'manual' && (
                <div className="flex flex-wrap items-center gap-2 pl-6 pt-1">
                  <select value={manual.currency} onChange={e => setManual(m => ({ ...m, currency: e.target.value }))} aria-label="Moeda" className={field}>
                    <option value="USD">US$</option><option value="BRL">R$</option><option value="EUR">€</option>
                  </select>
                  <input value={manual.amount} onChange={e => setManual(m => ({ ...m, amount: e.target.value }))} inputMode="decimal" placeholder="Valor" aria-label="Valor da venda" className={`${field} w-24`} />
                  <input value={manual.order} onChange={e => setManual(m => ({ ...m, order: e.target.value }))} placeholder="Número do pedido" aria-label="Número do pedido na plataforma" className={`${field} w-40`} />
                  <span className={`text-xs ${muted}`}>Com o número do pedido, se o postback chegar depois a venda não conta duas vezes.</span>
                </div>
              )}
            </fieldset>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button disabled={!ready || saving} onClick={save} className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium disabled:opacity-50 flex items-center gap-1.5">
              {saving && <Loader2 size={12} aria-hidden="true" className="animate-spin" />} Registrar a venda nesta visita
            </button>
            <button onClick={() => setOpenForm(false)} className={`text-xs font-medium ${muted} hover:text-ink`}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
