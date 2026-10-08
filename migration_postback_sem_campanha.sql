-- Postbacks que chegaram e não acharam a campanha.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- Até aqui esses postbacks eram descartados sem deixar rastro: a venda sumia e
-- não dava para saber por quê. Agora cada um fica guardado com o que a
-- plataforma mandou, para conferir e corrigir a ligação da campanha.

CREATE TABLE IF NOT EXISTS public.postback_unmatched (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  event_type     TEXT,
  amount         NUMERIC,
  currency       TEXT,
  transaction_id TEXT,
  source         TEXT,
  ref_ids        TEXT[],                           -- o que veio nos subids (sessão, gclid…)
  campaign_name  TEXT,
  query          TEXT,                             -- o pedido inteiro, como a plataforma mandou
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_postback_unmatched_user ON public.postback_unmatched (user_id, created_at DESC);

-- Só o servidor lê e grava.
ALTER TABLE public.postback_unmatched ENABLE ROW LEVEL SECURITY;
