import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Configuração do Cliente Supabase (Service Role para ignorar RLS)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { campaign_name, date, metrics, currency_code, user_id } = body;

    if (!user_id || !campaign_name) {
      return NextResponse.json({ message: 'Dados incompletos.' }, { status: 400 });
    }

    // 1. Busca ou Cria o Produto
    let { data: product, error: findError } = await supabase
      .from('products')
      .select('id')
      .eq('google_ads_campaign_name', campaign_name)
      .eq('user_id', user_id)
      .single();

    if (!product) {
      const { data: newProduct, error: createError } = await supabase
        .from('products')
        .insert([{
            name: campaign_name,
            google_ads_campaign_name: campaign_name,
            user_id: user_id,
            platform: 'Google Ads (Auto)',
            currency: currency_code || 'BRL',
            status: 'active'
        }])
        .select('id')
        .single();

      if (createError) {
        return NextResponse.json({ error: `Erro ao criar produto: ${createError.message}` }, { status: 500 });
      }
      product = newProduct;
    }

    // 2. Prepara Payload (CORRIGIDO: conversion_value)
    const payload = {
      product_id: product.id,
      date: date,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      cost: metrics.cost_micros / 1000000, 
      ctr: parseFloat(metrics.ctr.replace('%', '') || '0'),
      avg_cpc: metrics.average_cpc / 1000000,
      
      // Mapeamento correto das colunas do banco
      conversion_value: 0, // O script atual manda custo, mas se mandar receita futuramente, mapeamos aqui
      
      search_impression_share: metrics.search_impression_share || '0%',
      search_top_impression_share: metrics.search_top_impression_share || '0%',
      search_abs_top_share: metrics.search_abs_top_share || '0%',
      budget_micros: metrics.budget_micros,
      bidding_strategy: metrics.bidding_strategy_type,
      currency: currency_code || 'BRL',
      updated_at: new Date().toISOString()
    };

    // 3. Tenta Inserir (Upsert)
    const { error: upsertError } = await supabase
      .from('daily_metrics')
      .upsert(payload, { onConflict: 'product_id, date' });

    if (upsertError) {
      return NextResponse.json({ error: `Erro SQL: ${upsertError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}