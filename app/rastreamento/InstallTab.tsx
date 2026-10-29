"use client";

import React, { useEffect, useState } from 'react';
import { Check, Clock, Copy, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { CLOCK_OPTIONS, clockOf, timeInClock } from '@/lib/tracking/platformClock';
import { ConversionUploadCard } from '@/app/integration/ConversionUploadCard';
import { UrlBuilder } from './UrlBuilder';

/**
 * Aba Instalação do Rastreamento (antes "Conversão Automática", na Integração):
 * o script das páginas, a URL de postback de cada plataforma de venda, o
 * relógio de cada plataforma e o envio das vendas ao Google.
 */
export function InstallTab({ isDark, userId }: { isDark: boolean; userId: string }) {
  const [convTracker, setConvTracker] = useState<'flowtracking'>('flowtracking');
  const [convPlatform, setConvPlatform] = useState<'buygoods' | 'clickbank' | 'digistore' | 'gurumedia' | 'jvzoo' | 'maxweb' | 'mediascalers' | 'smartadv'>('buygoods');
  const [copiedPostback, setCopiedPostback] = useState<string | null>(null);
  // Relógio de cada plataforma (lib/tracking/platformClock.ts): a venda entra no dia em que aconteceu nele.
  const [clocks, setClocks] = useState<Record<string, string>>({});
  const [clockNote, setClockNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!userId) return;
    supabase.from('user_settings').select('platform_clocks').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (data?.platform_clocks && typeof data.platform_clocks === 'object') setClocks(data.platform_clocks); });
  }, [userId]);
  const saveClock = async (platform: string, zone: string) => {
    const next = { ...clocks, [platform]: zone };
    setClocks(next);
    setClockNote(null);
    const { error } = await supabase.from('user_settings').upsert({ user_id: userId, platform_clocks: next }, { onConflict: 'user_id' });
    setClockNote(error
      ? { ok: false, text: 'Não foi possível salvar. Falta rodar o arquivo migration_relogio_plataformas.sql no Supabase.' }
      : { ok: true, text: 'Salvo. Vale para as próximas vendas.' });
  };
  const copyPostback = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPostback(key);
    setTimeout(() => setCopiedPostback(null), 2000);
  };
  const bgCard = 'bg-surface-1 border-line';
  const textHead = 'text-ink';
  const textMuted = 'text-ink-subtle';

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
    <>Cole a URL de venda do passo 2 e salve.</>,
  ];
  const saleNote = <>Esta URL recebe só a <strong>venda</strong>. O valor é a sua comissão.</>;
  const platforms = {
    buygoods: {
      name: 'BuyGoods',
      postback: pb('BuyGoods', 'event={CONV_TYPE}&cy=USD&amount={COMMISSION_AMOUNT}&orderid={ORDERID}&product={PRODUCT_CODENAME}&subid1={SUBID}&subid2={SUBID2}&subid3={SUBID3}&subid4={SUBID4}&subid5={SUBID5}'),
      note: <>A mesma URL recebe venda frontend e upsell — o <code className="px-1 rounded bg-surface-3 text-brand-text">{'{CONV_TYPE}'}</code> identifica o evento.</>,
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
        <>Cole a URL de venda do passo 2 e salve.</>,
      ],
    },
    clickbank: {
      name: 'ClickBank',
      postback: pb('ClickBank', 'event={event_type}&cy=USD&amount={affiliate_earnings}&orderid={receipt_id}&product={vendor}&subid1={aff_sub1}&subid2={tid}&subid3={extclid}&subid4={aff_sub2}&subid5={aff_sub3}'),
      note: <>A mesma URL recebe a compra e o upsell — o <code className="px-1 rounded bg-surface-3 text-brand-text">{'{event_type}'}</code> identifica o evento. O valor é a sua comissão, em dólar.</>,
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
      note: <>A Digistore avisa o tipo em <code className="px-1 rounded bg-surface-3 text-brand-text">{'{transaction_type}'}</code>: pagamento entra como venda; os outros avisos são ignorados.</>,
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
      postback: pb('JVZoo', 'event={transaction_type}&cy={currency}&amount={affiliate_amount}&orderid={transaction_id}&product={product_name}&subid1={tid}&subid2={sub_id1}&subid3={gclid}&subid4={sub_id2}&subid5={sub_id3}&utm_campaign={utm_campaign}&r={random}'),
      note: <>A JVZoo avisa o tipo em <code className="px-1 rounded bg-surface-3 text-brand-text">{'{transaction_type}'}</code>: <strong>SALE</strong> entra como venda e <strong>RFND</strong> como reembolso. O valor é a sua comissão.</>,
      details: [
        { label: 'event', value: '{transaction_type} (SALE / RFND)' },
        { label: 'subid1', value: '{tid} (clique)' },
        { label: 'subid3', value: '{gclid}' },
        { label: 'orderid', value: '{transaction_id}' },
        { label: 'amount', value: '{affiliate_amount}' },
      ],
      steps: [
        <>Na JVZoo, abra <strong>My Account → Account Details</strong>, desça até <strong>Affiliate Settings</strong> e clique em <strong>Manage S2S Postbacks</strong>.</>,
        <>Clique em <strong>Add New Postback</strong>, dê o nome <strong>Autometrics - Venda</strong> e escolha o tipo <strong>Purchase</strong>.</>,
        <>Cole a URL de venda do passo 2, deixe <strong>Active</strong> e <strong>All Products</strong>. Não marque <strong>Exclude refunded transactions</strong>: é por ele que o reembolso chega.</>,
        <>Salve. O ícone de registro (log) ao lado do postback mostra cada aviso que a JVZoo mandou e se deu certo.</>,
      ],
    },
    maxweb: {
      name: 'MaxWeb',
      postback: pb('MaxWeb', 'event={CONV_TYPE}&cy=USD&amount={COMMISSION_AMOUNT}&orderid={ORDERID}&product={PRODUCT_CODENAME}&subid1={SUBID}&subid2={SUBID2}&subid3={SUBID3}&subid4={SUBID4}&subid5={SUBID5}'),
      note: <>A mesma URL recebe venda frontend e upsell — o <code className="px-1 rounded bg-surface-3 text-brand-text">{'{CONV_TYPE}'}</code> identifica o evento.</>,
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
  // Checkout de cada plataforma. Onde ela avisa a chegada ao checkout por postback, uma URL
  // própria (event fixo); nas outras, o checkout é o clique no link de compra, que o script guarda.
  type CheckoutSetup = { postback: string; details: { label: string; value: string }[]; steps: React.ReactNode[] }
    | { snippet: string; steps: React.ReactNode[] } | { script: React.ReactNode };
  // BuyGoods: o checkout tem um campo próprio para script (Funnel pixels → Checkout); o public/amc.js avisa a chegada.
  const checkoutScript = `<script src="https://autometrics.cloud/amc.js" data-uid="${userId}" async></script>`;
  const scriptOnly = (name: string) => ({ script: <>A {name} não avisa o checkout por postback. O checkout é contado pelo <strong>script das páginas</strong>: cada pessoa que clica no link de compra (ou no botão do vídeo) entra como checkout da campanha do clique.</> });
  const checkouts: Record<keyof typeof platforms, CheckoutSetup> = {
    buygoods: {
      snippet: checkoutScript,
      steps: [
        <>Na BuyGoods, abra <strong>My profile → Funnel pixels</strong>.</>,
        <>No campo <strong>Checkout</strong>, <strong>mantenha</strong> o script da FlowTracking e cole o script acima numa linha nova, embaixo dele.</>,
        <>Salve. Os dois funcionam juntos: cada um avisa o seu sistema.</>,
      ],
    },
    clickbank: {
      postback: pb('ClickBank', 'event=checkout&subid1={aff_sub1}&subid3={extclid}&subid4={aff_sub2}&subid5={aff_sub3}'),
      details: [
        { label: 'event', value: 'checkout (fixo)' },
        { label: 'subid1', value: '{aff_sub1} (gclid)' },
        { label: 'subid3', value: '{extclid}' },
      ],
      steps: [
        <>Na ClickBank, abra <strong>Integrations → Postback/Pixels</strong> e clique em <strong>Add Integration</strong>.</>,
        <>Escolha <strong>Custom Postback/Pixel</strong>, o tipo <strong>S2S Postback</strong>, o papel <strong>Affiliate</strong> e o nível <strong>Global</strong>.</>,
        <>Em eventos, marque só <strong>Order Form Impression</strong> (a pessoa abriu a página do pedido).</>,
        <>Cole a URL de checkout acima e salve. A venda continua na integração do passo 3.</>,
      ],
    },
    digistore: scriptOnly('Digistore'),
    gurumedia: scriptOnly('Gurumedia'),
    jvzoo: {
      postback: pb('JVZoo', 'event=initiated&orderid={session_id}&subid1={tid}&subid2={sub_id1}&subid3={gclid}&subid4={sub_id2}&subid5={sub_id3}&utm_campaign={utm_campaign}&r={random}'),
      details: [
        { label: 'event', value: 'initiated (fixo)' },
        { label: 'orderid', value: '{session_id} (visita)' },
        { label: 'subid1', value: '{tid} (clique)' },
        { label: 'subid3', value: '{gclid}' },
      ],
      steps: [
        <>Em <strong>Manage S2S Postbacks</strong>, clique de novo em <strong>Add New Postback</strong>.</>,
        <>Dê o nome <strong>Autometrics - Checkout</strong> e escolha o tipo <strong>Initiated</strong> (dispara quando a pessoa chega na página do checkout).</>,
        <>Cole a URL de checkout acima, deixe <strong>Active</strong> e <strong>All Products</strong>, e salve.</>,
      ],
    },
    maxweb: scriptOnly('MaxWeb'),
    mediascalers: scriptOnly('MediaScalers'),
    smartadv: scriptOnly('SmartAdv'),
  };
  const plat = platforms[convPlatform];
  const checkout = checkouts[convPlatform];
  const stepBadge = (n: number) => (
    <span className="bg-brand w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white shrink-0">{n}</span>
  );
  const subTabClass = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? 'bg-surface-3 text-ink' : 'bg-surface-2 text-ink-subtle hover:text-ink'}`;
  const copyBtn = (text: string, key: string, label: string) => (
    <button onClick={() => copyPostback(text, key)}
      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${copiedPostback === key ? 'bg-pos text-white' : 'bg-surface-2 text-ink-subtle hover:text-ink'}`}>
      {copiedPostback === key ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copiedPostback === key ? 'Copiado!' : label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center gap-3 mb-1">
          <Zap size={20} aria-hidden="true" className="text-warn" />
          <h2 className={`text-base font-semibold ${textHead}`}>Conversão Automática</h2>
        </div>
        <p className={`text-sm ${textMuted} mb-5`}>
          Cada venda feita na plataforma entra automaticamente na campanha certa do AutoMetrics,
          funcionando <strong>junto</strong> com o seu tracker — nada do que ele já faz é alterado.
        </p>

        <p className={`text-xs font-medium mb-2 ${textMuted}`}>Tracker</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setConvTracker('flowtracking')} aria-pressed={convTracker === 'flowtracking'} className={subTabClass(convTracker === 'flowtracking')}>FlowTracking</button>
        </div>

        <p className={`text-xs font-medium mb-2 ${textMuted}`}>Plataforma de venda</p>
        <div className="flex flex-wrap gap-2">
          {platformKeys.map(k => (
            <button key={k} onClick={() => setConvPlatform(k)} aria-pressed={convPlatform === k} className={subTabClass(convPlatform === k)}>{platforms[k].name}</button>
          ))}
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-2 text-xs font-mono p-4 rounded-lg border bg-surface-2 border-line`}>
        <span className="bg-brand/15 text-brand-text px-2 py-1 rounded">Clique (gclid + ft_sid)</span>
        <span className={textMuted}>→ script liga à campanha →</span>
        <span className="bg-surface-3 text-ink-muted px-2 py-1 rounded">FlowTracking preenche os subids</span>
        <span className={textMuted}>→</span>
        <span className="bg-pos/10 text-pos px-2 py-1 rounded">{plat.name} dispara postback → venda na campanha</span>
      </div>

      {/* PASSO 1: SCRIPT */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className={`text-sm font-semibold flex items-center gap-2 ${textHead}`}>{stepBadge(1)} Script nas páginas do funil</h3>
          {copyBtn(flowScript, 'conv_flow_script', 'Copiar Script')}
        </div>
        <p className={`text-xs mb-3 ${textMuted}`}>
          Cole antes do <code className="px-1 rounded bg-surface-3 text-brand-text">&lt;/body&gt;</code> em <strong>todas as páginas antes do checkout</strong> (pré-lander e VSL),
          junto com o script da FlowTracking. Ele liga o <strong>gclid</strong> e a sessão da FlowTracking à campanha do clique.
        </p>
        <pre className={`rounded-lg p-4 text-[11px] font-mono overflow-x-auto leading-relaxed bg-surface-2 text-ink-muted`}>{flowScript}</pre>
      </div>

      {/* Endereço do anúncio, com os campos que o script lê */}
      <UrlBuilder isDark={isDark} />

      {/* PASSO 2: POSTBACK */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className={`text-sm font-semibold flex items-center gap-2 ${textHead}`}>{stepBadge(2)} Postback de venda na {plat.name}</h3>
          {copyBtn(plat.postback, `conv_pb_${convPlatform}`, 'Copiar URL')}
        </div>
        <p className={`text-xs mb-3 ${textMuted}`}>
          {plat.note}
        </p>
        <code className={`block text-[11px] font-mono break-all p-3 rounded border bg-surface-2 border-line ${textMuted}`}>{plat.postback}</code>
        <div className="flex flex-wrap gap-2 mt-3">
          {plat.details.map(d => (
            <span key={d.label} className={`text-[10px] px-2 py-0.5 rounded font-mono bg-surface-3 text-ink-subtle`}>
              <span className="text-brand-text">{d.label}</span>=<span className="text-ink">{d.value}</span>
            </span>
          ))}
        </div>
      </div>

      {/* PASSO 3: CONFIGURAR NA PLATAFORMA */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${textHead}`}>{stepBadge(3)} Configurar na {plat.name}</h3>
        <ol className={`space-y-2 text-xs ${textMuted} list-decimal list-inside`}>
          {plat.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>

      {/* PASSO 4: CHECKOUT */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className={`text-sm font-semibold flex items-center gap-2 ${textHead}`}>{stepBadge(4)} Checkout na {plat.name}</h3>
          {'postback' in checkout && copyBtn(checkout.postback, `conv_ck_${convPlatform}`, 'Copiar URL')}
          {'snippet' in checkout && copyBtn(checkout.snippet, `conv_ck_${convPlatform}`, 'Copiar Script')}
        </div>
        {'postback' in checkout ? (
          <>
            <p className={`text-xs mb-3 ${textMuted}`}>
              A {plat.name} avisa quando a pessoa chega no checkout. Cada clique conta <strong>um</strong> checkout, mesmo que a pessoa recarregue a página.
              Ele aparece na aba Checkouts e na coluna de checkouts da campanha.
            </p>
            <code className={`block text-[11px] font-mono break-all p-3 rounded border bg-surface-2 border-line ${textMuted}`}>{checkout.postback}</code>
            <div className="flex flex-wrap gap-2 mt-3 mb-4">
              {checkout.details.map(d => (
                <span key={d.label} className={`text-[10px] px-2 py-0.5 rounded font-mono bg-surface-3 text-ink-subtle`}>
                  <span className="text-brand-text">{d.label}</span>=<span className="text-ink">{d.value}</span>
                </span>
              ))}
            </div>
            <ol className={`space-y-2 text-xs ${textMuted} list-decimal list-inside`}>
              {checkout.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </>
        ) : 'snippet' in checkout ? (
          <>
            <p className={`text-xs mb-3 ${textMuted}`}>
              A {plat.name} roda este script na página do checkout. Ele avisa o AutoMetrics que a pessoa chegou lá, com o clique que veio no link de compra,
              e cada clique conta <strong>um</strong> checkout, mesmo que a pessoa recarregue a página. Não guarda nada do aparelho além disso.
            </p>
            <pre className={`rounded-lg p-4 text-[11px] font-mono overflow-x-auto leading-relaxed bg-surface-2 text-ink-muted mb-4`}>{checkout.snippet}</pre>
            <ol className={`space-y-2 text-xs ${textMuted} list-decimal list-inside`}>
              {checkout.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </>
        ) : (
          <p className={`text-xs ${textMuted}`}>{checkout.script}</p>
        )}
      </div>

      {/* RELÓGIO DA PLATAFORMA */}
      <div className={`rounded-xl p-6 border ${bgCard}`}>
        <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${textHead}`}><Clock size={16} aria-hidden="true" className="text-brand-text" /> Relógio da {plat.name}</h3>
        <p className={`text-xs mb-3 ${textMuted}`}>
          A venda entra no dia em que aconteceu no relógio da {plat.name}, para o dia do AutoMetrics fechar igual ao relatório dela.
          Uma venda perto da meia-noite pode cair num dia diferente do de Brasília.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={clockOf(convPlatform, clocks)} onChange={e => saveClock(convPlatform, e.target.value)} aria-label={`Relógio da ${plat.name}`}
            className={`text-xs font-medium rounded-lg px-3 py-2 border outline-none bg-surface-2 border-line text-ink focus:border-brand`}>
            {CLOCK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className={`text-xs ${textMuted}`}>Agora na {plat.name}: <strong className={textHead}>{timeInClock(clockOf(convPlatform, clocks))}</strong></span>
        </div>
        {clockNote && <p className={`text-xs mt-3 ${clockNote.ok ? 'text-pos' : 'text-neg'}`}>{clockNote.text}</p>}
      </div>

      <ConversionUploadCard isDark={isDark} />
    </div>
  );
}
