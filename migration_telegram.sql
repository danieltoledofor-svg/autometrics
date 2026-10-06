-- Alertas pelo Telegram.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- telegram_links  a conversa do Telegram de cada usuário (um por usuário)
-- alert_log       cada alerta enviado: o mesmo alerta da mesma campanha não
--                 se repete no mesmo dia

CREATE TABLE IF NOT EXISTS public.telegram_links (
  user_id     TEXT PRIMARY KEY,
  chat_id     TEXT,                              -- vazio = ainda não ligado
  chat_name   TEXT,
  code        TEXT,                              -- código que a pessoa manda para o bot
  code_at     TIMESTAMPTZ,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.alert_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  kind        TEXT NOT NULL,                     -- gasto_passou | gasto_ritmo
  details     JSONB,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, day, kind)
);
CREATE INDEX IF NOT EXISTS idx_alert_log_user ON public.alert_log (user_id, sent_at DESC);

-- Só o servidor lê e grava (rota /api/telegram e o agendador). Sem política
-- de propósito: a conversa de um usuário não pode ser trocada pelo navegador.
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_log      ENABLE ROW LEVEL SECURITY;
