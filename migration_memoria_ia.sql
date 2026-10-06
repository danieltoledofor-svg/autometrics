-- Memória da IA: decisões, observações e materiais que o usuário guarda para
-- a IA levar em conta nas análises (tela Análise de IA).
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- content  o texto inteiro, como o usuário colou ou enviou (.md / .txt)
-- summary  o que entra no pedido à IA: o próprio texto, quando é curto, ou o
--          resumo em regras práticas feito na hora de guardar
-- scope    marcação do nome da campanha a que a anotação vale ("[WL]");
--          vazio = vale para todas

CREATE TABLE IF NOT EXISTS public.ai_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  product_id  UUID REFERENCES public.products(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'observacao',   -- decisao | material | observacao
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  summary     TEXT,
  scope       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_memory_user ON public.ai_memory (user_id, created_at DESC);

-- A tela lê e grava pela rota /api/memory (service role). Aqui, só leitura do
-- que é do próprio usuário.
ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_own_ai_memory" ON public.ai_memory;
CREATE POLICY "read_own_ai_memory" ON public.ai_memory
  FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
