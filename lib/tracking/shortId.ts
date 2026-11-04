/**
 * Código curto do clique para o tid da JVZoo, que guarda no máximo 26 caracteres
 * (o gclid tem perto de 100). O mesmo cálculo está em public/am.js: os dois têm de
 * dar o mesmo resultado. "am" + duas somas FNV-1a de 32 bits em base 36 = 16 caracteres.
 */
export function shortClickId(id: string): string {
    let a = 0x811c9dc5, b = 0x9747b28c;
    for (let i = 0; i < id.length; i++) {
        const c = id.charCodeAt(i);
        a = Math.imul(a ^ c, 16777619);
        b = Math.imul(b ^ c, 0x5bd1e995);
    }
    const part = (n: number) => ('000000' + (n >>> 0).toString(36)).slice(-7);
    return 'am' + part(a) + part(b);
}

/** Parece um código curto do clique (para não procurar à toa). */
export const isShortClickId = (v: string) => /^am[0-9a-z]{14}$/.test(v);
