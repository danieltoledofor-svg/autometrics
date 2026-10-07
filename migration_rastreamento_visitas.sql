-- Rastreamento próprio — visitas: de onde veio cada clique e o que a pessoa fez.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- tracking_clicks ganha, para cada visita: o IP e o local (país, estado e
-- cidade), sistema e navegador, tela, idioma, a origem (anúncio, busca, rede
-- social, outro site ou direto), se é robô, o tempo na página e até onde rolou.
-- A partir daqui também entram as visitas que não vieram de anúncio.

ALTER TABLE public.tracking_clicks
  ADD COLUMN IF NOT EXISTS ip           TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS country      TEXT,
  ADD COLUMN IF NOT EXISTS region       TEXT,
  ADD COLUMN IF NOT EXISTS city         TEXT,
  ADD COLUMN IF NOT EXISTS geo_at       TIMESTAMPTZ,            -- quando o local foi procurado (achando ou não)
  ADD COLUMN IF NOT EXISTS os           TEXT,
  ADD COLUMN IF NOT EXISTS browser      TEXT,
  ADD COLUMN IF NOT EXISTS screen       TEXT,                   -- "390x844"
  ADD COLUMN IF NOT EXISTS language     TEXT,
  ADD COLUMN IF NOT EXISTS traffic      TEXT,                   -- pago | organico | social | referencia | direto
  ADD COLUMN IF NOT EXISTS is_bot       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seconds      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_scroll   INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tracking_clicks_geo_wait
  ON public.tracking_clicks (created_at) WHERE ip IS NOT NULL AND geo_at IS NULL;

-- Tempo na página e rolagem chegam aos poucos: soma o tempo e guarda a maior rolagem.
CREATE OR REPLACE FUNCTION public.tracking_touch(p_user TEXT, p_click TEXT, p_seconds INTEGER, p_scroll INTEGER)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.tracking_clicks
     SET seconds      = seconds + GREATEST(0, LEAST(COALESCE(p_seconds, 0), 3600)),
         max_scroll   = GREATEST(max_scroll, LEAST(COALESCE(p_scroll, 0), 100)),
         last_seen_at = NOW()
   WHERE user_id = p_user AND click_id = p_click;
$$;
REVOKE ALL ON FUNCTION public.tracking_touch(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
