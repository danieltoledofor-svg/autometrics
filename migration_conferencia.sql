-- Etapa 0 — conferência diária com o Google.
--
-- Uma vez por dia, para cada conta conectada pela API, o painel pergunta ao
-- Google o que ele registrou nos últimos 7 dias fechados e compara com o que
-- está gravado em daily_metrics: impressões, cliques, custo e conversões, no
-- total da conta e campanha por campanha. É o que dá segurança para desligar
-- os scripts das MCCs.
--
-- google_ads_reconciliations: uma linha por conta e por dia conferido.
-- daily_metrics.last_source: quem gravou o dia por último (api ou script) —
-- enquanto os dois convivem, é o que explica uma divergência.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

CREATE TABLE IF NOT EXISTS public.google_ads_reconciliations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  account_id          UUID NOT NULL REFERENCES public.google_ads_accounts(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  status              TEXT NOT NULL,          -- ok | divergente
  google_impressions  BIGINT NOT NULL DEFAULT 0,
  panel_impressions   BIGINT NOT NULL DEFAULT 0,
  google_clicks       BIGINT NOT NULL DEFAULT 0,
  panel_clicks        BIGINT NOT NULL DEFAULT 0,
  google_cost         NUMERIC(15,4) NOT NULL DEFAULT 0,
  panel_cost          NUMERIC(15,4) NOT NULL DEFAULT 0,
  google_conversions  NUMERIC NOT NULL DEFAULT 0,
  panel_conversions   NUMERIC,                -- null: dia gravado só pelo script, sem conversões do Google
  issues              JSONB NOT NULL DEFAULT '[]'::jsonb,  -- campanha a campanha: o que não bateu
  checked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gads_recon_user ON public.google_ads_reconciliations (user_id, date DESC);

ALTER TABLE public.google_ads_accounts
  ADD COLUMN IF NOT EXISTS last_reconciled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconcile_status   TEXT,       -- ok | divergente | erro
  ADD COLUMN IF NOT EXISTS last_reconcile_summary  JSONB;

ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS last_source TEXT;                    -- api | script

-- Leitura pelo painel, só das próprias contas. A gravação é do servidor.
ALTER TABLE public.google_ads_reconciliations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_own_gads_recon" ON public.google_ads_reconciliations;
CREATE POLICY "read_own_gads_recon" ON public.google_ads_reconciliations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()::text);
