"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation'; 
import { 
  ArrowLeft, Columns, X, ArrowDownRight, ExternalLink, Calendar, Link as LinkIcon
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

// --- DEFINIÇÃO COMPLETA DAS COLUNAS (BASEADO NA SUA PLANILHA) ---
const ALL_COLUMNS = [
  // GERAL
  { key: 'date', label: 'Data', category: 'Geral', default: true },
  
  // TRÁFEGO
  { key: 'impressions', label: 'Impressões', category: 'Tráfego', default: true },
  { key: 'clicks', label: 'Cliques', category: 'Tráfego', default: true },
  { key: 'ctr', label: 'CTR', category: 'Tráfego', default: true, format: 'percentage' },
  
  // CUSTOS
  { key: 'avg_cpc', label: 'CPC Médio', category: 'Custo', default: true, format: 'currency' }, 
  { key: 'budget', label: 'Orçamento Diário', category: 'Custo', default: true, format: 'currency' },
  { key: 'cost', label: 'Custo Ads', category: 'Custo', default: true, format: 'currency' },
  
  // FUNIL (MANUAL)
  { key: 'visits', label: 'Visitas Pág.', category: 'Funil', default: true },
  { key: 'checkouts', label: 'Checkout', category: 'Funil', default: true },
  
  // FINANCEIRO
  { key: 'conversions', label: 'Conversões', category: 'Financeiro', default: true },
  { key: 'revenue', label: 'Receita Total', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'refunds', label: 'Reembolso', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'cpa', label: 'Custo/Conv (CPA)', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'profit', label: 'Lucro (R$)', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'roi', label: 'ROI (%)', category: 'Financeiro', default: true, format: 'percentage' },
  
  // GOOGLE ADS AVANÇADO
  { key: 'strategy', label: 'Tipo Campanha', category: 'Google Ads', default: true },
  { key: 'search_impr_share', label: 'Parc. Impr.', category: 'Google Ads', default: false },
  { key: 'search_top_share', label: 'Parc. Topo', category: 'Google Ads', default: false },
  { key: 'search_abs_share', label: 'Parc. Absoluta', category: 'Google Ads', default: false },
  { key: 'final_url', label: 'Página Anúncio', category: 'Google Ads', default: false, type: 'link' },
];

export default function ProductDetailPage() {
  const params = useParams();
  const productId = typeof params?.id === 'string' ? params.id : '';

  // Datas Padrão (Início do Mês Atual)
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

  useEffect(() => {
    if (!productId) return;
    async function fetchData() {
      setLoading(true);
      try {
        const { data: prodData } = await supabase.from('products').select('*').eq('id', productId).single();
        if (prodData) setProduct(prodData);

        const { data: metricsData } = await supabase
          .from('daily_metrics')
          .select('*')
          .eq('product_id', productId)
          .order('date', { ascending: true });

        setMetrics(metricsData || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [productId]);

  const processedData = useMemo(() => {
    const filteredMetrics = metrics.filter(m => m.date >= startDate && m.date <= endDate);
    
    // Inicializa totais
    const stats = { revenue: 0, cost: 0, profit: 0, roi: 0, conversions: 0, clicks: 0, visits: 0 };
    if (!filteredMetrics.length) return { rows: [], stats, chart: [] };

    const exchangeRate = 6.15; // Em produção, viria de uma API ou do banco

    const rows = filteredMetrics.map(row => {
      // Conversão e Tratamento de Valores
      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);
      let cpc = Number(row.avg_cpc || 0);
      let budget = Number(row.budget_micros || 0) / 1000000;
      
      const rowCurrency = row.currency || 'BRL';
      
      // Lógica de Câmbio
      if (viewCurrency === 'BRL' && rowCurrency === 'USD') {
        cost *= exchangeRate; revenue *= exchangeRate; refunds *= exchangeRate; cpc *= exchangeRate; budget *= exchangeRate;
      } else if (viewCurrency === 'ORIGINAL' && rowCurrency === 'BRL') {
        cost /= exchangeRate; revenue /= exchangeRate; refunds /= exchangeRate; cpc /= exchangeRate; budget /= exchangeRate;
      }

      const profit = revenue - refunds - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const conversions = Number(row.conversions || 0);
      
      // Cálculo do CPA (Custo por Conversão)
      const cpa = conversions > 0 ? cost / conversions : 0;

      // Acumula Totais
      stats.revenue += revenue;
      stats.cost += cost;
      stats.profit += profit;
      stats.conversions += conversions;
      stats.clicks += Number(row.clicks || 0);
      stats.visits += Number(row.visits || 0);

      // Formata Data
      const dateParts = row.date.split('-');
      const shortDate = `${dateParts[2]}/${dateParts[1]}`;
      const fullDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

      return {
        ...row,
        date: fullDate, shortDate,
        cost, revenue, refunds, profit, roi, 
        avg_cpc: cpc, 
        budget, cpa,
        // Garante que CTR seja tratado como número corretamente para formatação
        ctr: Number(row.ctr || 0),
        // Mapeia colunas de texto do Google Ads
        strategy: row.bidding_strategy || '-',
        search_impr_share: row.search_impression_share || '-',
        search_top_share: row.search_top_impression_share || '-',
        search_abs_share: row.search_abs_top_share || '-',
        final_url: row.final_url
      };
    });

    // Totais Finais
    stats.roi = stats.cost > 0 ? (stats.profit / stats.cost) * 100 : 0;

    // Gráfico
    const chartData = rows.map(r => ({
      day: r.shortDate, lucro: r.profit, custo: r.cost, receita: r.revenue
    }));

    return { rows: rows.reverse(), chart: chartData, stats };
  }, [metrics, viewCurrency, startDate, endDate]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency === 'BRL' ? 'BRL' : 'USD' }).format(val);
  
  // Função auxiliar para formatar porcentagem sem excesso de casas decimais
  const formatPercent = (val: number) => `${val.toFixed(2)}%`;

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500 animate-pulse">Carregando dados...</div>;
  if (!product) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500">Produto não encontrado.</div>;

  const { rows, stats, chart } = processedData;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-6 relative">
      
      {/* HEADER & FILTROS */}
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

        <div className="flex flex-wrap gap-4 w-full xl:w-auto items-end">
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 items-center">
            <div className="flex items-center gap-2 px-3 border-r border-slate-800">
               <Calendar size={14} className="text-indigo-400"/>
               <span className="text-xs font-bold text-slate-500 uppercase">Período</span>
            </div>
            <input type="date" className="bg-transparent text-white text-xs font-mono p-2 outline-none [&::-webkit-calendar-picker-indicator]:invert cursor-pointer" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <span className="text-slate-600">-</span>
            <input type="date" className="bg-transparent text-white text-xs font-mono p-2 outline-none [&::-webkit-calendar-picker-indicator]:invert cursor-pointer" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
             <button onClick={() => setViewCurrency('ORIGINAL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'ORIGINAL' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>USD</button>
             <button onClick={() => setViewCurrency('BRL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'BRL' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>BRL</button>
          </div>
        </div>
      </header>

      {/* CARDS KPI */}
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
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Receita Total</p>
           <p className="text-2xl font-bold text-white">{formatMoney(stats.revenue)}</p>
           <p className="text-xs text-slate-500 mt-1">{stats.conversions} conversões</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Custo Ads</p>
           <p className="text-2xl font-bold text-amber-500">{formatMoney(stats.cost)}</p>
        </div>
      </div>

      {/* GRÁFICO */}
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

      {/* TABELA DETALHADA */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm relative flex flex-col h-[600px]">
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center bg-slate-900/50 gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-white">Histórico Detalhado</h3>
            <span className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">{rows.length} registros</span>
          </div>
          <button onClick={() => setShowColumnModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors border border-slate-700">
            <Columns size={14} /> Colunas
          </button>
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

                    // Lógica de Renderização por Tipo
                    if (col.key === 'date') return <td key={col.key} className="px-4 py-4 font-medium text-white sticky left-0 bg-slate-900 group-hover:bg-slate-800 border-r border-slate-800">{val}</td>
                    
                    if (col.type === 'link') {
                        content = val ? <a href={val} target="_blank" className="text-indigo-400 hover:text-indigo-300 flex justify-end"><LinkIcon size={14}/></a> : '-';
                    } else if (col.format === 'currency') {
                      content = <span className={col.key === 'profit' ? (val >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold') : 'text-slate-300'}>{formatMoney(val)}</span>;
                    } else if (col.format === 'percentage') {
                      content = <span className={`px-2 py-1 rounded text-xs border ${val < 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{formatPercent(val)}</span>;
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
                    Nenhum dado encontrado para o período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* MODAL DE COLUNAS */}
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