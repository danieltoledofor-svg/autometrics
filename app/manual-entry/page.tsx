"use client";

import React, { useState, useEffect } from 'react';
import { 
  Calendar, Save, Users, ShoppingCart, 
  DollarSign, RotateCcw, Check, ArrowLeft, AlertCircle, Loader2
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Configuração do Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ManualEntryPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedProductId, setSelectedProductId] = useState('');
  
  // NOVO: Estado para controlar a moeda selecionada manualmente
  const [manualCurrency, setManualCurrency] = useState('BRL');
  
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Estado do formulário
  const [formData, setFormData] = useState({
    visits: '',
    checkouts: '',
    conversions: '',
    revenue: '',
    refunds: ''
  });

  // Métricas calculadas em tempo real (Visual)
  const [metrics, setMetrics] = useState({
    conversionRate: 0,
    ticketAverage: 0
  });

  // 1. Busca Produtos ao carregar a página
  useEffect(() => {
    async function fetchProducts() {
      try {
        const { data } = await supabase.from('products').select('*').order('name');
        if (data && data.length > 0) {
          setProducts(data);
          setSelectedProductId(data[0].id);
          setManualCurrency(data[0].currency || 'BRL'); // Define moeda inicial
        }
      } catch (error) {
        console.error("Erro ao buscar produtos:", error);
      } finally {
        setLoadingProducts(false);
      }
    }
    fetchProducts();
  }, []);

  // 2. Busca dados existentes E atualiza moeda padrão quando troca Produto
  useEffect(() => {
    async function fetchExistingData() {
      if (!selectedProductId) return;

      // A. Atualiza a moeda para o padrão do produto selecionado
      const currentProd = products.find(p => p.id === selectedProductId);
      if (currentProd) {
        setManualCurrency(currentProd.currency);
      }

      if (!selectedDate) return;

      // B. Busca dados no banco
      const { data } = await supabase
        .from('daily_metrics')
        .select('visits, checkouts, conversions, conversion_value, refunds, currency') // Busca currency também
        .eq('product_id', selectedProductId)
        .eq('date', selectedDate)
        .single();

      if (data) {
        // Se já tem dados, preenche o form
        setFormData({
          visits: data.visits?.toString() || '',
          checkouts: data.checkouts?.toString() || '',
          conversions: data.conversions?.toString() || '',
          revenue: data.conversion_value?.toString() || '',
          refunds: data.refunds?.toString() || ''
        });
        // Se já tinha salvo uma moeda específica para esse dia, usa ela
        if (data.currency) {
          setManualCurrency(data.currency);
        }
      } else {
        // Se não tem, limpa o form mas MANTE A MOEDA do produto (já setada acima)
        setFormData({ visits: '', checkouts: '', conversions: '', revenue: '', refunds: '' });
      }
    }
    fetchExistingData();
  }, [selectedProductId, selectedDate, products]);

  // 3. Atualiza métricas visuais
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
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSave = async () => {
    if (!selectedProductId) return alert("Selecione um produto.");
    setIsSaving(true);
    setSuccessMessage('');

    try {
      const payload = {
        product_id: selectedProductId,
        date: selectedDate,
        
        visits: Number(formData.visits) || 0,
        checkouts: Number(formData.checkouts) || 0,
        conversions: Number(formData.conversions) || 0,
        conversion_value: Number(formData.revenue) || 0,
        refunds: Number(formData.refunds) || 0,
        
        currency: manualCurrency, // ATENÇÃO: Salva a moeda que você escolheu no select
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('daily_metrics')
        .upsert(payload, { onConflict: 'product_id, date' });

      if (error) throw error;

      setSuccessMessage('Dados salvos e sincronizados!');
      setTimeout(() => setSuccessMessage(''), 3000);

    } catch (error: any) {
      alert('Erro ao salvar: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingProducts) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-slate-500">Carregando produtos...</div>;
  }

  // Símbolo da moeda selecionada para exibir nos inputs
  const currencySymbol = manualCurrency === 'USD' ? '$' : manualCurrency === 'EUR' ? '€' : 'R$';

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl">
        
        {/* Cabeçalho */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
               <Link href="/dashboard" className="p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-white transition-colors">
                 <ArrowLeft size={20} />
               </Link>
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
          
          {/* Coluna da Esquerda: Formulário */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Seleção de Produto e Data */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Produto
                  </label>
                  <select 
                    className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    value={selectedProductId}
                  >
                    {products.map(p => (
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

            {/* Inputs de Métricas */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
              
              {/* --- ALTERAÇÃO AQUI: SELETOR DE MOEDA --- */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white">Métricas de Funil</h2>
                
                <div className="flex items-center gap-2">
                   <span className="text-xs text-slate-500 uppercase font-semibold">Moeda:</span>
                   <select 
                      value={manualCurrency}
                      onChange={(e) => setManualCurrency(e.target.value)}
                      className="text-xs font-medium px-2 py-1 bg-slate-950 text-white rounded border border-slate-700 focus:border-indigo-500 outline-none cursor-pointer"
                   >
                      <option value="BRL">Real (BRL)</option>
                      <option value="USD">Dólar (USD)</option>
                      <option value="EUR">Euro (EUR)</option>
                   </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400">
                    <Users size={16} /> Visitas na Página
                  </label>
                  <input type="text" name="visits" placeholder="0" className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-indigo-500 text-right font-mono"
                    value={formData.visits} onChange={handleInputChange} />
                </div>

                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400">
                    <ShoppingCart size={16} /> Initiated Checkout
                  </label>
                  <input type="text" name="checkouts" placeholder="0" className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-indigo-500 text-right font-mono"
                    value={formData.checkouts} onChange={handleInputChange} />
                </div>

                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-emerald-400">
                    <Check size={16} /> Vendas Confirmadas
                  </label>
                  <input type="text" name="conversions" placeholder="0" className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:outline-none focus:border-emerald-500 text-right font-mono"
                    value={formData.conversions} onChange={handleInputChange} />
                </div>

                <div className="relative group">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-emerald-400">
                    <DollarSign size={16} /> Receita Total ({manualCurrency})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-slate-500 font-mono">{currencySymbol}</span>
                    <input type="text" name="revenue" placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 text-white p-3 pl-10 rounded-lg focus:outline-none focus:border-emerald-500 text-right font-mono text-lg font-bold text-emerald-400"
                      value={formData.revenue} onChange={handleInputChange} />
                  </div>
                </div>

                <div className="relative group md:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2 group-focus-within:text-rose-400">
                    <RotateCcw size={16} /> Reembolsos ({manualCurrency})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-slate-500 font-mono">{currencySymbol}</span>
                    <input type="text" name="refunds" placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 text-white p-3 pl-10 rounded-lg focus:outline-none focus:border-rose-500 text-right font-mono text-rose-400"
                      value={formData.refunds} onChange={handleInputChange} />
                  </div>
                </div>

              </div>

              <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between">
                <span className={`text-sm font-medium text-emerald-400 transition-opacity flex items-center gap-2 ${successMessage ? 'opacity-100' : 'opacity-0'}`}>
                  <Check size={16} /> {successMessage}
                </span>
                
                <button 
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-900/20 active:scale-95 transition-all flex items-center gap-2"
                >
                  {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  {isSaving ? 'Salvando...' : 'Salvar Dados'}
                </button>
              </div>
            </div>
          </div>

          {/* Coluna da Direita: Preview */}
          <div className="space-y-6">
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
                    <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${Math.min(metrics.conversionRate * 10, 100)}%` }} />
                  </div>
                  <p className="text-xs text-slate-600 mt-1">Baseado em {formData.visits || 0} visitas</p>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-500 text-sm">Ticket Médio</span>
                    <span className="text-white font-mono font-bold">
                      {currencySymbol} {metrics.ticketAverage.toFixed(2)}
                    </span>
                  </div>
                </div>

                 <div className="pt-4 border-t border-slate-800">
                  <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex gap-3">
                    <AlertCircle className="text-indigo-400 shrink-0" size={18} />
                    <p className="text-xs text-indigo-300">
                      Os dados de Custo (Google Ads) serão mesclados automaticamente nesta data e moeda.
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