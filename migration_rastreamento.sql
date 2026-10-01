-- Rastreamento próprio — Etapa 1: o clique e as páginas visitadas.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- tracking_clicks     uma linha por clique: gclid (ou identificador próprio), campanha,
--                     UTMs, palavra-chave, aparelho e tudo o que veio na URL de entrada
-- tracking_pageviews  cada página que a pessoa abriu depois do clique

CREATE TABLE IF NOT EXISTS public.tracking_clicks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  click_id     TEXT NOT NULL,              -- gclid / gbraid / wbraid, ou am_xxx quando a URL não traz nenhum
  product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
  campaign_id  TEXT,
  gclid        TEXT,
  gbraid       TEXT,
  wbraid       TEXT,
  ft_sid       TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_term     TEXT,
  utm_content  TEXT,
  keyword      TEXT,
  match_type   TEXT,
  ad_group_id  TEXT,
  ad_id        TEXT,
  network      TEXT,
  device       TEXT,                       -- MOBILE | DESKTOP | TABLET
  landing_url  TEXT,
  referrer     TEXT,
  user_agent   TEXT,
  params       JSONB,                      -- a URL de entrada inteira, campo a campo
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, click_id)
);
CREATE INDEX IF NOT EXISTS idx_tracking_clicks_product ON public.tracking_clicks (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_clicks_user ON public.tracking_clicks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tracking_pageviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  click_id   TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracking_pageviews_click ON public.tracking_pageviews (user_id, click_id, created_at);

-- ── Acesso ─────────────────────────────────────────────────────────────────
-- Gravação e leitura só pelo servidor (service role). Nada aberto para o navegador.
ALTER TABLE public.tracking_clicks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_pageviews ENABLE ROW LEVEL SECURITY;
