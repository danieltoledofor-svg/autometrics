-- ─────────────────────────────────────────────────────────────────────────────
-- CORREÇÃO DE SEGURANÇA — Row Level Security (passo 2)
--
-- O passo anterior ativou RLS nas 10 tabelas (rowsecurity = true), mas products,
-- daily_metrics e click_sessions CONTINUARAM legíveis pela chave pública.
--
-- Motivo: políticas de RLS se somam. Basta UMA política permissiva para liberar
-- o acesso, e essas tabelas têm políticas antigas — provavelmente criadas como
-- "permitir tudo" durante o desenvolvimento. O script anterior removia apenas a
-- política de mesmo nome que ia criar, deixando as outras intactas.
--
-- Este arquivo remove TODAS as políticas das 10 tabelas e recria somente a
-- correta, para não restar nenhuma porta aberta esquecida.
--
-- Antes de remover, a primeira consulta lista o que existe hoje — guarde o
-- resultado, é o registro do que estava aberto.
--
-- O webhook usa SUPABASE_SERVICE_ROLE_KEY, que ignora RLS. A coleta não é
-- afetada.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. O que existe hoje (anote o resultado) ──
SELECT tablename, policyname, cmd, roles::text, qual::text AS condicao
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('products','daily_metrics','click_sessions','search_terms','audiences','locations','postback_events','additional_costs','financial_goals','user_settings')
ORDER BY tablename, policyname;

-- ── 2. Remove TODAS as políticas dessas tabelas ──
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('products','daily_metrics','click_sessions','search_terms','audiences','locations','postback_events','additional_costs','financial_goals','user_settings')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'removida: % em %', r.policyname, r.tablename;
  END LOOP;
END $$;

-- ── 3. Recria apenas a política correta de cada tabela ──
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_products" ON public.products
  FOR ALL
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_daily_metrics" ON public.daily_metrics
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = daily_metrics.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = daily_metrics.product_id
            AND p.user_id::text = auth.uid()::text));
ALTER TABLE public.click_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_click_sessions" ON public.click_sessions
  FOR ALL
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
ALTER TABLE public.search_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_search_terms" ON public.search_terms
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = search_terms.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = search_terms.product_id
            AND p.user_id::text = auth.uid()::text));
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_audiences" ON public.audiences
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = audiences.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = audiences.product_id
            AND p.user_id::text = auth.uid()::text));
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_locations" ON public.locations
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = locations.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = locations.product_id
            AND p.user_id::text = auth.uid()::text));
ALTER TABLE public.postback_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_postback_events" ON public.postback_events
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = postback_events.product_id
            AND p.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p
          WHERE p.id = postback_events.product_id
            AND p.user_id::text = auth.uid()::text));
ALTER TABLE public.additional_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_additional_costs" ON public.additional_costs
  FOR ALL
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_financial_goals" ON public.financial_goals
  FOR ALL
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage_own_user_settings" ON public.user_settings
  FOR ALL
  TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ── 4. Conferência: deve sobrar exatamente UMA política por tabela,
--       restrita ao papel 'authenticated' ──
SELECT tablename, policyname, roles::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('products','daily_metrics','click_sessions','search_terms','audiences','locations','postback_events','additional_costs','financial_goals','user_settings')
ORDER BY tablename;
