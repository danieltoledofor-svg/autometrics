-- Etapa 5 — Análise da campanha com IA (OpenRouter).
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- campaign_analyses       a leitura mais recente de cada campanha (checklist de 8 itens)
-- analysis_suggestions    cada ponto de alteração, com os números do momento e o resultado depois
-- ai_learnings            memória geral: o que funcionou ou não, sem nome de campanha, conta ou usuário
-- ai_usage / ai_settings  consumo da IA e modelo de cada função (só o dono do Autometrics vê)
-- google_ads_changes      alterações feitas no Google Ads, para saber quando uma sugestão foi aplicada
-- products.vsl_transcript transcrição da VSL (item 8 do checklist)

-- ── Leitura da campanha ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_analyses (
  product_id      UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period          JSONB NOT NULL,          -- { d3: [ini, fim], d7: [ini, fim], today }
  reference       JSONB NOT NULL,          -- { mode: venda|meta_cpa|cpa_7d|nenhuma, value, warn, urgent, no_sale }
  numbers         JSONB NOT NULL,          -- linha de números da campanha (3d × 7d)
  checklist       JSONB NOT NULL,          -- os itens, na ordem da tela
  summary         JSONB,                   -- { status, title, text } — texto da IA ou do modelo fixo
  summary_hash    TEXT,                    -- muda quando algum item muda de status: aí a IA reescreve
  page            JSONB,                   -- item 8: resultado da leitura anúncio × página × VSL
  page_hash       TEXT,
  page_checked_at TIMESTAMPTZ
);

-- ── Sugestões e o resultado delas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analysis_suggestions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  product_id       UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  item             TEXT NOT NULL,          -- termos | palavras_chave | dispositivos | publicos | locais | anuncios | sitelinks | pagina
  target_key       TEXT NOT NULL,          -- o que foi apontado (termo, id da palavra-chave, dispositivo…)
  target_label     TEXT NOT NULL,
  action           TEXT NOT NULL,          -- tipo da alteração: negativa, lance, pausar… (lib/analysis/actions.ts)
  text             TEXT NOT NULL,          -- o "Ponto de alteração" mostrado na tela
  severity         TEXT NOT NULL,          -- alerta | urgente
  baseline         JSONB NOT NULL,         -- números do item e da campanha no momento da sugestão
  situation        JSONB NOT NULL,         -- a situação em termos gerais (vai para a memória geral)
  status           TEXT NOT NULL DEFAULT 'aberta', -- aberta | aplicada | ignorada | nao_faz_sentido | resolvida_sozinha | avaliada
  change_at        TIMESTAMPTZ,            -- quando a mudança apareceu no Google
  change           JSONB,                  -- a alteração encontrada
  eval_3d          JSONB,
  eval_7d          JSONB,
  outcome          TEXT,                   -- funcionou | piorou | sem_efeito
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma sugestão aberta por alvo: a mesma análise rodando de hora em hora não repete.
CREATE UNIQUE INDEX IF NOT EXISTS analysis_suggestions_open_key
  ON public.analysis_suggestions (product_id, item, target_key) WHERE status IN ('aberta', 'aplicada');
CREATE INDEX IF NOT EXISTS idx_analysis_suggestions_product ON public.analysis_suggestions (product_id, created_at DESC);

-- ── Memória geral ──────────────────────────────────────────────────────────
-- Junta todos os usuários. Não guarda nome de campanha, conta, produto nem
-- usuário: o que volta para a IA é só o padrão (tipo de item, situação,
-- alteração e resultado). A origem fica em source_id, que nunca sai do servidor.
CREATE TABLE IF NOT EXISTS public.ai_learnings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item         TEXT NOT NULL,
  action       TEXT NOT NULL,
  situation    JSONB NOT NULL,
  outcome      TEXT NOT NULL,              -- funcionou | piorou | sem_efeito
  cpa_change   NUMERIC,                    -- variação do CPA da campanha, em %
  waste_change NUMERIC,                    -- variação do gasto sem venda do item, em %
  source_id    UUID UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_learnings_item ON public.ai_learnings (item, action);

-- ── Consumo e configuração da IA ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  product_id    UUID,
  function      TEXT NOT NULL,             -- leitura | pagina
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
  ok            BOOLEAN NOT NULL DEFAULT TRUE,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_period ON public.ai_usage (created_at, user_id);

CREATE TABLE IF NOT EXISTS public.ai_settings (
  function    TEXT PRIMARY KEY,            -- leitura | pagina
  model       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Alterações feitas no Google Ads ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  changed_at     TEXT NOT NULL,            -- "AAAA-MM-DD HH:MM:SS" no fuso da conta, como o Google manda
  resource_type  TEXT,
  operation      TEXT,
  resource_name  TEXT NOT NULL,
  fields         JSONB,                    -- [{ f, de, para }]
  new_resource   JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, resource_name, changed_at)
);
CREATE INDEX IF NOT EXISTS idx_gads_changes_product ON public.google_ads_changes (product_id, changed_at DESC);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vsl_transcript TEXT;

-- ── Acesso ─────────────────────────────────────────────────────────────────
-- A tela lê pela rota /api/analysis (service role). Aqui, só leitura do que é
-- do próprio usuário; memória geral, consumo e configuração ficam fechados.
ALTER TABLE public.campaign_analyses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_learnings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_changes   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_own_campaign_analyses" ON public.campaign_analyses;
CREATE POLICY "read_own_campaign_analyses" ON public.campaign_analyses
  FOR SELECT TO authenticated USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "read_own_analysis_suggestions" ON public.analysis_suggestions;
CREATE POLICY "read_own_analysis_suggestions" ON public.analysis_suggestions
  FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
