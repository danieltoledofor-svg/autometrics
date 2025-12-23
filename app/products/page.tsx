"use client";

import React, { useState, useEffect } from 'react';
import { Package, Plus, Search, DollarSign, ExternalLink, X, ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Estado do formulário de novo produto
  const [newProduct, setNewProduct] = useState({ 
    name: '', 
    campaign_name: '', 
    platform: '', // Agora começa vazio para digitação
    currency: 'BRL', 
    status: 'active' 
  });

  useEffect(() => { fetchProducts(); }, []);

  async function fetchProducts() {
    setLoading(true);
    const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (data) setProducts(data);
    setLoading(false);
  }

  const handleSave = async () => {
    // Validação básica
    if (!newProduct.name || !newProduct.campaign_name || !newProduct.platform) {
      return alert("Preencha todos os campos obrigatórios (Nome, Campanha e Plataforma).");
    }

    setSaving(true);
    const { data, error } = await supabase.from('products').insert([{
      name: newProduct.name,
      google_ads_campaign_name: newProduct.campaign_name,
      platform: newProduct.platform, // Salva o texto que você digitou
      currency: newProduct.currency,
      status: newProduct.status
    }]).select();

    if (error) {
      alert(error.code === '23505' ? 'Erro: Já existe um produto com esse nome de campanha.' : 'Erro ao salvar: ' + error.message);
    } else if (data) {
      setProducts([data[0], ...products]);
      setIsModalOpen(false);
      // Limpa o formulário
      setNewProduct({ name: '', campaign_name: '', platform: '', currency: 'BRL', status: 'active' });
      alert('Produto salvo com sucesso!');
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex">
      {/* Sidebar simples para voltar */}
      <aside className="w-16 md:w-64 bg-slate-950 border-r border-slate-900 flex flex-col fixed h-full z-20">
        <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-slate-900">
           <Link href="/dashboard" className="flex items-center gap-2 text-white font-bold hover:text-indigo-400 transition-colors"><ArrowLeft size={20} /><span className="hidden md:inline">Voltar</span></Link>
        </div>
      </aside>

      <main className="flex-1 ml-16 md:ml-64 p-4 md:p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3"><Package className="text-indigo-500" /> Meus Produtos</h1>
          <button onClick={() => setIsModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"><Plus size={18} /> Novo Produto</button>
        </div>

        {/* Barra de Busca */}
        <div className="bg-slate-900/50 border border-slate-900 p-4 rounded-xl mb-6 flex gap-4 items-center">
          <Search className="text-slate-500" size={18} />
          <input type="text" placeholder="Buscar produto..." className="bg-transparent text-white w-full outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <button onClick={() => fetchProducts()}><RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} /></button>
        </div>

        {/* Grid de Produtos */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map((product) => (
            <div key={product.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/30 transition-all group">
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl flex items-center justify-center w-12 h-12 
                  ${product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : 
                    product.currency === 'EUR' ? 'bg-blue-500/10 text-blue-500' : 
                    'bg-emerald-500/10 text-emerald-500'}`}>
                    {product.currency === 'USD' ? '$' : product.currency === 'EUR' ? '€' : 'R$'}
                </div>
                <span className="text-xs font-medium border border-slate-700 px-2 py-1 rounded bg-slate-800 text-slate-400 uppercase">{product.currency}</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">{product.name}</h3>
              <p className="text-xs text-slate-500 flex items-center gap-1 mb-4">
                <ExternalLink size={12} /> {product.platform}
              </p>
              <div className="space-y-3 border-t border-slate-800 pt-4">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Campanha Vinculada</span>
                  <p className="text-xs text-slate-300 font-mono bg-black/50 border border-slate-800 px-2 py-1.5 rounded mt-1 truncate group-hover:text-white transition-colors">
                    {product.google_ads_campaign_name}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Modal de Novo Produto */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white">Novo Produto</h2>
                <button onClick={() => setIsModalOpen(false)}><X size={24} className="text-slate-400 hover:text-white" /></button>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nome do Produto</label>
                  <input type="text" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none transition-colors" placeholder="Ex: Epicooler 85" 
                    value={newProduct.name} onChange={(e) => setNewProduct({...newProduct, name: e.target.value})} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nome Exato da Campanha (Google Ads)</label>
                  <input type="text" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white font-mono text-sm focus:border-indigo-500 outline-none transition-colors" placeholder="Ex: [FF] EPICOOLER 85" 
                    value={newProduct.campaign_name} onChange={(e) => setNewProduct({...newProduct, campaign_name: e.target.value})} />
                  <p className="text-[10px] text-indigo-400 mt-1">* Deve ser idêntico ao nome no Google Ads.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* ALTERAÇÃO 1: INPUT DE TEXTO LIVRE PARA PLATAFORMA */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Plataforma</label>
                    <input 
                      type="text" 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none transition-colors" 
                      placeholder="Ex: Kiwify, Eduzz..."
                      value={newProduct.platform} 
                      onChange={(e) => setNewProduct({...newProduct, platform: e.target.value})} 
                    />
                  </div>

                  {/* ALTERAÇÃO 2: MOEDA COM EURO */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Moeda</label>
                    <select 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none appearance-none cursor-pointer"
                      value={newProduct.currency} 
                      onChange={(e) => setNewProduct({...newProduct, currency: e.target.value})}
                    >
                      <option value="BRL">Real (BRL)</option>
                      <option value="USD">Dólar (USD)</option>
                      <option value="EUR">Euro (EUR)</option> {/* ADICIONADO EURO */}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-slate-800">
                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white transition-colors">Cancelar</button>
                <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center gap-2">
                  {saving && <Loader2 className="animate-spin" size={16} />}
                  Salvar Produto
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}