"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Target, TrendingUp, DollarSign, Calendar as CalIcon, 
  AlertTriangle, CheckCircle, Edit2, ArrowRight, Plus, Trash2,
  Sun, Moon, RefreshCw, ChevronDown, Filter
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart 
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
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  
  // Dados
  const [metrics, setMetrics] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [extraCosts, setExtraCosts] = useState<any[]>([]);
  const [goal, setGoal] = useState({ revenue: 0, profit: 0, limit: 0 });

  // UI & Configs
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  
  // Moeda
  const [liveDollar, setLiveDollar] = useState(6.00);
  const [manualDollar, setManualDollar] = useState(5.60);
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD'>('BRL');
  
  // Tema
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Estados Temporários (Modais)
  const [tempGoal, setTempGoal] = useState({ revenue: 0, profit: 0, limit: 0 });
  const [newCost, setNewCost] = useState({ date: getLocalYYYYMMDD(new Date()), description: '', amount: 0, currency: 'BRL' });

  // --- INICIALIZAÇÃO ---
  useEffect(() => {
    fetchLiveDollar();
    const savedDollar = localStorage.getItem('autometrics_manual_dollar');
    if (savedDollar) setManualDollar(parseFloat(savedDollar));
    
    // Carrega tema salvo ou usa dark
    const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    fetchData();
  }, [currentMonth]);

  // Salva preferência de tema
  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('autometrics_theme', newTheme);
  };

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
    } catch(e) {}
  }

  const handleManualDollarChange = (val: number) => {
    setManualDollar(val);
    localStorage.setItem('autometrics_manual_dollar', val.toString());
  };

  async function fetchData() {
    setLoading(true);
    const userId = localStorage.getItem('autometrics_user_id');
    if (!userId) return;

    // 1. Metas
    const { data: goalData } = await supabase.from('financial_goals').select('*').eq('user_id', userId).eq('month_key', currentMonth).single();
    if (goalData) {
      setGoal({ revenue: goalData.revenue_target, profit: goalData.profit_target, limit: goalData.ad_spend_limit });
      setTempGoal({ revenue: goalData.revenue_target, profit: goalData.profit_target, limit: goalData.ad_spend_limit });
    } else {
      setGoal({ revenue: 0, profit: 0, limit: 0 });
    }

    // 2. Custos Extras
    const startOfMonth = `${currentMonth}-01`;
    const endOfMonth = `${currentMonth}-31`;
    
    const { data: costData } = await supabase.from('additional_costs').select('*').eq('user_id', userId).gte('date', startOfMonth).lte('date', endOfMonth);
    setExtraCosts(costData || []);

    // 3. Produtos & Métricas
    const { data: prodData } = await supabase.from('products').select('id, currency').eq('user_id', userId);
    setProducts(prodData || []);
    
    if (prodData && prodData.length > 0) {
      const { data: metData } = await supabase
        .from('daily_metrics')
        .select('*')
        .in('product_id', prodData.map(p => p.id))
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)
        .order('date', { ascending: true });
      setMetrics(metData || []);
    }
    setLoading(false);
  }

  // --- AÇÕES ---
  const handleSaveGoal = async () => {
    const userId = localStorage.getItem('autometrics_user_id');
    if (!userId) return;
    const payload = {
      user_id: userId, month_key: currentMonth,
      revenue_target: Number(tempGoal.revenue), profit_target: Number(tempGoal.profit), ad_spend_limit: Number(tempGoal.limit)
    };
    await supabase.from('financial_goals').upsert(payload, { onConflict: 'user_id, month_key' });
    setGoal(tempGoal);
    setIsGoalModalOpen(false);
  };

  const handleAddCost = async () => {
    const userId = localStorage.getItem('autometrics_user_id');
    if (!newCost.description || !newCost.amount) return alert("Preencha descrição e valor.");
    
    await supabase.from('additional_costs').insert([{
      user_id: userId, date: newCost.date, description: newCost.description, amount: Number(newCost.amount), currency: newCost.currency
    }]);
    
    setNewCost({ date: getLocalYYYYMMDD(new Date()), description: '', amount: 0, currency: 'BRL' });
    setIsCostModalOpen(false);
    fetchData(); // Recarrega para mostrar na tabela
  };

  const handleDeleteCost = async (id: string) => {
    if(!confirm("Excluir este custo?")) return;
    await supabase.from('additional_costs').delete().eq('id', id);
    fetchData();
  };

  // --- CÁLCULOS CENTRAIS ---
  const stats = useMemo(() => {
    // Mapa de Dias
    const dailyMap = new Map();
    const daysInMonth = new Date(parseInt(currentMonth.split('-')[0]), parseInt(currentMonth.split('-')[1]), 0).getDate();

    // 1. Processa Métricas (Ads)
    metrics.forEach(m => {
      const prod = products.find(p => p.id === m.product_id);
      const isUSD = prod?.currency === 'USD';
      
      let cost = Number(m.cost || 0);
      let revenue = Number(m.conversion_value || 0);
      let refunds = Number(m.refunds || 0);

      // Conversão Inteligente
      if (viewCurrency === 'BRL') {
        if (isUSD) { cost *= liveDollar; revenue *= manualDollar; refunds *= manualDollar; }
      } else {
        if (!isUSD) { cost /= liveDollar; revenue /= manualDollar; refunds /= manualDollar; }
      }

      if (!dailyMap.has(m.date)) dailyMap.set(m.date, { date: m.date, revenue: 0, ads_cost: 0, refunds: 0, extra_cost: 0, details: [] });
      const d = dailyMap.get(m.date);
      d.revenue += revenue;
      d.ads_cost += cost;
      d.refunds += refunds;
    });

    // 2. Processa Custos Extras
    extraCosts.forEach(c => {
      if (!dailyMap.has(c.date)) dailyMap.set(c.date, { date: c.date, revenue: 0, ads_cost: 0, refunds: 0, extra_cost: 0, details: [] });
      const d = dailyMap.get(c.date);
      
      let amount = Number(c.amount);
      // Conversão do Custo Extra
      if (viewCurrency === 'BRL' && c.currency === 'USD') amount *= liveDollar;
      else if (viewCurrency === 'USD' && c.currency === 'BRL') amount /= liveDollar;

      d.extra_cost += amount;
      d.details.push({ id: c.id, desc: c.description, val: amount });
    });

    const daysArray = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Totais
    const totalRevenue = daysArray.reduce((a, b) => a + b.revenue, 0);
    const totalAdsCost = daysArray.reduce((a, b) => a + b.ads_cost, 0);
    const totalExtraCost = daysArray.reduce((a, b) => a + b.extra_cost, 0);
    const totalRefunds = daysArray.reduce((a, b) => a + b.refunds, 0);
    const totalCost = totalAdsCost + totalExtraCost;
    const totalProfit = totalRevenue - totalCost - totalRefunds;

    // Projeções
    const today = new Date();
    const isCurrentMonth = currentMonth === today.toISOString().slice(0, 7);
    const daysPassed = isCurrentMonth ? Math.max(today.getDate(), 1) : daysInMonth;
    const projectedRevenue = isCurrentMonth ? (totalRevenue / daysPassed) * daysInMonth : totalRevenue;
    const revenueProgress = goal.revenue > 0 ? (totalRevenue / goal.revenue) * 100 : 0;
    
    // Gráfico Acumulado
    let accumRev = 0;
    let accumProfit = 0;
    const chartData = daysArray.map(day => {
      accumRev += day.revenue;
      accumProfit += (day.revenue - day.ads_cost - day.extra_cost - day.refunds);
      return {
        date: day.date.split('-')[2],
        revenue: accumRev,
        profit: accumProfit,
        ideal: (goal.revenue / daysInMonth) * parseInt(day.date.split('-')[2])
      };
    });

    return { totalRevenue, totalAdsCost, totalExtraCost, totalCost, totalProfit, totalRefunds, projectedRevenue, revenueProgress, chartData, daysArray };
  }, [metrics, extraCosts, products, viewCurrency, liveDollar, manualDollar, currentMonth, goal]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);

  // --- ESTILOS (CLARO / ESCURO) ---
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-500' : 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';

  if (loading) return <div className={`min-h-screen ${bgMain} flex items-center justify-center`}>Carregando planejamento...</div>;

  return (
    <div className={`min-h-screen font-sans p-4 md:p-8 ${bgMain}`}>
      
      {/* HEADER DE CONTROLE */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
        <div>
           <Link href="/dashboard" className={`text-xs ${textMuted} hover:underline mb-2 block`}>&larr; Voltar ao Dashboard</Link>
           <h1 className={`text-2xl font-bold ${textHead} flex items-center gap-2`}>
             <Target className="text-indigo-500" /> Planejamento & Resultados
           </h1>
           <p className={`text-sm ${textMuted}`}>Acompanhamento financeiro completo (DRE).</p>
        </div>

        <div className="flex flex-wrap gap-4 items-center">
           {/* Seletor de Mês */}
           <input 
             type="month" 
             className={`bg-transparent font-bold outline-none cursor-pointer ${textHead} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
             value={currentMonth}
             onChange={(e) => setCurrentMonth(e.target.value)}
           />

           {/* Controle de Dólar e Tema (Compacto) */}
           <div className={`flex items-center p-1.5 rounded-lg border gap-4 ${bgCard}`}>
              <div className={`flex gap-3 px-2 border-r ${borderCol} pr-4`}>
                 <div><span className="text-[9px] text-orange-500 uppercase font-bold block">Custo (API)</span><span className="text-xs font-mono font-bold text-orange-400">R$ {liveDollar.toFixed(2)}</span></div>
                 <div><span className="text-[9px] text-blue-500 uppercase font-bold block">Receita (Manual)</span><div className="flex items-center gap-1"><span className={`text-[10px] ${textMuted}`}>R$</span><input type="number" step="0.01" className={`w-10 bg-transparent text-xs font-mono font-bold outline-none border-b ${isDark ? 'border-slate-700 text-white' : 'border-slate-300 text-black'}`} value={manualDollar} onChange={(e) => handleManualDollarChange(parseFloat(e.target.value))} /></div></div>
              </div>
              <div className={`flex p-1 rounded-md ${isDark ? 'bg-black' : 'bg-slate-100'}`}>
                 <button onClick={() => setViewCurrency('BRL')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'BRL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>R$</button>
                 <button onClick={() => setViewCurrency('USD')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${viewCurrency === 'USD' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>$</button>
              </div>
              <button onClick={toggleTheme} className={`${textMuted} hover:text-indigo-500`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
           </div>
           
           <button onClick={() => setIsGoalModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-lg">
             <Edit2 size={14}/> Metas
           </button>
        </div>
      </div>

      {/* BLOCO DE RESUMO EXECUTIVO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
         <div className={`${bgCard} p-6 rounded-xl border-t-4 border-t-blue-500 shadow-sm`}>
            <p className={`text-xs font-bold ${textMuted} uppercase`}>Faturamento Real</p>
            <div className="flex justify-between items-end mt-2">
               <span className={`text-2xl font-bold text-blue-500`}>{formatMoney(stats.totalRevenue)}</span>
               <span className={`text-xs font-mono ${stats.revenueProgress >= 100 ? 'text-emerald-500' : 'text-amber-500'}`}>{stats.revenueProgress.toFixed(1)}% da Meta</span>
            </div>
            <div className={`w-full h-1.5 rounded-full mt-2 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
               <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(stats.revenueProgress, 100)}%` }}></div>
            </div>
         </div>
         
         <div className={`${bgCard} p-6 rounded-xl border-t-4 border-t-orange-500 shadow-sm`}>
            <p className={`text-xs font-bold ${textMuted} uppercase`}>Custos Totais (Ads + Extras)</p>
            <span className="text-2xl font-bold text-orange-500 mt-2 block">{formatMoney(stats.totalCost)}</span>
            <p className={`text-xs mt-1 ${textMuted}`}>Ads: {formatMoney(stats.totalAdsCost)} | Outros: {formatMoney(stats.totalExtraCost)}</p>
         </div>

         <div className={`${bgCard} p-6 rounded-xl border-t-4 ${stats.totalProfit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'} shadow-sm`}>
            <p className={`text-xs font-bold ${textMuted} uppercase`}>Lucro Líquido</p>
            <span className={`text-2xl font-bold mt-2 block ${stats.totalProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(stats.totalProfit)}</span>
            <p className={`text-xs mt-1 ${textMuted}`}>Margem: {stats.totalRevenue > 0 ? ((stats.totalProfit/stats.totalRevenue)*100).toFixed(1) : 0}%</p>
         </div>

         <div className={`${bgCard} p-6 rounded-xl border-t-4 border-t-indigo-500 shadow-sm`}>
            <p className={`text-xs font-bold ${textMuted} uppercase`}>Projeção (Fim do Mês)</p>
            <span className={`text-2xl font-bold mt-2 block ${stats.projectedRevenue >= goal.revenue ? 'text-emerald-500' : 'text-amber-500'}`}>{formatMoney(stats.projectedRevenue)}</span>
            <p className={`text-xs mt-1 ${textMuted}`}>Baseado na média diária atual.</p>
         </div>
      </div>

      {/* GRÁFICO DE ACOMPANHAMENTO */}
      <div className={`${bgCard} rounded-xl p-6 mb-8 h-80 shadow-sm`}>
         <h3 className={`text-sm font-bold ${textHead} mb-4`}>Curva de Crescimento (Realizado vs Meta Ideal)</h3>
         <ResponsiveContainer width="100%" height="100%">
             <AreaChart data={stats.chartData}>
                <defs>
                   <linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                   </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0', color: isDark ? '#fff' : '#000' }} formatter={(v:any) => formatMoney(v)} />
                <Area type="monotone" dataKey="revenue" name="Receita Acumulada" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorReal)" />
                <Line type="monotone" dataKey="ideal" name="Meta Ideal" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
             </AreaChart>
         </ResponsiveContainer>
      </div>

      {/* TABELA FINANCEIRA DETALHADA (DRE DIÁRIO) */}
      <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
         <div className={`p-4 border-b ${borderCol} flex justify-between items-center`}>
            <h3 className={`font-bold ${textHead}`}>Demonstrativo Financeiro Diário</h3>
            <button onClick={() => setIsCostModalOpen(true)} className="flex items-center gap-2 text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 transition-colors">
               <Plus size={14}/> Add Custo Extra
            </button>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
               <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'}`}>
                  <tr>
                     <th className="px-6 py-4">Data</th>
                     <th className="px-6 py-4 text-right text-blue-600">Receita</th>
                     <th className="px-6 py-4 text-right text-orange-600">Ads Cost</th>
                     <th className="px-6 py-4 text-right text-rose-400">Reembolso</th>
                     <th className="px-6 py-4 text-right text-amber-500 border-l border-r border-dashed border-slate-700">Custos Extras</th>
                     <th className="px-6 py-4 text-right text-emerald-600">Lucro Real</th>
                     <th className="px-6 py-4 text-right">ROI</th>
                  </tr>
               </thead>
               <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                  {stats.daysArray.map((day: any) => {
                     const profit = day.revenue - day.ads_cost - day.extra_cost - day.refunds;
                     const roi = day.ads_cost > 0 ? (profit / day.ads_cost) * 100 : 0;
                     const dateParts = day.date.split('-');
                     return (
                        <tr key={day.date} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                           <td className={`px-6 py-4 font-bold ${textHead}`}>{`${dateParts[2]}/${dateParts[1]}`}</td>
                           <td className="px-6 py-4 text-right font-bold text-blue-500 bg-blue-500/5">{formatMoney(day.revenue)}</td>
                           <td className="px-6 py-4 text-right font-medium text-orange-500">{formatMoney(day.ads_cost)}</td>
                           <td className="px-6 py-4 text-right text-rose-400">{day.refunds > 0 ? formatMoney(day.refunds) : '-'}</td>
                           
                           {/* Coluna de Custos Extras (Interativa) */}
                           <td className="px-6 py-4 text-right border-l border-r border-dashed border-slate-700 relative group">
                              {day.extra_cost > 0 ? (
                                 <div className="flex flex-col items-end">
                                    <span className="text-amber-500 font-bold">{formatMoney(day.extra_cost)}</span>
                                    {day.details.map((d: any) => (
                                       <div key={d.id} className="text-[10px] text-slate-500 flex items-center gap-1">
                                          {d.desc} <button onClick={() => handleDeleteCost(d.id)} className="hover:text-rose-500"><Trash2 size={8}/></button>
                                       </div>
                                    ))}
                                 </div>
                              ) : <span className="text-slate-600">-</span>}
                           </td>

                           <td className={`px-6 py-4 text-right font-bold ${profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(profit)}</td>
                           <td className={`px-6 py-4 text-right font-bold ${roi >= 0 ? 'text-indigo-500' : 'text-rose-500'}`}>{roi.toFixed(0)}%</td>
                        </tr>
                     );
                  })}
               </tbody>
               {/* Rodapé de Totais */}
               <tfoot className={`text-xs uppercase font-bold border-t-2 ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-100 border-slate-300 text-black'}`}>
                  <tr>
                     <td className="px-6 py-4">TOTAIS</td>
                     <td className="px-6 py-4 text-right text-blue-500">{formatMoney(stats.totalRevenue)}</td>
                     <td className="px-6 py-4 text-right text-orange-500">{formatMoney(stats.totalAdsCost)}</td>
                     <td className="px-6 py-4 text-right text-rose-400">{formatMoney(stats.totalRefunds)}</td>
                     <td className="px-6 py-4 text-right text-amber-500">{formatMoney(stats.totalExtraCost)}</td>
                     <td className={`px-6 py-4 text-right ${stats.totalProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(stats.totalProfit)}</td>
                     <td className="px-6 py-4 text-right">-</td>
                  </tr>
               </tfoot>
            </table>
         </div>
      </div>

      {/* MODAL CUSTO EXTRA */}
      {isCostModalOpen && (
         <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`${bgCard} rounded-xl w-full max-w-sm p-6 shadow-2xl`}>
               <h3 className={`text-lg font-bold ${textHead} mb-4`}>Adicionar Custo Extra</h3>
               <div className="space-y-3">
                  <input type="date" className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={newCost.date} onChange={e => setNewCost({...newCost, date: e.target.value})} />
                  <input type="text" placeholder="Descrição (Ex: Hospedagem)" className={`w-full p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={newCost.description} onChange={e => setNewCost({...newCost, description: e.target.value})} />
                  <div className="flex gap-2">
                     <input type="number" placeholder="Valor" className={`flex-1 p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={newCost.amount} onChange={e => setNewCost({...newCost, amount: parseFloat(e.target.value)})} />
                     <select className={`p-2 rounded border bg-transparent ${textHead} ${borderCol}`} value={newCost.currency} onChange={e => setNewCost({...newCost, currency: e.target.value})}>
                        <option value="BRL">BRL</option>
                        <option value="USD">USD</option>
                     </select>
                  </div>
                  <button onClick={handleAddCost} className="w-full bg-indigo-600 text-white font-bold py-2 rounded hover:bg-indigo-700">Adicionar</button>
                  <button onClick={() => setIsCostModalOpen(false)} className={`w-full py-2 ${textMuted} hover:underline`}>Cancelar</button>
               </div>
            </div>
         </div>
      )}

      {/* MODAL METAS (SIMPLIFICADO) */}
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