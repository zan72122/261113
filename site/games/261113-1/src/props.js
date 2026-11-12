/* props.js — 小物（ふとんばさみ 2 個とかご・籐のふとんたたき・まくら・飛び出す物 6 種）
   公開 API（G.props）:
     build()
     clipPoint(i, out) / clipGrab(i) / clipDragTo(i, vec3) / clipAttach(i, slot) / clipRelease(i)
     clipsPopOff() / clipsReset() / clipState(i) → 'basket'|'drag'|'on'|'fly' / clipGlow(g) / clipWiggle()
     beaterPoint(out) / beaterTake() / beaterSwing(vec3) / beaterReturn() / beaterState() → 'hook'|'held'
     beaterGlow(g) / beaterWiggle()
     pillowPoint(out) / pillowBounce(s)
     ITEM_IDS = ['sockA','ball','block','spoon','marble','sockB']
     popItem(id, fromVec3) / balconyItems() → [{id, pos}] / pokeItem(id) / clearBalconyItems()
     setTrayItems(ids) / trayJiggle(s)
   自分で鳴らす音: clip（はさんだ瞬間）clipPop（はじけ飛ぶ）pickup（たたきを取る）pop（物が飛び出す）
     ballBounce blockClack spoonTing marbleRoll sockFlop（着地・つついた時）。
   呼び出し側が鳴らす音: たたいた音・ほこり、まくらの pillow 音。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var P = (G.props = G.props || {});
  P.ITEM_IDS = ['sockA', 'ball', 'block', 'spoon', 'marble', 'sockB'];

  var GR = 9.8;
  var PI = Math.PI;

  // ---------- 小さな道具 ----------
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function eOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function eIn(t) { t = clamp(t, 0, 1); return t * t; }
  function eIO(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function eBack(t) { t = clamp(t, 0, 1); var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function snd(name, o) { try { if (G.audio && G.audio.play) G.audio.play(name, o || {}); } catch (e) { /* 無音で続ける */ } }
  // ばね（細かく刻んで安定させる）
  function spr(k, c, x) { return { x: x || 0, v: 0, t: x || 0, k: k, c: c }; }
  function sstep(s, dt) {
    var n = Math.ceil(dt / 0.006), h = dt / n;
    for (var i = 0; i < n; i++) { s.v += (s.k * (s.t - s.x) - s.c * s.v) * h; s.x += s.v * h; }
  }

  // build 内で作る一時オブジェクト
  var V3, QT, _a, _b, _c, _d, _e, _f, _q1, _q2, _q3, _m, _eu, UP, AX, AZ;
  var built = false;

  // ---------- テクスチャ（Canvas 自作） ----------
  function cnv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function ctex(c, srgb, rx, ry) {
    var t = new THREE.CanvasTexture(c);
    if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    var an = 4;
    try { an = Math.min(4, G.renderer.capabilities.getMaxAnisotropy()); } catch (e) { an = 1; }
    t.anisotropy = an;
    if (rx) t.repeat.set(rx, ry);
    return t;
  }
  function rattanTex() {
    var c = cnv(256, 64), x = c.getContext('2d'), r = rng(11);
    x.fillStyle = '#b58049'; x.fillRect(0, 0, 256, 64);
    for (var i = 0; i < 260; i++) {
      var y = r() * 64, h = 0.5 + r() * 1.8, l = r() < 0.5;
      x.fillStyle = l ? 'rgba(250,215,160,' + (0.08 + r() * 0.22) + ')' : 'rgba(80,42,14,' + (0.06 + r() * 0.2) + ')';
      x.fillRect(r() * 40 - 40, y, 256 + 80, h);
    }
    // 節
    [52, 181].forEach(function (nx) {
      var g = x.createLinearGradient(nx - 6, 0, nx + 6, 0);
      g.addColorStop(0, 'rgba(70,35,10,0)'); g.addColorStop(0.5, 'rgba(70,35,10,0.45)'); g.addColorStop(1, 'rgba(70,35,10,0)');
      x.fillStyle = g; x.fillRect(nx - 6, 0, 12, 64);
    });
    return ctex(c, true);
  }
  function stripeTex() {
    var c = cnv(64, 64), x = c.getContext('2d'), r = rng(5);
    x.fillStyle = '#b5393e'; x.fillRect(0, 0, 64, 32);
    x.fillStyle = '#ebe6db'; x.fillRect(0, 32, 64, 32);
    // 編み目
    for (var yy = 0; yy < 64; yy += 4) for (var xx = 0; xx < 64; xx += 4) {
      x.fillStyle = 'rgba(0,0,0,' + (0.05 + r() * 0.06) + ')'; x.fillRect(xx, yy + 3, 2, 1);
      x.fillStyle = 'rgba(255,255,255,' + (0.04 + r() * 0.05) + ')'; x.fillRect(xx + 1, yy + 1, 1, 2);
    }
    return ctex(c, true, 1 / 0.034, 1 / 0.034);
  }
  function cottonTex() {
    var c = cnv(512, 512), x = c.getContext('2d'), r = rng(23);
    x.fillStyle = '#f3f1ec'; x.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 512; i += 2) {
      x.fillStyle = 'rgba(120,110,95,' + (0.015 + r() * 0.02) + ')'; x.fillRect(0, i, 512, 1);
      x.fillStyle = 'rgba(120,110,95,' + (0.01 + r() * 0.015) + ')'; x.fillRect(i, 0, 1, 512);
    }
    for (i = 0; i < 1400; i++) { x.fillStyle = 'rgba(110,100,90,' + r() * 0.05 + ')'; x.fillRect(r() * 512, r() * 512, 1 + r() * 3, 1); }
    // ふちの縫い目（点線）
    x.strokeStyle = 'rgba(150,143,130,0.6)'; x.lineWidth = 2.2;
    x.setLineDash([7, 5]);
    x.beginPath(); x.rect(26, 26, 460, 460); x.stroke();
    x.setLineDash([]);
    return ctex(c, true);
  }
  function latticeTex() {
    var c = cnv(128, 128), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = '#000';
    function rr(px, py, w, h, rd) {
      x.beginPath(); x.moveTo(px + rd, py); x.lineTo(px + w - rd, py); x.quadraticCurveTo(px + w, py, px + w, py + rd);
      x.lineTo(px + w, py + h - rd); x.quadraticCurveTo(px + w, py + h, px + w - rd, py + h); x.lineTo(px + rd, py + h);
      x.quadraticCurveTo(px, py + h, px, py + h - rd); x.lineTo(px, py + rd); x.quadraticCurveTo(px, py, px + rd, py); x.fill();
    }
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) rr(8 + i * 64, 8 + j * 64, 48, 48, 9);
    return ctex(c, true, 1 / 0.03, 1 / 0.03);
  }
  function woodTex() {
    if (G.assets && G.assets.has && G.assets.has('wood')) {
      try { return G.assets.tex('wood', { repeat: [1.6, 1.6] }); } catch (e) { /* 下の自作へ */ }
    }
    var c = cnv(256, 256), x = c.getContext('2d'), r = rng(3);
    x.fillStyle = '#d9b98c'; x.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 90; i++) {
      var y = r() * 256;
      x.strokeStyle = 'rgba(140,95,50,' + (0.08 + r() * 0.18) + ')'; x.lineWidth = 0.6 + r() * 1.6;
      x.beginPath(); x.moveTo(0, y);
      for (var k = 0; k <= 8; k++) x.lineTo(k * 32, y + Math.sin(k * 0.9 + i) * 3);
      x.stroke();
    }
    return ctex(c, true, 6, 6);
  }

  // ---------- 形づくりの道具 ----------
  // 曲線に沿って断面（超楕円）を掃く。o: {segs, radial, a(s)|r, b(s), p, cap, closed, side(Vector3), uScale}
  function sweep(curve, o) {
    var L = curve.getLength(), n = o.segs || 48, rs = o.radial || 10, p = o.p || 2, cap = o.cap || 0;
    var q = 2 / p, uS = o.uScale === undefined ? 4 : o.uScale, ss = [], k;
    if (cap > 0 && !o.closed) {
      var cs = Math.min(cap / L, 0.45);
      for (k = 0; k < 5; k++) ss.push(cs * (1 - Math.cos(k / 5 * PI / 2)));
      for (k = 0; k <= n; k++) ss.push(cs + (1 - 2 * cs) * k / n);
      for (k = 4; k >= 0; k--) ss.push(1 - cs * (1 - Math.cos(k / 5 * PI / 2)));
    } else for (k = 0; k <= n; k++) ss.push(k / n);
    var rows = ss.length, pos = new Float32Array(rows * (rs + 1) * 3), nor = new Float32Array(rows * (rs + 1) * 3), uv = new Float32Array(rows * (rs + 1) * 2);
    var Pt = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), tmp = new THREE.Vector3();
    var vi = 0;
    for (var i = 0; i < rows; i++) {
      var s = ss[i];
      curve.getPointAt(s, Pt); curve.getTangentAt(s, T);
      if (o.side) { N.crossVectors(o.side, T).normalize(); B.crossVectors(T, N); }
      else if (i === 0) {
        tmp.set(0, 1, 0); if (Math.abs(T.y) > 0.9) tmp.set(1, 0, 0);
        N.crossVectors(T, tmp).normalize(); B.crossVectors(T, N);
      } else { N.crossVectors(B, T).normalize(); B.crossVectors(T, N); }
      var a = o.a ? o.a(s) : o.r, b = o.b ? o.b(s) : a, e = 1, ce = 0;
      if (cap > 0 && !o.closed) {
        var d = s * L, de = L - d;
        if (d < cap) { var c0 = 1 - d / cap; e = Math.sqrt(Math.max(0, 1 - c0 * c0)); ce = -c0; }
        else if (de < cap) { var c1 = 1 - de / cap; e = Math.sqrt(Math.max(0, 1 - c1 * c1)); ce = c1; }
      }
      for (var j = 0; j <= rs; j++) {
        var ang = j / rs * PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
        var cx = Math.sign(c) * Math.pow(Math.abs(c), q), cy = Math.sign(sn) * Math.pow(Math.abs(sn), q);
        var nx = Math.sign(c) * Math.pow(Math.abs(c), 2 - q) / a, ny = Math.sign(sn) * Math.pow(Math.abs(sn), 2 - q) / b;
        tmp.set(0, 0, 0).addScaledVector(N, nx).addScaledVector(B, ny).normalize().multiplyScalar(e).addScaledVector(T, ce).normalize();
        var o3 = vi * 3;
        pos[o3] = Pt.x + (N.x * cx * a + B.x * cy * b) * e;
        pos[o3 + 1] = Pt.y + (N.y * cx * a + B.y * cy * b) * e;
        pos[o3 + 2] = Pt.z + (N.z * cx * a + B.z * cy * b) * e;
        nor[o3] = tmp.x; nor[o3 + 1] = tmp.y; nor[o3 + 2] = tmp.z;
        uv[vi * 2] = s * L * uS; uv[vi * 2 + 1] = j / rs;
        vi++;
      }
    }
    var idx = [];
    for (i = 0; i < rows - 1; i++) for (j = 0; j < rs; j++) {
      var A = i * (rs + 1) + j, Bn = (i + 1) * (rs + 1) + j, C = Bn + 1, D = A + 1;
      idx.push(A, D, Bn, Bn, D, C);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  function crv(pts, closed) {
    var a = [];
    for (var i = 0; i < pts.length; i++) a.push(pts[i].isVector3 ? pts[i] : new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2]));
    return new THREE.CatmullRomCurve3(a, !!closed, 'centripetal');
  }
  function helix(y0, y1, r, pitch, ph) {
    var turns = (y1 - y0) / pitch, n = Math.ceil(turns * 14) + 2, pts = [];
    for (var i = 0; i <= n; i++) {
      var y = y0 + (y1 - y0) * i / n, a = ph + (y - y0) / pitch * PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    var c = new THREE.CatmullRomCurve3(pts);
    c.arcLengthDivisions = n * 4;
    return { c: c, turns: turns };
  }
  // 角を丸めた箱（UV はメートル単位の箱投影）
  function roundBox(w, h, d, r) {
    var g = new THREE.SphereGeometry(1, 16, 12), p = g.attributes.position, uv = g.attributes.uv;
    var hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    function sg(v) { return v > 1e-4 ? 1 : v < -1e-4 ? -1 : 0; }
    for (var i = 0; i < p.count; i++) {
      var nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i);
      var x = sg(nx) * hx + nx * r, y = sg(ny) * hy + ny * r, z = sg(nz) * hz + nz * r;
      p.setXYZ(i, x, y, z);
      var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      if (ax >= ay && ax >= az) uv.setXY(i, z, y); else if (ay >= az) uv.setXY(i, x, z); else uv.setXY(i, x, y);
    }
    return g;
  }
  function tf(g, x, y, z, rx, ry, rz, sx, sy, sz) {
    _eu.set(rx || 0, ry || 0, rz || 0);
    _q1.setFromEuler(_eu);
    _a.set(x || 0, y || 0, z || 0);
    _b.set(sx || 1, sy || 1, sz || 1);
    _m.compose(_a, _q1, _b);
    g.applyMatrix4(_m);
    return g;
  }
  function merge(gs) {
    var nv = 0, ni = 0, i;
    for (i = 0; i < gs.length; i++) { nv += gs[i].attributes.position.count; ni += gs[i].index ? gs[i].index.count : gs[i].attributes.position.count; }
    var pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    var idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni), ov = 0, oi = 0;
    for (i = 0; i < gs.length; i++) {
      var g = gs[i], cnt = g.attributes.position.count;
      pos.set(g.attributes.position.array, ov * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, ov * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, ov * 2);
      if (g.index) { var ia = g.index.array; for (var k = 0; k < ia.length; k++) idx[oi + k] = ia[k] + ov; oi += ia.length; }
      else { for (k = 0; k < cnt; k++) idx[oi + k] = ov + k; oi += cnt; }
      ov += cnt;
      g.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  function shadowAll(o) { o.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }
  function houseParent() { return (G.world && G.world.house) || G.scene; }

  // =====================================================================
  // ふとんばさみ + かご
  // =====================================================================
  var clips = [], basket = null, BK = {};          // BK: かごの寸法と位置
  var GRAB = 0.09;                                  // つかむ所（ちょうつがいから先へ 9cm）
  var TIP_L = 0.168, TIP_Z = 0.0045;               // 先の位置（閉じた時）
  var qOn, clipGlowV = 0;

  function leverGeo(sign) {
    var pts = [[-0.078, 0.030], [-0.05, 0.020], [-0.02, 0.0115], [0.0, 0.0095], [0.025, 0.017], [0.06, 0.040],
      [0.10, 0.050], [0.135, 0.040], [0.158, 0.018], [TIP_L, TIP_Z]];
    var arr = pts.map(function (p) { return new THREE.Vector3(0, p[0], p[1] * sign); });
    var c = new THREE.CatmullRomCurve3(arr, false, 'centripetal');
    var gs = [];
    gs.push(sweep(c, {
      segs: 56, radial: 16, p: 4, cap: 0.006, side: AX,
      a: function () { return 0.0036; },
      b: function (s) { return s < 0.3 ? 0.0135 + s * 0.008 : 0.016 + (s - 0.3) * 0.005; }
    }));
    // 先の内側のすべり止め（3 本）と、握りの外側のでこぼこ
    function bump(s, inward, w, l, h) {
      c.getPointAt(s, _a); c.getTangentAt(s, _b);
      _c.crossVectors(AX, _b).normalize();               // 断面の法線（yz 面）
      if ((_c.z * sign > 0) === inward) _c.negate();
      _d.crossVectors(_b, _c);
      var g = roundBox(w, l, h, Math.min(h, l) * 0.45);
      _m.makeBasis(_d, _b, _c);
      _m.setPosition(_a.x + _c.x * 0.0036, _a.y + _c.y * 0.0036, _a.z + _c.z * 0.0036);
      g.applyMatrix4(_m);
      gs.push(g);
    }
    bump(0.83, true, 0.026, 0.0035, 0.0026); bump(0.875, true, 0.028, 0.0035, 0.0026); bump(0.92, true, 0.026, 0.0035, 0.0026);
    bump(0.06, false, 0.02, 0.004, 0.002); bump(0.11, false, 0.021, 0.004, 0.002); bump(0.16, false, 0.022, 0.004, 0.002);
    // ちょうつがいの筒（左右 2 つ）
    var x0 = sign > 0 ? 0.0135 : 0.0075, x1 = sign > 0 ? 0.0195 : 0.013;
    [-1, 1].forEach(function (sx) {
      var g = new THREE.CylinderGeometry(0.0055, 0.0055, x1 - x0, 14);
      tf(g, sx * (x0 + x1) / 2, 0, 0, 0, 0, PI / 2);
      gs.push(g);
    });
    return merge(gs);
  }
  function springGeo() {
    var gs = [], pts = [];
    for (var i = 0; i <= 80; i++) {
      var t = i / 80, a = t * PI * 2 * 4;
      pts.push(new THREE.Vector3(-0.0068 + t * 0.0136, Math.cos(a) * 0.0058, Math.sin(a) * 0.0058));
    }
    gs.push(sweep(new THREE.CatmullRomCurve3(pts), { segs: 120, radial: 6, r: 0.0009, cap: 0.0009 }));
    var pin = new THREE.CylinderGeometry(0.0017, 0.0017, 0.042, 10);
    tf(pin, 0, 0, 0, 0, 0, PI / 2); gs.push(pin);
    [-1, 1].forEach(function (s) {
      var cap = new THREE.SphereGeometry(0.0026, 10, 6); tf(cap, s * 0.021, 0, 0, 0, 0, 0, 0.6, 1, 1); gs.push(cap);
    });
    return merge(gs);
  }
  function buildBasket() {
    var Lr = G.L.rail, Lb = G.L.clipBasket;
    var railInner = Lr.z + Lr.cap / 2;
    var W = 0.26, H = 0.16, D = 0.12;
    BK.top = Lr.y - 0.045;
    BK.zc = Math.max(Lb.z, railInner + 0.004 + D / 2);
    BK.x = Lb.x; BK.W = W; BK.D = D; BK.H = H;
    var grp = new THREE.Group();
    grp.position.set(BK.x, BK.top, BK.zc);
    var solid = [], lat = [];
    solid.push(tf(roundBox(W, 0.012, D, 0.004), 0, -H + 0.006, 0));
    // 底の足（少し浮かせる縁）
    solid.push(tf(roundBox(W - 0.01, 0.006, D - 0.01, 0.0025), 0, -H - 0.001, 0));
    // 格子の壁
    var wy = -H / 2 - 0.004, wh = H - 0.02;
    lat.push(tf(roundBox(W - 0.006, wh, 0.004, 0.0015), 0, wy, D / 2 - 0.003));
    lat.push(tf(roundBox(W - 0.006, wh, 0.004, 0.0015), 0, wy, -D / 2 + 0.003));
    lat.push(tf(roundBox(0.004, wh, D - 0.006, 0.0015), W / 2 - 0.003, wy, 0));
    lat.push(tf(roundBox(0.004, wh, D - 0.006, 0.0015), -W / 2 + 0.003, wy, 0));
    // 角の柱
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
      solid.push(tf(roundBox(0.012, H - 0.01, 0.012, 0.005), s[0] * (W / 2 - 0.006), -H / 2, s[1] * (D / 2 - 0.006)));
    });
    // ふちの太い枠
    var rr = 0.012, hw = W / 2 - 0.002, hd = D / 2 - 0.002, rim = [];
    for (var k = 0; k < 4; k++) {
      var cx = (k === 0 || k === 3) ? hw - rr : -(hw - rr), cz = (k < 2) ? hd - rr : -(hd - rr);
      var a0 = [0, PI / 2, PI, PI * 1.5][k];
      for (var j = 0; j <= 4; j++) { var a = a0 + j / 4 * PI / 2; rim.push(new THREE.Vector3(cx + Math.cos(a) * rr, -0.006, cz + Math.sin(a) * rr)); }
    }
    solid.push(sweep(new THREE.CatmullRomCurve3(rim, true, 'centripetal'), { closed: true, segs: 96, radial: 10, p: 3, side: UP, a: function () { return 0.0045; }, b: function () { return 0.0075; } }));
    // 笠木に掛かるフック 2 本
    var capTop = Lr.y - BK.top;
    [-0.075, 0.075].forEach(function (hx) {
      var c = crv([[hx, -0.008, -D / 2 + 0.002], [hx, capTop * 0.6, -D / 2 - 0.002], [hx, capTop + 0.0045, -D / 2 - 0.018],
        [hx, capTop + 0.0045, -D / 2 - 0.045], [hx, capTop - 0.006, -D / 2 - 0.058]]);
      solid.push(sweep(c, { segs: 30, radial: 10, p: 3, cap: 0.004, side: AX, a: function () { return 0.0032; }, b: function () { return 0.008; } }));
    });
    var matB = new THREE.MeshStandardMaterial({ color: 0xe6e6e1, roughness: 0.48, metalness: 0 });
    var matL = new THREE.MeshStandardMaterial({ color: 0xe6e6e1, roughness: 0.5, metalness: 0, map: latticeTex(), alphaTest: 0.5, side: THREE.DoubleSide });
    var m1 = new THREE.Mesh(merge(solid), matB), m2 = new THREE.Mesh(merge(lat), matL);
    grp.add(m1, m2);
    shadowAll(grp);
    G.scene.add(grp);
    basket = grp;
  }
  function buildClips() {
    var cols = [0x3f8fcf, 0xe8859f];   // 本物によくある 青 と ピンク（白いかごの中でも見つけやすい）
    var gA = leverGeo(1), gB = leverGeo(-1), gS = springGeo();
    var matM = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.9, roughness: 0.3 });
    qOn = new THREE.Quaternion().setFromAxisAngle(AX, PI);
    for (var i = 0; i < 2; i++) {
      var mat = new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.36, metalness: 0, emissive: 0xfff0d2, emissiveIntensity: 0 });
      var g = new THREE.Group(), inner = new THREE.Group();
      inner.position.y = -GRAB;
      var pa = new THREE.Group(), pb = new THREE.Group();
      pa.add(new THREE.Mesh(gA, mat)); pb.add(new THREE.Mesh(gB, mat));
      inner.add(pa, pb, new THREE.Mesh(gS, matM));
      g.add(inner);
      shadowAll(g);
      G.scene.add(g);
      var sx = i === 0 ? -1 : 1;
      var c = {
        i: i, group: g, pa: pa, pb: pb, mat: mat, state: 'basket', mode: 'rest', slot: i,
        bp: new THREE.Vector3(BK.x + sx * 0.058, BK.top + 0.03, BK.zc - 0.004),
        bq: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.09, PI / 2, sx * 0.09, 'YXZ')),
        vel: new THREE.Vector3(), target: new THREE.Vector3(),
        open: spr(700, 15, 0), wig: -1, wigD: 0, k: 0,
        p0: new THREE.Vector3(), q0: new THREE.Quaternion(),
        segs: [{ p0: new THREE.Vector3(), v0: new THREE.Vector3(), T: 1 }, { p0: new THREE.Vector3(), v0: new THREE.Vector3(), T: 1 }],
        nseg: 1, si: 0, st: 0, tt: 0, TT: 1, spin: false, spinAx: new THREE.Vector3(0, 0, 1), spinW: 0, popAt: -1, bounce: false, theta: 0.5
      };
      g.position.copy(c.bp); g.quaternion.copy(c.bq);
      clips.push(c);
    }
  }
  // 'on' の時の姿勢（ふとんの上から笠木ごとはさむ）
  function onPose(c, outP, outQ) {
    var Lr = G.L.rail, u = G.L.clipSlots[c.slot] !== undefined ? G.L.clipSlots[c.slot] : 0.5;
    var ok = false;
    if (G.futon && G.futon.pointAt) { try { G.futon.pointAt(u, 0.5, _e); ok = isFinite(_e.y); } catch (e) { ok = false; } }
    if (!ok) _e.set((u - 0.5) * G.L.futon.w, Lr.y + 0.05, Lr.z);
    var fl = (G.futon && typeof G.futon.fluff === 'number') ? G.futon.fluff : 0;
    var t = clamp(_e.y - Lr.y, 0.015, 0.22);
    var w = Lr.cap * 0.5 + t * 0.55;
    c.theta = clamp(Math.asin(clamp((w - TIP_Z) / TIP_L, 0, 0.99)), 0.25, 1.0);
    // 少しだけ傾けて自然に
    _eu.set(0, c.slot ? -0.05 : 0.06, c.slot ? 0.03 : -0.025);
    outQ.setFromEuler(_eu).multiply(qOn);
    _f.set(0, GRAB, 0).applyQuaternion(outQ);
    outP.set(_e.x, _e.y + 0.035 + 0.012 * fl, Lr.z).add(_f);
  }
  function planSeg(sg, p0, p1, T) {
    sg.p0.copy(p0); sg.T = T;
    sg.v0.set((p1.x - p0.x) / T, (p1.y - p0.y) / T + 0.5 * GR * T, (p1.z - p0.z) / T);
  }
  function planSegV(sg, p0, p1, vy) {
    var dy = p0.y - p1.y, T = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GR * dy))) / GR;
    T = Math.max(T, 0.15);
    sg.p0.copy(p0); sg.T = T;
    sg.v0.set((p1.x - p0.x) / T, vy, (p1.z - p0.z) / T);
  }
  function segAt(sg, t, out) {
    out.copy(sg.p0).addScaledVector(sg.v0, t);
    out.y -= 0.5 * GR * t * t;
    return out;
  }
  function startHop(c, nseg, spin) {
    c.mode = 'hop'; c.nseg = nseg; c.si = 0; c.st = 0; c.tt = 0; c.spin = spin;
    c.TT = c.segs[0].T + (nseg > 1 ? c.segs[1].T : 0);
    c.p0.copy(c.group.position); c.q0.copy(c.group.quaternion);
  }
  function launchPop(c) {
    snd('clipPop', { pan: clamp(c.group.position.x, -1, 1) * 0.6 });
    c.state = 'fly';
    var r = Math.random;
    if (c.bounce) {
      _a.set(c.bp.x + 0.03, BK.top + 0.06, BK.zc + BK.D / 2 + 0.05);
      planSegV(c.segs[0], c.group.position, _a, 3.1);
      planSeg(c.segs[1], _a, c.bp, 0.36);
      startHop(c, 2, true);
    } else {
      planSegV(c.segs[0], c.group.position, c.bp, 2.9);
      startHop(c, 1, true);
    }
    c.spinAx.set(0.25 + r() * 0.2, (r() - 0.5) * 0.3, c.i ? -1 : 1).normalize();
    c.spinW = 14 + r() * 4;
    c.open.t = 0; c.open.v = -16;
    c.popAt = -1;
  }
  function updateClips(dt, time) {
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i], g = c.group;
      if (c.popAt >= 0) { c.popAt -= dt; if (c.popAt < 0) launchPop(c); }
      if (c.mode === 'rest') {
        var hop = 0, rz = 0;
        if (c.wig >= 0) {
          c.wig += dt;
          var w = c.wig - c.wigD;
          if (w > 0) { var amp = Math.exp(-4.5 * w); rz = 0.075 * Math.sin(48 * w) * amp; hop = 0.005 * Math.abs(Math.sin(24 * w)) * amp; }
          if (w > 1.3) c.wig = -1;
        }
        g.position.copy(c.bp); g.position.y += hop;
        _q1.setFromAxisAngle(AZ, rz);
        g.quaternion.copy(c.bq).multiply(_q1);
        c.open.t = 0;
      } else if (c.mode === 'drag') {
        var n = Math.ceil(dt / 0.008), h = dt / n;
        for (var k = 0; k < n; k++) {
          c.vel.x += ((c.target.x - g.position.x) * 230 - c.vel.x * 21) * h;
          c.vel.y += ((c.target.y - g.position.y) * 230 - c.vel.y * 21) * h;
          c.vel.z += ((c.target.z - g.position.z) * 230 - c.vel.z * 21) * h;
          g.position.addScaledVector(c.vel, h);
        }
        _eu.set(clamp(-c.vel.z * 0.22, -0.5, 0.5), 0, clamp(c.vel.x * 0.25, -0.55, 0.55));
        _q1.setFromEuler(_eu).multiply(qOn);
        g.quaternion.slerp(_q1, 1 - Math.exp(-13 * dt));
        c.open.t = 0.42;
      } else if (c.mode === 'attach') {
        c.k += dt / 0.15;
        onPose(c, _a, _q2);
        var kk = eOut(c.k);
        g.position.lerpVectors(c.p0, _a, kk); g.position.y += 0.035 * Math.sin(PI * clamp(c.k, 0, 1));
        g.quaternion.slerpQuaternions(c.q0, _q2, kk);
        c.open.t = c.theta + 0.3;
        if (c.k >= 1) { c.mode = 'on'; snd('clip', { pan: clamp(g.position.x, -1, 1) * 0.6 }); c.open.t = c.theta; c.open.v = -9; }
      } else if (c.mode === 'on') {
        onPose(c, g.position, g.quaternion);
        c.open.t = c.theta;
      } else if (c.mode === 'hop') {
        c.st += dt; c.tt += dt;
        var sg = c.segs[c.si];
        if (c.st >= sg.T) {
          if (c.si < c.nseg - 1) {
            c.st -= sg.T; c.si++; sg = c.segs[c.si];
            snd('blockClack', { vol: 0.35, pitch: 1.5 });
            c.open.v += 8;
          } else {
            c.mode = 'rest'; c.state = 'basket'; c.wig = 0; c.wigD = 0;
            snd('blockClack', { vol: 0.28, pitch: 1.3 });
            g.position.copy(c.bp); g.quaternion.copy(c.bq);
            continue;
          }
        }
        segAt(sg, c.st, g.position);
        var f = c.tt / c.TT;
        if (c.spin) {
          _q1.setFromAxisAngle(c.spinAx, c.spinW * c.tt);
          _q2.copy(c.q0).multiply(_q1);
          g.quaternion.slerpQuaternions(_q2, c.bq, eIO((f - 0.55) / 0.45));
        } else g.quaternion.slerpQuaternions(c.q0, c.bq, eIO(f));
        if (c.state === 'basket') c.open.t = 0;
      }
      sstep(c.open, dt);
      var th = Math.max(-0.08, c.open.x);
      c.pa.rotation.x = th; c.pb.rotation.x = -th;
      var gl = (c.state === 'basket' && c.mode === 'rest') ? clipGlowV : 0;
      c.mat.emissiveIntensity += (gl * 0.32 - c.mat.emissiveIntensity) * Math.min(1, dt * 12);
    }
  }
  P.clipState = function (i) { return clips[i] ? clips[i].state : 'basket'; };
  P.clipPoint = function (i, out) {
    out = out || new THREE.Vector3();
    var c = clips[i]; if (!c) return out;
    return out.copy(c.mode === 'rest' ? c.bp : c.group.position);
  };
  P.clipGrab = function (i) {
    var c = clips[i]; if (!c || c.state === 'fly') return;
    c.state = 'drag'; c.mode = 'drag'; c.vel.set(0, 0, 0); c.target.copy(c.group.position); c.popAt = -1;
    c.open.v += 6;
  };
  P.clipDragTo = function (i, v) {
    var c = clips[i]; if (!c || c.mode !== 'drag' || !v) return;
    c.target.copy(v);
  };
  P.clipAttach = function (i, slot) {
    var c = clips[i]; if (!c) return;
    c.slot = slot | 0; c.state = 'on'; c.mode = 'attach'; c.k = 0; c.popAt = -1;
    c.p0.copy(c.group.position); c.q0.copy(c.group.quaternion);
  };
  P.clipRelease = function (i) {
    var c = clips[i]; if (!c || c.state === 'basket') return;
    c.state = 'basket'; c.popAt = -1;
    planSeg(c.segs[0], c.group.position, c.bp, 0.45);
    startHop(c, 1, false);
  };
  P.clipsPopOff = function () {
    var on = [];
    for (var i = 0; i < clips.length; i++) if (clips[i].state === 'on') on.push(clips[i]);
    for (i = 0; i < on.length; i++) {
      on[i].popAt = i * 0.12; on[i].bounce = (i === on.length - 1);
      if (on[i].mode === 'attach') { on[i].mode = 'on'; }
    }
  };
  P.clipsReset = function () {
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      c.state = 'basket'; c.mode = 'rest'; c.popAt = -1; c.wig = -1;
      c.open.x = c.open.t = c.open.v = 0;
      c.group.position.copy(c.bp); c.group.quaternion.copy(c.bq);
    }
  };
  P.clipGlow = function (g) { clipGlowV = clamp(g || 0, 0, 1); };
  P.clipWiggle = function () {
    for (var i = 0; i < clips.length; i++) if (clips[i].mode === 'rest') { clips[i].wig = 0; clips[i].wigD = i * 0.09; }
  };

  // =====================================================================
  // ふとんたたき（籐）
  // =====================================================================
  var BT = null;
  var B_GRIP = 0.09, B_HEAD = 0.40;     // 輪の中心 → 握り 9cm、握り → 編んだ輪の中心 40cm
  function beaterGeo() {
    var gs = [], i;
    // 吊り下げの輪
    gs.push(tf(new THREE.TorusGeometry(0.011, 0.0028, 8, 26), 0, 0, 0));
    // 2 本の籐をねじった柄
    for (i = 0; i < 2; i++) {
      var h = helix(0.008, 0.362, 0.0043, 0.075, i * PI);
      gs.push(sweep(h.c, { segs: Math.ceil(h.turns * 24), radial: 8, r: 0.0058, cap: 0.003, uScale: 4 }));
    }
    // 握りの巻き（籐の皮）
    var hg = helix(0.012, 0.125, 0.0104, 0.0039, 0);
    gs.push(sweep(hg.c, { segs: Math.ceil(hg.turns * 12), radial: 5, r: 0.0019, cap: 0.002, uScale: 6 }));
    var hn = helix(0.322, 0.37, 0.0104, 0.0039, 1);
    gs.push(sweep(hn.c, { segs: Math.ceil(hn.turns * 12), radial: 5, r: 0.0019, cap: 0.002, uScale: 6 }));
    // 先の編んだ輪（ハート〜花形の 4 本）
    var loops = [
      [[0, 0.356], [0.03, 0.40], [0.052, 0.47], [0.046, 0.54], [0.022, 0.586], [0, 0.568], [-0.022, 0.586], [-0.046, 0.54], [-0.052, 0.47], [-0.03, 0.40]],
      [[0, 0.36], [-0.04, 0.39], [-0.094, 0.43], [-0.116, 0.49], [-0.098, 0.542], [-0.058, 0.55], [-0.026, 0.5], [-0.008, 0.42]],
      [[0, 0.36], [0.04, 0.39], [0.094, 0.43], [0.116, 0.49], [0.098, 0.542], [0.058, 0.55], [0.026, 0.5], [0.008, 0.42]],
      [[0, 0.43], [0.03, 0.5], [0.036, 0.57], [0.013, 0.612], [-0.013, 0.612], [-0.036, 0.57], [-0.03, 0.5]]
    ];
    for (i = 0; i < loops.length; i++) {
      var base = crv(loops[i].map(function (p) { return [p[0], p[1], 0]; }), true), pts = [];
      for (var k = 0; k < 64; k++) {
        base.getPointAt(k / 64, _a);
        pts.push(new THREE.Vector3(_a.x, _a.y, 0.0034 * Math.sin(k / 64 * PI * 2 * 5 + i * 1.3)));
      }
      gs.push(sweep(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), { closed: true, segs: 130, radial: 7, r: 0.0052, uScale: 4 }));
    }
    return merge(gs);
  }
  function buildBeater() {
    var Lh = G.L.beaterHook, Lr = G.L.rail, railInner = Lr.z + Lr.cap / 2;
    var mat = new THREE.MeshStandardMaterial({ map: rattanTex(), roughness: 0.46, metalness: 0, emissive: 0xfff0d2, emissiveIntensity: 0 });
    var g = new THREE.Group(), inner = new THREE.Group();
    inner.position.y = -B_GRIP;
    inner.add(new THREE.Mesh(beaterGeo(), mat));
    g.add(inner);
    shadowAll(g);
    G.scene.add(g);
    // 笠木の小さなフック（金属）
    var zh = Math.max(Lh.z, railInner + 0.02);
    var hx = Lh.x;
    var hc = crv([[hx, Lr.y + 0.003, Lr.z + 0.015], [hx, Lr.y + 0.0035, railInner - 0.004], [hx, Lr.y - 0.012, railInner + 0.004],
      [hx, Lh.y + 0.012, railInner + 0.006], [hx, Lh.y - 0.0005, zh - 0.006], [hx, Lh.y + 0.0015, zh + 0.008], [hx, Lh.y + 0.013, zh + 0.014]]);
    var hook = new THREE.Mesh(sweep(hc, { segs: 50, radial: 8, r: 0.0021, cap: 0.002 }),
      new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.85, roughness: 0.38 }));
    shadowAll(hook);
    G.scene.add(hook);
    BT = {
      group: g, mat: mat, state: 'hook', mode: 'hook', k: 0, glow: 0,
      loop: new THREE.Vector3(hx, Lh.y - 0.0095, zh),
      qHook: new THREE.Quaternion().setFromAxisAngle(AZ, PI),
      sway: spr(26, 0.9, 0),
      p0: new THREE.Vector3(), q0: new THREE.Quaternion(),
      hp: new THREE.Vector3(), hq: new THREE.Quaternion(),
      sw: { t: 9, p0: new THREE.Vector3(), q0: new THREE.Quaternion(), sp: new THREE.Vector3(), sq: new THREE.Quaternion(),
        rp: new THREE.Vector3(), rq: new THREE.Quaternion(), up: new THREE.Vector3() },
      qc: new THREE.Quaternion()
    };
    // 構えの向き（カメラ空間）: 先は左上・奥へ、面は少しこちら向き
    var Y = new THREE.Vector3(-0.75, 0.42, -0.5).normalize();   // 右下の隅から左上へ浅く寝かせて構える（ふとんを隠さない）
    var Z = new THREE.Vector3(0.2, 0.3, 1);
    Z.addScaledVector(Y, -Z.dot(Y)).normalize();
    var X = new THREE.Vector3().crossVectors(Y, Z).normalize();
    _m.makeBasis(X, Y, Z); BT.qc.setFromRotationMatrix(_m);
    hookPose(0, g.position, g.quaternion);
  }
  function hookPose(time, outP, outQ) {
    var a = BT.sway.x + 0.012 * Math.sin(time * 1.4) + 0.006 * Math.sin(time * 0.53 + 1);
    _q3.setFromAxisAngle(AZ, a);
    outQ.copy(_q3).multiply(BT.qHook);
    _f.set(0, B_GRIP, 0).applyQuaternion(outQ);
    outP.copy(BT.loop).add(_f);
  }
  function heldPose(time, outP, outQ) {
    var cam = G.camera;
    if (!cam) { hookPose(time, outP, outQ); return; }
    var ty = Math.tan((cam.fov || 50) * PI / 360), tx = ty * (cam.aspect || 1);
    _f.set(0.8 * tx, -0.92 * ty, -1).normalize();
    var br = Math.sin(time * 1.7);
    _f.multiplyScalar(1.3);
    _f.y += 0.004 * br;
    _f.applyQuaternion(cam.quaternion);
    outP.copy(cam.position).add(_f);
    _q3.setFromAxisAngle(AX, 0.022 * Math.sin(time * 1.7 + 0.8));
    outQ.copy(cam.quaternion).multiply(BT.qc).multiply(_q3);
  }
  function updateBeater(dt, time) {
    if (!BT) return;
    var g = BT.group;
    sstep(BT.sway, dt);
    if (BT.mode === 'hook') hookPose(time, g.position, g.quaternion);
    else if (BT.mode === 'toHand' || BT.mode === 'toHook') {
      var dur = BT.mode === 'toHand' ? 0.35 : 0.45;
      BT.k += dt / dur;
      if (BT.mode === 'toHand') heldPose(time, _a, _q2); else hookPose(time, _a, _q2);
      var k = eIO(BT.k);
      g.position.lerpVectors(BT.p0, _a, k); g.position.y += 0.12 * Math.sin(PI * clamp(BT.k, 0, 1));
      g.quaternion.slerpQuaternions(BT.q0, _q2, k);
      if (BT.k >= 1) BT.mode = BT.mode === 'toHand' ? 'held' : 'hook';
    } else if (BT.mode === 'held') heldPose(time, g.position, g.quaternion);
    else if (BT.mode === 'swing') {
      var S = BT.sw, D = 0.07, R = 0.06, K = 0.22;
      S.t += dt;
      heldPose(time, BT.hp, BT.hq);
      if (S.t < D) {
        var a = eIn(S.t / D);
        g.position.lerpVectors(S.p0, S.sp, a).addScaledVector(S.up, 0.06 * Math.sin(PI * a));
        g.quaternion.slerpQuaternions(S.q0, S.sq, a);
      } else if (S.t < D + R) {
        var b = eOut((S.t - D) / R);
        g.position.lerpVectors(S.sp, S.rp, b);
        g.quaternion.slerpQuaternions(S.sq, S.rq, b);
      } else if (S.t < D + R + K) {
        var c = eIO((S.t - D - R) / K);
        g.position.lerpVectors(S.rp, BT.hp, c);
        g.quaternion.slerpQuaternions(S.rq, BT.hq, c);
      } else { BT.mode = 'held'; g.position.copy(BT.hp); g.quaternion.copy(BT.hq); }
    }
    var gl = BT.state === 'hook' ? BT.glow : 0;
    BT.mat.emissiveIntensity += (gl * 0.3 - BT.mat.emissiveIntensity) * Math.min(1, dt * 12);
  }
  P.beaterState = function () { return BT ? BT.state : 'hook'; };
  P.beaterPoint = function (out) {
    out = out || new THREE.Vector3();
    if (!BT) return out;
    var g = BT.group;
    if (BT.state === 'hook') { hookPose(G.time || 0, _a, _q2); _b.set(0, 0.2, 0).applyQuaternion(_q2); return out.copy(_a).add(_b); }
    _b.set(0, B_HEAD, 0).applyQuaternion(g.quaternion);
    return out.copy(g.position).add(_b);
  };
  P.beaterTake = function () {
    if (!BT || BT.state === 'held') return;
    BT.state = 'held'; BT.mode = 'toHand'; BT.k = 0;
    BT.p0.copy(BT.group.position); BT.q0.copy(BT.group.quaternion);
    snd('pickup');
  };
  P.beaterReturn = function () {
    if (!BT || BT.state === 'hook') return;
    BT.state = 'hook'; BT.mode = 'toHook'; BT.k = 0;
    BT.p0.copy(BT.group.position); BT.q0.copy(BT.group.quaternion);
  };
  P.beaterSwing = function (v) {
    if (!BT || BT.state !== 'held' || !v || !G.camera) return;
    var S = BT.sw, g = BT.group, cam = G.camera;
    S.t = 0; BT.mode = 'swing';
    S.p0.copy(g.position); S.q0.copy(g.quaternion);
    heldPose(G.time || 0, BT.hp, BT.hq);
    // 面がふとんに向くよう N（ふとん → カメラ）を面の法線にする
    _c.copy(cam.position).sub(v); if (_c.lengthSq() < 1e-6) _c.set(0, 0, 1); _c.normalize();
    _d.set(0, 1, 0).applyQuaternion(BT.hq);
    _d.addScaledVector(_c, -_d.dot(_c));
    if (_d.lengthSq() < 1e-6) _d.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _d.normalize();
    _e.crossVectors(_d, _c).normalize();
    _d.crossVectors(_c, _e);
    _m.makeBasis(_e, _d, _c); S.sq.setFromRotationMatrix(_m);
    S.sp.copy(v).addScaledVector(_c, 0.012).addScaledVector(_d, -B_HEAD);
    S.rp.copy(S.sp).addScaledVector(_c, 0.045);
    S.rq.slerpQuaternions(S.sq, BT.hq, 0.18);
    S.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
  };
  P.beaterGlow = function (g) { if (BT) BT.glow = clamp(g || 0, 0, 1); };
  P.beaterWiggle = function () { if (BT && BT.mode === 'hook') BT.sway.v += (BT.sway.x > 0 ? -1 : 1) * 1.3; };

  // =====================================================================
  // まくら
  // =====================================================================
  var PL = null;
  function pillowGeo() {
    var W = 0.5, D = 0.35, NU = 26, NV = 20, y0 = 0.016, HT = 0.074;
    var rows = NV + 1, cols = NU + 1, pos = [], uv = [], idx = [], r = rng(7);
    function plan(tu, tv, out) {
      var u = Math.sin(tu * PI / 2), v = Math.sin(tv * PI / 2);
      out.x = u * W / 2 * (1 - 0.05 * (1 - v * v));
      out.z = v * D / 2 * (1 - 0.065 * (1 - u * u));
      out.f = Math.pow(Math.max(0, (1 - u * u) * (1 - v * v)), 0.42);
      return out;
    }
    var o = {}, side, i, j;
    for (side = 0; side < 2; side++) {
      for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) {
        var tu = -1 + 2 * i / NU, tv = -1 + 2 * j / NV;
        plan(tu, tv, o);
        var wr = (r() - 0.5) * 0.0012 * o.f;
        var y = side === 0 ? y0 + HT * o.f + wr : y0 * (1 - Math.min(1, o.f * 2.6));
        pos.push(o.x, y, o.z); uv.push(i / NU, j / NV);
      }
    }
    var off = rows * cols;
    for (j = 0; j < NV; j++) for (i = 0; i < NU; i++) {
      var a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);                         // 上面
      idx.push(off + a, off + b, off + c, off + b, off + d, off + c);   // 下面
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // ふちのパイピング
    var ring = [];
    for (i = 0; i < 4; i++) for (j = 0; j < 16; j++) {
      var t = -1 + 2 * j / 16, pu, pv;
      if (i === 0) { pu = t; pv = -1; } else if (i === 1) { pu = 1; pv = t; } else if (i === 2) { pu = -t; pv = 1; } else { pu = -1; pv = -t; }
      plan(pu, pv, o);
      ring.push(new THREE.Vector3(o.x, y0, o.z));
    }
    var pip = sweep(new THREE.CatmullRomCurve3(ring, true, 'centripetal'), { closed: true, segs: 160, radial: 8, r: 0.0034, uScale: 0 });
    return merge([g, pip]);
  }
  function buildPillow() {
    var Lp = G.L.pillow;
    var grp = new THREE.Group();
    grp.position.set(Lp.x, G.L.mattress.top, Lp.z);
    var mesh = new THREE.Mesh(pillowGeo(), new THREE.MeshStandardMaterial({ map: cottonTex(), roughness: 0.92, metalness: 0 }));
    grp.add(mesh);
    grp.rotation.y = 0.04;
    shadowAll(grp);
    houseParent().add(grp);
    PL = { group: grp, mesh: mesh, y: 0, v: 0, air: false, rx: spr(55, 4.5), rz: spr(55, 4.5), sq: spr(320, 11, 1), s: 0 };
  }
  function updatePillow(dt) {
    if (!PL) return;
    if (PL.air) {
      PL.v -= GR * dt; PL.y += PL.v * dt;
      if (PL.y <= 0 && PL.v < 0) { PL.y = 0; PL.air = false; PL.sq.v += PL.v * 3.2; PL.rx.v *= 0.5; PL.rz.v *= 0.5; }
    }
    sstep(PL.rx, dt); sstep(PL.rz, dt); sstep(PL.sq, dt);
    var g = PL.group;
    g.position.y = G.L.mattress.top + PL.y;
    g.rotation.x = PL.rx.x; g.rotation.z = PL.rz.x;
    var s = clamp(PL.sq.x, 0.6, 1.3);
    PL.mesh.scale.set(1 + (1 - s) * 0.35, s, 1 + (1 - s) * 0.35);
  }
  P.pillowPoint = function (out) {
    out = out || new THREE.Vector3();
    if (!PL) return out.set(G.L.pillow.x, G.L.mattress.top + 0.09, G.L.pillow.z);
    return out.set(PL.group.position.x, PL.group.position.y + 0.09 * PL.mesh.scale.y, PL.group.position.z);
  };
  P.pillowBounce = function (s) {
    if (!PL) return;
    s = clamp(s === undefined ? 1 : s, 0, 1.5);
    PL.v = Math.sqrt(2 * GR * 0.12 * s); PL.air = true;
    PL.sq.v += 2.5 * s;
    PL.rx.v += (Math.random() - 0.5) * 2.4 * s; PL.rz.v += (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random()) * s;
  };

  // =====================================================================
  // 飛び出す物
  // =====================================================================
  var DEF = {
    sockA: { kind: 'sock', restY: 0.0055, collR: 0.012 },
    sockB: { kind: 'sock', restY: 0.0055, collR: 0.012 },
    ball: { kind: 'ball', restY: 0.0225, collR: 0.0225 },
    block: { kind: 'block', restY: 0.02, collR: 0.024 },
    spoon: { kind: 'spoon', restY: 0.0085, collR: 0.012 },
    marble: { kind: 'marble', restY: 0.011, collR: 0.011 }
  };
  var ZOFF = { ball: -0.26, marble: -0.2, spoon: -0.07, block: -0.03, sock: 0 };
  var protos = {}, items = {}, itemList = [], trayItems = {}, outList = [], spoonMat = null, envChecked = 0;

  function sockGeo() {
    var s = new THREE.Shape(), k = 1.08;
    function mv(x, y) { s.moveTo(x * k, y * k); }
    function ln(x, y) { s.lineTo(x * k, y * k); }
    function qc(a, b, x, y) { s.quadraticCurveTo(a * k, b * k, x * k, y * k); }
    mv(0.006, 0.112); ln(0.003, 0.05); qc(0.0, 0.004, 0.032, 0.002); ln(0.118, 0.003);
    qc(0.149, 0.006, 0.148, 0.027); qc(0.146, 0.05, 0.118, 0.051); ln(0.078, 0.05);
    qc(0.058, 0.05, 0.058, 0.068); ln(0.059, 0.112); qc(0.032, 0.116, 0.006, 0.112);
    var g = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.0042, bevelSegments: 3, curveSegments: 12, steps: 1 });
    g.center();
    g.rotateX(-PI / 2);
    smoothNormals(g);
    return g;
  }
  // 位置が同じ頂点の法線を平均してなめらかに（Extrude の面取りが角ばらないように）
  function smoothNormals(g) {
    var p = g.attributes.position.array, n = g.attributes.normal.array, cnt = p.length / 3, map = {}, acc = [], key = new Array(cnt), i;
    for (i = 0; i < cnt; i++) {
      var k = Math.round(p[i * 3] * 2e4) + ',' + Math.round(p[i * 3 + 1] * 2e4) + ',' + Math.round(p[i * 3 + 2] * 2e4);
      if (map[k] === undefined) { map[k] = acc.length / 3; acc.push(0, 0, 0); }
      key[i] = map[k];
    }
    var flat = new Uint8Array(cnt);
    for (i = 0; i < cnt; i += 3) {
      var ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2];
      var ux = p[i * 3 + 3] - ax, uy = p[i * 3 + 4] - ay, uz = p[i * 3 + 5] - az;
      var vx = p[i * 3 + 6] - ax, vy = p[i * 3 + 7] - ay, vz = p[i * 3 + 8] - az;
      var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      var cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
      if (Math.abs(cy / cl) > 0.999) { flat[i] = flat[i + 1] = flat[i + 2] = 1; continue; }   // 平らな面はそのまま
      for (var j = 0; j < 3; j++) { var q = key[i + j] * 3; acc[q] += cx; acc[q + 1] += cy; acc[q + 2] += cz; }
    }
    for (i = 0; i < cnt; i++) {
      if (flat[i]) continue;
      var o = key[i] * 3, l = Math.sqrt(acc[o] * acc[o] + acc[o + 1] * acc[o + 1] + acc[o + 2] * acc[o + 2]) || 1;
      n[i * 3] = acc[o] / l; n[i * 3 + 1] = acc[o + 1] / l; n[i * 3 + 2] = acc[o + 2] / l;
    }
    g.attributes.normal.needsUpdate = true;
  }
  function spoonGeo() {
    var gs = [];
    var bowl = new THREE.SphereGeometry(1, 22, 8, 0, PI * 2, PI / 2, PI / 2);
    tf(bowl, 0, 0, 0, 0, 0, 0, 0.0165, 0.0065, 0.025);
    gs.push(bowl);
    var hc = crv([[0, -0.0005, 0.021], [0, 0.0015, 0.04], [0, 0.0055, 0.065], [0, 0.0075, 0.09], [0, 0.007, 0.106]]);
    gs.push(sweep(hc, {
      segs: 40, radial: 10, p: 4, cap: 0.005, side: AX,
      a: function () { return 0.0012; },
      b: function (s) { return s < 0.25 ? 0.0032 + s * 0.004 : 0.0042 + (s - 0.25) * 0.004; }
    }));
    var g = merge(gs);
    g.translate(0, 0, -0.04);
    return g;
  }
  function buildProtos() {
    var stripe = stripeTex();
    var sockMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.96, metalness: 0 });
    var sg = sockGeo();
    var a = new THREE.Group(); a.add(new THREE.Mesh(sg, sockMat)); protos.sockA = a;
    var b = new THREE.Group(); var mb = new THREE.Mesh(sg, sockMat); mb.scale.x = -1; b.add(mb); protos.sockB = b;
    var ballMat = new THREE.MeshPhysicalMaterial({ color: 0xa8151d, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x2a0306 });
    var ball = new THREE.Group(); ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.0225, 28, 18), ballMat)); protos.ball = ball;
    var wood = woodTex();
    var blk = new THREE.Group();
    blk.add(new THREE.Mesh(roundBox(0.04, 0.04, 0.04, 0.0035), new THREE.MeshStandardMaterial({ map: wood, color: 0xf3e6cf, roughness: 0.6, metalness: 0 })));
    protos.block = blk;
    spoonMat = new THREE.MeshStandardMaterial({ color: 0xd8dbde, metalness: 1, roughness: 0.2, side: THREE.DoubleSide });
    var sp = new THREE.Group(); sp.add(new THREE.Mesh(spoonGeo(), spoonMat)); protos.spoon = sp;
    var mar = new THREE.Group();
    var streak = crv([[-0.0065, -0.003, 0.001], [-0.003, 0.002, -0.002], [0.0, -0.001, 0.0015], [0.003, 0.003, -0.001], [0.0065, -0.0015, 0.001]]);
    mar.add(new THREE.Mesh(sweep(streak, { segs: 40, radial: 10, a: function () { return 0.0042 ; }, b: function () { return 0.0007; }, cap: 0.002 }),
      new THREE.MeshStandardMaterial({ color: 0x1f5f96, roughness: 0.35, metalness: 0 })));
    var glass = new THREE.Mesh(new THREE.SphereGeometry(0.011, 24, 16), new THREE.MeshPhysicalMaterial({
      color: 0x86cbbf, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.42
    }));
    glass.renderOrder = 2;
    glass.castShadow = true;
    mar.add(glass);
    protos.marble = mar;
    for (var id in protos) shadowAll(protos[id]);
    protos.marble.children[1].receiveShadow = false;
  }
  function buildItems() {
    var r = rng(41);
    for (var i = 0; i < P.ITEM_IDS.length; i++) {
      var id = P.ITEM_IDS[i], o = protos[id].clone();
      o.visible = false;
      G.scene.add(o);
      var it = {
        id: id, obj: o, def: DEF[id], kind: DEF[id].kind, active: false, mode: 'none', slot: -1,
        p: o.position, q: o.quaternion, v: new THREE.Vector3(), w: new THREE.Vector3(), b: 0, k: 0, sc: 1,
        q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), p0: new THREE.Vector3(), pv: new THREE.Vector3(), ax: new THREE.Vector3(),
        y0: 0, dur: 0.2, entry: { id: id, pos: new THREE.Vector3() }, yaw: r() * PI * 2
      };
      items[id] = it; itemList.push(it);
    }
  }
  // 回転を進める
  function spinQ(q, w, dt) {
    var l = w.length(); if (l < 1e-6) return;
    _f.copy(w).multiplyScalar(1 / l);
    _q3.setFromAxisAngle(_f, l * dt);
    q.premultiply(_q3);
  }
  // 床に寝かせた向き: ヨーだけ残す
  function restYaw(it, out) {
    var k = it.kind;
    if (k === 'block') {
      // いちばん上を向いた面を真上へ
      var best = 0, bd = 0, sgn = 1;
      for (var a = 0; a < 3; a++) {
        _f.set(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0).applyQuaternion(it.q);
        if (Math.abs(_f.y) > bd) { bd = Math.abs(_f.y); best = a; sgn = _f.y > 0 ? 1 : -1; }
      }
      _f.set(best === 0 ? 1 : 0, best === 1 ? 1 : 0, best === 2 ? 1 : 0).applyQuaternion(it.q).multiplyScalar(sgn);
      _q3.setFromUnitVectors(_f, UP);
      return out.copy(_q3).multiply(it.q);
    }
    if (k === 'spoon') {
      _f.set(0, 0, 1).applyQuaternion(it.q); var ys = Math.atan2(_f.x, _f.z);
      _q3.setFromAxisAngle(AX, 0.12);
      return out.setFromAxisAngle(UP, ys).multiply(_q3);
    }
    if (k === 'sock') {
      _f.set(1, 0, 0).applyQuaternion(it.q); var yk = Math.atan2(-_f.z, _f.x);
      return out.setFromAxisAngle(UP, yk);
    }
    return out.copy(it.q);
  }
  function startSettle(it, dur) {
    it.mode = 'settle'; it.k = 0; it.dur = dur; it.y0 = it.p.y;
    it.q0.copy(it.q); restYaw(it, it.q1);
  }
  function land(it) {
    var d = it.def, v = it.v, b = it.b;
    it.p.y = d.collR;
    switch (it.kind) {
      case 'ball':
        if (Math.abs(v.y) > 0.55 && b < 4) {
          v.y = -v.y * 0.6; v.x *= 0.5; v.z *= 0.5;
          snd('ballBounce', { vol: 0.85 * Math.pow(0.6, b), pitch: 1 + b * 0.07 });
          it.w.set(v.z, 0, -v.x).multiplyScalar(1 / d.collR);
          it.b++;
        } else { v.y = 0; it.mode = 'roll'; }
        break;
      case 'marble':
        if (b === 0) { snd('marbleRoll', { vol: 0.8 }); v.y = -v.y * 0.2; v.x *= 0.6; v.z *= 0.6; it.b = 1; }
        else {
          v.y = 0; it.mode = 'roll';
          var sp = Math.sqrt(v.x * v.x + v.z * v.z);
          if (sp < 0.2) { if (sp < 1e-4) { v.x = 0.2; } else { v.x *= 0.2 / sp; v.z *= 0.2 / sp; } }
        }
        break;
      case 'block':
        if (b === 0) { snd('blockClack'); v.y = -v.y * 0.32; v.x *= 0.35; v.z *= 0.35; it.w.multiplyScalar(0.45); it.b = 1; }
        else { snd('blockClack', { vol: 0.45, pitch: 1.15 }); v.set(0, 0, 0); startSettle(it, 0.24); }
        break;
      case 'spoon':
        if (b === 0) { snd('spoonTing'); v.y = -v.y * 0.27; v.x *= 0.6; v.z *= 0.6; it.w.multiplyScalar(0.35); it.b = 1; }
        else { v.y = 0; startSettle(it, 0.2); }
        break;
      default:       // sock
        snd('sockFlop'); v.set(0, 0, 0); startSettle(it, 0.16); it.sc = 1.4;   // 1.4: ぺたの つぶれを示す
    }
  }
  function keepIn(it) {
    var Lb = G.L.balcony;
    if (it.p.z > Lb.z1 - 0.18) { it.p.z = Lb.z1 - 0.18; if (it.v.z > 0) it.v.z *= -0.4; }
    if (it.p.z < Lb.z0 + 0.12 && it.mode !== 'fly') { it.p.z = Lb.z0 + 0.12; if (it.v.z < 0) it.v.z *= -0.4; }
    if (it.p.x > Lb.x1 - 0.12) { it.p.x = Lb.x1 - 0.12; if (it.v.x > 0) it.v.x *= -0.4; }
    if (it.p.x < Lb.x0 + 0.12) { it.p.x = Lb.x0 + 0.12; if (it.v.x < 0) it.v.x *= -0.4; }
  }
  function updateItems(dt) {
    if (spoonMat && envChecked < 2) {
      envChecked += dt;
      if (envChecked >= 2 && G.scene && !G.scene.environment) { spoonMat.metalness = 0.55; spoonMat.roughness = 0.28; }
    }
    for (var i = 0; i < itemList.length; i++) {
      var it = itemList[i];
      if (!it.active) continue;
      var d = it.def, v = it.v, o = it.obj, m = it.mode;
      if (m === 'fly') {
        v.y -= GR * dt;
        it.p.addScaledVector(v, dt);
        spinQ(it.q, it.w, dt);
        if (it.p.y <= d.collR && v.y < 0) land(it);
        keepIn(it);
      } else if (m === 'roll') {
        it.p.x += v.x * dt; it.p.z += v.z * dt; it.p.y = d.restY;
        var fr = it.kind === 'marble' ? 0.9 : 2.4;
        var dm = Math.exp(-fr * dt); v.x *= dm; v.z *= dm;
        it.w.set(v.z, 0, -v.x).multiplyScalar(1 / d.collR);
        spinQ(it.q, it.w, dt);
        keepIn(it);
        if (v.x * v.x + v.z * v.z < 0.0001) { it.mode = 'rest'; v.set(0, 0, 0); }
      } else if (m === 'settle') {
        it.k += dt / it.dur;
        var e = it.kind === 'block' ? eIn(it.k) : eOut(it.k);
        it.q.slerpQuaternions(it.q0, it.q1, e);
        it.p.y = it.y0 + (d.restY - it.y0) * e;
        it.p.x += v.x * dt; it.p.z += v.z * dt;
        var df = Math.exp(-5 * dt); v.x *= df; v.z *= df;
        keepIn(it);
        if (it.k >= 1) {
          it.p.y = d.restY; it.q.copy(it.q1);
          if (it.kind === 'spoon' && v.x * v.x + v.z * v.z > 0.0004) { it.mode = 'slide'; } else it.mode = 'rest';
        }
      } else if (m === 'slide') {
        it.p.x += v.x * dt; it.p.z += v.z * dt;
        var ds = Math.exp(-4.5 * dt); v.x *= ds; v.z *= ds;
        keepIn(it);
        if (v.x * v.x + v.z * v.z < 0.0001) it.mode = 'rest';
      } else if (m === 'tip') {         // 積み木が こてん と 90° 転がる
        it.k += dt / 0.3;
        var ta = eIn(it.k) * PI / 2;
        if (it.k >= 1) { ta = PI / 2; }
        _q3.setFromAxisAngle(it.ax, ta);
        it.q.copy(_q3).multiply(it.q0);
        _a.copy(it.p0).sub(it.pv).applyQuaternion(_q3);
        it.p.copy(it.pv).add(_a);
        if (it.k >= 1) { it.mode = 'rest'; snd('blockClack', { vol: 0.6 }); it.p.y = d.restY; }
      } else if (m === 'spin') {        // スプーンが くるっ
        it.k += dt / 0.55;
        _q3.setFromAxisAngle(UP, PI * 2 * eOut(it.k));
        it.q.copy(_q3).multiply(it.q0);
        it.p.y = d.restY + 0.012 * Math.sin(PI * clamp(it.k, 0, 1));
        if (it.k >= 1) { it.mode = 'rest'; it.q.copy(it.q0); it.p.y = d.restY; snd('spoonTing', { vol: 0.35, pitch: 1.2 }); }
      } else if (m === 'flip') {        // くつしたが ぺろん
        it.k += dt / 0.65;
        var fa = 0.95 * Math.sin(PI * eOut(clamp(it.k, 0, 1)));
        _q3.setFromAxisAngle(it.ax, fa);
        it.q.copy(_q3).multiply(it.q0);
        _a.copy(it.p0).sub(it.pv).applyQuaternion(_q3);
        it.p.copy(it.pv).add(_a);
        if (it.k >= 1) { it.mode = 'rest'; it.q.copy(it.q0); it.p.copy(it.p0); snd('sockFlop', { vol: 0.6 }); it.sc = 1.25; }
      }
      // 出てくる時の ぴょこっ と、ぺた の つぶれ
      if (it.sc < 1) { it.sc = Math.min(1, it.sc + dt / 0.16); var s = 0.35 + 0.65 * eBack(it.sc); o.scale.set(s, s, s); }
      else if (it.sc > 1) {
        it.sc = Math.max(1, it.sc - dt * 2.2);
        var sq = (it.sc - 1) * Math.sin((it.sc - 1) * 14);
        o.scale.set(1 + sq * 0.25, 1 - sq * 0.5, 1 + sq * 0.25);
      } else if (o.scale.x !== 1) o.scale.set(1, 1, 1);
    }
  }
  P.popItem = function (id, from) {
    var it = items[id]; if (!it || !from) return;
    var Li = G.L.itemLand, n = 6, best = -1, bd = 1e9, i, j;
    // 空いている着地 x のうち、出た所にいちばん近い所
    for (i = 0; i < n; i++) {
      var used = false;
      for (j = 0; j < itemList.length; j++) if (itemList[j] !== it && itemList[j].active && itemList[j].slot === i) used = true;
      if (used) continue;
      var sx = Li.x0 + (Li.x1 - Li.x0) * i / (n - 1), dd = Math.abs(sx - from.x);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) best = (Math.random() * n) | 0;
    it.slot = best;
    var tx = Li.x0 + (Li.x1 - Li.x0) * best / (n - 1) + (Math.random() - 0.5) * 0.04;
    var tz = Li.z + ZOFF[it.kind] + (best % 2 ? 0.05 : -0.04);
    it.active = true; it.obj.visible = true; it.mode = 'fly'; it.b = 0; it.sc = 0;
    it.p.copy(from); it.p.z += 0.03;
    var T = 0.85;
    it.v.set((tx - it.p.x) / T, (it.def.collR - it.p.y) / T + 0.5 * GR * T, (tz - it.p.z) / T);
    var r = Math.random, sp = it.kind === 'sock' ? 6 : it.kind === 'spoon' ? 15 : 10;
    it.w.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(sp + r() * 4);
    _eu.set(r() * 6, r() * 6, r() * 6); it.q.setFromEuler(_eu);
    it.obj.scale.set(0.35, 0.35, 0.35);
    snd('pop', { pan: clamp(from.x, -1, 1) * 0.6 });
  };
  P.balconyItems = function () {
    outList.length = 0;
    for (var i = 0; i < itemList.length; i++) {
      var it = itemList[i];
      if (!it.active) continue;
      it.entry.pos.copy(it.p);
      outList.push(it.entry);
    }
    return outList;
  };
  P.pokeItem = function (id) {
    var it = items[id]; if (!it || !it.active) return;
    if (it.mode === 'fly' || it.mode === 'tip' || it.mode === 'spin' || it.mode === 'flip' || it.mode === 'settle') return;
    var r = Math.random, d = it.def;
    switch (it.kind) {
      case 'ball':
        it.mode = 'fly'; it.b = 1; it.v.set((r() - 0.5) * 0.3, 2.3, (r() - 0.5) * 0.25);
        snd('ballBounce', { vol: 0.8 });
        break;
      case 'marble':
        var a = r() * PI * 2;
        it.mode = 'roll'; it.v.set(Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28);
        snd('marbleRoll', { vol: 0.7 });
        break;
      case 'block':
        _f.set(1, 0, 0).applyQuaternion(it.q);
        if (Math.abs(_f.y) > 0.7) _f.set(0, 0, 1).applyQuaternion(it.q);
        _f.y = 0; _f.normalize();
        if (r() < 0.5) _f.negate();
        it.ax.set(_f.z, 0, -_f.x);                         // 上 × 向き
        it.p0.copy(it.p); it.p0.y = d.restY; it.q0.copy(it.q);
        it.pv.copy(it.p0).addScaledVector(_f, 0.02); it.pv.y = 0;
        it.mode = 'tip'; it.k = 0;
        break;
      case 'spoon':
        it.q0.copy(it.q); it.mode = 'spin'; it.k = 0;
        snd('spoonTing', { vol: 0.7 });
        break;
      default:
        _f.set(1, 0, 0).applyQuaternion(it.q); _f.y = 0; _f.normalize();
        if (r() < 0.5) _f.negate();
        it.ax.crossVectors(_f, UP);                         // 先が持ち上がる向き
        it.p0.copy(it.p); it.q0.copy(it.q);
        it.pv.copy(it.p).addScaledVector(_f, -0.07); it.pv.y = 0;
        it.mode = 'flip'; it.k = 0;
    }
  };
  P.clearBalconyItems = function () {
    for (var i = 0; i < itemList.length; i++) { var it = itemList[i]; it.active = false; it.obj.visible = false; it.mode = 'none'; it.slot = -1; }
  };

  // ---------- 室内のかごの中 ----------
  // id ごとの固定の置き場所（かごの中心からの x, z、ヨー、ふちに掛かる傾き）
  var TRAY = {
    sockA: { x: -0.05, z: 0.06, yaw: 0.05, lift: 0.012, tilt: -0.17 },
    sockB: { x: 0.04, z: -0.075, yaw: PI + 0.3, lift: 0.012, tilt: -0.17 },
    ball: { x: 0.062, z: 0.045, yaw: 0, lift: 0, tilt: 0 },
    block: { x: -0.07, z: -0.05, yaw: 0.5, lift: 0, tilt: 0 },
    spoon: { x: 0.0, z: -0.01, yaw: -0.6 + PI / 2, lift: 0, tilt: 0 },
    marble: { x: 0.1, z: 0.0, yaw: 0, lift: 0, tilt: 0 }
  };
  function buildTray() {
    var Lt = G.L.tray, par = houseParent();
    for (var i = 0; i < P.ITEM_IDS.length; i++) {
      var id = P.ITEM_IDS[i], o = protos[id].clone(), t = TRAY[id], d = DEF[id];
      o.visible = false;
      var y = 0.015 + d.restY + t.lift;
      o.position.set(Lt.x + t.x, y, Lt.z + t.z);
      _q1.setFromAxisAngle(UP, t.yaw);
      if (d.kind === 'spoon') { _q2.setFromAxisAngle(AX, 0.1); _q1.multiply(_q2); }
      if (t.tilt) { _q2.setFromAxisAngle(AZ, t.tilt); _q1.multiply(_q2); }
      o.quaternion.copy(_q1);
      par.add(o);
      trayItems[id] = { obj: o, y: y, q: o.quaternion.clone(), jy: 0, jv: 0, rx: spr(90, 6), rz: spr(90, 6) };
    }
  }
  function updateTray(dt) {
    for (var id in trayItems) {
      var t = trayItems[id];
      if (!t.obj.visible) continue;
      if (t.jy > 0 || t.jv !== 0) {
        t.jv -= GR * dt; t.jy += t.jv * dt;
        if (t.jy <= 0) { t.jy = 0; t.jv = t.jv < -0.25 ? -t.jv * 0.3 : 0; }
      }
      sstep(t.rx, dt); sstep(t.rz, dt);
      t.obj.position.y = t.y + t.jy;
      _eu.set(t.rx.x, 0, t.rz.x); _q1.setFromEuler(_eu);
      t.obj.quaternion.copy(_q1).multiply(t.q);
    }
  }
  P.setTrayItems = function (ids) {
    ids = ids || [];
    for (var id in trayItems) {
      var t = trayItems[id];
      t.obj.visible = ids.indexOf(id) >= 0;
      t.jy = 0; t.jv = 0; t.rx.x = t.rx.v = 0; t.rz.x = t.rz.v = 0;
      t.obj.position.y = t.y; t.obj.quaternion.copy(t.q);
    }
  };
  P.trayJiggle = function (s) {
    s = clamp(s === undefined ? 1 : s, 0, 2);
    for (var id in trayItems) {
      var t = trayItems[id]; if (!t.obj.visible) continue;
      var m = id === 'ball' ? 1.2 : id.indexOf('sock') === 0 ? 0.5 : 0.8;
      t.jv = s * m * (0.55 + Math.random() * 0.35);
      t.jy = Math.max(t.jy, 0.0001);
      t.rx.v += (Math.random() - 0.5) * 3 * s; t.rz.v += (Math.random() - 0.5) * 3 * s;
    }
  };

  // =====================================================================
  P.build = function () {
    if (built) return;
    built = true;
    V3 = THREE.Vector3; QT = THREE.Quaternion;
    _a = new V3(); _b = new V3(); _c = new V3(); _d = new V3(); _e = new V3(); _f = new V3();
    _q1 = new QT(); _q2 = new QT(); _q3 = new QT(); _m = new THREE.Matrix4(); _eu = new THREE.Euler();
    UP = new V3(0, 1, 0); AX = new V3(1, 0, 0); AZ = new V3(0, 0, 1);
    buildBasket();
    buildClips();
    buildBeater();
    buildPillow();
    buildProtos();
    buildItems();
    buildTray();
    G.onUpdate(function (dt, time) {
      updateClips(dt, time);
      updateBeater(dt, time);
      updatePillow(dt);
      updateItems(dt);
      updateTray(dt);
    });
  };
})();
