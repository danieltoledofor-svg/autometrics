"use client";

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Ui } from '@/app/components/metrics/ColumnPicker';

/**
 * Alterações feitas na campanha e o que aconteceu depois (lib/analysis/changes).
 * Na aba Análise aparecem todas; nas outras abas, só as daquela área
 * (grupos, palavras-chave, anúncios…), para ver o efeito ao lado dos dados.
 * Nas abas de dados a lista pode ser ocultada; a escolha fica guardada no navegador.
 */

const HIDDEN = 'autometrics_alteracoes_ocultas';

export type ChangeArea = 'campanha' | 'grupos' | 'palavras' | 'anuncios' | 'recursos' | 'segmentacao';

const OUTCOME: Record<string, { label: string; cls: string }> = {
  melhorou: { label: 'Melhorou', cls: 'bg-pos/15 text-pos' },
  piorou: { label: 'Piorou', cls: 'bg-neg/15 text-neg' },
  igual: { label: 'Ficou igual', cls: 'bg-surface-3/15 text-ink-subtle' },
  aguardando: { label: 'Aguardando', cls: 'bg-warn/15 text-warn' },
  sem_base: { label: 'Sem base', cls: 'bg-surface-3/15 text-ink-subtle' },
};
const ddmm = (d?: string | null) => (d ? d.slice(5).split('-').reverse().join('/') : '');

// Uma leitura por campanha: as abas dividem a mesma resposta.
const cache = new Map<string, Promise<any[]>>();
function load(productId: string): Promise<any[]> {
  if (!cache.has(productId)) {
    cache.set(productId, (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/analysis?product_id=${productId}&only=changes`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
      const body = await res.json().catch(() => ({}));
      return Array.isArray(body.changes) ? body.changes : [];
    })().catch(() => []));
  }
  return cache.get(productId)!;
}

export function ChangeNotes({ productId, ui, areas, events, limit = 6 }: {
  productId: string; ui: Ui; areas?: ChangeArea[]; events?: any[]; limit?: number;
}) {
  const [loaded, setLoaded] = useState<any[] | null>(events || null);
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(!!areas && localStorage.getItem(HIDDEN) === '1'); } catch { /* sem armazenamento */ } }, [areas]);
  const toggleHidden = () => setHidden(v => { try { localStorage.setItem(HIDDEN, v ? '0' : '1'); } catch { /* sem armazenamento */ } return !v; });
  useEffect(() => {
    if (events) { setLoaded(events); return; }
    let alive = true;
    load(productId).then(list => { if (alive) setLoaded(list); });
    return () => { alive = false; };
  }, [productId, events]);

  const { bgCard, borderCol, textHead, textMuted } = ui;
  const list = (loaded || [])
    .map(e => ({ ...e, shown: areas ? e.items.filter((i: any) => areas.includes(i.area)) : e.items }))
    .filter(e => e.shown.length > 0 || (!areas && e.created));
  // Nas abas de dados, sem alteração daquela área não aparece nada.
  if (!loaded || (areas && !list.length)) return null;

  return (
    <div className={`${bgCard} border ${borderCol} rounded-xl mb-4 ${hidden ? 'px-4 py-2.5' : 'p-4'}`}>
      <div className={`flex items-center justify-between gap-3 ${hidden ? '' : 'mb-1'}`}>
        <div className={`text-[11px] font-semibold ${textMuted}`}>
          {areas ? 'Alterações feitas aqui e o que aconteceu depois' : 'Alterações feitas na campanha e o que aconteceu depois'}
          {hidden && <span className="font-medium normal-case tracking-normal"> · {list.length} {list.length === 1 ? 'data' : 'datas'}</span>}
        </div>
        {areas && (
          <button onClick={toggleHidden} className="inline-flex items-center gap-1 text-xs font-medium text-brand-text hover:underline whitespace-nowrap shrink-0">
            {hidden ? <>Mostrar <ChevronDown size={13} /></> : <>Ocultar <ChevronUp size={13} /></>}
          </button>
        )}
      </div>
      {hidden ? null : <>
      <div className={`text-[11px] ${textMuted} mb-2`}>
        Compara os 7 dias antes com os 3 e os 7 dias depois. O número é da campanha inteira, não de cada alteração sozinha.
      </div>
      {!list.length ? <div className={`text-sm ${textMuted}`}>O Google ainda não registrou alteração nesta campanha.</div> : (
        <div className="space-y-0">
          {(all ? list : list.slice(0, limit)).map(e => (
            <div key={e.date} className={`flex gap-3 items-start py-2 border-t ${borderCol}`}>
              <div className={`text-[13px] font-medium tabular-nums w-11 shrink-0 ${textHead}`}>{ddmm(e.date)}</div>
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] ${textHead}`}>
                  {e.shown.length ? e.shown.map((i: any) => i.text).join(' · ') : 'Campanha criada'}
                  {areas && e.items.length > e.shown.length && <span className={textMuted}> · e outras {e.items.length - e.shown.length} no mesmo dia</span>}
                </div>
                <div className={`text-[12px] ${textMuted} mt-0.5`}>
                  {e.text}
                  {e.mixed && ' Houve outra alteração dentro desses dias, então o efeito não é só desta.'}
                  {e.next_check && e.outcome !== 'aguardando' && ` Confere de novo com 7 dias em ${ddmm(e.next_check)}.`}
                </div>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${OUTCOME[e.outcome]?.cls}`}>
                {OUTCOME[e.outcome]?.label}{e.outcome === 'aguardando' && e.next_check ? ` até ${ddmm(e.next_check)}` : ''}
              </span>
            </div>
          ))}
          {list.length > limit && (
            <button onClick={() => setAll(v => !v)} className="text-xs text-brand-text hover:underline pt-2">
              {all ? 'Mostrar menos' : `Ver as ${list.length} datas`}
            </button>
          )}
        </div>
      )}
      </>}
    </div>
  );
}
