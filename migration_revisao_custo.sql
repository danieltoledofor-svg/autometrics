-- Revisões retroativas de custo do Google Ads.
--
-- O Google cancela cliques inválidos e devolve o valor depois do fato, às vezes
-- dias depois. O custo de um dia já fechado muda sem aviso, e hoje isso só é
-- percebido conferindo campanha por campanha.
--
-- A cada execução o script reenvia os últimos dias; quando o custo que chega
-- difere do gravado, o webhook registra o valor anterior e a data da revisão.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS cost_previous   NUMERIC,
  ADD COLUMN IF NOT EXISTS clicks_previous INTEGER,
  ADD COLUMN IF NOT EXISTS revised_at      TIMESTAMPTZ;

COMMENT ON COLUMN daily_metrics.cost_previous IS
  'Custo antes da última revisão do Google. NULL = o dia nunca foi revisado';
COMMENT ON COLUMN daily_metrics.clicks_previous IS
  'Cliques antes da última revisão — queda aqui indica cliques invalidados';
COMMENT ON COLUMN daily_metrics.revised_at IS
  'Quando a diferença foi detectada';

-- Serve à faixa de resumo, que busca os dias revisados do período.
CREATE INDEX IF NOT EXISTS idx_daily_metrics_revised
  ON daily_metrics (revised_at) WHERE revised_at IS NOT NULL;
