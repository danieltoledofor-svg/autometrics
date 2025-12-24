"use client";

import React, { useState, useEffect } from 'react';
import { 
  Copy, Check, Code, ArrowLeft, Zap, Calendar, 
  Globe, Store, AlertCircle, Sun, Moon 
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function IntegrationPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  const [accountType, setAccountType] = useState<'mcc' | 'single'>('mcc');
  const [identifierName, setIdentifierName] = useState('');
  
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Tema
    const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
    if (savedTheme) setTheme(savedTheme);

    async function getUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }
      setUserId(session.user.id);
    }
    getUser();
    
    const firstDay = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    setStartDate(firstDay);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('autometrics_theme', newTheme);
  };

  const handleGenerateScript = () => {
    if (!identifierName) return alert("Por favor, digite um nome para identificar esta conta/grupo.");

    const commonFunctions = `
function processAccount(account) {
  let currentDate = parseDate(CONFIG.START_DATE);
  const today = new Date(); 
  today.setHours(0,0,0,0);
  currentDate.setHours(0,0,0,0);

  if (currentDate > today) currentDate = today;

  while (currentDate <= today) {
    const dateString = Utilities.formatDate(currentDate, account.getTimeZone(), "yyyy-MM-dd");
    try {
      fetchAndSend(dateString, account);
    } catch (e) {
      Logger.log('Erro no dia ' + dateString + ': ' + e.message);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function fetchAndSend(dateString, account) {
  const query = \`
    SELECT
      campaign.id, campaign.name, campaign.status,
      metrics.impressions, metrics.clicks, metrics.ctr,
      metrics.average_cpc, metrics.cost_micros,
      metrics.search_impression_share, metrics.search_top_impression_share,
      metrics.search_absolute_top_impression_share,
      campaign.bidding_strategy_type, campaign_budget.amount_micros,
      customer.currency_code,
      campaign.target_cpa.target_cpa_micros,
      campaign.target_roas.target_roas,
      campaign.maximize_conversions.target_cpa_micros
    FROM campaign
    WHERE segments.date = '\${dateString}'
    AND metrics.impressions > 0 
  \`;

  const report = AdsApp.search(query);

  while (report.hasNext()) {
    const row = report.next();
    
    let finalUrl = '';
    try {
      const adQuery = "SELECT ad_group_ad.ad.final_urls FROM ad_group_ad WHERE campaign.id = " + row.campaign.id + " LIMIT 1";
      const adReport = AdsApp.search(adQuery);
      if(adReport.hasNext()) {
         const adRow = adReport.next();
         if(adRow.adGroupAd.ad.finalUrls) finalUrl = adRow.adGroupAd.ad.finalUrls[0];
      }
    } catch(e) {}

    let targetValue = 0;
    if (row.campaign.maximizeConversions && row.campaign.maximizeConversions.targetCpaMicros) {
        targetValue = row.campaign.maximizeConversions.targetCpaMicros / 1000000;
    } else if (row.campaign.targetCpa && row.campaign.targetCpa.targetCpaMicros) {
        targetValue = row.campaign.targetCpa.targetCpaMicros / 1000000;
    } else if (row.campaign.targetRoas && row.campaign.targetRoas.targetRoas) {
        targetValue = row.campaign.targetRoas.targetRoas;
    }

    const payload = {
      user_id: CONFIG.USER_ID,
      campaign_name: row.campaign.name,
      date: dateString,
      account_name: account.getName(),
      mcc_name: CONFIG.MCC_NAME, 
      currency_code: row.customer.currencyCode,
      metrics: {
        impressions: row.metrics.impressions,
        clicks: row.metrics.clicks,
        ctr: row.metrics.ctr,
        average_cpc: row.metrics.averageCpc,
        cost_micros: row.metrics.costMicros,
        search_impression_share: row.metrics.searchImpressionShare,
        search_top_impression_share: row.metrics.searchTopImpressionShare,
        search_abs_top_share: row.metrics.searchAbsoluteTopImpressionShare,
        bidding_strategy_type: row.campaign.biddingStrategyType,
        budget_micros: row.campaignBudget.amountMicros,
        status: row.campaign.status,
        final_url: finalUrl,
        target_value: targetValue
      }
    };
    sendToWebhook(payload);
  }
}

function sendToWebhook(payload) {
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  try { UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options); } catch (e) { Logger.log('❌ Erro Webhook: ' + e.message); }
}

function parseDate(str) {
  const parts = str.split('-');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}`;

    const scriptMcc = `/**
 * Script AutoMetrics - Versão Agência (MCC)
 * MCC: ${identifierName}
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  USER_ID: '${userId}', 
  START_DATE: "${startDate}",
  MCC_NAME: "${identifierName}" 
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics MCC para: ' + CONFIG.MCC_NAME);
  const accountIterator = AdsManagerApp.accounts().get();
  while (accountIterator.hasNext()) {
    const account = accountIterator.next();
    AdsManagerApp.select(account);
    processAccount(account);
  }
  Logger.log('✅ Finalizado com sucesso.');
}

${commonFunctions}`;

    const scriptSingle = `/**
 * Script AutoMetrics - Versão Conta Única
 * Loja: ${identifierName}
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  USER_ID: '${userId}', 
  START_DATE: "${startDate}",
  MCC_NAME: "${identifierName}" 
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics Single para: ' + CONFIG.MCC_NAME);
  const account = AdsApp.currentAccount();
  processAccount(account);
  Logger.log('✅ Finalizado com sucesso.');
}

${commonFunctions}`;

    setGeneratedScript(accountType === 'mcc' ? scriptMcc : scriptSingle);
  };

  const copyToClipboard = () => {
    if (!generatedScript) return;
    navigator.clipboard.writeText(generatedScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Estilos
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';

  return (
    <div className={`min-h-screen font-sans p-4 md:p-8 flex justify-center ${bgMain}`}>
      <div className="w-full max-w-4xl">
        
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className={`p-2 rounded-lg transition-colors ${isDark ? 'bg-slate-900 hover:bg-slate-800 text-slate-400' : 'bg-white border border-slate-200 text-slate-600'}`}>
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className={`text-2xl font-bold flex items-center gap-2 ${textHead}`}>
                <Code className="text-indigo-500" /> Nova Integração
              </h1>
              <p className={`text-sm ${textMuted}`}>Configure o script para conectar suas contas.</p>
            </div>
          </div>
          <button onClick={toggleTheme} className={`p-2.5 rounded-lg border transition-colors ${isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-500'}`}>
             {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {!generatedScript ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className={`${bgCard} rounded-xl p-6 border`}>
                <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${textHead}`}>
                  <span className="bg-indigo-600 w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white">1</span> 
                  Tipo de Conta Google
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button onClick={() => setAccountType('mcc')} className={`p-4 rounded-xl border-2 text-left transition-all group ${accountType === 'mcc' ? 'border-indigo-500 bg-indigo-500/10' : `${borderCol} hover:border-indigo-300`}`}>
                    <div className="flex justify-between items-start mb-2"><Globe className={accountType === 'mcc' ? 'text-indigo-400' : 'text-slate-400'} size={24} />{accountType === 'mcc' && <Check size={16} className="text-indigo-500" />}</div>
                    <p className={`font-bold ${textHead}`}>Agência / MCC</p><p className={`text-xs mt-1 ${textMuted}`}>Várias sub-contas.</p>
                  </button>
                  <button onClick={() => setAccountType('single')} className={`p-4 rounded-xl border-2 text-left transition-all group ${accountType === 'single' ? 'border-indigo-500 bg-indigo-500/10' : `${borderCol} hover:border-indigo-300`}`}>
                    <div className="flex justify-between items-start mb-2"><Store className={accountType === 'single' ? 'text-indigo-400' : 'text-slate-400'} size={24} />{accountType === 'single' && <Check size={16} className="text-indigo-500" />}</div>
                    <p className={`font-bold ${textHead}`}>Conta Única</p><p className={`text-xs mt-1 ${textMuted}`}>Conta isolada.</p>
                  </button>
                </div>
              </div>

              <div className={`${bgCard} rounded-xl p-6 border`}>
                <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${textHead}`}><span className="bg-indigo-600 w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white">2</span> Identificação</h3>
                <div className="space-y-4">
                  <div>
                     <label className={`block text-xs font-bold mb-2 ${textMuted}`}>{accountType === 'mcc' ? 'Nome da MCC' : 'Nome da Loja'}</label>
                     <input type="text" className={`w-full p-4 rounded-lg outline-none border transition-colors ${isDark ? 'bg-slate-950 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-300 text-black focus:border-indigo-500'}`} placeholder="Ex: Minha Loja" value={identifierName} onChange={(e) => setIdentifierName(e.target.value)} />
                  </div>
                  <div>
                     <label className={`block text-xs font-bold mb-2 ${textMuted}`}>Data Inicial</label>
                     <input type="date" className={`w-full p-4 rounded-lg outline-none border transition-colors ${isDark ? 'bg-slate-950 border-slate-700 text-white [&::-webkit-calendar-picker-indicator]:invert' : 'bg-slate-50 border-slate-300 text-black'}`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                </div>
              </div>
              <button onClick={handleGenerateScript} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2"><Code size={20} /> Gerar Script</button>
            </div>
            
            {/* INSTRUÇÕES DETALHADAS */}
            <div className="space-y-6">
               <div className={`${bgCard} rounded-xl p-6 border`}>
                  <h3 className={`font-bold mb-4 flex items-center gap-2 ${textHead}`}><Zap size={18} className="text-amber-400"/> Instalação</h3>
                  <ol className={`space-y-4 text-sm list-decimal pl-4 ${textMuted}`}>
                     <li>Abra sua conta do Google Ads.</li>
                     <li>Vá em <strong>Ferramentas e Configurações</strong> {'>'} <strong>Ações em Massa</strong> {'>'} <strong>Scripts</strong>.</li>
                     <li>Clique no botão <strong>+</strong> para criar um novo.</li>
                     <li>Apague qualquer código que estiver lá.</li>
                     <li>Cole o script gerado.</li>
                     <li>Clique em <strong>Autorizar</strong> e depois em <strong>Salvar</strong>.</li>
                  </ol>
               </div>
               
               <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
                  <p className="text-xs text-emerald-400 leading-relaxed mb-2">
                     <strong>Dica Importante:</strong>
                  </p>
                  <p className="text-xs text-emerald-500/80 leading-relaxed">
                     Na lista de scripts, altere a coluna <strong>Frequência</strong> de "Diariamente" para <strong>"A cada hora"</strong> (Hourly). 
                     Isso garante que seus dados estejam sempre atualizados.
                  </p>
               </div>
            </div>
          </div>
        ) : (
          <div className={`${bgCard} rounded-xl overflow-hidden shadow-2xl border animate-in zoom-in-95 duration-300`}>
            <div className={`px-6 py-4 border-b flex justify-between items-center gap-4 ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center gap-4">
                 <button onClick={() => setGeneratedScript(null)} className={`p-2 rounded-lg transition-colors ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}><ArrowLeft size={18} /></button>
                 <div><h3 className={`font-bold text-sm ${textHead}`}>Script Pronto</h3><p className="text-xs text-emerald-500">{identifierName}</p></div>
              </div>
              <button onClick={copyToClipboard} className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold transition-all ${copied ? 'bg-emerald-500 text-white' : (isDark ? 'bg-white text-black' : 'bg-slate-900 text-white')}`}>{copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Copiado!' : 'Copiar'}</button>
            </div>
            <div className="p-0 overflow-x-auto bg-[#0d1117]"><pre className="font-mono text-xs text-slate-300 leading-relaxed p-6 min-h-[400px]">{generatedScript}</pre></div>
          </div>
        )}
      </div>
    </div>
  );
}