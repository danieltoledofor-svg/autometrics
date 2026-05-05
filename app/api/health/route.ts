import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const result: Record<string, any> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? `${supabaseUrl.slice(0, 40)}...` : 'NOT SET',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey ? 'SET' : 'NOT SET',
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV,
    },
  };

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ...result, error: 'missing env vars' });
  }

  // Admin client - ignora RLS para contar registros reais
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Conta produtos e métricas totais (sem filtro de usuário)
  const [prodCount, metricsCount, recentMetrics] = await Promise.all([
    admin.from('products').select('id', { count: 'exact', head: true }),
    admin.from('daily_metrics').select('id', { count: 'exact', head: true }),
    admin.from('daily_metrics')
      .select('date, product_id, cost, conversions, updated_at')
      .order('updated_at', { ascending: false })
      .limit(3),
  ]);

  // Verifica auth anon (simula o que o dashboard faz)
  const anonClient = createClient(supabaseUrl, supabaseAnonKey!);
  const { error: anonError } = await anonClient.from('products').select('id').limit(1);

  // Testa o token JWT do header se passado (Authorization: Bearer <token>)
  const authHeader = request.headers.get('authorization');
  let userQueryResult: Record<string, any> | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const userClient = createClient(supabaseUrl, supabaseAnonKey!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userProducts, error: userError, count } = await userClient
      .from('products')
      .select('id', { count: 'exact', head: true });
    userQueryResult = {
      products_visible: count ?? 0,
      error: userError?.message ?? null,
    };
  }

  result.data_counts = {
    total_products: prodCount.count ?? 0,
    total_daily_metrics: metricsCount.count ?? 0,
    products_error: prodCount.error?.message ?? null,
    metrics_error: metricsCount.error?.message ?? null,
  };

  result.recent_metrics = recentMetrics.data?.map(r => ({
    date: r.date,
    updated_at: r.updated_at,
    cost: r.cost,
    conversions: r.conversions,
  })) ?? [];

  result.anon_query = {
    status: anonError ? 'error' : 'ok (RLS filtered - expected empty without auth)',
    error: anonError?.message ?? null,
  };

  if (userQueryResult) {
    result.authenticated_user_query = userQueryResult;
  } else {
    result.authenticated_user_query = 'Pass Authorization: Bearer <supabase_access_token> to test';
  }

  return NextResponse.json(result);
}
