/* world.js — 部屋・家具・光（夕方の台所と食卓）。動かない物すべて
   公開 API（契約）:
     G.world.build() / setDusk(k, sec) / dusk
     G.world.faucet.setLever(k) / leverPos(out) / mouthPos(out) / wiggle()
     G.world.lamp.setOn(on, instant) / on / setPull(d) / knobPos(out) / kick(v)
     G.world.spotPos(id, out) / seatReact(id)
   メモ: 影を落とす光は key（台所の天井側・左上手前の平行光）と lamp（ペンダントの SpotLight）の 2 つだけ。
         scene.environment は夕方 / 夕焼け / 日暮れ / 日暮れ+ランプ の 4 枚を自作の代理シーンから作って切り替える。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var W = (G.world = G.world || {});
  var T, L;

  // ---------- 小さな道具 ----------
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function C(hex) { return new T.Color(hex).convertSRGBToLinear(); }
  function std(o) {
    var p = {}, k;
    for (k in o) p[k] = o[k];
    if (typeof p.color === 'number') p.color = C(p.color);
    if (typeof p.emissive === 'number') p.emissive = C(p.emissive);
    if (p.metalness === undefined) p.metalness = 0;
    return new T.MeshStandardMaterial(p);
  }
  var _m4, _q, _e, _v, _s1;
  function xf(g, x, y, z, rx, ry, rz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(x || 0, y || 0, z || 0), _q, _s1);
    g.applyMatrix4(_m4);
    return g;
  }
  function box(w, h, d, x, y, z, rx, ry, rz) { return xf(new T.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  function cyl(rt, rb, h, seg, x, y, z, rx, ry, rz) { return xf(new T.CylinderGeometry(rt, rb, h, seg || 12), x, y, z, rx, ry, rz); }
  function rrShape(x0, y0, x1, y1, r, path) {
    var s = path ? new T.Path() : new T.Shape();
    r = Math.min(r, (x1 - x0) / 2 - 1e-4, (y1 - y0) / 2 - 1e-4);
    s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
  }
  // 面取りした箱（中心原点）
  function rbox(w, h, d, r) {
    r = Math.max(0.0004, Math.min(r, w * 0.45, h * 0.45, d * 0.45));
    var s = rrShape(-w / 2 + r, -h / 2 + r, w / 2 - r, h / 2 - r, Math.min(r * 1.2, w / 2 - r, h / 2 - r));
    var dd = Math.max(d - 2 * r, 0.0002);
    var g = new T.ExtrudeGeometry(s, { depth: dd, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 3 });
    g.translate(0, 0, -dd / 2);
    return g;
  }
  // 平らな板（xz 平面の角丸。上面 y=top、厚み th）
  function slab(x0, z0, x1, z1, r, top, th, bev, holes) {
    bev = bev || 0.002;
    var s = rrShape(x0 + bev, -z1 + bev, x1 - bev, -z0 - bev, Math.max(0.001, r - bev));
    if (holes) for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      s.holes.push(rrShape(h[0] - bev, -h[3] - bev, h[2] + bev, -h[1] + bev, h[4] + bev, true));
    }
    var g = new T.ExtrudeGeometry(s, { depth: Math.max(0.0002, th - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, top - th + bev, 0);
    return g;
  }
  // 世界（またはローカル）座標で UV（箱投影）。grain: 木目を通す軸 'x'|'y'|'z'
  function worldUV(g, sc, grain) {
    var p = g.attributes.position, n = g.attributes.normal, cnt = p.count, uv = new Float32Array(cnt * 2);
    for (var i = 0; i < cnt; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      var ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      var u, v;
      if (ay >= ax && ay >= az) { if (grain === 'x') { u = z; v = x; } else { u = x; v = z; } }
      else if (ax >= az) { if (grain === 'z') { u = y; v = z; } else { u = z; v = y; } }
      else { if (grain === 'x') { u = y; v = x; } else { u = x; v = y; } }
      uv[i * 2] = u * sc; uv[i * 2 + 1] = v * sc;
    }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return g;
  }
  // 部品ごとに一番長い向きへ木目を通す
  function partUV(g, sc) {
    g.computeBoundingBox();
    var b = g.boundingBox, dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
    return worldUV(g, sc, dx >= dy && dx >= dz ? 'x' : dz >= dy ? 'z' : 'y');
  }
  function paint(g, hex) {
    var c = C(hex), cnt = g.attributes.position.count, a = new Float32Array(cnt * 3);
    for (var i = 0; i < cnt; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    return g;
  }
  function merge(list) {
    var parts = [], n = 0, anyCol = false, i;
    for (i = 0; i < list.length; i++) {
      var q = list[i].index ? list[i].toNonIndexed() : list[i];
      if (!q.attributes.normal) q.computeVertexNormals();
      if (q.attributes.color) anyCol = true;
      parts.push(q); n += q.attributes.position.count;
    }
    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = anyCol ? new Float32Array(n * 3) : null, o = 0;
    for (i = 0; i < parts.length; i++) {
      var pa = parts[i], c = pa.attributes.position.count;
      pos.set(pa.attributes.position.array, o * 3);
      nor.set(pa.attributes.normal.array, o * 3);
      if (pa.attributes.uv) uv.set(pa.attributes.uv.array, o * 2);
      if (col) { if (pa.attributes.color) col.set(pa.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3); }
      o += c;
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }
  // ExtrudeGeometry の側面だけ取り出す
  function sidesOnly(g) {
    var gr = g.groups[1], out = new T.BufferGeometry();
    ['position', 'normal', 'uv'].forEach(function (k) {
      var a = g.attributes[k], s = a.itemSize;
      out.setAttribute(k, new T.BufferAttribute(a.array.slice(gr.start * s, (gr.start + gr.count) * s), s));
    });
    return out;
  }
  var root;
  function mesh(g, m, cast, recv, parent, dyn) {
    var o = new T.Mesh(g, m);
    o.castShadow = !!cast; o.receiveShadow = !!recv;
    (parent || root).add(o);
    if (!dyn) { o.matrixAutoUpdate = false; o.updateMatrix(); }
    return o;
  }
  function canvas(w, h, draw) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    return cv;
  }
  function ctex(cv, srgb, rep) {
    var t = new T.CanvasTexture(cv);
    if (srgb) t.encoding = T.sRGBEncoding;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if (rep) t.repeat.set(rep, rep);
    try { t.anisotropy = Math.min(8, G.renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
    return t;
  }
  function assetTex(name, rep) {
    if (!G.assets || !G.assets.tex) return null;
    return G.assets.tex(name, { repeat: rep || [1, 1], aniso: true });
  }
  // 写真が読めたら canvas に描き直す（読めるまでは手続きの代わり絵）
  var imgWait = [];
  function withImg(name, fn) {
    if (!G.assets || !G.assets.has || !G.assets.has(name)) return;
    var t = G.assets.tex(name, { aniso: true });
    imgWait.push({ t: t, fn: fn });
  }
  function pollImgs() {
    for (var i = imgWait.length - 1; i >= 0; i--) {
      var im = imgWait[i].t.image;
      if (im && im.width > 1 && (im.complete === undefined || im.complete)) {
        try { imgWait[i].fn(im); } catch (e) {}
        imgWait.splice(i, 1);
      }
    }
  }
  function mkSpring(x, k, c) { return new G.Spring({ x: x, k: k, c: c }); }

  // ---------- 状態 ----------
  var S = { built: false, lever: 0, lampF: 0, pull: 0, pullHeld: false, envKey: '' };
  var key, hemi, winLight, spot, pointL;
  var mats = {}, envs = {};
  var bdU, poolMat, curtainMat, glassMat;
  var leverG, leverTip, spLever;
  var lampPivot, stringPivot, stringMesh, knob, shadeMat, bulbMat;
  var spSwX, spSwZ, spStX, spStZ, spPull;
  var STR_LEN = 0.31;
  var sets = {};
  var tw = null, twLamp = null;

  // =====================================================================
  // テクスチャ（canvas）
  // =====================================================================
  function floorTex() {
    var cv = canvas(512, 512, function (x) { x.fillStyle = '#8f6844'; x.fillRect(0, 0, 512, 512); });
    var t = ctex(cv, true);
    function draw(img) {
      var x = cv.getContext('2d'), N = 6, pw = 512 / N;
      for (var i = 0; i < N; i++) {
        var off = Math.floor(rnd(i + 3) * 512), sx = Math.floor(rnd(i * 7 + 1) * (512 - pw));
        for (var s = 0; s < 2; s++) {
          var y0 = (off + s * 256) % 512, sy = Math.floor(rnd(i * 13 + s * 5) * 256);
          for (var w = 0; w < 2; w++) {
            var yy = y0 - w * 512;
            if (img) x.drawImage(img, sx, sy, pw, 256, i * pw, yy, pw, 256);
            else { x.fillStyle = '#9a7048'; x.fillRect(i * pw, yy, pw, 256); }
            var l = rnd(i * 31 + s * 17);
            x.fillStyle = l > 0.5 ? 'rgba(255,225,190,' + ((l - 0.5) * 0.22).toFixed(3) + ')' : 'rgba(60,30,10,' + ((0.5 - l) * 0.35).toFixed(3) + ')';
            x.fillRect(i * pw, yy, pw, 256);
            x.fillStyle = 'rgba(35,20,10,0.75)'; x.fillRect(i * pw, yy, pw, 1.5);
          }
        }
        x.fillStyle = 'rgba(35,20,10,0.8)'; x.fillRect(i * pw, 0, 1.5, 512);
        x.fillStyle = 'rgba(255,230,200,0.12)'; x.fillRect(i * pw + 1.5, 0, 1, 512);
      }
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = '#b39478'; x.fillRect(0, 0, 512, 512);
      x.globalCompositeOperation = 'source-over';
      t.needsUpdate = true;
    }
    draw(null);
    withImg('wood', draw);
    return t;
  }
  // 布（ふちのステッチ付き）。w,h は m
  function fabricTex(wm, hm, tint, edge, stitch) {
    var px = 512 / Math.max(wm, hm), cw = Math.round(wm * px), ch = Math.round(hm * px);
    var cv = canvas(cw, ch, function () {}), t = ctex(cv, true);
    function draw(img) {
      var x = cv.getContext('2d');
      x.fillStyle = '#d0c9b9'; x.fillRect(0, 0, cw, ch);
      if (img) { var ts = Math.round(0.16 * px); for (var a = 0; a < cw; a += ts) for (var b = 0; b < ch; b += ts) x.drawImage(img, a, b, ts, ts); }
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = tint; x.fillRect(0, 0, cw, ch);
      x.globalCompositeOperation = 'source-over';
      var e = Math.round(0.014 * px);
      x.strokeStyle = edge; x.lineWidth = e; x.strokeRect(e / 2, e / 2, cw - e, ch - e);
      var si = Math.round(0.028 * px);
      x.strokeStyle = stitch; x.lineWidth = 1.6; x.setLineDash([5, 4]);
      x.strokeRect(si, si, cw - 2 * si, ch - 2 * si);
      x.setLineDash([]);
      var g = x.createLinearGradient(0, 0, 0, ch);
      x.globalAlpha = 0.25;
      x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2; x.strokeRect(1, 1, cw - 2, ch - 2);
      x.globalAlpha = 1;
      t.needsUpdate = true;
      return g;
    }
    draw(null);
    withImg('linen', draw);
    return t;
  }
  function hairlineTex() {
    var cv = canvas(256, 256, function (x) {
      x.fillStyle = 'rgb(214,214,214)'; x.fillRect(0, 0, 256, 256);
      for (var i = 0; i < 1400; i++) {
        var y = rnd(i) * 256, l = rnd(i + 0.5), x0 = rnd(i * 5) * 256;
        x.fillStyle = l > 0.5 ? 'rgba(255,255,255,' + ((l - 0.5) * 0.18).toFixed(3) + ')' : 'rgba(120,120,120,' + ((0.5 - l) * 0.14).toFixed(3) + ')';
        x.fillRect(x0 - 256, y, 256 + rnd(i * 7) * 256, 0.5);
        x.fillRect(x0, y, 256, 0.5);
      }
    });
    return ctex(cv, true, 1);
  }
  function marbleTex() {
    var cv = canvas(512, 512, function (x) {
      x.fillStyle = '#ece8e1'; x.fillRect(0, 0, 512, 512);
      for (var i = 0; i < 40; i++) {
        var gx = rnd(i * 3) * 512, gy = rnd(i * 5) * 512, r = 40 + rnd(i * 7) * 120;
        for (var ox = -512; ox <= 512; ox += 512) for (var oy = -512; oy <= 512; oy += 512) {
          var hx = gx + ox, hy = gy + oy;
          if (hx + r < 0 || hx - r > 512 || hy + r < 0 || hy - r > 512) continue;
          var g = x.createRadialGradient(hx, hy, 0, hx, hy, r);
          g.addColorStop(0, rnd(i) > 0.5 ? 'rgba(220,212,200,0.35)' : 'rgba(250,248,244,0.4)'); g.addColorStop(1, 'rgba(236,232,225,0)');
          x.fillStyle = g; x.fillRect(hx - r, hy - r, 2 * r, 2 * r);
        }
      }
      for (var j = 0; j < 4000; j++) {
        x.fillStyle = rnd(j * 1.3) > 0.5 ? 'rgba(170,160,148,0.35)' : 'rgba(255,255,255,0.5)';
        x.fillRect(rnd(j * 2.1) * 512, rnd(j * 3.7) * 512, 1.2, 1.2);
      }
    });
    return ctex(cv, true, 2);
  }
  function laceTex() {
    var cv = canvas(256, 256, function (x) {
      x.clearRect(0, 0, 256, 256);
      x.fillStyle = 'rgba(255,255,255,0.55)'; x.fillRect(0, 0, 256, 256);
      x.fillStyle = 'rgba(255,255,255,0.0)';
      x.globalCompositeOperation = 'destination-out';
      for (var a = 0; a < 256; a += 4) for (var b = 0; b < 256; b += 4) { x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(a + 1, b + 1, 2, 2); }
      x.globalCompositeOperation = 'source-over';
      x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 2.2;
      for (var k = 0; k < 6; k++) {
        var cx = (k % 2) * 128 + 64, cy = Math.floor(k / 2) * 86 + 43;
        for (var p = 0; p < 6; p++) {
          var an = p / 6 * Math.PI * 2;
          x.beginPath(); x.ellipse(cx + Math.cos(an) * 14, cy + Math.sin(an) * 14, 12, 6, an, 0, Math.PI * 2); x.stroke();
        }
        x.beginPath(); x.arc(cx, cy, 5, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,0.9)'; x.fill();
      }
      x.fillStyle = 'rgba(255,255,255,0.8)';
      for (var v = 0; v < 256; v += 32) x.fillRect(v, 0, 1.5, 256);
    });
    return ctex(cv, true);
  }
  function leafTex() {
    var cv = canvas(128, 256, function (x) {
      x.clearRect(0, 0, 128, 256);
      x.beginPath(); x.moveTo(64, 250);
      x.bezierCurveTo(-10, 200, 0, 60, 64, 6); x.bezierCurveTo(128, 60, 138, 200, 64, 250); x.closePath();
      var g = x.createLinearGradient(0, 0, 128, 256); g.addColorStop(0, '#4f7a33'); g.addColorStop(1, '#2f5521');
      x.fillStyle = g; x.fill();
      x.strokeStyle = 'rgba(190,220,150,0.6)'; x.lineWidth = 2.5;
      x.beginPath(); x.moveTo(64, 248); x.lineTo(64, 14); x.stroke();
      x.lineWidth = 1.2;
      for (var i = 0; i < 7; i++) { var y = 220 - i * 28; x.beginPath(); x.moveTo(64, y); x.quadraticCurveTo(84, y - 18, 104, y - 30); x.moveTo(64, y); x.quadraticCurveTo(44, y - 18, 24, y - 30); x.stroke(); }
    });
    return ctex(cv, true);
  }
  function softTex() {
    var cv = canvas(64, 64, function (x) {
      var d = x.createImageData(64, 64);
      for (var j = 0; j < 64; j++) for (var i = 0; i < 64; i++) {
        var u = i / 63, v = j / 63;
        var a = Math.min(1, u * 4) * Math.min(1, (1 - u) * 4) * Math.min(1, v * 3) * Math.min(1, (1 - v) * 5);
        a = a * a * (3 - 2 * a);
        var o = (j * 64 + i) * 4; d.data[o] = d.data[o + 1] = d.data[o + 2] = Math.round(255 * a); d.data[o + 3] = 255;
      }
      x.putImageData(d, 0, 0);
    });
    return ctex(cv, false);
  }
  function drainTex() {
    var cv = canvas(128, 128, function (x) {
      x.fillStyle = '#8d9093'; x.fillRect(0, 0, 128, 128);
      x.fillStyle = '#c9ccd0'; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill();
      x.fillStyle = '#a4a8ac'; x.beginPath(); x.arc(64, 64, 50, 0, 7); x.fill();
      x.fillStyle = '#2b2c2e';
      for (var r = 12; r < 46; r += 9) for (var a = 0; a < Math.PI * 2; a += 0.55 * 12 / r) { x.beginPath(); x.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2.2, 0, 7); x.fill(); }
      x.fillStyle = '#b8bcc0'; x.beginPath(); x.arc(64, 64, 6, 0, 7); x.fill();
    });
    return ctex(cv, true);
  }

  // =====================================================================
  // 部屋
  // =====================================================================
  function buildRoom() {
    var R = L.room, Wn = L.window, z0 = R.z0, th = 0.12;
    var walls = [
      box(Wn.x0 - R.x0, R.h, th, (R.x0 + Wn.x0) / 2, R.h / 2, z0 - th / 2),
      box(R.x1 - Wn.x1, R.h, th, (R.x1 + Wn.x1) / 2, R.h / 2, z0 - th / 2),
      box(Wn.x1 - Wn.x0, Wn.y0, th, (Wn.x0 + Wn.x1) / 2, Wn.y0 / 2, z0 - th / 2),
      box(Wn.x1 - Wn.x0, R.h - Wn.y1, th, (Wn.x0 + Wn.x1) / 2, (R.h + Wn.y1) / 2, z0 - th / 2),
      box(th, R.h, R.z1 - R.z0, R.x0 - th / 2, R.h / 2, (R.z0 + R.z1) / 2),
      box(th, R.h, R.z1 - R.z0, R.x1 + th / 2, R.h / 2, (R.z0 + R.z1) / 2),
      box(R.x1 - R.x0, R.h, th, 0, R.h / 2, R.z1 + th / 2)
    ];
    var wg = merge(walls); worldUV(wg, 1 / 0.45);
    mats.wall = std({ color: 0xf7f3ec, map: assetTex('wall'), roughness: 0.95 });
    mesh(wg, mats.wall, false, true);
    // 天井
    var cg = new T.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0); cg.rotateX(Math.PI / 2); cg.translate(0, R.h, (R.z0 + R.z1) / 2);
    mats.ceil = std({ color: 0xf4f1ea, roughness: 1 });
    mesh(cg, mats.ceil, false, false);
    // 床（フローリング）
    var fg = new T.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0); fg.rotateX(-Math.PI / 2); fg.translate(0, 0, (R.z0 + R.z1) / 2);
    worldUV(fg, 1 / 0.9, 'z');
    mats.floor = std({ color: 0xffffff, map: floorTex(), roughness: 0.55 });
    mesh(fg, mats.floor, false, true);
    // 巾木
    var bb = [
      box(R.x1 - R.x0, 0.06, 0.012, 0, 0.03, z0 + 0.006),
      box(0.012, 0.06, R.z1 - R.z0, R.x0 + 0.006, 0.03, (R.z0 + R.z1) / 2),
      box(0.012, 0.06, R.z1 - R.z0, R.x1 - 0.006, 0.03, (R.z0 + R.z1) / 2)
    ];
    mesh(merge(bb), std({ color: 0xe9e3d8, roughness: 0.5 }), false, true);
  }

  function buildWindow() {
    var Wn = L.window, z0 = L.room.z0, th = 0.12, cx = (Wn.x0 + Wn.x1) / 2, ww = Wn.x1 - Wn.x0, wh = Wn.y1 - Wn.y0;
    // 木の枠（内側の見込み + 室内側の額縁 + 膳板）
    var t = 0.018, f = 0.055, wood = [];
    wood.push(box(ww, t, th, cx, Wn.y0 + t / 2, z0 - th / 2));
    wood.push(box(ww, t, th, cx, Wn.y1 - t / 2, z0 - th / 2));
    wood.push(box(t, wh, th, Wn.x0 + t / 2, (Wn.y0 + Wn.y1) / 2, z0 - th / 2));
    wood.push(box(t, wh, th, Wn.x1 - t / 2, (Wn.y0 + Wn.y1) / 2, z0 - th / 2));
    wood.push(rbox(ww + 2 * f, f, 0.016, 0.004)); xf(wood[4], cx, Wn.y1 + f / 2, z0 + 0.008);
    wood.push(xf(rbox(f, wh, 0.016, 0.004), Wn.x0 - f / 2, (Wn.y0 + Wn.y1) / 2, z0 + 0.008));
    wood.push(xf(rbox(f, wh, 0.016, 0.004), Wn.x1 + f / 2, (Wn.y0 + Wn.y1) / 2, z0 + 0.008));
    wood.push(xf(rbox(ww + 0.16, 0.026, 0.07, 0.006), cx, Wn.y0 - 0.002, z0 + 0.02));
    wood.forEach(function (g) { partUV(g, 1.2); });
    mats.trim = std({ color: 0xe6d2b6, map: assetTex('wood'), roughness: 0.55 });
    mesh(merge(wood), mats.trim, false, true);
    // アルミのサッシ（引き違い 2 枚）
    var sz = z0 - 0.07, sw = 0.028, alu = [], half = ww / 2 + 0.02;
    alu.push(box(ww - 0.03, 0.03, 0.05, cx, Wn.y0 + 0.033, sz));
    alu.push(box(ww - 0.03, 0.03, 0.05, cx, Wn.y1 - 0.033, sz));
    [[Wn.x0 + 0.018 + half / 2, sz - 0.012], [Wn.x1 - 0.018 - half / 2, sz + 0.012]].forEach(function (p) {
      var x = p[0], z = p[1], h = wh - 0.08, y = (Wn.y0 + Wn.y1) / 2;
      alu.push(box(half, sw, 0.022, x, y - h / 2 + sw / 2, z), box(half, sw, 0.022, x, y + h / 2 - sw / 2, z));
      alu.push(box(sw, h, 0.022, x - half / 2 + sw / 2, y, z), box(sw, h, 0.022, x + half / 2 - sw / 2, y, z));
    });
    mesh(merge(alu), std({ color: 0xb9b4aa, metalness: 0.7, roughness: 0.4 }), false, false);
    glassMat = new T.MeshStandardMaterial({ color: C(0xffffff), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false });
    var gg = new T.PlaneGeometry(ww - 0.04, wh - 0.06); gg.translate(cx, (Wn.y0 + Wn.y1) / 2, sz);
    mesh(gg, glassMat, false, false);
    // 窓の外（写真の板）+ 夕方の色
    var bw = 6.4, bh = bw * 533 / 1280;
    var bgeo = new T.PlaneGeometry(bw, bh); bgeo.translate(cx, 1.15, z0 - 1.3);
    bdU = { low: { value: new T.Color(1, 1, 1) }, high: { value: new T.Color(1, 1, 1) }, glow: { value: new T.Color(0, 0, 0) } };
    var bm = new T.MeshBasicMaterial({ color: 0xffffff, map: assetTex('backdrop', [1, 1]) });
    bm.onBeforeCompile = function (sh) {
      sh.uniforms.uLow = bdU.low; sh.uniforms.uHigh = bdU.high; sh.uniforms.uGlow = bdU.glow;
      sh.fragmentShader = 'uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uGlow;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n float hh = vUv.y;\n vec3 tnt = mix(uLow, uHigh, smoothstep(0.42, 0.95, hh));\n' +
        ' float sky = smoothstep(0.50, 0.62, hh);\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3,0.5,0.2))), sky*0.65) * tnt + uGlow * exp(-pow((hh-0.50)*6.0, 2.0));');
    };
    mesh(bgeo, bm, false, false);
    // 床に落ちる窓の光だまり
    poolMat = new T.MeshBasicMaterial({ map: softTex(), color: 0x000000, transparent: true, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var pg = new T.BufferGeometry(), y = 0.003;
    var px0 = Wn.x0 + 0.05, px1 = Wn.x1 - 0.05, sk = 0.35, zn = z0 + 0.12, zf = z0 + 1.05;
    pg.setAttribute('position', new T.BufferAttribute(new Float32Array([px0, y, zn, px1, y, zn, px1 + sk, y, zf, px0 + sk, y, zf]), 3));
    pg.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    pg.setIndex([0, 2, 1, 0, 3, 2]);
    mesh(pg, poolMat, false, false);
    // レースのカーテン（左右に寄せる）
    var lt = laceTex(), cur = [];
    [[Wn.x0 - 0.21, Wn.x0 + 0.12], [Wn.x1 - 0.12, Wn.x1 + 0.21]].forEach(function (a, s) {
      var w = a[1] - a[0], h = 1.24, g = new T.PlaneGeometry(w, h, 34, 6), p = g.attributes.position, uv = g.attributes.uv;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), yy = p.getY(i), b = 0.5 - yy / h;
        p.setZ(i, 0.022 * Math.sin((x + s * 0.013) * Math.PI * 2 / 0.075) * (0.8 + 0.4 * b) + 0.006 * Math.sin(x * 37 + yy * 3));
        uv.setXY(i, (x + w / 2) / 0.13, (yy + h / 2) / 0.22);
      }
      g.computeVertexNormals();
      g.translate((a[0] + a[1]) / 2, 2.12 - h / 2, z0 + 0.07);
      cur.push(g);
    });
    curtainMat = new T.MeshStandardMaterial({ color: C(0xfbf8f2), map: lt, transparent: true, side: T.DoubleSide, depthWrite: false, roughness: 0.95, emissive: new T.Color(0, 0, 0) });
    mesh(merge(cur), curtainMat, false, false).renderOrder = 2;
    // カーテンレール
    mats.steel2 = std({ color: 0xd9d6d0, metalness: 0.8, roughness: 0.35 });
    var rail = [box(ww + 0.6, 0.022, 0.03, cx, 2.14, z0 + 0.06), box(0.02, 0.03, 0.06, Wn.x0 - 0.25, 2.14, z0 + 0.03), box(0.02, 0.03, 0.06, Wn.x1 + 0.25, 2.14, z0 + 0.03)];
    mesh(merge(rail), mats.steel2, false, false);
  }

  // =====================================================================
  // 台所カウンター・シンク・蛇口
  // =====================================================================
  function buildCounter() {
    var K = L.counter, Sk = L.sink, top = K.top;
    mats.white = std({ color: 0xf4f2ee, roughness: 0.42 });
    var body = [
      box(K.x1 - K.x0 - 0.02, 0.08, K.z1 - K.z0 - 0.08, (K.x0 + K.x1) / 2, 0.04, (K.z0 + K.z1) / 2 - 0.02),
      box(K.x1 - K.x0, 0.57, K.z1 - K.z0 - 0.02, (K.x0 + K.x1) / 2, 0.08 + 0.285, (K.z0 + K.z1) / 2 - 0.01),
      box(K.x1 - K.x0, 0.17, 0.02, (K.x0 + K.x1) / 2, 0.735, K.z0 + 0.01),
      box(K.x1 - K.x0, 0.17, 0.02, (K.x0 + K.x1) / 2, 0.735, K.z1 - 0.03),
      box(0.02, 0.17, K.z1 - K.z0, K.x0 + 0.01, 0.735, (K.z0 + K.z1) / 2),
      box(0.02, 0.17, K.z1 - K.z0, K.x1 - 0.01, 0.735, (K.z0 + K.z1) / 2)
    ];
    // 引き出しの前板（4 列 × 2 段）
    var cols = 4, cw = (K.x1 - K.x0) / cols, rows = [[0.095, 0.455], [0.46, 0.818]], hand = [];
    for (var c = 0; c < cols; c++) for (var r = 0; r < 2; r++) {
      var x = K.x0 + cw * (c + 0.5), y0 = rows[r][0], y1 = rows[r][1];
      body.push(xf(rbox(cw - 0.005, y1 - y0 - 0.005, 0.02, 0.0035), x, (y0 + y1) / 2, K.z1 - 0.01));
      hand.push(xf(rbox(cw * 0.55, 0.012, 0.016, 0.004), x, y1 - 0.035, K.z1 + 0.012));
    }
    mesh(merge(body), mats.white, true, true);
    // 天板（人工大理石・シンクの穴あき）
    var hole = [Sk.x0 - 0.005, Sk.z0 - 0.005, Sk.x1 + 0.005, Sk.z1 + 0.005, 0.04];
    var tg = slab(K.x0 - 0.015, K.z0 - 0.015, K.x1 + 0.015, K.z1 + 0.025, 0.012, top, 0.038, 0.004, [hole]);
    worldUV(tg, 0.6);
    mats.top = std({ color: 0xffffff, map: marbleTex(), roughness: 0.32 });
    mesh(tg, mats.top, true, true);
    // ステンレス
    var hl = hairlineTex();
    mats.steel = std({ color: 0xd8dade, map: hl, roughnessMap: hl, metalness: 0.85, roughness: 0.55 });
    var dep = top + 0.004 - Sk.floorY, inner = rrShape(Sk.x0, -Sk.z1, Sk.x1, -Sk.z0, 0.05);
    var wall = sidesOnly(new T.ExtrudeGeometry(inner, { depth: dep, bevelEnabled: false, curveSegments: 6 }));
    wall.rotateX(-Math.PI / 2); wall.translate(0, Sk.floorY, 0);
    var flo = new T.ShapeGeometry(inner, 6); flo.rotateX(-Math.PI / 2); flo.translate(0, Sk.floorY, 0);
    var rim = slab(Sk.x0 - 0.028, Sk.z0 - 0.028, Sk.x1 + 0.028, Sk.z1 + 0.028, 0.06, top + 0.004, 0.006, 0.0025, [[Sk.x0, Sk.z0, Sk.x1, Sk.z1, 0.05]]);
    [wall, flo, rim].forEach(function (g) { worldUV(g, 6, 'x'); });
    // かごの水受けトレー
    var Rk = L.rack, tx0 = Rk.x - Rk.w / 2 - 0.01, tx1 = Rk.x + Rk.w / 2 + 0.01, tz0 = Rk.z - Rk.d / 2 - 0.01, tz1 = Rk.z + Rk.d / 2 - 0.015;
    var tray = slab(tx0, tz0, tx1, tz1, 0.02, top + 0.014, 0.014, 0.004);
    worldUV(tray, 6, 'x');
    hand.forEach(function (g) { worldUV(g, 6, 'x'); });
    var sm = mesh(merge([wall, flo, rim, tray].concat(hand)), new T.MeshStandardMaterial({ color: C(0xd8dade), map: hl, roughnessMap: hl, metalness: 0.75, roughness: 0.42, side: T.DoubleSide }), false, true);
    sm.castShadow = false;
    // 排水口
    var dg = new T.CircleGeometry(0.055, 32); dg.rotateX(-Math.PI / 2); dg.translate((Sk.x0 + Sk.x1) / 2, Sk.floorY + 0.0015, Sk.z0 + 0.13);
    mesh(dg, std({ color: 0xffffff, map: drainTex(), metalness: 0.6, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -1 }), false, true);
    // スポンジ・洗剤
    var sp1 = xf(rbox(0.095, 0.026, 0.064, 0.008), -0.30, top + 0.013, -0.33, 0, 0.25, 0);
    var sp2 = xf(rbox(0.095, 0.009, 0.064, 0.003), -0.30, top + 0.0305, -0.33, 0, 0.25, 0);
    paint(sp1, 0xf2c94c); paint(sp2, 0x3f8a4e);
    mesh(merge([sp1, sp2]), std({ color: 0xffffff, vertexColors: true, roughness: 0.95 }), true, true);
    var prof = [[0, 0], [0.03, 0], [0.033, 0.006], [0.034, 0.12], [0.03, 0.16], [0.018, 0.185], [0.0001, 0.186]];
    var bot = new T.LatheGeometry(prof.map(function (p) { return new T.Vector2(p[0], p[1]); }), 28);
    bot.translate(-0.19, top, -0.32); paint(bot, 0xb9dcc4);
    var cap = cyl(0.016, 0.017, 0.026, 20, -0.19, top + 0.198, -0.32); paint(cap, 0xf4f4f2);
    mesh(merge([bot, cap]), std({ color: 0xffffff, vertexColors: true, roughness: 0.22 }), true, true);
  }

  function buildFaucet() {
    var F = L.faucet, top = L.counter.top, M = F.mouth;
    mats.chrome = std({ color: 0xf4f6f8, metalness: 0.95, roughness: 0.16 });
    var bp = [[0, 0], [0.036, 0], [0.037, 0.004], [0.033, 0.01], [0.03, 0.016], [0.029, 0.13], [0.026, 0.15], [0.016, 0.16], [0.0001, 0.161]];
    var body = new T.LatheGeometry(bp.map(function (p) { return new T.Vector2(p[0], p[1]); }), 32);
    body.translate(F.x, top, F.z);
    // グースネック: 胴の上から立ち上がり、半円で前へ曲がって真下の吐水口へ
    var y0 = top + 0.15, dz = M.z - F.z, R = dz / 2, yc = M.y + 0.025, pts = [];
    for (var i = 0; i <= 6; i++) pts.push(new T.Vector3(F.x, y0 + (yc - y0) * i / 6, F.z));
    for (var j = 1; j <= 24; j++) { var a = Math.PI * j / 24; pts.push(new T.Vector3(F.x, yc + Math.sin(a) * R, F.z + R - Math.cos(a) * R)); }
    pts.push(new T.Vector3(F.x, M.y + 0.012, M.z));
    var tube = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 90, 0.0115, 14, false);
    var aer = cyl(0.0135, 0.0135, 0.022, 20, M.x, M.y + 0.011, M.z);
    var hub = cyl(0.017, 0.017, 0.026, 20, F.x + 0.036, top + 0.118, F.z, 0, 0, Math.PI / 2);
    mesh(merge([body, tube, aer, hub]), mats.chrome, true, true);
    var mo = new T.CircleGeometry(0.009, 16); mo.rotateX(Math.PI / 2); mo.translate(M.x, M.y - 0.0005, M.z);
    mesh(mo, std({ color: 0x222426, roughness: 0.8 }), false, false);
    // レバー（右肩のハブから右へ。0=下 / 1=上。正面から角度がはっきり見える）
    leverG = new T.Group(); leverG.position.set(F.x + 0.042, top + 0.118, F.z); root.add(leverG);
    var arm = xf(rbox(0.14, 0.014, 0.024, 0.0055), 0.07, 0.004, 0, 0, 0, -0.05);
    var pad = xf(rbox(0.042, 0.018, 0.032, 0.007), 0.136, 0.0005, 0, 0, 0, -0.05);
    var boss = cyl(0.017, 0.017, 0.026, 20, 0.006, 0, 0, 0, 0, Math.PI / 2);
    mesh(merge([arm, pad, boss]), mats.chrome, true, true, leverG);
    leverTip = new T.Object3D(); leverTip.position.set(0.145, 0.004, 0); leverG.add(leverTip);
    spLever = mkSpring(0, 260, 9);
    applyLever();
  }
  function applyLever() {
    if (!leverG) return;
    leverG.rotation.z = lerp(-0.2, 0.41, S.lever) + spLever.x;
  }

  // =====================================================================
  // 水切りかご・ふきマット
  // =====================================================================
  function buildRack() {
    var Rk = L.rack, top = L.counter.top, x0 = Rk.x - Rk.w / 2 + 0.01, x1 = Rk.x + Rk.w / 2 - 0.01;
    var z0 = Rk.z - Rk.d / 2 + 0.005, z1 = Rk.z + Rk.d / 2 - 0.03, yb = top + 0.024, yf = top + 0.105, yk = top + 0.205;
    var rw = 0.0024, g = [];
    function rod(ax, ay, az, bx, by, bz, r) {
      var dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var c = new T.CylinderGeometry(r || rw, r || rw, len, 6, 1, true);
      _v.set(dx, dy, dz).normalize();
      _q.setFromUnitVectors(new T.Vector3(0, 1, 0), _v);
      _m4.compose(new T.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s1);
      c.applyMatrix4(_m4);
      g.push(c);
    }
    function ytop(z) { return lerp(yk, yf, (z - z0) / (z1 - z0)); }
    // 底（前後の線 + 横の線）
    for (var x = x0 + 0.02; x < x1 - 0.01; x += 0.028) rod(x, yb, z0, x, yb, z1);
    [z0, (z0 + z1) / 2, z1].forEach(function (z) { rod(x0, yb - 0.003, z, x1, yb - 0.003, z, 0.003); });
    // 縁（下と上）
    rod(x0, yb, z0, x0, yb, z1, 0.003); rod(x1, yb, z0, x1, yb, z1, 0.003);
    rod(x0, yf, z1, x1, yf, z1, 0.0032); rod(x0, yk, z0, x1, yk, z0, 0.0032);
    rod(x0, yf, z1, x0, yk, z0, 0.0032); rod(x1, yf, z1, x1, yk, z0, 0.0032);
    rod(x0, yb + 0.045, z0, x1, yb + 0.045, z0); rod(x0, yb + 0.11, z0, x1, yb + 0.11, z0);
    // 縦の線
    for (var xx = x0; xx <= x1 + 1e-4; xx += (x1 - x0) / 10) { rod(xx, yb, z1, xx, yf, z1); rod(xx, yb, z0, xx, yk, z0); }
    for (var zz = z0 + 0.06; zz < z1 - 0.01; zz += 0.06) { rod(x0, yb, zz, x0, ytop(zz), zz); rod(x1, yb, zz, x1, ytop(zz), zz); }
    rod(x0, (yb + yf) / 2, z1, x1, (yb + yf) / 2, z1);
    rod(x0, yb + 0.04, z0, x0, yb + 0.04, z1); rod(x1, yb + 0.04, z0, x1, yb + 0.04, z1);
    // 大皿の前の低いくし（皿の下だけ）
    for (var tx = x0 + 0.02; tx < Rk.x + 0.03; tx += 0.034) rod(tx, yb, -0.243, tx, yb + 0.05, -0.243, 0.0022);
    rod(x0, yb + 0.002, -0.243, Rk.x + 0.03, yb + 0.002, -0.243);
    // 足
    [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(function (p) { rod(p[0], top + 0.014, p[1], p[0], yb, p[1], 0.004); });
    mesh(merge(g), std({ color: 0xe4e6e9, metalness: 0.9, roughness: 0.28 }), false, false);
  }
  function buildMat() {
    var M = L.mat, th = M.top - L.counter.top;
    var z0 = Math.max(M.z - M.d / 2, L.rack.z + L.rack.d / 2 - 0.012);
    var g = slab(M.x - M.w / 2, z0, M.x + M.w / 2, M.z + M.d / 2, 0.02, M.top, th, Math.min(0.005, th * 0.4));
    var p = g.attributes.position, uv = new Float32Array(p.count * 2);
    for (var i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) - (M.x - M.w / 2)) / M.w; uv[i * 2 + 1] = 1 - (p.getZ(i) - (M.z - M.d / 2)) / M.d; }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    mesh(g, std({ color: 0xffffff, map: fabricTex(M.w, M.d, '#d9d3c8', 'rgba(150,140,128,0.55)', 'rgba(250,248,242,0.9)'), roughness: 1 }), true, true);
  }

  // =====================================================================
  // 食卓・椅子・席のしつらえ
  // =====================================================================
  function buildTable() {
    var Tb = L.table, top = Tb.top, r = Tb.r, th = 0.03;
    mats.wood = std({ color: 0xf1dcc0, map: assetTex('wood'), roughness: 0.48 });
    var prof = [[0.0001, top - th], [r - 0.012, top - th], [r - 0.003, top - th + 0.004], [r, top - th / 2], [r - 0.003, top - 0.004], [r - 0.012, top], [0.0001, top]];
    var tg = new T.LatheGeometry(prof.map(function (p) { return new T.Vector2(p[0], p[1]); }), 96);
    tg.translate(Tb.x, 0, Tb.z);
    worldUV(tg, 1 / 0.8, 'x');
    mesh(tg, std({ color: 0xf6e2c6, map: assetTex('wood'), roughness: 0.38 }), true, true);
    var parts = [];
    for (var i = 0; i < 4; i++) {
      var a = Math.PI / 4 + i * Math.PI / 2, lx = Tb.x + Math.cos(a) * 0.36, lz = Tb.z + Math.sin(a) * 0.36;
      parts.push(partUV(cyl(0.026, 0.019, top - th, 14, lx, (top - th) / 2, lz, Math.sin(a) * 0.03, 0, -Math.cos(a) * 0.03), 2));
    }
    var ap = [[0.37, top - th - 0.065], [0.39, top - th - 0.065], [0.39, top - th], [0.37, top - th], [0.37, top - th - 0.065]];
    var ring = new T.LatheGeometry(ap.map(function (p) { return new T.Vector2(p[0], p[1]); }), 64);
    ring.translate(Tb.x, 0, Tb.z); worldUV(ring, 2, 'y');
    parts.push(ring);
    return parts;
  }
  function chairParts(o, out) {
    var sw = o.sw, sd = o.sd, sh = o.sh, bh = o.bh, lt = o.lt, g = [];
    var lx = sw / 2 - lt / 2 - 0.01, lz = sd / 2 - lt / 2 - 0.01;
    [[-lx, lz], [lx, lz]].forEach(function (p) { g.push(rbox(lt, sh - 0.03, lt, 0.005)); xf(g[g.length - 1], p[0], (sh - 0.03) / 2, p[1]); });
    [-lx, lx].forEach(function (x) { g.push(xf(rbox(lt, bh, lt * 1.1, 0.006), x, bh / 2, -lz - 0.012, -0.05, 0, 0)); });
    g.push(xf(rbox(sw, 0.034, sd, 0.012), 0, sh - 0.017, 0));
    g.push(xf(rbox(sw - 0.06, 0.05, 0.018, 0.004), 0, sh - 0.06, lz));
    g.push(xf(rbox(sw - 0.06, 0.05, 0.018, 0.004), 0, sh - 0.06, -lz));
    g.push(xf(rbox(0.018, 0.05, sd - 0.06, 0.004), -lx, sh - 0.06, 0));
    g.push(xf(rbox(0.018, 0.05, sd - 0.06, 0.004), lx, sh - 0.06, 0));
    g.push(xf(rbox(0.016, 0.022, sd - 0.06, 0.004), -lx, 0.16, 0));
    g.push(xf(rbox(0.016, 0.022, sd - 0.06, 0.004), lx, 0.16, 0));
    var bz = -lz - 0.012 - Math.sin(0.05) * (bh - 0.06);
    g.push(xf(rbox(sw - 0.01, o.rail, 0.024, 0.008), 0, bh - o.rail / 2 - 0.01, bz + 0.002, -0.05, 0, 0));
    var slatY = sh + (bh - sh) * 0.42;
    g.push(xf(rbox(sw - 0.06, 0.045, 0.018, 0.005), 0, slatY, -lz - 0.012 - Math.sin(0.05) * (slatY - 0.0), -0.05, 0, 0));
    if (o.foot) { g.push(xf(rbox(sw - 0.04, 0.022, 0.06, 0.005), 0, o.foot, lz + 0.01)); }
    if (o.arms) {
      [-1, 1].forEach(function (s) {
        g.push(xf(rbox(0.045, 0.024, sd - 0.03, 0.008), s * (sw / 2 - 0.02), sh + 0.21, -0.01));
        g.push(xf(rbox(0.022, 0.21, 0.022, 0.005), s * (sw / 2 - 0.02), sh + 0.105, lz - 0.03));
      });
    }
    g.forEach(function (q) { partUV(q, 2.2); });
    var cush = [];
    if (o.cushion) {
      cush.push(xf(rbox(sw - 0.03, 0.04, sd - 0.04, 0.016), 0, sh + 0.018, 0.005));
      cush.push(xf(rbox(sw - 0.05, 0.13, 0.03, 0.014), 0, bh - 0.12, bz + 0.03, -0.05, 0, 0));
      cush.forEach(function (q) { worldUV(q, 3); });
    }
    var ang = o.face === 'px' ? Math.PI / 2 : o.face === 'nx' ? -Math.PI / 2 : 0;
    g.concat(cush).forEach(function (q) { xf(q, o.x, 0, o.z, 0, ang, 0); });
    out.wood = out.wood.concat(g); out.cush = out.cush.concat(cush);
  }
  function buildChairs(tableParts) {
    var St = L.seats, out = { wood: [], cush: [] };
    chairParts({ x: St.bowlL.x, z: St.bowlL.z, face: St.bowlL.face, sw: 0.5, sd: 0.47, sh: 0.45, bh: 1.0, lt: 0.042, rail: 0.11, arms: true }, out);
    chairParts({ x: St.bowlM.x, z: St.bowlM.z, face: St.bowlM.face, sw: 0.42, sd: 0.41, sh: 0.435, bh: 0.86, lt: 0.034, rail: 0.075 }, out);
    chairParts({ x: St.bowlS.x, z: St.bowlS.z, face: St.bowlS.face, sw: 0.34, sd: 0.31, sh: 0.5, bh: 0.84, lt: 0.03, rail: 0.06, foot: 0.24, cushion: true }, out);
    mesh(merge(out.wood.concat(tableParts)), mats.wood, true, true);
    mesh(merge(out.cush), std({ color: 0xf0c13a, map: assetTex('linen', [2, 2]), roughness: 1 }), true, true);
  }
  function muted(hex, k) {
    var c = new T.Color(hex), g = 0.42;
    c.r = lerp(c.r, g, k); c.g = lerp(c.g, g * 0.97, k); c.b = lerp(c.b, g * 0.9, k);
    return '#' + c.getHexString();
  }
  function buildSettings() {
    var Sp = L.spots, St = L.seats, top = L.table.top;
    var cfg = {
      bowlL: { len: 0.235, col: 0x2b2522, rest: 0xd8d4cc, k: 0.05 },
      bowlM: { len: 0.21, col: 0x9e2f26, rest: 0xe2d6c4, k: 0.32 },
      bowlS: { len: 0.165, col: 0xe8b52a, rest: 0xf4efe6, k: 0.2, spoon: true }
    };
    ['bowlL', 'bowlM', 'bowlS'].forEach(function (id, n) {
      var s = St[id], sp = Sp[id], c = cfg[id];
      var f = s.face === 'px' ? [1, 0] : s.face === 'nx' ? [-1, 0] : [0, 1];
      var rr = s.face === 'pz' ? [-1, 0] : s.face === 'px' ? [0, 1] : [0, -1];
      var mw = 0.40, md = 0.27;
      var cx = sp.x - f[0] * 0.05, cz = sp.z - f[1] * 0.05;
      if (id === 'bowlS') { cx = (sp.x + Sp.glass.x) / 2; cz = sp.z - 0.04; }
      var ang = Math.atan2(f[0], f[1]);
      var pm = rbox(mw, 0.0016, md, 0.0007);
      var p = pm.attributes.position, uv = new Float32Array(p.count * 2);
      for (var i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / mw + 0.5; uv[i * 2 + 1] = p.getZ(i) / md + 0.5; }
      pm.setAttribute('uv', new T.BufferAttribute(uv, 2));
      xf(pm, cx, top + 0.0003, cz, 0, ang, 0);
      var col = muted(L.seatColor[id], c.k);
      var mm = mesh(pm, std({ color: 0xffffff, map: fabricTex(mw, md, col, 'rgba(0,0,0,0.18)', 'rgba(255,250,240,0.55)'), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), false, true);
      mm.renderOrder = 1;
      // 箸と箸置き（席の手前。先は席の人の左へ）
      var px = cx - f[0] * (md / 2 - 0.042), pz = cz - f[1] * (md / 2 - 0.042);
      var grp = new T.Group(); grp.position.set(px, top + 0.0016, pz);
      grp.rotation.y = Math.atan2(rr[1], -rr[0]);
      root.add(grp);
      var len = c.len, tilt = Math.atan2(0.0075, len), sticks = [];
      [-0.0065, 0.0065].forEach(function (oz) {
        var st = new T.CylinderGeometry(0.0022, 0.0042, len, 8);
        st.rotateZ(-Math.PI / 2); st.rotateZ(tilt); st.translate(0, 0.0045 + 0.0035, oz);
        sticks.push(st);
      });
      mesh(merge(sticks), std({ color: c.col, roughness: 0.35 }), true, true, grp);
      var rest = new T.SphereGeometry(0.012, 14, 8); rest.scale(1.0, 0.45, 1.4); rest.translate(len / 2 - 0.028, 0.005, 0);
      mesh(rest, std({ color: c.rest, roughness: 0.25 }), true, true, grp);
      if (c.spoon) {
        var hdl = xf(rbox(0.085, 0.003, 0.011, 0.0012), -0.022, 0.002, 0.034);
        var bowl = new T.SphereGeometry(0.016, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); bowl.scale(1.35, 0.35, 1); bowl.rotateX(Math.PI); bowl.translate(0.044, 0.0065, 0.034);
        bowl = bowl.toNonIndexed();
        mesh(merge([hdl, bowl]), mats.chrome, true, true, grp);
      }
      sets[id] = { g: grp, y: grp.position.y, off: 0, v: 0, rz: 0 };
      void n;
    });
  }

  // =====================================================================
  // ペンダントライト
  // =====================================================================
  function buildLamp() {
    var Lp = L.lamp, Rh = L.room.h;
    lampPivot = new T.Group(); lampPivot.position.set(Lp.x, Rh, Lp.z); root.add(lampPivot);
    var dark = std({ color: 0x2a2826, roughness: 0.6 });
    var shadeTop = Lp.shadeY + 0.2, cordLen = Rh - shadeTop - 0.02;
    var canopy = cyl(0.05, 0.055, 0.025, 24, Lp.x, Rh - 0.0125, Lp.z);
    mesh(canopy, std({ color: 0xf2efe8, roughness: 0.4 }), false, false);
    var cord = cyl(0.0035, 0.0035, cordLen, 6, 0, -cordLen / 2, 0);
    var sock = cyl(0.022, 0.026, 0.06, 16, 0, -(Rh - shadeTop) + 0.01, 0);
    mesh(merge([cord, sock]), dark, false, false, lampPivot);
    // かさ（乳白ガラス風）
    var sp = [[0.18, 0], [0.178, 0.008], [0.168, 0.035], [0.148, 0.08], [0.118, 0.122], [0.085, 0.155], [0.052, 0.18], [0.03, 0.195], [0.022, 0.2]];
    var sg = new T.LatheGeometry(sp.map(function (p) { return new T.Vector2(p[0], p[1]); }), 64);
    var lip = new T.TorusGeometry(0.18, 0.0035, 6, 64); lip.rotateX(Math.PI / 2);
    sg = merge([sg, lip]);
    sg.translate(0, -(Rh - Lp.shadeY), 0);
    shadeMat = new T.MeshStandardMaterial({ color: C(0xf5f2ea), roughness: 0.32, side: T.DoubleSide, emissive: C(0xffd8a0), emissiveIntensity: 0 });
    mesh(sg, shadeMat, false, false, lampPivot, true);
    bulbMat = new T.MeshStandardMaterial({ color: C(0xfffaf0), roughness: 0.2, emissive: C(0xffe2b0), emissiveIntensity: 0 });
    var bulb = new T.SphereGeometry(0.035, 20, 14); bulb.translate(0, -(Rh - Lp.shadeY) + 0.1, 0);
    mesh(bulb, bulbMat, false, false, lampPivot, true);
    // ひもスイッチ
    stringPivot = new T.Group();
    stringPivot.position.set(Lp.knob.x - Lp.x, -(Rh - Lp.shadeY) + 0.05, Lp.knob.z - Lp.z);
    lampPivot.add(stringPivot);
    STR_LEN = (Lp.shadeY + 0.05) - Lp.knob.y;
    var sgeo = new T.CylinderGeometry(0.0013, 0.0013, 1, 5); sgeo.translate(0, -0.5, 0);
    stringMesh = mesh(sgeo, std({ color: 0xe8e2d6, roughness: 0.9 }), false, false, stringPivot, true);
    var kg = new T.SphereGeometry(0.02, 20, 14);
    var kt = assetTex('wood', [0.3, 0.3]);
    knob = mesh(kg, std({ color: 0xd9b48a, map: kt, roughness: 0.45 }), true, false, stringPivot, true);
    // 光
    spot = new T.SpotLight(C(0xffc489), 0, 2.4, 0.6, 0.55, 2);
    spot.position.set(0, -(Rh - Lp.shadeY) + 0.09, 0);
    spot.target.position.set(0, -(Rh - Lp.shadeY) - 1.0, 0);
    spot.castShadow = !G.quality.low;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.2; spot.shadow.camera.far = 3;
    spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.012;
    spot.shadow.autoUpdate = false;
    lampPivot.add(spot); lampPivot.add(spot.target);
    pointL = new T.PointLight(C(0xffb877), 0, 1.8, 2);
    pointL.position.set(0, -(Rh - Lp.shadeY) - 0.05, 0);
    lampPivot.add(pointL);
    spSwX = mkSpring(0, 9, 0.5); spSwZ = mkSpring(0, 9, 0.5);
    spStX = mkSpring(0, 32, 1.4); spStZ = mkSpring(0, 32, 1.4);
    spPull = mkSpring(0, 420, 9);
    updLampPose();
  }
  function updLampPose() {
    lampPivot.rotation.set(spSwX.x, 0, spSwZ.x);
    stringPivot.rotation.set(spStX.x - spSwX.x * 0.6, 0, spStZ.x - spSwZ.x * 0.6);
    var d = Math.max(-0.02, spPull.x) * L.lamp.pull, len = STR_LEN + d;
    stringMesh.scale.set(1, len - 0.018, 1);
    knob.position.set(0, -len, 0);
  }
  function applyLamp(f) {
    S.lampF = f;
    spot.intensity = f * 5.2;
    pointL.intensity = f * 0.5;
    bulbMat.emissiveIntensity = f * 5;
    shadeMat.emissiveIntensity = f * 0.75;
    if (f > 0.001 && !spot.shadow.autoUpdate) { spot.shadow.autoUpdate = true; spot.shadow.needsUpdate = true; }
    else if (f <= 0.001) spot.shadow.autoUpdate = false;
    applyDusk(W.dusk);
  }

  // =====================================================================
  // 背景の小物（サイドボード・観葉植物・壁掛け時計）
  // =====================================================================
  function buildProps() {
    var z0 = L.room.z0, sb = [], x0 = -1.75, x1 = -0.78, d = 0.4, h = 0.74, zc = z0 + d / 2 + 0.005;
    sb.push(xf(rbox(x1 - x0, 0.03, d + 0.01, 0.004), (x0 + x1) / 2, h - 0.015, zc));
    sb.push(box(x1 - x0 - 0.02, h - 0.1, d - 0.02, (x0 + x1) / 2, (h - 0.1) / 2 + 0.07, zc - 0.005));
    var n = 3, dw = (x1 - x0 - 0.02) / n;
    for (var i = 0; i < n; i++) sb.push(xf(rbox(dw - 0.004, h - 0.12, 0.018, 0.003), x0 + 0.01 + dw * (i + 0.5), (h - 0.12) / 2 + 0.08, zc + d / 2 - 0.006));
    [x0 + 0.04, x1 - 0.04].forEach(function (x) { [zc - d / 2 + 0.04, zc + d / 2 - 0.04].forEach(function (z) { sb.push(box(0.03, 0.07, 0.03, x, 0.035, z)); }); });
    sb.forEach(function (g) { partUV(g, 1.6); });
    mesh(merge(sb), std({ color: 0xa47d5c, map: assetTex('wood'), roughness: 0.5 }), true, true);
    // 上の小物（白い花びん）
    var vp = [[0, 0], [0.045, 0], [0.055, 0.05], [0.05, 0.12], [0.025, 0.17], [0.022, 0.2], [0.026, 0.205], [0.0001, 0.205]];
    var vg = new T.LatheGeometry(vp.map(function (p) { return new T.Vector2(p[0], p[1]); }), 24); vg.translate(x0 + 0.22, h, zc - 0.03);
    mesh(vg, std({ color: 0xe9e4da, roughness: 0.3 }), true, true);
    // 観葉植物
    var px = 1.55, pz = z0 + 0.32;
    var pp = [[0, 0.0], [0.13, 0.0], [0.155, 0.3], [0.16, 0.31], [0.0001, 0.31]];
    var pot = new T.LatheGeometry(pp.map(function (p) { return new T.Vector2(p[0], p[1]); }), 32); pot.translate(px, 0, pz);
    mesh(pot, std({ color: 0xd8d2c8, roughness: 0.75 }), true, true);
    var soil = new T.CircleGeometry(0.15, 24); soil.rotateX(-Math.PI / 2); soil.translate(px, 0.29, pz);
    var stems = [soil];
    var leaves = [];
    for (var k = 0; k < 34; k++) {
      var a = k * 2.399, hgt = 0.45 + rnd(k) * 0.75, rad = 0.06 + rnd(k + 9) * 0.22 * (hgt / 1.2);
      var lx = px + Math.cos(a) * rad, lz = pz + Math.sin(a) * rad * 0.7, ly = 0.3 + hgt;
      var ls = 0.16 + rnd(k * 3) * 0.08;
      var lg = new T.PlaneGeometry(ls * 0.62, ls, 2, 3), lp = lg.attributes.position;
      for (var q = 0; q < lp.count; q++) lp.setZ(q, -Math.abs(lp.getX(q)) * 0.35 + lp.getY(q) * lp.getY(q) * -0.8);
      lg.computeVertexNormals();
      lg.translate(0, ls / 2, 0);
      xf(lg, lx, ly, lz, -0.5 - rnd(k + 2) * 0.6, a + Math.PI / 2 + (rnd(k + 5) - 0.5), 0);
      leaves.push(lg);
      if (k % 3 === 0) stems.push(cyl(0.006, 0.008, hgt, 5, (px + lx) / 2, 0.3 + hgt / 2, (pz + lz) / 2, (lz - pz) / hgt * 0.9, 0, -(lx - px) / hgt * 0.9));
    }
    mesh(merge(leaves), std({ color: 0xffffff, map: leafTex(), alphaTest: 0.5, side: T.DoubleSide, roughness: 0.6 }), false, true);
    stems.forEach(function (g, i) { paint(g, i === 0 ? 0x3a2a1e : 0x5a4a2a); });
    mesh(merge(stems), std({ color: 0xffffff, vertexColors: true, roughness: 0.9 }), false, true);
    // 壁掛け時計（数字なし）
    var cxk = -1.26, cyk = 1.78, czk = z0 + 0.025;
    var frame = cyl(0.15, 0.15, 0.04, 48, cxk, cyk, czk, Math.PI / 2, 0, 0);
    partUV(frame, 3);
    mesh(frame, mats.wood, false, true);
    var face = new T.CircleGeometry(0.132, 48); face.translate(cxk, cyk, czk + 0.0205);
    mesh(face, std({ color: 0xf6f3ec, roughness: 0.5 }), false, true);
    var ticks = [];
    for (var t = 0; t < 12; t++) {
      var an = t / 12 * Math.PI * 2, big = t % 3 === 0;
      ticks.push(box(big ? 0.008 : 0.004, big ? 0.022 : 0.014, 0.002, cxk + Math.sin(an) * 0.112, cyk + Math.cos(an) * 0.112, czk + 0.022, 0, 0, -an));
    }
    var hA = -(5.6 / 12) * Math.PI * 2, mA = -(40 / 60) * Math.PI * 2;
    ticks.push(box(0.008, 0.07, 0.002, cxk - Math.sin(hA) * 0.03, cyk + Math.cos(hA) * 0.03, czk + 0.025, 0, 0, hA));
    ticks.push(box(0.005, 0.105, 0.002, cxk - Math.sin(mA) * 0.045, cyk + Math.cos(mA) * 0.045, czk + 0.027, 0, 0, mA));
    ticks.push(cyl(0.007, 0.007, 0.006, 12, cxk, cyk, czk + 0.028, Math.PI / 2, 0, 0));
    mesh(merge(ticks), std({ color: 0x2a2826, roughness: 0.5 }), false, false);
  }

  // =====================================================================
  // 光と夕暮れ
  // =====================================================================
  var KF = {
    hemiI: [0.5, 0.4, 0.2], keyI: [1.3, 0.95, 0.5], winI: [1.4, 1.1, 0.16], pool: [0.3, 0.24, 0.0], curE: [0.4, 0.3, 0.03]
  };
  var KH = {
    hemiS: [0xfff0e2, 0xffd2b4, 0x4e5f8e], hemiG: [0x7a6656, 0x6a4a3c, 0x1b1f2c],
    keyC: [0xfff0de, 0xffd8bc, 0x8796c4], winC: [0xffbe70, 0xff8048, 0x34468a],
    bdLow: [0xffe2b8, 0xff9a62, 0x1a2242], bdHigh: [0xfff0d0, 0xffa486, 0x22305e], bdGlow: [0x502a08, 0x6a2a08, 0x1a0c06],
    pool: [0xffc27a, 0xff9858, 0x000000], curE: [0xffc890, 0xff9a60, 0x2a3660]
  };
  var KC = {}, _ki = 0, _kf = 0, _c1;
  function kSet(k) { k = clamp(k, 0, 1) * 2; _ki = Math.min(1, Math.floor(k)); _kf = k - _ki; }
  function kf(n) { var a = KF[n]; return a[_ki] + (a[_ki + 1] - a[_ki]) * _kf; }
  function kc(n, out) { var a = KC[n]; return out.copy(a[_ki]).lerp(a[_ki + 1], _kf); }
  function buildLights() {
    for (var n in KH) KC[n] = KH[n].map(function (h) { return C(h); });
    _c1 = new T.Color();
    hemi = new T.HemisphereLight(0xffffff, 0x444444, 0.5);
    root.add(hemi);
    key = new T.DirectionalLight(0xffffff, 1.3);
    key.position.set(-1.6, 3.4, 1.9); key.target.position.set(0.1, 0.8, -0.7);
    key.position.add(key.target.position).sub(new T.Vector3(0.1, 0.8, -0.7));
    key.castShadow = true;
    var sz = G.quality.low ? 1024 : 2048;
    key.shadow.mapSize.set(sz, sz);
    var c = key.shadow.camera; c.left = -2.0; c.right = 2.0; c.top = 2.0; c.bottom = -2.0; c.near = 0.5; c.far = 7;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
    root.add(key); root.add(key.target);
    winLight = new T.DirectionalLight(0xffffff, 1.4);
    winLight.position.set(1.2, 2.0, L.room.z0 - 1.0); winLight.target.position.set(0.1, 0.8, -0.6);
    root.add(winLight); root.add(winLight.target);
  }
  function applyDusk(k) {
    if (!S.built) return;
    W.dusk = k; kSet(k);
    var lf = S.lampF;
    hemi.intensity = kf('hemiI') + lf * 0.08;
    kc('hemiS', hemi.color); if (lf > 0) hemi.color.lerp(KC.keyC[0], lf * 0.3);
    kc('hemiG', hemi.groundColor);
    mats.ceil.emissive.copy(hemi.color).multiplyScalar(hemi.intensity * 0.35);
    key.intensity = kf('keyI'); kc('keyC', key.color);
    winLight.intensity = kf('winI'); kc('winC', winLight.color);
    kc('bdLow', bdU.low.value).multiplyScalar(1.15);
    kc('bdHigh', bdU.high.value).multiplyScalar(1.15);
    kc('bdGlow', bdU.glow.value);
    kc('pool', poolMat.color).multiplyScalar(kf('pool'));
    kc('curE', curtainMat.emissive).multiplyScalar(kf('curE'));
    var ek = lf > 0.5 && k > 0.55 ? 'lamp' : k < 0.3 ? 'day' : k < 0.75 ? 'sunset' : 'night';
    if (ek !== S.envKey && envs[ek]) { S.envKey = ek; G.scene.environment = envs[ek]; }
  }

  // 環境マップ（自作の代理シーン）
  function makeEnv(o) {
    var sc = new T.Scene(), list = [];
    function add(g, col, mul) {
      var m = new T.MeshBasicMaterial({ color: new T.Color(col).convertSRGBToLinear().multiplyScalar(mul || 1), side: T.BackSide });
      var me = new T.Mesh(g, m); sc.add(me); list.push(g, m);
      return me;
    }
    add(new T.BoxGeometry(6, 3, 6), o.wall, o.wallI);
    var fl = new T.PlaneGeometry(6, 6); fl.rotateX(Math.PI / 2); fl.translate(0, -1.0, 0);
    add(fl, 0x6a4a30, o.floorI);
    var ce = new T.PlaneGeometry(6, 6); ce.rotateX(-Math.PI / 2); ce.translate(0, 1.45, 0);
    add(ce, o.ceil, o.ceilI);
    var wn = new T.PlaneGeometry(1.8, 1.05); wn.translate(0.2, 0.25, -2.9); wn.rotateY(0);
    var wm = add(wn, o.win, o.winI); wm.material.side = T.DoubleSide;
    var wn2 = new T.PlaneGeometry(1.4, 0.4); wn2.translate(0.2, 0.0, -2.88);
    add(wn2, o.win2, o.winI * 0.8).material.side = T.DoubleSide;
    var kt = new T.PlaneGeometry(1.2, 0.6); kt.rotateX(-Math.PI / 2); kt.translate(-0.4, 1.44, 2.0);
    add(kt, 0xfff4e4, o.kitI).material.side = T.DoubleSide;
    if (o.lamp) {
      var lp = new T.SphereGeometry(0.25, 16, 8); lp.translate(0, 0.9, -0.6);
      add(lp, 0xffd8a0, o.lamp).material.side = T.DoubleSide;
    }
    var pm = new T.PMREMGenerator(G.renderer);
    var rt = pm.fromScene(sc, 0.03);
    pm.dispose();
    list.forEach(function (x) { x.dispose(); });
    return rt.texture;
  }
  function buildEnvs() {
    try {
      envs.day = makeEnv({ wall: 0xd8ccbc, wallI: 0.65, floorI: 0.3, ceil: 0xf2e9dc, ceilI: 0.6, win: 0xffdcaa, win2: 0xfff0d8, winI: 4.0, kitI: 3.0 });
      envs.sunset = makeEnv({ wall: 0xc8ae98, wallI: 0.38, floorI: 0.25, ceil: 0xe8d4c0, ceilI: 0.42, win: 0xffa468, win2: 0xffd0a8, winI: 3.2, kitI: 2.4 });
      envs.night = makeEnv({ wall: 0x707890, wallI: 0.13, floorI: 0.06, ceil: 0x8890a8, ceilI: 0.14, win: 0x3a4c8a, win2: 0x50608a, winI: 0.7, kitI: 1.4 });
      envs.lamp = makeEnv({ wall: 0xa08c78, wallI: 0.13, floorI: 0.06, ceil: 0xb0a088, ceilI: 0.14, win: 0x3a4c8a, win2: 0x50608a, winI: 0.7, kitI: 1.4, lamp: 3.5 });
    } catch (e) { /* 映り込みなしで続ける */ }
  }

  // =====================================================================
  // 毎フレーム
  // =====================================================================
  function update(dt) {
    if (imgWait.length) pollImgs();
    spLever.step(dt);
    applyLever();
    spSwX.step(dt); spSwZ.step(dt); spStX.step(dt); spStZ.step(dt);
    if (!S.pullHeld) spPull.step(dt);
    updLampPose();
    for (var id in sets) {
      var s = sets[id];
      if (s.off > 0 || s.v !== 0) {
        s.v -= 9.8 * dt; s.off += s.v * dt;
        if (s.off <= 0) { s.off = 0; s.v = Math.abs(s.v) > 0.08 ? -s.v * 0.3 : 0; }
        s.rz *= Math.exp(-dt * 10);
        s.g.position.y = s.y + s.off;
        s.g.rotation.z = s.rz;
      }
    }
  }

  // =====================================================================
  // 公開 API
  // =====================================================================
  W.dusk = 0;
  W.build = function () {
    if (S.built || !window.THREE || !G.scene) return;
    T = window.THREE; L = G.L;
    _m4 = new T.Matrix4(); _q = new T.Quaternion(); _e = new T.Euler(); _v = new T.Vector3(); _s1 = new T.Vector3(1, 1, 1);
    root = new T.Group(); root.name = 'world'; G.scene.add(root);
    buildLights();
    buildRoom();
    buildWindow();
    buildCounter();
    buildFaucet();
    buildRack();
    buildMat();
    buildChairs(buildTable());
    buildSettings();
    buildLamp();
    buildProps();
    buildEnvs();
    S.built = true;
    applyLamp(0);
    applyDusk(W.dusk);
    G.onUpdate(update);
    G.onQuality(function (q) {
      if (!q.low) return;
      key.shadow.mapSize.set(1024, 1024);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      spot.castShadow = false;
    });
  };
  W.setDusk = function (k, sec) {
    k = clamp(+k || 0, 0, 1);
    if (sec == null) sec = 2;
    if (tw) { tw.cancel(); tw = null; }
    if (!S.built) { W.dusk = k; return; }
    if (sec <= 0) { applyDusk(k); return; }
    var from = W.dusk;
    tw = G.tween(sec, function (e) { applyDusk(lerp(from, k, e)); }, { ease: 'easeInOutCubic', onDone: function () { tw = null; } });
  };
  W.spotPos = function (id, out) {
    var s = (G.L.spots && G.L.spots[id]) || G.L.spots.plate;
    out = out || new window.THREE.Vector3();
    return out.set(s.x, G.L.table.top, s.z);
  };
  W.seatReact = function (id) {
    function hop(sid, k) { var s = sets[sid]; if (!s) return; s.v = Math.max(s.v, 0.32 * k); s.off = Math.max(s.off, 0.0001); s.rz = (Math.random() - 0.5) * 0.08 * k; }
    if (sets[id]) hop(id, 1);
    else if (id === 'glass') hop('bowlS', 0.6);
    else if (id === 'plate') { hop('bowlL', 0.45); hop('bowlM', 0.45); hop('bowlS', 0.45); }
  };
  W.faucet = {
    setLever: function (k) { S.lever = clamp(+k || 0, 0, 1); applyLever(); },
    leverPos: function (out) {
      out = out || new window.THREE.Vector3();
      if (leverTip) return leverTip.getWorldPosition(out);
      var F = G.L.faucet; return out.set(F.x + 0.18, G.L.counter.top + 0.09, F.z);
    },
    mouthPos: function (out) {
      var m = G.L.faucet.mouth; out = out || new window.THREE.Vector3();
      return out.set(m.x, m.y, m.z);
    },
    wiggle: function () { if (spLever) spLever.kick(4.5); }
  };
  W.lamp = {
    on: false,
    setOn: function (on, instant) {
      on = !!on; W.lamp.on = on;
      if (!S.built) return;
      if (twLamp) { twLamp.cancel(); twLamp = null; }
      var to = on ? 1 : 0, from = S.lampF;
      if (instant) { applyLamp(to); return; }
      twLamp = G.tween(on ? 0.25 : 0.4, function (e) { applyLamp(lerp(from, to, e)); }, { ease: on ? 'easeOutCubic' : 'easeInOutCubic', onDone: function () { twLamp = null; } });
    },
    setPull: function (d) {
      if (!spPull) return;
      d = clamp(+d || 0, 0, 1);
      if (d > 0.001) { S.pullHeld = true; spPull.x = d; spPull.v = 0; S.pull = d; }
      else if (S.pullHeld) {
        S.pullHeld = false; spPull.target = 0; spPull.v = 0;
        spStX.kick(0.4 * S.pull); spStZ.kick(0.2 * S.pull * (Math.random() - 0.5)); spSwX.kick(0.04 * S.pull);
        S.pull = 0;
      }
      if (lampPivot) updLampPose();
    },
    knobPos: function (out) {
      out = out || new window.THREE.Vector3();
      if (knob) return knob.getWorldPosition(out);
      var k = G.L.lamp.knob; return out.set(k.x, k.y, k.z);
    },
    kick: function (v) {
      if (!spSwX) return;
      v = v == null ? 1 : v;
      spSwX.kick(0.12 * v); spSwZ.kick(0.06 * v * (Math.random() - 0.5));
      spStX.kick(0.6 * v); spStZ.kick(0.35 * v * (Math.random() - 0.5));
    }
  };
})();
