-- Adiciona coluna 'source' para identificar a plataforma de venda (BuyGoods, Clickbank, etc.)
ALTER TABLE public.postback_events
  ADD COLUMN IF NOT EXISTS source TEXT;
