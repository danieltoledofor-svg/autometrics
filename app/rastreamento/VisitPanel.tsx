"use client";

import React, { forwardRef } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { JourneyStep } from '@/lib/tracking/journey';
import { money, when, clock, lasted, path, DEVICE, TRAFFIC, type Ui } from './shared';

/**
 * O detalhe que as abas Visitas, Vendas e Checkouts têm em comum: o caminho do
 * lead (lib/tracking/journey.ts), o anúncio, o visitante, o que ele fez na
 * página e tudo o que veio na URL. `children` entra depois desses blocos.
 */

/** Nome simples de cada campo que chega na URL do anúncio. */
const PARAM: Record<string, string> = {
  gclid: 'Clique do Google', gbraid: 'Clique do Google (iPhone)', wbraid: 'Clique do Google (app)', ftgid: 'Clique do Google (via FlowTracking)', amclid: 'Clique do Google (pelo Autometrics)',
  utm_id: 'Campanha (número)', gad_campaignid: 'Campanha (número, do Google)', utm_campaign: 'Campanha (nome)', utm_source: 'Origem',
  utm_medium: 'Grupo de anúncios', utm_content: 'Anúncio', utm_term: 'Palavra-chave', keyword: 'Palavra-chave', matchtype: 'Tipo de correspondência',
  network: 'Rede', device: 'Aparelho (pelo Google)', gad_source: 'Origem (do Google)', ft_sid: 'Sessão da FlowTracking', src: 'Marcação da página',
  loc_physical_ms: 'Local (número do Google)', devicemodel: 'Modelo do aparelho', extensionid: 'Extensão clicada', placement: 'Site onde o anúncio apareceu',
};

const STEP_COLOR: Partial<Record<JourneyStep['kind'], string>> = { checkout: 'text-warn', compra: 'text-pos', reembolso: 'text-neg' };

/** Tempo desde o passo anterior que tem hora. */
function since(steps: JourneyStep[], i: number) {
  const at = steps[i].at;
  const before = steps.slice(0, i).reverse().find(s => s.at)?.at;
  if (!at || !before) return '';
  return `+${lasted((Date.parse(at) - Date.parse(before)) / 1000)}`;
}

export function Journey({ ui, steps }: { ui: Ui; steps: JourneyStep[] }) {
  const { title, muted, head } = ui;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <div className={title}>Caminho do lead</div>
        <div className={`text-xs ${muted}`}>Horários de Brasília.</div>
      </div>
      {steps.length === 0 ? <div className={`text-[13px] mt-1 ${muted}`}>Nenhuma página registrada.</div> : (
        <ol className="mt-2 flex flex-wrap gap-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-stretch w-full sm:w-auto">
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 w-full sm:w-48 min-w-0">
                <div className={`text-[13px] font-medium ${STEP_COLOR[s.kind] || head}`}>{s.label}{s.amount ? ` ${money(s.amount, s.currency)}` : ''}</div>
                <div className={`text-xs tabular-nums ${muted}`}>{s.at ? clock(s.at) : 'Sem hora registrada'}{since(steps, i) ? ` · ${since(steps, i)}` : ''}</div>
                {s.url && <div className={`text-xs truncate ${head}`} title={s.url}>{path(s.url)}</div>}
                {s.note && <div className={`text-xs ${muted}`}>{s.note}</div>}
                {s.order && <div className={`text-xs ${muted}`}>Pedido {s.order}</div>}
                {s.google && <div className={`text-xs ${muted}`} title={s.google.reason || ''}>Google: {s.google.status}</div>}
              </div>
              {i < steps.length - 1 && <ChevronRight size={16} aria-hidden="true" className={`hidden sm:block self-center mx-1 shrink-0 ${muted}`} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Props = { ui: Ui; label: string; heading: React.ReactNode; sub: React.ReactNode; steps: JourneyStep[]; visit?: any; onClose: () => void; children?: React.ReactNode };

export const VisitPanel = forwardRef<HTMLDivElement, Props>(function VisitPanel({ ui, label, heading, sub, steps, visit, onClose, children }, ref) {
  const { card, head, muted, title } = ui;
  const info = (name: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 text-[13px]"><span className={muted}>{name}</span><span className={`${head} text-right break-all`}>{value || <span className={muted}>—</span>}</span></div>
  );
  return (
    <div ref={ref} tabIndex={-1} aria-label={label} className={`${card} border rounded-xl p-4 space-y-4 scroll-mt-4 focus:outline-none`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-medium ${head}`}>{heading}</div>
          <div className={`text-xs mt-0.5 ${muted}`}>{sub}</div>
        </div>
        <button onClick={onClose} aria-label="Fechar o detalhe" className={muted}><X size={18} aria-hidden="true" /></button>
      </div>
      <Journey ui={ui} steps={steps} />
      {visit ? (
        <div className="grid md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <div className={title}>Anúncio</div>
            {info('Origem', TRAFFIC[visit.traffic] || '')}
            {info('Palavra-chave', visit.keyword)}
            {info('Correspondência', visit.match_type)}
            {info('Grupo de anúncios', visit.ad_group_id)}
            {info('Anúncio', visit.ad_id)}
            {info('Rede', visit.network === 'g' ? 'Pesquisa do Google' : visit.network === 's' ? 'Parceiros de pesquisa' : visit.network === 'd' ? 'Display' : visit.network)}
            {info('Página de entrada', path(visit.landing_url || ''))}
            {info('Veio de', visit.referrer ? path(visit.referrer) : '')}
          </div>
          <div>
            <div className={title}>Visitante</div>
            {info('País', visit.country)}
            {info('Estado', visit.region)}
            {info('Cidade', visit.city)}
            {info('IP', visit.ip)}
            {info('Aparelho', DEVICE[visit.device] || '')}
            {info('Sistema', visit.os)}
            {info('Navegador', visit.browser)}
            {info('Tela', visit.screen ? visit.screen.replace('x', ' × ') : '')}
            {info('Idioma', visit.language)}
            {visit.is_bot && <div className="text-xs text-warn mt-1">Parece um robô, não uma pessoa.</div>}
          </div>
          <div>
            <div className={title}>Na página</div>
            {info('Tempo', visit.seconds ? lasted(visit.seconds) : '')}
            {info('Rolou até', visit.max_scroll ? `${visit.max_scroll}%` : '')}
            {info('Última atividade', when(visit.last_seen_at))}
          </div>
        </div>
      ) : <p className={`text-[13px] ${muted}`}>Nenhuma visita ligada: o script não registrou esse clique nas páginas, então só há o que a plataforma avisou.</p>}
      {children}
      {visit?.params && Object.keys(visit.params).length > 0 && (
        <div>
          <div className={title}>Tudo o que veio na URL do anúncio</div>
          <div className="grid md:grid-cols-2 gap-x-6 mt-1">
            {Object.entries(visit.params as Record<string, string>).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-1 text-[13px]">
                <span className={muted}>{PARAM[k] || k}</span><span className={`${head} text-right break-all max-w-[60%]`}>{String(v).length > 60 ? `${String(v).slice(0, 28)}…${String(v).slice(-12)}` : String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
