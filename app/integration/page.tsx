"use client";

import React, { useState, useEffect } from 'react';
import { Copy, Check, Code, ArrowLeft, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

export default function IntegrationPage() {
  const [userId, setUserId] = useState('');
  const [copied, setCopied] = useState(false);

  // 1. Gera ou recupera o ID Único do Usuário
  useEffect(() => {
    // Tenta pegar do armazenamento local
    let storedId = localStorage.getItem('autometrics_user_id');
    
    if (!storedId) {
      // Se não existir, gera um novo UUID aleatório
      storedId = crypto.randomUUID();
      localStorage.setItem('autometrics_user_id', storedId);
    }
    
    setUserId(storedId);
  }, []);

  // 2. O Template do Script com o ID INJETADO
  const scriptCode = `/**
 * Script AutoMetrics - SEU TOKEN EXCLUSIVO
 * Copie e cole este código INTEIRO no Google Ads (Scripts)
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  
  // SEU ID DE SEGURANÇA (NÃO ALTERE)
  USER_ID: '${userId}', 

  HISTORICAL_MODE: false, // Mude para true se quiser pegar dados antigos
  START_DATE: "2025-12-01",
  END_DATE: "2025-12-30"
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics para o usuário: ' + CONFIG.USER_ID);

  if (typeof AdsManagerApp !== 'undefined') {
    // Modo MCC
    const accountIterator = AdsManagerApp.accounts().get();
    while (accountIterator.hasNext()) {
      const account = accountIterator.next();
      AdsManagerApp.select(account);
      processAccount(account);
    }
  } else {
    // Modo Conta Única
    processAccount(AdsApp.currentAccount());
  }
}

function processAccount(account) {
  const dateString = getLastDate();
  
  // Query Otimizada
  const report = AdsApp.search(\`
    SELECT
      campaign.id, campaign.name,
      metrics.impressions, metrics.clicks, metrics.ctr,
      metrics.average_cpc, metrics.cost_micros,
      metrics.search_impression_share, metrics.search_top_impression_share,
      metrics.search_absolute_top_impression_share,
      campaign.bidding_strategy_type, campaign_budget.amount_micros,
      customer.currency_code
    FROM campaign
    WHERE segments.date = '\${dateString}'
    AND metrics.cost_micros > 0
  \`);

  while (report.hasNext()) {
    const row = report.next();
    const payload = {
      user_id: CONFIG.USER_ID,
      campaign_name: row.campaign.name,
      date: dateString,
      account_name: account.getName(),
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
        budget_micros: row.campaignBudget.amountMicros
      }
    };
    sendToWebhook(payload);
  }
}

function sendToWebhook(payload) {
  const options = {
    'method': 'post', 'contentType': 'application/json',
    'payload': JSON.stringify(payload), 'muteHttpExceptions': true
  };
  try {
    UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options);
    Logger.log('📤 Enviado: ' + payload.campaign_name);
  } catch (e) {
    Logger.log('❌ Erro: ' + e.message);
  }
}

function getLastDate() {
  if (CONFIG.HISTORICAL_MODE) return CONFIG.START_DATE; // Simplificado para exemplo
  const d = new Date(); d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");
}
`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-8 flex justify-center">
      <div className="w-full max-w-4xl">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Code className="text-indigo-500" /> Integração Google Ads
            </h1>
            <p className="text-slate-500 text-sm">Gere seu script exclusivo para conectar todas as suas contas.</p>
          </div>
        </div>

        {/* Warning Box */}
        <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl mb-6 flex gap-3 items-start">
          <ShieldAlert className="text-indigo-400 shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-indigo-300 font-bold text-sm">Token de Segurança Gerado</h3>
            <p className="text-xs text-indigo-200/70 mt-1">
              Este script contém seu ID único: <span className="font-mono bg-indigo-500/20 px-1 rounded">{userId}</span>. 
              Ele garante que os dados das suas campanhas cheguem apenas no seu painel.
            </p>
          </div>
        </div>

        {/* Code Area */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
            <span className="text-xs font-mono text-slate-400">google-ads-script.js</span>
            <button 
              onClick={copyToClipboard}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${
                copied ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copiado!' : 'Copiar Script'}
            </button>
          </div>
          <div className="p-4 overflow-x-auto">
            <pre className="font-mono text-xs text-slate-300 leading-relaxed">
              {scriptCode}
            </pre>
          </div>
        </div>

      </div>
    </div>
  );
}