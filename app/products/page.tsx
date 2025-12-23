"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, Plus, Search, ExternalLink, X, ArrowLeft, RefreshCw, 
  Briefcase, Folder, Layers, LayoutGrid, ChevronRight
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Estado para seleção de conta
  const [selectedAccount, setSelectedAccount] = useState<string | null>('ALL');

  // Estados do Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ 
    name: '', campaign_name: '', platform: '', currency: 'BRL', status: 'active', account_name: 'Manual' 
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { 
    fetchProducts(); 
  }, []);

  async function fetchProducts() {
    setLoading(true);
    const currentUserId = localStorage.getItem('autometrics_user_id');
    
    let query = supabase.from('products').select('*').order('created_at', { ascending: false });
    
    if (currentUserId) {
      query = query.eq('user_id', currentUserId);
    }

    const { data } = await query;
    if (data) setProducts(data);
    setLoading(false);
  }

  // Agrupa produtos por Conta
  const accounts = useMemo(() => {
    const accSet = new Set(products.map(p => p.account_name || 'Sem Conta Vinculada'));
    return Array.from(accSet).sort();
  }, [products]);

  // Filtra produtos baseado na busca e na conta selecionada
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAccount = selectedAccount === 'ALL' || (p.account_name || 'Sem Conta Vinculada') === selectedAccount;
    return matchesSearch && matchesAccount;
  });

  const handleSave = async () => {
    // ... (Mantendo a lógica de salvamento existente)
    if (!newProduct.name || !newProduct.campaign_name) return alert("Preencha os campos obrigatórios.");
    
    let currentUserId = localStorage.getItem('autometrics_user_id');
    if (!currentUserId) {
       currentUserId = crypto.randomUUID();
       localStorage.setItem('autometrics_user_id', currentUserId);
    }
    setSaving(true);
    const { data, error } = await supabase.from('products').insert([{
      name: newProduct.name,
      google_ads_campaign_name: newProduct.campaign_name,
      platform: newProduct.platform,
      currency: newProduct.currency,
      status: newProduct.status,
      user_id: currentUserId,
      account_name: 'Manual'
    }]).select();

    if (error) alert('Erro: ' + error.message);
    else if (data) {
      setProducts([data[0], ...products]);
      setIsModalOpen(false);
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex flex-col md:flex-row">
      
      {/* --- SIDEBAR DE CONTAS (NOVO) --- */}
      <aside className="w-full md:w-72 bg-slate-950 border-r border-slate-900 flex flex-col h-screen sticky top-0">
        
        {/* Logo / Voltar */}
        <div className="p-6 border-b border-slate-900 flex items-center gap-3">
           <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
             <ArrowLeft size={18} />
           </Link>
           <span className="font-bold text-white tracking-wide">Minhas Contas</span>
        </div>

        {/* Lista de Contas */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
           <button 
             onClick={() => setSelectedAccount('ALL')}
             className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${selectedAccount === 'ALL' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}
           >
              <LayoutGrid size={18} />
              <span className="font-medium text-sm">Todas as Contas</span>
              <span className="ml-auto text-xs bg-black/20 px-2 py-0.5 rounded-full">{products.length}</span>
           </button>

           <div className="pt-4 pb-2 px-2">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Contas de Anúncio</p>
           </div>

           {accounts.map(acc => (
             <button 
               key={acc}
               onClick={() => setSelectedAccount(acc)}
               className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all group ${selectedAccount === acc ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:bg-slate-900 hover:text-white border border-transparent'}`}
             >
                <Briefcase size={18} className={selectedAccount === acc ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'} />
                <span className="font-medium text-sm truncate">{acc}</span>
                {selectedAccount === acc && <ChevronRight size={14} className="ml-auto text-indigo-500"/>}
             </button>
           ))}
        </div>
        
        {/* Footer Sidebar */}
        <div className="p-4 border-t border-slate-900 text-center">
           <p className="text-[10px] text-slate-600">AutoMetrics v3.0</p>
        </div>
      </aside>

      {/* --- ÁREA PRINCIPAL (CAMPANHAS) --- */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen">
        
        {/* Cabeçalho */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              {selectedAccount === 'ALL' ? 'Todas as Campanhas' : selectedAccount}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Gerenciando {filteredProducts.length} campanhas {selectedAccount !== 'ALL' && 'nesta conta'}.
            </p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-lg shadow-indigo-900/20"
          >
            <Plus size={18} /> Novo Produto
          </button>
        </div>

        {/* Busca */}
        <div className="bg-slate-900/50 border border-slate-900 p-4 rounded-xl mb-6 flex gap-4 items-center">
          <Search className="text-slate-500" size={18} />
          <input 
            type="text" 
            placeholder="Buscar campanha..." 
            className="bg-transparent text-white w-full outline-none placeholder:text-slate-600" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
          <button onClick={() => fetchProducts()} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} />
          </button>
        </div>

        {/* Grid de Cards */}
        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-slate-500">Carregando campanhas...</div>
        ) : filteredProducts.length === 0 ? (
           <div className="flex flex-col items-center justify-center h-64 text-slate-500 border border-dashed border-slate-800 rounded-xl">
              <Layers size={32} className="mb-2 opacity-50"/>
              <p>Nenhuma campanha encontrada nesta conta.</p>
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredProducts.map((product) => (
              <Link key={product.id} href={`/products/${product.id}`} className="block group">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/50 hover:bg-slate-900/80 transition-all h-full relative overflow-hidden flex flex-col">
                  
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-0 translate-x-4">
                     <ExternalLink size={18} className="text-indigo-400" />
                  </div>

                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-xl flex items-center justify-center w-12 h-12 
                      ${product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : 
                        product.currency === 'EUR' ? 'bg-blue-500/10 text-blue-500' : 
                        'bg-emerald-500/10 text-emerald-500'}`}>
                        {product.currency === 'USD' ? '$' : product.currency === 'EUR' ? '€' : 'R$'}
                    </div>
                    {/* Status Badge */}
                    <span className={`text-[10px] px-2 py-1 rounded border uppercase font-bold ${
                      product.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-800 text-slate-500 border-slate-700'
                    }`}>
                      {product.status || 'Active'}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-bold text-white mb-1 group-hover:text-indigo-400 transition-colors line-clamp-2">
                    {product.name}
                  </h3>
                  
                  <div className="mt-auto pt-4 space-y-2 border-t border-slate-800/50">
                     <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Folder size={12}/>
                        <span className="truncate max-w-[200px]">{product.account_name || 'Sem Conta'}</span>
                     </div>
                     <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Layers size={12}/>
                        <span className="font-mono bg-black/30 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                          {product.google_ads_campaign_name}
                        </span>
                     </div>
                  </div>
                  
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Modal de Novo Produto (Mantido Simplificado) */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white">Novo Produto Manual</h2>
                <button onClick={() => setIsModalOpen(false)}><X size={24} className="text-slate-400 hover:text-white" /></button>
              </div>
              <div className="space-y-4">
                <input type="text" className="w-full bg-slate-950 border-slate-800 rounded-lg p-3 text-white" placeholder="Nome do Produto" value={newProduct.name} onChange={e=>setNewProduct({...newProduct, name: e.target.value})} />
                <input type="text" className="w-full bg-slate-950 border-slate-800 rounded-lg p-3 text-white" placeholder="Campanha Google Ads (Exato)" value={newProduct.campaign_name} onChange={e=>setNewProduct({...newProduct, campaign_name: e.target.value})} />
                <button onClick={handleSave} className="w-full bg-indigo-600 py-3 rounded-lg text-white font-bold">{saving ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}