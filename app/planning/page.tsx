"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Target, TrendingUp, DollarSign, Calendar as CalIcon, 
  AlertTriangle, CheckCircle, Edit2, ArrowRight 
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart 
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function PlanningPage() {
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  
  // Dados Reais
  const [metrics, setMetrics] = useState<any[]>([]);
  const [goal, setGoal] = useState({ revenue: 0, profit: 0, limit: 0 });
  
  // Modal de Configuração
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempGoal, setTempGoal] = useState({ revenue: 0, profit: 0, limit: 0 });

  // Configurações de Moeda (Mesma lógica do Dashboard)
  const [manualDollar, setManualDollar] = useState(5.60);
  const [liveDollar, setLiveDollar] = useState(6.00);

  useEffect(() => {
    // Carrega preferências
    const savedDollar = localStorage.getItem('autometrics_manual_dollar');
    if (savedDollar) setManualDollar(parseFloat(savedDollar));
    fetchLiveDollar();
    fetchData();
  }, [currentMonth]); // Recarrega se mudar o mês

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
    } catch(e) {}
  }

  async function fetchData() {
    setLoading(true);
    const userId = localStorage.getItem('autometrics_user_id');
    if (!userId) return;

    // 1. Busca Metas do Mês
    const { data: goalData } = await supabase
      .from('financial_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('month_key', currentMonth)
      .single();
    
    if (goalData) {
      setGoal({ revenue: goalData.revenue_target, profit: goalData.profit_target, limit: goalData.ad_spend_limit });
      setTempGoal({ revenue: goalData.revenue_target, profit: goalData.profit_target, limit: goalData.ad_spend_limit });
    } else {
      // Se não tem meta, zera
      setGoal({ revenue: 0, profit: 0, limit: 0 });
      setTempGoal({ revenue: 0, profit: 0, limit: 0 });
    }

    // 2. Busca Métricas Reais do Mês
    // Primeiro pegamos os produtos do usuário
    const { data: products } = await supabase.from('products').select('id, currency').eq('user_id', userId);
    
    if (products && products.length > 0) {
      const startOfMonth = `${currentMonth}-01`;
      const endOfMonth = `${currentMonth}-31`;
      
      const { data: metData } = await supabase
        .from('daily_metrics')
        .select('*')
        .in('product_id', products.map(p => p.id))
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)
        .order('date', { ascending: true });

      // Processa os dados (Conversão de Moeda)
      const processed = (metData || []).map((row: any) => {
        const prod = products.find(p => p.id === row.product_id);
        const isUSD = prod?.currency === 'USD';
        
        let cost = Number(row.cost || 0);
        let revenue = Number(row.conversion_value || 0);
        let refunds = Number(row.refunds || 0);

        // Conversão para BRL (Padrão para planejamento financeiro)
        if (isUSD) {
           cost *= liveDollar;
           revenue *= manualDollar;
           refunds *= manualDollar;
        }

        return {
          date: row.date,
          cost, revenue, refunds,
          profit: revenue - cost - refunds
        };
      });

      setMetrics(processed);
    }
    setLoading(false);
  }

  const handleSaveGoal = async () => {
    const userId = localStorage.getItem('autometrics_user_id');
    if (!userId) return;

    const payload = {
      user_id: userId,
      month_key: currentMonth,
      revenue_target: Number(tempGoal.revenue),
      profit_target: Number(tempGoal.profit),
      ad_spend_limit: Number(tempGoal.limit)
    };

    const { error } = await supabase
      .from('financial_goals')
      .upsert(payload, { onConflict: 'user_id, month_key' });

    if (error) alert('Erro ao salvar meta');
    else {
      setGoal(tempGoal);
      setIsModalOpen(false);
    }
  };

  // --- CÁLCULOS DE PLANEJAMENTO ---
  const stats = useMemo(() => {
    // 1. Agrupar por dia (Somar métricas de todos os produtos do dia)
    const dailyMap = new Map();
    metrics.forEach(m => {
      if (!dailyMap.has(m.date)) dailyMap.set(m.date, { date: m.date, revenue: 0, profit: 0, cost: 0 });
      const d = dailyMap.get(m.date);
      d.revenue += m.revenue;
      d.profit += m.profit;
      d.cost += m.cost;
    });

    const daysArray = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // 2. Totais Acumulados
    const totalRevenue = daysArray.reduce((acc, curr) => acc + curr.revenue, 0);
    const totalProfit = daysArray.reduce((acc, curr) => acc + curr.profit, 0);
    const totalCost = daysArray.reduce((acc, curr) => acc + curr.cost, 0);

    // 3. Projeções (Run Rate)
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    // Se estivermos vendo um mês passado, dias passados = total dias mês. Se atual, dias passados = hoje.
    const isCurrentMonth = currentMonth === new Date().toISOString().slice(0, 7);
    const daysPassed = isCurrentMonth ? Math.max(today.getDate(), 1) : daysInMonth; // Evita divisão por 0
    
    const avgDailyRevenue = totalRevenue / daysPassed;
    const projectedRevenue = isCurrentMonth ? (avgDailyRevenue * daysInMonth) : totalRevenue;
    
    const revenueProgress = goal.revenue > 0 ? (totalRevenue / goal.revenue) * 100 : 0;
    
    // Quanto falta?
    const remainingRevenue = Math.max(goal.revenue - totalRevenue, 0);
    const daysRemaining = Math.max(daysInMonth - daysPassed, 0);
    const requiredDailyRevenue = daysRemaining > 0 ? remainingRevenue / daysRemaining : 0;

    // 4. Dados para o Gráfico (Acumulado)
    let accumRev = 0;
    const chartData = daysArray.map(day => {
      accumRev += day.revenue;
      return {
        date: day.date.split('-')[2], // Dia
        actual: accumRev,
        // Linha de Meta Ideal (Linear)
        ideal: (goal.revenue / daysInMonth) * parseInt(day.date.split('-')[2])
      };
    });

    return {
      totalRevenue, totalProfit, totalCost,
      projectedRevenue,
      revenueProgress,
      remainingRevenue,
      requiredDailyRevenue,
      chartData,
      daysArray
    };
  }, [metrics, goal, currentMonth]);

  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-8">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
        <div>
           <Link href="/dashboard" className="text-xs text-slate-500 hover:text-white mb-2 block">&larr; Voltar ao Dashboard</Link>
           <h1 className="text-2xl font-bold text-white flex items-center gap-2">
             <Target className="text-indigo-500" /> Planejamento Financeiro
           </h1>
           <p className="text-slate-500 text-sm">Acompanhamento de metas e projeções.</p>
        </div>

        <div className="flex items-center gap-4 bg-slate-900 p-2 rounded-xl border border-slate-800">
           <input 
             type="month" 
             className="bg-transparent text-white font-bold outline-none [&::-webkit-calendar-picker-indicator]:invert"
             value={currentMonth}
             onChange={(e) => setCurrentMonth(e.target.value)}
           />
           <button 
             onClick={() => setIsModalOpen(true)}
             className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2"
           >
             <Edit2 size={14}/> Definir Metas
           </button>
        </div>
      </div>

      {/* --- BLOCO PRINCIPAL: META vs REALIDADE --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        
        {/* Card 1: Progresso da Receita */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
           <div className="flex justify-between items-start mb-4">
              <div>
                 <p className="text-xs font-bold text-slate-500 uppercase">Faturamento Mensal</p>
                 <h3 className="text-3xl font-bold text-white mt-1">{formatMoney(stats.totalRevenue)}</h3>
              </div>
              <div className="text-right">
                 <p className="text-xs font-bold text-slate-500 uppercase">Meta</p>
                 <p className="text-sm font-mono text-indigo-400">{formatMoney(goal.revenue)}</p>
              </div>
           </div>
           
           {/* Barra de Progresso */}
           <div className="relative h-4 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div 
                className={`h-full transition-all duration-1000 ${stats.revenueProgress >= 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} 
                style={{ width: `${Math.min(stats.revenueProgress, 100)}%` }}
              ></div>
           </div>
           <p className="text-xs text-right text-slate-400">{stats.revenueProgress.toFixed(1)}% atingido</p>
        </div>

        {/* Card 2: Projeção (Run Rate) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
           <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="text-amber-500" size={20} />
              <p className="text-xs font-bold text-slate-500 uppercase">Projeção (Ritmo Atual)</p>
           </div>
           
           <div className="flex items-baseline gap-2">
              <h3 className={`text-3xl font-bold ${stats.projectedRevenue >= goal.revenue ? 'text-emerald-400' : 'text-amber-400'}`}>
                {formatMoney(stats.projectedRevenue)}
              </h3>
           </div>
           
           <p className="text-xs text-slate-500 mt-2 leading-relaxed">
             Se continuar vendendo a média de <strong>{formatMoney(stats.totalRevenue / Math.max(new Date().getDate(), 1))}</strong>/dia, 
             você fechará o mês com este valor.
           </p>
        </div>

        {/* Card 3: O que falta (Meta Diária Dinâmica) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
           <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="text-rose-500" size={20} />
              <p className="text-xs font-bold text-slate-500 uppercase">Meta Diária Necessária</p>
           </div>

           {stats.remainingRevenue <= 0 ? (
             <div className="flex flex-col items-center justify-center h-full pb-4">
                <CheckCircle className="text-emerald-500 mb-2" size={32} />
                <span className="text-emerald-400 font-bold">Meta Batida! 🚀</span>
             </div>
           ) : (
             <>
               <h3 className="text-3xl font-bold text-white">{formatMoney(stats.requiredDailyRevenue)}</h3>
               <p className="text-xs text-slate-500 mt-2">
                 Para bater a meta, você precisa vender este valor <strong>todos os dias</strong> até o fim do mês.
               </p>
             </>
           )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* GRÁFICO DE PACE (ACUMULADO) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
           <h3 className="text-sm font-bold text-white mb-6">Curva de Crescimento (Real vs Ideal)</h3>
           <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={stats.chartData}>
                    <defs>
                       <linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                       </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v/1000}k`} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} formatter={(v:any) => formatMoney(v)} />
                    <Area type="monotone" dataKey="actual" name="Realizado" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorReal)" />
                    <Line type="monotone" dataKey="ideal" name="Meta Ideal" stroke="#64748b" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                 </AreaChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* DETALHES FINANCEIROS */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
           <div>
              <h3 className="text-sm font-bold text-white mb-6">Raio-X Financeiro</h3>
              <div className="space-y-4">
                 <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                    <span className="text-slate-500 text-sm">Lucro Acumulado</span>
                    <span className={`font-bold ${stats.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                       {formatMoney(stats.totalProfit)}
                    </span>
                 </div>
                 <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                    <span className="text-slate-500 text-sm">Meta de Lucro</span>
                    <span className="text-white font-mono">{formatMoney(goal.profit)}</span>
                 </div>
                 <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                    <span className="text-slate-500 text-sm">Custos Totais</span>
                    <span className="text-amber-500 font-medium">{formatMoney(stats.totalCost)}</span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-slate-500 text-sm">Teto de Gastos</span>
                    <span className={`font-mono ${stats.totalCost > goal.limit && goal.limit > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                       {formatMoney(goal.limit)}
                    </span>
                 </div>
              </div>
           </div>
           
           {stats.totalCost > goal.limit && goal.limit > 0 && (
              <div className="mt-6 bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg flex items-center gap-3">
                 <AlertTriangle size={20} className="text-rose-500" />
                 <p className="text-xs text-rose-300">Atenção: Você estourou o teto de gastos planejado para este mês.</p>
              </div>
           )}
        </div>
      </div>

      {/* MODAL CONFIGURAÇÃO */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-6 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-6">Definir Metas para {currentMonth.split('-')[1]}/{currentMonth.split('-')[0]}</h2>
              <div className="space-y-4">
                 <div>
                    <label className="text-xs uppercase text-blue-500 font-bold mb-1 block">Meta de Faturamento (R$)</label>
                    <input type="number" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-blue-500 outline-none" 
                      value={tempGoal.revenue} onChange={e => setTempGoal({...tempGoal, revenue: parseFloat(e.target.value)})} />
                 </div>
                 <div>
                    <label className="text-xs uppercase text-emerald-500 font-bold mb-1 block">Meta de Lucro Líquido (R$)</label>
                    <input type="number" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-emerald-500 outline-none" 
                      value={tempGoal.profit} onChange={e => setTempGoal({...tempGoal, profit: parseFloat(e.target.value)})} />
                 </div>
                 <div>
                    <label className="text-xs uppercase text-amber-500 font-bold mb-1 block">Teto Máximo de Gastos (Ads)</label>
                    <input type="number" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none" 
                      value={tempGoal.limit} onChange={e => setTempGoal({...tempGoal, limit: parseFloat(e.target.value)})} />
                 </div>
                 <div className="flex gap-3 mt-6">
                    <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-slate-400 hover:text-white">Cancelar</button>
                    <button onClick={handleSaveGoal} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg py-3">Salvar Metas</button>
                 </div>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}