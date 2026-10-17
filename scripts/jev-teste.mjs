/**
 * Teste por fora do Jev (TypeSafe) na escolha da ação das sugestões da análise.
 *
 * Só lê o banco: nada é gravado no Supabase nem mexido no Google Ads.
 * Para cada sugestão já criada (analysis_suggestions), manda ao Jev a situação
 * do momento em faixas (o Jev erra conta com número cru, então a conta fica
 * aqui) e faz duas perguntas:
 *
 *   1. mexer agora ou esperar mais uns dias;
 *   2. qual alteração, dentro das permitidas para o item (actions.ts).
 *
 * Depois compara com o que aconteceu:
 *   - resolvida_sozinha  → voltou ao normal sem ninguém mexer: esperar era o certo;
 *   - avaliada           → o resultado medido (funcionou | piorou | sem_efeito);
 *   - nao_faz_sentido    → o afiliado recusou a sugestão;
 *   - a ação que o sistema escolheu hoje (IA de leitura ou regra do código).
 *
 * Uso:
 *   node scripts/jev-teste.mjs --dry      mostra o que seria enviado, sem chamar o Jev
 *   node scripts/jev-teste.mjs            roda (precisa de TYPESAFE_API_KEY no .env.local)
 *
 * Resultado em jev-teste-resultado.md e jev-teste-respostas.json (raiz do projeto).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js');

function loadEnv() {
  const env = { ...process.env };
  for (const file of [path.join(ROOT, '.env.local'), path.join(ROOT, '../../../.env.local')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i < 1 || line.startsWith('#')) continue;
      const k = line.slice(0, i).trim();
      if (!env[k]) env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const DRY = process.argv.includes('--dry');
const MODEL = process.env.JEV_MODEL || 'jev-1.14.0';
const CONCURRENCY = 6;

// Ações permitidas por item, com a descrição que vai para o Jev (lib/analysis/actions.ts).
const ACTIONS = {
  negativa: 'Add the search term as an exact negative keyword, so it stops showing ads',
  lance_palavra: 'Lower the bid of the keyword that triggers it, keeping it running with less spend',
  pausar_palavra: 'Pause the keyword entirely',
  ajuste_dispositivo: 'Lower the bid adjustment for this device',
  ajuste_publico: 'Lower the bid adjustment for this audience segment',
  excluir_publico: 'Exclude this audience segment entirely',
  ajuste_local: 'Lower the bid adjustment for this location',
  excluir_local: 'Exclude this location entirely',
  pausar_anuncio: 'Pause this ad',
  trocar_texto: 'Rewrite the headlines and descriptions of this ad, keeping it running',
  trocar_sitelink: 'Rewrite the text of this ad asset (sitelink, callout)',
  remover_sitelink: 'Remove this ad asset',
};
const ACTIONS_BY_ITEM = {
  termos: ['negativa', 'lance_palavra'],
  palavras_chave: ['lance_palavra', 'pausar_palavra'],
  dispositivos: ['ajuste_dispositivo'],
  publicos: ['ajuste_publico', 'excluir_publico'],
  locais: ['ajuste_local', 'excluir_local'],
  anuncios: ['pausar_anuncio', 'trocar_texto'],
  sitelinks: ['trocar_sitelink', 'remover_sitelink'],
};
const ITEM_EN = {
  termos: 'search term', palavras_chave: 'keyword', dispositivos: 'device', publicos: 'audience segment (age, gender)',
  locais: 'location', anuncios: 'ad', sitelinks: 'ad asset',
};

// Mesma regra do código quando a IA não responde (defaultAction em actions.ts).
function defaultAction(item, row) {
  if (item === 'termos') return row.conv3 > 0 ? 'lance_palavra' : 'negativa';
  if (item === 'palavras_chave') return row.conv7 > 0 ? 'lance_palavra' : 'pausar_palavra';
  if (item === 'publicos') return 'ajuste_publico';
  if (item === 'locais') return row.conv7 > 0 ? 'ajuste_local' : 'excluir_local';
  if (item === 'anuncios') return row.conv7 > 0 ? 'trocar_texto' : 'pausar_anuncio';
  if (item === 'sitelinks') return 'trocar_sitelink';
  return ACTIONS_BY_ITEM[item][0];
}

// ── Números viram faixas (o Jev lê melhor palavras do que números) ──────────
function salesBucket(n) {
  if (!n || n <= 0) return 'no sales';
  if (n < 1.5) return 'about 1 sale';
  if (n < 4) return 'a few sales (2-3)';
  return 'many sales (4 or more)';
}
function cpaVsTarget(row) {
  const p = row.pct;
  if (p === null || p === undefined) return 'unknown';
  if (row.conv3 > 0) {
    if (p < 0.9) return 'cost per sale clearly below the target (good)';
    if (p <= 1.1) return 'cost per sale close to the target';
    if (p <= 1.5) return 'cost per sale somewhat above the target';
    return 'cost per sale far above the target (bad)';
  }
  if (p < 0.5) return 'spent less than half of one target sale without selling';
  if (p <= 1) return 'spent between half and one full target sale without selling';
  if (p <= 2) return 'spent between one and two target sales without selling';
  return 'spent more than two target sales without selling';
}
function vsCampaign(rowCpa, campCpa) {
  if (rowCpa === null || rowCpa === undefined || !campCpa) return 'not comparable';
  const r = rowCpa / campCpa;
  if (r < 0.9) return 'better than the campaign average';
  if (r <= 1.1) return 'about the same as the campaign average';
  if (r <= 1.5) return 'somewhat worse than the campaign average';
  return 'much worse than the campaign average';
}
function share(cost, total) {
  const s = total > 0 ? cost / total : 0;
  return s < 0.1 ? 'small (under 10% of campaign spend)' : s <= 0.25 ? 'medium (10-25% of campaign spend)' : 'large (over 25% of campaign spend)';
}
function trend(row) {
  // 7 dias inclui os 3. Os 4 dias de antes = 7d − 3d.
  const costBefore = row.cost7 - row.cost3, convBefore = row.conv7 - row.conv3;
  if (costBefore <= 0) return 'no data before the last 3 days (new)';
  if (convBefore <= 0 && row.conv3 <= 0) return 'no sales in the whole week';
  if (convBefore <= 0) return 'sold in the last 3 days but not in the 4 days before';
  if (row.conv3 <= 0) return 'sold in the 4 days before but stopped selling in the last 3 days';
  const before = costBefore / convBefore, now = row.cpa3;
  if (now < before * 0.9) return 'cost per sale improving';
  if (now > before * 1.1) return 'cost per sale getting worse';
  return 'cost per sale stable';
}

function stateFor(s) {
  const b = s.baseline, row = b.row, camp = b.campaign?.d3 || {};
  const st = {
    item_type: ITEM_EN[s.item],
    item_name: row.label,
    target_mode: { venda: 'target = sale commission', meta_cpa: 'target = CPA goal', cpa_7d: 'target = 7-day campaign CPA' }[b.reference?.mode] || b.reference?.mode,
    last_3_days: {
      sales: salesBucket(row.conv3),
      versus_target: cpaVsTarget(row),
      versus_campaign: vsCampaign(row.cpa3, camp.cpa),
      share_of_spend: share(row.cost3, Number(camp.cost) || 0),
    },
    last_7_days: { sales: salesBucket(row.conv7) },
    trend: trend(row),
    campaign_last_3_days: { sales: salesBucket(camp.sales), status: camp.sales > 0 ? 'campaign is selling' : 'campaign has no sales' },
    sales_are_estimated: !!row.approx,
  };
  if (s.item === 'termos' && b.keyword) st.triggered_by_keyword = b.keyword;
  if (s.item === 'termos' && row.tag) st.match_type = row.tag;
  if (s.item === 'anuncios' && row.extra?.strength) st.ad_strength = String(row.extra.strength).toLowerCase();
  if (s.item === 'sitelinks' && row.tag) st.asset_type = row.tag;
  return st;
}

function questionsFor(s) {
  const allowed = ACTIONS_BY_ITEM[s.item];
  return {
    agir: {
      type: 'choice',
      instructions: 'A Google Ads affiliate is looking at this item flagged by an automatic check. Should they change it now, or wait a few more days because the numbers are too small or too close to normal to be sure?',
      criteria: {
        mudar_agora: 'Change now: the problem is clear and the item is losing money with enough data to be confident.',
        esperar: 'Wait: little data, close to the target, a recent change, or the item is still selling; it may return to normal on its own.',
      },
    },
    ...(allowed.length > 1 ? {
      acao: {
        type: 'choice',
        instructions: `If the affiliate changes this ${ITEM_EN[s.item]}, which change fits best? Prefer the milder option when the item still sells; prefer the stronger option when it spends without selling.`,
        criteria: Object.fromEntries(allowed.map(a => [a, ACTIONS[a]])),
      },
    } : {}),
  };
}

// O que o afiliado realmente fez no Google (quando a mudança foi detectada).
function actualAction(s) {
  const ch = s.change;
  if (!ch) return null;
  const f = (ch.fields || []).map(x => `${x.f}:${x.para}`).join(' ');
  if (s.item === 'anuncios') return /status:PAUSED|status:REMOVED/.test(f) ? 'pausar_anuncio' : 'trocar_texto';
  if (s.item === 'palavras_chave') return /status:PAUSED/.test(f) ? 'pausar_palavra' : 'lance_palavra';
  if (s.item === 'termos') return /NEGATIVE|negative/i.test(JSON.stringify(ch)) ? 'negativa' : 'lance_palavra';
  if (s.item === 'locais' || s.item === 'publicos') return /negative:true|REMOVED|EXCLU/i.test(JSON.stringify(ch)) ? (s.item === 'locais' ? 'excluir_local' : 'excluir_publico') : (s.item === 'locais' ? 'ajuste_local' : 'ajuste_publico');
  return s.action;
}

async function ask(state, questions) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const t0 = Date.now();
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Jev ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return { ...body, ms: Date.now() - t0 };
  }
  throw new Error('Jev não respondeu depois de 4 tentativas');
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

async function main() {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await db.from('analysis_suggestions')
    .select('id, item, action, status, outcome, baseline, change, created_at')
    .neq('item', 'pagina').order('created_at').limit(5000);
  if (error) throw error;
  const list = data.filter(s => s.baseline?.row && ACTIONS_BY_ITEM[s.item]);
  console.log(`${list.length} sugestões (sem página/VSL)`);

  if (DRY) {
    for (const s of [list.find(s => s.item === 'termos'), list.find(s => s.status === 'avaliada'), list.find(s => s.item === 'publicos')].filter(Boolean)) {
      console.log(JSON.stringify({ status: s.status, acao_do_sistema: s.action, state: stateFor(s), questions: questionsFor(s) }, null, 2));
    }
    const chars = list.reduce((n, s) => n + JSON.stringify(stateFor(s)).length + JSON.stringify(questionsFor(s)).length, 0);
    console.log(`\n~${Math.round(chars / 4).toLocaleString('pt-BR')} tokens de entrada no total ≈ US$ ${(chars / 4 / 1e6 * 0.042).toFixed(4)} (US$ 0,042 por milhão; saída grátis)`);
    return;
  }
  if (!env.TYPESAFE_API_KEY) throw new Error('Falta TYPESAFE_API_KEY no .env.local (crie em console.typesafe.ai/keys).');

  // Confere a chave e o modelo numa chamada só antes de mandar todas.
  await ask(stateFor(list[0]), questionsFor(list[0]));

  let done = 0;
  const rows = await pool(list, CONCURRENCY, async s => {
    const state = stateFor(s), questions = questionsFor(s);
    try {
      const r = await ask(state, questions);
      if (++done % 25 === 0) console.log(`${done}/${list.length}`);
      const agir = r.answers?.agir, acao = r.answers?.acao;
      return {
        id: s.id, item: s.item, status: s.status, outcome: s.outcome, created_at: s.created_at,
        sistema: s.action, regra: defaultAction(s.item, s.baseline.row), feito: actualAction(s),
        jev_agir: agir?.choice, jev_agir_conf: agir?.confidence, jev_agir_prob_esperar: agir?.probabilities?.esperar,
        jev_acao: acao?.choice || ACTIONS_BY_ITEM[s.item][0], jev_acao_conf: acao?.confidence ?? null,
        tokens: r.usage?.input_tokens || 0, ms: r.ms, modelo: r.model, state,
      };
    } catch (e) {
      return { id: s.id, item: s.item, status: s.status, erro: e.message };
    }
  });

  fs.writeFileSync(path.join(ROOT, 'jev-teste-respostas.json'), JSON.stringify(rows, null, 1));
  fs.writeFileSync(path.join(ROOT, 'jev-teste-resultado.md'), report(rows));
  console.log('Pronto: jev-teste-resultado.md');
}

function report(rows) {
  const ok = rows.filter(r => !r.erro);
  const errs = rows.length - ok.length;
  const tokens = ok.reduce((n, r) => n + r.tokens, 0);
  const ms = ok.map(r => r.ms).sort((a, b) => a - b);
  const L = [];
  L.push(`# Teste do Jev — escolha da ação das sugestões`, '');
  L.push(`Rodado em ${new Date().toLocaleString('pt-BR')} com \`${ok[0]?.modelo || MODEL}\`. Só leitura: nada foi gravado nem mexido no Google.`, '');
  L.push(`- Sugestões testadas: **${ok.length}**${errs ? ` (${errs} com erro)` : ''}`);
  L.push(`- Custo: ${tokens.toLocaleString('pt-BR')} tokens de entrada ≈ **US$ ${(tokens / 1e6 * 0.042).toFixed(4)}** no total (US$ ${(tokens / Math.max(ok.length, 1) / 1e6 * 0.042).toFixed(6)} por sugestão)`);
  L.push(`- Tempo por resposta: mediana ${ms[Math.floor(ms.length / 2)] || 0} ms, 90% abaixo de ${ms[Math.floor(ms.length * 0.9)] || 0} ms`, '');

  // 1. Esperar × mexer, contra o que aconteceu.
  L.push(`## 1. Mexer agora ou esperar`, '');
  L.push(`"Voltou sozinha" = a sugestão saiu da lista porque o item voltou ao normal sem ninguém mexer. Nesses casos, esperar era o certo.`, '');
  L.push(`| O que aconteceu | Sugestões | Jev disse esperar | Jev disse mexer agora |`, `|---|---|---|---|`);
  const groups = [
    ['Voltou sozinha', r => r.status === 'resolvida_sozinha'],
    ['Ainda aberta', r => r.status === 'aberta'],
    ['Aplicada, sem resultado ainda', r => r.status === 'aplicada'],
    ['Aplicada e funcionou', r => r.outcome === 'funcionou'],
    ['Aplicada e piorou', r => r.outcome === 'piorou'],
    ['Aplicada, sem efeito', r => r.outcome === 'sem_efeito'],
    ['O afiliado recusou', r => r.status === 'nao_faz_sentido' || r.status === 'ignorada'],
  ];
  for (const [label, f] of groups) {
    const g = ok.filter(f);
    if (!g.length) continue;
    const w = g.filter(r => r.jev_agir === 'esperar').length;
    L.push(`| ${label} | ${g.length} | ${w} (${pct(w, g.length)}) | ${g.length - w} (${pct(g.length - w, g.length)}) |`);
  }
  const conf = ok.filter(r => r.jev_agir_conf >= 0.7);
  const confSolved = conf.filter(r => r.status === 'resolvida_sozinha');
  L.push('', `Com confiança do Jev de 70% ou mais (${conf.length} sugestões): das que voltaram sozinhas (${confSolved.length}), ele mandou esperar em ${pct(confSolved.filter(r => r.jev_agir === 'esperar').length, confSolved.length)}.`, '');

  // 2. Qual ação.
  const multi = ok.filter(r => ACTIONS_BY_ITEM[r.item].length > 1);
  L.push(`## 2. Qual alteração (itens com mais de uma opção: ${multi.length})`, '');
  L.push(`| Item | Sugestões | Jev = sistema hoje | Jev = regra do código | Sistema hoje = regra |`, `|---|---|---|---|---|`);
  for (const item of Object.keys(ACTIONS_BY_ITEM)) {
    const g = multi.filter(r => r.item === item);
    if (!g.length) continue;
    L.push(`| ${item} | ${g.length} | ${pct(g.filter(r => r.jev_acao === r.sistema).length, g.length)} | ${pct(g.filter(r => r.jev_acao === r.regra).length, g.length)} | ${pct(g.filter(r => r.sistema === r.regra).length, g.length)} |`);
  }
  const did = ok.filter(r => r.feito && ACTIONS_BY_ITEM[r.item].length > 1);
  if (did.length) {
    L.push('', `### Onde o afiliado mexeu de verdade (${did.length})`, '');
    L.push(`| Item | O afiliado fez | Sistema sugeriu | Jev escolheu | Resultado |`, `|---|---|---|---|---|`);
    for (const r of did) L.push(`| ${r.item} | ${r.feito} | ${r.sistema} | ${r.jev_acao} | ${r.outcome || 'sem resultado ainda'} |`);
  }

  // 3. Casos em que o Jev discorda do sistema — para ler um a um.
  const dis = multi.filter(r => r.jev_acao !== r.sistema).slice(0, 25);
  if (dis.length) {
    L.push('', `## 3. Onde o Jev discorda do sistema (até 25, para conferir)`, '');
    L.push(`| Item | Alvo | Situação | Sistema | Jev | Confiança | Aconteceu |`, `|---|---|---|---|---|---|---|`);
    for (const r of dis) {
      const s = r.state;
      L.push(`| ${r.item} | ${String(s.item_name).slice(0, 40).replace(/\|/g, '/')} | ${s.last_3_days.sales}; ${s.last_3_days.versus_target}; ${s.trend} | ${r.sistema} | ${r.jev_acao} | ${r.jev_acao_conf === null ? '—' : Math.round(r.jev_acao_conf * 100) + '%'} | ${r.outcome || r.status} |`);
    }
  }
  L.push('', `## Como ler`, '');
  L.push(`- Só ${ok.filter(r => r.outcome).length} sugestões têm resultado medido: pouco para dizer quem acerta mais. O teste mostra se o Jev concorda com o sistema e se teria evitado mexer no que voltou sozinho.`);
  L.push(`- "Sistema hoje" é a ação gravada na sugestão (escolhida pela IA de leitura ou, sem ela, pela regra do código).`);
  return L.join('\n') + '\n';
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
