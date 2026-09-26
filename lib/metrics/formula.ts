/**
 * Fórmulas das colunas personalizadas.
 *
 * Aceita números, nomes de métrica, + - * / e parênteses — o mesmo que as
 * colunas personalizadas do Google. Não usa eval: a fórmula vem do usuário e é
 * guardada no banco.
 *
 * Divisão por zero ou métrica que não existe naquela tabela dá null, e a
 * célula mostra "—" em vez de um número inventado.
 */

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'op'; op: '+' | '-' | '*' | '/'; a: Node; b: Node };

export interface ParsedFormula {
  ok: boolean;
  error?: string;
  vars: string[];
  node?: Node;
}

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  const re = /\s*(\d+(?:[.,]\d+)?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/])/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`Caractere inválido: "${src[i]}"`);
    tokens.push(m[1]);
    i = re.lastIndex;
  }
  return tokens;
}

export function parseFormula(src: string): ParsedFormula {
  const vars = new Set<string>();
  try {
    const tokens = tokenize(src || '');
    if (!tokens.length) return { ok: false, error: 'Fórmula vazia', vars: [] };
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    const primary = (): Node => {
      const tk = next();
      if (tk === undefined) throw new Error('A fórmula termina no meio');
      if (tk === '(') {
        const e = expr();
        if (next() !== ')') throw new Error('Falta fechar parênteses');
        return e;
      }
      if (tk === '-') return { t: 'neg', a: primary() };
      if (/^\d/.test(tk)) return { t: 'num', v: Number(tk.replace(',', '.')) };
      if (/^[A-Za-z_]/.test(tk)) { vars.add(tk); return { t: 'var', name: tk }; }
      throw new Error(`"${tk}" fora de lugar`);
    };
    const term = (): Node => {
      let a = primary();
      while (peek() === '*' || peek() === '/') {
        const op = next() as '*' | '/';
        a = { t: 'op', op, a, b: primary() };
      }
      return a;
    };
    const expr = (): Node => {
      let a = term();
      while (peek() === '+' || peek() === '-') {
        const op = next() as '+' | '-';
        a = { t: 'op', op, a, b: term() };
      }
      return a;
    };

    const node = expr();
    if (pos < tokens.length) throw new Error(`"${tokens[pos]}" fora de lugar`);
    return { ok: true, vars: [...vars], node };
  } catch (e: any) {
    return { ok: false, error: e.message, vars: [...vars] };
  }
}

export function evaluate(node: Node | undefined, get: (name: string) => number | null | undefined): number | null {
  if (!node) return null;
  switch (node.t) {
    case 'num': return node.v;
    case 'var': {
      const v = get(node.name);
      return v === null || v === undefined || !Number.isFinite(v) ? null : v;
    }
    case 'neg': {
      const a = evaluate(node.a, get);
      return a === null ? null : -a;
    }
    case 'op': {
      const a = evaluate(node.a, get);
      const b = evaluate(node.b, get);
      if (a === null || b === null) return null;
      if (node.op === '+') return a + b;
      if (node.op === '-') return a - b;
      if (node.op === '*') return a * b;
      return b === 0 ? null : a / b;
    }
  }
}

export interface CustomColumn {
  id: string;
  name: string;
  formula: string;
  /** number | money | percent — percent multiplica o resultado por 100. */
  format: 'number' | 'money' | 'percent';
}

export const CUSTOM_KEY = (id: string) => `custom_${id}`;

/** Compila uma vez; a tabela avalia milhares de vezes. */
export function compileCustom(cols: CustomColumn[]) {
  return cols.map(c => ({ ...c, key: CUSTOM_KEY(c.id), parsed: parseFormula(c.formula) }));
}
export type CompiledCustom = ReturnType<typeof compileCustom>[number];

export function customValue(col: CompiledCustom, get: (name: string) => number | null | undefined): number | null {
  if (!col.parsed.ok) return null;
  const v = evaluate(col.parsed.node, get);
  if (v === null) return null;
  return col.format === 'percent' ? v * 100 : v;
}
