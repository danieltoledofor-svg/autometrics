"use client";

import React, { useState, useEffect } from 'react';
import { Copy, Check, Code, ArrowLeft, ShieldAlert, Calendar, Clock, ChevronRight, Settings } from 'lucide-react';
import Link from 'next/link';

export default function IntegrationPage() {
  const [userId, setUserId] = useState('');
  const [activeTab, setActiveTab] = useState<'daily' | 'historical'>('daily');
  
  // Estado para as datas do Histórico
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Estado da Geração do Script
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 1. Recupera ID e Define datas padrão
  useEffect(() => {
    let storedId = localStorage.getItem('autometrics_user_id');
    if (!storedId) {
      storedId = crypto.randomUUID();
      localStorage.setItem('autometrics_user_id', storedId);
    }
    setUserId(storedId);

    // Datas padrão para histórico (Início do mês até hoje)
    const today = new Date().toISOString().split('T')[0];
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    setStartDate(firstDay);
    setEndDate(today);
  }, []);

  // Quando troca de aba, limpa o script gerado para forçar nova geração
  useEffect(() => {
    setGeneratedScript(null);
  }, [activeTab]);

  // Função que MONTA o script baseado nas escolhas
  const handleGenerateScript = () => {
    const isHistorical = activeTab === 'historical';
    
    const scriptTemplate = `/**
 * Script AutoMetrics - ${isHistorical ? 'CARGA HISTÓRICA' : 'AUTOMAÇÃO DIÁRIA'}
 * Gerado em: ${new Date().toLocaleString()}
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  
  // SEU TOKEN EXCLUSIVO
  USER_ID: '${userId}', 

  // CONFIGURAÇÃO DE DATAS
  HISTORICAL_MODE: ${isHistorical}, 
  ${isHistorical ? `START_DATE: "${startDate}", // Data Início escolhida` : '// Modo Diário (Ontem)'}
  ${isHistorical ? `END_DATE: "${endDate}"      // Data Fim escolhida` : ''}
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics (${isHistorical ? 'Histórico' : 'Diário'}) para: ' + CONFIG.USER_ID);
  
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
  ${isHistorical ? `
  // Modo Histórico: Itera sobre as datas
  let currentDate = parseDate(CONFIG.START_DATE);
  const endDate = parseDate(CONFIG.END_DATE);

  while (currentDate <= endDate) {
    const dateString = Utilities.formatDate(currentDate, account.getTimeZone(), "yyyy-MM-dd");
    fetchAndSend(dateString, account);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  ` : `
  // Modo Diário: Pega apenas ontem
  const d = new Date(); d.setDate(d.getDate() - 1);
  const dateString = Utilities.formatDate(d, account.getTimeZone(), "yyyy-MM-dd");
  fetchAndSend(dateString, account);
  `}
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
    if (r.getResponseCode() === 200) Logger.log('📤 Enviado: ' + payload.campaign_name + ' [' + payload.date + ']');
  } catch (e) { Logger.log('❌ Erro: ' + e.message); }
}

${isHistorical ? `
function parseDate(str) {
  const parts = str.split('-');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
` : ''}
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
              <Code className="text-indigo-500" /> Integração Google Ads
            </h1>
            <p className="text-slate-500 text-sm">Gerador de scripts seguros para suas contas.</p>
          </div>
        </div>

        {/* Token Info */}
        <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl mb-6 flex gap-3 items-center">
          <ShieldAlert className="text-indigo-400 shrink-0" size={20} />
          <p className="text-xs text-indigo-200/80">
            Seu Token Único <span className="font-mono bg-indigo-500/20 px-1 rounded text-white mx-1">{userId}</span> será inserido automaticamente no código.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-900 p-1 rounded-xl mb-8 w-fit border border-slate-800">
          <button 
            onClick={() => setActiveTab('daily')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'daily' 
                ? 'bg-indigo-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock size={16} /> Automação Diária
          </button>
          <button 
            onClick={() => setActiveTab('historical')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'historical' 
                ? 'bg-indigo-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Calendar size={16} /> Carga Histórica
          </button>
        </div>

        {/* CONTEÚDO PRINCIPAL: CONFIGURAÇÃO OU CÓDIGO */}
        {!generatedScript ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {activeTab === 'daily' ? (
              <div className="text-center space-y-6 py-4">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="text-emerald-500" size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Script de Automação Diária</h3>
                  <p className="text-slate-400 max-w-md mx-auto">
                    Este script não precisa de configuração de datas. Ele é programado para rodar todos os dias e capturar os dados de <strong>ontem</strong>.
                  </p>
                </div>
                <button 
                  onClick={handleGenerateScript}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 mx-auto"
                >
                  <Settings size={18} />
                  Gerar Script Diário
                </button>
              </div>
            ) : (
              <div className="max-w-lg mx-auto space-y-6">
                <div className="text-center mb-8">
                  <h3 className="text-xl font-bold text-white mb-2">Configurar Intervalo</h3>
                  <p className="text-slate-400 text-sm">
                    Defina o período que você deseja importar. O script será gerado especificamente para essas datas.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Data Início</label>
                    <input 
                      type="date" 
                      className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:border-indigo-500 outline-none [&::-webkit-calendar-picker-indicator]:invert"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Data Fim</label>
                    <input 
                      type="date" 
                      className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-lg focus:border-indigo-500 outline-none [&::-webkit-calendar-picker-indicator]:invert"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <button 
                  onClick={handleGenerateScript}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-900/20 transition-all flex items-center justify-center gap-2 mt-4"
                >
                  <Code size={18} />
                  Gerar Script Histórico
                </button>
              </div>
            )}
          </div>
        ) : (
          // --- ÁREA DO CÓDIGO GERADO ---
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <button onClick={() => setGeneratedScript(null)} className="text-slate-500 hover:text-white text-xs font-medium flex items-center gap-1">
                  <ArrowLeft size={14} /> Voltar
                </button>
                <span className="text-xs font-mono text-emerald-400">
                  {activeTab === 'daily' ? 'autometrics-daily.js' : 'autometrics-history.js'}
                </span>
              </div>
              
              <button 
                onClick={copyToClipboard}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  copied ? 'bg-emerald-500 text-white' : 'bg-white text-black hover:bg-slate-200'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copiado!' : 'Copiar Código'}
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