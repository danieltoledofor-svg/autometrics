import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Configuração do Cliente Supabase
// Tenta usar a Service Role (Admin) se disponível, senão usa a Anon
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { campaign_name, date, metrics, currency_code, user_id, account_name, mcc_name } = body;

    // Validação básica
    if (!user_id || !campaign_name) {
      return NextResponse.json({ message: 'Dados incompletos.' }, { status: 400 });
    }

    // 1. Busca ou Cria o Produto (Vínculo)
    let { data: product, error: findError } = await supabase
      .from('products')
      .select('id')
      .eq('google_ads_campaign_name', campaign_name)
      .eq('user_id', user_id)
      .single();

    if (!product) {
      // Se não existe, cria um novo produto automaticamente
      const { data: newProduct, error: createError } = await supabase
        .from('products')
        .insert([{
            name: campaign_name,
            google_ads_campaign_name: campaign_name,
            user_id: user_id,
            platform: 'Google Ads (Auto)',
            currency: currency_code || 'BRL',
            status: 'active',
            account_name: account_name || 'Conta Desconhecida',
            mcc_name: mcc_name || 'Sem MCC'
        }])
        .select('id')
        .single();

      if (createError) {
        // Retorna erro para o script saber
        return NextResponse.json({ error: `Erro ao criar produto: ${createError.message}` }, { status: 500 });
      }
      product = newProduct;
    } else {
      // Se já existe, atualiza nomes de conta/mcc para manter sincronizado
      await supabase
        .from('products')
        .update({ 
            account_name: account_name,
            mcc_name: mcc_name || 'Sem MCC'
        })
        .eq('id', product.id);
    }

    // 2. Tratamento de CTR (String % para Number)
    let cleanCtr = 0;
    if (metrics.ctr) {
       const ctrString = String(metrics.ctr).replace('%', '');
       cleanCtr = parseFloat(ctrString);
       if (cleanCtr < 1 && cleanCtr > 0) cleanCtr = cleanCtr * 100;
    }

    // 3. Payload Seguro (O SEGREDO ESTÁ AQUI)
    // Removemos 'conversion_value', 'visits', 'checkouts', 'refunds' deste objeto.
    // Assim, o upsert vai atualizar APENAS o que veio do Google e MANTER o que você digitou.
    const payload = {
      product_id: product.id,
      date: date,
      
      // Dados que o Google MANDA e pode atualizar
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      cost: metrics.cost_micros / 1000000, 
      ctr: cleanCtr,
      avg_cpc: metrics.average_cpc / 1000000,
      
      account_name: account_name,
      target_cpa: metrics.target_value || 0,
      final_url: metrics.final_url,
      campaign_status: metrics.status,
      
      search_impression_share: String(metrics.search_impression_share || '0%'),
      search_top_impression_share: String(metrics.search_top_impression_share || '0%'),
      search_abs_top_share: String(metrics.search_abs_top_share || '0%'),
      budget_micros: metrics.budget_micros,
      bidding_strategy: metrics.bidding_strategy_type,
      currency: currency_code || 'BRL',
      
      updated_at: new Date().toISOString()
      
      // OBSERVAÇÃO CRÍTICA:
      // Não incluímos 'conversion_value' aqui. 
      // Se a linha já existir (com sua receita manual), o valor antigo será preservado.
      // Se a linha for nova (criada pelo script), o banco usará o DEFAULT 0.
    };

    const { error: upsertError } = await supabase
      .from('daily_metrics')
      .upsert(payload, { onConflict: 'product_id, date' }); // Upsert mescla os dados

    if (upsertError) {
      return NextResponse.json({ error: `Erro SQL: ${upsertError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}