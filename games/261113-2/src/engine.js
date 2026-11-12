/* engine.js — renderer, clock, camera, input, tweens, FX, hints, save, director.
   Classic script. Exposes everything on window.G. */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var THREE = window.THREE;
  var DEG = Math.PI / 180;

  // ------------------------------------------------------------------ utils
  function safeCall(fn, self, args, tag) {
    try { return fn.apply(self, args || []); }
    catch (e) { reportError(tag || 'callback', e); }
  }
  var errCount = 0;
  function reportError(tag, e) {
    if (errCount++ < 30 && window.console) console.error('[G:' + tag + ']', e);
  }
  G.lerp = function (a, b, k) { return a + (b - a) * k; };
  G.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  G.smooth = function (cur, target, rate, dt) {
    var k = 1 - Math.exp(-rate * dt);
    if (cur && typeof cur.lerp === 'function') return cur.lerp(target, k);
    return cur + (target - cur) * k;
  };

  // ------------------------------------------------------------------ easing
  var Ease = {
    linear: function (t) { return t; },
    in: function (t) { return t * t * t; },
    out: function (t) { var u = 1 - t; return 1 - u * u * u; },
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    sine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; },
    outElastic: function (t) {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    },
    outBounce: function (t) {
      var n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  };
  G.Ease = Ease;
  function resolveEase(e) {
    if (typeof e === 'function') return e;
    if (typeof e === 'string' && Ease[e]) return Ease[e];
    return Ease.inOut;
  }

  // ------------------------------------------------------------------ tweens
  var tweens = [];
  function startTween(tw) {
    tw.started = true;
    tw.from = {};
    var keys = Object.keys(tw.to);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = tw.target[k];
      if (typeof v !== 'number') { delete tw.to[k]; continue; }
      tw.from[k] = v;
      // newer tween wins on the same property
      for (var j = 0; j < tweens.length; j++) {
        var o = tweens[j];
        if (o !== tw && !o.dead && o.started && o.target === tw.target && k in o.to) {
          delete o.to[k]; delete o.from[k];
        }
      }
    }
  }
  function applyTween(tw, e) {
    for (var k in tw.to) tw.target[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
  }
  G.tween = function (target, to, dur, o) {
    o = o || {};
    var props = {};
    for (var k in to) if (typeof to[k] === 'number') props[k] = to[k];
    var tw = {
      target: target || {}, to: props, dur: Math.max(0, +dur || 0), delay: Math.max(0, +o.delay || 0),
      ease: resolveEase(o.ease), onUpdate: o.onUpdate, onDone: o.onDone, t: 0, started: false, dead: false, from: null
    };
    var handle = { kill: function () { tw.dead = true; } };
    if (tw.delay <= 0) {
      startTween(tw);
      if (tw.dur === 0) {
        applyTween(tw, 1); tw.dead = true;
        if (tw.onUpdate) safeCall(tw.onUpdate, null, [1, 1], 'tween');
        if (tw.onDone) safeCall(tw.onDone, null, [], 'tween');
        return handle;
      }
    }
    tweens.push(tw);
    return handle;
  };
  G.wait = function (sec, fn) {
    return G.tween({}, {}, sec, { ease: 'linear', onDone: fn });
  };
  G.killTweens = function (target) {
    for (var i = 0; i < tweens.length; i++) if (tweens[i].target === target) tweens[i].dead = true;
  };
  function updateTweens(dt) {
    var n = tweens.length;
    for (var i = 0; i < n; i++) {
      var tw = tweens[i];
      if (tw.dead) continue;
      var step = dt;
      if (!tw.started) {
        tw.delay -= dt;
        if (tw.delay > 0) continue;
        step = -tw.delay;
        startTween(tw);
      }
      tw.t += step;
      var raw = tw.dur > 0 ? Math.min(1, tw.t / tw.dur) : 1;
      var e = tw.ease(raw);
      applyTween(tw, e);
      if (tw.onUpdate) safeCall(tw.onUpdate, null, [e, raw], 'tween');
      if (raw >= 1) {
        tw.dead = true;
        if (tw.onDone) safeCall(tw.onDone, null, [], 'tween');
      }
    }
    var w = 0;
    for (var r = 0; r < tweens.length; r++) if (!tweens[r].dead) tweens[w++] = tweens[r];
    tweens.length = w;
  }

  // ------------------------------------------------------------------ save
  var SAVE_KEY = 'gf-261113-2';
  var saveCache = null;
  G.Save = {
    get: function () {
      if (saveCache) return saveCache;
      var o = {};
      try {
        var s = window.localStorage.getItem(SAVE_KEY);
        if (s) { var p = JSON.parse(s); if (p && typeof p === 'object' && !Array.isArray(p)) o = p; }
      } catch (e) { o = {}; }
      saveCache = o;
      return o;
    },
    set: function (patch) {
      try {
        var cur = G.Save.get();
        if (patch && typeof patch === 'object') for (var k in patch) cur[k] = patch[k];
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(cur));
      } catch (e) { /* storage refused: keep in memory */ }
    }
  };

  // ------------------------------------------------------------------ director
  var scenes = {};
  G.Director = {
    current: null,
    add: function (name, sc) { scenes[name] = sc || {}; },
    has: function (name) { return !!scenes[name]; },
    go: function (name) {
      var next = scenes[name];
      if (!next) return;
      var cur = scenes[G.Director.current];
      if (cur && cur.exit) safeCall(cur.exit, cur, [], 'exit:' + G.Director.current);
      G.Director.current = name;
      if (G.Hint) G.Hint.clear();
      if (next.enter) safeCall(next.enter, next, [], 'enter:' + name);
    },
    update: function (dt) {
      var cur = scenes[G.Director.current];
      if (cur && cur.update) safeCall(cur.update, cur, [dt, G.time], 'update:' + G.Director.current);
    }
  };

  // ------------------------------------------------------------------ engine
  var renderer, scene, camera, canvas, sun, hemi, envRT;
  var updateFns = [], resizeFns = [], qualityFns = [];
  var running = false, started = false, rafId = 0, lastTs = null;
  var viewW = 1, viewH = 1;
  var safe = { t: 0, r: 0, b: 0, l: 0 }, safeEl = null;
  var quality = { tier: 'high', shadows: true, particles: 220, texSize: 1024, pixelRatio: 1, prCap: 2 };
  G.quality = quality;
  G.time = 0;

  var dyn = { ema: 16.7, settle: 1.5, checkT: 0, slowAtMin: 0 };

  function readSafeArea() {
    if (!safeEl) return;
    var cs = window.getComputedStyle(safeEl);
    safe.t = parseFloat(cs.paddingTop) || 0;
    safe.r = parseFloat(cs.paddingRight) || 0;
    safe.b = parseFloat(cs.paddingBottom) || 0;
    safe.l = parseFloat(cs.paddingLeft) || 0;
  }

  function buildEnvironment() {
    // tiny procedural kitchen: warm walls, bright window (left/back), soft ceiling
    var env = new THREE.Scene();
    function mat(r, g, b) { var m = new THREE.MeshBasicMaterial({ side: THREE.BackSide }); m.color.setRGB(r, g, b); return m; }
    var room = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), [
      mat(0.66, 0.58, 0.48), // +x wall
      mat(0.74, 0.66, 0.56), // -x wall (window side)
      mat(0.95, 0.90, 0.82), // ceiling
      mat(0.36, 0.25, 0.16), // floor (wood)
      mat(0.64, 0.56, 0.46), // +z
      mat(0.76, 0.68, 0.58)  // -z
    ]);
    room.position.y = 1.5;
    env.add(room);
    function panel(w, h, pos, rotY, r, g, b) {
      var m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); m.color.setRGB(r, g, b);
      var p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      p.position.copy(pos); p.rotation.y = rotY; env.add(p);
    }
    panel(2.6, 1.8, new THREE.Vector3(-3.95, 2.0, -1.2), Math.PI / 2, 5.0, 4.6, 4.0);   // left window
    panel(2.2, 1.4, new THREE.Vector3(-1.0, 2.2, -3.95), 0, 3.6, 3.3, 2.9);           // back window
    panel(3.0, 0.6, new THREE.Vector3(0.4, 3.95, 0), 0, 1.6, 1.5, 1.35);              // ceiling light strip
    env.children[env.children.length - 1].rotation.x = Math.PI / 2;
    var pm = new THREE.PMREMGenerator(renderer);
    envRT = pm.fromScene(env, 0.035);
    pm.dispose();
    env.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    scene.environment = envRT.texture;
  }

  function setPixelRatio(pr) {
    quality.pixelRatio = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(viewW, viewH, false);
  }

  function prCap() { return Math.min(window.devicePixelRatio || 1, quality.tier === 'high' ? 2 : 1.5); }

  function handleResize(force) {
    var w = Math.max(1, window.innerWidth | 0), h = Math.max(1, window.innerHeight | 0);
    if (!force && w === viewW && h === viewH) return;
    viewW = w; viewH = h;
    readSafeArea();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    Cam._recompute(true);
    for (var i = 0; i < resizeFns.length; i++) safeCall(resizeFns[i], null, [w, h], 'resize');
  }

  function setQuality(tier) {
    if (tier !== 'high' && tier !== 'low') return;
    var changed = quality.tier !== tier;
    quality.tier = tier;
    quality.shadows = tier === 'high';
    quality.particles = tier === 'high' ? 220 : 90;
    quality.texSize = tier === 'high' ? 1024 : 512;
    quality.prCap = tier === 'high' ? 2 : 1.5;
    if (renderer) {
      var shadowWas = renderer.shadowMap.enabled;
      renderer.shadowMap.enabled = quality.shadows;
      if (sun) sun.castShadow = quality.shadows;
      if (shadowWas !== quality.shadows && scene) {
        scene.traverse(function (o) {
          if (!o.material) return;
          var ms = Array.isArray(o.material) ? o.material : [o.material];
          for (var i = 0; i < ms.length; i++) ms[i].needsUpdate = true;
        });
      }
      if (quality.pixelRatio > prCap()) setPixelRatio(prCap());
    }
    dyn.settle = 1.5; dyn.slowAtMin = 0;
    if (changed) for (var i = 0; i < qualityFns.length; i++) safeCall(qualityFns[i], null, [quality], 'quality');
  }

  function dynamicResolution(rawMs, dt) {
    dyn.ema += (Math.min(rawMs, 200) - dyn.ema) * 0.08;
    if (!G.Engine.dynamicRes) return;
    if (dyn.settle > 0) { dyn.settle -= dt; return; }
    dyn.checkT += dt;
    if (dyn.checkT < 0.75) return;
    dyn.checkT = 0;
    var cap = prCap(), pr = quality.pixelRatio;
    if (dyn.ema > 36) {
      if (pr > 0.6 + 1e-3) { setPixelRatio(Math.max(0.6, pr - 0.15)); dyn.settle = 1.0; }
      else if (quality.tier === 'high') {
        if (++dyn.slowAtMin >= 2) { setQuality('low'); setPixelRatio(Math.min(1, prCap())); }
      }
    } else if (dyn.ema < 24 && pr < cap - 1e-3) {
      setPixelRatio(Math.min(cap, pr + 0.1)); dyn.settle = 1.0; dyn.slowAtMin = 0;
    } else dyn.slowAtMin = 0;
  }

  function frame(ts) {
    rafId = 0;
    if (!running) return;
    rafId = window.requestAnimationFrame(frame);
    var rawMs = lastTs == null ? 16.7 : ts - lastTs;
    lastTs = ts;
    var dt = Math.min(0.05, Math.max(0, rawMs / 1000));
    G.time += dt;
    handleResize(false);
    updateTweens(dt);
    G.Director.update(dt);
    for (var i = 0; i < updateFns.length; i++) safeCall(updateFns[i], null, [dt, G.time], 'update');
    safeCall(Cam._update, Cam, [dt], 'cam');
    safeCall(FX._update, FX, [dt], 'fx');
    safeCall(Hint._update, Hint, [dt], 'hint');
    try { renderer.render(scene, camera); } catch (e) { reportError('render', e); }
    dynamicResolution(rawMs, dt);
  }

  function pause() {
    if (!running) return;
    running = false;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    Input._cancel();
    if (G.Audio && G.Audio.suspend) safeCall(G.Audio.suspend, G.Audio, [], 'audio');
  }
  function resume() {
    if (!started || running || document.hidden) return;
    running = true;
    lastTs = null; // never jump the clock
    dyn.settle = 1.5;
    if (G.Audio && G.Audio.resume) safeCall(G.Audio.resume, G.Audio, [], 'audio');
    rafId = window.requestAnimationFrame(frame);
  }

  G.Engine = {
    dynamicRes: true,
    init: function (cv) {
      canvas = cv;
      try {
        if (!THREE || !canvas) return false;
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
        if (!renderer.getContext()) return false;
      } catch (e) { reportError('webgl', e); return false; }
      try {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.92;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setClearColor(0xcaa27a, 1);

        safeEl = document.createElement('div');
        safeEl.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
          'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
        document.body.appendChild(safeEl);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xd9bf9c);
        camera = new THREE.PerspectiveCamera(42, 1, 0.02, 30);
        camera.rotation.order = 'YXZ';
        scene.add(camera);
        G.scene = scene; G.camera = camera; G.renderer = renderer;

        // lighting: warm morning sun from back-left-up
        sun = new THREE.DirectionalLight(0xfff0de, 2.6);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        var sc = sun.shadow.camera;
        sc.left = -0.6; sc.right = 0.6; sc.top = 0.6; sc.bottom = -0.6; sc.near = 0.3; sc.far = 6;
        sun.shadow.bias = -0.00025;
        sun.shadow.normalBias = 0.0012;
        sun.shadow.radius = 4;
        scene.add(sun); scene.add(sun.target);
        G.sun = sun;
        hemi = new THREE.HemisphereLight(0xf6f4ef, 0xb69676, 0.5);
        scene.add(hemi);
        G.hemi = hemi;

        buildEnvironment();

        var caps = renderer.capabilities;
        if (caps && caps.maxTextureSize && caps.maxTextureSize < 4096) setQuality('low');
        else { quality.prCap = 2; }
        if (quality.tier === 'low') sun.shadow.mapSize.set(1024, 1024);
        quality.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        renderer.setPixelRatio(quality.pixelRatio);
        handleResize(true);
        Cam._recompute(true);
        Input._bind(canvas);
        FX._init();

        canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); }, false);
        document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else resume(); });
        window.addEventListener('pagehide', pause);
        window.addEventListener('blur', pause);
        window.addEventListener('focus', resume);
        window.addEventListener('pageshow', resume);
        window.addEventListener('resize', function () { if (renderer) handleResize(false); });
        window.addEventListener('orientationchange', function () { if (renderer) handleResize(true); });
        return true;
      } catch (e2) {
        reportError('init', e2);
        return false;
      }
    },
    start: function () {
      if (!renderer) return;
      started = true;
      resume();
    },
    onUpdate: function (fn) { if (typeof fn === 'function') updateFns.push(fn); return fn; },
    offUpdate: function (fn) { var i = updateFns.indexOf(fn); if (i >= 0) updateFns.splice(i, 1); },
    onResize: function (fn) { if (typeof fn === 'function') resizeFns.push(fn); return fn; },
    onQuality: function (fn) { if (typeof fn === 'function') qualityFns.push(fn); return fn; },
    setQuality: setQuality,
    get running() { return running; },
    get size() { return { w: viewW, h: viewH }; },
    get safeArea() { return { top: safe.t, right: safe.r, bottom: safe.b, left: safe.l }; },
    get frameMs() { return dyn.ema; }
  };

  // ------------------------------------------------------------------ camera
  var Cam = {
    current: null,
    _pose: { pos: new THREE.Vector3(0, 0.9, 0.3), pitch: 60 * DEG, cx: 0, cz: -0.3, half: 0.6 },
    _from: null, _to: null, _t: 0, _dur: 0, _ease: Ease.inOut,
    _shake: { amt: 0, dur: 0, t: 0 },
    frame: function (f) {
      if (typeof f === 'string') f = G.W && G.W.FRAMES ? G.W.FRAMES[f] : null;
      if (!f) return;
      var fr = { cx: +f.cx || 0, cz: +f.cz || 0, w: f.w != null ? +f.w : 0.4, d: f.d != null ? +f.d : 0.5,
        pitch: f.pitch != null ? +f.pitch : 60, pad: f.pad != null ? +f.pad : 0.06 };
      var dur = f.dur != null ? +f.dur : 1.0;
      Cam.current = fr;
      Cam._ease = resolveEase(f.ease);
      var p = Cam._pose;
      Cam._from = { pos: p.pos.clone(), pitch: p.pitch, cx: p.cx, cz: p.cz, half: p.half };
      Cam._to = computePose(fr);
      Cam._t = 0; Cam._dur = Math.max(0, dur);
      if (Cam._dur === 0 || !camera) { copyPose(p, Cam._to); Cam._to = null; applyCamera(0); }
    },
    shake: function (amount, dur) {
      Cam._shake.amt = Math.max(Cam._shake.amt * (1 - Cam._shake.t / (Cam._shake.dur || 1)), amount || 0.004);
      Cam._shake.dur = dur || 0.3; Cam._shake.t = 0;
    },
    _recompute: function () {
      if (!camera) return;
      if (!Cam.current) Cam.current = { cx: 0, cz: -0.3, w: 0.4, d: 0.6, pitch: 60, pad: 0.06 };
      var target = computePose(Cam.current);
      if (Cam._to) Cam._to = target; // keep animating toward updated target
      else { copyPose(Cam._pose, target); applyCamera(0); }
    },
    _update: function (dt) {
      if (Cam._to) {
        Cam._t += dt;
        var k = Cam._dur > 0 ? Math.min(1, Cam._t / Cam._dur) : 1;
        var e = Cam._ease(k), a = Cam._from, b = Cam._to, p = Cam._pose;
        p.pos.lerpVectors(a.pos, b.pos, e);
        p.pitch = G.lerp(a.pitch, b.pitch, e);
        p.cx = G.lerp(a.cx, b.cx, e); p.cz = G.lerp(a.cz, b.cz, e); p.half = G.lerp(a.half, b.half, e);
        if (k >= 1) Cam._to = null;
      }
      applyCamera(dt);
    }
  };
  G.Cam = Cam;
  function copyPose(dst, src) { dst.pos.copy(src.pos); dst.pitch = src.pitch; dst.cx = src.cx; dst.cz = src.cz; dst.half = src.half; }

  var _pts = [];
  for (var pi = 0; pi < 8; pi++) _pts.push(new THREE.Vector3());
  function computePose(fr) {
    var p = fr.pitch * DEG, sp = Math.sin(p), cp = Math.cos(p);
    var hw = fr.w / 2 + fr.pad, hd = fr.d / 2 + fr.pad;
    var A = [], B = [], C = [];
    var n = 0;
    for (var ix = -1; ix <= 1; ix += 2) for (var iz = -1; iz <= 1; iz += 2) for (var iy = 0; iy <= 1; iy++) {
      var qx = ix * hw, qy = iy * 0.12, qz = iz * hd; // relative to (cx,0,cz)
      A[n] = qx;                       // · right (1,0,0)
      B[n] = qy * cp - qz * sp;        // · up (0,cos,-sin)
      C[n] = -qy * sp - qz * cp;       // · forward (0,-sin,-cos)
      n++;
    }
    var w = viewW || 1, h = viewH || 1;
    var sl = Math.min(safe.l, w * 0.4), sr = Math.min(safe.r, w * 0.4), st = Math.min(safe.t, h * 0.4), sb = Math.min(safe.b, h * 0.4);
    var xl = -1 + 2 * sl / w, xr = 1 - 2 * sr / w, yb = -1 + 2 * sb / h, yt = 1 - 2 * st / h;
    var ty = Math.tan((camera ? camera.fov : 42) * DEG / 2), tx = ty * (w / h);
    function test(D, out) {
      var loX = -1e9, hiX = 1e9, loY = -1e9, hiY = 1e9;
      for (var i = 0; i < n; i++) {
        var z = D + C[i];
        if (z <= 0.03) return false;
        loX = Math.max(loX, A[i] - xr * tx * z); hiX = Math.min(hiX, A[i] - xl * tx * z);
        loY = Math.max(loY, B[i] - yt * ty * z); hiY = Math.min(hiY, B[i] - yb * ty * z);
      }
      if (out) { out.ox = (loX + hiX) / 2; out.oy = (loY + hiY) / 2; }
      return loX <= hiX && loY <= hiY;
    }
    var lo = 0.05, hi = 40;
    for (var c = 0; c < n; c++) lo = Math.max(lo, -C[c] + 0.04);
    if (!test(hi)) hi = 40;
    for (var it = 0; it < 48; it++) { var mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
    var res = { ox: 0, oy: 0 };
    test(hi, res);
    var D = hi;
    // camera = C - f*D + r*ox + u*oy
    var pos = new THREE.Vector3(
      fr.cx + res.ox,
      0 + sp * D + cp * res.oy,
      fr.cz + cp * D - sp * res.oy
    );
    return { pos: pos, pitch: p, cx: fr.cx, cz: fr.cz, half: Math.max(0.6, Math.max(fr.w, fr.d) / 2 + 0.2) };
  }

  var SUN_DIR = new THREE.Vector3(-0.62, 1.25, -0.78).normalize();
  var _lastHalf = 0;
  function applyCamera(dt) {
    if (!camera) return;
    var p = Cam._pose;
    camera.position.copy(p.pos);
    camera.rotation.set(-p.pitch, 0, 0);
    var s = Cam._shake;
    if (s.amt > 0 && s.t < s.dur) {
      s.t += dt;
      var k = 1 - s.t / s.dur, a = s.amt * k * k, t = G.time;
      camera.position.x += a * Math.sin(t * 71.3) * 0.8;
      camera.position.y += a * Math.sin(t * 59.1 + 1.3) * 0.6;
      camera.position.z += a * Math.sin(t * 83.7 + 2.1) * 0.5;
    } else s.amt = 0;
    camera.updateMatrixWorld();
    if (sun) {
      sun.target.position.set(p.cx, 0, p.cz);
      sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 3);
      var half = Math.round(p.half * 20) / 20;
      if (half !== _lastHalf) {
        _lastHalf = half;
        var sc = sun.shadow.camera;
        sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
        sc.updateProjectionMatrix();
      }
    }
  }

  // ------------------------------------------------------------------ input
  var listeners = { down: [], move: [], up: [] };
  var ndc = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  var Input = {
    active: false, enabled: true, last: null,
    _id: null, _start: null,
    on: function (type, fn) { if (listeners[type] && typeof fn === 'function') listeners[type].push(fn); return fn; },
    off: function (type, fn) {
      if (!listeners[type]) return;
      if (!fn) { listeners[type].length = 0; return; }
      var i = listeners[type].indexOf(fn); if (i >= 0) listeners[type].splice(i, 1);
    },
    pick: function (ev, objs) {
      if (!ev || !ev.ray || !objs) return null;
      raycaster.ray.copy(ev.ray);
      raycaster.near = 0; raycaster.far = 100;
      raycaster.camera = camera;
      var list = Array.isArray(objs) ? objs.filter(Boolean) : [objs];
      var hits;
      try { hits = raycaster.intersectObjects(list, true); } catch (e) { return null; }
      for (var i = 0; i < hits.length; i++) {
        if (isVisible(hits[i].object)) return { object: hits[i].object, point: hits[i].point, distance: hits[i].distance };
      }
      return null;
    },
    project: function (v) {
      if (!camera || !v) return { x: -1e5, y: -1e5 };
      var p = _tmpV.copy(v).project(camera);
      var r = canvasRect();
      return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height, behind: p.z > 1 };
    },
    screenDist: function (ev, v) {
      if (!ev || !v) return 1e9;
      var p = Input.project(v);
      return Math.hypot(p.x - ev.x, p.y - ev.y);
    },
    _bind: function (cv) {
      cv.addEventListener('pointerdown', onDown, { passive: false });
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp, { passive: false });
      window.addEventListener('pointercancel', onUp, { passive: false });
      cv.addEventListener('lostpointercapture', function (e) { if (e.pointerId === Input._id) onUp(e); });
    },
    _cancel: function () {
      if (Input.active && Input.last) emit('up', makeEv(Input.last.x, Input.last.y, Input._id));
      Input.active = false; Input._id = null;
    }
  };
  G.Input = Input;
  var _tmpV = new THREE.Vector3();
  function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
  var _rect = null, _rectT = -1;
  function canvasRect() {
    if (!canvas) return { left: 0, top: 0, width: viewW, height: viewH };
    if (_rectT !== G.time || !_rect) { _rect = canvas.getBoundingClientRect(); _rectT = G.time; }
    return _rect;
  }
  function makeEv(cx, cy, id) {
    var r = canvasRect();
    var x = cx - r.left, y = cy - r.top;
    var ray = new THREE.Ray();
    if (camera) {
      camera.updateMatrixWorld();
      ndc.set(x / Math.max(1, r.width) * 2 - 1, -(y / Math.max(1, r.height)) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      ray.copy(raycaster.ray);
    }
    var prev = Input.last;
    var ev = {
      x: x, y: y, clientX: cx, clientY: cy, id: id, ray: ray, time: G.time,
      dx: prev ? x - prev.x : 0, dy: prev ? y - prev.y : 0,
      moved: prev ? prev.moved : 0, duration: Input._start ? G.time - Input._start.time : 0,
      onPlane: function (py) {
        var dy = ray.direction.y;
        if (Math.abs(dy) < 1e-6) return null;
        var t = ((py || 0) - ray.origin.y) / dy;
        if (t < 0) return null;
        return ray.origin.clone().addScaledVector(ray.direction, t);
      }
    };
    ev.moved += Math.hypot(ev.dx, ev.dy);
    return ev;
  }
  function emit(type, ev) {
    var l = listeners[type].slice();
    for (var i = 0; i < l.length; i++) safeCall(l[i], null, [ev], 'input:' + type);
  }
  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    if (!Input.enabled || !running) return;
    if (Input.active) return; // only the first finger
    if (e.button != null && e.button > 0 && e.pointerType === 'mouse') return;
    Input.active = true; Input._id = e.pointerId; Input.last = null; Input._start = null;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var ev = makeEv(e.clientX, e.clientY, e.pointerId);
    ev.moved = 0; ev.duration = 0;
    Input._start = ev; Input.last = ev;
    if (G.Hint) G.Hint.poke();
    emit('down', ev);
  }
  function onMove(e) {
    if (!Input.active || e.pointerId !== Input._id) return;
    if (e.cancelable) e.preventDefault();
    var ev = makeEv(e.clientX, e.clientY, e.pointerId);
    Input.last = ev;
    if (G.Hint) G.Hint.poke();
    emit('move', ev);
  }
  function onUp(e) {
    if (!Input.active || e.pointerId !== Input._id) return;
    var ev = makeEv(e.clientX, e.clientY, e.pointerId);
    Input.active = false; Input._id = null; Input.last = ev;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (G.Hint) G.Hint.poke();
    emit('up', ev);
  }

  // ------------------------------------------------------------------ FX
  var FX = {};
  G.FX = FX;
  var pools = {}, emitters = [], halos = [], pulses = [];
  var haloTex = null, haloGeo = null;
  function canvasTex(size, w, draw) {
    var c = document.createElement('canvas'); c.width = w || size; c.height = size;
    draw(c.getContext('2d'), c.width, c.height);
    var t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }
  function makeAtlas() {
    // cell 0: wispy steam puff, cell 1: soft solid dot (grains/sparkle core)
    return canvasTex(128, 256, function (g, W, H) {
      g.clearRect(0, 0, W, H);
      var rnd = mulberry(7);
      g.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 14; i++) {
        var a = rnd() * Math.PI * 2, r = rnd() * 26;
        var x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rad = 22 + rnd() * 26;
        var gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.16)');
        gr.addColorStop(0.5, 'rgba(255,255,255,0.07)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      }
      g.globalCompositeOperation = 'source-over';
      var d = g.createRadialGradient(192, 64, 0, 192, 64, 60);
      d.addColorStop(0, 'rgba(255,255,255,1)');
      d.addColorStop(0.35, 'rgba(255,255,255,0.95)');
      d.addColorStop(0.6, 'rgba(255,255,255,0.35)');
      d.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = d; g.fillRect(128, 0, 128, 128);
    });
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  var CAP = 220;
  function makePool(additive, tex) {
    var plane = new THREE.PlaneGeometry(1, 1);
    var geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    var aPos = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    var aCol = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    var aMisc = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    aPos.setUsage(THREE.DynamicDrawUsage); aCol.setUsage(THREE.DynamicDrawUsage); aMisc.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', aPos); geo.setAttribute('iCol', aCol); geo.setAttribute('iMisc', aMisc);
    geo.instanceCount = 0;
    var mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: [
        'attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iMisc;',
        'varying vec2 vUv; varying vec4 vCol;',
        'void main(){',
        '  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);',
        '  vec2 c = position.xy; c.x *= iMisc.z;',
        '  float cs = cos(iMisc.y), sn = sin(iMisc.y);',
        '  c = vec2(c.x*cs - c.y*sn, c.x*sn + c.y*cs);',
        '  mv.xy += c * iMisc.x;',
        '  gl_Position = projectionMatrix * mv;',
        '  vUv = vec2((uv.x + iMisc.w) * 0.5, uv.y);',
        '  vCol = iCol;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;',
        'void main(){',
        '  vec4 t = texture2D(map, vUv);',
        '  float a = vCol.a * t.a;',
        '  if (a < 0.002) discard;',
        '  gl_FragColor = vec4(vCol.rgb, a);',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 30 : 25;
    return { mesh: mesh, geo: geo, aPos: aPos, aCol: aCol, aMisc: aMisc, list: [] };
  }
  function totalParticles() { return pools.normal.list.length + pools.add.list.length; }
  var _col = new THREE.Color();
  function spawn(pool, p) {
    if (totalParticles() >= Math.min(CAP, quality.particles)) {
      if (p.kind === 'steam') return null;
      // recycle the oldest steam particle for important bursts
      var L = pools.normal.list, oi = -1, best = -1;
      for (var i = 0; i < L.length; i++) if (L[i].kind === 'steam' && L[i].age / L[i].life > best) { best = L[i].age / L[i].life; oi = i; }
      if (oi < 0) return null;
      L[oi] = L[L.length - 1]; L.pop();
    }
    pool.list.push(p);
    return p;
  }
  function vec(v) { return v && v.isVector3 ? v : (v && v.getWorldPosition ? v.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3()); }

  FX._init = function () {
    var atlas = makeAtlas();
    pools.normal = makePool(false, atlas);
    pools.add = makePool(true, atlas);
    scene.add(pools.normal.mesh); scene.add(pools.add.mesh);
    haloTex = canvasTex(256, 256, function (g) {
      var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0.0, 'rgba(255,255,255,0.22)');
      gr.addColorStop(0.42, 'rgba(255,255,255,0.5)');
      gr.addColorStop(0.62, 'rgba(255,255,255,0.78)');
      gr.addColorStop(0.78, 'rgba(255,255,255,0.32)');
      gr.addColorStop(1.0, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    });
    haloGeo = new THREE.PlaneGeometry(1, 1);
    haloGeo.rotateX(-Math.PI / 2);
  };

  function steamParticle(pos, size, rise, life) {
    var s = size * (0.75 + Math.random() * 0.5);
    return {
      kind: 'steam', cell: 0, pos: new THREE.Vector3(pos.x + (Math.random() - 0.5) * size * 0.4, pos.y, pos.z + (Math.random() - 0.5) * size * 0.4),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.02, rise * (0.7 + Math.random() * 0.5), (Math.random() - 0.5) * 0.02),
      age: 0, life: life * (0.8 + Math.random() * 0.4), s0: s * 0.6, s1: s * 2.6, rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 0.6,
      r: 1, g: 1, b: 1, a: 0.42 + Math.random() * 0.14, seed: Math.random() * 100, stretch: 1
    };
  }
  FX.steam = function (src, o) {
    o = o || {};
    var em = { src: src, rate: o.rate != null ? o.rate : 6, size: o.size || 0.05, rise: o.rise || 0.25, life: o.life || 1.6, acc: Math.random(), dead: false };
    emitters.push(em);
    return { stop: function () { em.dead = true; }, setRate: function (n) { em.rate = Math.max(0, +n || 0); } };
  };
  FX.puff = function (pos, o) {
    o = o || {};
    if (!pools.normal) return;
    var p0 = vec(typeof pos === 'function' ? pos() : pos);
    var count = o.count || 8, size = o.size || 0.05;
    if (quality.tier === 'low') count = Math.ceil(count * 0.5);
    for (var i = 0; i < count; i++) {
      var p = steamParticle(p0, size, 0.18, 1.2);
      p.vel.x += (Math.random() - 0.5) * 0.12; p.vel.z += (Math.random() - 0.5) * 0.12;
      spawn(pools.normal, p);
    }
  };
  FX.burst = function (pos, o) {
    o = o || {};
    if (!pools.normal) return;
    var p0 = vec(typeof pos === 'function' ? pos() : pos);
    var kind = o.kind || 'sparkle';
    var count = o.count != null ? o.count : 14;
    if (quality.tier === 'low') count = Math.ceil(count * 0.6);
    var speed = o.speed != null ? o.speed : (kind === 'sparkle' ? 0.22 : 0.35);
    var size = o.size || (kind === 'sparkle' ? 0.014 : kind === 'grain' ? 0.0062 : 0.004);
    _col.set(o.color != null ? o.color : (kind === 'sparkle' ? 0xffe2a0 : kind === 'grain' ? 0xf7f3ea : 0xeee6d6));
    var floorY = o.floor != null ? o.floor : Math.max(0.002, p0.y - 0.03);
    for (var i = 0; i < count; i++) {
      var th = Math.random() * Math.PI * 2, up = kind === 'sparkle' ? 0.2 + Math.random() * 0.8 : 0.5 + Math.random() * 0.6;
      var sp = speed * (0.5 + Math.random() * 0.7), hz = Math.sqrt(Math.max(0, 1 - up * up));
      var p = {
        kind: kind, cell: 1, pos: p0.clone(),
        vel: new THREE.Vector3(Math.cos(th) * hz * sp, up * sp, Math.sin(th) * hz * sp),
        age: 0, life: kind === 'sparkle' ? 0.55 + Math.random() * 0.5 : 1.2 + Math.random() * 0.6,
        s0: size * (0.7 + Math.random() * 0.6), s1: 0, rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * (kind === 'sparkle' ? 2 : 14),
        r: _col.r, g: _col.g, b: _col.b, a: kind === 'sparkle' ? 0.9 : 1, seed: Math.random() * 100,
        stretch: kind === 'grain' ? 0.5 : 1, floor: floorY
      };
      spawn(kind === 'sparkle' ? pools.add : pools.normal, p);
    }
  };
  FX.halo = function (src, o) {
    o = o || {};
    var radius = o.radius || 0.05;
    var mat = new THREE.MeshBasicMaterial({
      map: haloTex, color: o.color != null ? o.color : 0xfff2b0, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    });
    var m = new THREE.Mesh(haloGeo, mat);
    m.scale.setScalar(radius * 2 * 1.5);
    m.renderOrder = 20;
    m.frustumCulled = false;
    if (scene) scene.add(m);
    var h = { mesh: m, src: src, y: o.y != null ? o.y : 0.002, strength: 1, shown: 0, phase: Math.random() * 6, dead: false };
    halos.push(h);
    return {
      mesh: m,
      setStrength: function (v) { h.strength = G.clamp(+v || 0, 0, 1.5); },
      dispose: function () { if (h.dead) return; h.dead = true; if (m.parent) m.parent.remove(m); mat.dispose(); }
    };
  };
  FX.pulse = function (obj, o) {
    o = o || {};
    var col = new THREE.Color(o.color != null ? o.color : 0xffd070);
    var entries = [];
    if (obj && obj.traverse) obj.traverse(function (n) {
      if (!n.isMesh || !n.material) return;
      var orig = n.material;
      var arr = Array.isArray(orig) ? orig : [orig];
      var clones = arr.map(function (m) {
        if (!m || !m.emissive) return m;
        var c = m.clone(); c.userData.__pulseBase = m.emissive.clone(); return c;
      });
      n.material = Array.isArray(orig) ? clones : clones[0];
      entries.push({ mesh: n, orig: orig, clones: clones });
    });
    var pu = { entries: entries, color: col, strength: o.strength != null ? o.strength : 0.5, shown: 0, dead: false, phase: Math.random() * 6 };
    pulses.push(pu);
    return {
      setStrength: function (v) { pu.strength = Math.max(0, +v || 0); },
      stop: function () {
        if (pu.dead) return; pu.dead = true;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          var cur = e.mesh.material;
          var isOurs = Array.isArray(cur) ? cur === e.mesh.material && cur.every(function (m, j) { return m === e.clones[j]; }) : cur === e.clones[0];
          if (isOurs) e.mesh.material = e.orig;
          for (var j = 0; j < e.clones.length; j++) if (e.clones[j] && e.clones[j] !== (Array.isArray(e.orig) ? e.orig[j] : e.orig)) e.clones[j].dispose();
        }
      }
    };
  };
  FX.clearParticles = function () { if (pools.normal) { pools.normal.list.length = 0; pools.add.list.length = 0; } };

  var _hp = new THREE.Vector3();
  FX._update = function (dt) {
    if (!pools.normal) return;
    var t = G.time, i;
    // emitters
    for (i = emitters.length - 1; i >= 0; i--) {
      var em = emitters[i];
      if (em.dead) { emitters.splice(i, 1); continue; }
      var rate = em.rate * (quality.tier === 'low' ? 0.5 : 1);
      em.acc += rate * dt;
      if (em.acc >= 1) {
        var src = typeof em.src === 'function' ? safeCall(em.src, null, [], 'steam') : em.src;
        var p0 = src ? vec(src) : null;
        while (em.acc >= 1) {
          em.acc -= 1;
          if (p0) spawn(pools.normal, steamParticle(p0, em.size, em.rise, em.life));
        }
      }
    }
    // particles
    [pools.normal, pools.add].forEach(function (pool) {
      var L = pool.list, w = 0;
      for (var j = 0; j < L.length; j++) {
        var p = L[j];
        p.age += dt;
        if (p.age >= p.life) continue;
        var k = p.age / p.life;
        if (p.kind === 'steam') {
          p.vel.x += Math.sin(t * 1.3 + p.seed) * 0.03 * dt;
          p.vel.z += Math.cos(t * 1.1 + p.seed) * 0.02 * dt;
          p.vel.multiplyScalar(1 - 0.35 * dt);
          p.pos.addScaledVector(p.vel, dt);
          p.size = p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - k, 2));
          p.alpha = p.a * Math.min(1, k / 0.18) * Math.pow(1 - k, 1.4);
        } else if (p.kind === 'sparkle') {
          p.vel.multiplyScalar(1 - 2.2 * dt);
          p.vel.y += 0.03 * dt;
          p.pos.addScaledVector(p.vel, dt);
          p.size = p.s0 * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, k * 1.2 + 0.1)));
          p.alpha = p.a * Math.sin(Math.PI * k) * (0.75 + 0.25 * Math.sin(p.age * 28 + p.seed));
        } else { // grain / crumb
          if (!p.rest) {
            p.vel.y -= 3.2 * dt;
            p.vel.multiplyScalar(1 - 0.6 * dt);
            p.pos.addScaledVector(p.vel, dt);
            if (p.pos.y <= p.floor) { p.pos.y = p.floor; p.rest = true; p.rotV = 0; }
          }
          p.size = p.s0;
          p.alpha = p.a * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
        }
        p.rot += p.rotV * dt;
        L[w++] = p;
      }
      L.length = w;
      var n = Math.min(L.length, CAP);
      var ap = pool.aPos.array, ac = pool.aCol.array, am = pool.aMisc.array;
      for (var q = 0; q < n; q++) {
        var pp = L[q];
        ap[q * 3] = pp.pos.x; ap[q * 3 + 1] = pp.pos.y; ap[q * 3 + 2] = pp.pos.z;
        ac[q * 4] = pp.r; ac[q * 4 + 1] = pp.g; ac[q * 4 + 2] = pp.b; ac[q * 4 + 3] = pp.alpha;
        am[q * 4] = pp.size; am[q * 4 + 1] = pp.rot; am[q * 4 + 2] = pp.stretch; am[q * 4 + 3] = pp.cell;
      }
      pool.geo.instanceCount = n;
      if (n > 0) {
        pool.aPos.needsUpdate = true; pool.aCol.needsUpdate = true; pool.aMisc.needsUpdate = true;
      }
      pool.mesh.visible = n > 0;
    });
    // halos
    for (i = halos.length - 1; i >= 0; i--) {
      var h = halos[i];
      if (h.dead) { halos.splice(i, 1); continue; }
      var pos = null;
      if (typeof h.src === 'function') pos = safeCall(h.src, null, [], 'halo');
      else if (h.src && h.src.isObject3D) pos = h.src.getWorldPosition(_hp);
      else if (h.src && h.src.isVector3) pos = h.src;
      if (pos) {
        pos = vec(pos);
        h.mesh.position.set(pos.x, pos.y + h.y, pos.z);
        if (h.src && h.src.isObject3D) h.mesh.visible = isVisible(h.src);
      }
      h.shown = G.smooth(h.shown, pos ? h.strength : 0, 6, dt);
      var breath = 0.75 + 0.25 * Math.sin(t * 2.4 + h.phase);
      h.mesh.material.opacity = h.shown * breath * 0.42;
    }
    // pulses
    for (i = pulses.length - 1; i >= 0; i--) {
      var pu = pulses[i];
      if (pu.dead) { pulses.splice(i, 1); continue; }
      pu.shown = G.smooth(pu.shown, pu.strength, 6, dt);
      var v = pu.shown * (0.55 + 0.45 * Math.sin(t * 2.6 + pu.phase));
      for (var e = 0; e < pu.entries.length; e++) {
        var cl = pu.entries[e].clones;
        for (var c2 = 0; c2 < cl.length; c2++) {
          var m = cl[c2];
          if (m && m.emissive && m.userData.__pulseBase) {
            var sv = v / Math.max(0.01, m.emissiveIntensity || 1), bc = m.userData.__pulseBase;
            m.emissive.setRGB(bc.r + pu.color.r * sv, bc.g + pu.color.g * sv, bc.b + pu.color.b * sv);
          }
        }
      }
    }
  };

  // ------------------------------------------------------------------ hint
  var hint = null; // {opts, idle, level, halo, pulse, ghostT}
  var ghost = null;
  function getGhost() {
    if (ghost) return ghost;
    var pivot = new THREE.Group();
    var g = null;
    if (G.Hands && typeof G.Hands.createGhost === 'function') {
      try { g = G.Hands.createGhost(); } catch (e) { reportError('ghost', e); g = null; }
    }
    if (!g || !g.group) g = makeCapsuleGhost();
    pivot.add(g.group);
    pivot.visible = false;
    if (scene) scene.add(pivot);
    ghost = { pivot: pivot, g: g, op: 0 };
    return ghost;
  }
  function makeCapsuleGhost() {
    var group = new THREE.Group();
    var inner = new THREE.Group();
    inner.rotation.x = -0.55; // finger points forward-down, hand rises behind
    group.add(inner);
    var mat = new THREE.MeshStandardMaterial({ color: 0xe7a283, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false });
    var pre = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true });
    function add(geo) {
      var a = new THREE.Mesh(geo, pre); a.renderOrder = 40; inner.add(a);
      var b = new THREE.Mesh(geo, mat); b.renderOrder = 41; inner.add(b);
    }
    var fr = 0.0088, fl = 0.05;
    var finger = new THREE.CapsuleGeometry(fr, fl, 8, 18);
    finger.rotateX(Math.PI / 2); finger.translate(0, 0, fl / 2 + fr);
    add(finger);
    var curled = new THREE.CapsuleGeometry(0.0095, 0.03, 6, 14);
    curled.rotateZ(Math.PI / 2); curled.translate(0.004, -0.004, 0.066);
    add(curled);
    var hand = new THREE.SphereGeometry(1, 28, 18);
    hand.scale(0.031, 0.017, 0.042); hand.translate(0.003, 0.006, 0.098);
    add(hand);
    var thumb = new THREE.CapsuleGeometry(0.0085, 0.026, 6, 14);
    thumb.rotateX(Math.PI / 2); thumb.rotateY(-0.5); thumb.translate(-0.022, -0.002, 0.082);
    add(thumb);
    var tip = new THREE.Object3D(); group.add(tip);
    return {
      group: group, tip: tip,
      setOpacity: function (v) { mat.opacity = 0.5 * G.clamp(v, 0, 1); group.visible = v > 0.01; },
      setPress: function (p) { inner.scale.set(1 + 0.04 * p, 1 - 0.06 * p, 1); }
    };
  }
  function hintPos(fn) {
    if (!fn) return null;
    var v = typeof fn === 'function' ? safeCall(fn, null, [], 'hint') : fn;
    if (!v) return null;
    return v.isVector3 ? v : (v.getWorldPosition ? v.getWorldPosition(new THREE.Vector3()) : null);
  }
  function hintSetLevel(lv) {
    if (!hint || hint.level === lv) return;
    hint.level = lv;
    if (hint.halo) hint.halo.setStrength(lv === 0 ? 0.6 : lv === 1 ? 1.05 : 1.15);
    if (hint.pulse) hint.pulse.setStrength(lv === 0 ? 0.14 : 0.3);
    if (lv === 1 && G.Audio && G.Audio.play) safeCall(G.Audio.play, G.Audio, ['ping', { vol: 0.7 }], 'audio');
    if (lv === 2) hint.ghostT = 0;
    if (hint.opts.onLevel) safeCall(hint.opts.onLevel, null, [lv], 'hint');
  }
  var _g0 = new THREE.Vector3(), _g1 = new THREE.Vector3();
  var Hint = {
    set: function (o) {
      Hint.clear();
      if (!o) return;
      hint = { opts: o, idle: 0, level: 0, ghostT: 0, halo: null, pulse: null };
      var at = o.at;
      hint.halo = FX.halo(function () { return hintPos(at); }, { radius: o.radius || 0.05, color: o.color });
      hint.halo.setStrength(0.6);
      if (o.object) { hint.pulse = FX.pulse(o.object, { strength: 0.14 }); }
    },
    clear: function () {
      if (!hint) return;
      if (hint.halo) hint.halo.dispose();
      if (hint.pulse) hint.pulse.stop();
      hint = null;
      if (ghost) { ghost.op = 0; ghost.g.setOpacity(0); ghost.pivot.visible = false; }
    },
    poke: function () {
      if (!hint) return;
      hint.idle = 0;
      if (ghost) { ghost.op = 0; ghost.g.setOpacity(0); ghost.pivot.visible = false; }
      if (hint.level !== 0) hintSetLevel(0);
    },
    get level() { return hint ? hint.level : -1; },
    get active() { return !!hint; },
    _update: function (dt) {
      if (!hint) return;
      if (Input.active) hint.idle = 0; else hint.idle += dt;
      var lv = hint.idle >= 8 ? 2 : hint.idle >= 4 ? 1 : 0;
      if (lv > hint.level) hintSetLevel(lv);
      if (hint.level < 2) return;
      var gh = getGhost();
      hint.ghostT += dt;
      var kind = hint.opts.kind || 'tap';
      var a = hintPos(hint.opts.at);
      if (!a) { gh.g.setOpacity(0); gh.pivot.visible = false; return; }
      var pos = _g0, op = 0, press = 0, k;
      if (kind === 'drag') {
        var b = hintPos(hint.opts.to) || a;
        var T = 2.6, ph = (hint.ghostT % T) / T * T; // seconds into cycle
        if (ph < 0.35) { k = Ease.out(ph / 0.35); pos.copy(a).add(_g1.set(0, 0.05 * (1 - k) + 0.004, 0.03 * (1 - k))); op = k; press = k * 0.6; }
        else if (ph < 2.15) { k = Ease.inOut((ph - 0.35) / 1.8); pos.lerpVectors(a, b, k); pos.y = G.lerp(a.y, b.y, k) + 0.004 + Math.sin(Math.PI * k) * 0.012; op = 1; press = 0.6; }
        else { k = (ph - 2.15) / 0.45; pos.copy(b).add(_g1.set(0, 0.004 + 0.04 * k, 0.02 * k)); op = 1 - k; press = 0.6 * (1 - k); }
      } else {
        var T2 = kind === 'press' ? 2.4 : 1.6, s = hint.ghostT % T2;
        var down = kind === 'press' ? 0.55 : 0.45, hold = kind === 'press' ? 1.35 : 0.62;
        if (s < down) { k = Ease.inOut(s / down); pos.copy(a).add(_g1.set(0, 0.075 * (1 - k) + 0.004, 0.045 * (1 - k))); op = Math.min(1, s / 0.25); press = 0; }
        else if (s < hold) { k = (s - down) / (hold - down); var pr = kind === 'press' ? Math.min(1, k * 4) * (0.85 + 0.15 * Math.sin(k * 18)) : Math.sin(Math.PI * k); pos.copy(a); pos.y += 0.004 - 0.004 * pr; op = 1; press = pr; }
        else { k = Ease.inOut((s - hold) / (T2 - hold)); pos.copy(a).add(_g1.set(0, 0.004 + 0.07 * k, 0.05 * k)); op = 1 - k; press = 0; }
      }
      gh.pivot.visible = true;
      gh.pivot.position.copy(pos);
      gh.g.setOpacity(op);
      if (gh.g.setPress) gh.g.setPress(press);
    }
  };
  G.Hint = Hint;
})();
