import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let supabaseStatus = 'not_tested';
  let supabaseError: string | null = null;

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error } = await supabase.from('products').select('id').limit(1);
      supabaseStatus = error ? 'error' : 'ok';
      if (error) supabaseError = error.message;
    } catch (e: any) {
      supabaseStatus = 'exception';
      supabaseError = e?.message;
    }
  } else {
    supabaseStatus = 'missing_env_vars';
  }

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    build_time: process.env.BUILD_TIME || 'not_set',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? `${supabaseUrl.slice(0, 30)}...` : 'NOT SET',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey ? 'SET' : 'NOT SET',
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV,
    },
    supabase: {
      status: supabaseStatus,
      error: supabaseError,
    },
  });
}
