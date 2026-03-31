"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Columns, X, ArrowDownRight, ExternalLink, Calendar, Link as LinkIcon,
  PlayCircle, PauseCircle, RefreshCw, FileText, Save, Sun, Moon, ShoppingCart,
  Video, MousePointer, NotebookPen, Check, BarChart2, TrendingUp, Tv2, Settings2, Globe, BarChart, Hash
} from 'lucide-react';
import {
  BarChart as RechartsBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend
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

  // CUSTO (Onde está o Orçamento)
  { key: 'avg_cpc', label: 'CPC Médio', category: 'Custo', default: true, format: 'currency' },
  { key: 'cost', label: 'Custo Ads', category: 'Custo', default: true, format: 'currency' },
  { key: 'budget', label: 'Orçamento Diário', category: 'Custo', default: true, format: 'currency' },

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
  // ANOTAÇÕES
  { key: 'notes', label: 'Anotações', category: 'Geral', default: true },
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

  // --- ANOTAÇÕES & ESTRATÉGIA ---
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  
  const [campaignStrategy, setCampaignStrategy] = useState('');
  const [isSavingStrategy, setIsSavingStrategy] = useState(false);

  // --- DEEP METRICS (Search Terms, Audiences, Locations) ---
  const [searchTerms, setSearchTerms] = useState<any[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  // --- ABA VTURB ---
  const [activeTab, setActiveTab] = useState<'ads' | 'search_terms' | 'audiences' | 'locations' | 'strategy' | 'vturb'>('ads');
  const [vturbRows, setVturbRows] = useState<any[]>([]);
  const [vturbLoading, setVturbLoading] = useState(false);
  const [vturbError, setVturbError] = useState<string | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState(false);
  const [playerIdInput, setPlayerIdInput] = useState('');
  const [vturbBreakdown, setVturbBreakdown] = useState<{ device: any[]; country: any[] }>({ device: [], country: [] });

  // --- INICIALIZAÇÃO ---
  useEffect(() => {
    // 1. Tema e Moeda
    const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
    if (savedTheme) setTheme(savedTheme);

    const savedColumns = localStorage.getItem('autometrics_visible_columns');
    if (savedColumns) try { setVisibleColumns(JSON.parse(savedColumns)); } catch (e) { }

    const savedDollar = localStorage.getItem('autometrics_manual_dollar');
    if (savedDollar) setManualDollar(parseFloat(savedDollar));

    const savedViewCurrency = localStorage.getItem('autometrics_view_currency');
    if (savedViewCurrency) setViewCurrency(savedViewCurrency);

    fetchLiveDollar();

    // 2. Data Inicial
    setManualData(prev => ({ ...prev, date: getLocalYYYYMMDD(new Date()) }));
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
        setManualData(prev => ({ ...prev, currency: prodData.currency || 'BRL' }));
      }
      const { data: metricsData } = await supabase.from('daily_metrics').select('*').eq('product_id', productId).limit(10000).order('date', { ascending: true });
      setMetrics(metricsData || []);
      // Carregar anotações existentes
      const notesMap: Record<string, string> = {};
      (metricsData || []).forEach((m: any) => { if (m.notes) notesMap[m.date] = m.notes; });
      setNotes(notesMap);

      // Carregar Deep Metrics
      const { data: stData } = await supabase.from('search_terms').select('*').eq('product_id', productId);
      setSearchTerms(stData || []);
      
      const { data: audData } = await supabase.from('audiences').select('*').eq('product_id', productId);
      setAudiences(audData || []);

      const { data: locData } = await supabase.from('locations').select('*').eq('product_id', productId);
      setLocations(locData || []);

      const { data: stratData } = await supabase.from('campaign_strategies').select('strategy_text').eq('product_id', productId).maybeSingle();
      if (stratData) setCampaignStrategy(stratData.strategy_text || '');

    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  // --- VTurb: busca dados por dia ---
  const fetchVturb = async (playerId?: string) => {
    const pid = playerId || product?.vturb_player_id;
    if (!pid || !startDate || !endDate) return;
    setVturbLoading(true);
    setVturbError(null);
    try {
      // 1. Dados diários de sessões
      const res = await fetch('/api/vturb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'sessions/stats_by_day',
          body: { player_id: pid, start_date: startDate, end_date: endDate, timezone: 'America/Sao_Paulo' },
        }),
      });
      const data = await res.json();
      if (data?.error) { setVturbError(data.error); setVturbRows([]); }
      else setVturbRows(Array.isArray(data) ? [...data].reverse() : []);

      // 2. Breakdown por dispositivo
      const [devRes, cntRes] = await Promise.all([
        fetch('/api/vturb', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'sessions/stats_by_field',
            body: { player_id: pid, start_date: startDate, end_date: endDate, field: 'device_type', timezone: 'America/Sao_Paulo' }
          })
        }),
        fetch('/api/vturb', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'sessions/stats_by_field',
            body: { player_id: pid, start_date: startDate, end_date: endDate, field: 'country', timezone: 'America/Sao_Paulo' }
          })
        }),
      ]);
      const devData = await devRes.json();
      const cntData = await cntRes.json();
      setVturbBreakdown({
        device: Array.isArray(devData) ? devData : [],
        country: Array.isArray(cntData) ? cntData.slice(0, 10) : [],
      });
    } catch (e: any) {
      setVturbError(e.message);
    } finally {
      setVturbLoading(false);
    }
  };

  const savePlayerId = async () => {
    if (!playerIdInput.trim()) return;
    // Extrai o UUID da URL do VTurb (ex: app.vturb.com/players/<UUID>/edit)
    const uuidMatch = playerIdInput.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const pid = uuidMatch ? uuidMatch[0] : playerIdInput.trim();
    await supabase.from('products').update({ vturb_player_id: pid }).eq('id', productId);
    const updated = { ...product, vturb_player_id: pid };
    setProduct(updated);
    setEditingPlayerId(false);
    fetchVturb(pid);
  };

  useEffect(() => { if (productId) fetchData(); }, [productId]);

  // Dispara fetch VTurb ao mudar aba ou intervalo de datas
  useEffect(() => {
    if (activeTab === 'vturb' && product?.vturb_player_id && startDate && endDate) {
      fetchVturb();
    }
  }, [activeTab, startDate, endDate, product?.vturb_player_id]);

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
      if (error) throw error;

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

  // --- ANOTAÇÕES ---
  const openNote = (rawDate: string, displayDate: string) => {
    // rawDate = 'YYYY-MM-DD', displayDate = 'DD/MM/YYYY'
    // Converter displayDate → rawDate para usar como chave
    const parts = displayDate.split('/');
    const key = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : rawDate;
    setEditingNote(key);
    setNoteText(notes[key] || '');
  };

  const openNoteByKey = (key: string) => {
    setEditingNote(key);
    setNoteText(notes[key] || '');
  };

  const saveNote = async (dateKey: string) => {
    const text = noteText.trim();
    // Upsert na coluna notes de daily_metrics
    const { error } = await supabase
      .from('daily_metrics')
      .upsert({ product_id: productId, date: dateKey, notes: text }, { onConflict: 'product_id, date' });
    if (!error) {
      setNotes(prev => text ? { ...prev, [dateKey]: text } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== dateKey)));
    }
    setEditingNote(null);
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

  // --- LINHA DE TOTAIS/MÉDIAS (Atualizada conforme regras) ---
  const AVERAGE_COLS = new Set(['ctr', 'avg_cpc', 'fuga_pagina', 'fuga_bridge', 'fuga_vsl', 'cpa', 'roi', 'search_impr_share', 'search_top_share', 'search_abs_share']);
  const LATEST_COLS = new Set(['target_cpa', 'strategy', 'budget', 'account_name']);
  const SKIP_COLS = new Set(['date', 'campaign_status', 'final_url', 'notes']);

  const summaryRow = (() => {
    if (!rows.length) return null;
    const result: Record<string, any> = {};
    ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).forEach(col => {
      if (SKIP_COLS.has(col.key)) { result[col.key] = null; return; }
      
      // Valores Atuais (Latest, pegamos da row[0])
      if (LATEST_COLS.has(col.key)) {
        result[col.key] = rows[0]?.[col.key] !== undefined ? rows[0][col.key] : (col.key === 'strategy' || col.key === 'account_name' ? '-' : 0);
        return;
      }

      const vals = rows.map((r: any) => Number(r[col.key] ?? 0)).filter((v: number) => !isNaN(v));
      if (!vals.length) { result[col.key] = 0; return; }
      const sum = vals.reduce((a: number, b: number) => a + b, 0);
      result[col.key] = AVERAGE_COLS.has(col.key) ? sum / vals.length : sum;
    });
    return result;
  })();

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
            <div className={`flex items-center gap-3 text-sm ${textMuted} mt-1`}><span className="flex items-center gap-1"><ExternalLink size={12} /> {product.platform}</span><span>•</span><span className={`font-mono text-xs px-1 rounded flex items-center gap-1 ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}><Hash size={10} /> {product.google_ads_campaign_id || 'N/A'}</span></div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-stretch sm:items-center w-full xl:w-auto">
          <button onClick={() => setShowManualEntry(true)} className="flex justify-center items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 sm:py-2 rounded-xl sm:rounded-lg text-sm sm:text-xs font-bold transition-all shadow-lg shadow-indigo-900/20 w-full sm:w-auto">
            <FileText size={16} className="sm:w-3.5 sm:h-3.5" /> Lançamento Rápido
          </button>

          {/* SELETOR DE DATA */}
          <div className={`flex flex-col sm:flex-row items-stretch sm:items-center p-2 sm:p-1.5 rounded-xl border ${bgCard} shadow-sm w-full sm:w-auto gap-2 sm:gap-0`}>
            <div className="flex items-center justify-between sm:justify-start gap-2 px-2 pb-2 sm:pb-0 sm:border-r border-b sm:border-b-0 border-inherit">
              <div className="flex items-center gap-2 w-full">
                <Calendar size={18} className={isDark ? "text-white" : "text-indigo-600"} />
                <select
                  className={`bg-transparent text-sm font-bold outline-none cursor-pointer text-right sm:text-left flex-1 sm:w-28 ${textHead}`}
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

          <div className={`flex flex-col sm:flex-row items-stretch sm:items-center p-2 sm:p-1.5 rounded-lg border gap-4 sm:gap-2 w-full sm:w-auto ${bgCard}`}>
            <div className={`flex rounded-md p-1 sm:p-0 ${isDark ? 'bg-black sm:bg-transparent' : 'bg-slate-100 sm:bg-transparent'} gap-1 w-full sm:w-auto`}>
              <button onClick={() => toggleViewCurrency('ORIGINAL')} className={`flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded text-sm sm:text-xs font-bold transition-all ${viewCurrency === 'ORIGINAL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>USD</button>
              <button onClick={() => toggleViewCurrency('BRL')} className={`flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded text-sm sm:text-xs font-bold transition-all ${viewCurrency === 'BRL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-white text-indigo-600 shadow') : textMuted}`}>BRL</button>
            </div>
            <button onClick={toggleTheme} className={`hidden xl:block ${textMuted} hover:text-indigo-500 px-2`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </div>
      </header>

      <div className={`flex overflow-x-auto custom-scrollbar gap-0 border-b ${borderCol} mb-8`}>
        {[
          { id: 'ads', icon: <BarChart2 size={15} />, label: 'Visão Geral' },
          { id: 'search_terms', icon: <FileText size={15} />, label: 'Termos de Pesquisa' },
          { id: 'audiences', icon: <BarChart size={15} />, label: 'Públicos' },
          { id: 'locations', icon: <Globe size={15} />, label: 'Locais' },
          { id: 'strategy', icon: <NotebookPen size={15} />, label: 'Estratégia' },
          { id: 'vturb', icon: <Tv2 size={15} />, label: 'VTurb Analytics' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition-all ${activeTab === tab.id
              ? 'border-indigo-500 text-indigo-400'
              : `border-transparent ${textMuted} hover:text-slate-300`
              }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════ ABA GOOGLE ADS ══════════════════════════ */}
      {activeTab === 'ads' && (<>
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
            <RechartsBarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
              <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', borderColor: isDark ? '#1e293b' : '#e2e8f0', color: isDark ? '#fff' : '#000' }} formatter={(val: any) => formatMoney(val)} />
              <Legend />
              <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="cost" name="Custo" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="lucro" name="Lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </RechartsBarChart>
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

                {/* ── LINHA DE TOTAIS/MÉDIAS ── */}
                {summaryRow && (
                  <tr className={`font-bold text-xs border-b-2 ${isDark ? 'bg-indigo-950/40 border-indigo-800' : 'bg-indigo-50 border-indigo-200'}`}>
                    {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map((col, i) => {
                      if (i === 0) return (
                        <td key={col.key} className={`px-4 py-3 sticky left-0 border-r ${borderCol} text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-indigo-950 text-indigo-300' : 'bg-indigo-50 text-indigo-600'}`}>
                          Σ Total / Ø Média
                        </td>
                      );
                      const val = summaryRow[col.key];
                      if (val === null || val === undefined) return <td key={col.key} className="px-4 py-3 text-right text-slate-500">—</td>;
                      const isAvg = AVERAGE_COLS.has(col.key);
                      const isLatest = LATEST_COLS.has(col.key);

                      let textClass = '';
                      if (col.key === 'profit') textClass = val >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold';
                      else if (col.key === 'revenue') textClass = 'text-blue-500 font-bold';
                      else if (col.key === 'cost') textClass = 'text-orange-500 font-bold';
                      else if (isAvg) textClass = isDark ? 'text-indigo-400 font-extrabold' : 'text-indigo-600 font-extrabold';
                      else if (isLatest) textClass = isDark ? 'text-fuchsia-400 font-extrabold' : 'text-fuchsia-600 font-extrabold';
                      else textClass = isDark ? 'text-slate-300 font-bold' : 'text-slate-700 font-bold';

                      let content;
                      if (col.format === 'currency') {
                        content = <span className={textClass}>{formatMoney(val)}</span>;
                      }
                      else if (col.format === 'percentage' || col.format === 'percentage_red' || col.format === 'percentage_share') {
                        const formatted = col.format === 'percentage_share' ? formatShare(val) : formatPercent(val);
                        content = <span className={textClass}>{formatted}</span>;
                      }
                      else {
                        const displayVal = typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(0)) : val;
                        content = <span className={textClass}>{displayVal}</span>;
                      }
                      return <td key={col.key} className="px-4 py-3 text-right whitespace-nowrap">{content}</td>;
                    })}
                  </tr>
                )}

                {/* ── LINHAS DE DADOS ── */}
                {rows.map(row => {
                  // Converter data de display (DD/MM/YYYY) de volta para chave (YYYY-MM-DD)
                  const dateParts = row.date.split('/');
                  const dateKey = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : row.id;
                  const hasNote = !!notes[dateKey];
                  const isEditingThisNote = editingNote === dateKey;

                  return (
                    <React.Fragment key={row.id}>
                      <tr className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                        {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => {
                          const val = row[col.key];
                          let content;
                          if (col.key === 'date') return (
                            <td key={col.key} className={`px-4 py-4 font-medium sticky left-0 border-r ${borderCol} ${isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}>
                              <div className="flex items-center gap-2">
                                <span>{val}</span>
                                <button
                                  onClick={() => openNoteByKey(dateKey)}
                                  title={hasNote ? 'Ver/Editar anotação' : 'Adicionar anotação'}
                                  className={`rounded-md p-1 transition-colors ${hasNote
                                    ? 'text-amber-400 bg-amber-400/10 hover:bg-amber-400/20'
                                    : `${textMuted} hover:text-indigo-400 hover:bg-indigo-400/10 opacity-0 group-hover:opacity-100`
                                    }`}
                                >
                                  <NotebookPen size={13} />
                                </button>
                                {hasNote && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Tem anotação" />}
                              </div>
                            </td>
                          );
                          if (col.key === 'notes') return (
                            <td key={col.key} className="px-4 py-4 max-w-[200px]">
                              {hasNote
                                ? <span className={`text-xs italic truncate block max-w-[180px] text-amber-400/80 cursor-pointer hover:text-amber-300`} title={notes[dateKey]} onClick={() => openNoteByKey(dateKey)}>{notes[dateKey]}</span>
                                : <button onClick={() => openNoteByKey(dateKey)} className={`text-xs ${textMuted} hover:text-indigo-400 transition-colors`}>+ nota</button>
                              }
                            </td>
                          );
                          if (col.key === 'campaign_status') content = <span className={`flex items-center justify-end gap-1.5 ${val === 'PAUSED' ? 'text-slate-500' : 'text-emerald-400'}`}>{val} {val === 'PAUSED' ? <PauseCircle size={14} /> : <PlayCircle size={14} />}</span>;
                          else if (col.type === 'link') content = val ? <a href={val} target="_blank" className="text-indigo-400 hover:text-indigo-300 flex justify-end"><LinkIcon size={14} /></a> : '-';
                          else if (col.format === 'currency') content = <span className={col.key === 'profit' ? (val >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold') : (col.key === 'revenue' ? 'text-blue-500 font-bold' : (col.key === 'cost' ? 'text-orange-500 font-medium' : 'text-slate-400'))}>{formatMoney(val)}</span>;
                          else if (col.format === 'percentage') content = <span>{formatPercent(val)}</span>;
                          else if (col.format === 'percentage_share') content = <span>{formatShare(val)}</span>;
                          else if (col.format === 'percentage_red') content = <span className={`${val > 50 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>{formatPercent(val)}</span>;
                          else content = <span className={textMuted}>{val}</span>;
                          return <td key={col.key} className="px-4 py-4 whitespace-nowrap text-right">{content}</td>;
                        })}
                      </tr>

                      {/* ── EDITOR INLINE DE NOTA ── */}
                      {isEditingThisNote && (
                        <tr className={`${isDark ? 'bg-amber-950/20' : 'bg-amber-50'}`}>
                          <td colSpan={ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).length} className="px-4 py-3">
                            <div className={`flex items-start gap-3 p-3 rounded-xl border ${isDark ? 'bg-slate-950 border-amber-500/30' : 'bg-white border-amber-300'}`}>
                              <NotebookPen size={16} className="text-amber-400 mt-1 shrink-0" />
                              <div className="flex-1">
                                <p className={`text-[10px] font-bold uppercase text-amber-400 mb-1`}>Anotação — {row.date}</p>
                                <textarea
                                  autoFocus
                                  rows={3}
                                  value={noteText}
                                  onChange={e => setNoteText(e.target.value)}
                                  placeholder="Digite sua anotação para este dia..."
                                  className={`w-full rounded-lg p-2 text-sm outline-none resize-none transition-colors border ${isDark
                                    ? 'bg-slate-900 border-slate-700 text-white focus:border-amber-500 placeholder-slate-600'
                                    : 'bg-slate-50 border-slate-200 text-black focus:border-amber-400'
                                    }`}
                                />
                              </div>
                              <div className="flex flex-col gap-2 shrink-0">
                                <button onClick={() => saveNote(dateKey)}
                                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                                  <Check size={12} /> Salvar
                                </button>
                                <button onClick={() => setEditingNote(null)}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-black'
                                    }`}>
                                  <X size={12} /> Fechar
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {showManualEntry && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`${bgCard} rounded-xl w-full max-w-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]`}>
              <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                <h2 className={`text-xl font-bold ${textHead} flex items-center gap-2`}><FileText size={20} className="text-indigo-500" /> Lançamento Rápido (Funil)</h2>
                <button onClick={() => setShowManualEntry(false)}><X size={24} className="text-slate-400 hover:text-white" /></button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="text-xs uppercase text-slate-500 font-bold">Data</label><input type="date" className={`w-full border rounded p-2 ${isDark ? 'bg-slate-950 border-slate-800 text-white [&::-webkit-calendar-picker-indicator]:invert' : 'bg-white border-slate-200 text-black'} `} value={manualData.date} onChange={e => setManualData({ ...manualData, date: e.target.value })} /></div>
                  <div>
                    <label className="text-xs uppercase text-slate-500 font-bold">Moeda</label>
                    <select className={`w-full border rounded p-2 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-black'}`} value={manualData.currency} onChange={e => setManualData({ ...manualData, currency: e.target.value })}>
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>

                <div className={`p-4 rounded-lg border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <h3 className="text-xs font-bold text-indigo-400 uppercase mb-3 flex items-center gap-2"><MousePointer size={14} /> Tráfego & VSL</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div><label className="text-[10px] uppercase text-slate-500 font-bold">Visitas Pág.</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.visits} onChange={e => setManualData({ ...manualData, visits: parseFloat(e.target.value) })} /></div>
                    <div><label className="text-[10px] uppercase text-slate-500 font-bold">Cliques VSL</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.vsl_clicks} onChange={e => setManualData({ ...manualData, vsl_clicks: parseFloat(e.target.value) })} /></div>
                    <div><label className="text-[10px] uppercase text-slate-500 font-bold">Checkout VSL</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.vsl_checkouts} onChange={e => setManualData({ ...manualData, vsl_checkouts: parseFloat(e.target.value) })} /></div>
                    <div><label className="text-[10px] uppercase text-slate-500 font-bold">Check. Geral</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.checkouts} onChange={e => setManualData({ ...manualData, checkouts: parseFloat(e.target.value) })} /></div>
                  </div>
                </div>

                <div className={`p-4 rounded-lg border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <h3 className="text-xs font-bold text-emerald-400 uppercase mb-3 flex items-center gap-2"><ShoppingCart size={14} /> Vendas & Receita</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div><label className="text-[10px] uppercase text-slate-500 font-bold">Vendas (Qtd)</label><input type="number" className={`w-full border rounded p-2 text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0" value={manualData.sales} onChange={e => setManualData({ ...manualData, sales: parseFloat(e.target.value) })} /></div>
                    <div><label className="text-[10px] uppercase text-blue-500 font-bold">Receita Total</label><input type="number" className={`w-full border rounded p-2 text-sm border-l-4 border-l-blue-500 ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0.00" value={manualData.revenue} onChange={e => setManualData({ ...manualData, revenue: parseFloat(e.target.value) })} /></div>
                    <div><label className="text-[10px] uppercase text-rose-500 font-bold">Reembolsos</label><input type="number" className={`w-full border rounded p-2 text-sm border-l-4 border-l-rose-500 ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300'}`} placeholder="0.00" value={manualData.refunds} onChange={e => setManualData({ ...manualData, refunds: parseFloat(e.target.value) })} /></div>
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
              <div className={`p-6 border-b flex justify-between items-center ${borderCol}`}><h2 className={`text-xl font-bold ${textHead} flex items-center gap-2`}><Columns size={20} className="text-indigo-500" /> Personalizar Colunas</h2><button onClick={() => setShowColumnModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button></div>
              <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {['Geral', 'Tráfego', 'Custo', 'Métricas de Fuga', 'Funil', 'Financeiro', 'Google Ads'].map(category => (
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

      </>)}

      {/* ══════════════════════════ ABA TERMOS DE PESQUISA ══════════════════════════ */}
      {activeTab === 'search_terms' && (
        <div className="space-y-6">
          <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
            <div className={`p-4 border-b ${borderCol} flex flex-col md:flex-row justify-between items-center gap-4`}>
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-indigo-400" />
                <h3 className={`font-semibold ${textHead}`}>Termos de Pesquisa (Últimos 30 dias)</h3>
                <span className={`text-xs ${textMuted} ${isDark ? 'bg-slate-950' : 'bg-slate-100'} px-2 py-1 rounded border ${borderCol}`}>{searchTerms.length} termos</span>
              </div>
            </div>
            {searchTerms.length > 0 ? (
              <div className="overflow-auto custom-scrollbar max-h-[600px]">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0 z-10`}>
                    <tr>
                      <th className={`px-4 py-3 border-b ${borderCol}`}>Termo de Pesquisa</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Campanha</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Impressões</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Cliques</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Custo</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Conversões Ads</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                    {searchTerms.sort((a,b) => b.cost - a.cost).map(st => (
                      <tr key={st.id} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                        <td className={`px-4 py-3 font-medium ${textHead}`}>{st.search_term}</td>
                        <td className={`px-4 py-3 text-right ${textMuted} text-xs truncate max-w-[150px]`} title={st.campaign_name}>{st.campaign_name}</td>
                        <td className={`px-4 py-3 text-right ${textMuted}`}>{st.impressions}</td>
                        <td className={`px-4 py-3 text-right ${textMuted}`}>{st.clicks}</td>
                        <td className={`px-4 py-3 text-right text-orange-400`}>{formatMoney(st.cost)}</td>
                        <td className={`px-4 py-3 text-right ${st.conversions > 0 ? 'text-emerald-400 font-bold' : textMuted}`}>{st.conversions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`p-10 text-center ${textMuted}`}>Nenhum termo de pesquisa coletado ainda. Garanta que o Script Google Ads esteja rodando.</div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════ ABA PÚBLICOS ══════════════════════════ */}
      {activeTab === 'audiences' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* IDADE */}
            <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
              <div className={`p-4 border-b ${borderCol} flex items-center gap-3`}>
                <BarChart size={18} className="text-cyan-400" />
                <h3 className={`font-semibold ${textHead}`}>Por Idade</h3>
              </div>
              {audiences.filter(a => a.audience_type === 'Age').length > 0 ? (
                <div className="overflow-auto custom-scrollbar max-h-[400px]">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0`}>
                      <tr>
                        <th className={`px-4 py-3 border-b ${borderCol}`}>Faixa Etária</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Impr.</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Cliques</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Custo</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                      {audiences.filter(a => a.audience_type === 'Age').sort((a,b) => b.cost - a.cost).map(aud => (
                        <tr key={aud.id} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                          <td className={`px-4 py-3 font-medium ${textHead}`}>{aud.audience_name.replace('AGE_RANGE_', '')}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.impressions}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.clicks}</td>
                          <td className={`px-4 py-3 text-right text-orange-400`}>{formatMoney(aud.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className={`p-6 text-center ${textMuted} text-xs`}>Sem dados de idade.</div>}
            </div>

            {/* GÊNERO */}
            <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
              <div className={`p-4 border-b ${borderCol} flex items-center gap-3`}>
                <BarChart size={18} className="text-pink-400" />
                <h3 className={`font-semibold ${textHead}`}>Por Gênero</h3>
              </div>
              {audiences.filter(a => a.audience_type === 'Gender').length > 0 ? (
                <div className="overflow-auto custom-scrollbar max-h-[400px]">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0`}>
                      <tr>
                        <th className={`px-4 py-3 border-b ${borderCol}`}>Gênero</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Impr.</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Cliques</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Custo</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                      {Object.values(audiences.filter(a => a.audience_type === 'Gender').reduce((acc: any, aud: any) => {
                        if (!acc[aud.audience_name]) acc[aud.audience_name] = { ...aud, impressions: 0, clicks: 0, cost: 0 };
                        acc[aud.audience_name].impressions += aud.impressions;
                        acc[aud.audience_name].clicks += aud.clicks;
                        acc[aud.audience_name].cost += aud.cost;
                        return acc;
                      }, {})).sort((a: any, b: any) => b.impressions - a.impressions).map((aud: any, i: number) => (
                        <tr key={i} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                          <td className={`px-4 py-3 font-medium ${textHead}`}>{aud.audience_name}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.impressions.toLocaleString('pt-BR')}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.clicks.toLocaleString('pt-BR')}</td>
                          <td className={`px-4 py-3 text-right text-orange-400`}>{formatMoney(aud.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className={`p-6 text-center ${textMuted} text-xs`}>Sem dados de gênero.</div>}
            </div>

            {/* DISPOSITIVOS */}
            <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
              <div className={`p-4 border-b ${borderCol} flex items-center gap-3`}>
                <Hash size={18} className="text-violet-400" />
                <h3 className={`font-semibold ${textHead}`}>Por Dispositivo</h3>
              </div>
              {audiences.filter(a => a.audience_type === 'Device').length > 0 ? (
                <div className="overflow-auto custom-scrollbar max-h-[400px]">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0`}>
                      <tr>
                        <th className={`px-4 py-3 border-b ${borderCol}`}>Dispositivo</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Impr.</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Cliques</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Custo</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                      {Object.values(audiences.filter(a => a.audience_type === 'Device').reduce((acc: any, aud: any) => {
                        if (!acc[aud.audience_name]) acc[aud.audience_name] = { ...aud, impressions: 0, clicks: 0, cost: 0 };
                        acc[aud.audience_name].impressions += aud.impressions;
                        acc[aud.audience_name].clicks += aud.clicks;
                        acc[aud.audience_name].cost += aud.cost;
                        return acc;
                      }, {})).sort((a: any, b: any) => b.impressions - a.impressions).map((aud: any, i: number) => (
                        <tr key={i} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                          <td className={`px-4 py-3 font-medium ${textHead}`}>{aud.audience_name.replace('MOBILE', '📱 Mobile').replace('DESKTOP', '🖥 Desktop').replace('TABLET', '📋 Tablet').replace('CONNECTED_TV', '📺 TV')}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.impressions.toLocaleString('pt-BR')}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.clicks.toLocaleString('pt-BR')}</td>
                          <td className={`px-4 py-3 text-right text-orange-400`}>{formatMoney(aud.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className={`p-6 text-center ${textMuted} text-xs`}>Sem dados de dispositivo.</div>}
            </div>

            {/* RENDA FAMILIAR */}
            <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol}`}>
              <div className={`p-4 border-b ${borderCol} flex items-center gap-3`}>
                <TrendingUp size={18} className="text-green-400" />
                <h3 className={`font-semibold ${textHead}`}>Por Renda Familiar</h3>
              </div>
              {audiences.filter(a => a.audience_type === 'Income').length > 0 ? (
                <div className="overflow-auto custom-scrollbar max-h-[400px]">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0`}>
                      <tr>
                        <th className={`px-4 py-3 border-b ${borderCol}`}>Faixa de Renda</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Impr.</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Cliques</th>
                        <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Custo</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                      {Object.values(audiences.filter(a => a.audience_type === 'Income').reduce((acc: any, aud: any) => {
                        if (!acc[aud.audience_name]) acc[aud.audience_name] = { ...aud, impressions: 0, clicks: 0, cost: 0 };
                        acc[aud.audience_name].impressions += aud.impressions;
                        acc[aud.audience_name].clicks += aud.clicks;
                        acc[aud.audience_name].cost += aud.cost;
                        return acc;
                      }, {})).sort((a: any, b: any) => b.impressions - a.impressions).map((aud: any, i: number) => (
                        <tr key={i} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                          <td className={`px-4 py-3 font-medium ${textHead}`}>{aud.audience_name.replace('INCOME_RANGE_', 'Renda: ').replace(/_/g, '-').replace('0-50', 'Top 10%').replace('50-60', 'Top 11-20%').replace('60-70', 'Top 21-30%').replace('70-80', '30-40%').replace('80-90', '40-50%').replace('90-100', 'Menor 50%')}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.impressions.toLocaleString('pt-BR')}</td>
                          <td className={`px-4 py-3 text-right ${textMuted}`}>{aud.clicks.toLocaleString('pt-BR')}</td>
                          <td className={`px-4 py-3 text-right text-orange-400`}>{formatMoney(aud.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className={`p-6 text-center ${textMuted} text-xs`}>Sem dados de renda familiar.</div>}
            </div>
          </div>
        </div>
      )}


      {/* ══════════════════════════ ABA LOCAIS ══════════════════════════ */}
      {activeTab === 'locations' && (
        <div className="space-y-6">
          <div className={`${bgCard} rounded-xl overflow-hidden shadow-sm border ${borderCol} max-w-4xl`}>
            <div className={`p-4 border-b ${borderCol} flex items-center gap-3`}>
              <Globe size={18} className="text-emerald-400" />
              <h3 className={`font-semibold ${textHead}`}>Performance por Região/País</h3>
            </div>
            {locations.length > 0 ? (
              <div className="overflow-auto custom-scrollbar max-h-[500px]">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className={`text-xs uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-600'} sticky top-0`}>
                    <tr>
                      <th className={`px-4 py-3 border-b ${borderCol}`}>Local / Região</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Campanha</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Impr.</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Cliques</th>
                      <th className={`px-4 py-3 border-b ${borderCol} text-right`}>Custo</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                    {Object.values(locations.reduce((acc: any, loc: any) => {
                        if (!acc[loc.location_name]) acc[loc.location_name] = { ...loc, impressions: 0, clicks: 0, cost: 0 };
                        acc[loc.location_name].impressions += loc.impressions;
                        acc[loc.location_name].clicks += loc.clicks;
                        acc[loc.location_name].cost += loc.cost;
                        return acc;
                      }, {})).sort((a: any, b: any) => b.impressions - a.impressions).map((loc: any, i: number) => (
                      <tr key={i} className={`transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                        <td className={`px-4 py-3 font-medium ${textHead}`}>{loc.location_name}</td>
                        <td className={`px-4 py-3 text-right text-xs ${textMuted} truncate max-w-[120px]`} title={loc.campaign_name}>{loc.campaign_name}</td>
                        <td className={`px-4 py-3 text-right ${textMuted}`}>{loc.impressions.toLocaleString('pt-BR')}</td>
                        <td className={`px-4 py-3 text-right ${textMuted}`}>{loc.clicks.toLocaleString('pt-BR')}</td>
                        <td className={`px-4 py-3 text-right text-orange-400`}>{formatMoney(loc.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className={`p-10 text-center ${textMuted}`}>Nenhum dado de região coletado.</div>}
          </div>
        </div>
      )}

      {/* ══════════════════════════ ABA ESTRATÉGIA ══════════════════════════ */}
      {activeTab === 'strategy' && (
        <div className="space-y-6">
          <div className={`${bgCard} rounded-xl p-6 shadow-sm border ${borderCol} max-w-4xl`}>
            <div className="flex items-center gap-3 mb-4">
              <NotebookPen size={20} className="text-indigo-500" />
              <h2 className={`text-lg font-bold ${textHead}`}>Estratégia da Campanha</h2>
            </div>
            <p className={`text-sm mb-6 ${textMuted}`}>
              Use esta área como seu "Diário de Bordo" (War Room). Documente a tese principal, ângulos de anúncios que estão sendo testados, limites de CPA, ou regras de escala.
            </p>
            <div className="flex flex-col gap-4">
              <textarea
                value={campaignStrategy}
                onChange={e => setCampaignStrategy(e.target.value)}
                placeholder="Exemplo: Testando ângulo 'Saúde Natural' focado em homens 45+. CPA limite é $40."
                className={`w-full h-80 rounded-xl p-4 text-sm outline-none resize-none border focus:border-indigo-500 transition-colors ${
                  isDark ? 'bg-slate-950 border-slate-700 text-slate-200 placeholder-slate-600' : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
              />
              <div className="flex justify-end">
                <button 
                  onClick={async () => {
                    setIsSavingStrategy(true);
                    await supabase.from('campaign_strategies').upsert({ product_id: productId, strategy_text: campaignStrategy }, { onConflict: 'product_id' });
                    setIsSavingStrategy(false);
                  }}
                  disabled={isSavingStrategy}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2"
                >
                  {isSavingStrategy ? 'Salvando...' : <><Save size={16}/> Salvar Estratégia</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════ ABA VTURB ══════════════════════════ */}
      {activeTab === 'vturb' && (
        <div className="space-y-6">

          {/* CONFIGURAÇÃO DO PLAYER */}
          <div className={`rounded-xl p-5 border ${bgCard} flex flex-wrap items-center gap-4`}>
            <Tv2 size={20} className="text-purple-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${textHead}`}>Player VTurb vinculado</p>
              {editingPlayerId ? (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    autoFocus
                    value={playerIdInput}
                    onChange={e => setPlayerIdInput(e.target.value)}
                    placeholder="Cole a URL ou o ID do player VTurb..."
                    className={`flex-1 rounded-lg px-3 py-2 text-sm border outline-none font-mono ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-black'}`}
                  />
                  <button onClick={savePlayerId} className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1"><Check size={12} /> Salvar</button>
                  <button onClick={() => setEditingPlayerId(false)} className={`px-3 py-2 rounded-lg text-xs font-bold ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}><X size={12} /></button>
                </div>
              ) : product?.vturb_player_id ? (
                <div className="flex items-center gap-2 mt-1">
                  <code className={`text-xs font-mono px-2 py-0.5 rounded ${isDark ? 'bg-slate-950 text-purple-300' : 'bg-purple-50 text-purple-700'}`}>{product.vturb_player_id}</code>
                  <button onClick={() => { setPlayerIdInput(product.vturb_player_id); setEditingPlayerId(true); }} className={`text-xs ${textMuted} hover:text-purple-400`}>← alterar</button>
                </div>
              ) : (
                <p className={`text-xs ${textMuted} mt-0.5`}>Nenhum player configurado. Vincule um player para ver os dados do VTurb.</p>
              )}
            </div>
            {!editingPlayerId && !product?.vturb_player_id && (
              <button onClick={() => setEditingPlayerId(true)} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shrink-0">
                <Settings2 size={14} /> Vincular Player
              </button>
            )}
            {product?.vturb_player_id && (
              <button onClick={() => fetchVturb()} disabled={vturbLoading} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}>
                <RefreshCw size={13} className={vturbLoading ? 'animate-spin' : ''} /> {vturbLoading ? 'Buscando...' : 'Atualizar'}
              </button>
            )}
          </div>

          {/* ERRO */}
          {vturbError && (
            <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
              ⚠️ {vturbError}
            </div>
          )}

          {/* SEM PLAYER */}
          {!product?.vturb_player_id && !vturbError && (
            <div className={`rounded-xl p-10 border ${bgCard} flex flex-col items-center gap-4 text-center`}>
              <Tv2 size={40} className="text-purple-400/40" />
              <p className={`font-bold ${textHead}`}>Configure um Player VTurb</p>
              <p className={`text-sm ${textMuted} max-w-md`}>
                Vincule o ID do player VTurb ao produto para visualizar automaticamente visualizações, engajamento, retenção ao pitch, cliques e conversões por dia.
              </p>
              <button onClick={() => setEditingPlayerId(true)} className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 mt-2">
                <Settings2 size={15} /> Vincular Player
              </button>
            </div>
          )}

          {/* DADOS VTURB */}
          {product?.vturb_player_id && !vturbLoading && vturbRows.length > 0 && (() => {
            // KPI aggregates
            const total = vturbRows.reduce((acc: any, r: any) => {
              acc.views += Number(r.views ?? 0);
              acc.unique_views += Number(r.unique_views ?? 0);
              acc.unique_plays += Number(r.unique_plays ?? 0);
              acc.pitch_viewers += Number(r.pitch_viewers ?? 0);
              acc.clicks += Number(r.clicks ?? 0);
              acc.conversions += Number(r.conversions ?? 0);
              acc.conversions_brl += Number(r.conversions_brl ?? 0);
              return acc;
            }, { views: 0, unique_views: 0, unique_plays: 0, pitch_viewers: 0, clicks: 0, conversions: 0, conversions_brl: 0 });

            const avgPlayRate = vturbRows.reduce((s: number, r: any) => s + Number(r.play_rate ?? 0), 0) / vturbRows.length;
            const avgEngagement = vturbRows.reduce((s: number, r: any) => s + Number(r.engagement_rate ?? 0), 0) / vturbRows.length;
            const avgPitchRate = vturbRows.reduce((s: number, r: any) => s + Number(r.pitch_rate ?? 0), 0) / vturbRows.length;

            const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
            const moneyBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

            const VKpi = ({ label, value, color }: { label: string; value: string; color: string }) => (
              <div className={`${bgCard} p-4 rounded-xl border-t-4 border-t-${color}`}>
                <p className="text-slate-500 text-xs font-bold uppercase mb-1">{label}</p>
                <p className={`text-xl font-bold text-${color}`}>{value}</p>
              </div>
            );

            return (
              <div className="space-y-6">
                {/* KPI CARDS */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  <VKpi label="Visualizações" value={total.views.toLocaleString()} color="purple-400" />
                  <VKpi label="Únicos" value={total.unique_views.toLocaleString()} color="indigo-400" />
                  <VKpi label="Play Rate" value={pct(avgPlayRate)} color="cyan-400" />
                  <VKpi label="Engajamento" value={pct(avgEngagement)} color="blue-400" />
                  <VKpi label="Audiência Pitch" value={total.pitch_viewers.toLocaleString()} color="amber-400" />
                  <VKpi label="Cliques CTA" value={total.clicks.toLocaleString()} color="emerald-400" />
                  <VKpi label="Receita VTurb" value={moneyBRL(total.conversions_brl)} color="green-400" />
                </div>

                {/* TABELA DIÁRIA */}
                <div className={`${bgCard} rounded-xl overflow-hidden border ${borderCol}`}>
                  <div className={`p-4 border-b ${borderCol} flex items-center gap-3`}>
                    <Tv2 size={16} className="text-purple-400" />
                    <h3 className={`font-semibold ${textHead}`}>Dados Diários VTurb</h3>
                    <span className={`text-xs ${textMuted} px-2 py-0.5 rounded ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>{vturbRows.length} dias</span>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className={`text-[10px] uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-500'} sticky top-0`}>
                        <tr>
                          {['Data', 'Views', 'Únicos', 'Plays Únicos', 'Play Rate', 'Engajamento', 'Pitch', 'Ret. Pitch', 'Cliques', 'Conversões', 'Receita (BRL)'].map(h => (
                            <th key={h} className={`px-4 py-3 whitespace-nowrap text-right first:text-left border-b ${borderCol}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                        {vturbRows.map((r: any, i: number) => {
                          const dp = (r.date || '').split('T')[0].split('-');
                          const dateLabel = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : r.date;
                          return (
                            <tr key={i} className={`transition-colors ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                              <td className={`px-4 py-3 sticky left-0 font-medium border-r ${borderCol} ${isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}>{dateLabel}</td>
                              <td className="px-4 py-3 text-right text-purple-400 font-medium">{Number(r.views ?? 0).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-slate-400">{Number(r.unique_views ?? 0).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-slate-400">{Number(r.unique_plays ?? 0).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-cyan-400">{pct(Number(r.play_rate ?? 0))}</td>
                              <td className="px-4 py-3 text-right text-blue-400">{pct(Number(r.engagement_rate ?? 0))}</td>
                              <td className="px-4 py-3 text-right text-amber-400 font-medium">{Number(r.pitch_viewers ?? 0).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-amber-300">{pct(Number(r.pitch_rate ?? 0))}</td>
                              <td className="px-4 py-3 text-right text-emerald-400 font-medium">{Number(r.clicks ?? 0).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-green-400">{Number(r.conversions ?? 0)}</td>
                              <td className="px-4 py-3 text-right text-green-300 font-bold">{moneyBRL(Number(r.conversions_brl ?? 0))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* BREAKDOWN: DEVICE + PAÍS */}
                {(vturbBreakdown.device.length > 0 || vturbBreakdown.country.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Por Dispositivo */}
                    {vturbBreakdown.device.length > 0 && (
                      <div className={`${bgCard} rounded-xl border ${borderCol} overflow-hidden`}>
                        <div className={`p-4 border-b ${borderCol} flex items-center gap-2`}>
                          <TrendingUp size={15} className="text-cyan-400" />
                          <h4 className={`text-sm font-bold ${textHead}`}>Por Dispositivo</h4>
                        </div>
                        <table className="w-full text-xs">
                          <thead className={`text-[10px] uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-500'}`}>
                            <tr>
                              <th className="px-4 py-2 text-left">Dispositivo</th>
                              <th className="px-4 py-2 text-right">Views</th>
                              <th className="px-4 py-2 text-right">Play Rate</th>
                              <th className="px-4 py-2 text-right">Engajamento</th>
                            </tr>
                          </thead>
                          <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                            {vturbBreakdown.device.map((d: any, i: number) => (
                              <tr key={i} className={`${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                                <td className={`px-4 py-2.5 font-medium capitalize ${textHead}`}>{d.field_value || d.device_type || '—'}</td>
                                <td className="px-4 py-2.5 text-right text-purple-400">{Number(d.views ?? 0).toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-right text-cyan-400">{pct(Number(d.play_rate ?? 0))}</td>
                                <td className="px-4 py-2.5 text-right text-blue-400">{pct(Number(d.engagement_rate ?? 0))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Por País */}
                    {vturbBreakdown.country.length > 0 && (
                      <div className={`${bgCard} rounded-xl border ${borderCol} overflow-hidden`}>
                        <div className={`p-4 border-b ${borderCol} flex items-center gap-2`}>
                          <TrendingUp size={15} className="text-emerald-400" />
                          <h4 className={`text-sm font-bold ${textHead}`}>Por País (top 10)</h4>
                        </div>
                        <table className="w-full text-xs">
                          <thead className={`text-[10px] uppercase font-bold ${isDark ? 'bg-slate-950 text-slate-500' : 'bg-slate-100 text-slate-500'}`}>
                            <tr>
                              <th className="px-4 py-2 text-left">País</th>
                              <th className="px-4 py-2 text-right">Views</th>
                              <th className="px-4 py-2 text-right">Play Rate</th>
                              <th className="px-4 py-2 text-right">Engajamento</th>
                            </tr>
                          </thead>
                          <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                            {vturbBreakdown.country.map((c: any, i: number) => (
                              <tr key={i} className={`${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                                <td className={`px-4 py-2.5 font-medium ${textHead}`}>{c.field_value || c.country || '—'}</td>
                                <td className="px-4 py-2.5 text-right text-purple-400">{Number(c.views ?? 0).toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-right text-cyan-400">{pct(Number(c.play_rate ?? 0))}</td>
                                <td className="px-4 py-2.5 text-right text-blue-400">{pct(Number(c.engagement_rate ?? 0))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* LOADING */}
          {vturbLoading && (
            <div className={`rounded-xl p-10 border ${bgCard} flex flex-col items-center gap-3 text-center`}>
              <RefreshCw size={28} className="text-purple-400 animate-spin" />
              <p className={`text-sm ${textMuted}`}>Buscando dados do VTurb...</p>
            </div>
          )}

          {/* SEM DADOS */}
          {product?.vturb_player_id && !vturbLoading && !vturbError && vturbRows.length === 0 && (
            <div className={`rounded-xl p-10 border ${bgCard} flex flex-col items-center gap-3 text-center`}>
              <Tv2 size={36} className="text-purple-400/30" />
              <p className={`font-bold ${textHead}`}>Nenhum dado no período</p>
              <p className={`text-sm ${textMuted}`}>Tente ampliar o intervalo de datas.</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}