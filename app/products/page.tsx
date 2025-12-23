"use client";

import React, { useState, useEffect } from 'react';
import { Package, Plus, Search, ExternalLink, X, ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Configuração Supabase
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
    platform: '', 
    currency: 'BRL', 
    status: 'active' 
  });

  // Busca produtos ao carregar a página
  useEffect(() => { 
    fetchProducts(); 
  }, []);

  async function fetchProducts() {
    setLoading(true);
    
    // Tenta recuperar o ID do usuário localmente para filtrar (se houver)
    const currentUserId = typeof window !== 'undefined' ? localStorage.getItem('autometrics_user_id') : null;
    
    let query = supabase.from('products').select('*').order('created_at', { ascending: false });
    
    // Se tivermos um ID de usuário, filtramos apenas os produtos dele
    if (currentUserId) {
      query = query.eq('user_id', currentUserId);
    }

    const { data } = await query;
    if (data) setProducts(data);
    setLoading(false);
  }

  const handleSave = async () => {
    // Validação
    if (!newProduct.name || !newProduct.campaign_name || !newProduct.platform) {
      return alert("Preencha todos os campos obrigatórios.");
    }

    // 1. Lógica Automática de ID do Usuário (Segurança)
    let currentUserId = localStorage.getItem('autometrics_user_id');
    if (!currentUserId) {
      // Se não tiver ID, cria um novo e salva
      currentUserId = crypto.randomUUID();
      localStorage.setItem('autometrics_user_id', currentUserId);
    }

    setSaving(true);

    // 2. Salva no banco com o user_id
    const { data, error } = await supabase.from('products').insert([{
      name: newProduct.name,
      google_ads_campaign_name: newProduct.campaign_name,
      platform: newProduct.platform,
      currency: newProduct.currency,
      status: newProduct.status,
      user_id: currentUserId // Vínculo automático para o script
    }]).select();

    if (error) {
      // Tratamento de erro de duplicidade (Nome de campanha já existe para este usuário)
      if (error.code === '23505') {
        alert('Erro: Você já cadastrou uma campanha com esse nome exato.');
      } else {
        alert('Erro ao salvar: ' + error.message);
      }
    } else if (data) {
      // Sucesso: Atualiza a lista e fecha o modal
      setProducts([data[0], ...products]);
      setIsModalOpen(false);
      setNewProduct({ name: '', campaign_name: '', platform: '', currency: 'BRL', status: 'active' });
      alert('Produto salvo com sucesso!');
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex">
      
      {/* Sidebar de Navegação (Fixo à esquerda) */}
      <aside className="w-16 md:w-64 bg-slate-950 border-r border-slate-900 flex flex-col fixed h-full z-20">
        <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-slate-900">
           <Link href="/dashboard" className="flex items-center gap-2 text-white font-bold hover:text-indigo-400 transition-colors">
             <ArrowLeft size={20} />
             <span className="hidden md:inline">Voltar</span>
           </Link>
        </div>
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 ml-16 md:ml-64 p-4 md:p-8">
        
        {/* Cabeçalho */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Package className="text-indigo-500" /> Meus Produtos
          </h1>
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-lg shadow-indigo-900/20"
          >
            <Plus size={18} /> Novo Produto
          </button>
        </div>

        {/* Barra de Busca */}
        <div className="bg-slate-900/50 border border-slate-900 p-4 rounded-xl mb-6 flex gap-4 items-center">
          <Search className="text-slate-500" size={18} />
          <input 
            type="text" 
            placeholder="Buscar produto..." 
            className="bg-transparent text-white w-full outline-none placeholder:text-slate-600" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
          <button onClick={() => fetchProducts()} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} />
          </button>
        </div>

        {/* Grid de Produtos */}
        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-slate-500">Carregando produtos...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map((product) => (
              
              /* LINK CLICÁVEL: Envolve todo o card */
              <Link key={product.id} href={`/products/${product.id}`} className="block group">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/50 hover:bg-slate-900/80 transition-all h-full relative overflow-hidden">
                  
                  {/* Ícone de Hover */}
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-0 translate-x-4">
                     <ExternalLink size={18} className="text-indigo-400" />
                  </div>

                  {/* Ícone da Moeda */}
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-xl flex items-center justify-center w-12 h-12 
                      ${product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : 
                        product.currency === 'EUR' ? 'bg-blue-500/10 text-blue-500' : 
                        'bg-emerald-500/10 text-emerald-500'}`}>
                        {product.currency === 'USD' ? '$' : product.currency === 'EUR' ? '€' : 'R$'}
                    </div>
                    <span className="text-xs font-medium border border-slate-700 px-2 py-1 rounded bg-slate-800 text-slate-400 uppercase">
                      {product.currency}
                    </span>
                  </div>
                  
                  {/* Nome e Plataforma */}
                  <h3 className="text-lg font-bold text-white mb-1 group-hover:text-indigo-400 transition-colors">
                    {product.name}
                  </h3>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mb-4">
                    {product.platform}
                  </p>
                  
                  {/* Footer do Card: Campanha Vinculada */}
                  <div className="space-y-3 border-t border-slate-800 pt-4">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Campanha Vinculada</span>
                      <p className="text-xs text-slate-300 font-mono bg-black/50 border border-slate-800 px-2 py-1.5 rounded mt-1 truncate group-hover:border-indigo-500/30 transition-colors">
                        {product.google_ads_campaign_name}
                      </p>
                    </div>
                  </div>
                  
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Modal de Novo Produto */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white">Novo Produto</h2>
                <button onClick={() => setIsModalOpen(false)}><X size={24} className="text-slate-400 hover:text-white" /></button>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nome do Produto</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none transition-colors placeholder:text-slate-600" 
                    placeholder="Ex: Epicooler 85" 
                    value={newProduct.name} 
                    onChange={(e) => setNewProduct({...newProduct, name: e.target.value})} 
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nome Exato da Campanha (Google Ads)</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white font-mono text-sm focus:border-indigo-500 outline-none transition-colors placeholder:text-slate-600" 
                    placeholder="Ex: [FF] EPICOOLER 85" 
                    value={newProduct.campaign_name} 
                    onChange={(e) => setNewProduct({...newProduct, campaign_name: e.target.value})} 
                  />
                  <p className="text-[10px] text-indigo-400 mt-1">* Deve ser idêntico ao nome no Google Ads.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Plataforma</label>
                    <input 
                      type="text" 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none transition-colors placeholder:text-slate-600" 
                      placeholder="Ex: Kiwify, Eduzz..."
                      value={newProduct.platform} 
                      onChange={(e) => setNewProduct({...newProduct, platform: e.target.value})} 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Moeda</label>
                    <select 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 outline-none appearance-none cursor-pointer"
                      value={newProduct.currency} 
                      onChange={(e) => setNewProduct({...newProduct, currency: e.target.value})}
                    >
                      <option value="BRL">Real (BRL)</option>
                      <option value="USD">Dólar (USD)</option>
                      <option value="EUR">Euro (EUR)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-slate-800">
                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white transition-colors">Cancelar</button>
                <button 
                  onClick={handleSave} 
                  disabled={saving} 
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center gap-2 transition-all disabled:opacity-50"
                >
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