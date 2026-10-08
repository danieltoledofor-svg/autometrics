-- Criador de campanhas — modelos de campanha.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- campaign_templates guarda o que foi lido de uma campanha do Google para servir
-- de modelo: configuração, meta de conversão, locais, idiomas, negativas, grupos,
-- palavras-chave, anúncios, sitelinks e frases de destaque. Um modelo por
-- campanha de origem; ler de novo atualiza o mesmo modelo.

CREATE TABLE IF NOT EXISTS public.campaign_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  source_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  funnel            TEXT,                        -- fundo | topo (escolhido pelo usuário)
  data              JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source_product_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_templates_user ON public.campaign_templates (user_id, updated_at DESC);

-- A tela lê e grava pela rota /api/campaign-builder (service role). Nada aberto para o navegador.
ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;
