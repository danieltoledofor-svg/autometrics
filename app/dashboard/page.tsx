"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar, Sun, Moon, LayoutGrid, Package, Settings,
  LogOut, Target,
  ChevronUp, ChevronDown, ChevronRight, SlidersHorizontal, X, FileText, AlertTriangle, Sparkles, Route
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { supabase } from '../../lib/supabaseClient';
import { useLiveMetrics } from '@/lib/useLiveMetrics';
import { fetchAllRows, fetchByProducts } from '@/lib/fetchRows';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import { useDayInput, isValidDay } from '@/lib/useDayInput';
import { saleMoney } from '@/app/components/SaleAlerts';
import { closeAllSales, closeSale, usePendingSales } from '@/lib/saleAlerts';
import { Logo } from '@/app/components/Logo';
import { resolveCampaignStatus, resolveProductStatus, STATUS_SEVERITY, type CampaignStatus } from '@/lib/campaignStatus';
import { CampaignStatusToggle } from '@/app/components/CampaignStatusToggle';
import { QuickEntryModal, type QuickEntryTarget } from '@/app/components/QuickEntryModal';
import { METRIC_SORTS, loadMetricSort, saveMetricSort, sortByMetric, type MetricSort } from '@/lib/metricSort';
import { MAIN_BLOCK, blockName, blockOf } from '@/lib/campaignGroups';
import { useCampaignGroups } from '@/app/components/table/useTablePrefs';
import { CampaignGroupsBar } from '@/app/components/CampaignGroupsBar';
import { spendAlert } from '@/lib/alerts/spendRule';
import { lossAlert, turnAlert, type DaySum } from '@/lib/alerts/marginRules';
import { Inter } from 'next/font/google';

// Fonte do guia visual (DESIGN.md). Por enquanto só na Dashboard, a primeira tela migrada.
const inter = Inter({ subsets: ['latin'], display: 'swap' });

// Última cotação lida do site de câmbio.
const RATES_KEY = 'autometrics_live_rates';

// Colunas de daily_metrics que a tela lê (id é a chave da atualização ao vivo).
const METRIC_COLUMNS = 'id, product_id, date, cost, conversion_value, conversions, refunds, account_name, reconcile_note, effective_status, campaign_status, campaign_status_reasons';

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
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block' }} aria-hidden="true">
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

/** ROI no formato brasileiro: "12,5%", "1.200%". */
function formatPct(val: number, digits = 0) {
  return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format((val || 0) / 100);
}

/** Contorno de foco para controles que tiram o contorno padrão. */
const FOCUS_RING = 'rounded-md focus-visible:ring-2 focus-visible:ring-indigo-500';

/**
 * Texto da marca de problema da conferência com o Google. Só existe para o
 * que a correção automática não resolveu — o que foi corrigido não aparece.
 */
function reconcileProblemText(note: any, currency: string): string {
  const m = (v: any) => `${currency} ${Number(v || 0).toFixed(2)}`;
  if (note.kind === 'sobrando') {
    return `Gasto que o Google não tem: o painel mostra ${m(note.panel?.cost)} neste dia, mas o Google não registra gasto para esta campanha. Pode ser campanha duplicada no painel. Nada foi alterado.`;
  }
  const g = note.google || {}, p = note.panel || {};
  const linhas = (note.fields || []).map((f: string) =>
    f === 'custo' ? `Custo: painel ${m(p.cost)} · Google ${m(g.cost)}`
    : f === 'cliques' ? `Cliques: painel ${p.clicks} · Google ${g.clicks}`
    : f === 'impressões' ? `Impressões: painel ${p.impressions} · Google ${g.impressions}`
    : `Conversões: painel ${p.conversions} · Google ${g.conversions}`);
  return ['Não confere com o Google e a correção automática não resolveu.', ...linhas, note.source ? `Gravado por: ${note.source}.` : ''].filter(Boolean).join('\n');
}

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
  const [quickEntry, setQuickEntry] = useState<QuickEntryTarget | null>(null);
  const [metricSort, setMetricSort] = useState<MetricSort>('cost');

  const [selectedMcc, setSelectedMcc] = useState<string>('all');
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  // Ao abrir os filtros, o foco vai para dentro do painel (botão de fechar).
  const filterCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (showFilterSheet) filterCloseRef.current?.focus(); }, [showFilterSheet]);
  const { groups, setGroups } = useCampaignGroups();

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
      if (savedTheme) { setTheme(savedTheme); }
    applyTheme(savedTheme || 'dark');
      setMetricSort(loadMetricSort());

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
          if (isValidDay(savedStart)) { setStartDate(savedStart!); initialFromDate = savedStart!; }
          if (isValidDay(savedEnd)) setEndDate(savedEnd!);
        } else {
          handlePresetChange(savedDateRange);
        }
      } else {
        handlePresetChange('this_month');
      }

      // Com a cotação da última visita guardada, a tela não espera o site de
      // câmbio responder: abre com ela e troca quando a nova chegar.
      let hasCachedRates = false;
      try {
        const cached = JSON.parse(localStorage.getItem(RATES_KEY) || 'null');
        if (cached?.USD > 0 && cached?.EUR > 0) { setLiveDollar(cached.USD); setLiveEuro(cached.EUR); hasCachedRates = true; }
      } catch { /* sem armazenamento */ }
      const rates = fetchLiveRates();
      await Promise.all([
        fetchInitialData(session.user.id, initialFromDate),
        hasCachedRates ? null : rates,
      ]);

      setLoading(false);
    }
    init();
  }, []);

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

  async function fetchLiveRates() {
    try {
      const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const usd = parseFloat(data.USDBRL?.bid), eur = parseFloat(data.EURBRL?.bid);
      if (usd > 0) setLiveDollar(usd);
      if (eur > 0) setLiveEuro(eur);
      if (usd > 0 && eur > 0) localStorage.setItem(RATES_KEY, JSON.stringify({ USD: usd, EUR: eur }));
    } catch (e) { console.error(e); }
  }

  async function fetchInitialData(userId: string, fromDate?: string) {
    const { data: allProducts } = await fetchAllRows(() => supabase
      .from('products')
      .select('id, currency, name, google_ads_campaign_name, google_ads_campaign_id, account_name, mcc_name, google_status, google_status_reasons, status')
      .eq('user_id', userId)
      .order('id'));
    setProducts(allProducts);

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

      let sixtyDaysAgoStr: string;
      if (fromDate) {
        sixtyDaysAgoStr = fromDate;
      } else {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        sixtyDaysAgoStr = getLocalYYYYMMDD(sixtyDaysAgo);
      }
      setFetchedFrom(sixtyDaysAgoStr);

      // Só as colunas que a tela usa: a linha inteira tem ~40 colunas e pesava
      // quase 5 vezes mais para baixar.
      const { data: allMetrics } = await fetchByProducts(productIds, chunk => supabase
        .from('daily_metrics')
        .select(METRIC_COLUMNS)
        .in('product_id', chunk)
        .gte('date', sixtyDaysAgoStr)
        .order('date', { ascending: false })
        .order('id'));
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

  // Campanha por id: a conta do painel passa por milhares de linhas de números.
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const processedData = useMemo(() => {
    if (loading || !metrics.length) return { chart: [], table: [], totals: null, blocks: [] as any[] };

    const dailyMap = new Map();

    metrics.forEach(row => {
      if (row.date < startDate || row.date > endDate) return;

      const product = productById.get(row.product_id);
      const mccName = product?.mcc_name?.trim() ? product.mcc_name : 'Contas Individuais';
      if (selectedMcc !== 'all' && mccName !== selectedMcc) return;

      // Grupos do usuário: bloco desmarcado fica fora de tudo.
      const campaignName = product?.name || 'Venda Externa';
      const blockId = blockOf(campaignName, groups.list);
      if (groups.hidden.includes(blockId)) return;

      const isUSD = product?.currency === 'USD';
      const isEUR = product?.currency === 'EUR';

      const accountName = row.account_name || product?.account_name || product?.mcc_name || 'Desconhecida';

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
        dailyMap.set(row.date, { date: row.date, cost: 0, revenue: 0, profit: 0, refunds: 0, accounts: {}, blocks: {} });
      }
      const day = dailyMap.get(row.date);
      day.cost += cost; day.revenue += revenue; day.refunds += refunds; day.profit += profit;

      if (!day.blocks[blockId]) {
        day.blocks[blockId] = { id: blockId, cost: 0, revenue: 0, profit: 0, refunds: 0, accounts: {} };
      }
      const block = day.blocks[blockId];
      block.cost += cost; block.revenue += revenue; block.refunds += refunds; block.profit += profit;

      // O badge mostra o estado ATUAL da campanha, não o daquele dia: quando uma
      // conta é suspensa hoje, o que importa é ver isso ao lado de qualquer data,
      // e não descobrir que em 02/09 ela ainda rodava. É também o mesmo status
      // que a aba Campanhas exibe. Sem produto (venda externa), usa a linha.
      const rowStatus = product ? resolveProductStatus(product) : resolveCampaignStatus(row);
      // Problema que a conferência com o Google não conseguiu corrigir.
      const note = row.reconcile_note;
      const hasProblem = note && (note.kind === 'sobrando' || note.kind === 'divergente');

      // A mesma linha entra no dia inteiro e no bloco do grupo dela.
      [day, block].forEach((holder: any) => {
        if (!holder.accounts[accountName]) {
          holder.accounts[accountName] = { name: accountName, cost: 0, revenue: 0, profit: 0, refunds: 0, campaigns: {} };
        }
        const acc = holder.accounts[accountName];
        acc.cost += cost; acc.revenue += revenue; acc.profit += profit; acc.refunds += refunds;

        if (!acc.campaigns[campaignName]) {
          acc.campaigns[campaignName] = { name: campaignName, cost: 0, revenue: 0, profit: 0, refunds: 0, productId: product?.id, currency: product?.currency || 'BRL', status: null as CampaignStatus | null };
        }
        const cmp = acc.campaigns[campaignName];
        cmp.cost += cost; cmp.revenue += revenue; cmp.profit += profit; cmp.refunds += refunds;

        if (hasProblem && !cmp.problem) {
          cmp.problem = { text: reconcileProblemText(note, product?.currency || 'BRL') };
          if (holder === day) day.problems = (day.problems || 0) + 1;
        }

        const prevStatus: CampaignStatus | null = cmp.status;
        if (!prevStatus || STATUS_SEVERITY[rowStatus.key] > STATUS_SEVERITY[prevStatus.key]) {
          cmp.status = rowStatus;
        }
      });
    });

    // Dentro de cada dia, conta e campanha vêm ordenadas pela métrica escolhida.
    // Os blocos seguem a ordem dos grupos, com "Principais" na frente.
    const blockOrder = [MAIN_BLOCK, ...groups.list.map(g => g.id)];
    const blockTotals = new Map<string, any>();
    dailyMap.forEach((day: any) => {
      const sortAccounts = (holder: any) => {
        holder.accountList = sortByMetric(Object.values(holder.accounts) as any[], metricSort, (a: any) => a);
        holder.accountList.forEach((acc: any) => {
          acc.campaignList = sortByMetric(Object.values(acc.campaigns) as any[], metricSort, (c: any) => c);
        });
      };
      sortAccounts(day);
      day.blockList = blockOrder.filter(id => day.blocks[id]).map(id => day.blocks[id]);
      day.blockList.forEach((blk: any) => {
        sortAccounts(blk);
        blk.name = blockName(blk.id, groups.list);
        blk.roi = blk.cost > 0 ? (blk.profit / blk.cost) * 100 : 0;
        const t = blockTotals.get(blk.id) || { id: blk.id, name: blk.name, cost: 0, revenue: 0, profit: 0, refunds: 0, roi: 0 };
        t.cost += blk.cost; t.revenue += blk.revenue; t.profit += blk.profit; t.refunds += blk.refunds;
        blockTotals.set(blk.id, t);
      });
    });
    const blocks = blockOrder.filter(id => blockTotals.has(id)).map(id => {
      const t = blockTotals.get(id);
      return { ...t, roi: t.cost > 0 ? (t.profit / t.cost) * 100 : 0 };
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

    return { chart: chartData, table: resultRows, totals, blocks };
  }, [metrics, productById, startDate, endDate, liveDollar, manualDollar, liveEuro, manualEuro, viewCurrency, loading, selectedMcc, metricSort, groups]);

  // Com mais de um bloco na tela, cada dia abre separado por grupo.
  const showBlocks = processedData.blocks.length > 1;
  const campaignNames = useMemo(() => products.map(p => p.name || ''), [products]);

  // ── Alertas de gasto ──────────────────────────────────────────────────────
  // Campanha que hoje já gastou bem mais que o normal dela. A regra é a mesma
  // do alerta pelo Telegram (lib/alerts/spendRule). Valores na moeda da conta.
  const [seenAlerts, setSeenAlerts] = useState<string[]>([]);
  const todayStr = getLocalYYYYMMDD(new Date());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('autometrics_alerts_seen') || '{}');
      if (saved.day === todayStr && Array.isArray(saved.ids)) setSeenAlerts(saved.ids);
    } catch { /* primeira vez */ }
  }, [todayStr]);
  const markAlertSeen = (id: string) => {
    const ids = [...seenAlerts, id];
    setSeenAlerts(ids);
    try { localStorage.setItem('autometrics_alerts_seen', JSON.stringify({ day: todayStr, ids })); } catch { /* sem armazenamento */ }
  };

  const spendAlerts = useMemo(() => {
    if (loading || !metrics.length) return [];
    const from = new Date(); from.setDate(from.getDate() - 7);
    const fromStr = getLocalYYYYMMDD(from);
    const now = new Date();
    const dayPart = (now.getHours() * 60 + now.getMinutes()) / 1440;
    const byProduct = new Map<string, { today: number; sales: number; past: number; days: number }>();
    for (const row of metrics) {
      if (row.date < fromStr || row.date > todayStr) continue;
      const cost = Number(row.cost || 0);
      if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, { today: 0, sales: 0, past: 0, days: 0 });
      const p = byProduct.get(row.product_id)!;
      if (row.date === todayStr) { p.today += cost; p.sales += Number(row.conversions || 0); }
      else if (cost > 0) { p.past += cost; p.days++; }
    }
    const out: any[] = [];
    for (const [id, p] of byProduct) {
      const alert = spendAlert(p.today, p.past, p.days, dayPart);
      if (!alert) continue;
      const product = productById.get(id);
      if (!product) continue;
      const mccName = product.mcc_name?.trim() ? product.mcc_name : 'Contas Individuais';
      if (selectedMcc !== 'all' && mccName !== selectedMcc) continue;
      out.push({ id, name: product.name, currency: product.currency || 'BRL', today: p.today, normal: alert.normal, sales: p.sales, passed: alert.kind === 'passou', pace: alert.pace, over: alert.over });
    }
    return out.sort((a, b) => b.over - a.over);
  }, [metrics, productById, loading, selectedMcc, todayStr]);
  const openAlerts = spendAlerts.filter(a => !seenAlerts.includes(a.id));

  // ── Regras de margem ──────────────────────────────────────────────────────
  // As mesmas do Telegram (lib/alerts/marginRules), com os limites e o liga e
  // desliga escolhidos em Integração → Telegram. Sem essa leitura, valem os padrões.
  const [marginPrefs, setMarginPrefs] = useState({ prejuizo: { on: true, margin: 10 }, virada: { on: true, margin: 20, hour: 12 } });
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/telegram?settings=1', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } }).catch(() => null);
      const a = (await res?.json().catch(() => null))?.settings?.alerts;
      if (a?.prejuizo && a?.virada) setMarginPrefs({ prejuizo: a.prejuizo, virada: a.virada });
    })();
  }, [user]);

  const marginAlerts = useMemo(() => {
    if (loading || !metrics.length) return [];
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterdayStr = getLocalYYYYMMDD(y);
    const hourNow = new Date().getHours();
    const empty = (): DaySum => ({ cost: 0, revenue: 0, refunds: 0, sales: 0 });
    const byProduct = new Map<string, { today: DaySum; yesterday: DaySum }>();
    for (const row of metrics) {
      if (row.date !== todayStr && row.date !== yesterdayStr) continue;
      if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, { today: empty(), yesterday: empty() });
      const d = byProduct.get(row.product_id)![row.date === todayStr ? 'today' : 'yesterday'];
      d.cost += Number(row.cost || 0); d.revenue += Number(row.conversion_value || 0); d.refunds += Number(row.refunds || 0); d.sales += Number(row.conversions || 0);
    }
    const out: any[] = [];
    for (const [id, p] of byProduct) {
      const product = productById.get(id);
      if (!product) continue;
      const mccName = product.mcc_name?.trim() ? product.mcc_name : 'Contas Individuais';
      if (selectedMcc !== 'all' && mccName !== selectedMcc) continue;
      const base = { name: product.name, currency: product.currency || 'BRL', today: p.today, yesterday: p.yesterday, productId: id };
      const turn = marginPrefs.virada.on ? turnAlert(p.yesterday, p.today, hourNow, marginPrefs.virada.margin, marginPrefs.virada.hour) : null;
      // A virada já diz que hoje está no vermelho: não repete o aviso de custo passando da receita.
      if (turn) { out.push({ ...base, id: `virada:${id}`, kind: 'virada', turn, weight: 2 }); continue; }
      const loss = marginPrefs.prejuizo.on ? lossAlert(p.today, marginPrefs.prejuizo.margin) : null;
      if (loss) out.push({ ...base, id: `prejuizo:${loss.level}:${id}`, kind: 'prejuizo', loss, weight: loss.level === 'perdendo' ? 1 : 0 });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }, [metrics, productById, loading, selectedMcc, todayStr, marginPrefs]);
  const openMarginAlerts = marginAlerts.filter(a => !seenAlerts.includes(a.id));

  // Vendas que chegaram e ainda não foram marcadas como vistas (lib/saleAlerts.ts).
  const pendingSales = usePendingSales();

  // A coleta roda de hora em hora: o painel aberto relê os dados a cada 20
  // minutos, para o alerta aparecer sem precisar recarregar a página.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => { fetchInitialData(user.id, fetchedFrom || undefined); }, 20 * 60 * 1000);
    return () => clearInterval(timer);
  }, [user, fetchedFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Venda nova (ou custo novo) sem recarregar a página: só as linhas de ontem e de hoje que mudaram, a cada
  // 30 segundos. A releitura completa continua sendo a de 20 minutos, acima.
  const productIds = useMemo(() => new Set(products.map(p => p.id)), [products]);
  useLiveMetrics(supabase, !!user && !loading, setMetrics, { accept: row => productIds.has(row.product_id) });

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

  // Visual pelo guia (DESIGN.md, direção Linear): cores pelos tokens do tema,
  // números neutros e cor só no resultado (lucro, ROI).
  const isDark = theme === 'dark';
  const bgMain = 'bg-canvas text-ink-muted';
  const textHead = 'text-ink';
  const tone = (v: number) => (v >= 0 ? 'text-pos' : 'text-neg');
  const navItem = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const navIdle = `${navItem} text-ink-subtle hover:bg-surface-2 hover:text-ink`;
  const iconBtn = 'w-8 h-8 flex items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors';
  const segGroup = 'flex items-center gap-1 p-1 rounded-lg border border-line bg-surface-1';
  const segItem = (on: boolean) => `rounded-md text-xs font-medium transition-colors ${on ? 'bg-surface-3 text-ink' : 'text-ink-subtle hover:text-ink'}`;
  const chip = (on: boolean) => `flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${on ? 'bg-surface-3 border-line-strong text-ink' : 'bg-surface-1 border-line text-ink-subtle hover:text-ink'}`;
  const field = 'bg-surface-1 border border-line-strong rounded-lg text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand';
  const th = 'px-4 py-2.5 text-xs font-medium text-ink-subtle';
  // Recharts e o desenho das linhas pedem a cor pronta: os mesmos valores dos tokens chart-*.
  const chartColor = isDark
    ? { revenue: '#7c86e0', cost: '#d9913f', profit: '#27a644', roi: '#9aa3ef', grid: '#23252a', axis: '#8a8f98', tipBg: '#0f1011', tipLine: '#34343a', tipText: '#f7f8f8' }
    : { revenue: '#5e6ad2', cost: '#c27a28', profit: '#1d7f38', roi: '#4b56be', grid: '#e2e4e8', axis: '#62666f', tipBg: '#ffffff', tipLine: '#cfd2d8', tipText: '#16171a' };

  const formatMoney = (val: number) => new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : viewCurrency === 'EUR' ? 'de-DE' : 'en-US', { style: 'currency', currency: viewCurrency }).format(val);
  const toggleExpand = (id: string) => setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));

  if (!authChecked) return <div className="min-h-screen bg-canvas" />;
  if (loading) return <div className={`${inter.className} min-h-screen ${bgMain} flex items-center justify-center`}>Carregando…</div>;

  const mobileKpiCards = processedData.totals ? [
    { label: 'Receita', value: processedData.totals.revenue, color: chartColor.revenue, data: sparklineData.revenue, isPositiveGood: true, isRoi: false, isResult: false },
    { label: 'Lucro', value: processedData.totals.profit, color: chartColor.profit, data: sparklineData.profit, isPositiveGood: true, isRoi: false, isResult: true },
    { label: 'Custo', value: processedData.totals.cost, color: chartColor.cost, data: sparklineData.cost, isPositiveGood: false, isRoi: false, isResult: false },
    { label: 'ROI', value: processedData.totals.roi, color: chartColor.roi, data: sparklineData.roi, isPositiveGood: true, isRoi: true, isResult: true },
    { label: 'Reembolsos', value: processedData.totals.refunds, color: chartColor.cost, data: sparklineData.refunds, isPositiveGood: false, isRoi: false, isResult: false },
  ] : [];

  const NAV_ITEMS = [
    { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', short: 'Dashboard' },
    { href: '/planning', Icon: Target, label: 'Metas', short: 'Metas' },
    { href: '/products', Icon: Package, label: 'Campanhas', short: 'Campanhas' },
    { href: '/analise-ia', Icon: Sparkles, label: 'Análise de IA', short: 'Análise IA' },
    { href: '/rastreamento', Icon: Route, label: 'Rastreamento', short: 'Rastreio' },
    { href: '/integration', Icon: Settings, label: 'Integração', short: 'Integração' },
  ];

  const kpis = processedData.totals ? [
    { label: 'Receita', value: formatMoney(processedData.totals.revenue), cls: textHead },
    { label: 'Custo', value: formatMoney(processedData.totals.cost), cls: textHead },
    { label: 'Lucro líquido', value: formatMoney(processedData.totals.profit), cls: tone(processedData.totals.profit) },
    { label: 'ROI', value: formatPct(processedData.totals.roi, 1), cls: tone(processedData.totals.roi) },
    { label: 'Reembolsos', value: formatMoney(processedData.totals.refunds), cls: textHead },
  ] : [];

  const rateBox = (kind: 'USD' | 'EUR') => (
    <div className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg border border-line bg-surface-1 flex-1 sm:flex-none sm:min-w-[180px]">
      <div className="flex flex-col">
        <span className="text-xs font-medium text-ink-subtle">{kind === 'USD' ? 'Dólar hoje' : 'Euro hoje'}</span>
        <span className="text-sm font-medium tabular-nums text-ink">R$ {(kind === 'USD' ? liveDollar : liveEuro).toFixed(2).replace('.', ',')}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-xs font-medium text-ink-subtle">{kind === 'USD' ? 'Meu dólar' : 'Meu euro'}</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-subtle">R$</span>
          <input type="text" inputMode="decimal" aria-label={kind === 'USD' ? 'Meu dólar, em reais' : 'Meu euro, em reais'}
            className="w-14 text-right bg-transparent text-sm font-medium tabular-nums text-ink outline-none border-b border-line-strong focus:border-brand transition-colors pb-0.5"
            value={kind === 'USD' ? dollarInput : euroInput}
            onChange={(e) => (kind === 'USD' ? handleDollarInputChange(e.target.value) : handleEuroInputChange(e.target.value))}
            onBlur={kind === 'USD' ? handleDollarInputBlur : handleEuroInputBlur}
          />
          <div className="flex flex-col ml-0.5">
            <button type="button" onClick={() => (kind === 'USD' ? handleDollarStep(0.01) : handleEuroStep(0.01))} aria-label={`Subir o ${kind === 'USD' ? 'dólar' : 'euro'} em 1 centavo`} className="p-0.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"><ChevronUp size={12} aria-hidden="true" /></button>
            <button type="button" onClick={() => (kind === 'USD' ? handleDollarStep(-0.01) : handleEuroStep(-0.01))} aria-label={`Baixar o ${kind === 'USD' ? 'dólar' : 'euro'} em 1 centavo`} className="p-0.5 rounded text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"><ChevronDown size={12} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </div>
  );

  const quickEntryButton = (cmp: any, date: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); setQuickEntry({ productId: cmp.productId, productName: cmp.name, accountCurrency: cmp.currency, date }); }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border bg-pos/10 text-pos border-pos/30 hover:bg-pos/20 transition-colors"
      title={`Lançar vendas de ${date.split('-').reverse().join('/')}`}
    >
      <FileText size={12} aria-hidden="true" /> Lançar
    </button>
  );

  // Pausar/ativar no Google Ads, antes do nome da campanha.
  const statusToggle = (cmp: any) => {
    const product = cmp.productId && productById.get(cmp.productId);
    if (!product) return null;
    return (
      <CampaignStatusToggle product={product} isDark={isDark} tokens
        onChanged={(patch) => setProducts(prev => prev.map(p => p.id === product.id ? { ...p, ...patch } : p))} />
    );
  };

  return (
    <div className={`${inter.className} min-h-screen font-sans flex ${bgMain}`}>

      {/* ─── DESKTOP SIDEBAR (hidden on mobile) ─── */}
      <aside className="hidden md:flex md:w-60 shrink-0 border-r border-line bg-surface-1 flex-col sticky top-0 h-screen z-20">
        <div className="h-16 flex items-center justify-start px-5 border-b border-line overflow-hidden shrink-0">
          <Logo />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ href, Icon, label }) => href === '/dashboard' ? (
            <Link key={href} href={href} aria-current="page" className={`${navItem} bg-surface-2 text-ink`}>
              <Icon size={18} aria-hidden="true" className="text-brand-text" /> <span>{label}</span>
            </Link>
          ) : (
            <Link key={href} href={href} className={navIdle}>
              <Icon size={18} aria-hidden="true" /> <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-line">
          <button onClick={handleLogout} className={`${navItem} text-ink-subtle hover:text-neg hover:bg-neg/10`}>
            <LogOut size={18} aria-hidden="true" /> <span className="truncate">Sair ({user?.email?.split('@')[0]})</span>
          </button>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <main className="flex-1 min-w-0 p-4 md:p-8 overflow-y-auto pb-24 md:pb-8">

        {/* ── DESKTOP HEADER & FILTERS (hidden on mobile) ── */}
        <header className="hidden md:flex flex-col gap-4 mb-6">
          <div className="flex justify-between items-start gap-4">
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-ink">Visão geral</h1>
              <p className="text-sm text-ink-subtle">Seus resultados consolidados no período.</p>
            </div>
            <button type="button" onClick={toggleTheme} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} className={iconBtn}>
              {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
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
                  {availableMccs.map(mcc => <option key={mcc} value={mcc}>{mcc}</option>)}
                </select>
              </div>
            )}

            <div className="flex items-center h-9 rounded-lg border border-line bg-surface-1">
              <div className="flex items-center gap-2 px-3 h-full border-r border-line">
                <Calendar size={16} aria-hidden="true" className="text-ink-subtle"/>
                <select
                  aria-label="Período"
                  className={`bg-transparent text-sm font-medium outline-none cursor-pointer ${FOCUS_RING} text-ink w-auto`}
                  value={dateRange}
                  onChange={(e) => handlePresetChange(e.target.value)}
                >
                  <option value="today">Hoje</option>
                  <option value="yesterday">Ontem</option>
                  <option value="7d">7 dias</option>
                  <option value="30d">30 dias</option>
                  <option value="this_month">Este mês</option>
                  <option value="last_month">Mês passado</option>
                  <option value="custom">Personalizado</option>
                </select>
              </div>
              <div className="flex items-center gap-2 px-3">
                <input
                  type="date"
                  aria-label="Data inicial"
                  className={`bg-transparent w-[112px] text-xs tabular-nums outline-none cursor-pointer ${FOCUS_RING} text-ink ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                  value={startInput.value}
                  onChange={(e) => startInput.onChange(e.target.value)}
                />
                <span className="text-ink-subtle text-xs">até</span>
                <input
                  type="date"
                  aria-label="Data final"
                  className={`bg-transparent w-[112px] text-xs tabular-nums outline-none cursor-pointer ${FOCUS_RING} text-ink ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                  value={endInput.value}
                  onChange={(e) => endInput.onChange(e.target.value)}
                />
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

        {/* ── MOBILE HEADER (hidden on desktop) ── */}
        <div className="flex md:hidden items-center justify-between px-1 pt-1 pb-3">
          <div>
            <h1 className="text-xl font-semibold leading-tight text-ink">Visão geral</h1>
            <p className="text-xs text-ink-subtle mt-0.5">
              {dateRange !== 'custom'
                ? DATE_PRESET_LABELS[dateRange] ?? 'Período personalizado'
                : `${startDate ? startDate.split('-').reverse().join('/') : '—'} → ${endDate ? endDate.split('-').reverse().join('/') : '—'}`
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} className={`${iconBtn} w-9 h-9`}>
              {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <button onClick={() => setShowFilterSheet(true)} aria-label="Abrir filtros" aria-expanded={showFilterSheet} className={`${iconBtn} w-9 h-9`}>
              <SlidersHorizontal size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* ── MOBILE DATE CHIPS (hidden on desktop) ── */}
        <div className="flex md:hidden gap-2 px-1 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          {DATE_PRESETS.map(preset => (
            <button key={preset} onClick={() => handlePresetChange(preset)} aria-pressed={dateRange === preset} className={chip(dateRange === preset)}>
              {DATE_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>

        {/* Vendas e alertas chegam sozinhos: o leitor de tela avisa quando aparecem. */}
        <div aria-live="polite">
        {/* ── VENDAS NOVAS ── ficam aqui até serem marcadas como vistas */}
        {pendingSales.length > 0 && (
          <div className="rounded-xl border border-pos/30 bg-pos/5 mb-4 overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-pos" aria-hidden="true" />
              <span className="text-[13px] font-medium text-pos">{pendingSales.length === 1 ? '1 venda nova' : `${pendingSales.length} vendas novas`}</span>
              {pendingSales.length > 1 && (
                <button onClick={closeAllSales} className="ml-auto text-xs font-medium text-ink-subtle hover:text-ink">Marcar todas como vistas</button>
              )}
            </div>
            {pendingSales.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2 border-t border-pos/15">
                <div className="flex-1 min-w-0">
                  <Link href={`/products/${s.productId}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium break-words text-ink hover:underline">{s.productName}</Link>
                  <div className="text-xs text-ink-subtle">
                    <span className="font-medium text-pos tabular-nums">{saleMoney(s.amount, s.currency)}</span> · {s.platform} · {new Date(s.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às')}
                  </div>
                </div>
                <button onClick={() => closeSale(s.id)} className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border border-line text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
                  Visto
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── REGRAS DE MARGEM ── */}
        {openMarginAlerts.length > 0 && (
          <div className="rounded-xl border border-neg/30 bg-neg/5 mb-4 overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-neg">
              <AlertTriangle size={15} aria-hidden="true" />
              <span className="text-[13px] font-medium">Campanhas para olhar agora · {openMarginAlerts.length}</span>
            </div>
            {openMarginAlerts.map(a => {
              const m = (v: number) => new Intl.NumberFormat(a.currency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: a.currency }).format(v);
              const signed = (v: number) => `${v >= 0 ? '+' : '−'}${m(Math.abs(v))}`;
              const pct = (v: number) => `${Math.round(v)}%`;
              return (
                <div key={a.id} className="flex items-start gap-3 px-4 py-2 border-t border-neg/15">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-neg">
                      {a.kind === 'virada' ? 'Dia apertado seguido de manhã ruim' : a.loss.level === 'perdendo' ? 'Custo passou da receita' : 'Custo empatando com a receita'}
                    </div>
                    <Link href={`/products/${a.productId}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium break-words text-ink hover:underline">{a.name}</Link>
                    <div className="text-xs text-ink-subtle">
                      {a.kind === 'virada'
                        ? <>Ontem fechou com {signed(a.turn.yesterday)} ({pct(a.turn.yesterdayMargin)} sobre o custo). Hoje até agora: custo {m(a.today.cost)}, receita {m(a.today.revenue)}, resultado {signed(a.turn.today)}.</>
                        : <>Hoje: custo {m(a.today.cost)}, receita {m(a.today.revenue)}, {String(a.today.sales).replace('.', ',')} {a.today.sales === 1 ? 'venda' : 'vendas'}. Resultado {signed(a.loss.result)} ({pct(a.loss.margin)} sobre o custo).</>}
                    </div>
                  </div>
                  <button onClick={() => markAlertSeen(a.id)} className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border border-line text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
                    Visto
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── ALERTAS DE GASTO ── */}
        {openAlerts.length > 0 && (
          <div className="rounded-xl border border-warn/30 bg-warn/5 mb-4 overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-warn">
              <AlertTriangle size={15} aria-hidden="true" />
              <span className="text-[13px] font-medium">Gasto acima do normal hoje · {openAlerts.length} {openAlerts.length === 1 ? 'campanha' : 'campanhas'}</span>
            </div>
            {openAlerts.map(a => {
              const m = (v: number) => new Intl.NumberFormat(a.currency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency: a.currency }).format(v);
              return (
                <div key={a.id} className="flex items-start gap-3 px-4 py-2 border-t border-warn/15">
                  <div className="flex-1 min-w-0">
                    <Link href={`/products/${a.id}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium break-words text-ink hover:underline">{a.name}</Link>
                    <div className="text-xs text-ink-subtle">
                      {a.passed
                        ? <>Já gastou {m(a.today)} hoje, {Math.round((a.over - 1) * 100)}% acima de um dia normal ({m(a.normal)}).</>
                        : <>Gastou {m(a.today)} até agora: no ritmo de fechar o dia em {m(a.pace)}, contra {m(a.normal)} de um dia normal.</>}
                      {' '}{a.sales > 0 ? `${String(a.sales).replace('.', ',')} ${a.sales === 1 ? 'venda' : 'vendas'} hoje.` : 'Nenhuma venda hoje.'}
                    </div>
                  </div>
                  <button onClick={() => markAlertSeen(a.id)} className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border border-line text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
                    Visto
                  </button>
                </div>
              );
            })}
          </div>
        )}
        </div>

        {/* ── MOBILE KPI GRID 2x2 (hidden on desktop) ── */}
        {processedData.totals && (
          <div className="md:hidden grid grid-cols-2 gap-3 px-1 pb-3">
            {mobileKpiCards.slice(0, 4).map(({ label, value, color, data, isPositiveGood, isRoi, isResult }) => {
              const trend = trendPct(data);
              const trendUp = trend >= 0;
              const trendGood = isPositiveGood ? trendUp : !trendUp;
              return (
                <div key={label} className="rounded-xl border border-line bg-surface-1 p-3">
                  <div className="text-xs font-medium text-ink-subtle mb-1">{label}</div>
                  <div className={`text-base font-semibold tabular-nums leading-tight mb-1.5 ${isResult ? tone(value) : 'text-ink'}`}>
                    {isRoi ? formatPct(value, 1) : formatMoney(value)}
                  </div>
                  {data.length >= 2 && (
                    <div className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded mb-1.5 ${trendGood ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg'}`}>
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
          <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 mb-6">
            {kpis.map(k => (
              <div key={k.label} className="rounded-xl border border-line bg-surface-1 p-4">
                <p className="text-xs font-medium text-ink-subtle mb-1.5">{k.label}</p>
                <p className={`text-2xl font-semibold tabular-nums tracking-[-0.3px] ${k.cls}`}>{k.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="hidden md:block text-center py-16 rounded-xl mb-6 border border-dashed border-line">
            <p className="text-sm text-ink-subtle">Nenhum dado neste período. Troque o período ou a MCC acima.</p>
          </div>
        )}

        {/* ── BAR CHART (desktop only) ── */}
        <div className="hidden md:block rounded-xl border border-line bg-surface-1 p-4 md:p-5 mb-6" style={{ height: '14rem' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={processedData.chart}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColor.grid} vertical={false} />
              <XAxis dataKey="shortDate" stroke={chartColor.axis} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke={chartColor.axis} fontSize={11} tickLine={false} axisLine={false} hide={true} />
              <Tooltip cursor={{ fill: chartColor.grid, opacity: 0.4 }} contentStyle={{ backgroundColor: chartColor.tipBg, borderColor: chartColor.tipLine, borderRadius: 8, color: chartColor.tipText, fontSize: 12 }} formatter={(val: any) => formatMoney(val)} />
              <Legend wrapperStyle={{ fontSize: 12, color: chartColor.axis }} iconType="circle" iconSize={8} />
              <Bar dataKey="revenue" name="Receita" fill={chartColor.revenue} radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="cost" name="Custo" fill={chartColor.cost} radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="profit" name="Lucro" fill={chartColor.profit} radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <CampaignGroupsBar groups={groups} onChange={setGroups} campaignNames={campaignNames} isDark={isDark} tokens />

        {/* Total de cada grupo no período, quando há mais de um bloco marcado. */}
        {showBlocks && (
          <div className="rounded-xl border border-line bg-surface-1 overflow-x-auto mb-4">
            <table className="w-full text-[13px] text-left border-collapse tabular-nums">
              <thead className="bg-surface-2">
                <tr>
                  <th className={th}>Grupo</th>
                  <th className={`${th} text-right`}>Receita</th>
                  <th className={`${th} text-right`}>Custo</th>
                  <th className={`${th} text-right`}>Lucro</th>
                  <th className={`${th} text-right`}>ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {processedData.blocks.map((blk: any) => (
                  <tr key={blk.id}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap text-ink">{blk.name}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-ink-muted">{formatMoney(blk.revenue)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-ink-muted">{formatMoney(blk.cost)}</td>
                    <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${tone(blk.profit)}`}>{formatMoney(blk.profit)}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${tone(blk.roi)}`}>{formatPct(blk.roi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Ordenação das campanhas dentro de cada data. */}
        <div className="flex items-center justify-end gap-2 mb-3 flex-wrap">
          <span className="text-xs font-medium text-ink-subtle">Ordenar campanhas por</span>
          <div className={segGroup}>
            {METRIC_SORTS.map(opt => (
              <button
                key={opt.key}
                onClick={() => { setMetricSort(opt.key); saveMetricSort(opt.key); }}
                aria-pressed={metricSort === opt.key}
                className={`px-3 py-1 ${segItem(metricSort === opt.key)}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── DESKTOP TABLE (hidden on mobile) ── */}
        <div className="hidden md:block rounded-xl border border-line bg-surface-1 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] text-left border-collapse tabular-nums">
              <thead className="bg-surface-2">
                <tr>
                  <th className={`${th} w-10`}></th>
                  <th className={th}>Data</th>
                  <th className={`${th} text-right`}>Receita</th>
                  <th className={`${th} text-right`}>Custo</th>
                  <th className={`${th} text-right`}>Lucro</th>
                  <th className={`${th} text-right`}>ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {processedData.table.map((row: any) => {
                  const dateParts = row.date.split('-');
                  const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                  const isExpanded = expandedRows[row.date];
                  return (
                    <React.Fragment key={row.date}>
                      <tr onClick={() => toggleExpand(row.date)} className={`transition-colors cursor-pointer hover:bg-surface-2 ${isExpanded ? 'bg-surface-2' : ''}`}>
                        <td className="px-4 py-2.5 text-center">
                          {/* A linha inteira abre com o mouse; este botão é o caminho pelo teclado. */}
                          {Object.keys(row.accounts).length > 0 && (
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); toggleExpand(row.date); }}
                              aria-expanded={!!isExpanded}
                              aria-label={`${isExpanded ? 'Fechar' : 'Abrir'} o dia ${formattedDate}`}
                              className={`inline-flex p-1 text-ink-subtle hover:text-ink ${FOCUS_RING}`}>
                              {isExpanded ? <ChevronDown size={16} aria-hidden="true"/> : <ChevronRight size={16} aria-hidden="true"/>}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-ink">
                          {formattedDate}
                          {row.problems > 0 && (
                            <span title={`${row.problems} campanha(s) com valor que não confere com o Google. Abra o dia para ver.`}
                              className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-warn/10 text-warn align-middle cursor-help">
                              <AlertTriangle size={11} aria-hidden="true" /> {row.problems}
                              <span className="sr-only">{row.problems === 1 ? 'campanha' : 'campanhas'} com valor que não confere com o Google</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink">{formatMoney(row.revenue)}</td>
                        <td className="px-4 py-2.5 text-right text-ink-muted">{formatMoney(row.cost)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${tone(row.profit)}`}>{formatMoney(row.profit)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${tone(row.roi)}`}>{formatPct(row.roi)}</td>
                      </tr>
                      {isExpanded && (showBlocks ? row.blockList : [{ id: 'all', accountList: row.accountList }]).map((blk: any) => (
                      <React.Fragment key={blk.id}>
                      {showBlocks && (
                        <tr className="bg-surface-2">
                          <td></td>
                          <td className="px-4 py-2 pl-6 text-xs font-medium text-ink">{blk.name}</td>
                          <td className="px-4 py-2 text-right text-ink-muted">{formatMoney(blk.revenue)}</td>
                          <td className="px-4 py-2 text-right text-ink-muted">{formatMoney(blk.cost)}</td>
                          <td className={`px-4 py-2 text-right font-medium ${tone(blk.profit)}`}>{formatMoney(blk.profit)}</td>
                          <td className={`px-4 py-2 text-right font-medium ${tone(blk.roi)}`}>{formatPct(blk.roi)}</td>
                        </tr>
                      )}
                      {(blk.accountList || []).map((acc: any) => (
                        <React.Fragment key={acc.name}>
                          <tr className="bg-canvas/40">
                            <td></td>
                            <td className="px-4 py-2 pl-8 font-medium text-ink">
                              <span className="inline-flex items-center gap-2"><Settings size={12} aria-hidden="true" className="text-ink-subtle"/> {acc.name}</span>
                            </td>
                            <td className="px-4 py-2 text-right text-ink-muted">{formatMoney(acc.revenue)}</td>
                            <td className="px-4 py-2 text-right text-ink-muted">{formatMoney(acc.cost)}</td>
                            <td className={`px-4 py-2 text-right font-medium ${tone(acc.profit)}`}>{formatMoney(acc.profit)}</td>
                            <td></td>
                          </tr>
                          {(acc.campaignList || []).map((cmp: any) => (
                            <tr key={cmp.name} className="bg-canvas/40">
                              <td></td>
                              <td className="px-4 py-2 pl-14">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {statusToggle(cmp)}
                                  {cmp.productId ? (
                                    <Link href={`/products/${cmp.productId}`} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-brand-text hover:underline transition-colors">
                                      {cmp.name}
                                    </Link>
                                  ) : <span className="text-ink">{cmp.name}</span>}
                                  {cmp.status && (
                                    <span
                                      title={cmp.status.hint}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium shrink-0 ${cmp.status.badge}`}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${cmp.status.dot}`} />
                                      {cmp.status.label}
                                      {cmp.status.hint && <span className="sr-only">: {cmp.status.hint}</span>}
                                    </span>
                                  )}
                                  {cmp.problem && (
                                    <span title={cmp.problem.text}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-warn/10 text-warn shrink-0 cursor-help">
                                      <AlertTriangle size={11} aria-hidden="true" /> não confere
                                      <span className="sr-only">: {cmp.problem.text}</span>
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right text-ink-muted">{formatMoney(cmp.revenue)}</td>
                              <td className="px-4 py-2 text-right text-ink-muted">{formatMoney(cmp.cost)}</td>
                              <td className={`px-4 py-2 text-right ${tone(cmp.profit)}`}>{formatMoney(cmp.profit)}</td>
                              <td className="px-4 py-2 text-right">
                                {cmp.productId && quickEntryButton(cmp, row.date)}
                              </td>
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
            </table>
          </div>
        </div>

        {/* ── MOBILE DAY ROWS (hidden on desktop) ── */}
        <div className="md:hidden">
          {processedData.table.length === 0 ? (
            <div className="text-center py-10 rounded-xl border border-dashed border-line">
              <p className="text-ink-subtle text-sm">Nenhum dado neste período. Troque o período nos filtros.</p>
            </div>
          ) : (
            <>
              <div className="text-xs font-medium text-ink-subtle mb-2 px-1">Dia a dia</div>
              <div className="rounded-xl overflow-hidden border border-line bg-surface-1">
                {processedData.table.map((row: any) => {
                  const dp = row.date.split('-');
                  const fmt = `${dp[2]}/${dp[1]}`;
                  const isExpanded = expandedRows[row.date];
                  return (
                    <React.Fragment key={row.date}>
                      <button
                        type="button"
                        onClick={() => toggleExpand(row.date)}
                        aria-expanded={!!isExpanded}
                        className={`w-full text-left flex items-center justify-between px-4 py-3 border-b border-line cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand active:bg-surface-2 ${isExpanded ? 'bg-surface-2' : ''}`}
                      >
                        <span className="flex items-center gap-3">
                          <span aria-hidden="true" className={`block text-xs w-3 text-ink-subtle transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                            {Object.keys(row.accounts).length > 0 ? '›' : ''}
                          </span>
                          <span className="block">
                            <span className="block text-sm font-medium text-ink">{fmt}</span>
                            <span className="block text-xs text-ink-subtle tabular-nums">{formatMoney(row.cost)} de custo</span>
                          </span>
                        </span>
                        <span className="block text-right">
                          <span className="block text-sm font-medium text-ink tabular-nums">{formatMoney(row.revenue)}</span>
                          <span className={`block text-xs font-medium tabular-nums ${tone(row.profit)}`}>
                            <span aria-hidden="true">{row.profit >= 0 ? '↑' : '↓'} </span>ROI {formatPct(row.roi)}
                          </span>
                        </span>
                      </button>

                      {isExpanded && (showBlocks ? row.blockList : [{ id: 'all', accountList: row.accountList }]).map((blk: any) => (
                      <React.Fragment key={blk.id}>
                      {showBlocks && (
                        <div className="flex items-center justify-between px-4 py-2 border-b border-line bg-surface-2">
                          <span className="text-xs font-medium text-ink">{blk.name}</span>
                          <span className={`text-xs font-medium tabular-nums ${tone(blk.profit)}`}>{formatMoney(blk.profit)}</span>
                        </div>
                      )}
                      {(blk.accountList || []).map((acc: any) => (
                        <React.Fragment key={acc.name}>
                          <div className="flex items-center justify-between px-5 py-2 border-b border-line bg-canvas/40">
                            <span className="text-xs font-medium text-ink break-words min-w-0 mr-2">{acc.name}</span>
                            <span className="text-xs text-ink-muted tabular-nums ml-2 shrink-0">{formatMoney(acc.revenue)}</span>
                          </div>
                          {(acc.campaignList || []).map((cmp: any) => (
                            <div key={cmp.name} className="px-6 py-2.5 border-b border-line bg-canvas/40">
                              <div className="flex items-start justify-between gap-2">
                                <span className="-my-1 shrink-0">{statusToggle(cmp)}</span>
                                <span className="text-[13px] break-words min-w-0 flex-1 text-ink">
                                  {cmp.productId ? (
                                    <Link href={`/products/${cmp.productId}`} className="hover:text-brand-text active:text-brand-text">
                                      {cmp.name}
                                    </Link>
                                  ) : cmp.name}
                                  {cmp.problem && (
                                    <span title={cmp.problem.text} className="ml-1.5 inline-flex align-middle text-warn">
                                      <AlertTriangle size={12} aria-hidden="true" />
                                      <span className="sr-only">Não confere com o Google: {cmp.problem.text}</span>
                                    </span>
                                  )}
                                </span>
                                <span className={`text-xs font-medium tabular-nums shrink-0 ${tone(cmp.profit)}`}>
                                  {formatMoney(cmp.profit)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-1.5">
                                {cmp.status ? (
                                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${cmp.status.text}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${cmp.status.dot}`} />
                                    {cmp.status.label}
                                  </span>
                                ) : <span />}
                                {cmp.productId && quickEntryButton(cmp, row.date)}
                              </div>
                            </div>
                          ))}
                        </React.Fragment>
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

      <QuickEntryModal
        target={quickEntry}
        onClose={() => setQuickEntry(null)}
        onSaved={() => { if (user) fetchInitialData(user.id, fetchedFrom || undefined); }}
        manualDollar={manualDollar}
        isDark={isDark}
      />

      {/* ─── MOBILE BOTTOM NAVIGATION ─── */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden z-40 border-t border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex justify-around items-center px-2 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map(({ href, Icon, short }) => {
            const active = href === '/dashboard';
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-lg transition-colors ${active ? 'text-brand-text' : 'text-ink-subtle'}`}>
                <Icon size={22} aria-hidden="true" />
                <span className="text-[10px] font-medium">{short}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ─── FILTER BOTTOM SHEET ─── */}
      {/* Fechado, o painel fica fora do alcance do teclado e do leitor de tela (inert). */}
      <div
        inert={!showFilterSheet}
        onKeyDown={(e) => { if (e.key === 'Escape') setShowFilterSheet(false); }}
        className={`fixed inset-0 z-50 md:hidden transition-opacity duration-300 ${showFilterSheet ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="absolute inset-0 bg-black/60" onClick={() => setShowFilterSheet(false)} />
        <div role="dialog" aria-modal="true" aria-labelledby="filter-sheet-title"
          className={`absolute bottom-0 inset-x-0 rounded-t-2xl border-t border-line-strong bg-surface-1 transition-transform duration-300 ease-out ${showFilterSheet ? 'translate-y-0' : 'translate-y-full'}`}>

          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-line-strong" />
          </div>

          <div className="flex items-center justify-between px-5 pb-3">
            <h3 id="filter-sheet-title" className="text-base font-semibold text-ink">Filtros</h3>
            <button ref={filterCloseRef} onClick={() => setShowFilterSheet(false)} aria-label="Fechar filtros" className={iconBtn}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="px-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)_+_1rem))] max-h-[80vh] overflow-y-auto" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>

            <div className="mb-5">
              <div className="text-xs font-medium text-ink-subtle mb-2">Período</div>
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map(preset => (
                  <button key={preset} onClick={() => handlePresetChange(preset)} aria-pressed={dateRange === preset} className={chip(dateRange === preset)}>
                    {DATE_PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <div className="text-xs font-medium text-ink-subtle mb-2">Datas personalizadas</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className="block text-xs text-ink-subtle mb-1">De</span>
                  <input type="date" value={startInput.value}
                    onChange={e => startInput.onChange(e.target.value)}
                    className={`w-full min-w-0 text-sm px-3 py-2 ${field} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="block text-xs text-ink-subtle mb-1">Até</span>
                  <input type="date" value={endInput.value}
                    onChange={e => endInput.onChange(e.target.value)}
                    className={`w-full min-w-0 text-sm px-3 py-2 ${field} ${isDark ? '[&::-webkit-calendar-picker-indicator]:invert' : ''}`}
                  />
                </label>
              </div>
            </div>

            {availableMccs.length > 0 && (
              <div className="mb-5">
                <label htmlFor="filter-sheet-mcc" className="block text-xs font-medium text-ink-subtle mb-2">MCC ou conta</label>
                <select id="filter-sheet-mcc" value={selectedMcc} onChange={e => handleMccChange(e.target.value)}
                  className={`w-full text-sm px-3 py-2 ${field}`}>
                  <option value="all">Todas as MCCs</option>
                  {availableMccs.map(mcc => <option key={mcc} value={mcc}>{mcc}</option>)}
                </select>
              </div>
            )}

            <div className="mb-5">
              <div className="text-xs font-medium text-ink-subtle mb-2">Moeda de exibição</div>
              <div className={segGroup} role="group" aria-label="Moeda de exibição">
                {(['BRL', 'USD', 'EUR'] as const).map(curr => (
                  <button key={curr} onClick={() => handleCurrencyChange(curr)} aria-pressed={viewCurrency === curr}
                    className={`flex-1 py-2 text-sm ${segItem(viewCurrency === curr)}`}>
                    {curr === 'BRL' ? 'R$ BRL' : curr === 'USD' ? 'US$ USD' : '€ EUR'}
                  </button>
                ))}
              </div>
            </div>

            {viewCurrency !== 'BRL' && (
              <div className="mb-5">
                <div className="text-xs font-medium text-ink-subtle mb-2">Câmbio manual — {rateConfig}</div>
                {rateBox(rateConfig)}
              </div>
            )}

            <button
              onClick={() => setShowFilterSheet(false)}
              className="w-full bg-brand hover:bg-brand-hover text-white font-medium py-3 rounded-lg text-sm transition-colors"
            >
              Aplicar filtros
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
