-- LootRush: cobranças dos cartões, para avisar no Telegram e conferir com o gasto do Google.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- lootrush_connections  a chave da LootRush de cada usuário (criptografada) e os
--                       grupos de cartões que ele acompanha
-- lootrush_charges      cada cobrança lida desses grupos, com a conta do Google
--                       tirada do nome da cobrança ("Google ADS1234567890")

CREATE TABLE IF NOT EXISTS public.lootrush_connections (
  user_id       TEXT PRIMARY KEY,
  key_enc       TEXT NOT NULL,                    -- chave da LootRush, criptografada (só leitura)
  groups        JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ id, name }] grupos de cartões acompanhados
  status        TEXT NOT NULL DEFAULT 'ok',       -- ok | erro
  last_error    TEXT,
  last_sync_at  TIMESTAMPTZ,
  baseline_at   TIMESTAMPTZ,                      -- primeira leitura: o que já existia não vira aviso
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lootrush_charges (
  user_id        TEXT NOT NULL,
  id             TEXT NOT NULL,                   -- id da cobrança na LootRush
  group_id       TEXT,
  group_name     TEXT,
  card_last4     TEXT,
  card_name      TEXT,
  merchant       TEXT,
  customer_id    TEXT,                            -- conta do Google Ads tirada do nome da cobrança
  code           TEXT,                            -- código de verificação do Google, quando o nome traz um
  amount         NUMERIC NOT NULL DEFAULT 0,      -- em dólar, como a LootRush cobra do saldo
  local_amount   NUMERIC,
  local_currency TEXT,
  status         TEXT,                            -- on_hold | settled | declined | reversed
  polarity       TEXT,                            -- debit | credit
  reason         TEXT,                            -- motivo da recusa, quando a LootRush informa
  charged_at     TIMESTAMPTZ NOT NULL,
  posted_at      TIMESTAMPTZ,
  notified       TEXT,                            -- último estado já avisado no Telegram
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_lootrush_charges_when ON public.lootrush_charges (user_id, charged_at DESC);
CREATE INDEX IF NOT EXISTS idx_lootrush_charges_account ON public.lootrush_charges (user_id, customer_id, charged_at DESC);

-- Só o servidor lê e grava (rota /api/lootrush e o agendador). Sem política de
-- propósito: a chave e as cobranças não saem pelo navegador direto do banco.
ALTER TABLE public.lootrush_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lootrush_charges     ENABLE ROW LEVEL SECURITY;
