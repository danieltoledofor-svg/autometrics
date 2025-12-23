"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation'; 
import { 
  ArrowLeft, Columns, DollarSign, ArrowRightLeft, ArrowUpRight, Coins, X, ArrowDownRight, ExternalLink
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
  { key: 'roas', label: 'ROAS', category: 'Financeiro', default: false },
  { key: 'strategy', label: 'Estratégia', category: 'Google Ads', default: false },
];

export default function ProductDetailPage() {
  const params = useParams();
  // Força o ID a ser string para evitar erros de tipagem
  const productId = typeof params?.id === 'string' ? params.id : '';

  const [product, setProduct] = useState<any>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [showColumnModal, setShowColumnModal] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('BRL');
  const [visibleColumns, setVisibleColumns] = useState(ALL_COLUMNS.filter(c => c.default).map(c => c.key));

  useEffect(() => {
    if (!productId) return;

    async function fetchData() {
      console.log("🔍 Buscando dados para o ID:", productId);
      setLoading(true);
      setErrorMsg('');

      try {
        // 1. Busca Detalhes do Produto
        const { data: prodData, error: prodError } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .single();
        
        if (prodError) throw prodError;
        setProduct(prodData);
        console.log("✅ Produto encontrado:", prodData.name);

        // 2. Busca Métricas
        const { data: metricsData, error: metricsError } = await supabase
          .from('daily_metrics')
          .select('*')
          .eq('product_id', productId)
          .order('date', { ascending: true });

        if (metricsError) throw metricsError;
        setMetrics(metricsData || []);
        console.log("✅ Métricas encontradas:", metricsData?.length);

      } catch (error: any) {
        console.error("❌ Erro ao buscar:", error);
        setErrorMsg(error.message || 'Erro desconhecido');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [productId]);

  // Processamento e Cálculos
  const processedData = useMemo(() => {
    if (!metrics.length) return { rows: [], stats: { revenue: 0, cost: 0, profit: 0, roi: 0, conversions: 0 }, chart: [] };

    const exchangeRate = 6.15; 
    let totalRevenue = 0, totalCost = 0, totalRefunds = 0, totalConversions = 0;

    const rows = metrics.map(row => {
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
      const roas = cost > 0 ? revenue / cost : 0;

      totalRevenue += revenue;
      totalCost += cost;
      totalRefunds += refunds;
      totalConversions += Number(row.conversions || 0);

      const dateParts = row.date.split('-');
      // Fallback para datas mal formatadas
      const shortDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : row.date;
      const fullDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : row.date;

      return {
        ...row, date: fullDate, shortDate, cost, revenue, refunds, profit, roi, roas, avg_cpc: cpc
      };
    });

    const totalProfit = totalRevenue - totalRefunds - totalCost;
    const totalRoi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    const chartData = rows.slice(-14).map(r => ({
      day: r.shortDate, lucro: r.profit, custo: r.cost, receita: r.revenue
    }));

    return {
      rows: rows.reverse(),
      chart: chartData,
      stats: { revenue: totalRevenue, cost: totalCost, profit: totalProfit, roi: totalRoi, conversions: totalConversions }
    };
  }, [metrics, viewCurrency]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency === 'BRL' ? 'BRL' : 'USD' }).format(val);

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500 animate-pulse">Carregando dados...</div>;
  
  if (errorMsg) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center text-rose-500 gap-4">
      <p>Erro ao carregar produto: {errorMsg}</p>
      <Link href="/products" className="bg-slate-800 text-white px-4 py-2 rounded">Voltar</Link>
    </div>
  );

  if (!product) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500">Produto não encontrado.</div>;

  const { rows, stats, chart } = processedData;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-6 relative">
      {/* Header */}
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
        <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
           <button onClick={() => setViewCurrency('ORIGINAL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'ORIGINAL' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>USD</button>
           <button onClick={() => setViewCurrency('BRL')} className={`px-4 py-1.5 rounded text-xs font-bold ${viewCurrency === 'BRL' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>BRL</button>
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
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
         <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
               <thead className="text-xs text-slate-500 uppercase bg-slate-950 font-bold">
                  <tr>
                     {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (
                        <th key={col.key} className="px-4 py-4 whitespace-nowrap text-right first:text-left">{col.label}</th>
                     ))}
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-800">
                  {rows.map(row => (
                     <tr key={row.id} className="hover:bg-slate-800/50">
                        {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => {
                           const val = row[col.key];
                           if (col.key === 'date') return <td key={col.key} className="px-4 py-4 font-medium text-white">{val}</td>;
                           if (col.format === 'currency') return <td key={col.key} className={`px-4 py-4 text-right ${col.key==='profit' ? (val>=0?'text-emerald-400':'text-rose-400') : 'text-slate-300'}`}>{formatMoney(val)}</td>;
                           return <td key={col.key} className="px-4 py-4 text-right text-slate-400">{val}</td>;
                        })}
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
}