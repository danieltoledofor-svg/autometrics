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
    const { 
      campaign_name, campaign_id, date, metrics, currency_code, user_id, account_name, mcc_name,
      search_terms = [], audiences = [], locations = [], history = [] 
    } = body;

    // Validação básica
    if (!user_id || !campaign_name) {
      return NextResponse.json({ message: 'Dados incompletos.' }, { status: 400 });
    }

    // 1. Busca ou Cria o Produto (Vínculo)
    // Tenta buscar primeiro pelo ID exato da campanha
    let product: any = null;
    
    if (campaign_id) {
      const { data } = await supabase.from('products').select('id').eq('google_ads_campaign_id', campaign_id).eq('user_id', user_id).maybeSingle();
      if (data) product = data;
    }

    // Se n achou pelo ID, tenta buscar pelo nome da campanha E nome da conta para evitar duplicidade de nomes em contas diferentes
    if (!product) {
      const { data } = await supabase.from('products')
        .select('id')
        .eq('google_ads_campaign_name', campaign_name)
        .eq('account_name', account_name)
        .eq('user_id', user_id)
        .maybeSingle();
      if (data) product = data;
    }

    // Se ainda n achou, tenta só pelo nome (para produtos antigos criados antes de salvar account_name)
    if (!product) {
       const { data, error: multiError } = await supabase.from('products').select('id, account_name').eq('google_ads_campaign_name', campaign_name).eq('user_id', user_id).limit(1);
       if (data && data.length > 0) product = data[0];
    }

    if (!product) {
      // Se não existe, cria um novo produto automaticamente
      const { data: newProduct, error: createError } = await supabase
        .from('products')
        .insert([{
          name: campaign_name,
          google_ads_campaign_name: campaign_name,
          google_ads_campaign_id: String(campaign_id) || null,
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
        return NextResponse.json({ error: `Erro ao criar produto: ${createError.message}` }, { status: 500 });
      }
      product = newProduct;
    } else {
      // Se já existe, atualiza nomes de conta/mcc e campaign_id para manter sincronizado (e garantir que produtos antigos ganhem o ID e Conta)
      await supabase
        .from('products')
        .update({
          account_name: account_name,
          mcc_name: mcc_name || 'Sem MCC',
          google_ads_campaign_id: String(campaign_id) || null
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

    // ==========================================
    // 4. DEEP METRICS & HISTÓRICO (Em Paralelo)
    // ==========================================
     // Collect errors from parallel tasks for diagnostics
    const taskErrors: string[] = [];
    const safeTask = (promise: Promise<any>, name: string) =>
      promise.catch((e: any) => taskErrors.push(`${name}: ${e?.message || e}`));

    const diagTasks: Promise<any>[] = [];
    
    if (search_terms && search_terms.length > 0) {
      const stPayload = search_terms.map((st: any) => ({
        product_id: product.id, date: date, 
        search_term: st.t || st.term,
        campaign_name: campaign_name,
        impressions: st.i ?? st.impressions ?? 0,
        clicks: st.cl ?? st.clicks ?? 0,
        cost: (st.c ?? st.cost_micros ?? 0) / 1000000,
        conversions: st.cv ?? st.conversions ?? 0,
        updated_at: new Date().toISOString()
      }));
      diagTasks.push(
        safeTask(
          Promise.resolve(supabase.from('search_terms').upsert(stPayload, { onConflict: 'product_id, date, search_term' }))
            .then(({ error }) => { if (error) taskErrors.push('search_terms: ' + error.message); }),
          'search_terms_catch'
        )
      );
    }

    if (audiences && audiences.length > 0) {
      const audPayload = audiences.map((aud: any) => ({
        product_id: product.id, date: date, 
        audience_name: aud.n || aud.name,
        audience_type: aud.tp || aud.type,
        campaign_name: campaign_name, 
        impressions: aud.i ?? aud.impressions ?? 0, 
        clicks: aud.cl ?? aud.clicks ?? 0,
        cost: (aud.c ?? aud.cost_micros ?? 0) / 1000000, 
        conversions: aud.cv ?? aud.conversions ?? 0,
        updated_at: new Date().toISOString()
      }));
      diagTasks.push(
        safeTask(
          Promise.resolve(supabase.from('audiences').upsert(audPayload, { onConflict: 'product_id, date, audience_name, audience_type' }))
            .then(({ error }) => { if (error) taskErrors.push('audiences: ' + error.message); }),
          'audiences_catch'
        )
      );
    }

    if (locations && locations.length > 0) {
      const locPayload = locations.map((loc: any) => ({
        product_id: product.id, date: date, 
        location_name: loc.n || loc.name,
        location_type: loc.tp || loc.type,
        campaign_name: campaign_name, 
        impressions: loc.i ?? loc.impressions ?? 0, 
        clicks: loc.cl ?? loc.clicks ?? 0,
        cost: (loc.c ?? loc.cost_micros ?? 0) / 1000, // script pre-divides by 1000, so /1000 = dollars
        conversions: loc.cv ?? loc.conversions ?? 0,
        updated_at: new Date().toISOString()
      }));
      diagTasks.push(
        safeTask(
          Promise.resolve(supabase.from('locations').upsert(locPayload, { onConflict: 'product_id, date, location_name' }))
            .then(({ error }) => { if (error) taskErrors.push('locations: ' + error.message); }),
          'locations_catch'
        )
      );
    }

    if (history && history.length > 0) {
      diagTasks.push((async () => {
        try {
          const { data: currentMetrics } = await supabase.from('daily_metrics').select('notes').eq('product_id', product.id).eq('date', date).maybeSingle();
          let currentNotes = currentMetrics?.notes || '';
          let addedHistory = false;
          history.forEach((hist: any) => {
            const histLine = `[AUTO] ${hist.time} - ${hist.change}`;
            if (!currentNotes.includes(histLine)) {
              currentNotes += (currentNotes ? '\n' : '') + histLine;
              addedHistory = true;
            }
          });
          if (addedHistory) {
             const { error } = await supabase.from('daily_metrics').update({ notes: currentNotes }).eq('product_id', product.id).eq('date', date);
             if (error) taskErrors.push('history: ' + error.message);
          }
        } catch (e: any) {
          taskErrors.push('history_catch: ' + e?.message);
        }
      })());
    }

    await Promise.all(diagTasks);

    // Diagnostic response visible in Google Ads script logs
    return NextResponse.json({ 
      success: true,
      diag: {
        st_recv: search_terms?.length || 0,
        aud_recv: audiences?.length || 0,
        loc_recv: locations?.length || 0,
        errors: taskErrors
      }
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}