/**
 * Anotação automática do dia: cada alteração do histórico do Google escrita
 * como uma frase que qualquer pessoa lê ("Idade 45 a 54: ajuste de lance de
 * −40% para −90%"), em vez do nome técnico do campo.
 *
 * O histórico do Google diz só o campo que mudou; quem é a linha (qual idade,
 * qual aparelho, qual país) vem do número no fim do nome do item, que é fixo.
 *
 * Linhas: "[AUTO] HH:MM · frase". O que o usuário escreveu à mão fica intacto.
 */

export interface ChangeEntry {
  time: string;                 // HH:MM:SS, no fuso da conta
  type: string;                 // CAMPAIGN_CRITERION, AD_GROUP_CRITERION…
  op: string;                   // CREATE | UPDATE | REMOVE
  fields?: { f: string; de: string; para: string }[];
  /** Nome do item no Google (customers/1/adGroupCriteria/2~503004). Só a coleta pela API manda. */
  res?: string;
  /** Nome do local, quando o item é um país ou região. */
  geo?: string;
}

const AGE: Record<string, string> = { '503001': '18 a 24', '503002': '25 a 34', '503003': '35 a 44', '503004': '45 a 54', '503005': '55 a 64', '503006': '65 ou mais', '503999': 'desconhecida' };
const GENDER: Record<string, string> = { '10': 'homens', '11': 'mulheres', '20': 'desconhecido' };
// O Google numera a renda de baixo para cima: 510001 são os 50% de menor renda.
const INCOME: Record<string, string> = { '510000': 'desconhecida', '510001': '50% com menor renda', '510002': '41–50% superiores', '510003': '31–40% superiores', '510004': '21–30% superiores', '510005': '11–20% superiores', '510006': '10% com maior renda' };
const PARENT: Record<string, string> = { '300': 'com filhos', '301': 'sem filhos', '302': 'desconhecido' };
const DEVICE: Record<string, string> = { '30000': 'computador', '30001': 'celular', '30002': 'tablet', '30004': 'TV conectada' };
const DEVICE_TYPE: Record<string, string> = { DESKTOP: 'computador', MOBILE: 'celular', TABLET: 'tablet', CONNECTED_TV: 'TV conectada' };
const STRATEGY: Record<string, string> = {
  MAXIMIZE_CONVERSIONS: 'maximizar conversões', TARGET_CPA: 'CPA desejado', MAXIMIZE_CONVERSION_VALUE: 'maximizar valor das conversões',
  TARGET_ROAS: 'ROAS desejado', TARGET_SPEND: 'maximizar cliques', MANUAL_CPC: 'CPC manual', ENHANCED_CPC: 'CPC otimizado', TARGET_IMPRESSION_SHARE: 'parcela de impressões',
};
const GENERIC: Record<string, [string, 'o' | 'a']> = {
  CAMPAIGN: ['Campanha', 'a'], CAMPAIGN_BUDGET: ['Orçamento', 'o'], CAMPAIGN_CRITERION: ['Segmentação da campanha', 'a'], AD_GROUP: ['Grupo de anúncios', 'o'],
  AD_GROUP_AD: ['Anúncio', 'o'], AD: ['Texto do anúncio', 'o'], AD_GROUP_CRITERION: ['Segmentação do grupo', 'a'], AD_GROUP_BID_MODIFIER: ['Ajuste de lance do grupo', 'o'],
  CAMPAIGN_ASSET: ['Recurso da campanha (sitelink, frase de destaque…)', 'o'], AD_GROUP_ASSET: ['Recurso do grupo', 'o'], ASSET: ['Recurso', 'o'], CUSTOMER_ASSET: ['Recurso da conta', 'o'],
  CAMPAIGN_SHARED_SET: ['Lista compartilhada', 'a'], SHARED_SET: ['Lista compartilhada', 'a'], ASSET_SET: ['Conjunto de recursos', 'o'], BIDDING_STRATEGY: ['Estratégia de lances', 'a'],
  FEED: ['Feed', 'o'], AD_GROUP_FEED: ['Feed do grupo', 'o'], CAMPAIGN_FEED: ['Feed da campanha', 'o'],
};
const PAST: Record<string, string> = { CREATE: 'incluíd', UPDATE: 'alterad', REMOVE: 'removid' };
/** Nomes que a anotação antiga usava, para reescrever as linhas que ficaram sem detalhe. */
const OLD_LABEL: Record<string, string> = {
  'Campanha': 'CAMPAIGN', 'Orçamento': 'CAMPAIGN_BUDGET', 'Segmentação da campanha': 'CAMPAIGN_CRITERION', 'Grupo de anúncios': 'AD_GROUP', 'Anúncio': 'AD_GROUP_AD',
  'Palavra-chave / segmentação': 'AD_GROUP_CRITERION', 'Ajuste de lance': 'AD_GROUP_BID_MODIFIER', 'Recurso da campanha': 'CAMPAIGN_ASSET', 'Recurso do grupo': 'AD_GROUP_ASSET',
  'Recurso': 'ASSET', 'Anúncio do grupo': 'AD_GROUP_AD', 'Lista compartilhada': 'SHARED_SET', 'Conjunto de recursos': 'ASSET_SET', 'Recurso da conta': 'CUSTOMER_ASSET', 'Estratégia de lance': 'BIDDING_STRATEGY',
};
const OLD_OP: Record<string, string> = { criou: 'CREATE', alterou: 'UPDATE', removeu: 'REMOVE', criado: 'CREATE', alterado: 'UPDATE', removido: 'REMOVE' };
/** O que se cria; o resto se inclui na campanha. */
const CREATED = new Set(['CAMPAIGN', 'CAMPAIGN_BUDGET', 'AD_GROUP', 'AD_GROUP_AD']);

const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const money = (v: any) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 0,6 no Google = −40% na tela; vazio ou 1 = sem ajuste. */
const pct = (v: any) => { const p = v === '' || v === undefined || v === null ? 0 : Math.round((num(v) - 1) * 100); return p === 0 ? 'sem ajuste' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`; };
const fromTo = (f: { de: string; para: string }, fmt: (v: any) => string) => (f.de !== '' && f.para !== '' ? `de ${fmt(f.de)} para ${fmt(f.para)}` : f.para !== '' ? `agora ${fmt(f.para)}` : `retirado (era ${fmt(f.de)})`);
const generic = (type: string, op: string) => { const [name, g] = GENERIC[type] || ['Item da campanha', 'o']; return `${name} ${op === 'CREATE' && CREATED.has(type) ? 'criad' : PAST[op] || 'alterad'}${g}`; };
const keyword = (text: string, match: string) => (match === 'EXACT' ? `[${text}]` : match === 'PHRASE' ? `"${text}"` : text);

/** De quem é a linha: idade, gênero, renda, aparelho ou local. */
function subject(e: ChangeEntry, get: (name: string) => string): string {
  const id = String(e.res || '').split('~').pop() || get('criterion_id');
  if (AGE[id]) return `Idade ${AGE[id]}`;
  if (GENDER[id] && e.type === 'AD_GROUP_CRITERION') return `Gênero ${GENDER[id]}`;
  if (INCOME[id]) return `Renda ${INCOME[id]}`;
  if (PARENT[id] && e.type === 'AD_GROUP_CRITERION') return `Pais e mães: ${PARENT[id]}`;
  if (DEVICE[id]) return `Aparelho ${DEVICE[id]}`;
  if (e.type === 'CAMPAIGN_CRITERION' && e.geo) return `Local ${e.geo}`;
  if (e.type === 'CAMPAIGN_CRITERION' && /^[2-9]\d{3}$|^\d{5,7}$/.test(id)) return `Local (código ${id})`;
  return '';
}

/** Uma alteração em uma frase. Vazio quando a linha não diz nada sozinha (é o caso das faixas criadas sem ajuste). */
function sentence(e: ChangeEntry): { text: string; quiet?: string } {
  const fields = e.fields || [];
  const find = (name: string) => fields.find(f => f.f === name || f.f.endsWith(`.${name}`));
  const get = (name: string) => { const f = find(name); return f ? String(f.para || f.de || '') : ''; };
  const { type, op } = e;

  if (type === 'CAMPAIGN_BUDGET') {
    const f = find('amount_micros');
    return { text: f ? `Orçamento diário: ${fromTo(f, money)}` : generic(type, op) };
  }
  if (type === 'CAMPAIGN' || type === 'AD_GROUP') {
    const who = type === 'CAMPAIGN' ? 'Campanha' : 'Grupo de anúncios';
    const of = type === 'CAMPAIGN' ? '' : ' do grupo';
    if (op === 'CREATE') return { text: `${who} criad${type === 'CAMPAIGN' ? 'a' : 'o'}${get('name') ? `: ${get('name')}` : ''}` };
    const parts: string[] = [];
    for (const f of fields) {
      const last = f.f.split('.').pop();
      if (last === 'status') parts.push(`${who} ${f.para === 'PAUSED' ? `pausad` : f.para === 'ENABLED' ? 'reativad' : 'removid'}${type === 'CAMPAIGN' ? 'a' : 'o'}`);
      else if (last === 'target_cpa_micros') parts.push(`Meta de CPA${of}: ${fromTo(f, money)}`);
      else if (last === 'target_roas') parts.push(`Meta de ROAS${of}: ${fromTo(f, v => `${Math.round(num(v) * 100)}%`)}`);
      else if (last === 'cpc_bid_ceiling_micros') parts.push(`Limite de CPC: ${fromTo(f, money)}`);
      else if (last === 'cpc_bid_micros') parts.push(`Lance de CPC${of}: ${fromTo(f, money)}`);
      else if (last === 'bidding_strategy_type') parts.push(`Estratégia de lances: ${fromTo(f, v => STRATEGY[String(v)] || String(v).toLowerCase())}`);
      else if (last === 'name') parts.push(`Nome${of}: de "${f.de}" para "${f.para}"`);
      else if (last === 'start_date' || last === 'end_date') parts.push(`Data de ${last === 'start_date' ? 'início' : 'término'}: ${fromTo(f, String)}`);
    }
    return { text: parts.join('; ') || generic(type, op) };
  }
  if (type === 'AD_GROUP_CRITERION' || type === 'CAMPAIGN_CRITERION' || type === 'SHARED_CRITERION') {
    const text = get('text');
    const negative = type === 'SHARED_CRITERION' || get('negative') === 'true';
    if (text) {
      const kw = keyword(text, get('match_type'));
      const what = negative ? 'Negativa' : 'Palavra-chave';
      return { text: `${what} ${op === 'REMOVE' ? 'removida' : op === 'CREATE' ? 'incluída' : 'alterada'}: ${kw}` };
    }
    const who = subject(e, get);
    const bid = find('bid_modifier'), status = find('status');
    if (who) {
      if (op === 'REMOVE') return { text: `${who}: ajuste retirado` };
      if (negative && find('negative')) return { text: `${who}: excluído da campanha` };
      if (bid) return { text: `${who}: ajuste de lance ${op === 'CREATE' ? pct(bid.para) : fromTo({ de: bid.de === '' ? '1' : bid.de, para: bid.para === '' ? '1' : bid.para }, pct)}` };
      // Faixa criada sem ajuste: o Google cria todas de uma vez quando uma delas é alterada.
      if (op === 'CREATE') return { text: '', quiet: who.split(' ')[0] };
      // O Google não informa o valor do ajuste de aparelho e de local no histórico.
      return { text: `${who}: ajuste de lance alterado` };
    }
    if (status && type === 'AD_GROUP_CRITERION') return { text: `Palavra-chave ${status.para === 'PAUSED' ? 'pausada' : status.para === 'ENABLED' ? 'reativada' : 'removida'}` };
    if (bid) return { text: `Ajuste de lance: ${fromTo({ de: bid.de === '' ? '1' : bid.de, para: bid.para === '' ? '1' : bid.para }, pct)}` };
    if (find('cpc_bid_micros')) return { text: `Lance da palavra-chave: ${fromTo(find('cpc_bid_micros')!, money)}` };
    return { text: generic(type === 'SHARED_CRITERION' ? 'SHARED_SET' : type, op) };
  }
  if (type === 'AD_GROUP_BID_MODIFIER') {
    const bid = find('bid_modifier');
    const device = DEVICE_TYPE[get('type')] || DEVICE[String(e.res || '').split('~').pop() || ''];
    return { text: bid ? `Aparelho ${device || ''} (no grupo): ajuste de lance ${fromTo({ de: bid.de === '' ? '1' : bid.de, para: bid.para === '' ? '1' : bid.para }, pct)}`.replace('  ', ' ') : generic(type, op) };
  }
  if (type === 'AD_GROUP_AD') {
    const status = find('status');
    if (op === 'CREATE') return { text: 'Anúncio criado' };
    if (status) return { text: `Anúncio ${status.para === 'PAUSED' ? 'pausado' : status.para === 'ENABLED' ? 'reativado' : 'removido'}` };
  }
  if (type === 'AD') return { text: 'Títulos, descrições ou endereço do anúncio alterados' };
  return { text: generic(type, op) };
}

const AUTO = /^\[AUTO\] (\d\d:\d\d)(:\d\d)?\s*[-·]\s*(.*)$/;

/**
 * Reescreve as linhas automáticas do dia com o histórico recebido e devolve a
 * anotação inteira. Linhas automáticas de horários que não vieram desta vez
 * ficam (a outra fonte do histórico pode ter visto primeiro); as antigas sem
 * detalhe são reescritas em português simples.
 */
export function mergeAutoNotes(current: string, history: ChangeEntry[]): string {
  const manual: string[] = [];
  const kept = new Map<string, Set<string>>();                    // HH:MM → frases
  const add = (time: string, text: string) => { if (!kept.has(time)) kept.set(time, new Set()); kept.get(time)!.add(text); };
  const detailed = history.some(h => h.res);
  const incoming = new Set(history.map(h => h.time.slice(0, 5)));

  for (const line of String(current || '').split('\n')) {
    const m = line.match(AUTO);
    if (!m) { if (line.trim() || manual.length) manual.push(line); continue; }
    const [, time, , body] = m;
    const old = body.match(/^(.+?) — (criou|alterou|removeu|criado|alterado|removido)\s*(.*)$/);
    // Linha antiga: some quando o mesmo minuto chega agora com detalhe; sem isso, só vira frase simples.
    if (old) {
      if (incoming.has(time) && (detailed || !old[3])) continue;
      if (!old[3]) { add(time, generic(OLD_LABEL[old[1]] || '', OLD_OP[old[2]])); continue; }
      const value = old[3].match(/^(valor|CPA alvo): (\S+) → (\S+)$/);
      if (value) { add(time, `${value[1] === 'valor' ? 'Orçamento diário' : 'Meta de CPA'}: ${fromTo({ de: value[2] === '—' ? '' : value[2], para: value[3] === '—' ? '' : value[3] }, money)}`); continue; }
    } else if (incoming.has(time) && detailed) continue;
    add(time, /^Alteração —\s*$/.test(body) ? 'Alteração na campanha' : body);
  }

  // Alterações do mesmo minuto ficam numa linha só; faixas criadas sem ajuste viram um aviso curto, ou nada.
  const byTime = new Map<string, { texts: string[]; quiet: Set<string> }>();
  for (const h of [...history].sort((a, b) => a.time.localeCompare(b.time))) {
    const time = h.time.slice(0, 5);
    if (!detailed && kept.has(time)) continue;                    // histórico sem detalhe não repete o que já está escrito
    if (!byTime.has(time)) byTime.set(time, { texts: [], quiet: new Set() });
    const s = sentence(h), slot = byTime.get(time)!;
    if (s.text && !slot.texts.includes(s.text)) slot.texts.push(s.text);
    if (s.quiet) slot.quiet.add(s.quiet);
  }
  for (const [time, slot] of byTime) {
    for (const t of slot.texts) add(time, t);
    const said = (word: string) => slot.texts.some(t => t.startsWith(word));
    for (const word of slot.quiet) if (!said(word)) add(time, `${word}: faixas incluídas na campanha, sem ajuste de lance`);
  }

  const auto = [...kept.keys()].sort().flatMap(time => [...kept.get(time)!].map(text => `[AUTO] ${time} · ${text}`));
  while (manual.length && !manual[manual.length - 1].trim()) manual.pop();
  return [...manual, ...auto].join('\n');
}

/** Resumo para a célula da tabela: a anotação à mão, ou quantas alterações o dia teve. */
export function noteSummary(notes: string): string {
  const lines = String(notes || '').split('\n').filter(l => l.trim());
  const auto = lines.filter(l => AUTO.test(l));
  const manual = lines.filter(l => !AUTO.test(l));
  const first = auto[0]?.match(AUTO)?.[3] || '';
  const changes = auto.length === 1 ? first : auto.length ? `${auto.length} alterações no Google · ${first}` : '';
  return [manual[0], changes].filter(Boolean).join(' · ');
}
