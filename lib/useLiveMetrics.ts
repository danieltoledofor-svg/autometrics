import { useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Venda nova (ou custo novo) na tela sem recarregar a página.
 *
 * A cada 30 segundos, com a aba à vista, pede só as linhas de ontem e de hoje
 * de daily_metrics que mudaram desde a última olhada e troca essas linhas na
 * lista da tela. Voltar para a aba olha na hora. É uma consulta pequena: o
 * banco só devolve as linhas das campanhas do próprio usuário.
 *
 * `accept` diz quais linhas interessam à tela (campanhas carregadas, período
 * escolhido); `productId` restringe a uma campanha.
 */
export function useLiveMetrics(
  client: SupabaseClient,
  enabled: boolean,
  setRows: (update: (current: any[]) => any[]) => void,
  options: { productId?: string; accept?: (row: any) => boolean; ascending?: boolean } = {},
) {
  const lastLook = useRef('');
  const opts = useRef(options);
  opts.current = options;
  useEffect(() => {
    if (!enabled) return;
    if (!lastLook.current) lastLook.current = new Date().toISOString();
    let busy = false;
    const look = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const since = new Date(new Date(lastLook.current).getTime() - 5000).toISOString();   // folga para o relógio do servidor
        const started = new Date().toISOString();
        const d = new Date(); d.setDate(d.getDate() - 1);
        const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        let query = client.from('daily_metrics').select('*').gte('date', from).gt('updated_at', since);
        if (opts.current.productId) query = query.eq('product_id', opts.current.productId);
        const { data, error } = await query.limit(1000);
        if (error) return;
        lastLook.current = started;
        const rows = (data || []).filter(r => !opts.current.accept || opts.current.accept(r));
        if (!rows.length) return;
        setRows(current => {
          const fresh = new Map(rows.map(r => [r.id, r]));
          const next = current.map(r => { const n = fresh.get(r.id); if (n) fresh.delete(r.id); return n || r; });
          if (!fresh.size) return next;
          // Linha de um dia que ainda não estava na tela.
          const all = [...fresh.values(), ...next];
          return opts.current.ascending ? all.sort((a, b) => String(a.date).localeCompare(String(b.date))) : all;
        });
      } finally { busy = false; }
    };
    const timer = setInterval(look, 30 * 1000);
    document.addEventListener('visibilitychange', look);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', look); };
  }, [client, enabled, setRows]);
}
