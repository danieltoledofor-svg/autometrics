"use client";

import React, { useState } from 'react';
import { Check, Copy, Zap } from 'lucide-react';
import { ConversionUploadCard } from '@/app/integration/ConversionUploadCard';
import { UrlBuilder } from './UrlBuilder';

/**
 * Aba Instalação do Rastreamento (antes "Conversão Automática", na Integração):
 * o script das páginas, a URL de postback de cada plataforma de venda e o
 * envio das vendas ao Google.
 */
export function InstallTab({ isDark, userId }: { isDark: boolean; userId: string }) {
  const [convTracker, setConvTracker] = useState<'flowtracking'>('flowtracking');
  const [convPlatform, setConvPlatform] = useState<'buygoods' | 'clickbank' | 'digistore' | 'gurumedia' | 'jvzoo' | 'maxweb' | 'mediascalers' | 'smartadv'>('buygoods');
  const [copiedPostback, setCopiedPostback] = useState<string | null>(null);
  const copyPostback = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPostback(key);
    setTimeout(() => setCopiedPostback(null), 2000);
  };
  const bgCard = isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const textHead = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = 'text-slate-500';

  const origin = typeof window !== "undefined" ? window.location.origin : "https://autometrics.cloud";

  // A FlowTracking ocupa todos os subids da plataforma: SUBID/SUBID4 = ftsession_<ft_sid>,
  // SUBID2 = gclid. O script guarda gclid e ftsession ligados à campanha do clique,
  // e o postback resolve a campanha por qualquer um dos subids.
  //
  // Script único (v4): uma linha, igual em todas as páginas. O código mora
  // em public/am.js, então melhorias valem sem trocar nada nas páginas.
  const flowScript = `<script src="https://autometrics.cloud/am.js" data-uid="${userId}" async></script>`;

  // Só a venda, por enquanto: o evento vai fixo em "sale", menos onde a
  // própria plataforma diz o que aconteceu (BuyGoods e Digistore).
  const pb = (source: string, query: string) => `${origin}/api/postback/${userId}?source=${source}&${query}`;
  const where = (name: string) => [
    <>Na {name}, abra a área de <strong>postback</strong> (onde está o postback da FlowTracking).</>,
    <><strong>Mantenha</strong> o postback da FlowTracking como está e <strong>adicione um novo</strong> postback, para o evento de venda.</>,
    <>Cole a URL de postback do passo 2 e salve.</>,
  ];
  const saleNote = <>Esta URL recebe só a <strong>venda</strong>. O valor é a sua comissão.</>;
  const platforms = {
    buygoods: {
      name: 'BuyGoods',
      postback: pb('BuyGoods', 'event={CONV_TYPE}&cy=USD&amount={COMMISSION_AMOUNT}&orderid={ORDERID}&product={PRODUCT_CODENAME}&subid1={SUBID}&subid2={SUBID2}&subid3={SUBID3}&subid4={SUBID4}&subid5={SUBID5}'),
      note: <>A mesma URL recebe venda frontend e upsell — o <code className={`px-1 rounded ${isDark ? 'bg-slate-800 text-indigo-300' : 'bg-slate-100 text-indigo-600'}`}>{'{CONV_TYPE}'}</code> identifica o evento.</>,
      details: [
        { label: 'event', value: '{CONV_TYPE} (frontend / upsell / sale)' },
        { label: 'subid1', value: '{SUBID} (ftsession)' },
        { label: 'subid2', value: '{SUBID2} (gclid)' },
        { label: 'orderid', value: '{ORDERID}' },
        { label: 'amount', value: '{COMMISSION_AMOUNT}' },
      ],
      steps: [
        <>Na BuyGoods, abra <strong>Settings → Postback / Pixels</strong> (onde está o postback da FlowTracking).</>,
        <><strong>Mantenha</strong> o postback da FlowTracking como está e <strong>adicione um novo</strong> postback.</>,
        <>Cole a URL de postback do passo 2 e salve.</>,
      ],
    },
    clickbank: {
      name: 'ClickBank',
      postback: pb('ClickBank', 'event={event_type}&cy=USD&amount={affiliate_earnings}&orderid={receipt_id}&product={vendor}&subid1={aff_sub1}&subid2={tid}&subid3={extclid}&subid4={aff_sub2}&subid5={aff_sub3}'),
      note: <>A mesma URL recebe a compra e o upsell — o <code className={`px-1 rounded ${isDark ? 'bg-slate-800 text-indigo-300' : 'bg-slate-100 text-indigo-600'}`}>{'{event_type}'}</code> identifica o evento. O valor é a sua comissão, em dólar.</>,
      details: [
        { label: 'event', value: '{event_type} (Purchase / Upsell)' },
        { label: 'subid1', value: '{aff_sub1} (gclid)' },
        { label: 'subid2', value: '{tid}' },
        { label: 'orderid', value: '{receipt_id}' },
        { label: 'amount', value: '{affiliate_earnings}' },
      ],
      steps: [
        <>Na ClickBank, abra <strong>Integrations → Postback/Pixels</strong> e clique em <strong>Add Integration</strong>.</>,
        <>Escolha <strong>Custom Postback/Pixel</strong>, a sua conta, o papel <strong>Affiliate</strong> e o nível <strong>Global</strong>.</>,
        <>Em eventos, marque <strong>Initial Purchase</strong> e <strong>Upsell Purchase</strong>. Não marque <strong>Combined Conversion</strong> junto, para a venda não entrar duas vezes.</>,
        <>Cole a URL de postback do passo 2, salve e use o <strong>Test</strong> da própria ClickBank.</>,
      ],
    },
    digistore: {
      name: 'Digistore',
      postback: pb('Digistore', 'event={transaction_type}&cy={currency}&amount={amount_affiliate}&orderid={transaction_id}&product={product_name}&cid={cid}&subid1={sid1}&subid2={sid2}&subid3={sid3}&subid4={sid4}&subid5={sid5}'),
      note: <>A Digistore avisa o tipo em <code className={`px-1 rounded ${isDark ? 'bg-slate-800 text-indigo-300' : 'bg-slate-100 text-indigo-600'}`}>{'{transaction_type}'}</code>: pagamento entra como venda; os outros avisos são ignorados.</>,
      details: [
        { label: 'event', value: '{transaction_type}' },
        { label: 'cid', value: '{cid} (gclid)' },
        { label: 'subid1', value: '{sid1}' },
        { label: 'orderid', value: '{transaction_id}' },
        { label: 'amount', value: '{amount_affiliate}' },
      ],
      steps: where('Digistore'),
    },
    gurumedia: {
      name: 'Gurumedia',
      postback: pb('Gurumedia', 'event=sale&cy={offer_currency}&amount={payout_amount}&orderid={transaction_id}&product={offer_name}&subid1={sub1}&subid2={sub2}&subid3={sub3}&subid4={sub4}&subid5={sub5}'),
      note: saleNote,
      details: [
        { label: 'subid1', value: '{sub1}' },
        { label: 'subid2', value: '{sub2}' },
        { label: 'orderid', value: '{transaction_id}' },
        { label: 'amount', value: '{payout_amount}' },
      ],
      steps: where('Gurumedia'),
    },
    jvzoo: {
      name: 'JVZoo',
      postback: pb('JVZoo', 'event=sale&cy={currency}&amount={affiliate_amount}&orderid={transaction_id}&product={product_name}&subid1={gclid}&subid2={sub_id2}&subid3={sub_id3}&subid4={sub_id4}&subid5={sub_id5}'),
      note: saleNote,
      details: [
        { label: 'subid1', value: '{gclid}' },
        { label: 'subid2', value: '{sub_id2}' },
        { label: 'orderid', value: '{transaction_id}' },
        { label: 'amount', value: '{affiliate_amount}' },
      ],
      steps: where('JVZoo'),
    },
    maxweb: {
      name: 'MaxWeb',
      postback: pb('MaxWeb', 'event={CONV_TYPE}&cy=USD&amount={COMMISSION_AMOUNT}&orderid={ORDERID}&product={PRODUCT_CODENAME}&subid1={SUBID}&subid2={SUBID2}&subid3={SUBID3}&subid4={SUBID4}&subid5={SUBID5}'),
      note: <>A mesma URL recebe venda frontend e upsell — o <code className={`px-1 rounded ${isDark ? 'bg-slate-800 text-indigo-300' : 'bg-slate-100 text-indigo-600'}`}>{'{CONV_TYPE}'}</code> identifica o evento.</>,
      details: [
        { label: 'event', value: '{CONV_TYPE}' },
        { label: 'subid1', value: '{SUBID}' },
        { label: 'subid2', value: '{SUBID2} (gclid)' },
        { label: 'orderid', value: '{ORDERID}' },
        { label: 'amount', value: '{COMMISSION_AMOUNT}' },
      ],
      steps: where('MaxWeb'),
    },
    mediascalers: {
      name: 'MediaScalers',
      postback: pb('MediaScalers', 'event=sale&status={status}&cy={offer_currency}&amount={payout_amount}&orderid={transaction_id}&product={offer_name}&subid1={sub1}&subid2={sub2}'),
      note: <>{saleNote} Venda que a rede marcar como recusada não entra.</>,
      details: [
        { label: 'subid1', value: '{sub1}' },
        { label: 'subid2', value: '{sub2}' },
        { label: 'status', value: '{status}' },
        { label: 'orderid', value: '{transaction_id}' },
        { label: 'amount', value: '{payout_amount}' },
      ],
      steps: where('MediaScalers'),
    },
    smartadv: {
      name: 'SmartAdv',
      postback: pb('SmartAdv', 'event=sale&status={status}&cy={offer_currency}&amount={payout_amount}&orderid={transaction_id}&product={offer_name}&subid1={sub1}&subid2={sub2}&subid3={sub3}&subid4={sub4}&subid5={sub5}'),
      note: <>{saleNote} Venda que a rede marcar como recusada não entra.</>,
      details: [
        { label: 'subid1', value: '{sub1} (gclid)' },
        { label: 'subid2', value: '{sub2}' },
        { label: 'status', value: '{status}' },
        { label: 'orderid', value: '{transaction_id}' },
        { label: 'amount', value: '{payout_amount}' },
      ],
      steps: where('SmartAdv'),
    },
  } as const;
  const platformKeys = Object.keys(platforms) as (keyof typeof platforms)[];
  const plat = platforms[convPlatform];
  const stepBadge = (n: number) => (
    <span className="bg-indigo-600 w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white shrink-0">{n}</span>
  );
  const subTabClass = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${active ? 'bg-indigo-500 text-white' : `${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-black'}`}`;
  const copyBtn = (text: string, key: string, label: string) => (
    <button onClick={() => copyPostback(text, key)}
      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${copiedPostback === key ? 'bg-emerald-500 text-white' : `${isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-600 hover:text-black'}`}`}>
      {copiedPostback === key ? <Check size={12} /> : <Copy size={12} />}
      {copiedPostback === key ? 'Copiado!' : label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center gap-3 mb-1">
          <Zap size={20} className="text-amber-400" />
          <h2 className={`text-lg font-bold ${textHead}`}>Conversão Automática</h2>
        </div>
        <p className={`text-sm ${textMuted} mb-5`}>
          Cada venda feita na plataforma entra automaticamente na campanha certa do AutoMetrics,
          funcionando <strong>junto</strong> com o seu tracker — nada do que ele já faz é alterado.
        </p>

        <p className={`text-xs font-bold uppercase mb-2 ${textMuted}`}>Tracker</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setConvTracker('flowtracking')} className={subTabClass(convTracker === 'flowtracking')}>FlowTracking</button>
        </div>

        <p className={`text-xs font-bold uppercase mb-2 ${textMuted}`}>Plataforma de venda</p>
        <div className="flex flex-wrap gap-2">
          {platformKeys.map(k => (
            <button key={k} onClick={() => setConvPlatform(k)} className={subTabClass(convPlatform === k)}>{platforms[k].name}</button>
          ))}
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-2 text-xs font-mono p-4 rounded-lg border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
        <span className="bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded">Clique (gclid + ft_sid)</span>
        <span className={textMuted}>→ script liga à campanha →</span>
        <span className="bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">FlowTracking preenche os subids</span>
        <span className={textMuted}>→</span>
        <span className="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">{plat.name} dispara postback → venda na campanha</span>
      </div>

      {/* PASSO 1: SCRIPT */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${textHead}`}>{stepBadge(1)} Script nas páginas do funil</h3>
          {copyBtn(flowScript, 'conv_flow_script', 'Copiar Script')}
        </div>
        <p className={`text-xs mb-3 ${textMuted}`}>
          Cole antes do <code className={`px-1 rounded ${isDark ? 'bg-slate-800 text-indigo-300' : 'bg-slate-100 text-indigo-600'}`}>&lt;/body&gt;</code> em <strong>todas as páginas antes do checkout</strong> (pré-lander e VSL),
          junto com o script da FlowTracking. Ele liga o <strong>gclid</strong> e a sessão da FlowTracking à campanha do clique.
        </p>
        <pre className={`rounded-lg p-4 text-[11px] font-mono overflow-x-auto leading-relaxed ${isDark ? 'bg-slate-950 text-slate-300' : 'bg-slate-50 text-slate-700'}`}>{flowScript}</pre>
      </div>

      {/* Endereço do anúncio, com os campos que o script lê */}
      <UrlBuilder isDark={isDark} />

      {/* PASSO 2: POSTBACK */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${textHead}`}>{stepBadge(2)} Postback na {plat.name}</h3>
          {copyBtn(plat.postback, `conv_pb_${convPlatform}`, 'Copiar URL')}
        </div>
        <p className={`text-xs mb-3 ${textMuted}`}>
          {plat.note}
        </p>
        <code className={`block text-[11px] font-mono break-all p-3 rounded border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'} ${textMuted}`}>{plat.postback}</code>
        <div className="flex flex-wrap gap-2 mt-3">
          {plat.details.map(d => (
            <span key={d.label} className={`text-[10px] px-2 py-0.5 rounded font-mono ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>
              <span className="text-indigo-400">{d.label}</span>=<span className="text-blue-400">{d.value}</span>
            </span>
          ))}
        </div>
      </div>

      {/* PASSO 3: CONFIGURAR NA PLATAFORMA */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <h3 className={`text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2 ${textHead}`}>{stepBadge(3)} Configurar na {plat.name}</h3>
        <ol className={`space-y-2 text-xs ${textMuted} list-decimal list-inside`}>
          {plat.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>

      <ConversionUploadCard isDark={isDark} />

      <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
        <p className="text-xs font-bold text-amber-400 mb-2">⚠️ Antes de ativar</p>
        <ul className={`space-y-1 text-xs ${textMuted} list-disc list-inside`}>
          <li>A URL do anúncio precisa ter <code className="bg-slate-800 px-1 rounded text-indigo-300">utm_id={'{campaignid}'}</code> (ou o <code className="bg-slate-800 px-1 rounded text-indigo-300">gad_campaignid</code> automático do Google).</li>
          <li>A campanha precisa estar cadastrada no AutoMetrics com o mesmo ID do Google Ads.</li>
          <li>Vendas de cliques anteriores à instalação do script não são atribuídas.</li>
        </ul>
      </div>
    </div>
  );
}
