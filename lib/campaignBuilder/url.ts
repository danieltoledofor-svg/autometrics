/**
 * Endereço do anúncio com o rastreamento escolhido no criador de campanhas.
 *
 * O usuário cola a página e escolhe o rastreador. Com "autometrics" entram os
 * mesmos campos do Construtor de URL (aba Instalação do Rastreamento); com
 * "flowtracking", os que as campanhas dele já usam; com "nenhum", o endereço
 * vai como foi colado. O mesmo endereço vale para o anúncio e para os sitelinks.
 */

export type Tracker = 'autometrics' | 'flowtracking' | 'nenhum';
export const TRACKERS: { id: Tracker; nome: string; resumo: string }[] = [
  { id: 'autometrics', nome: 'Autometrics', resumo: 'campanha, grupo, palavra-chave, anúncio, aparelho e o identificador do clique (amclid)' },
  { id: 'flowtracking', nome: 'FlowTracking', resumo: 'os mesmos campos, com o identificador da FlowTracking (ftgid)' },
  { id: 'nenhum', nome: 'Nenhum', resumo: 'o endereço vai exatamente como você colar' },
];

/** O que o Google troca na hora do clique fica entre chaves e não pode ser codificado. */
const COMMON: [string, string][] = [
  ['utm_id', '{campaignid}'], ['utm_source', 'google'], ['utm_medium', '{adgroupid}'],
  ['utm_term', '{keyword}'], ['utm_content', '{creative}'], ['network', '{network}'], ['device', '{device}'],
];
const PARAMS: Record<Exclude<Tracker, 'nenhum'>, [string, string][]> = {
  autometrics: [...COMMON.slice(0, 5), ['matchtype', '{matchtype}'], ...COMMON.slice(5), ['amclid', 'am_{gclid}_am']],
  flowtracking: [...COMMON, ['ftgid', 'ftgid_{gclid}_ftgid']],
};
/** Identificadores de clique de outros rastreadores: saem quando o rastreador escolhido é outro. */
const CLICK_IDS = ['amclid', 'ftgid', 'raclid'];

export function trackedUrl(page: string, tracker: Tracker): string {
  const raw = String(page || '').trim();
  if (!raw || tracker === 'nenhum') return raw;
  const [beforeHash, hash = ''] = raw.split('#');
  const [base, query = ''] = beforeHash.split('?');
  const add = PARAMS[tracker];
  const replaced = new Set([...add.map(([k]) => k), ...CLICK_IDS]);
  // O que já veio na página e não é do rastreamento (um ?id=3, por exemplo) fica como está.
  const kept = query.split('&').filter(p => p && !replaced.has(decodeURIComponent(p.split('=')[0])));
  const qs = [...kept, ...add.map(([k, v]) => `${k}=${v}`)].join('&');
  return `${base}?${qs}${hash ? `#${hash}` : ''}`;
}

/** Endereço que aparece no anúncio: o Google só aceita o mesmo site da página. */
export function siteOf(page: string): string {
  try { return new URL(String(page).trim()).hostname.replace(/^www\./, ''); } catch { return ''; }
}
