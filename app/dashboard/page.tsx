"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, ArrowUpRight, ArrowDownRight, DollarSign, 
  TrendingUp, Activity, Sun, Moon, RefreshCw, Filter 
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURAÇÃO ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DashboardPage() {
  // --- ESTADOS ---
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  
  // Filtros de Data
  const [dateRange, setDateRange] = useState('this_month'); // today, yesterday, 7d, 30d, this_month, last_month
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Moeda
  const [liveDollar, setLiveDollar] = useState(6.00); // Valor API
  const [manualDollar, setManualDollar] = useState(5.60); // Valor Manual (Receita)
  
  // Tema
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // --- CARREGAMENTO INICIAL ---
  useEffect(() => {
    fetchInitialData();
    fetchLiveDollar();
  }, []);

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) {
        setLiveDollar(parseFloat(data.USDBRL.bid));
      }
    } catch (e) {
      console.error("Erro ao buscar dólar", e);
    }
  }

  async function fetchInitialData() {
    setLoading(true);
    // 1. Busca Produtos (para saber a moeda de cada um)
    const { data: prodData } = await supabase.from('products').select('id, currency, name');
    setProducts(prodData || []);

    // 2. Busca Métricas (Todas, depois filtramos na memória para rapidez)
    const { data: metData } = await supabase
      .from('daily_metrics')
      .select('*')
      .order('date', { ascending: true });
    
    setMetrics(metData || []);
    setLoading(false);
  }

  // --- LÓGICA DE FILTRAGEM E CÁLCULO ---
  const processedData = useMemo(() => {
    if (!metrics.length) return { chart: [], table: [], totals: null };

    // 1. Definir Intervalo de Datas
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (dateRange === 'today') {
      // Já está configurado
    } else if (dateRange === 'yesterday') {
      start.setDate(now.getDate() - 1);
      end.setDate(now.getDate() - 1);
    } else if (dateRange === '7d') {
      start.setDate(now.getDate() - 7);
    } else if (dateRange === '30d') {
      start.setDate(now.getDate() - 30);
    } else if (dateRange === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (dateRange === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (dateRange === 'custom' && customStart && customEnd) {
      start = new Date(customStart); // Ajustar fuso se necessário
      end = new Date(customEnd);
    }

    // Normaliza datas para comparação YYYY-MM-DD
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    // 2. Filtrar e Agrupar por Dia
    const dailyMap = new Map();

    metrics.forEach(row => {
      if (row.date < startStr || row.date > endStr) return;

      const product = products.find(p => p.id === row.product_id);
      const isUSD = product?.currency === 'USD';

      // --- LÓGICA DE CONVERSÃO EXIGIDA ---
      // Custo: Usa Dólar do Dia (Simulado pelo LiveDollar aqui, ou valor original se for BRL)
      // Receita: Usa Dólar Manual (Para proteger margem)
      
      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);

      if (isUSD) {
        cost = cost * liveDollar; // Custo = Real time / Dia
        revenue = revenue * manualDollar; // Receita = Manual (Imposto/Margem)
        refunds = refunds * manualDollar;
      }

      const profit = revenue - cost - refunds;

      // Agrupa
      if (!dailyMap.has(row.date)) {
        dailyMap.set(row.date, { 
          date: row.date, cost: 0, revenue: 0, profit: 0, refunds: 0, roi: 0 
        });
      }

      const day = dailyMap.get(row.date);
      day.cost += cost;
      day.revenue += revenue;
      day.refunds += refunds;
      day.profit += profit;
    });

    // 3. Formata para Array e Calcula Totais Gerais
    const resultRows = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date)); // Decrescente para Tabela

    const totals = { cost: 0, revenue: 0, profit: 0, refunds: 0, roi: 0 };
    resultRows.forEach(r => {
      totals.cost += r.cost;
      totals.revenue += r.revenue;
      totals.profit += r.profit;
      totals.refunds += r.refunds;
      // Recalcula ROI do dia
      r.roi = r.cost > 0 ? (r.profit / r.cost) * 100 : 0;
    });
    totals.roi = totals.cost > 0 ? (totals.profit / totals.cost) * 100 : 0;

    // Dados para Gráfico (Crescente)
    const chartData = [...resultRows].sort((a, b) => a.date.localeCompare(b.date)).map(r => ({
      ...r,
      shortDate: r.date.split('-').slice(1).reverse().join('/') // 12-25 -> 25/12
    }));

    return { chart: chartData, table: resultRows, totals };

  }, [metrics, products, dateRange, customStart, customEnd, liveDollar, manualDollar]);

  // Helpers de Formatação
  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  const formatPercent = (val: number) => `${val.toFixed(2)}%`;

  // Estilos Dinâmicos (Dark/Light)
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textSub = isDark ? 'text-slate-500' : 'text-slate-500';

  return (
    <div className={`min-h-screen font-sans p-4 md:p-8 transition-colors ${bgMain}`}>
      
      {/* --- HEADER --- */}
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-6 mb-8">
        <div>
          <h1 className={`text-3xl font-bold ${textHead} mb-2`}>Dashboard Executivo</h1>
          <p className={textSub}>Visão consolidada de todas as campanhas e resultados financeiros.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto">
          
          {/* Controle de Dólar */}
          <div className={`${bgCard} border rounded-xl p-3 flex gap-4 items-center`}>
             <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Dólar Real (Custo)</label>
                <div className="flex items-center gap-1 text-amber-500 font-mono font-bold">
                   <RefreshCw size={12} onClick={fetchLiveDollar} className="cursor-pointer hover:animate-spin"/>
                   R$ {liveDollar.toFixed(2)}
                </div>
             </div>
             <div className="w-px h-8 bg-slate-700/50"></div>
             <div>
                <label className="text-[10px] font-bold text-emerald-500 uppercase block mb-1">Dólar Manual (Receita)</label>
                <div className="flex items-center gap-1">
                   <span className="text-slate-500 text-xs">R$</span>
                   <input 
                      type="number" 
                      step="0.01"
                      className={`w-16 bg-transparent border-b border-slate-500 ${textHead} font-bold text-sm focus:outline-none focus:border-emerald-500`}
                      value={manualDollar}
                      onChange={(e) => setManualDollar(parseFloat(e.target.value))}
                   />
                </div>
             </div>
          </div>

          {/* Controle de Tema */}
          <button 
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`p-3 rounded-xl border transition-colors ${bgCard} ${textSub} hover:text-indigo-500`}
          >
            {isDark ? <Sun size={20}/> : <Moon size={20}/>}
          </button>
        </div>
      </header>

      {/* --- FILTROS DE DATA --- */}
      <div className="flex flex-wrap gap-2 mb-8">
        {[
          { id: 'today', label: 'Hoje' },
          { id: 'yesterday', label: 'Ontem' },
          { id: '7d', label: '7 Dias' },
          { id: '30d', label: '30 Dias' },
          { id: 'this_month', label: 'Este Mês' },
          { id: 'last_month', label: 'Mês Passado' },
        ].map(filter => (
          <button
            key={filter.id}
            onClick={() => setDateRange(filter.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              dateRange === filter.id 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                : `${bgCard} ${textSub} hover:border-indigo-500`
            }`}
          >
            {filter.label}
          </button>
        ))}
        
        {/* Filtro Custom */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${bgCard}`}>
           <span className="text-xs font-bold uppercase text-slate-500">De</span>
           <input type="date" className="bg-transparent text-xs outline-none" onChange={(e) => { setCustomStart(e.target.value); setDateRange('custom'); }} />
           <span className="text-xs font-bold uppercase text-slate-500">Até</span>
           <input type="date" className="bg-transparent text-xs outline-none" onChange={(e) => { setCustomEnd(e.target.value); setDateRange('custom'); }} />
        </div>
      </div>

      {/* --- KPI CARDS (TOTAIS) --- */}
      {processedData.totals && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
          
          {/* Receita (VERDE) */}
          <div className={`${bgCard} border-t-4 border-t-emerald-500 p-5 rounded-xl shadow-lg`}>
            <p className="text-xs font-bold text-slate-500 uppercase mb-2">Receita Total</p>
            <p className="text-2xl font-bold text-emerald-500">{formatMoney(processedData.totals.revenue)}</p>
          </div>

          {/* Custos (AMARELO/LARANJA) */}
          <div className={`${bgCard} border-t-4 border-t-amber-500 p-5 rounded-xl shadow-lg`}>
            <p className="text-xs font-bold text-slate-500 uppercase mb-2">Custos Totais</p>
            <p className="text-2xl font-bold text-amber-500">{formatMoney(processedData.totals.cost)}</p>
          </div>

          {/* Lucro (DINÂMICO) */}
          <div className={`${bgCard} border-t-4 ${processedData.totals.profit >= 0 ? 'border-t-emerald-600' : 'border-t-rose-500'} p-5 rounded-xl shadow-lg`}>
            <p className="text-xs font-bold text-slate-500 uppercase mb-2">Lucro Líquido</p>
            <p className={`text-2xl font-bold ${processedData.totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {formatMoney(processedData.totals.profit)}
            </p>
          </div>

          {/* ROI (ROXO) */}
          <div className={`${bgCard} border-t-4 border-t-indigo-500 p-5 rounded-xl shadow-lg`}>
            <p className="text-xs font-bold text-slate-500 uppercase mb-2">ROI</p>
            <p className="text-2xl font-bold text-indigo-500">{formatPercent(processedData.totals.roi)}</p>
          </div>

          {/* Reembolso (VERMELHO) */}
          <div className={`${bgCard} border-t-4 border-t-rose-500 p-5 rounded-xl shadow-lg`}>
             <p className="text-xs font-bold text-slate-500 uppercase mb-2">Reembolsos</p>
             <p className="text-2xl font-bold text-rose-500">{formatMoney(processedData.totals.refunds)}</p>
          </div>
        </div>
      )}

      {/* --- GRÁFICO --- */}
      <div className={`${bgCard} rounded-xl p-6 mb-8 h-80 shadow-lg`}>
         <h3 className={`text-lg font-bold ${textHead} mb-6`}>Performance Diária</h3>
         <ResponsiveContainer width="100%" height="100%">
            <BarChart data={processedData.chart}>
               <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
               <XAxis dataKey="shortDate" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
               <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `R$${val/1000}k`} />
               <Tooltip 
                 contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0', color: isDark ? '#fff' : '#000' }} 
                 formatter={(val:any) => formatMoney(val)} 
               />
               <Legend />
               <Bar dataKey="revenue" name="Receita" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
               <Bar dataKey="cost" name="Custo" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
               <Bar dataKey="profit" name="Lucro" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
         </ResponsiveContainer>
      </div>

      {/* --- TABELA DIÁRIA --- */}
      <div className={`${bgCard} rounded-xl overflow-hidden shadow-lg border`}>
        <div className={`p-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} flex justify-between items-center`}>
           <h3 className={`font-bold ${textHead}`}>Detalhamento Diário</h3>
           <span className="text-xs text-slate-500">{processedData.table.length} dias registrados</span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'}`}>
              <tr>
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4 text-right text-emerald-600">Receita</th>
                <th className="px-6 py-4 text-right text-amber-600">Custo</th>
                <th className="px-6 py-4 text-right text-indigo-600">Lucro</th>
                <th className="px-6 py-4 text-right text-rose-600">Reembolso</th>
                <th className="px-6 py-4 text-right">ROI</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
              {processedData.table.map((row: any) => {
                 const dateParts = row.date.split('-');
                 const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                 return (
                  <tr key={row.date} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                    <td className={`px-6 py-4 font-bold ${textHead}`}>{formattedDate}</td>
                    
                    {/* Receita: SEMPRE VERDE */}
                    <td className="px-6 py-4 text-right font-bold text-emerald-500 bg-emerald-500/5">
                      {formatMoney(row.revenue)}
                    </td>
                    
                    <td className="px-6 py-4 text-right font-medium text-amber-500">
                      {formatMoney(row.cost)}
                    </td>
                    
                    <td className={`px-6 py-4 text-right font-bold ${row.profit >= 0 ? 'text-indigo-500' : 'text-rose-500'}`}>
                      {formatMoney(row.profit)}
                    </td>
                    
                    <td className="px-6 py-4 text-right text-rose-400">
                      {row.refunds > 0 ? formatMoney(row.refunds) : '-'}
                    </td>
                    
                    <td className={`px-6 py-4 text-right font-bold ${row.roi >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {row.roi.toFixed(0)}%
                    </td>
                  </tr>
                 );
              })}
              {processedData.table.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    Nenhum dado neste período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}