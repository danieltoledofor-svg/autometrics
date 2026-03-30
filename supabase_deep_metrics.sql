-- =========================================
-- AUTO METRICS - DEEP METRICS TABLES
-- =========================================

-- 1. Tabela de Termos de Pesquisa
CREATE TABLE IF NOT EXISTS public.search_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  search_term TEXT NOT NULL,
  campaign_name TEXT,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  cost NUMERIC(15,4) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, date, search_term)
);

-- 2. Tabela de Públicos-Alvo (Idades e Gêneros)
CREATE TABLE IF NOT EXISTS public.audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  audience_name TEXT NOT NULL, -- Ex: "18-24", "Male", etc
  audience_type TEXT NOT NULL, -- Ex: "Age", "Gender", "Audience"
  campaign_name TEXT,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  cost NUMERIC(15,4) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, date, audience_name, audience_type)
);

-- 3. Tabela de Localizações
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  location_name TEXT NOT NULL, -- Ex: "São Paulo, Brazil"
  location_type TEXT NOT NULL, -- Ex: "City", "Country"
  campaign_name TEXT,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  cost NUMERIC(15,4) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, date, location_name)
);

-- 4. Tabela de Estratégias (Anotação Persistente)
CREATE TABLE IF NOT EXISTS public.campaign_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE UNIQUE,
  strategy_text TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Configurar RLS (Row Level Security) para as novas tabelas
ALTER TABLE public.search_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_strategies ENABLE ROW LEVEL SECURITY;

-- Políticas de Acesso (Assume que os requests vêm via API com Service Role)
-- Para requests do Frontend autenticados:
CREATE POLICY "Users can fully manage their own product search terms" ON public.search_terms
  FOR ALL USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can fully manage their own product audiences" ON public.audiences
  FOR ALL USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can fully manage their own product locations" ON public.locations
  FOR ALL USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can fully manage their own product strategies" ON public.campaign_strategies
  FOR ALL USING (product_id IN (SELECT id FROM public.products WHERE user_id = auth.uid()::text));
