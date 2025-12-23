"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Code, Activity, DollarSign, TrendingDown, LayoutDashboard, 
  Package, Settings, Menu, X, Coins, RotateCcw
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Configuração Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

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
  conversion_value: number; 
  refunds: number;          
};

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('BRL'); 
  
  const [products, setProducts] = useState<Product[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  // Busca dados
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const { data: productsData } = await supabase.from('products').select('*');
        setProducts(productsData || []);

        const { data: metricsData } = await supabase
          .from('daily_metrics')
          .select('date, product_id, cost, conversion_value, refunds')
          .order('date', { ascending: true });
          
        setMetrics(metricsData || []);
      } catch (error) {
        console.error("Erro:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const aggregatedData = useMemo(() => {
    if (loading || metrics.length === 0) return [];

    const groupedByDate: Record<string, { cost: number, revenue: number, refunds: number }> = {};

    metrics.forEach(item => {
      const dateParts = item.date.split('-');
      const dateKey = `${dateParts[2]}/${dateParts[1]}`; 
      
      if (!groupedByDate[dateKey]) groupedByDate[dateKey] = { cost: 0, revenue: 0, refunds: 0 };

      const product = products.find(p => p.id === item.product_id);
      
      // --- LÓGICA DE MOEDA ATUALIZADA ---
      const currency = product?.currency || 'BRL';
      
      // Taxas de câmbio fixas (para exemplo)
      const rates = {
        USD: 5.40, // Dólar
        EUR: 6.40  // Euro (Adicionado)
      };

      let itemCost = Number(item.cost || 0);
      let itemRevenue = Number(item.conversion_value || 0);
      let itemRefunds = Number(item.refunds || 0);

      // Passo 1: Converte TUDO para BRL primeiro (Normalização)
      if (currency === 'USD') {
        itemCost *= rates.USD;
        itemRevenue *= rates.USD;
        itemRefunds *= rates.USD;
      } else if (currency === 'EUR') {
        itemCost *= rates.EUR;
        itemRevenue *= rates.EUR;
        itemRefunds *= rates.EUR;
      }

      // Passo 2: Se o usuário quer ver em USD, converte o BRL de volta para USD
      if (viewCurrency === 'USD') {
        itemCost /= rates.USD;
        itemRevenue /= rates.USD;
        itemRefunds /= rates.USD;
      }
      // Se viewCurrency for 'BRL', já está pronto.

      groupedByDate[dateKey].cost += itemCost;
      groupedByDate[dateKey].revenue += itemRevenue;
      groupedByDate[dateKey].refunds += itemRefunds;
    });

    return Object.entries(groupedByDate).map(([date, values]) => {
      const netRevenue = values.revenue - values.refunds; 
      const profit = netRevenue - values.cost;           

      return {
        name: date,
        custo: values.cost,
        receita_bruta: values.revenue,
        reembolsos: values.refunds,
        receita_liquida: netRevenue,
        lucro: profit,
        roi: values.cost > 0 ? (profit / values.cost) * 100 : 0
      };
    });
  }, [metrics, products, viewCurrency, loading]);

  const totals = useMemo(() => {
    return aggregatedData.reduce((acc, curr) => ({
      cost: acc.cost + curr.custo,
      revenue: acc.revenue + curr.receita_bruta,
      refunds: acc.refunds + curr.reembolsos,
      profit: acc.profit + curr.lucro
    }), { cost: 0, revenue: 0, refunds: 0, profit: 0 });
  }, [aggregatedData]);

  const totalRoi = totals.cost > 0 ? (totals.profit / totals.cost) * 100 : 0;

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);

  return (
    <div className="flex min-h-screen bg-black text-slate-200 font-sans">
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-slate-900 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} flex flex-col`}>
        <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-900">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center"><Activity className="text-white w-5 h-5" /></div>
          <span className="text-lg font-bold text-white">AutoMetrics</span>
          <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}><X size={20}/></button>
        </div>
        <nav className="flex-1 px-3 py-6 space-y-1">
  <Link href="/dashboard" className="...classes..."><LayoutDashboard size={18} /> Visão Geral</Link>
  <Link href="/products" className="...classes..."><Package size={18} /> Meus Produtos</Link>
  <Link href="/manual-entry" className="...classes..."><Settings size={18} /> Lançamento Manual</Link>
  
  {/* NOVO LINK DE INTEGRAÇÃO */}
  <Link href="/integration" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors">
    <Code size={18} /> Integração
  </Link>
</nav>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-black overflow-hidden relative">
        <header className="h-16 md:h-20 border-b border-slate-900 flex items-center justify-between px-4 lg:px-8 bg-black/50 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button className="lg:hidden text-slate-400" onClick={() => setSidebarOpen(true)}><Menu size={24}/></button>
            <h1 className="text-lg font-semibold text-white">Dashboard de Resultados</h1>
          </div>
          <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button onClick={() => setViewCurrency('BRL')} className={`px-3 py-1.5 rounded text-xs font-medium ${viewCurrency === 'BRL' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>R$ BRL</button>
            <button onClick={() => setViewCurrency('USD')} className={`px-3 py-1.5 rounded text-xs font-medium ${viewCurrency === 'USD' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>$ USD</button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 lg:p-8 custom-scrollbar">
          {loading ? (
            <div className="flex justify-center items-center h-64 animate-pulse text-slate-500">Carregando métricas...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                {[
                  { title: 'Receita Bruta', val: totals.revenue, color: 'text-white', icon: DollarSign, bg: 'bg-emerald-500/10', iconColor: 'text-emerald-500' },
                  { title: 'Reembolsos', val: totals.refunds, color: 'text-rose-400', icon: RotateCcw, bg: 'bg-rose-500/10', iconColor: 'text-rose-500' },
                  { title: 'Custo Ads', val: totals.cost, color: 'text-white', icon: TrendingDown, bg: 'bg-slate-700/30', iconColor: 'text-slate-400' },
                  { title: 'Lucro Real', val: totals.profit, color: totals.profit > 0 ? 'text-emerald-400' : 'text-rose-400', icon: Coins, bg: 'bg-indigo-500/10', iconColor: 'text-indigo-500' },
                  { title: 'ROI', val: `${totalRoi.toFixed(1)}%`, color: totalRoi > 0 ? 'text-emerald-400' : 'text-rose-400', icon: Activity, bg: 'bg-blue-500/10', iconColor: 'text-blue-500', isPercent: true }
                ].map((card, i) => (
                  <div key={i} className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl hover:border-indigo-500/30 transition-all">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <div className={`p-2 rounded-lg ${card.bg} ${card.iconColor}`}><card.icon size={18} /></div>
                        <h3 className="text-slate-400 text-xs font-semibold uppercase">{card.title}</h3>
                      </div>
                    </div>
                    <span className={`text-2xl font-bold ${card.color}`}>{card.isPercent ? card.val : formatMoney(card.val as number)}</span>
                  </div>
                ))}
              </div>

              <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-6 h-[400px] w-full mb-8">
                <h3 className="text-white font-bold mb-4">Evolução Diária</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={aggregatedData}>
                    <defs>
                      <linearGradient id="colorLucro" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorCusto" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/><stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', color: '#f8fafc' }} 
                      formatter={(val:any, name:string) => [formatMoney(Number(val)), name === 'lucro' ? 'Lucro Líquido' : name === 'custo' ? 'Custo Ads' : 'Receita']} 
                    />
                    <Area type="monotone" dataKey="lucro" stackId="1" stroke="#6366f1" fillOpacity={1} fill="url(#colorLucro)" strokeWidth={3} name="Lucro" />
                    <Area type="monotone" dataKey="custo" stackId="2" stroke="#f43f5e" fillOpacity={1} fill="url(#colorCusto)" strokeWidth={2} name="Custo" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}