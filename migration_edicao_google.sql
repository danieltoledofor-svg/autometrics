-- Alterações feitas pelo Autometrics no Google Ads: meta de CPA, limite de CPC,
-- orçamento e ajustes de lance (aparelho, idade, gênero e local).
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- google_ads_actions já guardava cada pausa e ativação; passa a guardar também
-- o que foi alterado, de quanto para quanto, e o que serve para desfazer.

ALTER TABLE public.google_ads_actions
  ADD COLUMN IF NOT EXISTS kind           TEXT,      -- meta_cpa | limite_cpc | orcamento | aparelho | idade | genero | local
  ADD COLUMN IF NOT EXISTS target         TEXT,      -- o que foi alterado, por extenso ("Computador", "65 ou mais")
  ADD COLUMN IF NOT EXISTS target_key     TEXT,      -- identificador do item no Google
  ADD COLUMN IF NOT EXISTS previous_value NUMERIC,   -- dinheiro na moeda da conta, ou % do ajuste
  ADD COLUMN IF NOT EXISTS new_value      NUMERIC,
  ADD COLUMN IF NOT EXISTS undone_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undo_of        UUID;
