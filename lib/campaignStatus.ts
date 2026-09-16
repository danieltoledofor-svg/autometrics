/**
 * Status de campanha do Google Ads, reduzido a três estados para exibição.
 *
 * O script grava em `effective_status` um diagnóstico detalhado (14 valores).
 * O painel mostra apenas Ativo / Pausado / Suspenso — o detalhe fica no tooltip,
 * que é onde a diferença entre "limitada por orçamento" e "anúncios reprovados"
 * ainda importa para quem for investigar.
 */

export type StatusKey = 'ativo' | 'pausado' | 'suspenso';

export interface CampaignStatus {
  key: StatusKey;
  label: string;
  /** Badge completo: fundo, texto e borda. */
  badge: string;
  /** Só a cor de fundo, para o ponto compacto do dashboard. */
  dot: string;
  /** Só a cor do texto. */
  text: string;
  /** Motivo real, para o title do elemento. */
  hint: string;
}

const TONE: Record<StatusKey, Omit<CampaignStatus, 'hint' | 'key'>> = {
  ativo: {
    label: 'Ativo',
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
  },
  pausado: {
    label: 'Pausado',
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-500',
    text: 'text-amber-400',
  },
  suspenso: {
    label: 'Suspenso',
    badge: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    dot: 'bg-rose-500',
    text: 'text-rose-400',
  },
};

/** Os 14 status do script agrupados nos 3 exibidos, com o detalhe preservado. */
const MAP: Record<string, { key: StatusKey; hint: string }> = {
  ATIVA:           { key: 'ativo',    hint: 'Veiculando normalmente' },
  APRENDENDO:      { key: 'ativo',    hint: 'Veiculando — estratégia de lances em aprendizado' },
  LIMITADA:        { key: 'ativo',    hint: 'Veiculando abaixo do potencial (orçamento ou lance)' },

  PAUSADA:         { key: 'pausado',  hint: 'Pausada pelo anunciante' },
  AGENDADA:        { key: 'pausado',  hint: 'Agendada — ainda não começou a veicular' },
  ENCERRADA:       { key: 'pausado',  hint: 'Encerrada — data de término já passou' },
  REMOVIDA:        { key: 'pausado',  hint: 'Removida pelo anunciante' },
  NAO_VEICULANDO:  { key: 'pausado',  hint: 'Sem veiculação no período' },
  DESCONHECIDO:    { key: 'pausado',  hint: 'Status não informado pelo Google' },

  SUSPENSA:        { key: 'suspenso', hint: 'Suspensa pelo Google' },
  COM_ERRO:        { key: 'suspenso', hint: 'Configuração impede a veiculação' },
  NAO_ELEGIVEL:    { key: 'suspenso', hint: 'Não elegível para veicular' },
  CONTA_SUSPENSA:  { key: 'suspenso', hint: 'A conta do Google Ads está suspensa' },
  CONTA_ENCERRADA: { key: 'suspenso', hint: 'A conta foi cancelada ou encerrada' },
};

/**
 * Consolida os quatro campos de status crus do Google em um único rótulo.
 *
 * Esta regra vivia dentro do script do Google Ads, o que obrigava a recolar o
 * script em todos os gerenciadores sempre que ela mudasse. Agora o script só
 * reporta o que leu e a decisão acontece aqui, no servidor: mudar a regra
 * passou a ser um deploy.
 *
 * campaign.status         = o que o anunciante configurou (ENABLED/PAUSED/REMOVED)
 * campaign.serving_status = veiculação real (SERVING/SUSPENDED/PENDING/ENDED/NONE)
 * campaign.primary_status = diagnóstico (ELIGIBLE/LIMITED/MISCONFIGURED/...)
 * customer.status         = conta (ENABLED/SUSPENDED/CANCELED/CLOSED)
 */
export function resolveEffectiveStatus(input: {
  status?: string | null;
  servingStatus?: string | null;
  primaryStatus?: string | null;
  accountStatus?: string | null;
}): string {
  const status = (input.status || '').toUpperCase();
  const serving = (input.servingStatus || '').toUpperCase();
  const primary = (input.primaryStatus || '').toUpperCase();
  const account = (input.accountStatus || '').toUpperCase();

  if (account === 'SUSPENDED') return 'CONTA_SUSPENSA';
  if (account === 'CANCELED' || account === 'CLOSED') return 'CONTA_ENCERRADA';

  if (status === 'REMOVED') return 'REMOVIDA';
  if (status === 'PAUSED') return 'PAUSADA';

  if (serving === 'SUSPENDED') return 'SUSPENSA';
  if (serving === 'ENDED' || primary === 'ENDED') return 'ENCERRADA';
  if (serving === 'PENDING' || primary === 'PENDING') return 'AGENDADA';

  if (primary === 'MISCONFIGURED') return 'COM_ERRO';
  if (primary === 'NOT_ELIGIBLE') return 'NAO_ELEGIVEL';
  if (primary === 'LIMITED') return 'LIMITADA';
  if (primary === 'LEARNING') return 'APRENDENDO';
  if (primary === 'ELIGIBLE') return 'ATIVA';

  if (serving === 'SERVING') return 'ATIVA';
  if (serving === 'NONE') return 'NAO_VEICULANDO';

  return status === 'ENABLED' ? 'ATIVA' : 'DESCONHECIDO';
}

/** Suspenso vence pausado, que vence ativo — usado ao agregar várias linhas. */
export const STATUS_SEVERITY: Record<StatusKey, number> = { ativo: 0, pausado: 1, suspenso: 2 };

export interface StatusSource {
  effective_status?: string | null;
  campaign_status?: string | null;
  campaign_status_reasons?: string | null;
}

export function resolveCampaignStatus(row: StatusSource): CampaignStatus {
  const effective = (row.effective_status || '').toUpperCase();
  let entry = MAP[effective];

  // Registros gravados antes da coluna existir: deriva do campaign_status cru.
  if (!entry) {
    const legacy = (row.campaign_status || '').toUpperCase();
    if (legacy === 'PAUSED') entry = { key: 'pausado', hint: 'Pausada pelo anunciante' };
    else if (legacy === 'REMOVED') entry = { key: 'pausado', hint: 'Removida pelo anunciante' };
    else if (legacy === 'ENABLED') entry = { key: 'ativo', hint: 'Veiculando normalmente' };
    else entry = MAP.DESCONHECIDO;
  }

  const reasons = row.campaign_status_reasons;
  return {
    key: entry.key,
    ...TONE[entry.key],
    hint: reasons ? `${entry.hint} — ${reasons}` : entry.hint,
  };
}

/**
 * Status de uma linha da tabela `products`.
 *
 * `google_status` é preenchido pelo webhook a cada rodada do script. Enquanto
 * ele não existir — antes da migration, ou para produtos manuais que nunca
 * vieram do Google — vale o campo legado `status` ('active'/'paused'), senão
 * toda campanha apareceria como pausada.
 */
export function resolveProductStatus(product: {
  google_status?: string | null;
  google_status_reasons?: string | null;
  /** campaign_status da linha mais recente de daily_metrics. */
  latest_campaign_status?: string | null;
  status?: string | null;
}): CampaignStatus {
  if (product.google_status || product.latest_campaign_status) {
    return resolveCampaignStatus({
      effective_status: product.google_status,
      campaign_status: product.latest_campaign_status,
      campaign_status_reasons: product.google_status_reasons,
    });
  }
  return resolveCampaignStatus({
    campaign_status: product.status === 'paused' ? 'PAUSED' : 'ENABLED',
  });
}

/** Status mais severo entre vários — para a campanha agregada no dashboard. */
export function mostSevereStatus(rows: StatusSource[]): CampaignStatus | null {
  let worst: CampaignStatus | null = null;
  for (const row of rows) {
    const s = resolveCampaignStatus(row);
    if (!worst || STATUS_SEVERITY[s.key] > STATUS_SEVERITY[worst.key]) worst = s;
  }
  return worst;
}
