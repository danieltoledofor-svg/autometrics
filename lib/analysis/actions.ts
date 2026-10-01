import type { ItemKey, Row } from './compute';

/**
 * Tipos de alteração que uma sugestão pode apontar. O tipo é o que liga a
 * sugestão ao histórico do Google (track.ts) e à memória geral — por isso a IA
 * escolhe só dentro desta lista, e o texto dela é conferido antes de ir à tela.
 */

export const ACTIONS: Record<string, string> = {
  negativa: 'palavra negativa para o termo',
  lance_palavra: 'lance da palavra-chave',
  pausar_palavra: 'pausa da palavra-chave',
  ajuste_dispositivo: 'ajuste de lance por dispositivo',
  ajuste_publico: 'ajuste de lance no público',
  excluir_publico: 'exclusão do público',
  ajuste_local: 'ajuste de lance no local',
  excluir_local: 'exclusão do local',
  pausar_anuncio: 'pausa do anúncio',
  trocar_texto: 'troca de títulos ou descrições do anúncio',
  trocar_sitelink: 'troca do texto do recurso',
  remover_sitelink: 'remoção do recurso',
  ajuste_pagina: 'mudança na página ou na VSL',
  ajuste_vsl: 'mudança na VSL',
};

export const ACTIONS_BY_ITEM: Record<ItemKey, string[]> = {
  termos: ['negativa', 'lance_palavra'],
  palavras_chave: ['lance_palavra', 'pausar_palavra'],
  dispositivos: ['ajuste_dispositivo'],
  publicos: ['ajuste_publico', 'excluir_publico'],
  locais: ['ajuste_local', 'excluir_local'],
  anuncios: ['pausar_anuncio', 'trocar_texto'],
  sitelinks: ['trocar_sitelink', 'remover_sitelink'],
  pagina: ['ajuste_pagina'],
};

/** Escolha do código quando a IA não responde. */
export function defaultAction(item: ItemKey, row: Row): string {
  if (item === 'termos') return row.conv3 > 0 ? 'lance_palavra' : 'negativa';
  if (item === 'palavras_chave') return row.conv7 > 0 ? 'lance_palavra' : 'pausar_palavra';
  if (item === 'publicos') return 'ajuste_publico';
  if (item === 'locais') return row.conv7 > 0 ? 'ajuste_local' : 'excluir_local';
  if (item === 'anuncios') return row.conv7 > 0 ? 'trocar_texto' : 'pausar_anuncio';
  if (item === 'sitelinks') return 'trocar_sitelink';
  return ACTIONS_BY_ITEM[item][0];
}

/** Texto padrão do "Ponto de alteração", sem IA. */
export function templateText(item: ItemKey, action: string, row: Row, keyword?: string | null): string {
  const q = `"${row.label}"`;
  switch (action) {
    case 'negativa': return `Negativa exata ${q}${keyword ? ` (acionado por ${keyword})` : ''}`;
    case 'lance_palavra': return item === 'termos' && keyword ? `Lance da palavra-chave ${keyword}, que aciona ${q}` : `Lance da palavra-chave ${row.label}`;
    case 'pausar_palavra': return `Pausa da palavra-chave ${row.label}`;
    case 'ajuste_dispositivo': return `Ajuste de lance no dispositivo ${row.label.toLowerCase()}`;
    case 'ajuste_publico': return `Ajuste de lance negativo na faixa ${q}`;
    case 'excluir_publico': return `Exclusão da faixa ${q}`;
    case 'ajuste_local': return `Ajuste de lance no local ${q}`;
    case 'excluir_local': return `Exclusão do local ${q}`;
    case 'pausar_anuncio': return `Pausa do anúncio ${q}`;
    case 'trocar_texto': return `Títulos e descrições do anúncio ${q}`;
    case 'trocar_sitelink': return `Texto do ${row.tag || 'recurso'} ${q}`;
    case 'remover_sitelink': return `Remoção do ${row.tag || 'recurso'} ${q}`;
    default: return ACTIONS[action] || action;
  }
}

/**
 * O que a IA não pode escrever: verbos de ordem (a skill só aponta, quem
 * decide é o afiliado) e nomes técnicos ou em inglês que o usuário vetou.
 * Siglas do dia a dia (CPA, CPC, CTR, RSA) ficam.
 */
const FORBIDDEN = [
  /\bsugiro\b/i, /\bsugerimos\b/i, /\brecomend[oa]\b/i, /\brecomendamos\b/i, /\bconsidere\b/i, /\btente\b/i,
  /\bmelhore\b/i, /\botimiz[ea]r?\b/i, /\bpause\b/i, /\bative\b/i, /\baumente\b/i, /\bdiminua\b/i, /\breduza\b/i,
  /\bvoc[eê] deve\b/i, /\bseria bom\b/i, /\bvale a pena\b/i, /\bfaz sentido\b/i, /\bajuste (o|a|os|as)\b/i,
  /\bmismatch\b/i, /\bcluster/i, /\bcompliance\b/i, /\bcongru[eê]ncia\b/i, /\binsight/i, /\bperformance\b/i,
  /\bcusto por (a[cç][aã]o|aquisi[cç][aã]o)\b/i, /\bfunnel\b/i, /\bengajamento\b/i,
  // Nada de citar outra campanha ou outro usuário como origem.
  /outr[oa]s? (campanhas?|contas?|usu[aá]rios?|clientes?)/i,
];

export function languageProblems(text: string): string[] {
  return FORBIDDEN.filter(re => re.test(text)).map(re => (text.match(re) || [''])[0]);
}
