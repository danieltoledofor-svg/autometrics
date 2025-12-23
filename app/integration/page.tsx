"use client";

import React, { useState, useEffect } from 'react';
import { Copy, Check, Code, ArrowLeft, ShieldAlert, Calendar, Clock } from 'lucide-react';
import Link from 'next/link';

export default function IntegrationPage() {
  const [userId, setUserId] = useState('');
  const [activeTab, setActiveTab] = useState<'historical' | 'daily'>('daily');
  const [copied, setCopied] = useState(false);

  // 1. Gera ou recupera o ID Único do Usuário do LocalStorage
  useEffect(() => {
    let storedId = localStorage.getItem('autometrics_user_id');
    if (!storedId) {
      storedId = crypto.randomUUID();
      localStorage.setItem('autometrics_user_id', storedId);
    }
    setUserId(storedId);
  }, []);

  // --- MODELO 1: SCRIPT DIÁRIO (O mais usado) ---
  const dailyScript = `/**
 * Script AutoMetrics - AUTOMAÇÃO DIÁRIA
 * Este script pega automaticamente os dados de ONTEM.
 * Configure para rodar Diariamente (ex: às 04:00 AM).
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  
  // SEU TOKEN EXCLUSIVO (NÃO ALTERE)
  USER_ID: '${userId}', 

  // Configuração Automática (Dia Anterior)
  HISTORICAL_MODE: false 
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics Diário para: ' + CONFIG.USER_ID);
  
  if (typeof AdsManagerApp !== 'undefined') { // MCC
    const accountIterator = AdsManagerApp.accounts().get();
    while (accountIterator.hasNext()) {
      const account = accountIterator.next();
      AdsManagerApp.select(account);
      processAccount(account);
    }
  } else { // Conta Única
    processAccount(AdsApp.currentAccount());
  }
}

function processAccount(account) {
  // Pega automaticamente a data de ontem
  const d = new Date(); d.setDate(d.getDate() - 1);
  const dateString = Utilities.formatDate(d, account.getTimeZone(), "yyyy-MM-dd");
  
  fetchAndSend(dateString, account);
}

function fetchAndSend(dateString, account) {
  const query = \`
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
  \`;

  const report = AdsApp.search(query);

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
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  try {
    const r = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options);
    if (r.getResponseCode() === 200) Logger.log('📤 Enviado: ' + payload.campaign_name);
  } catch (e) { Logger.log('❌ Erro: ' + e.message); }
}
`;

  // --- MODELO 2: SCRIPT HISTÓRICO (Intervalo) ---
  const historicalScript = `/**
 * Script AutoMetrics - CARGA HISTÓRICA
 * Use este script UMA VEZ para carregar dados antigos.
 * Defina a DATA DE INÍCIO e FIM abaixo.
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  
  // SEU TOKEN EXCLUSIVO (NÃO ALTERE)
  USER_ID: '${userId}', 

  // --- CONFIGURE O INTERVALO AQUI ---
  HISTORICAL_MODE: true, 
  START_DATE: "2024-12-01", // <--- EDITE A DATA INICIAL (Ano-Mês-Dia)
  END_DATE: "2024-12-31"    // <--- EDITE A DATA FINAL
};

function main() {
  Logger.log('🚀 Iniciando Carga Histórica para: ' + CONFIG.USER_ID);
  
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
}

function processAccount(account) {
  let currentDate = parseDate(CONFIG.START_DATE);
  const endDate = parseDate(CONFIG.END_DATE);

  while (currentDate <= endDate) {
    const dateString = Utilities.formatDate(currentDate, account.getTimeZone(), "yyyy-MM-dd");
    fetchAndSend(dateString, account);
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function fetchAndSend(dateString, account) {
  // Mesma query otimizada do modelo diário
  const query = \`
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
  \`;

  const report = AdsApp.search(query);

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
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  try {
    const r = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options);
    if (r.getResponseCode() === 200) Logger.log('📤 [Data: ' + payload.date + '] Enviado: ' + payload.campaign_name);
  } catch (e) { Logger.log('❌ Erro: ' + e.message); }
}

function parseDate(str) {
  const parts = str.split('-');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
`;

  const activeScript = activeTab === 'daily' ? dailyScript : historicalScript;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(activeScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans p-4 md:p-8 flex justify-center">
      <div className="w-full max-w-5xl">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Code className="text-indigo-500" /> Integração Google Ads
            </h1>
            <p className="text-slate-500 text-sm">Gere seu script exclusivo para conectar suas contas.</p>
          </div>
        </div>

        {/* Warning Box */}
        <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl mb-6 flex gap-3 items-start">
          <ShieldAlert className="text-indigo-400 shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-indigo-300 font-bold text-sm">Token de Segurança Ativo</h3>
            <p className="text-xs text-indigo-200/70 mt-1">
              Seu ID único <span className="font-mono bg-indigo-500/20 px-1 rounded text-white">{userId}</span> foi injetado automaticamente nos scripts abaixo. 
              Não é necessário configuração manual.
            </p>
          </div>
        </div>

        {/* Tabs de Seleção */}
        <div className="flex gap-4 mb-4">
          <button 
            onClick={() => setActiveTab('daily')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${
              activeTab === 'daily' 
                ? 'bg-slate-800 text-white border border-indigo-500 shadow-lg shadow-indigo-500/20' 
                : 'bg-slate-900 text-slate-400 border border-transparent hover:bg-slate-800'
            }`}
          >
            <Clock size={18} /> Automação Diária
          </button>
          <button 
            onClick={() => setActiveTab('historical')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${
              activeTab === 'historical' 
                ? 'bg-slate-800 text-white border border-indigo-500 shadow-lg shadow-indigo-500/20' 
                : 'bg-slate-900 text-slate-400 border border-transparent hover:bg-slate-800'
            }`}
          >
            <Calendar size={18} /> Carga Histórica (Intervalo)
          </button>
        </div>

        {/* Descrição Contextual */}
        <div className="mb-4 text-sm text-slate-400 pl-1">
          {activeTab === 'daily' 
            ? "Este script roda todos os dias e pega automaticamente os dados de ONTEM. Ideal para deixar agendado."
            : "Este script permite definir uma Data de Início e Fim. Use para importar dados de meses passados."}
        </div>

        {/* Code Area */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
            <span className="text-xs font-mono text-slate-400">
              {activeTab === 'daily' ? 'autometrics-daily.js' : 'autometrics-historical.js'}
            </span>
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
          <div className="p-4 overflow-x-auto h-[500px] custom-scrollbar">
            <pre className="font-mono text-xs text-slate-300 leading-relaxed whitespace-pre">
              {activeScript}
            </pre>
          </div>
        </div>

      </div>
    </div>
  );
}