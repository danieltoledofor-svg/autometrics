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
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  
  // Filtro de MCC
  const [selectedMcc, setSelectedMcc] = useState<string>('all');

  // Configurações Globais (Moeda e Tema)
  const [liveDollar, setLiveDollar] = useState(6.00); 
  const [manualDollar, setManualDollar] = useState(5.60); 
  const [liveEuro, setLiveEuro] = useState(6.50); 
  const [manualEuro, setManualEuro] = useState(6.00); 
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD' | 'EUR'>('BRL');
  const [rateConfig, setRateConfig] = useState<'USD' | 'EUR'>('USD');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // --- INICIALIZAÇÃO E AUTENTICAÇÃO ---
  useEffect(() => {
    async function init() {
      // 1. Recupera Preferências Salvas
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) setTheme(savedTheme);

      const savedDollar = localStorage.getItem('autometrics_manual_dollar');
      if (savedDollar) setManualDollar(parseFloat(savedDollar));

      const savedEuro = localStorage.getItem('autometrics_manual_euro');
      if (savedEuro) setManualEuro(parseFloat(savedEuro));

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
        fetchLiveRates()
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

  async function fetchLiveRates() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
      if (data.EURBRL) setLiveEuro(parseFloat(data.EURBRL.bid));
    } catch (e) { console.error(e); }
  }

  async function fetchInitialData(userId: string) {
    const { data: prodData } = await supabase
      .from('products')
      .select('id, currency, name, google_ads_campaign_name, account_name, mcc_name')
      .eq('user_id', userId); 

    setProducts(prodData || []);

    // Se tiver produtos, busca as métricas deles
    if (prodData && prodData.length > 0) {
        const productIds = prodData.map(p => p.id);
        
        let allMetrics = [];
        let page = 0;
        let hasMore = true;
        
        while(hasMore) {
           const { data: chunk, error } = await supabase
             .from('daily_metrics')
             .select('*')
             .in('product_id', productIds)
             .range(page * 1000, (page + 1) * 1000 - 1)
             .order('date', { ascending: false });
             
           if (chunk && chunk.length > 0) {
              allMetrics.push(...chunk);
              if (chunk.length < 1000) hasMore = false;
              else page++;
           } else {
              hasMore = false;
           }
        }
        setMetrics(allMetrics);
    } else {
        setMetrics([]);
    }
  }

  const handleManualDollarChange = (val: number) => {
    setManualDollar(val);
    localStorage.setItem('autometrics_manual_dollar', val.toString());
  };

  const handleManualEuroChange = (val: number) => {
    setManualEuro(val);
    localStorage.setItem('autometrics_manual_euro', val.toString());
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

  // --- MCCs DISPONÍVEIS ---
  const availableMccs = useMemo(() => {
    const mccs = new Set<string>();
    let hasIndividuals = false;
    products.forEach(p => {
      if (p.mcc_name && p.mcc_name.trim() !== '') {
        mccs.add(p.mcc_name);
      } else {
        hasIndividuals = true;
      }
    });
    const arr = Array.from(mccs).sort();
    if (hasIndividuals) arr.push('Contas Individuais');
    return arr;
  }, [products]);

  // --- PROCESSAMENTO DE DADOS ---
  const processedData = useMemo(() => {
    if (loading || !metrics.length) return { chart: [], table: [], totals: null };

    const dailyMap = new Map();

    metrics.forEach(row => {
      // Filtra usando as datas do estado (startDate / endDate)
      if (row.date < startDate || row.date > endDate) return;

      const product = products.find(p => p.id === row.product_id);
      
      const mccName = product?.mcc_name?.trim() ? product.mcc_name : 'Contas Individuais';

      // Filtra por MCC
      if (selectedMcc !== 'all' && mccName !== selectedMcc) {
        return;
      }
      
      const isUSD = product?.currency === 'USD';
      const isEUR = product?.currency === 'EUR';
      
      const accountName = row.account_name || product?.account_name || product?.mcc_name || 'Desconhecida';
      const campaignName = product?.name || 'Venda Externa';

      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);

      // Conversão de Moeda (Primeiro para BRL Base)
      let costInBRL = cost;
      let revenueInBRL = revenue;
      let refundsInBRL = refunds;
      
      if (isUSD) {
         costInBRL *= liveDollar;
         revenueInBRL *= manualDollar;
         refundsInBRL *= manualDollar;
      } else if (isEUR) {
         costInBRL *= liveEuro;
         revenueInBRL *= manualEuro;
         refundsInBRL *= manualEuro;
      }

      // Converte para a Moeda de Visualização
      if (viewCurrency === 'BRL') {
         cost = costInBRL;
         revenue = revenueInBRL;
         refunds = refundsInBRL;
      } else if (viewCurrency === 'USD') {
         cost = costInBRL / liveDollar;
         revenue = revenueInBRL / manualDollar;
         refunds = refundsInBRL / manualDollar;
      } else if (viewCurrency === 'EUR') {
         cost = costInBRL / liveEuro;
         revenue = revenueInBRL / manualEuro;
         refunds = refundsInBRL / manualEuro;
      }

      const profit = revenue - cost - refunds;

      // 1. Agrupamento por Dia
      if (!dailyMap.has(row.date)) {
         dailyMap.set(row.date, { date: row.date, cost: 0, revenue: 0, profit: 0, refunds: 0, accounts: {} });
      }
      const day = dailyMap.get(row.date);
      
      day.cost += cost;
      day.revenue += revenue;
      day.refunds += refunds;
      day.profit += profit;

      // 2. Sub-Agrupamento por Conta
      if (!day.accounts[accountName]) {
         day.accounts[accountName] = { name: accountName, cost: 0, revenue: 0, profit: 0, refunds: 0, campaigns: {} };
      }
      const acc = day.accounts[accountName];
      acc.cost += cost; acc.revenue += revenue; acc.profit += profit; acc.refunds += refunds;

      // 3. Sub-Agrupamento por Campanha
      if (!acc.campaigns[campaignName]) {
         acc.campaigns[campaignName] = { name: campaignName, cost: 0, revenue: 0, profit: 0, refunds: 0 };
      }
      const cmp = acc.campaigns[campaignName];
      cmp.cost += cost; cmp.revenue += revenue; cmp.profit += profit; cmp.refunds += refunds;
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
  }, [metrics, products, startDate, endDate, liveDollar, manualDollar, liveEuro, manualEuro, viewCurrency, loading, selectedMcc]);

  // --- ESTILOS DINÂMICOS ---
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';
  
  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : viewCurrency === 'EUR' ? 'de-DE' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);
  const toggleExpand = (id: string) => { setExpandedRows(prev => ({ ...prev, [id]: !prev[id] })); };

  if (loading) return <div className={`min-h-screen ${bgMain} flex items-center justify-center`}>Carregando dados...</div>;

  return (
    <div className={`min-h-screen font-sans flex ${bgMain}`}>
      <aside className={`w-16 md:w-64 shrink-0 border-r flex flex-col sticky top-0 h-screen z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        
        {/* Logo - ADICIONADO overflow-hidden PARA EVITAR QUE A LOGO CUBRA O BOTÃO */}
        <div className="h-20 flex items-center justify-center md:justify-start md:px-6 border-b border-inherit overflow-hidden shrink-0">
           <div className="hidden md:block relative"> 
             {/* Logo com Sombra no modo Claro para garantir visibilidade */}
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
        
        <nav className="flex-1 px-2 py-4 space-y-2">
           <Link href="/dashboard" className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
             <LayoutGrid size={20} /> 
             <span className="hidden md:block font-medium">Dashboard</span>
           </Link>
           
           <Link href="/planning" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Target size={20} /> <span className="hidden md:block font-medium">Planejamento</span></Link>
           
           <Link href="/products" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Package size={20} /> <span className="hidden md:block font-medium">Meus Produtos</span></Link>
           
           <Link href="/integration" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Settings size={20} /> <span className="hidden md:block font-medium">Integração</span></Link>
        </nav>
        <div className="p-4 border-t border-inherit">
           <button onClick={handleLogout} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-rose-500 hover:bg-rose-500/10`}><LogOut size={20} /> <span className="hidden md:block font-medium">Sair ({user?.email?.split('@')[0]})</span></button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        {/* Header e Filtros */}
        <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
          <div className="flex justify-between items-center w-full xl:w-auto">
             <div><h1 className={`text-2xl font-bold ${textHead}`}>Visão Geral</h1><p className={textMuted}>Acompanhe seus resultados consolidados.</p></div>
             <button onClick={toggleTheme} className={`xl:hidden p-2 rounded-lg border ${bgCard} ${textMuted}`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-stretch sm:items-center w-full xl:w-auto">
             
             {/* SELETOR DE MCC E DATA */}
             <div className="flex flex-col sm:flex-row flex-wrap gap-4 w-full sm:w-auto">
                 {availableMccs.length > 0 && (
                 <div className={`flex items-center p-2 sm:p-1.5 rounded-xl border ${bgCard} shadow-sm w-full sm:w-auto`}>
                    <div className="flex items-center gap-2 px-2 w-full">
                       <Target size={18} className={isDark ? "text-white" : "text-indigo-600"}/>
                       <select 
                          className={`bg-transparent text-sm font-bold outline-none cursor-pointer flex-1 sm:w-32 ${textHead}`}
                          value={selectedMcc}
                          onChange={(e) => setSelectedMcc(e.target.value)}
                       >
                          <option value="all">Visão Geral (Todas)</option>
                          {availableMccs.map(mcc => (
                             <option key={mcc} value={mcc}>{mcc}</option>
                          ))}
                       </select>
                    </div>
                 </div>
                 )}

                 {/* SELETOR DE DATA UNIFICADO */}
                 <div className={`flex flex-col sm:flex-row items-stretch sm:items-center p-2 sm:p-1.5 rounded-xl border ${bgCard} shadow-sm w-full sm:w-auto gap-2 sm:gap-0`}>
                    <div className="flex items-center justify-between sm:justify-start gap-2 px-2 pb-2 sm:pb-0 sm:border-r border-b sm:border-b-0 border-inherit">
                       <div className="flex items-center gap-2">
                          {/* Ícone: Branco no escuro, Indigo no claro */}
                          <Calendar size={18} className={isDark ? "text-white" : "text-indigo-600"}/>
                          <select 
                             className={`bg-transparent text-sm font-bold outline-none cursor-pointer ${textHead} w-auto`}
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
                    </div>
                    <div className="flex items-center justify-between sm:justify-start gap-2 px-2">
                       <input 
                         type="date" 
                         className={`bg-transparent flex-1 sm:flex-none sm:w-[110px] text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                         value={startDate}
                         onChange={(e) => handleCustomDateChange('start', e.target.value)}
                       />
                       <span className="text-slate-500 text-xs">até</span>
                       <input 
                         type="date" 
                         className={`bg-transparent flex-1 sm:flex-none sm:w-[110px] text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                         value={endDate}
                         onChange={(e) => handleCustomDateChange('end', e.target.value)}
                       />
                    </div>
                 </div>
             </div>

             <div className={`flex flex-col sm:flex-row items-stretch sm:items-center p-2 sm:p-1.5 rounded-lg border gap-4 sm:gap-4 flex-wrap xl:flex-nowrap ${bgCard} w-full sm:w-auto`}>
                <div className="flex items-center justify-between sm:justify-start gap-3 px-2 pb-2 sm:pb-0 sm:border-r border-b sm:border-b-0 border-inherit pr-4">
                   <div>
                      <span className="text-[9px] text-orange-500 uppercase font-bold block">{rateConfig === 'USD' ? 'Dólar Agora' : 'Euro Agora'}</span>
                      <span className="text-xs font-mono font-bold text-orange-400">R$ {(rateConfig === 'USD' ? liveDollar : liveEuro).toFixed(2)}</span>
                   </div>
                   <div>
                      <span className="text-[9px] text-blue-500 uppercase font-bold block">{rateConfig === 'USD' ? 'Meu Dólar' : 'Meu Euro'}</span>
                      <div className="flex items-center gap-1">
                         <span className={`text-[10px] ${textHead}`}>R$</span>
                         <input 
                            type="number" step="0.01" 
                            className={`w-12 bg-transparent text-xs font-mono font-bold outline-none border-b ${isDark ? 'border-slate-700 text-white' : 'border-slate-300 text-black'}`} 
                            value={rateConfig === 'USD' ? manualDollar : manualEuro} 
                            onChange={(e) => rateConfig === 'USD' ? handleManualDollarChange(parseFloat(e.target.value)) : handleManualEuroChange(parseFloat(e.target.value))} 
                         />
                      </div>
                   </div>
                </div>
                
                <div className={`flex justify-between sm:justify-start items-center p-1 rounded-md gap-1 ${isDark ? 'bg-black' : 'bg-slate-100'} w-full sm:w-auto`}>
                   <button onClick={() => setViewCurrency('BRL')} className={`flex-1 sm:flex-none px-2 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'BRL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>R$</button>
                   <button onClick={() => { setViewCurrency('USD'); setRateConfig('USD'); }} className={`flex-1 sm:flex-none px-2 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'USD' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>$</button>
                   <button onClick={() => { setViewCurrency('EUR'); setRateConfig('EUR'); }} className={`flex-1 sm:flex-none px-2 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'EUR' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>€</button>
                </div>
                <button onClick={toggleTheme} className={`hidden xl:block ${textMuted} hover:text-indigo-500 px-2`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
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
                <tr>
                   <th className="px-6 py-4 w-10"></th>
                   <th className="px-6 py-4">Data</th>
                   <th className="px-6 py-4 text-right text-blue-600">Receita</th>
                   <th className="px-6 py-4 text-right text-orange-600">Custo</th>
                   <th className="px-6 py-4 text-right text-emerald-600">Lucro</th>
                   <th className="px-6 py-4 text-right">ROI</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                {processedData.table.map((row: any) => {
                  const dateParts = row.date.split('-');
                  const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                  const isExpanded = expandedRows[row.date];

                  return (
                    <React.Fragment key={row.date}>
                       <tr onClick={() => toggleExpand(row.date)} className={`transition-colors cursor-pointer ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'} ${isExpanded ? (isDark ? 'bg-slate-900' : 'bg-slate-50') : ''}`}>
                         <td className="px-6 py-4 text-center">
                            {Object.keys(row.accounts).length > 0 && (
                               isExpanded ? <ArrowDownRight size={16} className="text-slate-500"/> : <ArrowUpRight size={16} className="text-slate-500"/>
                            )}
                         </td>
                         <td className={`px-6 py-4 font-bold ${textHead}`}>{formattedDate}</td>
                         <td className="px-6 py-4 text-right font-bold text-blue-500">{formatMoney(row.revenue)}</td>
                         <td className="px-6 py-4 text-right font-medium text-orange-500">{formatMoney(row.cost)}</td>
                         <td className={`px-6 py-4 text-right font-bold ${row.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(row.profit)}</td>
                         <td className={`px-6 py-4 text-right font-bold ${row.roi >= 0 ? 'text-indigo-500' : 'text-rose-500'}`}>{row.roi.toFixed(0)}%</td>
                       </tr>

                       {isExpanded && Object.values(row.accounts).map((acc: any) => (
                          <React.Fragment key={acc.name}>
                             <tr className={`${isDark ? 'bg-slate-950/50' : 'bg-slate-100/50'}`}>
                                <td></td>
                                <td className="px-6 py-2 text-xs font-bold text-indigo-400 pl-10 flex items-center gap-2">
                                   <Settings size={12}/> Conta: {acc.name}
                                </td>
                                <td className="px-6 py-2 text-right text-xs text-blue-400/70">{formatMoney(acc.revenue)}</td>
                                <td className="px-6 py-2 text-right text-xs text-orange-400/70">{formatMoney(acc.cost)}</td>
                                <td className={`px-6 py-2 text-right text-xs font-medium ${acc.profit >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{formatMoney(acc.profit)}</td>
                                <td></td>
                             </tr>
                             {Object.values(acc.campaigns).map((cmp: any) => (
                                <tr key={cmp.name} className={`${isDark ? 'bg-slate-950/30' : 'bg-slate-100/30'}`}>
                                   <td></td>
                                   <td className="px-6 py-1 text-[10px] text-slate-500 pl-16 flex items-center gap-2 border-l-2 border-slate-800 ml-10">
                                      <Package size={10}/> {cmp.name}
                                   </td>
                                   <td className="px-6 py-1 text-right text-[10px] text-slate-600">{formatMoney(cmp.revenue)}</td>
                                   <td className="px-6 py-1 text-right text-[10px] text-slate-600">{formatMoney(cmp.cost)}</td>
                                   <td className={`px-6 py-1 text-right text-[10px] font-medium ${cmp.profit >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>{formatMoney(cmp.profit)}</td>
                                   <td></td>
                                </tr>
                             ))}
                          </React.Fragment>
                       ))}
                    </React.Fragment>
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