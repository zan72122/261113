/* vfx.js — 水・泡・湯気・きらめき（G.vfx）
   build()
   water.setFlow(k) / water.hitY
   bubbles.emit(pos, n) / bubbles.popAt(p)
   steam.add(pos, scale) → {stop()} / steam.clear()
   sparkle(pos, {n, spread, size}) / glint(pos, size)
   spot.show(pos, radius) / spot.hide()
   drip(pos, floorY)
   粒はすべて固定長プールの Points 2 系統（ふつう合成 / 加算合成）で描く。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var T = null, built = false, low = false;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function damp(c, t, l, dt) { return c + (t - c) * (1 - Math.exp(-l * dt)); }
  function px(o, k, d) { return o && typeof o[k] === 'number' && isFinite(o[k]) ? o[k] : d; }
  function sinkFloor() { return G.L && G.L.sink ? G.L.sink.floorY : 0.68; }

  // ====================================================================
  // canvas テクスチャ
  // ====================================================================
  function cv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  function radial(ctx, x, y, r, stops) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (var i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  function ray(ctx, cx, cy, ang, len, thin, alpha) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ang); ctx.scale(1, thin);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    g.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
    g.addColorStop(0.25, 'rgba(255,250,240,' + alpha * 0.55 + ')');
    g.addColorStop(0.6, 'rgba(255,240,220,' + alpha * 0.16 + ')');
    g.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, len, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function toTex(c, repeat) {
    var t = new T.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    t.needsUpdate = true;
    return t;
  }

  // 加算用アトラス 2x2: 0 星(4点) / 1 光条 / 2 やわらかい円 / 3 輪
  function makeAddAtlas() {
    var S = 256, c = cv(S * 2), x = c.getContext('2d');
    // 0: 4 点星
    var cx = S * 0.5, cy = S * 0.5;
    x.globalCompositeOperation = 'lighter';
    radial(x, cx, cy, S * 0.22, [0, 'rgba(255,255,255,0.9)', 0.3, 'rgba(255,248,230,0.35)', 1, 'rgba(255,240,210,0)']);
    ray(x, cx, cy, 0, S * 0.49, 0.055, 1);
    ray(x, cx, cy, Math.PI / 2, S * 0.49, 0.055, 1);
    ray(x, cx, cy, Math.PI / 4, S * 0.22, 0.07, 0.45);
    ray(x, cx, cy, -Math.PI / 4, S * 0.22, 0.07, 0.45);
    radial(x, cx, cy, S * 0.05, [0, 'rgba(255,255,255,1)', 1, 'rgba(255,255,255,0)']);
    // 1: 横に長い光条
    cx = S * 1.5; cy = S * 0.5;
    ray(x, cx, cy, 0, S * 0.5, 0.018, 1);
    ray(x, cx, cy, 0, S * 0.3, 0.05, 0.5);
    ray(x, cx, cy, Math.PI / 2, S * 0.16, 0.05, 0.5);
    radial(x, cx, cy, S * 0.06, [0, 'rgba(255,255,255,0.9)', 1, 'rgba(255,255,255,0)']);
    // 2: やわらかい円
    radial(x, S * 0.5, S * 1.5, S * 0.5, [0, 'rgba(255,255,255,1)', 0.2, 'rgba(255,255,255,0.75)', 0.45, 'rgba(255,255,255,0.32)', 0.7, 'rgba(255,255,255,0.09)', 1, 'rgba(255,255,255,0)']);
    // 3: 輪
    radial(x, S * 1.5, S * 1.5, S * 0.5, [0, 'rgba(255,255,255,0)', 0.68, 'rgba(255,255,255,0)', 0.84, 'rgba(255,255,255,0.9)', 0.9, 'rgba(255,255,255,0.5)', 1, 'rgba(255,255,255,0)']);
    return toTex(c);
  }

  // ふつう合成用アトラス 2x2: 0 水の粒 / 1 湯気 / 2 シャボン玉 / 3 しずく
  function makeNormAtlas() {
    var S = 256, c = cv(S * 2), x = c.getContext('2d'), i;
    // 0: 水の粒（明るい芯 + うすい縁）
    var cx = S * 0.5, cy = S * 0.5, r = S * 0.46;
    radial(x, cx, cy, r, [0, 'rgba(235,245,255,0.95)', 0.45, 'rgba(205,222,235,0.7)', 0.8, 'rgba(170,190,205,0.35)', 1, 'rgba(170,190,205,0)']);
    radial(x, cx - r * 0.25, cy - r * 0.3, r * 0.3, [0, 'rgba(255,255,255,1)', 1, 'rgba(255,255,255,0)']);
    // 1: 湯気（やわらかいもや。小さな円を重ねる）
    cx = S * 1.5; cy = S * 0.5;
    for (i = 0; i < 18; i++) {
      var a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.2, rr = S * rnd(0.14, 0.26);
      radial(x, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, [0, 'rgba(255,255,255,0.16)', 0.5, 'rgba(255,255,255,0.08)', 1, 'rgba(255,255,255,0)']);
    }
    // 外へ向けてなめらかに消す
    x.save();
    x.beginPath(); x.rect(S, 0, S, S); x.clip();
    x.globalCompositeOperation = 'destination-in';
    var mg = x.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
    mg.addColorStop(0, 'rgba(0,0,0,1)'); mg.addColorStop(0.55, 'rgba(0,0,0,0.8)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = mg; x.fillRect(S, 0, S, S);
    x.restore();
    // 2: シャボン玉
    cx = S * 0.5; cy = S * 1.5; r = S * 0.47;
    radial(x, cx, cy, r, [0, 'rgba(255,255,255,0.025)', 0.7, 'rgba(255,255,255,0.05)', 0.86, 'rgba(255,255,255,0.18)', 0.95, 'rgba(255,255,255,0.5)', 0.985, 'rgba(255,255,255,0.75)', 1, 'rgba(255,255,255,0)']);
    var hues = [300, 45, 185, 120, 330, 200, 55, 280];
    x.save();
    x.beginPath(); x.arc(cx, cy, r * 0.99, 0, Math.PI * 2); x.clip();
    x.lineWidth = r * 0.1;
    for (i = 0; i < 24; i++) {
      var h = hues[i % hues.length], a0 = i / 24 * Math.PI * 2;
      x.strokeStyle = 'hsla(' + h + ',85%,65%,0.22)';
      x.beginPath(); x.arc(cx, cy, r * 0.91, a0, a0 + Math.PI * 2 / 24 + 0.03); x.stroke();
    }
    // 膜の中のうすい虹の渦（下側）
    x.lineWidth = r * 0.05;
    for (i = 0; i < 4; i++) {
      x.strokeStyle = 'hsla(' + hues[(i * 3) % 8] + ',80%,70%,0.07)';
      x.beginPath(); x.arc(cx + r * 0.1, cy + r * 0.25, r * (0.45 + i * 0.09), 0.2, 2.6); x.stroke();
    }
    x.restore();
    // 窓の映り込み（左上、4 枚の窓ガラス）
    x.save();
    x.translate(cx - r * 0.42, cy - r * 0.44); x.rotate(-0.35);
    x.shadowColor = 'rgba(255,255,255,0.9)'; x.shadowBlur = r * 0.06;
    x.fillStyle = 'rgba(255,255,255,0.85)';
    var pw = r * 0.15, ph = r * 0.12, g = r * 0.03;
    x.fillRect(-pw - g / 2, -ph - g / 2, pw, ph); x.fillRect(g / 2, -ph - g / 2, pw * 0.9, ph);
    x.fillStyle = 'rgba(255,255,255,0.6)';
    x.fillRect(-pw - g / 2, g / 2, pw, ph * 0.85); x.fillRect(g / 2, g / 2, pw * 0.9, ph * 0.85);
    x.restore();
    // 右下の弱い映り込み
    x.save();
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = r * 0.05; x.lineCap = 'round';
    x.shadowColor = 'rgba(255,255,255,0.6)'; x.shadowBlur = r * 0.05;
    x.beginPath(); x.arc(cx, cy, r * 0.8, 0.35, 1.05); x.stroke();
    x.restore();
    // 3: しずく（少し縦長の粒）
    cx = S * 1.5; cy = S * 1.5;
    x.save(); x.translate(cx, cy); x.scale(0.75, 1);
    radial(x, 0, 0, S * 0.45, [0, 'rgba(225,238,250,0.9)', 0.55, 'rgba(195,212,228,0.6)', 0.85, 'rgba(150,170,190,0.5)', 1, 'rgba(150,170,190,0)']);
    radial(x, -S * 0.12, -S * 0.15, S * 0.13, [0, 'rgba(255,255,255,1)', 1, 'rgba(255,255,255,0)']);
    x.restore();
    return toTex(c);
  }

  // 水の筋（縦に流れる明るい線）
  function makeStreakTex() {
    var c = cv(64, 256), x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 64, 256);
    for (var i = 0; i < 40; i++) {
      var sx = Math.random() * 64, len = rnd(40, 220), y0 = Math.random() * 256, w = rnd(0.8, 3), a = rnd(0.25, 0.9);
      var g = x.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,' + a + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      for (var k = -1; k <= 1; k++) for (var m = -1; m <= 1; m++) x.fillRect(sx - w / 2 + k * 64, y0 + m * 256, w, len);
    }
    return toTex(c, true);
  }

  // ====================================================================
  // 粒システム（Points + 自前シェーダ。1 系統 = 1 draw call）
  // ====================================================================
  var PV = [
    'attribute float aSize; attribute float aPx; attribute float aAlpha; attribute float aRot; attribute float aCell; attribute vec3 aColor;',
    'uniform float uScale; uniform float uPR; uniform float uPush;',
    'varying float vA; varying float vR; varying vec3 vC; varying vec2 vOff;',
    'void main(){',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float z = max(0.02, -mv.z);',
    '  mv.xyz += normalize(-mv.xyz) * min(uPush, z * 0.5);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = aAlpha > 0.0 ? (aSize * uScale / z + aPx * uPR) : 0.0;',
    '  vA = aAlpha; vR = aRot; vC = aColor;',
    '  vOff = vec2(mod(aCell, 2.0), 1.0 - floor(aCell / 2.0 + 0.01)) * 0.5;',
    '}'
  ].join('\n');
  var PF = [
    'uniform sampler2D uTex;',
    'varying float vA; varying float vR; varying vec3 vC; varying vec2 vOff;',
    'void main(){',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float s = sin(vR), k = cos(vR);',
    '  c = vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;',
    '  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) discard;',
    '  c.y = 1.0 - c.y;',
    '  vec4 t = texture2D(uTex, vOff + c * 0.5);',
    '  float a = t.a * vA;',
    '  if (a < 0.003) discard;',
    '  gl_FragColor = vec4(t.rgb * vC, a);',
    '}'
  ].join('\n');

  function PSys(max, tex, additive, push, order) {
    this.max = max;
    this.ps = [];
    for (var i = 0; i < max; i++) this.ps.push({ alive: false });
    var g = new T.BufferGeometry();
    this.aPos = new T.BufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new T.BufferAttribute(new Float32Array(max), 1);
    this.aPx = new T.BufferAttribute(new Float32Array(max), 1);
    this.aAlpha = new T.BufferAttribute(new Float32Array(max), 1);
    this.aRot = new T.BufferAttribute(new Float32Array(max), 1);
    this.aCell = new T.BufferAttribute(new Float32Array(max), 1);
    this.aColor = new T.BufferAttribute(new Float32Array(max * 3), 3);
    var list = [this.aPos, this.aSize, this.aPx, this.aAlpha, this.aRot, this.aCell, this.aColor];
    for (i = 0; i < list.length; i++) list[i].setUsage(T.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aPx', this.aPx);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aRot', this.aRot);
    g.setAttribute('aCell', this.aCell);
    g.setAttribute('aColor', this.aColor);
    g.setDrawRange(0, 0);
    this.uni = { uTex: { value: tex }, uScale: { value: 500 }, uPR: { value: 1 }, uPush: { value: push || 0 } };
    var m = new T.ShaderMaterial({
      uniforms: this.uni, vertexShader: PV, fragmentShader: PF,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? T.AdditiveBlending : T.NormalBlending
    });
    m.toneMapped = false;
    this.pts = new T.Points(g, m);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = order || 0;
    this.geo = g;
  }
  PSys.prototype.get = function () {
    for (var i = 0; i < this.max; i++) if (!this.ps[i].alive) { var p = this.ps[i]; p.alive = true; return p; }
    return null;
  };
  PSys.prototype.flush = function () {
    var n = 0, P = this.aPos.array, S = this.aSize.array, X = this.aPx.array, A = this.aAlpha.array,
      R = this.aRot.array, C = this.aCell.array, K = this.aColor.array;
    for (var i = 0; i < this.max; i++) {
      var p = this.ps[i];
      if (!p.alive || p.oa <= 0) continue;
      P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z;
      S[n] = p.os; X[n] = p.opx; A[n] = p.oa; R[n] = p.rot; C[n] = p.cell;
      K[n * 3] = p.r; K[n * 3 + 1] = p.g; K[n * 3 + 2] = p.b;
      n++;
    }
    this.geo.setDrawRange(0, n);
    if (n > 0) {
      this.aPos.needsUpdate = this.aSize.needsUpdate = this.aPx.needsUpdate = this.aAlpha.needsUpdate = true;
      this.aRot.needsUpdate = this.aCell.needsUpdate = this.aColor.needsUpdate = true;
    }
    this.pts.visible = n > 0;
  };

  // 粒の種類
  var SPRAY = 1, STEAM = 2, BUBBLE = 3, DROP = 4, STAR = 5, GL_HALO = 6, GL_STAR = 7, GL_STREAK = 8;
  var CAP_N = { normal: [0, 110, 36, 14, 8], low: [0, 45, 24, 14, 8] };
  var count = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  var NS = null, AS = null;   // normal / additive 系統
  function total() { var s = 0; for (var i = 1; i < count.length; i++) s += count[i]; return s; }
  function budget() { return (G.quality && G.quality.maxParticles) || 300; }
  function cap(type) {
    var c = low ? CAP_N.low : CAP_N.normal;
    if (type <= 4) return c[type];
    return low ? 34 : 54;
  }
  function spawn(sys, type) {
    if (!sys) return null;
    var cnt = type >= STAR ? count[STAR] + count[GL_HALO] + count[GL_STAR] + count[GL_STREAK] : count[type];
    if (cnt >= cap(type) || total() >= budget()) return null;
    var p = sys.get();
    if (!p) return null;
    count[type]++;
    p.type = type; p.age = 0; p.life = 1; p.x = p.y = p.z = 0; p.vx = p.vy = p.vz = 0;
    p.os = 0; p.opx = 0; p.oa = 0; p.rot = 0; p.vr = 0; p.cell = 0; p.r = p.g = p.b = 1;
    p.s0 = 0; p.s1 = 0; p.px0 = 0; p.a0 = 1; p.floor = -1e9; p.ph = Math.random() * 6.283; p.pop = -1;
    return p;
  }
  function kill(p) { if (p.alive) { p.alive = false; p.oa = 0; count[p.type]--; } }

  function spray(x, y, z, n, o) {
    o = o || {};
    var sp = o.speed || 1, up = o.up || 1, sz = o.size || 1, fl = o.floor != null ? o.floor : sinkFloor();
    for (var i = 0; i < n; i++) {
      var p = spawn(NS, SPRAY); if (!p) return;
      var a = Math.random() * 6.283, v = rnd(0.12, 0.6) * sp;
      p.x = x + Math.cos(a) * 0.004; p.y = y; p.z = z + Math.sin(a) * 0.004;
      p.vx = Math.cos(a) * v; p.vz = Math.sin(a) * v; p.vy = rnd(0.15, 0.75) * up;
      p.life = rnd(0.3, 0.6); p.s0 = rnd(0.0016, 0.0038) * sz; p.px0 = 1.8;
      p.cell = 0; p.a0 = rnd(0.55, 0.9); p.floor = fl;
      p.r = 0.95; p.g = 0.97; p.b = 1;
    }
  }

  // ====================================================================
  // 水の柱
  // ====================================================================
  var WV = [
    'uniform float uR; uniform float uLen; uniform float uTime; uniform float uMouthY; uniform float uTop;',
    'varying vec3 vN; varying vec3 vV; varying float vU; varying float vD;',
    'void main(){',
    '  float t = -position.y;',
    '  float wy = uTop - t * uLen;',
    '  float d = max(0.0, uMouthY - wy);',
    '  float tb = clamp(d / 0.38, 0.0, 1.0); tb = tb * tb;',
    '  float ang = atan(position.z, position.x);',
    '  float r = uR * (1.0 - 0.22 * clamp(d / 0.4, 0.0, 1.0));',
    '  r *= 1.0 + tb * (0.16 * sin(ang * 3.0 + wy * 70.0 + uTime * 23.0) + 0.12 * sin(wy * 110.0 - uTime * 41.0));',
    '  vec3 p = vec3(position.x * r, -t * uLen, position.z * r);',
    '  p.x += tb * uR * 0.45 * sin(wy * 23.0 + uTime * 17.0);',
    '  p.z += tb * uR * 0.45 * cos(wy * 19.0 - uTime * 13.0);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vN = normalize(normalMatrix * vec3(position.x, 0.0, position.z));',
    '  vV = -mv.xyz; vU = uv.x; vD = d;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var WF = [
    'uniform sampler2D uStreak; uniform float uTime; uniform float uAlpha; uniform vec3 uTint;',
    'varying vec3 vN; varying vec3 vV; varying float vU; varying float vD;',
    'void main(){',
    '  vec3 n = normalize(vN); vec3 v = normalize(vV);',
    '  float ndv = abs(dot(n, v));',
    '  float fres = pow(1.0 - ndv, 2.2);',
    '  float s1 = texture2D(uStreak, vec2(vU * 2.0, vD * 2.6 - uTime * 2.3)).r;',
    '  float s2 = texture2D(uStreak, vec2(vU * 3.0 + 0.37, vD * 4.4 - uTime * 3.2)).r;',
    '  float s = s1 * 0.6 + s2 * 0.4;',
    '  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));',
    '  float sp = pow(max(dot(n, normalize(L + v)), 0.0), 50.0) * 1.3;',
    '  vec3 L2 = normalize(vec3(0.7, 0.15, 0.7));',
    '  float sp2 = pow(max(dot(n, normalize(L2 + v)), 0.0), 24.0) * 0.35;',
    '  float core = smoothstep(0.55, 1.0, ndv);',
    '  vec3 col = mix(uTint * 0.62, vec3(0.96, 0.98, 1.0), clamp(fres * 0.85 + s * 0.45, 0.0, 1.0));',
    '  col += (sp + sp2) * vec3(1.0, 0.97, 0.92) + core * s * 0.15;',
    '  float a = (0.2 + 0.7 * fres + 0.28 * s + sp * 0.8 + sp2) * uAlpha;',
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));',
    '}'
  ].join('\n');

  var W = { target: 0, k: 0, rk: 0, on: false, tail: 0, head: 0, tailV: 0, headV: 0, sprayAcc: 0, ringAcc: 0, film: 0, mx: 0, my: 1.1, mz: 0 };
  var waterMesh = null, waterU = null, impact = null, filmMesh = null, rings = [];
  var tmpV = null;

  function mouth() {
    var m = G.L && G.L.faucet ? G.L.faucet.mouth : { x: -0.72, y: 1.1, z: -0.04 };
    var x = m.x, y = m.y, z = m.z;
    if (G.world && G.world.faucet && typeof G.world.faucet.mouthPos === 'function') {
      try {
        var r = G.world.faucet.mouthPos(tmpV);
        if (r && isFinite(r.x) && isFinite(r.y) && isFinite(r.z)) { x = r.x; y = r.y; z = r.z; }
      } catch (e) {}
    }
    W.mx = x; W.my = y; W.mz = z;
  }

  function ring(x, y, z, r0, r1, life, a0) {
    for (var i = 0; i < rings.length; i++) {
      var R = rings[i];
      if (R.alive) continue;
      R.alive = true; R.age = 0; R.life = life; R.r0 = r0; R.r1 = r1; R.a0 = a0;
      R.mesh.position.set(x, y, z);
      R.mesh.visible = true;
      return;
    }
  }

  function buildWater() {
    var geo = new T.CylinderGeometry(1, 1, 1, 16, 28, true);
    geo.translate(0, -0.5, 0);
    waterU = {
      uR: { value: 0.004 }, uLen: { value: 0.3 }, uTime: { value: 0 }, uMouthY: { value: 1.1 }, uTop: { value: 1.1 },
      uStreak: { value: makeStreakTex() }, uAlpha: { value: 1 }, uTint: { value: new T.Color(0.74, 0.8, 0.82) }
    };
    var m = new T.ShaderMaterial({ uniforms: waterU, vertexShader: WV, fragmentShader: WF, transparent: true, depthWrite: false, side: T.DoubleSide });
    m.toneMapped = false;
    waterMesh = new T.Mesh(geo, m);
    waterMesh.frustumCulled = false;
    waterMesh.renderOrder = 5;
    waterMesh.visible = false;
    G.scene.add(waterMesh);

    var plane = new T.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    function flat(tex, op, order, additive) {
      var mm = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false, color: 0xffffff,
        blending: additive ? T.AdditiveBlending : T.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      mm.toneMapped = false;
      var me = new T.Mesh(plane, mm);
      me.renderOrder = order; me.visible = false; me.frustumCulled = false;
      G.scene.add(me);
      return me;
    }
    impact = flat(texSoft, 0, 4);
    filmMesh = flat(texSoft, 0, 3);
    for (var i = 0; i < 8; i++) rings.push({ alive: false, mesh: flat(texRing, 0, 3) });
  }

  function updateWater(dt, time) {
    mouth();
    var hitY = typeof water.hitY === 'number' && isFinite(water.hitY) ? water.hitY : sinkFloor() + 0.05;
    if (hitY > W.my - 0.01) hitY = W.my - 0.01;
    var floorY = Math.min(sinkFloor(), hitY);
    W.k = damp(W.k, W.target, 5, dt);
    if (W.target > 0.001) {
      if (!W.on) { W.on = true; W.head = W.my; W.headV = 0.6; }
      W.tail = W.my; W.tailV = 0;
      W.rk = W.k;
    } else if (W.on) {
      W.tailV += 9.8 * dt; W.tail -= W.tailV * dt;
    }
    if (W.on) {
      if (W.head > hitY) { W.headV += 9.8 * dt; W.head = Math.max(hitY, W.head - W.headV * dt); }
      else W.head = hitY;
      if (W.tail <= W.head + 0.002) W.on = false;
    }
    var vis = W.on && W.tail - W.head > 0.002;
    waterMesh.visible = vis;
    var kk = Math.max(W.rk, 0.02);
    if (vis) {
      waterMesh.position.set(W.mx, W.tail, W.mz);
      waterU.uTop.value = W.tail;
      waterU.uLen.value = W.tail - W.head;
      waterU.uMouthY.value = W.my;
      waterU.uR.value = 0.002 + 0.0035 * kk;
      waterU.uTime.value = time;
      waterU.uAlpha.value = clamp(0.65 + 0.35 * kk, 0, 1);
    }
    var hitting = W.on && W.head <= hitY + 0.0005;
    var flowK = hitting ? kk : 0;
    // しぶき
    if (hitting) {
      W.sprayAcc += dt * (low ? 28 : 70) * (0.35 + 0.65 * kk);
      var n = Math.floor(W.sprayAcc); W.sprayAcc -= n;
      if (n > 0) spray(W.mx, hitY, W.mz, n, { speed: 0.7 + 0.6 * kk, up: 0.55 + 0.5 * kk, floor: floorY });
      W.ringAcc += dt;
      if (W.ringAcc > 0.3) {
        W.ringAcc = 0;
        ring(W.mx + rnd(-0.006, 0.006), floorY + 0.003, W.mz + rnd(-0.006, 0.006), 0.012, 0.09 + 0.07 * kk, rnd(1.0, 1.4), 0.12 + 0.12 * kk);
      }
    }
    // 当たった所の白いきらめき
    if (flowK > 0) {
      impact.visible = true;
      impact.position.set(W.mx, hitY + 0.002, W.mz);
      var s = 0.03 + 0.03 * kk + 0.004 * Math.sin(time * 37);
      impact.scale.set(s, 1, s);
      impact.material.opacity = (0.22 + 0.06 * Math.sin(time * 29)) * (0.5 + 0.5 * kk);
    } else impact.visible = false;
    // 流しの底にうすく広がる水の膜
    W.film = damp(W.film, flowK > 0 ? 0.5 + 0.5 * kk : 0, flowK > 0 ? 0.8 : 0.5, dt);
    if (W.film > 0.01) {
      filmMesh.visible = true;
      filmMesh.position.set(W.mx, floorY + 0.002, W.mz + 0.01);
      var fs = 0.1 + 0.2 * W.film;
      filmMesh.scale.set(fs, 1, fs * 0.9);
      filmMesh.material.opacity = 0.09 * W.film;
    } else filmMesh.visible = false;
    for (var i = 0; i < rings.length; i++) {
      var R = rings[i];
      if (!R.alive) continue;
      R.age += dt;
      var t = R.age / R.life;
      if (t >= 1) { R.alive = false; R.mesh.visible = false; continue; }
      var e = 1 - Math.pow(1 - t, 2.2);
      var rr = (R.r0 + (R.r1 - R.r0) * e) * 2;
      R.mesh.scale.set(rr, 1, rr);
      R.mesh.material.opacity = R.a0 * Math.min(1, t * 8) * Math.pow(1 - t, 1.5);
    }
  }

  // ====================================================================
  // 光の輪（spot）
  // ====================================================================
  var SP = { group: null, disc: null, rim: null, conv: [], a: 0, target: 0, r: 0.1 };
  function buildSpot() {
    var g = new T.Group(), plane = new T.PlaneGeometry(2, 2);
    plane.rotateX(-Math.PI / 2);
    function mk(tex, order) {
      var m = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, color: 0xffb46a });
      m.toneMapped = false;
      var me = new T.Mesh(plane, m);
      me.renderOrder = order;
      g.add(me);
      return me;
    }
    SP.disc = mk(texSoft, 6);
    SP.rim = mk(texRing, 7);
    SP.conv = [mk(texRing, 7), mk(texRing, 7)];
    g.visible = false;
    SP.group = g;
    G.scene.add(g);
  }
  function updateSpot(dt, time) {
    SP.a = SP.target > SP.a ? Math.min(SP.target, SP.a + dt / 0.3) : Math.max(SP.target, SP.a - dt / 0.3);
    if (SP.a <= 0) { SP.group.visible = false; return; }
    SP.group.visible = true;
    var a = SP.a * SP.a * (3 - 2 * SP.a), r = SP.r, pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    SP.disc.scale.setScalar(r * 1.25);
    SP.disc.material.opacity = a * (0.14 + 0.07 * pulse);
    SP.rim.scale.setScalar(r * (1.0 + 0.03 * pulse));
    SP.rim.material.opacity = a * (0.3 + 0.14 * pulse);
    for (var i = 0; i < SP.conv.length; i++) {
      var t = ((time * 0.6) + i * 0.5) % 1;           // 外 → 内へ集まる
      var m = SP.conv[i];
      m.scale.setScalar(r * (1.55 - 0.55 * t));
      m.material.opacity = a * 0.28 * Math.sin(Math.PI * t);
    }
  }

  // ====================================================================
  // 湯気
  // ====================================================================
  var steamSrc = [], steamGen = 0;
  function updateSteamSources(dt) {
    var per = low ? 4 : 6, life = 3.2;
    for (var i = 0; i < steamSrc.length; i++) {
      var s = steamSrc[i];
      if (!s.on) continue;
      s.acc += dt;
      var iv = life / per;
      while (s.acc >= iv) {
        s.acc -= iv;
        if (s.n >= per) continue;
        var p = spawn(NS, STEAM); if (!p) break;
        p.src = s; s.n++;
        var sc = s.scale;
        p.x = s.x + rnd(-0.012, 0.012) * sc; p.y = s.y + rnd(0, 0.01) * sc; p.z = s.z + rnd(-0.012, 0.012) * sc;
        p.vy = rnd(0.06, 0.09) * sc; p.vx = rnd(-0.006, 0.006); p.vz = rnd(-0.006, 0.006);
        p.life = life * rnd(0.85, 1.1); p.s0 = 0.04 * sc; p.s1 = rnd(0.15, 0.2) * sc;
        p.cell = 1; p.a0 = rnd(0.3, 0.4); p.rot = Math.random() * 6.283; p.vr = rnd(-0.25, 0.25);
        p.r = 1; p.g = 0.985; p.b = 0.97; p.sc = sc;
      }
    }
  }

  // ====================================================================
  // 粒の更新
  // ====================================================================
  function updateParticles(dt, time) {
    var i, p, t, sys = [NS, AS];
    for (var q = 0; q < 2; q++) {
      var S = sys[q];
      for (i = 0; i < S.max; i++) {
        p = S.ps[i];
        if (!p.alive) continue;
        p.age += dt;
        if (p.type === BUBBLE) { updBubble(p, dt, time); continue; }
        t = p.age / p.life;
        if (t >= 1) { if (p.type === STEAM && p.src) p.src.n--; kill(p); continue; }
        switch (p.type) {
          case SPRAY:
            p.vy -= 9.8 * dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            if (p.y < p.floor) { kill(p); continue; }
            p.os = p.s0; p.opx = p.px0; p.oa = p.a0 * (1 - t * t);
            break;
          case DROP:
            p.vy -= 9.8 * dt;
            p.y += p.vy * dt;
            if (p.y <= p.floor) {
              spray(p.x, p.floor + 0.002, p.z, low ? 3 : 5, { speed: 0.35, up: 0.45, size: 0.8, floor: p.floor - 0.001 });
              ring(p.x, p.floor + 0.002, p.z, 0.003, 0.028, 0.6, 0.3);
              kill(p); continue;
            }
            p.os = p.s0; p.opx = 1.5; p.oa = p.a0 * Math.min(1, p.age * 10);
            break;
          case STEAM:
            p.vy = damp(p.vy, 0.045 * p.sc, 0.6, dt);
            p.x += (p.vx + Math.sin(time * 0.9 + p.ph) * 0.018 * p.sc) * dt;
            p.z += (p.vz + Math.cos(time * 0.7 + p.ph) * 0.01 * p.sc) * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            p.os = p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - t, 1.6));
            p.oa = p.a0 * Math.min(1, t / 0.22) * Math.pow(1 - t, 1.4);
            break;
          case STAR:
            var e = t < 0.22 ? 1 - Math.pow(1 - t / 0.22, 2) : Math.pow(1 - (t - 0.22) / 0.78, 1.6);
            p.rot += p.vr * dt;
            p.opx = p.px0 * (0.25 + 0.75 * e); p.oa = e * p.a0;
            break;
          case GL_HALO: case GL_STAR: case GL_STREAK:
            var g = t < 0.16 ? 1 - Math.pow(1 - t / 0.16, 3) : Math.pow(1 - (t - 0.16) / 0.84, 1.8);
            var sz = p.type === GL_STREAK ? 0.45 + 0.55 * Math.min(1, t / 0.3) : 0.3 + 0.7 * g;
            p.rot += p.vr * dt;
            p.opx = p.px0 * sz; p.oa = g * p.a0;
            break;
        }
      }
    }
  }

  // ====================================================================
  // シャボン玉
  // ====================================================================
  function updBubble(p, dt, time) {
    if (p.pop >= 0) {
      p.pop += dt;
      var k = p.pop / 0.08;
      if (k >= 1) { kill(p); return; }
      p.os = p.s0 * (1 + 0.25 * k); p.oa = 1 - k;
      return;
    }
    if (p.age >= p.life || p.y > 1.5) { popBubble(p); return; }
    p.vy = damp(p.vy, p.vt, 0.8, dt);
    p.bx += p.vx * dt; p.bz += p.vz * dt; p.y += p.vy * dt;
    p.x = p.bx + Math.sin(p.age * p.w + p.ph) * 0.014;
    p.z = p.bz + Math.cos(p.age * p.w * 0.8 + p.ph) * 0.008;
    var g = Math.min(1, p.age / 0.4);
    p.os = p.s0 * (0.3 + 0.7 * (1 - Math.pow(1 - g, 3))) * (1 + 0.025 * Math.sin(time * 6 + p.ph));
    p.oa = Math.min(1, p.age / 0.25);
  }
  function popBubble(p) {
    if (p.pop >= 0) return;
    p.pop = 0;
    var n = low ? 4 : 7, r = p.s0 * 0.5;
    for (var i = 0; i < n; i++) {
      var d = spawn(NS, SPRAY); if (!d) break;
      var a = Math.random() * 6.283, b = rnd(-1, 1), c = Math.sqrt(1 - b * b), v = rnd(0.25, 0.55);
      d.x = p.x + Math.cos(a) * c * r; d.y = p.y + b * r; d.z = p.z + Math.sin(a) * c * r;
      d.vx = Math.cos(a) * c * v; d.vy = b * v + 0.1; d.vz = Math.sin(a) * c * v;
      d.life = rnd(0.2, 0.35); d.s0 = rnd(0.0008, 0.0016); d.px0 = 1; d.cell = 0; d.a0 = 0.7; d.floor = -1e9;
    }
  }

  // ====================================================================
  // 毎フレーム
  // ====================================================================
  function update(dt, time) {
    if (!built) return;
    dt = Math.min(dt || 0, 0.1);
    time = time || 0;
    var R = G.renderer, C = G.camera;
    if (R && C) {
      var h = R.domElement ? R.domElement.height : 800;
      var sc = h / (2 * Math.tan(C.fov * Math.PI / 360));
      var pr = R.getPixelRatio ? R.getPixelRatio() : 1;
      NS.uni.uScale.value = AS.uni.uScale.value = sc;
      NS.uni.uPR.value = AS.uni.uPR.value = pr;
    }
    try { updateWater(dt, time); } catch (e) { report(e); }
    try { updateSpot(dt, time); } catch (e) { report(e); }
    updateSteamSources(dt);
    updateParticles(dt, time);
    NS.flush(); AS.flush();
  }
  var reported = {};
  function report(e) { var k = String(e && e.message); if (reported[k]) return; reported[k] = 1; try { console.error('[vfx]', e); } catch (_) {} }

  // ====================================================================
  // 公開 API
  // ====================================================================
  var texSoft = null, texRing = null;
  var water = {
    hitY: sinkFloor() + 0.05,
    setFlow: function (k) { W.target = clamp(+k || 0, 0, 1); }
  };
  var bubbles = {
    emit: function (pos, n) {
      if (!built || !pos) return;
      n = Math.max(0, Math.min(14, Math.floor(n == null ? 1 : n)));
      var x = px(pos, 'x', 0), y = px(pos, 'y', 0), z = px(pos, 'z', 0);
      for (var i = 0; i < n; i++) {
        var p = spawn(NS, BUBBLE); if (!p) return;
        p.bx = x + rnd(-0.03, 0.03); p.y = y + rnd(0, 0.025); p.bz = z + rnd(-0.03, 0.03);
        p.x = p.bx; p.z = p.bz;
        p.vx = rnd(-0.015, 0.015); p.vz = rnd(-0.01, 0.01); p.vy = 0.02; p.vt = rnd(0.05, 0.11);
        p.w = rnd(1.2, 2.2); p.life = rnd(4, 7); p.s0 = rnd(0.015, 0.04);
        p.cell = 2; p.rot = 0; p.r = 1; p.g = 1; p.b = 1;
        p.age = -i * 0.12;   // 少しずつ時間差で
      }
    },
    popAt: function (pt) {
      if (!built || !pt || typeof G.screenDist !== 'function') return false;
      var best = null, bd = 50;
      for (var i = 0; i < NS.max; i++) {
        var p = NS.ps[i];
        if (!p.alive || p.type !== BUBBLE || p.pop >= 0 || p.age < 0) continue;
        tmpV.set(p.x, p.y, p.z);
        var d = G.screenDist(pt, tmpV);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return false;
      popBubble(best);
      return true;
    },
    count: function () { return count[BUBBLE]; }
  };
  var steam = {
    add: function (pos, scale) {
      var dummy = { stop: function () {} };
      if (!built || !pos) return dummy;
      var s = null, i;
      for (i = 0; i < steamSrc.length; i++) if (!steamSrc[i].on) { s = steamSrc[i]; break; }
      if (!s) {
        if (steamSrc.length < 6) { s = { n: 0 }; steamSrc.push(s); }
        else { s = steamSrc[0]; for (i = 1; i < steamSrc.length; i++) if (steamSrc[i].gen < s.gen) s = steamSrc[i]; }
      }
      s.on = true; s.gen = ++steamGen; s.acc = 0.5; s.scale = clamp(+scale || 1, 0.2, 5);
      s.x = px(pos, 'x', 0); s.y = px(pos, 'y', 0); s.z = px(pos, 'z', 0);
      if (s.n == null) s.n = 0;
      var gen = s.gen;
      return { stop: function () { if (s.gen === gen) s.on = false; } };
    },
    clear: function () { for (var i = 0; i < steamSrc.length; i++) steamSrc[i].on = false; }
  };
  function sparkle(pos, o) {
    if (!built || !pos) return;
    o = o || {};
    var n = Math.max(0, Math.min(24, Math.floor(o.n == null ? 5 : o.n))), spread = o.spread == null ? 0.08 : +o.spread || 0,
      size = o.size == null ? 1 : +o.size || 1;
    var x = px(pos, 'x', 0), y = px(pos, 'y', 0), z = px(pos, 'z', 0);
    for (var i = 0; i < n; i++) {
      var p = spawn(AS, STAR); if (!p) return;
      var a = Math.random() * 6.283, b = rnd(-1, 1), c = Math.sqrt(1 - b * b), r = spread * Math.sqrt(Math.random());
      p.x = x + Math.cos(a) * c * r; p.y = y + b * r * 0.6; p.z = z + Math.sin(a) * c * r;
      p.life = rnd(0.55, 0.8); p.age = -i * rnd(0.02, 0.06);
      p.px0 = rnd(14, 30) * size; p.a0 = rnd(0.75, 1);
      p.cell = 0; p.rot = rnd(-0.3, 0.3); p.vr = rnd(-1.2, 1.2);
      var w = Math.random();
      p.r = 1; p.g = 0.93 + 0.06 * w; p.b = 0.8 + 0.18 * w;
    }
  }
  function glint(pos, size) {
    if (!built || !pos) return;
    size = size == null ? 1 : +size || 1;
    var x = px(pos, 'x', 0), y = px(pos, 'y', 0), z = px(pos, 'z', 0);
    var parts = [[GL_HALO, 2, 1.4, 0.3, 0], [GL_STREAK, 1, 3.0, 0.85, 0], [GL_STAR, 0, 1.0, 1, 1]];
    var tilt = rnd(-0.12, 0.12);
    for (var i = 0; i < parts.length; i++) {
      var p = spawn(AS, parts[i][0]); if (!p) return;
      p.x = x; p.y = y; p.z = z;
      p.life = 0.62; p.cell = parts[i][1]; p.px0 = 70 * parts[i][2] * size; p.a0 = parts[i][3];
      p.rot = parts[i][4] ? -0.25 : tilt; p.vr = parts[i][4] ? 0.8 : 0;
      p.r = 1; p.g = parts[i][0] === GL_HALO ? 0.85 : 0.96; p.b = parts[i][0] === GL_HALO ? 0.62 : 0.88;
    }
  }
  var spot = {
    show: function (pos, radius) {
      if (!built || !pos) return;
      SP.r = clamp(+radius || 0.1, 0.01, 2);
      SP.group.position.set(px(pos, 'x', 0), px(pos, 'y', 0) + 0.002, px(pos, 'z', 0));
      SP.target = 1;
    },
    hide: function () { SP.target = 0; }
  };
  function drip(pos, floorY) {
    if (!built || !pos) return;
    var p = spawn(NS, DROP); if (!p) return;
    p.x = px(pos, 'x', 0); p.y = px(pos, 'y', 0); p.z = px(pos, 'z', 0);
    p.floor = typeof floorY === 'number' && isFinite(floorY) ? Math.min(floorY, p.y) : p.y - 0.3;
    p.vy = 0; p.life = 5; p.s0 = 0.0045; p.cell = 3; p.a0 = 0.9;
  }

  function build() {
    if (built) return;
    T = window.THREE;
    if (!T || !G.scene) return;
    tmpV = new T.Vector3();
    var addTex = makeAddAtlas(), normTex = makeNormAtlas();
    // 単体の円・輪（平面メッシュ用）
    var c = cv(128), x = c.getContext('2d');
    radial(x, 64, 64, 64, [0, 'rgba(255,255,255,1)', 0.25, 'rgba(255,255,255,0.7)', 0.55, 'rgba(255,255,255,0.25)', 0.8, 'rgba(255,255,255,0.06)', 1, 'rgba(255,255,255,0)']);
    texSoft = toTex(c);
    c = cv(256); x = c.getContext('2d');
    radial(x, 128, 128, 128, [0, 'rgba(255,255,255,0)', 0.72, 'rgba(255,255,255,0)', 0.86, 'rgba(255,255,255,0.85)', 0.91, 'rgba(255,255,255,0.45)', 1, 'rgba(255,255,255,0)']);
    texRing = toTex(c);
    NS = new PSys(170, normTex, false, 0, 8);
    AS = new PSys(60, addTex, true, 0.04, 20);
    G.scene.add(NS.pts);
    G.scene.add(AS.pts);
    buildWater();
    buildSpot();
    low = !!(G.quality && G.quality.low);
    if (G.onQuality) G.onQuality(function (q) { low = !!(q && q.low); });
    built = true;
    if (G.onUpdate) G.onUpdate(update);
  }

  G.vfx = {
    build: build,
    water: water,
    bubbles: bubbles,
    steam: steam,
    sparkle: sparkle,
    glint: glint,
    spot: spot,
    drip: drip
  };
})();
