import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/googleAds/server';
import { userOfToken } from '@/lib/mcp/tokens';
import { TOOLS, UserError } from '@/lib/mcp/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * MCP do Autometrics (Streamable HTTP, sem sessão): o Claude do celular ou do
 * claude.ai lê as campanhas do usuário. Só leitura.
 *
 * POST /api/mcp/<chave>   JSON-RPC 2.0: initialize, tools/list, tools/call, ping
 *
 * A chave é gerada em Integração → Claude (lib/mcp/tokens.ts) e identifica o
 * usuário; chave errada ou revogada recebe 404, como se a rota não existisse.
 */

const SERVER = { name: 'autometrics', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `Dados das campanhas de Google Ads do usuário no Autometrics: custo, vendas reais (postback das plataformas e lançamento manual), receita, lucro e as quebras por item. Só leitura.
- Comece por "campanhas" para achar a campanha; as outras ferramentas aceitam o id ou um trecho do nome.
- Vendas por item (palavra-chave, anúncio, país…) são exatas: só a venda ligada ao clique, inteira. Não estime nem divida vendas entre itens; quando a venda não trouxe o dado, diga isso.
- Dinheiro na moeda de cada campanha. Responda em português simples, sem jargão, com os números que sustentam o que disser.`;

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
const reply = (id: Rpc['id'], result: any) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, userId: string): Promise<any | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Pedido inválido.');
  const isNotification = msg.id === undefined || msg.id === null;
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion || '');
      return reply(msg.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(msg.id, {});
    case 'tools/list':
      return reply(msg.id, {
        tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })),
      });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === msg.params?.name);
      if (!tool) return fail(msg.id, -32602, `Ferramenta desconhecida: ${msg.params?.name}`);
      try {
        const out = await tool.run({ db: supabaseAdmin(), userId }, msg.params?.arguments || {});
        return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(out) }], isError: false });
      } catch (e: any) {
        const text = e instanceof UserError ? e.message : 'Não foi possível ler os dados agora. Tente de novo em instantes.';
        if (!(e instanceof UserError)) console.error('[MCP]', tool.name, e?.message || e);
        return reply(msg.id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized e outras: sem resposta
      return fail(msg.id, -32601, `Método não suportado: ${msg.method}`);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const userId = await userOfToken(supabaseAdmin(), token).catch(() => null);
  if (!userId) return new NextResponse('Not found', { status: 404 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json(fail(null, -32700, 'JSON inválido.'), { status: 400 }); }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handle(m, userId)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const out = await handle(body, userId);
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
}

// Sem fluxo de eventos do servidor: o Claude usa só POST.
export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
