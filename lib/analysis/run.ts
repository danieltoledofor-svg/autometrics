import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/googleAds/server';
import { aiEnabled, askJson } from '@/lib/ai/openrouter';
import { computeAnalysis, addDays, todayIn, ITEMS, worst, type Computed, type Item, type ItemKey, type Row, type Status } from './compute';
import { ACTIONS, ACTIONS_BY_ITEM, defaultAction, templateText, languageProblems } from './actions';
import { situationFor, learningsFor, campaignHistory } from './memory';
import { detectApplied, evaluateApplied, markPageApplied } from './track';
import { analyzePage, fetchPageText, landingUrl, pageHash, pageStatus, type PageResult } from './page';
import { formatMoney } from './labels';
import { funnelFor, vturbSuggestions, vturbFlagged, detectVturbApplied, pageHashNow as currentPageHash } from './vturbItem';
import { buildTopo, topoHash, writeTopoText } from '@/lib/vturb/topo';
import { memoryBlock, memoryFor } from './userMemory';

/**
 * Análise de uma campanha, do começo ao fim:
 *
 * 1. números e checklist (compute.ts) — toda vez, sem custo;
 * 2. acompanhamento das sugestões: aplicadas no Google e resultado (track.ts);
 * 3. item 8, página e VSL — só quando a página, a VSL ou os termos principais
 *    mudam, ou uma vez por semana;
 * 4. texto da IA (resumo e pontos de alteração) — só quando surge item novo
 *    fora do limite, quando algum item muda de status, ou uma vez por dia.
 *
 * Roda pelo agendador depois da coleta e pelo botão "Reanalisar".
 */

const PAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SUMMARY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Candidate {
  id: string;
  item: ItemKey;
  row: Row;
  keyword?: { text: string; match: string } | null;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export async function analysisTablesReady(): Promise<boolean> {
  const { error } = await supabaseAdmin().from('campaign_analyses').select('product_id').limit(1);
  return !error;
}

export async function runAnalysis(productId: string, opts: { force?: boolean } = {}) {
  const db = supabaseAdmin();
  const c = await computeAnalysis(productId);
  if (!c) return { error: 'Campanha não encontrada' };
  const userId = String(c.product.user_id);
  const money = (v: number) => formatMoney(v, c.reference.currency);

  const { data: previous } = await db.from('campaign_analyses').select('*').eq('product_id', productId).maybeSingle();

  // ── 2. Acompanhamento ────────────────────────────────────────────────────
  const applied = await detectApplied(productId, c.timeZone);
  const evaluated = await evaluateApplied(productId, c.today);

  // ── 3. Página e VSL ─────────────────────────────────────────────────────
  const transcript = String(c.product.vsl_transcript || '').trim();
  let page: PageResult | null = previous?.page || null;
  let pageHashNow: string | null = previous?.page_hash || null;
  let pageCheckedAt: string | null = previous?.page_checked_at || null;
  let newPage = false;
  if (transcript) {
    const url = landingUrl(c);
    if (!url) {
      page = { url: '', checked_at: new Date().toISOString(), resumo: '', grupos: [], achados: [], error: 'Nenhum anúncio ativo com página.' };
    } else if (!aiEnabled()) {
      page = { url, checked_at: new Date().toISOString(), resumo: '', grupos: [], achados: [], error: 'IA desligada (OPENROUTER_API_KEY).' };
    } else {
      try {
        const text = await fetchPageText(url);
        const h = pageHash(text, transcript, c);
        const stale = !pageCheckedAt || Date.now() - new Date(pageCheckedAt).getTime() > PAGE_MAX_AGE_MS;
        if (h !== pageHashNow || stale || opts.force || !page || page.error) {
          // Página ou VSL mudou depois de uma sugestão sobre ela: conta como aplicada.
          if (pageHashNow && h !== pageHashNow) await markPageApplied(productId, new Date().toISOString());
          page = await analyzePage(c, { url, pageText: text, transcript, userId });
          pageHashNow = h;
          pageCheckedAt = page.checked_at;
          newPage = true;
        }
      } catch (e: any) {
        page = { ...(page || { grupos: [], achados: [], resumo: '' }), url, checked_at: new Date().toISOString(), error: `Página não lida: ${e.message}` } as PageResult;
      }
    }
  } else {
    page = null;
  }

  // Topo de funil (VTurb + página + VSL) fica na aba VTurb; aqui só os
  // dados da campanha. As sugestões do topo continuam sendo criadas e
  // acompanhadas aqui, com item = 'pagina'.
  const funnel = await funnelFor(productId, c.product);
  const appliedVturb = await detectVturbApplied(c, funnel);
  const items: Item[] = [...c.items];

  // ── Sugestões: novas, mantidas e resolvidas ─────────────────────────────
  const { data: existing } = await db.from('analysis_suggestions').select('id, item, target_key, status, created_at, action, text, baseline')
    .eq('product_id', productId).in('status', ['aberta', 'aplicada']);
  const active = new Set((existing || []).map(s => `${s.item}|${s.target_key}`));
  const flaggedKeys = new Set<string>();
  const candidates: Candidate[] = [];
  // Sugestão só onde o problema se concentra: item com CPA pelo menos 10% pior
  // que o da campanha, ou gastando sem venda. Quando a campanha inteira está
  // acima do limite, todo segmento herda a cor — e apontar todos não diz nada.
  // No máximo 3 por item, pelos de maior gasto.
  const campaignCpa = c.numbers.d3.cpa === null ? null : Number(c.numbers.d3.cpa);
  for (const it of c.items) {
    const flagged = it.rows.filter(r => r.status === 'urgente' || r.status === 'alerta');
    for (const row of flagged) flaggedKeys.add(`${it.key}|${row.key}`);
    const specific = flagged
      .filter(r => r.conv3 <= 0 || r.cpa3 === null || campaignCpa === null || r.cpa3 >= campaignCpa * 1.1)
      .sort((a, b) => b.cost3 - a.cost3);
    let taken = (existing || []).filter(s => s.item === it.key).length;
    for (const row of specific) {
      if (taken >= 3) break;
      if (active.has(`${it.key}|${row.key}`)) continue;
      candidates.push({ id: `s${candidates.length + 1}`, item: it.key, row, keyword: it.key === 'termos' ? c.keywordByTerm.get(row.key) || null : null });
      taken++;
    }
  }
  // Sugestão aberta que ficou com o texto padrão (a IA estava desligada ou
  // falhou quando ela nasceu): a IA reescreve junto com os outros textos.
  const rowsNow = new Map(c.items.flatMap(it => it.rows.map(r => [`${it.key}|${r.key}`, r] as const)));
  const retext: (Candidate & { suggestionId: string; text: string })[] = [];
  for (const s of existing || []) {
    if (s.status !== 'aberta' || s.item === 'pagina' || !s.baseline?.row) continue;
    if (s.text !== templateText(s.item as ItemKey, s.action, s.baseline.row, s.baseline.keyword || null)) continue;
    const item = s.item as ItemKey;
    retext.push({
      id: `r${retext.length + 1}`, suggestionId: s.id, text: s.text, item,
      row: rowsNow.get(`${item}|${s.target_key}`) || s.baseline.row,
      keyword: item === 'termos' ? c.keywordByTerm.get(s.target_key) || null : null,
    });
  }

  // Voltou ao normal sem ninguém mexer: sai da lista depois de 3 dias.
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  for (const k of vturbFlagged(funnel)) flaggedKeys.add(k);
  const solved = (existing || []).filter(s => s.status === 'aberta' && (s.item !== 'pagina' || String(s.target_key).startsWith('vturb:'))
    && !flaggedKeys.has(`${s.item}|${s.target_key}`) && new Date(s.created_at).getTime() < threeDaysAgo);
  if (solved.length) {
    await db.from('analysis_suggestions').update({ status: 'resolvida_sozinha', updated_at: new Date().toISOString() }).in('id', solved.map(s => s.id));
  }

  // ── 4. Texto da IA ──────────────────────────────────────────────────────
  const summaryHash = hash(JSON.stringify([c.campaignStatus, c.reference.mode, items.map(i => [i.key, i.status]), [...flaggedKeys].sort()]));
  const summaryAge = previous?.summary?.generated_at ? Date.now() - new Date(previous.summary.generated_at).getTime() : Infinity;
  const needsText = opts.force || candidates.length > 0 || summaryHash !== previous?.summary_hash || summaryAge > SUMMARY_MAX_AGE_MS || !previous?.summary;

  let summary = previous?.summary || null;
  const texts = new Map<string, { action: string; text: string }>();
  if (needsText) {
    summary = templateSummary(c, items, money);
    if (aiEnabled() && c.reference.mode !== 'nenhuma') {
      try {
        const ai = await writeTexts(c, items, [...candidates, ...retext], userId, money);
        if (ai.resumo) summary = { ...summary, ...ai.resumo, source: 'ia' };
        for (const [id, t] of ai.pontos) texts.set(id, t);
      } catch (e: any) {
        summary = { ...summary, ai_error: e.message };
      }
    }
    summary.generated_at = new Date().toISOString();
  }

  // ── Resumo do topo de funil (aba VTurb) ─────────────────────────────────
  let topo: any = previous?.summary?.topo || null;
  if (funnel) {
    const h = topoHash(funnel, page, transcript);
    const age = topo?.generated_at ? Date.now() - new Date(topo.generated_at).getTime() : Infinity;
    if (opts.force || !topo || topo.hash !== h || age > SUMMARY_MAX_AGE_MS) {
      let t: { title: string; text: string } | null = null;
      if (aiEnabled() && funnel.d3.viewed > 0) {
        try { t = await writeTopoText(funnel, page, transcript, { userId, productId }); } catch { t = null; }
      }
      topo = { ...(t || funnel.summary), source: t ? 'ia' : 'modelo', generated_at: new Date().toISOString(), hash: h };
    }
    const b = buildTopo(funnel, page, transcript);
    const worstItem = b.items.find(i => i.status === b.status);
    topo = { ...topo, status: b.status, headline: worstItem ? `${worstItem.title.toLowerCase()} · ${worstItem.headline}` : null };
  } else topo = null;
  summary = { ...(summary || {}), topo };

  // Grava as sugestões novas com os números do momento.
  const campaignCost3 = Number(c.numbers.d3.cost) || 0;
  const rows = candidates.map(cd => {
    const t = texts.get(cd.id);
    const action = t?.action || defaultAction(cd.item, cd.row);
    const kwLabel = cd.keyword ? keywordText(cd.keyword) : null;
    return {
      user_id: userId, product_id: productId, item: cd.item, target_key: cd.row.key, target_label: cd.row.label,
      action, text: t?.text || templateText(cd.item, action, cd.row, kwLabel),
      severity: cd.row.status,
      baseline: {
        row: cd.row, campaign: { d3: c.numbers.d3, d7: c.numbers.d7 }, sales_source: c.numbers.salesSource,
        reference: { mode: c.reference.mode, value: c.reference.value },
        keyword: kwLabel,
        keyword_entity_id: cd.keyword ? c.keywordEntities.get(`${cd.keyword.text}|${cd.keyword.match}`) || null : null,
      },
      situation: situationFor(cd.item, cd.row, c.reference, campaignCost3),
    };
  });
  if (newPage && page && !page.error) {
    const { data: openPage } = await db.from('analysis_suggestions').select('target_key').eq('product_id', productId).eq('item', 'pagina').in('status', ['aberta', 'aplicada']);
    const have = new Set((openPage || []).map(s => s.target_key));
    for (const a of page.achados) {
      if (!a.ponto || a.nivel === 'ok' || have.has(slug(a.titulo))) continue;
      rows.push({
        user_id: userId, product_id: productId, item: 'pagina', target_key: slug(a.titulo), target_label: a.titulo,
        action: 'ajuste_pagina', text: a.ponto, severity: a.nivel,
        baseline: { row: null as any, campaign: { d3: c.numbers.d3, d7: c.numbers.d7 }, sales_source: c.numbers.salesSource, reference: { mode: c.reference.mode, value: c.reference.value }, keyword: null, keyword_entity_id: null },
        situation: { item: 'pagina', mode: c.reference.mode, faixa: a.nivel, com_venda: Number(c.numbers.d3.sales) > 0, tipo: a.titulo, peso: '' } as any,
      });
    }
  }
  for (const r of retext) {
    const t = texts.get(r.id);
    if (!t || t.text === r.text) continue;
    await db.from('analysis_suggestions').update({ action: t.action, text: t.text, updated_at: new Date().toISOString() })
      .eq('id', r.suggestionId).eq('status', 'aberta');
  }

  if (funnel) {
    let extra = vturbSuggestions(funnel, c, userId, active, null);
    if (extra.some(r => r.action === 'ajuste_pagina')) {
      const h = await currentPageHash(c);
      extra = extra.map(r => (r.action === 'ajuste_pagina' ? { ...r, baseline: { ...r.baseline, vturb: { ...r.baseline.vturb, page_hash: h } } } : r));
    }
    rows.push(...extra);
  }

  // Uma a uma: se outra rodada gravou o mesmo alvo antes, só aquela falha.
  for (const row of rows) {
    const { error } = await db.from('analysis_suggestions').insert(row);
    if (error && error.code !== '23505') console.warn('[análise] sugestão não gravada:', error.message);
  }

  const record = {
    product_id: productId,
    user_id: userId,
    computed_at: new Date().toISOString(),
    period: c.period,
    reference: c.reference,
    numbers: c.numbers,
    checklist: items,
    summary,
    summary_hash: summaryHash,
    page,
    page_hash: pageHashNow,
    page_checked_at: pageCheckedAt,
  };
  const { error } = await db.from('campaign_analyses').upsert(record, { onConflict: 'product_id' });
  if (error) return { error: error.message };
  return { ok: true, new_suggestions: rows.length, applied: applied + appliedVturb, evaluated, ai_text: needsText, page_checked: newPage };
}

function keywordText(k: { text: string; match: string }) {
  return k.match === 'EXACT' ? `[${k.text}]` : k.match === 'PHRASE' ? `"${k.text}"` : k.text;
}

function pct(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined || !b) return null;
  return Math.round(((a - b) / b) * 100);
}

/** Resumo sem IA — também é o que fica se a IA falhar. */
function templateSummary(c: Computed, items: Item[], money: (v: number) => string) {
  const d3 = c.numbers.d3, d7 = c.numbers.d7, ref = c.reference;
  let title: string;
  if (d3.cpa !== null && ref.value) title = `CPA de ${money(Number(d3.cpa))} nos últimos 3 dias, ${Math.round((Number(d3.cpa) / ref.value) * 100)}% ${ref.of}`;
  else if (d3.cpa !== null) title = `CPA de ${money(Number(d3.cpa))} nos últimos 3 dias`;
  else if (Number(d3.cost) > 0) title = `${money(Number(d3.cost))} gastos sem venda nos últimos 3 dias`;
  else title = 'Sem gasto nos últimos 3 dias';
  const parts: string[] = [];
  const cost = pct(Number(d3.cost_day), Number(d7.cost_day));
  const sales = pct(Number(d3.sales_day), Number(d7.sales_day));
  if (cost !== null) parts.push(`Gasto por dia ${cost > 2 ? `subiu ${cost}%` : cost < -2 ? `caiu ${-cost}%` : 'igual'}`);
  if (sales !== null) parts.push(`vendas por dia ${sales > 2 ? `subiram ${sales}%` : sales < -2 ? `caíram ${-sales}%` : 'iguais'}`);
  let text = parts.length ? `${parts.join(' e ')} em relação à média de 7 dias.` : '';
  if (Number(d7.sales) === 0 && Number(d7.cost) > 0) text = `${money(Number(d7.cost))} em 7 dias sem venda. ${text}`.trim();
  return { status: c.campaignStatus, title, text, source: 'modelo' } as any;
}

const SYSTEM = `Você escreve a leitura de uma campanha do Google Ads para um afiliado, a partir de números já calculados.

Regras de linguagem, obrigatórias:
- Português simples e direto. Frases curtas. Nada de termo técnico ou em inglês (proibido: mismatch, cluster, compliance, congruência, insight, performance, funil, "custo por ação"). Use as siglas CPA, CPC, CTR como o afiliado usa.
- Você só aponta, quem decide é o afiliado. Proibido: sugiro, recomendo, considere, tente, pause, ative, melhore, otimize, aumente, diminua, reduza, você deve, vale a pena, faz sentido, seria bom.
- O "ponto de alteração" é um substantivo que nomeia o elemento concreto: "Negativa exata \\"pink salt trick\\"", "Lance da palavra-chave [gelatin recipe]", "Ajuste de lance negativo na faixa Idade desconhecida".
- Não invente números. Use só os que vierem no pedido.
- Nunca mencione outras campanhas, outras contas ou outros usuários. O histórico geral serve só para escolher o tipo de alteração com mais chance de dar certo.

Para cada item em PONTOS, escolha "acao" dentro da lista permitida daquele item e escreva "texto" (até 140 caracteres).
Leve em conta o histórico: se um tipo de alteração piorou nesta campanha ou costuma piorar nessa situação, prefira outro da lista permitida.

Responda só com JSON:
{"resumo": {"title": "frase de até 90 caracteres com o principal de hoje, com o número", "text": "1 ou 2 frases explicando de onde veio a mudança"},
 "pontos": [{"id": "s1", "acao": "negativa", "texto": "..."}]}`;

async function writeTexts(c: Computed, items: Item[], candidates: Candidate[], userId: string, money: (v: number) => string) {
  const d3 = c.numbers.d3, d7 = c.numbers.d7;
  const n = (v: any, f: (x: number) => string) => (v === null || v === undefined ? '—' : f(Number(v)));
  const pctf = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
  const history = await campaignHistory(c.product.id, 15);
  const learnings = await learningsFor([...new Set(candidates.map(cd => cd.item))]);
  const notes = memoryBlock(await memoryFor(userId, { text: String(c.product.name || ''), productId: c.product.id }));

  const pontos = candidates.map(cd => {
    const r = cd.row;
    const rateio = r.approx ? ' (vendas reais rateadas pelo item)' : '';
    const nums = r.conv3 > 0
      ? `CPA 3d ${money(r.cpa3!)} (${Math.round((r.pct || 0) * 100)}% ${c.reference.of}), CPA 7d ${n(r.cpa7, money)}, gasto 3d ${money(r.cost3)}, vendas 3d ${r.conv3}`
      : `gasto 3d ${money(r.cost3)} sem venda (${Math.round((r.pct || 0) * 100)}% ${c.reference.of}), gasto 7d ${money(r.cost7)}, vendas 7d ${r.conv7}`;
    const extra = r.extra ? Object.entries(r.extra).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'number' && v < 1 && v > 0 ? pctf(v) : v}`).join(', ') : '';
    const allowed = ACTIONS_BY_ITEM[cd.item].map(a => `${a} (${ACTIONS[a]})`).join(', ');
    return `- id ${cd.id} · ${ITEMS.find(i => i.key === cd.item)!.title} · ${r.label}${r.tag ? ` [${r.tag}]` : ''}${cd.keyword ? ` · acionado pela palavra-chave ${keywordText(cd.keyword)}` : ''} · ${r.status} · ${nums}${rateio}${extra ? ` · ${extra}` : ''}\n  permitidas: ${allowed}`;
  }).join('\n');

  const hist = history.map(h => {
    const ev = h.eval_7d || h.eval_3d;
    const res = h.status === 'nao_faz_sentido' ? 'o usuário disse que não fazia sentido' : h.outcome ? `${h.outcome}${ev?.cpa_change !== null && ev?.cpa_change !== undefined ? ` (CPA ${ev.cpa_change > 0 ? '+' : ''}${ev.cpa_change}%)` : ''}` : 'aplicada, resultado ainda não saiu';
    return `- ${h.target_label}: ${ACTIONS[h.action] || h.action} → ${res}`;
  }).join('\n');

  const user = `Campanha: ${c.product.name}
Referência: ${c.reference.mode === 'venda' ? `valor médio da venda ${money(c.reference.value)}` : `${c.reference.basis}: ${money(c.reference.value)}`} · alerta a partir de ${money(c.reference.warn)} · urgente acima de ${money(c.reference.urgent)}

NÚMEROS (3 dias × média de 7 dias):
CPA ${n(d3.cpa, money)} × ${n(d7.cpa, money)} · gasto/dia ${n(d3.cost_day, money)} × ${n(d7.cost_day, money)} · vendas/dia ${d3.sales_day} × ${d7.sales_day} · CTR ${n(d3.ctr, pctf)} × ${n(d7.ctr, pctf)} · CPC ${n(d3.cpc, money)} × ${n(d7.cpc, money)} · visibilidade ${n(d3.visibility, pctf)} × ${n(d7.visibility, pctf)}

CHECKLIST:
${items.map(i => `- ${i.title}: ${i.status} · ${i.headline}`).join('\n')}

PONTOS (escreva um para cada):
${pontos || '(nenhum novo)'}

HISTÓRICO DESTA CAMPANHA:
${hist || '(nenhum ainda)'}

HISTÓRICO GERAL (contagens por situação; não citar a origem):
${learnings.join('\n') || '(nenhum ainda)'}${notes ? `\n\n${notes}` : ''}`;

  let raw: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await askJson({ fn: 'leitura', userId, productId: c.product.id, system: SYSTEM, user: attempt ? `${user}\n\nATENÇÃO: a resposta anterior usou palavras proibidas. Reescreva seguindo as regras de linguagem.` : user, maxTokens: 2000 });
    if (!languageProblems(JSON.stringify(raw)).length) break;
  }

  // Cada texto passa pela checagem sozinho: um ruim cai no texto padrão, os outros ficam.
  const out = new Map<string, { action: string; text: string }>();
  for (const p of Array.isArray(raw?.pontos) ? raw.pontos : []) {
    const cd = candidates.find(x => x.id === p?.id);
    if (!cd) continue;
    const action = ACTIONS_BY_ITEM[cd.item].includes(p.acao) ? p.acao : defaultAction(cd.item, cd.row);
    const text = String(p.texto || '').trim().slice(0, 200);
    if (text && !languageProblems(text).length) out.set(cd.id, { action, text });
    else out.set(cd.id, { action, text: templateText(cd.item, action, cd.row, cd.keyword ? keywordText(cd.keyword) : null) });
  }
  const title = String(raw?.resumo?.title || '').trim();
  const text = String(raw?.resumo?.text || '').trim();
  const resumo = title && !languageProblems(`${title} ${text}`).length ? { title: title.slice(0, 140), text: text.slice(0, 400) } : null;
  return { resumo, pontos: out };
}

// ── agendador ───────────────────────────────────────────────────────────────

const ANALYSIS_INTERVAL_MIN = Number(process.env.ANALYSIS_INTERVAL_MIN) || 60;

/**
 * Campanhas com gasto nos últimos 7 dias cuja leitura tem mais de uma hora,
 * da mais atrasada para a mais nova, até acabar o tempo da chamada.
 */
export async function runDueAnalyses(deadline: number) {
  const report: any[] = [];
  if (!(await analysisTablesReady())) return report;
  const db = supabaseAdmin();
  const since = addDays(todayIn('UTC'), -8);
  const productIds = new Set<string>();
  for (let page = 0; ; page++) {
    const { data } = await db.from('daily_metrics').select('product_id').gte('date', since).gt('cost', 0)
      .range(page * 1000, page * 1000 + 999);
    for (const d of data || []) productIds.add(d.product_id);
    if (!data || data.length < 1000) break;
  }
  if (!productIds.size) return report;
  const ids = [...productIds];
  const last = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('campaign_analyses').select('product_id, computed_at').in('product_id', ids.slice(i, i + 200));
    for (const a of data || []) last.set(a.product_id, new Date(a.computed_at).getTime());
  }
  const due = ids
    .filter(id => !last.has(id) || Date.now() - last.get(id)! >= ANALYSIS_INTERVAL_MIN * 60 * 1000)
    .sort((a, b) => (last.get(a) || 0) - (last.get(b) || 0));
  for (const id of due) {
    if (Date.now() > deadline) break;
    try {
      report.push({ product_id: id, ...(await runAnalysis(id)) });
    } catch (e: any) {
      report.push({ product_id: id, error: e.message });
    }
  }
  return report;
}
