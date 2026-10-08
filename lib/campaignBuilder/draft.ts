import type { Template } from './template';
import type { Funnel } from './resources';
import type { Tracker } from './url';

/**
 * Rascunho de campanha no criador: o que o usuário está montando, antes de
 * virar campanha no Google. Nasce de um modelo lido (ou do zero) e é editado
 * passo a passo na tela. As mesmas palavras-chave, o mesmo anúncio e os
 * mesmos recursos valem para todos os grupos e para todas as contas do lançamento.
 */

export interface Draft {
  funil: Funnel;
  nome: string;
  lance: { estrategia: 'MAXIMIZE_CONVERSIONS' | 'TARGET_SPEND'; meta_cpa: number | null; limite_cpc: number | null };
  orcamento_diario: number | null;
  redes: { parceiros: boolean; display: boolean };
  /** Locais incluídos e excluídos. Sem nenhum incluído, a campanha roda em todos os países, menos os excluídos. */
  locais: { id: string; nome: string; excluido: boolean; ajuste: number }[];
  local_incluir: 'PRESENCE' | 'PRESENCE_OR_INTEREST';
  idiomas: { id: string; nome: string }[];
  /** IA Max do Google: nasce sempre desligada, com as duas opções desligadas. */
  ia_max: { ligada: boolean; personalizar_texto: boolean; expandir_url: boolean };
  aparelhos: { tipo: 'MOBILE' | 'DESKTOP' | 'TABLET'; ajuste: number }[];
  negativas: { texto: string; tipo: string }[];
  /** Grupos iguais (mesmas palavras e mesmo anúncio); só a meta de CPA muda. Vazio = segue a meta da campanha. */
  grupos: { nome: string; meta_cpa: number | null }[];
  palavras: { texto: string; tipo: string }[];
  rastreador: Tracker;
  anuncio: { caminho1: string; caminho2: string; titulos: string[]; descricoes: string[] };
  sitelinks: { texto: string; desc1: string; desc2: string }[];
  destaques: string[];
  origem: string | null;
}

export const LANGUAGES: { id: string; nome: string }[] = [
  { id: '1000', nome: 'Inglês' }, { id: '1014', nome: 'Português' }, { id: '1003', nome: 'Espanhol' },
  { id: '1002', nome: 'Francês' }, { id: '1001', nome: 'Alemão' }, { id: '1004', nome: 'Italiano' },
];
const DEVICES: Draft['aparelhos'][number]['tipo'][] = ['MOBILE', 'DESKTOP', 'TABLET'];

export function emptyDraft(): Draft {
  return {
    funil: 'topo', nome: '', lance: { estrategia: 'MAXIMIZE_CONVERSIONS', meta_cpa: null, limite_cpc: null }, orcamento_diario: null,
    redes: { parceiros: false, display: false }, locais: [], local_incluir: 'PRESENCE', idiomas: [],
    ia_max: { ligada: false, personalizar_texto: false, expandir_url: false },
    aparelhos: DEVICES.map(tipo => ({ tipo, ajuste: 0 })), negativas: [], grupos: [{ nome: 'Grupo 01', meta_cpa: null }], palavras: [],
    rastreador: 'autometrics', anuncio: { caminho1: '', caminho2: '', titulos: [], descricoes: [] }, sitelinks: [], destaques: [], origem: null,
  };
}

/** Rascunho a partir de uma campanha lida. O que é de cada lançamento (página, contas, meta de conversão) fica de fora. */
export function draftFromTemplate(t: Template): Draft {
  const c = t.campanha, first = t.grupos[0];
  const ad = t.grupos.flatMap(g => g.anuncios).find(a => a.status === 'ENABLED') || t.grupos.flatMap(g => g.anuncios)[0];
  const uniq = <T,>(list: T[], key: (x: T) => string) => { const seen = new Set<string>(); return list.filter(x => { const k = key(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return {
    funil: /\[(FF|FUNDO)\]/i.test(t.origem.nome) ? 'fundo' : 'topo',
    nome: t.origem.nome,
    lance: {
      estrategia: c.lance.estrategia === 'TARGET_SPEND' ? 'TARGET_SPEND' : 'MAXIMIZE_CONVERSIONS',
      meta_cpa: c.lance.meta_cpa, limite_cpc: c.lance.limite_cpc,
    },
    orcamento_diario: c.orcamento_diario,
    redes: { parceiros: c.redes.parceiros, display: c.redes.display },
    locais: t.locais.map(l => ({ ...l })),
    local_incluir: c.local_incluir === 'PRESENCE' ? 'PRESENCE' : 'PRESENCE_OR_INTEREST',
    idiomas: t.idiomas.map(i => ({ ...i })),
    ia_max: { ligada: false, personalizar_texto: false, expandir_url: false },
    aparelhos: DEVICES.map(tipo => ({ tipo, ajuste: t.aparelhos.find(a => a.tipo === tipo)?.ajuste || 0 })),
    negativas: uniq([...t.negativas, ...t.grupos.flatMap(g => g.negativas)], n => `${n.texto}|${n.tipo}`),
    grupos: t.grupos.length ? t.grupos.map(g => ({ nome: g.nome, meta_cpa: g.meta_cpa })) : [{ nome: 'Grupo 01', meta_cpa: null }],
    palavras: uniq((first?.palavras || []).filter(k => k.status !== 'REMOVED').map(k => ({ texto: k.texto, tipo: k.tipo })), k => `${k.texto}|${k.tipo}`),
    rastreador: 'autometrics',
    anuncio: { caminho1: ad?.caminho1 || '', caminho2: ad?.caminho2 || '', titulos: (ad?.titulos || []).map(x => x.texto), descricoes: (ad?.descricoes || []).map(x => x.texto) },
    sitelinks: t.recursos.sitelinks.map(s => ({ texto: s.texto, desc1: s.desc1, desc2: s.desc2 })),
    destaques: t.recursos.destaques.map(d => d.texto),
    origem: t.origem.nome,
  };
}

/** O que falta para o passo Campanha estar completo. Lista vazia = pode seguir. */
export function campaignProblems(d: Draft): string[] {
  const out: string[] = [];
  if (!d.nome.trim()) out.push('Dê um nome à campanha.');
  if (!d.orcamento_diario || d.orcamento_diario <= 0) out.push('Informe o orçamento diário.');
  if (d.lance.estrategia === 'MAXIMIZE_CONVERSIONS' && d.lance.meta_cpa !== null && d.lance.meta_cpa <= 0) out.push('A meta de CPA precisa ser maior que zero (ou fique em branco).');
  if (d.lance.estrategia === 'TARGET_SPEND' && d.lance.limite_cpc !== null && d.lance.limite_cpc <= 0) out.push('O limite de CPC precisa ser maior que zero (ou fique em branco).');
  if (!d.grupos.length) out.push('A campanha precisa de pelo menos um grupo de anúncios.');
  if (d.grupos.some(g => !g.nome.trim())) out.push('Todo grupo precisa de um nome.');
  if (new Set(d.grupos.map(g => g.nome.trim().toLowerCase())).size !== d.grupos.length) out.push('Dois grupos têm o mesmo nome.');
  if (d.aparelhos.some(a => a.ajuste < -100 || a.ajuste > 900)) out.push('O ajuste de aparelho vai de −100% a +900%.');
  if (d.locais.some(l => l.ajuste < -90 || l.ajuste > 900)) out.push('O ajuste de local vai de −90% a +900%.');
  return out;
}
