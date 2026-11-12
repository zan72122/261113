/* props.js — 台所のカウンターと道具（炊飯器・しゃもじ・まな板・盆と豆皿・大皿・湯のみ）
   すべて手続き生成。G.Props.build() -> props（scene には add しない）。 */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  var T = window.THREE;
  if (!T) { G.Props = { build: function () { return null; } }; return; }

  var PI = Math.PI;

  // ------------------------------------------------------------------ utils
  function texSize() {
    try { return (G.quality && G.quality.tier === 'low') ? 512 : 1024; } catch (e) { return 1024; }
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 1, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  // periodic value noise: x in [0,px), y in [0,py) lattice units
  function vnoise(x, y, px, py, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var fx = x - xi, fy = y - yi;
    var x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    var x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(u, v, px, py, seed, oct) {
    var s = 0, amp = 0.5, tot = 0;
    for (var i = 0; i < oct; i++) {
      s += amp * vnoise(u * px, v * py, px, py, seed + i * 31);
      tot += amp; px *= 2; py *= 2; amp *= 0.5;
    }
    return s / tot;
  }
  function sstep(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function canvasTex(c, srgb, repeat) {
    var t = new T.CanvasTexture(c);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.wrapS = t.wrapT = repeat ? T.RepeatWrapping : T.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function mesh(geo, mat, cast, recv) {
    var m = new T.Mesh(geo, mat);
    m.castShadow = cast !== false;
    m.receiveShadow = recv !== false;
    return m;
  }

  // merge non-indexed geometries (position, normal, [color], [uv])
  function mergeGeos(list) {
    var hasC = list[0].attributes.color, hasUV = list[0].attributes.uv;
    var n = 0, i, k;
    for (i = 0; i < list.length; i++) { if (list[i].index) list[i] = list[i].toNonIndexed(); n += list[i].attributes.position.count; }
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = hasC ? new Float32Array(n * 3) : null, U = hasUV ? new Float32Array(n * 2) : null;
    var o = 0;
    for (i = 0; i < list.length; i++) {
      var g = list[i], c = g.attributes.position.count;
      P.set(g.attributes.position.array, o * 3);
      N.set(g.attributes.normal.array, o * 3);
      if (C) C.set(g.attributes.color.array, o * 3);
      if (U && g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
      o += c;
      g.dispose();
    }
    var out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(P, 3));
    out.setAttribute('normal', new T.BufferAttribute(N, 3));
    if (C) out.setAttribute('color', new T.BufferAttribute(C, 3));
    if (U) out.setAttribute('uv', new T.BufferAttribute(U, 2));
    return out;
  }
  function paint(geo, color) {
    var n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    return geo;
  }

  // ------------------------------------------------------------------ rings & loft
  // superellipse ring (rounded box seen from above)
  function seRing(a, b, n, N, cz) {
    cz = cz || 0;
    var cs = [], sn = [];
    for (var i = 0; i < N; i++) {
      var t = 2 * PI * i / N, c = Math.cos(t), s = Math.sin(t);
      cs.push((c < 0 ? -1 : 1) * Math.pow(Math.abs(c), 2 / n));
      sn.push((s < 0 ? -1 : 1) * Math.pow(Math.abs(s), 2 / n));
    }
    return function (ins) {
      var p = [];
      for (var i = 0; i < N; i++) p.push([(a - ins) * cs[i], (b - ins) * sn[i] + cz]);
      return p;
    };
  }
  // rounded rectangle ring
  function rrRing(hw, hd, r, seg) {
    return function (ins) {
      var w = hw - ins, d = hd - ins, rr = Math.max(r - ins, 0.0008), p = [];
      var C = [[w - rr, d - rr], [-(w - rr), d - rr], [-(w - rr), -(d - rr)], [w - rr, -(d - rr)]];
      for (var k = 0; k < 4; k++) for (var s = 0; s <= seg; s++) {
        var a = (k + s / seg) * PI / 2;
        p.push([C[k][0] + rr * Math.cos(a), C[k][1] + rr * Math.sin(a)]);
      }
      return p;
    };
  }
  function circleRing(r, N, cx, cz) {
    var p = [];
    for (var i = 0; i < N; i++) { var t = 2 * PI * i / N; p.push([cx + r * Math.cos(t), cz + r * Math.sin(t)]); }
    return p;
  }
  // loft: profile = [[inset, y], ...] bottom -> top. Outward faces.
  function loft(ringFn, profile, opt) {
    opt = opt || {};
    var r0 = ringFn(profile[0][0]), N = r0.length;
    var pos = [], uv = [], idx = [], j, i, ring;
    var us = opt.uvScale || 0, uo = opt.uo || 0, vo = opt.vo || 0;
    var rings = [];
    for (j = 0; j < profile.length; j++) {
      ring = ringFn(profile[j][0]); rings.push(ring);
      for (i = 0; i < N; i++) {
        pos.push(ring[i][0], profile[j][1], ring[i][1]);
        if (us) uv.push(ring[i][0] / us + uo, -ring[i][1] / us + vo); else uv.push(i / N, j / (profile.length - 1));
      }
    }
    for (j = 0; j < profile.length - 1; j++) for (i = 0; i < N; i++) {
      var a = j * N + i, a1 = j * N + (i + 1) % N, b = (j + 1) * N + i, b1 = (j + 1) * N + (i + 1) % N;
      idx.push(a, b, a1, a1, b, b1);
    }
    function cap(ring, y, up, center) {
      var base = pos.length / 3, cx = center ? center[0] : 0, cz = center ? center[1] : 0;
      pos.push(cx, y, cz); uv.push(us ? cx / us + uo : 0.5, us ? -cz / us + vo : 0.5);
      for (i = 0; i < N; i++) { pos.push(ring[i][0], y, ring[i][1]); uv.push(us ? ring[i][0] / us + uo : 0.5, us ? -ring[i][1] / us + vo : 0.5); }
      for (i = 0; i < N; i++) {
        if (up) idx.push(base, base + 1 + (i + 1) % N, base + 1 + i);
        else idx.push(base, base + 1 + i, base + 1 + (i + 1) % N);
      }
    }
    if (opt.capTop) cap(rings[rings.length - 1], profile[profile.length - 1][1], true, opt.center);
    if (opt.capBottom) cap(rings[0], profile[0][1], false, opt.center);
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // flat annulus between two rings with the same point count (faces up)
  function annulusGeo(outer, inner, y) {
    var N = outer.length, pos = [], idx = [], uv = [], i;
    for (i = 0; i < N; i++) { pos.push(outer[i][0], y, outer[i][1]); uv.push(0, 0); }
    for (i = 0; i < N; i++) { pos.push(inner[i][0], y, inner[i][1]); uv.push(1, 1); }
    for (i = 0; i < N; i++) {
      var o = i, o1 = (i + 1) % N, n = N + i, n1 = N + (i + 1) % N;
      idx.push(n, o1, o, n, n1, o1);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function lathe(pts, seg) {
    var v = [];
    for (var i = 0; i < pts.length; i++) v.push(new T.Vector2(pts[i][0], pts[i][1]));
    return new T.LatheGeometry(v, seg || 64);
  }
  // per profile-point vertex colours on a LatheGeometry (fn(j) -> THREE.Color)
  function latheColors(geo, nPts, fn) {
    var n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (var k = 0; k < n; k++) {
      var c = fn(k % nPts);
      a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    return geo;
  }

  // ------------------------------------------------------------------ textures
  // tileable wood: grain lines run along U (= +X)
  function woodTex(o) {
    var S = o.size, c = newCanvas(S, S), b = newCanvas(S, S);
    var ctx = c.getContext('2d'), btx = b.getContext('2d');
    var img = ctx.createImageData(S, S), bim = btx.createImageData(S, S);
    var d = img.data, bd = bim.data;
    var rnd = mulberry(o.seed), NS = o.staves, st = [], k;
    for (k = 0; k < NS; k++) st.push({
      shade: 1 + (rnd() - 0.5) * o.staveVar, warm: (rnd() - 0.5) * o.staveVar * 0.6,
      phase: rnd() * 50, freq: o.rings * (0.75 + 0.5 * rnd()), fig: o.figure * (0.4 + rnd()),
      fm: 1 + Math.floor(rnd() * 2), fph: rnd() * 6.283
    });
    var pu = o.poreU, pv = S;
    var lw = o.lineWarp || 1;
    for (var y = 0; y < S; y++) {
      var v = y / S, kk = Math.floor(v * NS), s = st[kk], vl = v * NS - kk;
      var edgePx = Math.min(vl, 1 - vl) * S / NS;
      var edge = NS > 1 ? Math.max(0, 1 - edgePx / 1.3) * 0.6 : 0;
      for (var x = 0; x < S; x++) {
        var u = x / S;
        var w1 = vnoise(u * 3, v * 6, 3, 6, o.seed + kk * 7) - 0.5;
        var w2 = vnoise(u * 14, v * 28, 14, 28, o.seed + 3) - 0.5;
        var g = vl * s.freq + s.phase + w1 * 2.2 * lw + w2 * 0.5 * lw + s.fig * Math.sin(u * 6.2832 * s.fm + s.fph) * (0.6 + w1);
        var ring = g - Math.floor(g);
        var late = Math.pow(ring, o.latePow || 3);
        late = late * (1 - sstep(0.94, 1.0, ring));
        var pn = vnoise(u * pu, v * pv, pu, pv, o.seed + 11);
        var pore = sstep(o.poreLo || 0.74, 0.92, pn) * o.poreAmt * (0.45 + (1 - ring) * 0.9);
        var fib = vnoise(u * pu * 0.5, v * pv * 0.5, Math.max(1, (pu * 0.5) | 0), pv / 2, o.seed + 13) - 0.5;
        var blot = fbm(u, v, 3, 3, o.seed + 21, 3) - 0.5;
        var br = s.shade * (1 - o.lineDark * late) * (1 + blot * o.blotch) * (1 - pore) * (1 + fib * o.fiber) * (1 - edge * 0.28);
        var dk = 1 - br;
        var i4 = (y * S + x) * 4;
        d[i4] = clamp(o.base[0] * (1 - dk * 0.8) * (1 + s.warm), 0, 255);
        d[i4 + 1] = clamp(o.base[1] * (1 - dk), 0, 255);
        d[i4 + 2] = clamp(o.base[2] * (1 - dk * 1.25) * (1 - s.warm), 0, 255);
        d[i4 + 3] = 255;
        var bv = clamp(150 + late * 30 - pore * 260 + fib * 30 - edge * 120, 0, 255);
        bd[i4] = bd[i4 + 1] = bd[i4 + 2] = bv; bd[i4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0); btx.putImageData(bim, 0, 0);
    return { map: canvasTex(c, true, true), bump: canvasTex(b, false, true) };
  }

  function shamojiBumpTex() {
    var W = 256, H = 512, c = newCanvas(W, H), x = c.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
    var rnd = mulberry(77);
    // blade region: v from 0 (tip, z=-0.045) to ~0.45 ; canvas y = (1-v)*H (flipY)
    for (var i = 0; i < 1300; i++) {
      var u = rnd(), v = 0.53 + rnd() * 0.47;
      var px = u * W, py = (1 - v) * H;
      var r = 2.2 + rnd() * 1.4;
      var gr = x.createRadialGradient(px, py, 0, px, py, r * 1.6);
      gr.addColorStop(0, 'rgba(235,235,235,1)'); gr.addColorStop(0.6, 'rgba(190,190,190,0.6)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
      x.fillStyle = gr;
      x.beginPath(); x.ellipse(px, py, r * 1.6, r * 1.1, 0, 0, 2 * PI); x.fill();
    }
    return canvasTex(c, false, false);
  }

  function riceTex() {
    var S = 512, c = newCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = 'rgb(214,206,186)'; x.fillRect(0, 0, S, S);
    var rnd = mulberry(5);
    for (var i = 0; i < 1500; i++) {
      var px = rnd() * S, py = rnd() * S, a = rnd() * PI, L = 11 + rnd() * 5, Wd = 5.5 + rnd() * 1.5;
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        var cx = px + ox * S, cy = py + oy * S;
        if (cx < -20 || cx > S + 20 || cy < -20 || cy > S + 20) continue;
        x.save(); x.translate(cx, cy); x.rotate(a);
        x.fillStyle = 'rgba(150,140,120,0.35)';
        x.beginPath(); x.ellipse(1.5, 1.5, L, Wd, 0, 0, 2 * PI); x.fill();
        var gr = x.createRadialGradient(-L * 0.25, -Wd * 0.3, 0, 0, 0, L);
        gr.addColorStop(0, 'rgb(255,254,250)'); gr.addColorStop(0.7, 'rgb(244,240,228)'); gr.addColorStop(1, 'rgb(222,215,198)');
        x.fillStyle = gr;
        x.beginPath(); x.ellipse(0, 0, L, Wd, 0, 0, 2 * PI); x.fill();
        x.restore();
      }
    }
    return canvasTex(c, true, true);
  }

  function leafTex() {
    var W = 128, H = 1024, c = newCanvas(W, H), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgb(48,92,34)'); g.addColorStop(0.18, 'rgb(62,112,40)'); g.addColorStop(0.47, 'rgb(78,128,48)');
    g.addColorStop(0.5, 'rgb(150,182,98)'); g.addColorStop(0.53, 'rgb(78,128,48)');
    g.addColorStop(0.82, 'rgb(60,110,40)'); g.addColorStop(1, 'rgb(46,90,33)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // parallel veins
    var rnd = mulberry(9);
    for (var i = 1; i < 18; i++) {
      var u = i / 18; if (Math.abs(u - 0.5) < 0.03) continue;
      x.strokeStyle = 'rgba(' + (i % 3 === 0 ? '120,160,80,0.55' : '40,80,28,0.35') + ')';
      x.lineWidth = i % 3 === 0 ? 1.4 : 0.9;
      x.beginPath(); x.moveTo(u * W, 0); x.lineTo(u * W, H); x.stroke();
    }
    // tiny cross veinlets + mottling
    for (i = 0; i < 2200; i++) {
      var px = rnd() * W, py = rnd() * H;
      x.fillStyle = rnd() < 0.5 ? 'rgba(30,70,20,0.10)' : 'rgba(140,175,90,0.08)';
      x.fillRect(px, py, 2 + rnd() * 3, 1);
    }
    // midrib
    x.strokeStyle = 'rgba(190,210,140,0.75)'; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W / 2, H); x.stroke();
    // slightly pale dry margin (隈) near the edges, faint
    var e = x.createLinearGradient(0, 0, W, 0);
    e.addColorStop(0, 'rgba(200,205,150,0.35)'); e.addColorStop(0.06, 'rgba(200,205,150,0)');
    e.addColorStop(0.94, 'rgba(200,205,150,0)'); e.addColorStop(1, 'rgba(200,205,150,0.35)');
    x.fillStyle = e; x.fillRect(0, 0, W, H);
    return canvasTex(c, true, false);
  }

  function glowTex() {
    var S = 128, c = newCanvas(S, S), x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data;
    for (var y = 0; y < S; y++) for (var xx = 0; xx < S; xx++) {
      var dx = (xx + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, r = Math.sqrt(dx * dx + dy * dy);
      var ring = Math.exp(-Math.pow((r - 0.6) / 0.16, 2));
      var v = clamp(ring * 1.0 + Math.max(0, 1 - r) * 0.12, 0, 1) * (r < 1 ? 1 : 0);
      var i4 = (y * S + xx) * 4;
      d[i4] = 255 * v; d[i4 + 1] = 160 * v; d[i4 + 2] = 70 * v; d[i4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return canvasTex(c, true, false);
  }

  // ------------------------------------------------------------------ materials (shared)
  var M = null;
  function materials() {
    if (M) return M;
    var S = texSize();
    var oak = woodTex({ size: S, seed: 3, staves: 9, rings: 13, staveVar: 0.14, figure: 0.55, lineDark: 0.20,
      poreU: 110, poreAmt: 0.16, poreLo: 0.78, blotch: 0.10, fiber: 0.07, base: [206, 166, 118], latePow: 3 });
    oak.map.repeat.set(3.2, 3.2); oak.bump.repeat.set(3.2, 3.2);
    var hin = woodTex({ size: S, seed: 8, staves: 1, rings: 62, staveVar: 0.0, figure: 0.3, lineDark: 0.30,
      poreU: 160, poreAmt: 0.10, poreLo: 0.80, blotch: 0.14, fiber: 0.08, base: [240, 214, 168], latePow: 5, lineWarp: 0.7 });
    var trayS = Math.min(512, S);
    var wal = woodTex({ size: trayS, seed: 15, staves: 1, rings: 34, staveVar: 0.0, figure: 0.7, lineDark: 0.32,
      poreU: 120, poreAmt: 0.25, blotch: 0.18, fiber: 0.06, base: [104, 66, 44], latePow: 3 });

    M = {
      counter: new T.MeshStandardMaterial({ map: oak.map, bumpMap: oak.bump, bumpScale: 0.6, roughness: 0.52, metalness: 0 }),
      board: new T.MeshStandardMaterial({ map: hin.map, bumpMap: hin.bump, bumpScale: 0.5, roughness: 0.78, metalness: 0 }),
      tray: new T.MeshPhysicalMaterial({ map: wal.map, bumpMap: wal.bump, bumpScale: 0.4, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
      white: new T.MeshPhysicalMaterial({ color: 0xf2f1ec, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
      gray: new T.MeshStandardMaterial({ color: 0xc8c8c3, roughness: 0.45 }),
      grayDark: new T.MeshStandardMaterial({ color: 0x8c8d8c, roughness: 0.55 }),
      metal: new T.MeshStandardMaterial({ color: 0xd9d9d6, metalness: 1, roughness: 0.25, side: T.DoubleSide }),
      potCoat: new T.MeshPhysicalMaterial({ color: 0x252527, roughness: 0.42, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.3, side: T.DoubleSide }),
      panel: new T.MeshPhysicalMaterial({ color: 0x0d0f11, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 }),
      buttonWhite: new T.MeshPhysicalMaterial({ color: 0xfbfaf6, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
      bezel: new T.MeshStandardMaterial({ color: 0xc3c5c6, roughness: 0.3, metalness: 0.35 }),
      gasket: new T.MeshStandardMaterial({ color: 0x9fa2a3, roughness: 0.7 }),
      glaze: new T.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }),
      tea: new T.MeshPhysicalMaterial({ color: 0x86932f, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
      leaf: new T.MeshPhysicalMaterial({ map: leafTex(), roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.3, side: T.DoubleSide }),
      shamoji: new T.MeshPhysicalMaterial({ color: 0xf4f3ee, roughness: 0.38, clearcoat: 0.25, clearcoatRoughness: 0.35, bumpMap: shamojiBumpTex(), bumpScale: 4 }),
      rice: new T.MeshStandardMaterial({ map: riceTex(), roughness: 0.5, metalness: 0 }),
      ume: new T.MeshPhysicalMaterial({ color: 0x84101c, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
      sake: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62 }),
      kombu: new T.MeshPhysicalMaterial({ color: 0x1b2010, roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.15 })
    };
    M.rice.map.repeat.set(1, 1);
    M.rice.bumpMap = M.rice.map; M.rice.bumpScale = 0.8;
    return M;
  }

  // ------------------------------------------------------------------ cooker
  function buildCooker() {
    var g = new T.Group(); g.name = 'cooker';
    var A = 0.125, B = 0.15, NE = 2.7, NR = 96;
    var ring = seRing(A, B, NE, NR);
    var potZ = 0.008, potR = 0.0895;
    var bodyTop = 0.165;

    // base (light gray foot section)
    g.add(mesh(loft(ring, [[0.013, 0], [0.008, 0.0015], [0.0045, 0.005], [0.0032, 0.012], [0.0032, 0.0255]], { capBottom: true }), M.gray));
    // body
    g.add(mesh(loft(ring, [[0.0035, 0.0262], [0.001, 0.0285], [0, 0.033], [-0.0016, 0.085], [-0.0008, 0.130], [0.0005, 0.150],
      [0.0025, 0.1575], [0.0065, 0.162], [0.010, 0.1645], [0.012, bodyTop]]), M.white));
    g.add(mesh(loft(ring, [[0.0095, 0.1636], [0.0085, 0.1668]]), M.grayDark, false, false));
    // top annulus around pot opening
    g.add(mesh(annulusGeo(ring(0.012), circleRing(0.0995, NR, 0, potZ), bodyTop), M.white));
    // collar into cavity
    var collar = mesh(lathe([[0.0995, bodyTop], [0.0990, 0.158], [0.0978, 0.148], [0.096, 0.145]], 64), M.gray);
    collar.position.z = potZ; collar.material = M.gray; g.add(collar);
    // pot: metal rim + coated interior
    var rim = mesh(lathe([[0.0968, 0.148], [0.0968, 0.1585], [0.0958, 0.1612], [0.0938, 0.1622], [0.0920, 0.1612], [0.0909, 0.1585], [0.0905, 0.155]], 64), M.metal);
    rim.position.z = potZ; g.add(rim);
    var pot = mesh(lathe([[0.0905, 0.1552], [0.0902, 0.140], [0.0895, 0.125], [0.0880, 0.116], [0.084, 0.1115], [0.04, 0.1105], [0, 0.110]], 64), M.potCoat);
    pot.position.z = potZ; g.add(pot);

    // side grips
    var gripGeo = new T.CapsuleGeometry(0.0055, 0.075, 4, 12);
    gripGeo.rotateX(PI / 2); gripGeo.scale(0.55, 1, 1);
    [-1, 1].forEach(function (sx) {
      var m = mesh(gripGeo, M.gray); m.position.set(sx * (A + 0.0012), 0.128, -0.005); g.add(m);
      var shadowLine = mesh(new T.CapsuleGeometry(0.0022, 0.08, 3, 10).rotateX(PI / 2).scale(0.5, 1, 1), M.grayDark, false, true);
      shadowLine.position.set(sx * (A + 0.0005), 0.1205, -0.005); g.add(shadowLine);
    });
    // hinge block at back
    var hinge = mesh(new T.CylinderGeometry(0.008, 0.008, 0.10, 20).rotateZ(PI / 2), M.gray);
    hinge.position.set(0, bodyTop + 0.002, -0.139); g.add(hinge);

    // potAnchor / rice
    var potAnchor = new T.Object3D(); potAnchor.name = 'potAnchor';
    potAnchor.position.set(0, 0.128, potZ); g.add(potAnchor);
    var potRice = null;
    try {
      if (G.Rice && typeof G.Rice.createPotRice === 'function') {
        potRice = G.Rice.createPotRice(potR);
        if (potRice && potRice.group) { potRice.group.position.copy(potAnchor.position); g.add(potRice.group); } else potRice = null;
      }
    } catch (e) { potRice = null; }
    if (!potRice) {
      var rg = fallbackPotRice(potR);
      rg.position.copy(potAnchor.position); g.add(rg);
      potRice = { group: rg, dig: function () {} , fallback: true };
    }

    // ---- lid (pivot at rear hinge)
    var lidPivot = new T.Group(); lidPivot.name = 'lidPivot';
    var H = new T.Vector3(0, bodyTop + 0.004, -0.136);
    lidPivot.position.copy(H); g.add(lidPivot);
    var shell = new T.Group(); shell.position.set(0, bodyTop - H.y, -H.z); lidPivot.add(shell);
    var LT = 0.046;
    shell.add(mesh(loft(ring, [[0.0075, 0], [0.0045, 0.0007], [0.0022, 0.0030], [0.0010, 0.008], [0.0004, 0.016], [0.0012, 0.0245],
      [0.004, 0.0325], [0.0095, 0.0388], [0.017, 0.0425], [0.027, 0.0445], [0.045, 0.0455], [0.075, 0.0459], [0.10, LT]], { capTop: true }), M.white));
    // underside
    var under = mesh(loft(ring, [[0.0075, 0.0004], [0.0078, 0.0004]], { capBottom: true }), M.gray);
    shell.add(under);
    // inner lid (silver disc + gasket)
    var inner = new T.Group(); inner.position.set(0, 0, potZ); shell.add(inner);
    inner.add(mesh(lathe([[0, -0.0024], [0.03, -0.0024], [0.07, -0.0021], [0.088, -0.0016], [0.095, -0.0006], [0.0975, 0.0006]], 64), M.metal));
    var gk = mesh(new T.TorusGeometry(0.0915, 0.0022, 8, 72), M.gasket); gk.rotation.x = PI / 2; gk.position.y = -0.0018; inner.add(gk);
    var knob = mesh(lathe([[0.012, 0], [0.012, -0.0035], [0.009, -0.0055], [0, -0.0058]], 32), M.gray);
    knob.position.z = -0.03; inner.add(knob);
    var knob2 = mesh(new T.CylinderGeometry(0.008, 0.009, 0.004, 24), M.gray); knob2.position.set(0, -0.004, 0.05); inner.add(knob2);

    // control area on lid top: button, LED ring, panel
    var btnZ = 0.078, btnY = 0.0453;
    var ledMat = new T.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.35, emissive: 0xff7a1e, emissiveIntensity: 0 });
    var bez = mesh(lathe([[0.0238, -0.002], [0.0238, 0.0018], [0.0232, 0.0036], [0.0216, 0.0046], [0.0198, 0.0043], [0.0189, 0.0026], [0.0188, -0.001]], 64), M.bezel);
    bez.position.set(0, btnY, btnZ); shell.add(bez);
    var led = mesh(lathe([[0.0292, -0.001], [0.0292, 0.0006], [0.0288, 0.0011], [0.0251, 0.0011], [0.0246, 0.0006], [0.0246, -0.001]], 64), ledMat, false, true);
    led.position.set(0, btnY, btnZ); shell.add(led);
    var button = mesh(lathe([[0.0184, -0.004], [0.0184, 0.0016], [0.0180, 0.0031], [0.0172, 0.0038], [0.0150, 0.0036], [0.010, 0.0030], [0.005, 0.0027], [0, 0.0026]], 64), M.buttonWhite);
    button.name = 'cookerButton';
    button.position.set(0, btnY, btnZ); shell.add(button);
    var glow = new T.Mesh(new T.PlaneGeometry(0.085, 0.085).rotateX(-PI / 2),
      new T.MeshBasicMaterial({ map: glowTex(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.9 }));
    glow.position.set(0, btnY + 0.0016, btnZ); glow.visible = false; glow.renderOrder = 2; shell.add(glow);

    // display panel (dark glossy, no characters)
    var ps = new T.Shape(); roundRectPath(ps, 0.074, 0.026, 0.006);
    var pg = new T.ExtrudeGeometry(ps, { depth: 0.0004, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0008, bevelOffset: -0.0008, bevelSegments: 2, curveSegments: 8 });
    pg.rotateX(-PI / 2);
    var panel = mesh(pg, M.panel, false, true); panel.position.set(0, 0.0452, 0.027); shell.add(panel);
    var trim = mesh(loft(rrRing(0.0395, 0.0155, 0.0085, 6), [[-0.0008, -0.0005], [0, 0.0006], [0.0012, 0.0010], [0.0022, 0.0004]]), M.bezel, false, true);
    trim.position.set(0, 0.0452, 0.027); shell.add(trim);
    var dotG = new T.CircleGeometry(0.0011, 12).rotateX(-PI / 2);
    var dot1 = new T.Mesh(dotG, ledMat); dot1.position.set(0.029, 0.0465, 0.022); shell.add(dot1);
    var dot2 = new T.Mesh(dotG, M.grayDark); dot2.position.set(0.029, 0.0465, 0.031); shell.add(dot2);

    // steam vent cap (oval bump with oval hole)
    var vent = mesh(lathe([[0.019, -0.001], [0.019, 0.0006], [0.0175, 0.0032], [0.0145, 0.0062], [0.0105, 0.0082], [0.0078, 0.0083], [0.0068, 0.0072], [0.0064, 0.003]], 48), M.gray);
    vent.scale.set(1, 1, 0.72); vent.position.set(0, 0.0452, -0.062); shell.add(vent);
    var hole = new T.Mesh(new T.CircleGeometry(0.0066, 24).rotateX(-PI / 2), M.panel);
    hole.scale.set(1, 1, 0.72); hole.position.set(0, 0.0452 + 0.0035, -0.062); shell.add(hole);
    var steamAnchor = new T.Object3D(); steamAnchor.name = 'steamAnchor';
    steamAnchor.position.set(0, 0.0452 + 0.0095, -0.062); shell.add(steamAnchor);

    // API
    g.lid = lidPivot;
    g.button = button;
    g.steamAnchor = steamAnchor;
    g.potAnchor = potAnchor;
    g.potRadius = potR;
    g.potRice = potRice;
    g.lidValue = 0;
    g.setLid = function (v) {
      v = clamp(+v || 0, 0, 1); g.lidValue = v;
      lidPivot.rotation.x = -v * (95 * PI / 180);
    };
    g.pressButton = function (p) {
      p = clamp(+p || 0, 0, 1);
      button.position.y = btnY - 0.0026 * p;
    };
    g.ledOn = function (on) {
      on = !!on; g.ledIsOn = on;
      ledMat.emissiveIntensity = on ? 2.4 : 0;
      ledMat.color.setHex(on ? 0xffd2a6 : 0xe9e4da);
      dot1.material = ledMat;
      glow.visible = on;
    };
    g.ledOn(false);
    g.traverse(function (o) { if (o.isMesh && o !== glow && o.castShadow !== false) o.castShadow = true; });
    return g;
  }

  function fallbackPotRice(R) {
    var grp = new T.Group();
    var NRr = 18, NA = 64, pos = [], uv = [], idx = [];
    var rnd = mulberry(31);
    function h(x, z, r) {
      var n = (vnoise((x + 1) * 120, (z + 1) * 120, 4096, 4096, 3) - 0.5) * 0.0024 + (vnoise((x + 1) * 40, (z + 1) * 40, 4096, 4096, 7) - 0.5) * 0.004;
      var dome = 0.006 * (1 - Math.pow(r / R, 2));
      var edge = r > R * 0.9 ? -0.002 * sstep(R * 0.9, R, r) : 0;
      return dome + n * (1 - sstep(R * 0.92, R, r) * 0.5) + edge;
    }
    pos.push(0, h(0, 0, 0), 0); uv.push(0.5, 0.5);
    for (var j = 1; j <= NRr; j++) {
      var r = R * j / NRr;
      for (var i = 0; i < NA; i++) {
        var t = 2 * PI * i / NA, x = r * Math.cos(t), z = r * Math.sin(t);
        pos.push(x, h(x, z, r), z); uv.push(x / 0.1 + 0.5, -z / 0.1 + 0.5);
      }
    }
    for (i = 0; i < NA; i++) idx.push(0, 1 + (i + 1) % NA, 1 + i);
    for (j = 1; j < NRr; j++) for (i = 0; i < NA; i++) {
      var a = 1 + (j - 1) * NA + i, a1 = 1 + (j - 1) * NA + (i + 1) % NA, b = 1 + j * NA + i, b1 = 1 + j * NA + (i + 1) % NA;
      idx.push(a, a1, b, a1, b1, b);
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    grp.add(mesh(geo, M.rice, false, true));
    return grp;
  }

  function roundRectPath(s, w, d, r) {
    var x0 = -w / 2, y0 = -d / 2, x1 = w / 2, y1 = d / 2;
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -PI / 2, 0, false);
    s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, PI / 2, false);
    s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, PI / 2, PI, false);
    s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, PI, 1.5 * PI, false);
    return s;
  }

  // ------------------------------------------------------------------ shamoji
  function buildShamoji() {
    var g = new T.Group(); g.name = 'shamoji';
    var z0 = -0.045, z1 = 0.155, NZ = 96, NA = 22;
    function ell(z) {
      var zc = -0.008, A = z < zc ? 0.037 : 0.056, t = (z - zc) / A;
      if (Math.abs(t) >= 1) return 0;
      return 0.0330 * Math.pow(1 - t * t, z < zc ? 0.42 : 0.75);
    }
    function hand(z) {
      if (z < -0.005) return 0;
      var w = 0.0118 + 0.0022 * sstep(0.05, 0.15, z);
      var ze = z1 - 0.010;
      if (z > ze) { var t = (z - ze) / 0.010; w *= Math.sqrt(Math.max(0, 1 - t * t)); }
      return w;
    }
    function hw(z) {
      var a = ell(z), b = hand(z);
      if (z > 0.09) return b;
      var k = 0.012, hh = Math.max(k - Math.abs(a - b), 0) / k;
      return Math.max(a, b) + hh * hh * k * 0.25;
    }
    function bladeness(z) { return 1 - sstep(0.012, 0.06, z); }
    function ht(z) {
      var bl = bladeness(z);
      var t = 0.0014 + 0.0010 * sstep(-0.045, 0.03, z);
      var h = t * bl + 0.0042 * (1 - bl);
      if (z < z0 + 0.004) h *= Math.sqrt(Math.max(0.05, (z - z0) / 0.004));
      var ze = z1 - 0.010;
      if (z > ze) { var q = (z - ze) / 0.010; h *= Math.sqrt(Math.max(0.05, 1 - q * q)); }
      return h;
    }
    function yc(z) {
      var bl = bladeness(z);
      var bow = 0.0028 * Math.pow((z + 0.006) / 0.045, 2) * bl;
      var rise = z > 0.02 ? 0.05 * (z - 0.02) : 0;
      return bow + rise - 0.0019;
    }
    var pos = [], uv = [], idx = [];
    for (var j = 0; j <= NZ; j++) {
      var s = j / NZ;
      var z = z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos(s * PI)); // denser at ends
      var w = hw(z), h = ht(z), bl = bladeness(z), n = 2.5 + 3.5 * bl, cy = yc(z);
      for (var i = 0; i < NA; i++) {
        var p = 2 * PI * i / NA, c = Math.cos(p), sn = Math.sin(p);
        var x = (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), 2 / n) * w;
        var y = (sn < 0 ? -1 : 1) * Math.pow(Math.abs(sn), 2 / n) * h + cy + 0.0036 * bl * Math.pow(x / 0.0335, 2);
        pos.push(x, y, z);
        uv.push((x + 0.035) / 0.07, 1 - (z - z0) / 0.2);
      }
    }
    for (j = 0; j < NZ; j++) for (i = 0; i < NA; i++) {
      var a = j * NA + i, a1 = j * NA + (i + 1) % NA, b = (j + 1) * NA + i, b1 = (j + 1) * NA + (i + 1) % NA;
      idx.push(a, a1, b, a1, b1, b);
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    var m = mesh(geo, M.shamoji); m.name = 'shamojiMesh';
    g.add(m);
    g.mesh = m;
    var ha = new T.Object3D(); ha.name = 'handleAnchor'; ha.position.set(0, yc(0.105), 0.105); g.add(ha);
    var ba = new T.Object3D(); ba.name = 'bladeAnchor'; ba.position.set(0, 0.0004, -0.006); g.add(ba);
    g.handleAnchor = ha; g.bladeAnchor = ba;
    g.restY = 0.0034; // put origin this high to lie on the counter
    return g;
  }

  // ------------------------------------------------------------------ boards
  function buildBoard(w, d, withHole, uo, vo) {
    var g = new T.Group(); g.name = 'board';
    var s = new T.Shape(); roundRectPath(s, w, d, 0.014);
    if (withHole) { var h = new T.Path(); h.absarc(w / 2 - 0.022, 0, 0.0105, 0, 2 * PI, true); s.holes.push(h); }
    var bt = 0.0016, TH = 0.012;
    var geo = new T.ExtrudeGeometry(s, { depth: TH - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 3, curveSegments: 14 });
    geo.rotateX(-PI / 2); geo.translate(0, bt, 0);
    var uvA = geo.attributes.uv;
    for (var i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) / 0.34 + uo, uvA.getY(i) / 0.34 + vo);
    var m = mesh(geo, M.board); g.add(m); g.mesh = m;
    g.topY = TH;
    return g;
  }

  // ------------------------------------------------------------------ tray + dishes
  function dishGeo() {
    var pts = [[0, 0.0015], [0.0188, 0.0015], [0.0199, 0.0004], [0.0214, 0], [0.0230, 0.0004], [0.0237, 0.0022],
      [0.0275, 0.0043], [0.0315, 0.0073], [0.0342, 0.0103], [0.0352, 0.0117], [0.0350, 0.0127], [0.0342, 0.0130],
      [0.0332, 0.0121], [0.0302, 0.0093], [0.0250, 0.0066], [0.0150, 0.0055], [0, 0.0053]];
    var geo = lathe(pts, 48);
    var white = new T.Color(0xf5f3ee), foot = new T.Color(0xe2dccf);
    return latheColors(geo, pts.length, function (j) { return (j >= 1 && j <= 5) ? foot : white; });
  }
  function buildTray() {
    var g = new T.Group(); g.name = 'tray';
    var L = 0.30, W = 0.095, floorY = 0.0068;
    var ring = rrRing(L / 2, W / 2, 0.018, 8);
    g.add(mesh(loft(ring, [[0.0045, 0], [0.0018, 0.0007], [0.0003, 0.0028], [0, 0.0060], [0, 0.0122], [0.0005, 0.0146], [0.0017, 0.0158],
      [0.0034, 0.0159], [0.0048, 0.0149], [0.0056, 0.0128], [0.0059, 0.0095], [0.0064, 0.0076], [0.0078, 0.0069], [0.011, floorY], [0.02, floorY]],
      { capTop: true, uvScale: 0.42, uo: 0.13, vo: 0.4 }), M.tray));
    g.floorY = floorY;
    var kinds = ['ume', 'sake', 'kombu'], xs = [-0.096, 0, 0.096];
    var dg = dishGeo();
    g.dishes = [];
    for (var k = 0; k < 3; k++) {
      var dgp = new T.Group(); dgp.name = 'dish_' + kinds[k];
      dgp.position.set(xs[k], floorY, 0);
      var dm = mesh(dg, M.glaze); dgp.add(dm);
      var anchor = new T.Object3D(); anchor.name = 'dishAnchor'; anchor.position.set(0, 0.0053, 0); dgp.add(anchor);
      var heap = null;
      try {
        if (G.Rice && typeof G.Rice.createFillingHeap === 'function') heap = G.Rice.createFillingHeap(kinds[k]);
      } catch (e) { heap = null; }
      if (!heap || !heap.isObject3D) heap = fallbackHeap(kinds[k]);
      heap.position.set(0, 0.0053, 0);
      dgp.add(heap);
      g.add(dgp);
      g.dishes.push({ kind: kinds[k], anchor: anchor, group: dgp, heap: heap, mesh: dm });
    }
    return g;
  }

  function fallbackHeap(kind) {
    var grp = new T.Group(); grp.name = 'heap_' + kind;
    var rnd = mulberry(kind === 'ume' ? 101 : kind === 'sake' ? 202 : 303);
    var parts = [], mtx = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), sc = new T.Vector3(), p = new T.Vector3();
    var i;
    if (kind === 'ume') {
      var spots = [[-0.0105, 0.0, 0.006], [0.0105, 0.0, 0.006], [0, 0.0, -0.011], [0.0005, 0.0105, 0.0005]];
      for (i = 0; i < spots.length; i++) {
        var sg = new T.SphereGeometry(0.0098, 22, 16), pa = sg.attributes.position, ph = rnd() * 10;
        for (var v = 0; v < pa.count; v++) {
          var x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v);
          var wr = 1 + 0.07 * Math.sin(x * 1100 + ph) * Math.sin(z * 900 + y * 500) + 0.05 * Math.sin(y * 1700 + x * 600 + ph) + 0.03 * Math.sin(z * 2300 - x * 900);
          pa.setXYZ(v, x * wr, y * wr * 0.78, z * wr);
        }
        sg.computeVertexNormals();
        e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e);
        mtx.compose(p.set(spots[i][0], spots[i][1] + 0.0075, spots[i][2]), q, sc.set(1, 1, 1));
        sg.applyMatrix4(mtx);
        parts.push(sg);
      }
      grp.add(mesh(mergeGeos(parts), M.ume));
    } else if (kind === 'sake') {
      var cA = new T.Color(0xf29a78), cB = new T.Color(0xe57d5c), cC = new T.Color(0xf7c0a4);
      for (i = 0; i < 46; i++) {
        var ig = new T.IcosahedronGeometry(0.0042, 0);
        var a = rnd() * 2 * PI, r = Math.sqrt(rnd()) * 0.019;
        var yy = 0.0022 + (1 - Math.pow(r / 0.02, 2)) * 0.011 * (0.6 + 0.4 * rnd());
        e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e);
        mtx.compose(p.set(Math.cos(a) * r, yy, Math.sin(a) * r), q, sc.set(1.0 + rnd() * 1.0, 0.28 + rnd() * 0.18, 0.55 + rnd() * 0.45));
        ig.applyMatrix4(mtx);
        var col = rnd() < 0.15 ? cC : (rnd() < 0.5 ? cA : cB);
        parts.push(paint(ig.index ? ig.toNonIndexed() : ig, col));
      }
      grp.add(mesh(mergeGeos(parts), M.sake));
    } else {
      for (i = 0; i < 60; i++) {
        var bg = new T.BoxGeometry(0.016 + rnd() * 0.008, 0.0011, 0.0024, 4, 1, 1);
        var bp = bg.attributes.position;
        for (var vv = 0; vv < bp.count; vv++) { var bx = bp.getX(vv); bp.setY(vv, bp.getY(vv) + Math.sin(bx * 300) * 0.0012); }
        bg.computeVertexNormals();
        var a2 = rnd() * 2 * PI, r2 = Math.sqrt(rnd()) * 0.017;
        var y2 = 0.0012 + (1 - Math.pow(r2 / 0.018, 2)) * 0.010 * (0.5 + 0.5 * rnd());
        e.set((rnd() - 0.5) * 0.9, rnd() * PI * 2, (rnd() - 0.5) * 0.9); q.setFromEuler(e);
        mtx.compose(p.set(Math.cos(a2) * r2, y2, Math.sin(a2) * r2), q, sc.set(1, 1, 1));
        bg.applyMatrix4(mtx);
        parts.push(bg.toNonIndexed());
      }
      for (i = 0; i < parts.length; i++) parts[i].deleteAttribute('uv');
      grp.add(mesh(mergeGeos(parts), M.kombu));
    }
    return grp;
  }

  // ------------------------------------------------------------------ plate
  var PLATE_IN = [[0.1215, 0.0190], [0.112, 0.0152], [0.100, 0.0124], [0.090, 0.0111], [0.075, 0.0106], [0.04, 0.0105], [0, 0.0105]];
  function plateFloorY(r) {
    var P = PLATE_IN;
    if (r <= 0) return P[P.length - 1][1];
    for (var i = 0; i < P.length - 1; i++) {
      var a = P[i], b = P[i + 1];
      if (r <= a[0] && r >= b[0]) { var t = (r - b[0]) / (a[0] - b[0]); return b[1] + (a[1] - b[1]) * t; }
    }
    return P[0][1];
  }
  function buildPlate() {
    var g = new T.Group(); g.name = 'plate';
    var pts = [[0, 0.0035], [0.068, 0.0035], [0.0698, 0.0006], [0.0722, 0], [0.0748, 0.0006], [0.0765, 0.0035],
      [0.086, 0.0056], [0.100, 0.0078], [0.115, 0.0108], [0.126, 0.0150], [0.1318, 0.0186], [0.1349, 0.0212], [0.1353, 0.0225],
      [0.1342, 0.0235], [0.1322, 0.0234], [0.1300, 0.0228], [0.1288, 0.0224], [0.1268, 0.0216], [0.1255, 0.0211], [0.1240, 0.0203]].concat(PLATE_IN);
    var geo = lathe(pts, 96);
    var white = new T.Color(0xf6f4ef), blue = new T.Color(0x8fb0d6), foot = new T.Color(0xe3ddd0);
    latheColors(geo, pts.length, function (j) {
      if (j >= 1 && j <= 5) return foot;
      if (j >= 11 && j <= 14) return blue;     // lip line
      if (j === 16 || j === 17) return blue;   // inner thin line
      return white;
    });
    var pm = mesh(geo, M.glaze); pm.name = 'plateMesh'; g.add(pm); g.mesh = pm;

    // sasa leaf
    var Lf = 0.19, Wf = 0.023, NS = 44, NW = 10, pos = [], uv = [], idx = [];
    var rot = -0.62, cr = Math.cos(rot), sr = Math.sin(rot);
    function lw(s) {
      if (s < 0.035) return 0.0018;
      var a = (s - 0.035) / 0.965;
      if (a < 0.2) return Wf * Math.pow(Math.sin(a / 0.2 * PI / 2), 0.8) + 0.0018 * (1 - a / 0.2);
      return Wf * Math.pow(Math.cos((a - 0.2) / 0.8 * PI / 2), 1.15);
    }
    for (var j = 0; j <= NS; j++) {
      var s = j / NS, zl = (s - 0.5) * Lf, w = lw(s);
      for (var i = 0; i <= NW; i++) {
        var u = i / NW, xl = (u - 0.5) * 2 * w;
        var x = xl * cr - zl * sr, z = xl * sr + zl * cr, r = Math.sqrt(x * x + z * z);
        var y = plateFloorY(r) + 0.0007 + Math.abs(xl) * 0.10 + 0.0012 * Math.sin(s * PI * 2 + 1) * s;
        pos.push(x, y, z); uv.push(u, s);
      }
    }
    for (j = 0; j < NS; j++) for (i = 0; i < NW; i++) {
      var a0 = j * (NW + 1) + i, a1 = a0 + 1, b0 = a0 + NW + 1, b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    var lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    lg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    lg.setIndex(idx); lg.computeVertexNormals();
    var leaf = mesh(lg, M.leaf, true, true); leaf.name = 'sasa'; g.add(leaf); g.leaf = leaf;

    function slot(name, x, z, dy) {
      var o = new T.Object3D(); o.name = name;
      o.position.set(x, plateFloorY(Math.sqrt(x * x + z * z)) + (dy || 0), z); g.add(o); return o;
    }
    var sl = { mama: slot('slotMama', -0.055, -0.008, 0.0012), child: slot('slotChild', 0.05, -0.008, 0.0012), tiny: [] };
    for (var t = 0; t < 5; t++) {
      var ang = (50 + t * 20) * PI / 180;
      sl.tiny.push(slot('slotTiny' + t, -Math.cos(ang) * 0.088, Math.sin(ang) * 0.088, 0));
    }
    g.slots = sl;
    return g;
  }

  // ------------------------------------------------------------------ cups
  function cupProfile(H, R) {
    var outer = [[0, 0.0045], [R * 0.70, 0.0045], [R * 0.73, 0.0012], [R * 0.78, 0], [R * 0.83, 0.0006], [R * 0.85, 0.0042]];
    var n = 16, i;
    for (i = 0; i <= n; i++) {
      var y = 0.008 + (H - 0.012) * i / n, f = i / n;
      var r = R * (0.915 + 0.085 * Math.pow(f, 0.8)) + 0.00045 * Math.sin(f * PI * 7.5);
      outer.push([r, y]);
    }
    var t = 0.0034;
    outer.push([R + 0.0002, H - 0.0018], [R - 0.0008, H], [R - t + 0.0006, H - 0.0004], [R - t, H - 0.003]);
    for (i = n; i >= 0; i--) {
      var y2 = 0.012 + (H - 0.018) * i / n, f2 = i / n;
      outer.push([R * (0.915 + 0.085 * Math.pow(f2, 0.8)) - t, y2]);
    }
    outer.push([R * 0.6, 0.0085], [0, 0.0082]);
    return outer;
  }
  function innerR(H, R, y) { var f = clamp((y - 0.012) / (H - 0.018), 0, 1); return R * (0.915 + 0.085 * Math.pow(f, 0.8)) - 0.0034; }
  function buildCup(H, R, glazeHex, lipHex) {
    var g = new T.Group();
    var pts = cupProfile(H, R), geo = lathe(pts, 56);
    var glz = new T.Color(glazeHex), lip = new T.Color(lipHex), clay = new T.Color(0xa58a6e);
    var nOuterLip = 6 + 17; // index where lip begins
    latheColors(geo, pts.length, function (j) {
      if (j >= 1 && j <= 5) return clay;
      if (j >= nOuterLip - 1 && j <= nOuterLip + 3) return lip;
      return glz;
    });
    g.add(mesh(geo, M.glaze));
    var teaY = H * 0.78;
    var tea = mesh(new T.CircleGeometry(innerR(H, R, teaY) + 0.0003, 40).rotateX(-PI / 2), M.tea, false, true);
    tea.position.y = teaY; g.add(tea);
    var sa = new T.Object3D(); sa.position.set(0, teaY + 0.004, 0); g.add(sa);
    g.steamAnchor = sa;
    return g;
  }

  // ------------------------------------------------------------------ counter
  function buildCounter() {
    var geo = new T.PlaneGeometry(3.2, 3.2).rotateX(-PI / 2);
    var m = new T.Mesh(geo, M.counter);
    m.receiveShadow = true; m.castShadow = false; m.name = 'counter';
    return m;
  }

  // ------------------------------------------------------------------ build
  function build() {
    materials();
    var props = {};
    props.materials = M;
    props.counter = buildCounter();
    props.cooker = buildCooker();
    props.shamoji = buildShamoji();
    props.boardMama = buildBoard(0.27, 0.18, false, 0.11, 0.31);
    props.boardChild = buildBoard(0.23, 0.16, true, 0.57, 0.68);
    props.tray = buildTray();
    props.plate = buildPlate();
    var cups = new T.Group(); cups.name = 'cups';
    cups.big = buildCup(0.088, 0.037, 0x4c6378, 0x8a7a66);
    cups.small = buildCup(0.072, 0.031, 0xc2b394, 0x8f6e50);
    cups.big.position.set(-0.16, 0, 0);
    cups.small.position.set(0.16, 0, 0);
    cups.add(cups.big); cups.add(cups.small);
    cups.steamAnchors = [cups.big.steamAnchor, cups.small.steamAnchor];
    props.cups = cups;
    return props;
  }

  G.Props = { build: build, materials: function () { return materials(); } };
})();
