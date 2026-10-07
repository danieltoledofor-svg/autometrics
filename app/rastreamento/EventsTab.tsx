"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { api, qty, money, when, gap, place, DEVICE, type Ui } from './shared';

/**
 * Abas Vendas e Checkouts: cada evento que a plataforma avisou, com o clique
 * que o gerou e, na venda, se ela foi enviada ao Google.
 *
 * Rota: /api/tracking/events.
 */

const GOOGLE: Record<string, { label: string; cls: string }> = {
  enviada: { label: 'Enviada', cls: 'bg-emerald-500/15 text-emerald-500' },
  aguardando: { label: 'Aguardando o Google', cls: 'bg-amber-500/15 text-amber-500' },
  falhou: { label: 'Recusada', cls: 'bg-rose-500/15 text-rose-500' },
  ignorada: { label: 'Não enviada', cls: 'bg-slate-500/15 text-slate-400' },
};

export function EventsTab({ ui, period, type }: { ui: Ui; period: string; type: 'sale' | 'checkout' }) {
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
  if (error) return <div className={`${card} border rounded-xl p-4 text-sm text-rose-500`}>{error}</div>;
  if (!data) return <div className={`flex items-center gap-2 text-sm ${muted}`}><Loader2 size={16} className="animate-spin" /> Carregando…</div>;

  const values = Object.entries(data.value as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const stat = (label: string, value: React.ReactNode) => (
    <div className={`${card} border rounded-xl p-4`}><div className={`text-xs font-medium ${muted}`}>{label}</div><div className={`text-2xl font-bold mt-1 tabular-nums ${head}`}>{value}</div></div>
  );

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {stat(sale ? 'Vendas' : 'Checkouts', qty(data.total))}
        {stat('Ligados a um clique', `${qty(data.linked)}${data.total ? ` · ${Math.round((data.linked / data.total) * 100)}%` : ''}`)}
        {sale && stat('Valor vendido', values.length ? values.map(([c, v]) => money(v, c)).join(' + ') : money(0))}
      </div>

      {data.total === 0 ? (
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
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{when(e.at)}</td>
                    {sale && <td className={`${td} ${head} text-right tabular-nums font-bold whitespace-nowrap`}>{money(e.amount, e.currency)}</td>}
                    <td className={`${td} max-w-[260px] truncate`} title={e.campaign}><Link href={`/products/${e.product_id}`} className={`${head} hover:text-indigo-400 hover:underline`}>{e.campaign}</Link></td>
                    <td className={`${td} max-w-[200px] truncate`}>{e.click?.keyword || <span className={muted}>—</span>}</td>
                    <td className={`${td} max-w-[180px] truncate`}>{place(e.click) || <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{e.click ? [DEVICE[e.click.device], e.click.os].filter(Boolean).join(' · ') : <span className={muted}>sem clique ligado</span>}</td>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{e.click ? gap(e.click.created_at, e.at) : <span className={muted}>—</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{e.source || <span className={muted}>—</span>}</td>
                    {sale && <td className={`${td} whitespace-nowrap`}>{e.google ? <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${GOOGLE[e.google.status]?.cls || ''}`} title={e.google.reason || ''}>{GOOGLE[e.google.status]?.label || e.google.status}</span> : <span className={muted}>—</span>}</td>}
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
