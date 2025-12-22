"use client";

import React, { useState } from 'react';
import { 
  ArrowLeft, Download, ExternalLink, 
  Search, ArrowUpRight, ArrowDownRight, X, Columns,
  RefreshCw, DollarSign, ArrowRightLeft, Coins
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

// --- CONFIGURAÇÃO SIMULADA (MOCK) ---
// Nota: Esta página ainda usa dados simulados para visualização.
// Futuramente, podemos conectá-la ao Supabase igual ao Dashboard.
const productInfo = {
  name: 'FASTTRACK MUNDO MCQ',
  platform: 'Clickbank',
  account_currency: 'USD',
  revenue_currency: 'USD',
  status: 'Ativo',
  campaign_name: '[FF PROD] FASTTRACK MUNDO MCQ'
};

const summaryStatsBase = {
  revenue: 3025.00,
  cost: 1021.00,
  profit: 2004.00,
  roi: 196.2,
  conversions: 84,
  avg_rate: 6.10
};

const generateHistory = (days: number) => {
  const data = [];
  const baseDate = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i);
    
    const imps = Math.floor(Math.random() * (12000 - 5000) + 5000);
    const clicks = Math.floor(imps * (Math.random() * (0.06 - 0.03) + 0.03));
    const cost = clicks * (Math.random() * (0.18 - 0.12) + 0.12);
    const sales = Math.floor(clicks * (Math.random() * (0.025 - 0.005) + 0.005));
    const revenue = sales * 27.00;
    
    data.push({
      id: i + 1,
      date: date.toLocaleDateString('pt-BR'),
      exchange_rate: 6.00 + (Math.random() * 0.3),
      imps,
      clicks,
      ctr: ((clicks / imps) * 100).toFixed(2) + '%',
      cpc: cost / (clicks || 1),
      cost,
      sales,
      revenue,
      profit: revenue - cost,
      roi: cost > 0 ? ((revenue - cost) / cost * 100).toFixed(1) : '0',
      roas: cost > 0 ? (revenue / cost).toFixed(2) : '0',
      budget: 50.00,
      strategy: 'Maximizar Conversões',
      target: 0,
      share_impr: (Math.random() * 20 + 30).toFixed(1) + '%',
      share_top: (Math.random() * 30 + 50).toFixed(1) + '%',
      account: 'Conta 02 - USD',
      url: 'https://fasttrack.com/vsl'
    });
  }
  return data;
};

const fullHistoryData = generateHistory(30);

const ALL_COLUMNS = [
  { key: 'imps', label: 'Impressões', category: 'Tráfego', default: true },
  { key: 'clicks', label: 'Cliques', category: 'Tráfego', default: true },
  { key: 'ctr', label: 'CTR', category: 'Tráfego', default: true },
  { key: 'cpc', label: 'CPC Médio', category: 'Custo', default: true, format: 'currency' }, 
  { key: 'budget', label: 'Orçamento', category: 'Custo', default: false, format: 'currency' },
  { key: 'cost', label: 'Custo', category: 'Custo', default: true, format: 'currency' },
  { key: 'sales', label: 'Vendas', category: 'Financeiro', default: true },
  { key: 'revenue', label: 'Receita', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'profit', label: 'Lucro', category: 'Financeiro', default: true, format: 'currency' },
  { key: 'roi', label: 'ROI', category: 'Financeiro', default: true, format: 'percentage' },
  { key: 'roas', label: 'ROAS', category: 'Financeiro', default: false },
  { key: 'strategy', label: 'Estratégia', category: 'Google Ads', default: false },
  { key: 'target', label: 'Meta', category: 'Google Ads', default: false, format: 'currency' },
  { key: 'share_impr', label: 'Parc. Impr.', category: 'Google Ads', default: false },
  { key: 'share_top', label: 'Parc. Topo', category: 'Google Ads', default: false },
  { key: 'account', label: 'Conta Ads', category: 'Google Ads', default: false },
  { key: 'url', label: 'URL Final', category: 'Google Ads', default: false },
];

export default function ProductDetailPage() {
  const [timeRange, setTimeRange] = useState('30d');
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('BRL');

  const [visibleColumns, setVisibleColumns] = useState(
    ALL_COLUMNS.filter(c => c.default).map(c => c.key)
  );

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const getDisplayValue = (val: number, rate: number) => {
    if (viewCurrency === 'BRL') return val * rate;
    return val;
  };

  const formatMoney = (val: number) => {
    const currency = viewCurrency === 'BRL' ? 'BRL' : productInfo.account_currency;
    return new Intl.NumberFormat(viewCurrency === 'BRL' ? 'pt-BR' : 'en-US', { 
      style: 'currency', 
      currency: currency 
    }).format(val);
  };

  const chartData = fullHistoryData.slice(0, 7).reverse().map(item => ({
    day: item.date.split('/')[0] + '/' + item.date.split('/')[1],
    custo: getDisplayValue(item.cost, item.exchange_rate),
    receita: getDisplayValue(item.revenue, item.exchange_rate),
    lucro: getDisplayValue(item.profit, item.exchange_rate),
  }));

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-6 relative">
      
      {/* Header */}
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
        <div className="flex items-center gap-4">
          <a href="/products" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </a>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{productInfo.name}</h1>
              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                {productInfo.status}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
              <span className="flex items-center gap-1"><ExternalLink size={12}/> {productInfo.platform}</span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono">{productInfo.campaign_name}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full xl:w-auto">
          <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex items-center">
            <button
              onClick={() => setViewCurrency('ORIGINAL')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewCurrency === 'ORIGINAL' 
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <DollarSign size={14} />
              Original (USD)
            </button>
            <button
              onClick={() => setViewCurrency('BRL')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewCurrency === 'BRL' 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowRightLeft size={14} />
              Convertido (BRL)
            </button>
          </div>

          <div className="flex items-center gap-3 bg-slate-900 p-1 rounded-lg border border-slate-800">
            {['7d', '30d', 'Este Mês', 'Total'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                  timeRange === range 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl group hover:border-indigo-500/30 transition-all">
          <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 flex justify-between">
            Lucro Líquido
            <span className="text-[10px] bg-slate-800 px-1.5 rounded text-slate-400">
              {viewCurrency === 'BRL' ? 'Em Reais' : 'Em Dólar'}
            </span>
          </p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-emerald-400">
              {formatMoney(getDisplayValue(summaryStatsBase.profit, summaryStatsBase.avg_rate))}
            </span>
            <div className="flex items-center text-emerald-500 text-xs mb-1 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              <ArrowUpRight size={12} /> 12%
            </div>
          </div>
        </div>
        
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
          <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">ROI (Média)</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-indigo-400">{summaryStatsBase.roi}%</span>
          </div>
        </div>
        
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
          <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Custo Total</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-rose-400">
              {formatMoney(getDisplayValue(summaryStatsBase.cost, summaryStatsBase.avg_rate))}
            </span>
          </div>
        </div>
        
        <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-xl">
          <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Receita Total</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-white">
              {formatMoney(getDisplayValue(summaryStatsBase.revenue, summaryStatsBase.avg_rate))}
            </span>
            <span className="text-slate-500 text-xs mb-1">{summaryStatsBase.conversions} vendas</span>
          </div>
        </div>
      </div>

      {/* Gráfico */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-semibold text-white">Evolução Financeira (7 dias)</h3>
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-2 text-slate-400"><div className="w-3 h-3 bg-emerald-500 rounded-full"></div> Lucro</div>
              <div className="flex items-center gap-2 text-slate-400"><div className="w-3 h-3 bg-rose-500/50 rounded-full"></div> Custo</div>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={0}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => viewCurrency === 'BRL' ? `R$${val}` : `$${val}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                  cursor={{fill: '#1e293b', opacity: 0.4}}
                  // CORREÇÃO: Aceita any para evitar erro de build
                  formatter={(value: any) => formatMoney(Number(value))}
                />
                <Bar dataKey="lucro" name="Lucro" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.lucro > 0 ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
                <Bar dataKey="custo" name="Custo" fill="#f43f5e" opacity={0.3} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Info Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Coins size={16} className="text-indigo-400"/> Status da Moeda
          </h3>
          <div className={`p-4 rounded-lg border transition-all mb-4 ${viewCurrency === 'BRL' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-950 border-slate-800'}`}>
             <div className="flex justify-between items-center mb-1">
               <span className={`text-sm font-bold ${viewCurrency === 'BRL' ? 'text-emerald-400' : 'text-slate-400'}`}>Modo Convertido (BRL)</span>
               {viewCurrency === 'BRL' && <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>}
             </div>
             <p className="text-xs text-slate-500">Exibindo valores convertidos para Reais com a cotação do dia.</p>
          </div>
          <div className="mt-auto">
            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
              <span className="text-slate-500 text-xs block mb-1">Cotação Dólar (Hoje)</span>
              <span className="text-2xl font-mono text-white">R$ 6,15</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm relative flex flex-col h-[600px]">
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center bg-slate-900/50 gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-white">Histórico Completo</h3>
            <span className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800">{fullHistoryData.length} dias</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowColumnModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors border border-slate-700">
              <Columns size={14} /> Personalizar
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 rounded transition-colors">
              <Download size={14} /> CSV
            </button>
          </div>
        </div>

        <div className="overflow-auto custom-scrollbar flex-1">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-xs text-slate-500 uppercase bg-slate-950 font-semibold sticky top-0 z-20 shadow-lg">
              <tr>
                <th className="px-6 py-4 sticky left-0 bg-slate-950 z-30 shadow-r border-b border-slate-800 min-w-[120px]">Data</th>
                {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => (
                  <th key={col.key} className="px-4 py-4 whitespace-nowrap border-b border-slate-800 text-right bg-slate-950">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {fullHistoryData.map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="px-6 py-4 font-medium text-white sticky left-0 bg-slate-900 group-hover:bg-slate-800 transition-colors shadow-r border-r border-slate-800">{row.date}</td>
                  {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(col => {
                    const val = row[col.key as keyof typeof row];
                    let cellContent;
                    if (col.format === 'currency') {
                      const displayVal = getDisplayValue(val as number, row.exchange_rate);
                      cellContent = (
                        <span className={col.key === 'profit' ? (displayVal > 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold') : 'text-slate-300'}>
                          {formatMoney(displayVal)}
                        </span>
                      );
                    } else if (col.format === 'percentage') {
                      cellContent = <span className={`px-2 py-1 rounded text-xs border ${String(val).includes('-') ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{val}</span>;
                    } else if (col.key === 'url') {
                      cellContent = <a href={val as string} target="_blank" className="text-indigo-400 hover:underline flex items-center justify-end gap-1">Link <ExternalLink size={10}/></a>;
                    } else {
                      cellContent = <span className="text-slate-400">{val}</span>;
                    }
                    return <td key={col.key} className="px-4 py-4 whitespace-nowrap text-right align-middle">{cellContent}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Modal Columns */}
      {showColumnModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Columns size={20} className="text-indigo-500"/> Personalizar Colunas</h2>
              <button onClick={() => setShowColumnModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {['Tráfego', 'Custo', 'Financeiro', 'Google Ads'].map(category => (
                  <div key={category}>
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