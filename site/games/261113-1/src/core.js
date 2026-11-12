/* core.js — エンジン土台（描画・ループ・入力・カメラ・ヒント・小道具）
   公開 API（契約 §2 §6）:
     G.boot(startFn)
     G.scene, G.camera, G.renderer, G.canvas, G.time
     G.onUpdate(fn(dt,time)) / G.onResize(fn(w,h,aspect)) / G.quality / G.onQuality(fn(quality))
     G.util: clamp lerp smooth damp rand easeOutBack easeOutCubic easeInOutCubic
     G.Spring({x,k,c}) → .x .v .target .step(dt) .kick(v)
     G.tween(sec, fn(k), {ease,onDone}) → {cancel()} / G.after(sec, fn) → {cancel()}
     G.assets.tex(name, {repeat,mirror,srgb,aniso}) / G.assets.has(name)
     G.input.on('down'|'move'|'up', fn(p))
     G.screenRay(nx,ny) / G.toScreen(vec3,out)
     G.cam.setView(view,opts) / solve(view) / pointIn(view,nx,ny,dist) / shake(amount) / G.cam.view
     G.fx.flash(cssColor, peak, inSec, outSec, atPeak)
     G.hint.set(opts) / G.hint.clear()
     G.save.get(key,def) / G.save.set(key,value)
     G.dbg.stats() → {fps,pixelRatio,low,calls,tris}
*/
(function () {
  'use strict';
  var G = (window.G = window.G || {});

  // ---------- エラーは同じものを 1 回だけ ----------
  var errSeen = {};
  function report(tag, e) {
    var k = tag + '|' + (e && e.message ? e.message : String(e));
    if (errSeen[k]) return;
    errSeen[k] = 1;
    try { console.error('[core:' + tag + ']', e); } catch (_) {}
  }

  // ---------- util ----------
  var U = {
    clamp: function (x, a, b) { return x < a ? a : x > b ? b : x; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smooth: function (t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); },
    damp: function (cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    easeOutBack: function (t) { var c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; },
    easeOutCubic: function (t) { var u = 1 - t; return 1 - u * u * u; },
    easeInOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  };
  G.util = U;
  function easeOf(e) {
    if (typeof e === 'function') return e;
    if (typeof e === 'string' && typeof U[e] === 'function') return U[e];
    return U.easeInOutCubic;
  }
  function seg(t, a, b) { return U.clamp((t - a) / (b - a), 0, 1); }

  // ---------- Spring ----------
  function Spring(o) {
    o = o || {};
    this.x = o.x != null ? o.x : 0;
    this.v = o.v != null ? o.v : 0;
    this.target = o.target != null ? o.target : this.x;
    this.k = o.k != null ? o.k : 120;
    this.c = o.c != null ? o.c : 14;
  }
  Spring.prototype.step = function (dt) {
    var n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  };
  Spring.prototype.kick = function (v) { this.v += v; return this; };
  G.Spring = Spring;

  // ---------- tween / after（ゲーム内時間） ----------
  var tasks = [];
  G.tween = function (sec, fn, opts) {
    opts = opts || {};
    var o = { kind: 0, t: 0, sec: sec || 0, fn: fn, ease: easeOf(opts.ease), onDone: opts.onDone, dead: false };
    tasks.push(o);
    return { cancel: function () { o.dead = true; } };
  };
  G.after = function (sec, fn) {
    var o = { kind: 1, t: 0, sec: sec || 0, fn: fn, dead: false };
    tasks.push(o);
    return { cancel: function () { o.dead = true; } };
  };
  function runTasks(dt) {
    var n = tasks.length, anyDead = false;
    for (var i = 0; i < n; i++) {
      var o = tasks[i];
      if (o.dead) { anyDead = true; continue; }
      o.t += dt;
      if (o.kind === 0) {
        var k = o.sec > 0 ? Math.min(1, o.t / o.sec) : 1;
        if (o.fn) { try { o.fn(o.ease(k)); } catch (e) { report('tween', e); } }
        if (k >= 1 && !o.dead) {
          o.dead = true;
          if (o.onDone) { try { o.onDone(); } catch (e) { report('tween.onDone', e); } }
        }
      } else if (o.t >= o.sec) {
        o.dead = true;
        try { o.fn && o.fn(); } catch (e) { report('after', e); }
      }
      if (o.dead) anyDead = true;
    }
    if (anyDead) {
      var j = 0;
      for (var m = 0; m < tasks.length; m++) if (!tasks[m].dead) tasks[j++] = tasks[m];
      tasks.length = j;
    }
  }

  // ---------- save ----------
  var SAVE_KEY = 'gf-261113-1', saveMem = null;
  function saveLoad() {
    if (saveMem) return saveMem;
    saveMem = {};
    try {
      var s = window.localStorage.getItem(SAVE_KEY);
      if (s) {
        var o = JSON.parse(s);
        if (o && typeof o === 'object' && !Array.isArray(o)) saveMem = o;
        else window.localStorage.removeItem(SAVE_KEY);
      }
    } catch (e) {
      saveMem = {};
      try { window.localStorage.removeItem(SAVE_KEY); } catch (_) {}
    }
    return saveMem;
  }
  G.save = {
    get: function (key, def) {
      var m = saveLoad();
      return Object.prototype.hasOwnProperty.call(m, key) ? m[key] : def;
    },
    set: function (key, value) {
      var m = saveLoad();
      m[key] = value;
      try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(m)); } catch (e) {}
    }
  };

  // ---------- 状態 ----------
  var booted = false, renderer = null, scene = null, camera = null, canvas = null;
  var vw = 1, vh = 1, rect = { left: 0, top: 0 };
  var basePR = 1, curPR = 1;
  var updFns = [], resizeFns = [], qualityFns = [];
  G.time = 0;
  G.quality = { low: false, shadowSize: 2048, maxParticles: 300 };

  G.onUpdate = function (fn) { if (typeof fn === 'function') updFns.push(fn); };
  G.onResize = function (fn) {
    if (typeof fn !== 'function') return;
    resizeFns.push(fn);
    if (booted) { try { fn(vw, vh, vw / vh); } catch (e) { report('onResize', e); } }
  };
  G.onQuality = function (fn) { if (typeof fn === 'function') qualityFns.push(fn); };

  // ---------- 数学の使い回し（THREE が無い環境でも読み込みで落ちないよう遅延生成） ----------
  var M = null;
  function math() {
    if (M) return M;
    var T = window.THREE;
    M = {
      v1: new T.Vector3(), v2: new T.Vector3(), v3: new T.Vector3(),
      right: new T.Vector3(), up: new T.Vector3(),
      ray: new T.Raycaster(), ndc: new T.Vector2(),
      cur: { pos: new T.Vector3(0, 1.2, 3), look: new T.Vector3(0, 1, 0), fov: 55 },
      from: { pos: new T.Vector3(), look: new T.Vector3(), fov: 55 },
      to: { pos: new T.Vector3(0, 1.2, 3), look: new T.Vector3(0, 1, 0), fov: 55 },
      shakeOff: new T.Vector3(),
      tmpCam: new T.PerspectiveCamera(50, 1, 0.05, 400)
    };
    return M;
  }

  // ---------- カメラ ----------
  var camMove = { on: false, t: 0, sec: 1, ease: U.easeInOutCubic, onDone: null };
  var shakeAmp = 0, shakeT = 0;
  function fovFor(view, a) {
    var p = view.fovP != null ? view.fovP : 64, l = view.fovL != null ? view.fovL : 46;
    return U.lerp(p, l, U.smooth((a - 0.6) / 1.0));
  }
  function solveInto(view, pos, look) {
    var a = vw / vh;
    var fov = fovFor(view, a);
    var t = Math.tan(fov * Math.PI / 360);
    var w = view.w || 1, h = view.h || 1;
    var d = Math.max(h / 2 / t, w / 2 / (t * a));
    var L = view.look || [0, 1, 0], D = view.dir || [0, 0, 1];
    look.set(L[0], L[1], L[2]);
    pos.set(D[0], D[1], D[2]);
    if (pos.lengthSq() < 1e-12) pos.set(0, 0, 1);
    pos.normalize().multiplyScalar(d).add(look);
    return fov;
  }
  var cam = {
    view: null,
    solve: function (view) {
      var T = window.THREE;
      var pos = new T.Vector3(), look = new T.Vector3();
      var fov = solveInto(view, pos, look);
      return { pos: pos, look: look, fov: fov };
    },
    setView: function (view, opts) {
      if (!view) return;
      opts = opts || {};
      var m = math();
      cam.view = view;
      m.to.fov = solveInto(view, m.to.pos, m.to.look);
      var sec = opts.sec != null ? opts.sec : 1.2;
      if (sec <= 0) {
        camMove.on = false;
        m.cur.pos.copy(m.to.pos); m.cur.look.copy(m.to.look); m.cur.fov = m.to.fov;
        if (opts.onDone) { try { opts.onDone(); } catch (e) { report('setView.onDone', e); } }
        return;
      }
      // 今の値（補間途中でも）から続ける
      m.from.pos.copy(m.cur.pos); m.from.look.copy(m.cur.look); m.from.fov = m.cur.fov;
      camMove.on = true; camMove.t = 0; camMove.sec = sec;
      camMove.ease = easeOf(opts.ease); camMove.onDone = opts.onDone || null;
    },
    pointIn: function (view, nx, ny, dist) {
      var T = window.THREE, m = math();
      var pos = new T.Vector3(), look = new T.Vector3();
      var tc = m.tmpCam;
      tc.fov = solveInto(view, pos, look);
      tc.aspect = vw / vh;
      tc.position.copy(pos);
      tc.lookAt(look);
      tc.updateProjectionMatrix();
      tc.updateMatrixWorld(true);
      var v = new T.Vector3(nx, ny, 0.5).unproject(tc);
      return v.sub(pos).normalize().multiplyScalar(dist).add(pos);
    },
    shake: function (amount) {
      amount = U.clamp(amount || 0, 0, 1);
      if (amount > shakeAmp) shakeAmp = amount;
    }
  };
  G.cam = cam;
  function camUpdate(dt) {
    var m = math();
    if (camMove.on) {
      camMove.t += dt;
      var k = Math.min(1, camMove.t / camMove.sec), e = camMove.ease(k);
      m.cur.pos.lerpVectors(m.from.pos, m.to.pos, e);
      m.cur.look.lerpVectors(m.from.look, m.to.look, e);
      m.cur.fov = U.lerp(m.from.fov, m.to.fov, e);
      if (k >= 1) {
        camMove.on = false;
        var cb = camMove.onDone; camMove.onDone = null;
        if (cb) { try { cb(); } catch (er) { report('setView.onDone', er); } }
      }
    } else if (cam.view) {
      m.cur.pos.copy(m.to.pos); m.cur.look.copy(m.to.look); m.cur.fov = m.to.fov;
    }
    // 揺れ（最大 1.5cm、減衰）
    shakeT += dt;
    shakeAmp *= Math.exp(-dt * 5);
    if (shakeAmp < 1e-4) shakeAmp = 0;
    var a = shakeAmp * 0.015;
    m.shakeOff.set(
      a * (Math.sin(shakeT * 47.3) * 0.6 + Math.sin(shakeT * 83.1) * 0.4),
      a * (Math.sin(shakeT * 59.7 + 1.3) * 0.6 + Math.sin(shakeT * 91.9) * 0.4),
      a * 0.5 * Math.sin(shakeT * 67.1 + 2.1)
    );
    camera.position.copy(m.cur.pos).add(m.shakeOff);
    camera.lookAt(m.cur.look);
    camera.fov = m.cur.fov;
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  // ---------- screenRay / toScreen ----------
  G.screenRay = function (nx, ny) {
    var m = math();
    m.ndc.set(nx, ny);
    if (camera) m.ray.setFromCamera(m.ndc, camera);
    return m.ray.ray;
  };
  G.toScreen = function (v, out) {
    out = out || {};
    var m = math();
    if (!camera) { out.x = 0; out.y = 0; out.behind = true; return out; }
    m.v3.copy(v).applyMatrix4(camera.matrixWorldInverse);
    out.behind = m.v3.z > 0;
    m.v3.copy(v).project(camera);
    out.x = (m.v3.x + 1) * 0.5 * vw;
    out.y = (1 - m.v3.y) * 0.5 * vh;
    return out;
  };

  // ---------- assets ----------
  var texCache = {};
  function assetSrc(name) { var A = window.G_ASSETS; return A && typeof A[name] === 'string' && A[name] ? A[name] : null; }
  G.assets = {
    has: function (name) { return !!assetSrc(name); },
    tex: function (name, opts) {
      opts = opts || {};
      var T = window.THREE;
      var rep = opts.repeat || [1, 1];
      var mirror = opts.mirror !== false, srgb = opts.srgb !== false, aniso = !!opts.aniso;
      var key = name + '|' + rep[0] + ',' + rep[1] + '|' + (mirror ? 1 : 0) + (srgb ? 1 : 0) + (aniso ? 1 : 0);
      if (texCache[key]) return texCache[key];
      var src = assetSrc(name), tex;
      if (!src) {
        tex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
        tex.needsUpdate = true;
      } else {
        tex = new T.TextureLoader().load(src);
        tex.wrapS = tex.wrapT = mirror ? T.MirroredRepeatWrapping : T.RepeatWrapping;
        tex.repeat.set(rep[0], rep[1]);
        if (srgb) tex.encoding = T.sRGBEncoding;
        if (aniso && renderer) tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      texCache[key] = tex;
      return tex;
    }
  };

  // ---------- fx.flash ----------
  var fxEl = null, fxS = { on: false, phase: 0, t: 0, o0: 0, cur: 0, peak: 1, inSec: 0, outSec: 0, atPeak: null };
  G.fx = {
    flash: function (cssColor, peak, inSec, outSec, atPeak) {
      fxEl = fxEl || document.getElementById('fx');
      if (fxEl && cssColor) fxEl.style.background = cssColor;
      fxS.on = true; fxS.phase = 0; fxS.t = 0; fxS.o0 = fxS.cur;
      fxS.peak = peak != null ? U.clamp(peak, 0, 1) : 1;
      fxS.inSec = Math.max(0, inSec || 0); fxS.outSec = Math.max(0, outSec || 0);
      fxS.atPeak = atPeak || null;
    }
  };
  function fxUpdate(dt) {
    if (!fxS.on) return;
    fxS.t += dt;
    if (fxS.phase === 0) {
      var k = fxS.inSec > 0 ? Math.min(1, fxS.t / fxS.inSec) : 1;
      fxS.cur = U.lerp(fxS.o0, fxS.peak, U.easeOutCubic(k));
      if (k >= 1) {
        fxS.phase = 1; fxS.t = 0;
        var cb = fxS.atPeak; fxS.atPeak = null;
        if (cb) { try { cb(); } catch (e) { report('flash.atPeak', e); } }
      }
    } else {
      var k2 = fxS.outSec > 0 ? Math.min(1, fxS.t / fxS.outSec) : 1;
      fxS.cur = fxS.peak * (1 - U.easeInOutCubic(k2));
      if (k2 >= 1) { fxS.on = false; fxS.cur = 0; }
    }
    if (fxEl) fxEl.style.opacity = String(Math.round(fxS.cur * 1000) / 1000);
  }

  // ---------- 入力（最初の 1 本だけ） ----------
  var inFns = { down: [], move: [], up: [] };
  var ptr = { id: null, sx: 0, sy: 0, x: 0, y: 0, lx: 0, ly: 0, lt: 0, t0: 0, vx: 0, vy: 0, moved: false };
  G.input = {
    on: function (type, fn) { if (inFns[type] && typeof fn === 'function') inFns[type].push(fn); }
  };
  function nowS() { return (window.performance && performance.now ? performance.now() : Date.now()) / 1000; }
  function mkP() {
    return {
      x: ptr.x, y: ptr.y,
      nx: (ptr.x / vw) * 2 - 1, ny: -((ptr.y / vh) * 2 - 1),
      dx: ptr.x - ptr.sx, dy: ptr.y - ptr.sy,
      vx: ptr.vx, vy: ptr.vy, moved: ptr.moved, time: nowS() - ptr.t0
    };
  }
  function emit(type) {
    var p = mkP(), a = inFns[type];
    for (var i = 0; i < a.length; i++) { try { a[i](p); } catch (e) { report('input.' + type, e); } }
  }
  function setPos(e) {
    ptr.x = e.clientX - rect.left;
    ptr.y = e.clientY - rect.top;
  }
  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    if (ptr.id !== null) return;                 // 2 本目以降は無視
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptr.id = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    setPos(e);
    ptr.sx = ptr.lx = ptr.x; ptr.sy = ptr.ly = ptr.y;
    ptr.t0 = ptr.lt = nowS(); ptr.vx = ptr.vy = 0; ptr.moved = false;
    try { if (G.audio && G.audio.unlock) G.audio.unlock(); } catch (er) { report('audio.unlock', er); }
    hintTouch();
    emit('down');
  }
  function onMove(e) {
    if (ptr.id === null || e.pointerId !== ptr.id) return;
    if (e.cancelable) e.preventDefault();
    setPos(e);
    var t = nowS(), d = t - ptr.lt;
    if (d > 0.001) {
      var w = U.clamp(d / 0.05, 0.2, 1);
      ptr.vx = U.lerp(ptr.vx, (ptr.x - ptr.lx) / d, w);
      ptr.vy = U.lerp(ptr.vy, (ptr.y - ptr.ly) / d, w);
      ptr.lx = ptr.x; ptr.ly = ptr.y; ptr.lt = t;
    }
    if (!ptr.moved) {
      var dx = ptr.x - ptr.sx, dy = ptr.y - ptr.sy;
      if (dx * dx + dy * dy > 64) ptr.moved = true;
    }
    emit('move');
  }
  function endPtr(e) {
    if (ptr.id === null) return;
    if (e && e.pointerId != null && e.pointerId !== ptr.id) return;
    if (e && e.clientX != null && e.type === 'pointerup') setPos(e);
    var id = ptr.id;
    ptr.id = null;
    if (nowS() - ptr.lt > 0.08) { ptr.vx = 0; ptr.vy = 0; }
    try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (_) {}
    emit('up');
  }
  function bindInput() {
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', endPtr, { passive: false });
    canvas.addEventListener('pointercancel', endPtr, { passive: false });
    canvas.addEventListener('lostpointercapture', endPtr, { passive: false });
    window.addEventListener('blur', function () { endPtr(null); });
    var stop = function (e) { if (e.cancelable) e.preventDefault(); };
    ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'contextmenu', 'selectstart', 'dblclick'].forEach(function (n) {
      document.addEventListener(n, stop, { passive: false });
    });
  }

  // ---------- サイズ・動的解像度 ----------
  function readSize() {
    var vv = window.visualViewport;
    var w = vv && vv.width ? vv.width : window.innerWidth;
    var h = vv && vv.height ? vv.height : window.innerHeight;
    return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
  }
  function applySize(force) {
    var s = readSize();
    if (!force && s[0] === vw && s[1] === vh) return;
    vw = s[0]; vh = s[1];
    renderer.setPixelRatio(curPR);
    renderer.setSize(vw, vh, true);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    try { var r = canvas.getBoundingClientRect(); rect = { left: r.left, top: r.top }; } catch (_) {}
    if (cam.view) { var m = math(); m.to.fov = solveInto(cam.view, m.to.pos, m.to.look); }
    for (var i = 0; i < resizeFns.length; i++) {
      try { resizeFns[i](vw, vh, vw / vh); } catch (e) { report('onResize', e); }
    }
  }
  var perf = { acc: 0, n: 0, warm: 3, slow: 0, fast: 0, needFast: 8, avg: 1 / 60 };
  function perfSample(raw) {
    var d = Math.min(raw, 0.2);
    perf.avg = perf.avg * 0.95 + d * 0.05;
    if (perf.warm > 0) { perf.warm -= raw; return; }
    perf.acc += d; perf.n++;
    if (perf.acc < 1) return;
    var avg = perf.acc / perf.n;
    perf.acc = 0; perf.n = 0;
    var minPR = Math.min(1, basePR);   // これ以上は下げない（ぼやけすぎ防止）
    if (avg > 0.040) {
      perf.fast = 0;
      if (++perf.slow >= 2) {
        perf.slow = 0; perf.warm = 1.5;
        if (curPR > minPR + 1e-3) {
          curPR = Math.max(minPR, curPR - 0.25);
          perf.needFast = Math.min(64, perf.needFast * 2);  // 戻しにくくしてばたつき防止
          applySize(true);
        } else if (!G.quality.low) {
          G.quality.low = true; G.quality.shadowSize = 1024; G.quality.maxParticles = 140;
          for (var i = 0; i < qualityFns.length; i++) {
            try { qualityFns[i](G.quality); } catch (e) { report('onQuality', e); }
          }
        }
      }
    } else {
      perf.slow = 0;
      if (avg < 0.024 && curPR < basePR - 1e-3) {
        if (++perf.fast >= perf.needFast) {
          perf.fast = 0; perf.warm = 1.5;
          curPR = Math.min(basePR, curPR + 0.25);
          applySize(true);
        }
      } else perf.fast = 0;
    }
  }

  // ---------- ループ・可視性 ----------
  var rafId = 0, running = false, lastNow = -1, hidden = false, lost = false;
  function frame(now) {
    rafId = 0;
    if (!running || hidden) return;
    rafId = requestAnimationFrame(frame);
    if (lost) { lastNow = -1; return; }
    var raw = lastNow < 0 ? 0 : (now - lastNow) / 1000;
    lastNow = now;
    if (raw > 0) perfSample(raw);
    var dt = Math.min(0.05, Math.max(0, raw));
    G.time += dt;
    applySize(false);
    runTasks(dt);
    for (var i = 0; i < updFns.length; i++) {
      try { updFns[i](dt, G.time); } catch (e) { report('onUpdate#' + i, e); }
    }
    camUpdate(dt);
    hintUpdate(dt);
    fxUpdate(dt);
    try { renderer.render(scene, camera); } catch (e) { report('render', e); }
  }
  function startLoop() {
    if (!running || hidden || rafId) return;
    lastNow = -1;                                 // dt を持ち越さない
    rafId = requestAnimationFrame(frame);
  }
  function setHidden(h) {
    if (h === hidden) return;
    hidden = h;
    if (h) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      endPtr(null);
      try { if (G.audio && G.audio.suspend) G.audio.suspend(); } catch (e) { report('audio.suspend', e); }
    } else {
      try { if (G.audio && G.audio.resume) G.audio.resume(); } catch (e) { report('audio.resume', e); }
      perf.warm = Math.max(perf.warm, 1.5); perf.acc = 0; perf.n = 0;
      startLoop();
    }
  }

  // ---------- 代替画面 ----------
  function showFallback() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    var src = assetSrc('fallback');
    if (!src) return;
    var img = document.getElementById('fallback');
    if (!img) return;
    img.src = src;
    img.style.display = 'block';
    var c = canvas || document.getElementById('c');
    if (c) c.style.display = 'none';
  }

  // ---------- boot ----------
  G.boot = function (startFn) {
    if (booted) return;
    canvas = document.getElementById('c');
    var T = window.THREE;
    try {
      if (!T || !canvas) throw new Error('no THREE/canvas');
      renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
      if (!renderer.getContext()) throw new Error('no gl');
      renderer.outputEncoding = T.sRGBEncoding;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.physicallyCorrectLights = false;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.setClearColor(0x1a1612, 1);
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(55, 1, 0.05, 400);
      math();
    } catch (e) {
      report('boot', e);
      showFallback();
      return;
    }
    G.renderer = renderer; G.scene = scene; G.camera = camera; G.canvas = canvas;
    basePR = Math.min(2, window.devicePixelRatio || 1);
    curPR = basePR;
    booted = true;
    applySize(true);
    camUpdate(0);

    // コンテキスト喪失: 3 秒で戻らなければ代替画面
    var lostTimer = 0;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      lost = true;
      clearTimeout(lostTimer);
      lostTimer = setTimeout(function () { if (lost) showFallback(); }, 3000);
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      lost = false;
      clearTimeout(lostTimer);
    }, false);

    bindInput();
    var onRs = function () { applySize(false); };
    window.addEventListener('resize', onRs);
    window.addEventListener('orientationchange', function () { onRs(); setTimeout(onRs, 300); setTimeout(onRs, 800); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onRs);
    document.addEventListener('visibilitychange', function () { setHidden(!!document.hidden); });
    window.addEventListener('pagehide', function () { setHidden(true); });
    window.addEventListener('pageshow', function () { if (!document.hidden) setHidden(false); });
    hidden = !!document.hidden;

    try { if (typeof startFn === 'function') startFn(); } catch (e) { report('startFn', e); }
    running = true;
    startLoop();
  };

  // =====================================================================
  // ヒント（§6）
  // =====================================================================
  var H = {
    opts: null, idle: 0, nextWig: 3.5, vis: 0, nullPrev: true,
    inDemo: false, demoT: 0, handMul: 0, ripT: 9, objs: null
  };
  var HAND_PX = 92;           // 手の画面上の高さ（CSS px）
  var HAND_MAX = 0.74;         // 手の不透明度の上限
  var SPARK_N = 7;

  function hintTouch() {
    H.idle = 0; H.nextWig = 3.5;
    H.inDemo = false;          // handMul は 0.15 秒で消える
  }

  // 4 点星（細い光条 + 小さな芯）
  function makeStarTex() {
    var T = window.THREE, S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    var x = c.getContext('2d'), h = S / 2;
    x.globalCompositeOperation = 'lighter';
    function ray(horiz, len, thick, alpha) {
      var g = horiz ? x.createLinearGradient(h - len, 0, h + len, 0) : x.createLinearGradient(0, h - len, 0, h + len);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,' + alpha + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath();
      if (horiz) {
        x.moveTo(h - len, h); x.quadraticCurveTo(h, h - thick, h + len, h); x.quadraticCurveTo(h, h + thick, h - len, h);
      } else {
        x.moveTo(h, h - len); x.quadraticCurveTo(h + thick, h, h, h + len); x.quadraticCurveTo(h - thick, h, h, h - len);
      }
      x.fill();
    }
    ray(true, 60, 3.2, 1); ray(false, 60, 3.2, 1);
    ray(true, 34, 6, 0.35); ray(false, 34, 6, 0.35);
    var rg = x.createRadialGradient(h, h, 0, h, h, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg;
    x.fillRect(0, 0, S, S);
    var t = new T.CanvasTexture(c);
    return t;
  }
  // 波紋（やわらかい輪）
  function makeRingTex() {
    var T = window.THREE, S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    var x = c.getContext('2d'), h = S / 2;
    var g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.58, 'rgba(255,255,255,0)');
    g.addColorStop(0.74, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.9, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    return new T.CanvasTexture(c);
  }
  // 人さし指を伸ばした右手（手の甲側）。指先はキャンバス上部
  var HAND_TIP = [119.5, 18];
  function makeHandTex() {
    var T = window.THREE, S = 256;
    var m = document.createElement('canvas'); m.width = m.height = S;
    var k = m.getContext('2d');
    k.fillStyle = '#000'; k.strokeStyle = '#000'; k.lineCap = 'round'; k.lineJoin = 'round';
    function cap(x0, y0, x1, y1, w) { k.lineWidth = w; k.beginPath(); k.moveTo(x0, y0); k.lineTo(x1, y1); k.stroke(); }
    function rr(ctx, x0, y0, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
      ctx.lineTo(x0 + w, y0 + h - r); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
      ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
      ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0); ctx.closePath();
    }
    cap(118, 32, 121, 150, 31);          // 人さし指
    cap(150, 140, 152, 172, 30);         // 中指（曲げた）
    cap(175, 148, 176, 178, 28);         // 薬指
    cap(197, 160, 196, 186, 23);         // 小指
    rr(k, 101, 130, 103, 98, 34); k.fill();     // 手の甲
    rr(k, 113, 196, 76, 80, 28); k.fill();      // 手首
    cap(108, 214, 85, 174, 30);          // 親指
    cap(85, 174, 97, 148, 24);
    // 肌色で塗る
    k.globalCompositeOperation = 'source-in';
    var g = k.createLinearGradient(80, 20, 215, 250);
    g.addColorStop(0, '#f6dccb'); g.addColorStop(0.55, '#ebc6ae'); g.addColorStop(1, '#d9ab91');
    k.fillStyle = g; k.fillRect(0, 0, S, S);
    // 陰影とディテール
    k.globalCompositeOperation = 'source-atop';
    var hl = k.createRadialGradient(128, 120, 10, 128, 120, 130);
    hl.addColorStop(0, 'rgba(255,248,242,0.28)'); hl.addColorStop(1, 'rgba(255,248,242,0)');
    k.fillStyle = hl; k.fillRect(0, 0, S, S);
    var sh = k.createLinearGradient(0, 200, 0, 256);
    sh.addColorStop(0, 'rgba(150,95,72,0)'); sh.addColorStop(1, 'rgba(150,95,72,0.22)');
    k.fillStyle = sh; k.fillRect(0, 0, S, S);
    k.lineCap = 'round';
    k.strokeStyle = 'rgba(150,92,70,0.22)'; k.lineWidth = 2.2;
    [[136, 146, 137, 182], [163, 152, 163, 186], [187, 160, 186, 190]].forEach(function (l) {
      k.beginPath(); k.moveTo(l[0], l[1]); k.lineTo(l[2], l[3]); k.stroke();
    });
    k.strokeStyle = 'rgba(150,92,70,0.14)'; k.lineWidth = 1.6;
    [[64, 9], [100, 10]].forEach(function (c) {               // 指の関節のしわ
      k.beginPath(); k.moveTo(119.5 - c[1], c[0]); k.quadraticCurveTo(119.5, c[0] + 3, 119.5 + c[1], c[0]); k.stroke();
    });
    k.strokeStyle = 'rgba(150,92,70,0.16)'; k.lineWidth = 1.8;
    k.beginPath(); k.moveTo(92, 168); k.quadraticCurveTo(100, 178, 104, 196); k.stroke(); // 親指の付け根
    k.fillStyle = 'rgba(255,238,232,0.55)';                   // つめ
    rr(k, 109, 22, 21, 26, 9); k.fill();
    k.strokeStyle = 'rgba(170,110,95,0.25)'; k.lineWidth = 1.2;
    rr(k, 109, 22, 21, 26, 9); k.stroke();
    // やわらかい輪郭の影を付けて合成
    var c = document.createElement('canvas'); c.width = c.height = S;
    var x = c.getContext('2d');
    x.shadowColor = 'rgba(60,32,18,0.62)'; x.shadowBlur = 13; x.shadowOffsetY = 3;
    x.drawImage(m, 0, 0);
    x.shadowColor = 'rgba(0,0,0,0)';
    var t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  function hintObjs() {
    if (H.objs) return H.objs;
    if (!scene) return null;
    var T = window.THREE;
    var grp = new T.Group();
    grp.name = 'core-hint';
    var star = makeStarTex();
    var sparks = [];
    for (var i = 0; i < SPARK_N; i++) {
      var mat = new T.SpriteMaterial({
        map: star, color: 0xfff0d8, transparent: true, opacity: 0, blending: T.AdditiveBlending,
        depthTest: false, depthWrite: false, toneMapped: false, fog: false
      });
      var sp = new T.Sprite(mat);
      sp.renderOrder = 1000; sp.visible = false; sp.frustumCulled = false;
      grp.add(sp);
      sparks.push({ sp: sp, t: -U.rand(0, 1.2), life: 1.4, ang: 0, r: 40, size: 36, rot: 0, rv: 0, dz: 0 });
    }
    var hc = document.createElement('canvas'); hc.width = hc.height = 128;
    var hx = hc.getContext('2d'), hg = hx.createRadialGradient(64, 64, 0, 64, 64, 64);
    hg.addColorStop(0, 'rgba(255,255,255,0.85)'); hg.addColorStop(0.3, 'rgba(255,255,255,0.4)');
    hg.addColorStop(0.65, 'rgba(255,255,255,0.1)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    hx.fillStyle = hg; hx.fillRect(0, 0, 128, 128);
    var halo = new T.Sprite(new T.SpriteMaterial({
      map: new T.CanvasTexture(hc), color: 0xffe9bf, transparent: true, opacity: 0, blending: T.AdditiveBlending,
      depthTest: false, depthWrite: false, toneMapped: false, fog: false
    }));
    halo.renderOrder = 999; halo.visible = false; halo.frustumCulled = false;
    grp.add(halo);
    var ring = new T.Sprite(new T.SpriteMaterial({
      map: makeRingTex(), color: 0xffffff, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, toneMapped: false, fog: false
    }));
    ring.renderOrder = 1001; ring.visible = false; ring.frustumCulled = false;
    grp.add(ring);
    var hand = new T.Sprite(new T.SpriteMaterial({
      map: makeHandTex(), color: 0xffffff, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, toneMapped: false, fog: false
    }));
    hand.center.set(HAND_TIP[0] / 256, 1 - HAND_TIP[1] / 256);
    hand.material.rotation = 0.38;     // 右下から差し出す傾き
    hand.renderOrder = 1002; hand.visible = false; hand.frustumCulled = false;
    grp.add(hand);
    H.objs = {
      grp: grp, sparks: sparks, ring: ring, hand: hand, halo: halo,
      at: new T.Vector3(), to: new T.Vector3(), tip: new T.Vector3(), ringPos: new T.Vector3(), tmp: new T.Vector3()
    };
    return H.objs;
  }
  function hideAll() {
    var o = H.objs;
    if (!o) return;
    for (var i = 0; i < o.sparks.length; i++) o.sparks[i].sp.visible = false;
    o.ring.visible = false; o.hand.visible = false; if (o.halo) o.halo.visible = false;
  }
  function respawn(s, first) {
    s.t = first ? -U.rand(0, 1.0) : -U.rand(0.15, 0.9);
    s.life = U.rand(1.1, 1.7);
    s.ang = U.rand(0, Math.PI * 2);
    s.r = U.rand(26, 52);
    s.size = U.rand(26, 46);
    s.rot = U.rand(-0.3, 0.3);
    s.rv = U.rand(-0.25, 0.25);
    s.dz = 0;
  }
  function callGlow(opts, g) {
    if (opts && opts.glow) { try { opts.glow(g); } catch (e) { report('hint.glow', e); } }
  }

  G.hint = {
    set: function (opts) {
      var prev = H.opts;
      if (prev && prev !== opts && prev.glow && (!opts || prev.glow !== opts.glow)) callGlow(prev, 0);
      H.opts = opts || null;
      H.idle = 0; H.nextWig = 3.5; H.vis = 0; H.nullPrev = true;
      H.inDemo = false; H.demoT = 0; H.handMul = 0; H.ripT = 9;
      var o = H.objs;
      if (o) { for (var i = 0; i < o.sparks.length; i++) respawn(o.sparks[i], true); hideAll(); }
    },
    clear: function () {
      var prev = H.opts;
      H.opts = null; H.inDemo = false; H.handMul = 0;
      callGlow(prev, 0);
      hideAll();
    }
  };

  // お手本の姿勢: 戻り値は H.pose を書き換え
  var pose = { a: 0, s: 1, ox: 0, oy: 0, slide: 0, len: 3.4, rips: null };
  var RIPS_TAP = [0.72, 1.17], RIPS_HOLD = [0.75, 1.2], RIPS_DRAG = [0.68];
  function bump(t, a, b, c) { return t < b ? U.smooth(seg(t, a, b)) : 1 - U.smooth(seg(t, b, c)); }
  function demoPose(gest, t) {
    var appear, leave, press = 0;
    pose.slide = 0;
    if (gest === 'drag') {
      pose.len = 3.5; pose.rips = RIPS_DRAG;
      appear = seg(t, 0, 0.45); leave = seg(t, 1.85, 2.25);
      press = U.smooth(seg(t, 0.5, 0.68)) * (1 - U.smooth(seg(t, 1.65, 1.82)));
      pose.slide = U.easeInOutCubic(seg(t, 0.72, 1.62));
    } else if (gest === 'hold') {
      pose.len = 3.6; pose.rips = RIPS_HOLD;
      appear = seg(t, 0, 0.45); leave = seg(t, 1.85, 2.3);
      press = U.smooth(seg(t, 0.55, 0.75)) * (1 - U.smooth(seg(t, 1.55, 1.75)));
    } else {
      pose.len = 3.4; pose.rips = RIPS_TAP;
      appear = seg(t, 0, 0.45); leave = seg(t, 1.55, 2.0);
      press = Math.max(bump(t, 0.55, 0.72, 0.9), bump(t, 1.0, 1.17, 1.35));
    }
    var ea = U.easeOutCubic(appear), el = U.smooth(leave);
    pose.a = ea * (1 - el);
    var lift = (1 - press) * 0.07;
    pose.ox = (1 - ea) * 0.45 + el * 0.3 + lift * 0.5;
    pose.oy = -(1 - ea) * 0.45 - el * 0.3 - lift * 0.5;
    pose.s = (1 - 0.1 * press) * (1 + 0.06 * (1 - press));
    return pose;
  }

  function hintUpdate(dt) {
    if (!H.opts) { hideAll(); return; }
    var o = hintObjs();
    if (!o) return;
    if (o.grp.parent !== scene) scene.add(o.grp);
    var opts = H.opts, atp = null;
    try { atp = opts.at ? opts.at() : null; } catch (e) { report('hint.at', e); }
    if (!atp) {
      if (!H.nullPrev) callGlow(opts, 0);
      H.nullPrev = true;
      hideAll();
      return;
    }
    if (H.nullPrev) { H.nullPrev = false; }
    o.at.copy(atp);

    // 無操作時間（指が触れている間は 0）
    if (ptr.id !== null) { H.idle = 0; H.nextWig = 3.5; }
    else H.idle += dt;
    H.vis = Math.min(1, H.vis + dt / 0.5);

    // 段階 0: 脈打つ光
    callGlow(opts, 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(G.time * 2.6)));
    if (H.opts !== opts) return;              // glow の中で set/clear された

    // 段階 1: ゆれ + 控えめな音
    if (H.idle >= H.nextWig) {
      H.nextWig += 2.8;
      if (opts.wiggle) { try { opts.wiggle(); } catch (e) { report('hint.wiggle', e); } }
      try { if (G.audio && G.audio.play) G.audio.play('hint', { vol: 0.5 }); } catch (e) { report('hint.audio', e); }
      if (H.opts !== opts) return;
    }
    // 段階 2: 手のお手本
    if (H.idle >= 7.5 && !H.inDemo) { H.inDemo = true; H.demoT = 0; H.handMul = 1; H.ripT = 9; }
    if (H.inDemo) H.handMul = 1;
    else H.handMul = Math.max(0, H.handMul - dt / 0.15);

    // カメラ基準の量
    var m = math();
    m.right.setFromMatrixColumn(camera.matrixWorld, 0);
    m.up.setFromMatrixColumn(camera.matrixWorld, 1);
    var dist = camera.position.distanceTo(o.at);
    var f = Math.max(0.08, dist) * 2 * Math.tan(camera.fov * Math.PI / 360) / vh;   // 1 CSS px の世界サイズ
    var pulse = 0.5 + 0.5 * Math.sin(G.time * 2.6);
    o.halo.visible = true;
    o.halo.position.copy(o.at);
    o.halo.scale.setScalar(f * (150 + 34 * pulse));
    o.halo.material.opacity = (0.2 + 0.3 * pulse) * H.vis;
    var vis = H.vis;

    // きらめき
    for (var i = 0; i < o.sparks.length; i++) {
      var s = o.sparks[i], sp = s.sp;
      s.t += dt;
      if (s.t >= s.life) respawn(s, false);
      if (s.t < 0) { sp.visible = false; continue; }
      var k = s.t / s.life, env = Math.sin(Math.PI * k);
      env = env * env;
      sp.visible = true;
      sp.material.opacity = 0.9 * env * vis;
      sp.material.rotation = s.rot + s.rv * s.t;
      var sz = s.size * f * (0.55 + 0.45 * env);
      sp.scale.set(sz, sz, 1);
      var r = s.r * f;
      sp.position.copy(o.at)
        .addScaledVector(m.right, Math.cos(s.ang) * r)
        .addScaledVector(m.up, Math.sin(s.ang) * r + 6 * f * k);
      o.tmp.copy(camera.position).sub(o.at).normalize();
      sp.position.addScaledVector(o.tmp, s.dz);
    }

    // 手
    if (H.handMul <= 0) { o.hand.visible = false; o.ring.visible = false; return; }
    var gest = opts.gesture || 'tap';
    var hasTo = false;
    if (gest === 'drag') {
      var tp = null;
      try { tp = opts.to ? opts.to() : null; } catch (e) { report('hint.to', e); }
      if (tp) { o.to.copy(tp); hasTo = true; } else gest = 'hold';
    }
    var prevT = H.demoT;
    H.demoT += dt;
    var pz = demoPose(gest, H.demoT);
    if (H.demoT >= pz.len) { H.demoT -= pz.len; prevT = -1; pz = demoPose(gest, H.demoT); }
    o.tip.copy(o.at);
    if (hasTo) o.tip.lerp(o.to, pz.slide);
    // 画面上の高さ HAND_PX になる世界サイズ
    o.tmp.copy(o.tip).applyMatrix4(camera.matrixWorldInverse);
    var depth = -o.tmp.z;
    if (depth < 0.06) { o.hand.visible = false; o.ring.visible = false; return; }
    var worldH = HAND_PX / vh * 2 * depth * Math.tan(camera.fov * Math.PI / 360);
    // 波紋のきっかけ
    for (var j = 0; j < pz.rips.length; j++) {
      if (pz.rips[j] > prevT && pz.rips[j] <= H.demoT) { H.ripT = 0; o.ringPos.copy(o.tip); }
    }
    var hs = worldH * pz.s;
    o.hand.visible = true;
    o.hand.scale.set(hs, hs, 1);
    o.hand.position.copy(o.tip)
      .addScaledVector(m.right, pz.ox * worldH)
      .addScaledVector(m.up, pz.oy * worldH);
    o.hand.material.opacity = HAND_MAX * pz.a * H.handMul * vis;

    H.ripT += dt;
    if (H.ripT < 0.55) {
      var rk = H.ripT / 0.55;
      var rs = worldH * (0.18 + 0.5 * U.easeOutCubic(rk));
      o.ring.visible = true;
      o.ring.position.copy(o.ringPos);
      o.ring.scale.set(rs, rs, 1);
      o.ring.material.opacity = 0.55 * (1 - rk) * (1 - rk) * H.handMul * vis;
    } else o.ring.visible = false;
  }

  // ---------- dbg ----------
  G.dbg = {
    stats: function () {
      var info = renderer ? renderer.info.render : null;
      return {
        fps: Math.round(1 / Math.max(1e-3, perf.avg)),
        pixelRatio: curPR,
        low: G.quality.low,
        calls: info ? info.calls : 0,
        tris: info ? info.triangles : 0
      };
    }
  };
})();
