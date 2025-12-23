"use client";

import React, { useState, useEffect } from 'react';
import { Copy, Check, Code, ArrowLeft, ShieldAlert, Calendar, Clock, Settings, Zap } from 'lucide-react';
import Link from 'next/link';

export default function IntegrationPage() {
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let storedId = localStorage.getItem('autometrics_user_id');
    if (!storedId) {
      storedId = crypto.randomUUID();
      localStorage.setItem('autometrics_user_id', storedId);
    }
    setUserId(storedId);
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    setStartDate(firstDay);
  }, []);

  const handleGenerateScript = () => {
    const scriptTemplate = `/**
 * Script AutoMetrics - UNIVERSAL (V2 - COMPLETO)
 * Traz: Conta, CPA Meta, URL Final e Métricas.
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  USER_ID: '${userId}', 
  START_DATE: "${startDate}" // Data Início
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics V2...');
  
  if (typeof AdsManagerApp !== 'undefined') {
    const accountIterator = AdsManagerApp.accounts().get();
    while (accountIterator.hasNext()) {
      const account = accountIterator.next();
      AdsManagerApp.select(account);
      processAccount(account);
    }
  } else {
    processAccount(AdsApp.currentAccount());
  }
  Logger.log('✅ Finalizado.');
}

function processAccount(account) {
  let currentDate = parseDate(CONFIG.START_DATE);
  const today = new Date(); 
  today.setHours(0,0,0,0);
  currentDate.setHours(0,0,0,0);

  while (currentDate <= today) {
    const dateString = Utilities.formatDate(currentDate, account.getTimeZone(), "yyyy-MM-dd");
    fetchAndSend(dateString, account);
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function fetchAndSend(dateString, account) {
  // Query Principal
  const query = \`
    SELECT
      campaign.id, campaign.name,
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
    
    // 1. Busca URL Final (Sub-query simples)
    let finalUrl = '';
    const adQuery = "SELECT ad_group_ad.ad.final_urls FROM ad_group_ad WHERE campaign.id = " + row.campaign.id + " LIMIT 1";
    const adReport = AdsApp.search(adQuery);
    if(adReport.hasNext()) {
       const adRow = adReport.next();
       if(adRow.adGroupAd.ad.finalUrls) finalUrl = adRow.adGroupAd.ad.finalUrls[0];
    }

    // 2. Calcula Meta (CPA ou ROAS)
    let targetValue = 0;
    if (row.campaign.targetCpa && row.campaign.targetCpa.targetCpaMicros) {
        targetValue = row.campaign.targetCpa.targetCpaMicros / 1000000;
    } else if (row.campaign.maximizeConversions && row.campaign.maximizeConversions.targetCpaMicros) {
        targetValue = row.campaign.maximizeConversions.targetCpaMicros / 1000000;
    } else if (row.campaign.targetRoas && row.campaign.targetRoas.targetRoas) {
        targetValue = row.campaign.targetRoas.targetRoas;
    }

    const payload = {
      user_id: CONFIG.USER_ID,
      campaign_name: row.campaign.name,
      date: dateString,
      account_name: account.getName(), // Nome da Conta
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
        
        final_url: finalUrl, // URL
        target_value: targetValue // Meta
      }
    };
    sendToWebhook(payload);
  }
}

function sendToWebhook(payload) {
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  try {
    UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options);
  } catch (e) { Logger.log('❌ Erro: ' + e.message); }
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
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Code className="text-indigo-500" /> Integração Universal V2
            </h1>
            <p className="text-slate-500 text-sm">Gere um único script inteligente para Histórico e Tempo Real.</p>
          </div>
        </div>

        {!generatedScript ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="max-w-lg mx-auto space-y-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-indigo-500/20">
                  <Zap className="text-white" size={32} fill="currentColor" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Script Híbrido Automático</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Busca todas as métricas, incluindo <strong>CPA Meta</strong>, <strong>URL Final</strong> e <strong>Nome da Conta</strong>.
                </p>
              </div>

              <div className="bg-slate-950 p-6 rounded-xl border border-slate-800">
                <label className="block text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3">
                  A partir de quando quer os dados?
                </label>
                <div className="relative">
                  <input 
                    type="date" 
                    className="w-full bg-slate-900 border border-slate-700 text-white p-4 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all [&::-webkit-calendar-picker-indicator]:invert font-mono text-lg"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={20} />
                </div>
              </div>

              <button 
                onClick={handleGenerateScript}
                className="w-full bg-white hover:bg-slate-200 text-black px-8 py-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 transform active:scale-95"
              >
                <Code size={20} />
                Gerar Script Definitivo
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <button onClick={() => setGeneratedScript(null)} className="text-slate-500 hover:text-white text-xs font-medium flex items-center gap-1">
                  <ArrowLeft size={14} /> Configurar
                </button>
                <span className="text-xs font-mono text-emerald-400">
                  autometrics-universal-v2.js
                </span>
              </div>
              
              <button 
                onClick={copyToClipboard}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  copied ? 'bg-emerald-500 text-white' : 'bg-white text-black hover:bg-slate-200'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copiado!' : 'Copiar Script'}
              </button>
            </div>
            
            <div className="p-0 overflow-x-auto">
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