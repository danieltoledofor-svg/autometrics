-- Rastreamento próprio — Etapa 2: a venda ligada ao clique.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- postback_events.click_id  o clique (tracking_clicks.click_id) que gerou a venda
-- postback_events.ref_ids   tudo o que a plataforma devolveu no postback (subids,
--                           gclid, sessão), para ligar depois o que ainda não ligou

ALTER TABLE public.postback_events ADD COLUMN IF NOT EXISTS click_id TEXT;
ALTER TABLE public.postback_events ADD COLUMN IF NOT EXISTS ref_ids JSONB;
CREATE INDEX IF NOT EXISTS idx_postback_events_click ON public.postback_events (click_id);
