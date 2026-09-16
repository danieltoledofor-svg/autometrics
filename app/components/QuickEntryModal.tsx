"use client";

import React, { useEffect, useState } from 'react';
import { FileText, X, MousePointer, ShoppingCart, Save } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface QuickEntryTarget {
  productId: string;
  productName: string;
  /** Moeda da conta do Google Ads — é nela que o valor é gravado. */
  accountCurrency: string;
  /** Data pré-selecionada, 'YYYY-MM-DD'. */
  date: string;
}

interface Props {
  target: QuickEntryTarget | null;
  onClose: () => void;
  onSaved?: () => void;
  /** Cotação usada para converter quando a moeda do lançamento difere da conta. */
  manualDollar: number;
  isDark: boolean;
}

const EMPTY = { visits: 0, checkouts: 0, vsl_clicks: 0, vsl_checkouts: 0, sales: 0, revenue: 0, refunds: 0 };

export function QuickEntryModal({ target, onClose, onSaved, manualDollar, isDark }: Props) {
  const [data, setData] = useState({ ...EMPTY, date: '', currency: 'BRL' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const productId = target?.productId;
  const accountCurrency = target?.accountCurrency || 'BRL';

  // Ao abrir, e a cada troca de data, recarrega o que já existe naquele dia.
  // O save é um upsert da linha inteira: abrir zerado gravaria zero por cima
  // de valores já lançados.
  useEffect(() => {
    if (!productId || !data.date) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data: row } = await supabase
        .from('daily_metrics')
        .select('visits, checkouts, vsl_clicks, vsl_checkouts, conversions, conversion_value, refunds, currency')
        .eq('product_id', productId)
        .eq('date', data.date)
        .maybeSingle();

      if (cancelled) return;
      setData(prev => ({
        ...prev,
        visits: row?.visits || 0,
        checkouts: row?.checkouts || 0,
        vsl_clicks: row?.vsl_clicks || 0,
        vsl_checkouts: row?.vsl_checkouts || 0,
        sales: row?.conversions || 0,
        revenue: row?.conversion_value || 0,
        refunds: row?.refunds || 0,
        currency: row?.currency || prev.currency,
      }));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [productId, data.date]);

  // Troca de campanha: reposiciona data e moeda; o efeito acima busca os valores.
  useEffect(() => {
    if (!target) return;
    setData({ ...EMPTY, date: target.date, currency: target.accountCurrency || 'BRL' });
  }, [target]);

  if (!target) return null;

  const num = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let revenue = num(data.revenue);
      let refunds = num(data.refunds);

      // O custo vindo do Google está na moeda da conta. Converter aqui evita
      // que receita e custo fiquem em escalas diferentes na mesma linha.
      if (data.currency !== accountCurrency) {
        if (accountCurrency === 'BRL' && data.currency === 'USD') {
          revenue *= manualDollar; refunds *= manualDollar;
        } else if (accountCurrency === 'USD' && data.currency === 'BRL') {
          revenue /= manualDollar; refunds /= manualDollar;
        }
      }

      const { error } = await supabase.from('daily_metrics').upsert({
        product_id: target.productId,
        date: data.date,
        visits: num(data.visits),
        checkouts: num(data.checkouts),
        vsl_clicks: num(data.vsl_clicks),
        vsl_checkouts: num(data.vsl_checkouts),
        conversions: num(data.sales),
        conversion_value: revenue,
        refunds,
        currency: accountCurrency,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'product_id, date' });

      if (error) throw error;
      onSaved?.();
      onClose();
    } catch (e: any) {
      alert('Erro: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const inputCls = `w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-black'}`;
  const field = (label: string, key: keyof typeof EMPTY, accent = 'text-slate-500', extra = '') => (
    <div>
      <label className={`text-[10px] uppercase font-bold ${accent}`}>{label}</label>
      <input
        type="number"
        className={`${inputCls} ${extra}`}
        placeholder="0"
        value={data[key] === 0 ? '' : data[key]}
        onChange={e => setData({ ...data, [key]: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={`${bgCard} border rounded-xl w-full max-w-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]`} onClick={e => e.stopPropagation()}>
        <div className={`flex justify-between items-start gap-4 mb-6 border-b pb-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div className="min-w-0">
            <h2 className={`text-xl font-bold ${textHead} flex items-center gap-2`}>
              <FileText size={20} className="text-indigo-500" /> Lançamento Rápido
            </h2>
            <p className="text-xs text-slate-500 mt-1 break-words">{target.productName}</p>
          </div>
          <button onClick={onClose} className="shrink-0"><X size={24} className="text-slate-400 hover:text-white" /></button>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase text-slate-500 font-bold">Data</label>
              <input
                type="date"
                className={`w-full border rounded p-2 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-black'}`}
                value={data.date}
                onChange={e => setData({ ...data, date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500 font-bold">Moeda</label>
              <select
                className={`w-full border rounded p-2 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-black'}`}
                value={data.currency}
                onChange={e => setData({ ...data, currency: e.target.value })}
              >
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>

          <div className={`p-4 rounded-lg border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <h3 className="text-xs font-bold text-indigo-400 uppercase mb-3 flex items-center gap-2"><MousePointer size={14} /> Tráfego & VSL</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {field('Visitas Pág.', 'visits')}
              {field('Cliques VSL', 'vsl_clicks')}
              {field('Checkout VSL', 'vsl_checkouts')}
              {field('Check. Geral', 'checkouts')}
            </div>
          </div>

          <div className={`p-4 rounded-lg border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <h3 className="text-xs font-bold text-emerald-400 uppercase mb-3 flex items-center gap-2"><ShoppingCart size={14} /> Vendas & Receita</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {field('Vendas (Qtd)', 'sales')}
              {field('Receita Total', 'revenue', 'text-blue-500', 'border-l-4 border-l-blue-500')}
              {field('Reembolsos', 'refunds', 'text-rose-500', 'border-l-4 border-l-rose-500')}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || loading || !data.date}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-4 rounded-xl mt-2 flex items-center justify-center gap-2 shadow-lg transition-colors"
          >
            {loading ? 'Carregando dia...' : saving ? 'Salvando...' : 'Salvar Lançamento'} <Save size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
