"use client";

import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Link as LinkIcon, Plus, Trash2 } from 'lucide-react';

/**
 * Construtor de URL (aba Instalação do Rastreamento): monta o endereço do
 * anúncio com os campos que o Google preenche na hora do clique.
 *
 * utm_id, utm_source e utm_medium são fixos: campanha, origem e grupo de
 * anúncios. amclid leva o gclid embrulhado (am_{gclid}_am), para o clique
 * chegar ao script mesmo se a marcação automática do Google falhar.
 */
export function UrlBuilder({ isDark }: { isDark: boolean }) {
  const [urlBase, setUrlBase] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);
  const [urlParams, setUrlParams] = useState([
    { key: 'utm_id', value: '{campaignid}', locked: true, own: false },
    { key: 'utm_source', value: 'google', locked: true, own: false },
    { key: 'utm_medium', value: '{adgroupid}', locked: true, own: false },
    { key: 'utm_term', value: '{keyword}', locked: false, own: false },
    { key: 'utm_content', value: '{creative}', locked: false, own: false },
    { key: 'matchtype', value: '{matchtype}', locked: false, own: false },
    { key: 'network', value: '{network}', locked: false, own: false },
    { key: 'device', value: '{device}', locked: false, own: false },
    { key: 'amclid', value: 'am_{gclid}_am', locked: false, own: true },
  ]);
  const bgCard = 'bg-surface-1 border-line';
  const textHead = 'text-ink';
  const textMuted = 'text-ink-subtle';

  const buildUrl = () => {
    if (!urlBase.trim()) return '';
    try {
      const base = urlBase.trim();
      const hasQuery = base.includes('?');
      const params = urlParams.filter(p => p.key && p.value);
      const qs = params.map(p => `${encodeURIComponent(p.key)}=${p.value}`).join('&');
      return `${base}${hasQuery ? '&' : '?'}${qs}`;
    } catch { return urlBase; }
  };
  const finalUrl = buildUrl();

  const updateParam = (idx: number, field: 'key' | 'value', val: string) => {
    setUrlParams(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  };
  const removeParam = (idx: number) => {
    setUrlParams(prev => prev.filter((_, i) => i !== idx));
  };
  const addParam = () => {
    setUrlParams(prev => [...prev, { key: '', value: '', locked: false, own: false }]);
  };
  const copyUrl = () => {
    navigator.clipboard.writeText(finalUrl);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center gap-3 mb-1">
          <LinkIcon size={20} aria-hidden="true" className="text-pos" />
          <h2 className={`text-base font-semibold ${textHead}`}>Construtor de URL</h2>
        </div>
        <p className={`text-sm ${textMuted} mb-5`}>
          Cole o endereço da sua página abaixo. Os campos já vêm preenchidos com o que o Google troca na hora do clique (campanha, grupo de anúncios, palavra-chave, anúncio) e com o identificador do clique para o Autometrics.
        </p>

        {/* URL BASE */}
        <div className="mb-5">
          <label htmlFor="url-builder-base" className={`block text-xs font-medium mb-2 ${textMuted}`}>Endereço da página (pré-venda ou página de vendas)</label>
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 bg-surface-2 border-line focus-within:border-brand transition-colors`}>
            <ExternalLink size={15} aria-hidden="true" className="text-ink-subtle shrink-0" />
            <input
              id="url-builder-base"
              type="url"
              value={urlBase}
              onChange={e => setUrlBase(e.target.value)}
              placeholder="https://seusite.com/presell"
              className={`flex-1 bg-transparent outline-none text-sm ${textHead} placeholder:text-ink-faint`}
            />
          </div>
        </div>

        {/* PARÂMETROS */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className={`text-xs font-medium ${textMuted}`}>Parâmetros</p>
            <button onClick={addParam} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-surface-2 text-ink-subtle hover:text-ink`}>
              <Plus size={12} aria-hidden="true" /> Adicionar
            </button>
          </div>

          <div className="space-y-2">
            {urlParams.map((param, idx) => (
              <div key={idx} className={`flex flex-wrap items-center gap-2 p-2 rounded-xl border bg-surface-2 border-line`}>
                {/* Padrão (Key Section) */}
                <div className="flex items-center gap-2 min-w-[140px]">
                  {/* Badge tipo */}
                  <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${param.locked ? 'bg-brand/15 text-brand-text border border-brand/30' :
                    param.own ? 'bg-warn/10 text-warn border border-warn/30' :
                      'bg-surface-3 text-ink-subtle border border-line'
                    }`}>
                    {param.locked ? 'UTM*' : param.own ? 'Autometrics' : 'UTM'}
                  </span>
                  {/* Key */}
                  <input
                    type="text"
                    value={param.key}
                    aria-label={`Nome do parâmetro ${idx + 1}`}
                    readOnly={param.locked}
                    onChange={e => updateParam(idx, 'key', e.target.value)}
                    className={`w-20 sm:w-28 bg-transparent outline-none text-xs font-mono ${param.locked ? textMuted : textHead} shrink-0`}
                  />
                </div>

                <span className="text-ink-faint shrink-0 hidden sm:inline">=</span>
                
                {/* Value Section */}
                <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                  <span className="text-ink-faint shrink-0 sm:hidden block">=</span>
                  <input
                    type="text"
                    value={param.value}
                    aria-label={`Valor do parâmetro ${param.key || idx + 1}`}
                    onChange={e => updateParam(idx, 'value', e.target.value)}
                    className={`flex-1 min-w-[100px] bg-transparent outline-none text-xs font-mono ${textHead}`}
                  />
                  {/* Remove */}
                  {!param.locked && (
                    <button onClick={() => removeParam(idx)} aria-label={`Remover o parâmetro ${param.key || idx + 1}`} className="shrink-0 p-1.5 rounded text-ink-subtle hover:text-neg hover:bg-neg/10 transition-colors ml-auto">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* LEGENDA */}
        <div className="flex flex-wrap gap-3 mb-5 text-[10px]">
          <span className="flex items-center gap-1"><span className="bg-brand/15 text-brand-text border border-brand/30 px-1.5 py-0.5 rounded font-medium">UTM*</span> <span className={textMuted}>Obrigatório para o Autometrics</span></span>
          <span className="flex items-center gap-1"><span className="bg-warn/10 text-warn border border-warn/30 px-1.5 py-0.5 rounded font-medium">Autometrics</span> <span className={textMuted}>Identificador do clique para o rastreamento do Autometrics</span></span>
          <span className="flex items-center gap-1"><span className="bg-surface-3 text-ink-subtle border border-line px-1.5 py-0.5 rounded font-medium">UTM</span> <span className={textMuted}>Campo opcional (pode editar ou remover)</span></span>
        </div>
      </div>

      {/* URL GERADA */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center justify-between mb-3">
          <p className={`text-sm font-medium ${textHead}`}>URL Final Gerada</p>
          <button
            onClick={copyUrl}
            disabled={!finalUrl}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${urlCopied ? 'bg-pos text-white' : 'bg-brand hover:bg-brand-hover text-white disabled:opacity-30 disabled:cursor-not-allowed'
              }`}
          >
            {urlCopied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {urlCopied ? 'Copiado!' : 'Copiar URL'}
          </button>
        </div>

        <div className={`rounded-xl p-4 font-mono text-xs break-all leading-relaxed border bg-surface-2 border-line text-ink-muted`}>
          {finalUrl || (
            <span className="text-ink-faint">Cole a URL base acima para ver o resultado aqui.</span>
          )}
        </div>

        {finalUrl && (
          <div className={`mt-4 p-3 rounded-lg border bg-brand/5 border-brand/20`}>
            <p className="text-xs text-brand-text font-medium mb-1">Onde usar esta URL:</p>
            <p className={`text-xs ${textMuted}`}>
              Esta URL vai no campo <strong>URL Final</strong> do seu anúncio no Google Ads.
              Os valores entre chaves <code className="bg-surface-3 px-1 rounded">{'{keyword}'}</code> serão substituídos automaticamente pelo Google no momento do clique.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
