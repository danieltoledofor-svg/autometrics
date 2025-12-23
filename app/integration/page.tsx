"use client";

import React, { useState, useEffect } from 'react';
import { Copy, Check, Code, ArrowLeft, ShieldAlert, Calendar, Clock, Settings, Zap } from 'lucide-react';
import Link from 'next/link';

export default function IntegrationPage() {
  const [userId, setUserId] = useState('');
  // Agora temos apenas um modo principal: O Universal
  const [startDate, setStartDate] = useState('');
  
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 1. Recupera ID e Define Data Padrão (Início do Mês Atual)
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

  // Função que MONTA o script Universal
  const handleGenerateScript = () => {
    
    const scriptTemplate = `/**
 * Script AutoMetrics - UNIVERSAL (HISTÓRICO + TEMPO REAL)
 * Gerado em: ${new Date().toLocaleString()}
 * * COMO FUNCIONA:
 * 1. Começa na DATA DE INÍCIO configurada abaixo.
 * 2. Busca dados dia após dia até chegar em HOJE.
 * 3. Se agendado de HORA EM HORA, ele mantém tudo atualizado (Passado e Presente).
 */

const CONFIG = {
  WEBHOOK_URL: 'https://autometrics.vercel.app/api/webhook/google-ads', 
  
  // SEU TOKEN EXCLUSIVO
  USER_ID: '${userId}', 

  // --- CONFIGURAÇÃO ---
  // Defina aqui a partir de quando você quer puxar os dados.
  // O script vai ler desta data até o momento AGORA (Hoje).
  START_DATE: "${startDate}" // Formato: Ano-Mês-Dia
};

function main() {
  Logger.log('🚀 Iniciando AutoMetrics Universal para: ' + CONFIG.USER_ID);
  
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
  Logger.log('✅ Finalizado com sucesso.');
}

function processAccount(account) {
  // 1. Define o intervalo: Da DATA INICIO até HOJE
  let currentDate = parseDate(CONFIG.START_DATE);
  const today = new Date(); 
  
  // Zera as horas para comparar apenas datas
  today.setHours(0,0,0,0);
  currentDate.setHours(0,0,0,0);

  // Loop: Enquanto a data processada for menor ou igual a hoje
  while (currentDate <= today) {
    const dateString = Utilities.formatDate(currentDate, account.getTimeZone(), "yyyy-MM-dd");
    
    // Logger.log('   Processing: ' + dateString); // Descomente para debug
    fetchAndSend(dateString, account);
    
    // Avança para o próximo dia
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function fetchAndSend(dateString, account) {
  // Busca campanhas com IMPRESSÕES > 0 (Ativas)
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
    AND metrics.impressions > 0 
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
    // Log apenas se for o dia de HOJE para não poluir o histórico
    const isToday = payload.date === Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");
    if (r.getResponseCode() === 200 && isToday) {
       Logger.log('📤 [Tempo Real] Enviado: ' + payload.campaign_name);
    }
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
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Code className="text-indigo-500" /> Integração Universal
            </h1>
            <p className="text-slate-500 text-sm">Gere um único script inteligente para Histórico e Tempo Real.</p>
          </div>
        </div>

        {/* Token Info */}
        <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl mb-6 flex gap-3 items-center">
          <ShieldAlert className="text-indigo-400 shrink-0" size={20} />
          <p className="text-xs text-indigo-200/80">
            Seu Token Único <span className="font-mono bg-indigo-500/20 px-1 rounded text-white mx-1">{userId}</span> será inserido automaticamente.
          </p>
        </div>

        {/* ÁREA DE CONFIGURAÇÃO */}
        {!generatedScript ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            <div className="max-w-lg mx-auto space-y-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-indigo-500/20">
                  <Zap className="text-white" size={32} fill="currentColor" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Script Híbrido Automático</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Este script entende o que fazer. Ele vai processar todo o intervalo desde a data que você escolher abaixo 
                  até o dia de <strong>HOJE</strong>. E continuará atualizando o hoje a cada execução.
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
                <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                  <Clock size={10} /> O script buscará de {startDate} até Agora (Tempo Real).
                </p>
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
          // --- ÁREA DO CÓDIGO GERADO ---
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <button onClick={() => setGeneratedScript(null)} className="text-slate-500 hover:text-white text-xs font-medium flex items-center gap-1">
                  <ArrowLeft size={14} /> Configurar
                </button>
                <span className="text-xs font-mono text-emerald-400">
                  autometrics-universal.js
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
            
            <div className="relative">
              <div className="absolute top-0 right-0 p-4 pointer-events-none">
                 <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] px-2 py-1 rounded backdrop-blur-sm">
                    Modo: Histórico + Tempo Real
                 </div>
              </div>
              <div className="p-0 overflow-x-auto">
                <pre className="font-mono text-xs text-slate-300 leading-relaxed p-6 min-h-[400px]">
                  {generatedScript}
                </pre>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}