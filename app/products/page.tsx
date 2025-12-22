"use client";

import React, { useState, useEffect } from 'react';
import { 
  Package, Plus, Search, Edit2, 
  DollarSign, ExternalLink, X, 
  ArrowLeft, RefreshCw
} from 'lucide-react';

// --- CONEXÃO COM BANCO DE DADOS (ATIVADA) ---
// Certifique-se de ter instalado: npm install @supabase/supabase-js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- DADOS MOCK (DESATIVADOS) ---
// Mantidos aqui apenas como referência de estrutura, caso precise testar offline.
/*
const MOCK_PRODUCTS = [
  { id: '1', name: 'EPICOOLER 85', google_ads_campaign_name: '[FF] EPICOOLER 85', platform: 'Hotmart', currency: 'BRL', status: 'active' },
  { id: '2', name: 'FASTTRACK MUNDO MCQ', google_ads_campaign_name: '[FF PROD] FASTTRACK MUNDO MCQ', platform: 'Clickbank', currency: 'USD', status: 'active' }
];
*/

type Product = {
  id: string;
  name: string;
  google_ads_campaign_name: string; // Nome exato da coluna no Banco
  platform: string;
  currency: string;
  status: string;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // Estado para o formulário
  const [newProduct, setNewProduct] = useState({
    name: '',
    campaign_name: '',
    platform: 'Hotmart',
    currency: 'BRL',
    status: 'active'
  });

  // --- CARREGAR PRODUTOS (DO SUPABASE) ---
  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    setLoading(true);
    try {
      // Busca dados reais na tabela 'products'
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      if (data) {
        setProducts(data);
      }
    } catch (error) {
      console.error('Erro ao buscar produtos:', error);
      alert('Erro ao carregar produtos. Verifique sua conexão com o Supabase.');
    } finally {
      setLoading(false);
    }
  }

  // --- SALVAR NOVO PRODUTO (NO SUPABASE) ---
  const handleSave = async () => {
    if (!newProduct.name || !newProduct.campaign_name) {
      alert("Preencha os campos obrigatórios");
      return;
    }

    // Prepara o objeto exatamente como o Banco de Dados espera
    const productPayload = {
      name: newProduct.name,
      google_ads_campaign_name: newProduct.campaign_name, // Mapeando para o nome correto da coluna
      platform: newProduct.platform,
      currency: newProduct.currency,
      status: newProduct.status
    };

    try {
      const { data, error } = await supabase
        .from('products')
        .insert([productPayload])
        .select();

      if (error) {
        console.error('Erro Supabase:', error);
        throw error;
      }

      if (data) {
        // Adiciona o produto recém-criado à lista local para atualização imediata
        setProducts([data[0], ...products]);
        setIsModalOpen(false);
        setNewProduct({ name: '', campaign_name: '', platform: 'Hotmart', currency: 'BRL', status: 'active' });
        alert('Produto salvo com sucesso!');
      }
      
    } catch (error: any) {
      console.error('Erro ao salvar:', error);
      // Tratamento de erro específico para duplicidade
      if (error.code === '23505') {
        alert('Erro: Já existe um produto vinculado a essa Campanha do Google Ads.');
      } else {
        alert('Erro ao salvar produto. Verifique o console.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex">
      
      {/* Sidebar Simplificada */}
      <aside className="w-16 md:w-64 bg-slate-950 border-r border-slate-900 flex flex-col fixed h-full z-20">
        <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-slate-900">
           <a href="/dashboard" className="flex items-center gap-2 text-white font-bold hover:text-indigo-400 transition-colors">
             <ArrowLeft size={20} />
             <span className="hidden md:inline">Voltar</span>
           </a>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="flex-1 ml-16 md:ml-64 p-4 md:p-8">
        
        {/* Cabeçalho */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Package className="text-indigo-500" />
              Meus Produtos
            </h1>
            <p className="text-slate-500 text-sm mt-1">Gerencie os produtos e vincule às campanhas.</p>
          </div>
          
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-900/20 flex items-center gap-2"
          >
            <Plus size={18} />
            Novo Produto
          </button>
        </div>

        {/* Barra de Busca */}
        <div className="bg-slate-900/50 border border-slate-900 p-4 rounded-xl mb-6 flex flex-col sm:flex-row gap-4 justify-between items-center">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Buscar produto..." 
              className="w-full bg-slate-950 border border-slate-800 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button onClick={() => fetchProducts()} className="p-2 text-slate-400 hover:text-white transition-colors" title="Recarregar">
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Grid de Produtos */}
        {loading && products.length === 0 ? (
          <div className="text-center py-20 text-slate-500">Carregando produtos do banco de dados...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map((product) => (
              <div key={product.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/30 transition-all group relative">
                
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-xl ${product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    <DollarSign size={24} />
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    product.status === 'active' 
                      ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20' 
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {product.status === 'active' ? 'Ativo' : 'Pausado'}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-1">{product.name}</h3>
                <p className="text-xs text-slate-500 flex items-center gap-1 mb-4">
                  <ExternalLink size={12} />
                  {product.platform}
                </p>

                <div className="space-y-3 border-t border-slate-800 pt-4">
                  <div>
                    <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Campanha (Ads)</span>
                    <p className="text-sm text-slate-300 font-mono bg-slate-950 px-2 py-1 rounded mt-1 truncate" title={product.google_ads_campaign_name}>
                      {product.google_ads_campaign_name}
                    </p>
                  </div>
                  
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Moeda</span>
                    <span className="text-white font-medium">{product.currency}</span>
                  </div>
                </div>

                <div className="mt-6 flex gap-3">
                  <a href={`/products/${product.id}`} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                    <Edit2 size={14} /> Detalhes
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de Cadastro */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <h2 className="text-xl font-bold text-white">Novo Produto</h2>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Nome do Produto</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                    placeholder="Ex: Epicooler 85"
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Nome Exato da Campanha (Google Ads)</label>
                  <input 
                    type="text" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 font-mono text-sm"
                    placeholder="Ex: [FF] EPICOOLER 85"
                    value={newProduct.campaign_name}
                    onChange={(e) => setNewProduct({...newProduct, campaign_name: e.target.value})}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Deve ser idêntico ao nome da campanha no Google Ads.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Plataforma</label>
                    <select 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 appearance-none"
                      value={newProduct.platform}
                      onChange={(e) => setNewProduct({...newProduct, platform: e.target.value})}
                    >
                      <option value="Hotmart">Hotmart</option>
                      <option value="Clickbank">Clickbank</option>
                      <option value="Monetizze">Monetizze</option>
                      <option value="Kiwify">Kiwify</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Moeda</label>
                    <select 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 appearance-none"
                      value={newProduct.currency}
                      onChange={(e) => setNewProduct({...newProduct, currency: e.target.value})}
                    >
                      <option value="BRL">Real (BRL)</option>
                      <option value="USD">Dólar (USD)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-950/50">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSave}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
                >
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