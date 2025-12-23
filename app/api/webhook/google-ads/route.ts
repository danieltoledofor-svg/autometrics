import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Agora recebemos o user_id do script
    const { campaign_name, date, metrics, currency_code, user_id } = body;

    // 1. Busca produto vinculado AO USUÁRIO ESPECÍFICO
    // Se o script mandar 'usuario_mestre_01', só buscamos produtos desse usuário
    let query = supabase
      .from('products')
      .select('id')
      .eq('google_ads_campaign_name', campaign_name);

    // Se o script enviou um user_id, filtramos por ele (Segurança)
    if (user_id) {
      query = query.eq('user_id', user_id);
    }

    const { data: product, error: productError } = await query.single();

    if (productError || !product) {
      // Se não achou o produto vinculado a esse usuário, ignora
      return NextResponse.json({ message: 'Produto ignorado.' }, { status: 200 });
    }

    // 2. Prepara os dados
    const payload = {
      product_id: product.id,
      date: date,
      
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      cost: metrics.cost_micros / 1000000, 
      ctr: parseFloat(metrics.ctr.replace('%', '')),
      avg_cpc: metrics.average_cpc / 1000000,
      
      search_impression_share: metrics.search_impression_share || '0%',
      search_top_impression_share: metrics.search_top_impression_share || '0%',
      search_abs_top_share: metrics.search_abs_top_share || '0%',
      
      budget_micros: metrics.budget_micros,
      bidding_strategy: metrics.bidding_strategy_type,
      currency: currency_code || 'BRL',

      updated_at: new Date().toISOString()
    };

    // 3. Salva no banco
    const { error: upsertError } = await supabase
      .from('daily_metrics')
      .upsert(payload, { onConflict: 'product_id, date' });

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('❌ Erro servidor:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}