-- Status real das campanhas do Google Ads.
--
-- campaign_status ja existia e guarda apenas o que o anunciante configurou:
-- ENABLED / PAUSED / REMOVED. Ele nunca informa suspensao — por isso as colunas
-- abaixo. effective_status e o rotulo final consolidado pelo script.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS campaign_serving_status  TEXT,
  ADD COLUMN IF NOT EXISTS campaign_primary_status  TEXT,
  ADD COLUMN IF NOT EXISTS campaign_status_reasons  TEXT,
  ADD COLUMN IF NOT EXISTS account_status           TEXT,
  ADD COLUMN IF NOT EXISTS effective_status         TEXT;

COMMENT ON COLUMN daily_metrics.campaign_serving_status IS
  'campaign.serving_status: SERVING | SUSPENDED | PENDING | ENDED | NONE';
COMMENT ON COLUMN daily_metrics.campaign_primary_status IS
  'campaign.primary_status: ELIGIBLE | LIMITED | LEARNING | MISCONFIGURED | NOT_ELIGIBLE | PENDING | ENDED | PAUSED | REMOVED';
COMMENT ON COLUMN daily_metrics.campaign_status_reasons IS
  'campaign.primary_status_reasons separados por virgula (ex: BUDGET_CONSTRAINED,HAS_ADS_DISAPPROVED)';
COMMENT ON COLUMN daily_metrics.account_status IS
  'customer.status: ENABLED | SUSPENDED | CANCELED | CLOSED';
COMMENT ON COLUMN daily_metrics.effective_status IS
  'Rotulo consolidado: ATIVA | PAUSADA | SUSPENSA | LIMITADA | COM_ERRO | NAO_ELEGIVEL | APRENDENDO | AGENDADA | ENCERRADA | REMOVIDA | CONTA_SUSPENSA | CONTA_ENCERRADA | NAO_VEICULANDO | DESCONHECIDO';

CREATE INDEX IF NOT EXISTS idx_daily_metrics_effective_status
  ON daily_metrics (effective_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Status atual por campanha (tabela products).
--
-- daily_metrics guarda o status de cada dia. Para a lista de campanhas e o
-- cabeçalho do detalhe, o que importa é o status de HOJE — sem varrer o
-- histórico. O webhook mantém estas colunas com o dia mais recente recebido.
--
-- products.status continua sendo o campo legado 'active'/'paused', agora
-- sincronizado a partir do Google em vez de ficar preso no default de criação.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS google_status         TEXT,
  ADD COLUMN IF NOT EXISTS google_status_reasons TEXT,
  ADD COLUMN IF NOT EXISTS google_status_date    DATE;

COMMENT ON COLUMN products.google_status IS
  'effective_status do dia mais recente recebido do Google Ads';
COMMENT ON COLUMN products.google_status_date IS
  'Data a que google_status se refere — impede que um dia antigo sobrescreva o atual';
