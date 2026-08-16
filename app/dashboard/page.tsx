"use client";

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar, Sun, Moon, LayoutGrid, Package, Settings,
  LogOut, Target, ArrowUpRight, ArrowDownRight,
  ChevronUp, ChevronDown, SlidersHorizontal, X
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { supabase } from '../../lib/supabaseClient';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuthGuard } from '@/lib/useAuthGuard';
import SaleAlertNotification from './SaleAlertNotification';

function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function trendPct(arr: number[]): number {
  if (!arr || arr.length < 2) return 0;
  const first = arr[0];
  const last = arr[arr.length - 1];
  if (!first) return 0;
  return ((last - first) / Math.abs(first)) * 100;
}

function SparklineSVG({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <div className="h-7" />;
  const w = 80, h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y] as [number, number];
  });
  const polyPts = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} L${w},${h} L0,${h} Z`;
  const lastPt = pts[pts.length - 1];
  const gradId = `sg${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline points={polyPts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastPt[0].toFixed(1)} cy={lastPt[1].toFixed(1)} r="2.5" fill={color} />
    </svg>
  );
}

const DATE_PRESET_LABELS: Record<string, string> = {
  today: 'Hoje', yesterday: 'Ontem', '7d': '7 Dias',
  this_month: 'Este Mês', '30d': '30 Dias', last_month: 'Mês Passado',
};
const DATE_PRESETS = ['today', 'yesterday', '7d', 'this_month', '30d', 'last_month'] as const;

export default function DashboardPage() {
  const router = useRouter();
  const { authChecked } = useAuthGuard();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  const [metrics, setMetrics] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [fetchedFrom, setFetchedFrom] = useState('');

  const [dateRange, setDateRange] = useState('this_month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const [selectedMcc, setSelectedMcc] = useState<string>('all');
  const [showFilterSheet, setShowFilterSheet] = useState(false);

  const [liveDollar, setLiveDollar] = useState(6.00);
  const [manualDollar, setManualDollar] = useState(5.60);
  const [liveEuro, setLiveEuro] = useState(6.50);
  const [manualEuro, setManualEuro] = useState(6.00);
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD' | 'EUR'>('BRL');
  const [rateConfig, setRateConfig] = useState<'USD' | 'EUR'>('USD');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [dollarInput, setDollarInput] = useState("5,60");
  const [euroInput, setEuroInput] = useState("6,00");

  useEffect(() => {
    async function init() {
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) setTheme(savedTheme);

      const savedDollar = localStorage.getItem('autometrics_manual_dollar');
      if (savedDollar) {
        const dVal = parseFloat(savedDollar);
        setManualDollar(dVal);
        setDollarInput(dVal.toFixed(2).replace('.', ','));
      } else {
        setDollarInput((5.60).toFixed(2).replace('.', ','));
      }

      const savedEuro = localStorage.getItem('autometrics_manual_euro');
      if (savedEuro) {
        const eVal = parseFloat(savedEuro);
        setManualEuro(eVal);
        setEuroInput(eVal.toFixed(2).replace('.', ','));
      } else {
        setEuroInput((6.00).toFixed(2).replace('.', ','));
      }

      const savedCurrency = localStorage.getItem('autometrics_view_currency') as 'BRL' | 'USD' | 'EUR';
      if (savedCurrency && ['BRL', 'USD', 'EUR'].includes(savedCurrency)) setViewCurrency(savedCurrency);

      const savedRateConfig = localStorage.getItem('autometrics_rate_config') as 'USD' | 'EUR';
      if (savedRateConfig && ['USD', 'EUR'].includes(savedRateConfig)) setRateConfig(savedRateConfig);

      const savedMcc = localStorage.getItem('autometrics_selected_mcc');
      if (savedMcc) setSelectedMcc(savedMcc);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setUser(session.user);

      let initialFromDate: string | undefined;
      const savedDateRange = localStorage.getItem('autometrics_date_range');
      if (savedDateRange) {
        if (savedDateRange === 'custom') {
          const savedStart = localStorage.getItem('autometrics_start_date');
          const savedEnd = localStorage.getItem('autometrics_end_date');
          setDateRange('custom');
          if (savedStart) { setStartDate(savedStart); initialFromDate = savedStart; }
          if (savedEnd) setEndDate(savedEnd);
        } else {
          handlePresetChange(savedDateRange);
        }
      } else {
        handlePresetChange('this_month');
      }

      await Promise.all([
        fetchInitialData(session.user.id, initialFromDate),
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

  async function fetchInitialData(userId: string, fromDate?: string) {
    let allProducts: any[] = [];
    let p_prod = 0;
    let m_prod = true;
    while (m_prod) {
      const { data } = await supabase
        .from('products')
        .select('id, currency, name, google_ads_campaign_name, account_name, mcc_name')
        .eq('user_id', userId)
        .range(p_prod * 1000, (p_prod + 1) * 1000 - 1);

      if (data && data.length > 0) {
        allProducts.push(...data);
        if (data.length < 1000) m_prod = false;
        else p_prod++;
      } else { m_prod = false; }
    }
    setProducts(allProducts || []);

    const currentSavedMcc = localStorage.getItem('autometrics_selected_mcc');
    if (currentSavedMcc && currentSavedMcc !== 'all') {
      const validMccs = new Set(
        (allProducts || []).map((p: any) => p.mcc_name?.trim() ? p.mcc_name : 'Contas Individuais')
      );
      if (!validMccs.has(currentSavedMcc)) {
        setSelectedMcc('all');
        localStorage.setItem('autometrics_selected_mcc', 'all');
      }
    }

    if (allProducts && allProducts.length > 0) {
      const productIds = allProducts.map(p => p.id);
      let allMetrics: any[] = [];

      let sixtyDaysAgoStr: string;
      if (fromDate) {
        sixtyDaysAgoStr = fromDate;
      } else {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        sixtyDaysAgoStr = getLocalYYYYMMDD(sixtyDaysAgo);
      }
      setFetchedFrom(sixtyDaysAgoStr);

      const chunkSize = 150;
      for (let i = 0; i < productIds.length; i += chunkSize) {
        const idChunk = productIds.slice(i, i + chunkSize);
        let page = 0;
        let hasMore = true;

        while (hasMore) {
          const { data: chunk, error } = await supabase
            .from('daily_metrics')
            .select('*')
            .in('product_id', idChunk)
            .gte('date', sixtyDaysAgoStr)
            .range(page * 1000, (page + 1) * 1000 - 1)
            .order('date', { ascending: false });

          if (error) { hasMore = false; }
          else if (chunk && chunk.length > 0) {
            allMetrics.push(...chunk);
            if (chunk.length < 1000) hasMore = false;
            else page++;
          } else { hasMore = false; }
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
  const handleDollarInputChange = (val: string) => {
    const cleanVal = val.replace(/[^0-9.,]/g, '');
    setDollarInput(cleanVal);
    const normalized = cleanVal.replace(',', '.');
    const parsed = parseFloat(normalized);
    if (!isNaN(parsed) && parsed > 0) {
      setManualDollar(parsed);
      localStorage.setItem('autometrics_manual_dollar', parsed.toString());
    }
  };
  const handleDollarInputBlur = () => setDollarInput(manualDollar.toFixed(2).replace('.', ','));
  const handleEuroInputChange = (val: string) => {
    const cleanVal = val.replace(/[^0-9.,]/g, '');
    setEuroInput(cleanVal);
    const normalized = cleanVal.replace(',', '.');
    const parsed = parseFloat(normalized);
    if (!isNaN(parsed) && parsed > 0) {
      setManualEuro(parsed);
      localStorage.setItem('autometrics_manual_euro', parsed.toString());
    }
  };
  const handleEuroInputBlur = () => setEuroInput(manualEuro.toFixed(2).replace('.', ','));
  const handleDollarStep = (amount: number) => {
    const newVal = Math.max(0, parseFloat((manualDollar + amount).toFixed(2)));
    setManualDollar(newVal);
    setDollarInput(newVal.toFixed(2).replace('.', ','));
    localStorage.setItem('autometrics_manual_dollar', newVal.toString());
  };
  const handleEuroStep = (amount: number) => {
    const newVal = Math.max(0, parseFloat((manualEuro + amount).toFixed(2)));
    setManualEuro(newVal);
    setEuroInput(newVal.toFixed(2).replace('.', ','));
    localStorage.setItem('autometrics_manual_euro', newVal.toString());
  };

  const handlePresetChange = (preset: string) => {
    setDateRange(preset);
    localStorage.setItem('autometrics_date_range', preset);
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (preset === 'today') { /* hoje */ }
    else if (preset === 'yesterday') { start.setDate(now.getDate() - 1); end.setDate(now.getDate() - 1); }
    else if (preset === '7d') { start.setDate(now.getDate() - 7); }
    else if (preset === '30d') { start.setDate(now.getDate() - 30); }
    else if (preset === 'this_month') { start = new Date(now.getFullYear(), now.getMonth(), 1); }
    else if (preset === 'last_month') { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); }

    const startStr = getLocalYYYYMMDD(start);
    const endStr = getLocalYYYYMMDD(end);
    setStartDate(startStr);
    setEndDate(endStr);
    localStorage.setItem('autometrics_start_date', startStr);
    localStorage.setItem('autometrics_end_date', endStr);
  };

  const handleCustomDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') {
      setStartDate(value);
      localStorage.setItem('autometrics_start_date', value);
      if (user && fetchedFrom && value < fetchedFrom) {
        setLoading(true);
        fetchInitialData(user.id, value).then(() => setLoading(false));
      }
    } else {
      setEndDate(value);
      localStorage.setItem('autometrics_end_date', value);
    }
    setDateRange('custom');
    localStorage.setItem('autometrics_date_range', 'custom');
  };

  const handleMccChange = (value: string) => {
    setSelectedMcc(value);
    localStorage.setItem('autometrics_selected_mcc', value);
  };

  const handleCurrencyChange = (currency: 'BRL' | 'USD' | 'EUR') => {
    setViewCurrency(currency);
    localStorage.setItem('autometrics_view_currency', currency);
    if (currency !== 'BRL') {
      setRateConfig(currency);
      localStorage.setItem('autometrics_rate_config', currency);
    }
  };

  const availableMccs = useMemo(() => {
    const mccs = new Set<string>();
    let hasIndividuals = false;
    products.forEach(p => {
      if (p.mcc_name && p.mcc_name.trim() !== '') mccs.add(p.mcc_name);
      else hasIndividuals = true;
    });
    const arr = Array.from(mccs).sort();
    if (hasIndividuals) arr.push('Contas Individuais');
    return arr;
  }, [products]);

  const processedData = useMemo(() => {
    if (loading || !metrics.length) return { chart: [], table: [], totals: null };

    const dailyMap = new Map();

    metrics.forEach(row => {
      if (row.date < startDate || row.date > endDate) return;

      const product = products.find(p => p.id === row.product_id);
      const mccName = product?.mcc_name?.trim() ? product.mcc_name : 'Contas Individuais';
      if (selectedMcc !== 'all' && mccName !== selectedMcc) return;

      const isUSD = product?.currency === 'USD';
      const isEUR = product?.currency === 'EUR';

      const accountName = row.account_name || product?.account_name || product?.mcc_name || 'Desconhecida';
      const campaignName = product?.name || 'Venda Externa';

      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0);
      let refunds = Number(row.refunds || 0);

      let costInBRL = cost;
      let revenueInBRL = revenue;
      let refundsInBRL = refunds;

      if (isUSD) { costInBRL *= liveDollar; revenueInBRL *= manualDollar; refundsInBRL *= manualDollar; }
      else if (isEUR) { costInBRL *= liveEuro; revenueInBRL *= manualEuro; refundsInBRL *= manualEuro; }

      if (viewCurrency === 'BRL') { cost = costInBRL; revenue = revenueInBRL; refunds = refundsInBRL; }
      else if (viewCurrency === 'USD') { cost = costInBRL / liveDollar; revenue = revenueInBRL / manualDollar; refunds = refundsInBRL / manualDollar; }
      else if (viewCurrency === 'EUR') { cost = costInBRL / liveEuro; revenue = revenueInBRL / manualEuro; refunds = refundsInBRL / manualEuro; }

      const profit = revenue - cost - refunds;

      if (!dailyMap.has(row.date)) {
        dailyMap.set(row.date, { date: row.date, cost: 0, revenue: 0, profit: 0, refunds: 0, accounts: {} });
      }
      const day = dailyMap.get(row.date);
      day.cost += cost; day.revenue += revenue; day.refunds += refunds; day.profit += profit;

      if (!day.accounts[accountName]) {
        day.accounts[accountName] = { name: accountName, cost: 0, revenue: 0, profit: 0, refunds: 0, campaigns: {} };
      }
      const acc = day.accounts[accountName];
      acc.cost += cost; acc.revenue += revenue; acc.profit += profit; acc.refunds += refunds;

      if (!acc.campaigns[campaignName]) {
        acc.campaigns[campaignName] = { name: campaignName, cost: 0, revenue: 0, profit: 0, refunds: 0, productId: product?.id };
      }
      const cmp = acc.campaigns[campaignName];
      cmp.cost += cost; cmp.revenue += revenue; cmp.profit += profit; cmp.refunds += refunds;
    });

    const resultRows = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    const totals = { cost: 0, revenue: 0, profit: 0, refunds: 0, roi: 0 };
    resultRows.forEach(r => {
      totals.cost += r.cost; totals.revenue += r.revenue; totals.profit += r.profit; totals.refunds += r.refunds;
      r.roi = r.cost > 0 ? (r.profit / r.cost) * 100 : 0;
    });
    totals.roi = totals.cost > 0 ? (totals.profit / totals.cost) * 100 : 0;

    const chartData = [...resultRows].sort((a, b) => a.date.localeCompare(b.date)).map(r => ({
      ...r, shortDate: r.date.split('-').slice(1).reverse().join('/')
    }));

    return { chart: chartData, table: resultRows, totals };
  }, [metrics, products, startDate, endDate, liveDollar, manualDollar, liveEuro, manualEuro, viewCurrency, loading, selectedMcc]);

  const sparklineData = useMemo(() => {
    const last7 = processedData.chart.slice(-7);
    return {
      revenue: last7.map((d: any) => d.revenue),
      cost: last7.map((d: any) => d.cost),
      profit: last7.map((d: any) => d.profit),
      roi: last7.map((d: any) => d.roi || 0),
      refunds: last7.map((d: any) => d.refunds),
    };
  }, [processedData.chart]);

  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : viewCurrency === 'EUR' ? 'de-DE' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);
  const toggleExpand = (id: string) => setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));

  if (!authChecked) return <div className="min-h-screen bg-black" />;
  if (loading) return <div className={`min-h-screen ${bgMain} flex items-center justify-center`}>Carregando dados...</div>;

  const mobileKpiCards = processedData.totals ? [
    { label: 'Receita', value: processedData.totals.revenue, color: '#3B82F6', data: sparklineData.revenue, isPositiveGood: true, isRoi: false },
    { label: 'Lucro', value: processedData.totals.profit, color: '#10B981', data: sparklineData.profit, isPositiveGood: true, isRoi: false },
    { label: 'Custo', value: processedData.totals.cost, color: '#F97316', data: sparklineData.cost, isPositiveGood: false, isRoi: false },
    { label: 'ROI', value: processedData.totals.roi, color: '#8B5CF6', data: sparklineData.roi, isPositiveGood: true, isRoi: true },
    { label: 'Reembolsos', value: processedData.totals.refunds, color: '#F43F5E', data: sparklineData.refunds, isPositiveGood: false, isRoi: false },
  ] : [];

  return (
    <div className={`min-h-screen font-sans flex ${bgMain}`}>

      {/* ─── DESKTOP SIDEBAR (hidden on mobile) ─── */}
      <aside className={`hidden md:flex md:w-64 shrink-0 border-r flex-col sticky top-0 h-screen z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        <div className="h-20 flex items-center justify-start px-6 border-b border-inherit overflow-hidden shrink-0">
          <div className="relative">
            <Image
              src="/logo.png" alt="Logo" width={180} height={60}
              className={`w-[180px] h-auto object-contain object-left ${!isDark ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : ''}`}
              priority
            />
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-2">
          <Link href="/dashboard" className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
            <LayoutGrid size={20} /> <span className="font-medium">Dashboard</span>
          </Link>
          <Link href="/planning" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}>
            <Target size={20} /> <span className="font-medium">Planejamento</span>
          </Link>
          <Link href="/products" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}>
            <Package size={20} /> <span className="font-medium">Meus Produtos</span>
          </Link>
          <Link href="/integration" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}>
            <Settings size={20} /> <span className="font-medium">Integração</span>
          </Link>
        </nav>
        <div className="p-4 border-t border-inherit">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-rose-500 hover:bg-rose-500/10">
            <LogOut size={20} /> <span className="font-medium">Sair ({user?.email?.split('@')[0]})</span>
          </button>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto pb-24 md:pb-8">

        {/* ── DESKTOP HEADER & FILTERS (hidden on mobile) ── */}
        <header className="hidden md:flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
          <div className="flex justify-between items-center w-full xl:w-auto">
            <div>
              <h1 className={`text-2xl font-bold ${textHead}`}>Visão Geral</h1>
              <p className={textMuted}>Acompanhe seus resultados consolidados.</p>
            </div>
            <button onClick={toggleTheme} className={`xl:hidden p-2 rounded-lg border ${bgCard} ${textMuted}`}>
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-stretch sm:items-center w-full xl:w-auto">
            <div className="flex flex-col sm:flex-row flex-wrap gap-4 w-full sm:w-auto">
              {availableMccs.length > 0 && (
                <div className={`flex items-center p-2 sm:p-1.5 rounded-xl border ${bgCard} shadow-sm w-full sm:w-auto`}>
                  <div className="flex items-center gap-2 px-2 w-full">
                    <Target size={18} className={isDark ? "text-white" : "text-indigo-600"}/>
                    <select
                      className={`bg-transparent text-sm font-bold outline-none cursor-pointer flex-1 sm:w-32 ${textHead}`}
                      value={selectedMcc}
                      onChange={(e) => handleMccChange(e.target.value)}
                    >
                      <option value="all">Visão Geral (Todas)</option>
                      {availableMccs.map(mcc => <option key={mcc} value={mcc}>{mcc}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className={`flex flex-col sm:flex-row items-stretch sm:items-center p-2 sm:p-1.5 rounded-xl border ${bgCard} shadow-sm w-full sm:w-auto gap-2 sm:gap-0`}>
                <div className="flex items-center justify-between sm:justify-start gap-2 px-2 pb-2 sm:pb-0 sm:border-r border-b sm:border-b-0 border-inherit">
                  <div className="flex items-center gap-2">
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

            <div className={`flex flex-col xl:flex-row items-stretch xl:items-center gap-4 p-3 rounded-2xl border ${bgCard} w-full xl:w-auto shadow-md`}>
              <div className="flex flex-col gap-1.5 flex-1 sm:min-w-[140px]">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Moeda de Exibição</span>
                <div className={`flex items-center p-1 rounded-xl ${isDark ? 'bg-black/60' : 'bg-slate-100'} h-10`}>
                  {(['BRL', 'USD', 'EUR'] as const).map(curr => (
                    <button key={curr} type="button" onClick={() => handleCurrencyChange(curr)}
                      className={`flex-1 h-8 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${viewCurrency === curr ? (isDark ? 'bg-slate-800 text-white shadow' : 'bg-white text-indigo-600 shadow') : 'text-slate-400 hover:text-slate-200'}`}>
                      <span>{curr === 'BRL' ? 'R$' : curr === 'USD' ? '$' : '€'}</span>
                      <span className="hidden sm:inline text-[9px] opacity-60 font-medium">{curr}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={`hidden xl:block h-10 w-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />

              <div className="flex flex-col sm:flex-row gap-3 flex-1 sm:flex-none">
                {rateConfig === 'USD' && (
                  <div className={`flex items-center justify-between gap-3 p-2 rounded-xl border ${isDark ? 'border-slate-800 bg-black/20' : 'border-slate-100 bg-slate-50/50'} flex-1 sm:flex-none sm:min-w-[155px]`}>
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-orange-500 uppercase tracking-wider">Dólar Hoje</span>
                      <span className="text-xs font-mono font-bold text-orange-400">R$ {liveDollar.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Meu Dólar</span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] text-slate-500 font-bold">R$</span>
                        <input type="text" inputMode="decimal"
                          className={`w-14 text-right bg-transparent text-xs font-mono font-bold outline-none border-b focus:border-indigo-500 transition-colors pb-0.5 ${isDark ? 'border-slate-700 text-white' : 'border-slate-300 text-black'}`}
                          value={dollarInput} onChange={(e) => handleDollarInputChange(e.target.value)} onBlur={handleDollarInputBlur}
                        />
                        <div className="flex flex-col gap-0.5 ml-0.5">
                          <button type="button" onClick={() => handleDollarStep(0.01)} className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-indigo-500"><ChevronUp size={12} /></button>
                          <button type="button" onClick={() => handleDollarStep(-0.01)} className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-indigo-500"><ChevronDown size={12} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {rateConfig === 'EUR' && (
                  <div className={`flex items-center justify-between gap-3 p-2 rounded-xl border ${isDark ? 'border-slate-800 bg-black/20' : 'border-slate-100 bg-slate-50/50'} flex-1 sm:flex-none sm:min-w-[155px]`}>
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-orange-500 uppercase tracking-wider">Euro Hoje</span>
                      <span className="text-xs font-mono font-bold text-orange-400">R$ {liveEuro.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Meu Euro</span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] text-slate-500 font-bold">R$</span>
                        <input type="text" inputMode="decimal"
                          className={`w-14 text-right bg-transparent text-xs font-mono font-bold outline-none border-b focus:border-indigo-500 transition-colors pb-0.5 ${isDark ? 'border-slate-700 text-white' : 'border-slate-300 text-black'}`}
                          value={euroInput} onChange={(e) => handleEuroInputChange(e.target.value)} onBlur={handleEuroInputBlur}
                        />
                        <div className="flex flex-col gap-0.5 ml-0.5">
                          <button type="button" onClick={() => handleEuroStep(0.01)} className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-indigo-500"><ChevronUp size={12} /></button>
                          <button type="button" onClick={() => handleEuroStep(-0.01)} className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-indigo-500"><ChevronDown size={12} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button type="button" onClick={toggleTheme}
                className={`hidden xl:flex items-center justify-center w-10 h-10 rounded-xl border ${isDark ? 'border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:text-black hover:bg-slate-100'} transition-all`}>
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </div>
        </header>

        {/* ── MOBILE HEADER (hidden on desktop) ── */}
        <div className="flex md:hidden items-center justify-between px-1 pt-1 pb-3">
          <div>
            <h1 className={`text-xl font-bold leading-tight ${textHead}`}>Visão Geral</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {dateRange !== 'custom'
                ? DATE_PRESET_LABELS[dateRange] ?? 'Período personalizado'
                : `${startDate ? startDate.split('-').reverse().join('/') : '—'} → ${endDate ? endDate.split('-').reverse().join('/') : '—'}`
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme}
              className={`w-9 h-9 flex items-center justify-center rounded-xl border ${bgCard} ${textMuted}`}>
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button onClick={() => setShowFilterSheet(true)}
              className={`w-9 h-9 flex items-center justify-center rounded-xl border ${isDark ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400' : 'bg-indigo-50 border-indigo-200 text-indigo-600'}`}>
              <SlidersHorizontal size={15} />
            </button>
          </div>
        </div>

        {/* ── MOBILE DATE CHIPS (hidden on desktop) ── */}
        <div className="flex md:hidden gap-2 px-1 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          {DATE_PRESETS.map(preset => (
            <button
              key={preset}
              onClick={() => handlePresetChange(preset)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                dateRange === preset
                  ? 'bg-indigo-600 text-white'
                  : isDark ? 'bg-slate-900 text-slate-400 border border-slate-800' : 'bg-white text-slate-500 border border-slate-200'
              }`}
            >
              {DATE_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>

        {/* ── MOBILE KPI CAROUSEL (hidden on desktop) ── */}
        {processedData.totals && (
          <div className="flex md:hidden gap-3 px-1 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            {mobileKpiCards.map(({ label, value, color, data, isPositiveGood, isRoi }) => {
              const trend = trendPct(data);
              const trendUp = trend >= 0;
              const trendGood = isPositiveGood ? trendUp : !trendUp;
              return (
                <div key={label} className={`flex-shrink-0 w-[130px] border rounded-2xl p-3 relative overflow-hidden ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: color }} />
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{label}</div>
                  <div className="text-sm font-bold font-mono leading-tight mb-1" style={{ color }}>
                    {isRoi ? `${value.toFixed(1)}%` : formatMoney(value)}
                  </div>
                  {data.length >= 2 && (
                    <div className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded mb-1.5 ${
                      trendGood ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                    }`}>
                      {trendUp ? '↑' : '↓'} {Math.abs(trend).toFixed(0)}%
                    </div>
                  )}
                  <SparklineSVG data={data} color={color} />
                </div>
              );
            })}
          </div>
        )}

        {/* ── DESKTOP KPI GRID (hidden on mobile) ── */}
        {processedData.totals ? (
          <div className="hidden md:grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
            <div className={`${bgCard} border-t-4 border-t-blue-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Receita Total</p><p className="text-2xl font-bold text-blue-500">{formatMoney(processedData.totals.revenue)}</p></div>
            <div className={`${bgCard} border-t-4 border-t-orange-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Custos Totais</p><p className="text-2xl font-bold text-orange-500">{formatMoney(processedData.totals.cost)}</p></div>
            <div className={`${bgCard} border-t-4 ${processedData.totals.profit >= 0 ? 'border-t-emerald-500' : 'border-t-rose-500'} p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Lucro Líquido</p><p className={`text-2xl font-bold ${processedData.totals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(processedData.totals.profit)}</p></div>
            <div className={`${bgCard} border-t-4 border-t-indigo-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">ROI</p><p className="text-2xl font-bold text-indigo-500">{processedData.totals.roi.toFixed(1)}%</p></div>
            <div className={`${bgCard} border-t-4 border-t-rose-500 p-5 rounded-xl shadow-sm`}><p className="text-xs font-bold text-slate-500 uppercase mb-2">Reembolsos</p><p className="text-2xl font-bold text-rose-500">{formatMoney(processedData.totals.refunds)}</p></div>
          </div>
        ) : (
          <div className="hidden md:block text-center py-20 bg-slate-900/20 rounded-xl mb-8 border border-dashed border-slate-800">
            <p className="text-slate-500">Nenhum dado encontrado.</p>
          </div>
        )}

        {/* ── BAR CHART (shared, height adjusts per breakpoint) ── */}
        <div className={`${bgCard} rounded-xl p-4 md:p-6 mb-4 md:mb-8 border shadow-sm`} style={{ height: '13rem' }}>
          <div className="md:hidden text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Receita vs Custo</div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={processedData.chart}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
              <XAxis dataKey="shortDate" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} hide={true} />
              <Tooltip contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0', color: isDark ? '#fff' : '#000', fontSize: 12 }} formatter={(val: any) => formatMoney(val)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={32} />
              <Bar dataKey="cost" name="Custo" fill="#f97316" radius={[3, 3, 0, 0]} maxBarSize={32} />
              <Bar dataKey="profit" name="Lucro" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── DESKTOP TABLE (hidden on mobile) ── */}
        <div className={`hidden md:block ${bgCard} rounded-xl overflow-hidden shadow-sm border border-inherit`}>
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
                                <Package size={10}/>
                                {cmp.productId ? (
                                  <Link href={`/products/${cmp.productId}`} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-400 hover:underline transition-colors cursor-pointer">
                                    {cmp.name}
                                  </Link>
                                ) : cmp.name}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── MOBILE DAY ROWS (hidden on desktop) ── */}
        <div className="md:hidden">
          {processedData.table.length === 0 ? (
            <div className={`text-center py-10 rounded-2xl border border-dashed ${borderCol}`}>
              <p className="text-slate-500 text-sm">Nenhum dado encontrado.</p>
            </div>
          ) : (
            <>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 px-1">
                Detalhes por Dia
              </div>
              <div className={`rounded-2xl overflow-hidden border ${borderCol}`}>
                {processedData.table.map((row: any) => {
                  const dp = row.date.split('-');
                  const fmt = `${dp[2]}/${dp[1]}`;
                  const isExpanded = expandedRows[row.date];
                  return (
                    <React.Fragment key={row.date}>
                      <div
                        onClick={() => toggleExpand(row.date)}
                        className={`flex items-center justify-between px-4 py-3 border-b ${borderCol} cursor-pointer transition-colors ${
                          isDark ? 'active:bg-slate-800/70' : 'active:bg-slate-50'
                        } ${isExpanded ? (isDark ? 'bg-slate-900' : 'bg-slate-50') : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`text-[10px] w-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                            {Object.keys(row.accounts).length > 0 ? '›' : ''}
                          </div>
                          <div>
                            <div className={`text-sm font-bold ${textHead}`}>{fmt}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{formatMoney(row.cost)} custo</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-blue-500 font-mono">{formatMoney(row.revenue)}</div>
                          <div className={`text-[10px] font-bold ${row.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {row.profit >= 0 ? '↑' : '↓'} ROI {row.roi?.toFixed(0)}%
                          </div>
                        </div>
                      </div>

                      {isExpanded && Object.values(row.accounts).map((acc: any) => (
                        <React.Fragment key={acc.name}>
                          <div className={`flex items-center justify-between px-5 py-2 border-b ${borderCol} ${isDark ? 'bg-slate-950/60' : 'bg-indigo-50/60'}`}>
                            <span className="text-xs font-bold text-indigo-400 truncate max-w-[170px]">{acc.name}</span>
                            <span className="text-xs font-mono text-blue-400 ml-2 shrink-0">{formatMoney(acc.revenue)}</span>
                          </div>
                          {Object.values(acc.campaigns).map((cmp: any) => (
                            <div key={cmp.name} className={`flex items-center justify-between px-6 py-2 border-b ${borderCol} ${isDark ? 'bg-slate-950/40' : 'bg-slate-50/60'}`}>
                              <span className="text-[11px] text-slate-500 truncate max-w-[170px]">
                                {cmp.productId ? (
                                  <Link href={`/products/${cmp.productId}`} className="hover:text-indigo-400 active:text-indigo-400">
                                    {cmp.name}
                                  </Link>
                                ) : cmp.name}
                              </span>
                              <span className={`text-[11px] font-bold font-mono ml-2 shrink-0 ${cmp.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {formatMoney(cmp.profit)}
                              </span>
                            </div>
                          ))}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  );
                })}
              </div>
            </>
          )}
        </div>

      </main>

      {/* ─── MOBILE BOTTOM NAVIGATION ─── */}
      <nav className={`fixed bottom-0 inset-x-0 md:hidden z-40 border-t backdrop-blur-md ${isDark ? 'bg-slate-950/95 border-slate-900' : 'bg-white/95 border-slate-200'}`}>
        <div className="flex justify-around items-center px-2 pt-2 pb-5">
          {[
            { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', active: true },
            { href: '/planning', Icon: Target, label: 'Planejamento', active: false },
            { href: '/products', Icon: Package, label: 'Produtos', active: false },
            { href: '/integration', Icon: Settings, label: 'Integração', active: false },
          ].map(({ href, Icon, label, active }) => (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-xl transition-colors ${
                active ? 'text-indigo-500' : isDark ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              <Icon size={22} />
              <span className="text-[9px] font-bold tracking-wide">{label}</span>
              {active && <div className="w-1 h-1 rounded-full bg-indigo-500" />}
            </Link>
          ))}
        </div>
      </nav>

      {/* ─── FILTER BOTTOM SHEET (Concept 04) ─── */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-opacity duration-300 ${showFilterSheet ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowFilterSheet(false)}
        />
        {/* Sheet panel */}
        <div className={`absolute bottom-0 inset-x-0 rounded-t-3xl border-t transition-transform duration-300 ease-out ${
          showFilterSheet ? 'translate-y-0' : 'translate-y-full'
        } ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'}`}>

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className={`w-10 h-1 rounded-full ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />
          </div>

          {/* Close button */}
          <div className="flex items-center justify-between px-5 pb-3">
            <h3 className={`text-base font-bold ${textHead}`}>Filtros</h3>
            <button onClick={() => setShowFilterSheet(false)}
              className={`w-8 h-8 flex items-center justify-center rounded-xl ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
              <X size={15} />
            </button>
          </div>

          <div className="px-5 pb-8 max-h-[80vh] overflow-y-auto" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>

            {/* Period */}
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Período</div>
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map(preset => (
                  <button key={preset} onClick={() => handlePresetChange(preset)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      dateRange === preset
                        ? 'bg-indigo-600 text-white'
                        : isDark ? 'bg-slate-900 text-slate-400 border border-slate-800' : 'bg-slate-100 text-slate-500'
                    }`}>
                    {DATE_PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom dates */}
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Datas Personalizadas</div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="text-[10px] text-slate-500 mb-1 font-medium">De</div>
                  <input type="date" value={startDate}
                    onChange={e => handleCustomDateChange('start', e.target.value)}
                    className={`w-full text-sm rounded-xl border px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors ${isDark ? 'bg-slate-900 border-slate-700 text-white [&::-webkit-calendar-picker-indicator]:invert' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] text-slate-500 mb-1 font-medium">Até</div>
                  <input type="date" value={endDate}
                    onChange={e => handleCustomDateChange('end', e.target.value)}
                    className={`w-full text-sm rounded-xl border px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors ${isDark ? 'bg-slate-900 border-slate-700 text-white [&::-webkit-calendar-picker-indicator]:invert' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                  />
                </div>
              </div>
            </div>

            {/* MCC */}
            {availableMccs.length > 0 && (
              <div className="mb-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">MCC / Conta</div>
                <select value={selectedMcc} onChange={e => handleMccChange(e.target.value)}
                  className={`w-full text-sm rounded-xl border px-3 py-2.5 outline-none ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
                  <option value="all">Visão Geral (Todas)</option>
                  {availableMccs.map(mcc => <option key={mcc} value={mcc}>{mcc}</option>)}
                </select>
              </div>
            )}

            {/* Currency */}
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Moeda de Exibição</div>
              <div className={`flex p-1 rounded-xl ${isDark ? 'bg-black/60' : 'bg-slate-100'}`}>
                {(['BRL', 'USD', 'EUR'] as const).map(curr => (
                  <button key={curr} onClick={() => handleCurrencyChange(curr)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      viewCurrency === curr
                        ? isDark ? 'bg-slate-800 text-white shadow' : 'bg-white text-indigo-600 shadow'
                        : 'text-slate-400'
                    }`}>
                    {curr === 'BRL' ? 'R$ BRL' : curr === 'USD' ? '$ USD' : '€ EUR'}
                  </button>
                ))}
              </div>
            </div>

            {/* Exchange rate */}
            {viewCurrency !== 'BRL' && (
              <div className="mb-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
                  Câmbio Manual — {rateConfig}
                </div>
                <div className={`flex items-center justify-between p-3.5 rounded-xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div>
                    <div className="text-[9px] font-bold text-orange-500 uppercase tracking-wider mb-1">Cotação Hoje</div>
                    <div className="text-sm font-bold text-orange-400 font-mono">
                      R$ {(rateConfig === 'USD' ? liveDollar : liveEuro).toFixed(2).replace('.', ',')}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="text-[9px] font-bold text-blue-500 uppercase tracking-wider mb-1">Meu Câmbio</div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-500 font-bold">R$</span>
                        <input type="text" inputMode="decimal"
                          value={rateConfig === 'USD' ? dollarInput : euroInput}
                          onChange={e => rateConfig === 'USD' ? handleDollarInputChange(e.target.value) : handleEuroInputChange(e.target.value)}
                          onBlur={rateConfig === 'USD' ? handleDollarInputBlur : handleEuroInputBlur}
                          className={`w-16 text-right bg-transparent text-sm font-mono font-bold outline-none border-b transition-colors ${isDark ? 'border-slate-700 text-white focus:border-indigo-500' : 'border-slate-300 text-black focus:border-indigo-500'}`}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => rateConfig === 'USD' ? handleDollarStep(0.01) : handleEuroStep(0.01)}
                        className={`w-9 h-9 flex items-center justify-center rounded-xl ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'} transition-colors`}>
                        <ChevronUp size={15} />
                      </button>
                      <button onClick={() => rateConfig === 'USD' ? handleDollarStep(-0.01) : handleEuroStep(-0.01)}
                        className={`w-9 h-9 flex items-center justify-center rounded-xl ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'} transition-colors`}>
                        <ChevronDown size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Apply */}
            <button
              onClick={() => setShowFilterSheet(false)}
              className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold py-4 rounded-2xl text-sm transition-colors"
            >
              Aplicar Filtros
            </button>
          </div>
        </div>
      </div>

      <SaleAlertNotification products={products} isDark={isDark} />
    </div>
  );
}
