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
  const [prevMetrics, setPrevMetrics] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [extraCosts, setExtraCosts] = useState<any[]>([]);
  const [prevExtraCosts, setPrevExtraCosts] = useState<any[]>([]);
  const [goal, setGoal] = useState({ revenue: 0, profit: 0, limit: 0 });

  // --- NOVO PADRÃO DE DATAS ---
  const [dateRange, setDateRange] = useState('this_month'); 
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // -----------------------------

  // UI
  const [selectedMcc, setSelectedMcc] = useState<string>('all');
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false); 
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({}); 

  // Moeda & Tema
  const [liveDollar, setLiveDollar] = useState(6.00);
  const [manualDollar, setManualDollar] = useState(5.60);
  const [liveEuro, setLiveEuro] = useState(6.50);
  const [manualEuro, setManualEuro] = useState(6.00);
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD' | 'EUR'>('BRL');
  const [rateConfig, setRateConfig] = useState<'USD' | 'EUR'>('USD');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [tempGoal, setTempGoal] = useState({ revenue: 0, profit: 0, limit: 0 });
  const [newCost, setNewCost] = useState({ date: '', description: '', amount: 0, currency: 'BRL', type: 'cost' });

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
      const savedEuro = localStorage.getItem('autometrics_manual_euro');
      if (savedEuro) setManualEuro(parseFloat(savedEuro));

      fetchLiveRates();
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

  const handleManualEuroChange = (val: number) => {
    setManualEuro(val);
    localStorage.setItem('autometrics_manual_euro', val.toString());
  };

  async function fetchLiveRates() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
      if (data.EURBRL) setLiveEuro(parseFloat(data.EURBRL.bid));
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
    
    // Cálculo do período anterior para Comparativo Progressivo
    const sDate = new Date(startDate + "T00:00:00");
    const eDate = new Date(endDate + "T23:59:59");
    const diffTime = Math.abs(eDate.getTime() - sDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const pEndDate = new Date(sDate.getTime() - (1000 * 60 * 60 * 24)); // Um dia antes do start
    const pStartDate = new Date(pEndDate.getTime() - (diffDays * 1000 * 60 * 60 * 24));
    
    const prevStartStr = getLocalYYYYMMDD(pStartDate);
    const prevEndStr = getLocalYYYYMMDD(pEndDate);

    const { data: prevCostData } = await supabase.from('additional_costs').select('*').eq('user_id', userId).gte('date', prevStartStr).lte('date', prevEndStr);
    setPrevExtraCosts(prevCostData || []);

    if (prodData && prodData.length > 0) {
      const fetchMetricsPaginated = async (s: string, e: string) => {
          let res = [];
          let p = 0;
          let m = true;
          while(m) {
             const { data: c } = await supabase.from('daily_metrics').select('*').in('product_id', prodData.map(pr => pr.id)).gte('date', s).lte('date', e).range(p*1000, (p+1)*1000-1);
             if (c && c.length > 0) { res.push(...c); if (c.length < 1000) m = false; else p++; } else m = false;
          }
          return res;
      };

      const metData = await fetchMetricsPaginated(startDate, endDate);
      setMetrics(metData || []);

      const pMetData = await fetchMetricsPaginated(prevStartStr, prevEndStr);
      setPrevMetrics(pMetData || []);
    }
    setLoading(false);
  }

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

  const processedData = useMemo(() => {
    // A filtragem já acontece no Fetch, mas garantimos aqui também
    const filteredMetrics = metrics.filter(m => m.date >= startDate && m.date <= endDate);
    
    const dailyMap: Record<string, any> = {};
    const campaignMap: Record<string, {name: string, revenue: number, cost: number, refunds: number}> = {};
    
    // 1. Ads
    filteredMetrics.forEach(m => {
      const prod = products.find(p => p.id === m.product_id);
      
      const mccName = prod?.mcc_name?.trim() ? prod.mcc_name : 'Contas Individuais';

      // Filtra por MCC
      if (selectedMcc !== 'all' && mccName !== selectedMcc) {
        return;
      }
      
      const isUSD = prod?.currency === 'USD';
      const isEUR = prod?.currency === 'EUR';
      const mcc = mccName;
      const account = m.account_name || prod?.account_name || 'Desconhecida';
      
      let cost = Number(m.cost || 0); let revenue = Number(m.conversion_value || 0); let refunds = Number(m.refunds || 0);
      let costInBRL = cost; let revenueInBRL = revenue; let refundsInBRL = refunds;
      if (isUSD) { costInBRL *= liveDollar; revenueInBRL *= manualDollar; refundsInBRL *= manualDollar; }
      else if (isEUR) { costInBRL *= liveEuro; revenueInBRL *= manualEuro; refundsInBRL *= manualEuro; }

      if (viewCurrency === 'BRL') { cost = costInBRL; revenue = revenueInBRL; refunds = refundsInBRL; }
      else if (viewCurrency === 'USD') { cost = costInBRL / liveDollar; revenue = revenueInBRL / manualDollar; refunds = refundsInBRL / manualDollar; }
      else if (viewCurrency === 'EUR') { cost = costInBRL / liveEuro; revenue = revenueInBRL / manualEuro; refunds = refundsInBRL / manualEuro; }

      if (!dailyMap[m.date]) dailyMap[m.date] = { date: m.date, revenue: 0, ads_cost: 0, refunds: 0, extra_cost: 0, details: [], mccs: {} };
      const day = dailyMap[m.date];
      day.revenue += revenue; day.ads_cost += cost; day.refunds += refunds;

      if (!day.mccs[mcc]) day.mccs[mcc] = { name: mcc, revenue: 0, ads_cost: 0, refunds: 0, accounts: {} };
      const mccObj = day.mccs[mcc]; mccObj.revenue += revenue; mccObj.ads_cost += cost; mccObj.refunds += refunds;

      if (!mccObj.accounts[account]) mccObj.accounts[account] = { name: account, revenue: 0, ads_cost: 0, refunds: 0 };
      if (!mccObj.accounts[account]) mccObj.accounts[account] = { name: account, revenue: 0, ads_cost: 0, refunds: 0 };
      const accObj = mccObj.accounts[account]; accObj.revenue += revenue; accObj.ads_cost += cost; accObj.refunds += refunds;

      // Map para o Widget de Top Campanhas
      const campaignName = prod?.name || 'Venda Externa';
      if (!campaignMap[campaignName]) campaignMap[campaignName] = { name: campaignName, revenue: 0, cost: 0, refunds: 0 };
      campaignMap[campaignName].revenue += revenue;
      campaignMap[campaignName].cost += cost;
      campaignMap[campaignName].refunds += refunds;
    });

    // 2. Extras
    extraCosts.forEach(c => {
       // Filtra extras pela data também (embora o fetch já filtre)
       if (c.date < startDate || c.date > endDate) return;
       if (!dailyMap[c.date]) dailyMap[c.date] = { date: c.date, revenue: 0, ads_cost: 0, refunds: 0, extra_cost: 0, extra_revenue: 0, net_extra: 0, details: [], mccs: {} };
       
       let amount = Number(c.amount);
       let amountInBRL = amount;
       if (c.currency === 'USD') amountInBRL *= liveDollar;
       else if (c.currency === 'EUR') amountInBRL *= liveEuro;

       if (viewCurrency === 'BRL') amount = amountInBRL;
       else if (viewCurrency === 'USD') amount = amountInBRL / liveDollar;
       else if (viewCurrency === 'EUR') amount = amountInBRL / liveEuro;
       const day = dailyMap[c.date];
       if (amount >= 0) day.extra_cost += amount;
       else day.extra_revenue += Math.abs(amount);
       day.net_extra = day.extra_revenue - day.extra_cost;
       day.details.push({ id: c.id, desc: c.description, val: amount });
    });

    const daysArray = Object.values(dailyMap).sort((a: any, b: any) => b.date.localeCompare(a.date));
    const totals = { revenue: 0, ads_cost: 0, extra_cost: 0, extra_revenue: 0, net_extra: 0, refunds: 0, total_cost: 0, profit: 0, roi: 0 };
    daysArray.forEach((d: any) => { totals.revenue += d.revenue; totals.ads_cost += d.ads_cost; totals.extra_cost += d.extra_cost; totals.extra_revenue += d.extra_revenue; totals.refunds += d.refunds; });
    totals.net_extra = totals.extra_revenue - totals.extra_cost;
    totals.total_cost = totals.ads_cost + totals.extra_cost;
    totals.profit = totals.revenue + totals.extra_revenue - totals.total_cost - totals.refunds;
    totals.roi = totals.ads_cost > 0 ? (totals.profit / totals.ads_cost) * 100 : 0;
    
    // --- Cálculo do Período Anterior ---
    const prevTotals = { revenue: 0, ads_cost: 0, extra_cost: 0, extra_revenue: 0, refunds: 0, total_cost: 0, profit: 0, roi: 0 };
    prevMetrics.forEach(m => {
      const prod = products.find(p => p.id === m.product_id);
      
      const mccName = prod?.mcc_name?.trim() ? prod.mcc_name : 'Contas Individuais';

      // Filtra por MCC
      if (selectedMcc !== 'all' && mccName !== selectedMcc) {
        return;
      }

      const isUSD = prod?.currency === 'USD';
      const isEUR = prod?.currency === 'EUR';
      let cost = Number(m.cost || 0); let revenue = Number(m.conversion_value || 0); let refunds = Number(m.refunds || 0);
      let costInBRL = cost; let revenueInBRL = revenue; let refundsInBRL = refunds;
      if (isUSD) { costInBRL *= liveDollar; revenueInBRL *= manualDollar; refundsInBRL *= manualDollar; }
      else if (isEUR) { costInBRL *= liveEuro; revenueInBRL *= manualEuro; refundsInBRL *= manualEuro; }

      if (viewCurrency === 'BRL') { cost = costInBRL; revenue = revenueInBRL; refunds = refundsInBRL; }
      else if (viewCurrency === 'USD') { cost = costInBRL / liveDollar; revenue = revenueInBRL / manualDollar; refunds = refundsInBRL / manualDollar; }
      else if (viewCurrency === 'EUR') { cost = costInBRL / liveEuro; revenue = revenueInBRL / manualEuro; refunds = refundsInBRL / manualEuro; }
      prevTotals.revenue += revenue; prevTotals.ads_cost += cost; prevTotals.refunds += refunds;
    });
    prevExtraCosts.forEach(c => {
       let amount = Number(c.amount);
       let amountInBRL = amount;
       if (c.currency === 'USD') amountInBRL *= liveDollar;
       else if (c.currency === 'EUR') amountInBRL *= liveEuro;

       if (viewCurrency === 'BRL') amount = amountInBRL;
       else if (viewCurrency === 'USD') amount = amountInBRL / liveDollar;
       else if (viewCurrency === 'EUR') amount = amountInBRL / liveEuro;
       if (amount >= 0) prevTotals.extra_cost += amount;
       else prevTotals.extra_revenue += Math.abs(amount);
    });
    prevTotals.total_cost = prevTotals.ads_cost + prevTotals.extra_cost;
    prevTotals.profit = prevTotals.revenue + prevTotals.extra_revenue - prevTotals.total_cost - prevTotals.refunds;
    prevTotals.roi = prevTotals.ads_cost > 0 ? (prevTotals.profit / prevTotals.ads_cost) * 100 : 0;

    const variations = {
      revenue: prevTotals.revenue > 0 ? ((totals.revenue - prevTotals.revenue) / prevTotals.revenue) * 100 : 0,
      ads_cost: prevTotals.ads_cost > 0 ? ((totals.ads_cost - prevTotals.ads_cost) / prevTotals.ads_cost) * 100 : 0,
      profit: prevTotals.profit !== 0 ? ((totals.profit - prevTotals.profit) / Math.abs(prevTotals.profit)) * 100 : 0,
      roi: totals.roi - prevTotals.roi // Pontos percentuais absolutos
    };
    // -----------------------------------

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

    // Cálculos Estratégicos (Break-even e Top Campanhas)
    const breakEvenROAS = totals.ads_cost > 0 ? ((totals.ads_cost + totals.extra_cost) / totals.ads_cost) * 100 : 0;
    
    const campaignsArray = Object.values(campaignMap).map(c => {
       const profit = c.revenue - c.cost - c.refunds;
       const roi = c.cost > 0 ? (profit / c.cost) * 100 : 0;
       return { ...c, profit, roi };
    }).sort((a, b) => b.profit - a.profit);
    
    const activeCampaigns = campaignsArray.filter(c => c.cost > 0 || c.revenue > 0);
    const topCampaigns = activeCampaigns.slice(0, 3).map(c => ({
       ...c, 
       profitShare: totals.profit > 0 && c.profit > 0 ? (c.profit / totals.profit) * 100 : 0,
       spendShare: totals.ads_cost > 0 ? (c.cost / totals.ads_cost) * 100 : 0
    }));
    const bottomCampaigns = activeCampaigns.length > 3 ? activeCampaigns.slice(-3).reverse().map(c => ({
       ...c, 
       spendShare: totals.ads_cost > 0 ? (c.cost / totals.ads_cost) * 100 : 0
    })) : [];

    return { daysArray, totals, variations, chartData, projectedRevenue, revenueProgress, breakEvenROAS, topCampaigns, bottomCampaigns, isCurrentMonth, daysPassed, daysInMonth };
  }, [metrics, prevMetrics, extraCosts, prevExtraCosts, products, viewCurrency, liveDollar, manualDollar, liveEuro, manualEuro, goal, startDate, endDate, selectedMcc]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : viewCurrency === 'EUR' ? 'de-DE' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);
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
    const val = newCost.type === 'revenue' ? -Math.abs(Number(newCost.amount)) : Math.abs(Number(newCost.amount));
    await supabase.from('additional_costs').insert([{ date: newCost.date, description: newCost.description, currency: newCost.currency, user_id: userId, amount: val }]);
    setNewCost({ date: getLocalYYYYMMDD(new Date()), description: '', amount: 0, currency: 'BRL', type: 'cost' });
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
        <div className="w-full xl:w-auto">
           <Link href="/dashboard" className={`text-xs ${textMuted} hover:underline mb-2 block`}>&larr; Voltar ao Dashboard</Link>
           <div className="flex justify-between items-center w-full">
              <h1 className={`text-2xl font-bold ${textHead} flex items-center gap-2`}><Target className="text-indigo-500" /> Planejamento & DRE</h1>
              <button onClick={toggleTheme} className={`xl:hidden p-2 rounded-lg border ${bgCard} ${textMuted}`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
           </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-stretch sm:items-center w-full xl:w-auto">
           
           {/* SELETOR DE MCC E DATA */}
           <div className="flex flex-col sm:flex-row flex-wrap gap-4 w-full sm:w-auto">
               {availableMccs.length > 0 && (
               <div className={`flex items-center p-2 sm:p-1.5 rounded-xl border ${bgCard} shadow-sm w-full sm:w-auto`}>
                  <div className="flex items-center gap-2 px-2 w-full">
                     <Target size={18} className="text-indigo-500"/>
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
                          <Calendar size={18} className="text-indigo-500"/>
                          <select className={`bg-transparent text-sm font-bold outline-none cursor-pointer ${textHead} w-auto`} value={dateRange} onChange={(e) => handlePresetChange(e.target.value)}>
                             <option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="7d">7 Dias</option><option value="30d">30 Dias</option><option value="this_month">Este Mês</option><option value="last_month">Mês Passado</option><option value="custom">Personalizado</option>
                          </select>
                       </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-start gap-2 px-2">
                       <input type="date" className={`bg-transparent flex-1 sm:flex-none sm:w-[110px] text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={startDate} onChange={(e) => handleCustomDateChange('start', e.target.value)} />
                       <span className="text-slate-500 text-xs">até</span>
                       <input type="date" className={`bg-transparent flex-1 sm:flex-none sm:w-[110px] text-xs font-mono font-medium outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={endDate} onChange={(e) => handleCustomDateChange('end', e.target.value)} />
                    </div>
               </div>
           </div>
           
           <div className={`flex flex-col sm:flex-row items-stretch sm:items-center p-2 sm:p-1.5 rounded-lg border gap-4 sm:gap-4 flex-wrap xl:flex-nowrap ${bgCard} w-full sm:w-auto`}>
              <div className={`flex items-center justify-between sm:justify-start gap-3 px-2 pb-2 sm:pb-0 sm:border-r border-b sm:border-b-0 ${borderCol} pr-4`}>
                 <div>
                    <span className="text-[9px] text-orange-500 uppercase font-bold block">{rateConfig === 'USD' ? 'Dólar Agora' : 'Euro Agora'}</span>
                    <span className="text-xs font-mono font-bold text-orange-400">R$ {(rateConfig === 'USD' ? liveDollar : liveEuro).toFixed(2)}</span>
                 </div>
                 <div>
                    <span className="text-[9px] text-blue-500 uppercase font-bold block">{rateConfig === 'USD' ? 'Meu Dólar' : 'Meu Euro'}</span>
                    <div className="flex items-center gap-1">
                       <span className={`text-[10px] ${textMuted}`}>R$</span>
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
           
           <div className="flex gap-2 w-full sm:w-auto">
             <button onClick={() => setEditMode(!editMode)} className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all flex justify-center items-center gap-2 ${editMode ? 'bg-amber-500 text-white shadow-lg' : `${bgCard} ${textMuted}`}`}><Edit2 size={14}/> {editMode ? 'Parar Edição' : 'Editar Planilha'}</button>
             <button onClick={() => setIsGoalModalOpen(true)} className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex justify-center items-center gap-2 shadow-lg"><Target size={14}/> Metas</button>
           </div>
        </div>
      </div>

      {/* ... (Resto do conteúdo da página mantido igual: KPIs, Gráfico, Tabela, Modais) ... */}
      {/* KPI SUMÁRIO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-blue-500 shadow-sm`}>
           <p className="text-xs font-bold text-slate-500 uppercase">Receita</p>
           <p className="text-2xl font-bold text-blue-500">{formatMoney(processedData.totals.revenue)}</p>
           {processedData.variations.revenue !== 0 && (
             <p className={`text-[10px] font-bold mt-1 ${processedData.variations.revenue > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
               {processedData.variations.revenue > 0 ? '+' : ''}{processedData.variations.revenue.toFixed(1)}% <span className="text-slate-400 font-normal">vs pe. anterior</span>
             </p>
           )}
        </div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-orange-500 shadow-sm`}>
           <p className="text-xs font-bold text-slate-500 uppercase">Custo Ads</p>
           <p className="text-2xl font-bold text-orange-500">{formatMoney(processedData.totals.ads_cost)}</p>
           {processedData.variations.ads_cost !== 0 && (
             <p className={`text-[10px] font-bold mt-1 ${processedData.variations.ads_cost < 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
               {processedData.variations.ads_cost > 0 ? '+' : ''}{processedData.variations.ads_cost.toFixed(1)}% <span className="text-slate-400 font-normal">vs pe. anterior</span>
             </p>
           )}
        </div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 ${processedData.totals.net_extra >= 0 ? 'border-t-emerald-500' : 'border-t-amber-500'} shadow-sm`}>
           <p className="text-xs font-bold text-slate-500 uppercase">Extras Net</p>
           <p className={`text-2xl font-bold ${processedData.totals.net_extra >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>{formatMoney(processedData.totals.net_extra)}</p>
        </div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 ${processedData.totals.profit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'} shadow-sm`}>
           <p className="text-xs font-bold text-slate-500 uppercase">Lucro Líquido</p>
           <p className={`text-2xl font-bold ${processedData.totals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(processedData.totals.profit)}</p>
           {processedData.variations.profit !== 0 && (
             <p className={`text-[10px] font-bold mt-1 ${processedData.variations.profit > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
               {processedData.variations.profit > 0 ? '+' : ''}{processedData.variations.profit.toFixed(1)}% <span className="text-slate-400 font-normal">vs pe. anterior</span>
             </p>
           )}
        </div>
        <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-indigo-500 shadow-sm`}>
           <p className="text-xs font-bold text-slate-500 uppercase">ROI</p>
           <p className="text-2xl font-bold text-indigo-500">{processedData.totals.roi.toFixed(1)}%</p>
           {processedData.variations.roi !== 0 && (
             <p className={`text-[10px] font-bold mt-1 ${processedData.variations.roi > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
               {processedData.variations.roi > 0 ? '+' : ''}{processedData.variations.roi.toFixed(1)}pp <span className="text-slate-400 font-normal">vs pe. anterior</span>
             </p>
           )}
        </div>
      </div>

      {/* PAINEL DE INSIGHTS ESTRATÉGICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
         {/* Widget 1: Previsão de Fechamento (Pacing) */}
         <div className={`${bgCard} p-5 rounded-xl border ${borderCol} flex flex-col justify-between shadow-sm`}>
            <div>
               <div className="flex justify-between items-start mb-2">
                  <h3 className={`text-sm font-bold ${textHead} flex items-center gap-2`}><TrendingUp size={16} className="text-blue-500" /> Previsão de Fechamento</h3>
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${processedData.isCurrentMonth ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                     {processedData.isCurrentMonth ? 'Ritmo Atual' : 'Mês Fechado'}
                  </span>
               </div>
               <p className={`text-xs ${textMuted} mb-4`}>Projeção baseada na média diária de {formatMoney(processedData.totals.revenue / Math.max(1, processedData.daysPassed))}/dia</p>
            </div>
            
            <div>
               <div className="flex justify-between items-end mb-1">
                  <div>
                     <span className="text-[10px] font-bold text-slate-400 uppercase">Projeção Final</span>
                     <p className={`text-xl font-bold ${processedData.projectedRevenue >= goal.revenue && goal.revenue > 0 ? 'text-emerald-500' : textHead}`}>{formatMoney(processedData.projectedRevenue)}</p>
                  </div>
                  <div className="text-right">
                     <span className="text-[10px] font-bold text-slate-400 uppercase">Sua Meta</span>
                     <p className={`text-sm font-bold ${textMuted}`}>{formatMoney(goal.revenue)}</p>
                  </div>
               </div>
               {goal.revenue > 0 && (
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 mt-2">
                     <div className={`h-2 rounded-full ${processedData.projectedRevenue >= goal.revenue ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${Math.min((processedData.projectedRevenue / goal.revenue) * 100, 100)}%` }}></div>
                  </div>
               )}
            </div>
         </div>

         {/* Widget 2: Break-even Analysis */}
         <div className={`${bgCard} p-5 rounded-xl border ${borderCol} flex flex-col justify-between shadow-sm`}>
            <div>
               <div className="flex items-center gap-2 mb-2">
                  <Target size={16} className="text-orange-500" />
                  <h3 className={`text-sm font-bold ${textHead}`}>Ponto de Equilíbrio (Break-even)</h3>
               </div>
               <p className={`text-xs ${textMuted} mb-4`}>Para atingir um lucro de R$ 0,00 e pagar todos os {formatMoney(processedData.totals.extra_cost)} em Custos Extras da sua operação.</p>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800">
               <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">ROAS Mínimo Necessário</span>
                  <p className="text-2xl font-bold text-orange-500">{processedData.breakEvenROAS.toFixed(1)}%</p>
               </div>
               <div className="text-right">
                   <span className="text-[10px] font-bold text-slate-400 uppercase block">ROAS Atual</span>
                   <p className={`text-lg font-bold ${processedData.totals.roi >= processedData.breakEvenROAS - 100 ? 'text-emerald-500' : 'text-rose-500'}`}>{processedData.totals.roi.toFixed(1)}%</p>
               </div>
            </div>
         </div>

         {/* Widget 3: Curva ABC de Campanhas */}
         <div className={`${bgCard} p-5 rounded-xl border ${borderCol} flex flex-col shadow-sm`}>
            <div className="flex items-center gap-2 mb-4">
               <DollarSign size={16} className="text-emerald-500" />
               <h3 className={`text-sm font-bold ${textHead}`}>Top Campanhas (Lucratividade)</h3>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
               {processedData.topCampaigns.length === 0 ? (
                  <p className={`text-xs ${textMuted} text-center py-4`}>Sem dados suficientes</p>
               ) : (
                  processedData.topCampaigns.map((camp: any, idx: number) => (
                     <div key={idx} className="flex justify-between items-center text-xs">
                        <div className="truncate pr-2">
                           <span className="font-bold text-slate-400 mr-2">{idx + 1}.</span>
                           <span className={`font-medium ${textHead}`}>{camp.name === 'Desconhecida' ? 'Venda Externa' : camp.name}</span>
                           <span className="block text-[9px] text-slate-400 mt-0.5 ml-5">Traz <span className="text-emerald-500 font-bold">{camp.profitShare.toFixed(1)}%</span> do lucro gastando <span className="text-orange-400 font-bold">{camp.spendShare.toFixed(1)}%</span></span>
                        </div>
                        <span className={`font-bold whitespace-nowrap self-start ${camp.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                           {formatMoney(camp.profit)}
                        </span>
                     </div>
                  ))
               )}
               {processedData.bottomCampaigns.length > 0 && (
                   <>
                     <div className="border-t border-dashed border-slate-200 dark:border-slate-800 my-2 pt-2"></div>
                     <span className="text-[10px] font-bold text-rose-500 uppercase block mb-2">Piores Resultados</span>
                     {processedData.bottomCampaigns.map((camp: any, idx: number) => (
                         <div key={`bot-${idx}`} className="flex justify-between items-center text-xs opacity-80">
                            <div className="truncate pr-2">
                               <span className={`font-medium ${textHead}`}>{camp.name === 'Desconhecida' ? 'Venda Externa' : camp.name}</span>
                            </div>
                            <span className="font-bold whitespace-nowrap text-rose-500">
                               {formatMoney(camp.profit)}
                            </span>
                         </div>
                      ))}
                   </>
               )}
            </div>
         </div>
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
               <Plus size={14}/> Lançar Extras
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
                     <th className="px-6 py-4 text-right text-emerald-500">Extras</th>
                     <th className="px-6 py-4 text-right text-rose-400">Reembolso</th>
                     <th className="px-6 py-4 text-right text-emerald-600">Lucro</th>
                  </tr>
               </thead>
               <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                  {processedData.daysArray.map((day: any) => {
                     const isExpanded = expandedRows[day.date];
                     const profit = day.revenue - day.ads_cost + day.extra_revenue - day.extra_cost - day.refunds;
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
                              
                              {/* EXTRAS */}
                              <td className="px-6 py-4 text-right relative align-top" onClick={(e) => e.stopPropagation()}>
                                 {day.details.length > 0 ? (
                                    <div className="flex flex-col items-end gap-1">
                                       <span className={`font-bold ${day.net_extra >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>{formatMoney(day.net_extra)}</span>
                                       <div className="flex flex-col gap-1 w-full items-end mt-1 border-t border-dashed border-slate-700 pt-1">
                                          {day.details.map((d: any) => (
                                             <div key={d.id} className="flex items-center gap-2 group/item">
                                                <span className={`text-[10px] ${textMuted} truncate max-w-[100px]`} title={d.desc}>{d.desc}</span>
                                                <span className={`text-[10px] font-bold ${d.val < 0 ? 'text-emerald-500' : 'text-amber-500'}`}>{formatMoney(Math.abs(d.val))}</span>
                                                {/* Botão Excluir (Só com Modo Edição) */}
                                                {editMode && (
                                                   <button 
                                                     onClick={(e) => { e.stopPropagation(); handleDeleteCost(d.id); }} 
                                                     className="text-rose-500 hover:text-rose-400 p-1 bg-rose-500/10 rounded"
                                                     title="Excluir Extra"
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
                                    <td colSpan={2}></td>
                                    <td className={`px-6 py-2 text-right text-xs font-medium ${(mcc.revenue - mcc.ads_cost - mcc.refunds) >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{formatMoney(mcc.revenue - mcc.ads_cost - mcc.refunds)}</td>
                                 </tr>
                                 {Object.values(mcc.accounts).map((acc: any) => (
                                    <tr key={acc.name} className={`${isDark ? 'bg-slate-950/30' : 'bg-slate-100/30'}`}>
                                       <td></td>
                                       <td className="px-6 py-1 text-[10px] text-slate-500 pl-16 flex items-center gap-2 border-l-2 border-slate-800 ml-10">
                                          <Briefcase size={10}/> {acc.name}
                                       </td>
                                       <td className="px-6 py-1 text-right text-[10px] text-slate-600">{formatMoney(acc.revenue)}</td>
                                       <td className="px-6 py-1 text-right text-[10px] text-slate-600">{formatMoney(acc.ads_cost)}</td>
                                       <td colSpan={2}></td>
                                       <td className={`px-6 py-1 text-right text-[10px] font-medium ${(acc.revenue - acc.ads_cost - acc.refunds) >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>{formatMoney(acc.revenue - acc.ads_cost - acc.refunds)}</td>
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
                     <td className={`px-6 py-4 text-right ${processedData.totals.net_extra >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>{formatMoney(processedData.totals.net_extra)}</td>
                     <td className="px-6 py-4 text-right text-rose-400">{formatMoney(processedData.totals.refunds)}</td>
                     <td className={`px-6 py-4 text-right ${processedData.totals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(processedData.totals.profit)}</td>
                  </tr>
               </tfoot>
            </table>
         </div>
      </div>

      {/* MODAL EXTRAS */}
      {isCostModalOpen && (
         <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`${bgCard} rounded-xl w-full max-w-sm p-6 shadow-2xl`}>
               <h3 className={`text-lg font-bold ${textHead} mb-4`}>Lançar Extras</h3>
               <div className="space-y-3">
                  <div className="flex gap-2 mb-3">
                     <button onClick={() => setNewCost({...newCost, type: 'cost'})} className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${newCost.type === 'cost' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>Custo Extra</button>
                     <button onClick={() => setNewCost({...newCost, type: 'revenue'})} className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${newCost.type === 'revenue' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>Receita Extra</button>
                  </div>
                  <div>
                    <label className="text-xs uppercase font-bold text-slate-500">Data do Lançamento</label>
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
                           <option value="EUR">EUR</option>
                        </select>
                     </div>
                  </div>
                  <button onClick={handleAddCost} className={`w-full text-white font-bold py-3 rounded mt-2 transition-colors ${newCost.type === 'revenue' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>{newCost.type === 'revenue' ? 'Salvar Receita' : 'Salvar Despesa'}</button>
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