import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/googleAds/server';
import { worst, type Computed, type Item, type Status } from './compute';
import { landingUrl, fetchPageText, pageStatus, type PageResult } from './page';
import { computeFunnel, pct, mmss, MIN_VIEWS } from '@/lib/vturb/funnel';
import { playerIdFrom } from '@/lib/vturb/client';

/**
 * Item 8 da Análise, "Página e vídeo": a VTurb (fuga da página, play, chegada
 * ao pitch, palavras-chave) junto com a leitura anúncio × página × VSL quando
 * a transcrição está salva.
 *
 * Pontos de alteração da VTurb (texto fixo, sem IA):
 * - fuga da página em ALERTA ou URGENTE → "Carregamento da página do vídeo";
 * - chegada ao pitch em ALERTA ou URGENTE → o trecho da VSL com a maior queda;
 * - palavra-chave com 30 visitas ou mais, pitch 25% abaixo da campanha ou fuga
 *   10 pontos acima → lance ou pausa da palavra-chave (o Google registra).
 *
 * Página e VSL não aparecem no histórico do Google: a mudança é percebida
 * pelo HTML da página (relido 1 vez por dia, sem IA), pela troca do player
 * ou do vídeo dentro dele. O resultado é medido pela própria fuga ou pitch.
 */

export type Funnel = Extract<NonNullable<Awaited<ReturnType<typeof computeFunnel>>>, { keywords: any }>;

const PAGE_CHECK_MS = 20 * 60 * 60 * 1000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const known = (list: Status[]) => list.filter(s => s !== 'sem_dado');

export async function funnelFor(productId: string, product: any): Promise<Funnel | null> {
  if (!playerIdFrom(product.vturb_player_id)) return null;
  const { error } = await supabaseAdmin().from('vturb_daily').select('product_id').limit(1);
  if (error) return null; // antes de migration_vturb.sql
  const f: any = await computeFunnel(productId).catch(() => null);
  return f?.ready ? f : null;
}

/** O resumo da VTurb que vai junto do item, para a tela e para a IA. */
function vturbSummary(f: Funnel) {
  const kws = f.keywords.rows.filter((r: any) => !r.small);
  const smallRows = f.keywords.rows.filter((r: any) => r.small);
  return {
    player: f.player, synced_at: f.synced_at,
    d3: { leak: f.d3.leak, play: f.d3.play, pitch: f.d3.pitch, salesPerPitch: f.d3.salesPerPitch, clicks: f.d3.clicks, viewed: f.d3.viewed },
    d7: { leak: f.d7.leak, play: f.d7.play, pitch: f.d7.pitch, salesPerPitch: f.d7.salesPerPitch },
    status: f.status,
    enough: f.d3.viewed >= MIN_VIEWS,
    retention: f.curve?.notes?.join(' · ') || null,
    pitch_time: f.player?.pitch_time || null,
    keywords: {
      source: f.keywords.source, visits: f.keywords.visits,
      rows: kws.slice(0, 15).map((r: any) => ({ key: r.key, label: r.label, viewed: r.viewed, leak: r.leak, pitch: r.pitch, pitchVs: r.pitchVs, leakVs: r.leakVs, sales: r.sales, status: r.status })),
      small: { count: smallRows.length, viewed: smallRows.reduce((s: number, r: any) => s + r.viewed, 0), sales: smallRows.reduce((s: number, r: any) => s + r.sales, 0) },
    },
  };
}

export function pageVideoItem(page: PageResult | null, hasTranscript: boolean, f: Funnel | null, money: (v: number) => string): Item {
  const v = f ? vturbSummary(f) : null;
  const kwBad = v?.keywords.rows.filter(r => r.status === 'alerta' || r.status === 'urgente') || [];
  const funnelStatuses: Status[] = v && v.enough ? [v.status.leak, v.status.pitch] : [];
  const pageS: Status = hasTranscript ? pageStatus(page) : 'sem_dado';
  const all = known([...funnelStatuses, ...kwBad.map(r => r.status as Status), pageS]);
  const status: Status = all.length ? worst(all) : 'sem_dado';

  const count = (s: Status) => funnelStatuses.filter(x => x === s).length + kwBad.filter(r => r.status === s).length
    + (hasTranscript ? page?.achados.filter(a => a.nivel === s).length || 0 : 0);

  let headline = 'Aguardando os primeiros números da VTurb';
  const badPage = hasTranscript && page && !page.error ? page.grupos.filter(g => g.conversa !== 'sim') : [];
  const alertOf = (s: Status) => s === 'alerta' || s === 'urgente';
  if (v && v.enough && alertOf(v.status.leak)) headline = `Fuga da página em ${pct(v.d3.leak)} em 3 dias (7d ${pct(v.d7.leak)})`;
  else if (v && v.enough && alertOf(v.status.pitch)) headline = `Chegada ao pitch em ${pct(v.d3.pitch)} em 3 dias (7d ${pct(v.d7.pitch)})`;
  else if (kwBad.length) {
    const k = kwBad[0];
    headline = k.pitchVs !== null && k.pitchVs <= -0.15
      ? `${k.label}: chegada ao pitch em ${pct(k.pitch)}, ${Math.round(-k.pitchVs * 100)}% abaixo da campanha`
      : `${k.label}: fuga da página em ${pct(k.leak)}`;
  } else if (badPage.length) {
    const g = badPage[0];
    headline = `Quem busca "${g.nome.toLowerCase()}" (${money(g.gasto3)} em 3 dias) ${g.conversa === 'nao' ? 'não encontra o assunto no começo da página' : 'encontra o assunto só em parte'}`;
  } else if (v && v.enough) headline = `Fuga da página ${pct(v.d3.leak)}, play ${pct(v.d3.play)}, pitch ${pct(v.d3.pitch)}: iguais à média`;
  else if (v) headline = `Só ${v.d3.viewed} vídeos carregados em 3 dias: menos de ${MIN_VIEWS}, sem semáforo`;
  else if (hasTranscript && page?.error) headline = page.error;
  else if (hasTranscript && page) headline = 'Os grupos de busca principais encontram o assunto na página e na VSL';
  else if (hasTranscript) headline = 'Aguardando a primeira leitura da página';

  return {
    key: 'pagina', title: 'Página e vídeo', status, headline, rows: [], others: null,
    counts: { urgente: count('urgente'), alerta: count('alerta'), ok: count('ok') },
    vturb: v,
  };
}

/** Sugestões novas da VTurb (texto fixo), no formato de analysis_suggestions. */
export function vturbSuggestions(f: Funnel, c: Computed, userId: string, active: Set<string>, pageHash: string | null) {
  const v = vturbSummary(f);
  const out: any[] = [];
  const baseline = (extra: Record<string, any>) => ({
    row: null, campaign: { d3: c.numbers.d3, d7: c.numbers.d7 }, sales_source: c.numbers.salesSource,
    reference: { mode: c.reference.mode, value: c.reference.value }, keyword: null, keyword_entity_id: null,
    vturb: { player_id: f.player?.id, duration: f.player?.duration, page_hash: pageHash, page_checked_at: new Date().toISOString(), ...extra },
  });
  const situation = (tipo: string, faixa: string) => ({ item: 'pagina', mode: c.reference.mode, faixa, com_venda: Number(c.numbers.d3.sales) > 0, tipo, peso: '' });
  const push = (row: any) => { if (!active.has(`pagina|${row.target_key}`)) out.push({ user_id: userId, product_id: c.product.id, item: 'pagina', ...row }); };

  if (!v.enough) return out;
  if (v.status.leak === 'alerta' || v.status.leak === 'urgente') {
    push({
      target_key: 'vturb:fuga', target_label: 'Página do vídeo', action: 'ajuste_pagina', severity: v.status.leak,
      text: `Carregamento da página do vídeo (fuga de ${pct(v.d3.leak)} em 3 dias, contra ${pct(v.d7.leak)})`,
      baseline: baseline({ metric: 'fuga', d3: v.d3.leak, d7: v.d7.leak }),
      situation: situation('fuga da página', v.status.leak),
    });
  }
  if (v.status.pitch === 'alerta' || v.status.pitch === 'urgente') {
    const drop = f.curve?.drop;
    push({
      target_key: 'vturb:pitch', target_label: 'VSL', action: 'ajuste_vsl', severity: v.status.pitch,
      text: drop
        ? `Trecho da VSL entre ${mmss(drop.from)} e ${mmss(drop.to)} (chegada ao pitch em ${pct(v.d3.pitch)}, contra ${pct(v.d7.pitch)})`
        : `Retenção da VSL antes do pitch (chegada ao pitch em ${pct(v.d3.pitch)}, contra ${pct(v.d7.pitch)})`,
      baseline: baseline({ metric: 'pitch', d3: v.d3.pitch, d7: v.d7.pitch, drop }),
      situation: situation('chegada ao pitch', v.status.pitch),
    });
  }
  let kwTaken = 0;
  for (const k of v.keywords.rows) {
    if (k.status !== 'urgente' || kwTaken >= 3) continue;
    const [text, match] = String(k.key).split('|');
    const entity = c.keywordEntities.get(`${text}|${match || ''}`) || null;
    const action = k.sales > 0 ? 'lance_palavra' : 'pausar_palavra';
    const why = k.pitchVs !== null && k.pitchVs <= -0.25
      ? `chegada ao pitch em ${pct(k.pitch)}, ${Math.round(-k.pitchVs * 100)}% abaixo da campanha`
      : `fuga da página em ${pct(k.leak)}, ${Math.round(k.leakVs || 0)} pontos acima da campanha`;
    push({
      target_key: `vturb:kw:${k.key}`, target_label: k.label, action, severity: 'urgente',
      text: `${action === 'lance_palavra' ? 'Lance' : 'Pausa'} da palavra-chave ${k.label} (${why})`,
      baseline: { ...baseline({ metric: k.pitchVs !== null && k.pitchVs <= -0.25 ? 'pitch_palavra' : 'fuga_palavra', pitch: k.pitch, leak: k.leak }), keyword: k.label, keyword_entity_id: entity },
      situation: situation('palavra-chave pela VTurb', 'urgente'),
    });
    kwTaken++;
  }
  return out;
}

/** Chaves das sugestões da VTurb que seguem fora do limite hoje. */
export function vturbFlagged(f: Funnel | null): string[] {
  if (!f) return [];
  const v = vturbSummary(f);
  const keys: string[] = [];
  if (v.enough && (v.status.leak === 'alerta' || v.status.leak === 'urgente')) keys.push('pagina|vturb:fuga');
  if (v.enough && (v.status.pitch === 'alerta' || v.status.pitch === 'urgente')) keys.push('pagina|vturb:pitch');
  for (const k of v.keywords.rows) if (k.status === 'alerta' || k.status === 'urgente') keys.push(`pagina|vturb:kw:${k.key}`);
  return keys;
}

/** URL da página: a do anúncio ativo (API) ou a última que a coleta gravou. */
export async function pageUrlFor(c: Computed): Promise<string | null> {
  const fromAds = landingUrl(c);
  if (fromAds) return fromAds;
  const { data } = await supabaseAdmin().from('daily_metrics').select('final_url')
    .eq('product_id', c.product.id).not('final_url', 'is', null).neq('final_url', '').order('date', { ascending: false }).limit(1);
  return data?.[0]?.final_url || null;
}

export async function pageHashNow(c: Computed): Promise<string | null> {
  const url = await pageUrlFor(c);
  if (!url) return null;
  // Sem os números: data do dia ou contador na página não contam como mudança.
  try { return sha((await fetchPageText(url)).replace(/\d+/g, '#')); } catch { return null; }
}

/**
 * Sugestões abertas de página e VSL que foram feitas: player trocado, vídeo
 * trocado dentro do player (duração diferente) ou HTML da página mudou.
 */
export async function detectVturbApplied(c: Computed, f: Funnel | null) {
  const db = supabaseAdmin();
  const { data: open } = await db.from('analysis_suggestions').select('id, action, baseline')
    .eq('product_id', c.product.id).eq('status', 'aberta').like('target_key', 'vturb:%').in('action', ['ajuste_pagina', 'ajuste_vsl']);
  if (!open?.length) return 0;
  const now = new Date().toISOString();
  let hashNow: string | null | undefined;
  let applied = 0;
  for (const s of open) {
    const b = s.baseline?.vturb || {};
    let type: string | null = null;
    if (f?.player?.id && b.player_id && f.player.id !== b.player_id) type = 'PLAYER';
    else if (f?.player?.duration && b.duration && Number(f.player.duration) !== Number(b.duration)) type = 'VIDEO';
    else if (s.action === 'ajuste_pagina' && b.page_hash && (!b.page_checked_at || Date.now() - new Date(b.page_checked_at).getTime() > PAGE_CHECK_MS)) {
      if (hashNow === undefined) hashNow = await pageHashNow(c);
      if (hashNow && hashNow !== b.page_hash) type = 'PAGINA';
      else await db.from('analysis_suggestions').update({ baseline: { ...s.baseline, vturb: { ...b, page_checked_at: now } } }).eq('id', s.id);
    }
    if (!type) continue;
    await db.from('analysis_suggestions').update({
      status: 'aplicada', change_at: now,
      change: { changed_at: now.slice(0, 19).replace('T', ' '), type, operation: 'UPDATE' },
      updated_at: now,
    }).eq('id', s.id);
    applied++;
  }
  return applied;
}

/** Linhas da VTurb para o pedido da IA (resumo da campanha). */
export function vturbPromptLines(item: Item | undefined): string {
  const v = item?.vturb;
  if (!v || !v.enough) return '';
  return `PÁGINA E VÍDEO (VTurb, 3 dias × média de 7 dias):
fuga da página ${pct(v.d3.leak)} × ${pct(v.d7.leak)} (${v.status.leak}) · play ${pct(v.d3.play)} × ${pct(v.d7.play)} · chegada ao pitch ${pct(v.d3.pitch)} × ${pct(v.d7.pitch)} (${v.status.pitch}) · vendas de quem chegou ao pitch ${pct(v.d3.salesPerPitch)} × ${pct(v.d7.salesPerPitch)}${v.retention ? `\nretenção: ${v.retention}` : ''}`;
}
