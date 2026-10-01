-- Etapa 4 — VTurb guardada no banco e cruzada com o Google.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- vturb_daily          números do player por dia (carregaram, play, pitch, vendas)
-- vturb_daily_by_term  os mesmos números por utm_term, por dia
-- vturb_gclid          uma linha por visita com gclid, por dia (liga visita e venda à palavra-chave)
-- vturb_retention      curva de retenção dos últimos 7 dias, atualizada 1 vez por dia
-- google_ads_clicks    gclid → palavra-chave, do click_view do Google (só contas pela API)
-- products.vturb_*     duração, pitch, nome e estado da última leitura do player

CREATE TABLE IF NOT EXISTS public.vturb_daily (
  product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  player_id    TEXT NOT NULL,
  date         DATE NOT NULL,
  viewed       INTEGER NOT NULL DEFAULT 0,   -- sessões que carregaram o vídeo
  started      INTEGER NOT NULL DEFAULT 0,   -- sessões que deram play
  over_pitch   INTEGER NOT NULL DEFAULT 0,
  under_pitch  INTEGER NOT NULL DEFAULT 0,
  finished     INTEGER NOT NULL DEFAULT 0,
  clicked      INTEGER NOT NULL DEFAULT 0,
  conversions  INTEGER NOT NULL DEFAULT 0,
  amount_usd   NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, player_id, date)
);

CREATE TABLE IF NOT EXISTS public.vturb_daily_by_term (
  product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  player_id    TEXT NOT NULL,
  date         DATE NOT NULL,
  term         TEXT NOT NULL,
  viewed       INTEGER NOT NULL DEFAULT 0,
  started      INTEGER NOT NULL DEFAULT 0,
  over_pitch   INTEGER NOT NULL DEFAULT 0,
  under_pitch  INTEGER NOT NULL DEFAULT 0,
  conversions  INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, player_id, date, term)
);

CREATE TABLE IF NOT EXISTS public.vturb_gclid (
  product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  player_id    TEXT NOT NULL,
  date         DATE NOT NULL,
  gclid        TEXT NOT NULL,
  viewed       INTEGER NOT NULL DEFAULT 0,
  started      INTEGER NOT NULL DEFAULT 0,
  over_pitch   INTEGER NOT NULL DEFAULT 0,
  under_pitch  INTEGER NOT NULL DEFAULT 0,
  conversions  INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, player_id, date, gclid)
);
CREATE INDEX IF NOT EXISTS idx_vturb_gclid_gclid ON public.vturb_gclid (gclid);

CREATE TABLE IF NOT EXISTS public.vturb_retention (
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  player_id      TEXT NOT NULL,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  duration       INTEGER NOT NULL,
  pitch_time     INTEGER,
  average_watched INTEGER,
  curve          JSONB NOT NULL,             -- [[segundo, % ainda assistindo], ...] a cada 30 s
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.google_ads_clicks (
  gclid          TEXT PRIMARY KEY,
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  keyword_text   TEXT,
  match_type     TEXT,
  ad_group_id    TEXT,
  device         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gads_clicks_product ON public.google_ads_clicks (product_id, date);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vturb_duration INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vturb_pitch_time INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vturb_player_name TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vturb_synced_at TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vturb_sync_error TEXT;

-- ── Acesso ─────────────────────────────────────────────────────────────────
-- A tela lê pela rota /api/vturb (service role). Nada aberto para o navegador.
ALTER TABLE public.vturb_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vturb_daily_by_term ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vturb_gclid         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vturb_retention     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_clicks   ENABLE ROW LEVEL SECURITY;
