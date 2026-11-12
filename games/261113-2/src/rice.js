/* rice.js — ごはん・おにぎり・具・のり（手続き生成） gf-261113-nx2
 * クラシックスクリプト。グローバル THREE (r160) を使い window.G.Rice を生やす。
 * 座標: 輪郭は θ のとき x = r·cosθ, z = -r·sinθ（θ=90° が -Z=画面上）。単位 m。
 */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  if (typeof THREE === 'undefined') { G.Rice = G.Rice || {}; return; }

  var N = 64, TAU = Math.PI * 2, PI = Math.PI, HALF_PI = Math.PI / 2;
  var RICE_TILE = 0.05;   // ごはんテクスチャ1枚 = 5cm 角（粒 約5mm）
  var NORI_TILE = 0.04;

  // ---------------------------------------------------------------- utils
  function tier() {
    try { return (G.quality && G.quality.tier === 'low') ? 'low' : 'high'; } catch (e) { return 'high'; }
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function srgb(r, g, b) { return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace); }

  // Perlin 3D
  var PERM = (function () {
    var r = rng(1234), p = [], i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; }
    var q = new Uint8Array(512);
    for (i = 0; i < 512; i++) q[i] = p[i & 255];
    return q;
  })();
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function grad(h, x, y, z) {
    h &= 15;
    var u = h < 8 ? x : y, v = h < 4 ? y : ((h === 12 || h === 14) ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function noise3(x, y, z) {
    var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    var u = fade(x), v = fade(y), w = fade(z);
    var A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
        lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // 高さ(0..255 の R)から法線マップを作る。v は上向き（flipY 前提）
  function heightToNormal(hd, S, str) {
    var out = new Uint8ClampedArray(S * S * 4);
    for (var y = 0; y < S; y++) {
      var yu = ((y - 1 + S) % S) * S, yd = ((y + 1) % S) * S, yc = y * S;
      for (var x = 0; x < S; x++) {
        var xl = (x - 1 + S) % S, xr = (x + 1) % S;
        var dx = (hd[(yc + xr) * 4] - hd[(yc + xl) * 4]) / 255 * str;
        var dy = (hd[(yu + x) * 4] - hd[(yd + x) * 4]) / 255 * str;
        var nx = -dx, ny = -dy, nz = 1, l = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        var i = (yc + x) * 4;
        out[i] = (nx * l * 0.5 + 0.5) * 255; out[i + 1] = (ny * l * 0.5 + 0.5) * 255;
        out[i + 2] = (nz * l * 0.5 + 0.5) * 255; out[i + 3] = 255;
      }
    }
    return out;
  }
  function canvasTex(c, isColor, rep) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (isColor) t.colorSpace = THREE.SRGBColorSpace;
    if (rep) t.repeat.set(rep, rep);
    t.needsUpdate = true;
    return t;
  }

  // ---------------------------------------------------------------- ごはんの粒テクスチャ
  var RTEX = null;
  function riceTextures() {
    if (RTEX) return RTEX;
    var S = tier() === 'low' ? 512 : 1024;
    var k = S / (RICE_TILE * 1000);            // px / mm
    var hc = makeCanvas(S, S), ac = makeCanvas(S, S);
    var hx = hc.getContext('2d'), ax = ac.getContext('2d');
    hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S);
    ax.fillStyle = 'rgb(196,190,177)'; ax.fillRect(0, 0, S, S);
    var r = rng(9137), count = 1150;
    function grain(ctx, x, y, a, L, W, stops) {
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        var px = x + ox * S, py = y + oy * S;
        if (px < -L || px > S + L || py < -L || py > S + L) continue;
        ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.scale(L, W);
        var g = ctx.createRadialGradient(-0.12, -0.18, 0, 0, 0, 1);
        for (var s = 0; s < stops.length; s++) g.addColorStop(stops[s][0], stops[s][1]);
        ctx.fillStyle = g; ctx.beginPath();
        // 少し角の丸い長円（カプセル寄りの楕円）
        ctx.moveTo(1, 0);
        for (var j = 1; j <= 24; j++) {
          var th = j / 24 * TAU, c = Math.cos(th), sn = Math.sin(th);
          var e = 0.78; // superellipse
          ctx.lineTo(Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(sn) * Math.pow(Math.abs(sn), e));
        }
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    for (var i = 0; i < count; i++) {
      var x = r() * S, y = r() * S, a = r() * PI;
      var L = (4.7 + r() * 1.5) * k * 0.5, W = (2.3 + r() * 0.8) * k * 0.5;
      var hv = 150 + r() * 105;
      grain(hx, x, y, a, L, W, [
        [0, 'rgb(' + (hv | 0) + ',0,0)'], [0.55, 'rgb(' + (hv * 0.9 | 0) + ',0,0)'],
        [0.85, 'rgb(' + (hv * 0.62 | 0) + ',0,0)'], [1, 'rgb(' + (hv * 0.22 | 0) + ',0,0)']
      ]);
      var tr = r(), tl = tr < 0.18 ? -10 : (tr > 0.9 ? 4 : 0);  // 一部の粒は少し透けて灰色寄り
      var w0 = 247 + tl, w1 = 239 + tl, w2 = 224 + tl, w3 = 198 + tl;
      grain(ax, x, y, a, L, W, [
        [0, 'rgb(' + w0 + ',' + (w0 - 3) + ',' + (w0 - 11) + ')'],
        [0.55, 'rgb(' + w1 + ',' + (w1 - 4) + ',' + (w1 - 13) + ')'],
        [0.88, 'rgb(' + w2 + ',' + (w2 - 6) + ',' + (w2 - 18) + ')'],
        [1, 'rgb(' + w3 + ',' + (w3 - 7) + ',' + (w3 - 19) + ')']
      ]);
    }
    var hid = hx.getImageData(0, 0, S, S), hd = hid.data;
    var aid = ax.getImageData(0, 0, S, S), ad = aid.data;
    for (var p = 0; p < S * S; p++) {
      var h = hd[p * 4] / 255, ao = 0.86 + 0.14 * smooth(0.05, 0.7, h);
      ad[p * 4] *= ao; ad[p * 4 + 1] *= ao; ad[p * 4 + 2] *= ao * 0.995;
    }
    ax.putImageData(aid, 0, 0);
    var nd = heightToNormal(hd, S, 5.5 * S / 1024);
    var nc = makeCanvas(S, S), nx = nc.getContext('2d');
    var nid = nx.createImageData(S, S); nid.data.set(nd); nx.putImageData(nid, 0, 0);
    RTEX = { albedo: canvasTex(ac, true), normal: canvasTex(nc, false) };
    return RTEX;
  }

  // ---------------------------------------------------------------- ごはん材質（三面投影・物体空間 m 基準）
  var RICE_MAT = null;
  function riceMaterial() {
    if (RICE_MAT) return RICE_MAT;
    var tex = riceTextures();
    var m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.5, metalness: 0,
      clearcoat: 0.14, clearcoatRoughness: 0.38,
      sheen: 0.45, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xfff4e4)
    });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.tRiceAlb = { value: tex.albedo };
      sh.uniforms.tRiceNrm = { value: tex.normal };
      sh.uniforms.triScale = { value: 1 / RICE_TILE };
      sh.uniforms.triBump = { value: 1.0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;\nvarying vec3 vAX;\nvarying vec3 vAY;\nvarying vec3 vAZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = position;\nvTriNrm = objectNormal;\nvAX = normalMatrix * vec3(1.0,0.0,0.0);\nvAY = normalMatrix * vec3(0.0,1.0,0.0);\nvAZ = normalMatrix * vec3(0.0,0.0,1.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tRiceAlb;\nuniform sampler2D tRiceNrm;\nuniform float triScale;\nuniform float triBump;\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;\nvarying vec3 vAX;\nvarying vec3 vAY;\nvarying vec3 vAZ;')
        .replace('#include <map_fragment>', [
          'vec3 triN = normalize(vTriNrm);',
          'vec3 triW = pow(abs(triN), vec3(4.0)); triW /= (triW.x + triW.y + triW.z);',
          'vec3 triS = vec3(triN.x >= 0.0 ? 1.0 : -1.0, triN.y >= 0.0 ? 1.0 : -1.0, triN.z >= 0.0 ? 1.0 : -1.0);',
          'vec2 uvX = vec2(-triS.x * vTriPos.z, vTriPos.y) * triScale + vec2(0.37, 0.11);',
          'vec2 uvY = vec2(vTriPos.x, -triS.y * vTriPos.z) * triScale + vec2(0.71, 0.53);',
          'vec2 uvZ = vec2(triS.z * vTriPos.x, vTriPos.y) * triScale + vec2(0.19, 0.83);',
          'vec4 triAlb = texture2D(tRiceAlb, uvX) * triW.x + texture2D(tRiceAlb, uvY) * triW.y + texture2D(tRiceAlb, uvZ) * triW.z;',
          'diffuseColor.rgb *= triAlb.rgb;',
          'float triLum = dot(triAlb.rgb, vec3(0.3333));'
        ].join('\n'))
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * (1.28 - 0.5 * smoothstep(0.5, 0.85, triLum));')
        .replace('#include <normal_fragment_maps>', [
          'vec3 tnX = texture2D(tRiceNrm, uvX).xyz * 2.0 - 1.0;',
          'vec3 tnY = texture2D(tRiceNrm, uvY).xyz * 2.0 - 1.0;',
          'vec3 tnZ = texture2D(tRiceNrm, uvZ).xyz * 2.0 - 1.0;',
          'vec3 pX = tnX.x * vec3(0.0, 0.0, -triS.x) + tnX.y * vec3(0.0, 1.0, 0.0);',
          'vec3 pY = tnY.x * vec3(1.0, 0.0, 0.0) + tnY.y * vec3(0.0, 0.0, -triS.y);',
          'vec3 pZ = tnZ.x * vec3(triS.z, 0.0, 0.0) + tnZ.y * vec3(0.0, 1.0, 0.0);',
          'vec3 objN = normalize(triN + (pX * triW.x + pY * triW.y + pZ * triW.z) * triBump);',
          'normal = normalize(objN.x * vAX + objN.y * vAY + objN.z * vAZ);'
        ].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'riceTriplanar1'; };
    RICE_MAT = m;
    return m;
  }

  // ---------------------------------------------------------------- 1粒
  var GRAIN_GEO = null, GRAIN_MAT = null;
  function grainGeo() {
    if (GRAIN_GEO) return GRAIN_GEO;
    var g = new THREE.SphereGeometry(1, 8, 6);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      var xe = Math.sign(x) * Math.pow(Math.abs(x), 0.8);           // 両端を少し丸く太く
      var fat = 1 + 0.12 * x;                                       // 片側がわずかに太い
      p.setXYZ(i, xe * 0.0027, y * 0.00105 * fat, z * 0.00145 * fat);
    }
    g.computeVertexNormals();
    GRAIN_GEO = g;
    return g;
  }
  function grainMaterial() {
    if (GRAIN_MAT) return GRAIN_MAT;
    GRAIN_MAT = new THREE.MeshPhysicalMaterial({
      color: srgb(243, 239, 229), roughness: 0.4, metalness: 0,
      clearcoat: 0.3, clearcoatRoughness: 0.3,
      sheen: 0.5, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xfffaf0)
    });
    return GRAIN_MAT;
  }

  // ---------------------------------------------------------------- 輪郭
  function sdRoundBox(px, py, bx, by, rr) {
    var qx = Math.abs(px) - bx + rr, qy = Math.abs(py) - by + rr;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  }
  function sdEqTri(px, py, r) {  // 頂点が +py、辺の長さ 2r、重心が原点
    var k = Math.sqrt(3);
    px = Math.abs(px) - r; py = py + r / k;
    if (px + k * py > 0) { var nx = (px - k * py) / 2, ny = (-k * px - py) / 2; px = nx; py = ny; }
    px -= clamp(px, -2 * r, 0);
    return -Math.hypot(px, py) * Math.sign(py);
  }
  function outlineFromSdf(sdf) {
    var o = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var th = i / N * TAU, dx = Math.cos(th), dy = Math.sin(th); // dy は 2D の上 (= -Z)
      var lo = 0, hi = 4;
      for (var it = 0; it < 40; it++) { var m = (lo + hi) / 2; if (sdf(dx * m, dy * m) < 0) lo = m; else hi = m; }
      o[i] = (lo + hi) / 2;
    }
    return normalizeOutline(o);
  }
  function normalizeOutline(o) {
    var s = 0, i;
    for (i = 0; i < N; i++) s += o[i] * o[i];
    var k = 1 / Math.sqrt(s / N);
    for (i = 0; i < N; i++) o[i] *= k;
    return o;
  }
  var BASE = null;
  function baseOutlines() {
    if (BASE) return BASE;
    var a = 0.74;
    var tawara = outlineFromSdf(function (x, y) { return sdRoundBox(x, y, a, a * 1.35, a * 0.86); });
    var triR = 1.0, rc = 0.4;
    var tri0 = outlineFromSdf(function (x, y) { return sdEqTri(x, y + 0.0, triR - rc * 0.0) - rc; });
    var circ = new Float32Array(N); for (var i = 0; i < N; i++) circ[i] = 1;
    var tri = new Float32Array(N);
    for (i = 0; i < N; i++) tri[i] = lerp(tri0[i], 1, 0.08);   // 辺をわずかにふくらませる
    BASE = { tawara: tawara, tri: normalizeOutline(tri), circle: circ };
    return BASE;
  }
  function targetOutline(t) {
    var b = baseOutlines(), o = new Float32Array(N), i;
    t = finite(t) ? clamp(t, 0, 1) : 1;
    for (i = 0; i < N; i++) {
      o[i] = t <= 0.5 ? lerp(b.tawara[i], b.tri[i], t / 0.5) : lerp(b.tri[i], b.circle[i], (t - 0.5) / 0.5);
    }
    return normalizeOutline(o);
  }
  function sampleOutline(o, theta) {  // 周期 Catmull-Rom
    var u = theta / TAU * N; u = ((u % N) + N) % N;
    var i1 = Math.floor(u), f = u - i1;
    var i0 = (i1 - 1 + N) % N, i2 = (i1 + 1) % N, i3 = (i1 + 2) % N;
    var p0 = o[i0], p1 = o[i1], p2 = o[i2], p3 = o[i3];
    var f2 = f * f, f3 = f2 * f;
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
  }

  // ---------------------------------------------------------------- のりテクスチャ・材質
  var NORI_MAT = null;
  function noriMaterial() {
    if (NORI_MAT) return NORI_MAT;
    var S = tier() === 'low' ? 256 : 512;
    var ac = makeCanvas(S, S), hc = makeCanvas(S, S);
    var ax = ac.getContext('2d'), hx = hc.getContext('2d');
    ax.fillStyle = 'rgb(30,36,27)'; ax.fillRect(0, 0, S, S);
    hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, S, S);
    var r = rng(4242), i;
    // うすい所・濃い所のむら
    for (i = 0; i < 40; i++) {
      var x = r() * S, y = r() * S, rad = (6 + r() * 26) * S / 512;
      var g = ax.createRadialGradient(x, y, 0, x, y, rad);
      var light = r() < 0.5;
      g.addColorStop(0, light ? 'rgba(52,62,40,0.35)' : 'rgba(14,16,14,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ax.fillStyle = g; ax.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 繊維
    var nStroke = Math.floor(9000 * S * S / (512 * 512));
    for (i = 0; i < nStroke; i++) {
      var sx = r() * S, sy = r() * S, a = r() * PI, len = (1.5 + r() * 6) * S / 512;
      var v = r();
      var col = v < 0.35 ? 'rgba(12,15,12,0.55)' : (v < 0.8 ? 'rgba(42,52,36,0.45)' : (v < 0.93 ? 'rgba(58,70,46,0.4)' : 'rgba(46,36,48,0.35)'));
      ax.strokeStyle = col; ax.lineWidth = (0.6 + r() * 1.2) * S / 512;
      ax.beginPath(); ax.moveTo(sx, sy); ax.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len); ax.stroke();
      var hv = v < 0.35 ? 90 : 170 + r() * 50;
      hx.strokeStyle = 'rgba(' + (hv | 0) + ',0,0,0.5)'; hx.lineWidth = ax.lineWidth;
      hx.beginPath(); hx.moveTo(sx, sy); hx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len); hx.stroke();
    }
    var hd = hx.getImageData(0, 0, S, S).data;
    var nc = makeCanvas(S, S), nx = nc.getContext('2d'), nid = nx.createImageData(S, S);
    nid.data.set(heightToNormal(hd, S, 2.2 * S / 512)); nx.putImageData(nid, 0, 0);
    NORI_MAT = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: canvasTex(ac, true), normalMap: canvasTex(nc, false),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.5, metalness: 0, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x4a5a3c),
      clearcoat: 0.12, clearcoatRoughness: 0.5, side: THREE.DoubleSide
    });
    return NORI_MAT;
  }

  // ---------------------------------------------------------------- 具
  var FILL_MATS = {};
  function umeMaterial() {
    if (FILL_MATS.ume) return FILL_MATS.ume;
    FILL_MATS.ume = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.32,
      sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xff6a5a)
    });
    return FILL_MATS.ume;
  }
  function sakeMaterial() {
    if (FILL_MATS.sake) return FILL_MATS.sake;
    var S = 256, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = 'rgb(236,128,98)'; x.fillRect(0, 0, S, S);
    var r = rng(77), i;
    for (i = 0; i < 600; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(220,104,78,0.25)' : 'rgba(246,156,124,0.25)';
      x.fillRect(r() * S, r() * S, 2 + r() * 10, 1 + r() * 3);
    }
    var yy = 0;
    while (yy < S) {   // 身の筋（白っぽい脂の線）
      var w = 1.5 + r() * 2.5;
      x.fillStyle = 'rgba(252,206,186,' + (0.55 + r() * 0.35) + ')';
      x.beginPath(); x.moveTo(0, yy);
      for (var xx = 0; xx <= S; xx += 16) x.lineTo(xx, yy + Math.sin(xx * 0.05 + yy) * 2);
      for (xx = S; xx >= 0; xx -= 16) x.lineTo(xx, yy + w + Math.sin(xx * 0.05 + yy) * 2);
      x.fill();
      yy += 14 + r() * 22;
    }
    FILL_MATS.sake = new THREE.MeshPhysicalMaterial({
      map: canvasTex(c, true), vertexColors: true, roughness: 0.55, metalness: 0,
      clearcoat: 0.12, clearcoatRoughness: 0.5, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffc0a8)
    });
    return FILL_MATS.sake;
  }
  function kombuMaterial() {
    if (FILL_MATS.kombu) return FILL_MATS.kombu;
    FILL_MATS.kombu = new THREE.MeshPhysicalMaterial({
      color: srgb(22, 27, 16), roughness: 0.24, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12,
      side: THREE.DoubleSide
    });
    return FILL_MATS.kombu;
  }
  function sesameMaterial() {
    if (FILL_MATS.sesame) return FILL_MATS.sesame;
    FILL_MATS.sesame = new THREE.MeshStandardMaterial({ color: srgb(214, 190, 150), roughness: 0.5 });
    return FILL_MATS.sesame;
  }

  // 梅干し 1個のジオメトリ（半径 r、原点=底）
  function umeGeometry(r, seed) {
    var seg = tier() === 'low' ? 28 : 40;
    var g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7));
    var p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
    var o = seed * 13.7;
    var cBase = srgb(132, 14, 24), cDeep = srgb(62, 4, 12), cHi = srgb(178, 40, 36);
    var tmp = new THREE.Color(), minY = 1e9, i;
    for (i = 0; i < n; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      var rid = 0, amp = 1, fr = 2.6;
      for (var oc = 0; oc < 3; oc++) {
        rid += amp * (1 - Math.abs(noise3(x * fr + o, y * fr * 1.3 + o * 0.7, z * fr - o)));
        amp *= 0.5; fr *= 2.1;
      }
      rid /= 1.75;                                    // 0..1 尾根
      var low = noise3(x * 1.3 + o, y * 1.3, z * 1.3 - o);
      var d = 1 + 0.13 * (rid - 0.6) + 0.07 * low;
      var top = Math.max(0, y - 0.86) / 0.14; d -= 0.12 * top;   // へたのくぼみ
      var px = x * d, py = y * d * 0.8, pz = z * d;
      if (py < -0.66) py = -0.66 - (py + 0.66) * 0.25;            // 底は平たく
      p.setXYZ(i, px * r, py * r, pz * r);
      minY = Math.min(minY, py * r);
      var t = clamp((rid - 0.35) / 0.5, 0, 1);
      tmp.copy(cDeep).lerp(cBase, smooth(0, 0.55, t)).lerp(cHi, smooth(0.6, 1, t) * 0.7);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.translate(0, -minY, 0);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }

  // 小片の集まりを1つのジオメトリに（しゃけ用）
  function sakeGeometry(count, radius, height, seed) {
    var r = rng(seed || 5), pos = [], nor = [], uv = [], col = [], idx = [], base = 0;
    var unit = new THREE.SphereGeometry(1, 7, 5), up = unit.attributes.position, ui = unit.index.array;
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
    var v = new THREE.Vector3(), c1 = srgb(255, 255, 255);
    for (var k = 0; k < count; k++) {
      var a = r() * TAU, rr = radius * Math.sqrt(r());
      var hy = height * Math.pow(Math.max(0, 1 - (rr / radius) * (rr / radius)), 0.8);
      var L = 0.0022 + r() * 0.0028, W = 0.0011 + r() * 0.0011, T = 0.0008 + r() * 0.0007;
      t.set(Math.cos(a) * rr, hy * (0.35 + 0.65 * r()) + T * 0.6, -Math.sin(a) * rr);
      e.set((r() - 0.5) * 1.2, r() * TAU, (r() - 0.5) * 1.2); q.setFromEuler(e);
      s.set(L, T, W); m.compose(t, q, s);
      var br = 0.82 + r() * 0.3, ph = r() * 10;
      for (var i = 0; i < up.count; i++) {
        var lx = up.getX(i), ly = up.getY(i), lz = up.getZ(i);
        var d = 1 + 0.25 * noise3(lx * 1.7 + k * 3.1, ly * 1.7, lz * 1.7 + ph);
        var bx = Math.sign(lx) * Math.pow(Math.abs(lx), 0.6);         // ほぐし身は角ばっている
        var by = Math.sign(ly) * Math.pow(Math.abs(ly), 0.5);
        v.set(bx * d, by * d, lz * d).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        nor.push(0, 1, 0);
        uv.push(lz * 0.6 + ph, lx * 0.12 + ph * 0.37);
        col.push(c1.r * br, c1.g * br, c1.b * br);
      }
      for (i = 0; i < ui.length; i++) idx.push(ui[i] + base);
      base += up.count;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    unit.dispose();
    return g;
  }

  // こんぶの佃煮（細切りのリボンの集まり）
  function kombuGeometry(count, radius, height, seed) {
    var r = rng(seed || 9), pos = [], idx = [], base = 0, SEG = 10;
    var P = new THREE.Vector3(), D = new THREE.Vector3(), Nn = new THREE.Vector3(), Wv = new THREE.Vector3();
    for (var k = 0; k < count; k++) {
      var a = r() * TAU, rr = radius * Math.sqrt(r()) * 0.85;
      var hy = height * Math.pow(Math.max(0, 1 - (rr / radius) * (rr / radius)), 0.7) * (0.3 + 0.7 * r());
      P.set(Math.cos(a) * rr, hy + 0.0006, -Math.sin(a) * rr);
      var yaw = r() * TAU, pitch = (r() - 0.5) * 0.9;
      D.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
      var len = 0.008 + r() * 0.01, wid = 0.0022 + r() * 0.0012, curl = (r() - 0.5) * 6, roll = (r() - 0.5) * 3;
      var segL = len / SEG;
      P.addScaledVector(D, -len / 2);
      Nn.set(0, 1, 0); Nn.addScaledVector(D, -Nn.dot(D)).normalize();
      for (var j = 0; j <= SEG; j++) {
        Wv.crossVectors(D, Nn).normalize();
        var w = wid * (0.85 + 0.15 * Math.sin(j * 1.3 + k));
        pos.push(P.x + Wv.x * w / 2, P.y + Wv.y * w / 2, P.z + Wv.z * w / 2);
        pos.push(P.x - Wv.x * w / 2, P.y - Wv.y * w / 2, P.z - Wv.z * w / 2);
        // 曲げる
        D.addScaledVector(Nn, curl * segL * 0.9).addScaledVector(Wv, roll * segL * 0.6).normalize();
        Nn.addScaledVector(D, -Nn.dot(D)).normalize();
        P.addScaledVector(D, segL);
        if (P.y < 0.0004) P.y = 0.0004;
      }
      for (j = 0; j < SEG; j++) {
        var i0 = base + j * 2;
        idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
      base += (SEG + 1) * 2;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function sesameGeometry(count, radius, height, seed) {
    var r = rng(seed || 3), unit = new THREE.SphereGeometry(1, 6, 4), parts = [];
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var pos = [], idx = [], up = unit.attributes.position, ui = unit.index.array, v = new THREE.Vector3();
    for (var k = 0; k < count; k++) {
      var a = r() * TAU, rr = radius * Math.sqrt(r()) * 0.8;
      var hy = height * Math.pow(Math.max(0, 1 - (rr / radius) * (rr / radius)), 0.7) * (0.6 + 0.4 * r());
      e.set((r() - 0.5) * 0.8, r() * TAU, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a) * rr, hy + 0.0009, -Math.sin(a) * rr), q, new THREE.Vector3(0.0014, 0.0005, 0.0009));
      for (var i = 0; i < up.count; i++) { v.fromBufferAttribute(up, i).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
      for (i = 0; i < ui.length; i++) idx.push(ui[i] + k * up.count);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals(); unit.dispose();
    return g;
  }
  function shadowMesh(geo, mat) {
    var m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m;
  }
  function validKind(k) { return k === 'ume' || k === 'sake' || k === 'kombu' ? k : null; }

  function createFillingPiece(kind, seed) {
    kind = validKind(kind) || 'ume';
    var g = new THREE.Group(); g.name = 'filling-' + kind;
    seed = seed || 1;
    if (kind === 'ume') {
      g.add(shadowMesh(umeGeometry(0.009, seed), umeMaterial()));
    } else if (kind === 'sake') {
      g.add(shadowMesh(sakeGeometry(tier() === 'low' ? 22 : 36, 0.0105, 0.009, 11 + seed), sakeMaterial()));
    } else {
      g.add(shadowMesh(kombuGeometry(tier() === 'low' ? 22 : 36, 0.0105, 0.0075, 21 + seed), kombuMaterial()));
      g.add(shadowMesh(sesameGeometry(5, 0.008, 0.006, 31 + seed), sesameMaterial()));
    }
    g.userData.kind = kind;
    return g;
  }
  function createFillingHeap(kind) {
    kind = validKind(kind) || 'ume';
    var g = new THREE.Group(); g.name = 'fillingHeap-' + kind;
    var low = tier() === 'low';
    if (kind === 'ume') {
      var rr = 0.0108;
      for (var i = 0; i < 3; i++) {
        var a = i / 3 * TAU + 0.4, m = shadowMesh(umeGeometry(rr * (0.94 + 0.08 * i), 3 + i * 7), umeMaterial());
        m.position.set(Math.cos(a) * 0.0115, 0, -Math.sin(a) * 0.0115);
        m.rotation.set((i - 1) * 0.15, i * 2.1, (i - 1) * -0.12);
        g.add(m);
      }
    } else if (kind === 'sake') {
      g.add(shadowMesh(sakeGeometry(low ? 70 : 120, 0.021, 0.014, 101), sakeMaterial()));
    } else {
      g.add(shadowMesh(kombuGeometry(low ? 50 : 85, 0.021, 0.011, 202), kombuMaterial()));
      g.add(shadowMesh(sesameGeometry(16, 0.019, 0.011, 303), sesameMaterial()));
    }
    g.userData.kind = kind;
    return g;
  }

  // ---------------------------------------------------------------- のりの帯（平置き）
  function createNoriStrip(opts) {
    opts = opts || {};
    var W = finite(opts.width) && opts.width > 0 ? opts.width : 0.032;
    var L = finite(opts.length) && opts.length > 0 ? opts.length : 0.095;
    var nx = 8, nz = 28, geo = new THREE.PlaneGeometry(W, L, nx, nz);
    geo.rotateX(-HALF_PI);
    var p = geo.attributes.position, uv = geo.attributes.uv, r = rng(55);
    var jit = [];
    for (var i = 0; i <= nz; i++) jit.push([(r() - 0.5) * 0.0007, (r() - 0.5) * 0.0007]);
    for (i = 0; i < p.count; i++) {
      var x = p.getX(i), z = p.getZ(i);
      var row = Math.round((z / L + 0.5) * nz), colEdge = Math.abs(Math.abs(x) - W / 2) < 1e-6;
      if (colEdge) x += (x > 0 ? jit[row][0] : jit[row][1]);
      if (Math.abs(Math.abs(z) - L / 2) < 1e-6) z += (r() - 0.5) * 0.0006;
      var y = 0.0003 + 0.0006 * (0.5 + 0.5 * Math.sin(z * 90 + x * 30)) + 0.0004 * Math.max(0, Math.abs(z) / (L / 2) - 0.7) * 3;
      p.setXYZ(i, x, y, z);
      uv.setXY(i, (x + W / 2) / NORI_TILE, (z + L / 2) / NORI_TILE);
    }
    geo.computeVertexNormals();
    var m = new THREE.Mesh(geo, noriMaterial());
    m.castShadow = true; m.receiveShadow = true;
    var g = new THREE.Group(); g.name = 'noriStrip'; g.add(m);
    return g;
  }

  // ---------------------------------------------------------------- 本体（おにぎり・山）
  var NA = 128, NT = 16, NB = 6, NROW = NT + NB + 1;
  var NXN = 14, NAC = 64, NRN = 40;
  var ALPHA0 = -1.2, ALPHAMAX = 1.45;
  var BODY_INDEX = null;
  function bodyIndex() {
    if (BODY_INDEX) return BODY_INDEX;
    var idx = [];
    for (var j = 0; j < NROW - 1; j++) for (var i = 0; i < NA; i++) {
      var a = j * NA + i, b = (j + 1) * NA + i, c = j * NA + (i + 1) % NA, d = (j + 1) * NA + (i + 1) % NA;
      idx.push(a, b, c, c, b, d);
    }
    BODY_INDEX = idx;
    return idx;
  }
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
  var _info = { clipped: 0 };

  function Body(opts) {
    opts = opts || {};
    this.kind = opts.kind || 'lump';
    this.size = finite(opts.size) && opts.size > 0 ? opts.size : 0.032;
    this.seed = (finite(opts.seed) ? opts.seed : Math.floor(Math.random() * 1e9)) >>> 0;
    this.outline = new Float32Array(N); for (var i = 0; i < N; i++) this.outline[i] = 1;
    this.formed = 0; this.t = 1; this.filling = null; this.nori = 0; this.bites = 0;
    this.press = 0;
    this.dimple = opts.dimple !== undefined ? opts.dimple : (this.kind === 'lump' ? 1 : 0);
    this.rough = opts.rough !== undefined ? opts.rough : (this.kind === 'scoop' ? 1.35 : 1);
    this.group = new THREE.Group(); this.group.name = 'rice-' + this.kind;
    this.group.userData.body = this;
    this.inner = new THREE.Group(); this.group.add(this.inner);
    var geo = new THREE.BufferGeometry();
    this._pos = new Float32Array(NA * NROW * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    geo.setIndex(bodyIndex());
    this.mesh = new THREE.Mesh(geo, riceMaterial());
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.inner.add(this.mesh);
    this._initNoise();
    this._circles = [];
    this._noriDirty = true;
    this._makeGrains();
    this.rebuild();
  }
  var BP = Body.prototype;

  BP._initNoise = function () {
    var r = rng(this.seed * 7 + 3), i;
    this._oh = [];
    for (i = 2; i <= 7; i++) this._oh.push({ k: i, a: (0.4 + r() * 0.6) / Math.pow(i, 0.7), p: r() * TAU });
    var s = 0; for (i = 0; i < this._oh.length; i++) s += this._oh[i].a; for (i = 0; i < this._oh.length; i++) this._oh[i].a /= s;
    this._hw = [];
    for (i = 0; i < 6; i++) { var a = r() * TAU; this._hw.push({ dx: Math.cos(a), dz: Math.sin(a), f: 2.2 + r() * 4.5, p: r() * TAU, a: 0.5 + r() * 0.5 }); }
    s = 0; for (i = 0; i < 6; i++) s += this._hw[i].a; for (i = 0; i < 6; i++) this._hw[i].a /= s;
    this._cw = [];
    for (i = 0; i < 6; i++) {
      var v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      this._cw.push({ v: v, f: 9 + r() * 9, p: r() * TAU });
    }
    this._toothPh = r() * TAU;
  };

  BP._prep = function () {
    var f = clamp(this.formed, 0, 1), sz = this.size;
    this._f = f; this._fe = smooth(0, 1, f);
    this._H = sz * lerp(0.86, 0.95, this._fe);
    this._C = this._H * lerp(0.22, 0.47, this._fe);
    this._oAmp = 0.075 * Math.pow(1 - f, 1.5) * this.rough;
    this._hAmp = 0.1 * this._H * Math.pow(1 - f, 1.3) * this.rough;
    this._clAmp = 0.022 * sz * Math.pow(1 - f, 1.2) * this.rough;
    this._dimp = 0.2 * sz * (1 - smooth(0, 0.32, f)) * this.dimple;
    this._makeCircles();
  };
  BP._R = function (theta) {
    var r = sampleOutline(this.outline, theta), n = 0;
    if (this._oAmp > 0) { for (var i = 0; i < this._oh.length; i++) { var h = this._oh[i]; n += h.a * Math.cos(h.k * theta + h.p); } }
    return r * this.size * (1 + this._oAmp * n * 1.6);
  };
  BP._prof = function (R) {
    var fe = this._fe, H = this._H, c = this._C;
    var re = H * 0.42, reb = c * 0.75;
    return {
      p: lerp(2.0, Math.max(2.2, 2.3 * R / re), fe),
      q: lerp(1.45, 2.3, fe),
      pb: lerp(2.2, Math.max(2.2, 2.1 * R / reb), fe),
      qb: 2.2
    };
  };
  BP._topExtra = function (x, z, rho, s, g) {
    var sz = this.size, y = this._H * 0.035 * this._fe * (1 - s * s);
    if (this._hAmp > 0) {
      var n = 0;
      for (var i = 0; i < this._hw.length; i++) { var w = this._hw[i]; n += w.a * Math.cos((w.dx * x + w.dz * z) / sz * w.f + w.p); }
      y += this._hAmp * n * 1.4 * (0.35 + 0.65 * g);
    }
    if (this._dimp > 0) { var e = rho / (0.36 * sz); y -= this._dimp * Math.exp(-e * e); }
    return y;
  };
  BP._clump = function (x, y, z) {
    var n = 0, sz = this.size;
    for (var i = 0; i < this._cw.length; i++) { var w = this._cw[i]; n += Math.cos((w.v.x * x + w.v.y * y + w.v.z * z) / sz * w.f + w.p); }
    return n / this._cw.length * 2;
  };
  BP._makeCircles = function () {
    this._circles = [];
    if (this.bites <= 0) return;
    // 円は上面の高さで中心に届かない大きさに限る（星形のまま切り取れるように）
    var sz = this.size, Rt = sampleOutline(this.outline, HALF_PI) * sz;
    var r1 = 0.8 * sz, n1 = Math.max(Rt * 0.5, Rt - 0.75 * sz), a1 = HALF_PI + 0.07;
    this._circles.push({ x: Math.cos(a1) * (n1 + r1), z: -Math.sin(a1) * (n1 + r1), r: r1 });
    if (this.bites >= 2) {
      var r2 = 1.05 * sz, n2 = 0.06 * sz, a2 = HALF_PI - 0.05;
      this._circles.push({ x: Math.cos(a2) * (n2 + r2), z: -Math.sin(a2) * (n2 + r2), r: r2 });
    }
  };
  BP._clip = function (theta, y) {
    var cs = this._circles; if (!cs.length) return Infinity;
    var dx = Math.cos(theta), dz = -Math.sin(theta), best = Infinity, H = this._H;
    var lean = 0.55 * H, yh = clamp(y / H, 0, 1), yk = yh * yh * yh;
    for (var i = 0; i < cs.length; i++) {
      var C = cs[i], rr = C.r + (yk - 1) * lean;   // 上の縁ほど深く（断面の上側が上を向く）
      if (rr <= 0) continue;
      var b = dx * C.x + dz * C.z, cc = C.x * C.x + C.z * C.z;
      if (b <= 0) continue;
      var disc = b * b - (cc - rr * rr); if (disc < 0) continue;
      var tE = b - Math.sqrt(disc);
      // 歯形の浅い波
      var qx = dx * tE - C.x, qz = dz * tE - C.z, beta = Math.atan2(qz, qx);
      rr *= 1 + 0.035 * Math.cos(beta * 9 + this._toothPh + i * 1.7);
      disc = b * b - (cc - rr * rr); if (disc < 0) continue;
      tE = Math.max(0, b - Math.sqrt(disc));
      if (tE < best) best = tE;
    }
    return best;
  };
  // 表面の点（θ, φ）φ: 0=上面中央 … π/2=側面 … π=底面中央
  BP._eval = function (theta, phi, out, info) {
    var R = this._R(theta), pr = this._prof(R), H = this._H, c = this._C;
    var sp = Math.sin(phi), cp = Math.cos(phi), s, g, y, top = phi <= HALF_PI;
    if (top) { s = Math.pow(sp, 2 / pr.p); g = Math.pow(Math.max(cp, 0), 2 / pr.q); y = c + (H - c) * g; }
    else { s = Math.pow(sp, 2 / pr.pb); g = Math.pow(-cp, 2 / pr.qb); y = c - c * g; }
    var rho = s * R, ct = Math.cos(theta), st = Math.sin(theta);
    if (top) y += this._topExtra(rho * ct, -rho * st, rho, s, g);
    if (this._clAmp > 0) {
      var fadeB = top ? 1 : clamp(1 - (phi - HALF_PI) / 0.7, 0, 1);
      var cl = this._clump(rho * ct, y, -rho * st) * this._clAmp * fadeB;
      rho += cl * sp; y += cl * cp;
    }
    if (y < 0) y = 0;
    var clip = this._clip(theta, y);
    if (info) info.clipped = rho > clip ? rho - clip : 0;
    if (rho > clip) {   // 断面はぽろぽろ
      rho = clip - 0.0007 * (0.5 + 0.5 * noise3(ct * clip * 900, y * 900, st * clip * 900));
    }
    out.set(rho * ct, y, -rho * st);
    return out;
  };
  BP._inside = function (x, y, z) {
    if (y < 0) return false;
    var theta = Math.atan2(-z, x), rho = Math.sqrt(x * x + z * z), R = this._R(theta), s = rho / R;
    if (s >= 1) return false;
    var pr = this._prof(R), H = this._H, c = this._C;
    var g = Math.pow(Math.max(0, 1 - Math.pow(s, pr.p)), 1 / pr.q);
    var yt = c + (H - c) * g + this._topExtra(x, z, rho, s, g);
    if (y > yt) return false;
    if (y < c) {
      var gb = Math.pow(Math.max(0, 1 - Math.pow(s, pr.pb)), 1 / pr.qb);
      if (y < c - c * gb) return false;
    }
    if (rho > this._clip(theta, y)) return false;
    return true;
  };

  BP.rebuild = function () {
    this._prep();
    var pos = this._pos, j, i, k = 0, v = _v1;
    this._phis = [];
    for (j = 0; j < NROW; j++) this._phis.push(j <= NT ? (j / NT) * HALF_PI : HALF_PI + ((j - NT) / NB) * HALF_PI);
    for (j = 0; j < NROW; j++) {
      var phi = this._phis[j];
      for (i = 0; i < NA; i++) {
        this._eval(i / NA * TAU, phi, v);
        pos[k++] = v.x; pos[k++] = v.y; pos[k++] = v.z;
      }
    }
    var geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    var nrm = geo.attributes.normal.array;
    [0, NROW - 1].forEach(function (row) {   // 極の法線をそろえる
      var sx = 0, sy = 0, sz = 0, b = row * NA * 3;
      for (var q = 0; q < NA; q++) { sx += nrm[b + q * 3]; sy += nrm[b + q * 3 + 1]; sz += nrm[b + q * 3 + 2]; }
      var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      for (q = 0; q < NA; q++) { nrm[b + q * 3] = sx / l; nrm[b + q * 3 + 1] = sy / l; nrm[b + q * 3 + 2] = sz / l; }
    });
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    // 粒の分布用 CDF
    this._rowCDF = []; var acc = 0, rowLim = NT + 3;
    for (j = 0; j < rowLim; j++) {
      var a = 0;
      for (i = 0; i < NA; i += 8) {
        var p0 = (j * NA + i) * 3, p1 = ((j + 1) * NA + i) * 3;
        var dl = Math.hypot(pos[p1] - pos[p0], pos[p1 + 1] - pos[p0 + 1], pos[p1 + 2] - pos[p0 + 2]);
        var rr = (Math.hypot(pos[p0], pos[p0 + 2]) + Math.hypot(pos[p1], pos[p1 + 2])) * 0.5;
        a += dl * rr;
      }
      acc += a; this._rowCDF.push(acc);
    }
    for (j = 0; j < rowLim; j++) this._rowCDF[j] /= acc || 1;
    this._thCDF = []; acc = 0;
    for (i = 0; i < NA; i++) { var R = this._R(i / NA * TAU); acc += R * R; this._thCDF.push(acc); }
    for (i = 0; i < NA; i++) this._thCDF[i] /= acc;
    this._noriDirty = true;
    if (this.nori > 0.001) this._updateNori();
    else if (this.noriMesh) this.noriMesh.visible = false;
    this._placeGrains();
    this._updateFilling();
    this._buildCore();
    this.group.visible = this.bites < 3;
  };

  // ---- 粒
  BP._grainCount = function () {
    var n = Math.round(150 * Math.pow(this.size / 0.032, 1.6));
    if (this.kind === 'scoop') n = Math.round(n * 1.1);
    n = clamp(n, 14, 210);
    if (tier() === 'low') n = Math.max(8, Math.round(n / 2));
    return n;
  };
  BP._makeGrains = function () {
    var n = this._grainCount();
    if (this.grains && this._gN === n) return;
    if (this.grains) { this.inner.remove(this.grains); this.grains.dispose(); }
    var im = new THREE.InstancedMesh(grainGeo(), grainMaterial(), n);
    im.castShadow = false; im.receiveShadow = true;
    im.frustumCulled = false;
    var r = rng(this.seed * 3 + 11), col = new THREE.Color();
    this._gp = [];
    for (var i = 0; i < n; i++) {
      this._gp.push({ u1: r(), u2: r(), a: r() * TAU, sc: 0.88 + r() * 0.24, tilt: (r() - 0.5) * 2, emb: r(), vis: r(), edge: r() < 0.25 });
      var b = 0.95 + r() * 0.07;
      col.setRGB(b, b * (0.995 + r() * 0.01), b * (0.985 + r() * 0.015));
      im.setColorAt(i, col);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.grains = im; this._gN = n;
    this.inner.add(im);
  };
  function invCDF(cdf, u) {
    var lo = 0, hi = cdf.length - 1;
    while (lo < hi) { var m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
    var prev = lo > 0 ? cdf[lo - 1] : 0, w = cdf[lo] - prev;
    return lo + (w > 0 ? (u - prev) / w : 0.5);
  }
  var _m4 = new THREE.Matrix4(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  BP._placeGrains = function () {
    var im = this.grains, n = this._gN, f = this._f;
    var P = _v1, A = _v2, B = _v3, Nn = new THREE.Vector3(), T = new THREE.Vector3(), Bt = new THREE.Vector3(), T2 = new THREE.Vector3();
    var visTh = lerp(1, 0.7, f), e = 0.02, info = _info;
    this._grainPos = this._grainPos || [];
    for (var i = 0; i < n; i++) {
      var g = this._gp[i];
      var th = invCDF(this._thCDF, g.u2) / NA * TAU;
      var phi;
      if (g.edge) phi = HALF_PI + (g.u1 - 0.7) * 0.5;
      else {
        var rr = invCDF(this._rowCDF, g.u1);
        phi = clamp(rr <= NT ? rr * (HALF_PI / NT) : HALF_PI + (rr - NT) * (HALF_PI / NB), 0.05, HALF_PI + 0.5);
      }
      this._eval(th, phi, P, info);
      var clipped = info.clipped;
      this._eval(th + e, phi, A); this._eval(th - e, phi, B); T.subVectors(A, B);
      this._eval(th, phi + e, A); this._eval(th, Math.max(0.001, phi - e), B); A.sub(B);
      Nn.crossVectors(A, T);
      if (Nn.lengthSq() < 1e-14) Nn.set(0, 1, 0);
      Nn.normalize();
      T.normalize(); Bt.crossVectors(T, Nn).normalize(); T.crossVectors(Nn, Bt).normalize();
      // 面内でランダムに回す
      var ca = Math.cos(g.a), sa = Math.sin(g.a);
      T2.copy(T).multiplyScalar(ca).addScaledVector(Bt, sa);
      Bt.crossVectors(T2, Nn).normalize();
      // 盛ったままだと粒が立つ
      var tilt = g.tilt * lerp(0.45, 0.12, f);
      var ct = Math.cos(tilt), st = Math.sin(tilt);
      var Tx = T2.clone().multiplyScalar(ct).addScaledVector(Nn, st);
      var Ny = Nn.clone().multiplyScalar(ct).addScaledVector(T2, -st);
      var off = 0.00105 * (lerp(0.1, -0.35, f) + (g.emb - 0.5) * 0.5);
      P.addScaledVector(Nn, off);
      var hide = g.vis > visTh || clipped > 0.0025 || P.y < 0.0006 || this._noriCovers(P);
      if (hide) { im.setMatrixAt(i, _zero); continue; }
      _m4.makeBasis(Tx, Ny, Bt);
      _m4.scale(_v4.set(g.sc, g.sc * lerp(1.08, 0.95, f), g.sc));
      _m4.setPosition(P);
      im.setMatrixAt(i, _m4);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  BP._noriCovers = function (p) {
    if (this.nori <= 0.001) return false;
    var W = this.size * 0.95;
    if (Math.abs(p.x) > W / 2 + 0.0006) return false;
    var a = Math.atan2(p.y - this._C, p.z), a1 = ALPHA0 + this.nori * (ALPHAMAX - ALPHA0);
    return a >= ALPHA0 - 0.1 && a <= a1 + 0.03;
  };

  // ---- のり
  BP._buildNoriCache = function () {
    var W = this.size * 0.95, c = this._C, r = rng(this.seed + 99);
    var cache = new Float32Array(NXN * NAC * 3), arc = new Float32Array(NXN * NAC);
    var step = this.size * 0.03, maxT = this.size * 4;
    for (var ix = 0; ix < NXN; ix++) {
      for (var ia = 0; ia < NAC; ia++) {
        var u = ix / (NXN - 1) - 0.5;
        var x = u * W;
        if (ix === 0 || ix === NXN - 1) x += (r() - 0.5) * 0.0008;
        var al = ALPHA0 + ia / (NAC - 1) * (ALPHAMAX - ALPHA0);
        var dy = Math.sin(al), dz = Math.cos(al), t = 0;
        while (t < maxT && this._inside(x, c + dy * t, dz * t)) t += step;
        var lo = Math.max(0, t - step), hi = t;
        for (var it = 0; it < 14; it++) { var m = (lo + hi) / 2; if (this._inside(x, c + dy * m, dz * m)) lo = m; else hi = m; }
        t = hi + 0.00055;
        var k = (ix * NAC + ia) * 3;
        cache[k] = x; cache[k + 1] = Math.max(-0.0004, c + dy * t); cache[k + 2] = dz * t;
        if (ia > 0) {
          var kp = k - 3;
          arc[ix * NAC + ia] = arc[ix * NAC + ia - 1] + Math.hypot(cache[k] - cache[kp], cache[k + 1] - cache[kp + 1], cache[k + 2] - cache[kp + 2]);
        }
      }
    }
    this._noriCache = cache; this._noriArc = arc;
    this._noriEndJit = []; for (ix = 0; ix < NXN; ix++) this._noriEndJit.push((r() - 0.5) * 0.035);
    this._noriDirty = false;
  };
  BP._updateNori = function () {
    if (this.nori <= 0.001) { if (this.noriMesh) this.noriMesh.visible = false; return; }
    if (this._noriDirty || !this._noriCache) this._buildNoriCache();
    if (!this.noriMesh) {
      var geo = new THREE.BufferGeometry(), idx = [];
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NXN * NRN * 3), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(NXN * NRN * 2), 2));
      for (var a = 0; a < NRN - 1; a++) for (var b = 0; b < NXN - 1; b++) {
        var i0 = a * NXN + b, i1 = i0 + 1, i2 = i0 + NXN, i3 = i2 + 1;
        idx.push(i0, i2, i1, i1, i2, i3);
      }
      geo.setIndex(idx);
      this.noriMesh = new THREE.Mesh(geo, noriMaterial());
      this.noriMesh.castShadow = true; this.noriMesh.receiveShadow = true;
      this.inner.add(this.noriMesh);
    }
    var v = clamp(this.nori, 0, 1), W = this.size * 0.95;
    var pos = this.noriMesh.geometry.attributes.position.array, uv = this.noriMesh.geometry.attributes.uv.array;
    var cache = this._noriCache, arc = this._noriArc;
    for (var ix = 0; ix < NXN; ix++) {
      var aEnd = clamp(v + (v > 0.04 ? this._noriEndJit[ix] * (0.3 + 0.7 * v) : 0), 0.002, 1);
      for (var ir = 0; ir < NRN; ir++) {
        var fr = ir / (NRN - 1) * aEnd * (NAC - 1), i0 = Math.min(NAC - 2, Math.floor(fr)), w = fr - i0;
        var k0 = (ix * NAC + i0) * 3, k1 = k0 + 3, o = (ir * NXN + ix);
        pos[o * 3] = lerp(cache[k0], cache[k1], w);
        pos[o * 3 + 1] = lerp(cache[k0 + 1], cache[k1 + 1], w);
        pos[o * 3 + 2] = lerp(cache[k0 + 2], cache[k1 + 2], w);
        uv[o * 2] = (ix / (NXN - 1)) * W / NORI_TILE;
        uv[o * 2 + 1] = lerp(arc[ix * NAC + i0], arc[ix * NAC + i0 + 1], w) / NORI_TILE;
      }
    }
    var g = this.noriMesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true;
    g.computeVertexNormals(); g.computeBoundingSphere();
    this.noriMesh.visible = true;
  };

  // ---- 具
  BP._updateFilling = function () {
    var kind = this.filling;
    if (this.piece && (!kind || this.piece.userData.kind !== kind)) { this.inner.remove(this.piece); disposeTree(this.piece); this.piece = null; }
    if (!kind) return;
    if (!this.piece) { this.piece = createFillingPiece(kind, (this.seed % 7) + 1); this.inner.add(this.piece); }
    var f = this._f, k = this.size / 0.032 * 0.95;
    var topY = this._eval(0, 0, _v1).y;
    var sink = smooth(0, 0.25, f);
    this.piece.scale.setScalar(k * lerp(1, 0.85, sink));
    this.piece.position.set(0, topY - 0.0028 * k - sink * 0.012 * k, 0);
    this.piece.visible = f < 0.25 && this.bites === 0;
  };
  BP._buildCore = function () {
    if (this.core) { this.inner.remove(this.core); disposeTree(this.core); this.core = null; }
    if (!this.filling || this.bites <= 0 || this.bites >= 3) return;
    var src = createFillingPiece(this.filling, (this.seed % 7) + 1);
    var k = this.size / 0.032 * 1.25, self = this;
    var M = new THREE.Matrix4().compose(new THREE.Vector3(0, this._H * 0.64 - 0.0075 * k * 0.5, -0.16 * this.size), new THREE.Quaternion(), new THREE.Vector3(k, k, k));
    var core = new THREE.Group(); core.name = 'fillingCore';
    src.updateMatrixWorld(true);
    src.children.forEach(function (ch) {
      var g = ch.geometry.clone(), mm = new THREE.Matrix4().multiplyMatrices(M, ch.matrixWorld);
      g.applyMatrix4(mm);
      var p = g.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        var th = Math.atan2(-z, x), rho = Math.sqrt(x * x + z * z), cl = self._clip(th, y);
        if (rho > cl) { var nr = cl + 0.0005; p.setXYZ(i, Math.cos(th) * nr, y, -Math.sin(th) * nr); }
      }
      g.computeVertexNormals();
      var m = new THREE.Mesh(g, ch.material); m.castShadow = false; m.receiveShadow = true;
      core.add(m);
    });
    disposeTree(src);
    this.core = core; this.inner.add(core);
  };
  function disposeTree(o) {
    o.traverse(function (c) { if (c.geometry && c.geometry !== GRAIN_GEO) c.geometry.dispose(); });
  }

  // ---- 公開メソッド
  BP.squeeze = function (t, amount) {
    t = finite(t) ? clamp(t, 0, 1) : this.t;
    amount = finite(amount) ? clamp(amount, 0, 1) : 0.4;
    var tg = targetOutline(t);
    for (var i = 0; i < N; i++) this.outline[i] = lerp(this.outline[i], tg[i], amount);
    normalizeOutline(this.outline);
    this.t = t;
    this.formed = clamp(this.formed + amount * 0.6 + 0.02, 0, 1);
    this.rebuild();
    return this;
  };
  BP.setPress = function (p) {
    p = finite(p) ? clamp(p, 0, 1) : 0;
    this.press = p;
    this.inner.scale.set(1 - 0.08 * p, 1 + 0.07 * p, 1 + 0.035 * p);
  };
  BP.setSize = function (size) {
    if (!finite(size) || size <= 0) return;
    this.size = size;
    this._makeGrains();
    this.rebuild();
  };
  BP.setFilling = function (kind) {
    this.filling = validKind(kind);
    this._updateFilling();
    this._buildCore();
  };
  BP.setNori = function (v) {
    v = finite(v) ? clamp(v, 0, 1) : 0;
    this.nori = v;
    this._updateNori();
    this._placeGrains();
  };
  BP.bite = function () {
    if (this.bites >= 3) { this.group.visible = false; return true; }
    this.bites++;
    if (this.bites >= 3) { this.group.visible = false; return true; }
    this.rebuild();
    return false;
  };
  BP.topY = function () { return this._eval(0, 0, _v1).y * this.inner.scale.y; };
  BP.height = function () { return this._H; };
  BP.serialize = function () {
    var o = [];
    for (var i = 0; i < N; i++) o.push(Math.round(this.outline[i] * 10000) / 10000);
    return { outline: o, size: this.size, formed: this.formed, t: this.t, filling: this.filling, nori: this.nori, bites: this.bites, seed: this.seed, kind: this.kind };
  };
  BP.dispose = function () {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.mesh.geometry.dispose();
    if (this.noriMesh) this.noriMesh.geometry.dispose();
    if (this.grains) this.grains.dispose();
    if (this.piece) disposeTree(this.piece);
    if (this.core) disposeTree(this.core);
  };

  function createBody(opts) { return new Body(opts || {}); }

  function fromData(d) {
    try {
      if (!d || typeof d !== 'object') return null;
      var o = d.outline;
      if (!o || typeof o.length !== 'number' || o.length !== N) return null;
      for (var i = 0; i < N; i++) if (!finite(o[i]) || o[i] <= 0 || o[i] > 5) return null;
      if (!finite(d.size) || d.size <= 0 || d.size > 0.5) return null;
      var formed = d.formed === undefined ? 1 : d.formed;
      if (!finite(formed)) return null;
      var t = d.t === undefined || d.t === null ? 1 : d.t; if (!finite(t)) return null;
      var nori = d.nori === undefined ? 0 : d.nori; if (!finite(nori)) return null;
      var bites = d.bites === undefined ? 0 : d.bites; if (!finite(bites)) return null;
      var b = new Body({ size: d.size, seed: finite(d.seed) ? d.seed : undefined, kind: typeof d.kind === 'string' ? d.kind : 'lump' });
      for (i = 0; i < N; i++) b.outline[i] = o[i];
      normalizeOutline(b.outline);
      b.formed = clamp(formed, 0, 1); b.t = clamp(t, 0, 1);
      b.filling = validKind(d.filling); b.nori = clamp(nori, 0, 1);
      b.bites = clamp(Math.round(bites), 0, 3);
      b.rebuild();
      return b;
    } catch (e) { return null; }
  }

  function createScoop(size) {
    var b = new Body({ size: finite(size) && size > 0 ? size : 0.03, kind: 'scoop', dimple: 0, rough: 1.4 });
    b.formed = 0.0; b.rebuild();
    b.group.userData.body = b;
    return b.group;
  }

  // ---------------------------------------------------------------- 釜のごはん面
  function createPotRice(radius) {
    var R = finite(radius) && radius > 0 ? radius : 0.09;
    var NRp = 30, NAp = 96, group = new THREE.Group(); group.name = 'potRice';
    var pits = [], seed = Math.floor(Math.random() * 1000), digN = 0;
    var geo = new THREE.BufferGeometry(), pos = new Float32Array((NRp + 1) * NAp * 3), idx = [];
    for (var j = 0; j < NRp; j++) for (var i = 0; i < NAp; i++) {
      var a = j * NAp + i, b = (j + 1) * NAp + i, c = j * NAp + (i + 1) % NAp, d = (j + 1) * NAp + (i + 1) % NAp;
      idx.push(a, c, b, c, d, b);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    var mesh = new THREE.Mesh(geo, riceMaterial()); mesh.receiveShadow = true; mesh.castShadow = false;
    group.add(mesh);
    function height(x, z) {
      var r = Math.sqrt(x * x + z * z);
      var y = 0.0022 * noise3(x * 38 + seed, 0.3, z * 38) + 0.0012 * noise3(x * 95, 1.7 + seed, z * 95);
      y += 0.0045 * smooth(0.78 * R, R, r);
      for (var k = 0; k < pits.length; k++) {
        var P = pits[k], dx = x - P.x, dz = z - P.z;
        var u = (dx * P.ux + dz * P.uz) / P.a, v = (-dx * P.uz + dz * P.ux) / P.b, e = u * u + v * v;
        if (e < 1) y -= P.d * (1 - e) * (1 - e) * (0.85 + 0.15 * noise3(x * 120, 2.2, z * 120));
        var se = Math.sqrt(e) - 1; y += P.d * 0.2 * Math.exp(-se * se / 0.04);
      }
      return y;
    }
    var nG = tier() === 'low' ? 110 : 230;
    var grains = new THREE.InstancedMesh(grainGeo(), grainMaterial(), nG);
    grains.receiveShadow = true; grains.frustumCulled = false; group.add(grains);
    var gr = rng(seed + 5), gp = [], col = new THREE.Color();
    for (var g = 0; g < nG; g++) {
      gp.push({ r: Math.sqrt(gr()) * 0.95, a: gr() * TAU, rot: gr() * TAU, tilt: (gr() - 0.5) * 0.5, sc: 0.9 + gr() * 0.2, emb: gr() });
      var bb = 0.95 + gr() * 0.07; col.setRGB(bb, bb, bb * 0.99); grains.setColorAt(g, col);
    }
    function build() {
      var k = 0;
      for (var j = 0; j <= NRp; j++) {
        var rr = R * j / NRp;
        for (var i = 0; i < NAp; i++) {
          var th = i / NAp * TAU, x = Math.cos(th) * rr, z = -Math.sin(th) * rr;
          pos[k++] = x; pos[k++] = height(x, z); pos[k++] = z;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      var n = geo.attributes.normal.array, sx = 0, sy = 0, sz = 0, q;
      for (q = 0; q < NAp; q++) { sx += n[q * 3]; sy += n[q * 3 + 1]; sz += n[q * 3 + 2]; }
      var l = Math.hypot(sx, sy, sz) || 1;
      for (q = 0; q < NAp; q++) { n[q * 3] = sx / l; n[q * 3 + 1] = sy / l; n[q * 3 + 2] = sz / l; }
      geo.attributes.normal.needsUpdate = true;
      geo.computeBoundingSphere();
      var Nn = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), e = 0.001;
      for (var g = 0; g < nG; g++) {
        var o = gp[g], x = Math.cos(o.a) * o.r * R, z = -Math.sin(o.a) * o.r * R, y = height(x, z);
        Nn.set(-(height(x + e, z) - height(x - e, z)) / (2 * e), 1, -(height(x, z + e) - height(x, z - e)) / (2 * e)).normalize();
        T.set(Math.cos(o.rot), 0, Math.sin(o.rot)); T.addScaledVector(Nn, -T.dot(Nn)).normalize();
        T.addScaledVector(Nn, o.tilt).normalize();
        B.crossVectors(T, Nn).normalize(); var Ny = new THREE.Vector3().crossVectors(B, T).normalize();
        P.set(x, y, z).addScaledVector(Nn, 0.00105 * (-0.1 + (o.emb - 0.5) * 0.5));
        _m4.makeBasis(T, Ny, B); _m4.scale(_v4.set(o.sc, o.sc, o.sc)); _m4.setPosition(P);
        grains.setMatrixAt(g, _m4);
      }
      grains.instanceMatrix.needsUpdate = true;
      if (grains.instanceColor) grains.instanceColor.needsUpdate = true;
    }
    build();
    var ANG = [0.75, 2.55, 4.3, 5.6];
    return {
      group: group, mesh: mesh,
      dig: function () {
        var a = ANG[digN % 4] + (digN >= 4 ? 0.5 : 0), dist = R * (0.38 + 0.05 * (digN % 2));
        var ux = -Math.cos(a), uz = Math.sin(a);   // 長軸は中心向き
        var pa = Math.min(0.036, R * 0.4), pb = pa * 0.72;
        pits.push({ x: Math.cos(a) * dist, z: -Math.sin(a) * dist, ux: ux, uz: uz, a: pa, b: pb, d: Math.min(0.013, R * 0.14) });
        if (pits.length > 4) pits.shift();
        digN++;
        build();
        return pits.length;
      },
      count: function () { return pits.length; }
    };
  }

  function createGrain() {
    var m = new THREE.Mesh(grainGeo(), grainMaterial());
    m.castShadow = false; m.receiveShadow = true;
    return m;
  }

  G.Rice = {
    N: N,
    targetOutline: targetOutline,
    createBody: createBody,
    fromData: fromData,
    createFillingPiece: function (kind) { return createFillingPiece(kind, 1); },
    createFillingHeap: createFillingHeap,
    createNoriStrip: createNoriStrip,
    createScoop: createScoop,
    createPotRice: createPotRice,
    createGrain: createGrain,
    sampleOutline: sampleOutline,
    Body: Body
  };
  Object.defineProperty(G.Rice, 'material', { get: riceMaterial, enumerable: true });
  Object.defineProperty(G.Rice, 'noriMaterial', { get: noriMaterial, enumerable: true });
})();
