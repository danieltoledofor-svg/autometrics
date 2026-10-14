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

  if (!authChecked) return <div className="min-h-screen bg-black" />;

  return (
    <div className={`min-h-[100dvh] font-sans flex flex-col md:flex-row ${bgMain}`}>
      
      {/* MOBILE HEADER */}
      <div className={`md:hidden flex items-center justify-between p-4 border-b shrink-0 z-30 sticky top-0 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3">
           <Logo />
        </div>
        <button onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} aria-label={isMobileSidebarOpen ? 'Fechar o menu' : 'Abrir o menu'} aria-expanded={isMobileSidebarOpen} className={`p-2 transition-colors ${textMuted} hover:text-indigo-500`}>
           {isMobileSidebarOpen ? <X size={24} aria-hidden="true"/> : <List size={24} aria-hidden="true"/>}
        </button>
      </div>

      {/* SIDEBAR */}
      <aside className={`${isMobileSidebarOpen ? 'flex' : 'hidden'} md:flex fixed md:sticky inset-0 md:inset-auto top-[73px] md:top-0 w-full md:w-72 shrink-0 border-r flex-col h-[calc(100dvh-73px)] md:h-screen z-20 ${isDark ? 'bg-slate-950 border-slate-900' : 'bg-white border-slate-200'}`}>
        
        <div className="hidden md:flex h-20 items-center justify-center md:justify-start md:px-6 border-b border-inherit overflow-hidden shrink-0">
           <Logo />
        </div>
        
        {/* Scrollable Area for Sidebar Items */}
        <div className="flex-1 overflow-y-auto flex flex-col custom-scrollbar">
          <nav className="px-2 py-4 space-y-2 shrink-0">
             <Link href="/dashboard" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><LayoutGrid size={20} aria-hidden="true" /> <span className="font-medium">Dashboard</span></Link>
             <Link href="/planning" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Target size={20} aria-hidden="true" /> <span className="font-medium">Metas</span></Link>
             <Link href="/products" className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20"><Briefcase size={20} aria-hidden="true" /> <span className="font-medium">Campanhas</span></Link>
             <Link href="/analise-ia" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Sparkles size={20} aria-hidden="true" /> <span className="font-medium">Análise de IA</span></Link>
             <Link href="/rastreamento" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Route size={20} aria-hidden="true" /> <span className="font-medium">Rastreamento</span></Link>
             <Link href="/integration" className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isDark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-black'}`}><Settings size={20} aria-hidden="true" /> <span className="font-medium">Integração</span></Link>
          </nav>
          
          <div className="px-4 pb-2 mt-2 shrink-0">
            <div className={`p-3 rounded-lg border mb-2 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Estrutura de Contas</p>
              <div className="flex justify-between items-center">
                <button onClick={() => setShowHidden(!showHidden)} className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded border transition-colors ${showHidden ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : `text-slate-500 border-transparent ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}`}>
                  {showHidden ? <Eye size={10} aria-hidden="true" /> : <EyeOff size={10} aria-hidden="true" />}
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
                      <button onClick={() => toggleMccExpand(mcc.name)} aria-label={`${isExpanded ? 'Recolher' : 'Mostrar'} as contas de ${mcc.name}`} aria-expanded={isExpanded} className={`p-2 transition-colors ${textMuted} hover:text-indigo-500`}>{isExpanded ? <ChevronDown size={14} aria-hidden="true"/> : <ChevronRight size={14} aria-hidden="true"/>}</button>
                      <button onClick={() => handleSelectMcc(mcc.name)} className={`w-full flex-1 min-w-0 text-left py-2 px-3 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${isMccActive ? 'bg-indigo-600 text-white shadow' : `${textMuted} ${hoverItem}`}`}>
                         <Globe size={14} aria-hidden="true" className={`shrink-0 ${isMccActive ? 'text-white' : 'text-slate-500'}`}/>
                         <span className="break-all min-w-0">{mcc.name}</span>
                      </button>
                      <button onClick={(e) => handleDeleteMcc(mcc.name, e)} aria-label={`Excluir a MCC ${mcc.name}`} className="p-1.5 text-slate-500 hover:text-rose-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"><Trash2 size={12} aria-hidden="true"/></button>
                   </div>
                   {isExpanded && (
                     <div className={`ml-4 pl-3 border-l mt-1 space-y-1 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                        {mcc.accounts.map(acc => {
                          const isAccActive = selectedAccount === acc && selectedMcc === mcc.name;
                          const accProds = products.filter(p => (p.mcc_name || 'Outras') === mcc.name && (p.account_name || 'Sem Conta') === acc);
                          const isHidden = accProds.length > 0 && accProds.every(p => p.is_hidden);

                          return (
                            <div key={acc} className="flex items-center group/acc pr-2">
                              <button onClick={() => handleSelectAccount(mcc.name, acc)} className={`w-full flex-1 min-w-0 text-left px-3 py-2 rounded-lg flex items-center gap-2 text-xs transition-all ${isAccActive ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : `${textMuted} ${hoverItem}`}`}>
                                  <Briefcase size={12} aria-hidden="true" className="shrink-0"/> <span className={`break-all min-w-0 ${isHidden ? 'opacity-50 line-through' : ''}`}>{acc}</span>
                              </button>
                              <button onClick={(e) => toggleAccountFromSidebar(mcc.name, acc, e)} className={`p-1.5 opacity-100 md:opacity-0 md:group-hover/acc:opacity-100 focus-visible:opacity-100 transition-opacity ml-1 ${isHidden ? 'text-amber-500 hover:text-amber-400' : `text-slate-500 ${isDark ? 'hover:text-slate-200' : 'hover:text-slate-800'}`}`} title={isHidden ? "Restaurar Conta" : "Ocultar Conta"} aria-label={`${isHidden ? 'Restaurar' : 'Ocultar'} a conta ${acc}`}>
                                 {isHidden ? <Eye size={12} aria-hidden="true"/> : <EyeOff size={12} aria-hidden="true"/>}
                              </button>
                              <button onClick={(e) => handleDeleteAccount(mcc.name, acc, e)} className="p-1.5 text-slate-500 hover:text-rose-500 opacity-100 md:opacity-0 md:group-hover/acc:opacity-100 focus-visible:opacity-100 transition-opacity ml-0.5" title="Excluir" aria-label={`Excluir a conta ${acc}`}><Trash2 size={12} aria-hidden="true"/></button>
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
           <button onClick={handleLogout} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-rose-500 hover:bg-rose-500/10`}><LogOut size={20} aria-hidden="true" /> <span className="font-medium">Sair</span></button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto md:h-screen min-h-[calc(100vh-73px)] relative">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            {/* O que a tabela está mostrando. Com MCC ou conta escolhida, cada etiqueta tem um ✕ e há um botão que volta a mostrar tudo. */}
            <div className={`flex flex-wrap items-center gap-2 text-xs ${textMuted} mb-1`}>
              {!selectedMcc && !selectedAccount ? (
                <span className={`px-2 py-0.5 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>Todas as MCCs</span>
              ) : (
                <>
                  {selectedMcc && (
                    <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>
                      MCC: <b className={textHead}>{selectedMcc}</b>
                      <button onClick={resetFilters} aria-label={`Tirar a MCC ${selectedMcc}`} title="Tirar esta MCC" className="p-0.5 rounded hover:text-rose-500"><X size={12} aria-hidden="true" /></button>
                    </span>
                  )}
                  {selectedAccount && (
                    <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded ${isDark ? 'bg-slate-900' : 'bg-slate-200'}`}>
                      Conta: <b className="text-indigo-500">{selectedAccount}</b>
                      <button onClick={clearAccount} aria-label={`Tirar a conta ${selectedAccount}`} title="Tirar esta conta e ficar na MCC" className="p-0.5 rounded hover:text-rose-500"><X size={12} aria-hidden="true" /></button>
                    </span>
                  )}
                  <button onClick={resetFilters} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-bold transition-colors ${isDark ? 'border-slate-700 text-slate-200 hover:border-indigo-500 hover:text-indigo-300' : 'border-slate-300 text-slate-700 hover:border-indigo-500 hover:text-indigo-700'}`}>
                    <X size={12} aria-hidden="true" /> Limpar e ver todas as MCCs
                  </button>
                </>
              )}
            </div>
            <h1 className={`text-2xl font-bold flex flex-wrap items-center gap-2 ${textHead}`}>{selectedAccount || selectedMcc || 'Gerenciador de Campanhas'}</h1>
          </div>
          
          <div className="flex flex-wrap gap-3">
             <button onClick={toggleTheme} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} className={`hidden md:block p-2.5 rounded-lg border transition-colors ${isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-500'}`}>{isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
             {canCreate && <Link href="/criar-campanha" className="flex-1 md:flex-none justify-center bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg"><Plus size={18} aria-hidden="true" /> Criar campanha no Google</Link>}
          </div>
        </div>

        {/* BARRA DE FERRAMENTAS E FILTROS */}
        <div className="flex flex-col gap-4 mb-6">
           <div className={`p-1.5 rounded-xl flex flex-wrap gap-2 md:gap-4 items-center border ${bgCard}`}>
             <div className="pl-3 text-slate-500"><Search size={18} aria-hidden="true" /></div>
             <input type="search" aria-label="Buscar campanha" placeholder="Buscar campanha…" className={`bg-transparent flex-1 outline-none rounded focus-visible:ring-2 focus-visible:ring-indigo-500 min-w-[120px] px-2 md:px-0 placeholder:text-slate-600 ${textHead}`} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             
             {/* Situação das campanhas */}
             <div className={`flex flex-wrap items-center gap-1 px-2 border-t md:border-t-0 md:border-l w-full md:w-auto pt-2 md:pt-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                {([['ALL', 'Todas'], ['ativo', 'Ativas'], ['pausado', 'Pausadas'], ['suspenso', 'Suspensas'], ['sem_veicular', 'Sem veicular']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => changeStatusFilter(key)} aria-pressed={key === 'ALL' ? !statusFilter.length : statusFilter.includes(key)}
                    className={`flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${(key === 'ALL' ? !statusFilter.length : statusFilter.includes(key)) ? (isDark ? 'bg-slate-800 text-white' : 'bg-slate-200 text-black') : `text-slate-500 ${isDark ? 'hover:text-slate-200' : 'hover:text-slate-800'}`}`}>
                    {key !== 'ALL' && <span className={`w-2 h-2 rounded-full ${DOT[key]}`} />}{label} <span className="font-normal tabular-nums opacity-70">{key === 'ALL' ? filteredProducts.length : statusCount[key]}</span>
                  </button>
                ))}
             </div>

             {/* O que cada linha da tabela é */}
             <div className={`flex items-center gap-1 px-2 border-t md:border-t-0 md:border-l w-full md:w-auto pt-2 md:pt-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                {LEVELS.map(l => (
                  <button key={l.key} onClick={() => changeLevel(l.key)} aria-pressed={level === l.key}
                    className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${level === l.key ? (isDark ? 'bg-slate-800 text-white' : 'bg-slate-200 text-black') : `text-slate-500 ${isDark ? 'hover:text-slate-200' : 'hover:text-slate-800'}`}`}>{l.label}</button>
                ))}
             </div>

             {/* Filtro de Data */}
             <div className={`flex items-center gap-1 px-2 border-t md:border-t-0 md:border-l w-full md:w-auto pt-2 md:pt-0 ${isDark ? 'border-slate-800' : 'border-slate-200'} relative`}>
               <Calendar size={16} aria-hidden="true" className="text-slate-500 mr-1" />
               <select 
                 aria-label="Período"
                 className={`bg-transparent outline-none rounded focus-visible:ring-2 focus-visible:ring-indigo-500 text-xs font-bold ${isDark ? 'text-white [&>option]:bg-slate-900' : 'text-black [&>option]:bg-white'} cursor-pointer appearance-none pr-4`}
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
               <ChevronDown size={14} aria-hidden="true" className="text-slate-500 absolute right-2 pointer-events-none" />
             </div>

             <button onClick={handleReload} className={`p-2 rounded-lg transition-colors hidden md:block mr-1 ${hoverItem}`} title="Recarregar" aria-label="Recarregar"><RefreshCw size={18} aria-hidden="true" className={loading ? "animate-spin text-indigo-500" : "text-slate-400"} /></button>
           </div>
           
           {showHidden && <div className="bg-amber-500/10 border border-amber-500/20 p-2 md:px-4 rounded-xl flex items-center justify-center gap-2 text-amber-500 text-xs font-bold"><AlertTriangle size={16} aria-hidden="true" /> Exibindo Ocultos</div>}
        </div>

        <CampaignGroupsBar groups={groups} onChange={setGroups} campaignNames={campaignNames} isDark={isDark} />

        {/* TABELA */}
        {loading && products.length === 0 ? (
          <div className="flex justify-center items-center h-64 text-slate-500">Carregando campanhas…</div>
        ) : shownProducts.length === 0 ? (
           <div className={`flex flex-col items-center justify-center h-64 text-slate-500 border border-dashed rounded-xl ${isDark ? 'border-slate-800' : 'border-slate-300'}`}><Layers size={32} aria-hidden="true" className="mb-2 opacity-50"/><p>Nenhuma campanha encontrada com os filtros atuais.</p>
             {hasFilters && (
               <button onClick={clearAllFilters} className={`mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${isDark ? 'border-slate-700 text-slate-200 hover:border-indigo-500 hover:text-indigo-300' : 'border-slate-300 text-slate-700 hover:border-indigo-500 hover:text-indigo-700'}`}>
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
                <CampaignStatusToggle product={product} isDark={isDark} onChanged={(patch) => setProducts(prev => prev.map(p => p.id === product.id ? { ...p, ...patch } : p))} />
                <button onClick={(e) => copyPostback(product.id, e)} className={`p-1.5 rounded-lg transition-colors ${copiedPostback === product.id ? 'text-emerald-500 bg-emerald-500/10' : (isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-200')}`} title="Copiar Postback" aria-label={`Copiar o postback de ${product.name}`}>{copiedPostback === product.id ? <Check size={14} aria-hidden="true"/> : <Copy size={14} aria-hidden="true"/>}</button>
                <button onClick={(e) => toggleProductVisibility(product, e)} className={`p-1.5 rounded-lg transition-colors ${product.is_hidden ? 'text-amber-500 bg-amber-500/10' : (isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-200')}`} title={product.is_hidden ? 'Restaurar' : 'Ocultar'} aria-label={`${product.is_hidden ? 'Restaurar' : 'Ocultar'} ${product.name}`}>{product.is_hidden ? <Eye size={14} aria-hidden="true"/> : <EyeOff size={14} aria-hidden="true"/>}</button>
                <button onClick={(e) => handleDeleteProduct(product.id, e)} className={`p-1.5 rounded-lg transition-colors hover:text-rose-500 ${isDark ? 'text-slate-400 hover:bg-rose-500/20' : 'text-slate-500 hover:bg-rose-100'}`} title="Excluir" aria-label={`Excluir ${product.name}`}><Trash2 size={14} aria-hidden="true" /></button>
              </>
            )} />
        )}

        {/* BULK ACTION BAR */}
        {selectedProducts.length > 0 && (
          <div className={`fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 border px-6 flex items-center gap-6 z-50 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300 ${isDark ? 'bg-slate-900 border-slate-700 text-white shadow-indigo-500/10' : 'bg-white border-slate-300 text-slate-900 shadow-slate-300'}`}>
            <div className="flex items-center gap-3 py-4">
               <div className="bg-indigo-600 text-white w-8 h-8 rounded-full flex justify-center items-center font-bold text-sm shadow-inner">{selectedProducts.length}</div>
               <span className="font-medium text-sm">Selecionados</span>
            </div>
            
            <div className={`w-px h-8 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}></div>

            <div className="flex items-center gap-2 py-4">
               <button onClick={()=>handleBulkAction('hide')} disabled={bulkActionLoading} className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}><EyeOff size={14} aria-hidden="true"/> Ocultar</button>
               <button onClick={()=>handleBulkAction('delete')} disabled={bulkActionLoading} className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors ${isDark ? 'hover:bg-rose-500/20 hover:text-rose-400' : 'hover:bg-rose-100 hover:text-rose-600'}`}><Trash2 size={14} aria-hidden="true"/> Excluir</button>
            </div>
            
            <div className={`w-px h-8 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            
            <button onClick={()=>setSelectedProducts([])} className={`p-4 transition-colors border-l ${isDark ? 'text-slate-400 hover:text-white border-slate-800' : 'text-slate-500 hover:text-black border-slate-200'}`} title="Cancelar" aria-label="Cancelar a seleção"><X size={18} aria-hidden="true"/></button>
          </div>
        )}

        {/* Modal Data Personalizada */}
        {isCustomDateModalOpen && (
          <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onKeyDown={e => { if (e.key === 'Escape') closeCustomDateModal(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="custom-date-title" className={`rounded-xl w-full max-w-sm p-6 shadow-2xl border ${bgCard}`}>
              <div className="flex justify-between items-center mb-6">
                <h2 id="custom-date-title" className={`text-xl font-bold ${textHead}`}>Data Personalizada</h2>
                <button onClick={closeCustomDateModal} aria-label="Fechar"><X size={24} aria-hidden="true" className="text-slate-400 hover:text-indigo-500" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="custom-date-start" className="block text-sm font-medium mb-1 text-slate-500">Data Inicial</label>
                  <input id="custom-date-start" type="date" className={`w-full border rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isDark ? 'bg-slate-900 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-black'}`} style={isDark ? {colorScheme: 'dark'} : {}} value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="custom-date-end" className="block text-sm font-medium mb-1 text-slate-500">Data Final</label>
                  <input id="custom-date-end" type="date" className={`w-full border rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isDark ? 'bg-slate-900 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-black'}`} style={isDark ? {colorScheme: 'dark'} : {}} value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} />
                </div>
                <button onClick={handleCustomDateApply} className="w-full bg-indigo-600 py-3 rounded-lg text-white font-bold hover:bg-indigo-700">Aplicar</button>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* BOTTOM NAV */}
      <nav className={`fixed bottom-0 inset-x-0 md:hidden z-40 border-t backdrop-blur-md ${isDark ? 'bg-slate-950/95 border-slate-900' : 'bg-white/95 border-slate-200'}`}>
        <div className="flex justify-around items-center px-2 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {[
            { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', active: false },
            { href: '/planning', Icon: Target, label: 'Metas', active: false },
            { href: '/products', Icon: Package, label: 'Campanhas', active: true },
            { href: '/analise-ia', Icon: Sparkles, label: 'Análise IA', active: false },
            { href: '/rastreamento', Icon: Route, label: 'Rastreio', active: false },
            { href: '/integration', Icon: Settings, label: 'Integração', active: false },
          ].map(({ href, Icon, label, active }) => (
            <Link key={href} href={href} className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-xl transition-colors ${active ? 'text-indigo-500' : isDark ? 'text-slate-600' : 'text-slate-400'}`}>
              <Icon size={22} aria-hidden="true"/>
              <span className="text-[9px] font-bold tracking-wide">{label}</span>
              {active && <div className="w-1 h-1 rounded-full bg-indigo-500"/>}
            </Link>
          ))}
        </div>
      </nav>

    </div>
  );
}