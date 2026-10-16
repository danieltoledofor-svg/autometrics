/**
 * Nome dos países pelo ID de local do Google Ads (geo target constant).
 *
 * O ID do país no Google é 2000 + o código numérico ISO (Estados Unidos =
 * 2840, Nova Zelândia = 2554). É o mesmo número que aparece no critério de
 * local da campanha, então serve para ligar a linha da aba Locais ao ajuste
 * de lance sem depender do nome escrito.
 *
 * O script e a coleta pela API gravaram o mesmo país com nomes diferentes
 * ("País 2554" quando o país não estava no dicionário, "New Zealand" quando o
 * nome vinha do Google em inglês). countryId() reconhece as três formas.
 */

/** [ID, nome em português, nome em inglês (como o Google devolve)]. */
const COUNTRIES: [string, string, string][] = [
  ['2840', 'Estados Unidos', 'United States'],
  ['2124', 'Canadá', 'Canada'],
  ['2826', 'Reino Unido', 'United Kingdom'],
  ['2036', 'Austrália', 'Australia'],
  ['2554', 'Nova Zelândia', 'New Zealand'],
  ['2372', 'Irlanda', 'Ireland'],
  ['2710', 'África do Sul', 'South Africa'],
  ['2076', 'Brasil', 'Brazil'],
  ['2620', 'Portugal', 'Portugal'],
  ['2724', 'Espanha', 'Spain'],
  ['2250', 'França', 'France'],
  ['2276', 'Alemanha', 'Germany'],
  ['2380', 'Itália', 'Italy'],
  ['2528', 'Países Baixos', 'Netherlands'],
  ['2056', 'Bélgica', 'Belgium'],
  ['2040', 'Áustria', 'Austria'],
  ['2756', 'Suíça', 'Switzerland'],
  ['2442', 'Luxemburgo', 'Luxembourg'],
  ['2208', 'Dinamarca', 'Denmark'],
  ['2752', 'Suécia', 'Sweden'],
  ['2578', 'Noruega', 'Norway'],
  ['2246', 'Finlândia', 'Finland'],
  ['2352', 'Islândia', 'Iceland'],
  ['2616', 'Polônia', 'Poland'],
  ['2203', 'Tchéquia', 'Czechia'],
  ['2703', 'Eslováquia', 'Slovakia'],
  ['2348', 'Hungria', 'Hungary'],
  ['2642', 'Romênia', 'Romania'],
  ['2100', 'Bulgária', 'Bulgaria'],
  ['2300', 'Grécia', 'Greece'],
  ['2191', 'Croácia', 'Croatia'],
  ['2705', 'Eslovênia', 'Slovenia'],
  ['2233', 'Estônia', 'Estonia'],
  ['2428', 'Letônia', 'Latvia'],
  ['2440', 'Lituânia', 'Lithuania'],
  ['2470', 'Malta', 'Malta'],
  ['2196', 'Chipre', 'Cyprus'],
  ['2792', 'Turquia', 'Turkey'],
  ['2376', 'Israel', 'Israel'],
  ['2784', 'Emirados Árabes Unidos', 'United Arab Emirates'],
  ['2682', 'Arábia Saudita', 'Saudi Arabia'],
  ['2634', 'Catar', 'Qatar'],
  ['2414', 'Kuwait', 'Kuwait'],
  ['2048', 'Bahrein', 'Bahrain'],
  ['2512', 'Omã', 'Oman'],
  ['2484', 'México', 'Mexico'],
  ['2032', 'Argentina', 'Argentina'],
  ['2152', 'Chile', 'Chile'],
  ['2170', 'Colômbia', 'Colombia'],
  ['2604', 'Peru', 'Peru'],
  ['2858', 'Uruguai', 'Uruguay'],
  ['2600', 'Paraguai', 'Paraguay'],
  ['2068', 'Bolívia', 'Bolivia'],
  ['2218', 'Equador', 'Ecuador'],
  ['2862', 'Venezuela', 'Venezuela'],
  ['2188', 'Costa Rica', 'Costa Rica'],
  ['2591', 'Panamá', 'Panama'],
  ['2214', 'República Dominicana', 'Dominican Republic'],
  ['2630', 'Porto Rico', 'Puerto Rico'],
  ['2388', 'Jamaica', 'Jamaica'],
  ['2780', 'Trinidad e Tobago', 'Trinidad and Tobago'],
  ['2392', 'Japão', 'Japan'],
  ['2410', 'Coreia do Sul', 'South Korea'],
  ['2156', 'China', 'China'],
  ['2344', 'Hong Kong', 'Hong Kong'],
  ['2158', 'Taiwan', 'Taiwan'],
  ['2702', 'Singapura', 'Singapore'],
  ['2458', 'Malásia', 'Malaysia'],
  ['2360', 'Indonésia', 'Indonesia'],
  ['2608', 'Filipinas', 'Philippines'],
  ['2764', 'Tailândia', 'Thailand'],
  ['2704', 'Vietnã', 'Vietnam'],
  ['2356', 'Índia', 'India'],
  ['2586', 'Paquistão', 'Pakistan'],
  ['2050', 'Bangladesh', 'Bangladesh'],
  ['2566', 'Nigéria', 'Nigeria'],
  ['2404', 'Quênia', 'Kenya'],
  ['2288', 'Gana', 'Ghana'],
  ['2818', 'Egito', 'Egypt'],
  ['2504', 'Marrocos', 'Morocco'],
  ['2024', 'Angola', 'Angola'],
  ['2508', 'Moçambique', 'Mozambique'],
];

/** ID → nome em português. */
export const GEO_NAMES: Record<string, string> = Object.fromEntries(COUNTRIES.map(([id, pt]) => [id, pt]));

const BY_NAME = new Map<string, string>();
for (const [id, pt, en] of COUNTRIES) {
  BY_NAME.set(pt.toLowerCase(), id);
  BY_NAME.set(en.toLowerCase(), id);
}

/** ID do país a partir do nome gravado ("Nova Zelândia", "New Zealand" ou "País 2554"). */
export function countryId(name: string | null | undefined): string | null {
  const s = String(name || '').trim();
  const num = s.match(/^(?:País|Local)\s+(\d+)$/i);
  if (num) return num[1];
  return BY_NAME.get(s.toLowerCase()) || null;
}

/** Nome em português para exibir; mantém o original se o país não estiver na lista. */
export function countryLabel(name: string | null | undefined): string {
  const id = countryId(name);
  return (id && GEO_NAMES[id]) || String(name || '');
}

/**
 * Linhas da tabela locations com o nome do país em português e sem repetir
 * o mesmo país no mesmo dia. Enquanto o script e a API gravavam nomes
 * diferentes, um dia podia ter "País 2554" e "New Zealand": fica a linha
 * com mais impressões (ou custo), como a coleta já faz por tipo de local.
 */
export function normalizeLocations<T extends Record<string, any>>(rows: T[]): T[] {
  const best = new Map<string, T>();
  const weight = (r: T) => Number(r.impressions || 0) * 1e6 + Number(r.cost || 0);
  for (const r of rows) {
    const row = { ...r, location_name: countryLabel(r.location_name) };
    const k = `${r.product_id || ''}|${r.date}|${row.location_name}`;
    const cur = best.get(k);
    if (!cur || weight(row) > weight(cur)) best.set(k, row);
  }
  return [...best.values()];
}
