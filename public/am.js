/**
 * AutoMetrics — Rastreamento (v4). O mesmo arquivo para todas as páginas:
 *   <script src="https://autometrics.cloud/am.js" data-uid="SEU_CODIGO" async></script>
 *
 * Guarda tudo o que vier na URL de entrada, lembra o clique no navegador para
 * as páginas seguintes, marca cada página visitada e a saída para o checkout.
 * Numa página sem a FlowTracking, leva o identificador no link de compra da
 * BuyGoods (inclusive no botão do player da VTurb); com ela na página, só lê.
 *
 * Mudou aqui, mudou em todas as páginas: teste antes de publicar.
 */
(function () {
  try {
    // O código do usuário vem da própria tag: <script src=".../am.js" data-uid="...">
    var tag = document.currentScript || document.querySelector('script[src*="/am.js"][data-uid]');
    var uid = tag && tag.getAttribute('data-uid');
    if (!uid || window.__amTracking) return;                      // sem código, ou script colado duas vezes
    window.__amTracking = 1;
    var url = new URL(tag.src, location.href).origin + '/api/track-click/' + uid;
    var KEY = 'am_click', now = Date.now();
    function read() {
      var o = {}, n = 0;
      new URLSearchParams(window.location.search).forEach(function (v, k) { if (v && n < 40) { o[k.slice(0, 40)] = String(v).slice(0, 300); n++; } });
      return o;
    }
    function send(o) {
      try {
        var b = JSON.stringify(o);
        if (navigator.sendBeacon && navigator.sendBeacon(url, b)) return;
        fetch(url, { method: 'POST', body: b, keepalive: true, mode: 'no-cors' });
      } catch (e) {}
    }
    // gclid: o do Google ou o que vem em ftgid=ftgid_{gclid}_ftgid
    function gclidOf(p) {
      var f = p.ftgid || '';
      return p.gclid || (f.indexOf('ftgid_') === 0 && f.slice(-6) === '_ftgid' && f.indexOf('{') < 0 ? f.slice(6, -6) : '');
    }
    var params = read();
    var clickId = gclidOf(params) || params.gbraid || params.wbraid || '';
    var hasCampaign = params.utm_id || params.gad_campaignid || params.utm_campaign || params.utm_source;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && now - saved.t > 30 * 864e5) saved = null;       // clique vale 30 dias
    var cur = null;
    if (clickId) cur = saved && saved.id === clickId ? saved : null;
    else if (saved && (!hasCampaign || now - saved.s < 30 * 6e4)) cur = saved; // página seguinte do mesmo clique
    if (!cur) {
      if (!clickId && !hasCampaign) return;                       // visita sem nenhum dado de campanha
      cur = { id: clickId || 'am_' + now.toString(36) + Math.random().toString(36).slice(2, 10), p: {}, t: now };
    }
    function merge(p) { var added = false; for (var k in p) if (!(k in cur.p)) { cur.p[k] = p[k]; added = true; } return added; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} }
    merge(params); cur.s = now; save();
    send({ v: 3, c: cur.id, p: cur.p, u: location.origin + location.pathname, r: document.referrer || '' });

    // ── Saída para o checkout ──────────────────────────────────────────────
    var HOSTS = ['buygoods', 'clickbank', 'digistore24', 'cartpanda', 'maxweb', 'hotmart', 'kiwify'];
    function platform(u) {
      try {
        var h = new URL(u, location.href).hostname.toLowerCase();
        for (var i = 0; i < HOSTS.length; i++) if (h.indexOf(HOSTS[i]) >= 0) return HOSTS[i];
      } catch (e) {}
      return '';
    }
    // Com a FlowTracking na página, é ela que escreve no link de compra.
    function other() { return !!document.querySelector('script[src*="flow-tracking"],script[src*="flowtracking"]'); }
    var sent = {};
    // Registra a saída (uma vez por destino), sem mexer no link.
    function note(u) {
      if (!platform(u)) return;
      var key = String(u).split('?')[0];
      if (!sent[key]) { sent[key] = 1; send({ v: 3, c: cur.id, p: cur.p, e: 'out', u: key }); }
    }
    function out(u) {
      var pf = platform(u), next = u;
      if (!pf) return u;
      if (pf === 'buygoods' && !other()) {
        try {
          var d = new URL(u, location.href), s = d.searchParams, g = gclidOf(cur.p);
          if (!s.get('subid') && !s.get('SUBID')) s.set('subid', cur.id);
          if (g && !s.get('subid2') && !s.get('SUBID2')) s.set('subid2', g);
          next = d.toString();
        } catch (e) {}
      }
      note(next);
      return next;
    }
    document.addEventListener('click', function (ev) {
      try {
        // composedPath alcança o link dentro do player (shadow DOM).
        var path = ev.composedPath ? ev.composedPath() : [ev.target], a = null;
        for (var i = 0; i < path.length && !a; i++) if (path[i] && path[i].tagName === 'A' && path[i].href) a = path[i];
        if (!a) return;
        var n = out(a.href);
        if (n !== a.href) a.href = n;
      } catch (e) {}
    }, true);
    // Saídas que não passam por um link clicado (botão do player, redirecionamento): só registra.
    try {
      if (window.navigation && window.navigation.addEventListener) {
        window.navigation.addEventListener('navigate', function (e) { try { if (e.destination && e.destination.url) note(e.destination.url); } catch (x) {} });
      }
      var open = window.open;
      window.open = function (u) { try { if (u) note(new URL(String(u), location.href).href); } catch (x) {} return open.apply(window, arguments); };
    } catch (e) {}
    // Botão dentro do player da VTurb: o player deixa ajustar o link antes de sair.
    var bound = [];
    function hook(el) {
      try {
        if (el.__am || other() || typeof el.injectUrlUpdater !== 'function') return;
        el.__am = 1;
        el.injectUrlUpdater(function (u) { try { return out(String(u || '')); } catch (e) { return u; } });
      } catch (e) {}
    }
    function bind() {
      var list = document.querySelectorAll('vturb-smartplayer');
      for (var i = 0; i < list.length; i++) (function (el) {
        hook(el);
        if (bound.indexOf(el) < 0) { bound.push(el); el.addEventListener('player:ready', function () { hook(el); }); }
      })(list[i]);
    }
    // Dados que aparecem na URL depois do carregamento (ex.: ft_sid) e players que entram depois.
    function late() {
      if (merge(read())) { save(); send({ v: 3, c: cur.id, p: cur.p, e: 'u' }); }
      bind();
    }
    bind();
    document.addEventListener('DOMContentLoaded', bind);
    setTimeout(late, 1500);
    setTimeout(late, 4000);
  } catch (e) {}
})();
