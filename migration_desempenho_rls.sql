-- Desempenho das telas (Dashboard, Metas, Campanhas): regras de acesso mais leves.
--
-- As regras de segurança (RLS) chamavam auth.uid() uma vez POR LINHA lida, e em
-- daily_metrics ainda faziam a busca da campanha dona da linha também por linha.
-- Com auth.uid() dentro de um (select ...), o banco calcula o usuário uma única
-- vez por consulta (recomendação do próprio Supabase). Quem pode ver o quê não
-- muda: são as mesmas condições de migration_rls_seguranca.sql.
--
-- O índice em products(user_id) serve à lista de campanhas de cada usuário e à
-- checagem de dono feita pelas regras das outras tabelas.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.

CREATE INDEX IF NOT EXISTS idx_products_user ON public.products (user_id);

DROP POLICY IF EXISTS "manage_own_products" ON public.products;
CREATE POLICY "manage_own_products" ON public.products
  FOR ALL
  TO authenticated
  USING (user_id::text = (select auth.uid()::text))
  WITH CHECK (user_id::text = (select auth.uid()::text));

DROP POLICY IF EXISTS "manage_own_daily_metrics" ON public.daily_metrics;
CREATE POLICY "manage_own_daily_metrics" ON public.daily_metrics
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = daily_metrics.product_id
            AND p.user_id::text = (select auth.uid()::text)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = daily_metrics.product_id
            AND p.user_id::text = (select auth.uid()::text)));

DROP POLICY IF EXISTS "manage_own_additional_costs" ON public.additional_costs;
CREATE POLICY "manage_own_additional_costs" ON public.additional_costs
  FOR ALL
  TO authenticated
  USING (user_id::text = (select auth.uid()::text))
  WITH CHECK (user_id::text = (select auth.uid()::text));

DROP POLICY IF EXISTS "manage_own_financial_goals" ON public.financial_goals;
CREATE POLICY "manage_own_financial_goals" ON public.financial_goals
  FOR ALL
  TO authenticated
  USING (user_id::text = (select auth.uid()::text))
  WITH CHECK (user_id::text = (select auth.uid()::text));

-- Conferência: uma política por tabela, com "( SELECT auth.uid()" no texto.
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('products','daily_metrics','additional_costs','financial_goals');
