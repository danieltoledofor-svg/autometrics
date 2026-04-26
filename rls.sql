ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_products" ON public.products;
CREATE POLICY "manage_own_products" ON public.products FOR ALL USING (user_id = auth.uid()::text);

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_daily_metrics" ON public.daily_metrics;
CREATE POLICY "manage_own_daily_metrics" ON public.daily_metrics FOR ALL USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

ALTER TABLE public.additional_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_additional_costs" ON public.additional_costs;
CREATE POLICY "manage_own_additional_costs" ON public.additional_costs FOR ALL USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_financial_goals" ON public.financial_goals;
CREATE POLICY "manage_own_financial_goals" ON public.financial_goals FOR ALL USING (user_id = auth.uid()::text);

ALTER TABLE public.postback_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_postbacks" ON public.postback_events;
CREATE POLICY "manage_own_postbacks" ON public.postback_events FOR ALL USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));
