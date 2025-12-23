"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, ExternalLink, X, ArrowLeft, RefreshCw, 
  Briefcase, Folder, Layers, LayoutGrid, ChevronRight, 
  Eye, EyeOff, Archive, AlertTriangle
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
  
  // Filtros
  const [selectedAccount, setSelectedAccount] = useState<string | null>('ALL');
  const [showHidden, setShowHidden] = useState(false); // Toggle para ver arquivados

  // Modal
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

  // --- LÓGICA DE OCULTAR/MOSTRAR ---

  // 1. Ocultar/Restaurar um Produto Individual
  const toggleProductVisibility = async (product: any, e: React.MouseEvent) => {
    e.preventDefault(); // Evita abrir o link
    e.stopPropagation();
    
    const newStatus = !product.is_hidden;
    
    // Otimista (Atualiza na tela antes do banco)
    const updatedProducts = products.map(p => p.id === product.id ? { ...p, is_hidden: newStatus } : p);
    setProducts(updatedProducts);

    await supabase.from('products').update({ is_hidden: newStatus }).eq('id', product.id);
  };

  // 2. Ocultar/Restaurar TODOS da Conta Selecionada (Ex: Conta Suspensa)
  const toggleAccountVisibility = async () => {
    if (selectedAccount === 'ALL') return;
    
    const shouldHide = !isAccountHidden; // Se está oculto, vamos mostrar. Se visível, ocultar.
    const confirmMsg = shouldHide 
      ? `Tem certeza que deseja OCULTAR toda a conta "${selectedAccount}"?` 
      : `Deseja RESTAURAR a conta "${selectedAccount}"?`;

    if (!confirm(confirmMsg)) return;

    // Atualiza localmente
    const updatedProducts = products.map(p => 
      p.account_name === selectedAccount ? { ...p, is_hidden: shouldHide } : p
    );
    setProducts(updatedProducts);

    // Atualiza no banco
    await supabase.from('products')
      .update({ is_hidden: shouldHide })
      .eq('account_name', selectedAccount);
      
    // Se ocultou a conta atual, volta para 'ALL'
    if (shouldHide) setSelectedAccount('ALL');
  };

  // --- FILTROS ---

  // Agrupa contas (Mostra na sidebar apenas contas que têm produtos visíveis, a menos que showHidden esteja ativo)
  const accounts = useMemo(() => {
    const relevantProducts = showHidden ? products : products.filter(p => !p.is_hidden);
    const accSet = new Set(relevantProducts.map(p => p.account_name || 'Sem Conta Vinculada'));
    return Array.from(accSet).sort();
  }, [products, showHidden]);

  // Filtra produtos da grid
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAccount = selectedAccount === 'ALL' || (p.account_name || 'Sem Conta Vinculada') === selectedAccount;
    const matchesHidden = showHidden ? true : !p.is_hidden; // Se showHidden=false, esconde os hidden=true
    
    return matchesSearch && matchesAccount && matchesHidden;
  });

  // Verifica se a conta atual está "toda oculta" (para mudar o botão de ação)
  const isAccountHidden = useMemo(() => {
     if (selectedAccount === 'ALL') return false;
     const accountProducts = products.filter(p => p.account_name === selectedAccount);
     // Se todos os produtos da conta estão hidden, consideramos a conta oculta
     return accountProducts.length > 0 && accountProducts.every(p => p.is_hidden);
  }, [products, selectedAccount]);

  // --- RENDER ---

  const handleSave = async () => {
    if (!newProduct.name || !newProduct.campaign_name) return alert("Preencha os campos obrigatórios.");
    let currentUserId = localStorage.getItem('autometrics_user_id');
    if (!currentUserId) { currentUserId = crypto.randomUUID(); localStorage.setItem('autometrics_user_id', currentUserId); }
    setSaving(true);
    const { data, error } = await supabase.from('products').insert([{ ...newProduct, user_id: currentUserId, account_name: 'Manual' }]).select();
    if (error) alert('Erro: ' + error.message);
    else if (data) { setProducts([data[0], ...products]); setIsModalOpen(false); }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex flex-col md:flex-row">
      
      {/* SIDEBAR */}
      <aside className="w-full md:w-72 bg-slate-950 border-r border-slate-900 flex flex-col h-screen sticky top-0 z-20">
        <div className="p-6 border-b border-slate-900 flex items-center gap-3">
           <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
             <ArrowLeft size={18} />
           </Link>
           <span className="font-bold text-white tracking-wide">Minhas Contas</span>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
           <button onClick={() => setSelectedAccount('ALL')} className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${selectedAccount === 'ALL' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-900'}`}>
              <LayoutGrid size={18} />
              <span className="font-medium text-sm">Todas as Contas</span>
              <span className="ml-auto text-xs bg-black/20 px-2 py-0.5 rounded-full">{products.filter(p => !p.is_hidden || showHidden).length}</span>
           </button>

           <div className="pt-4 pb-2 px-2 flex justify-between items-center">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Contas de Anúncio</p>
              {/* Toggle de Visualização na Sidebar */}
              <button 
                onClick={() => setShowHidden(!showHidden)}
                className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded border transition-colors ${showHidden ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-slate-900 text-slate-600 border-slate-800'}`}
                title={showHidden ? "Ocultar Arquivados" : "Ver Arquivados"}
              >
                {showHidden ? <Eye size={10} /> : <EyeOff size={10} />}
                {showHidden ? 'Ver Ativos' : 'Ver Ocultos'}
              </button>
           </div>

           {accounts.map(acc => (
             <button key={acc} onClick={() => setSelectedAccount(acc)} className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all group ${selectedAccount === acc ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:bg-slate-900 hover:text-white border border-transparent'}`}>
                <Briefcase size={18} className={selectedAccount === acc ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'} />
                <span className="font-medium text-sm truncate">{acc}</span>
                {selectedAccount === acc && <ChevronRight size={14} className="ml-auto text-indigo-500"/>}
             </button>
           ))}
           
           {accounts.length === 0 && (
             <p className="text-xs text-slate-600 p-4 text-center">Nenhuma conta visível.</p>
           )}
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen relative">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              {selectedAccount === 'ALL' ? 'Visão Geral' : selectedAccount}
              {/* Badge se a conta estiver oculta */}
              {isAccountHidden && selectedAccount !== 'ALL' && (
                <span className="text-xs bg-amber-500/20 text-amber-500 px-2 py-1 rounded border border-amber-500/30 flex items-center gap-1">
                  <EyeOff size={12}/> Oculta
                </span>
              )}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {selectedAccount === 'ALL' 
                ? `Exibindo ${filteredProducts.length} campanhas de todas as contas.` 
                : `Gerenciando campanhas da conta ${selectedAccount}.`}
            </p>
          </div>
          
          <div className="flex gap-3">
            {/* Botão de Ocultar Conta Inteira (Só aparece se selecionar uma conta específica) */}
            {selectedAccount !== 'ALL' && (
              <button 
                onClick={toggleAccountVisibility}
                className={`px-4 py-2.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-2 ${
                  isAccountHidden 
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20' 
                    : 'bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20'
                }`}
              >
                {isAccountHidden ? <Eye size={14}/> : <EyeOff size={14}/>}
                {isAccountHidden ? 'Restaurar Conta' : 'Ocultar Conta (Suspensa)'}
              </button>
            )}

            <button onClick={() => setIsModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg">
              <Plus size={18} /> Novo Produto
            </button>
          </div>
        </div>

        {/* Busca e Aviso de Filtro */}
        <div className="flex gap-4 mb-6">
           <div className="bg-slate-900/50 border border-slate-900 p-4 rounded-xl flex-1 flex gap-4 items-center">
             <Search className="text-slate-500" size={18} />
             <input type="text" placeholder="Buscar campanha..." className="bg-transparent text-white w-full outline-none placeholder:text-slate-600" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             <button onClick={() => fetchProducts()} className="p-2 hover:bg-slate-800 rounded-full transition-colors"><RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} /></button>
           </div>
           
           {/* Botão Toggle Rápido para Ocultos */}
           {showHidden && (
             <div className="bg-amber-500/10 border border-amber-500/20 px-4 rounded-xl flex items-center gap-2 text-amber-500 text-xs font-bold animate-pulse">
                <AlertTriangle size={16} />
                Modo de Edição: Exibindo Ocultos
             </div>
           )}
        </div>

        {/* GRID */}
        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-slate-500">Carregando...</div>
        ) : filteredProducts.length === 0 ? (
           <div className="flex flex-col items-center justify-center h-64 text-slate-500 border border-dashed border-slate-800 rounded-xl">
              <Layers size={32} className="mb-2 opacity-50"/>
              <p>Nenhuma campanha encontrada.</p>
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
            {filteredProducts.map((product) => (
              <Link key={product.id} href={`/products/${product.id}`} className="block group">
                <div className={`border rounded-xl p-6 transition-all h-full relative overflow-hidden flex flex-col ${
                  product.is_hidden 
                    ? 'bg-black border-slate-800 opacity-60 hover:opacity-100' // Estilo se oculto
                    : 'bg-slate-900 border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/80' // Estilo normal
                }`}>
                  
                  {/* Botão de Ocultar/Mostrar no Card */}
                  <div className="absolute top-4 right-4 flex gap-2">
                     <button 
                       onClick={(e) => toggleProductVisibility(product, e)}
                       className={`p-1.5 rounded-lg transition-colors z-10 ${
                         product.is_hidden 
                           ? 'bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30' 
                           : 'bg-slate-800 text-slate-500 hover:text-white hover:bg-rose-500/20 hover:text-rose-500'
                       }`}
                       title={product.is_hidden ? "Restaurar" : "Arquivar/Ocultar"}
                     >
                        {product.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                     </button>
                  </div>

                  {/* Moeda e Status */}
                  <div className="flex justify-between items-start mb-4 pr-10">
                    <div className={`p-3 rounded-xl flex items-center justify-center w-12 h-12 
                      ${product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : product.currency === 'EUR' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                        {product.currency === 'USD' ? '$' : product.currency === 'EUR' ? '€' : 'R$'}
                    </div>
                    {product.is_hidden && (
                       <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Arquivado</span>
                    )}
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

        {/* Modal Novo Produto */}
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