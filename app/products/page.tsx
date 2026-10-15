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
  ChevronRight, ChevronDown, ArrowLeft, Package, FileText, CheckCircle2, XCircle, ArrowDownWideNarrow, Sparkles, Route
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { canEdit } from '@/lib/googleAds/editors';
import { useRouter } from 'next/navigation';
import { Logo } from '@/app/components/Logo';
import { CampaignStatusToggle } from '@/app/components/CampaignStatusToggle';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import { isValidDay } from '@/lib/useDayInput';
import { blockOf } from '@/lib/campaignGroups';
import { useCampaignGroups } from '@/app/components/table/useTablePrefs';
import { CampaignGroupsBar } from '@/app/components/CampaignGroupsBar';
import { CampaignTable, DOT, LEVELS, loadLevel, loadSort, saveLevel, saveSort, toneOf, type Level, type Sort, type Tone } from './CampaignTable';
import { Inter } from 'next/font/google';

// Fonte do guia visual (DESIGN.md), nas telas já migradas.
const inter = Inter({ subsets: ['latin'], display: 'swap' });

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
  const { authChecked } = useAuthGuard();
  const [products, setProducts] = useState<any[]>([]);
  // Grupos de campanhas do usuário: os mesmos da Dashboard, com a mesma marcação.
  const { groups, setGroups } = useCampaignGroups();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // Filtros de Navegação
  const [selectedMcc, setSelectedMcc] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  
  // Filtros de Visualização
  // O que cada linha da tabela é (campanha, conta ou MCC) e a coluna que ordena.
  const [level, setLevel] = useState<Level>('campaigns');
  const [sort, setSort] = useState<Sort>({ key: 'cost', desc: true });
  // Situações que a tabela mostra. Vazio = todas.
  const [statusFilter, setStatusFilter] = useState<Tone[]>([]);
  const [rates, setRates] = useState({ USD: 5.60, EUR: 6.00 }); 
  const [showHidden, setShowHidden] = useState(false);
  
  const [expandedMccs, setExpandedMccs] = useState<string[]>([]);
  
  const [userId, setUserId] = useState('');
  const [canCreate, setCanCreate] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Novos Estados (Enhancements)
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [copiedPostback, setCopiedPostback] = useState<string | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Novos Estados para Filtro de Data
  const [dateFilter, setDateFilter] = useState<string>('7d');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [isCustomDateModalOpen, setIsCustomDateModalOpen] = useState(false);

  // --- INICIALIZAÇÃO ---
  useEffect(() => { 
    async function init() {
      // Carrega Tema
      const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
      if (savedTheme) { setTheme(savedTheme); }
    applyTheme(savedTheme || 'dark');

      // 'active'/'paused' são os valores antigos, de antes do status vir do Google.
      const savedStatus = localStorage.getItem('autometrics_products_status_filter') || '';
      const STATUS: Record<string, Tone> = { ativo: 'ativo', pausado: 'pausado', suspenso: 'suspenso', sem_veicular: 'sem_veicular', active: 'ativo', paused: 'pausado' };
      setStatusFilter([...new Set(savedStatus.split(',').map(v => STATUS[v.trim()]).filter(Boolean))]);
      setLevel(loadLevel());
      setSort(loadSort());

      // Mesmas cotações do dashboard: sem elas, ordenar ou somar uma conta em USD
      // com outra em BRL misturaria 100 dólares com 100 reais.
      const d = parseFloat(localStorage.getItem('autometrics_manual_dollar') || '');
      const e = parseFloat(localStorage.getItem('autometrics_manual_euro') || '');
      setRates({
        USD: Number.isFinite(d) && d > 0 ? d : 5.60,
        EUR: Number.isFinite(e) && e > 0 ? e : 6.00,
      });

      // Carrega Filtro de Data Salvo
      const savedDateFilter = localStorage.getItem('autometrics_products_date_filter') || '7d';
      setDateFilter(savedDateFilter);
      const savedCustomStart = localStorage.getItem('autometrics_products_custom_start') || '';
      setCustomStartDate(savedCustomStart);
      const savedCustomEnd = localStorage.getItem('autometrics_products_custom_end') || '';
      setCustomEndDate(savedCustomEnd);

      // Carrega Seleções Globais
      const savedMcc = localStorage.getItem('autometrics_selected_mcc');
      if (savedMcc && savedMcc !== 'all') setSelectedMcc(savedMcc); // Integrado ao dashboard/planning

      const savedAccount = localStorage.getItem('autometrics_products_account');
      if (savedAccount) setSelectedAccount(savedAccount);

      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/');
        return;
      }

      setUserId(session.user.id);
      setCanCreate(canEdit(session.user.email));
      await fetchProducts(session.user.id, savedDateFilter, savedCustomStart, savedCustomEnd);
    }
    init();
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('autometrics_theme', newTheme);
    applyTheme(newTheme);
  };

  const handleDateFilterChange = (newFilter: string) => {
    setDateFilter(newFilter);
    localStorage.setItem('autometrics_products_date_filter', newFilter);
    if (newFilter === 'custom') {
      setIsCustomDateModalOpen(true);
    } else if (userId) {
      fetchProducts(userId, newFilter, customStartDate, customEndDate);
    }
  };

  const handleCustomDateApply = () => {
    // Data pela metade consultava o banco com "0002-10-26" ou vazio.
    if (!isValidDay(customStartDate) || !isValidDay(customEndDate)) {
      alert('Preencha as duas datas por completo.');
      return;
    }
    localStorage.setItem('autometrics_products_custom_start', customStartDate);
    localStorage.setItem('autometrics_products_custom_end', customEndDate);
    if (userId) fetchProducts(userId, 'custom', customStartDate, customEndDate);
    setIsCustomDateModalOpen(false);
  };

  // Fechar sem as duas datas volta para os últimos 7 dias, como antes.
  const closeCustomDateModal = () => {
    setIsCustomDateModalOpen(false);
    if (!customStartDate || !customEndDate) {
      setDateFilter('7d');
      localStorage.setItem('autometrics_products_date_filter', '7d');
      if (userId) fetchProducts(userId, '7d');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  async function fetchProducts(currentUserId: string, dFilter: string = dateFilter, cStart: string = customStartDate, cEnd: string = customEndDate) {
    setLoading(true);
    
    let allProducts: any[] = [];
    let p_prod = 0;
    let m_prod = true;
    while (m_prod) {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .range(p_prod * 1000, (p_prod + 1) * 1000 - 1);
        
      if (data && data.length > 0) {
        allProducts.push(...data);
        if (data.length < 1000) m_prod = false;
        else p_prod++;
      } else {
        m_prod = false;
      }
    }
    const prodData = allProducts;
    if (prodData && prodData.length > 0) {
       let startDateStr = '';
       let endDateStr = '';
       const today = new Date();
       
       if (dFilter === 'today') {
         startDateStr = getLocalYYYYMMDD(today);
         endDateStr = startDateStr;
       } else if (dFilter === 'yesterday') {
         const yesterday = new Date(today);
         yesterday.setDate(today.getDate() - 1);
         startDateStr = getLocalYYYYMMDD(yesterday);
         endDateStr = startDateStr;
       } else if (dFilter === '7d') {
         const sevenDaysAgo = new Date(today);
         sevenDaysAgo.setDate(today.getDate() - 7);
         startDateStr = getLocalYYYYMMDD(sevenDaysAgo);
         endDateStr = getLocalYYYYMMDD(today);
       } else if (dFilter === '14d') {
         const fourteenDaysAgo = new Date(today);
         fourteenDaysAgo.setDate(today.getDate() - 14);
         startDateStr = getLocalYYYYMMDD(fourteenDaysAgo);
         endDateStr = getLocalYYYYMMDD(today);
       } else if (dFilter === 'this_month') {
         startDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
         endDateStr = getLocalYYYYMMDD(today);
       } else if (dFilter === 'custom') {
         startDateStr = cStart;
         endDateStr = cEnd;
       }

       if (!startDateStr || !endDateStr) {
           const sevenDaysAgo = new Date(today);
           sevenDaysAgo.setDate(today.getDate() - 7);
           startDateStr = getLocalYYYYMMDD(sevenDaysAgo);
           endDateStr = getLocalYYYYMMDD(today);
       }

       const productIds = prodData.map((p: any) => p.id);
       let metricsData: any[] = [];
       const chunkSize = 150;
       for (let i = 0; i < productIds.length; i += chunkSize) {
           const idChunk = productIds.slice(i, i + chunkSize);
           let p = 0;
           let m = true;
           while(m) {
              const { data: c } = await supabase.from('daily_metrics').select('product_id, cost, conversion_value, impressions, clicks').in('product_id', idChunk).gte('date', startDateStr).lte('date', endDateStr).range(p*1000, (p+1)*1000-1);
              if (c && c.length > 0) { metricsData.push(...c); if (c.length < 1000) m = false; else p++; } else m = false;
           }
       }
       
       const metricsMap: Record<string, {cost: number, revenue: number, profit: number, roi: number, impressions: number, clicks: number, budget: number, budgetDate?: string}> = {};
       prodData.forEach((p: any) => metricsMap[p.id] = { cost: 0, revenue: 0, profit: 0, roi: 0, impressions: 0, clicks: 0, budget: 0 });
       
       if (metricsData) {
         metricsData.forEach(m => {
            const c = Number(m.cost || 0);
            const r = Number(m.conversion_value || 0);
            metricsMap[m.product_id].cost += c;
            metricsMap[m.product_id].revenue += r;
            metricsMap[m.product_id].impressions += Number(m.impressions || 0);
            metricsMap[m.product_id].clicks += Number(m.clicks || 0);
         });
       }

       // Status atual de cada campanha.
       // products.google_status é preenchido pelo webhook, mas o histórico em
       // daily_metrics já traz o status por dia — e é mais fresco que o filtro
       // de data escolhido aqui, que pode nem incluir hoje. Vale a linha de
       // maior data dos últimos 7 dias.
       const statusWindow = new Date(today);
       statusWindow.setDate(today.getDate() - 7);
       const statusFrom = getLocalYYYYMMDD(statusWindow);
       const statusMap: Record<string, { date: string; effective_status?: string; campaign_status?: string; campaign_status_reasons?: string }> = {};
       // Orçamento diário: o Google só informa o de hoje, e a coleta grava no dia em que leu.
       // Vale a leitura mais recente.
       const budgetMap: Record<string, { date: string; value: number }> = {};

       // As colunas novas só existem depois da migration; até lá o PostgREST
       // recusa a query inteira, então cai para as colunas antigas.
       const STATUS_COLS_FULL = 'product_id, date, campaign_status, effective_status, campaign_status_reasons, budget_micros';
       const STATUS_COLS_LEGACY = 'product_id, date, campaign_status';
       let statusCols = STATUS_COLS_FULL;

       for (let i = 0; i < productIds.length; i += chunkSize) {
          const idChunk = productIds.slice(i, i + chunkSize);
          const fetchStatus = (cols: string) => supabase
            .from('daily_metrics')
            .select(cols)
            .in('product_id', idChunk)
            .gte('date', statusFrom)
            .order('date', { ascending: false });

          let { data: st, error: stErr } = await fetchStatus(statusCols);
          if (stErr && statusCols === STATUS_COLS_FULL) {
             statusCols = STATUS_COLS_LEGACY;
             ({ data: st } = await fetchStatus(statusCols));
          }

          ((st || []) as any[]).forEach((r: any) => {
             const cur = statusMap[r.product_id];
             if (!cur || r.date > cur.date) statusMap[r.product_id] = r;
             const budget = Number(r.budget_micros || 0) / 1000000;
             if (budget > 0 && (!budgetMap[r.product_id] || r.date > budgetMap[r.product_id].date)) budgetMap[r.product_id] = { date: r.date, value: budget };
          });
       }

       // Campanha sem leitura nos últimos 7 dias (pausada há mais tempo): vale o orçamento da última
       // vez em que foi lida, sem limite de dias. As linhas vêm da mais nova para a mais antiga, e a
       // busca de cada lote para quando todas as campanhas dele já têm valor.
       if (statusCols === STATUS_COLS_FULL) {
          const missing = productIds.filter((id: string) => !budgetMap[id]);
          for (let i = 0; i < missing.length; i += chunkSize) {
             const idChunk = missing.slice(i, i + chunkSize);
             for (let page = 0; ; page++) {
                const { data: old } = await supabase.from('daily_metrics').select('product_id, date, budget_micros')
                  .in('product_id', idChunk).gt('budget_micros', 0).lt('date', statusFrom)
                  .order('date', { ascending: false }).range(page * 1000, (page + 1) * 1000 - 1);
                ((old || []) as any[]).forEach((r: any) => { if (!budgetMap[r.product_id]) budgetMap[r.product_id] = { date: r.date, value: Number(r.budget_micros) / 1000000 }; });
                if (!old || old.length < 1000 || idChunk.every((id: string) => budgetMap[id])) break;
             }
          }
       }

       const finalProducts = prodData.map((p: any) => {
          const m = metricsMap[p.id];
          m.profit = m.revenue - m.cost;
          if (m.cost > 0) m.roi = (m.profit / m.cost) * 100;
          m.budget = budgetMap[p.id]?.value || 0;
          m.budgetDate = budgetMap[p.id]?.date || '';
          const latest = statusMap[p.id];
          return {
            ...p,
            metrics7d: m,
            google_status: p.google_status || latest?.effective_status || null,
            google_status_reasons: p.google_status_reasons || latest?.campaign_status_reasons || null,
            latest_campaign_status: latest?.campaign_status || null,
          };
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
    // Apaga do painel todas as campanhas da MCC e, em cascata, o que foi guardado
    // delas (análises, grupos, anúncios). Um clique errado no lixinho não basta:
    // é preciso digitar o nome da MCC.
    const total = products.filter(p => (p.mcc_name || 'Outras') === mccName).length;
    const typed = prompt(
      `Isto apaga do painel as ${total} ${total === 1 ? 'campanha' : 'campanhas'} da MCC "${mccName}" e tudo o que foi guardado delas (números, análises, anúncios). Não dá para desfazer.\n\nPara confirmar, digite o nome da MCC:`
    );
    if (typed === null) return;
    if (typed.trim() !== mccName.trim()) { alert('O nome digitado não confere. Nada foi apagado.'); return; }
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

  const handleBulkAction = async (action: 'delete' | 'hide' | 'unhide') => {
    if (selectedProducts.length === 0) return;
    const count = selectedProducts.length;
    let confirmMsg = '';
    if (action === 'delete') confirmMsg = `Excluir PERMANENTEMENTE ${count} campanhas?`;
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
    let matchesContext = true;
    if (selectedAccount) {
       matchesContext = (p.account_name || 'Sem Conta') === selectedAccount && (selectedMcc ? (p.mcc_name || 'Outras') === selectedMcc : true);
    } else if (selectedMcc) {
       matchesContext = (p.mcc_name || 'Outras') === selectedMcc;
    }

    // Grupo desmarcado fica fora da tabela, como na Dashboard.
    const matchesGroup = !groups.hidden.includes(blockOf(p.name || '', groups.list));

    return matchesSearch && matchesContext && matchesHidden && matchesGroup;
  });

  const toggleMccExpand = (mccName: string) => { setExpandedMccs(prev => prev.includes(mccName) ? prev.filter(m => m !== mccName) : [...prev, mccName]); };
  const handleSelectMcc = (mccName: string) => { 
     setSelectedMcc(mccName); 
     setSelectedAccount(null); 
     localStorage.setItem('autometrics_selected_mcc', mccName);
     localStorage.removeItem('autometrics_products_account');
  };
  const handleSelectAccount = (mccName: string, accName: string) => { 
     setSelectedMcc(mccName); 
     setSelectedAccount(accName); 
     localStorage.setItem('autometrics_selected_mcc', mccName);
     localStorage.setItem('autometrics_products_account', accName);
  };
  const resetFilters = () => { 
     setSelectedMcc(null); 
     setSelectedAccount(null);
     localStorage.removeItem('autometrics_selected_mcc');
     localStorage.removeItem('autometrics_products_account');
     // Not removing from everything, just locally? Actually, 'all' means reset for dashboard.
     localStorage.setItem('autometrics_selected_mcc', 'all');
  };

  /** Tira só a conta e continua na MCC dela. */
  const clearAccount = () => { setSelectedAccount(null); localStorage.removeItem('autometrics_products_account'); };

  const toggleProductVisibility = async (product: any, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const newHidden = !product.is_hidden;
    setProducts(products.map(p => p.id === product.id ? { ...p, is_hidden: newHidden } : p));
    await supabase.from('products').update({ is_hidden: newHidden }).eq('id', product.id);
  };

  const handleReload = () => { if (userId) fetchProducts(userId, dateFilter, customStartDate, customEndDate); };

  // Clicar numa situação marca ou desmarca; "Todas" limpa a escolha. Marcar as quatro é o mesmo que todas.
  const changeStatusFilter = (key: 'ALL' | Tone) => {
    const toggled = key === 'ALL' ? [] : statusFilter.includes(key) ? statusFilter.filter(t => t !== key) : [...statusFilter, key];
    const next = toggled.length === 4 ? [] : toggled;
    setStatusFilter(next);
    localStorage.setItem('autometrics_products_status_filter', next.join(',') || 'ALL');
  };
  // Quantas campanhas há em cada situação, antes de filtrar por situação: é o número de cada botão.
  const statusCount: Record<Tone, number> = { ativo: 0, pausado: 0, suspenso: 0, sem_veicular: 0 };
  for (const p of filteredProducts) statusCount[toneOf(p).tone]++;
  const shownProducts = statusFilter.length ? filteredProducts.filter(p => statusFilter.includes(toneOf(p).tone)) : filteredProducts;

  // Lista vazia por causa dos filtros: um botão desfaz busca, situação e MCC/conta.
  // Os grupos ficam como estão — são escolha guardada, valem também na Dashboard.
  const hasFilters = !!searchTerm || statusFilter.length > 0 || !!selectedMcc || !!selectedAccount;
  const clearAllFilters = () => {
    setSearchTerm('');
    setStatusFilter([]);
    localStorage.setItem('autometrics_products_status_filter', 'ALL');
    resetFilters();
  };

  // Nomes para a barra de grupos contar quantas campanhas entram em cada um (ocultas só quando estão à mostra).
  const campaignNames = useMemo(() => products.filter(p => showHidden || !p.is_hidden).map(p => p.name || ''), [products, showHidden]);

  const changeLevel = (l: Level) => { setLevel(l); saveLevel(l); };
  const changeSort = (next: Sort) => { setSort(next); saveSort(next); };

  // Visual pelo guia (DESIGN.md, direção Linear): cores pelos tokens do tema.
  const isDark = theme === 'dark';
  const navItem = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const navIdle = `${navItem} text-ink-subtle hover:bg-surface-2 hover:text-ink`;
  const iconBtn = 'w-8 h-8 flex items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors';
  const segItem = (on: boolean) => `rounded-md text-xs font-medium whitespace-nowrap transition-colors ${on ? 'bg-surface-3 text-ink' : 'text-ink-subtle hover:text-ink'}`;
  const rowAction = 'p-1.5 rounded-md text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors';
  const field = 'w-full bg-surface-1 border border-line-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand';
  const NAV_ITEMS = [
    { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', short: 'Dashboard' },
    { href: '/planning', Icon: Target, label: 'Metas', short: 'Metas' },
    { href: '/products', Icon: Package, label: 'Campanhas', short: 'Campanhas' },
    { href: '/analise-ia', Icon: Sparkles, label: 'Análise de IA', short: 'Análise IA' },
    { href: '/rastreamento', Icon: Route, label: 'Rastreamento', short: 'Rastreio' },
    { href: '/integration', Icon: Settings, label: 'Integração', short: 'Integração' },
  ];

  if (!authChecked) return <div className="min-h-screen bg-canvas" />;

  return (
    <div className={`${inter.className} min-h-[100dvh] font-sans flex flex-col md:flex-row bg-canvas text-ink-muted`}>

      {/* MOBILE HEADER */}
      <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-line bg-surface-1 shrink-0 z-30 sticky top-0">
        <Logo />
        <button onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} aria-label={isMobileSidebarOpen ? 'Fechar o menu' : 'Abrir o menu'} aria-expanded={isMobileSidebarOpen} className={iconBtn}>
          {isMobileSidebarOpen ? <X size={18} aria-hidden="true"/> : <List size={18} aria-hidden="true"/>}
        </button>
      </div>

      {/* SIDEBAR */}
      <aside className={`${isMobileSidebarOpen ? 'flex' : 'hidden'} md:flex fixed md:sticky inset-0 md:inset-auto top-14 md:top-0 w-full md:w-64 shrink-0 border-r border-line bg-surface-1 flex-col h-[calc(100dvh-3.5rem)] md:h-screen z-20`}>

        <div className="hidden md:flex h-16 items-center px-5 border-b border-line overflow-hidden shrink-0">
          <Logo />
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col custom-scrollbar">
          <nav className="px-3 py-4 space-y-0.5 shrink-0">
            {NAV_ITEMS.map(({ href, Icon, label }) => href === '/products' ? (
              <Link key={href} href={href} aria-current="page" className={`${navItem} bg-surface-2 text-ink`}>
                <Icon size={18} aria-hidden="true" className="text-brand-text" /> <span>{label}</span>
              </Link>
            ) : (
              <Link key={href} href={href} className={navIdle}>
                <Icon size={18} aria-hidden="true" /> <span>{label}</span>
              </Link>
            ))}
          </nav>

          <div className="px-3 pt-2 pb-2 shrink-0 border-t border-line">
            <div className="flex justify-between items-center px-2 py-2">
              <p className="text-xs font-medium text-ink-subtle">Contas</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowHidden(!showHidden)} aria-pressed={showHidden}
                  className={`text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${showHidden ? 'bg-warn/10 text-warn' : 'text-ink-subtle hover:text-ink hover:bg-surface-2'}`}>
                  {showHidden ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
                  {showHidden ? 'Ver ativas' : 'Ver ocultas'}
                </button>
                <button onClick={resetFilters} className="text-xs px-2 py-1 rounded-md text-brand-text hover:bg-surface-2">Limpar</button>
              </div>
            </div>
          </div>

          <div className="px-3 pb-4 space-y-0.5">
            {structure.length === 0 && !loading && (
              <div className="text-center py-4 px-2"><p className="text-xs text-ink-subtle">Nenhuma conta encontrada.</p></div>
            )}

            {structure.map(mcc => {
              const isMccActive = selectedMcc === mcc.name && !selectedAccount;
              const isExpanded = expandedMccs.includes(mcc.name);
              return (
                <div key={mcc.name}>
                  <div className="flex items-center gap-0.5 group relative">
                    <button onClick={() => toggleMccExpand(mcc.name)} aria-label={`${isExpanded ? 'Recolher' : 'Mostrar'} as contas de ${mcc.name}`} aria-expanded={isExpanded} className="p-1.5 rounded-md text-ink-subtle hover:text-ink">{isExpanded ? <ChevronDown size={14} aria-hidden="true"/> : <ChevronRight size={14} aria-hidden="true"/>}</button>
                    <button onClick={() => handleSelectMcc(mcc.name)} aria-current={isMccActive ? 'true' : undefined}
                      className={`flex-1 min-w-0 text-left py-1.5 px-2 rounded-md flex items-center gap-2 text-[13px] font-medium transition-colors ${isMccActive ? 'bg-surface-2 text-ink' : 'text-ink-subtle hover:bg-surface-2 hover:text-ink'}`}>
                      <Globe size={14} aria-hidden="true" className={`shrink-0 ${isMccActive ? 'text-brand-text' : ''}`}/>
                      <span className="break-all min-w-0">{mcc.name}</span>
                    </button>
                    <button onClick={(e) => handleDeleteMcc(mcc.name, e)} aria-label={`Excluir a MCC ${mcc.name}`} className="p-1.5 rounded-md text-ink-subtle hover:text-neg opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"><Trash2 size={12} aria-hidden="true"/></button>
                  </div>
                  {isExpanded && (
                    <div className="ml-4 pl-2 border-l border-line my-0.5 space-y-0.5">
                      {mcc.accounts.map(acc => {
                        const isAccActive = selectedAccount === acc && selectedMcc === mcc.name;
                        const accProds = products.filter(p => (p.mcc_name || 'Outras') === mcc.name && (p.account_name || 'Sem Conta') === acc);
                        const isHidden = accProds.length > 0 && accProds.every(p => p.is_hidden);

                        return (
                          <div key={acc} className="flex items-center group/acc">
                            <button onClick={() => handleSelectAccount(mcc.name, acc)} aria-current={isAccActive ? 'true' : undefined}
                              className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md flex items-center gap-2 text-xs transition-colors ${isAccActive ? 'bg-surface-2 text-ink font-medium' : 'text-ink-subtle hover:bg-surface-2 hover:text-ink'}`}>
                              <Briefcase size={12} aria-hidden="true" className={`shrink-0 ${isAccActive ? 'text-brand-text' : ''}`}/> <span className={`break-all min-w-0 ${isHidden ? 'opacity-50 line-through' : ''}`}>{acc}</span>
                            </button>
                            <button onClick={(e) => toggleAccountFromSidebar(mcc.name, acc, e)} className={`p-1.5 rounded-md opacity-100 md:opacity-0 md:group-hover/acc:opacity-100 focus-visible:opacity-100 transition-opacity ${isHidden ? 'text-warn' : 'text-ink-subtle hover:text-ink'}`} title={isHidden ? "Restaurar conta" : "Ocultar conta"} aria-label={`${isHidden ? 'Restaurar' : 'Ocultar'} a conta ${acc}`}>
                              {isHidden ? <Eye size={12} aria-hidden="true"/> : <EyeOff size={12} aria-hidden="true"/>}
                            </button>
                            <button onClick={(e) => handleDeleteAccount(mcc.name, acc, e)} className="p-1.5 rounded-md text-ink-subtle hover:text-neg opacity-100 md:opacity-0 md:group-hover/acc:opacity-100 focus-visible:opacity-100 transition-opacity" title="Excluir" aria-label={`Excluir a conta ${acc}`}><Trash2 size={12} aria-hidden="true"/></button>
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

        <div className="p-3 border-t border-line shrink-0">
          <button onClick={handleLogout} className={`${navItem} text-ink-subtle hover:text-neg hover:bg-neg/10`}><LogOut size={18} aria-hidden="true" /> <span>Sair</span></button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 min-w-0 p-4 md:p-8 overflow-y-auto md:h-screen min-h-[calc(100vh-3.5rem)] relative">

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="min-w-0">
            {/* O que a tabela está mostrando. Com MCC ou conta escolhida, cada etiqueta tem um ✕ e há um botão que volta a mostrar tudo. */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle mb-1.5">
              {!selectedMcc && !selectedAccount ? (
                <span>Todas as MCCs</span>
              ) : (
                <>
                  {selectedMcc && (
                    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-surface-2 border border-line">
                      MCC: <span className="font-medium text-ink">{selectedMcc}</span>
                      <button onClick={resetFilters} aria-label={`Tirar a MCC ${selectedMcc}`} title="Tirar esta MCC" className="p-0.5 rounded hover:text-neg"><X size={12} aria-hidden="true" /></button>
                    </span>
                  )}
                  {selectedAccount && (
                    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-surface-2 border border-line">
                      Conta: <span className="font-medium text-ink">{selectedAccount}</span>
                      <button onClick={clearAccount} aria-label={`Tirar a conta ${selectedAccount}`} title="Tirar esta conta e ficar na MCC" className="p-0.5 rounded hover:text-neg"><X size={12} aria-hidden="true" /></button>
                    </span>
                  )}
                  <button onClick={resetFilters} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-line font-medium text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
                    <X size={12} aria-hidden="true" /> Limpar e ver todas as MCCs
                  </button>
                </>
              )}
            </div>
            <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-ink break-words">{selectedAccount || selectedMcc || 'Campanhas'}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <button onClick={toggleTheme} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} className={`hidden md:flex ${iconBtn}`}>{isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</button>
            {canCreate && <Link href="/criar-campanha" className="flex-1 md:flex-none justify-center bg-brand hover:bg-brand-hover text-white h-9 px-4 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} aria-hidden="true" /> Criar campanha no Google</Link>}
          </div>
        </div>

        {/* BARRA DE FERRAMENTAS E FILTROS */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="rounded-xl border border-line bg-surface-1 p-1.5 flex flex-wrap gap-2 md:gap-3 items-center">
            <div className="flex items-center gap-2 flex-1 min-w-[180px] pl-2">
              <Search size={16} aria-hidden="true" className="text-ink-subtle shrink-0" />
              <input type="search" aria-label="Buscar campanha" placeholder="Buscar campanha…" className="bg-transparent flex-1 min-w-0 h-8 outline-none rounded text-sm text-ink placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-brand" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>

            {/* Situação das campanhas */}
            <div className="flex flex-wrap items-center gap-1 px-1 md:px-2 border-t md:border-t-0 md:border-l border-line w-full md:w-auto pt-2 md:pt-0">
              {([['ALL', 'Todas'], ['ativo', 'Ativas'], ['pausado', 'Pausadas'], ['suspenso', 'Suspensas'], ['sem_veicular', 'Sem veicular']] as const).map(([key, label]) => {
                const on = key === 'ALL' ? !statusFilter.length : statusFilter.includes(key);
                return (
                  <button key={key} onClick={() => changeStatusFilter(key)} aria-pressed={on}
                    className={`flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 ${segItem(on)}`}>
                    {key !== 'ALL' && <span className={`w-1.5 h-1.5 rounded-full ${DOT[key]}`} />}{label} <span className="tabular-nums text-ink-subtle">{key === 'ALL' ? filteredProducts.length : statusCount[key]}</span>
                  </button>
                );
              })}
            </div>

            {/* O que cada linha da tabela é */}
            <div className="flex items-center gap-1 px-1 md:px-2 border-t md:border-t-0 md:border-l border-line w-full md:w-auto pt-2 md:pt-0">
              {LEVELS.map(l => (
                <button key={l.key} onClick={() => changeLevel(l.key)} aria-pressed={level === l.key}
                  className={`flex-1 md:flex-none px-3 py-1.5 ${segItem(level === l.key)}`}>{l.label}</button>
              ))}
            </div>

            {/* Filtro de Data */}
            <div className="flex items-center gap-1.5 px-2 border-t md:border-t-0 md:border-l border-line w-full md:w-auto pt-2 md:pt-0 relative">
              <Calendar size={14} aria-hidden="true" className="text-ink-subtle" />
              <select
                aria-label="Período"
                className="bg-transparent outline-none rounded focus-visible:ring-2 focus-visible:ring-brand text-xs font-medium text-ink cursor-pointer appearance-none pr-5"
                value={dateFilter}
                onChange={(e) => handleDateFilterChange(e.target.value)}
              >
                <option value="today">Hoje</option>
                <option value="yesterday">Ontem</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="14d">Últimos 14 dias</option>
                <option value="this_month">Este mês</option>
                <option value="custom">Personalizado</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" className="text-ink-subtle absolute right-2 pointer-events-none" />
            </div>

            <button onClick={handleReload} className={`hidden md:flex ${rowAction}`} title="Recarregar" aria-label="Recarregar"><RefreshCw size={16} aria-hidden="true" className={loading ? 'animate-spin text-brand-text' : ''} /></button>
          </div>

          {showHidden && <div className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 flex items-center justify-center gap-2 text-warn text-xs font-medium"><AlertTriangle size={14} aria-hidden="true" /> Exibindo campanhas ocultas</div>}
        </div>

        <CampaignGroupsBar groups={groups} onChange={setGroups} campaignNames={campaignNames} isDark={isDark} tokens />

        {/* TABELA */}
        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-sm text-ink-subtle">Carregando campanhas…</div>
        ) : shownProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-sm text-ink-subtle border border-dashed border-line rounded-xl"><Layers size={28} aria-hidden="true" className="mb-2 opacity-60"/><p>Nenhuma campanha encontrada com os filtros atuais.</p>
            {hasFilters && (
              <button onClick={clearAllFilters} className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
                <X size={12} aria-hidden="true" /> Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <CampaignTable products={shownProducts} level={level} sort={sort} onSort={changeSort} rates={rates} isDark={isDark}
            selected={selectedProducts} onToggleSelect={toggleSelectProduct} onSelectAll={handleSelectAll}
            onOpen={product => router.push(`/products/${product.id}`)}
            hrefOf={product => `/products/${product.id}`}
            onPickAccount={(mcc, account) => { handleSelectAccount(mcc, account); changeLevel('campaigns'); }}
            onPickMcc={mcc => { handleSelectMcc(mcc); changeLevel('accounts'); }}
            actions={product => (
              <>
                <CampaignStatusToggle product={product} isDark={isDark} tokens onChanged={(patch) => setProducts(prev => prev.map(p => p.id === product.id ? { ...p, ...patch } : p))} />
                <button onClick={(e) => copyPostback(product.id, e)} className={copiedPostback === product.id ? 'p-1.5 rounded-md text-pos bg-pos/10' : rowAction} title="Copiar postback" aria-label={`Copiar o postback de ${product.name}`}>{copiedPostback === product.id ? <Check size={14} aria-hidden="true"/> : <Copy size={14} aria-hidden="true"/>}</button>
                <button onClick={(e) => toggleProductVisibility(product, e)} className={product.is_hidden ? 'p-1.5 rounded-md text-warn bg-warn/10' : rowAction} title={product.is_hidden ? 'Restaurar' : 'Ocultar'} aria-label={`${product.is_hidden ? 'Restaurar' : 'Ocultar'} ${product.name}`}>{product.is_hidden ? <Eye size={14} aria-hidden="true"/> : <EyeOff size={14} aria-hidden="true"/>}</button>
                <button onClick={(e) => handleDeleteProduct(product.id, e)} className="p-1.5 rounded-md text-ink-subtle hover:text-neg hover:bg-neg/10 transition-colors" title="Excluir" aria-label={`Excluir ${product.name}`}><Trash2 size={14} aria-hidden="true" /></button>
              </>
            )} />
        )}

        {/* BULK ACTION BAR */}
        {selectedProducts.length > 0 && (
          <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-line-strong bg-surface-1 text-ink px-2 py-2">
            <span className="px-3 text-sm"><span className="font-semibold tabular-nums">{selectedProducts.length}</span> <span className="text-ink-subtle">{selectedProducts.length === 1 ? 'selecionada' : 'selecionadas'}</span></span>
            <span className="w-px h-6 bg-line" />
            <button onClick={()=>handleBulkAction('hide')} disabled={bulkActionLoading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"><EyeOff size={14} aria-hidden="true"/> Ocultar</button>
            <button onClick={()=>handleBulkAction('delete')} disabled={bulkActionLoading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-ink-subtle hover:text-neg hover:bg-neg/10 transition-colors"><Trash2 size={14} aria-hidden="true"/> Excluir</button>
            <span className="w-px h-6 bg-line" />
            <button onClick={()=>setSelectedProducts([])} className={rowAction} title="Cancelar" aria-label="Cancelar a seleção"><X size={16} aria-hidden="true"/></button>
          </div>
        )}

        {/* Modal Data Personalizada */}
        {isCustomDateModalOpen && (
          <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onKeyDown={e => { if (e.key === 'Escape') closeCustomDateModal(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="custom-date-title" className="rounded-2xl w-full max-w-sm p-6 border border-line-strong bg-surface-1">
              <div className="flex justify-between items-center mb-5">
                <h2 id="custom-date-title" className="text-base font-semibold text-ink">Período personalizado</h2>
                <button onClick={closeCustomDateModal} aria-label="Fechar" className={iconBtn}><X size={16} aria-hidden="true" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="custom-date-start" className="block text-xs font-medium mb-1.5 text-ink-subtle">Data inicial</label>
                  <input id="custom-date-start" type="date" className={field} style={isDark ? {colorScheme: 'dark'} : {}} value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="custom-date-end" className="block text-xs font-medium mb-1.5 text-ink-subtle">Data final</label>
                  <input id="custom-date-end" type="date" className={field} style={isDark ? {colorScheme: 'dark'} : {}} value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} />
                </div>
                <button onClick={handleCustomDateApply} className="w-full bg-brand hover:bg-brand-hover py-2.5 rounded-lg text-white text-sm font-medium transition-colors">Aplicar</button>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden z-40 border-t border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex justify-around items-center px-2 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map(({ href, Icon, short }) => {
            const active = href === '/products';
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-lg transition-colors ${active ? 'text-brand-text' : 'text-ink-subtle'}`}>
                <Icon size={22} aria-hidden="true"/>
                <span className="text-[10px] font-medium">{short}</span>
              </Link>
            );
          })}
        </div>
      </nav>

    </div>
  );
}
