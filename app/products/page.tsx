"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, ExternalLink, X, ArrowLeft, RefreshCw, 
  Briefcase, Folder, Layers, LayoutGrid, ChevronRight, ChevronDown,
  Eye, EyeOff, PlayCircle, PauseCircle, AlertTriangle, Globe, Trash2
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filtros de Navegação
  const [selectedMcc, setSelectedMcc] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  
  const [expandedMccs, setExpandedMccs] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ 
    name: '', campaign_name: '', platform: '', currency: 'BRL', status: 'active', account_name: 'Manual', mcc_name: 'Manual' 
  });
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');

  // --- INICIALIZAÇÃO ---
  useEffect(() => { 
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/');
        return;
      }

      setUserId(session.user.id);
      await fetchProducts(session.user.id);
    }
    init();
  }, []);

  async function fetchProducts(currentUserId: string) {
    setLoading(true);
    
    let query = supabase
      .from('products')
      .select('*')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false });

    const { data } = await query;
    if (data) {
       setProducts(data);
       const allMccs = Array.from(new Set(data.map((p: any) => p.mcc_name || 'Sem MCC'))) as string[];
       setExpandedMccs(allMccs);
    }
    setLoading(false);
  }

  // --- ESTRUTURA SIDEBAR ---
  const structure = useMemo(() => {
    const relevantProducts = showHidden ? products : products.filter(p => !p.is_hidden);
    const tree: Record<string, Set<string>> = {};

    relevantProducts.forEach(p => {
      const mcc = p.mcc_name || 'Outras';
      const acc = p.account_name || 'Sem Conta';
      
      if (!tree[mcc]) tree[mcc] = new Set();
      tree[mcc].add(acc);
    });

    return Object.keys(tree).sort().map(mcc => ({
      name: mcc,
      accounts: Array.from(tree[mcc]).sort()
    }));
  }, [products, showHidden]);

  // --- AÇÕES DE EXCLUSÃO ---
  
  const handleDeleteMcc = async (mccName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmMsg = `⚠️ ATENÇÃO CRÍTICA ⚠️\n\nVocê está prestes a excluir a MCC inteira: "${mccName}".\n\nIsso apagará PERMANENTEMENTE todas as contas, produtos e métricas vinculados a ela.\n\nTem certeza absoluta?`;
    
    if (!confirm(confirmMsg)) return;

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('user_id', userId)
      .eq('mcc_name', mccName);

    if (error) {
      alert("Erro ao excluir: " + error.message);
    } else {
      setProducts(prev => prev.filter(p => p.mcc_name !== mccName));
      if (selectedMcc === mccName) resetFilters();
    }
  };

  const handleDeleteAccount = async (mccName: string, accountName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmMsg = `Tem certeza que deseja excluir a conta "${accountName}"?\n\nIsso apagará todos os produtos e métricas desta conta.`;
    
    if (!confirm(confirmMsg)) return;

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('user_id', userId)
      .eq('mcc_name', mccName)
      .eq('account_name', accountName);

    if (error) {
      alert("Erro ao excluir: " + error.message);
    } else {
      setProducts(prev => prev.filter(p => !(p.mcc_name === mccName && p.account_name === accountName)));
      if (selectedAccount === accountName) resetFilters();
    }
  };

  // --- NOVA FUNÇÃO: DELETAR PRODUTO INDIVIDUAL ---
  const handleDeleteProduct = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault(); 
    e.stopPropagation();
    
    if (!confirm("Tem certeza que deseja excluir este produto permanentemente?")) return;

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('user_id', userId)
      .eq('id', productId);

    if (error) {
      alert("Erro ao excluir produto: " + error.message);
    } else {
      setProducts(prev => prev.filter(p => p.id !== productId));
    }
  };

  // --- OUTRAS AÇÕES ---
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesHidden = showHidden ? true : !p.is_hidden;
    
    let matchesContext = true;
    if (selectedAccount) {
       matchesContext = (p.account_name || 'Sem Conta') === selectedAccount && (selectedMcc ? (p.mcc_name || 'Outras') === selectedMcc : true);
    } else if (selectedMcc) {
       matchesContext = (p.mcc_name || 'Outras') === selectedMcc;
    }

    return matchesSearch && matchesContext && matchesHidden;
  });

  const toggleMccExpand = (mccName: string) => {
    setExpandedMccs(prev => prev.includes(mccName) ? prev.filter(m => m !== mccName) : [...prev, mccName]);
  };

  const handleSelectMcc = (mccName: string) => {
    setSelectedMcc(mccName);
    setSelectedAccount(null);
  };

  const handleSelectAccount = (mccName: string, accName: string) => {
    setSelectedMcc(mccName);
    setSelectedAccount(accName);
  };

  const resetFilters = () => {
    setSelectedMcc(null);
    setSelectedAccount(null);
  };

  const toggleStatus = async (product: any, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const newStatus = product.status === 'active' ? 'paused' : 'active';
    setProducts(products.map(p => p.id === product.id ? { ...p, status: newStatus } : p));
    await supabase.from('products').update({ status: newStatus }).eq('id', product.id);
  };

  const toggleProductVisibility = async (product: any, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const newHidden = !product.is_hidden;
    setProducts(products.map(p => p.id === product.id ? { ...p, is_hidden: newHidden } : p));
    await supabase.from('products').update({ is_hidden: newHidden }).eq('id', product.id);
  };

  const handleSave = async () => {
    if (!newProduct.name || !newProduct.campaign_name) return alert("Preencha os campos obrigatórios.");
    setSaving(true);
    const { data, error } = await supabase.from('products').insert([{ ...newProduct, user_id: userId }]).select();
    if (error) alert('Erro: ' + error.message);
    else if (data) { 
        setProducts([data[0], ...products]); 
        setIsModalOpen(false); 
        const newMcc = data[0].mcc_name || 'Manual';
        if (!expandedMccs.includes(newMcc)) setExpandedMccs([...expandedMccs, newMcc]);
    }
    setSaving(false);
  };

  const handleReload = () => { if (userId) fetchProducts(userId); };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans flex flex-col md:flex-row">
      
      {/* SIDEBAR */}
      <aside className="w-full md:w-72 bg-slate-950 border-r border-slate-900 flex flex-col h-screen sticky top-0 z-20">
        <div className="p-6 border-b border-slate-900 flex items-center gap-3">
           <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"><ArrowLeft size={18} /></Link>
           <span className="font-bold text-white tracking-wide">Estrutura</span>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
           <button onClick={resetFilters} className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all mb-4 ${!selectedMcc ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-900'}`}>
              <LayoutGrid size={18} />
              <span className="font-medium text-sm">Visão Global</span>
           </button>

           <div className="flex justify-between items-center px-2 pb-2 mt-4 border-b border-slate-900 mb-2">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">MCCs e Contas</span>
              <button onClick={() => setShowHidden(!showHidden)} className="text-slate-600 hover:text-white" title="Ver Ocultos">{showHidden ? <Eye size={12}/> : <EyeOff size={12}/>}</button>
           </div>

           {structure.length === 0 && !loading && (
               <div className="text-center py-4 px-2">
                   <p className="text-xs text-slate-600">Nenhuma conta encontrada.</p>
               </div>
           )}

           {structure.map(mcc => {
             const isMccActive = selectedMcc === mcc.name && !selectedAccount;
             const isExpanded = expandedMccs.includes(mcc.name);

             return (
               <div key={mcc.name} className="mb-2">
                 {/* MCC ROW */}
                 <div className="flex items-center gap-1 group relative pr-2">
                    <button onClick={() => toggleMccExpand(mcc.name)} className="p-2 text-slate-600 hover:text-white transition-colors">
                       {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                    </button>
                    <button 
                      onClick={() => handleSelectMcc(mcc.name)}
                      className={`flex-1 text-left py-2 px-3 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${isMccActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
                    >
                       <Globe size={14} className={isMccActive ? 'text-indigo-400' : 'text-slate-600'}/>
                       <span className="truncate w-32">{mcc.name}</span>
                    </button>

                    <button 
                       onClick={(e) => handleDeleteMcc(mcc.name, e)}
                       className="p-1.5 text-slate-700 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                       title="Excluir MCC e suas contas"
                    >
                       <Trash2 size={12}/>
                    </button>
                 </div>

                 {/* CONTAS ROW */}
                 {isExpanded && (
                   <div className="ml-4 pl-3 border-l border-slate-800 mt-1 space-y-1">
                      {mcc.accounts.map(acc => {
                        const isAccActive = selectedAccount === acc && selectedMcc === mcc.name;
                        return (
                          <div key={acc} className="flex items-center group/acc pr-2">
                            <button 
                                onClick={() => handleSelectAccount(mcc.name, acc)}
                                className={`flex-1 text-left px-3 py-2 rounded-lg flex items-center gap-2 text-xs transition-all ${isAccActive ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900'}`}
                            >
                                <Briefcase size={12}/>
                                <span className="truncate w-32">{acc}</span>
                            </button>
                            
                            <button 
                                onClick={(e) => handleDeleteAccount(mcc.name, acc, e)}
                                className="p-1.5 text-slate-700 hover:text-rose-500 opacity-0 group-hover/acc:opacity-100 transition-opacity ml-1"
                                title="Excluir Conta"
                            >
                                <Trash2 size={12}/>
                            </button>
                          </div>
                        );
                      })}
                   </div>
                 )}
               </div>
             )
           })}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen relative bg-black">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
               {selectedMcc ? (
                 <>
                   <span className="bg-slate-900 px-2 py-0.5 rounded">{selectedMcc}</span>
                   {selectedAccount && <><ChevronRight size={12}/> <span className="bg-slate-900 px-2 py-0.5 rounded text-indigo-400">{selectedAccount}</span></>}
                 </>
               ) : (
                 <span className="bg-slate-900 px-2 py-0.5 rounded">Todas as MCCs</span>
               )}
            </div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              {selectedAccount || selectedMcc || 'Todas as Campanhas'}
            </h1>
          </div>
          
          <div className="flex gap-3">
            <button onClick={() => setIsModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg"><Plus size={18} /> Novo Produto</button>
          </div>
        </div>

        <div className="flex gap-4 mb-6">
           <div className="bg-slate-900/50 border border-slate-900 p-4 rounded-xl flex-1 flex gap-4 items-center">
             <Search className="text-slate-500" size={18} />
             <input type="text" placeholder="Buscar campanha..." className="bg-transparent text-white w-full outline-none placeholder:text-slate-600" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             <button onClick={handleReload} className="p-2 hover:bg-slate-800 rounded-full transition-colors"><RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} /></button>
           </div>
           {showHidden && <div className="bg-amber-500/10 border border-amber-500/20 px-4 rounded-xl flex items-center gap-2 text-amber-500 text-xs font-bold animate-pulse"><AlertTriangle size={16} /> Ver Ocultos</div>}
        </div>

        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-slate-500">Carregando produtos...</div>
        ) : filteredProducts.length === 0 ? (
           <div className="flex flex-col items-center justify-center h-64 text-slate-500 border border-dashed border-slate-800 rounded-xl"><Layers size={32} className="mb-2 opacity-50"/><p>Nenhuma campanha encontrada.</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
            {filteredProducts.map((product) => (
              <Link key={product.id} href={`/products/${product.id}`} className="block group">
                <div className={`border rounded-xl p-6 transition-all h-full relative overflow-hidden flex flex-col ${product.is_hidden ? 'bg-black border-slate-800 opacity-60' : 'bg-slate-900 border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/80'}`}>
                  
                  <div className="absolute top-4 right-4 flex gap-2 z-10">
                     <button onClick={(e) => toggleStatus(product, e)} className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-colors border ${product.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20'}`} title="Status">
                        {product.status === 'active' ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                     </button>
                     
                     {/* BOTÃO DE ARQUIVAR */}
                     <button onClick={(e) => toggleProductVisibility(product, e)} className={`p-1.5 rounded-lg transition-colors ${product.is_hidden ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-800 text-slate-500 hover:text-white hover:bg-slate-700'}`}>
                        {product.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                     </button>

                     {/* BOTÃO DE DELETAR (NOVO) */}
                     <button 
                       onClick={(e) => handleDeleteProduct(product.id, e)}
                       className="p-1.5 rounded-lg transition-colors bg-slate-800 text-slate-500 hover:bg-rose-500 hover:text-white"
                       title="Excluir Definitivamente"
                     >
                       <Trash2 size={14} />
                     </button>
                  </div>

                  <div className="flex justify-between items-start mb-4 pr-32">
                    <div className={`p-3 rounded-xl flex items-center justify-center w-12 h-12 ${product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : product.currency === 'EUR' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                        {product.currency === 'USD' ? '$' : product.currency === 'EUR' ? '€' : 'R$'}
                    </div>
                  </div>
                  
                  <h3 className="text-lg font-bold text-white mb-1 group-hover:text-indigo-400 transition-colors line-clamp-2">{product.name}</h3>
                  
                  <div className="mt-auto pt-4 space-y-2 border-t border-slate-800/50">
                     <div className="flex items-center gap-2 text-xs text-slate-500"><Folder size={12}/><span className="truncate max-w-[200px]">{product.account_name || 'Sem Conta'}</span></div>
                     <div className="flex items-center gap-2 text-xs text-slate-500"><Layers size={12}/><span className="font-mono bg-black/30 px-1.5 py-0.5 rounded truncate max-w-[200px]">{product.google_ads_campaign_name}</span></div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {isModalOpen && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold text-white">Novo Produto Manual</h2><button onClick={() => setIsModalOpen(false)}><X size={24} className="text-slate-400 hover:text-white" /></button></div>
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