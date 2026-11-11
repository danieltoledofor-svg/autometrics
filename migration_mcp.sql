-- MCP do Autometrics: chaves de acesso para usar o Claude (celular, claude.ai)
-- com os dados das campanhas.
--
-- Rode no SQL Editor do Supabase, sem nada selecionado. Pode rodar de novo sem problema.
--
-- mcp_tokens  uma linha por link gerado na Integração → Claude. Só o hash da
--             chave fica guardado; a chave aparece uma vez, na hora de gerar.

CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON public.mcp_tokens (user_id, created_at DESC);

-- Gravação e leitura só pelo servidor (service role). Nada aberto para o navegador.
ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
