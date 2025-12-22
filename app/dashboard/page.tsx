"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Calendar, DollarSign, TrendingUp, TrendingDown, Activity, 
  LayoutDashboard, Package, Settings, LogOut, Menu, X, ChevronDown, 
  Coins
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURAÇÃO DO SUPABASE ---
// Certifique-se de que o pacote está instalado: npm install @supabase/supabase-js
// E que as variáveis estão no arquivo .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- TIPOS ---
type Product = {
  id: string;
  name: string;
  currency: string;
  platform: string;
};

type Metric = {
  date: string;
  product_id: string;
  cost: number;
  revenue: number;
};

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [viewCurrency, setViewCurrency] = useState('BRL');
  
  // Estados para dados reais
  const [products, setProducts] = useState<Product[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  // --- BUSCAR DADOS DO BANCO REAL ---
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        
        // 1. Buscar Produtos
        const { data: productsData, error: prodError } = await supabase
          .from('products')
          .select('*');
        
        if (prodError) throw prodError;
        setProducts(productsData || []);

        // 2. Buscar Métricas (Últimos 30 dias ou geral)
        const { data: metricsData, error: metError } = await supabase
          .from('daily_metrics')
          .select('date, product_id, cost, revenue')
          .order('date', { ascending: true });

        if (metError) throw metError;
        setMetrics(metricsData || []);
        
      } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // --- PROCESSAMENTO DE DADOS ---
  const aggregatedData = useMemo(() => {
    if (loading || metrics.length === 0) return [];

    // Agrupa métricas por data
    const groupedByDate: Record<string, { cost: number, revenue: number }> = {};

    metrics.forEach(item => {
      // Formata data para DD/MM
      const dateParts = item.date.split('-'); // Assume formato YYYY-MM-DD do banco
      const dateKey = `${dateParts[2]}/${dateParts[1]}`;
      
      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = { cost: 0, revenue: 0 };
      }

      const product = products.find(p => p.id === item.product_id);
      const isProdUSD = product?.currency === 'USD';
      // Nota: Em produção, o ideal é pegar a taxa do banco de dados (coluna exchange_rate)
      const exchangeRate = 6.10; 

      let itemCost = Number(item.cost);
      let itemRevenue = Number(item.revenue);

      // Conversão de Moeda
      if (viewCurrency === 'BRL') {
        if (isProdUSD) {
          itemCost *= exchangeRate;
          itemRevenue *= exchangeRate;
        }
      } else { // View USD
        if (!isProdUSD) {
          itemCost /= exchangeRate;
          itemRevenue /= exchangeRate;
        }
      }

      groupedByDate[dateKey].cost += itemCost;
      groupedByDate[dateKey].revenue += itemRevenue;
    });

    // Transforma objeto em array para o gráfico e inverte se necessário
    return Object.entries(groupedByDate).map(([date, values]) => ({
      name: date,
      custo: values.cost,
      receita: values.revenue,
      lucro: values.revenue - values.cost,
      roi: values.cost > 0 ? ((values.revenue - values.cost) / values.cost) * 100 : 0
    }));
  }, [metrics, products, viewCurrency, loading]);

  const totals = useMemo(() => {
    const sum = aggregatedData.reduce((acc, curr) => ({
      cost: acc.cost + curr.custo,
      revenue: acc.revenue + curr.receita,
      profit: acc.profit + curr.lucro
    }), { cost: 0, revenue: 0, profit: 0 });
    
    return {
      ...sum,
      roi: sum.cost > 0 ? ((sum.revenue - sum.cost) / sum.cost) * 100 : 0
    };
  }, [aggregatedData]);

  const formatMoney = (val: number) => {
    return new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { 
      style: 'currency', 
      currency: viewCurrency 
    }).format(val);
  };

  return (
    <div className="flex min-h-screen bg-black text-slate-200 font-sans">
      
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/80 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-slate-900 
        transform transition-transform duration-300 ease-in-out flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-900">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-900/20">
            <Activity className="text-white w-5 h-5" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight">AutoMetrics</span>
          <button 
            className="ml-auto lg:hidden text-slate-400"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          <a href="/dashboard" className={`w-full px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all ${activeTab === 'dashboard' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}>
            <LayoutDashboard size={18} />
            <span className="font-medium text-sm">Visão Geral</span>
          </a>
          <a href="/products" className="w-full px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all text-slate-400 hover:text-white hover:bg-slate-900">
            <Package size={18} />
            <span className="font-medium text-sm">Meus Produtos</span>
          </a>
          <a href="/manual-entry" className="w-full px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all text-slate-400 hover:text-white hover:bg-slate-900">
            <Settings size={18} />
            <span className="font-medium text-sm">Lançamento Manual</span>
          </a>
        </nav>

        <div className="p-4 border-t border-slate-900">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-white">US</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Usuario</p>
              <p className="text-xs text-slate-500 truncate">admin@autometrics.com</p>
            </div>
            <LogOut size={16} className="text-slate-500 hover:text-rose-400 cursor-pointer" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-black overflow-hidden relative">
        
        {/* Top Header */}
        <header className="h-auto md:h-20 border-b border-slate-900 bg-black/50 backdrop-blur-md flex flex-col md:flex-row items-start md:items-center justify-between px-4 lg:px-8 py-4 sticky top-0 z-30 gap-4">
          <div className="flex items-center gap-4">
            <button className="lg:hidden text-slate-400 hover:text-white" onClick={() => setSidebarOpen(true)}>
              <Menu size={24} />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-white">Dashboard Principal</h1>
              <p className="text-xs text-slate-500 hidden sm:block">Visão consolidada de todas as contas</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Toggle Moeda Global */}
            <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex items-center mr-2">
              <button onClick={() => setViewCurrency('BRL')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${viewCurrency === 'BRL' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'text-slate-400 hover:text-white'}`}>R$ BRL</button>
              <button onClick={() => setViewCurrency('USD')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${viewCurrency === 'USD' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-400 hover:text-white'}`}>$ USD</button>
            </div>

            <div className="hidden md:flex items-center gap-2 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:border-slate-700 cursor-pointer transition-colors group">
              <Calendar size={14} className="text-slate-500 group-hover:text-white transition-colors" />
              <span>Últimos 30 dias</span>
              <ChevronDown size={14} className="text-slate-600" />
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 lg:p-8 custom-scrollbar">
          
          {loading ? (
            <div className="flex items-center justify-center h-64 text-slate-500 animate-pulse">
              Carregando dados reais...
            </div>
          ) : (
            <>
              {/* KPI Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl hover:border-emerald-500/30 transition-all group">
                   <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500"><DollarSign size={18} /></div>
                        <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Receita Total</h3>
                      </div>
                   </div>
                   <div className="space-y-1">
                     <span className="text-2xl font-bold text-white tracking-tight">{formatMoney(totals.revenue)}</span>
                   </div>
                </div>

                <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl hover:border-rose-500/30 transition-all">
                   <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-rose-500/10 text-rose-500"><TrendingDown size={18} /></div>
                        <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Custo Total</h3>
                      </div>
                   </div>
                   <div className="space-y-1">
                     <span className="text-2xl font-bold text-white tracking-tight">{formatMoney(totals.cost)}</span>
                   </div>
                </div>

                <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl hover:border-indigo-500/30 transition-all">
                   <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500"><Coins size={18} /></div>
                        <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Lucro Líquido</h3>
                      </div>
                   </div>
                   <div className="space-y-1">
                     <span className={`text-2xl font-bold tracking-tight ${totals.profit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                       {formatMoney(totals.profit)}
                     </span>
                   </div>
                </div>

                <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl hover:border-blue-500/30 transition-all">
                   <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500"><Activity size={18} /></div>
                        <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">ROI Global</h3>
                      </div>
                   </div>
                   <div className="space-y-1">
                     <span className="text-2xl font-bold text-white tracking-tight">{totals.roi.toFixed(1)}%</span>
                   </div>
                </div>
              </div>

              {/* Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div className="lg:col-span-3 bg-slate-950/50 border border-slate-900 rounded-xl p-6 relative overflow-hidden">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Fluxo de Caixa Unificado</h2>
                      <p className="text-slate-500 text-sm mt-1">
                        Visualizando em <strong className={viewCurrency === 'BRL' ? 'text-emerald-400' : 'text-indigo-400'}>{viewCurrency}</strong>
                      </p>
                    </div>
                  </div>
                  
                  <div className="h-[350px] w-full">
                    {aggregatedData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={aggregatedData}>
                          <defs>
                            <linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorCusto" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                          <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                          <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', color: '#f8fafc' }} 
                            itemStyle={{ color: '#e2e8f0' }}
                            // CORREÇÃO APLICADA AQUI: Aceitamos any para evitar erro de tipo estrito
                            formatter={(value: any) => formatMoney(Number(value))}
                          />
                          <Area type="monotone" dataKey="receita" stroke="#10b981" fillOpacity={1} fill="url(#colorReceita)" strokeWidth={2} />
                          <Area type="monotone" dataKey="custo" stroke="#f43f5e" fillOpacity={1} fill="url(#colorCusto)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-600">
                        Nenhum dado encontrado para o período.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </main>
    </div>
  );
}