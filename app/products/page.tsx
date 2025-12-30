"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, ExternalLink, X, ArrowLeft, RefreshCw, 
  Briefcase, Folder, Layers, LayoutGrid, ChevronRight, ChevronDown,
  Eye, EyeOff, PlayCircle, PauseCircle, AlertTriangle, Globe, Trash2,
  Sun, Moon, Filter, CheckCircle2, XCircle // Ícones novos
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

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
  
  // Filtros de Visualização
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'paused'>('ALL'); // NOVO: Filtro de Status
  const [showHidden, setShowHidden] = useState(false);
  
  const [expandedMccs, setExpandedMccs] = useState<string[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ 
    name: '', campaign_name: '', platform: '', currency: 'BRL', status: 'active', account_name: 'Manual', mcc_name: 'Manual' 
  });
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // --- INICIALIZAÇÃO ---
  useEffect(() => { 
    async function init() {
      // Carrega Tema
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) setTheme(savedTheme);

      // Carrega Filtro de Status Salvo (NOVO)
      const savedStatus = localStorage.getItem('autometrics_products_status_filter');
      if (savedStatus === 'active' || savedStatus === 'paused' || savedStatus === 'ALL') {
        setStatusFilter(savedStatus);
      }

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

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('autometrics_theme', newTheme);
  };

  // Função para mudar filtro e salvar (NOVO)
  const changeStatusFilter = (newStatus: 'ALL' | 'active' | 'paused') => {
    setStatusFilter(newStatus);
    localStorage.setItem('autometrics_products_status_filter', newStatus);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

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
    // A Sidebar deve mostrar a estrutura baseada nos produtos que NÃO estão ocultos (arquivados)
    // O filtro de status (ativo/pausado) afeta a grid principal, mas decidimos manter a estrutura visível na sidebar
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
    if (!confirm(`Excluir MCC "${mccName}" e todas suas contas?`)) return;
    const { error } = await supabase.from('products').delete().eq('user_id', userId).eq('mcc_name', mccName);
    if (!error) {
      setProducts(prev => prev.filter(p => p.mcc_name !== mccName));
      if (selectedMcc === mccName) resetFilters();
    }
  };

  const handleDeleteAccount = async (mccName: string, accountName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Excluir conta "${accountName}"?`)) return;
    const { error } = await supabase.from('products').delete().eq('user_id', userId).eq('mcc_name', mccName).eq('account_name', accountName);
    if (!error) {
      setProducts(prev => prev.filter(p => !(p.mcc_name === mccName && p.account_name === accountName)));
      if (selectedAccount === accountName) resetFilters();
    }
  };

  const handleDeleteProduct = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("Excluir produto permanentemente?")) return;
    const { error } = await supabase.from('products').delete().eq('user_id', userId).eq('id', productId);
    if (!error) setProducts(prev => prev.filter(p => p.id !== productId));
  };

  // --- FILTRAGEM PRINCIPAL (ATUALIZADA) ---
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesHidden = showHidden ? true : !p.is_hidden;
    
    // Filtro de Status (NOVO)
    const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
    
    let matchesContext = true;
    if (selectedAccount) {
       matchesContext = (p.account_name || 'Sem Conta') === selectedAccount && (selectedMcc ? (p.mcc_name || 'Outras') === selectedMcc : true);
    } else if (selectedMcc) {
       matchesContext = (p.mcc_name || 'Outras') === selectedMcc;
    }

    return matchesSearch && matchesContext && matchesHidden && matchesStatus;
  });

  const toggleMccExpand = (mccName: string) => { setExpandedMccs(prev => prev.includes(mccName) ? prev.filter(m => m !== mccName) : [...prev, mccName]); };
  const handleSelectMcc = (mccName: string) => { setSelectedMcc(mccName); setSelectedAccount(null); };
  const handleSelectAccount = (mccName: string, accName: string) => { setSelectedMcc(mccName); setSelectedAccount(accName); };
  const resetFilters = () => { setSelectedMcc(null); setSelectedAccount(null); };

  const toggleStatus = async (product: any, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const newStatus = product.status === 'active' ? 'paused' : 'active';
    // Otimista
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
    if (!newProduct.name || !newProduct.campaign_name) return alert("Preencha campos.");
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

  // Estilos
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';
  const hoverItem = isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100';

  return (
    <div className={`min-h-screen font-sans flex flex-col md:flex-row ${bgMain}`}>
      
      {/* SIDEBAR */}
      <aside className={`w-full md:w-72 border-r flex flex-col h-screen sticky top-0 z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        <div className="h-20 flex items-center justify-center md:justify-start md:px-6 border-b border-inherit">
           <div className="hidden md:block relative"><Image src="/logo.png" alt="Logo" width={180} height={60} className={`w-[180px] h-auto object-contain object-left ${!isDark ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : ''}`} priority /></div>
           <div className="md:hidden"><Image src="/logo.png" alt="Logo" width={40} height={40} className={`w-8 h-8 object-contain ${!isDark ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : ''}`}/></div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
           <Link href="/dashboard" className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><LayoutGrid size={20} /> <span className="hidden md:block font-medium">Dashboard</span></Link>
           <Link href="/planning" className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Target size={20} /> <span className="hidden md:block font-medium">Planejamento</span></Link>
           <Link href="/products" className="flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20"><Briefcase size={20} /> <span className="hidden md:block font-medium">Meus Produtos</span></Link>
           <Link href="/integration" className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><RefreshCw size={20} /> <span className="hidden md:block font-medium">Integração</span></Link>
        </nav>
        
        {/* Filtros da Sidebar */}
        <div className="px-4 pb-2 mt-auto">
          <div className={`p-3 rounded-lg border mb-2 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Estrutura de Contas</p>
            <div className="flex justify-between items-center">
              <button onClick={() => setShowHidden(!showHidden)} className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded border transition-colors ${showHidden ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'text-slate-500 border-transparent hover:bg-slate-800'}`}>
                {showHidden ? <Eye size={10} /> : <EyeOff size={10} />}
                {showHidden ? 'Ver Ativos' : 'Ver Ocultos'}
              </button>
              <button onClick={resetFilters} className="text-[10px] text-indigo-400 hover:underline">Limpar</button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4 space-y-1 max-h-[40vh]">
           {structure.length === 0 && !loading && (
               <div className="text-center py-4 px-2"><p className="text-xs text-slate-500">Nenhuma conta encontrada.</p></div>
           )}

           {structure.map(mcc => {
             const isMccActive = selectedMcc === mcc.name && !selectedAccount;
             const isExpanded = expandedMccs.includes(mcc.name);
             return (
               <div key={mcc.name} className="mb-2">
                 <div className="flex items-center gap-1 group relative pr-2">
                    <button onClick={() => toggleMccExpand(mcc.name)} className={`p-2 transition-colors ${textMuted} hover:text-indigo-500`}>{isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>
                    <button onClick={() => handleSelectMcc(mcc.name)} className={`flex-1 text-left py-2 px-3 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${isMccActive ? 'bg-indigo-600 text-white shadow' : `${textMuted} ${hoverItem}`}`}>
                       <Globe size={14} className={isMccActive ? 'text-white' : 'text-slate-500'}/>
                       <span className="truncate w-28">{mcc.name}</span>
                    </button>
                    <button onClick={(e) => handleDeleteMcc(mcc.name, e)} className="p-1.5 text-slate-500 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={12}/></button>
                 </div>
                 {isExpanded && (
                   <div className={`ml-4 pl-3 border-l mt-1 space-y-1 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                      {mcc.accounts.map(acc => {
                        const isAccActive = selectedAccount === acc && selectedMcc === mcc.name;
                        return (
                          <div key={acc} className="flex items-center group/acc pr-2">
                            <button onClick={() => handleSelectAccount(mcc.name, acc)} className={`flex-1 text-left px-3 py-2 rounded-lg flex items-center gap-2 text-xs transition-all ${isAccActive ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20' : `${textMuted} ${hoverItem}`}`}>
                                <Briefcase size={12}/> <span className="truncate w-28">{acc}</span>
                            </button>
                            <button onClick={(e) => handleDeleteAccount(mcc.name, acc, e)} className="p-1.5 text-slate-500 hover:text-rose-500 opacity-0 group-hover/acc:opacity-100 transition-opacity ml-1"><Trash2 size={12}/></button>
                          </div>
                        );
                      })}
                   </div>
                 )}
               </div>
             )
           })}
        </div>
        
        <div className="p-4 border-t border-inherit">
           <button onClick={handleLogout} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-rose-500 hover:bg-rose-500/10`}><LogOut size={20} /> <span className="hidden md:block font-medium">Sair</span></button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen relative">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className={`flex items-center gap-2 text-xs ${textMuted} mb-1`}>
               {selectedMcc ? (
                 <><span className={`px-2 py-0.5 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>{selectedMcc}</span>{selectedAccount && <><ChevronRight size={12}/> <span className={`px-2 py-0.5 rounded text-indigo-500 ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>{selectedAccount}</span></>}</>
               ) : (<span className={`px-2 py-0.5 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>Todas as MCCs</span>)}
            </div>
            <h1 className={`text-2xl font-bold flex items-center gap-2 ${textHead}`}>{selectedAccount || selectedMcc || 'Gerenciador de Campanhas'}</h1>
          </div>
          
          <div className="flex gap-3">
             <button onClick={toggleTheme} className={`p-2.5 rounded-lg border transition-colors ${isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-500'}`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
             <button onClick={() => setIsModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg"><Plus size={18} /> Novo Produto</button>
          </div>
        </div>

        {/* BARRA DE FERRAMENTAS E FILTROS */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
           <div className={`p-1.5 rounded-xl flex-1 flex gap-4 items-center border ${bgCard}`}>
             <div className="pl-3 text-slate-500"><Search size={18} /></div>
             <input type="text" placeholder="Buscar campanha..." className={`bg-transparent w-full outline-none placeholder:text-slate-500 ${textHead}`} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             
             {/* --- NOVO FILTRO DE STATUS --- */}
             <div className={`flex items-center gap-1 px-2 border-l ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button 
                  onClick={() => changeStatusFilter('ALL')} 
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'ALL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-slate-200 text-black') : 'text-slate-500 hover:text-slate-400'}`}
                >
                  Todos
                </button>
                <button 
                  onClick={() => changeStatusFilter('active')} 
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'active' ? 'bg-emerald-500/20 text-emerald-500' : 'text-slate-500 hover:text-emerald-500'}`}
                >
                  <PlayCircle size={12} /> Ativos
                </button>
                <button 
                  onClick={() => changeStatusFilter('paused')} 
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'paused' ? 'bg-rose-500/20 text-rose-500' : 'text-slate-500 hover:text-rose-500'}`}
                >
                  <PauseCircle size={12} /> Pausados
                </button>
             </div>

             <button onClick={handleReload} className={`p-2 rounded-lg transition-colors mr-1 ${hoverItem}`} title="Recarregar"><RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} /></button>
           </div>
           
           {showHidden && <div className="bg-amber-500/10 border border-amber-500/20 px-4 rounded-xl flex items-center gap-2 text-amber-500 text-xs font-bold animate-pulse whitespace-nowrap"><AlertTriangle size={16} /> Exibindo Ocultos</div>}
        </div>

        {/* GRID DE PRODUTOS */}
        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-slate-500">Carregando produtos...</div>
        ) : filteredProducts.length === 0 ? (
           <div className={`flex flex-col items-center justify-center h-64 text-slate-500 border border-dashed rounded-xl ${isDark ? 'border-slate-800' : 'border-slate-300'}`}><Layers size={32} className="mb-2 opacity-50"/><p>Nenhuma campanha encontrada com os filtros atuais.</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
            {filteredProducts.map((product) => (
              <Link key={product.id} href={`/products/${product.id}`} className="block group">
                <div className={`border rounded-xl p-6 transition-all h-full relative overflow-hidden flex flex-col ${
                   product.is_hidden 
                     ? (isDark ? 'bg-black border-slate-800 opacity-60' : 'bg-slate-100 border-slate-300 opacity-60') 
                     : `${bgCard} hover:border-indigo-500/50`
                }`}>
                  
                  <div className="absolute top-4 right-4 flex gap-2 z-10">
                     <button onClick={(e) => toggleStatus(product, e)} className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-colors border ${product.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20'}`} title="Alternar Status">
                        {product.status === 'active' ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                     </button>
                     <button onClick={(e) => toggleProductVisibility(product, e)} className={`p-1.5 rounded-lg transition-colors ${product.is_hidden ? 'bg-emerald-500/20 text-emerald-500' : `${isDark ? 'bg-slate-800 text-slate-500 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-indigo-600'}`}`} title={product.is_hidden ? "Restaurar" : "Arquivar"}>
                        {product.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                     </button>
                     <button onClick={(e) => handleDeleteProduct(product.id, e)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'bg-slate-800 text-slate-500 hover:bg-rose-500 hover:text-white' : 'bg-slate-100 text-slate-500 hover:bg-rose-100 hover:text-rose-600'}`} title="Excluir"><Trash2 size={14} /></button>
                  </div>

                  <div className="flex justify-between items-start mb-4 pr-32">
                    <div className={`p-3 rounded-xl flex items-center justify-center w-12 h-12 ${product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : product.currency === 'EUR' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                        {product.currency === 'USD' ? '$' : product.currency === 'EUR' ? '€' : 'R$'}
                    </div>
                  </div>
                  
                  <h3 className={`text-lg font-bold mb-1 transition-colors line-clamp-2 ${textHead} group-hover:text-indigo-500`}>{product.name}</h3>
                  
                  <div className={`mt-auto pt-4 space-y-2 border-t ${isDark ? 'border-slate-800/50' : 'border-slate-100'}`}>
                     <div className="flex items-center gap-2 text-xs text-slate-500"><Folder size={12}/><span className="truncate max-w-[200px]">{product.account_name || 'Sem Conta'}</span></div>
                     <div className="flex items-center gap-2 text-xs text-slate-500"><Layers size={12}/><span className={`font-mono px-1.5 py-0.5 rounded truncate max-w-[200px] ${isDark ? 'bg-black/30' : 'bg-slate-100'}`}>{product.google_ads_campaign_name}</span></div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Modal Novo Produto */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`rounded-xl w-full max-w-lg p-6 shadow-2xl border ${bgCard}`}>
              <div className="flex justify-between items-center mb-6"><h2 className={`text-xl font-bold ${textHead}`}>Novo Produto Manual</h2><button onClick={() => setIsModalOpen(false)}><X size={24} className="text-slate-400 hover:text-indigo-500" /></button></div>
              <div className="space-y-4">
                <input type="text" className={`w-full border rounded-lg p-3 outline-none ${isDark ? 'bg-slate-900 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-black'}`} placeholder="Nome do Produto" value={newProduct.name} onChange={e=>setNewProduct({...newProduct, name: e.target.value})} />
                <input type="text" className={`w-full border rounded-lg p-3 outline-none ${isDark ? 'bg-slate-900 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-black'}`} placeholder="Campanha Google Ads (Exato)" value={newProduct.campaign_name} onChange={e=>setNewProduct({...newProduct, campaign_name: e.target.value})} />
                <button onClick={handleSave} className="w-full bg-indigo-600 py-3 rounded-lg text-white font-bold hover:bg-indigo-700">{saving ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}