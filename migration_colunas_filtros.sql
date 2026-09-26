-- Colunas, filtros e colunas personalizadas em todas as abas da campanha.
--
-- 1. google_metrics (JSON) em grupos/anúncios/palavras-chave, termos, públicos
--    e locais: o bloco de métricas do Google de cada dia, para as mesmas
--    colunas que a Visão Geral já tem.
-- 2. conversions dessas três tabelas vira NUMERIC. Era INTEGER, e o Google
--    manda conversões fracionadas (1,5): o banco recusava o lote inteiro do
--    dia e o termo/público/local se perdia.
-- 3. custom_columns: as fórmulas que cada usuário cria no painel.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

ALTER TABLE public.google_ads_entity_metrics ADD COLUMN IF NOT EXISTS google_metrics JSONB;
ALTER TABLE public.search_terms ADD COLUMN IF NOT EXISTS google_metrics JSONB;
ALTER TABLE public.audiences    ADD COLUMN IF NOT EXISTS google_metrics JSONB;
ALTER TABLE public.locations    ADD COLUMN IF NOT EXISTS google_metrics JSONB;

ALTER TABLE public.search_terms ALTER COLUMN conversions TYPE NUMERIC;
ALTER TABLE public.audiences    ALTER COLUMN conversions TYPE NUMERIC;
ALTER TABLE public.locations    ALTER COLUMN conversions TYPE NUMERIC;

-- As abas agora filtram pelo período da tela.
CREATE INDEX IF NOT EXISTS idx_search_terms_period ON public.search_terms (product_id, date);
CREATE INDEX IF NOT EXISTS idx_audiences_period    ON public.audiences (product_id, date);
CREATE INDEX IF NOT EXISTS idx_locations_period    ON public.locations (product_id, date);

CREATE TABLE IF NOT EXISTS public.custom_columns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL DEFAULT auth.uid()::text,
  name        TEXT NOT NULL,
  formula     TEXT NOT NULL,
  format      TEXT NOT NULL DEFAULT 'number',   -- number | money | percent
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_columns_user ON public.custom_columns (user_id);

ALTER TABLE public.custom_columns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_custom_columns" ON public.custom_columns;
CREATE POLICY "manage_own_custom_columns" ON public.custom_columns
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);
