"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation'; 
import { 
  ArrowLeft, Columns, X, ArrowDownRight, ExternalLink, Calendar, Link as LinkIcon, 
  PlayCircle, PauseCircle, RefreshCw, FileText, Save, Sun, Moon, ShoppingCart, 
  Video, MousePointer
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

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

const ALL_COLUMNS = [
  // GERAL
  { key: 'date', label: 'Data', category: 'Geral', default: true },
  { key: 'campaign_status', label: 'Status Dia', category: 'Geral', default: true },
  { key: 'account_name', label: 'Conta', category: 'Geral', default: true },
  
  // TRÁFEGO ADS
  { key: 'impressions', label: 'Impressões', category: 'Tráfego', default: true },
  { key: 'clicks', label: 'Cliques Anúncio', category: 'Tráfego', default: true },
  { key: 'ctr', label: 'CTR', category: 'Tráfego', default: true, format: 'percentage' },
  { key: 'cost', label: 'Custo Ads', category: 'Custo', default: true, format: 'currency' },
  { key: 'avg_cpc', label: 'CPC Médio', category: 'Custo', default: true, format: 'currency' }, 
  { key: 'budget', label: 'Orçamento Diário', category: 'Custo', default: true, format: 'currency' }, // COLUNA INCLUÍDA AQUI

  // FUNIL (MANUAL)
  { key: 'visits', label: 'Visitas Pág.', category: 'Funil', default: true },
  { key: 'vsl_clicks', label: 'Cliques VSL', category: 'Funil', default: false },
  { key: 'vsl_checkouts', label: 'Checkout VSL', category: 'Funil', default: false },
  { key: 'checkouts', label: 'Checkout Geral', category: 'Funil', default: true },

  // FUGAS (CÁLCULOS)
  { key: 'fuga_pagina', label: 'Fuga Página (%)', category: 'Métricas de Fuga', default: true, format: 'percentage_red' },
  { key: 'fuga_bridge', label: 'Fuga Bridge (%)', category: 'Métricas de Fuga', default: false, format: 'percentage_red' },
  { key: 'fuga_vsl', label: 'Fuga VSL (%)', category: 'Métricas de Fuga', default: false, format: 'percentage_red' },

  // FINANCEIRO
  { key: 'conversions', label: 'Conversões', category: 'Financeiro', default: true },
  { key: 'revenue', label: 'Receita Total', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'refunds', label: 'Reembolso', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'cpa', label: 'CPA (Custo/Conv)', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'profit', label: 'Lucro (R$)', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'roi', label: 'ROI (%)', category: 'Financeiro', default: true, format: 'percentage' },
  
  // GOOGLE ADS AVANÇADO
  { key: 'strategy', label: 'Estratégia', category: 'Google Ads', default: true },
  { key: 'target_cpa', label: 'Meta (CPA/ROAS)', category: 'Google Ads', default: true, format: 'currency' },
  { key: 'search_impr_share', label: 'Parc. Impr.', category: 'Google Ads', default: false, format: 'percentage_share' },
  { key: 'search_top_share', label: 'Parc. Topo', category: 'Google Ads', default: false, format: 'percentage_share' },
  { key: 'search_abs_share', label: 'Parc. Absoluta', category: 'Google Ads', default: false, format: 'percentage_share' },
  { key: 'final_url', label: 'Página Anúncio', category: 'Google Ads', default: false, type: 'link' },
];

export default function ProductDetailPage() {
  const params = useParams();
  const productId = typeof params?.id === 'string' ? params.id : '';

  // --- ESTADOS DE DATA ---
  const [dateRange, setDateRange] = useState('this_month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [product, setProduct] = useState<any>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('BRL');
  const [liveDollar, setLiveDollar] = useState(6.00); 
  const [manualDollar, setManualDollar] = useState(5.60); 

  // Estado do Lançamento Manual
  const [manualData, setManualData] = useState({ 
    date: getLocalYYYYMMDD(new Date()), 
    visits: 0, checkouts: 0, vsl_clicks: 0, vsl_checkouts: 0, sales: 0, revenue: 0, refunds: 0, currency: 'BRL' 
  });
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState(
    ALL_COLUMNS.filter(c => c.default).map(c => c.key)
  );

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // --- INICIALIZAÇÃO ---
  useEffect(() => {
    // 1. Tema e Moeda
    const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
    if (savedTheme) setTheme(savedTheme);

    const savedColumns = localStorage.getItem('autometrics_visible_columns');
    if (savedColumns) try { setVisibleColumns(JSON.parse(savedColumns)); } catch (e) {}
    
    const savedDollar = localStorage.getItem('autometrics_manual_dollar');
    if (savedDollar) setManualDollar(parseFloat(savedDollar));
    
    const savedViewCurrency = localStorage.getItem('autometrics_view_currency');
    if (savedViewCurrency) setViewCurrency(savedViewCurrency);

    fetchLiveDollar();

    // 2. Data Inicial
    setManualData(prev => ({...prev, date: getLocalYYYYMMDD(new Date())}));
    handlePresetChange('this_month');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('autometrics_theme', newTheme);
  };

  const toggleViewCurrency = (currency: string) => {
    setViewCurrency(currency);
    localStorage.setItem('autometrics_view_currency', currency);
  };

  async function fetchLiveDollar() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      const data = await res.json();
      if (data.USDBRL) setLiveDollar(parseFloat(data.USDBRL.bid));
    } catch (e) { console.error(e); }
  }

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: prodData } = await supabase.from('products').select('*').eq('id', productId).single();
      if (prodData) {
         setProduct(prodData);
         setManualData(prev => ({...prev, currency: prodData.currency || 'BRL'}));
      }
      const { data: metricsData } = await supabase.from('daily_metrics').select('*').eq('product_id', productId).order('date', { ascending: true });
      setMetrics(metricsData || []);
    } catch (error) { console.error(error); } 
    finally { setLoading(false); }
  };

  useEffect(() => { if(productId) fetchData(); }, [productId]);

  // Carrega dados existentes para edição
  useEffect(() => {
    if (showManualEntry && manualData.date && productId) {
        const fetchDayData = async () => {
            const { data } = await supabase.from('daily_metrics').select('visits, checkouts, vsl_clicks, vsl_checkouts, conversions, conversion_value, refunds, currency').eq('product_id', productId).eq('date', manualData.date).single();
            if (data) {
                setManualData(prev => ({
                    ...prev,
                    visits: data.visits || 0, checkouts: data.checkouts || 0, vsl_clicks: data.vsl_clicks || 0, vsl_checkouts: data.vsl_checkouts || 0,
                    sales: data.conversions || 0, revenue: data.conversion_value || 0, refunds: data.refunds || 0, currency: data.currency || prev.currency
                }));
            } else {
                 setManualData(prev => ({
                    ...prev, visits: 0, checkouts: 0, vsl_clicks: 0, vsl_checkouts: 0, sales: 0, revenue: 0, refunds: 0
                 }));
            }
        };
        fetchDayData();
    }
  }, [manualData.date, showManualEntry, productId]);


  const handleSaveManual = async () => {
    setIsSavingManual(true);
    try {
      // 1. Identificar moeda da conta (Google Ads) - Esta é a "Verdade"
      const accountCurrency = product?.currency || 'BRL';
      const inputCurrency = manualData.currency;
      
      let finalRevenue = Number(manualData.revenue);
      let finalRefunds = Number(manualData.refunds);

      // 2. Converter se a moeda do lançamento for diferente da moeda da conta
      // Assim, o banco sempre guarda na moeda da conta, evitando que o custo (que também está na moeda da conta) fique com escala errada.
      if (inputCurrency !== accountCurrency) {
          if (accountCurrency === 'BRL' && inputCurrency === 'USD') {
              // Conta é Real, Lançou em Dólar -> Converte para Real (Multiplica)
              finalRevenue = finalRevenue * manualDollar;
              finalRefunds = finalRefunds * manualDollar;
          } else if (accountCurrency === 'USD' && inputCurrency === 'BRL') {
              // Conta é Dólar, Lançou em Real -> Converte para Dólar (Divide)
              finalRevenue = finalRevenue / manualDollar;
              finalRefunds = finalRefunds / manualDollar;
          }
          // (Adicionar lógica EUR se necessário, por enquanto assume paridade ou ignora)
      }

      const payload = {
        product_id: productId, date: manualData.date,
        visits: Number(manualData.visits), checkouts: Number(manualData.checkouts), 
        vsl_clicks: Number(manualData.vsl_clicks), vsl_checkouts: Number(manualData.vsl_checkouts),
        conversions: Number(manualData.sales), 
        conversion_value: finalRevenue, // Salva o valor JÁ CONVERTIDO para a moeda da conta
        refunds: finalRefunds,          // Salva o valor JÁ CONVERTIDO
        currency: accountCurrency,      // Força a moeda do registro ser a mesma da conta
        updated_at: new Date().toISOString()
      };
      
      const { error } = await supabase.from('daily_metrics').upsert(payload, { onConflict: 'product_id, date' });
      if(error) throw error;
      
      alert('Dados salvos com sucesso!');
      setShowManualEntry(false);
      fetchData(); 
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setIsSavingManual(false); }
  };

  const toggleStatus = async () => {
    if (!product) return;
    const newStatus = product.status === 'active' ? 'paused' : 'active';
    setProduct({ ...product, status: newStatus });
    await supabase.from('products').update({ status: newStatus }).eq('id', product.id);
  };

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const updatedColumns = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem('autometrics_visible_columns', JSON.stringify(updatedColumns));
      return updatedColumns;
    });
  };

  // --- LÓGICA DE DATAS ---
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

  const processedData = useMemo(() => {
    const filteredMetrics = metrics.filter(m => m.date >= startDate && m.date <= endDate);
    const stats = { revenue: 0, cost: 0, profit: 0, roi: 0, conversions: 0, clicks: 0, visits: 0 };
    if (!filteredMetrics.length) return { rows: [], stats, chart: [] };

    const rows = filteredMetrics.map(row => {
      let cost = Number(row.cost || 0); let revenue = Number(row.conversion_value || 0); let refunds = Number(row.refunds || 0); let cpc = Number(row.avg_cpc || 0);
      let budget = Number(row.budget_micros || 0) / 1000000; let targetValue = Number(row.target_cpa || 0);
      
      const rowCurrency = row.currency || 'BRL';
      
      if (viewCurrency === 'BRL' && rowCurrency === 'USD') {
        cost *= liveDollar; cpc *= liveDollar; budget *= liveDollar; targetValue *= liveDollar;
        revenue *= manualDollar; refunds *= manualDollar;
      } else if (viewCurrency === 'ORIGINAL' && rowCurrency === 'BRL') {
        cost /= liveDollar; revenue /= manualDollar; refunds /= manualDollar; 
      }

      const profit = revenue - refunds - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const conversions = Number(row.conversions || 0);
      const cpa = conversions > 0 ? cost / conversions : 0;

      // Métricas de Funil & Fuga
      const visits = Number(row.visits || 0);
      const checkouts = Number(row.checkouts || 0);
      const vslClicks = Number(row.vsl_clicks || 0);
      const vslCheckouts = Number(row.vsl_checkouts || 0);
      const clicks = Number(row.clicks || 0);
      
      const fugaPagina = clicks > 0 ? (1 - (checkouts / clicks)) * 100 : 0;
      const fugaBridge = clicks > 0 ? (1 - (vslClicks / clicks)) * 100 : 0;
      const fugaVsl = vslClicks > 0 ? (1 - (vslCheckouts / vslClicks)) * 100 : 0;

      stats.revenue += revenue; stats.cost += cost; stats.profit += profit;
      stats.conversions += conversions; stats.clicks += clicks; stats.visits += visits;

      const dateParts = row.date.split('-');
      const shortDate = `${dateParts[2]}/${dateParts[1]}`;
      const fullDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
      const parseShare = (val: any) => (!val || val === '< 10%') ? 0 : parseFloat(val);

      return {
        ...row, date: fullDate, shortDate, cost, revenue, refunds, profit, roi, avg_cpc: cpc, budget, cpa, target_cpa: targetValue,
        ctr: Number(row.ctr || 0), account_name: row.account_name || '-', campaign_status: row.campaign_status || 'ENABLED', 
        strategy: row.bidding_strategy || '-', final_url: row.final_url,
        // Parcelas
        search_impr_share: parseShare(row.search_impression_share), 
        search_top_share: parseShare(row.search_top_impression_share), 
        search_abs_share: parseShare(row.search_abs_top_share),
        // Funil
        visits, checkouts, vsl_clicks: vslClicks, vsl_checkouts: vslCheckouts, fuga_pagina: fugaPagina, fuga_bridge: fugaBridge, fuga_vsl: fugaVsl
      };
    });

    stats.roi = stats.cost > 0 ? (stats.profit / stats.cost) * 100 : 0;
    const chartData = rows.map(r => ({ day: r.shortDate, lucro: r.profit, custo: r.cost, receita: r.revenue }));
    return { rows: rows.reverse(), chart: chartData, stats };
  }, [metrics, viewCurrency, startDate, endDate, liveDollar, manualDollar]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: viewCurrency === 'BRL' ? 'BRL' : 'USD' }).format(val);
  const formatPercent = (val: number) => `${val.toFixed(2)}%`;
  const formatShare = (val: number) => val === 0 ? '< 10%' : `${(val * 100).toFixed(2)}%`;

  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';

  if (loading) return <div className={`min-h-screen ${bgMain} flex items-center justify-center`}>Carregando dados...</div>;
  if (!product) return <div className={`min-h-screen ${bgMain} flex items-center justify-center ${textMuted}`}>Produto não encontrado.</div>;

  const { rows, stats, chart } = processedData;
  const globalCpa = stats.conversions > 0 ? stats.cost / stats.conversions : 0;

  return (
    <div className={`min-h-screen font-sans p-4 md:p-6 relative ${bgMain}`}>
      
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
        <div className="flex items-center gap-4">
          <Link href="/products" className={`p-2 rounded-lg border transition-colors ${isDark ? 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className={`text-2xl font-bold ${textHead}`}>{product.name}</h1>
              <button onClick={toggleStatus} className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase border ${product.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20'}`}>
                {product.status === 'active' ? <PlayCircle size={12} /> : <PauseCircle size={12} />} {product.status === 'active' ? 'Ativo' : 'Pausado'}
              </button>
            </div>
            <div className={`flex items-center gap-3 text-sm ${textMuted} mt-1`}><span className="flex items-center gap-1"><ExternalLink size={12}/> {product.platform}</span><span>•</span><span className={`font-mono text-xs px-1 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>{product.google_ads_campaign_name}</span></div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 w-full xl:w-auto items-end">
          <button onClick={() => setShowManualEntry(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-900/20">
             <FileText size={14} /> Lançamento Rápido
          </button>
          
          {/* SELETOR DE DATA PADRONIZADO */}
          <div className={`flex items-center p-1.5 rounded-xl border ${bgCard} shadow-sm`}>
                <div className="flex items-center gap-2 px-2 border-r border-inherit">
                   {/* Ícone: Branco no escuro, Cinza Escuro no claro */}
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

          <div className={`flex p-1 rounded-lg border ${bgCard} gap-2`}>
             <div className={`flex rounded-md ${isDark ? 'bg-black' : 'bg-slate-100'}`}>
                <button onClick={() => toggleViewCurrency('ORIGINAL')} className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${viewCurrency === 'ORIGINAL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>USD</button>
                <button onClick={() => toggleViewCurrency('BRL')} className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${viewCurrency === 'BRL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>BRL</button>
             </div>
             <button onClick={toggleTheme} className={`${textMuted} hover:text-indigo-500 px-2`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div className={`${bgCard} p-5 rounded-xl border-t-4 border-t-blue-500`}>
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Receita Total</p>
           <p className="text-2xl font-bold text-blue-500">{formatMoney(stats.revenue)}</p>
        </div>
        <div className={`${bgCard} p-5 rounded-xl border-t-4 border-t-orange-500`}>
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Custo Ads</p>
           <p className="text-2xl font-bold text-orange-500">{formatMoney(stats.cost)}</p>
        </div>
        <div className={`${bgCard} p-5 rounded-xl border-t-4 ${stats.profit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'}`}>
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">Lucro Líquido</p>
           <p className={`text-2xl font-bold ${stats.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(stats.profit)}</p>
        </div>
        <div className={`${bgCard} p-5 rounded-xl border-t-4 border-t-indigo-500`}>
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">ROI</p>
           <p className="text-2xl font-bold text-indigo-500">{stats.roi.toFixed(1)}%</p>
        </div>
        <div className={`${bgCard} p-5 rounded-xl border-t-4 border-t-cyan-500`}>
           <p className="text-slate-500 text-xs font-bold uppercase mb-2">CPA (Custo/Conv)</p>
           <p className="text-2xl font-bold text-cyan-500">{formatMoney(globalCpa)}</p>
        </div>
      </div>

      <div className={`${bgCard} rounded-xl p-6 mb-8 h-64`}>
         <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
               <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
               <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
               <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
               <Tooltip contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0', color: isDark ? '#fff' : '#000' }} formatter={(val:any) => formatMoney(val)} />
               <Legend />
               <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
               <Bar dataKey="cost" name="Custo" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={40} />
               <Bar dataKey="lucro" name="Lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
         </ResponsiveContainer>
      </div>

      <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
        <div className={`p-4 border-b ${borderCol} flex flex-col md:flex-row justify-between items-center gap-4 shrink-0`}>
          <div className="flex items-center gap-3">
            <h3 className={`font-semibold ${textHead}`}>Histórico Detalhado</h3>
            <span className={`text-xs ${textMuted} ${isDark ? 'bg-slate-950' : 'bg-slate-100'} px-2 py-1 rounded border ${borderCol}`}>{rows.length} registros</span>
          </div>
          <button onClick={() => setShowColumnModal(true)} className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded transition-colors border ${isDark ? 'text-slate-300 bg-slate-800 hover:bg-slate-700 border-slate-700' : 'text-slate-600 bg-slate-100 hover:bg-slate-200 border-slate-300'}`}>
            <Columns size={14} /> Personalizar Colunas
          </button>
        </div>
        <div className="overflow-auto custom-scrollbar flex-1">
          <table className="w-full text-sm text-left border-collapse">
            <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0 z-20 shadow-lg`}>
              <tr>{ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (<th key={col.key} className={`px-4 py-4 whitespace-nowrap border-b ${borderCol} text-right ${isDark ? 'bg-slate-950' : 'bg-slate-100'} first:text-left first:sticky first:left-0 first:z-30`}>{col.label}</th>))}</tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
              {rows.map(row => (
                <tr key={row.id} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => {
                    const val = row[col.key];
                    let content;
                    if (col.key === 'date') return <td key={col.key} className={`px-4 py-4 font-medium sticky left-0 border-r ${borderCol} ${isDark ? 'bg-slate-900 group-hover:bg-slate-800 text-white' : 'bg-white group-hover:bg-slate-50 text-slate-900'}`}>{val}</td>
                    
                    if (col.key === 'campaign_status') content = <span className={`flex items-center justify-end gap-1.5 ${val === 'PAUSED' ? 'text-slate-500' : 'text-emerald-400'}`}>{val} {val === 'PAUSED' ? <PauseCircle size={14}/> : <PlayCircle size={14}/>}</span>;
                    else if (col.type === 'link') content = val ? <a href={val} target="_blank" className="text-indigo-400 hover:text-indigo-300 flex justify-end"><LinkIcon size={14}/></a> : '-';
                    else if (col.format === 'currency') content = <span className={col.key === 'profit' ? (val >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold') : (col.key === 'revenue' ? 'text-blue-500 font-bold' : (col.key === 'cost' ? 'text-orange-500 font-medium' : 'text-slate-400'))}>{formatMoney(val)}</span>;
                    else if (col.format === 'percentage') content = <span>{formatPercent(val)}</span>;
                    else if (col.format === 'percentage_share') content = <span>{formatShare(val)}</span>;
                    else if (col.format === 'percentage_red') content = <span className={`${val > 50 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>{formatPercent(val)}</span>;
                    else content = <span className={textMuted}>{val}</span>;
                    
                    return <td key={col.key} className="px-4 py-4 whitespace-nowrap text-right">{content}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {showManualEntry && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className={`${bgCard} rounded-xl w-full max-w-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]`}>
              <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                 <h2 className={`text-xl font-bold ${textHead} flex items-center gap-2`}><FileText size={20} className="text-indigo-500"/> Lançamento Rápido (Funil)</h2>
                 <button onClick={() => setShowManualEntry(false)}><X size={24} className="text-slate-400 hover:text-white" /></button>
              </div>
              
              <div className="space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="text-xs uppercase text-slate-500 font-bold">Data</label><input type="date" className={`w-full border rounded p-2 ${isDark ? 'bg-slate-950 border-slate-800 text-white [&::-webkit-calendar-picker-indicator]:invert' : 'bg-white border-slate-200 text-black'} `} value={manualData.date} onChange={e => setManualData({...manualData, date: e.target.value})} /></div>
                    <div>
                        <label className="text-xs uppercase text-slate-500 font-bold">Moeda</label>
                        <select className={`w-full border rounded p-2 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-black'}`} value={manualData.currency} onChange={e => setManualData({...manualData, currency: e.target.value})}>
                           <option value="BRL">BRL</option>
                           <option value="USD">USD</option>
                           <option value="EUR">EUR</option>
                        </select>
                    </div>
                 </div>

                 <div className={`p-4 rounded-lg border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                    <h3 className="text-xs font-bold text-indigo-400 uppercase mb-3 flex items-center gap-2"><MousePointer size={14}/> Tráfego & VSL</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                       <div><label className="text-[10px] uppercase text-slate-500 font-bold">Visitas Pág.</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.visits} onChange={e => setManualData({...manualData, visits: parseFloat(e.target.value)})} /></div>
                       <div><label className="text-[10px] uppercase text-slate-500 font-bold">Cliques VSL</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.vsl_clicks} onChange={e => setManualData({...manualData, vsl_clicks: parseFloat(e.target.value)})} /></div>
                       <div><label className="text-[10px] uppercase text-slate-500 font-bold">Checkout VSL</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.vsl_checkouts} onChange={e => setManualData({...manualData, vsl_checkouts: parseFloat(e.target.value)})} /></div>
                       <div><label className="text-[10px] uppercase text-slate-500 font-bold">Check. Geral</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.checkouts} onChange={e => setManualData({...manualData, checkouts: parseFloat(e.target.value)})} /></div>
                    </div>
                 </div>

                 <div className={`p-4 rounded-lg border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                    <h3 className="text-xs font-bold text-emerald-400 uppercase mb-3 flex items-center gap-2"><ShoppingCart size={14}/> Vendas & Receita</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                       <div><label className="text-[10px] uppercase text-slate-500 font-bold">Vendas (Qtd)</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.sales} onChange={e => setManualData({...manualData, sales: parseFloat(e.target.value)})} /></div>
                       <div><label className="text-[10px] uppercase text-blue-500 font-bold">Receita Total</label><input type="number" className={`w-full border rounded p-2 text-sm border-l-4 border-l-blue-500 ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0.00" value={manualData.revenue} onChange={e => setManualData({...manualData, revenue: parseFloat(e.target.value)})} /></div>
                       <div><label className="text-[10px] uppercase text-rose-500 font-bold">Reembolsos</label><input type="number" className={`w-full border rounded p-2 text-sm border-l-4 border-l-rose-500 ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0.00" value={manualData.refunds} onChange={e => setManualData({...manualData, refunds: parseFloat(e.target.value)})} /></div>
                    </div>
                 </div>
                 
                 <button onClick={handleSaveManual} disabled={isSavingManual} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl mt-2 flex items-center justify-center gap-2 shadow-lg">{isSavingManual ? 'Salvando...' : 'Salvar Dados'} <Save size={16} /></button>
              </div>
           </div>
        </div>
      )}

      {showColumnModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`${bgCard} rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]`}>
            <div className={`p-6 border-b flex justify-between items-center ${borderCol}`}><h2 className={`text-xl font-bold ${textHead} flex items-center gap-2`}><Columns size={20} className="text-indigo-500"/> Personalizar Colunas</h2><button onClick={() => setShowColumnModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button></div>
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {['Geral', 'Tráfego', 'Métricas de Fuga', 'Funil', 'Financeiro', 'Google Ads'].map(category => (
                  <div key={category}>
                    {ALL_COLUMNS.some(c => c.category === category) && (
                      <>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-800 pb-2">{category}</h3>
                        <div className="space-y-2">
                          {ALL_COLUMNS.filter(c => c.category === category).map(col => (
                            <div key={col.key} onClick={() => toggleColumn(col.key)} className={`flex items-center gap-3 p-2 rounded cursor-pointer group transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${visibleColumns.includes(col.key) ? 'bg-indigo-600 border-indigo-600' : 'bg-transparent border-slate-600'}`}>
                                {visibleColumns.includes(col.key) && <ArrowDownRight size={14} className="text-white" />}
                              </div>
                              <span className={visibleColumns.includes(col.key) ? `${textHead} font-medium` : 'text-slate-400'}>{col.label}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className={`p-4 border-t flex justify-end rounded-b-xl ${borderCol} ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}><button onClick={() => setShowColumnModal(false)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Confirmar</button></div>
          </div>
        </div>
      )}

    </div>
  );
}