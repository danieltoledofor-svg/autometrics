import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { campaign_name, date, metrics, currency_code, user_id, account_name } = body;

    // Validação básica de segurança
    if (!user_id || !campaign_name) {
      return NextResponse.json({ message: 'Dados incompletos.' }, { status: 400 });
    }

    // 1. Tenta encontrar o produto existente
    let { data: product, error: findError } = await supabase
      .from('products')
      .select('id')
      .eq('google_ads_campaign_name', campaign_name)
      .eq('user_id', user_id)
      .single();

    // 2. LÓGICA DE AUTO-CADASTRO (Se não existir, CRIA)
    if (!product) {
      console.log(`🆕 Nova campanha detectada: ${campaign_name}. Criando produto automático...`);
      
      const { data: newProduct, error: createError } = await supabase
        .from('products')
        .insert([
          {
            name: campaign_name, // Usa o nome da campanha como nome do produto
            google_ads_campaign_name: campaign_name,
            user_id: user_id,
            platform: 'Google Ads (Auto)', // Marca como automático para você saber
            currency: currency_code || 'BRL',
            status: 'active'
          }
        ])
        .select('id')
        .single();

      if (createError) {
        console.error('Erro ao criar produto automático:', createError);
        // Se der erro ao criar, retornamos sucesso 200 pro Google não travar, mas logamos o erro
        return NextResponse.json({ message: 'Erro ao criar produto auto.' }, { status: 200 });
      }
      
      product = newProduct;
    }

    if (!product) {
      return NextResponse.json({ message: 'Falha crítica ao identificar produto.' }, { status: 500 });
    }

    // 3. Prepara os dados das métricas
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

    // 4. Salva/Atualiza as métricas (Upsert)
    const { error: upsertError } = await supabase
      .from('daily_metrics')
      .upsert(payload, { onConflict: 'product_id, date' });

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true, message: 'Sincronizado com sucesso.' });

  } catch (error: any) {
    console.error('❌ Erro servidor:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}