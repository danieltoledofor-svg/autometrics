/**
 * O caminho do lead: do anúncio à compra, em passos com nome de gente.
 *
 * Junta o clique (tracking_clicks), as páginas e as saídas para comprar
 * (tracking_pageviews) e o que a plataforma avisou (postback_events).
 * Ex.: Anúncio → Bridge page → VSL → Página do produtor → Checkout → Compra.
 * Uma página só com saída para comprar é uma pre-sell.
 *
 * Quem clica no botão sai das nossas páginas: se o destino é a plataforma, o
 * próximo passo já é o checkout; se é outro site, é a página do produtor.
 * Venda sem aviso de checkout ainda passa por ele, sem hora (a compra prova).
 */

export type JourneyStep = {
  kind: 'origem' | 'pagina' | 'produtor' | 'botao' | 'checkout' | 'compra' | 'reembolso';
  label: string;
  short: string;                                                 // versão curta, para a coluna da tabela
  at: string | null;
  url?: string;
  note?: string;
  amount?: number;
  currency?: string;
  order?: string;
  google?: { status: string; reason?: string } | null;
};

type View = { url: string; kind?: string; created_at: string };
type Event = { event_type: string; amount?: number | string | null; currency?: string | null; source?: string | null; transaction_id?: string | null; created_at: string; google?: JourneyStep['google'] };

const PLATFORM = /buygoods|clickbank|digistore24|jvzoo|cartpanda|maxweb|hotmart|kiwify/i;
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };
const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };

function pageName(url: string, index: number, total: number, leftToBuy: boolean) {
  const p = pathOf(url);
  if (/vsl/i.test(p)) return 'VSL';
  if (/pre-?sell|advertorial/i.test(p)) return 'Pre-sell';
  if (/bridge/i.test(p)) return 'Bridge page';
  if (total === 1) return leftToBuy ? 'Pre-sell' : 'Página de entrada';
  return index === 0 ? 'Bridge page' : `Página ${index + 1}`;
}

const fromPage = (label: string) => `da ${label === 'VSL' ? label : label.toLowerCase()}`;

function originStep(click: any): JourneyStep | null {
  if (!click) return null;
  const paid = click.traffic === 'pago' || click.gclid;
  const label = click.gclid ? 'Anúncio do Google' : paid ? 'Anúncio' : 'Entrada';
  return { kind: 'origem', label, short: 'Anúncio', at: click.created_at, note: click.keyword ? `Palavra-chave: ${click.keyword}` : undefined };
}

export function buildJourney(click: any | null, views: View[], events: Event[]): JourneyStep[] {
  const seen = new Set<string>();
  // A mesma página recarregada não vira outro passo.
  const web = [...views].sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter(v => { const key = `${v.kind === 'checkout' ? 'out' : 'page'}|${v.url}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const pages = web.filter(v => v.kind !== 'checkout');
  const leftToBuy = web.length > pages.length;

  const steps: JourneyStep[] = [];
  const origin = originStep(click);
  if (origin) steps.push(origin);

  let lastPage = '';
  for (const v of web) {
    if (v.kind !== 'checkout') {
      lastPage = pageName(v.url, pages.indexOf(v), pages.length, leftToBuy);
      steps.push({ kind: 'pagina', label: lastPage, short: lastPage, at: v.created_at, url: v.url });
      continue;
    }
    const note = lastPage ? `Clicou no botão ${fromPage(lastPage)}` : undefined;
    if (PLATFORM.test(hostOf(v.url))) steps.push({ kind: 'botao', label: 'Clicou no botão', short: 'Botão', at: v.created_at, url: v.url, note });
    else steps.push({ kind: 'produtor', label: 'Página do produtor', short: 'Produtor', at: v.created_at, url: v.url, note });
  }

  const byTime = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const sales = byTime.filter(e => e.event_type === 'sale');
  const checkout = byTime.find(e => e.event_type === 'checkout');
  if (checkout) steps.push({ kind: 'checkout', label: 'Checkout', short: 'Checkout', at: checkout.created_at, note: checkout.source ? `Na ${checkout.source}` : undefined });
  else if (sales.length) steps.push({ kind: 'checkout', label: 'Checkout', short: 'Checkout', at: null, note: 'Sem aviso de checkout: a compra mostra que passou por ele' });

  sales.forEach((e, i) => steps.push({
    kind: 'compra', label: i ? 'Compra adicional' : 'Compra', short: i ? 'Adicional' : 'Compra', at: e.created_at,
    amount: Number(e.amount) || 0, currency: String(e.currency || 'USD').toUpperCase(), order: e.transaction_id || '', google: e.google || null,
    note: e.source ? `Na ${e.source}` : undefined,
  }));
  for (const e of byTime) {
    if (e.event_type === 'refund') steps.push({ kind: 'reembolso', label: 'Reembolso', short: 'Reembolso', at: e.created_at, amount: Number(e.amount) || 0, currency: String(e.currency || 'USD').toUpperCase() });
  }
  return steps;
}
