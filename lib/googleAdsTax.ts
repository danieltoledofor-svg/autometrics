// Imposto do Google Ads no Brasil (support.google.com/google-ads/answer/18857390).
//
// A partir de 01/01/2027 o Google cobra o "Ajuste Local de Preços de Anúncios" de
// 2,9% sobre o gasto, por cima do orçamento, só nas contas faturadas pelo Google
// Brasil em reais (BRL). Contas pagas em dólar ou euro ficam fora. O custo que o
// Google mostra nas campanhas não muda: o ajuste vem à parte na fatura. Por isso o
// Autometrics guarda o custo como está e mostra o imposto separado, descontado do lucro.
//
// IBS/CBS: o Google ainda não definiu a alíquota (usa 11,4% só como exemplo). Fica em
// zero até sair o número oficial; quando sair, basta trocar IBS_CBS_RATE aqui.

export const GOOGLE_TAX_START = '2027-01-01';
export const LOCAL_ADS_ADJUSTMENT_RATE = 0.029;
export const IBS_CBS_RATE = 0;

type TaxProduct = { currency?: string | null; google_ads_campaign_id?: string | null } | null | undefined;

/** A campanha é de uma conta do Google faturada em reais (pelo Google Brasil). */
export function paysGoogleBrTax(product: TaxProduct): boolean {
  return !!product?.google_ads_campaign_id && String(product.currency || '').toUpperCase() === 'BRL';
}

/** Imposto do Google sobre o custo de um dia, na moeda da campanha. Zero antes de 2027 e em contas fora do Brasil. */
export function googleTaxOn(cost: number, date: string, product: TaxProduct): number {
  if (!(cost > 0) || date < GOOGLE_TAX_START || !paysGoogleBrTax(product)) return 0;
  const adjustment = cost * LOCAL_ADS_ADJUSTMENT_RATE;
  return adjustment + (cost + adjustment) * IBS_CBS_RATE;
}

/** Texto curto que explica o valor, para a tela. */
export function googleTaxNote(): string {
  const pct = (LOCAL_ADS_ADJUSTMENT_RATE * 100).toFixed(1).replace('.', ',');
  const ibs = IBS_CBS_RATE > 0 ? ` + IBS/CBS de ${(IBS_CBS_RATE * 100).toFixed(1).replace('.', ',')}%` : '';
  return `Ajuste de ${pct}%${ibs} do Google Brasil sobre o custo das contas pagas em reais, desde 01/01/2027. Já descontado do lucro; o custo continua igual ao do Google.`;
}
