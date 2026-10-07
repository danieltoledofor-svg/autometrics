/**
 * AutoMetrics — Rastreamento (v5.2). O mesmo arquivo para todas as páginas:
 *   <script src="https://autometrics.cloud/am.js" data-uid="SEU_CODIGO" async></script>
 *
 * Guarda toda visita (com ou sem anúncio) e tudo o que vier na URL de entrada,
 * lembra o clique no navegador para as páginas seguintes, marca cada página
 * visitada, o tempo nela, até onde a pessoa rolou e a saída para o checkout.
 * O identificador do clique também viaja nos links entre as páginas do mesmo
 * site (am_c), para a visita não se perder onde o navegador não guarda nada
 * (link de compra na página ou botão do player da VTurb, inclusive quando ele
 * leva ao site do produtor). Numa página sem a FlowTracking, leva o
 * identificador no link de compra da BuyGoods; com ela na página, só lê.
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
    // gclid: o do Google, o do Autometrics (amclid=am_{gclid}_am) ou o da FlowTracking (ftgid=ftgid_{gclid}_ftgid)
    function gclidOf(p) {
      var f = p.ftgid || '', a = p.amclid || '';
      return p.gclid || (a.length > 6 && a.indexOf('am_') === 0 && a.slice(-3) === '_am' && a.indexOf('{') < 0 ? a.slice(3, -3) : '')
        || (f.indexOf('ftgid_') === 0 && f.slice(-6) === '_ftgid' && f.indexOf('{') < 0 ? f.slice(6, -6) : '');
    }
    var params = read();
    // Identificador trazido pelo link da página anterior: não é dado de anúncio.
    var carried = /^[\w.-]{6,200}$/.test(params.am_c || '') ? params.am_c : '';
    delete params.am_c;
    var clickId = gclidOf(params) || params.gbraid || params.wbraid || '';
    var hasCampaign = params.utm_id || params.gad_campaignid || params.utm_campaign || params.utm_source;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && now - saved.t > 30 * 864e5) saved = null;       // clique vale 30 dias
    if (saved && !saved.k && now - saved.s > 30 * 6e4) saved = null; // visita sem anúncio: 30 minutos parada e vira outra
    var cur = null;
    if (clickId) cur = saved && saved.id === clickId ? saved : null;
    else if (carried) cur = saved && saved.id === carried ? saved : { id: carried, p: {}, t: now, k: 1 };
    else if (saved && (!hasCampaign || now - saved.s < 30 * 6e4)) cur = saved; // página seguinte do mesmo clique
    if (!cur) cur = { id: clickId || 'am_' + now.toString(36) + Math.random().toString(36).slice(2, 10), p: {}, t: now, k: clickId || hasCampaign ? 1 : 0 };
    function merge(p) { var added = false; for (var k in p) if (!(k in cur.p)) { cur.p[k] = p[k]; added = true; } return added; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} }
    merge(params); cur.s = now; save();
    var here = location.origin + location.pathname, view = '', lang = '';
    try { view = screen.width + 'x' + screen.height; lang = navigator.language || ''; } catch (e) {}
    send({ v: 3, c: cur.id, p: cur.p, u: here, r: document.referrer || '', s: view, l: lang });

    // ── Tempo na página e rolagem: enviados quando a pessoa sai ou troca de aba ──
    var since = document.visibilityState === 'hidden' ? 0 : now, active = 0, deep = 0, told = 0;
    function depth() {
      try {
        var d = document.documentElement, total = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0);
        var pct = total > 0 ? Math.round(((window.pageYOffset || d.scrollTop || 0) + window.innerHeight) / total * 100) : 0;
        if (pct > deep) deep = Math.min(100, pct);
      } catch (e) {}
    }
    function tell() {
      if (since) { active += Date.now() - since; since = 0; }
      var sec = Math.round(active / 1000);
      active -= sec * 1000;
      if (sec > 0 || deep > told) { told = deep; send({ v: 3, c: cur.id, e: 't', u: here, t: sec, s: deep }); }
    }
    try {
      window.addEventListener('scroll', depth, { passive: true });
      depth();
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') tell(); else if (!since) since = Date.now(); });
      window.addEventListener('pagehide', tell);
    } catch (e) {}

    // ── Saída para o checkout ──────────────────────────────────────────────
    var HOSTS = ['buygoods', 'clickbank', 'digistore24', 'cartpanda', 'maxweb', 'hotmart', 'kiwify'];
    var AFF = ['aff_id', 'affid', 'aff', 'affiliate', 'hop', 'a_aid'];
    var cta = {};                                                 // destinos dos botões do player
    function bare(u) { try { var d = new URL(u, location.href); return d.origin + d.pathname; } catch (e) { return ''; } }
    // Link de compra: plataforma conhecida, link de afiliado no site do produtor
    // (ex.: produtor.com/bg/?aff_id=…) ou destino de um botão do player.
    function platform(u) {
      try {
        var d = new URL(u, location.href), h = d.hostname.toLowerCase(), i;
        if (d.protocol.indexOf('http') !== 0 || h === location.hostname) return '';
        for (i = 0; i < HOSTS.length; i++) if (h.indexOf(HOSTS[i]) >= 0) return HOSTS[i];
        if (d.searchParams.get('aff_id')) return 'buygoods';
        for (i = 0; i < AFF.length; i++) if (d.searchParams.get(AFF[i])) return 'link';
        if (cta[d.origin + d.pathname]) return 'link';
      } catch (e) {}
      return '';
    }
    function other() { return !!document.querySelector('script[src*="flow-tracking"],script[src*="flowtracking"]'); }
    var sent = {};
    function note(u) {
      if (!platform(u)) return;
      var key = bare(u);
      if (!sent[key]) { sent[key] = 1; send({ v: 3, c: cur.id, p: cur.p, e: 'out', u: key }); }
    }
    // Leva o identificador no link de compra; com a FlowTracking na página, não mexe.
    function stamp(u) {
      if (platform(u) !== 'buygoods' || other()) return u;
      try {
        var d = new URL(u, location.href), s = d.searchParams, g = gclidOf(cur.p);
        if (!s.get('subid') && !s.get('SUBID')) s.set('subid', cur.id);
        if (g && !s.get('subid2') && !s.get('SUBID2')) s.set('subid2', g);
        return d.toString();
      } catch (e) {}
      return u;
    }
    // Link para outra página do mesmo site: leva o identificador do clique.
    function carry(u) {
      try {
        var d = new URL(u, location.href);
        if (d.protocol.indexOf('http') !== 0 || d.hostname !== location.hostname) return u;
        if (d.pathname === location.pathname && d.search === location.search) return u;   // âncora na mesma página
        if (d.searchParams.get('am_c') === cur.id) return u;
        d.searchParams.set('am_c', cur.id);
        return d.toString();
      } catch (e) {}
      return u;
    }
    var last = '', playerClick = 0;
    document.addEventListener('click', function (ev) {
      try {
        var path = ev.composedPath ? ev.composedPath() : [ev.target], a = null, inPlayer = false;
        for (var i = 0; i < path.length; i++) {
          var el = path[i], name = el && el.tagName;
          if (!a && name === 'A' && el.href) a = el;
          if (name && name.indexOf('VTURB-') === 0) inPlayer = true;
        }
        if (a) {
          var n = stamp(carry(a.href));
          if (n !== a.href) a.href = n;
          note(n);
        } else if (inPlayer) playerClick = Date.now();           // botão dentro do vídeo: o link fica escondido
      } catch (e) {}
    }, true);
    // Saídas que não passam por um link visível (botão dentro do vídeo, redirecionamento): só registra.
    try {
      if (window.navigation && window.navigation.addEventListener) {
        window.navigation.addEventListener('navigate', function (e) { try { if (e.destination && e.destination.url) note(e.destination.url); } catch (x) {} });
      }
      var open = window.open;
      window.open = function (u) { try { if (u) note(new URL(String(u), location.href).href); } catch (x) {} return open.apply(window, arguments); };
      // Navegador sem aviso de navegação: saiu da página logo depois de tocar no player.
      var leave = function () { if (last && Date.now() - playerClick < 3000) note(last); };
      window.addEventListener('pagehide', leave);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
    } catch (e) {}
    // Botões do player da VTurb: o player mostra o link antes de usar, e deixa ajustar.
    var bound = [];
    function hook(el) {
      try {
        if (el.__am || typeof el.injectUrlUpdater !== 'function') return;
        el.__am = 1;
        el.injectUrlUpdater(function (u) {
          try {
            var d = new URL(String(u || ''), location.href);
            if (d.protocol.indexOf('http') !== 0) return u;
            if (d.hostname === location.hostname) return carry(d.href);
            cta[d.origin + d.pathname] = 1; last = d.href;
            return stamp(d.href);
          } catch (e) { return u; }
        });
      } catch (e) {}
    }
    function bind() {
      var list = document.querySelectorAll('vturb-smartplayer');
      for (var i = 0; i < list.length; i++) (function (el) {
        hook(el);
        if (bound.indexOf(el) < 0) { bound.push(el); el.addEventListener('player:ready', function () { hook(el); }); }
      })(list[i]);
    }
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
