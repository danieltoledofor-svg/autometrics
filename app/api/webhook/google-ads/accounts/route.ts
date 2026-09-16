import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveEffectiveStatus } from '@/lib/campaignStatus';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Status das contas que o script NÃO conseguiu abrir.
 *
 * AdsManagerApp.accounts() não lista conta suspensa, então o script nunca
 * visita as campanhas dela e elas ficavam congeladas no último status — quase
 * sempre "ativo", que é justamente o contrário do que aconteceu. O script
 * descobre essas contas por customer_client e as reporta aqui.
 *
 * Marca todas as campanhas da conta de uma vez: sem acesso à conta, não há como
 * saber o estado de cada campanha, e o que importa é que nenhuma está rodando.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user_id, mcc_name, accounts } = body;

    if (!user_id || !Array.isArray(accounts)) {
      return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const atualizadas: Record<string, number> = {};
    const erros: string[] = [];

    for (const conta of accounts) {
      const nome = conta?.name;
      if (!nome) continue;

      // Mesma regra de status usada para campanhas: conta suspensa vence tudo.
      const status = resolveEffectiveStatus({ accountStatus: conta.status });
      // Conta ENABLED aqui significaria que ela existe e está normal, mas o
      // script não a abriu — sem motivo conhecido, é melhor não mexer.
      if (status !== 'CONTA_SUSPENSA' && status !== 'CONTA_ENCERRADA') continue;

      let q = supabase
        .from('products')
        .update({
          google_status: status,
          google_status_reasons: `conta ${conta.status}`,
          google_status_date: hoje,
          status: 'paused',
        })
        .eq('user_id', user_id)
        .eq('account_name', nome);

      // Nomes de conta podem se repetir entre gerenciadores.
      if (mcc_name) q = q.eq('mcc_name', mcc_name);

      const { data, error } = await q.select('id');
      if (error) erros.push(`${nome}: ${error.message}`);
      else atualizadas[nome] = data?.length || 0;
    }

    return NextResponse.json({ success: true, atualizadas, erros });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
