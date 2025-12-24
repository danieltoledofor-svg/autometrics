"use client";

import React, { useState, useEffect } from 'react';
import { 
  Copy, Check, Code, ArrowLeft, Zap, Calendar, 
  Globe, Store, Building, ChevronRight, AlertCircle 
} from 'lucide-react';
import Link from 'next/link';

export default function IntegrationPage() {
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  
  // Estados de Configuração
  const [accountType, setAccountType] = useState<'mcc' | 'single'>('mcc');
  const [identifierName, setIdentifierName] = useState(''); // Nome da MCC ou da Loja
  
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let storedId = localStorage.getItem('autometrics_user_id');
    if (!storedId) {
      storedId = crypto.randomUUID();
      localStorage.setItem('autometrics_user_id', storedId);
    }
    setUserId(storedId);
    
    // Data padrão: Início do ano atual
    const firstDay = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    setStartDate(firstDay);
  }, []);

  const handleGenerateScript = () => {
    if (!identifierName) return alert("Por favor, digite um nome para identificar esta conta/grupo.");

    // O campo MCC_NAME no script serve como "Identificador de Agrupamento"
    // Seja MCC ou Conta Única, usamos ele para criar a pasta na Sidebar.
    
    const scriptTemplate = `/**
 * Script AutoMetrics - Gerado Automaticamente
 * Tipo: ${accountType === 'mcc' ? 'Agência (MCC)' : 'Conta Única'}
 * Identificador: ${identifierName}
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  USER_ID: '${userId}', 
  START_DATE: "${startDate}",
  MCC_NAME: "${identifierName}" // Define o nome da pasta na plataforma
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics para: ' + CONFIG.MCC_NAME);
  
  // Detecção Automática de Ambiente
  if (typeof AdsManagerApp !== 'undefined') {
    // Ambiente MCC
    const accountIterator = AdsManagerApp.accounts().get();
    while (accountIterator.hasNext()) {
      const account = accountIterator.next();
      AdsManagerApp.select(account);
      processAccount(account);
    }
  } else {
    // Ambiente Conta Única
    processAccount(AdsApp.currentAccount());
  }
  
  Logger.log('✅ Finalizado com sucesso.');
}

function processAccount(account) {
  let currentDate = parseDate(CONFIG.START_DATE);
  const today = new Date(); 
  today.setHours(0,0,0,0);
  currentDate.setHours(0,0,0,0);

  // Evita loop infinito se data for futura
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
    
    // Busca URL Final (Tentativa segura)
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
}
`;
    setGeneratedScript(scriptTemplate);
  };

  const copyToClipboard = () => {
    if (!generatedScript) return;
    navigator.clipboard.writeText(generatedScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-4xl">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Code className="text-indigo-500" /> Nova Integração
            </h1>
            <p className="text-slate-500 text-sm">Configure o script para conectar suas contas do Google Ads.</p>
          </div>
        </div>

        {!generatedScript ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Coluna da Esquerda: Configuração */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Passo 1: Tipo de Conta */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span className="bg-indigo-600 w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span> 
                  Tipo de Conta Google
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button 
                    onClick={() => setAccountType('mcc')}
                    className={`p-4 rounded-xl border-2 text-left transition-all relative overflow-hidden group ${accountType === 'mcc' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <Globe className={accountType === 'mcc' ? 'text-indigo-400' : 'text-slate-500'} size={24} />
                      {accountType === 'mcc' && <Check size={16} className="text-indigo-500" />}
                    </div>
                    <p className="font-bold text-white">Agência / MCC</p>
                    <p className="text-xs text-slate-500 mt-1">Tenho várias sub-contas dentro de uma central.</p>
                  </button>

                  <button 
                    onClick={() => setAccountType('single')}
                    className={`p-4 rounded-xl border-2 text-left transition-all relative overflow-hidden group ${accountType === 'single' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <Store className={accountType === 'single' ? 'text-indigo-400' : 'text-slate-500'} size={24} />
                      {accountType === 'single' && <Check size={16} className="text-indigo-500" />}
                    </div>
                    <p className="font-bold text-white">Conta Única</p>
                    <p className="text-xs text-slate-500 mt-1">É apenas uma conta de anúncios isolada.</p>
                  </button>
                </div>
              </div>

              {/* Passo 2: Detalhes */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span className="bg-indigo-600 w-5 h-5 rounded-full flex items-center justify-center text-[10px]">2</span> 
                  Identificação
                </h3>

                <div className="space-y-4">
                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-2">
                        {accountType === 'mcc' ? 'Nome da Agência / MCC' : 'Nome da Loja / Empresa'}
                     </label>
                     <input 
                       type="text" 
                       placeholder={accountType === 'mcc' ? "Ex: Agência Rocket" : "Ex: Minha Loja Oficial"}
                       className="w-full bg-slate-950 border border-slate-700 text-white p-4 rounded-lg outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                       value={identifierName}
                       onChange={(e) => setIdentifierName(e.target.value)}
                     />
                     <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                        <AlertCircle size={10}/> Esse nome será usado para criar a pasta na sua dashboard.
                     </p>
                  </div>

                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-2">Data Inicial dos Dados</label>
                     <input 
                       type="date" 
                       className="w-full bg-slate-950 border border-slate-700 text-white p-4 rounded-lg outline-none [&::-webkit-calendar-picker-indicator]:invert"
                       value={startDate}
                       onChange={(e) => setStartDate(e.target.value)}
                     />
                  </div>
                </div>
              </div>

              <button 
                onClick={handleGenerateScript} 
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2"
              >
                <Code size={20} /> Gerar Script Personalizado
              </button>

            </div>

            {/* Coluna da Direita: Instruções */}
            <div className="space-y-6">
               <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                  <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Zap size={18} className="text-amber-400"/> Como Instalar</h3>
                  <ol className="space-y-4 text-sm text-slate-400 list-decimal pl-4">
                     <li>Abra sua conta do Google Ads.</li>
                     <li>
                        Vá em <strong>Ferramentas e Configurações</strong> {'>'} <strong>Ações em Massa</strong> {'>'} <strong>Scripts</strong>.
                     </li>
                     <li>Clique no botão <strong>+</strong> para criar um novo.</li>
                     <li>Apague qualquer código que estiver lá.</li>
                     <li>Cole o script que vamos gerar aqui.</li>
                     <li>Clique em <strong>Autorizar</strong> e depois em <strong>Executar</strong>.</li>
                  </ol>
               </div>
               
               <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
                  <p className="text-xs text-emerald-400 leading-relaxed">
                     <strong>Dica Pro:</strong> Configure a frequência do script para rodar <strong>"Diariamente"</strong> às 04:00 da manhã. Assim seus dados estarão sempre atualizados quando você acordar.
                  </p>
               </div>
            </div>

          </div>
        ) : (
          // TELA DE SCRIPT GERADO
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                 <button onClick={() => setGeneratedScript(null)} className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors text-white">
                    <ArrowLeft size={18} />
                 </button>
                 <div>
                    <h3 className="font-bold text-white text-sm">Seu Script está pronto!</h3>
                    <p className="text-xs text-emerald-400">Configurado para: {identifierName}</p>
                 </div>
              </div>
              <button onClick={copyToClipboard} className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold transition-all ${copied ? 'bg-emerald-500 text-white' : 'bg-white text-black hover:bg-slate-200'}`}>
                {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Copiado!' : 'Copiar Código'}
              </button>
            </div>
            
            <div className="p-0 overflow-x-auto bg-[#0d1117]">
              <pre className="font-mono text-xs text-slate-300 leading-relaxed p-6 min-h-[400px]">
                {generatedScript}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}