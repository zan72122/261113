/* main.js — boot. Classic script. */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  function log(tag, e) { if (window.console) console.error('[G:main:' + tag + ']', e); }
  function showFallback() {
    var fb = document.getElementById('fallback');
    if (fb) fb.style.display = 'block';
    var cv = document.getElementById('c');
    if (cv) cv.style.display = 'none';
  }
  function boot() {
    var canvas = document.getElementById('c');
    var ok = false;
    try { ok = !!(G.Engine && G.Engine.init(canvas)); } catch (e) { log('init', e); ok = false; }
    if (!ok) { showFallback(); return; }
    try { if (G.W && G.W.build) G.W.build(); } catch (e) { log('world', e); }
    try {
      var S = G.Scenes;
      if (S) {
        if (typeof S.register === 'function') S.register();
        else {
          if (typeof S.registerA === 'function') S.registerA();
          if (typeof S.registerB === 'function') S.registerB();
        }
      }
    } catch (e) { log('scenes', e); }
    try { if (G.Director && G.Director.has && G.Director.has('S0')) G.Director.go('S0'); } catch (e) { log('director', e); }
    G.Engine.start();
    var unlocked = 0;
    function unlock() {
      if (G.Audio && typeof G.Audio.unlock === 'function') { try { G.Audio.unlock(); } catch (e) { /* ignore */ } }
      if (++unlocked >= 2) {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('touchend', unlock, true);
        window.removeEventListener('pointerup', unlock, true);
      }
    }
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('pointerup', unlock, true);
    window.addEventListener('touchend', unlock, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
