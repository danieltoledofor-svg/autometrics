"use client";

import React, { useState, useEffect } from 'react';
import {
  Copy, Check, Code, ArrowLeft, Zap, Calendar,
  Globe, Store, AlertCircle, Sun, Moon, Link2, ShoppingBag, MousePointerClick,
  Tv2, Key, Eye, EyeOff, Save, CheckCircle2, LinkIcon, ExternalLink, Plus, Trash2
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
  const [copiedPostback, setCopiedPostback] = useState<string | null>(null);

  // VTurb token
  const [vturbToken, setVturbToken] = useState('');
  const [vturbTokenInput, setVturbTokenInput] = useState('');
  const [vturbTokenSaving, setVturbTokenSaving] = useState(false);
  const [vturbTokenSaved, setVturbTokenSaved] = useState(false);
  const [vturbTokenVisible, setVturbTokenVisible] = useState(false);

  // Aba ativa
  const [activeTab, setActiveTab] = useState<'google' | 'postback' | 'pixel' | 'vturb' | 'url'>('google');

  // URL Builder
  const [urlBase, setUrlBase] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);
  const [urlParams, setUrlParams] = useState([
    { key: 'utm_id', value: '{campaignid}', locked: true, ratoeira: false },
    { key: 'utm_source', value: 'google', locked: true, ratoeira: false },
    { key: 'utm_medium', value: 'cpc', locked: true, ratoeira: false },
    { key: 'utm_campaign', value: '{campaignname}', locked: false, ratoeira: false },
    { key: 'utm_term', value: '{keyword}', locked: false, ratoeira: false },
    { key: 'utm_content', value: '{creative}', locked: false, ratoeira: false },
    { key: 'network', value: '{network}', locked: false, ratoeira: false },
    { key: 'device', value: '{device}', locked: false, ratoeira: false },
    { key: 'raclid', value: 'ra_{gclid}_ra', locked: false, ratoeira: true },
  ]);


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

      // Carrega token VTurb já salvo
      const { data: settings } = await supabase
        .from('user_settings')
        .select('vturb_api_token')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (settings?.vturb_api_token) {
        setVturbToken(settings.vturb_api_token);
        setVturbTokenInput(settings.vturb_api_token);
      }
    }
    getUser();

    const firstDay = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    setStartDate(firstDay);
  }, []);

  const saveVturbToken = async () => {
    if (!userId || !vturbTokenInput.trim()) return;
    setVturbTokenSaving(true);
    const token = vturbTokenInput.trim();
    await supabase.from('user_settings').upsert(
      { user_id: userId, vturb_api_token: token },
      { onConflict: 'user_id' }
    );
    setVturbToken(token);
    setVturbTokenSaving(false);
    setVturbTokenSaved(true);
    setTimeout(() => setVturbTokenSaved(false), 3000);
  };


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

    // ----------------------------------------------------
    // BUSCA DEEP METRICS (Termos, Públicos, Local)
    // Apenas para os últimos 3 dias para economizar cota do Google (Bandwidth limit)
    // ----------------------------------------------------
    const loopDate = parseDate(dateString);
    const todayDiff = new Date();
    todayDiff.setHours(0,0,0,0);
    const timeDiff = Math.abs(todayDiff.getTime() - loopDate.getTime());
    const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
    const isRecent = diffDays <= 3;

    let searchTerms = [];
    let audiences = [];
    let locations = [];
    let history = [];

    if (isRecent) {
      // 1. Termos de Pesquisa (top 10 por impressoes) — deduplicado por termo
      try {
      const stQuery = \`
        SELECT
          search_term_view.search_term,
          metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM search_term_view
        WHERE segments.date = '\${dateString}'
          AND campaign.id = \${row.campaign.id}
          AND metrics.impressions > 0
        ORDER BY metrics.impressions DESC
        LIMIT 20
      \`;
      const stMap = {}; // deduplicar termos de múltiplos ad groups
      const stReport = AdsApp.search(stQuery);
      while(stReport.hasNext()){
        const stRow = stReport.next();
        const term = stRow.searchTermView.searchTerm;
        if (!stMap[term]) stMap[term] = { t: term, i: 0, cl: 0, c: 0, cv: 0 };
        stMap[term].i += stRow.metrics.impressions;
        stMap[term].cl += stRow.metrics.clicks;
        stMap[term].c += stRow.metrics.costMicros;
        stMap[term].cv += Math.round(stRow.metrics.conversions || 0);
      }
      // Pega os top 10 por impressão após deduplicar
      searchTerms = Object.values(stMap)
        .sort((a, b) => b.i - a.i)
        .slice(0, 10);
    } catch(e) { Logger.log('ST error: ' + e.message); }

    // 2. Públicos: Idade, Gênero e Renda Familiar
    const audienceMap = {}; // Para deduplicar (múltiplos ad groups podem ter o mesmo segmento)
    try {
      const ageQuery = \`
        SELECT ad_group_criterion.age_range.type, metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM age_range_view 
        WHERE segments.date = '\${dateString}' AND campaign.id = \${row.campaign.id} AND metrics.impressions > 0
      \`;
      const ageReport = AdsApp.search(ageQuery);
      while(ageReport.hasNext()){
        const aRow = ageReport.next();
        const key = 'Age|' + aRow.adGroupCriterion.ageRange.type;
        if (!audienceMap[key]) audienceMap[key] = { tp: 'Age', n: aRow.adGroupCriterion.ageRange.type, i: 0, cl: 0, c: 0 };
        audienceMap[key].i += aRow.metrics.impressions;
        audienceMap[key].cl += aRow.metrics.clicks;
        audienceMap[key].c += aRow.metrics.costMicros;
      }

      const genderQuery = \`
        SELECT ad_group_criterion.gender.type, metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM gender_view 
        WHERE segments.date = '\${dateString}' AND campaign.id = \${row.campaign.id} AND metrics.impressions > 0
      \`;
      const genderReport = AdsApp.search(genderQuery);
      while(genderReport.hasNext()){
        const aRow = genderReport.next();
        const key = 'Gender|' + aRow.adGroupCriterion.gender.type;
        if (!audienceMap[key]) audienceMap[key] = { tp: 'Gender', n: aRow.adGroupCriterion.gender.type, i: 0, cl: 0, c: 0 };
        audienceMap[key].i += aRow.metrics.impressions;
        audienceMap[key].cl += aRow.metrics.clicks;
        audienceMap[key].c += aRow.metrics.costMicros;
      }

      const incomeQuery = \`
        SELECT ad_group_criterion.income_range.type, metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM income_range_view
        WHERE segments.date = '\${dateString}' AND campaign.id = \${row.campaign.id} AND metrics.impressions > 0
      \`;
      const incomeReport = AdsApp.search(incomeQuery);
      while(incomeReport.hasNext()){
        const aRow = incomeReport.next();
        const key = 'Income|' + aRow.adGroupCriterion.incomeRange.type;
        if (!audienceMap[key]) audienceMap[key] = { tp: 'Income', n: aRow.adGroupCriterion.incomeRange.type, i: 0, cl: 0, c: 0 };
        audienceMap[key].i += aRow.metrics.impressions;
        audienceMap[key].cl += aRow.metrics.clicks;
        audienceMap[key].c += aRow.metrics.costMicros;
      }
    } catch(e) {}

    // 3. Dispositivos (Desktop, Mobile, Tablet)
    try {
      const deviceQuery = \`
        SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM campaign
        WHERE segments.date = '\${dateString}' AND campaign.id = \${row.campaign.id} AND metrics.impressions > 0
      \`;
      const deviceReport = AdsApp.search(deviceQuery);
      while(deviceReport.hasNext()){
        const dRow = deviceReport.next();
        const key = 'Device|' + dRow.segments.device;
        if (!audienceMap[key]) audienceMap[key] = { tp: 'Device', n: dRow.segments.device, i: 0, cl: 0, c: 0 };
        audienceMap[key].i += dRow.metrics.impressions;
        audienceMap[key].cl += dRow.metrics.clicks;
        audienceMap[key].c += dRow.metrics.costMicros;
      }
    } catch(e) {}

    audiences = Object.values(audienceMap);

    // 4. Localizações — geographic_view (campaign.id must be in SELECT when used in WHERE)
    try {
      const locQuery = \`
        SELECT campaign.id, geographic_view.country_criterion_id, geographic_view.location_type,
               metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM geographic_view
        WHERE segments.date = '\${dateString}' AND campaign.id = \${row.campaign.id}
        LIMIT 10
      \`;
      const locReport = AdsApp.search(locQuery);
      while(locReport.hasNext()){
        const lRow = locReport.next();
        if (lRow.metrics.impressions > 0) {
          locations.push({
            tp: lRow.geographicView.locationType || 'Country',
            n: 'Geo:' + lRow.geographicView.countryCriterionId,
            i: lRow.metrics.impressions, cl: lRow.metrics.clicks, c: lRow.metrics.costMicros
          });
        }
      }
    } catch(e) { Logger.log('Loc error: ' + e.message); }
    } // Fim do if (isRecent)

    const payload = {
      user_id: CONFIG.USER_ID,
      campaign_name: row.campaign.name,
      campaign_id: row.campaign.id,
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
      },
      search_terms: searchTerms,
      audiences: audiences,
      locations: locations,
      history: history
    };
    sendToWebhook(payload);
  }
}

function sendToWebhook(payload) {
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  try { 
    Utilities.sleep(500);
    const response = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options); 
    const code = response.getResponseCode();
    if (code !== 200) {
       Logger.log('⚠️ Aviso Webhook HTTP ' + code + ': ' + response.getContentText());
    } else {
       // Logs diagnóstico: mostra quantos registros chegaram e qualquer erro de banco
       try {
         const body = JSON.parse(response.getContentText());
         if (body.diag) {
           Logger.log('✅ OK | st:' + body.diag.st_recv + ' aud:' + body.diag.aud_recv + ' loc:' + body.diag.loc_recv + (body.diag.errors && body.diag.errors.length ? ' ERROS:' + JSON.stringify(body.diag.errors) : ''));
         }
       } catch(pe) {}
    }
  } catch (e) { 
    Logger.log('❌ Erro Webhook: ' + e.message); 
  }
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
  WEBHOOK_URL: '${window.location.origin}/api/webhook/google-ads', 
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
  WEBHOOK_URL: '${window.location.origin}/api/webhook/google-ads', 
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

  const copyPostback = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPostback(key);
    setTimeout(() => setCopiedPostback(null), 2000);
  };

  // Estilos
  const isDark = theme === 'dark';
  const bgMain = isDark ? 'bg-black text-slate-200' : 'bg-slate-50 text-slate-900';
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';
  const borderCol = isDark ? 'border-slate-800' : 'border-slate-200';

  return (
    <div className={`min-h-screen font-sans ${bgMain}`}>
      <div className="w-full max-w-4xl mx-auto p-4 md:p-8">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className={`p-2 rounded-lg transition-colors ${isDark ? 'bg-slate-900 hover:bg-slate-800 text-slate-400' : 'bg-white border border-slate-200 text-slate-600'}`}>
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className={`text-2xl font-bold flex items-center gap-2 ${textHead}`}>
                <Code className="text-indigo-500" /> Integração
              </h1>
              <p className={`text-sm ${textMuted}`}>Configure as conexões da sua conta.</p>
            </div>
          </div>
          <button onClick={toggleTheme} className={`p-2.5 rounded-lg border transition-colors ${isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-500'}`}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* TAB NAV */}
        <div className={`flex gap-1 p-1 rounded-xl mb-8 ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-slate-100 border border-slate-200'}`}>
          {([
            { key: 'google', icon: <Code size={15} />, label: 'Google Ads' },
            { key: 'postback', icon: <ShoppingBag size={15} />, label: 'Postback S2S' },
            { key: 'pixel', icon: <MousePointerClick size={15} />, label: 'Pixel' },
            { key: 'vturb', icon: <Tv2 size={15} />, label: 'VTurb' },
            { key: 'url', icon: <LinkIcon size={15} />, label: 'URL Builder' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key
                ? 'bg-indigo-600 text-white shadow-lg'
                : `${textMuted} hover:text-white`
                }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── ABA 1: GOOGLE ADS ────────────────────────────────── */}
        {activeTab === 'google' && (
          <>
            {!generatedScript ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className={`${bgCard} rounded-xl p-6 border`}>
                    <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${textHead}`}>
                      <span className="bg-indigo-600 w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white">1</span>
                      Tipo de Conta Google
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <button onClick={() => setAccountType('mcc')} className={`p-4 rounded-xl border-2 text-left transition-all ${accountType === 'mcc' ? 'border-indigo-500 bg-indigo-500/10' : `${borderCol} hover:border-indigo-300`}`}>
                        <div className="flex justify-between items-start mb-2"><Globe className={accountType === 'mcc' ? 'text-indigo-400' : 'text-slate-400'} size={24} />{accountType === 'mcc' && <Check size={16} className="text-indigo-500" />}</div>
                        <p className={`font-bold ${textHead}`}>Agência / MCC</p><p className={`text-xs mt-1 ${textMuted}`}>Várias sub-contas.</p>
                      </button>
                      <button onClick={() => setAccountType('single')} className={`p-4 rounded-xl border-2 text-left transition-all ${accountType === 'single' ? 'border-indigo-500 bg-indigo-500/10' : `${borderCol} hover:border-indigo-300`}`}>
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

                <div className="space-y-6">
                  <div className={`${bgCard} rounded-xl p-6 border`}>
                    <h3 className={`font-bold mb-4 flex items-center gap-2 ${textHead}`}><Zap size={18} className="text-amber-400" /> Instalação</h3>
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
                    <p className="text-xs text-emerald-400 leading-relaxed mb-2"><strong>Dica Importante:</strong></p>
                    <p className="text-xs text-emerald-500/80 leading-relaxed">
                      Na lista de scripts, altere a coluna <strong>Frequência</strong> de "Diariamente" para <strong>"A cada hora"</strong> (Hourly).
                      Isso garante que seus dados estejam sempre atualizados.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${bgCard} rounded-xl overflow-hidden shadow-2xl border`}>
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
          </>
        )}

        {/* ── ABA 2: POSTBACK S2S ──────────────────────────────── */}
        {activeTab === 'postback' && userId && (
          <div className="space-y-6">
            <div className={`rounded-xl p-6 border ${bgCard}`}>
              <div className="flex items-center gap-3 mb-1">
                <ShoppingBag size={20} className="text-indigo-500" />
                <h2 className={`text-lg font-bold ${textHead}`}>Postback S2S — Plataformas de Venda</h2>
              </div>
              <p className={`text-sm ${textMuted} mb-6`}>
                Registre vendas (e upsells) e checkouts automaticamente. Cole a URL de postback da sua plataforma e os eventos serão registrados na campanha certa via <code className="bg-slate-800 px-1 rounded text-indigo-300">utm_id</code>.
              </p>

              <div className={`flex flex-wrap items-center gap-2 text-xs font-mono mb-6 p-4 rounded-lg border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                <span className="bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded">utm_id={'{campaignid}'}</span>
                <span className={textMuted}>→ capturado como subid</span>
                <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded">venda ocorre</span>
                <span className={textMuted}>→ plataforma dispara postback</span>
                <span className="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">AutoMetrics registra</span>
              </div>

              <div className="space-y-3">
                {[
                  { key: 'sale', label: 'Venda / Upsell', color: 'emerald', placeholders: 'event=sale&amount={payout_amount}&cy={offer_currency}&orderid={transaction_id}&campaign_id={sub1}' },
                  { key: 'checkout', label: 'Checkout', color: 'blue', placeholders: 'event=checkout&orderid={transaction_id}&campaign_id={sub1}' },
                ].map(({ key, label, color, placeholders }) => {
                  const url = `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?${placeholders}`;
                  const isCopied = copiedPostback === key;
                  return (
                    <div key={key} className={`flex items-start gap-3 p-3 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                      <span className={`mt-0.5 text-[10px] font-bold uppercase px-2 py-1 rounded shrink-0 bg-${color}-500/10 text-${color}-500 border border-${color}-500/20`}>{label}</span>
                      <code className={`flex-1 text-[11px] font-mono break-all ${textMuted}`}>{url}</code>
                      <button onClick={() => copyPostback(url, key)} className={`shrink-0 p-2 rounded-lg transition-all ${isCopied ? 'bg-emerald-500 text-white' : `${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-500 hover:text-black'}`}`} title="Copiar">
                        {isCopied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={`rounded-xl p-6 border ${bgCard}`}>
              <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${textHead}`}>
                <Link2 size={16} className="text-indigo-500" /> Como configurar por plataforma
              </h3>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Adicione a URL de postback <strong>ao lado</strong> da URL da Ratoeira — não substitua. A maioria das plataformas aceita múltiplos postbacks.
              </p>
              <div className="space-y-4">
                {[
                  {
                    name: 'Gurumedia',
                    note: 'Ratoeira usa sub1–sub4. Configure sub5 = utm_id na oferta.',
                    noteColor: 'amber',
                    urlSale: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=sale&amount={payout_amount}&cy={offer_currency}&orderid={transaction_id}&campaign_id={sub5}`,
                    urlCheckout: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=checkout&orderid={transaction_id}&campaign_id={sub5}`,
                    details: [
                      { label: 'campaign_id', value: '{sub5} (= utm_id)' },
                      { label: 'orderid', value: '{transaction_id}' },
                      { label: 'amount', value: '{payout_amount}' },
                      { label: 'cy', value: '{offer_currency}' },
                    ],
                  },
                  {
                    name: 'Clickbank (V8)',
                    note: 'Configure aff_sub5 = utm_id na oferta. tid = {tid}, amount = {affiliate_earnings}.',
                    noteColor: 'blue',
                    urlSale: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=sale&amount={affiliate_earnings}&cy={currency}&tid={tid}&campaign_id={aff_sub5}`,
                    urlCheckout: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=checkout&tid={tid}&campaign_id={aff_sub5}`,
                    details: [
                      { label: 'campaign_id', value: '{aff_sub5} (= utm_id)' },
                      { label: 'tid', value: '{tid}' },
                      { label: 'amount', value: '{affiliate_earnings}' },
                      { label: 'cy', value: '{currency}' },
                    ],
                  },
                  {
                    name: 'Cartpanda',
                    note: 'Cartpanda passa utm_campaign automaticamente via {utm_campaign}.',
                    noteColor: 'emerald',
                    urlSale: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=sale&amount={amount_affiliate}&cy={currency}&orderid={order_id}&campaign_id={utm_campaign}`,
                    urlCheckout: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=checkout&orderid={order_id}&campaign_id={utm_campaign}`,
                    details: [
                      { label: 'campaign_id', value: '{utm_campaign} (= utm_id)' },
                      { label: 'orderid', value: '{order_id}' },
                      { label: 'amount', value: '{amount_affiliate}' },
                      { label: 'cy', value: '{currency}' },
                    ],
                  },
                  {
                    name: 'MaxWeb / Buygoods',
                    note: 'Configure SUBID1 = utm_id. O AutoMetrics lerá os respectivos eventos.',
                    noteColor: 'indigo',
                    urlSale: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=sale&amount={COMMISSION_AMOUNT}&cy=USD&orderid={ORDERID}&campaign_id={SUBID1}`,
                    urlCheckout: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=checkout&orderid={ORDERID}&campaign_id={SUBID1}`,
                    details: [
                      { label: 'campaign_id', value: '{SUBID1} (= utm_id)' },
                      { label: 'orderid', value: '{ORDERID}' },
                      { label: 'amount', value: '{COMMISSION_AMOUNT}' },
                      { label: 'cy', value: 'USD' },
                    ],
                  },
                  {
                    name: 'Digistore',
                    note: 'sid1–5 configuráveis. Use sid5 = utm_id na configuração da oferta.',
                    noteColor: 'cyan',
                    urlSale: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=sale&amount={amount_affiliate}&cy={currency}&orderid={transaction_id}&campaign_id={sid5}`,
                    urlCheckout: `${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId}?event=checkout&orderid={transaction_id}&campaign_id={sid5}`,
                    details: [
                      { label: 'campaign_id', value: '{sid5} (= utm_id)' },
                      { label: 'orderid', value: '{transaction_id}' },
                      { label: 'amount', value: '{amount_affiliate}' },
                      { label: 'cy', value: '{currency}' },
                    ],
                  },
                ].map(p => {
                  const isCopiedSale = copiedPostback === `plat_sale_${p.name}`;
                  const isCopiedCheckout = copiedPostback === `plat_chk_${p.name}`;
                  return (
                    <div key={p.name} className={`rounded-xl border p-4 ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <p className={`font-bold text-sm ${textHead}`}>{p.name}</p>
                          <p className={`text-xs mt-0.5 text-${p.noteColor}-400`}>{p.note}</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {/* URL VENDA */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Venda / Upsell</span>
                            <button onClick={() => copyPostback(p.urlSale, `plat_sale_${p.name}`)} className={`shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${isCopiedSale ? 'bg-emerald-500 text-white' : `${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-600 hover:text-black'}`}`}>
                              {isCopiedSale ? <Check size={12} /> : <Copy size={12} />}
                              {isCopiedSale ? 'Copiado!' : 'Copiar URL Venda'}
                            </button>
                          </div>
                          <code className={`block text-[10px] font-mono break-all p-2 rounded border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} ${textMuted}`}>{p.urlSale}</code>
                        </div>

                        {/* URL CHECKOUT */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">Checkout</span>
                            <button onClick={() => copyPostback(p.urlCheckout, `plat_chk_${p.name}`)} className={`shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${isCopiedCheckout ? 'bg-blue-500 text-white' : `${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-600 hover:text-black'}`}`}>
                              {isCopiedCheckout ? <Check size={12} /> : <Copy size={12} />}
                              {isCopiedCheckout ? 'Copiado!' : 'Copiar URL Checkout'}
                            </button>
                          </div>
                          <code className={`block text-[10px] font-mono break-all p-2 rounded border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} ${textMuted}`}>{p.urlCheckout}</code>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-500/10">
                        {p.details.map(d => (
                          <span key={d.label} className={`text-[10px] px-2 py-0.5 rounded font-mono ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>
                            <span className="text-indigo-400">{d.label}</span>=<span className="text-blue-400">{d.value}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                <p className="text-xs font-bold text-amber-400 mb-2">⚠️ Configuração Gurumedia (Ratoeira usa sub1–sub4)</p>
                <p className={`text-xs ${textMuted} mb-3`}>
                  A Ratoeira Ads preenche automaticamente <code className="bg-slate-800 px-1 rounded text-amber-300">sub1</code> a <code className="bg-slate-800 px-1 rounded text-amber-300">sub4</code> com o ID de visita dela.
                  Configure o <strong>sub5</strong> para passar o <code className="bg-slate-800 px-1 rounded text-amber-300">utm_id</code> e use <code className="bg-slate-800 px-1 rounded text-indigo-300">campaign_id={'{sub5}'}</code> na URL de postback de <strong>Venda</strong>.
                </p>
                <div className={`rounded-lg p-3 font-mono text-[11px] break-all ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
                  {`${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/${userId || 'SEU_USER_ID'}?event=sale&amount={payout_amount}&cy={offer_currency}&tid={transaction_id}&campaign_id={sub5}`}
                </div>
              </div>
              <p className={`text-xs mt-3 ${textMuted}`}>
                ⚠️ Certifique-se que <code className="bg-slate-800 px-1 rounded text-indigo-300">utm_id={'{campaignid}'}</code> está na URL do anúncio no Google Ads.
              </p>
            </div>
          </div>
        )}

        {/* ── ABA 3: PIXEL DE RASTREAMENTO ─────────────────────── */}
        {activeTab === 'pixel' && userId && (
          <div className={`rounded-xl p-6 border ${bgCard}`}>
            <div className="flex items-center gap-3 mb-1">
              <MousePointerClick size={20} className="text-cyan-500" />
              <h2 className={`text-lg font-bold ${textHead}`}>Pixel de Rastreamento AutoMetrics</h2>
            </div>
            <p className={`text-sm ${textMuted} mb-5`}>
              Script leve para registrar <strong>cliques e checkouts</strong> automaticamente direto da sua página.
              Funciona em paralelo com Ratoeira, Hotjar ou qualquer outro tracker — <strong>sem interferência</strong>.
            </p>

            <div className={`flex flex-wrap items-center gap-2 text-xs mb-5 p-3 rounded-lg border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <span className="bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded font-mono">Landing Page</span>
              <span className={textMuted}>→ pixel captura utm_id →</span>
              <span className="bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded font-mono">click registrado</span>
              <span className={textMuted}>+</span>
              <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded font-mono">Checkout Page</span>
              <span className={textMuted}>→ pixel registra checkout</span>
              <span className={textMuted}>+</span>
              <span className="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded font-mono">Postback sub5 → venda</span>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-xs font-bold uppercase ${textMuted}`}>1. Pixel de Clique — colar na Landing Page</p>
                  <button onClick={() => copyPostback(`<!-- AutoMetrics Pixel (Clique) -->\n<script>(function(){var uid='${userId}';var p=new URLSearchParams(window.location.search);var cid=p.get('utm_id')||p.get('gad_campaignid')||'';if(!cid)return;var tid='clk_'+Date.now()+'_'+Math.random().toString(36).substr(2,6);navigator.sendBeacon('${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/'+uid+'?event=click&campaign_id='+encodeURIComponent(cid)+'&tid='+tid);})()</\script>`, 'pixel_click')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${copiedPostback === 'pixel_click' ? 'bg-emerald-500 text-white' : `${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-600 hover:text-black'}`}`}>
                    {copiedPostback === 'pixel_click' ? <Check size={12} /> : <Copy size={12} />}
                    {copiedPostback === 'pixel_click' ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
                <pre className={`rounded-lg p-4 text-[11px] font-mono overflow-x-auto leading-relaxed ${isDark ? 'bg-slate-950 text-slate-300' : 'bg-slate-50 text-slate-700'}`}>
                  {`<!-- AutoMetrics Pixel (Clique) -->
<script>
(function(){
  var uid = '${userId}';
  var p   = new URLSearchParams(window.location.search);
  var cid = p.get('utm_id') || p.get('gad_campaignid') || '';
  if (!cid) return;
  var tid = 'clk_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
  navigator.sendBeacon(
    '${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/' + uid +
    '?event=click&campaign_id=' + encodeURIComponent(cid) + '&tid=' + tid
  );
})();
</script>`}
                </pre>
              </div>

              <div className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className={`text-sm font-bold uppercase ${textHead}`}>2. Rastreio de Checkout</h3>
                  <span className="text-[10px] bg-slate-500/10 text-slate-500 px-2 py-0.5 rounded font-bold uppercase border border-slate-500/20">Atenção</span>
                </div>
                
                {/* Abordagem 1: Produtor (Dono da página) */}
                <div className="mb-4">
                  <p className={`text-xs font-bold ${textHead} mb-1 flex items-center gap-1.5`}><span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>Se você FOR O PRODUTOR (dono do checkout):</p>
                  <p className={`text-xs ${textMuted} mb-2 ml-3`}>Cole este script direto na sua página de checkout, da mesma forma que fez com a Landing Page.</p>
                  <div className="ml-3">
                    <div className="flex items-end justify-between mb-2">
                       <button onClick={() => copyPostback(`<!-- AutoMetrics Pixel (Checkout) -->\n<script>(function(){var uid='${userId}';var p=new URLSearchParams(window.location.search);var cid=p.get('utm_id')||p.get('gad_campaignid')||'';if(!cid)return;var tid='chk_'+Date.now()+'_'+Math.random().toString(36).substr(2,6);navigator.sendBeacon('${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/'+uid+'?event=checkout&campaign_id='+encodeURIComponent(cid)+'&tid='+tid);})()</\script>`, 'pixel_checkout')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${copiedPostback === 'pixel_checkout' ? 'bg-emerald-500 text-white' : `${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-600 hover:text-black'}`}`}>
                        {copiedPostback === 'pixel_checkout' ? <Check size={12} /> : <Copy size={12} />}
                        {copiedPostback === 'pixel_checkout' ? 'Copiado!' : 'Copiar Pixel de Checkout'}
                      </button>
                    </div>
                    <pre className={`rounded-lg p-3 text-[10px] font-mono overflow-x-auto leading-relaxed ${isDark ? 'bg-slate-950 text-slate-300 border border-slate-800' : 'bg-slate-50 text-slate-700 border border-slate-200'}`}>
                      {`<!-- AutoMetrics Pixel (Checkout) -->
<script>
(function(){
  var uid = '${userId}';
  var p   = new URLSearchParams(window.location.search);
  var cid = p.get('utm_id') || p.get('gad_campaignid') || '';
  if (!cid) return;
  var tid = 'chk_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
  navigator.sendBeacon(
    '${typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud"}/api/postback/' + uid +
    '?event=checkout&campaign_id=' + encodeURIComponent(cid) + '&tid=' + tid
  );
})();
</script>`}
                    </pre>
                  </div>
                </div>

                <div className={`my-4 border-t ${borderCol}`}></div>

                {/* Abordagem 2: Afiliado (Não tem acesso ao código) */}
                <div>
                  <p className={`text-xs font-bold text-amber-500 mb-1 flex items-center gap-1.5`}><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Se você FOR AFILIADO (não altere o código do checkout):</p>
                  <p className={`text-xs ${textMuted} mb-3 ml-3 leading-relaxed`}>
                    Como afiliado, você não consegue colar códigos (scripts) na página de checkout da plataforma externa (Clickbank, Buygoods, etc). 
                    <br/><br/>
                    <strong>A Solução:</strong> Você deve rastrear os checkouts usando a <strong>Aba de Postback S2S</strong>. Lá, você configura dentro da plataforma (ex: Clickbank) para que ela dispare a URL de postback sempre que ocorrer o evento de "Initiate Checkout" ou "Order Impression".
                  </p>
                  
                  <div className="ml-3">
                    <button onClick={() => setActiveTab('postback')} className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition-colors ${isDark ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
                      Ir para configurações de Postback S2S <ArrowLeft size={14} className="rotate-180" />
                    </button>
                  </div>
                </div>
              </div>

              <div className={`p-3 rounded-lg border ${isDark ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200'}`}>
                <p className="text-xs text-emerald-400 font-bold mb-1">✅ Por que não há conflito</p>
                <p className={`text-xs ${textMuted}`}>
                  O pixel usa <code className="bg-slate-800 px-1 rounded">navigator.sendBeacon</code> — assíncrono, não bloqueia a página e não modifica nenhuma variável global. A Ratoeira, Hotjar e outros scripts continuam funcionando normalmente em paralelo.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── ABA 4: VTURB ─────────────────────────────────────── */}
        {activeTab === 'vturb' && userId && (
          <div className={`rounded-xl p-6 border ${bgCard}`}>
            <div className="flex items-center gap-3 mb-1">
              <Tv2 size={20} className="text-purple-500" />
              <h2 className={`text-lg font-bold ${textHead}`}>VTurb Analytics — Token de API</h2>
            </div>
            <p className={`text-sm ${textMuted} mb-5`}>
              Configure seu token de API do VTurb para visualizar métricas de vídeo
              (visualizações, plays, engajamento, cliques e conversões) diretamente nos produtos.
            </p>

            <div className={`flex flex-col gap-1 text-xs mb-5 p-4 rounded-lg border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <p className={`font-bold mb-1 ${textHead}`}>Como obter o token:</p>
              {[
                '1. Acesse app.vturb.com e faça login',
                '2. Vá em Configurações → API (ou Integrações)',
                '3. Copie o token de API gerado',
                '4. Cole aqui abaixo e clique em Salvar',
              ].map(s => <p key={s} className={textMuted}>{s}</p>)}
            </div>

            <div className="flex items-center gap-3">
              <div className={`flex-1 flex items-center gap-2 rounded-xl border px-4 py-3 transition-colors ${isDark ? 'bg-slate-950 border-slate-700 focus-within:border-purple-500' : 'bg-white border-slate-200 focus-within:border-purple-400'}`}>
                <Key size={16} className="text-purple-400 shrink-0" />
                <input
                  type={vturbTokenVisible ? 'text' : 'password'}
                  value={vturbTokenInput}
                  onChange={e => setVturbTokenInput(e.target.value)}
                  placeholder="Cole seu token VTurb aqui..."
                  className={`flex-1 bg-transparent outline-none text-sm font-mono ${textHead} placeholder:text-slate-500`}
                />
                <button onClick={() => setVturbTokenVisible(v => !v)} className={`p-1 rounded transition-colors ${isDark ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-black'}`} title={vturbTokenVisible ? 'Ocultar token' : 'Mostrar token'}>
                  {vturbTokenVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <button onClick={saveVturbToken} disabled={vturbTokenSaving || !vturbTokenInput.trim()}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all shrink-0 ${vturbTokenSaved ? 'bg-emerald-500 text-white' : 'bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'}`}>
                {vturbTokenSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                {vturbTokenSaving ? 'Salvando...' : vturbTokenSaved ? 'Salvo!' : 'Salvar'}
              </button>
            </div>

            {vturbToken && (
              <div className={`mt-4 flex items-center gap-2 text-xs p-3 rounded-lg border ${isDark ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200'}`}>
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                <span className="text-emerald-400 font-medium">Token configurado</span>
                <span className={`font-mono ${textMuted}`}>{vturbToken.slice(0, 8)}{'•'.repeat(Math.min(20, vturbToken.length - 8))}</span>
              </div>
            )}
          </div>
        )}
        {/* ── ABA 5: URL BUILDER ───────────────────────────────── */}
        {activeTab === 'url' && (() => {
          const buildUrl = () => {
            if (!urlBase.trim()) return '';
            try {
              const base = urlBase.trim();
              const hasQuery = base.includes('?');
              const params = urlParams.filter(p => p.key && p.value);
              const qs = params.map(p => `${encodeURIComponent(p.key)}=${p.value}`).join('&');
              return `${base}${hasQuery ? '&' : '?'}${qs}`;
            } catch { return urlBase; }
          };
          const finalUrl = buildUrl();

          const updateParam = (idx: number, field: 'key' | 'value', val: string) => {
            setUrlParams(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
          };
          const removeParam = (idx: number) => {
            setUrlParams(prev => prev.filter((_, i) => i !== idx));
          };
          const addParam = () => {
            setUrlParams(prev => [...prev, { key: '', value: '', locked: false, ratoeira: false }]);
          };
          const copyUrl = () => {
            navigator.clipboard.writeText(finalUrl);
            setUrlCopied(true);
            setTimeout(() => setUrlCopied(false), 2000);
          };

          return (
            <div className="space-y-6">
              <div className={`rounded-xl p-6 border ${bgCard}`}>
                <div className="flex items-center gap-3 mb-1">
                  <LinkIcon size={20} className="text-emerald-500" />
                  <h2 className={`text-lg font-bold ${textHead}`}>URL Builder — Google Ads + Ratoeira</h2>
                </div>
                <p className={`text-sm ${textMuted} mb-5`}>
                  Cole a URL da sua presell/landing page abaixo. Os parâmetros padrão já estão preenchidos com os valores dinâmicos do Google Ads e o rastreamento da Ratoeira.
                </p>

                {/* URL BASE */}
                <div className="mb-5">
                  <label className={`block text-xs font-bold mb-2 ${textMuted}`}>URL Base (sua presell ou landing page)</label>
                  <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 ${isDark ? 'bg-slate-950 border-slate-700 focus-within:border-emerald-500' : 'bg-white border-slate-200 focus-within:border-emerald-400'} transition-colors`}>
                    <ExternalLink size={15} className="text-emerald-400 shrink-0" />
                    <input
                      type="url"
                      value={urlBase}
                      onChange={e => setUrlBase(e.target.value)}
                      placeholder="https://seusite.com/presell"
                      className={`flex-1 bg-transparent outline-none text-sm ${textHead} placeholder:text-slate-500`}
                    />
                  </div>
                </div>

                {/* PARÂMETROS */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className={`text-xs font-bold uppercase ${textMuted}`}>Parâmetros</p>
                    <button onClick={addParam} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-600 hover:text-black'}`}>
                      <Plus size={12} /> Adicionar
                    </button>
                  </div>

                  <div className="space-y-2">
                    {urlParams.map((param, idx) => (
                      <div key={idx} className={`flex items-center gap-2 p-2 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                        {/* Badge tipo */}
                        <span className={`shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${param.locked ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
                          param.ratoeira ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                            'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                          }`}>
                          {param.locked ? 'UTM*' : param.ratoeira ? 'Ratoeira' : 'UTM'}
                        </span>
                        {/* Key */}
                        <input
                          type="text"
                          value={param.key}
                          readOnly={param.locked}
                          onChange={e => updateParam(idx, 'key', e.target.value)}
                          className={`w-28 bg-transparent outline-none text-xs font-mono ${param.locked ? textMuted : textHead} shrink-0`}
                        />
                        <span className={`text-slate-500 shrink-0`}>=</span>
                        {/* Value */}
                        <input
                          type="text"
                          value={param.value}
                          onChange={e => updateParam(idx, 'value', e.target.value)}
                          className={`flex-1 bg-transparent outline-none text-xs font-mono ${textHead}`}
                        />
                        {/* Remove */}
                        {!param.locked && (
                          <button onClick={() => removeParam(idx)} className="shrink-0 p-1 rounded text-slate-500 hover:text-rose-400 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* LEGENDA */}
                <div className="flex flex-wrap gap-3 mb-5 text-[10px]">
                  <span className="flex items-center gap-1"><span className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded font-bold">UTM*</span> <span className={textMuted}>Obrigatório para AutoMetrics</span></span>
                  <span className="flex items-center gap-1"><span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">Ratoeira</span> <span className={textMuted}>Parâmetro de rastreamento Ratoeira Ads</span></span>
                  <span className="flex items-center gap-1"><span className="bg-slate-500/20 text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded font-bold">UTM</span> <span className={textMuted}>Parâmetro UTM padrão (editável)</span></span>
                </div>
              </div>

              {/* URL GERADA */}
              <div className={`rounded-xl p-6 border ${bgCard}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-sm font-bold ${textHead}`}>URL Final Gerada</p>
                  <button
                    onClick={copyUrl}
                    disabled={!finalUrl}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all shrink-0 ${urlCopied ? 'bg-emerald-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-30 disabled:cursor-not-allowed'
                      }`}
                  >
                    {urlCopied ? <Check size={15} /> : <Copy size={15} />}
                    {urlCopied ? 'Copiado!' : 'Copiar URL'}
                  </button>
                </div>

                <div className={`rounded-xl p-4 font-mono text-xs break-all leading-relaxed border ${isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}>
                  {finalUrl || (
                    <span className="text-slate-500">Cole a URL base acima para ver o resultado aqui.</span>
                  )}
                </div>

                {finalUrl && (
                  <div className={`mt-4 p-3 rounded-lg border ${isDark ? 'bg-blue-500/5 border-blue-500/20' : 'bg-blue-50 border-blue-200'}`}>
                    <p className="text-xs text-blue-400 font-bold mb-1">📋 Onde usar esta URL:</p>
                    <p className={`text-xs ${textMuted}`}>
                      Esta URL vai no campo <strong>URL Final</strong> do seu anúncio no Google Ads.
                      Os valores entre chaves <code className={`${isDark ? 'bg-slate-800' : 'bg-slate-200'} px-1 rounded`}>{'{keyword}'}</code> serão substituídos automaticamente pelo Google no momento do clique.
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
