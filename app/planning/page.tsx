"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Target, TrendingUp, Calendar as CalIcon, Edit2, Plus, Trash2,
  Sun, Moon, ChevronDown, ChevronRight, Save, DollarSign, AlertCircle,
  Briefcase, Globe, LayoutGrid, LogOut, Package, FileText, Settings, ArrowLeft,
  Calendar, ChevronUp, SlidersHorizontal, X, Sparkles, Route
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import { useDayInput, isValidDay, safeDay } from '@/lib/useDayInput';
import { Logo } from '@/app/components/Logo';
import { LootrushPanel } from './LootrushPanel';
import { useLiveMetrics } from '@/lib/useLiveMetrics';
import { useTablePrefs } from '@/app/components/table/useTablePrefs';
import { cellPad, TableControls, Th, widthStyle } from '@/app/components/table/tableUi';
import { Inter } from 'next/font/google';

// Fonte do guia visual (DESIGN.md), nas telas já migradas.
const inter = Inter({ subsets: ['latin'], display: 'swap' });

// Configuração Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DATE_PRESET_LABELS: Record<string, string> = {
  today: 'Hoje', yesterday: 'Ontem', '7d': '7 dias',
  this_month: 'Este mês', '30d': '30 dias', last_month: 'Mês passado',
};
const DATE_PRESETS = ['today', 'yesterday', '7d', 'this_month', '30d', 'last_month'] as const;

/** Porcentagem no formato brasileiro: "12,5%", "1.200%"; com sinal, "+3,2%". */
function fmtPct(val: number, digits = 0, signed = false) {
  return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: signed ? 'exceptZero' : 'auto' }).format((val || 0) / 100);
}
/** Número com vírgula, com ou sem sinal ("+3,2"). */
function fmtNum(val: number, digits = 1, signed = false) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: signed ? 'exceptZero' : 'auto' }).format(val || 0);
}
/** "2026-10-01" → "01/10/2026". */
function fmtDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)) : day;
}

/** Contorno de foco para controles que tiram o contorno padrão. */
const FOCUS_RING = 'rounded-md focus-visible:ring-2 focus-visible:ring-brand';

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
  const gradId = `spg${color.replace(/[^a-z0-9]/gi, '')}`;
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

function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function PlanningPage() {
  // Larguras e densidade da tabela do DRE ficam salvas no usuário.
  const drePrefs = useTablePrefs('planning_dre');
  const router = useRouter();
  const { authChecked } = useAuthGuard();
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
  // Aba da tela: as metas ou os cartões (LootRush), que só aparece para quem ligou em Integração.
  const [view, setView] = useState<'metas' | 'cartoes'>('metas');
  const [hasCards, setHasCards] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    supabase.auth.getSession().then(({ data: { session } }) => fetch('/api/lootrush', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } }))
      .then(r => r.json()).then(b => setHasCards(!!b?.connected && !!b.groups?.length)).catch(() => {});
  }, [user]);

  const [dateRange, setDateRange] = useState('this_month'); 
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // Venda nova (ou custo novo) entra sozinha, sem recarregar: só as linhas de ontem e de hoje que mudaram, dentro do período da tela.
  const liveProducts = useMemo(() => new Set(products.map(p => p.id)), [products]);
  useLiveMetrics(supabase, !!user?.id && !loading, setMetrics, { accept: row => liveProducts.has(row.product_id) && row.date >= startDate && row.date <= endDate });
  // -----------------------------

  // UI
  const [selectedMcc, setSelectedMcc] = useState<string>('all');
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false); 
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  // Ao abrir os filtros, o foco vai para dentro do painel (botão de fechar).
  const filterCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (showFilterSheet) filterCloseRef.current?.focus(); }, [showFilterSheet]);

  // Moeda & Tema
  const [liveDollar, setLiveDollar] = useState(6.00);
  const [manualDollar, setManualDollar] = useState(5.60);
  const [liveEuro, setLiveEuro] = useState(6.50);
  const [manualEuro, setManualEuro] = useState(6.00);
  const [viewCurrency, setViewCurrency] = useState<'BRL' | 'USD' | 'EUR'>('BRL');
  const [rateConfig, setRateConfig] = useState<'USD' | 'EUR'>('USD');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [dollarInput, setDollarInput] = useState("5,60");
  const [euroInput, setEuroInput] = useState("6,00");

  const [tempGoal, setTempGoal] = useState({ revenue: 0, profit: 0, limit: 0 });
  const [profitType, setProfitType] = useState<'value' | 'percentage'>('value');
  const [profitInput, setProfitInput] = useState<number>(0);
  const [goalCurrency, setGoalCurrency] = useState<'BRL' | 'USD' | 'EUR'>('BRL');

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

      // 3. Preferências
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) { setTheme(savedTheme); }
    applyTheme(savedTheme || 'dark');
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

      const savedGoalCurrency = localStorage.getItem('autometrics_goal_currency') as 'BRL' | 'USD' | 'EUR';
      if (savedGoalCurrency && ['BRL', 'USD', 'EUR'].includes(savedGoalCurrency)) setGoalCurrency(savedGoalCurrency);

      const savedDateRange = localStorage.getItem('autometrics_date_range');
      if (savedDateRange) {
        if (savedDateRange === 'custom') {
          setDateRange('custom');
          const savedStart = localStorage.getItem('autometrics_start_date');
          const savedEnd = localStorage.getItem('autometrics_end_date');
          if (isValidDay(savedStart)) setStartDate(savedStart!);
          if (isValidDay(savedEnd)) setEndDate(savedEnd!);
        } else {
          handlePresetChange(savedDateRange);
        }
      } else {
        handlePresetChange('this_month');
      }

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
    applyTheme(newTheme);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

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

  const handleDollarInputBlur = () => {
    setDollarInput(manualDollar.toFixed(2).replace('.', ','));
  };

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

  const handleEuroInputBlur = () => {
    setEuroInput(manualEuro.toFixed(2).replace('.', ','));
  };

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
    else if (preset === 'custom') return;

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
    } else {
      setEndDate(value);
      localStorage.setItem('autometrics_end_date', value);
    }
    setDateRange('custom');
    localStorage.setItem('autometrics_date_range', 'custom');
  };

  // Os campos de data guardam o que está sendo digitado; a tela só recebe a
  // data quando ela está completa (ver lib/useDayInput).
  const startInput = useDayInput(startDate, v => handleCustomDateChange('start', v));
  const endInput = useDayInput(endDate, v => handleCustomDateChange('end', v));

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

  async function fetchData(userId: string) {
    setLoading(true);
    
    // Metas: Busca pela chave do mês de INÍCIO
    const currentMonthKey = startDate.slice(0, 7);
    const { data: goalData } = await supabase.from('financial_goals').select('*').eq('user_id', userId).eq('month_key', currentMonthKey).maybeSingle();
    if (goalData) {
      setGoal({ revenue: goalData.revenue_target, profit: goalData.profit_target, limit: goalData.ad_spend_limit });
      
      let tbRev = goalData.revenue_target;
      let tbProf = goalData.profit_target;
      let tbLim = goalData.ad_spend_limit;
      // Reverse calc for modal state if user had a foreign goal currency selected previously
      // Note: we use current manual rates as approximations to populate the input
      if (goalCurrency === 'USD') { tbRev /= manualDollar; tbProf /= manualDollar; tbLim /= manualDollar; }
      else if (goalCurrency === 'EUR') { tbRev /= manualEuro; tbProf /= manualEuro; tbLim /= manualEuro; }
      
      setTempGoal({ revenue: tbRev, profit: tbProf, limit: tbLim });
      setProfitInput(parseFloat(tbProf.toFixed(2)));
      setProfitType('value');
    } else {
      setGoal({ revenue: 0, profit: 0, limit: 0 });
      setTempGoal({ revenue: 0, profit: 0, limit: 0 });
      setProfitInput(0);
      setProfitType('value');
    }

    const { data: costData } = await supabase.from('additional_costs').select('*').eq('user_id', userId).gte('date', startDate).lte('date', endDate);
    setExtraCosts(costData || []);

    let allProducts: any[] = [];
    let p_prod = 0;
    let m_prod = true;
    while (m_prod) {
      const { data } = await supabase
        .from('products')
        .select('id, currency, name, mcc_name, account_name')
        .eq('user_id', userId)
        .range(p_prod * 1000, (p_prod + 1) * 1000 - 1);
        
      if (data && data.length > 0) {
        allProducts.push(...data);
        if (data.length < 1000) m_prod = false;
        else p_prod++;
      } else {
        m_prod = false;
      }
    }
    const prodData = allProducts;
    setProducts(prodData || []);
    
    // Cálculo do período anterior para Comparativo Progressivo
    const hojeISO = getLocalYYYYMMDD(new Date());
    const sDate = new Date(safeDay(startDate, hojeISO) + "T00:00:00");
    const eDate = new Date(safeDay(endDate, hojeISO) + "T23:59:59");
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
          let res: any[] = [];
          const productIds = prodData.map(pr => pr.id);
          const chunkSize = 150;
          for (let i = 0; i < productIds.length; i += chunkSize) {
              const idChunk = productIds.slice(i, i + chunkSize);
              let p = 0;
              let m = true;
              while(m) {
                 const { data: c } = await supabase.from('daily_metrics').select('*').in('product_id', idChunk).gte('date', s).lte('date', e).range(p*1000, (p+1)*1000-1);
                 if (c && c.length > 0) { res.push(...c); if (c.length < 1000) m = false; else p++; } else m = false;
              }
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

      if (!dailyMap[m.date]) dailyMap[m.date] = { date: m.date, revenue: 0, ads_cost: 0, refunds: 0, extra_cost: 0, extra_revenue: 0, net_extra: 0, details: [], mccs: {} };
      const day = dailyMap[m.date];
      day.revenue += revenue; day.ads_cost += cost; day.refunds += refunds;

      if (!day.mccs[mcc]) day.mccs[mcc] = { name: mcc, revenue: 0, ads_cost: 0, refunds: 0, accounts: {} };
      const mccObj = day.mccs[mcc]; mccObj.revenue += revenue; mccObj.ads_cost += cost; mccObj.refunds += refunds;

      if (!mccObj.accounts[account]) mccObj.accounts[account] = { name: account, revenue: 0, ads_cost: 0, refunds: 0, campaigns: {} };
      const accObj = mccObj.accounts[account]; accObj.revenue += revenue; accObj.ads_cost += cost; accObj.refunds += refunds;

      const campaignName = prod?.name || 'Venda Externa';
      if (!accObj.campaigns[campaignName]) accObj.campaigns[campaignName] = { name: campaignName, revenue: 0, ads_cost: 0, refunds: 0 };
      const cmpObj = accObj.campaigns[campaignName];
      cmpObj.revenue += revenue; cmpObj.ads_cost += cost; cmpObj.refunds += refunds;

      // Map para o Widget de Top Campanhas
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
    
    let finalGoal = { ...goal };
    if (viewCurrency === 'USD') {
      finalGoal.revenue /= manualDollar;
      finalGoal.profit /= manualDollar;
      finalGoal.limit /= manualDollar;
    } else if (viewCurrency === 'EUR') {
      finalGoal.revenue /= manualEuro;
      finalGoal.profit /= manualEuro;
      finalGoal.limit /= manualEuro;
    }

    // Cálculos de Dias para Média (Diluição no período selecionado)
    const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const sDate = new Date(safeDay(startDate, getLocalYYYYMMDD(today)) + "T00:00:00");
    const eDate = new Date(safeDay(endDate, getLocalYYYYMMDD(today)) + "T00:00:00");
    const maxEndDate = eDate > todayNorm ? todayNorm : eDate;
    let timeDiff = maxEndDate.getTime() - sDate.getTime();
    let selectedDaysCount = Math.floor(timeDiff / (1000 * 60 * 60 * 24)) + 1;
    if (selectedDaysCount < 1) selectedDaysCount = 1;

    const projectedRevenue = isCurrentMonth ? (totals.revenue / selectedDaysCount) * daysInMonth : totals.revenue;
    const revenueProgress = finalGoal.revenue > 0 ? (totals.revenue / finalGoal.revenue) * 100 : 0;

    // Daily pacing metrics
    const dailyTargetRevenue = finalGoal.revenue / daysInMonth;
    const currentDailyRevenue = totals.revenue / selectedDaysCount;
    const revenuePacing = currentDailyRevenue - dailyTargetRevenue;

    const dailyTargetProfit = finalGoal.profit / daysInMonth;
    const currentDailyProfit = totals.profit / selectedDaysCount;
    const profitPacing = currentDailyProfit - dailyTargetProfit;
    const isProfitSafe = currentDailyProfit >= dailyTargetProfit && finalGoal.profit > 0;

    let accRev = 0;
    const chartData = [...daysArray].sort((a: any, b: any) => a.date.localeCompare(b.date)).map((d: any) => {
       accRev += d.revenue;
       return { date: d.date.split('-')[2], revenue: accRev, ideal: (finalGoal.revenue / daysInMonth) * parseInt(d.date.split('-')[2]) };
    });

    // Cálculos Estratégicos (Break-even e Top Campanhas)
    // Ponto de equilíbrio em ROI dos anúncios (sem os custos extras): para o lucro
    // ficar em zero, o que os anúncios deixam precisa pagar os extras.
    // Mínimo = extras ÷ custo dos anúncios; atual = (receita + receitas extras
    // − reembolsos − custo dos anúncios) ÷ custo dos anúncios. Atual ≥ mínimo
    // é o mesmo que lucro ≥ 0. (Antes comparava o ROI já com os extras
    // descontados contra este mínimo, contando os extras duas vezes.)
    const breakEvenRoi = totals.ads_cost > 0 ? (totals.extra_cost / totals.ads_cost) * 100 : 0;
    const adsRoi = totals.ads_cost > 0 ? ((totals.revenue + totals.extra_revenue - totals.refunds - totals.ads_cost) / totals.ads_cost) * 100 : 0;
    
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
    const avgRoi = activeCampaigns.length > 0 ? activeCampaigns.reduce((s, c) => s + c.roi, 0) / activeCampaigns.length : 0;
    // bottomCampaigns: all campaigns that either have negative profit OR ROI significantly below the average
    const bottomCampaigns = activeCampaigns
       .filter(c => c.profit < 0 || c.roi < 0 || (avgRoi > 0 && c.roi < avgRoi * 0.5 && c.cost > 0))
       .sort((a, b) => a.roi - b.roi)
       .map(c => ({
          ...c,
          spendShare: totals.ads_cost > 0 ? (c.cost / totals.ads_cost) * 100 : 0,
          avgRoi
       }));

    return { daysArray, totals, variations, chartData, projectedRevenue, revenueProgress, breakEvenRoi, adsRoi, topCampaigns, bottomCampaigns, isCurrentMonth, daysPassed, daysInMonth, dailyTargetRevenue, currentDailyRevenue, revenuePacing, dailyTargetProfit, currentDailyProfit, profitPacing, isProfitSafe, finalGoal };
  }, [metrics, prevMetrics, extraCosts, prevExtraCosts, products, viewCurrency, liveDollar, manualDollar, liveEuro, manualEuro, goal, startDate, endDate, selectedMcc]);

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : viewCurrency === 'EUR' ? 'de-DE' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);
  const toggleExpand = (id: string) => { setExpandedRows(prev => ({ ...prev, [id]: !prev[id] })); };

  const handleSaveGoal = async () => {
    const userId = user?.id;
    if (!userId) return;
    const currentMonthKey = startDate.slice(0, 7);
    
    let tr = tempGoal.revenue;
    let finalProfit = profitType === 'percentage' ? tr * (profitInput / 100) : profitInput;
    let tl = tempGoal.limit;

    if (goalCurrency === 'USD') { tr *= manualDollar; finalProfit *= manualDollar; tl *= manualDollar; }
    else if (goalCurrency === 'EUR') { tr *= manualEuro; finalProfit *= manualEuro; tl *= manualEuro; }

    const payload = { user_id: userId, month_key: currentMonthKey, revenue_target: tr, profit_target: finalProfit, ad_spend_limit: tl };
    const { error } = await supabase.from('financial_goals').upsert(payload, { onConflict: 'user_id, month_key' });
    if (error) { alert('Não foi possível salvar as metas: ' + error.message + '. Tente de novo.'); return; }
    
    setGoal({ revenue: tr, profit: finalProfit, limit: tl });
    localStorage.setItem('autometrics_goal_currency', goalCurrency);
    setIsGoalModalOpen(false);
  };
  const handleAddCost = async () => {
    const userId = user?.id;
    if (!userId) return;
    if (!newCost.description || !newCost.amount) return alert("Preencha descrição e valor.");
    const val = newCost.type === 'revenue' ? -Math.abs(Number(newCost.amount)) : Math.abs(Number(newCost.amount));
    const { error } = await supabase.from('additional_costs').insert([{ date: newCost.date, description: newCost.description, currency: newCost.currency, user_id: userId, amount: val }]);
    if (error) { alert('Não foi possível salvar o extra: ' + error.message + '. Tente de novo.'); return; }
    setNewCost({ date: getLocalYYYYMMDD(new Date()), description: '', amount: 0, currency: 'BRL', type: 'cost' });
    setIsCostModalOpen(false);
    fetchData(userId);
  };
  const handleDeleteCost = async (id: string, desc?: string) => {
    if (!confirm(`Excluir o extra${desc ? ` "${desc}"` : ''}? Não dá para desfazer.`)) return;
    const { error } = await supabase.from('additional_costs').delete().eq('id', id);
    if (error) { alert('Não foi possível excluir: ' + error.message + '. Tente de novo.'); return; }
    if (user?.id) fetchData(user.id);
  };

  // Visual pelo guia (DESIGN.md, direção Linear): cores pelos tokens do tema,
  // números neutros e cor só no resultado (lucro, ROI, variações).
  const isDark = theme === 'dark';
  const tone = (v: number) => (v >= 0 ? 'text-pos' : 'text-neg');
  const card = 'rounded-xl border border-line bg-surface-1';
  const label = 'text-xs font-medium text-ink-subtle';
  const navItem = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const navIdle = `${navItem} text-ink-subtle hover:bg-surface-2 hover:text-ink`;
  const iconBtn = 'w-8 h-8 flex items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors';
  const segGroup = 'flex items-center gap-1 p-1 rounded-lg border border-line bg-surface-1';
  const segItem = (on: boolean) => `rounded-md text-xs font-medium whitespace-nowrap transition-colors ${on ? 'bg-surface-3 text-ink' : 'text-ink-subtle hover:text-ink'}`;
  const chip = (on: boolean) => `flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${on ? 'bg-surface-3 border-line-strong text-ink' : 'bg-surface-1 border-line text-ink-subtle hover:text-ink'}`;
  const btnSecondary = 'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-lg border border-line bg-surface-1 text-sm font-medium text-ink hover:bg-surface-2 transition-colors';
  const btnPrimary = 'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors';
  const field = 'w-full bg-surface-1 border border-line-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand';
  // Recharts e as linhas pequenas pedem a cor pronta: os mesmos valores dos tokens chart-*.
  const chartColor = isDark
    ? { revenue: '#7c86e0', cost: '#d9913f', profit: '#27a644', roi: '#9aa3ef', grid: '#23252a', axis: '#8a8f98', goal: '#62666d', tipBg: '#0f1011', tipLine: '#34343a', tipText: '#f7f8f8' }
    : { revenue: '#5e6ad2', cost: '#c27a28', profit: '#1d7f38', roi: '#4b56be', grid: '#e2e4e8', axis: '#62666f', goal: '#9a9fa8', tipBg: '#ffffff', tipLine: '#cfd2d8', tipText: '#16171a' };
  const NAV_ITEMS = [
    { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', short: 'Dashboard' },
    { href: '/planning', Icon: Target, label: 'Metas', short: 'Metas' },
    { href: '/products', Icon: Package, label: 'Campanhas', short: 'Campanhas' },
    { href: '/analise-ia', Icon: Sparkles, label: 'Análise de IA', short: 'Análise IA' },
    { href: '/rastreamento', Icon: Route, label: 'Rastreamento', short: 'Rastreio' },
    { href: '/integration', Icon: Settings, label: 'Integração', short: 'Integração' },
  ];

  if (!authChecked) return <div className="min-h-screen bg-canvas" />;
  if (loading) return <div className={`${inter.className} min-h-screen bg-canvas text-ink-muted flex items-center justify-center`}>Carregando…</div>;

  const mobileKpiCards = [
    { label: 'Receita', value: processedData.totals.revenue, color: chartColor.revenue, data: processedData.daysArray.map((d: any) => d.revenue), isPositiveGood: true, isRoi: false, isResult: false },
    { label: 'Custo Ads', value: processedData.totals.ads_cost, color: chartColor.cost, data: processedData.daysArray.map((d: any) => d.ads_cost), isPositiveGood: false, isRoi: false, isResult: false },
    { label: 'Extras Net', value: processedData.totals.net_extra, color: chartColor.cost, data: processedData.daysArray.map((d: any) => d.net_extra), isPositiveGood: true, isRoi: false, isResult: false },
    { label: 'Lucro', value: processedData.totals.profit, color: chartColor.profit, data: processedData.daysArray.map((d: any) => d.revenue - d.ads_cost + d.extra_revenue - d.extra_cost - d.refunds), isPositiveGood: true, isRoi: false, isResult: true },
    { label: 'ROI', value: processedData.totals.roi, color: chartColor.roi, data: processedData.daysArray.map((d: any) => d.ads_cost > 0 ? ((d.revenue - d.ads_cost + d.extra_revenue - d.extra_cost - d.refunds) / d.ads_cost) * 100 : 0), isPositiveGood: true, isRoi: true, isResult: true },
  ];

  // Variação contra o período anterior; para custo, cair é bom.
  const variation = (v: number, goodWhenUp: boolean, pp = false) => v === 0 ? null : (
    <p className={`text-xs font-medium mt-1 tabular-nums ${(goodWhenUp ? v > 0 : v < 0) ? 'text-pos' : 'text-neg'}`}>
      {pp ? `${fmtNum(v, 1, true)} p.p.` : fmtPct(v, 1, true)} <span className="font-normal text-ink-subtle">vs período anterior</span>
    </p>
  );
  const kpis = [
    { label: 'Receita', value: formatMoney(processedData.totals.revenue), cls: 'text-ink', extra: variation(processedData.variations.revenue, true) },
    { label: 'Custo dos anúncios', value: formatMoney(processedData.totals.ads_cost), cls: 'text-ink', extra: variation(processedData.variations.ads_cost, false) },
    { label: 'Extras (saldo)', value: formatMoney(processedData.totals.net_extra), cls: processedData.totals.net_extra >= 0 ? 'text-ink' : 'text-warn', extra: null },
    { label: 'Lucro líquido', value: formatMoney(processedData.totals.profit), cls: tone(processedData.totals.profit), extra: variation(processedData.variations.profit, true) },
    { label: 'ROI', value: fmtPct(processedData.totals.roi, 1), cls: tone(processedData.totals.roi), extra: variation(processedData.variations.roi, true, true) },
  ];

  const rateBox = (kind: 'USD' | 'EUR') => (
    <div className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg border border-line bg-surface-1 flex-1 sm:flex-none sm:min-w-[180px]">
      <div className="flex flex-col">
        <span className={label}>{kind === 'USD' ? 'Dólar hoje' : 'Euro hoje'}</span>
        <span className="text-sm font-medium tabular-nums text-ink">R$ {(kind === 'USD' ? liveDollar : liveEuro).toFixed(2).replace('.', ',')}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className={label}>{kind === 'USD' ? 'Meu dólar' : 'Meu euro'}</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-subtle">R$</span>
          <input type="text" inputMode="decimal" aria-label={kind === 'USD' ? 'Meu dólar, em reais' : 'Meu euro, em reais'}
            className="w-14 text-right bg-transparent text-sm font-medium tabular-nums text-ink outline-none border-b border-line-strong focus:border-brand transition-colors pb-0.5"
            value={kind === 'USD' ? dollarInput : euroInput}
            onChange={(e) => (kind === 'USD' ? handleDollarInputChange(e.target.value) : handleEuroInputChange(e.target.value))}
            onBlur={kind === 'USD' ? handleDollarInputBlur : handleEuroInputBlur}
          />
          <div className="flex flex-col ml-0.5">
            <button type="button" onClick={() => (kind === 'USD' ? handleDollarStep(0.01) : handleEuroStep(0.01))} aria-label={`Aumentar o ${kind === 'USD' ? 'dólar' : 'euro'} em 1 centavo`} className="p-0.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"><ChevronUp size={12} aria-hidden="true" /></button>
            <button type="button" onClick={() => (kind === 'USD' ? handleDollarStep(-0.01) : handleEuroStep(-0.01))} aria-label={`Diminuir o ${kind === 'USD' ? 'dólar' : 'euro'} em 1 centavo`} className="p-0.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"><ChevronDown size={12} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`${inter.className} min-h-screen font-sans flex bg-canvas text-ink-muted`}>

      {/* SIDEBAR DESKTOP */}
      <aside className="hidden md:flex md:w-60 shrink-0 border-r border-line bg-surface-1 flex-col sticky top-0 h-screen z-20">
        <div className="h-16 flex items-center justify-start px-5 border-b border-line overflow-hidden shrink-0">
          <Logo />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ href, Icon, label: l }) => href === '/planning' ? (
            <Link key={href} href={href} aria-current="page" className={`${navItem} bg-surface-2 text-ink`}>
              <Icon size={18} aria-hidden="true" className="text-brand-text" /> <span>{l}</span>
            </Link>
          ) : (
            <Link key={href} href={href} className={navIdle}>
              <Icon size={18} aria-hidden="true" /> <span>{l}</span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-line">
          <button onClick={handleLogout} className={`${navItem} text-ink-subtle hover:text-neg hover:bg-neg/10`}><LogOut size={18} aria-hidden="true"/> <span className="truncate">Sair ({user?.email?.split('@')[0]})</span></button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 min-w-0 p-4 md:p-8 overflow-y-auto pb-24 md:pb-8">

      {/* ABAS: Metas | Cartões (LootRush). A segunda só existe para quem ligou a LootRush em Integração. */}
      {hasCards && (
        <div className={`${segGroup} mb-4 md:mb-6 w-full sm:w-fit`}>
          {([['metas', 'Metas e DRE'], ['cartoes', 'Cartões · LootRush']] as const).map(([key, l]) => (
            <button key={key} onClick={() => setView(key)} aria-pressed={view === key}
              className={`flex-1 sm:flex-none py-1.5 px-4 text-sm ${segItem(view === key)}`}>{l}</button>
          ))}
        </div>
      )}
      {view === 'cartoes' && hasCards && <LootrushPanel isDark={isDark} />}
      {(view !== 'cartoes' || !hasCards) && (<>

      {/* MOBILE HEADER */}
      <div className="flex md:hidden items-center justify-between px-1 pt-1 pb-3">
        <div>
          <h1 className="text-xl font-semibold leading-tight text-ink">Metas</h1>
          <p className="text-xs text-ink-subtle mt-0.5">{dateRange === 'custom' ? `${fmtDay(startDate)} → ${fmtDay(endDate)}` : (DATE_PRESET_LABELS[dateRange] || 'Período')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} className={`${iconBtn} w-9 h-9`}>
            {isDark ? <Sun size={16} aria-hidden="true"/> : <Moon size={16} aria-hidden="true"/>}
          </button>
          <button onClick={() => setShowFilterSheet(true)} aria-label="Abrir filtros" aria-expanded={showFilterSheet} className={`${iconBtn} w-9 h-9`}>
            <SlidersHorizontal size={16} aria-hidden="true"/>
          </button>
        </div>
      </div>

      {/* MOBILE DATE CHIPS */}
      <div className="flex md:hidden gap-2 px-1 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        {DATE_PRESETS.map(preset => (
          <button key={preset} onClick={() => handlePresetChange(preset)} aria-pressed={dateRange === preset} className={chip(dateRange === preset)}>
            {DATE_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>

      {/* MOBILE ACTION ROW */}
      <div className="flex md:hidden gap-2 px-1 pb-3">
        <button onClick={() => setEditMode(!editMode)} aria-pressed={editMode} className={`flex-1 ${editMode ? 'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-lg border border-warn/40 bg-warn/10 text-warn text-sm font-medium' : btnSecondary}`}>
          <Edit2 size={14} aria-hidden="true"/> {editMode ? 'Parar' : 'Editar'}
        </button>
        <button onClick={() => setIsGoalModalOpen(true)} className={`flex-1 ${btnPrimary}`}>
          <Target size={14} aria-hidden="true"/> Metas
        </button>
        <button onClick={() => setIsCostModalOpen(true)} className={`flex-1 ${btnSecondary}`}>
          <Plus size={14} aria-hidden="true"/> Extras
        </button>
      </div>

      {/* MOBILE KPI GRID 2x2 */}
      <div className="md:hidden grid grid-cols-2 gap-3 px-1 pb-3">
        {mobileKpiCards.filter(c => ['Receita', 'Lucro', 'Custo Ads', 'ROI'].includes(c.label)).map(({ label: l, value, color, data, isPositiveGood, isRoi, isResult }) => {
          // Mesma comparação dos cartões do computador: o período todo contra o anterior.
          const change = l === 'Receita' ? processedData.variations.revenue
            : l === 'Custo Ads' ? processedData.variations.ads_cost
            : l === 'Lucro' ? processedData.variations.profit
            : processedData.variations.roi;
          const trendUp = change >= 0;
          const trendGood = isPositiveGood ? trendUp : !trendUp;
          const displayLabel = l === 'Custo Ads' ? 'Custo' : l;
          return (
            <div key={l} className={`${card} p-3`}>
              <div className={`${label} mb-1`}>{displayLabel}</div>
              <div className={`text-base font-semibold tabular-nums leading-tight mb-1.5 ${isResult ? tone(value) : 'text-ink'}`}>
                {isRoi ? `${fmtPct(value, 1)}` : formatMoney(value)}
              </div>
              {change !== 0 && (
                <div className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded mb-1.5 ${trendGood ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg'}`}
                  title="Comparado com o período anterior">
                  <span aria-hidden="true">{trendUp ? '↑' : '↓'}</span> {isRoi ? `${fmtNum(Math.abs(change), 1)} p.p.` : fmtPct(Math.abs(change), 1)}
                  <span className="sr-only">{trendUp ? 'a mais' : 'a menos'} que no período anterior</span>
                </div>
              )}
              <SparklineSVG data={data} color={color} />
            </div>
          );
        })}
      </div>

      {/* DESKTOP HEADER */}
      <header className="hidden md:flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-ink">Metas e DRE</h1>
            <p className="text-sm text-ink-subtle">Ritmo do mês, ponto de equilíbrio e o resultado de cada dia.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditMode(!editMode)} aria-pressed={editMode} className={editMode ? 'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-lg border border-warn/40 bg-warn/10 text-warn text-sm font-medium' : btnSecondary}><Edit2 size={14} aria-hidden="true"/> {editMode ? 'Parar edição' : 'Editar planilha'}</button>
            <button onClick={() => setIsGoalModalOpen(true)} className={btnPrimary}><Target size={14} aria-hidden="true"/> Metas</button>
            <button type="button" onClick={toggleTheme} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} className={iconBtn}>
              {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {availableMccs.length > 0 && (
            <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface-1">
              <Target size={16} aria-hidden="true" className="text-ink-subtle"/>
              <select
                aria-label="MCC ou conta"
                className={`bg-transparent text-sm font-medium outline-none cursor-pointer w-40 ${FOCUS_RING} text-ink`}
                value={selectedMcc}
                onChange={(e) => handleMccChange(e.target.value)}
              >
                <option value="all">Todas as MCCs</option>
                {availableMccs.map(mcc => (
                  <option key={mcc} value={mcc}>{mcc}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center h-9 rounded-lg border border-line bg-surface-1">
            <div className="flex items-center gap-2 px-3 h-full border-r border-line">
              <Calendar size={16} aria-hidden="true" className="text-ink-subtle"/>
              <select aria-label="Período" className={`bg-transparent text-sm font-medium outline-none cursor-pointer ${FOCUS_RING} text-ink w-auto`} value={dateRange} onChange={(e) => handlePresetChange(e.target.value)}>
                <option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="7d">7 dias</option><option value="30d">30 dias</option><option value="this_month">Este mês</option><option value="last_month">Mês passado</option><option value="custom">Personalizado</option>
              </select>
            </div>
            <div className="flex items-center gap-2 px-3">
              <input type="date" aria-label="Data inicial" className={`bg-transparent w-[112px] text-xs tabular-nums outline-none cursor-pointer ${FOCUS_RING} text-ink ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={startInput.value} onChange={(e) => startInput.onChange(e.target.value)} />
              <span className="text-ink-subtle text-xs">até</span>
              <input type="date" aria-label="Data final" className={`bg-transparent w-[112px] text-xs tabular-nums outline-none cursor-pointer ${FOCUS_RING} text-ink ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={endInput.value} onChange={(e) => endInput.onChange(e.target.value)} />
            </div>
          </div>

          <div className={segGroup} role="group" aria-label="Moeda de exibição">
            {(['BRL', 'USD', 'EUR'] as const).map(curr => (
              <button key={curr} type="button" onClick={() => handleCurrencyChange(curr)} aria-pressed={viewCurrency === curr}
                className={`h-7 px-3 ${segItem(viewCurrency === curr)}`}>
                {curr === 'BRL' ? 'R$' : curr === 'USD' ? 'US$' : '€'}
              </button>
            ))}
          </div>

          {rateConfig === 'USD' && rateBox('USD')}
          {rateConfig === 'EUR' && rateBox('EUR')}
        </div>
      </header>

      {/* KPI SUMÁRIO — desktop only */}
      <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 mb-6">
        {kpis.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <p className={`${label} mb-1.5`}>{k.label}</p>
            <p className={`text-2xl font-semibold tabular-nums tracking-[-0.3px] ${k.cls}`}>{k.value}</p>
            {k.extra}
          </div>
        ))}
      </div>

      {/* PAINEL DE ACOMPANHAMENTO DIÁRIO E ESTRATÉGICO — desktop only */}
      {(goal.revenue > 0 || goal.profit > 0) && (
        <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">

          {/* Velocímetro Diário */}
          <div className={`${card} p-5`}>
             <p className="text-sm font-medium text-ink mb-4 flex items-center gap-2"><TrendingUp size={16} aria-hidden="true" className="text-ink-subtle"/> Ritmo diário</p>
             <div className="space-y-3">
               <div>
                  <p className={label}>Ritmo necessário por dia</p>
                  <p className="text-lg font-semibold tabular-nums text-ink">{formatMoney(processedData.dailyTargetRevenue)}</p>
               </div>
               <div>
                  <p className={label}>Seu ritmo atual por dia</p>
                  <p className={`text-lg font-semibold tabular-nums ${processedData.revenuePacing >= 0 ? 'text-pos' : 'text-neg'}`}>{formatMoney(processedData.currentDailyRevenue)}</p>
               </div>
               <div className={`text-xs font-medium px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 ${processedData.revenuePacing >= 0 ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg'}`}>
                 {processedData.revenuePacing >= 0 ? `Acima do ritmo em ${formatMoney(Math.abs(processedData.revenuePacing))} por dia` : `Abaixo do ritmo em ${formatMoney(Math.abs(processedData.revenuePacing))} por dia`}
               </div>
             </div>
          </div>

          {/* Lucro Seguro */}
          <div className={`${card} p-5`}>
             <p className="text-sm font-medium text-ink mb-2 flex items-center gap-2"><Briefcase size={16} aria-hidden="true" className="text-ink-subtle"/> Saúde do lucro</p>
             <p className="text-xs text-ink-subtle mb-3">Mesmo que a receita oscile, o que importa é o lucro no fim do dia.</p>
             {processedData.isProfitSafe ? (
               <div className="rounded-lg border border-pos/30 bg-pos/5 p-3">
                  <p className="text-sm font-medium text-pos mb-1">Lucro no alvo</p>
                  <p className="text-xs text-ink-muted">A média atual de <span className="font-medium text-ink tabular-nums">{formatMoney(processedData.currentDailyProfit)}/dia</span> bate a meta de <span className="font-medium text-ink tabular-nums">{formatMoney(processedData.dailyTargetProfit)}/dia</span>.</p>
               </div>
             ) : (
               <div className="rounded-lg border border-warn/30 bg-warn/5 p-3">
                  <p className="text-sm font-medium text-warn mb-1">Atenção ao ROI</p>
                  <p className="text-xs text-ink-muted">O lucro diário (<span className="font-medium text-ink tabular-nums">{formatMoney(processedData.currentDailyProfit)}</span>) está abaixo da média necessária de <span className="font-medium text-ink tabular-nums">{formatMoney(processedData.dailyTargetProfit)}/dia</span>.</p>
               </div>
             )}
          </div>

          {/* Matando meu ROI (Top Offenders) */}
          <div className={`${card} p-5`}>
             <p className="text-sm font-medium text-ink mb-0.5 flex items-center gap-2"><AlertCircle size={16} aria-hidden="true" className="text-ink-subtle"/> Matando meu ROI</p>
             <p className="text-xs text-ink-subtle mb-3">No período selecionado</p>
             <div className="space-y-1.5 overflow-y-auto max-h-44 pr-1">
               {processedData.bottomCampaigns.length === 0 ? (
                 <p className="text-xs p-3 border border-dashed border-line rounded-lg text-center text-ink-subtle">Nenhuma campanha prejudicando o ROI no período.</p>
               ) : (
                 processedData.bottomCampaigns.map((c, i) => {
                   const isLoss = c.profit < 0 || c.roi < 0;
                   return (
                     <div key={i} className="flex justify-between items-center gap-2 py-1.5 border-b border-line last:border-b-0">
                       <div className="min-w-0">
                         <p className="text-xs font-medium text-ink truncate" title={c.name}>{c.name}</p>
                         <p className="text-[11px] text-ink-subtle">{fmtPct(c.spendShare, 1)} do gasto total</p>
                       </div>
                       <div className="text-right flex-shrink-0 tabular-nums">
                         <p className={`text-xs font-medium ${isLoss ? 'text-neg' : 'text-warn'}`}>ROI {fmtPct(c.roi, 0)}</p>
                         <p className="text-[11px] text-ink-subtle">{isLoss ? `−${formatMoney(Math.abs(c.profit))}` : `média ${fmtPct(c.avgRoi, 0)}`}</p>
                       </div>
                     </div>
                   );
                 })
               )}
             </div>
          </div>

        </div>
      )}

      {/* PAINEL DE INSIGHTS ESTRATÉGICOS (PROJEÇÕES) — desktop only */}
      <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6 lg:items-start">
         {/* Widget 1: Previsão de Fechamento (Pacing) */}
         <div className={`${card} p-5`}>
            <div className="flex justify-between items-start gap-2 mb-1">
               <h3 className="text-sm font-medium text-ink flex items-center gap-2"><TrendingUp size={16} aria-hidden="true" className="text-ink-subtle" /> Previsão de fechamento</h3>
               <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-surface-3 text-ink-subtle whitespace-nowrap">
                  {processedData.isCurrentMonth ? 'Ritmo atual' : 'Mês fechado'}
               </span>
            </div>
            <p className="text-xs text-ink-subtle mb-4">Pela média diária de <span className="tabular-nums">{formatMoney(processedData.currentDailyRevenue)}</span></p>
            <div className="flex justify-between items-end mb-1">
               <div>
                  <span className={label}>Projeção final</span>
                  <p className={`text-xl font-semibold tabular-nums ${processedData.projectedRevenue >= processedData.finalGoal.revenue && processedData.finalGoal.revenue > 0 ? 'text-pos' : 'text-ink'}`}>{formatMoney(processedData.projectedRevenue)}</p>
               </div>
               <div className="text-right">
                  <span className={label}>Sua meta</span>
                  <p className="text-sm font-medium tabular-nums text-ink-muted">{formatMoney(processedData.finalGoal.revenue)}</p>
               </div>
            </div>
            {processedData.finalGoal.revenue > 0 && (
               <div className="w-full bg-surface-3 rounded-full h-1.5 mt-2" role="progressbar" aria-label="Projeção em relação à meta" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min((processedData.projectedRevenue / processedData.finalGoal.revenue) * 100, 100))}>
                  <div className={`h-1.5 rounded-full ${processedData.projectedRevenue >= processedData.finalGoal.revenue ? 'bg-pos' : 'bg-brand'}`} style={{ width: `${Math.min((processedData.projectedRevenue / processedData.finalGoal.revenue) * 100, 100)}%` }}></div>
               </div>
            )}
         </div>

         {/* Widget 2: Break-even Analysis */}
         <div className={`${card} p-5`}>
            <h3 className="text-sm font-medium text-ink flex items-center gap-2 mb-1"><Target size={16} aria-hidden="true" className="text-ink-subtle" /> Ponto de equilíbrio</h3>
            <p className="text-xs text-ink-subtle mb-4">Para o lucro chegar a zero, o que os anúncios deixam precisa pagar os <span className="tabular-nums">{formatMoney(processedData.totals.extra_cost)}</span> de custos extras do período.</p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-line">
               <div>
                  <span className={`${label} block`}>ROI mínimo para empatar</span>
                  <p className="text-xl font-semibold tabular-nums text-ink">{fmtPct(processedData.breakEvenRoi, 1)}</p>
               </div>
               <div className="text-right">
                   <span className={`${label} block`}>ROI atual dos anúncios</span>
                   <p className={`text-xl font-semibold tabular-nums ${processedData.adsRoi >= processedData.breakEvenRoi ? 'text-pos' : 'text-neg'}`}>{fmtPct(processedData.adsRoi, 1)}</p>
               </div>
            </div>
         </div>

         {/* Widget 3: Curva ABC de Campanhas */}
         <div className={`${card} p-5`}>
            <h3 className="text-sm font-medium text-ink flex items-center gap-2 mb-3"><DollarSign size={16} aria-hidden="true" className="text-ink-subtle" /> Campanhas que mais lucram</h3>
            <div className="space-y-2.5">
               {processedData.topCampaigns.length === 0 ? (
                  <p className="text-xs text-ink-subtle text-center py-4">Sem dados suficientes.</p>
               ) : (
                  processedData.topCampaigns.map((camp: any, idx: number) => (
                     <div key={idx} className="flex justify-between items-start gap-2 text-xs">
                        <div className="min-w-0">
                           <span className="font-medium text-ink break-words"><span className="text-ink-subtle tabular-nums mr-1.5">{idx + 1}.</span>{camp.name === 'Desconhecida' ? 'Venda Externa' : camp.name}</span>
                           <span className="block text-[11px] text-ink-subtle mt-0.5 tabular-nums">Traz {fmtPct(camp.profitShare, 1)} do lucro gastando {fmtPct(camp.spendShare, 1)}</span>
                        </div>
                        <span className={`font-medium whitespace-nowrap tabular-nums ${tone(camp.profit)}`}>{formatMoney(camp.profit)}</span>
                     </div>
                  ))
               )}
            </div>
            {processedData.bottomCampaigns.length > 0 && (
              <>
                <div className="border-t border-line mt-3 pt-3 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-neg">Piores resultados</span>
                  <span className="text-[11px] text-ink-subtle tabular-nums">{processedData.bottomCampaigns.length} {processedData.bottomCampaigns.length === 1 ? 'campanha' : 'campanhas'}</span>
                </div>
                {/* Lista com altura limitada: antes esticava os três cartões da linha. */}
                <div className="mt-1.5 max-h-48 overflow-y-auto pr-1 space-y-1">
                  {processedData.bottomCampaigns.map((camp: any, idx: number) => (
                    <div key={`bot-${idx}`} className="flex justify-between items-center gap-2 text-xs">
                      <span className="truncate text-ink-muted" title={camp.name}>{camp.name === 'Desconhecida' ? 'Venda Externa' : camp.name}</span>
                      <span className="font-medium whitespace-nowrap tabular-nums text-neg">{formatMoney(camp.profit)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
         </div>
      </div>

      {/* GRÁFICO */}
      <div className={`hidden md:block ${card} p-5 mb-6 h-64`}>
         <ResponsiveContainer width="100%" height="100%">
             <AreaChart data={processedData.chartData}>
                <defs><linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={chartColor.revenue} stopOpacity={0.25}/><stop offset="95%" stopColor={chartColor.revenue} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColor.grid} vertical={false} />
                <XAxis dataKey="date" stroke={chartColor.axis} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={chartColor.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v/1000}k`} />
                <Tooltip contentStyle={{ backgroundColor: chartColor.tipBg, borderColor: chartColor.tipLine, borderRadius: 8, color: chartColor.tipText, fontSize: 12 }} formatter={(v:any) => formatMoney(v)} />
                <Area type="monotone" dataKey="revenue" name="Receita acumulada" stroke={chartColor.revenue} strokeWidth={2} fillOpacity={1} fill="url(#colorReal)" />
                <Line type="monotone" dataKey="ideal" name="Meta" stroke={chartColor.goal} strokeDasharray="5 5" dot={false} />
             </AreaChart>
         </ResponsiveContainer>
      </div>

      {/* MOBILE DRE ROWS */}
      <div className="md:hidden space-y-2 mb-4">
        {processedData.daysArray.map((day: any) => {
          const isExpanded = expandedRows[day.date];
          const profit = day.revenue - day.ads_cost + day.extra_revenue - day.extra_cost - day.refunds;
          const dateParts = day.date.split('-');
          return (
            <div key={day.date} className={`${card} overflow-hidden`}>
              <div className="flex items-center justify-between p-3 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand" onClick={() => toggleExpand(day.date)}
                role="button" tabIndex={0} aria-expanded={!!isExpanded}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(day.date); } }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-medium bg-surface-2 text-ink tabular-nums">
                    {dateParts[2]}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-ink">{dateParts[2]}/{dateParts[1]}/{dateParts[0].slice(2)}</div>
                    <div className="text-xs text-ink-subtle tabular-nums">{formatMoney(day.revenue)} de receita</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[11px] text-ink-subtle">Lucro</div>
                    <div className={`text-sm font-medium tabular-nums ${tone(profit)}`}>{formatMoney(profit)}</div>
                  </div>
                  {isExpanded ? <ChevronDown size={14} aria-hidden="true" className="text-ink-subtle"/> : <ChevronRight size={14} aria-hidden="true" className="text-ink-subtle"/>}
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-line p-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-lg bg-surface-2">
                      <div className="text-[11px] text-ink-subtle mb-0.5">Receita</div>
                      <div className="font-medium tabular-nums text-ink">{formatMoney(day.revenue)}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-surface-2">
                      <div className="text-[11px] text-ink-subtle mb-0.5">Custo dos anúncios</div>
                      <div className="font-medium tabular-nums text-ink">{formatMoney(day.ads_cost)}</div>
                    </div>
                    {day.refunds > 0 && (
                      <div className="p-2 rounded-lg bg-surface-2">
                        <div className="text-[11px] text-ink-subtle mb-0.5">Reembolso</div>
                        <div className="font-medium tabular-nums text-neg">{formatMoney(day.refunds)}</div>
                      </div>
                    )}
                    {day.details.length > 0 && (
                      <div className="p-2 rounded-lg col-span-2 bg-surface-2">
                        <div className="text-[11px] text-ink-subtle mb-1">Extras (<span className="tabular-nums">{formatMoney(day.net_extra)}</span>)</div>
                        {day.details.map((d: any) => (
                          <div key={d.id} className="flex items-center justify-between py-0.5">
                            <span className="text-xs text-ink-muted truncate max-w-[55%]">{d.desc}</span>
                            <div className="flex items-center gap-1">
                              <span className={`text-xs font-medium tabular-nums ${d.val < 0 ? 'text-pos' : 'text-warn'}`}>{formatMoney(Math.abs(d.val))}</span>
                              {editMode && (
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteCost(d.id, d.desc); }} aria-label={`Excluir o extra ${d.desc}`} className="text-neg p-1 rounded hover:bg-neg/10">
                                  <Trash2 size={12} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* Totais mobile */}
        <div className={`${card} p-3 border-line-strong`}>
          <div className={`${label} mb-2`}>Totais do período</div>
          <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
            <div><div className="text-[11px] text-ink-subtle">Receita</div><div className="font-medium text-ink">{formatMoney(processedData.totals.revenue)}</div></div>
            <div><div className="text-[11px] text-ink-subtle">Custo dos anúncios</div><div className="font-medium text-ink">{formatMoney(processedData.totals.ads_cost)}</div></div>
            <div><div className="text-[11px] text-ink-subtle">Extras (saldo)</div><div className={`font-medium ${processedData.totals.net_extra >= 0 ? 'text-ink' : 'text-warn'}`}>{formatMoney(processedData.totals.net_extra)}</div></div>
            <div><div className="text-[11px] text-ink-subtle">Lucro</div><div className={`font-medium ${tone(processedData.totals.profit)}`}>{formatMoney(processedData.totals.profit)}</div></div>
          </div>
        </div>
      </div>

      {/* TABELA DE DRE (EXPANSÍVEL) — desktop only */}
      {(() => {
        const pad = cellPad(drePrefs.density);
        const w = (k: string) => widthStyle(drePrefs.widths[k]);
        const head = `${pad} border-b border-line bg-surface-2 text-xs font-medium text-ink-subtle whitespace-nowrap`;
        const sub = `${pad} border-b border-line`;
        return (
      <div className={`hidden md:block ${card} overflow-hidden`}>
         <div className="px-4 py-3 border-b border-line flex justify-between items-center">
            <h3 className="text-sm font-medium text-ink">Dia a dia (DRE)</h3>
            <div className="flex items-center gap-2">
            <TableControls prefs={drePrefs} isDark={isDark} tokens />
            <button onClick={() => setIsCostModalOpen(true)} className={btnSecondary}>
               <Plus size={14} aria-hidden="true"/> Lançar extras
            </button>
            </div>
         </div>
         <div className="overflow-x-auto">
            <table className="w-max min-w-full text-[13px] text-left border-collapse tabular-nums">
               <thead>
                  <tr>
                     <th className={`${head} w-10`}></th>
                     <Th colKey="date" prefs={drePrefs} className={head}>Data</Th>
                     <Th colKey="revenue" prefs={drePrefs} className={`${head} text-right`}>Receita</Th>
                     <Th colKey="ads_cost" prefs={drePrefs} className={`${head} text-right`}>Custo dos anúncios</Th>
                     <Th colKey="extras" prefs={drePrefs} className={`${head} text-right`}>Extras</Th>
                     <Th colKey="refunds" prefs={drePrefs} className={`${head} text-right`}>Reembolso</Th>
                     <Th colKey="profit" prefs={drePrefs} className={`${head} text-right`}>Lucro</Th>
                  </tr>
               </thead>
               <tbody>
                  {processedData.daysArray.map((day: any) => {
                     const isExpanded = expandedRows[day.date];
                     const cell = `${pad} border-b border-line ${isExpanded ? 'bg-surface-2' : ''} group-hover:bg-surface-2`;
                     const profit = day.revenue - day.ads_cost + day.extra_revenue - day.extra_cost - day.refunds;
                     const dateParts = day.date.split('-');

                     return (
                        <React.Fragment key={day.date}>
                           {/* LINHA PRINCIPAL (DIA) */}
                           <tr className="group cursor-pointer" onClick={() => toggleExpand(day.date)}>
                              <td className={`${cell} text-center`}>
                                 {/* A linha inteira abre com o mouse; este botão é o caminho pelo teclado. */}
                                 {Object.keys(day.mccs).length > 0 && (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpand(day.date); }}
                                      aria-expanded={!!isExpanded} aria-label={`${isExpanded ? 'Fechar' : 'Abrir'} o dia ${fmtDay(day.date)}`}
                                      className={`inline-flex p-1 text-ink-subtle hover:text-ink ${FOCUS_RING}`}>
                                      {isExpanded ? <ChevronDown size={16} aria-hidden="true"/> : <ChevronRight size={16} aria-hidden="true"/>}
                                    </button>
                                 )}
                              </td>
                              <td className={`${cell} font-medium text-ink`} style={w('date')}>{`${dateParts[2]}/${dateParts[1]}`}</td>
                              <td className={`${cell} text-right text-ink`} style={w('revenue')}>{formatMoney(day.revenue)}</td>
                              <td className={`${cell} text-right text-ink-muted`} style={w('ads_cost')}>{formatMoney(day.ads_cost)}</td>

                              {/* EXTRAS */}
                              <td className={`${cell} text-right relative align-top`} style={w('extras')} onClick={(e) => e.stopPropagation()}>
                                 {day.details.length > 0 ? (
                                    <div className="flex flex-col items-end gap-1">
                                       <span className={`font-medium ${day.net_extra >= 0 ? 'text-ink' : 'text-warn'}`}>{formatMoney(day.net_extra)}</span>
                                       <div className="flex flex-col gap-1 w-full items-end mt-1 border-t border-dashed border-line pt-1">
                                          {day.details.map((d: any) => (
                                             <div key={d.id} className="flex items-center gap-2">
                                                <span className="text-xs text-ink-subtle break-words min-w-0" title={d.desc}>{d.desc}</span>
                                                <span className={`text-xs font-medium ${d.val < 0 ? 'text-pos' : 'text-warn'}`}>{formatMoney(Math.abs(d.val))}</span>
                                                {/* Botão Excluir (Só com Modo Edição) */}
                                                {editMode && (
                                                   <button
                                                     onClick={(e) => { e.stopPropagation(); handleDeleteCost(d.id, d.desc); }}
                                                     className="text-neg p-1 rounded hover:bg-neg/10"
                                                     title="Excluir extra"
                                                     aria-label={`Excluir o extra ${d.desc}`}
                                                   >
                                                      <Trash2 size={12} aria-hidden="true" />
                                                   </button>
                                                )}
                                             </div>
                                          ))}
                                       </div>
                                    </div>
                                 ) : <span className="text-ink-faint">—</span>}
                              </td>

                              <td className={`${cell} text-right ${day.refunds > 0 ? 'text-neg' : 'text-ink-faint'}`} style={w('refunds')}>{day.refunds > 0 ? formatMoney(day.refunds) : '—'}</td>
                              <td className={`${cell} text-right font-medium ${tone(profit)}`} style={w('profit')}>{formatMoney(profit)}</td>
                           </tr>

                           {/* LINHAS EXPANDIDAS (DETALHE MCC/CONTA) */}
                           {isExpanded && Object.values(day.mccs).map((mcc: any) => (
                              <React.Fragment key={mcc.name}>
                                 <tr className="bg-canvas/40">
                                    <td className="border-b border-line"></td>
                                    <td className={`${sub} pl-6 font-medium text-ink`} style={w('date')}>
                                       <span className="flex items-start gap-2 max-w-[360px] whitespace-normal break-words"><Globe size={12} aria-hidden="true" className="text-ink-subtle shrink-0 mt-0.5"/> {mcc.name}</span>
                                    </td>
                                    <td className={`${sub} text-right text-ink-muted`}>{formatMoney(mcc.revenue)}</td>
                                    <td className={`${sub} text-right text-ink-muted`}>{formatMoney(mcc.ads_cost)}</td>
                                    <td colSpan={2} className="border-b border-line"></td>
                                    <td className={`${sub} text-right font-medium ${tone(mcc.revenue - mcc.ads_cost - mcc.refunds)}`}>{formatMoney(mcc.revenue - mcc.ads_cost - mcc.refunds)}</td>
                                 </tr>
                                 {Object.values(mcc.accounts).map((acc: any) => (
                                    <React.Fragment key={acc.name}>
                                       <tr className="bg-canvas/40">
                                          <td className="border-b border-line"></td>
                                          <td className={`${sub} pl-12 text-ink`} style={w('date')}>
                                             <span className="flex items-start gap-2 max-w-[340px] whitespace-normal break-words"><Briefcase size={12} aria-hidden="true" className="text-ink-subtle shrink-0 mt-0.5"/> {acc.name}</span>
                                          </td>
                                          <td className={`${sub} text-right text-ink-muted`}>{formatMoney(acc.revenue)}</td>
                                          <td className={`${sub} text-right text-ink-muted`}>{formatMoney(acc.ads_cost)}</td>
                                          <td colSpan={2} className="border-b border-line"></td>
                                          <td className={`${sub} text-right ${tone(acc.revenue - acc.ads_cost - acc.refunds)}`}>{formatMoney(acc.revenue - acc.ads_cost - acc.refunds)}</td>
                                       </tr>
                                       {Object.values(acc.campaigns).map((cmp: any) => (
                                          <tr key={cmp.name} className="bg-canvas/40">
                                             <td className="border-b border-line"></td>
                                             <td className={`${sub} pl-[4.5rem] text-ink-muted`} style={w('date')}>
                                                <span className="flex items-start gap-2 max-w-[320px] whitespace-normal break-words"><Package size={12} aria-hidden="true" className="text-ink-subtle shrink-0 mt-0.5"/> {cmp.name}</span>
                                             </td>
                                             <td className={`${sub} text-right text-ink-muted`}>{formatMoney(cmp.revenue)}</td>
                                             <td className={`${sub} text-right text-ink-muted`}>{formatMoney(cmp.ads_cost)}</td>
                                             <td colSpan={2} className="border-b border-line"></td>
                                             <td className={`${sub} text-right ${tone(cmp.revenue - cmp.ads_cost - cmp.refunds)}`}>{formatMoney(cmp.revenue - cmp.ads_cost - cmp.refunds)}</td>
                                          </tr>
                                       ))}
                                    </React.Fragment>
                                 ))}
                              </React.Fragment>
                           ))}
                        </React.Fragment>
                     );
                  })}
               </tbody>
               <tfoot className="font-medium bg-surface-2 border-t border-line-strong">
                  <tr>
                     <td className={`${pad} text-ink`}>Totais</td>
                     <td className={pad}></td>
                     <td className={`${pad} text-right text-ink`}>{formatMoney(processedData.totals.revenue)}</td>
                     <td className={`${pad} text-right text-ink`}>{formatMoney(processedData.totals.ads_cost)}</td>
                     <td className={`${pad} text-right ${processedData.totals.net_extra >= 0 ? 'text-ink' : 'text-warn'}`}>{formatMoney(processedData.totals.net_extra)}</td>
                     <td className={`${pad} text-right ${processedData.totals.refunds > 0 ? 'text-neg' : 'text-ink-faint'}`}>{formatMoney(processedData.totals.refunds)}</td>
                     <td className={`${pad} text-right ${tone(processedData.totals.profit)}`}>{formatMoney(processedData.totals.profit)}</td>
                  </tr>
               </tfoot>
            </table>
         </div>
      </div>
        );
      })()}
      </>)}

      </main>

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden z-40 border-t border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex justify-around items-center px-2 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map(({ href, Icon, short }) => {
            const active = href === '/planning';
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-lg transition-colors ${active ? 'text-brand-text' : 'text-ink-subtle'}`}>
                <Icon size={22} aria-hidden="true"/>
                <span className="text-[10px] font-medium">{short}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* FILTER BOTTOM SHEET */}
      {/* Fechado, o painel fica fora do alcance do teclado e do leitor de tela (inert). */}
      <div inert={!showFilterSheet} onKeyDown={(e) => { if (e.key === 'Escape') setShowFilterSheet(false); }}
        className={`fixed inset-0 z-50 md:hidden transition-opacity duration-300 ${showFilterSheet ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/60" onClick={() => setShowFilterSheet(false)}/>
        <div role="dialog" aria-modal="true" aria-labelledby="planning-filter-title" className={`absolute bottom-0 inset-x-0 rounded-t-2xl border-t border-line-strong bg-surface-1 transition-transform duration-300 ease-out ${showFilterSheet ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-line-strong"/></div>
          <div className="flex items-center justify-between px-5 pb-4">
            <h2 id="planning-filter-title" className="text-base font-semibold text-ink">Filtros</h2>
            <button ref={filterCloseRef} onClick={() => setShowFilterSheet(false)} aria-label="Fechar filtros" className={iconBtn}><X size={16} aria-hidden="true"/></button>
          </div>
          <div className="px-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)_+_1rem))] space-y-5 overflow-y-auto max-h-[70vh]">
            <div>
              <p className={`${label} mb-2`}>Período</p>
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map(preset => (
                  <button key={preset} onClick={() => handlePresetChange(preset)} aria-pressed={dateRange === preset} className={chip(dateRange === preset)}>
                    {DATE_PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className={`${label} mb-2`}>Datas personalizadas</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" aria-label="Data inicial" className={`${field} min-w-0 text-xs ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={startInput.value} onChange={e => startInput.onChange(e.target.value)} />
                <input type="date" aria-label="Data final" className={`${field} min-w-0 text-xs ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={endInput.value} onChange={e => endInput.onChange(e.target.value)} />
              </div>
            </div>
            {availableMccs.length > 0 && (
              <div>
                <p className={`${label} mb-2`}>MCC ou conta</p>
                <select aria-label="MCC ou conta" className={field} value={selectedMcc} onChange={e => handleMccChange(e.target.value)}>
                  <option value="all">Todas as MCCs</option>
                  {availableMccs.map(mcc => <option key={mcc} value={mcc}>{mcc}</option>)}
                </select>
              </div>
            )}
            <div>
              <p className={`${label} mb-2`}>Moeda</p>
              <div className={segGroup} role="group" aria-label="Moeda de exibição">
                {(['BRL', 'USD', 'EUR'] as const).map(c => (
                  <button key={c} onClick={() => handleCurrencyChange(c)} aria-pressed={viewCurrency === c} className={`flex-1 py-2 ${segItem(viewCurrency === c)}`}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <p className={`${label} mb-2`}>Câmbio</p>
              {rateBox(rateConfig)}
            </div>
            <button onClick={() => setShowFilterSheet(false)} className="w-full bg-brand hover:bg-brand-hover text-white font-medium py-3 rounded-lg text-sm transition-colors">Aplicar</button>
          </div>
        </div>
      </div>

      {/* MODAL EXTRAS */}
      {isCostModalOpen && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setIsCostModalOpen(false); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="cost-modal-title" className="rounded-2xl w-full max-w-sm p-6 border border-line-strong bg-surface-1">
               <h3 id="cost-modal-title" className="text-base font-semibold text-ink mb-4">Lançar extras</h3>
               <div className="space-y-3">
                  <div className={`${segGroup} mb-1`} role="group" aria-label="Tipo de extra">
                     <button onClick={() => setNewCost({...newCost, type: 'cost'})} aria-pressed={newCost.type === 'cost'} className={`flex-1 py-1.5 ${segItem(newCost.type === 'cost')}`}>Custo extra</button>
                     <button onClick={() => setNewCost({...newCost, type: 'revenue'})} aria-pressed={newCost.type === 'revenue'} className={`flex-1 py-1.5 ${segItem(newCost.type === 'revenue')}`}>Receita extra</button>
                  </div>
                  <div>
                    <label htmlFor="cost-date" className={`${label} block mb-1.5`}>Data do lançamento</label>
                    <input id="cost-date" type="date" className={`${field} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`} value={newCost.date} onChange={e => setNewCost({...newCost, date: e.target.value})} />
                  </div>
                  <div>
                    <label htmlFor="cost-desc" className={`${label} block mb-1.5`}>Descrição</label>
                    <input id="cost-desc" type="text" placeholder="Ex: Hospedagem, Copywriter…" className={`${field} placeholder:text-ink-faint`} value={newCost.description} onChange={e => setNewCost({...newCost, description: e.target.value})} />
                  </div>
                  <div className="flex gap-2">
                     <div className="flex-1">
                        <label htmlFor="cost-amount" className={`${label} block mb-1.5`}>Valor</label>
                        <input id="cost-amount" type="number" placeholder="0.00" className={field} value={newCost.amount} onChange={e => setNewCost({...newCost, amount: parseFloat(e.target.value)})} />
                     </div>
                     <div className="w-24">
                        <label htmlFor="cost-currency" className={`${label} block mb-1.5`}>Moeda</label>
                        <select id="cost-currency" className={field} value={newCost.currency} onChange={e => setNewCost({...newCost, currency: e.target.value})}>
                           <option value="BRL">BRL</option>
                           <option value="USD">USD</option>
                           <option value="EUR">EUR</option>
                        </select>
                     </div>
                  </div>
                  <button onClick={handleAddCost} className="w-full bg-brand hover:bg-brand-hover text-white text-sm font-medium py-2.5 rounded-lg mt-2 transition-colors">{newCost.type === 'revenue' ? 'Salvar receita' : 'Salvar despesa'}</button>
                  <button onClick={() => setIsCostModalOpen(false)} className="w-full py-2 text-sm text-ink-subtle hover:text-ink">Cancelar</button>
               </div>
            </div>
         </div>
      )}

      {/* MODAL METAS */}
      {isGoalModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setIsGoalModalOpen(false); }}>
           <div role="dialog" aria-modal="true" aria-labelledby="goal-modal-title" className="rounded-2xl w-full max-w-sm p-6 border border-line-strong bg-surface-1">
              <div className="flex justify-between items-start mb-4">
                 <h2 id="goal-modal-title" className="text-base font-semibold text-ink">Metas do mês</h2>
                 <select aria-label="Moeda das metas" className={`text-xs font-medium px-2 py-1 rounded-md border border-line-strong bg-surface-1 text-ink outline-none ${FOCUS_RING}`} value={goalCurrency} onChange={e => setGoalCurrency(e.target.value as any)}>
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                 </select>
              </div>
              <div className="space-y-4">
                 <div>
                    <label htmlFor="goal-revenue" className={`${label} block mb-1.5`}>Meta de faturamento</label>
                    <input id="goal-revenue" type="number" className={field} value={tempGoal.revenue} onChange={e => setTempGoal({...tempGoal, revenue: parseFloat(e.target.value)})} />
                 </div>

                 <div>
                    <div className="flex justify-between items-center mb-1.5">
                       <label htmlFor="goal-profit" className={label}>Meta de lucro</label>
                       <div className={`${segGroup} p-0.5`} role="group" aria-label="Meta de lucro em">
                          <button onClick={() => setProfitType('value')} aria-pressed={profitType === 'value'} className={`px-2 py-0.5 ${segItem(profitType === 'value')}`}>Valor</button>
                          <button onClick={() => setProfitType('percentage')} aria-pressed={profitType === 'percentage'} className={`px-2 py-0.5 ${segItem(profitType === 'percentage')}`}>Margem %</button>
                       </div>
                    </div>
                    <div className="relative">
                       <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-subtle">{profitType === 'percentage' ? '%' : (goalCurrency === 'BRL' ? 'R$' : goalCurrency === 'USD' ? '$' : '€')}</span>
                       <input id="goal-profit" type="number" className={`${field} pl-8`} value={profitInput} onChange={e => setProfitInput(parseFloat(e.target.value))} />
                    </div>
                    {profitType === 'percentage' && tempGoal.revenue > 0 && typeof profitInput === 'number' && (
                       <p className="text-xs text-ink-subtle mt-1.5">Sua meta será lucrar <span className="font-medium text-pos tabular-nums">{new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: goalCurrency }).format(tempGoal.revenue * (profitInput / 100))}</span> no fim do mês.</p>
                    )}
                 </div>

                 <div>
                    <label htmlFor="goal-limit" className={`${label} block mb-1.5`}>
                       Teto de gastos <span className="font-normal">(faturamento − lucro)</span>
                    </label>
                    <input
                      id="goal-limit"
                      type="number"
                      readOnly
                      className={`${field} text-ink-subtle cursor-not-allowed bg-surface-2`}
                      value={parseFloat((Math.max(0, (tempGoal.revenue || 0) - (profitType === 'percentage' ? (tempGoal.revenue || 0) * ((profitInput || 0) / 100) : (profitInput || 0)))).toFixed(2))}
                    />
                 </div>

                 <button onClick={handleSaveGoal} className="w-full bg-brand hover:bg-brand-hover text-white text-sm font-medium py-2.5 rounded-lg mt-2 transition-colors">Salvar metas</button>
                 <button onClick={() => setIsGoalModalOpen(false)} className="w-full py-2 text-sm text-ink-subtle hover:text-ink">Cancelar</button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}
