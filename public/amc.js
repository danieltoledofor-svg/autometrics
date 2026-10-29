/**
 * AutoMetrics — Checkout da BuyGoods (v1). Vai em BuyGoods → My profile → Funnel pixels → Checkout:
 *   <script src="https://autometrics.cloud/amc.js" data-uid="SEU_CODIGO" async></script>
 *
 * Roda na página do checkout (às vezes dentro de um iframe da BuyGoods) e avisa o
 * Autometrics que a pessoa chegou nele, com o que liga ao clique: os subids que o
 * am.js (ou a FlowTracking) pôs no link de compra, o gclid e a sessão da FlowTracking.
 * Procura na URL do checkout, na página que abriu o iframe e na página anterior.
 * O servidor acha a campanha como num postback e conta um checkout por clique.
 *
 * Não tira impressão digital do aparelho: só o que veio no link.
 * Mudou aqui, mudou em todos os checkouts: teste antes de publicar.
 */
(function () {
  try {
    var tag = document.currentScript || document.querySelector('script[src*="/amc.js"][data-uid]');
    var uid = tag && tag.getAttribute('data-uid');
    if (!uid || window.__amCheckout) return;
    window.__amCheckout = 1;
    var url = new URL(tag.src, location.href).origin + '/api/track-click/' + encodeURIComponent(uid) + '/checkout';
    var KEYS = ['subid', 'subid1', 'subid2', 'subid3', 'subid4', 'subid5', 'aff_sub', 'aff_sub2', 'aff_sub3', 'aff_sub4', 'aff_sub5', 'am_c', 'gclid', 'gbraid', 'wbraid', 'ft_sid'];
    var SESSION = /ftsession_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    var ids = [], seen = {}, gclid = '';
    function add(v) {
      v = String(v || '').trim();
      if (!v || v.length > 300 || /^\{.*\}$/.test(v) || seen[v]) return;
      seen[v] = 1; ids.push(v);
    }
    function scan(href) {
      try {
        if (!href) return;
        var s = new URL(href, location.href).searchParams;
        s.forEach(function (v, k) {
          var key = k.toLowerCase();
          if (KEYS.indexOf(key) < 0) return;
          if (key === 'ft_sid' && v.indexOf('ftsession_') !== 0) v = 'ftsession_' + v;
          if (key === 'gclid' && !gclid) gclid = v;
          add(v);
        });
      } catch (e) {}
    }
    function name(w) { try { var m = String(w.name || '').match(SESSION); if (m) add(m[0]); } catch (e) {} }
    scan(location.href);
    // Checkout dentro de um iframe: a página da BuyGoods em volta tem os subids (mesmo site, ou pelo referrer).
    try { if (window.parent !== window) scan(window.parent.location.href); } catch (e) {}
    try { if (window.top !== window) scan(window.top.location.href); } catch (e) {}
    scan(document.referrer);
    name(window);
    try { if (window.parent !== window) name(window.parent); } catch (e) {}
    try { if (window.top !== window) name(window.top); } catch (e) {}
    if (!ids.length) return;                                   // sem nada que ligue a um clique

    // A mesma pessoa recarregando o checkout: avisa uma vez por aba (o servidor também conta um por clique).
    var key = 'am_checkout_' + ids[0];
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) {}
    var body = JSON.stringify({ v: 1, ids: ids.slice(0, 8), gclid: gclid, u: location.origin + location.pathname });
    if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
    fetch(url, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
  } catch (e) {}
})();
