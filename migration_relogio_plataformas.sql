-- Relógio de cada plataforma de venda.
--
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem problema.
--
-- user_settings.platform_clocks  o relógio escolhido para cada plataforma, por exemplo
--                                {"buygoods": "Etc/GMT+4"} (GMT−4). A venda entra no dia em
--                                que aconteceu nesse relógio (lib/tracking/platformClock.ts).
--
-- Antes desta migração vale o padrão: BuyGoods em GMT−4, as outras no horário de Brasília.

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS platform_clocks JSONB;
