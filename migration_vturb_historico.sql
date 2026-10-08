-- VTurb — uma curva de retenção guardada por semana fechada.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- vturb_retention guarda só a curva dos últimos 7 dias. Com esta tabela, a aba
-- VTurb mostra a curva da semana anterior por baixo da atual, para ver o que
-- mudou depois de uma alteração na campanha, na página ou no vídeo.
-- A comparação começa a aparecer cerca de uma semana depois de rodar.

CREATE TABLE IF NOT EXISTS public.vturb_retention_history (
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  player_id   TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  duration    INTEGER NOT NULL,
  pitch_time  INTEGER,
  curve       JSONB NOT NULL,              -- [[segundo, % ainda assistindo], ...] a cada 30 s
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, player_id, end_date)
);

-- A tela lê pela rota /api/vturb (service role). Nada aberto para o navegador.
ALTER TABLE public.vturb_retention_history ENABLE ROW LEVEL SECURITY;
