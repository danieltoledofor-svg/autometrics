"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Target, TrendingUp, Calendar as CalIcon, Edit2, Plus, Trash2,
  Sun, Moon, ChevronDown, ChevronRight, Save, DollarSign, AlertCircle, 
  Briefcase, Globe, LayoutGrid, LogOut, Package, FileText, Settings, ArrowLeft,
  Calendar
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line 
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Configuração Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function PlanningPage() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  
  // Dados
  const [metrics, setMetrics] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [extraCosts, setExtraCosts] = useState<any[]>([]);
  const [goal, setGoal] = useState({ revenue: 0, profit: 0, limit: 0 });

  // --- NOVO PADRÃO DE DATAS ---
  const [dateRange, setDateRange] = useState('this_month'); 
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // -----------------------------

  // UI
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false); 
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({}); 

  // Moeda & Tema
  const [liveDollar, setLiveDollar] = useState(6.00);
  const [manualDollar, setManualDollar] = useState(5.60);
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD'>('BRL');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [tempGoal, setTempGoal] = useState({ revenue: 0, profit: 0, limit: 0 });
  const [newCost, setNewCost] = useState({ date: '', description: '', amount: 0, currency: 'BRL' });

  // INICIALIZAÇÃO
  useEffect(() => {
    async function init() {
      // 1. Auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUser(session.user);

      // 2. Data local e Presets
      setNewCost(prev => ({ ...prev, date: getLocalYYYYMMDD(new Date()) }));
      handlePresetChange('this_month'); // Começa com "Este Mês"

      // 3. Preferências
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) setTheme(savedTheme);
      const savedDollar = localStorage.getItem('autometrics_manual_dollar');
      if (savedDollar) setManualDollar(parseFloat(savedDollar));

      fetchLiveDollar();
    }
    init();
  }, []);

  // Recarrega dados quando as datas mudam
  useEffect(() => {
    if (user?.id && startDate && endDate) fetchData(user.id);
  }, [startDate, endDate, user]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('autometrics_theme', newTheme);
  };

  const handleManualDollarChange = (val: number) => {
    setManualDollar(val);
    localStorage.setItem('autometrics_manual_dollar', val.toString());
  };

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
    } catch(e) {}
  }

  // --- LÓGICA DE DATAS UNIFICADA ---
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
    else if (preset === 'custom') return;

    setStartDate(getLocalYYYYMMDD(start));
    setEndDate(getLocalYYYYMMDD(end));
  };

  const handleCustomDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') setStartDate(value); else setEndDate(value);
    setDateRange('custom');
  };

  async function fetchData(userId: string) {
    setLoading(true);
    
    // Metas: Busca pela chave do mês de INÍCIO
    const currentMonthKey = startDate.slice(0, 7);
    const { data: goalData } = await supabase.from('financial_goals').select('*').eq('user_id', userId).eq('month_key', currentMonthKey).single();
    if (goalData) {
      setGoal({ revenue: goalData.revenue_target, profit: goalData.profit_target, limit: goalData.ad_spend_limit });
      setTempGoal({ revenue: goalData.revenue_target, profit: goalData.profit_target, limit: goalData.ad_spend_limit });
    } else {
      setGoal({ revenue: 0, profit: 0, limit: 0 });
    }

    const { data: costData } = await supabase.from('additional_costs').select('*').eq('user_id', userId).gte('date', startDate).lte('date', endDate);
    setExtraCosts(costData || []);

    const { data: prodData } = await supabase.from('products').select('id, currency, name, mcc_name, account_name').eq('user_id', userId);
    setProducts(prodData || []);
    
    if (prodData && prodData.length > 0) {
      const { data: metData } = await supabase.from('daily_metrics').select('*').in('product_id', prodData.map(p => p.id)).gte('date', startDate).lte('date', endDate).order('date', { ascending: true });
      setMetrics(metData || []);
    }
    setLoading(false);
  }

  const processedData = useMemo(() => {
    // A filtragem já acontece no Fetch, mas garantimos aqui também
    const filteredMetrics = metrics.filter(m => m.date >= startDate && m.date <= endDate);
    
    const dailyMap: Record<string, any> = {};
    
    // 1. Ads
    filteredMetrics.forEach(m => {
      const prod = products.find(p => p.id === m.product_id);
      const isUSD = prod?.currency === 'USD';
      const mcc = prod?.mcc_name || 'Sem MCC';
      const account = prod?.account_name || 'Sem Conta';
      
      let cost = Number(m.cost || 0); let revenue = Number(m.conversion_value || 0); let refunds = Number(m.refunds || 0);
      if (viewCurrency === 'BRL') { if (isUSD) { cost *= liveDollar; revenue *= manualDollar; refunds *= manualDollar; } } 
      else { if (!isUSD) { cost /= liveDollar; revenue /= manualDollar; refunds /= manualDollar; } }

      if (!dailyMap[m.date]) dailyMap[m.date] = { date: m.date, revenue: 0, ads_cost: 0, refunds: 0, extra_cost: 0, details: [], mccs: {} };
      const day = dailyMap[m.date];
      day.revenue += revenue; day.ads_cost += cost; day.refunds += refunds;

      if (!day.mccs[mcc]) day.mccs[mcc] = { name: mcc, revenue: 0, ads_cost: 0, refunds: 0, accounts: {} };
      const mccObj = day.mccs[mcc]; mccObj.revenue += revenue; mccObj.ads_cost += cost; mccObj.refunds += refunds;

      if (!mccObj.accounts[account]) mccObj.accounts[account] = { name: account, revenue: 0, ads_cost: 0, refunds: 0 };
      const accObj = mccObj.accounts[account]; accObj.revenue += revenue; accObj.ads_cost += cost; accObj.refunds += refunds;
    });

    // 2. Extras
    extraCosts.forEach(c => {
       // Filtra extras pela data também (embora o fetch já filtre)
       if (c.date < startDate || c.date > endDate) return;
       if (!dailyMap[c.date]) dailyMap[c.date] = { date: c.date, revenue: 0, ads_cost: 0, refunds: 0, extra_cost: 0, details: [], mccs: {} };
       
       let amount = Number(c.amount);
       if (viewCurrency === 'BRL' && c.currency === 'USD') amount *= liveDollar;
       else if (viewCurrency === 'USD' && c.currency === 'BRL') amount /= liveDollar;
       const day = dailyMap[c.date]; day.extra_cost += amount;
       day.details.push({ id: c.id, desc: c.description, val: amount });
    });

    const daysArray = Object.values(dailyMap).sort((a: any, b: any) => b.date.localeCompare(a.date));
    const totals = { revenue: 0, ads_cost: 0, extra_cost: 0, refunds: 0, total_cost: 0, profit: 0, roi: 0 };
    daysArray.forEach((d: any) => { totals.revenue += d.revenue; totals.ads_cost += d.ads_cost; totals.extra_cost += d.extra_cost; totals.refunds += d.refunds; });
    totals.total_cost = totals.ads_cost + totals.extra_cost;
    totals.profit = totals.revenue - totals.total_cost - totals.refunds;
    totals.roi = totals.ads_cost > 0 ? (totals.profit / totals.ads_cost) * 100 : 0;
    
    // Projeções
    const today = new Date();
    const currentMonthKey = startDate.slice(0, 7);
    const isCurrentMonth = currentMonthKey === getLocalYYYYMMDD(today).slice(0, 7);
    const daysInMonth = new Date(parseInt(currentMonthKey.split('-')[0]), parseInt(currentMonthKey.split('-')[1]), 0).getDate();
    const daysPassed = isCurrentMonth ? Math.max(today.getDate(), 1) : daysInMonth;
    const projectedRevenue = isCurrentMonth ? (totals.revenue / daysPassed) * daysInMonth : totals.revenue;
    const revenueProgress = goal.revenue > 0 ? (totals.revenue / goal.revenue) * 100 : 0;

    let accRev = 0;
    const chartData = [...daysArray].sort((a: any, b: any) => a.date.localeCompare(b.date)).map((d: any) => {
       accRev += d.revenue;
       return { date: d.date.split('-')[2], revenue: accRev, ideal: (goal.revenue / daysInMonth) * parseInt(d.date.split('-')[2]) };
    });

    return { daysArray, totals, chartData, projectedRevenue, revenueProgress };
  }, [metrics, extraCosts, products, viewCurrency, liveDollar, manualDollar, goal, startDate, endDate]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);
  const toggleExpand = (id: string) => { setExpandedRows(prev => ({ ...prev, [id]: !prev[id] })); };

  const handleSaveGoal = async () => {
    const userId = user?.id;
    if (!userId) return;
    const currentMonthKey = startDate.slice(0, 7);
    const payload = { user_id: userId, month_key: currentMonthKey, revenue_target: Number(tempGoal.revenue), profit_target: Number(tempGoal.profit), ad_spend_limit: Number(tempGoal.limit) };
    await supabase.from('financial_goals').upsert(payload, { onConflict: 'user_id, month_key' });
    setGoal(tempGoal); setIsGoalModalOpen(false);
  };
  const handleAddCost = async () => {
    const userId = user?.id;
    if (!userId) return;
    if (!newCost.description || !newCost.amount) return alert("Preencha descrição e valor.");
    await supabase.from('additional_costs').insert([{ ...newCost, user_id: userId, amount: Number(newCost.amount) }]);
    setNewCost({ date: getLocalYYYYMMDD(new Date()), description: '', amount: 0, currency: 'BRL' });
    setIsCostModalOpen(false);
    fetchData(userId);
  };
  const handleDeleteCost = async (id: string) => {
    if(!confirm("Tem certeza?")) return;
    await supabase.from('additional_costs').delete().eq('id', id);
    if (user?.id) fetchData(user.id);
  };

  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';

  if (loading) return <div className={`min-h-screen ${bgMain} flex items-center justify-center`}>Carregando dados...</div>;

  return (
    <div className={`min-h-screen font-sans p-4 md:p-8 ${bgMain}`}>
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
        <div>
           <Link href="/dashboard" className={`text-xs ${textMuted} hover:underline mb-2 block`}>&larr; Voltar ao Dashboard</Link>
           <h1 className={`text-2xl font-bold ${textHead} flex items-center gap-2`}><Target className="text-indigo-500" /> Planejamento & DRE</h1>
        </div>

        <div className="flex flex-wrap gap-4 items-center">
           
           {/* SELETOR DE DATA UNIFICADO */}
           <div className={`flex items-center p-1.5 rounded-xl border ${bgCard} shadow-sm`}>
                <div className="flex items-center gap-2 px-2 border-r border-inherit">
                   <Calendar size={18} className="text-indigo-500"/>
                   <select className={`bg-transparent text-sm font-bold outline-none cursor-pointer ${textHead} w-24`} value={dateRange} onChange={(e) => handlePresetChange(e.target.value)}>
                      <option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="7d">7 Dias</option><option value="30d">30 Dias</option><option value="this_month">Este Mês</option><option value="last_month">Mês Passado</option><option value="custom">Personalizado</option>
                   </select>
                </div>
                <div className="flex items-center gap-2 px-2">
                   <input type="date" className={`bg-transparent text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={startDate} onChange={(e) => handleCustomDateChange('start', e.target.value)} />
                   <span className="text-slate-500 text-xs">até</span>
                   <input type="date" className={`bg-transparent text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={endDate} onChange={(e) => handleCustomDateChange('end', e.target.value)} />
                </div>
           </div>
           
           <div className={`flex items-center p-1.5 rounded-lg border gap-4 ${bgCard}`}>
              <div className={`flex gap-3 px-2 border-r ${borderCol} pr-4`}>
                 <div><span className="text-[9px] text-orange-500 uppercase font-bold block">Custo (API)</span><span className="text-xs font-mono font-bold text-orange-400">R$ {liveDollar.toFixed(2)}</span></div>
                 <div><span className="text-[9px] text-blue-500 uppercase font-bold block">Receita (Manual)</span><div className="flex items-center gap-1"><span className={`text-[10px] ${textMuted}`}>R$</span><input type="number" step="0.01" className={`w-10 bg-transparent text-xs font-mono font-bold outline-none border-b ${isDark ? 'border-slate-700 text-white' : 'border-slate-300 text-black'}`} value={manualDollar} onChange={(e) => handleManualDollarChange(parseFloat(e.target.value))} /></div></div>
              </div>
              <div className={`flex p-1 rounded-md ${isDark ? 'bg-black' : 'bg-slate-100'}`}>
                 <button onClick={() => setViewCurrency('BRL')} className={`px-3 py-1 rounded text-xs font-bold ${viewCurrency === 'BRL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>R$</button>
                 <button onClick={() => setViewCurrency('USD')} className={`px-3 py-1 rounded text-xs font-bold ${viewCurrency === 'USD' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>$</button>
              </div>
              <button onClick={toggleTheme} className={`${textMuted} hover:text-indigo-500 px-2`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
           </div>
           <button onClick={() => setEditMode(!editMode)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${editMode ? 'bg-amber-500 text-white shadow-lg' : `${bgCard} ${textMuted}`}`}><Edit2 size={14}/> {editMode ? 'Modo Edição Ativo' : 'Editar Planilha'}</button>
           <button onClick={() => setIsGoalModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-lg"><Target size={14}/> Metas</button>
        </div>
      </div>

      {/* ... (Resto do conteúdo da página mantido igual: KPIs, Gráfico, Tabela, Modais) ... */}
      {/* KPI SUMÁRIO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-blue-500 shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase">Receita</p><p className="text-2xl font-bold text-blue-500">{formatMoney(processedData.totals.revenue)}</p></div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-orange-500 shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase">Custo Ads</p><p className="text-2xl font-bold text-orange-500">{formatMoney(processedData.totals.ads_cost)}</p></div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-amber-500 shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase">Outros Custos</p><p className="text-2xl font-bold text-amber-500">{formatMoney(processedData.totals.extra_cost)}</p></div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 ${processedData.totals.profit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'} shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase">Lucro Líquido</p><p className={`text-2xl font-bold ${processedData.totals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(processedData.totals.profit)}</p></div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-indigo-500 shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase">ROI</p><p className="text-2xl font-bold text-indigo-500">{processedData.totals.roi.toFixed(1)}%</p></div>
      </div>

      {/* GRÁFICO */}
      <div className={`${bgCard} rounded-xl p-6 mb-8 h-64 shadow-sm`}>
         <ResponsiveContainer width="100%" height="100%">
             <AreaChart data={processedData.chartData}>
                <defs><linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
                <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v/1000}k`} />
                <Tooltip contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0', color: isDark ? '#fff' : '#000' }} formatter={(v:any) => formatMoney(v)} />
                <Area type="monotone" dataKey="revenue" name="Receita Acumulada" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorReal)" />
                <Line type="monotone" dataKey="ideal" name="Meta" stroke="#94a3b8" strokeDasharray="5 5" dot={false} />
             </AreaChart>
         </ResponsiveContainer>
      </div>

      {/* TABELA DE DRE (EXPANSÍVEL) */}
      <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
         <div className={`p-4 border-b ${borderCol} flex justify-between items-center`}>
            <h3 className={`font-bold ${textHead}`}>Detalhamento Diário (DRE)</h3>
            <button onClick={() => setIsCostModalOpen(true)} className="flex items-center gap-2 text-xs font-bold bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 transition-colors">
               <Plus size={14}/> Add Custo Extra
            </button>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
               <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'}`}>
                  <tr>
                     <th className="px-6 py-4 w-10"></th>
                     <th className="px-6 py-4">Data</th>
                     <th className="px-6 py-4 text-right text-blue-600">Receita</th>
                     <th className="px-6 py-4 text-right text-orange-600">Ads Cost</th>
                     <th className="px-6 py-4 text-right text-amber-500">Outros Custos</th>
                     <th className="px-6 py-4 text-right text-rose-400">Reembolso</th>
                     <th className="px-6 py-4 text-right text-emerald-600">Lucro</th>
                  </tr>
               </thead>
               <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                  {processedData.daysArray.map((day: any) => {
                     const isExpanded = expandedRows[day.date];
                     const profit = day.revenue - day.ads_cost - day.extra_cost - day.refunds;
                     const dateParts = day.date.split('-');
                     
                     return (
                        <React.Fragment key={day.date}>
                           {/* LINHA PRINCIPAL (DIA) */}
                           <tr className={`transition-colors cursor-pointer ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'} ${isExpanded ? (isDark ? 'bg-slate-900' : 'bg-slate-50') : ''}`} onClick={() => toggleExpand(day.date)}>
                              <td className="px-6 py-4 text-center">
                                 {Object.keys(day.mccs).length > 0 && (isExpanded ? <ChevronDown size={16} className="text-slate-500"/> : <ChevronRight size={16} className="text-slate-500"/>)}
                              </td>
                              <td className={`px-6 py-4 font-bold ${textHead}`}>{`${dateParts[2]}/${dateParts[1]}`}</td>
                              <td className="px-6 py-4 text-right font-bold text-blue-500">{formatMoney(day.revenue)}</td>
                              <td className="px-6 py-4 text-right font-medium text-orange-500">{formatMoney(day.ads_cost)}</td>
                              
                              {/* CUSTOS EXTRAS */}
                              <td className="px-6 py-4 text-right relative align-top" onClick={(e) => e.stopPropagation()}>
                                 {day.extra_cost > 0 ? (
                                    <div className="flex flex-col items-end gap-1">
                                       <span className="text-amber-500 font-bold">{formatMoney(day.extra_cost)}</span>
                                       <div className="flex flex-col gap-1 w-full items-end mt-1 border-t border-dashed border-slate-700 pt-1">
                                          {day.details.map((d: any) => (
                                             <div key={d.id} className="flex items-center gap-2 group/item">
                                                <span className={`text-[10px] ${textMuted} truncate max-w-[100px]`} title={d.desc}>{d.desc}</span>
                                                <span className={`text-[10px] ${textHead}`}>{formatMoney(d.val)}</span>
                                                {/* Botão Excluir (Só com Modo Edição) */}
                                                {editMode && (
                                                   <button 
                                                     onClick={(e) => { e.stopPropagation(); handleDeleteCost(d.id); }} 
                                                     className="text-rose-500 hover:text-rose-400 p-1 bg-rose-500/10 rounded"
                                                     title="Excluir Custo"
                                                   >
                                                      <Trash2 size={10} />
                                                   </button>
                                                )}
                                             </div>
                                          ))}
                                       </div>
                                    </div>
                                 ) : <span className="text-slate-600">-</span>}
                              </td>

                              <td className="px-6 py-4 text-right text-rose-400">{day.refunds > 0 ? formatMoney(day.refunds) : '-'}</td>
                              <td className={`px-6 py-4 text-right font-bold ${profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(profit)}</td>
                           </tr>

                           {/* LINHAS EXPANDIDAS (DETALHE MCC/CONTA) */}
                           {isExpanded && Object.values(day.mccs).map((mcc: any) => (
                              <React.Fragment key={mcc.name}>
                                 <tr className={`${isDark ? 'bg-slate-950/50' : 'bg-slate-100/50'}`}>
                                    <td></td>
                                    <td className="px-6 py-2 text-xs font-bold text-indigo-400 pl-10 flex items-center gap-2">
                                       <Globe size={12}/> MCC: {mcc.name}
                                    </td>
                                    <td className="px-6 py-2 text-right text-xs text-blue-400/70">{formatMoney(mcc.revenue)}</td>
                                    <td className="px-6 py-2 text-right text-xs text-orange-400/70">{formatMoney(mcc.ads_cost)}</td>
                                    <td colSpan={3}></td>
                                 </tr>
                                 {Object.values(mcc.accounts).map((acc: any) => (
                                    <tr key={acc.name} className={`${isDark ? 'bg-slate-950/30' : 'bg-slate-100/30'}`}>
                                       <td></td>
                                       <td className="px-6 py-1 text-[10px] text-slate-500 pl-16 flex items-center gap-2 border-l-2 border-slate-800 ml-10">
                                          <Briefcase size={10}/> {acc.name}
                                       </td>
                                       <td className="px-6 py-1 text-right text-[10px] text-slate-600">{formatMoney(acc.revenue)}</td>
                                       <td className="px-6 py-1 text-right text-[10px] text-slate-600">{formatMoney(acc.ads_cost)}</td>
                                       <td colSpan={3}></td>
                                    </tr>
                                 ))}
                              </React.Fragment>
                           ))}
                        </React.Fragment>
                     );
                  })}
               </tbody>
               <tfoot className={`text-xs uppercase font-bold border-t-2 ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-100 border-slate-300 text-black'}`}>
                  <tr>
                     <td className="px-6 py-4">TOTAIS</td>
                     <td className="px-6 py-4"></td>
                     <td className="px-6 py-4 text-right text-blue-500">{formatMoney(processedData.totals.revenue)}</td>
                     <td className="px-6 py-4 text-right text-orange-500">{formatMoney(processedData.totals.ads_cost)}</td>
                     <td className="px-6 py-4 text-right text-amber-500">{formatMoney(processedData.totals.extra_cost)}</td>
                     <td className="px-6 py-4 text-right text-rose-400">{formatMoney(processedData.totals.refunds)}</td>
                     <td className={`px-6 py-4 text-right ${processedData.totals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(processedData.totals.profit)}</td>
                  </tr>
               </tfoot>
            </table>
         </div>
      </div>

      {/* MODAL CUSTO EXTRA */}
      {isCostModalOpen && (
         <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`${bgCard} rounded-xl w-full max-w-sm p-6 shadow-2xl`}>
               <h3 className={`text-lg font-bold ${textHead} mb-4`}>Lançar Custo Extra</h3>
               <div className="space-y-3">
                  <div>
                    <label className="text-xs uppercase font-bold text-slate-500">Data do Gasto</label>
                    <input type="date" className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol} [&::-webkit-calendar-picker-indicator]:invert`} value={newCost.date} onChange={e => setNewCost({...newCost, date: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-xs uppercase font-bold text-slate-500">Descrição</label>
                    <input type="text" placeholder="Ex: Hospedagem, Copywriter..." className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={newCost.description} onChange={e => setNewCost({...newCost, description: e.target.value})} />
                  </div>
                  <div className="flex gap-2">
                     <div className="flex-1">
                        <label className="text-xs uppercase font-bold text-slate-500">Valor</label>
                        <input type="number" placeholder="0.00" className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={newCost.amount} onChange={e => setNewCost({...newCost, amount: parseFloat(e.target.value)})} />
                     </div>
                     <div className="w-24">
                        <label className="text-xs uppercase font-bold text-slate-500">Moeda</label>
                        <select className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={newCost.currency} onChange={e => setNewCost({...newCost, currency: e.target.value})}>
                           <option value="BRL">BRL</option>
                           <option value="USD">USD</option>
                        </select>
                     </div>
                  </div>
                  <button onClick={handleAddCost} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded mt-2">Salvar Despesa</button>
                  <button onClick={() => setIsCostModalOpen(false)} className={`w-full py-2 ${textMuted} hover:underline`}>Cancelar</button>
               </div>
            </div>
         </div>
      )}

      {/* MODAL METAS */}
      {isGoalModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className={`${bgCard} rounded-xl w-full max-w-sm p-6 shadow-2xl`}>
              <h2 className={`text-xl font-bold ${textHead} mb-4`}>Metas do Mês</h2>
              <div className="space-y-3">
                 <div><label className="text-xs uppercase text-blue-500 font-bold">Meta Faturamento</label><input type="number" className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={tempGoal.revenue} onChange={e => setTempGoal({...tempGoal, revenue: parseFloat(e.target.value)})} /></div>
                 <div><label className="text-xs uppercase text-emerald-500 font-bold">Meta Lucro</label><input type="number" className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={tempGoal.profit} onChange={e => setTempGoal({...tempGoal, profit: parseFloat(e.target.value)})} /></div>
                 <div><label className="text-xs uppercase text-amber-500 font-bold">Teto de Gastos</label><input type="number" className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={tempGoal.limit} onChange={e => setTempGoal({...tempGoal, limit: parseFloat(e.target.value)})} /></div>
                 <button onClick={handleSaveGoal} className="w-full bg-indigo-600 text-white font-bold py-2 rounded hover:bg-indigo-700 mt-2">Salvar Metas</button>
                 <button onClick={() => setIsGoalModalOpen(false)} className={`w-full py-2 ${textMuted} hover:underline`}>Cancelar</button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}