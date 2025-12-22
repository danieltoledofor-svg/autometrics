import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Configuração do Cliente Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- CORREÇÃO DO ERRO ---
// O Next.js exige que a função se chame "POST" e seja exportada diretamente.
// Não use "export default".

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { campaign_name, date, metrics } = body;

    console.log(`📡 Recebendo Webhook: ${campaign_name} [${date}]`);

    // 1. Busca produto
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name')
      .eq('google_ads_campaign_name', campaign_name)
      .single();

    if (productError || !product) {
      console.warn(`⚠️ Produto não encontrado: ${campaign_name}`);
      return NextResponse.json(
        { message: `Campanha '${campaign_name}' não vinculada.` }, 
        { status: 404 }
      );
    }

    // 2. Prepara dados
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
      updated_at: new Date().toISOString()
    };

    // 3. Salva no banco
    const { error: upsertError } = await supabase
      .from('daily_metrics')
      .upsert(payload, { onConflict: 'product_id, date' });

    if (upsertError) {
      console.error('Erro Supabase:', upsertError);
      throw upsertError;
    }

    return NextResponse.json({ success: true, message: 'Dados processados.' });

  } catch (error: any) {
    console.error('❌ Erro servidor:', error);
    return NextResponse.json(
      { error: 'Erro interno', details: error.message }, 
      { status: 500 }
    );
  }
}