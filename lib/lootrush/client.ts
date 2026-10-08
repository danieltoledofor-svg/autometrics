/**
 * Cliente mínimo da LootRush (banco dos cartões), só de leitura.
 *
 * A LootRush atende por um servidor MCP: cada pedido é um POST em JSON-RPC
 * com o nome da função e os argumentos, e a resposta vem como texto JSON
 * dentro de result.content[0].text. A chave é de cada usuário, com a
 * permissão "MCP → Read"; o Autometrics nunca pede a de escrita nem a de
 * revelar número de cartão. Limite: 1 pedido por segundo para cada função.
 * Documentação: https://docs.lootrush.com/mcp-server
 */

const ENDPOINT = 'https://mcp.lootrush.com/mcp';

export class LootrushError extends Error {
  constructor(message: string, public status: number, public code?: number) { super(message); }
}

/** O erro da LootRush em português simples, para a tela. */
export function plainLootrushError(e: any): string {
  const code = e instanceof LootrushError ? e.code : undefined, status = e instanceof LootrushError ? e.status : 0;
  if (code === -32001 || status === 401) return 'A LootRush não reconheceu a chave. Confira se ela foi copiada inteira ou gere outra.';
  if (code === -32004) return 'A chave tem uma lista de IPs permitidos e o servidor do Autometrics não está nela. Gere a chave sem essa lista.';
  if (code === -32003 || status === 403) return 'A chave não tem a permissão "MCP → Read". Gere outra chave com essa permissão marcada.';
  if (code === -32005 || status === 429) return 'A LootRush pediu para esperar um pouco (muitos pedidos seguidos). A próxima leitura tenta de novo.';
  return `A LootRush não respondeu: ${String(e?.message || e).slice(0, 160)}`;
}

const lastCall = new Map<string, number>();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function lootrush<T = any>(apiKey: string, tool: string, args: Record<string, any> = {}): Promise<T> {
  // Um pedido por segundo para cada função, por chave.
  const slot = `${apiKey.slice(-8)}|${tool}`, gap = Date.now() - (lastCall.get(slot) || 0);
  if (gap < 1100) await wait(1100 - gap);
  lastCall.set(slot, Date.now());

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(20_000),
  });
  let text = await res.text();
  if (/^(event|data):/m.test(text)) text = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
  let body: any;
  try { body = JSON.parse(text); } catch { throw new LootrushError(`HTTP ${res.status}`, res.status); }
  if (body.error) throw new LootrushError(body.error.message || `HTTP ${res.status}`, res.status, body.error.code);
  const raw = String(body.result?.content?.[0]?.text ?? '');
  let data: any = raw;
  try { data = JSON.parse(raw); } catch { /* texto simples */ }
  if (body.result?.isError) throw new LootrushError(typeof data === 'string' ? data : JSON.stringify(data).slice(0, 300), res.status);
  return data as T;
}

export interface CardGroup { id: string; name: string; cards: number; spend30: number | null }

export async function cardGroups(apiKey: string): Promise<CardGroup[]> {
  const data = await lootrush<any>(apiKey, 'getCardGroups', { pageSize: 100 });
  return (data?.cardGroups || []).map((g: any) => ({
    id: String(g.id), name: String(g.name || 'Grupo'), cards: Number(g.cardCount) || 0,
    spend30: g.spend30Days === null || g.spend30Days === undefined ? null : Number(g.spend30Days),
  }));
}

/** Cobranças de um grupo desde uma data, da mais nova para a mais antiga. Para nas `maxPages` páginas. */
export async function groupTransactions(apiKey: string, groupId: string, since: Date, maxPages = 10): Promise<{ rows: any[]; complete: boolean }> {
  const rows: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await lootrush<any>(apiKey, 'getUserCardTransactions', { groupId, page, pageSize: 100, startDate: since.toISOString() });
    const list: any[] = data?.transactions || [];
    rows.push(...list);
    if (list.length < 100) return { rows, complete: true };
  }
  return { rows, complete: false };
}
