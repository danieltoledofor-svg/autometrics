/**
 * Grupos de campanhas do painel: cada usuário separa as campanhas pelo que
 * está escrito no nome ("[EST 1%]", "[AQ]", "fundo de funil"…). É a
 * nomenclatura de cada um — nada aqui é fixo.
 *
 * Cada grupo sai do bloco "Principais" e vira um bloco próprio, com total
 * próprio. A tela mostra só os blocos marcados.
 */

export interface CampaignGroup {
  id: string;
  name: string;
  /** Trechos procurados no nome da campanha; basta um aparecer. */
  terms: string[];
}

export interface CampaignGroupsState {
  list: CampaignGroup[];
  /** Blocos desmarcados (ids de grupos ou MAIN_BLOCK). */
  hidden: string[];
}

export const MAIN_BLOCK = 'main';
export const MAIN_BLOCK_NAME = 'Principais';
export const EMPTY_GROUPS: CampaignGroupsState = { list: [], hidden: [] };

export function normalizeGroups(raw: any): CampaignGroupsState {
  if (!raw || !Array.isArray(raw.list)) return EMPTY_GROUPS;
  const list = raw.list
    .filter((g: any) => g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.terms))
    .map((g: any) => ({ id: g.id, name: g.name, terms: g.terms.map(String).filter(Boolean) }));
  const ids = new Set<string>([MAIN_BLOCK, ...list.map((g: CampaignGroup) => g.id)]);
  return { list, hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((id: any) => ids.has(id)) : [] };
}

export const parseTerms = (text: string) => text.split(',').map(t => t.trim()).filter(Boolean);

export function matchesGroup(name: string, group: CampaignGroup) {
  const n = name.toLowerCase();
  return group.terms.some(t => n.includes(t.toLowerCase()));
}

/** Bloco da campanha: o primeiro grupo que bate com o nome. */
export function blockOf(name: string, list: CampaignGroup[]) {
  return list.find(g => matchesGroup(name, g))?.id || MAIN_BLOCK;
}

export const blockName = (id: string, list: CampaignGroup[]) =>
  id === MAIN_BLOCK ? MAIN_BLOCK_NAME : list.find(g => g.id === id)?.name || MAIN_BLOCK_NAME;
