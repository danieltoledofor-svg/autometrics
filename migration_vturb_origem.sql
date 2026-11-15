-- Origem do player da VTurb de cada campanha.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- manual  colado por você em Campanha → VTurb: o rastreamento nunca troca
-- auto    achado pelo Autometrics (na visita à VSL ou no "encontrar para mim"):
--         se a VSL passar a mostrar outro vídeo, o rastreamento troca sozinho
--
-- Os players que já estavam ligados foram colados à mão: ficam como manual.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vturb_player_source TEXT;
UPDATE public.products SET vturb_player_source = 'manual'
  WHERE vturb_player_id IS NOT NULL AND vturb_player_source IS NULL;

-- A API do Supabase passa a enxergar a coluna nova na hora.
NOTIFY pgrst, 'reload schema';
