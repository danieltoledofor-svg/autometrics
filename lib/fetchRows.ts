/**
 * Leitura de tabelas grandes sem esperar uma consulta terminar para começar a
 * outra.
 *
 * O banco devolve no máximo 1000 linhas por pedido e a lista de campanhas vai
 * em lotes de 150 (o endereço da consulta tem limite de tamanho). Antes, cada
 * lote e cada página esperavam o anterior: com ~1200 campanhas eram 9 pedidos
 * em fila, ~0,4 s cada, só para os números do Dashboard. Aqui os lotes saem
 * todos juntos; dentro de um lote as páginas continuam em ordem, porque só dá
 * para saber se há outra página depois de ler a anterior.
 *
 * `make` monta a consulta do zero a cada página (o construtor do Supabase muda
 * a si mesmo em `.range()`, então não pode ser reaproveitado). A consulta deve
 * vir ordenada por uma coluna única no fim (ex.: `.order('id')`): sem isso o
 * banco pode repetir ou pular linhas entre uma página e outra.
 */

const PAGE = 1000;
const CHUNK = 150;

export type Rows<T> = { data: T[]; error: any };

/** Todas as páginas de uma consulta, uma depois da outra. */
export async function fetchAllRows<T = any>(make: () => any): Promise<Rows<T>> {
  const data: T[] = [];
  for (let page = 0; ; page++) {
    const { data: rows, error } = await make().range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return { data, error };
    if (!rows?.length) break;
    data.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data, error: null };
}

/** A mesma consulta para cada lote de campanhas, com os lotes em paralelo. */
export async function fetchByProducts<T = any>(ids: string[], make: (chunk: string[]) => any): Promise<Rows<T>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const parts = await Promise.all(chunks.map(chunk => fetchAllRows<T>(() => make(chunk))));
  return { data: parts.flatMap(p => p.data), error: parts.find(p => p.error)?.error ?? null };
}
