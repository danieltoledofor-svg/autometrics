-- Palavra-chave nos termos de pesquisa e conversões por ação (Checkout, Compra…).
--
-- 1. search_terms passa a guardar a palavra-chave que acionou o termo, a
--    correspondência, o grupo e o status do termo (adicionado/excluído). Um
--    mesmo termo pode vir de palavras-chave diferentes, então a chave única
--    passa a incluir a palavra-chave. Linhas do script ficam com palavra-chave
--    vazia.
-- 2. conversion_actions / google_conversion_actions: as conversões do Google
--    separadas por ação de conversão, por dia. É o que a coluna personalizada
--    do Google faz ao filtrar "Todas as conversões" por uma ação:
--    { "Checkout": { "a": todas as conv., "c": conversões, "v": valor } }
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

ALTER TABLE public.search_terms
  ADD COLUMN IF NOT EXISTS keyword            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS keyword_match_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ad_group_name      TEXT,
  ADD COLUMN IF NOT EXISTS term_status        TEXT,     -- ADDED | EXCLUDED | ADDED_EXCLUDED | NONE
  ADD COLUMN IF NOT EXISTS term_match_type    TEXT,     -- como o termo casou: EXACT, PHRASE, BROAD, NEAR_EXACT…
  ADD COLUMN IF NOT EXISTS conversion_actions JSONB;

-- Troca a chave única (produto, dia, termo) por (produto, dia, termo, palavra-chave).
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.search_terms'::regclass
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 3
  LOOP
    EXECUTE format('ALTER TABLE public.search_terms DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'removida: %', c.conname;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS search_terms_term_keyword_key
  ON public.search_terms (product_id, date, search_term, keyword, keyword_match_type);

ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS google_conversion_actions JSONB;
ALTER TABLE public.google_ads_entity_metrics
  ADD COLUMN IF NOT EXISTS conversion_actions JSONB;

COMMENT ON COLUMN public.daily_metrics.google_conversion_actions IS
  'Conversões do Google por ação de conversão no dia: {"Checkout": {"a": todas, "c": conversões, "v": valor}}';
