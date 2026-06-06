import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Singleton — evita múltiplas instâncias do GoTrueClient no mesmo contexto
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabase;
}

export const supabase = getSupabase();
