-- Rastreamento próprio — saída para o checkout.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- tracking_pageviews.kind  'page' = página aberta; 'checkout' = clique no link de compra

ALTER TABLE public.tracking_pageviews ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'page';
