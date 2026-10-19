"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Link2, Loader2 } from 'lucide-react';
import { api, qty, money, when, gap, place, DEVICE, type Ui } from './shared';
import type { UnmatchedSale } from './VisitsTab';

/**
 * Abas Vendas e Checkouts: cada evento que a plataforma avisou, com o clique
 * que o gerou e, na venda, se ela foi enviada ao Google.
 *
 * Nas vendas, as que chegaram sem campanha (o postback não disse de qual
 * clique veio) aparecem à parte, com o botão para ligar a uma visita.
 *
 * Rota: /api/tracking/events.
 */

const GOOGLE: Record<string, { label: string; cls: string }> = {
  enviada: { label: 'Enviada', cls: 'bg-pos/10 text-pos' },
  aguardando: { label: 'Aguardando o Google', cls: 'bg-warn/10 text-warn' },
  falhou: { label: 'Recusada', cls: 'bg-neg/10 text-neg' },
  ignorada: { label: 'Não enviada', cls: 'bg-surface-3 text-ink-subtle' },
};

export function EventsTab({ ui, period, type, onLink }: { ui: Ui; period: string; type: 'sale' | 'checkout'; onLink?: (sale: UnmatchedSale) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const sale = type === 'sale';

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    const { ok, body } = await api(`/api/tracking/events?type=${type}&${period}`);
    if (id !== request.current) return;
    if (!ok) { setError(body.error || 'Não foi possível carregar.'); setData(null); } else setData(body);
    setLoading(false);
  }, [type, period]);
  useEffect(() => { load(); }, [load]);

  const { card, head, muted, th, td } = ui;
  if (error) return <div className={`${card} border rounded-xl p-4 text-sm text-neg`}>{error}</div>;
  if (!data) return <div className={`flex items-center gap-2 text-sm ${muted}`}><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Carregando…</div>;

  const unmatched: UnmatchedSale[] = data.unmatched || [];
  const values = Object.entries(data.value as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const stat = (label: string, value: React.ReactNode) => (
    <div className={`${card} border rounded-xl p-4`}><div className={`text-xs font-medium ${muted}`}>{label}</div><div className={`text-lg sm:text-xl font-semibold mt-1 tabular-nums whitespace-nowrap ${head}`}>{value}</div></div>
  );

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {stat(sale ? 'Vendas' : 'Checkouts', qty(data.total))}
        {stat('Ligados a um clique', `${qty(data.linked)}${data.total ? ` · ${Math.round((data.linked / data.total) * 100)}%` : ''}`)}
        {sale && stat('Valor vendido', values.length ? values.map(([c, v]) => money(v, c)).join(' + ') : money(0))}
      </div>

      {sale && unmatched.length > 0 && (
        <div className="bg-surface-1 border border-warn/40 rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-line">
            <div className={`text-sm font-medium ${head}`}>{unmatched.length === 1 ? '1 venda sem campanha' : `${unmatched.length} vendas sem campanha`}</div>
            <div className={`text-xs mt-0.5 ${muted}`}>A plataforma avisou a venda, mas não disse de qual clique veio. Ela ainda não soma em nenhuma campanha: ligue à visita que gerou a venda e ela entra na campanha e vai para o Google.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <tbody>
                {unmatched.map(u => (
                  <tr key={u.id}>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{u.at_text || when(u.at)}</td>
                    <td className={`${td} ${head} text-right tabular-nums font-medium whitespace-nowrap`}>{money(u.amount, u.currency)}</td>
                    <td className={`${td} whitespace-nowrap`}>{u.source || <span className={muted}>—</span>}</td>
                    <td className={`${td} max-w-[200px] truncate`} title={u.product}>{u.product || <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap ${muted}`}>{u.order ? `pedido ${u.order}` : ''}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      {onLink && <button onClick={() => onLink(u)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition-colors"><Link2 size={14} aria-hidden="true" /> Ligar a uma visita</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className={`text-xs ${muted}`}>Dia e hora no relógio de cada plataforma (Instalação → Relógio), o mesmo dia em que {sale ? 'a venda' : 'o checkout'} entra no painel.</p>

      {data.total === 0 && unmatched.length > 0 ? null : data.total === 0 ? (
        <div className={`${card} border rounded-xl p-6 text-sm ${muted}`}>
          {sale ? 'Nenhuma venda neste período.' : 'Nenhum checkout avisado pela plataforma neste período. Confira se o postback do Autometrics na plataforma também está marcado para o evento de checkout.'}
        </div>
      ) : (
        <div className={`${card} border rounded-xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Quando</th>
                  {sale && <th className={`${th} text-right`}>Valor</th>}
                  <th className={`${th} text-left`}>Campanha</th>
                  <th className={`${th} text-left`}>Palavra-chave</th>
                  <th className={`${th} text-left`}>Local</th>
                  <th className={`${th} text-left`}>Aparelho</th>
                  <th className={`${th} text-left`}>Do clique até aqui</th>
                  <th className={`${th} text-left`}>Plataforma</th>
                  {sale && <th className={`${th} text-left`}>Google</th>}
                </tr>
              </thead>
              <tbody>
                {data.events.map((e: any, i: number) => (
                  <tr key={i}>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{e.at_text || when(e.at)}</td>
                    {sale && <td className={`${td} ${head} text-right tabular-nums font-medium whitespace-nowrap`}>{money(e.amount, e.currency)}</td>}
                    <td className={`${td} max-w-[260px] truncate`} title={e.campaign}><Link href={`/products/${e.product_id}`} className={`${head} hover:text-brand-text hover:underline`}>{e.campaign}</Link></td>
                    <td className={`${td} max-w-[200px] truncate`}>{e.click?.keyword || <span className={muted}>—</span>}</td>
                    <td className={`${td} max-w-[180px] truncate`}>{place(e.click) || <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{e.click ? [DEVICE[e.click.device], e.click.os].filter(Boolean).join(' · ') : <span className={muted}>sem clique ligado</span>}</td>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{e.click ? gap(e.click.created_at, e.at) : <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{e.source || <span className={muted}>—</span>}</td>
                    {sale && <td className={`${td} whitespace-nowrap`}>{e.google ? <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${GOOGLE[e.google.status]?.cls || ''}`} title={e.google.reason || ''}>{GOOGLE[e.google.status]?.label || e.google.status}{e.google.reason && <span className="sr-only">: {e.google.reason}</span>}</span> : <span className={muted}>—</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.events.length && <div className={`px-3 py-2 text-xs ${muted}`}>Mostrando os {data.events.length} mais recentes de {qty(data.total)}.</div>}
        </div>
      )}
    </div>
  );
}
