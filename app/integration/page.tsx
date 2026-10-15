"use client";

import React, { useState, useEffect } from 'react';
import {
  Copy, Check, Code, ArrowLeft, Zap, Calendar,
  Globe, Store, AlertCircle, Sun, Moon, Link2, Tv2, Key, Eye, EyeOff, Save, CheckCircle2, 
  LayoutGrid, Target, Package, Settings, LogOut, Sparkles, Send, Route, CreditCard
} from 'lucide-react';
import Link from 'next/link';
import { TelegramCard } from './TelegramCard';
import { LootrushCard } from './LootrushCard';
import { Logo } from '@/app/components/Logo';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { applyTheme } from '@/lib/theme';
import { GoogleAdsApiPanel } from './GoogleAdsApiPanel';
import { Inter } from 'next/font/google';

// Fonte do guia visual (DESIGN.md), nas telas já migradas.
const inter = Inter({ subsets: ['latin'], display: 'swap' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function IntegrationPage() {
  const router = useRouter();
  const { authChecked } = useAuthGuard();
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [startDate, setStartDate] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  // Dono do Autometrics vê o link do painel de consumo da IA.
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const res = await fetch('/api/ai-admin?check=1', { headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => null);
      setIsOwner(!!res?.ok);
    });
  }, []);

  const [accountType, setAccountType] = useState<'mcc' | 'single'>('mcc');
  const [identifierName, setIdentifierName] = useState('');

  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // VTurb token
  const [vturbToken, setVturbToken] = useState('');
  const [vturbTokenInput, setVturbTokenInput] = useState('');
  const [vturbTokenSaving, setVturbTokenSaving] = useState(false);
  const [vturbTokenSaved, setVturbTokenSaved] = useState(false);
  const [vturbTokenVisible, setVturbTokenVisible] = useState(false);

  // Aba ativa
  const [activeTab, setActiveTab] = useState<'google' | 'vturb' | 'telegram' | 'cartoes'>('google');





  useEffect(() => {
    // Tema
    const savedTheme = localStorage.getItem('autometrics_theme') as 'dark' | 'light';
    if (savedTheme) { setTheme(savedTheme); }
    applyTheme(savedTheme || 'dark');

    async function getUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }
      setUserId(session.user.id);
      setUserEmail(session.user.email || '');

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
    applyTheme(newTheme);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleGenerateScript = () => {
    if (!identifierName) return alert("Por favor, digite um nome para identificar esta conta/grupo.");

    const commonFunctions = `
// Identifica esta versao no log e no painel. Serve para conferir, sem abrir o
// banco, se o script colado no gerenciador e mesmo o mais recente.
const SCRIPT_VERSION = 'v9';

// Nivel de campos opcionais da query (ver buildCampaignQuery). Comeca no mais
// completo e desce sozinho se a API do gerenciador nao reconhecer algum campo.
let QUERY_LEVEL = 0;

function processAccount(account) {
  let currentDate = parseDate(CONFIG.START_DATE);
  const today = new Date(); 
  today.setHours(0,0,0,0);
  currentDate.setHours(0,0,0,0);

  if (currentDate > today) currentDate = today;

  // Conta suspensa por pagamento/politica: as campanhas continuam ENABLED,
  // quem denuncia a suspensao e o status da conta. Busca uma vez so.
  const accountStatus = getAccountStatus();
  if (accountStatus !== 'ENABLED' && accountStatus !== 'UNKNOWN') {
    Logger.log('⚠️ Conta ' + account.getName() + ' com status ' + accountStatus);
  }

  while (currentDate <= today) {
    const dateString = Utilities.formatDate(currentDate, account.getTimeZone(), "yyyy-MM-dd");
    try {
      fetchAndSend(dateString, account, accountStatus);
    } catch (e) {
      Logger.log('Erro no dia ' + dateString + ': ' + e.message);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

/**
 * Lista TODAS as contas filhas do gerenciador, com o status de cada uma.
 *
 * AdsManagerApp.accounts() devolve apenas as contas que o script consegue
 * abrir — conta suspensa fica de fora, sem aviso. Por isso as campanhas dela
 * nunca eram atualizadas e o painel seguia mostrando o ultimo status conhecido,
 * normalmente "ativo". customer_client enxerga essas contas.
 *
 * Roda no contexto do gerenciador, antes do primeiro select().
 */
function fetchAccountDirectory() {
  const lista = [];
  try {
    const r = AdsApp.search(
      "SELECT customer_client.descriptive_name, customer_client.status, customer_client.manager " +
      "FROM customer_client WHERE customer_client.level <= 1"
    );
    while (r.hasNext()) {
      const row = r.next();
      const c = row.customerClient || {};
      if (c.manager) continue; // gerenciadores nao tem campanhas
      lista.push({ name: c.descriptiveName || '', status: c.status || 'UNKNOWN' });
    }
  } catch (e) {
    Logger.log('Diretorio de contas indisponivel: ' + e.message);
  }
  return lista;
}

/**
 * Conta que aparece no diretorio mas o script nao conseguiu abrir: informa o
 * painel para que as campanhas dela deixem de figurar como ativas.
 */
function reportUnreachableAccounts(directory, visitadas) {
  const fora = [];
  for (let i = 0; i < directory.length; i++) {
    const c = directory[i];
    if (!c.name || visitadas[c.name]) continue;
    fora.push({ name: c.name, status: c.status });
  }
  if (!fora.length) return;

  Logger.log('⚠️ ' + fora.length + ' conta(s) nao acessivel(is): ' +
             fora.map(function (c) { return c.name + ' (' + c.status + ')'; }).join(', '));

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      user_id: CONFIG.USER_ID,
      mcc_name: CONFIG.MCC_NAME,
      script_version: SCRIPT_VERSION,
      accounts: fora
    }),
    muteHttpExceptions: true
  };
  try {
    const resp = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL + '/accounts', options);
    Logger.log('   status das contas enviado: HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText());
  } catch (e) {
    Logger.log('   falha ao enviar status das contas: ' + e.message);
  }
}

/**
 * Extrai o de/para dos campos alterados num change_event.
 *
 * changed_fields diz QUAIS campos mudaram; old_resource e new_resource trazem o
 * recurso antes e depois. Cruzando os tres da para dizer "orcamento: 100 -> 110",
 * que e como o proprio Google apresenta, em vez de so "CAMPAIGN_BUDGET (UPDATE)".
 */
function describeChanges(ev) {
  const out = [];
  try {
    const campos = ev.changedFields;
    const lista = !campos ? [] : (typeof campos === 'string' ? campos.split(',') : (campos.paths || campos));
    if (!lista || !lista.length) return out;

    for (let i = 0; i < lista.length; i++) {
      const caminho = String(lista[i]).trim();
      if (!caminho) continue;
      const antes = valorNoCaminho(ev.oldResource, caminho);
      const depois = valorNoCaminho(ev.newResource, caminho);
      if (antes === undefined && depois === undefined) continue;
      out.push({ f: caminho, de: formatarValor(antes), para: formatarValor(depois) });
    }
  } catch (e) { /* diagnostico e opcional: nunca derruba a coleta */ }
  return out;
}

/** Caminha por 'campaign.campaign_budget.amount_micros' dentro do recurso. */
function valorNoCaminho(recurso, caminho) {
  if (!recurso) return undefined;
  const partes = caminho.split('.');
  let atual = recurso;
  for (let i = 0; i < partes.length; i++) {
    if (atual === null || atual === undefined) return undefined;
    // a API devolve camelCase; changed_fields vem em snake_case
    const chave = partes[i].replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
    atual = atual[chave] !== undefined ? atual[chave] : atual[partes[i]];
  }
  return atual;
}

/** micros viram valor legivel; o resto vai como texto. */
function formatarValor(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  const n = Number(v);
  if (!isNaN(n) && Math.abs(n) >= 10000 && n % 10000 === 0) return String(n / 1000000);
  return String(v);
}

function getAccountStatus() {
  try {
    const r = AdsApp.search("SELECT customer.status FROM customer LIMIT 1");
    if (r.hasNext()) return r.next().customer.status || 'UNKNOWN';
  } catch (e) {
    Logger.log('Status da conta indisponivel: ' + e.message);
  }
  return 'UNKNOWN';
}

/**
 * Monta a query por nivel de campos opcionais.
 *
 * 0 = serving_status + primary_status   (melhor diagnostico)
 * 1 = so serving_status                 (primary_status nao existe nesta API)
 * 2 = nenhum dos dois                   (so o basico, sempre funciona)
 *
 * Os campos de status variam conforme a versao da API que o gerenciador usa.
 * Sem esta escada, um unico campo desconhecido derruba a coleta inteira.
 */
function buildCampaignQuery(dateString, level) {
  let extras = '';
  if (level <= 1) extras += 'campaign.serving_status, ';
  if (level <= 0) extras += 'campaign.primary_status, campaign.primary_status_reasons, ';
  return \`
    SELECT
      campaign.id, campaign.name, campaign.status,
      \${extras}metrics.impressions, metrics.clicks, metrics.ctr,
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
  \`;
}

function fetchAndSend(dateString, account, accountStatus) {
  // IMPORTANTE: nao filtrar por metrics.impressions > 0 aqui.
  // Campanha pausada/suspensa tem 0 impressoes e sumia completamente do relatorio,
  // impedindo que o painel recebesse o status atual dela.
  //
  // Desce um nivel a cada campo recusado e guarda o nivel que funcionou, para
  // nao repetir a tentativa a cada dia e a cada conta.
  let report = null;
  while (report === null) {
    try {
      report = AdsApp.search(buildCampaignQuery(dateString, QUERY_LEVEL));
    } catch (e) {
      if (QUERY_LEVEL >= 2) throw e;
      QUERY_LEVEL++;
      Logger.log('⚠️ Campo de status recusado pela API (' + e.message + '). Reduzindo para o nivel ' + QUERY_LEVEL + '.');
    }
  }

  while (report.hasNext()) {
    const row = report.next();
    // Um erro em uma campanha nao pode derrubar as demais do mesmo dia.
    try {
      processCampaignRow(row, dateString, account, accountStatus);
    } catch (e) {
      const cname = (row && row.campaign && row.campaign.name) || '?';
      Logger.log('Erro na campanha ' + cname + ' em ' + dateString + ': ' + e.message);
    }
  }
}

function processCampaignRow(row, dateString, account, accountStatus) {
  const m = row.metrics || {};
  const impressions = Number(m.impressions || 0);
  const clicks = Number(m.clicks || 0);
  const costMicros = Number(m.costMicros || 0);
  const c = row.campaign || {};
  const status = c.status || 'UNKNOWN';
  const servingStatus = c.servingStatus || '';
  const primaryStatus = c.primaryStatus || '';
  const statusReasons = (c.primaryStatusReasons || []).join(',');

  // ----------------------------------------------------
  // BUSCA DEEP METRICS (Termos, Publicos, Local)
  // Apenas para os ultimos 3 dias para economizar cota do Google (Bandwidth limit)
  // ----------------------------------------------------
  const loopDate = parseDate(dateString);
  const todayDiff = new Date();
  todayDiff.setHours(0,0,0,0);
  const timeDiff = Math.abs(todayDiff.getTime() - loopDate.getTime());
  const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
  const isRecent = diffDays <= 3;

  const hasActivity = impressions > 0 || clicks > 0 || costMicros > 0;

  // Sem atividade: so envia nos dias recentes, para o painel receber o status
  // atual (PAUSED / suspensa) sem inflar o historico antigo com linhas zeradas.
  // Campanha removida sem atividade nao interessa em nenhum caso.
  if (!hasActivity && (!isRecent || status === 'REMOVED')) return;

    let finalUrl = '';
    try {
      const adQuery = "SELECT ad_group_ad.ad.final_urls FROM ad_group_ad WHERE campaign.id = " + row.campaign.id + " AND ad_group_ad.status != 'REMOVED' LIMIT 1";
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

    let searchTerms = [];
    let audiences = [];
    let locations = [];
    let history = [];

    if (isRecent && hasActivity) {
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
        stMap[term].i += Number(stRow.metrics.impressions || 0);
        stMap[term].cl += Number(stRow.metrics.clicks || 0);
        stMap[term].c += Number(stRow.metrics.costMicros || 0);
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
        audienceMap[key].i += Number(aRow.metrics.impressions || 0);
        audienceMap[key].cl += Number(aRow.metrics.clicks || 0);
        audienceMap[key].c += Number(aRow.metrics.costMicros || 0);
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
        audienceMap[key].i += Number(aRow.metrics.impressions || 0);
        audienceMap[key].cl += Number(aRow.metrics.clicks || 0);
        audienceMap[key].c += Number(aRow.metrics.costMicros || 0);
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
        audienceMap[key].i += Number(aRow.metrics.impressions || 0);
        audienceMap[key].cl += Number(aRow.metrics.clicks || 0);
        audienceMap[key].c += Number(aRow.metrics.costMicros || 0);
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
        audienceMap[key].i += Number(dRow.metrics.impressions || 0);
        audienceMap[key].cl += Number(dRow.metrics.clicks || 0);
        audienceMap[key].c += Number(dRow.metrics.costMicros || 0);
      }
    } catch(e) {}

    audiences = Object.values(audienceMap);

    // 4. Localizações — geographic_view
    try {
      const GEO_NAMES = {
        '2076': 'Brasil', '2840': 'Estados Unidos', '2826': 'Reino Unido',
        '2124': 'Canadá', '2036': 'Austrália', '2250': 'França',
        '2276': 'Alemanha', '2724': 'Espanha', '2380': 'Itália',
        '2392': 'Japão', '2484': 'México', '2032': 'Argentina',
        '2152': 'Chile', '2170': 'Colômbia', '2604': 'Peru',
        '2620': 'Portugal', '2703': 'Eslováquia', '2528': 'Países Baixos',
        '2056': 'Bélgica', '2040': 'Áustria', '2616': 'Polônia'
      };
      const locQuery = \`
        SELECT campaign.id, geographic_view.country_criterion_id, geographic_view.location_type,
               metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM geographic_view
        WHERE segments.date = '\${dateString}' AND campaign.id = \${row.campaign.id}
          AND metrics.impressions > 0
        ORDER BY metrics.impressions DESC
        LIMIT 30
      \`;
      const locMap = {};
      const locReport = AdsApp.search(locQuery);
      while(locReport.hasNext()){
        const lRow = locReport.next();
        const countryId = String(lRow.geographicView.countryCriterionId);
        const countryName = GEO_NAMES[countryId] || ('País ' + countryId);
        // Usa apenas a row com mais impressões por país (evita somar hierarquia país+estado+cidade)
        const lImpr = Number(lRow.metrics.impressions || 0);
        if (!locMap[countryId] || lImpr > locMap[countryId].i) {
          locMap[countryId] = {
            tp: 'Country',
            n: countryName,
            i: lImpr,
            cl: Number(lRow.metrics.clicks || 0),
            c: Math.round(Number(lRow.metrics.costMicros || 0) / 1000) // em milésimos de dólar (divide final na API)
          };
        }
      }
      locations = Object.values(locMap).slice(0, 5);
    } catch(e) { Logger.log('Loc error: ' + e.message); }

    // 5. Histórico de Alterações (Change Event)
    try {
      const histQuery = \`
        SELECT
          change_event.change_date_time,
          change_event.change_resource_type,
          change_event.resource_change_operation,
          change_event.user_email,
          change_event.changed_fields,
          change_event.old_resource,
          change_event.new_resource
        FROM change_event
        WHERE change_event.change_date_time >= '\${dateString} 00:00:00'
          AND change_event.change_date_time <= '\${dateString} 23:59:59'
          AND campaign.id = \${row.campaign.id}
        LIMIT 20
      \`;
      const histReport = AdsApp.search(histQuery);
      while (histReport.hasNext()) {
        const hRow = histReport.next();
        const rawDateTime = hRow.changeEvent.changeDateTime || '';
        let eventTime = rawDateTime.split(' ')[1] || '';
        if (eventTime.indexOf('.') !== -1) {
          eventTime = eventTime.split('.')[0];
        }
        const ev = hRow.changeEvent || {};
        const resourceType = ev.changeResourceType || '';
        const operation = ev.resourceChangeOperation || '';
        const user = ev.userEmail || '';

        history.push({
          time: eventTime,
          type: resourceType,
          op: operation,
          user: user,
          // De/para de cada campo alterado, para o painel poder mostrar
          // "Orcamento: 100 -> 110" em vez de apenas "CAMPAIGN_BUDGET (UPDATE)".
          fields: describeChanges(ev),
          // Mantido para nao quebrar quem ainda le o formato antigo.
          change: resourceType + ' (' + operation + ') por ' + user
        });
      }
    } catch (e) {
      Logger.log('History error: ' + e.message);
    }
    } // Fim do if (isRecent && hasActivity)

    // Campanha pausada/suspensa costuma vir sem orcamento e sem metricas de leilao.
    // Tudo com fallback para nao quebrar o envio.
    const budget = row.campaignBudget || {};
    const currency = (row.customer && row.customer.currencyCode) || account.getCurrencyCode();

    const payload = {
      script_version: SCRIPT_VERSION,
      user_id: CONFIG.USER_ID,
      campaign_name: row.campaign.name,
      campaign_id: row.campaign.id,
      date: dateString,
      account_name: account.getName(),
      mcc_name: CONFIG.MCC_NAME, 
      currency_code: currency,
      metrics: {
        impressions: impressions,
        clicks: clicks,
        ctr: m.ctr || 0,
        average_cpc: Number(m.averageCpc || 0),
        cost_micros: costMicros,
        search_impression_share: m.searchImpressionShare,
        search_top_impression_share: m.searchTopImpressionShare,
        search_abs_top_share: m.searchAbsoluteTopImpressionShare,
        bidding_strategy_type: row.campaign.biddingStrategyType,
        budget_micros: Number(budget.amountMicros || 0),
        status: status,
        serving_status: servingStatus,
        primary_status: primaryStatus,
        status_reasons: statusReasons,
        account_status: accountStatus,
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
           Logger.log('✅ OK | ' + (body.diag.status_src || '?') + ' | st:' + body.diag.st_recv + ' aud:' + body.diag.aud_recv + ' loc:' + body.diag.loc_recv + (body.diag.errors && body.diag.errors.length ? ' ERROS:' + JSON.stringify(body.diag.errors) : ''));
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
  Logger.log('🚀 Iniciando AutoMetrics ' + SCRIPT_VERSION + ' para: ' + CONFIG.MCC_NAME);

  // Antes de iterar: quais contas o gerenciador tem, e em que estado.
  const directory = fetchAccountDirectory();
  const visitadas = {};

  const accountIterator = AdsManagerApp.accounts().get();
  while (accountIterator.hasNext()) {
    const account = accountIterator.next();
    visitadas[account.getName()] = true;
    // Conta suspensa/cancelada faz o select() ou a leitura lancar excecao.
    // Sem este try/catch, uma unica conta com problema abortava o MCC inteiro.
    try {
      AdsManagerApp.select(account);
      processAccount(account);
    } catch (e) {
      Logger.log('⚠️ Conta ignorada (' + account.getName() + '): ' + e.message);
    }
  }

  // Contas que o iterador nem chegou a listar — tipicamente suspensas.
  reportUnreachableAccounts(directory, visitadas);

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
  Logger.log('🚀 Iniciando AutoMetrics ' + SCRIPT_VERSION + ' para: ' + CONFIG.MCC_NAME);
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
  const bgMain = 'bg-canvas text-ink-muted';
  const bgCard = 'bg-surface-1 border-line';
  const textHead = 'text-ink';
  const textMuted = 'text-ink-subtle';
  const borderCol = 'border-line';
  const navItem = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const field = 'w-full px-3 py-2.5 rounded-lg outline-none border bg-surface-2 border-line text-ink focus:border-brand transition-colors';
  const stepBadge = (n: number) => <span className="bg-brand w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white">{n}</span>;
  const NAV = [
    { href: '/dashboard', Icon: LayoutGrid, label: 'Dashboard', short: 'Dashboard' },
    { href: '/planning', Icon: Target, label: 'Metas', short: 'Metas' },
    { href: '/products', Icon: Package, label: 'Campanhas', short: 'Campanhas' },
    { href: '/analise-ia', Icon: Sparkles, label: 'Análise de IA', short: 'Análise IA' },
    { href: '/rastreamento', Icon: Route, label: 'Rastreamento', short: 'Rastreio' },
    { href: '/integration', Icon: Settings, label: 'Integração', short: 'Integração' },
  ];

  if (!authChecked) return <div className="min-h-screen bg-canvas" />;

  return (
    <div className={`${inter.className} min-h-screen font-sans flex ${bgMain}`}>

      {/* SIDEBAR DESKTOP */}
      <aside className="hidden md:flex md:w-60 shrink-0 border-r border-line bg-surface-1 flex-col sticky top-0 h-screen z-20">
        <div className="h-16 flex items-center justify-start px-5 border-b border-line overflow-hidden shrink-0">
          <Logo />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, Icon, label }) => (
            <Link key={href} href={href} aria-current={href === '/integration' ? 'page' : undefined}
              className={href === '/integration' ? `${navItem} bg-surface-2 text-ink` : `${navItem} text-ink-subtle hover:bg-surface-2 hover:text-ink`}>
              <Icon size={18} aria-hidden="true" className={href === '/integration' ? 'text-brand-text' : ''} /> <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-line">
          <button onClick={handleLogout} className={`${navItem} text-ink-subtle hover:text-neg hover:bg-neg/10`}>
            <LogOut size={18} aria-hidden="true" /> <span className="truncate">Sair ({userEmail.split('@')[0]})</span>
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
      <div className="w-full max-w-4xl mx-auto p-4 md:p-8">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" aria-label="Voltar para a Dashboard" className="w-8 h-8 flex items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
              <ArrowLeft size={16} aria-hidden="true" />
            </Link>
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-ink">Integração</h1>
              <p className={`text-sm ${textMuted}`}>Configure as conexões da sua conta.</p>
            </div>
          </div>
          <button onClick={toggleTheme} aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors">
            {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>

        {/* TAB NAV */}
        <div className="flex gap-1 p-1 rounded-lg mb-8 overflow-x-auto border border-line bg-surface-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([
            { key: 'google', icon: <Code size={15} aria-hidden="true" />, label: 'Google Ads' },
            { key: 'vturb', icon: <Tv2 size={15} aria-hidden="true" />, label: 'VTurb' },
            { key: 'telegram', icon: <Send size={15} aria-hidden="true" />, label: 'Telegram' },
            { key: 'cartoes', icon: <CreditCard size={15} aria-hidden="true" />, label: 'Cartões' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={activeTab === tab.key}
              className={`shrink-0 sm:shrink flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab.key
                ? 'bg-surface-3 text-ink'
                : `${textMuted} hover:text-ink`
                }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {isOwner && (
          <div className="-mt-4 mb-6 text-right">
            <Link href="/ia" className="text-xs text-brand-text hover:underline">Consumo da IA →</Link>
          </div>
        )}

        {/* ── ABA TELEGRAM: ligação com o bot e alertas ─────────── */}
        {activeTab === 'telegram' && <TelegramCard isDark={isDark} />}

        {/* ── ABA CARTÕES: LootRush ─────────────────────────────── */}
        {activeTab === 'cartoes' && <LootrushCard isDark={isDark} />}

        {/* ── ABA 1: GOOGLE ADS ────────────────────────────────── */}
        {activeTab === 'google' && (
          <>
            <div className="mb-8">
              <GoogleAdsApiPanel isDark={isDark} />
            </div>

            <h3 className={`text-sm font-medium mb-4 ${textMuted}`}>Script do Google Ads (método antigo)</h3>
            {!generatedScript ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className={`${bgCard} rounded-xl p-6 border`}>
                    <h3 className={`text-sm font-semibold mb-4 flex items-center gap-2 ${textHead}`}>
                      {stepBadge(1)}
                      Tipo de Conta Google
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <button onClick={() => setAccountType('mcc')} aria-pressed={accountType === 'mcc'} className={`p-4 rounded-lg border text-left transition-colors ${accountType === 'mcc' ? 'border-brand bg-brand/10' : `${borderCol} hover:border-line-strong`}`}>
                        <div className="flex justify-between items-start mb-2"><Globe className={accountType === 'mcc' ? 'text-brand-text' : 'text-ink-faint'} size={22} aria-hidden="true" />{accountType === 'mcc' && <Check size={16} aria-hidden="true" className="text-brand-text" />}</div>
                        <p className={`font-medium ${textHead}`}>Agência / MCC</p><p className={`text-xs mt-1 ${textMuted}`}>Várias sub-contas.</p>
                      </button>
                      <button onClick={() => setAccountType('single')} aria-pressed={accountType === 'single'} className={`p-4 rounded-lg border text-left transition-colors ${accountType === 'single' ? 'border-brand bg-brand/10' : `${borderCol} hover:border-line-strong`}`}>
                        <div className="flex justify-between items-start mb-2"><Store className={accountType === 'single' ? 'text-brand-text' : 'text-ink-faint'} size={22} aria-hidden="true" />{accountType === 'single' && <Check size={16} aria-hidden="true" className="text-brand-text" />}</div>
                        <p className={`font-medium ${textHead}`}>Conta Única</p><p className={`text-xs mt-1 ${textMuted}`}>Conta isolada.</p>
                      </button>
                    </div>
                  </div>

                  <div className={`${bgCard} rounded-xl p-6 border`}>
                    <h3 className={`text-sm font-semibold mb-4 flex items-center gap-2 ${textHead}`}>{stepBadge(2)} Identificação</h3>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="script-identifier" className={`block text-xs font-medium mb-2 ${textMuted}`}>{accountType === 'mcc' ? 'Nome da MCC' : 'Nome da Loja'}</label>
                        <input id="script-identifier" type="text" className={field} placeholder="Ex: Minha Loja" value={identifierName} onChange={(e) => setIdentifierName(e.target.value)} />
                      </div>
                      <div>
                        <label htmlFor="script-start-date" className={`block text-xs font-medium mb-2 ${textMuted}`}>Data Inicial</label>
                        <input id="script-start-date" type="date" className={`${field} dark:[&::-webkit-calendar-picker-indicator]:invert`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                      </div>
                    </div>
                  </div>
                  <button onClick={handleGenerateScript} className="w-full bg-brand hover:bg-brand-hover text-white py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"><Code size={18} aria-hidden="true" /> Gerar Script</button>
                </div>

                <div className="space-y-6">
                  <div className={`${bgCard} rounded-xl p-6 border`}>
                    <h3 className={`text-sm font-semibold mb-4 flex items-center gap-2 ${textHead}`}><Zap size={16} aria-hidden="true" className="text-warn" /> Instalação</h3>
                    <ol className={`space-y-4 text-sm list-decimal pl-4 ${textMuted}`}>
                      <li>Abra sua conta do Google Ads.</li>
                      <li>Vá em <strong>Ferramentas e Configurações</strong> {'>'} <strong>Ações em Massa</strong> {'>'} <strong>Scripts</strong>.</li>
                      <li>Clique no botão <strong>+</strong> para criar um novo.</li>
                      <li>Apague qualquer código que estiver lá.</li>
                      <li>Cole o script gerado.</li>
                      <li>Clique em <strong>Autorizar</strong> e depois em <strong>Salvar</strong>.</li>
                    </ol>
                  </div>
                  <div className="bg-pos/10 border border-pos/20 p-4 rounded-lg">
                    <p className="text-xs text-pos leading-relaxed mb-2"><strong>Dica Importante:</strong></p>
                    <p className="text-xs text-ink-muted leading-relaxed">
                      Na lista de scripts, altere a coluna <strong>Frequência</strong> de "Diariamente" para <strong>"A cada hora"</strong> (Hourly).
                      Isso garante que seus dados estejam sempre atualizados.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${bgCard} rounded-xl overflow-hidden border`}>
                <div className={`px-6 py-4 border-b flex justify-between items-center gap-4 bg-surface-2 border-line`}>
                  <div className="flex items-center gap-4">
                    <button onClick={() => setGeneratedScript(null)} aria-label="Voltar e gerar outro script" className="p-2 rounded-lg border border-line bg-surface-1 text-ink-subtle hover:text-ink hover:bg-surface-3 transition-colors"><ArrowLeft size={16} aria-hidden="true" /></button>
                    <div><h3 className={`font-semibold text-sm ${textHead}`}>Script Pronto</h3><p className="text-xs text-pos">{identifierName}</p></div>
                  </div>
                  <button onClick={copyToClipboard} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copied ? 'bg-pos text-white' : 'bg-brand hover:bg-brand-hover text-white'}`}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copiado!' : 'Copiar'}</button>
                </div>
                <div className="p-0 overflow-x-auto bg-surface-2"><pre className="font-mono text-xs text-ink-muted leading-relaxed p-6 min-h-[400px]">{generatedScript}</pre></div>
              </div>
            )}
          </>
        )}


        {/* ── ABA 4: VTURB ─────────────────────────────────────── */}
        {activeTab === 'vturb' && userId && (
          <div className={`rounded-xl p-6 border ${bgCard}`}>
            <div className="flex items-center gap-3 mb-1">
              <Tv2 size={18} aria-hidden="true" className="text-brand-text" />
              <h2 className={`text-base font-semibold ${textHead}`}>VTurb Analytics — Token de API</h2>
            </div>
            <p className={`text-sm ${textMuted} mb-5`}>
              Configure seu token de API do VTurb para visualizar métricas de vídeo
              (visualizações, plays, engajamento, cliques e conversões) diretamente nos produtos.
            </p>

            <div className={`flex flex-col gap-1 text-xs mb-5 p-4 rounded-lg border bg-surface-2 border-line`}>
              <p className={`font-medium mb-1 ${textHead}`}>Como obter o token:</p>
              {[
                '1. Acesse app.vturb.com e faça login',
                '2. Vá em Configurações → API (ou Integrações)',
                '3. Copie o token de API gerado',
                '4. Cole aqui abaixo e clique em Salvar',
              ].map(s => <p key={s} className={textMuted}>{s}</p>)}
            </div>

            <div className="flex items-center gap-3">
              <div className={`flex-1 flex items-center gap-2 rounded-xl border px-4 py-3 transition-colors bg-surface-2 border-line focus-within:border-brand`}>
                <Key size={16} aria-hidden="true" className="text-ink-subtle shrink-0" />
                <input
                  type={vturbTokenVisible ? 'text' : 'password'}
                  value={vturbTokenInput}
                  onChange={e => setVturbTokenInput(e.target.value)}
                  placeholder="Cole seu token VTurb aqui…"
                  aria-label="Token de API da VTurb"
                  className={`flex-1 bg-transparent outline-none text-sm font-mono ${textHead} placeholder:text-ink-faint`}
                />
                <button onClick={() => setVturbTokenVisible(v => !v)} className="p-1 rounded transition-colors text-ink-subtle hover:text-ink" title={vturbTokenVisible ? 'Ocultar token' : 'Mostrar token'} aria-label={vturbTokenVisible ? 'Ocultar token' : 'Mostrar token'}>
                  {vturbTokenVisible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                </button>
              </div>
              <button onClick={saveVturbToken} disabled={vturbTokenSaving || !vturbTokenInput.trim()}
                className={`flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-colors shrink-0 ${vturbTokenSaved ? 'bg-pos text-white' : 'bg-brand hover:bg-brand-hover text-white disabled:opacity-40 disabled:cursor-not-allowed'}`}>
                {vturbTokenSaved ? <CheckCircle2 size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                {vturbTokenSaving ? 'Salvando…' : vturbTokenSaved ? 'Salvo!' : 'Salvar'}
              </button>
            </div>

            {vturbToken && (
              <div className={`mt-4 flex items-center gap-2 text-xs p-3 rounded-lg border bg-pos/5 border-pos/20`}>
                <CheckCircle2 size={14} aria-hidden="true" className="text-pos shrink-0" />
                <span className="text-pos font-medium">Token configurado</span>
                <span className={`font-mono ${textMuted}`}>{vturbToken.slice(0, 8)}{'•'.repeat(Math.min(20, vturbToken.length - 8))}</span>
              </div>
            )}
          </div>
        )}


      </div>
      </main>

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden z-40 border-t border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex justify-around items-center px-2 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {NAV.map(({ href, Icon, short }) => {
            const active = href === '/integration';
            return (
              <Link key={href} href={href}
                aria-current={active ? 'page' : undefined} className={`flex flex-col items-center gap-1 flex-1 py-1 rounded-lg transition-colors ${active ? 'text-brand-text' : 'text-ink-subtle'}`}>
                <Icon size={22} aria-hidden="true" />
                <span className="text-[10px] font-medium">{short}</span>
              </Link>
            );
          })}
        </div>
      </nav>

    </div>
  );
}
