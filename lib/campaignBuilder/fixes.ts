import { count } from './rules';
import type { Template } from './template';

/**
 * Correções na própria tela de duplicação (pedido do usuário em 26/10/2026):
 * quando o Google recusa um item da cópia no ensaio ou na criação, o item vem
 * apontado aqui, e a tela tira, troca o texto ou pede exceção ao Google sem
 * sair dela. Depois é só ensaiar de novo.
 *
 * Cada item é achado pelo texto (e pelo grupo e anúncio), não pela posição:
 * tirar um item não muda o endereço dos outros. A correção vale para a cópia
 * (todas as cópias desta duplicação); a campanha original não muda.
 */

type Ad = { grupo: string; anuncio: string };
export type Ref =
  | { tipo: 'palavra'; grupo: string; texto: string; correspondencia: string }
  | { tipo: 'negativa'; grupo: string | null; texto: string; correspondencia: string }
  | (Ad & { tipo: 'titulo' | 'descricao' | 'caminho1' | 'caminho2' | 'url'; texto: string })
  | (Ad & { tipo: 'anuncio'; texto: string })
  | { tipo: 'sitelink'; link: string; campo: 'texto' | 'desc1' | 'desc2' | 'url'; texto: string }
  | { tipo: 'destaque'; texto: string }
  | { tipo: 'local' | 'idioma'; id: string; texto: string }
  | { tipo: 'horario'; dia: string; inicio: string; texto: string }
  | { tipo: 'rastreamento' | 'sufixo'; texto: string };

/** Exceção de política que o Google aceita pedir: o item entra e passa pela revisão dele. */
export interface Exemption { politica: string; texto: string }
export type Fix = { acao: 'tirar' } | { acao: 'trocar'; texto: string } | { acao: 'excecao'; chave: Exemption };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const refKey = (r: Ref) => JSON.stringify(r);

/** Até quantas letras cada texto pode ter, e o nome dele na tela. null = não se edita aqui, só se tira. */
export function editable(r: Ref): { max: number | null; nome: string } | null {
  switch (r.tipo) {
    case 'palavra': return { max: 80, nome: 'palavra-chave' };
    case 'negativa': return { max: 80, nome: 'palavra negativa' };
    case 'titulo': return { max: 30, nome: 'título' };
    case 'descricao': return { max: 90, nome: 'descrição' };
    case 'caminho1': case 'caminho2': return { max: 15, nome: 'caminho do endereço' };
    case 'url': return { max: null, nome: 'endereço do anúncio' };
    case 'sitelink': return r.campo === 'texto' ? { max: 25, nome: 'texto do sitelink' } : r.campo === 'url' ? { max: null, nome: 'endereço do sitelink' } : { max: 35, nome: 'descrição do sitelink' };
    case 'destaque': return { max: 25, nome: 'frase de destaque' };
    case 'rastreamento': return { max: null, nome: 'modelo de rastreamento' };
    case 'sufixo': return { max: null, nome: 'sufixo da URL' };
    default: return null;
  }
}

/** Por que o texto novo não serve, ou null quando serve. */
export function editProblem(r: Ref, text: string): string | null {
  const t = text.trim(), e = editable(r);
  if (!e) return 'Este item não se edita aqui.';
  if (!t && !['caminho1', 'caminho2', 'sufixo', 'rastreamento'].includes(r.tipo) && !(r.tipo === 'sitelink' && r.campo !== 'texto' && r.campo !== 'url')) return 'Escreva o texto novo.';
  if (e.max && count(t) > e.max) return `${count(t)} letras, o máximo é ${e.max}.`;
  if ((r.tipo === 'palavra' || r.tipo === 'negativa') && t.split(/\s+/).length > 10) return 'O Google aceita até 10 palavras.';
  if ((r.tipo === 'url' || (r.tipo === 'sitelink' && r.campo === 'url')) && !/^https:\/\/[^\s/]+\.[^\s/]+/i.test(t)) return 'O endereço precisa começar com https://';
  if (t && same(t, r.texto)) return 'O texto novo é igual ao recusado.';
  return null;
}

/** Por que não dá para tirar o item, ou null quando dá. */
export function removeProblem(t: Template, r: Ref): string | null {
  if (r.tipo === 'titulo' || r.tipo === 'descricao') {
    const ad = t.grupos.find(g => g.id === r.grupo)?.anuncios.find(a => a.id === r.anuncio);
    const list = r.tipo === 'titulo' ? ad?.titulos : ad?.descricoes, min = r.tipo === 'titulo' ? 3 : 2;
    if (list && list.length <= min) return `O anúncio precisa de pelo menos ${min} ${r.tipo === 'titulo' ? 'títulos' : 'descrições'}: troque o texto em vez de tirar.`;
  }
  if (r.tipo === 'url') return 'O anúncio precisa de um endereço: troque em vez de tirar.';
  return null;
}

/** O item recusado ainda está na cópia do jeito que o Google recusou? */
export function present(t: Template, r: Ref): boolean {
  const ad = 'anuncio' in r ? t.grupos.find(g => g.id === r.grupo)?.anuncios.find(a => a.id === r.anuncio) : undefined;
  switch (r.tipo) {
    case 'palavra': return !!t.grupos.find(g => g.id === r.grupo)?.palavras.some(w => w.texto === r.texto && w.tipo === r.correspondencia && !w.excecoes?.length);
    case 'negativa': return (r.grupo ? t.grupos.find(g => g.id === r.grupo)?.negativas || [] : t.negativas).some(n => n.texto === r.texto && n.tipo === r.correspondencia);
    case 'titulo': return !!ad?.titulos.some(x => x.texto === r.texto) && !ad.excecoes?.length;
    case 'descricao': return !!ad?.descricoes.some(x => x.texto === r.texto) && !ad.excecoes?.length;
    case 'caminho1': return !!ad && ad.caminho1 === r.texto;
    case 'caminho2': return !!ad && ad.caminho2 === r.texto;
    case 'url': return !!ad?.urls.includes(r.texto);
    case 'anuncio': return !!ad && !ad.excecoes?.length;
    case 'sitelink': {
      const s = t.recursos.sitelinks.find(x => x.texto === r.link);
      return !!s && (r.campo === 'url' ? s.urls.includes(r.texto) : s[r.campo] === r.texto);
    }
    case 'destaque': return t.recursos.destaques.some(d => d.texto === r.texto);
    case 'local': return t.locais.some(l => l.id === r.id);
    case 'idioma': return t.idiomas.some(l => l.id === r.id);
    case 'horario': return t.horarios.some(h => h.dia === r.dia && h.inicio === r.inicio);
    case 'rastreamento': return t.campanha.modelo_rastreamento === r.texto;
    case 'sufixo': return t.campanha.sufixo_url === r.texto;
  }
}

/** Dá para pedir exceção ao Google neste item? Só palavras-chave e anúncios aceitam o pedido. */
export const exemptible = (r: Ref) => ['palavra', 'titulo', 'descricao', 'caminho1', 'caminho2', 'anuncio'].includes(r.tipo);

/** Aplica a correção em todos os lugares do item (a mesma palavra-chave recusada em 3 grupos, por exemplo). Devolve uma cópia nova. */
export function applyFix(t: Template, refs: Ref[], fix: Fix): Template {
  const out: Template = structuredClone(t);
  const text = fix.acao === 'trocar' ? fix.texto.trim() : '';
  for (const r of refs) {
    const group = 'grupo' in r && r.grupo ? out.grupos.find(g => g.id === r.grupo) : undefined;
    const ad = 'anuncio' in r ? group?.anuncios.find(a => a.id === r.anuncio) : undefined;
    const exempt = (list?: Exemption[]) => (fix.acao === 'excecao' && !list?.some(x => x.politica === fix.chave.politica && x.texto === fix.chave.texto) ? [...(list || []), fix.chave] : list || []);
    switch (r.tipo) {
      case 'palavra': {
        if (!group) break;
        const hit = (w: { texto: string; tipo: string }) => w.texto === r.texto && w.tipo === r.correspondencia;
        if (fix.acao === 'tirar') group.palavras = group.palavras.filter(w => !hit(w));
        else if (fix.acao === 'trocar') group.palavras = group.palavras.filter(w => !(w.texto === text && w.tipo === r.correspondencia)).map(w => (hit(w) ? { ...w, texto: text, excecoes: [] } : w));
        else group.palavras = group.palavras.map(w => (hit(w) ? { ...w, excecoes: exempt(w.excecoes) } : w));
        break;
      }
      case 'negativa': {
        const list = r.grupo ? group?.negativas : out.negativas;
        if (!list) break;
        const next = fix.acao === 'tirar' ? list.filter(n => !(n.texto === r.texto && n.tipo === r.correspondencia))
          : list.map(n => (n.texto === r.texto && n.tipo === r.correspondencia ? { ...n, texto: text } : n));
        if (r.grupo && group) group.negativas = next; else out.negativas = next;
        break;
      }
      case 'titulo': case 'descricao': {
        if (!ad) break;
        const key = r.tipo === 'titulo' ? 'titulos' : 'descricoes';
        if (fix.acao === 'tirar') ad[key] = ad[key].filter(x => x.texto !== r.texto);
        else if (fix.acao === 'trocar') { ad[key] = ad[key].map(x => (x.texto === r.texto ? { ...x, texto: text } : x)); ad.excecoes = []; }
        else ad.excecoes = exempt(ad.excecoes);
        break;
      }
      case 'caminho1': case 'caminho2': {
        if (!ad) break;
        if (fix.acao === 'excecao') { ad.excecoes = exempt(ad.excecoes); break; }
        ad[r.tipo] = text;
        if (r.tipo === 'caminho1' && !text) ad.caminho2 = '';
        break;
      }
      case 'url': if (ad && fix.acao === 'trocar') ad.urls = ad.urls.map(u => (u === r.texto ? text : u)); break;
      case 'anuncio':
        if (!group || !ad) break;
        if (fix.acao === 'tirar') group.anuncios = group.anuncios.filter(a => a.id !== r.anuncio);
        else if (fix.acao === 'excecao') ad.excecoes = exempt(ad.excecoes);
        break;
      case 'sitelink': {
        const s = out.recursos.sitelinks.find(x => x.texto === r.link);
        if (!s) break;
        if (fix.acao === 'tirar') {
          // Tirar uma linha de descrição tira as duas: o Google só aceita as duas juntas ou nenhuma.
          if (r.campo === 'desc1' || r.campo === 'desc2') { s.desc1 = ''; s.desc2 = ''; }
          else out.recursos.sitelinks = out.recursos.sitelinks.filter(x => x !== s);
        } else if (fix.acao === 'trocar') {
          if (r.campo === 'url') s.urls = s.urls.map(u => (u === r.texto ? text : u));
          else s[r.campo] = text;
        }
        break;
      }
      case 'destaque':
        out.recursos.destaques = fix.acao === 'tirar' ? out.recursos.destaques.filter(d => d.texto !== r.texto) : out.recursos.destaques.map(d => (d.texto === r.texto ? { ...d, texto: text } : d));
        break;
      case 'local': if (fix.acao === 'tirar') out.locais = out.locais.filter(l => l.id !== r.id); break;
      case 'idioma': if (fix.acao === 'tirar') out.idiomas = out.idiomas.filter(l => l.id !== r.id); break;
      case 'horario': if (fix.acao === 'tirar') out.horarios = out.horarios.filter(h => !(h.dia === r.dia && h.inicio === r.inicio)); break;
      case 'rastreamento': out.campanha.modelo_rastreamento = fix.acao === 'trocar' && text ? text : null; break;
      case 'sufixo': out.campanha.sufixo_url = fix.acao === 'trocar' && text ? text : null; break;
    }
  }
  return out;
}

/** A correção em uma linha, para a lista de correções da tela. */
export function fixNote(r: Ref, fix: Fix, places: number): string {
  const name: Record<Ref['tipo'], string> = {
    palavra: 'a palavra-chave', negativa: 'a palavra negativa', titulo: 'o título', descricao: 'a descrição', caminho1: 'o caminho', caminho2: 'o caminho', url: 'o endereço',
    anuncio: 'o anúncio', sitelink: 'o sitelink', destaque: 'a frase de destaque', local: 'o local', idioma: 'o idioma', horario: 'o horário', rastreamento: 'o modelo de rastreamento', sufixo: 'o sufixo da URL',
  };
  const what = r.tipo === 'anuncio' ? `o anúncio do grupo “${r.texto}”` : `${name[r.tipo]} “${r.texto}”`;
  const where = places > 1 ? ` (em ${places} grupos)` : '';
  if (fix.acao === 'tirar') return `Tirado ${what}${where}.`.replace('Tirado a', 'Tirada a');
  if (fix.acao === 'trocar') return `Trocado ${what} por “${fix.texto.trim()}”${where}.`.replace('Trocado a', 'Trocada a');
  return `Pedida exceção ao Google para ${what}${where}.`;
}
