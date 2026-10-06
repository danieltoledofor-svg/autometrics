-- Envio das vendas ao Google pelo clique (gclid) — Etapa 3 do rastreamento.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- google_conversion_settings  a escolha de cada usuário: ligado ou não, nome da
--                             ação de conversão e se ela conta para os lances
-- google_conversion_targets   em cada conta do Google, onde fica a ação de
--                             conversão (a própria conta ou a MCC dela)
-- google_conversion_uploads   cada venda enviada, ou o motivo de não ter ido

CREATE TABLE IF NOT EXISTS public.google_conversion_settings (
  user_id            TEXT PRIMARY KEY,
  enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  action_name        TEXT NOT NULL DEFAULT 'Venda Autometrics',
  counts_for_bidding BOOLEAN NOT NULL DEFAULT FALSE,   -- FALSE = só observação, não muda os lances
  start_at           TIMESTAMPTZ,                      -- só vendas a partir daqui são enviadas
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.google_conversion_targets (
  user_id                TEXT NOT NULL,
  customer_id            TEXT NOT NULL,               -- conta onde o clique aconteceu
  action_name            TEXT NOT NULL,
  conversion_customer_id TEXT NOT NULL,               -- conta dona das conversões (pode ser a MCC)
  action_resource        TEXT NOT NULL,
  created_by_us          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, customer_id, action_name)
);

CREATE TABLE IF NOT EXISTS public.google_conversion_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  event_id      UUID NOT NULL UNIQUE,                 -- postback_events.id
  product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  customer_id   TEXT,
  click_id      TEXT,
  amount        NUMERIC,
  currency      TEXT,
  order_id      TEXT,
  conversion_at TIMESTAMPTZ,
  status        TEXT NOT NULL,                        -- enviada | aguardando | falhou | ignorada
  reason        TEXT,                                 -- por que não foi (em português)
  error_code    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_try_at   TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gconv_uploads_user ON public.google_conversion_uploads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gconv_uploads_wait ON public.google_conversion_uploads (next_try_at) WHERE status = 'aguardando';

-- Só o servidor lê e grava (rota /api/google-ads/conversions e o agendador).
ALTER TABLE public.google_conversion_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_conversion_targets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_conversion_uploads  ENABLE ROW LEVEL SECURITY;
