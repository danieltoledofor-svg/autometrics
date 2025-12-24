"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, DollarSign, RefreshCw, Sun, Moon, 
  LayoutGrid, Package, Settings, FileText, Menu, ChevronDown, Filter
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Configuração Supabase
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
  const [dateRange, setDateRange] = useState('this_month'); 
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [isDateMenuOpen, setIsDateMenuOpen] = useState(false);

  // Moedas e Taxas
  const [liveDollar, setLiveDollar] = useState(6.00); 
  const [manualDollar, setManualDollar] = useState(5.60); 
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD'>('BRL'); // Toggle de Visualização

  // UI
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // --- EFEITOS ---
  useEffect(() => {
    fetchInitialData();
    fetchLiveDollar();
    const savedDollar = localStorage.getItem('autometrics_manual_dollar');
    if (savedDollar) setManualDollar(parseFloat(savedDollar));
  }, []);

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
    } catch (e) { console.error(e); }
  }

  async function fetchInitialData() {
    setLoading(true);
    const { data: prodData } = await supabase.from('products').select('id, currency');
    setProducts(prodData || []);
    const { data: metData } = await supabase.from('daily_metrics').select('*').order('date', { ascending: true });
    setMetrics(metData || []);
    setLoading(false);
  }

  const handleManualDollarChange = (val: number) => {
    setManualDollar(val);
    localStorage.setItem('autometrics_manual_dollar', val.toString());
  };

  // --- CÁLCULOS ---
  const processedData = useMemo(() => {
    if (!metrics.length) return { chart: [], table: [], totals: null };

    // 1. Filtro de Data
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (dateRange === 'today') { /* start = now */ }
    else if (dateRange === 'yesterday') { start.setDate(now.getDate() - 1); end.setDate(now.getDate() - 1); }
    else if (dateRange === '7d') { start.setDate(now.getDate() - 7); }
    else if (dateRange === '30d') { start.setDate(now.getDate() - 30); }
    else if (dateRange === 'this_month') { start = new Date(now.getFullYear(), now.getMonth(), 1); }
    else if (dateRange === 'custom' && customStart && customEnd) { start = new Date(customStart); end = new Date(customEnd); }

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    // 2. Processamento
    const dailyMap = new Map();

    metrics.forEach(row => {
      if (row.date < startStr || row.date > endStr) return;

      const product = products.find(p => p.id === row.product_id);
      const isUSD = product?.currency === 'USD';

      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);

      // Conversão Baseada na Visualização (viewCurrency)
      if (viewCurrency === 'BRL') {
        // Se a conta é USD, converte pra BRL
        if (isUSD) {
          cost = cost * liveDollar;
          revenue = revenue * manualDollar;
          refunds = refunds * manualDollar;
        }
      } else {
        // Visualizando em USD
        // Se a conta é BRL, converte pra USD (divisão)
        if (!isUSD) {
          cost = cost / liveDollar;
          revenue = revenue / manualDollar;
          refunds = refunds / manualDollar;
        }
      }

      const profit = revenue - cost - refunds;

      if (!dailyMap.has(row.date)) dailyMap.set(row.date, { date: row.date, cost: 0, revenue: 0, profit: 0, refunds: 0 });
      const day = dailyMap.get(row.date);
      
      day.cost += cost;
      day.revenue += revenue;
      day.refunds += refunds;
      day.profit += profit;
    });

    const resultRows = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    const totals = { cost: 0, revenue: 0, profit: 0, refunds: 0, roi: 0 };
    
    resultRows.forEach(r => {
      totals.cost += r.cost;
      totals.revenue += r.revenue;
      totals.profit += r.profit;
      totals.refunds += r.refunds;
      r.roi = r.cost > 0 ? (r.profit / r.cost) * 100 : 0;
    });
    totals.roi = totals.cost > 0 ? (totals.profit / totals.cost) * 100 : 0;

    const chartData = [...resultRows].sort((a, b) => a.date.localeCompare(b.date)).map(r => ({
      ...r, shortDate: r.date.split('-').slice(1).reverse().join('/')
    }));

    return { chart: chartData, table: resultRows, totals };
  }, [metrics, products, dateRange, customStart, customEnd, liveDollar, manualDollar, viewCurrency]);

  // Estilos
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);

  return (
    <div className={`min-h-screen font-sans flex ${bgMain}`}>
      
      {/* --- SIDEBAR --- */}
      <aside className={`w-16 md:w-64 border-r flex flex-col sticky top-0 h-screen z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-inherit">
           <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-white">A</div>
           <span className={`ml-3 font-bold text-lg hidden md:block ${textHead}`}>AutoMetrics</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
           <Link href="/dashboard" className="flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
              <LayoutGrid size={20} /> <span className="hidden md:block font-medium">Dashboard</span>
           </Link>
           <Link href="/products" className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}>
              <Package size={20} /> <span className="hidden md:block font-medium">Meus Produtos</span>
           </Link>
           <Link href="/manual-entry" className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}>
              <FileText size={20} /> <span className="hidden md:block font-medium">Lançamento</span>
           </Link>
           <Link href="/integration" className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}>
              <Settings size={20} /> <span className="hidden md:block font-medium">Integração</span>
           </Link>
        </nav>
      </aside>

      {/* --- CONTEÚDO PRINCIPAL --- */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        
        {/* Header Superior */}
        <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
          <div>
            <h1 className={`text-2xl font-bold ${textHead}`}>Visão Geral</h1>
            <p className="text-slate-500 text-sm">Acompanhe seus resultados consolidados.</p>
          </div>

          <div className="flex flex-wrap gap-4 items-center w-full xl:w-auto">
             
             {/* Seletor de Data Compacto */}
             <div className={`flex items-center p-1 rounded-lg border ${bgCard} relative`}>
                <div className="flex items-center gap-2 px-3 border-r border-inherit">
                   <Calendar size={16} className="text-indigo-500"/>
                   <select 
                      className={`bg-transparent text-sm font-bold outline-none cursor-pointer ${textHead}`}
                      value={dateRange}
                      onChange={(e) => setDateRange(e.target.value)}
                   >
                      <option value="today">Hoje</option>
                      <option value="yesterday">Ontem</option>
                      <option value="7d">Últimos 7 dias</option>
                      <option value="30d">Últimos 30 dias</option>
                      <option value="this_month">Este Mês</option>
                      <option value="last_month">Mês Passado</option>
                      <option value="custom">Personalizado</option>
                   </select>
                </div>
                {dateRange === 'custom' && (
                   <div className="flex gap-2 px-2">
                      <input type="date" className="bg-transparent text-xs outline-none" onChange={e => setCustomStart(e.target.value)} />
                      <input type="date" className="bg-transparent text-xs outline-none" onChange={e => setCustomEnd(e.target.value)} />
                   </div>
                )}
             </div>

             {/* Configurações de Dólar e Visualização */}
             <div className={`flex items-center p-1.5 rounded-lg border gap-4 ${bgCard}`}>
                
                {/* Inputs de Taxa */}
                <div className="flex gap-3 px-2 border-r border-inherit pr-4">
                   <div>
                      <span className="text-[9px] text-orange-500 uppercase font-bold block">Custo (Real)</span>
                      <span className="text-xs font-mono font-bold text-orange-400">R$ {liveDollar.toFixed(2)}</span>
                   </div>
                   <div>
                      <span className="text-[9px] text-blue-500 uppercase font-bold block">Receita (Manual)</span>
                      <div className="flex items-center gap-1">
                         <span className="text-[10px] text-slate-500">R$</span>
                         <input type="number" step="0.01" className={`w-10 bg-transparent text-xs font-mono font-bold outline-none border-b ${isDark ? 'border-slate-700 text-white' : 'border-slate-300 text-black'}`} value={manualDollar} onChange={(e) => handleManualDollarChange(parseFloat(e.target.value))} />
                      </div>
                   </div>
                </div>

                {/* Toggle Moeda */}
                <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-md">
                   <button onClick={() => setViewCurrency('BRL')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'BRL' ? 'bg-white dark:bg-slate-800 shadow text-indigo-600' : 'text-slate-400'}`}>R$</button>
                   <button onClick={() => setViewCurrency('USD')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'USD' ? 'bg-white dark:bg-slate-800 shadow text-indigo-600' : 'text-slate-400'}`}>$</button>
                </div>

                {/* Tema */}
                <button onClick={() => setTheme(isDark ? 'light' : 'dark')} className="text-slate-400 hover:text-indigo-500">
                   {isDark ? <Sun size={18} /> : <Moon size={18} />}
                </button>
             </div>
          </div>
        </header>

        {/* --- KPI CARDS (CORES ATUALIZADAS) --- */}
        {processedData.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
            {/* Receita (AZUL) */}
            <div className={`${bgCard} border-t-4 border-t-blue-500 p-5 rounded-xl shadow-sm`}>
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Receita Total</p>
              <p className="text-2xl font-bold text-blue-500">{formatMoney(processedData.totals.revenue)}</p>
            </div>
            {/* Custos (LARANJA) */}
            <div className={`${bgCard} border-t-4 border-t-orange-500 p-5 rounded-xl shadow-sm`}>
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Custos Totais</p>
              <p className="text-2xl font-bold text-orange-500">{formatMoney(processedData.totals.cost)}</p>
            </div>
            {/* Lucro (VERDE/VERMELHO) */}
            <div className={`${bgCard} border-t-4 ${processedData.totals.profit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'} p-5 rounded-xl shadow-sm`}>
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Lucro Líquido</p>
              <p className={`text-2xl font-bold ${processedData.totals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {formatMoney(processedData.totals.profit)}
              </p>
            </div>
            {/* ROI */}
            <div className={`${bgCard} border-t-4 border-t-indigo-500 p-5 rounded-xl shadow-sm`}>
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">ROI</p>
              <p className="text-2xl font-bold text-indigo-500">{processedData.totals.roi.toFixed(1)}%</p>
            </div>
            {/* Reembolso */}
            <div className={`${bgCard} border-t-4 border-t-rose-500 p-5 rounded-xl shadow-sm`}>
               <p className="text-xs font-bold text-slate-500 uppercase mb-2">Reembolsos</p>
               <p className="text-2xl font-bold text-rose-500">{formatMoney(processedData.totals.refunds)}</p>
            </div>
          </div>
        )}

        {/* --- GRÁFICO --- */}
        <div className={`${bgCard} rounded-xl p-6 mb-8 h-80 shadow-sm`}>
           <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processedData.chart}>
                 <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
                 <XAxis dataKey="shortDate" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                 <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                 <Tooltip 
                   contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0' }} 
                   formatter={(val:any) => formatMoney(val)} 
                 />
                 <Legend />
                 {/* Cores Atualizadas: Receita (Azul), Custo (Laranja), Lucro (Verde) */}
                 <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                 <Bar dataKey="cost" name="Custo" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={40} />
                 <Bar dataKey="profit" name="Lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
           </ResponsiveContainer>
        </div>

        {/* --- TABELA --- */}
        <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border border-inherit`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'}`}>
                <tr>
                  <th className="px-6 py-4">Data</th>
                  <th className="px-6 py-4 text-right text-blue-600">Receita</th>
                  <th className="px-6 py-4 text-right text-orange-600">Custo</th>
                  <th className="px-6 py-4 text-right text-emerald-600">Lucro</th>
                  <th className="px-6 py-4 text-right">ROI</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                {processedData.table.map((row: any) => (
                  <tr key={row.date} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                    <td className={`px-6 py-4 font-bold ${textHead}`}>{row.shortDate}</td>
                    <td className="px-6 py-4 text-right font-bold text-blue-500 bg-blue-500/5">{formatMoney(row.revenue)}</td>
                    <td className="px-6 py-4 text-right font-medium text-orange-500">{formatMoney(row.cost)}</td>
                    <td className={`px-6 py-4 text-right font-bold ${row.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(row.profit)}</td>
                    <td className={`px-6 py-4 text-right font-bold ${row.roi >= 0 ? 'text-indigo-500' : 'text-rose-500'}`}>{row.roi.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
}