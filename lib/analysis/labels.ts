/** Nomes em português do que o Google manda em código (idade, dispositivo…). */

const AUDIENCE_PT: Record<string, string> = {
  MALE: 'masculino', FEMALE: 'feminino',
  MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet', CONNECTED_TV: 'TV conectada', OTHER: 'Outros',
};

export function deviceLabel(code: string) {
  return AUDIENCE_PT[code] || code;
}

export function audienceLabel(type: string, code: string) {
  const unknown = /UNDETERMINED|UNKNOWN/.test(code);
  if (type === 'Age') {
    if (unknown) return 'Idade desconhecida';
    if (code === 'AGE_RANGE_65_UP') return 'Idade 65 ou mais';
    const m = code.match(/^AGE_RANGE_(\d+)_(\d+)$/);
    return m ? `Idade ${m[1]}–${m[2]}` : code;
  }
  if (type === 'Gender') return unknown ? 'Gênero desconhecido' : `Gênero ${AUDIENCE_PT[code] || code}`;
  return code;
}

/** Como o termo casou com a palavra-chave, em forma curta para a etiqueta. */
export const TERM_MATCH_TAG: Record<string, string> = {
  EXACT: 'exata', NEAR_EXACT: 'exata var.', PHRASE: 'frase', NEAR_PHRASE: 'frase var.', BROAD: 'ampla', AUTO: 'automática',
};

export function keywordLabel(text: string, matchType?: string | null) {
  if (matchType === 'EXACT') return `[${text}]`;
  if (matchType === 'PHRASE') return `"${text}"`;
  return text;
}

export const ASSET_TAG: Record<string, string> = {
  SITELINK: 'sitelink', CALLOUT: 'frase de destaque', PROMOTION: 'promoção', STRUCTURED_SNIPPET: 'snippet',
};

export function currencySymbol(code?: string | null) {
  const c = (code || 'USD').toUpperCase();
  return c === 'BRL' ? 'R$' : c === 'EUR' ? '€' : c === 'USD' ? 'US$' : c;
}

export function formatMoney(value: number, currency?: string | null) {
  return `${currencySymbol(currency)} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
