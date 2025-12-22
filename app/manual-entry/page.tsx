"use client";

import React, { useState, useEffect } from 'react';
import { 
  Calendar, Save, TrendingUp, Users, ShoppingCart, 
  DollarSign, RotateCcw, Check, ArrowLeft, AlertCircle
} from 'lucide-react';

// Simulando seus produtos cadastrados (viriam do banco de dados)
const myProducts = [
  { id: 1, name: 'EPICOOLER 85', currency: 'BRL', platform: 'Hotmart' },
  { id: 2, name: 'FASTTRACK MUNDO MCQ', currency: 'USD', platform: 'Clickbank' },
  { id: 3, name: 'PRODUTO TESTE A', currency: 'BRL', platform: 'Monetizze' },
];

export default function ManualEntryPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedProduct, setSelectedProduct] = useState(myProducts[0]);
  const [successMessage, setSuccessMessage] = useState('');

  // Estado do formulário
  const [formData, setFormData] = useState({
    visits: '',
    checkouts: '',
    conversions: '',
    revenue: '',
    refunds: ''
  });

  // Métricas calculadas em tempo real
  const [metrics, setMetrics] = useState({
    conversionRate: 0,
    ticketAverage: 0
  });

  // Atualiza métricas quando o formulário muda
  useEffect(() => {
    const visits = parseFloat(formData.visits) || 0;
    const conversions = parseFloat(formData.conversions) || 0;
    const revenue = parseFloat(formData.revenue) || 0;

    setMetrics({
      conversionRate: visits > 0 ? (conversions / visits) * 100 : 0,
      ticketAverage: conversions > 0 ? revenue / conversions : 0
    });
  }, [formData]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Permite apenas números e um ponto decimal
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleProductChange = (productId: string) => {
    const product = myProducts.find(p => p.id === parseInt(productId));
    if (product) setSelectedProduct(product);
  };

  const handleSave = () => {
    // Aqui entraria a lógica de salvar no Supabase
    setSuccessMessage('Dados salvos com sucesso!');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex justify-center p-4 md:p-8">
      
      <div className="w-full max-w-4xl">
        
        {/* Cabeçalho com botão de Voltar */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
               <a href="/dashboard" className="p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-white transition-colors">
                 <ArrowLeft size={20} />
               </a>
               <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                 Lançamento Diário
               </h1>
            </div>
            <p className="text-slate-500 text-sm ml-12">
              Preencha as métricas manuais da plataforma de vendas.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Coluna da Esquerda: Seleção e Formulário */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Card de Seleção Contextual */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Produto
                  </label>
                  <select 
                    className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors appearance-none cursor-pointer"
                    onChange={(e) => handleProductChange(e.target.value)}
                    value={selectedProduct.id}
                  >
                    {myProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Data de Referência
                  </label>
                  <div className="relative">
                    <input 
                      type="date" 
                      className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors [&::-webkit-calendar-picker-indicator]:invert"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                    />
                    <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
                  </div>
                </div>
              </div>
            </div>

            {/* Formulário de Métricas */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white">Métricas de Funil</h2>
                <span className="text-xs font-medium px-2 py-1 bg-slate-800 text-slate-400 rounded border border-slate-700">
                  Moeda: {selectedProduct.currency}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Visitas */}
                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">
                    <Users size={16} /> Visitas na Página
                  </label>
                  <input 
                    type="text" 
                    name="visits"
                    placeholder="0" 
                    className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-right font-mono"
                    value={formData.visits}
                    onChange={handleInputChange}
                  />
                </div>

                {/* Checkouts */}
                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">
                    <ShoppingCart size={16} /> Initiated Checkout
                  </label>
                  <input 
                    type="text" 
                    name="checkouts"
                    placeholder="0" 
                    className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-right font-mono"
                    value={formData.checkouts}
                    onChange={handleInputChange}
                  />
                </div>

                {/* Conversões (Vendas) */}
                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-emerald-400 transition-colors">
                    <Check size={16} /> Vendas Confirmadas
                  </label>
                  <input 
                    type="text" 
                    name="conversions"
                    placeholder="0" 
                    className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all text-right font-mono"
                    value={formData.conversions}
                    onChange={handleInputChange}
                  />
                </div>

                {/* Receita Manual */}
                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-emerald-400 transition-colors">
                    <DollarSign size={16} /> Receita Total ({selectedProduct.currency})
                  </label>
                  <input 
                    type="text" 
                    name="revenue"
                    placeholder="0.00" 
                    className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all text-right font-mono text-lg font-bold text-emerald-400"
                    value={formData.revenue}
                    onChange={handleInputChange}
                  />
                </div>

                {/* Reembolsos */}
                <div className="relative group md:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-rose-400 transition-colors">
                    <RotateCcw size={16} /> Reembolsos / Chargebacks ({selectedProduct.currency})
                  </label>
                  <input 
                    type="text" 
                    name="refunds"
                    placeholder="0.00" 
                    className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/50 transition-all text-right font-mono text-rose-400"
                    value={formData.refunds}
                    onChange={handleInputChange}
                  />
                </div>

              </div>

              {/* Botão de Salvar */}
              <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between">
                <span className={`text-sm font-medium text-emerald-400 transition-opacity flex items-center gap-2 ${successMessage ? 'opacity-100' : 'opacity-0'}`}>
                  <Check size={16} /> {successMessage}
                </span>
                
                <button 
                  onClick={handleSave}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-900/20 active:scale-95 transition-all flex items-center gap-2"
                >
                  <Save size={18} />
                  Salvar Dados
                </button>
              </div>
            </div>
          </div>

          {/* Coluna da Direita: Preview e Feedback */}
          <div className="space-y-6">
            
            {/* Card de Resumo (Feedback Imediato) */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 p-6 rounded-xl">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-6">Simulação do Dia</h3>
              
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-500">Taxa de Conversão</span>
                    <span className={`font-bold ${metrics.conversionRate > 1 ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {metrics.conversionRate.toFixed(2)}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-500"
                      style={{ width: `${Math.min(metrics.conversionRate * 10, 100)}%` }} 
                    />
                  </div>
                  <p className="text-xs text-slate-600 mt-1">Baseado em {formData.visits || 0} visitas</p>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-500 text-sm">Ticket Médio</span>
                    <span className="text-white font-mono font-bold">
                      {selectedProduct.currency === 'USD' ? '$' : 'R$'} {metrics.ticketAverage.toFixed(2)}
                    </span>
                  </div>
                </div>

                 <div className="pt-4 border-t border-slate-800">
                  <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex gap-3">
                    <AlertCircle className="text-indigo-400 shrink-0" size={18} />
                    <p className="text-xs text-indigo-300">
                      Os dados de Custo e Google Ads serão importados automaticamente na próxima sincronização (04:00 AM).
                    </p>
                  </div>
                </div>

              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}