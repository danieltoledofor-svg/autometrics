import { supabaseAdmin } from '@/lib/googleAds/server';
import { countryId, countryLabel } from '@/lib/geoNames';
import type { Template } from './template';

/**
 * Modelo de campanha montado só com o que o Autometrics já guardou, sem consultar o Google.
 *
 * Serve quando o Google não deixa ler a campanha (conta suspensa ou cancelada): a estrutura
 * que funcionou continua no banco e dá para copiar ou duplicar a partir dela.
 *
 * Vem do banco: grupos (google_ads_entities, ad_group), anúncios (ad), palavras-chave (keyword),
 * sitelinks e frases de destaque (asset), orçamento, meta de CPA e estratégia (último dia de
 * daily_metrics que tem orçamento) e os países onde a campanha apareceu (locations, os 60 dias até
 * o último em que rodou).
 *
 * Não está guardado e entra pelo padrão do criador: idioma (inglês), redes (só Pesquisa), aparelhos,
 * horários, negativas, públicos e a meta de conversão. Cada falta vira um aviso para conferir.
 */

const PAGE = 1000;
async function all<T>(fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const ENGLISH = { id: '1000', nome: 'Inglês' };
const money = (v: any) => (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Math.round(Number(v) * 100) / 100);
const pinned = (list: any) => (Array.isArray(list) ? list : [])
  .map((x: any) => ({ texto: String(x?.text || ''), fixo: x?.pin || null }))
  .filter((x: { texto: string }) => x.texto);

export async function storedTemplate(userId: string, productId: string): Promise<Template | null> {
  const db = supabaseAdmin();
  const { data: product } = await db.from('products').select('id, name, google_ads_campaign_name, google_ads_campaign_id, google_ads_customer_id')
    .eq('id', productId).eq('user_id', userId).maybeSingle();
  if (!product) return null;

  // Países dos últimos 60 dias em que a campanha rodou (a conta suspensa parou de rodar há tempos).
  const { data: lastPlace } = await db.from('locations').select('date').eq('product_id', productId).order('date', { ascending: false }).limit(1).maybeSingle()
    .then(r => r, () => ({ data: null }));
  const since = lastPlace?.date ? new Date(new Date(`${lastPlace.date}T12:00:00Z`).getTime() - 60 * 86400000).toISOString().slice(0, 10) : null;
  const [entities, metric, places] = await Promise.all([
    all<any>((a, b) => db.from('google_ads_entities').select('level, entity_id, ad_group_id, name, status, details')
      .eq('product_id', productId).in('level', ['ad_group', 'ad', 'keyword', 'asset']).neq('status', 'REMOVED').range(a, b)),
    db.from('daily_metrics').select('date, budget_micros, target_cpa, bidding_strategy').eq('product_id', productId)
      .gt('budget_micros', 0).order('date', { ascending: false }).limit(1).maybeSingle().then(r => r.data, () => null),
    since ? all<any>((a, b) => db.from('locations').select('location_name, impressions').eq('product_id', productId).gte('date', since).range(a, b)).catch(() => []) : [],
  ]);

  const groups = entities.filter(e => e.level === 'ad_group');
  if (!groups.length) return null;                                       // nada guardado da estrutura

  const avisos: string[] = [
    'Campanha de conta suspensa: o Google não deixa ler. Este modelo foi montado com o que o Autometrics guardou.',
  ];

  const strategy = String(metric?.bidding_strategy || '');
  const target = money(metric?.target_cpa);
  const usesCpa = strategy === 'TARGET_CPA' || strategy === 'MAXIMIZE_CONVERSIONS';
  if (!metric) avisos.push('Orçamento e meta de CPA não estão guardados: preencha na cópia.');

  // Países por impressões. É onde a campanha apareceu, não a lista exata configurada nela.
  const byCountry = new Map<string, { nome: string; i: number }>();
  for (const p of places) {
    const id = countryId(p.location_name);
    if (!id) continue;
    const cur = byCountry.get(id) || { nome: countryLabel(p.location_name), i: 0 };
    cur.i += Number(p.impressions || 0);
    byCountry.set(id, cur);
  }
  const locais = [...byCountry].sort((a, b) => b[1].i - a[1].i).map(([id, c]) => ({ id, nome: c.nome, excluido: false, ajuste: 0 }));
  avisos.push(locais.length
    ? `Países: entram os ${locais.length} em que a campanha apareceu nos últimos 60 dias em que rodou. Confira se falta algum.`
    : 'Países não estão guardados: escolha os países na cópia.');
  avisos.push('Idioma, negativas, horários e aparelhos não estão guardados: a cópia vai com inglês, só rede de Pesquisa, sem negativas e sem horários. Confira antes de subir.');

  const t: Template = {
    origem: {
      campanha_id: String(product.google_ads_campaign_id || ''),
      conta_id: String(product.google_ads_customer_id || '').replace(/\D/g, ''),
      nome: product.google_ads_campaign_name || product.name || '',
      lido_em: metric?.date ? `${metric.date}T12:00:00Z` : new Date().toISOString(),
    },
    campanha: {
      tipo: 'SEARCH',
      lance: {
        estrategia: strategy || 'MAXIMIZE_CONVERSIONS', compartilhada: false,
        meta_cpa: usesCpa ? target : null,
        limite_cpc: null,
      },
      orcamento_diario: metric ? money(Number(metric.budget_micros) / 1e6) : null,
      redes: { pesquisa: true, parceiros: false, display: false },
      local_incluir: 'PRESENCE',
      local_excluir: 'PRESENCE',
      ia_max: { ligada: false, personalizar_texto: false, expandir_url: false },
      anuncio_politico_ue: false,
      modelo_rastreamento: null,
      sufixo_url: null,
      meta_conversao: null,
    },
    locais,
    idiomas: [ENGLISH],
    aparelhos: [], horarios: [], negativas: [],
    grupos: [],
    recursos: { sitelinks: [], destaques: [], nome_empresa: null },
    metas_da_conta: [],
    avisos,
  };

  const byGroup = new Map<string, Template['grupos'][number]>();
  for (const g of groups) {
    byGroup.set(String(g.entity_id), {
      id: String(g.entity_id), nome: g.name || '', status: g.status || '',
      meta_cpa: money(g.details?.target_cpa), palavras: [], negativas: [], publicos: [], anuncios: [],
    });
  }
  for (const e of entities) {
    const g = byGroup.get(String(e.ad_group_id || ''));
    if (!g) continue;
    if (e.level === 'keyword' && e.name) g.palavras.push({ texto: e.name, tipo: e.details?.match_type || 'BROAD', status: e.status || '' });
    else if (e.level === 'ad') {
      const d = e.details || {};
      if (d.type && d.type !== 'RESPONSIVE_SEARCH_AD') continue;
      const titulos = pinned(d.headlines), descricoes = pinned(d.descriptions);
      if (!titulos.length) continue;
      g.anuncios.push({ id: String(d.ad_id || ''), status: e.status || '', urls: d.final_url ? [d.final_url] : [], caminho1: d.path1 || '', caminho2: d.path2 || '', titulos, descricoes });
    }
  }
  for (const g of byGroup.values()) g.palavras.sort((a, b) => a.texto.localeCompare(b.texto));
  t.grupos = [...byGroup.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  if (!t.grupos.some(g => g.anuncios.length)) avisos.push('Nenhum anúncio guardado desta campanha: escreva os anúncios na cópia.');

  // Recursos guardados ficam no nível da campanha; o sitelink não tem endereço próprio
  // guardado e usa o do primeiro anúncio ao subir.
  const seen = new Set<string>();
  for (const e of entities) {
    if (e.level !== 'asset' || !e.name) continue;
    const type = e.details?.field_type;
    if (type === 'SITELINK' && !seen.has(`s|${e.name}`)) {
      seen.add(`s|${e.name}`);
      t.recursos.sitelinks.push({ texto: e.name, desc1: e.details?.description1 || '', desc2: e.details?.description2 || '', urls: [], nivel: 'campanha' });
    } else if (type === 'CALLOUT' && !seen.has(`c|${e.name}`)) {
      seen.add(`c|${e.name}`);
      t.recursos.destaques.push({ texto: e.name, nivel: 'campanha' });
    }
  }
  if (t.recursos.sitelinks.length) avisos.push('Sitelinks vão com o endereço do primeiro anúncio: o endereço próprio de cada um não está guardado.');

  return t;
}
