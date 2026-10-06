import { supabaseAdmin } from '@/lib/googleAds/server';

/**
 * Memória do usuário: decisões, observações e materiais que ele guardou na
 * tela Análise de IA (tabela ai_memory). Entra nos pedidos à IA como
 * "ANOTAÇÕES DO AFILIADO". É de cada usuário — nunca vai para outro.
 */

export const MEMORY_KINDS: Record<string, string> = { decisao: 'Decisão', material: 'Material', observacao: 'Observação' };
export const SUMMARY_LIMIT = 1800;
const PROMPT_LIMIT = 7000;

/**
 * Anotações que valem para um conjunto: as sem marcação, as da campanha e as
 * cuja marcação aparece no nome (ou no trecho escolhido na tela).
 */
export async function memoryFor(userId: string, where: { text?: string; productId?: string | null } = {}): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin().from('ai_memory')
      .select('kind, title, summary, content, scope, product_id, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(60);
    if (error || !data?.length) return '';
    const text = String(where.text || '').toLowerCase();
    const lines: string[] = [];
    let size = 0;
    for (const m of data) {
      if (m.product_id && m.product_id !== where.productId) continue;
      const scope = String(m.scope || '').trim().toLowerCase();
      if (scope && !text.includes(scope)) continue;
      const body = String(m.summary || m.content || '').trim().slice(0, SUMMARY_LIMIT);
      const line = `- [${MEMORY_KINDS[m.kind] || 'Observação'} · ${String(m.created_at).slice(0, 10)}] ${m.title}: ${body}`;
      if (size + line.length > PROMPT_LIMIT) break;
      lines.push(line); size += line.length;
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

/** Trecho pronto para o pedido, com a instrução de como usar. */
export function memoryBlock(memory: string) {
  return memory
    ? `ANOTAÇÕES DO AFILIADO (decisões, regras e materiais que ele guardou; leve em conta ao interpretar os números e, se um número contrariar uma anotação, diga isso):\n${memory}`
    : '';
}
