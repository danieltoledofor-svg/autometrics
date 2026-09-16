import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveCampaignStatus, resolveEffectiveStatus } from '@/lib/campaignStatus';

// Configuração do Cliente Supabase
// Tenta usar a Service Role (Admin) se disponível, senão usa a Anon
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/** Nomes técnicos do Google em português, para a anotação do dia. */
const RECURSO_PT: Record<string, string> = {
  CAMPAIGN: 'Campanha',
  CAMPAIGN_BUDGET: 'Orçamento',
  CAMPAIGN_CRITERION: 'Segmentação da campanha',
  AD_GROUP: 'Grupo de anúncios',
  AD_GROUP_AD: 'Anúncio',
  AD_GROUP_CRITERION: 'Palavra-chave / segmentação',
  AD_GROUP_BID_MODIFIER: 'Ajuste de lance',
  CAMPAIGN_ASSET: 'Recurso da campanha',
  AD_GROUP_ASSET: 'Recurso do grupo',
  ASSET: 'Recurso',
  FEED: 'Feed',
};

const OPERACAO_PT: Record<string, string> = {
  CREATE: 'criou',
  UPDATE: 'alterou',
  REMOVE: 'removeu',
};

const CAMPO_PT: Record<string, string> = {
  amount_micros: 'valor',
  target_cpa_micros: 'CPA alvo',
  target_roas: 'ROAS alvo',
  status: 'status',
  name: 'nome',
  cpc_bid_micros: 'lance de CPC',
  bidding_strategy_type: 'estratégia de lance',
  final_urls: 'URL final',
  start_date: 'data de início',
  end_date: 'data de término',
};

/**
 * Monta a linha do histórico no formato que o Google usa: o que mudou e de que
 * valor para qual. Antes a anotação dizia apenas "CAMPAIGN_BUDGET (UPDATE) por
 * fulano", que informa que algo mudou mas não o quê.
 */
function descreverAlteracao(hist: any): string {
  const recurso = RECURSO_PT[hist.type] || hist.type || 'Alteração';
  const acao = OPERACAO_PT[hist.op] || (hist.op || '').toLowerCase();
  const quem = hist.user ? ` por ${hist.user}` : '';

  const campos = Array.isArray(hist.fields) ? hist.fields : [];
  if (!campos.length) {
    // Sem detalhe disponível: mantém o formato antigo, que ao menos diz o quê.
    return hist.change || `${recurso} (${hist.op || ''})${quem}`;
  }

  const detalhes = campos
    .map((c: any) => {
      const nome = CAMPO_PT[String(c.f).split('.').pop() || ''] || String(c.f).split('.').pop();
      const de = c.de === '' || c.de === undefined ? '—' : c.de;
      const para = c.para === '' || c.para === undefined ? '—' : c.para;
      return de === para ? `${nome}: ${para}` : `${nome}: ${de} → ${para}`;
    })
    .join(', ');

  return `${recurso} — ${acao} ${detalhes}${quem}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      campaign_name, campaign_id, date, metrics, currency_code, user_id, account_name, mcc_name,
      search_terms = [], audiences = [], locations = [], history = [],
      script_version = 'v1'
    } = body;

    // Validação básica
    if (!user_id || !campaign_name) {
      return NextResponse.json({ message: 'Dados incompletos.' }, { status: 400 });
    }

    // 1. Busca ou Cria o Produto (Vínculo)
    // Tenta buscar primeiro pelo ID exato da campanha
    // Status real do Google.
    //
    // A consolidação é feita AQUI, não no script: os scripts instalados nos
    // gerenciadores só reportam o que leram, então mudar a regra é um deploy em
    // vez de recolar o script em cada conta.
    //
    // Scripts antigos mandavam o rótulo já pronto em effective_status; ele só é
    // usado quando não vierem os campos crus, para não quebrar quem ainda não
    // atualizou. Havendo campos crus, a regra nova vale mesmo no script antigo.
    const hasRawStatus = Boolean(metrics.serving_status || metrics.primary_status || metrics.account_status);
    const googleStatus: string = hasRawStatus
      ? resolveEffectiveStatus({
          status: metrics.status,
          servingStatus: metrics.serving_status,
          primaryStatus: metrics.primary_status,
          accountStatus: metrics.account_status,
        })
      : (metrics.effective_status || 'DESCONHECIDO');
    const statusKey = resolveCampaignStatus({
      effective_status: googleStatus,
      campaign_status: metrics.status,
    }).key;
    // Campo legado 'active'/'paused': suspenso conta como parado.
    const legacyStatus = statusKey === 'ativo' ? 'active' : 'paused';

    let product: any = null;
    const rawId = campaign_id ? String(campaign_id) : null;
    const safeCampaignId = (rawId && rawId !== 'undefined' && rawId !== 'null') ? rawId : null;
    
    if (safeCampaignId) {
      const { data } = await supabase.from('products').select('id, google_status_date').eq('google_ads_campaign_id', safeCampaignId).eq('user_id', user_id).limit(1);
      if (data && data.length) product = data[0];
    }

    // Se n achou pelo ID, tenta buscar pelo nome da campanha E nome da conta para evitar duplicidade de nomes em contas diferentes
    if (!product) {
      const { data } = await supabase.from('products')
        .select('id, google_ads_campaign_id, google_status_date')
        .eq('google_ads_campaign_name', campaign_name)
        .eq('account_name', account_name)
        .eq('user_id', user_id)
        .limit(1);

      const match = data && data.length ? data[0] : null;
      // Só aceita o match por nome se o produto não tiver um ID diferente salvo
      const existingId = (match?.google_ads_campaign_id && match.google_ads_campaign_id !== 'undefined') ? match.google_ads_campaign_id : null;
      if (match && (!existingId || existingId === safeCampaignId)) {
        product = match;
      }
    }

    // Se ainda n achou, tenta só pelo nome (para produtos antigos criados antes de salvar account_name)
    if (!product) {
       const { data, error: multiError } = await supabase.from('products').select('id, account_name, google_ads_campaign_id, google_status_date').eq('google_ads_campaign_name', campaign_name).eq('user_id', user_id).limit(10);
       if (data && data.length > 0) {
         // Busca um produto que não tenha ID de campanha conflitante
         const validMatch = data.find(p => {
           const pid = (p.google_ads_campaign_id && p.google_ads_campaign_id !== 'undefined') ? p.google_ads_campaign_id : null;
           return !pid || pid === safeCampaignId;
         });
         if (validMatch) product = validMatch;
       }
    }

    if (!product) {
      // Se não existe, cria um novo produto automaticamente
      const { data: newProduct, error: createError } = await supabase
        .from('products')
        .insert([{
          name: campaign_name,
          google_ads_campaign_name: campaign_name,
          google_ads_campaign_id: safeCampaignId,
          user_id: user_id,
          platform: 'Google Ads (Auto)',
          currency: currency_code || 'BRL',
          status: legacyStatus,
          google_status: googleStatus,
          google_status_reasons: metrics.status_reasons || null,
          google_status_date: date,
          account_name: account_name || 'Conta Desconhecida',
          mcc_name: mcc_name || 'Sem MCC'
        }])
        .select('id')
        .single();

      if (createError) {
        const isDuplicate = createError.code === '23505' || /duplicate key/i.test(createError.message || '');
        if (isDuplicate) {
          // Alguma linha já ocupa a chave. Tenta todas as formas de achá-la
          // antes de descartar o dia desta campanha.
          const porId = safeCampaignId
            ? await supabase.from('products').select('id, google_status_date')
                .eq('google_ads_campaign_id', safeCampaignId).eq('user_id', user_id).limit(1)
            : { data: null };
          if (porId.data && porId.data.length) product = porId.data[0];

          if (!product) {
            const { data: porNome } = await supabase.from('products')
              .select('id, google_status_date')
              .eq('google_ads_campaign_name', campaign_name)
              .eq('user_id', user_id)
              .limit(1);
            if (porNome && porNome.length) product = porNome[0];
          }

          if (!product) {
            const { data: porTitulo } = await supabase.from('products')
              .select('id, google_status_date')
              .eq('name', campaign_name)
              .eq('user_id', user_id)
              .limit(1);
            if (porTitulo && porTitulo.length) product = porTitulo[0];
          }
        }
        if (!product) {
          return NextResponse.json({
            error: `Erro ao criar produto "${campaign_name}" (id ${safeCampaignId ?? 'sem id'}, conta ${account_name}): ${createError.message}`
          }, { status: 500 });
        }
      } else {
        product = newProduct;
      }
    } else {
      // Se já existe, atualiza nomes de conta/mcc, campaign_id e o NOME da campanha (para refletir mudanças feitas no Google Ads)
      const update: any = {
        name: campaign_name,
        google_ads_campaign_name: campaign_name,
        account_name: account_name,
        mcc_name: mcc_name || 'Sem MCC',
        google_ads_campaign_id: safeCampaignId
      };

      // O script reprocessa dias antigos a cada rodada. Só o dia mais recente
      // pode mexer no status atual, senão um dia velho rebaixaria a campanha.
      if (!product.google_status_date || date >= product.google_status_date) {
        update.status = legacyStatus;
        update.google_status = googleStatus;
        update.google_status_reasons = metrics.status_reasons || null;
        update.google_status_date = date;
      }

      await supabase.from('products').update(update).eq('id', product.id);
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
    // Campanha pausada/suspensa chega com metricas ausentes ou zeradas.
    // Normaliza tudo para numero para nao gravar NaN nas colunas.
    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const payload: any = {
      product_id: product.id,
      date: date,

      // Dados que o Google MANDA e pode atualizar
      impressions: num(metrics.impressions),
      clicks: num(metrics.clicks),
      cost: num(metrics.cost_micros) / 1000000,
      ctr: cleanCtr,
      avg_cpc: num(metrics.average_cpc) / 1000000,

      account_name: account_name,

      // Status: 'campaign_status' e o que o anunciante configurou (ENABLED/PAUSED/
      // REMOVED). 'effective_status' e o status real ja resolvido pelo script,
      // combinando veiculacao, diagnostico e status da conta.
      campaign_status: metrics.status || 'UNKNOWN',
      campaign_serving_status: metrics.serving_status || null,
      campaign_primary_status: metrics.primary_status || null,
      campaign_status_reasons: metrics.status_reasons || null,
      account_status: metrics.account_status || null,
      effective_status: googleStatus,

      search_impression_share: String(metrics.search_impression_share || '0%'),
      search_top_impression_share: String(metrics.search_top_impression_share || '0%'),
      search_abs_top_share: String(metrics.search_abs_top_share || '0%'),
      bidding_strategy: metrics.bidding_strategy_type,
      currency: currency_code || 'BRL',

      updated_at: new Date().toISOString()

      // OBSERVAÇÃO CRÍTICA:
      // Não incluímos 'conversion_value' aqui. 
      // Se a linha já existir (com sua receita manual), o valor antigo será preservado.
      // Se a linha for nova (criada pelo script), o banco usará o DEFAULT 0.
    };

    // Campanha sem anuncios ativos nao retorna final_url. Omitir a coluna
    // preserva o valor ja gravado em vez de apaga-lo.
    if (metrics.final_url) payload.final_url = metrics.final_url;

    // Orçamento e meta de CPA são o valor ATUAL da campanha, não o daquele dia:
    // o Google não devolve o histórico deles por data. Gravá-los em dias
    // passados carimbava o valor de hoje sobre todo o histórico, e a evolução
    // da campanha se perdia — um orçamento que foi de 100 para 110 passava a
    // exibir 110 em todos os dias anteriores.
    //
    // Por isso só são gravados no dia corrente. Dias anteriores mantêm o que foi
    // registrado quando eles próprios eram "hoje".
    const hojeStr = new Date().toISOString().slice(0, 10);
    if (date === hojeStr) {
      payload.budget_micros = num(metrics.budget_micros);
      payload.target_cpa = num(metrics.target_value);
    }

    // Uma linha no histórico significa "esta campanha rodou neste dia". O script
    // envia também campanhas sem atividade — é assim que o status de uma campanha
    // pausada chega até aqui —, mas essas NÃO podem virar linha do dia: enchiam
    // o detalhamento com campanhas antigas zeradas.
    //
    // Sem atividade: atualiza o status na linha que já existir (update não cria
    // nada quando não há linha) e não grava mais nada. Com atividade: upsert
    // normal. O status atual da campanha já foi gravado em products acima, e não
    // depende deste trecho.
    const hasAdsActivity = payload.impressions > 0 || payload.clicks > 0 || payload.cost > 0;

    let upsertError = null;
    if (hasAdsActivity) {
      // Revisão retroativa: o Google cancela cliques inválidos e devolve o valor
      // dias depois, mudando o custo de um dia já fechado. Comparando o que
      // chega com o que está gravado, a diferença deixa de precisar ser caçada
      // campanha por campanha. Só para dias anteriores — no dia corrente o valor
      // muda o tempo todo por acúmulo normal, e não é revisão.
      if (date !== hojeStr) {
        const { data: anterior } = await supabase
          .from('daily_metrics')
          .select('cost, clicks')
          .eq('product_id', product.id)
          .eq('date', date)
          .limit(1);

        const antes = anterior && anterior.length ? anterior[0] : null;
        if (antes) {
          const custoAntes = Number(antes.cost) || 0;
          const cliquesAntes = Number(antes.clicks) || 0;
          // Um centavo de folga evita marcar revisão por arredondamento.
          const mudouCusto = Math.abs(custoAntes - payload.cost) > 0.005;
          const mudouCliques = cliquesAntes !== payload.clicks;
          if (mudouCusto || mudouCliques) {
            payload.cost_previous = custoAntes;
            payload.clicks_previous = cliquesAntes;
            payload.revised_at = new Date().toISOString();
          }
        }
      }

      let { error } = await supabase
        .from('daily_metrics')
        .upsert(payload, { onConflict: 'product_id, date' }); // Upsert mescla os dados

      // As colunas de revisão só existem após a migration. Até lá o Postgres
      // recusa a linha inteira; sem este resguardo, a coleta pararia de gravar.
      if (error && /cost_previous|clicks_previous|revised_at/.test(error.message || '')) {
        delete payload.cost_previous;
        delete payload.clicks_previous;
        delete payload.revised_at;
        ({ error } = await supabase
          .from('daily_metrics')
          .upsert(payload, { onConflict: 'product_id, date' }));
      }
      upsertError = error;
    } else {
      const { error } = await supabase
        .from('daily_metrics')
        .update({
          campaign_status: payload.campaign_status,
          campaign_serving_status: payload.campaign_serving_status,
          campaign_primary_status: payload.campaign_primary_status,
          campaign_status_reasons: payload.campaign_status_reasons,
          account_status: payload.account_status,
          effective_status: payload.effective_status,
          updated_at: payload.updated_at,
        })
        .eq('product_id', product.id)
        .eq('date', date);
      upsertError = error;
    }

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
            const histLine = `[AUTO] ${hist.time} - ${descreverAlteracao(hist)}`;
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
        // Aparece no log do script: confirma, sem abrir o banco, se o script
        // colado no gerenciador é o atual.
        status_src: hasRawStatus
          ? `${script_version} servidor->${googleStatus}`
          : `${script_version} SEM CAMPOS CRUS (script desatualizado)`,
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