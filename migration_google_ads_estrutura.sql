-- Grupos de anúncios, anúncios e palavras-chave (Etapa 2).
--
-- Duas tabelas servem os três níveis:
--
-- google_ads_entities   o item como está hoje no Google: nome, status, lance,
--                       textos do anúncio, índice de qualidade. Uma linha por
--                       item, atualizada a cada coleta.
-- google_ads_entity_metrics
--                       o desempenho do item em cada dia. Só dias com
--                       impressão ou clique viram linha.
--
-- level: ad_group | ad | keyword. Item removido no Google continua aqui com
-- status REMOVED, para o histórico não perder o nome.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

CREATE TABLE IF NOT EXISTS public.google_ads_entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  level        TEXT NOT NULL,     -- ad_group | ad | keyword
  entity_id    TEXT NOT NULL,     -- id do Google; palavra-chave usa "grupo~critério"
  ad_group_id  TEXT,
  name         TEXT,
  status       TEXT,              -- ENABLED | PAUSED | REMOVED
  details      JSONB,             -- o resto: lances, textos, índice de qualidade
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, level, entity_id)
);

CREATE TABLE IF NOT EXISTS public.google_ads_entity_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  level             TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  date              DATE NOT NULL,
  impressions       INTEGER NOT NULL DEFAULT 0,
  clicks            INTEGER NOT NULL DEFAULT 0,
  cost              NUMERIC(15,4) NOT NULL DEFAULT 0,   -- moeda da conta
  conversions       NUMERIC NOT NULL DEFAULT 0,         -- conversões do Google, não o postback
  conversions_value NUMERIC NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, level, entity_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gads_entity_metrics_period
  ON public.google_ads_entity_metrics (product_id, level, date);

-- Primeira coleta da conta traz 30 dias; as seguintes, só os últimos dias.
ALTER TABLE public.google_ads_accounts
  ADD COLUMN IF NOT EXISTS entities_synced_at TIMESTAMPTZ;

-- Leitura pelo painel, restrita às campanhas do próprio usuário. A gravação é
-- da coleta, com a service role.
ALTER TABLE public.google_ads_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_own_gads_entities" ON public.google_ads_entities;
CREATE POLICY "read_own_gads_entities" ON public.google_ads_entities
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = google_ads_entities.product_id
            AND p.user_id::text = auth.uid()::text));

ALTER TABLE public.google_ads_entity_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_own_gads_entity_metrics" ON public.google_ads_entity_metrics;
CREATE POLICY "read_own_gads_entity_metrics" ON public.google_ads_entity_metrics
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = google_ads_entity_metrics.product_id
            AND p.user_id::text = auth.uid()::text));
