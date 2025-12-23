"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Save, Calendar, ArrowLeft, DollarSign, Users, ShoppingCart, RefreshCw, AlertCircle } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Configuração do Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ManualEntryPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Estados do Formulário
  const [selectedProductId, setSelectedProductId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState('BRL');

  const [formData, setFormData] = useState({
    visits: 0,
    checkouts: 0,
    conversions: 0,
    revenue: 0, // Visualmente chamamos de revenue
    refunds: 0
  });

  // Carrega Produtos ao Iniciar
  useEffect(() => {
    async function fetchProducts() {
      const currentUserId = localStorage.getItem('autometrics_user_id');
      let query = supabase.from('products').select('*').eq('status', 'active');
      
      if (currentUserId) {
        query = query.eq('user_id', currentUserId);
      }

      const { data } = await query;
      if (data) {
        setProducts(data);
        if (data.length > 0) setSelectedProductId(data[0].id);
      }
      setLoading(false);
    }
    fetchProducts();
  }, []);

  // Simulação em Tempo Real (Card Lateral)
  const stats = useMemo(() => {
    const visits = Number(formData.visits) || 0;
    const sales = Number(formData.conversions) || 0;
    const rev = Number(formData.revenue) || 0;

    const conversionRate = visits > 0 ? (sales / visits) * 100 : 0;
    const ticket = sales > 0 ? rev / sales : 0;

    return { conversionRate, ticket };
  }, [formData]);

  const handleSave = async () => {
    if (!selectedProductId) return alert("Selecione um produto.");
    
    setSaving(true);
    try {
      // 1. Prepara o Payload (O SEGREDO ESTÁ AQUI)
      const payload = {
        product_id: selectedProductId,
        date: date,
        
        // Mapeamento correto para o Banco de Dados
        visits: Number(formData.visits),
        checkouts: Number(formData.checkouts),
        conversions: Number(formData.conversions),
        conversion_value: Number(formData.revenue), // <--- A CORREÇÃO: Envia 'revenue' para 'conversion_value'
        refunds: Number(formData.refunds),
        
        currency: currency, // Salva a moeda escolhida
        updated_at: new Date().toISOString()
      };

      // 2. Envia para o Supabase (Upsert: Atualiza se existir, Cria se não)
      // O onConflict garante que não duplicamos, apenas atualizamos o dia
      const { error } = await supabase
        .from('daily_metrics')
        .upsert(payload, { onConflict: 'product_id, date' });

      if (error) throw error;

      alert("✅ Dados salvos com sucesso!");
      
      // Opcional: Limpar formulário ou manter
      // setFormData({ visits: 0, checkouts: 0, conversions: 0, revenue: 0, refunds: 0 });

    } catch (error: any) {
      alert("❌ Erro ao salvar: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-5xl">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Lançamento Diário</h1>
            <p className="text-slate-500 text-sm">Preencha as métricas manuais da plataforma de vendas.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Coluna Principal: Formulário */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Bloco 1: Seleção */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Produto</label>
                  <select 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white outline-none focus:border-indigo-500"
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Data de Referência</label>
                  <div className="relative">
                    <input 
                      type="date" 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white outline-none focus:border-indigo-500 [&::-webkit-calendar-picker-indicator]:invert"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                    <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18}/>
                  </div>
                </div>
              </div>
            </div>

            {/* Bloco 2: Métricas */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-white flex items-center gap-2">Métricas de Funil</h3>
                <div className="flex items-center gap-2">
                   <span className="text-xs text-slate-500 uppercase font-bold">Moeda:</span>
                   <select 
                      value={currency} 
                      onChange={(e) => setCurrency(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded text-xs px-2 py-1 outline-none text-white"
                   >
                      <option value="BRL">Real (BRL)</option>
                      <option value="USD">Dólar (USD)</option>
                   </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                {/* Visitas */}
                <div>
                  <label className="text-xs text-slate-400 flex items-center gap-1 mb-2">
                    <Users size={14} /> Visitas na Página
                  </label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white outline-none focus:border-indigo-500 font-mono"
                    placeholder="0"
                    value={formData.visits}
                    onChange={(e) => setFormData({...formData, visits: Number(e.target.value)})}
                  />
                </div>

                {/* Checkout */}
                <div>
                  <label className="text-xs text-slate-400 flex items-center gap-1 mb-2">
                    <ShoppingCart size={14} /> Initiated Checkout
                  </label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white outline-none focus:border-indigo-500 font-mono"
                    placeholder="0"
                    value={formData.checkouts}
                    onChange={(e) => setFormData({...formData, checkouts: Number(e.target.value)})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-slate-800 pt-6">
                {/* Vendas */}
                <div>
                  <label className="text-xs text-emerald-400 font-bold flex items-center gap-1 mb-2">
                    <CheckCircleIcon /> Vendas Confirmadas
                  </label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white outline-none focus:border-emerald-500 font-mono"
                    placeholder="0"
                    value={formData.conversions}
                    onChange={(e) => setFormData({...formData, conversions: Number(e.target.value)})}
                  />
                </div>

                {/* Receita (AQUI OCORRIA O ERRO) */}
                <div>
                  <label className="text-xs text-emerald-400 font-bold flex items-center gap-1 mb-2">
                    <DollarSign size={14} /> Receita Total ({currency})
                  </label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white outline-none focus:border-emerald-500 font-mono"
                    placeholder="0.00"
                    value={formData.revenue}
                    onChange={(e) => setFormData({...formData, revenue: Number(e.target.value)})}
                  />
                </div>
              </div>

              {/* Reembolsos */}
              <div className="mt-6">
                 <label className="text-xs text-rose-400 font-bold flex items-center gap-1 mb-2">
                    <RefreshCw size={14} /> Reembolsos ({currency})
                  </label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white outline-none focus:border-rose-500 font-mono"
                    placeholder="0.00"
                    value={formData.refunds}
                    onChange={(e) => setFormData({...formData, refunds: Number(e.target.value)})}
                  />
              </div>

              <button 
                onClick={handleSave}
                disabled={saving}
                className="w-full mt-8 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Salvando...' : 'Salvar Dados'} <Save size={18} />
              </button>

            </div>
          </div>

          {/* Coluna Lateral: Simulação */}
          <div className="lg:col-span-1">
             <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sticky top-8">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-6">Simulação do Dia</h4>
                
                <div className="space-y-6">
                   <div>
                      <div className="flex justify-between text-sm mb-1">
                         <span className="text-slate-400">Taxa de Conversão</span>
                         <span className="text-white font-mono">{stats.conversionRate.toFixed(2)}%</span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
                         <div className="bg-emerald-500 h-full transition-all duration-500" style={{width: `${Math.min(stats.conversionRate, 100)}%`}}></div>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-1">Baseado em {formData.visits} visitas</p>
                   </div>

                   <div className="flex justify-between items-center py-4 border-t border-slate-800">
                      <span className="text-slate-400 text-sm">Ticket Médio</span>
                      <span className="text-xl font-bold text-white font-mono">
                         {currency === 'BRL' ? 'R$' : '$'} {stats.ticket.toFixed(2)}
                      </span>
                   </div>

                   <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-lg flex gap-3">
                      <AlertCircle className="text-indigo-400 shrink-0" size={18} />
                      <p className="text-xs text-indigo-200 leading-relaxed">
                         Os dados de <strong>Custo (Google Ads)</strong> serão mesclados automaticamente nesta data e moeda.
                      </p>
                   </div>
                </div>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// Pequeno helper para ícone
function CheckCircleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
  )
}