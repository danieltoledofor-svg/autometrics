-- Integração direta com a Google Ads API.
--
-- Substitui aos poucos os scripts colados em cada MCC: o Autometrics passa a
-- consultar o Google sozinho, com o login OAuth de quem conectou.
--
-- google_ads_connections guarda o refresh token CRIPTOGRAFADO (AES-256-GCM,
-- chave GOOGLE_ADS_TOKEN_KEY no servidor). A tabela não tem política de RLS:
-- nem o usuário logado lê essa tabela pela chave pública — só as rotas do
-- servidor, com a service role.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

CREATE TABLE IF NOT EXISTS public.google_ads_connections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  google_email       TEXT NOT NULL,
  refresh_token_enc  TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ok',   -- ok | expirada
  last_error         TEXT,
  last_discovery_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, google_email)
);

CREATE TABLE IF NOT EXISTS public.google_ads_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  connection_id       UUID NOT NULL REFERENCES public.google_ads_connections(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL,          -- sem hífens
  login_customer_id   TEXT NOT NULL,          -- MCC pela qual a conta é acessada
  name                TEXT,
  mcc_name            TEXT,
  currency_code       TEXT,
  time_zone           TEXT,
  status              TEXT,                   -- ENABLED | SUSPENDED | CANCELED | CLOSED
  sync_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at        TIMESTAMPTZ,
  last_deep_sync_at   TIMESTAMPTZ,
  last_sync_status    TEXT,                   -- ok | parcial | erro | ignorada
  last_sync_error     TEXT,
  last_sync_summary   JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_gads_accounts_due
  ON public.google_ads_accounts (last_sync_at NULLS FIRST) WHERE sync_enabled;

-- Registro de cada pausa/ativação feita pelo painel.
CREATE TABLE IF NOT EXISTS public.google_ads_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  product_id       UUID REFERENCES public.products(id) ON DELETE SET NULL,
  customer_id      TEXT,
  campaign_id      TEXT,
  action           TEXT NOT NULL,     -- pausar | ativar
  previous_status  TEXT,
  new_status       TEXT,
  confirmed_status TEXT,              -- o que o Google devolveu depois da mudança
  ok               BOOLEAN NOT NULL DEFAULT FALSE,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gads_actions_product ON public.google_ads_actions (product_id, created_at DESC);

-- Consultas feitas à API por dia (fuso do Pacífico, o mesmo da cota do
-- Google). A coleta automática desacelera antes de estourar o limite do nível
-- de acesso — Explorer: 2.880/dia; Basic: 15.000/dia.
CREATE TABLE IF NOT EXISTS public.google_ads_usage (
  day        DATE PRIMARY KEY,
  api_calls  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.gads_add_usage(p_day DATE, p_calls INTEGER)
RETURNS INTEGER
LANGUAGE sql
AS $$
  INSERT INTO public.google_ads_usage (day, api_calls, updated_at)
  VALUES (p_day, p_calls, NOW())
  ON CONFLICT (day) DO UPDATE
    SET api_calls = public.google_ads_usage.api_calls + EXCLUDED.api_calls, updated_at = NOW()
  RETURNING api_calls;
$$;
REVOKE ALL ON FUNCTION public.gads_add_usage(DATE, INTEGER) FROM PUBLIC, anon, authenticated;

-- Conta dona de cada campanha: sem ela não dá para pausar/ativar.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS google_ads_customer_id TEXT;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.google_ads_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_actions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_usage       ENABLE ROW LEVEL SECURITY;

-- Contas e ações: o dono pode ler (o painel e as skills de análise usam).
-- Nenhuma política em google_ads_connections nem em google_ads_usage, de propósito.
DROP POLICY IF EXISTS "read_own_gads_accounts" ON public.google_ads_accounts;
CREATE POLICY "read_own_gads_accounts" ON public.google_ads_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "read_own_gads_actions" ON public.google_ads_actions;
CREATE POLICY "read_own_gads_actions" ON public.google_ads_actions
  FOR SELECT TO authenticated USING (user_id = auth.uid()::text);


-- ── Agendamento (rode depois de configurar GOOGLE_ADS_CRON_SECRET) ──────────
--
-- Chama a coleta a cada 5 minutos. Cada chamada processa só as contas que já
-- venceram o intervalo (15 min por padrão; contas paradas a cada 6 h) e para
-- sozinha perto do limite diário de consultas (GOOGLE_ADS_DAILY_QUOTA).
--
-- 1. Database → Extensions: ative pg_cron e pg_net.
-- 2. Troque COLE_O_SEGREDO pelo mesmo valor de GOOGLE_ADS_CRON_SECRET e rode:
--
-- SELECT cron.schedule(
--   'autometrics-google-ads-sync',
--   '*/5 * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://autometrics.cloud/api/google-ads/sync',
--     headers := jsonb_build_object('Authorization', 'Bearer COLE_O_SEGREDO', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 120000
--   );
--   $$
-- );
--
-- Conferir as execuções:  SELECT * FROM net._http_response ORDER BY created DESC LIMIT 10;
-- Parar o agendamento:    SELECT cron.unschedule('autometrics-google-ads-sync');
