"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, 
  ExternalLink, 
  MoreVertical, 
  Trash2, 
  PlayCircle, 
  PauseCircle, 
  RefreshCw, 
  Plus, 
  X,
  Search,
  Filter,
  DollarSign,
  TrendingUp,
  Activity,
  Calendar,
  Layers,
  Globe,
  Briefcase,
  LayoutGrid,
  Target,
  Settings,
  LogOut,
  Folder,
  Eye,
  EyeOff,
  AlertTriangle,
  Square,
  CheckSquare,
  Copy,
  Check,
  List,
  Sun,
  Moon,
  Hash,
  ChevronRight, ChevronDown, ArrowLeft, Package, FileText, CheckCircle2, XCircle
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // Filtros de Navegação
  const [selectedMcc, setSelectedMcc] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  
  // Filtros de Visualização
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'paused'>('ALL'); 
  const [showHidden, setShowHidden] = useState(false);
  
  const [expandedMccs, setExpandedMccs] = useState<string[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ 
    name: '', campaign_name: '', platform: '', currency: 'BRL', status: 'active', account_name: 'Manual', mcc_name: 'Manual' 
  });
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Novos Estados (Enhancements)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [copiedPostback, setCopiedPostback] = useState<string | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // --- INICIALIZAÇÃO ---
  useEffect(() => { 
    async function init() {
      // Carrega Tema
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) setTheme(savedTheme);

      // Carrega Filtro de Status Salvo
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

  // Função para mudar filtro e salvar
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

    const { data: prodData } = await query;
    if (prodData && prodData.length > 0) {
       // Buscar métricas dos últimos 7 dias para o "Mini-Dashboard" (Métricas Vitais)
       const sevenDaysAgo = new Date();
       sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
       const startDateStr = getLocalYYYYMMDD(sevenDaysAgo);

       const { data: metricsData } = await supabase
         .from('daily_metrics')
         .select('product_id, cost, conversion_value')
         .in('product_id', prodData.map((p: any) => p.id))
         .gte('date', startDateStr)
         .limit(50000);
       
       const metricsMap: Record<string, {cost: number, revenue: number, roi: number}> = {};
       prodData.forEach((p: any) => metricsMap[p.id] = { cost: 0, revenue: 0, roi: 0 });
       
       if (metricsData) {
         metricsData.forEach(m => {
            const c = Number(m.cost || 0);
            const r = Number(m.conversion_value || 0);
            metricsMap[m.product_id].cost += c;
            metricsMap[m.product_id].revenue += r;
         });
       }

       const finalProducts = prodData.map((p: any) => {
          const m = metricsMap[p.id];
          if (m.cost > 0) m.roi = ((m.revenue - m.cost) / m.cost) * 100;
          return { ...p, metrics7d: m };
       });

       setProducts(finalProducts);
       const allMccs = Array.from(new Set(finalProducts.map((p: any) => p.mcc_name || 'Sem MCC'))) as string[];
       setExpandedMccs(allMccs);
    } else {
       setProducts([]);
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
      setSelectedProducts(prev => prev.filter(id => !products.find(p => p.id === id && p.account_name === accountName)));
    }
  };

  const toggleAccountFromSidebar = async (mccName: string, accountName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const isTargetAccount = (p: any) => (p.mcc_name || 'Outras') === mccName && (p.account_name || 'Sem Conta') === accountName;
    const accProducts = products.filter(isTargetAccount);
    
    if (accProducts.length === 0) return;
    
    const isFullyHidden = accProducts.every(p => p.is_hidden);
    const newHidden = !isFullyHidden;
    
    if (!confirm(newHidden ? `Ocultar todos os produtos da conta "${accountName}"?` : `Restaurar todos os produtos ocultos da conta "${accountName}"?`)) return;

    setProducts(prev => prev.map(p => 
      isTargetAccount(p) ? { ...p, is_hidden: newHidden } : p
    ));

    const ids = accProducts.map(p => p.id);
    if (ids.length > 0) {
       await supabase.from('products').update({ is_hidden: newHidden }).in('id', ids);
    }
  };

  const handleDeleteProduct = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("Excluir produto permanentemente?")) return;
    const { error } = await supabase.from('products').delete().eq('user_id', userId).eq('id', productId);
    if (!error) {
       setProducts(prev => prev.filter(p => p.id !== productId));
       setSelectedProducts(prev => prev.filter(id => id !== productId));
    }
  };

  // --- AÇÕES EM MASSA (BULK) & POSTBACK ---
  const toggleSelectProduct = (productId: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedProducts(prev => prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]);
  };

  const handleSelectAll = (filteredIds: string[]) => {
    const allSelected = filteredIds.every(id => selectedProducts.includes(id));
    if (allSelected) {
       setSelectedProducts(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
       setSelectedProducts(prev => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleBulkAction = async (action: 'active' | 'paused' | 'delete' | 'hide' | 'unhide') => {
    if (selectedProducts.length === 0) return;
    const count = selectedProducts.length;
    let confirmMsg = '';
    if (action === 'delete') confirmMsg = `Excluir PERMANENTEMENTE ${count} campanhas?`;
    else if (action === 'active') confirmMsg = `Ativar ${count} campanhas?`;
    else if (action === 'paused') confirmMsg = `Pausar ${count} campanhas?`;
    else if (action === 'hide') confirmMsg = `Ocultar ${count} campanhas?`;
    else if (action === 'unhide') confirmMsg = `Desocultar ${count} campanhas?`;

    if (!confirm(confirmMsg)) return;

    setBulkActionLoading(true);
    let error = null;

    if (action === 'delete') {
       const res = await supabase.from('products').delete().eq('user_id', userId).in('id', selectedProducts);
       error = res.error;
       if (!error) setProducts(prev => prev.filter(p => !selectedProducts.includes(p.id)));
    } else if (action === 'hide' || action === 'unhide') {
       const isHidden = action === 'hide';
       const res = await supabase.from('products').update({ is_hidden: isHidden }).in('id', selectedProducts);
       error = res.error;
       if (!error) setProducts(prev => prev.map(p => selectedProducts.includes(p.id) ? { ...p, is_hidden: isHidden } : p));
    } else {
       const res = await supabase.from('products').update({ status: action }).in('id', selectedProducts);
       error = res.error;
       if (!error) setProducts(prev => prev.map(p => selectedProducts.includes(p.id) ? { ...p, status: action } : p));
    }

    setBulkActionLoading(false);
    if (!error) setSelectedProducts([]);
    else alert("Erro na ação em massa: " + error.message);
  };

  const copyPostback = (productId: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const url = `${window.location.origin}/api/postback/${userId}?event=sale&amount={amount}&cy={currency}&orderid={transaction_id}&campaign_id={utm_id}`;
    navigator.clipboard.writeText(url);
    setCopiedPostback(productId);
    setTimeout(() => setCopiedPostback(null), 2000);
  };

  // --- FILTRAGEM PRINCIPAL ---
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesHidden = showHidden ? true : !p.is_hidden;
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

  // --- GRUPOS DE PRODUTOS ---
  const groupedProducts = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredProducts.forEach(p => {
      const key = `${p.mcc_name || 'Sem MCC'} • ${p.account_name || 'Sem Conta'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    // Sort keys alphabetically
    return Object.entries(groups).sort((a,b) => a[0].localeCompare(b[0]));
  }, [filteredProducts]);

  const renderPlatformBadge = (product: any) => {
     const p = (product.platform || '').toLowerCase();
     if (p.includes('clickbank')) return <div className="px-2 py-1 rounded w-10 flex justify-center items-center bg-[#1b2649] text-white font-black text-[9px] shrink-0 shadow-inner">CB</div>;
     if (p.includes('cartpanda')) return <div className="px-2 py-1 rounded w-10 flex justify-center items-center bg-[#2D03FC] text-white font-black text-[9px] shrink-0 shadow-inner">CP</div>;
     if (p.includes('maxweb'))    return <div className="px-2 py-1 rounded w-10 flex justify-center items-center bg-[#F8A826] text-white font-black text-[9px] shrink-0 shadow-inner">MW</div>;
     if (p.includes('digistore')) return <div className="px-2 py-1 rounded w-10 flex justify-center items-center bg-[#003970] text-white font-black text-[9px] shrink-0 shadow-inner">DS</div>;
     if (p.includes('gurumedia')) return <div className="px-2 py-1 rounded w-10 flex justify-center items-center bg-[#4caf50] text-white font-black text-[9px] shrink-0 shadow-inner">GM</div>;
     
     // Fallback text badge for Currency
     const curText = product.currency === 'USD' ? 'USD' : product.currency === 'EUR' ? 'EUR' : 'BRL';
     const curColor = product.currency === 'USD' ? 'bg-indigo-500/10 text-indigo-500' : product.currency === 'EUR' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500';
     return <div className={`px-2 py-1 rounded flex items-center justify-center w-10 shrink-0 ${curColor}`}><span className="font-bold text-[9px]">{curText}</span></div>;
  };

  const formatMoney = (val: number, currency = 'BRL') => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val);

  // Estilos
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';
  const hoverItem = isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100';
  const activeItem = isDark ? 'bg-slate-800 text-white' : 'bg-slate-100 text-black border border-slate-200';
  const buttonPrimary = isDark ? 'bg-indigo-600 text-white' : 'bg-indigo-600 text-white shadow';

  return (
    <div className={`min-h-[100dvh] font-sans flex flex-col md:flex-row ${bgMain}`}>
      
      {/* MOBILE HEADER */}
      <div className={`md:hidden flex items-center justify-between p-4 border-b shrink-0 z-30 sticky top-0 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3">
           <Image src="/logo.png" alt="Logo" width={120} height={40} className={`w-[120px] h-auto object-contain object-left ${!isDark ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : ''}`} priority />
        </div>
        <button onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} className={`p-2 transition-colors ${textMuted} hover:text-indigo-500`}>
           {isMobileSidebarOpen ? <X size={24}/> : <List size={24}/>}
        </button>
      </div>

      {/* SIDEBAR */}
      <aside className={`${isMobileSidebarOpen ? 'flex' : 'hidden'} md:flex fixed md:sticky inset-0 md:inset-auto top-[73px] md:top-0 w-full md:w-72 shrink-0 border-r flex-col h-[calc(100dvh-73px)] md:h-screen z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        
        <div className="hidden md:flex h-20 items-center justify-center md:justify-start md:px-6 border-b border-inherit overflow-hidden shrink-0">
           <div className="relative"><Image src="/logo.png" alt="Logo" width={180} height={60} className={`w-[180px] h-auto object-contain object-left ${!isDark ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : ''}`} priority /></div>
        </div>
        
        {/* Scrollable Area for Sidebar Items */}
        <div className="flex-1 overflow-y-auto flex flex-col custom-scrollbar">
          <nav className="px-2 py-4 space-y-2 shrink-0">
             <Link href="/dashboard" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><LayoutGrid size={20} /> <span className="font-medium">Dashboard</span></Link>
             <Link href="/planning" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Target size={20} /> <span className="font-medium">Planejamento</span></Link>
             <Link href="/products" className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20"><Briefcase size={20} /> <span className="font-medium">Meus Produtos</span></Link>
             <Link href="/integration" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Settings size={20} /> <span className="font-medium">Integração</span></Link>
          </nav>
          
          <div className="px-4 pb-2 mt-2 shrink-0">
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

          <div className="px-4 pb-4 space-y-1">
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
                      <button onClick={() => handleSelectMcc(mcc.name)} className={`w-full flex-1 text-left py-2 px-3 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${isMccActive ? 'bg-indigo-600 text-white shadow' : `${textMuted} ${hoverItem}`}`}>
                         <Globe size={14} className={isMccActive ? 'text-white' : 'text-slate-500'}/>
                         <span className="truncate w-28">{mcc.name}</span>
                      </button>
                      <button onClick={(e) => handleDeleteMcc(mcc.name, e)} className="p-1.5 text-slate-500 hover:text-rose-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><Trash2 size={12}/></button>
                   </div>
                   {isExpanded && (
                     <div className={`ml-4 pl-3 border-l mt-1 space-y-1 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                        {mcc.accounts.map(acc => {
                          const isAccActive = selectedAccount === acc && selectedMcc === mcc.name;
                          const accProds = products.filter(p => (p.mcc_name || 'Outras') === mcc.name && (p.account_name || 'Sem Conta') === acc);
                          const isHidden = accProds.length > 0 && accProds.every(p => p.is_hidden);

                          return (
                            <div key={acc} className="flex items-center group/acc pr-2">
                              <button onClick={() => handleSelectAccount(mcc.name, acc)} className={`w-full flex-1 text-left px-3 py-2 rounded-lg flex items-center gap-2 text-xs transition-all ${isAccActive ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : `${textMuted} ${hoverItem}`}`}>
                                  <Briefcase size={12}/> <span className={`truncate w-28 ${isHidden ? 'opacity-50 line-through' : ''}`}>{acc}</span>
                              </button>
                              <button onClick={(e) => toggleAccountFromSidebar(mcc.name, acc, e)} className={`p-1.5 opacity-100 md:opacity-0 md:group-hover/acc:opacity-100 transition-opacity ml-1 ${isHidden ? 'text-amber-500 hover:text-amber-400' : 'text-slate-500 hover:text-slate-400'}`} title={isHidden ? "Restaurar Conta" : "Ocultar Conta"}>
                                 {isHidden ? <Eye size={12}/> : <EyeOff size={12}/>}
                              </button>
                              <button onClick={(e) => handleDeleteAccount(mcc.name, acc, e)} className="p-1.5 text-slate-500 hover:text-rose-500 opacity-100 md:opacity-0 md:group-hover/acc:opacity-100 transition-opacity ml-0.5" title="Excluir"><Trash2 size={12}/></button>
                            </div>
                          );
                        })}
                     </div>
                   )}
                 </div>
               )
             })}
          </div>
        </div>
        
        <div className="p-4 border-t border-inherit shrink-0">
           <button onClick={handleLogout} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-rose-500 hover:bg-rose-500/10`}><LogOut size={20} /> <span className="font-medium">Sair</span></button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto md:h-screen min-h-[calc(100vh-73px)] relative">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className={`flex flex-wrap items-center gap-2 text-xs ${textMuted} mb-1`}>{selectedMcc ? (<><span className={`px-2 py-0.5 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>{selectedMcc}</span>{selectedAccount && <><ChevronRight size={12}/> <span className={`px-2 py-0.5 rounded text-indigo-500 ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>{selectedAccount}</span></>}</>) : (<span className={`px-2 py-0.5 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>Todas as MCCs</span>)}</div>
            <h1 className={`text-2xl font-bold flex flex-wrap items-center gap-2 ${textHead}`}>{selectedAccount || selectedMcc || 'Gerenciador de Campanhas'}</h1>
          </div>
          
          <div className="flex flex-wrap gap-3">
             <button onClick={toggleTheme} className={`hidden md:block p-2.5 rounded-lg border transition-colors ${isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-500'}`}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
             <button onClick={() => setIsModalOpen(true)} className="flex-1 md:flex-none justify-center bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg"><Plus size={18} /> Novo Produto</button>
          </div>
        </div>

        {/* BARRA DE FERRAMENTAS E FILTROS */}
        <div className="flex flex-col gap-4 mb-6">
           <div className={`p-1.5 rounded-xl flex flex-wrap gap-2 md:gap-4 items-center border ${bgCard}`}>
             <div className="pl-3 text-slate-500 hidden md:block"><Search size={18} /></div>
             <input type="text" placeholder="Buscar campanha..." className={`bg-transparent flex-1 outline-none min-w-[120px] px-2 md:px-0 placeholder:text-slate-600 ${textHead}`} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             
             {/* Filtro de Status */}
             <div className={`flex flex-wrap items-center gap-1 px-2 border-t md:border-t-0 md:border-l w-full md:w-auto pt-2 md:pt-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button onClick={() => changeStatusFilter('ALL')} className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'ALL' ? (isDark ? 'bg-slate-800 text-white' : 'bg-slate-200 text-black') : 'text-slate-500 hover:text-slate-400'}`}>Todos</button>
                <button onClick={() => changeStatusFilter('active')} className={`flex-1 md:flex-none flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'active' ? 'bg-emerald-500/20 text-emerald-500' : 'text-slate-500 hover:text-emerald-500'}`}><PlayCircle size={12} /> Ativos</button>
                <button onClick={() => changeStatusFilter('paused')} className={`flex-1 md:flex-none flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${statusFilter === 'paused' ? 'bg-rose-500/20 text-rose-500' : 'text-slate-500 hover:text-rose-500'}`}><PauseCircle size={12} /> Pausados</button>
             </div>

             <div className={`flex items-center gap-1 px-2 border-l ${isDark ? 'border-slate-800' : 'border-slate-200'} hidden md:flex`}>
                <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? (isDark?'bg-slate-800 text-white':'bg-slate-200 text-black') : 'text-slate-500 hover:text-slate-400'}`} title="Grid View"><LayoutGrid size={16}/></button>
                <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-lg transition-colors ${viewMode === 'table' ? (isDark?'bg-slate-800 text-white':'bg-slate-200 text-black') : 'text-slate-500 hover:text-slate-400'}`} title="Table View"><List size={16}/></button>
             </div>

             <button onClick={handleReload} className={`p-2 rounded-lg transition-colors hidden md:block mr-1 ${hoverItem}`} title="Recarregar"><RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} /></button>
           </div>
           
           {showHidden && <div className="bg-amber-500/10 border border-amber-500/20 p-2 md:px-4 rounded-xl flex items-center justify-center gap-2 text-amber-500 text-xs font-bold animate-pulse"><AlertTriangle size={16} /> Exibindo Ocultos</div>}
        </div>

        {/* GRID OU TABELA DE PRODUTOS */}
        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-slate-500">Carregando produtos...</div>
        ) : filteredProducts.length === 0 ? (
           <div className={`flex flex-col items-center justify-center h-64 text-slate-500 border border-dashed rounded-xl ${isDark ? 'border-slate-800' : 'border-slate-300'}`}><Layers size={32} className="mb-2 opacity-50"/><p>Nenhuma campanha encontrada com os filtros atuais.</p></div>
        ) : (
          <div className="space-y-8 pb-32">
             {groupedProducts.map(([groupName, groupProds]) => (
                <div key={groupName} className="space-y-4">
                   <h2 className={`text-sm font-bold flex items-center gap-2 ${textMuted} uppercase tracking-wider pl-2 border-l-2 ${isDark?'border-slate-800':'border-slate-300'}`}><Folder size={16}/> {groupName} <span className="text-xs bg-slate-500/10 px-2 py-0.5 rounded-full">{groupProds.length}</span></h2>
                   
                   {viewMode === 'grid' ? (
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                       {groupProds.map(product => {
                         const isSelected = selectedProducts.includes(product.id);
                         const m7d = product.metrics7d || {cost:0, revenue:0, roi:0};
                         return (
                           <div key={product.id} className={`border rounded-xl transition-all relative overflow-hidden flex flex-col ${product.is_hidden ? (isDark ? 'bg-black border-slate-800 opacity-60' : 'bg-slate-100 border-slate-300 opacity-60') : `${bgCard} hover:border-indigo-500/50`} ${isSelected ? 'ring-2 ring-indigo-500 border-transparent shadow-lg shadow-indigo-500/10' : ''}`}>
                             <div className="p-5 flex-1 cursor-pointer" onClick={() => router.push(`/products/${product.id}`)}>
                               <div className="absolute top-4 right-4 flex gap-1 z-10" onClick={e=>e.stopPropagation()}>
                                  <button onClick={(e) => toggleStatus(product, e)} className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-bold transition-colors border ${product.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20'}`} title="Alternar Status">
                                     {product.status === 'active' ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                                  </button>
                                  <button onClick={(e) => copyPostback(product.id, e)} className={`p-1.5 rounded-lg transition-colors ${copiedPostback === product.id ? 'bg-emerald-500 text-white' : (isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-black')}`} title="Copiar Postback">{copiedPostback === product.id ? <Check size={14}/> : <Copy size={14}/>}</button>
                                  <button onClick={(e) => toggleProductVisibility(product, e)} className={`p-1.5 rounded-lg transition-colors ${product.is_hidden ? 'bg-amber-500/20 text-amber-500' : (isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-black')}`} title={product.is_hidden ? "Restaurar" : "Arquivar"}>{product.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                                  <button onClick={(e) => handleDeleteProduct(product.id, e)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'bg-slate-800 text-slate-500 hover:bg-rose-500 hover:text-white' : 'bg-slate-100 text-slate-500 hover:bg-rose-100 hover:text-rose-600'}`} title="Excluir"><Trash2 size={14} /></button>
                               </div>

                               <div className="flex items-center gap-2 mb-3 pr-28">
                                 <button onClick={(e)=>toggleSelectProduct(product.id, e)} className={`${isSelected ? 'text-indigo-500' : 'text-slate-300 hover:text-slate-400'}`}>{isSelected ? <CheckSquare size={16}/> : <Square size={16}/>}</button>
                                 {renderPlatformBadge(product)}
                               </div>
                               
                               <h3 className={`text-sm font-bold mb-1 transition-colors line-clamp-2 ${textHead} group-hover:text-indigo-500`}>{product.name}</h3>
                               <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono"><Hash size={10}/><span className="truncate max-w-[200px]">{product.campaign_id}</span></div>
                             </div>

                             {/* Métricas 7D Footer Compacto */}
                             <div className={`px-4 py-3 border-t flex flex-col gap-2 ${isDark ? 'border-slate-800/50 bg-slate-900/50' : 'border-slate-100 bg-slate-50'}`}>
                               <div className="flex justify-between items-center text-xs">
                                  <span className="text-slate-500 font-medium tracking-wide">Receita</span>
                                  <span className={`font-mono font-medium ${isDark?'text-slate-200':'text-slate-900'}`}>{formatMoney(m7d.revenue, product.currency)}</span>
                               </div>
                               <div className="flex justify-between items-center text-xs">
                                  <span className="text-slate-500 font-medium tracking-wide">Custo</span>
                                  <span className={`font-mono font-medium ${isDark?'text-slate-200':'text-slate-900'}`}>{formatMoney(m7d.cost, product.currency)}</span>
                               </div>
                               <div className="flex justify-between items-center mt-1 pt-2 border-t border-dashed border-slate-300/20">
                                  <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark?'text-white':'text-black'}`}>Lucro (7D)</span>
                                  <span className={`font-mono font-bold text-sm ${(m7d.revenue - m7d.cost) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney((m7d.revenue - m7d.cost), product.currency)}</span>
                               </div>
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   ) : (
                     <div className={`border rounded-xl flex overflow-hidden overflow-x-auto ${bgCard}`}>
                       <table className="w-full text-left border-collapse min-w-[800px] whitespace-nowrap">
                         <thead>
                           <tr className={`text-xs uppercase tracking-wider ${isDark ? 'bg-slate-900/50 text-slate-500' : 'bg-slate-50 text-slate-500'} border-b ${borderCol}`}>
                             <th className="p-3 w-10 text-center"><button onClick={() => handleSelectAll(groupProds.map(p=>p.id))} className="text-slate-400 hover:text-indigo-500">{groupProds.length > 0 && groupProds.every(p => selectedProducts.includes(p.id)) ? <CheckSquare size={16}/> : <Square size={16}/>}</button></th>
                             <th className="p-3 w-12 text-center">Plat.</th>
                             <th className="p-3">Campanha</th>
                             <th className="p-3">7D Receita</th>
                             <th className="p-3">7D Custo</th>
                             <th className="p-3">7D Lucro</th>
                             <th className="p-3 text-right">Ações</th>
                           </tr>
                         </thead>
                         <tbody className="divide-y divide-inherit">
                           {groupProds.map(product => {
                             const isSelected = selectedProducts.includes(product.id);
                             const m7d = product.metrics7d || {cost:0, revenue:0, roi:0};
                             return (
                               <tr key={product.id} className={`transition-colors cursor-pointer ${isSelected ? (isDark?'bg-indigo-500/10':'bg-indigo-50') : hoverItem}`} onClick={() => router.push(`/products/${product.id}`)}>
                                 <td className="p-3 text-center" onClick={e=>e.stopPropagation()}><button onClick={(e)=>toggleSelectProduct(product.id, e)} className={`${isSelected ? 'text-indigo-500' : 'text-slate-300 hover:text-slate-400'}`}>{isSelected ? <CheckSquare size={16}/> : <Square size={16}/>}</button></td>
                                 <td className="p-3 py-2 flex justify-center">{renderPlatformBadge(product)}</td>
                                 <td className="p-3">
                                   <div className="flex items-center gap-2">
                                     {product.status === 'active' ? <PlayCircle size={14} className="text-emerald-500 shrink-0"/> : <PauseCircle size={14} className="text-rose-500 shrink-0"/>}
                                     <span className={`font-bold text-sm ${textHead} truncate max-w-[280px]`} title={product.name}>{product.name}</span>
                                     {product.is_hidden && <EyeOff size={12} className="text-amber-500 shrink-0"/>}
                                   </div>
                                   <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono mt-0.5 truncate max-w-[280px]" title={product.campaign_id}>
                                      <Hash size={10} /> {product.campaign_id}
                                   </div>
                                 </td>
                                 <td className={`p-3 font-mono text-xs ${isDark?'text-slate-200':'text-slate-900'}`}>{formatMoney(m7d.revenue, product.currency)}</td>
                                 <td className={`p-3 font-mono text-xs ${isDark?'text-slate-200':'text-slate-900'}`}>{formatMoney(m7d.cost, product.currency)}</td>
                                 <td className="p-3"><span className={`font-mono text-xs font-bold ${(m7d.revenue - m7d.cost) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMoney(m7d.revenue - m7d.cost, product.currency)}</span></td>
                                 <td className="p-3 text-right" onClick={e=>e.stopPropagation()}>
                                   <div className="flex justify-end gap-1">
                                      <button onClick={(e) => toggleStatus(product, e)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-200'}`} title="Pausar/Ativar">{product.status === 'active' ? <PauseCircle size={14} /> : <PlayCircle size={14} />}</button>
                                      <button onClick={(e) => copyPostback(product.id, e)} className={`p-1.5 rounded-lg transition-colors ${copiedPostback === product.id ? 'text-emerald-500 bg-emerald-500/10' : (isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-200')}`} title="Copiar Postback">{copiedPostback === product.id ? <Check size={14}/> : <Copy size={14}/>}</button>
                                      <button onClick={(e) => handleDeleteProduct(product.id, e)} className={`p-1.5 rounded-lg transition-colors hover:text-rose-500 ${isDark ? 'text-slate-400 hover:bg-rose-500/20' : 'text-slate-500 hover:bg-rose-100'}`} title="Excluir"><Trash2 size={14} /></button>
                                   </div>
                                 </td>
                               </tr>
                             )
                           })}
                         </tbody>
                       </table>
                     </div>
                   )}
                </div>
             ))}
          </div>
        )}

        {/* BULK ACTION BAR */}
        {selectedProducts.length > 0 && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 border px-6 flex items-center gap-6 z-50 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300 ${isDark ? 'bg-slate-900 border-slate-700 text-white shadow-indigo-500/10' : 'bg-white border-slate-300 text-slate-900 shadow-slate-300'}`}>
            <div className="flex items-center gap-3 py-4">
               <div className="bg-indigo-600 text-white w-8 h-8 rounded-full flex justify-center items-center font-bold text-sm shadow-inner">{selectedProducts.length}</div>
               <span className="font-medium text-sm">Selecionados</span>
            </div>
            
            <div className={`w-px h-8 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}></div>

            <div className="flex items-center gap-2 py-4">
               <button onClick={()=>handleBulkAction('active')} disabled={bulkActionLoading} className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${isDark ? 'hover:bg-emerald-500/20 hover:text-emerald-400' : 'hover:bg-emerald-100 hover:text-emerald-600'}`}><PlayCircle size={14}/> Ativar</button>
               <button onClick={()=>handleBulkAction('paused')} disabled={bulkActionLoading} className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${isDark ? 'hover:bg-amber-500/20 hover:text-amber-400' : 'hover:bg-amber-100 hover:text-amber-600'}`}><PauseCircle size={14}/> Pausar</button>
               <button onClick={()=>handleBulkAction('hide')} disabled={bulkActionLoading} className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}><EyeOff size={14}/> Ocultar</button>
               <button onClick={()=>handleBulkAction('delete')} disabled={bulkActionLoading} className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${isDark ? 'hover:bg-rose-500/20 hover:text-rose-400' : 'hover:bg-rose-100 hover:text-rose-600'}`}><Trash2 size={14}/> Excluir</button>
            </div>
            
            <div className={`w-px h-8 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            
            <button onClick={()=>setSelectedProducts([])} className={`p-4 transition-colors border-l ${isDark ? 'text-slate-400 hover:text-white border-slate-800' : 'text-slate-500 hover:text-black border-slate-200'}`} title="Cancelar"><X size={18}/></button>
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