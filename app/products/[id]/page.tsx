"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation'; // Hook para pegar o ID da URL
import { 
  ArrowLeft, Download, ExternalLink, Columns,
  DollarSign, ArrowRightLeft, ArrowUpRight, Coins, X, ArrowDownRight
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// --- CONFIGURAÇÃO SUPABASE ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Definição das colunas disponíveis (Baseado no seu layout)
const ALL_COLUMNS = [
  { key: 'date', label: 'Data', category: 'Geral', default: true },
  { key: 'impressions', label: 'Impressões', category: 'Tráfego', default: true },
  { key: 'clicks', label: 'Cliques', category: 'Tráfego', default: true },
  { key: 'ctr', label: 'CTR', category: 'Tráfego', default: true },
  { key: 'avg_cpc', label: 'CPC Médio', category: 'Custo', default: true, format: 'currency' }, 
  { key: 'cost', label: 'Custo Ads', category: 'Custo', default: true, format: 'currency' },
  { key: 'visits', label: 'Visitas Pág.', category: 'Funil', default: true }, // Novo
  { key: 'checkouts', label: 'Checkouts', category: 'Funil', default: false }, // Novo
  { key: 'conversions', label: 'Vendas', category: 'Financeiro', default: true },
  { key: 'revenue', label: 'Receita', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'refunds', label: 'Reembolso', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'profit', label: 'Lucro', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'roi', label: 'ROI', category: 'Financeiro', default: true, format: 'percentage' },
  { key: 'roas', label: 'ROAS', category: 'Financeiro', default: false },
  { key: 'strategy', label: 'Estratégia', category: 'Google Ads', default: false },
];

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params.id as string;

  // Estados de Dados Reais
  const [product, setProduct] = useState<any>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados de UI
  const [timeRange, setTimeRange] = useState('Total'); // Filtro de tempo simples
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('BRL');
  const [visibleColumns, setVisibleColumns] = useState(
    ALL_COLUMNS.filter(c => c.default).map(c => c.key)
  );

  // 1. Busca Dados no Banco ao carregar
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Busca Produto
        const { data: prodData } = await supabase.from('products').select('*').eq('id', productId).single();
        if (prodData) setProduct(prodData);

        // Busca Métricas
        const { data: metricsData } = await supabase
          .from('daily_metrics')
          .select('*')
          .eq('product_id', productId)
          .order('date', { ascending: true }); // Do antigo para o recente

        if (metricsData) setMetrics(metricsData);
      } catch (error) {
        console.error("Erro:", error);
      } finally {
        setLoading(false);
      }
    }
    if (productId) fetchData();
  }, [productId]);

  // 2. Processamento e Cálculos (O "Cérebro" da página)
  const processedData = useMemo(() => {
    if (!metrics.length) return { rows: [], stats: null, chart: [] };

    // Taxa de câmbio fixa para simulação (em produção viria de uma API)
    const exchangeRate = 6.15; 

    let totalRevenue = 0, totalCost = 0, totalRefunds = 0, totalConversions = 0;

    const rows = metrics.map(row => {
      // Normalização de Valores (Banco -> Visualização)
      let cost = Number(row.cost || 0);
      let revenue = Number(row.conversion_value || 0); // O banco chama de conversion_value
      let refunds = Number(row.refunds || 0);
      let cpc = Number(row.avg_cpc || 0);

      // Conversão de Moeda
      const rowCurrency = row.currency || 'BRL';
      
      // Se estamos vendo em BRL, mas o dado é USD -> Converte pra BRL
      if (viewCurrency === 'BRL' && rowCurrency === 'USD') {
        cost *= exchangeRate; revenue *= exchangeRate; refunds *= exchangeRate; cpc *= exchangeRate;
      }
      // Se estamos vendo em USD, mas o dado é BRL -> Converte pra USD
      else if (viewCurrency === 'ORIGINAL' && rowCurrency === 'BRL') {
        cost /= exchangeRate; revenue /= exchangeRate; refunds /= exchangeRate; cpc /= exchangeRate;
      }
      // (Simplificação: 'ORIGINAL' aqui estou tratando como USD forçado para visualização internacional)

      const profit = revenue - refunds - cost;
      const roi = cost > 0 ? (profit / cost) * 100 : 0;
      const roas = cost > 0 ? revenue / cost : 0;

      // Acumula Totais
      totalRevenue += revenue;
      totalCost += cost;
      totalRefunds += refunds;
      totalConversions += Number(row.conversions || 0);

      // Formata data para DD/MM
      const dateParts = row.date.split('-');
      const shortDate = `${dateParts[2]}/${dateParts[1]}`;
      const fullDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

      return {
        ...row,
        date: fullDate, // Para tabela
        shortDate,      // Para gráfico
        cost, revenue, refunds, profit, roi, roas, avg_cpc: cpc
      };
    });

    // Filtro de Data (Simples)
    const filteredRows = rows; // Aqui você pode implementar lógica de filtro '7d', '30d' se quiser depois

    const totalProfit = totalRevenue - totalRefunds - totalCost;
    const totalRoi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    // Dados para o Gráfico (Últimos 14 dias para não poluir)
    const chartData = rows.slice(-14).map(r => ({
      day: r.shortDate,
      lucro: r.profit,
      custo: r.cost,
      receita: r.revenue
    }));

    return {
      rows: filteredRows.reverse(), // Tabela mostra o mais recente primeiro
      chart: chartData,
      stats: {
        revenue: totalRevenue,
        cost: totalCost,
        profit: totalProfit,
        roi: totalRoi,
        conversions: totalConversions
      }
    };
  }, [metrics, viewCurrency]);

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const formatMoney = (val: number) => {
    return new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { 
      style: 'currency', currency: viewCurrency === 'BRL' ? 'BRL' : 'USD' 
    }).format(val);
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500 animate-pulse">Carregando dados reais...</div>;

  const { rows, stats, chart } = processedData;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-6 relative">
      
      {/* Header */}
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
        <div className="flex items-center gap-4">
          <Link href="/products" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{product?.name || 'Carregando...'}</h1>
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                {product?.status || 'Ativo'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
              <span className="flex items-center gap-1"><ExternalLink size={12}/> {product?.platform}</span>
              <span>•</span>
              <span className="font-mono text-xs bg-slate-900 px-1 rounded">{product?.google_ads_campaign_name}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full xl:w-auto">
          <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex items-center">
            <button onClick={() => setViewCurrency('ORIGINAL')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${viewCurrency === 'ORIGINAL' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:text-white'}`}>
              <DollarSign size={14} /> USD / Original
            </button>
            <button onClick={() => setViewCurrency('BRL')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${viewCurrency === 'BRL' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>
              <ArrowRightLeft size={14} /> Reais (BRL)
            </button>
          </div>
        </div>
      </header>

      {/* Cards de KPI */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl group hover:border-indigo-500/30 transition-all">
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Lucro Líquido</p>
            <div className="flex items-end gap-2">
              <span className={`text-2xl font-bold ${stats.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatMoney(stats.profit)}
              </span>
              {stats.profit > 0 && <div className="flex items-center text-emerald-500 text-xs mb-1 bg-emerald-500/10 px-1.5 py-0.5 rounded"><ArrowUpRight size={12} /></div>}
            </div>
          </div>
          
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">ROI Total</p>
            <div className="flex items-end gap-2">
              <span className={`text-2xl font-bold ${stats.roi >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>
                {stats.roi.toFixed(1)}%
              </span>
            </div>
          </div>
          
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Custo Ads</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-amber-500">{formatMoney(stats.cost)}</span>
            </div>
          </div>
          
          <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Receita Total</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-white">{formatMoney(stats.revenue)}</span>
              <span className="text-slate-500 text-xs mb-1">{stats.conversions} vendas</span>
            </div>
          </div>
        </div>
      )}

      {/* Gráfico */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-semibold text-white">Evolução Diária</h3>
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-2 text-slate-400"><div className="w-3 h-3 bg-emerald-500 rounded-full"></div> Lucro</div>
              <div className="flex items-center gap-2 text-slate-400"><div className="w-3 h-3 bg-rose-500/50 rounded-full"></div> Custo</div>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} barGap={0}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                  cursor={{fill: '#1e293b', opacity: 0.4}}
                  formatter={(value: any) => formatMoney(Number(value))}
                />
                <Bar dataKey="lucro" name="Lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {chart.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.lucro > 0 ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
                <Bar dataKey="custo" name="Custo" fill="#f43f5e" opacity={0.3} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Info Card Lateral */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Coins size={16} className="text-indigo-400"/> Resumo do Produto
          </h3>
          <div className="space-y-4">
             <div className="flex justify-between text-sm border-b border-slate-800 pb-2">
                <span className="text-slate-500">Moeda Padrão</span>
                <span className="text-white">{product?.currency}</span>
             </div>
             <div className="flex justify-between text-sm border-b border-slate-800 pb-2">
                <span className="text-slate-500">Dias Registrados</span>
                <span className="text-white">{metrics.length}</span>
             </div>
             <div className="flex justify-between text-sm border-b border-slate-800 pb-2">
                <span className="text-slate-500">Plataforma</span>
                <span className="text-white">{product?.platform}</span>
             </div>
          </div>
          <div className="mt-auto bg-slate-950 p-4 rounded-lg border border-slate-800">
             <p className="text-xs text-slate-500 mb-1">Última atualização</p>
             <p className="text-white font-mono text-sm">
                {metrics.length > 0 ? new Date(metrics[metrics.length-1].updated_at).toLocaleString() : '-'}
             </p>
          </div>
        </div>
      </div>

      {/* Tabela de Dados */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm relative flex flex-col h-[600px]">
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center bg-slate-900/50 gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-white">Histórico Detalhado</h3>
            <span className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">{rows.length} registros</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowColumnModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors border border-slate-700">
              <Columns size={14} /> Colunas
            </button>
          </div>
        </div>

        <div className="overflow-auto custom-scrollbar flex-1">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-xs text-slate-500 uppercase bg-slate-950 font-semibold sticky top-0 z-20 shadow-lg">
              <tr>
                {/* Cabeçalho dinâmico baseado nas colunas visíveis */}
                {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (
                  <th key={col.key} className="px-4 py-4 whitespace-nowrap border-b border-slate-800 text-right bg-slate-950 first:text-left first:sticky first:left-0 first:z-30">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row: any) => (
                <tr key={row.id} className="hover:bg-slate-800/50 transition-colors group">
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => {
                    const val = row[col.key];
                    let content;

                    if (col.key === 'date') {
                      return <td key={col.key} className="px-4 py-4 whitespace-nowrap font-medium text-white sticky left-0 bg-slate-900 group-hover:bg-slate-800 border-r border-slate-800">{val}</td>
                    }
                    
                    if (col.format === 'currency') {
                      content = <span className={col.key === 'profit' ? (val >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold') : 'text-slate-300'}>{formatMoney(val)}</span>;
                    } else if (col.format === 'percentage') {
                      content = <span className={`px-2 py-1 rounded text-xs border ${val < 0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{val.toFixed(2)}%</span>;
                    } else if (col.key === 'strategy') {
                      content = <span className="text-xs text-slate-500 truncate block max-w-[100px]" title={val}>{val || '-'}</span>;
                    } else {
                      content = <span className="text-slate-400">{val !== undefined && val !== null ? val : '-'}</span>;
                    }

                    return <td key={col.key} className="px-4 py-4 whitespace-nowrap text-right">{content}</td>;
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center py-12 text-slate-500">
                    Nenhum dado encontrado para este produto ainda.
                    <br/><span className="text-xs">Rode o script no Google Ads ou faça um lançamento manual.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Colunas (Mantido do seu código original) */}
      {showColumnModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Columns size={20} className="text-indigo-500"/> Personalizar Colunas</h2>
              <button onClick={() => setShowColumnModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {['Geral', 'Tráfego', 'Custo', 'Funil', 'Financeiro', 'Google Ads'].map(category => (
                  <div key={category}>
                    {/* Renderiza apenas se houver colunas dessa categoria */}
                    {ALL_COLUMNS.some(c => c.category === category) && (
                      <>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-800 pb-2">{category}</h3>
                        <div className="space-y-2">
                          {ALL_COLUMNS.filter(c => c.category === category).map(col => (
                            <label key={col.key} className="flex items-center gap-3 p-2 hover:bg-slate-800 rounded cursor-pointer group transition-colors">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${visibleColumns.includes(col.key) ? 'bg-indigo-600 border-indigo-600' : 'bg-transparent border-slate-600'}`}>
                                {visibleColumns.includes(col.key) && <ArrowDownRight size={14} className="text-white" />}
                              </div>
                              <span className={visibleColumns.includes(col.key) ? 'text-white font-medium' : 'text-slate-400'}>{col.label}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-slate-800 flex justify-end bg-slate-950/50 rounded-b-xl">
              <button onClick={() => setShowColumnModal(false)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}