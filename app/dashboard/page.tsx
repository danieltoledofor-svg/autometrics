"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation'; 
import { 
  ArrowLeft, Columns, X, ArrowDownRight, ExternalLink, Calendar, Link as LinkIcon, 
  PlayCircle, PauseCircle, RefreshCw, FileText, Save 
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Helper para Data Local
function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const ALL_COLUMNS = [
  { key: 'date', label: 'Data', category: 'Geral', default: true },
  { key: 'campaign_status', label: 'Status Dia', category: 'Geral', default: true },
  { key: 'account_name', label: 'Conta', category: 'Geral', default: true },
  { key: 'impressions', label: 'Impressões', category: 'Tráfego', default: true },
  { key: 'clicks', label: 'Cliques', category: 'Tráfego', default: true },
  { key: 'ctr', label: 'CTR', category: 'Tráfego', default: true, format: 'percentage' },
  { key: 'avg_cpc', label: 'CPC Médio', category: 'Custo', default: true, format: 'currency' }, 
  { key: 'budget', label: 'Orçamento Diário', category: 'Custo', default: true, format: 'currency' },
  { key: 'cost', label: 'Custo Ads', category: 'Custo', default: true, format: 'currency' },
  { key: 'visits', label: 'Visitas Pág.', category: 'Funil', default: true },
  { key: 'checkouts', label: 'Checkout', category: 'Funil', default: true },
  { key: 'conversions', label: 'Conversões', category: 'Financeiro', default: true },
  { key: 'revenue', label: 'Receita Total', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'refunds', label: 'Reembolso', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'cpa', label: 'Custo/Conv (CPA)', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'profit', label: 'Lucro (R$)', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'roi', label: 'ROI (%)', category: 'Financeiro', default: true, format: 'percentage' },
  { key: 'strategy', label: 'Estratégia', category: 'Google Ads', default: true },
  { key: 'target_cpa', label: 'Meta (CPA/ROAS)', category: 'Google Ads', default: true, format: 'currency' },
  { key: 'search_impr_share', label: 'Parc. Impr.', category: 'Google Ads', default: false, format: 'percentage_share' },
  { key: 'search_top_share', label: 'Parc. Topo', category: 'Google Ads', default: false, format: 'percentage_share' },
  { key: 'search_abs_share', label: 'Parc. Absoluta', category: 'Google Ads', default: false, format: 'percentage_share' },
  { key: 'final_url', label: 'Página Anúncio', category: 'Google Ads', default: false, type: 'link' },
];

export default function ProductDetailPage() {
  const params = useParams();
  const productId = typeof params?.id === 'string' ? params.id : '';

  // Datas com ajuste local
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1); // Primeiro dia do mês
    return getLocalYYYYMMDD(date);
  });
  const [endDate, setEndDate] = useState(() => getLocalYYYYMMDD(new Date()));

  const [product, setProduct] = useState<any>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('BRL');
  const [liveDollar, setLiveDollar] = useState(6.00); 
  const [manualDollar, setManualDollar] = useState(5.60); 

  // Estado do Lançamento Manual (com data corrigida)
  const [manualData, setManualData] = useState({ date: getLocalYYYYMMDD(new Date()), visits: 0, sales: 0, revenue: 0, refunds: 0 });
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState(
    ALL_COLUMNS.filter(c => c.default).map(c => c.key)
  );

  useEffect(() => {
    const savedColumns = localStorage.getItem('autometrics_visible_columns');
    if (savedColumns) try { setVisibleColumns(JSON.parse(savedColumns)); } catch (e) {}
    const savedDollar = localStorage.getItem('autometrics_manual_dollar');
    if (savedDollar) setManualDollar(parseFloat(savedDollar));
    fetchLiveDollar();
  }, []);

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
    } catch (e) { console.error(e); }
  }

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: prodData } = await supabase.from('products').select('*').eq('id', productId).single();
      if (prodData) setProduct(prodData);
      const { data: metricsData } = await supabase.from('daily_metrics').select('*').eq('product_id', productId).order('date', { ascending: true });
      setMetrics(metricsData || []);
    } catch (error) { console.error(error); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if(productId) fetchData(); }, [productId]);

  const handleSaveManual = async () => {
    setIsSavingManual(true);
    try {
      const payload = {
        product_id: productId,
        date: manualData.date,
        visits: Number(manualData.visits),
        conversions: Number(manualData.sales),
        conversion_value: Number(manualData.revenue),
        refunds: Number(manualData.refunds),
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('daily_metrics').upsert(payload, { onConflict: 'product_id, date' });
      if(error) throw error;
      alert('Dados salvos!');
      setShowManualEntry(false);
      fetchData();
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setIsSavingManual(false); }
  };

  const toggleStatus = async () => {
    if (!product) return;
    const newStatus = product.status === 'active' ? 'paused' : 'active';
    setProduct({ ...product, status: newStatus });
    await supabase.from('products').update({ status: newStatus }).eq('id', product.id);
  };

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const updatedColumns = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem('autometrics_visible_columns', JSON.stringify(updatedColumns));
      return updatedColumns;
    });
  };

  const processedData = useMemo(() => {
    const filteredMetrics = metrics.filter(m => m.date >= startDate && m.date <= endDate);
    const stats = { revenue: 0, cost: 0, profit: 0, roi: 0, conversions: 0, clicks: 0, visits: 0 };
    if (!filteredMetrics.length) return { rows: [], stats, chart: [] };

    const rows = filteredMetrics.map(row => {
      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);
      let cpc = Number(row.avg_cpc || 0);
      let budget = Number(row.budget_micros || 0) / 1000000;
      let targetValue = Number(row.target_cpa || 0);
      
      const rowCurrency = row.currency || 'BRL';
      
      if (viewCurrency === 'BRL' && rowCurrency === 'USD') {
        cost *= liveDollar; cpc *= liveDollar; budget *= liveDollar; targetValue *= liveDollar;
        revenue *= manualDollar; refunds *= manualDollar;
      } else if (viewCurrency === 'ORIGINAL' && rowCurrency === 'BRL') {
        cost /= liveDollar; revenue /= manualDollar; refunds /= manualDollar; 
      }

      const profit = revenue - refunds - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const conversions = Number(row.conversions || 0);
      const cpa = conversions > 0 ? cost / conversions : 0;

      stats.revenue += revenue; stats.cost += cost; stats.profit += profit;
      stats.conversions += conversions; stats.clicks += Number(row.clicks || 0); stats.visits += Number(row.visits || 0);

      const dateParts = row.date.split('-');
      const shortDate = `${dateParts[2]}/${dateParts[1]}`;
      const fullDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
      const parseShare = (val: any) => (!val || val === '< 10%') ? 0 : parseFloat(val);

      return {
        ...row, date: fullDate, shortDate, cost, revenue, refunds, profit, roi, avg_cpc: cpc, budget, cpa, target_cpa: targetValue,
        ctr: Number(row.ctr || 0), account_name: row.account_name || '-', campaign_status: row.campaign_status || 'ENABLED', 
        strategy: row.bidding_strategy || '-', final_url: row.final_url,
        search_impr_share: parseShare(row.search_impression_share), search_top_share: parseShare(row.search_top_impression_share), search_abs_share: parseShare(row.search_abs_top_share),
      };
    });

    stats.roi = stats.cost > 0 ? (stats.profit / stats.cost) * 100 : 0;
    const chartData = rows.map(r => ({ day: r.shortDate, lucro: r.profit, custo: r.cost, receita: r.revenue }));
    return { rows: rows.reverse(), chart: chartData, stats };
  }, [metrics, viewCurrency, startDate, endDate, liveDollar, manualDollar]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency === 'BRL' ? 'BRL' : 'USD' }).format(val);
  const formatPercent = (val: number) => `${val.toFixed(2)}%`;
  const formatShare = (val: number) => val === 0 ? '< 10%' : `${(val * 100).toFixed(2)}%`;

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500 animate-pulse">Carregando dados...</div>;
  if (!product) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500">Produto não encontrado.</div>;

  const { rows, stats, chart } = processedData;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-6 relative">
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
        <div className="flex items-center gap-4">
          <Link href="/products" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><ArrowLeft size={20} /></Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{product.name}</h1>
              <button onClick={toggleStatus} className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase border ${product.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20'}`}>{product.status === 'active' ? <PlayCircle size={12} /> : <PauseCircle size={12} />} {product.status === 'active' ? 'Ativo' : 'Pausado'}</button>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-1"><span className="flex items-center gap-1"><ExternalLink size={12}/> {product.platform}</span><span>•</span><span className="font-mono text-xs bg-slate-900 px-1 rounded">{product.google_ads_campaign_name}</span></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 w-full xl:w-auto items-end">
          <button onClick={() => setShowManualEntry(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-900/20"><FileText size={14} /> Lançamento Manual</button>
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 items-center">
            <div className="flex items-center gap-2 px-3 border-r border-slate-800"><Calendar size={14} className="text-indigo-400"/><span className="text-xs font-bold text-slate-500 uppercase">Período</span></div>
            <input type="date" className="bg-transparent text-white text-xs font-mono p-2 outline-none [&::-webkit-calendar-picker-indicator]:invert" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <span className="text-slate-600">-</span>
            <input type="date" className="bg-transparent text-white text-xs font-mono p-2 outline-none [&::-webkit-calendar-picker-indicator]:invert" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
             <button onClick={() => setViewCurrency('ORIGINAL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'ORIGINAL' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>USD</button>
             <button onClick={() => setViewCurrency('BRL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'BRL' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>BRL</button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl border-t-4 border-t-blue-500"><p className="text-slate-500 text-xs font-bold uppercase mb-2">Receita Total</p><p className="text-2xl font-bold text-blue-500">{formatMoney(stats.revenue)}</p></div>
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl border-t-4 border-t-orange-500"><p className="text-slate-500 text-xs font-bold uppercase mb-2">Custo Ads</p><p className="text-2xl font-bold text-orange-500">{formatMoney(stats.cost)}</p></div>
        <div className={`bg-slate-900/50 border border-slate-800 p-5 rounded-xl border-t-4 ${stats.profit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'}`}><p className="text-slate-500 text-xs font-bold uppercase mb-2">Lucro Líquido</p><p className={`text-2xl font-bold ${stats.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(stats.profit)}</p></div>
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl border-t-4 border-t-indigo-500"><p className="text-slate-500 text-xs font-bold uppercase mb-2">ROI</p><p className="text-2xl font-bold text-indigo-500">{stats.roi.toFixed(1)}%</p></div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-8 h-64">
         <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
               <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
               <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
               <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }} formatter={(val:any) => formatMoney(val)} />
               <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
               <Bar dataKey="cost" name="Custo" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={40} />
               <Bar dataKey="lucro" name="Lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
         </ResponsiveContainer>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm relative flex flex-col h-[600px]">
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center bg-slate-900/50 gap-4 shrink-0">
          <div className="flex items-center gap-3"><h3 className="font-semibold text-white">Histórico Detalhado</h3><span className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">{rows.length} registros</span></div>
          <button onClick={() => setShowColumnModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors border border-slate-700"><Columns size={14} /> Personalizar Colunas</button>
        </div>
        <div className="overflow-auto custom-scrollbar flex-1">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-xs text-slate-500 uppercase bg-slate-950 font-semibold sticky top-0 z-20 shadow-lg">
              <tr>{ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (<th key={col.key} className="px-4 py-4 whitespace-nowrap border-b border-slate-800 text-right bg-slate-950 first:text-left first:sticky first:left-0 first:z-30">{col.label}</th>))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-slate-800/50 transition-colors group">
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => {
                    const val = row[col.key];
                    let content;
                    if (col.key === 'date') return <td key={col.key} className="px-4 py-4 font-medium text-white sticky left-0 bg-slate-900 group-hover:bg-slate-800 border-r border-slate-800">{val}</td>
                    if (col.key === 'campaign_status') content = <span className={`flex items-center justify-end gap-1.5 ${val === 'PAUSED' ? 'text-slate-500' : 'text-emerald-400'}`}>{val} {val === 'PAUSED' ? <PauseCircle size={14}/> : <PlayCircle size={14}/>}</span>;
                    else if (col.type === 'link') content = val ? <a href={val} target="_blank" className="text-indigo-400 hover:text-indigo-300 flex justify-end"><LinkIcon size={14}/></a> : '-';
                    else if (col.format === 'currency') content = <span className={col.key === 'profit' ? (val >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold') : (col.key === 'revenue' ? 'text-blue-500 font-bold' : (col.key === 'cost' ? 'text-orange-500 font-medium' : 'text-slate-300'))}>{formatMoney(val)}</span>;
                    else if (col.format === 'percentage') content = <span>{formatPercent(val)}</span>;
                    else if (col.format === 'percentage_share') content = <span>{formatShare(val)}</span>;
                    else content = <span className="text-slate-400">{val}</span>;
                    return <td key={col.key} className="px-4 py-4 whitespace-nowrap text-right">{content}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {showManualEntry && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold text-white flex items-center gap-2"><FileText size={20} className="text-indigo-500"/> Lançamento Rápido</h2><button onClick={() => setShowManualEntry(false)}><X size={24} className="text-slate-400 hover:text-white" /></button></div>
              <div className="space-y-4">
                 <div><label className="text-xs uppercase text-slate-500 font-bold">Data</label><input type="date" className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white" value={manualData.date} onChange={e => setManualData({...manualData, date: e.target.value})} /></div>
                 <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-xs uppercase text-slate-500 font-bold">Vendas</label><input type="number" className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white" placeholder="0" value={manualData.sales} onChange={e => setManualData({...manualData, sales: parseFloat(e.target.value)})} /></div>
                    <div><label className="text-xs uppercase text-slate-500 font-bold">Visitas</label><input type="number" className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white" placeholder="0" value={manualData.visits} onChange={e => setManualData({...manualData, visits: parseFloat(e.target.value)})} /></div>
                 </div>
                 <div><label className="text-xs uppercase text-blue-500 font-bold">Receita (Moeda do Produto)</label><input type="number" className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white border-l-4 border-l-blue-500" placeholder="0.00" value={manualData.revenue} onChange={e => setManualData({...manualData, revenue: parseFloat(e.target.value)})} /></div>
                 <div><label className="text-xs uppercase text-rose-500 font-bold">Reembolsos</label><input type="number" className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white border-l-4 border-l-rose-500" placeholder="0.00" value={manualData.refunds} onChange={e => setManualData({...manualData, refunds: parseFloat(e.target.value)})} /></div>
                 <button onClick={handleSaveManual} disabled={isSavingManual} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg mt-4 flex items-center justify-center gap-2">{isSavingManual ? 'Salvando...' : 'Salvar Dados'} <Save size={16} /></button>
              </div>
           </div>
        </div>
      )}

      {showColumnModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center"><h2 className="text-xl font-bold text-white flex items-center gap-2"><Columns size={20} className="text-indigo-500"/> Personalizar Colunas</h2><button onClick={() => setShowColumnModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button></div>
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {['Geral', 'Tráfego', 'Custo', 'Funil', 'Financeiro', 'Google Ads'].map(category => (
                  <div key={category}>
                    {ALL_COLUMNS.some(c => c.category === category) && (
                      <>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-800 pb-2">{category}</h3>
                        <div className="space-y-2">
                          {ALL_COLUMNS.filter(c => c.category === category).map(col => (
                            <div key={col.key} onClick={() => toggleColumn(col.key)} className="flex items-center gap-3 p-2 hover:bg-slate-800 rounded cursor-pointer group transition-colors">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${visibleColumns.includes(col.key) ? 'bg-indigo-600 border-indigo-600' : 'bg-transparent border-slate-600'}`}>
                                {visibleColumns.includes(col.key) && <ArrowDownRight size={14} className="text-white" />}
                              </div>
                              <span className={visibleColumns.includes(col.key) ? 'text-white font-medium' : 'text-slate-400'}>{col.label}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-slate-800 flex justify-end bg-slate-950/50 rounded-b-xl"><button onClick={() => setShowColumnModal(false)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Confirmar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}