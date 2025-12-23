import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Configuração do Cliente Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Adicionamos currency_code na desestruturação
    const { campaign_name, date, metrics, currency_code } = body;

    // console.log(`📡 Recebendo: ${campaign_name}`); // Pode descomentar para debug

    // 1. Busca produto vinculado
    // Se não achar o produto, retornamos 200 (OK) em vez de 404
    // Isso evita que o Google Ads mostre "Erro" vermelho no log para campanhas que você não quer rastrear.
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id') // Só precisamos do ID
      .eq('google_ads_campaign_name', campaign_name)
      .single();

    if (productError || !product) {
      // Retorna sucesso silencioso para o script continuar rodando
      return NextResponse.json({ message: 'Campanha ignorada (não cadastrada).' }, { status: 200 });
    }

    // 2. Prepara os dados (Mapeamento Completo)
    // Nota: NÃO incluímos visits, checkouts, conversions aqui para não zerar os dados manuais.
    const payload = {
      product_id: product.id,
      date: date,
      
      // Métricas Básicas
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      cost: metrics.cost_micros / 1000000, // Converte micros para valor real
      ctr: parseFloat(metrics.ctr.replace('%', '')),
      avg_cpc: metrics.average_cpc / 1000000,
      
      // Métricas Avançadas (Novas colunas)
      search_impression_share: metrics.search_impression_share || '0%',
      search_top_impression_share: metrics.search_top_impression_share || '0%',
      search_abs_top_share: metrics.search_abs_top_share || '0%', // Nova
      
      // Dados Estratégicos
      budget_micros: metrics.budget_micros,
      bidding_strategy: metrics.bidding_strategy_type,
      final_url: metrics.final_url,
      currency: currency_code || 'BRL', // Salva a moeda da conta

      updated_at: new Date().toISOString()
    };

    // 3. Salva no banco (Upsert)
    // O Upsert atualiza as colunas acima e MANTÉM intactas as colunas manuais (visits, revenue, etc)
    const { error: upsertError } = await supabase
      .from('daily_metrics')
      .upsert(payload, { onConflict: 'product_id, date' });

    if (upsertError) {
      console.error('Erro Supabase:', upsertError);
      throw upsertError;
    }

    return NextResponse.json({ success: true, message: 'Dados atualizados.' });

  } catch (error: any) {
    console.error('❌ Erro servidor:', error);
    return NextResponse.json(
      { error: 'Erro interno', details: error.message }, 
      { status: 500 }
    );
  }
}