"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, Sun, Moon, LayoutGrid, Package, Settings, 
  LogOut, RefreshCw, Target, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

// Configuração Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Função para garantir data no fuso local (evita erros de UTC)
function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  
  // Dados
  const [metrics, setMetrics] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  
  // --- NOVOS ESTADOS DE DATA (PADRONIZADO) ---
  const [dateRange, setDateRange] = useState('this_month'); 
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Configurações Globais (Moeda e Tema)
  const [liveDollar, setLiveDollar] = useState(6.00); 
  const [manualDollar, setManualDollar] = useState(5.60); 
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD'>('BRL');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // --- INICIALIZAÇÃO E AUTENTICAÇÃO ---
  useEffect(() => {
    async function init() {
      // 1. Recupera Preferências Salvas
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) setTheme(savedTheme);

      const savedDollar = localStorage.getItem('autometrics_manual_dollar');
      if (savedDollar) setManualDollar(parseFloat(savedDollar));

      // 2. Verifica Login
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/'); 
        return;
      }
      setUser(session.user); 

      // 3. Inicializa Datas (Este Mês)
      handlePresetChange('this_month');

      // 4. Carrega Dados
      await Promise.all([
        fetchInitialData(session.user.id), 
        fetchLiveDollar()
      ]);
      
      setLoading(false);
    }
    init();
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('autometrics_theme', newTheme);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
    } catch (e) { console.error(e); }
  }

  async function fetchInitialData(userId: string) {
    const { data: prodData } = await supabase
      .from('products')
      .select('id, currency')
      .eq('user_id', userId); 

    setProducts(prodData || []);

    if (prodData && prodData.length > 0) {
        const productIds = prodData.map(p => p.id);
        const { data: metData } = await supabase
          .from('daily_metrics')
          .select('*')
          .in('product_id', productIds)
          .order('date', { ascending: true });
        setMetrics(metData || []);
    } else {
        setMetrics([]);
    }
  }

  const handleManualDollarChange = (val: number) => {
    setManualDollar(val);
    localStorage.setItem('autometrics_manual_dollar', val.toString());
  };

  // --- LÓGICA INTELIGENTE DE DATAS ---
  const handlePresetChange = (preset: string) => {
    setDateRange(preset);
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (preset === 'today') { /* hoje */ }
    else if (preset === 'yesterday') { start.setDate(now.getDate() - 1); end.setDate(now.getDate() - 1); }
    else if (preset === '7d') { start.setDate(now.getDate() - 7); }
    else if (preset === '30d') { start.setDate(now.getDate() - 30); }
    else if (preset === 'this_month') { start = new Date(now.getFullYear(), now.getMonth(), 1); }
    else if (preset === 'last_month') { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); }
    
    setStartDate(getLocalYYYYMMDD(start));
    setEndDate(getLocalYYYYMMDD(end));
  };

  const handleCustomDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') setStartDate(value);
    else setEndDate(value);
    setDateRange('custom'); // Muda o dropdown para "Personalizado" automaticamente
  };

  // --- PROCESSAMENTO DE DADOS ---
  const processedData = useMemo(() => {
    if (loading || !metrics.length) return { chart: [], table: [], totals: null };

    const dailyMap = new Map();

    metrics.forEach(row => {
      // Filtra usando as datas do estado (startDate / endDate)
      if (row.date < startDate || row.date > endDate) return;

      const product = products.find(p => p.id === row.product_id);
      const isUSD = product?.currency === 'USD';

      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);

      // Conversão de Moeda
      if (viewCurrency === 'BRL') {
        if (isUSD) {
          cost *= liveDollar;      
          revenue *= manualDollar; 
          refunds *= manualDollar;
        }
      } else {
        if (!isUSD) {
          cost /= liveDollar;
          revenue /= manualDollar;
          refunds /= manualDollar;
        }
      }

      const profit = revenue - cost - refunds;

      // Agrupamento por Dia
      if (!dailyMap.has(row.date)) dailyMap.set(row.date, { date: row.date, cost: 0, revenue: 0, profit: 0, refunds: 0 });
      const day = dailyMap.get(row.date);
      
      day.cost += cost;
      day.revenue += revenue;
      day.refunds += refunds;
      day.profit += profit;
    });

    const resultRows = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    
    // Totais Gerais
    const totals = { cost: 0, revenue: 0, profit: 0, refunds: 0, roi: 0 };
    resultRows.forEach(r => {
      totals.cost += r.cost;
      totals.revenue += r.revenue;
      totals.profit += r.profit;
      totals.refunds += r.refunds;
      r.roi = r.cost > 0 ? (r.profit / r.cost) * 100 : 0;
    });
    totals.roi = totals.cost > 0 ? (totals.profit / totals.cost) * 100 : 0;

    // Dados para Gráfico (Ordem Cronológica)
    const chartData = [...resultRows].sort((a, b) => a.date.localeCompare(b.date)).map(r => ({
      ...r, shortDate: r.date.split('-').slice(1).reverse().join('/')
    }));

    return { chart: chartData, table: resultRows, totals };
  }, [metrics, products, startDate, endDate, liveDollar, manualDollar, viewCurrency, loading]);

  // --- ESTILOS DINÂMICOS ---
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';

  if (loading) return <div className={`min-h-screen ${bgMain} flex items-center justify-center`}>Carregando dados...</div>;

  return (
    <div className={`min-h-screen font-sans flex ${bgMain}`}>
      <aside className={`w-16 md:w-64 border-r flex flex-col sticky top-0 h-screen z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        
        {/* Logo */}
        <div className="h-20 flex items-center justify-center md:justify-start md:px-6 border-b border-inherit">
           <div className="hidden md:block relative"> 
             <Image 
               src="/logo.png" 
               alt="Logo" 
               width={180} 
               height={60} 
               className={`w-[180px] h-auto object-contain object-left ${!isDark ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : ''}`} 
               priority 
             />
           </div>
           <div className="md:hidden">
             <Image 
                src="/logo.png" 
                alt="Logo" 
                width={40} 
                height={40} 
                className={`w-8 h-8 object-contain ${!isDark ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : ''}`}
             />
           </div>
        </div>
        
        {/* CORREÇÃO AQUI: ADICIONADO w-full PARA TODOS OS LINKS */}
        <nav className="flex-1 p-4 space-y-2">
           <Link href="/dashboard" className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20"><LayoutGrid size={20} /> <span className="hidden md:block font-medium">Dashboard</span></Link>
           
           <Link href="/planning" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Target size={20} /> <span className="hidden md:block font-medium">Planejamento</span></Link>
           
           <Link href="/products" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Package size={20} /> <span className="hidden md:block font-medium">Meus Produtos</span></Link>
           
           {/* Link de Lançamento REMOVIDO para limpar */}
           
           <Link href="/integration" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Settings size={20} /> <span className="hidden md:block font-medium">Integração</span></Link>
        </nav>
        <div className="p-4 border-t border-inherit">
           <button onClick={handleLogout} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-rose-500 hover:bg-rose-500/10`}><LogOut size={20} /> <span className="hidden md:block font-medium">Sair ({user?.email?.split('@')[0]})</span></button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
          <div><h1 className={`text-2xl font-bold ${textHead}`}>Visão Geral</h1><p className={textMuted}>Acompanhe seus resultados consolidados.</p></div>
          <div className="flex flex-wrap gap-4 items-center w-full xl:w-auto">
             
             {/* --- NOVO COMPONENTE DE DATA UNIFICADO --- */}
             <div className={`flex items-center p-1.5 rounded-xl border ${bgCard} shadow-sm`}>
                <div className="flex items-center gap-2 px-2 border-r border-inherit">
                   <Calendar size={18} className={isDark ? "text-white" : "text-indigo-600"}/>
                   <select 
                      className={`bg-transparent text-sm font-bold outline-none cursor-pointer ${textHead} w-24`}
                      value={dateRange}
                      onChange={(e) => handlePresetChange(e.target.value)}
                   >
                      <option value="today">Hoje</option>
                      <option value="yesterday">Ontem</option>
                      <option value="7d">7 Dias</option>
                      <option value="30d">30 Dias</option>
                      <option value="this_month">Este Mês</option>
                      <option value="last_month">Mês Passado</option>
                      <option value="custom">Personalizado</option>
                   </select>
                </div>
                <div className="flex items-center gap-2 px-2">
                   <input 
                     type="date" 
                     className={`bg-transparent text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                     value={startDate}
                     onChange={(e) => handleCustomDateChange('start', e.target.value)}
                   />
                   <span className="text-slate-500 text-xs">até</span>
                   <input 
                     type="date" 
                     className={`bg-transparent text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                     value={endDate}
                     onChange={(e) => handleCustomDateChange('end', e.target.value)}
                   />
                </div>
             </div>

             <div className={`flex items-center p-1.5 rounded-lg border gap-4 ${bgCard}`}>
                <div className="flex gap-3 px-2 border-r border-inherit pr-4">
                   <div><span className="text-[9px] text-orange-500 uppercase font-bold block">Custo (API)</span><span className="text-xs font-mono font-bold text-orange-400">R$ {liveDollar.toFixed(2)}</span></div>
                   <div><span className="text-[9px] text-blue-500 uppercase font-bold block">Receita (Manual)</span><div className="flex items-center gap-1"><span className={`text-[10px] ${textHead}`}>R$</span><input type="number" step="0.01" className={`w-10 bg-transparent text-xs font-mono font-bold outline-none border-b ${isDark ? 'border-slate-700 text-white' : 'border-slate-300 text-black'}`} value={manualDollar} onChange={(e) => handleManualDollarChange(parseFloat(e.target.value))} /></div></div>
                </div>
                <div className={`flex p-1 rounded-md ${isDark ? 'bg-black' : 'bg-slate-100'}`}>
                   <button onClick={() => setViewCurrency('BRL')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'BRL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>R$</button>
                   <button onClick={() => setViewCurrency('USD')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'USD' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>$</button>
                </div>
                <button onClick={toggleTheme} className={`${textMuted} hover:text-indigo-500 px-2`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
             </div>
          </div>
        </header>

        {processedData.totals ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
            <div className={`${bgCard} border-t-4 border-t-blue-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Receita Total</p><p className="text-2xl font-bold text-blue-500">{formatMoney(processedData.totals.revenue)}</p></div>
            <div className={`${bgCard} border-t-4 border-t-orange-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Custos Totais</p><p className="text-2xl font-bold text-orange-500">{formatMoney(processedData.totals.cost)}</p></div>
            <div className={`${bgCard} border-t-4 ${processedData.totals.profit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'} p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Lucro Líquido</p><p className={`text-2xl font-bold ${processedData.totals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(processedData.totals.profit)}</p></div>
            <div className={`${bgCard} border-t-4 border-t-indigo-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">ROI</p><p className="text-2xl font-bold text-indigo-500">{processedData.totals.roi.toFixed(1)}%</p></div>
            <div className={`${bgCard} border-t-4 border-t-rose-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Reembolsos</p><p className="text-2xl font-bold text-rose-500">{formatMoney(processedData.totals.refunds)}</p></div>
          </div>
        ) : (
           <div className="text-center py-20 bg-slate-900/20 rounded-xl mb-8 border border-dashed border-slate-800"><p className="text-slate-500">Nenhum dado encontrado.</p></div>
        )}

        <div className={`${bgCard} rounded-xl p-6 mb-8 h-80 shadow-sm`}>
           <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processedData.chart}>
                 <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
                 <XAxis dataKey="shortDate" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                 <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                 <Tooltip contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0', color: isDark ? '#fff' : '#000' }} formatter={(val:any) => formatMoney(val)} />
                 <Legend />
                 <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                 <Bar dataKey="cost" name="Custo" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={40} />
                 <Bar dataKey="profit" name="Lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
           </ResponsiveContainer>
        </div>

        <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border border-inherit`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'}`}>
                <tr><th className="px-6 py-4">Data</th><th className="px-6 py-4 text-right text-blue-600">Receita</th><th className="px-6 py-4 text-right text-orange-600">Custo</th><th className="px-6 py-4 text-right text-emerald-600">Lucro</th><th className="px-6 py-4 text-right">ROI</th></tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                {processedData.table.map((row: any) => {
                  const dateParts = row.date.split('-');
                  const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                  return (
                    <tr key={row.date} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                      <td className={`px-6 py-4 font-bold ${textHead}`}>{formattedDate}</td>
                      <td className="px-6 py-4 text-right font-bold text-blue-500 bg-blue-500/5">{formatMoney(row.revenue)}</td>
                      <td className="px-6 py-4 text-right font-medium text-orange-500">{formatMoney(row.cost)}</td>
                      <td className={`px-6 py-4 text-right font-bold ${row.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(row.profit)}</td>
                      <td className={`px-6 py-4 text-right font-bold ${row.roi >= 0 ? 'text-indigo-500' : 'text-rose-500'}`}>{row.roi.toFixed(0)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}