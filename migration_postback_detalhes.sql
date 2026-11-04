-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- Detalhes extras que a plataforma manda no postback (JVZoo: produto, valor da transação,
-- tipo de comissão, forma de pagamento, país, e-mail e nome do cliente, vendedor...).
-- Sem esta coluna o postback continua funcionando e só não guarda os extras.
alter table public.postback_events add column if not exists details jsonb;
