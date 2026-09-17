-- ─────────────────────────────────────────────────────────────────────────────
-- CORREÇÃO DE SEGURANÇA — Row Level Security
--
-- A chave anônima do Supabase fica embutida no JavaScript do site e é visível
-- para qualquer visitante. Sem RLS, ela dá acesso direto ao banco.
--
-- Verificado em 16/09/2026, com a chave pública e SEM login:
--   products        — leitura liberada E INSERÇÃO liberada (registro criado e removido no teste)
--   daily_metrics   — leitura liberada
--   click_sessions  — leitura liberada
--
-- Ou seja: qualquer pessoa conseguia ler campanhas, custos, receitas e lucros de
-- TODOS os usuários da plataforma, e gravar registros no banco.
--
-- As demais tabelas (search_terms, audiences, locations, additional_costs,
-- financial_goals, postback_events, user_settings) já estavam protegidas.
--
-- O arquivo rls.sql do repositório já previa parte disto, mas nunca foi
-- aplicado ao banco. Este arquivo consolida e completa.
--
-- IMPORTANTE: o webhook e as rotas de API usam SUPABASE_SERVICE_ROLE_KEY, que
-- ignora RLS por definição. A coleta do Google Ads não é afetada.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── products: cada usuário enxerga apenas as próprias campanhas ──
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_products" ON public.products;
CREATE POLICY "manage_own_products" ON public.products
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ── daily_metrics: segue a campanha ──
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_daily_metrics" ON public.daily_metrics;
CREATE POLICY "manage_own_daily_metrics" ON public.daily_metrics
  FOR ALL
  USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text))
  WITH CHECK (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

-- ── click_sessions: rastreamento de cliques, também por campanha ──
ALTER TABLE public.click_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_click_sessions" ON public.click_sessions;
CREATE POLICY "manage_own_click_sessions" ON public.click_sessions
  FOR ALL
  USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text))
  WITH CHECK (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

-- ── Reforço nas demais: já respondiam vazio, mas garante a política explícita ──
ALTER TABLE public.search_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_search_terms" ON public.search_terms;
CREATE POLICY "manage_own_search_terms" ON public.search_terms
  FOR ALL
  USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text))
  WITH CHECK (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_audiences" ON public.audiences;
CREATE POLICY "manage_own_audiences" ON public.audiences
  FOR ALL
  USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text))
  WITH CHECK (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_locations" ON public.locations;
CREATE POLICY "manage_own_locations" ON public.locations
  FOR ALL
  USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text))
  WITH CHECK (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_user_settings" ON public.user_settings;
CREATE POLICY "manage_own_user_settings" ON public.user_settings
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE public.additional_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_additional_costs" ON public.additional_costs;
CREATE POLICY "manage_own_additional_costs" ON public.additional_costs
  FOR ALL
  USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text))
  WITH CHECK (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_financial_goals" ON public.financial_goals;
CREATE POLICY "manage_own_financial_goals" ON public.financial_goals
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

ALTER TABLE public.postback_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_postbacks" ON public.postback_events;
CREATE POLICY "manage_own_postbacks" ON public.postback_events
  FOR ALL
  USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text))
  WITH CHECK (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

-- ── Conferência: todas devem aparecer com rowsecurity = true ──
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('products','daily_metrics','click_sessions','search_terms',
                    'audiences','locations','user_settings','additional_costs',
                    'financial_goals','postback_events')
ORDER BY rowsecurity, tablename;
