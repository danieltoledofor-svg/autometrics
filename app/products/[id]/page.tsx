"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation'; 
import { 
  ArrowLeft, Columns, DollarSign, ArrowRightLeft, ArrowUpRight, Coins, X, ArrowDownRight, ExternalLink, Calendar
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ALL_COLUMNS = [
  { key: 'date', label: 'Data', category: 'Geral', default: true },
  { key: 'impressions', label: 'Impressões', category: 'Tráfego', default: true },
  { key: 'clicks', label: 'Cliques', category: 'Tráfego', default: true },
  { key: 'ctr', label: 'CTR', category: 'Tráfego', default: true },
  { key: 'avg_cpc', label: 'CPC Médio', category: 'Custo', default: true, format: 'currency' }, 
  { key: 'cost', label: 'Custo Ads', category: 'Custo', default: true, format: 'currency' },
  { key: 'visits', label: 'Visitas Pág.', category: 'Funil', default: true },
  { key: 'checkouts', label: 'Checkouts', category: 'Funil', default: false },
  { key: 'conversions', label: 'Vendas', category: 'Financeiro', default: true },
  { key: 'revenue', label: 'Receita', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'refunds', label: 'Reembolso', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'profit', label: 'Lucro', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'roi', label: 'ROI', category: 'Financeiro', default: true, format: 'percentage' },
  { key: 'strategy', label: 'Estratégia', category: 'Google Ads', default: false },
];

export default function ProductDetailPage() {
  const params = useParams();
  const productId = typeof params?.id === 'string' ? params.id : '';

  // Estados de Datas (Padrão: Início do mês até Hoje)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [product, setProduct] = useState<any>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('BRL');
  const [visibleColumns, setVisibleColumns] = useState(ALL_COLUMNS.filter(c => c.default).map(c => c.key));

  // 1. Busca Dados no Banco
  useEffect(() => {
    if (!productId) return;

    async function fetchData() {
      setLoading(true);
      try {
        // Busca Produto
        const { data: prodData } = await supabase.from('products').select('*').eq('id', productId).single();
        if (prodData) setProduct(prodData);

        // Busca Métricas (Trazemos tudo e filtramos no front para ser mais rápido na interface)
        const { data: metricsData } = await supabase
          .from('daily_metrics')
          .select('*')
          .eq('product_id', productId)
          .order('date', { ascending: true });

        setMetrics(metricsData || []);
      } catch (error) {
        console.error("Erro:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [productId]);

  // 2. Processamento (Filtro de Data + Cálculos)
  const processedData = useMemo(() => {
    // A. Filtra pelo intervalo de datas selecionado
    const filteredMetrics = metrics.filter(m => m.date >= startDate && m.date <= endDate);

    if (!filteredMetrics.length) return { rows: [], stats: { revenue: 0, cost: 0, profit: 0, roi: 0, conversions: 0 }, chart: [] };

    const exchangeRate = 6.15; 
    let totalRevenue = 0, totalCost = 0, totalRefunds = 0, totalConversions = 0;

    const rows = filteredMetrics.map(row => {
      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);
      let cpc = Number(row.avg_cpc || 0);
      const rowCurrency = row.currency || 'BRL';
      
      if (viewCurrency === 'BRL' && rowCurrency === 'USD') {
        cost *= exchangeRate; revenue *= exchangeRate; refunds *= exchangeRate; cpc *= exchangeRate;
      } else if (viewCurrency === 'ORIGINAL' && rowCurrency === 'BRL') {
        cost /= exchangeRate; revenue /= exchangeRate; refunds /= exchangeRate; cpc /= exchangeRate;
      }

      const profit = revenue - refunds - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;

      totalRevenue += revenue;
      totalCost += cost;
      totalRefunds += refunds;
      totalConversions += Number(row.conversions || 0);

      const dateParts = row.date.split('-');
      const shortDate = `${dateParts[2]}/${dateParts[1]}`;
      const fullDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

      return {
        ...row, date: fullDate, shortDate, cost, revenue, refunds, profit, roi, avg_cpc: cpc
      };
    });

    const totalProfit = totalRevenue - totalRefunds - totalCost;
    const totalRoi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    // Gráfico (Ordenado por data)
    const chartData = rows.map(r => ({
      day: r.shortDate, lucro: r.profit, custo: r.cost, receita: r.revenue
    }));

    return {
      rows: rows.reverse(), // Tabela: Mais recente primeiro
      chart: chartData,     // Gráfico: Mantém ordem cronológica
      stats: { revenue: totalRevenue, cost: totalCost, profit: totalProfit, roi: totalRoi, conversions: totalConversions }
    };
  }, [metrics, viewCurrency, startDate, endDate]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency === 'BRL' ? 'BRL' : 'USD' }).format(val);

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500 animate-pulse">Carregando dados...</div>;
  if (!product) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500">Produto não encontrado.</div>;

  const { rows, stats, chart } = processedData;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-6 relative">
      
      {/* Header & Filtros */}
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
        <div className="flex items-center gap-4">
          <Link href="/products" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{product.name}</h1>
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">{product.status}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
              <span className="flex items-center gap-1"><ExternalLink size={12}/> {product.platform}</span>
              <span>•</span>
              <span className="font-mono text-xs bg-slate-900 px-1 rounded">{product.google_ads_campaign_name}</span>
            </div>
          </div>
        </div>

        {/* --- NOVO: BARRA DE FERRAMENTAS --- */}
        <div className="flex flex-wrap gap-4 w-full xl:w-auto items-end">
          
          {/* Seletor de Datas */}
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 items-center">
            <div className="flex items-center gap-2 px-3 border-r border-slate-800">
               <Calendar size={14} className="text-indigo-400"/>
               <span className="text-xs font-bold text-slate-500 uppercase">Período</span>
            </div>
            <input 
              type="date" 
              className="bg-transparent text-white text-xs font-mono p-2 outline-none [&::-webkit-calendar-picker-indicator]:invert cursor-pointer"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span className="text-slate-600">-</span>
            <input 
              type="date" 
              className="bg-transparent text-white text-xs font-mono p-2 outline-none [&::-webkit-calendar-picker-indicator]:invert cursor-pointer"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Seletor de Moeda */}
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
             <button onClick={() => setViewCurrency('ORIGINAL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'ORIGINAL' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>USD</button>
             <button onClick={() => setViewCurrency('BRL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'BRL' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>BRL</button>
          </div>
        </div>
      </header>

      {/* Cards KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Lucro Líquido</p>
           <p className={`text-2xl font-bold ${stats.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMoney(stats.profit)}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">ROI</p>
           <p className={`text-2xl font-bold ${stats.roi >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>{stats.roi.toFixed(1)}%</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Receita</p>
           <p className="text-2xl font-bold text-white">{formatMoney(stats.revenue)}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Custo Ads</p>
           <p className="text-2xl font-bold text-amber-500">{formatMoney(stats.cost)}</p>
        </div>
      </div>

      {/* Gráfico */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-8 h-64">
         <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
               <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
               <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
               <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }} formatter={(val:any) => formatMoney(val)} />
               <Bar dataKey="lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={50}>
                  {chart.map((e, i) => <Cell key={i} fill={e.lucro > 0 ? '#10b981' : '#f43f5e'} />)}
               </Bar>
            </BarChart>
         </ResponsiveContainer>
      </div>

      {/* Tabela */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm relative flex flex-col h-[600px]">
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center bg-slate-900/50 gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-white">Histórico Detalhado</h3>
            <span className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">{rows.length} registros</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowColumnModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors border border-slate-700">
              <Columns size={14} /> Colunas
            </button>
          </div>
        </div>

        <div className="overflow-auto custom-scrollbar flex-1">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-xs text-slate-500 uppercase bg-slate-950 font-semibold sticky top-0 z-20 shadow-lg">
              <tr>
                {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (
                  <th key={col.key} className="px-4 py-4 whitespace-nowrap border-b border-slate-800 text-right bg-slate-950 first:text-left first:sticky first:left-0 first:z-30">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-slate-800/50 transition-colors group">
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => {
                    const val = row[col.key];
                    let content;

                    if (col.key === 'date') return <td key={col.key} className="px-4 py-4 font-medium text-white sticky left-0 bg-slate-900 group-hover:bg-slate-800 border-r border-slate-800">{val}</td>
                    
                    if (col.format === 'currency') {
                      content = <span className={col.key === 'profit' ? (val >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold') : 'text-slate-300'}>{formatMoney(val)}</span>;
                    } else if (col.format === 'percentage') {
                      content = <span className={`px-2 py-1 rounded text-xs border ${val < 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{val.toFixed(2)}%</span>;
                    } else if (col.key === 'strategy') {
                      content = <span className="text-xs text-slate-500 truncate block max-w-[100px]" title={val}>{val || '-'}</span>;
                    } else {
                      content = <span className="text-slate-400">{val !== undefined && val !== null ? val : '-'}</span>;
                    }

                    return <td key={col.key} className="px-4 py-4 whitespace-nowrap text-right">{content}</td>;
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center py-12 text-slate-500">
                    Nenhum dado encontrado para o período {startDate.split('-').reverse().join('/')} a {endDate.split('-').reverse().join('/')}.
                    <br/><span className="text-xs">Verifique se você rodou o Script Histórico para essas datas.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Modal de Colunas Mantido (Ocultado para brevidade, mas está incluso na lógica) */}
      {showColumnModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Columns size={20} className="text-indigo-500"/> Personalizar Colunas</h2>
              <button onClick={() => setShowColumnModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {['Geral', 'Tráfego', 'Custo', 'Funil', 'Financeiro', 'Google Ads'].map(category => (
                  <div key={category}>
                    {ALL_COLUMNS.some(c => c.category === category) && (
                      <>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-800 pb-2">{category}</h3>
                        <div className="space-y-2">
                          {ALL_COLUMNS.filter(c => c.category === category).map(col => (
                            <label key={col.key} className="flex items-center gap-3 p-2 hover:bg-slate-800 rounded cursor-pointer group transition-colors">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${visibleColumns.includes(col.key) ? 'bg-indigo-600 border-indigo-600' : 'bg-transparent border-slate-600'}`}>
                                {visibleColumns.includes(col.key) && <ArrowDownRight size={14} className="text-white" />}
                              </div>
                              <span className={visibleColumns.includes(col.key) ? 'text-white font-medium' : 'text-slate-400'}>{col.label}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-slate-800 flex justify-end bg-slate-950/50 rounded-b-xl">
              <button onClick={() => setShowColumnModal(false)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Confirmar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}