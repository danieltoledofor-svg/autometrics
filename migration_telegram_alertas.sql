-- Alertas do Telegram: preferências de cada usuário e registro mais flexível.
--
-- Rode no SQL Editor do Supabase, depois de migration_telegram.sql.
-- Pode rodar de novo sem problema.
--
-- telegram_links.settings  quais alertas estão ligados, os limites de cada um
--                          e o horário de silêncio
-- alert_log.key            o que identifica o alerta dentro do dia (campanha,
--                          conta, número da venda…). Com ela, alerta sem
--                          campanha (resumo do dia, coleta) também cabe, e a
--                          mesma campanha pode avisar mais de uma venda no dia.

ALTER TABLE public.telegram_links ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.alert_log ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.alert_log ADD COLUMN IF NOT EXISTS key TEXT NOT NULL DEFAULT '';
UPDATE public.alert_log SET key = product_id::text WHERE key = '' AND product_id IS NOT NULL;

ALTER TABLE public.alert_log DROP CONSTRAINT IF EXISTS alert_log_product_id_day_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS alert_log_unique_key ON public.alert_log (user_id, day, kind, key);
CREATE INDEX IF NOT EXISTS idx_alert_log_kind ON public.alert_log (user_id, kind, sent_at DESC);
