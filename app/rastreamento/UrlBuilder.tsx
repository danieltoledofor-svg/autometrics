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
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';

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
          <LinkIcon size={20} className="text-emerald-500" />
          <h2 className={`text-lg font-bold ${textHead}`}>Construtor de URL</h2>
        </div>
        <p className={`text-sm ${textMuted} mb-5`}>
          Cole o endereço da sua página abaixo. Os campos já vêm preenchidos com o que o Google troca na hora do clique (campanha, grupo de anúncios, palavra-chave, anúncio) e com o identificador do clique para o Autometrics.
        </p>

        {/* URL BASE */}
        <div className="mb-5">
          <label className={`block text-xs font-bold mb-2 ${textMuted}`}>Endereço da página (pré-venda ou página de vendas)</label>
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 ${isDark ? 'bg-slate-950 border-slate-700 focus-within:border-emerald-500' : 'bg-white border-slate-200 focus-within:border-emerald-400'} transition-colors`}>
            <ExternalLink size={15} className="text-emerald-400 shrink-0" />
            <input
              type="url"
              value={urlBase}
              onChange={e => setUrlBase(e.target.value)}
              placeholder="https://seusite.com/presell"
              className={`flex-1 bg-transparent outline-none text-sm ${textHead} placeholder:text-slate-500`}
            />
          </div>
        </div>

        {/* PARÂMETROS */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className={`text-xs font-bold uppercase ${textMuted}`}>Parâmetros</p>
            <button onClick={addParam} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-600 hover:text-black'}`}>
              <Plus size={12} /> Adicionar
            </button>
          </div>

          <div className="space-y-2">
            {urlParams.map((param, idx) => (
              <div key={idx} className={`flex flex-wrap items-center gap-2 p-2 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                {/* Padrão (Key Section) */}
                <div className="flex items-center gap-2 min-w-[140px]">
                  {/* Badge tipo */}
                  <span className={`shrink-0 text-[8px] sm:text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${param.locked ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
                    param.own ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                      'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                    }`}>
                    {param.locked ? 'UTM*' : param.own ? 'Autometrics' : 'UTM'}
                  </span>
                  {/* Key */}
                  <input
                    type="text"
                    value={param.key}
                    readOnly={param.locked}
                    onChange={e => updateParam(idx, 'key', e.target.value)}
                    className={`w-20 sm:w-28 bg-transparent outline-none text-xs font-mono ${param.locked ? textMuted : textHead} shrink-0`}
                  />
                </div>

                <span className={`text-slate-500 shrink-0 hidden sm:inline`}>=</span>
                
                {/* Value Section */}
                <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                  <span className={`text-slate-500 shrink-0 sm:hidden block`}>=</span>
                  <input
                    type="text"
                    value={param.value}
                    onChange={e => updateParam(idx, 'value', e.target.value)}
                    className={`flex-1 min-w-[100px] bg-transparent outline-none text-xs font-mono ${textHead}`}
                  />
                  {/* Remove */}
                  {!param.locked && (
                    <button onClick={() => removeParam(idx)} className="shrink-0 p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-auto">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* LEGENDA */}
        <div className="flex flex-wrap gap-3 mb-5 text-[10px]">
          <span className="flex items-center gap-1"><span className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded font-bold">UTM*</span> <span className={textMuted}>Obrigatório para o Autometrics</span></span>
          <span className="flex items-center gap-1"><span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">Autometrics</span> <span className={textMuted}>Identificador do clique para o rastreamento do Autometrics</span></span>
          <span className="flex items-center gap-1"><span className="bg-slate-500/20 text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded font-bold">UTM</span> <span className={textMuted}>Campo opcional (pode editar ou remover)</span></span>
        </div>
      </div>

      {/* URL GERADA */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center justify-between mb-3">
          <p className={`text-sm font-bold ${textHead}`}>URL Final Gerada</p>
          <button
            onClick={copyUrl}
            disabled={!finalUrl}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all shrink-0 ${urlCopied ? 'bg-emerald-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-30 disabled:cursor-not-allowed'
              }`}
          >
            {urlCopied ? <Check size={15} /> : <Copy size={15} />}
            {urlCopied ? 'Copiado!' : 'Copiar URL'}
          </button>
        </div>

        <div className={`rounded-xl p-4 font-mono text-xs break-all leading-relaxed border ${isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}>
          {finalUrl || (
            <span className="text-slate-500">Cole a URL base acima para ver o resultado aqui.</span>
          )}
        </div>

        {finalUrl && (
          <div className={`mt-4 p-3 rounded-lg border ${isDark ? 'bg-blue-500/5 border-blue-500/20' : 'bg-blue-50 border-blue-200'}`}>
            <p className="text-xs text-blue-400 font-bold mb-1">📋 Onde usar esta URL:</p>
            <p className={`text-xs ${textMuted}`}>
              Esta URL vai no campo <strong>URL Final</strong> do seu anúncio no Google Ads.
              Os valores entre chaves <code className={`${isDark ? 'bg-slate-800' : 'bg-slate-200'} px-1 rounded`}>{'{keyword}'}</code> serão substituídos automaticamente pelo Google no momento do clique.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
