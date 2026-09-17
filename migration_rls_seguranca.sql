-- ─────────────────────────────────────────────────────────────────────────────
-- CORREÇÃO DE SEGURANÇA — Row Level Security
--
-- A chave anônima do Supabase fica embutida no JavaScript do site e é visível
-- para qualquer visitante. Sem RLS, ela dá acesso direto ao banco.
--
-- Verificado em produção em 16/09/2026, com a chave pública e SEM login:
--   products        leitura liberada E INSERÇÃO liberada
--   daily_metrics   leitura liberada
--   click_sessions  leitura liberada
--
-- Qualquer pessoa podia ler campanhas, custos, receitas e lucros de TODOS os
-- usuários da plataforma, e gravar registros.
--
-- Duas armadilhas encontradas ao escrever este arquivo:
--
-- 1. A chave varia por tabela. click_sessions e additional_costs usam user_id,
--    não product_id. Presumir o contrário dá "column product_id does not exist".
--
-- 2. O tipo de user_id varia entre as tabelas: em products é TEXT (guarda
--    'test_user', que não é UUID), em outras é UUID. Comparar direto com
--    auth.uid() dá "operator does not exist: uuid = text". Por isso os dois
--    lados são convertidos para texto.
--
-- Nas tabelas filhas a ligação usa EXISTS com p.id = product_id, sem cast, para
-- não perder o índice da chave primária; o cast fica só na comparação de
-- usuário, que roda uma vez por linha de products.
--
-- WITH CHECK é tão importante quanto USING: sem ele a política barra a leitura
-- de dados alheios, mas não impede gravar uma linha com o user_id de outro.
--
-- O webhook usa SUPABASE_SERVICE_ROLE_KEY, que ignora RLS (confirmada presente
-- em produção). A coleta do Google Ads não é afetada.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.
-- ─────────────────────────────────────────────────────────────────────────────

-- products: cada usuário enxerga apenas as próprias campanhas
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_products" ON public.products;
CREATE POLICY "manage_own_products" ON public.products
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
-- daily_metrics: métricas do dia seguem a campanha
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_daily_metrics" ON public.daily_metrics;
CREATE POLICY "manage_own_daily_metrics" ON public.daily_metrics
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = daily_metrics.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = daily_metrics.product_id
            AND p.user_id::text = auth.uid()::text));
-- click_sessions: rastreamento de cliques, ligado ao usuário
ALTER TABLE public.click_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_click_sessions" ON public.click_sessions;
CREATE POLICY "manage_own_click_sessions" ON public.click_sessions
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
-- search_terms: termos de pesquisa seguem a campanha
ALTER TABLE public.search_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_search_terms" ON public.search_terms;
CREATE POLICY "manage_own_search_terms" ON public.search_terms
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = search_terms.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = search_terms.product_id
            AND p.user_id::text = auth.uid()::text));
-- audiences: públicos seguem a campanha
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_audiences" ON public.audiences;
CREATE POLICY "manage_own_audiences" ON public.audiences
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = audiences.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = audiences.product_id
            AND p.user_id::text = auth.uid()::text));
-- locations: localizações seguem a campanha
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_locations" ON public.locations;
CREATE POLICY "manage_own_locations" ON public.locations
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = locations.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = locations.product_id
            AND p.user_id::text = auth.uid()::text));
-- postback_events: postbacks seguem a campanha
ALTER TABLE public.postback_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_postback_events" ON public.postback_events;
CREATE POLICY "manage_own_postback_events" ON public.postback_events
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = postback_events.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = postback_events.product_id
            AND p.user_id::text = auth.uid()::text));
-- additional_costs: custos extras, ligados ao usuário
ALTER TABLE public.additional_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_additional_costs" ON public.additional_costs;
CREATE POLICY "manage_own_additional_costs" ON public.additional_costs
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
-- financial_goals: metas, ligadas ao usuário
ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_financial_goals" ON public.financial_goals;
CREATE POLICY "manage_own_financial_goals" ON public.financial_goals
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
-- user_settings: preferências do usuário (token da Vturb)
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_user_settings" ON public.user_settings;
CREATE POLICY "manage_own_user_settings" ON public.user_settings
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- Conferência: todas devem sair com rowsecurity = true
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('products','daily_metrics','click_sessions','search_terms','audiences','locations','postback_events','additional_costs','financial_goals','user_settings')
ORDER BY rowsecurity, tablename;
