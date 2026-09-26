-- Preferências das tabelas por usuário: largura de cada coluna, densidade
-- (compacto/confortável) e colunas visíveis. Valem em qualquer computador em
-- que a pessoa entrar.
--
-- prefs: { "tables": { "<tabela>": { "widths": {"cost": 120}, "density": "compact", "columns": [...] } } }
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

CREATE TABLE IF NOT EXISTS public.user_ui_prefs (
  user_id     TEXT PRIMARY KEY DEFAULT auth.uid()::text,
  prefs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manage_own_ui_prefs" ON public.user_ui_prefs;
CREATE POLICY "manage_own_ui_prefs" ON public.user_ui_prefs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);
