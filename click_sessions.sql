-- Tabela de sessões de clique para resolução de IDs de trackers externos
-- (Ratoeiraads vst_XXX, Vturb, etc.) → campaign_id real

CREATE TABLE IF NOT EXISTS public.click_sessions (
    id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       TEXT        NOT NULL,
    session_id    TEXT        NOT NULL,          -- vst_XXXXX, gclid, ou qualquer ID de tracker
    utm_id        TEXT,                          -- campaign ID (utm_id)
    gad_campaignid TEXT,                         -- campaign ID (gad_campaignid)
    utm_campaign  TEXT,                          -- nome da campanha (fallback)
    utm_source    TEXT,
    utm_medium    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_click_sessions_lookup
    ON public.click_sessions (user_id, session_id);

-- Expira registros com mais de 90 dias (opcional — rode manualmente se quiser manter limpo)
-- DELETE FROM public.click_sessions WHERE created_at < NOW() - INTERVAL '90 days';

-- RLS
ALTER TABLE public.click_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_click_sessions" ON public.click_sessions;
CREATE POLICY "service_role_full_access_click_sessions"
    ON public.click_sessions
    FOR ALL
    USING (true)
    WITH CHECK (true);
