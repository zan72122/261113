/* Game Factory play logger. Local storage (log.html export) + best-effort anonymous send to gf-playlog Worker (2026-11-08). No UI, no cookies. */
(function () {
  'use strict';
  try {
    var key = 'gfpl1', match = location.pathname.match(/\/games\/([^/]+)\//);
    var id = match ? match[1] : document.title, now = Date.now;
    var last = now(), visible = document.visibilityState === 'visible';
    var seconds = 0, taps = 0, opening = true, dirty = false, sentAt = 0;
    var EP = 'https://gf-playlog.zan72122.workers.dev/log';
    function device() {
      try {
        var d = localStorage.getItem('gfpl1d');
        if (!d || !/^[A-Za-z0-9]{8,32}$/.test(d)) {
          d = ''; for (var i = 0; i < 16; i++) d += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36));
          localStorage.setItem('gfpl1d', d);
        }
        return d;
      } catch (ignore) { return ''; }
    }
    function send(force) {
      try {
        if (!dirty || (!force && now() - sentAt < 60000)) return;
        var data = JSON.parse(localStorage.getItem(key) || '{"g":{}}'), row = data && data.g && data.g[id], d = device();
        if (!row || !d) return;
        var site = (location.pathname.split('/')[1] || '').slice(0, 64);
        var body = JSON.stringify({d:d, p:site, r:[{g:String(id).slice(0, 64), o:row.o, l:row.l, n:row.n, s:row.s, t:row.t}]});
        var ok = false;
        if (navigator.sendBeacon) ok = navigator.sendBeacon(EP, new Blob([body], {type:'text/plain'}));
        if (!ok && window.fetch) fetch(EP, {method:'POST', body:body, keepalive:true, mode:'cors', credentials:'omit', headers:{'Content-Type':'text/plain'}}).catch(function () {});
        sentAt = now(); dirty = false;
      } catch (ignore) {}
    }
    function flush() {
      try {
        var at = now(), gap = Math.max(0, Math.min(10000, at - last));
        last = at;
        if (visible) seconds += gap / 1000;
        var data = JSON.parse(localStorage.getItem(key) || '{"g":{}}');
        if (!data || !data.g || typeof data.g !== 'object' || Array.isArray(data.g)) data = {g:{}};
        var g = data.g, own = Object.prototype.hasOwnProperty;
        var row = own.call(g, id) ? g[id] : null, epoch = Math.floor(at / 1000);
        if (!row || typeof row !== 'object') row = {o:epoch,l:epoch,n:0,s:0,t:0};
        row.s = (Number(row.s) || 0) + Math.floor(seconds);
        row.t = (Number(row.t) || 0) + taps;
        if (opening) { row.n = (Number(row.n) || 0) + 1; row.l = epoch; }
        Object.defineProperty(g, id, {value:row,enumerable:true,writable:true,configurable:true});
        var ids = Object.keys(g).sort(function (a, b) { return (g[b].l || 0) - (g[a].l || 0); });
        for (var i = 400; i < ids.length; i++) delete g[ids[i]];
        localStorage.setItem(key, JSON.stringify({g:g}));
        dirty = true; seconds -= Math.floor(seconds); taps = 0; opening = false;
      } catch (ignore) {}
    }
    function change() {
      try { flush(); visible = document.visibilityState === 'visible'; last = now(); if (!visible) send(true); } catch (ignore) {}
    }
    function tap() { try { taps++; } catch (ignore) {} }
    var opts = {capture:true,passive:true};
    if (window.PointerEvent) window.addEventListener('pointerdown', tap, opts);
    else {
      var touched = 0;
      window.addEventListener('touchstart', function () { try { touched = now(); tap(); } catch (ignore) {} }, opts);
      window.addEventListener('mousedown', function () { try { if (now() - touched > 800) tap(); } catch (ignore) {} }, opts);
    }
    document.addEventListener('visibilitychange', change, false);
    window.addEventListener('pagehide', function () { try { flush(); visible = false; send(true); } catch (ignore) {} }, false);
    window.addEventListener('pageshow', change, false);
    setInterval(function () { flush(); send(false); }, 5000);
    flush();
  } catch (ignore) {}
}());
