-- Todas as colunas do Google, por dia e por campanha.
--
-- A consulta diária já devolvia dezenas de métricas que eram descartadas —
-- conversões, CPA, ROAS, perdas de impressão por orçamento e por classificação,
-- parcela de cliques. Trazer o resto não custa nenhuma consulta a mais.
--
-- google_metrics guarda o bloco inteiro em JSON: métrica nova do Google passa a
-- aparecer sem precisar de outra migration. As duas colunas numéricas existem
-- para filtrar e ordenar rápido no painel.
--
-- IMPORTANTE: as conversões do Google NÃO entram em conversion_value. Aquela
-- coluna é a receita real vinda dos postbacks, e é ela que calcula o lucro.
--
-- Rode no SQL Editor do Supabase. Seguro para reexecutar.

ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS google_metrics          JSONB,
  ADD COLUMN IF NOT EXISTS google_conversions      NUMERIC,
  ADD COLUMN IF NOT EXISTS google_conversion_value NUMERIC;

COMMENT ON COLUMN public.daily_metrics.google_metrics IS
  'Bloco completo de métricas do Google no dia, em JSON. Valores em micros já convertidos para a moeda da conta';
COMMENT ON COLUMN public.daily_metrics.google_conversions IS
  'metrics.conversions — conversões medidas pelo Google, não a venda confirmada pelo postback';
COMMENT ON COLUMN public.daily_metrics.google_conversion_value IS
  'metrics.conversions_value — valor que o Google atribui às conversões dele';

-- Configurações atuais da campanha, para a lista e o cabeçalho do detalhe.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS google_channel_type       TEXT,
  ADD COLUMN IF NOT EXISTS google_channel_sub_type   TEXT,
  ADD COLUMN IF NOT EXISTS google_start_date         DATE,
  ADD COLUMN IF NOT EXISTS google_end_date           DATE,
  ADD COLUMN IF NOT EXISTS google_optimization_score NUMERIC;

COMMENT ON COLUMN public.products.google_channel_type IS
  'campaign.advertising_channel_type: SEARCH | PERFORMANCE_MAX | DISPLAY | VIDEO | SHOPPING | DEMAND_GEN';
COMMENT ON COLUMN public.products.google_optimization_score IS
  'campaign.optimization_score: 0 a 1, o mesmo índice de otimização da interface';
