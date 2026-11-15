-- Envio das etapas do funil ao Google pelo clique (checkout e 10 minutos no site).
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
-- Depende de migration_envio_google.sql.
--
-- google_conversion_settings.steps_enabled   liga o envio das etapas (separado do envio das vendas)
-- google_conversion_settings.steps_start_at  só etapas a partir daqui são enviadas
-- google_step_uploads                        cada etapa de cada clique: enviada, aguardando ou o motivo de não ir

ALTER TABLE public.google_conversion_settings ADD COLUMN IF NOT EXISTS steps_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.google_conversion_settings ADD COLUMN IF NOT EXISTS steps_start_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.google_step_uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  click_id    TEXT NOT NULL,                        -- tracking_clicks.click_id
  step        TEXT NOT NULL,                        -- checkout | tempo10
  product_id  UUID REFERENCES public.products(id) ON DELETE SET NULL,
  customer_id TEXT,
  value       NUMERIC,                              -- o que a etapa rende em vendas, em média
  currency    TEXT,
  step_at     TIMESTAMPTZ NOT NULL,                 -- quando a etapa aconteceu
  status      TEXT NOT NULL DEFAULT 'aguardando',   -- enviada | aguardando | falhou | ignorada
  reason      TEXT,
  error_code  TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_try_at TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, click_id, step)
);
CREATE INDEX IF NOT EXISTS idx_gstep_uploads_user ON public.google_step_uploads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gstep_uploads_wait ON public.google_step_uploads (user_id, next_try_at) WHERE status = 'aguardando';

-- Só o servidor lê e grava.
ALTER TABLE public.google_step_uploads ENABLE ROW LEVEL SECURITY;

-- A API do Supabase passa a enxergar as colunas e a tabela novas na hora.
NOTIFY pgrst, 'reload schema';
