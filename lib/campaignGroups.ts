/**
 * Grupos de campanhas do painel: cada usuário separa as campanhas pelo que
 * está escrito no nome ("[EST 1%]", "[AQ]", "fundo de funil"…). É a
 * nomenclatura de cada um — nada aqui é fixo.
 *
 * - grupo separado: sai do bloco "Principais" e vira um bloco próprio, com
 *   total próprio, que dá para marcar ou desmarcar;
 * - grupo misturado: funciona como filtro — marcado, a tela mostra só as
 *   campanhas dele, em qualquer conta ou MCC.
 */

export interface CampaignGroup {
  id: string;
  name: string;
  /** Trechos procurados no nome da campanha; basta um aparecer. */
  terms: string[];
  separate: boolean;
}

export interface CampaignGroupsState {
  list: CampaignGroup[];
  /** Blocos desmarcados (ids de grupos separados ou MAIN_BLOCK). */
  hidden: string[];
  /** Filtros ligados (ids de grupos misturados). */
  only: string[];
}

export const MAIN_BLOCK = 'main';
export const MAIN_BLOCK_NAME = 'Principais';
export const EMPTY_GROUPS: CampaignGroupsState = { list: [], hidden: [], only: [] };

export function normalizeGroups(raw: any): CampaignGroupsState {
  if (!raw || !Array.isArray(raw.list)) return EMPTY_GROUPS;
  const list = raw.list
    .filter((g: any) => g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.terms))
    .map((g: any) => ({ id: g.id, name: g.name, terms: g.terms.map(String).filter(Boolean), separate: g.separate !== false }));
  const ids = new Set<string>([MAIN_BLOCK, ...list.map((g: CampaignGroup) => g.id)]);
  const keep = (v: any) => (Array.isArray(v) ? v.filter((id: any) => ids.has(id)) : []);
  return { list, hidden: keep(raw.hidden), only: keep(raw.only) };
}

export const parseTerms = (text: string) => text.split(',').map(t => t.trim()).filter(Boolean);

export function matchesGroup(name: string, group: CampaignGroup) {
  const n = name.toLowerCase();
  return group.terms.some(t => n.includes(t.toLowerCase()));
}

/** Bloco da campanha: o primeiro grupo separado que bate com o nome. */
export function blockOf(name: string, list: CampaignGroup[]) {
  return list.find(g => g.separate && matchesGroup(name, g))?.id || MAIN_BLOCK;
}

/** Com algum filtro ligado, só passa a campanha que bate com um deles. */
export function passesFilters(name: string, state: CampaignGroupsState) {
  const active = state.list.filter(g => !g.separate && state.only.includes(g.id));
  return !active.length || active.some(g => matchesGroup(name, g));
}

export const blockName = (id: string, list: CampaignGroup[]) =>
  id === MAIN_BLOCK ? MAIN_BLOCK_NAME : list.find(g => g.id === id)?.name || MAIN_BLOCK_NAME;
