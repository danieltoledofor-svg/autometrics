import { supabaseAdmin } from '@/lib/googleAds/server';
import { fetchPageHtml } from '@/lib/analysis/page';

/**
 * "Encontrar para mim": acha o player da VTurb da campanha sem colar nada.
 *
 * Abre as páginas por onde as visitas da campanha passaram e a página do
 * anúncio; onde não há vídeo, segue os links para as páginas do mesmo site
 * (a VSL costuma ser a segunda página). Lê só o código-fonte, sem rodar nada.
 *
 * Origem do player (products.vturb_player_source):
 *   manual  colado por você: o am.js nunca troca
 *   auto    achado pelo Autometrics: o am.js troca sozinho se a VSL mudar de vídeo
 */

const MAX_PAGES = 10;

/** IDs de player no código-fonte: endereço do script (/players/<id>/) ou o id do elemento (vid-<id>). */
export function playersInHtml(html: string): string[] {
  const found: string[] = [];
  const add = (id: string) => { const v = id.toLowerCase(); if (!found.includes(v)) found.push(v); };
  for (const m of html.matchAll(/\/players\/([0-9a-f]{24})(?![0-9a-f])/gi)) add(m[1]);
  for (const m of html.matchAll(/\bid\s*=\s*["']vid[-_]([0-9a-f]{24})["']/gi)) add(m[1]);
  return found;
}

/** Links do mesmo site, sem âncora nem arquivo: candidatos a segunda página. */
function sameSiteLinks(html: string, base: string): string[] {
  let origin = '';
  try { origin = new URL(base).origin; } catch { return []; }
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), base);
      if (u.origin !== origin || /\.(pdf|jpe?g|png|gif|webp|svg|css|js|mp4)$/i.test(u.pathname)) continue;
      const bare = u.origin + u.pathname;
      if (bare !== base.split(/[?#]/)[0] && !out.includes(bare)) out.push(bare);
    } catch { /* link quebrado */ }
  }
  return out.slice(0, 4);
}

/** Páginas da campanha: as mais visitadas primeiro, depois a do anúncio. */
async function campaignPages(productId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const count = new Map<string, number>();
  const { data: product } = await db.from('products').select('user_id').eq('id', productId).maybeSingle();
  const { data: clicks } = await db.from('tracking_clicks').select('click_id').eq('product_id', productId)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(300).then(r => r, () => ({ data: null }));
  const ids = (clicks || []).map((c: any) => c.click_id);
  if (ids.length && product) {
    const { data: views } = await db.from('tracking_pageviews').select('url, kind').eq('user_id', product.user_id).in('click_id', ids).limit(3000)
      .then(r => r, () => ({ data: null }));
    for (const v of views || []) {
      if (v.kind === 'checkout' || !v.url) continue;
      count.set(v.url, (count.get(v.url) || 0) + 1);
    }
  }
  const pages = [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const { data: ads } = await db.from('google_ads_entities').select('details').eq('product_id', productId).eq('level', 'ad').neq('status', 'REMOVED')
    .then(r => r, () => ({ data: null }));
  const { data: days } = await db.from('daily_metrics').select('final_url').eq('product_id', productId).not('final_url', 'is', null)
    .order('date', { ascending: false }).limit(5).then(r => r, () => ({ data: null }));
  for (const u of [...(ads || []).map((a: any) => a.details?.final_url), ...(days || []).map((d: any) => d.final_url)]) {
    const bare = typeof u === 'string' && /^https?:\/\//.test(u) ? u.split(/[?#]/)[0] : '';
    if (bare && !pages.includes(bare)) pages.push(bare);
  }
  return pages;
}

export interface FindResult { player: string | null; page: string | null; checked: number; pages: number }

export async function findPlayer(productId: string, deadline = Date.now() + 40_000): Promise<FindResult> {
  const queue = await campaignPages(productId);
  const pages = queue.length;
  const done = new Set<string>();
  let checked = 0;
  while (queue.length && checked < MAX_PAGES && Date.now() < deadline) {
    const batch = queue.splice(0, 3).filter(u => !done.has(u));
    batch.forEach(u => done.add(u));
    const results = await Promise.all(batch.map(async url => {
      try { return { url, html: await fetchPageHtml(url, 10_000) }; } catch { return { url, html: '' }; }
    }));
    checked += batch.length;
    for (const { url, html } of results) {
      const found = playersInHtml(html);
      if (found.length) return { player: found[0], page: url, checked, pages };
    }
    // Sem vídeo nessas páginas: a VSL deve ser a próxima.
    for (const { url, html } of results) for (const link of sameSiteLinks(html, url)) if (!done.has(link) && !queue.includes(link)) queue.push(link);
  }
  return { player: null, page: null, checked, pages };
}
