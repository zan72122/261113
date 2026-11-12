/* world.js — 動かない世界・光・空（和室・ベランダ・空・遠景・太陽・雲・光）
   公開 API:
     G.world.build()
     G.world.setHouseVisible(bool)      家一式（部屋・外壁・窓・カーテン・しきぶとん・かご）の表示
     G.world.setCurtain(f)              0=閉 … 1=開
     G.world.curtainSway(v)             揺れの勢いを足す
     G.world.curtainGlow(g)             0..1 すき間・布の透け光
     G.world.curtainEdge(side, out)     合わせ目側の端（高さ 1.1）
     G.world.setDoor(f)                 0=閉 … 1=開（中央 2 枚が外側へ）
     G.world.doorHandle(out)            右中央戸の引き手
     G.world.doorGlow(g)
     G.world.setTime(t)                 0 朝 / 1 昼前 / 2 夕方 / 3 夜（連続）
     G.world.setShadowFocus(name)       'room' | 'balcony'
     G.world.placeSun(vec3)
     G.world.setCloud(k) / cloudPos(k, out) / sunExposure() / cloudGlow(g)
     G.world.chimeRing() / poleNudge()
     G.world.sunLight（平行光） G.world.house（Group）
   メモ: 室内の環境光・露光・scene.environment の強さ（全 MeshStandardMaterial の envMapIntensity を基準値×係数）は world が自動で調整する。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var W = (G.world = G.world || {});
  var T, L;

  // ---------- 小さな道具 ----------
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function sstep(a, b, x) { return smooth((x - a) / (b - a)); }
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
  function tex(name, srgb) {
    if (!G.assets || !G.assets.has || !G.assets.has(name)) return null;
    return G.assets.tex(name, { repeat: [1, 1], srgb: srgb !== false, aniso: true });
  }
  var _m4, _q, _e, _v, _v2, _v3, _s1, _up, _ax, _ay, _az, _c;
  function xf(g, x, y, z, rx, ry, rz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(x || 0, y || 0, z || 0), _q, _s1);
    g.applyMatrix4(_m4);
    return g;
  }
  function box(w, h, d, x, y, z, rx, ry, rz) { return xf(new T.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  // 面取りした箱（ExtrudeGeometry の bevel 1 段 = 小さな面取り、角は小さく丸める）
  var gcache = {};
  function rbox(w, h, d, r) {
    var key = w.toFixed(4) + '_' + h.toFixed(4) + '_' + d.toFixed(4) + '_' + r.toFixed(4);
    if (gcache[key]) return gcache[key].clone();
    r = Math.max(0.0004, Math.min(r, w * 0.45, h * 0.45, d * 0.45));
    var iw = w / 2 - r, ih = h / 2 - r, cr = Math.min(r * 0.8, iw * 0.9, ih * 0.9);
    var s = new T.Shape();
    s.moveTo(-iw + cr, -ih); s.lineTo(iw - cr, -ih); s.quadraticCurveTo(iw, -ih, iw, -ih + cr);
    s.lineTo(iw, ih - cr); s.quadraticCurveTo(iw, ih, iw - cr, ih);
    s.lineTo(-iw + cr, ih); s.quadraticCurveTo(-iw, ih, -iw, ih - cr);
    s.lineTo(-iw, -ih + cr); s.quadraticCurveTo(-iw, -ih, -iw + cr, -ih);
    var dd = Math.max(d - 2 * r, 0.0002);
    var g = new T.ExtrudeGeometry(s, { depth: dd, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelOffset: 0, bevelSegments: 1, curveSegments: 2 });
    g.translate(0, 0, -dd / 2);
    gcache[key] = g;
    return g.clone();
  }
  // 世界座標で UV を振る（箱投影）
  function worldUV(g, sc) {
    var p = g.attributes.position, n = g.attributes.normal, cnt = p.count, uv = new Float32Array(cnt * 2);
    for (var i = 0; i < cnt; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      var ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      var u, v;
      if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
      uv[i * 2] = u * sc; uv[i * 2 + 1] = v * sc;
    }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return g;
  }
  function paint(g, r, gg, b) {
    var cnt = g.attributes.position.count, a = new Float32Array(cnt * 3);
    for (var i = 0; i < cnt; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    return g;
  }
  // 幾何をまとめて 1 つに（position/normal/uv/color）
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
  function mesh(g, m, cast, recv, parent) {
    var o = new T.Mesh(g, m);
    o.castShadow = !!cast; o.receiveShadow = !!recv;
    if (parent) parent.add(o);
    return o;
  }
  function canvas(w, h, draw) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    return cv;
  }
  function ctex(cv, srgb) {
    var t = new T.CanvasTexture(cv);
    if (srgb) t.encoding = T.sRGBEncoding;
    return t;
  }
  function mkSpring(x, k, c) {
    if (G.Spring) { try { return new G.Spring({ x: x, k: k, c: c }); } catch (e) { /* 下へ */ } }
    return { x: x, v: 0, target: x, k: k, c: c,
      step: function (dt) { var a = -this.k * (this.x - this.target) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; },
      kick: function (v) { this.v += v; } };
  }

  // ---------- 状態 ----------
  var S = {
    built: false, houseVisible: true, curF: 0, curDirty: true, curGlow: 0,
    door: 0, doorGlow: 0, t: 0, focus: 'room', cloudK: 0, cloudGlow: 0,
    sunPlaced: false, envScale: -1, time: 0
  };
  var REF; // ベランダ視点の基準位置
  var sun, hemi, fill, lamp, house, balc, skyG;
  var sky, skyU, backdrop, sunDisc, sunGlow, cloud, cloudU;
  var curtains = [], curMat, curU, runners;
  var movL, movR, movFrameMat, handleMat;
  var bulbMat, shadeMat, ringMat;
  var poleG, pins = [], chimePivot, tanzakuPivot;
  var spSway, spPole, spPin, spChX, spChZ, spTan;

  // ---------- 時刻のキーフレーム（0 朝 / 1 昼前 / 2 夕方 / 3 夜） ----------
  var KF = {
    elev: [24, 58, 16, 38], az: [14, 16, 20, -12],
    sunI: [1.6, 1.6, 1.7, 0.22],
    hemiI: [0.7, 0.85, 0.55, 0.2], roomDim: [0.13, 0.3, 0.2, 0.1], roomOpen: [0.55, 0.65, 0.42, 0.2],
    fillI: [0.25, 0.32, 0.28, 0.0], expo: [1.0, 1.0, 1.0, 0.72], lamp: [0, 0, 0, 0.9],
    curI: [0.55, 0.35, 0.45, 0.13], sunVis: [1, 1, 1, 0], envK: [1, 1, 0.8, 0.25]
  };
  var KCH = {
    sunC: [0xffeedb, 0xfff8ee, 0xffae66, 0x9fb6e0],
    hemiS: [0xbfd2ea, 0xb4cff0, 0xa898b8, 0x34466e], hemiG: [0x8c7d6a, 0x9a9184, 0x8a6648, 0x1c1c26],
    fillC: [0xffe6cc, 0xfff0e0, 0xffc28a, 0x9fb6e0],
    skyTop: [0x86b2de, 0x3d7bcb, 0x46568e, 0x050a1c], skyHor: [0xf1e8db, 0xcfe2f3, 0xffb466, 0x17264a],
    skyGnd: [0xb6b2a8, 0xb2bac2, 0x8a6a58, 0x0c1222],
    bdTint: [0xfff1e2, 0xffffff, 0xffc69c, 0x343f5a],
    curC: [0xffd8a6, 0xfff0dc, 0xffa65a, 0x86a2d6],
    cloudT: [0xfcfaf5, 0xffffff, 0xffd8b4, 0x3a4460], cloudS: [0xb5bcc8, 0xb3bcc8, 0x9a8a9a, 0x232a3c],
    rim: [0xfff0d6, 0xfff6e6, 0xffbe6a, 0x6a7a9a]
  };
  var KC = {}, _ki = 0, _kf = 0;
  function kSet(t) { t = clamp(t, 0, 3); _ki = Math.min(2, Math.floor(t)); _kf = t - _ki; }
  function k(n) { var a = KF[n]; return a[_ki] + (a[_ki + 1] - a[_ki]) * _kf; }
  function kc(n, out) { var a = KC[n]; return out.copy(a[_ki]).lerp(a[_ki + 1], _kf); }

  // ---------- 和室 ----------
  function buildRoom() {
    var R = L.room, D = L.door;
    var wallT = tex('wall'), woodT = tex('wood'), tatT = tex('tatami');
    var wallMat = std({ color: wallT ? 0xe9dfcc : 0xd9cdb6, map: wallT, roughness: 0.95, envMapIntensity: 0.4 });
    var trimMat = std({ color: woodT ? 0xb48f63 : 0x9c7a52, map: woodT, roughness: 0.62, envMapIntensity: 0.5 });
    var ceilMat = std({ color: woodT ? 0xe2cba6 : 0xcdb48c, map: woodT, roughness: 0.7, envMapIntensity: 0.4 });

    // 壁（窓側は開口をくり抜き、垂れ壁あり）
    var wz0 = -0.10, wz1 = 0.06, wd = wz1 - wz0, wc = (wz0 + wz1) / 2, H = R.h + 0.06;
    var lw = (D.x0) - (R.x0 - 0.1);
    var walls = [
      box(lw, H, wd, R.x0 - 0.1 + lw / 2, H / 2, wc),
      box(lw, H, wd, -(R.x0 - 0.1 + lw / 2), H / 2, wc),
      box(D.x1 - D.x0, H - D.h, wd, (D.x0 + D.x1) / 2, D.h + (H - D.h) / 2, wc),
      box(0.1, H, R.z1 - wz0, R.x0 - 0.05, H / 2, (wz0 + R.z1) / 2),
      box(0.1, H, R.z1 - wz0, R.x1 + 0.05, H / 2, (wz0 + R.z1) / 2)
    ];
    mesh(worldUV(merge(walls), 3.0), wallMat, true, true, house);

    // 天井（竿縁天井）
    var ceil = [box(R.x1 - R.x0 + 0.2, 0.06, R.z1 - wz0, 0, R.h + 0.03, (wz0 + R.z1) / 2)];
    mesh(worldUV(merge(ceil), 0.55), ceilMat, true, true, house);

    // 木部: 柱・長押・回り縁・畳寄せ・竿縁・両脇の板
    var tr = [], i;
    tr.push(box(0.1, D.h, 0.11, D.x0 - 0.05, D.h / 2, 0.035));          // 窓わきの柱
    tr.push(box(0.1, D.h, 0.11, D.x1 + 0.05, D.h / 2, 0.035));
    tr.push(box(0.09, R.h, 0.09, R.x0 + 0.045, R.h / 2, 0.105));         // 隅の柱
    tr.push(box(0.09, R.h, 0.09, R.x1 - 0.045, R.h / 2, 0.105));
    [1.95, 3.85].forEach(function (z) { tr.push(box(0.03, R.h, 0.1, R.x0 + 0.015, R.h / 2, z)); });
    [1.82, 3.64].forEach(function (z) { tr.push(box(0.03, R.h, 0.1, R.x1 - 0.015, R.h / 2, z)); });
    tr.push(box(R.x1 - R.x0, 0.09, 0.035, 0, D.h + 0.045, wz1 + 0.0175));   // 長押（窓側）
    tr.push(box(0.035, 0.09, R.z1, R.x0 + 0.0175, D.h + 0.045, R.z1 / 2));  // 長押（左右）
    tr.push(box(0.035, 0.09, R.z1, R.x1 - 0.0175, D.h + 0.045, R.z1 / 2));
    tr.push(box(R.x1 - R.x0, 0.03, 0.025, 0, R.h - 0.015, wz1 + 0.0125));   // 回り縁
    tr.push(box(0.025, 0.03, R.z1, R.x0 + 0.0125, R.h - 0.015, R.z1 / 2));
    tr.push(box(0.025, 0.03, R.z1, R.x1 - 0.0125, R.h - 0.015, R.z1 / 2));
    tr.push(box(0.018, 0.035, R.z1, R.x0 + 0.009, 0.0175, R.z1 / 2));       // 畳寄せ
    tr.push(box(0.018, 0.035, R.z1, R.x1 - 0.009, 0.0175, R.z1 / 2));
    for (i = 1; i < 12; i++) tr.push(box(R.x1 - R.x0, 0.02, 0.022, 0, R.h - 0.01, i * 0.45)); // 竿縁
    tr.push(box(0.2, 0.012, R.z1, -1.9, -0.006, R.z1 / 2));                  // 両脇の板の間
    tr.push(box(0.2, 0.012, R.z1, 1.9, -0.006, R.z1 / 2));
    tr.push(box(2 * D.x1, 0.012, 0.06, 0, -0.006, 0.09));                    // 窓の敷居の内側
    mesh(worldUV(merge(tr), 1.4), trimMat, true, true, house);

    // 下地（畳のすき間の暗がり）
    mesh(box(R.x1 - R.x0, 0.02, R.z1, 0, -0.07, R.z1 / 2), std({ color: 0x2a2620, roughness: 1 }), false, true, house);

    buildTatami(tatT);
    buildWindow();
    buildCurtains();
    buildMattress();
    buildTray();
    buildTansu(trimMat, woodT);
    buildFusuma(trimMat);
    buildLamp(woodT);
  }

  function buildTatami(tatT) {
    var U = 0.9, X0 = -1.8;
    var TAT = [[0, 0, 2, 1], [2, 0, 1, 2], [3, 0, 1, 2], [0, 1, 1, 2], [1, 1, 1, 2], [2, 2, 2, 1],
      [0, 3, 2, 1], [2, 3, 1, 2], [3, 3, 1, 2], [0, 4, 1, 2], [1, 4, 1, 2], [2, 5, 2, 1]];
    var tops = [], heri = [];
    TAT.forEach(function (a, n) {
      var tx0 = X0 + a[0] * U, tz0 = a[1] * U, tw = a[2] * U, td = a[3] * U, longX = a[2] === 2;
      var cx = tx0 + tw / 2, cz = tz0 + td / 2;
      var top = new T.PlaneGeometry(tw - 0.006, td - 0.006);
      top.rotateX(-Math.PI / 2); top.translate(cx, 0, cz);
      var p = top.attributes.position, uv = top.attributes.uv, ou = rnd(n * 3.1), ov = rnd(n * 7.7);
      for (var i = 0; i < p.count; i++) {
        var lx = p.getX(i) - tx0, lz = p.getZ(i) - tz0;
        if (longX) uv.setXY(i, lz / U * 1.0 + ou, lx / U * 1.0 + ov);
        else uv.setXY(i, lx / U * 1.0 + ou, lz / U * 1.0 + ov);
      }
      // 日焼け: 窓に近いほど黄みが強い、1 枚ごとに少し違う
      var l = 0.92 + rnd(n * 11.3) * 0.1, sunF = clamp(1 - cz / 5.4, 0, 1) * 0.06;
      paint(top, l * (1 + sunF * 0.4), l, l * (0.97 - sunF));
      tops.push(top);
      var side = box(tw - 0.003, 0.05, td - 0.003, cx, -0.027, cz);
      paint(side, l * 0.55, l * 0.52, l * 0.42);
      tops.push(side);
      // 畳縁（長辺の 2 本）
      var hw = 0.03;
      if (longX) {
        heri.push(box(tw - 0.006, 0.003, hw, cx, 0.0006, tz0 + 0.003 + hw / 2));
        heri.push(box(tw - 0.006, 0.003, hw, cx, 0.0006, tz0 + td - 0.003 - hw / 2));
      } else {
        heri.push(box(hw, 0.003, td - 0.006, tx0 + 0.003 + hw / 2, 0.0006, cz));
        heri.push(box(hw, 0.003, td - 0.006, tx0 + tw - 0.003 - hw / 2, 0.0006, cz));
      }
    });
    var tm = std({ color: tatT ? 0xffffff : 0xb9b07e, map: tatT, roughness: 0.82, vertexColors: true, envMapIntensity: 0.35 });
    mesh(merge(tops), tm, false, true, house);
    var linenT = tex('linen');
    var hm = std({ color: 0x1f2d2a, map: linenT, roughness: 0.62, envMapIntensity: 0.5 });
    mesh(merge(heri), hm, false, true, house);
  }

  // ---------- 掃き出し窓（アルミサッシ） ----------
  function buildWindow() {
    var D = L.door;
    var alu = std({ color: 0xb9bcbe, metalness: 0.72, roughness: 0.36, envMapIntensity: 1.0 });
    movFrameMat = alu.clone();
    handleMat = std({ color: 0xa9adb0, metalness: 0.75, roughness: 0.3, envMapIntensity: 1.1 });
    var glassMat = std({ color: 0xdbe6e4, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.13,
      depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.8 });
    var w2 = D.x1 - D.x0;
    // 外枠: 上枠・下枠（レール 2 本）・縦枠
    var fr = [];
    fr.push(rbox(w2, 0.045, 0.14, 0.004)); xf(fr[0], 0, D.h - 0.0225, 0);
    fr.push(xf(rbox(w2, 0.032, 0.14, 0.004), 0, 0.016, 0));
    fr.push(box(w2, 0.011, 0.006, 0, 0.0375, -0.022));
    fr.push(box(w2, 0.011, 0.006, 0, 0.0375, 0.022));
    fr.push(box(w2, 0.012, 0.004, 0, D.h - 0.051, -0.04));     // 上枠の案内
    fr.push(box(w2, 0.012, 0.004, 0, D.h - 0.051, 0.0));
    fr.push(box(w2, 0.012, 0.004, 0, D.h - 0.051, 0.04));
    fr.push(xf(rbox(0.032, D.h, 0.14, 0.004), D.x0 + 0.016, D.h / 2, 0));
    fr.push(xf(rbox(0.032, D.h, 0.14, 0.004), D.x1 - 0.016, D.h / 2, 0));
    mesh(merge(fr), alu, true, true, house);

    var pw = D.panelW, ph = D.h - 0.045 - 0.043, py = 0.043;
    function panel(x, z, mat, meetX) {
      var g = new T.Group(); g.position.set(x, py, z);
      var st = 0.034, tp = 0.042, bt = 0.068, dp = 0.03, parts = [];
      parts.push(xf(rbox(st, ph, dp, 0.004), -pw / 2 + st / 2, ph / 2, 0));
      parts.push(xf(rbox(st, ph, dp, 0.004), pw / 2 - st / 2, ph / 2, 0));
      parts.push(xf(rbox(pw - 2 * st + 0.002, tp, dp * 0.9, 0.003), 0, ph - tp / 2, 0));
      parts.push(xf(rbox(pw - 2 * st + 0.002, bt, dp * 0.9, 0.003), 0, bt / 2, 0));
      // ガラス押さえ（ビード）
      var gw = pw - 2 * st, gh = ph - tp - bt;
      [-1, 1].forEach(function (sz) {
        var zz = sz * 0.009;
        parts.push(box(gw, 0.007, 0.005, 0, bt + 0.0035, zz));
        parts.push(box(gw, 0.007, 0.005, 0, ph - tp - 0.0035, zz));
        parts.push(box(0.007, gh, 0.005, -gw / 2 + 0.0035, bt + gh / 2, zz));
        parts.push(box(0.007, gh, 0.005, gw / 2 - 0.0035, bt + gh / 2, zz));
      });
      if (meetX) parts.push(box(0.01, ph - 0.02, 0.036, meetX * (pw / 2 - 0.005), ph / 2, 0)); // 召し合わせ
      mesh(merge(parts), mat, true, true, g);
      var gl = new T.Mesh(new T.PlaneGeometry(gw, gh), glassMat);
      gl.position.set(0, bt + gh / 2, 0); gl.renderOrder = 2;
      g.add(gl);
      house.add(g);
      return g;
    }
    panel(-0.9, -0.022, alu, 0); panel(0.9, -0.022, alu, 0);
    movL = panel(-0.3, 0.022, movFrameMat, 1);
    movR = panel(0.3, 0.022, movFrameMat, -1);
    // 右中央戸: 引き手（縦長）とクレセント
    var hp = [];
    hp.push(xf(rbox(0.016, 0.16, 0.014, 0.004), -pw / 2 + 0.05, 0.9 - py, 0.022));
    hp.push(box(0.008, 0.11, 0.006, -pw / 2 + 0.05, 0.9 - py, 0.031));
    hp.push(xf(rbox(0.022, 0.06, 0.012, 0.003), -pw / 2 + 0.017, 1.05 - py, 0.021)); // クレセント台座
    hp.push(xf(new T.CylinderGeometry(0.02, 0.02, 0.005, 16, 1, false, 0, Math.PI), -pw / 2 + 0.017, 1.05 - py, 0.029, Math.PI / 2, 0, Math.PI / 2));
    hp.push(xf(rbox(0.012, 0.03, 0.01, 0.003), -pw / 2 + 0.03, 1.02 - py, 0.035));
    mesh(merge(hp), handleMat, true, false, movR);
    var rc = [xf(rbox(0.018, 0.045, 0.012, 0.003), pw / 2 - 0.016, 1.05 - py, 0.021)]; // 受け
    mesh(merge(rc), handleMat, true, false, movL);
    // 外の水切り・外壁の見切り（ベランダ側）
    mesh(box(w2 + 0.08, 0.02, 0.05, 0, 0.01, -0.095), alu, true, true, house);
  }

  // ---------- カーテン ----------
  var PLE = 13, CX = PLE * 8, CY = 26, GAP = 0.008, HEM = 0.015;
  var CLOTH, CH, rA = [], rP = [];
  function buildCurtains() {
    var CL = L.curtain;
    CLOTH = CL.half * 1.5;
    CH = CL.yTop - 0.025 - HEM;
    for (var i = 0; i <= PLE + 1; i++) { rA.push(rnd(i * 5.3) * 2 - 1); rP.push(rnd(i * 9.1 + 2) * 2 - 1); }
    var linT = tex('linen');
    curU = { base: { value: 1 }, edge: { value: 0.5 } };
    curMat = std({ color: 0xf1e8d6, map: linT, emissive: 0xffd8a6, emissiveMap: linT, emissiveIntensity: 0.5,
      roughness: 0.93, side: T.DoubleSide, envMapIntensity: 0.3 });
    curMat.onBeforeCompile = function (sh) {
      sh.uniforms.uBase = curU.base; sh.uniforms.uEdge = curU.edge;
      sh.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = aGlow;');
      sh.fragmentShader = 'uniform float uBase;\nuniform float uEdge;\nvarying float vGlow;\n' +
        sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= (uBase + uEdge * vGlow) * mix(0.42, 1.0, pow(abs(normal.z), 1.6));');
    };
    [-1, 1].forEach(function (side) {
      var nv = (CX + 1) * (CY + 1);
      var pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), gw = new Float32Array(nv), idx = [];
      for (var j = 0; j <= CY; j++) {
        for (var i = 0; i <= CX; i++) {
          var kk = j * (CX + 1) + i, s = i / CX, v = j / CY;
          uv[kk * 2] = s * CLOTH / 0.5; uv[kk * 2 + 1] = v * CH / 0.5;
          gw[kk] = Math.exp(-s / 0.05) * 1.0 + Math.exp(-v / 0.035) * 0.55;
          if (i < CX && j < CY) {
            var a = kk, b = kk + 1, c = kk + CX + 1, d = c + 1;
            idx.push(a, b, d, a, d, c);
          }
        }
      }
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.setAttribute('aGlow', new T.BufferAttribute(gw, 1));
      g.setIndex(idx);
      var m = mesh(g, curMat, true, false, house);
      m.frustumCulled = false;
      curtains.push({ side: side, geo: g, pos: pos, xin: GAP });
    });
    // レール・ブラケット・端のキャップ
    var rail = [], ry = CL.yTop + 0.006;
    rail.push(xf(rbox(2 * CL.half + 0.12, 0.022, 0.028, 0.004), 0, ry, CL.z));
    [-1, 1].forEach(function (sd) {
      rail.push(xf(new T.CylinderGeometry(0.014, 0.014, 0.02, 14), sd * (CL.half + 0.07), ry, CL.z, 0, 0, Math.PI / 2));
      rail.push(box(0.03, 0.012, CL.z - 0.06, sd * 1.1, ry + 0.012, (CL.z + 0.06) / 2));
    });
    rail.push(box(0.03, 0.012, CL.z - 0.06, 0, ry + 0.012, (CL.z + 0.06) / 2));
    mesh(merge(rail), std({ color: 0xece9e2, roughness: 0.45, envMapIntensity: 0.6 }), true, true, house);
    runners = new T.InstancedMesh(rbox(0.012, 0.018, 0.018, 0.003), std({ color: 0xf2f0ea, roughness: 0.5 }), 2 * (PLE + 1));
    runners.castShadow = false;
    house.add(runners);
  }
  function updCurtains(t) {
    var CL = L.curtain, f = S.curF, half = CL.half;
    var xin = lerp(GAP, half - L.curtain.bunch, f), Sw = half - xin;
    var p = Sw / PLE, per = CLOTH / PLE;
    var A0 = Math.sqrt(Math.max(per * per - p * p, 0)) / 4;
    A0 = clamp(A0 * (0.6 + 0.9 * f), 0.012, 0.06);   // 閉じている時のひだは浅く
    var flare = 0.02 + 0.09 * f, sw = spSway.x, br = S.door * 0.007, zc = CL.z + 0.012;
    var TWO = Math.PI * 2, ri = 0;
    for (var ci = 0; ci < curtains.length; ci++) {
      var c = curtains[ci], side = c.side, pos = c.pos;
      c.xin = xin;
      for (var j = 0; j <= CY; j++) {
        var v = j / CY, low = 1 - v, y = HEM + v * CH, low2 = low * low;
        var topK = v > 0.93 ? 0.85 : 1, swK = Math.pow(low, 1.6);
        for (var i = 0; i <= CX; i++) {
          var s = i / CX, ph = s * PLE, kp = Math.floor(ph), fr = ph - kp;
          var ra = rA[kp] * (1 - fr) + rA[kp + 1] * fr, rp = rP[kp] * (1 - fr) + rP[kp + 1] * fr;
          var w = Math.sin((ph + low2 * 0.12 * rp) * TWO);
          w = (w < 0 ? -1 : 1) * Math.pow(Math.abs(w), 0.8);
          var A = A0 * (1 + (0.22 + low * 0.4) * ra) * topK;
          var x = side * (xin + s * Sw + s * flare * low2);
          var z = zc + A * w + sw * swK * (0.8 + 0.2 * Math.sin(s * 9 + t * 2.1 + side));
          if (br > 0) z += br * swK * Math.sin(t * 1.1 + s * 5 + side * 1.7);
          var o = (j * (CX + 1) + i) * 3;
          pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        }
      }
      c.geo.attributes.position.needsUpdate = true;
      c.geo.computeVertexNormals();
      // ランナー
      for (var r = 0; r <= PLE; r++) {
        _m4.makeTranslation(side * (xin + (r / PLE) * Sw), CL.yTop - 0.004, CL.z);
        runners.setMatrixAt(ri++, _m4);
      }
    }
    runners.instanceMatrix.needsUpdate = true;
  }

  // ---------- しきぶとん ----------
  function buildMattress() {
    var M = L.mattress, w = M.w, len = M.z1 - M.z0, th = M.top, r = 0.03;
    function prof(h, n) {
      var c = h - r, out = [], a, an;
      out.push([-h, th]);
      for (a = 5; a >= 1; a--) { an = a / 5 * Math.PI / 2; out.push([-(c + r * Math.sin(an)), r * (1 - Math.cos(an))]); }
      for (var i = 0; i <= n; i++) out.push([-c + 2 * c * i / n, 0]);
      for (a = 1; a <= 5; a++) { an = a / 5 * Math.PI / 2; out.push([c + r * Math.sin(an), r * (1 - Math.cos(an))]); }
      out.push([h, th]);
      return out;
    }
    var px = prof(w / 2, 24), pz = prof(len / 2, 40), nx = px.length, nz = pz.length;
    var pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), idx = [];
    for (var j = 0; j < nz; j++) {
      for (var i = 0; i < nx; i++) {
        var x = px[i][0], z = pz[j][0], drop = Math.max(px[i][1], pz[j][1]);
        var y = th - drop;
        if (drop < 0.002) {
          var ex = clamp((w / 2 - r - Math.abs(x)) / 0.1, 0, 1), ez = clamp((len / 2 - r - Math.abs(z)) / 0.1, 0, 1);
          var wr = 0.0016 * Math.sin(x * 23 + z * 7) * Math.sin(z * 17 - x * 5) + 0.0008 * Math.sin(x * 61 + z * 43) - 0.002 * ex * ez;
          y += wr * ex * ez;
        }
        var o = j * nx + i;
        pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
        uv[o * 2] = x / w + 0.5; uv[o * 2 + 1] = z / len + 0.5;
        if (i < nx - 1 && j < nz - 1) { var a0 = o, b0 = o + 1, c0 = o + nx, d0 = c0 + 1; idx.push(a0, d0, b0, a0, c0, d0); }
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    var m = mesh(g, std({ color: 0xdedad2, roughness: 0.88, envMapIntensity: 0.35 }), true, true, house);
    m.position.set(M.x, 0, (M.z0 + M.z1) / 2);
  }

  // ---------- かご（tray） ----------
  function buildTray() {
    var R0 = L.tray.r, sc = R0 / 0.13;
    var pts = [[0, 0], [0.104, 0], [0.122, 0.03], [0.13, 0.05], [0.124, 0.05], [0.116, 0.032], [0.099, 0.007], [0, 0.007]]
      .map(function (p) { return new T.Vector2(p[0] * sc, p[1]); });
    var g = new T.LatheGeometry(pts, 48);
    var cv = canvas(256, 128, function (x, w, h) {
      x.fillStyle = '#9c7a4c'; x.fillRect(0, 0, w, h);
      var cw = 8, chh = 8;
      for (var j = 0; j < h / chh; j++) for (var i = 0; i < w / cw; i++) {
        var on = (i + j) % 2 === 0, l = 140 + ((i * 37 + j * 91) % 23);
        var gr = x.createLinearGradient(0, j * chh, 0, j * chh + chh);
        var c1 = on ? 'rgb(' + (l + 50) + ',' + (l + 18) + ',' + (l - 40) + ')' : 'rgb(' + (l + 20) + ',' + (l - 8) + ',' + (l - 60) + ')';
        gr.addColorStop(0, 'rgba(70,50,30,1)'); gr.addColorStop(0.3, c1); gr.addColorStop(0.7, c1); gr.addColorStop(1, 'rgba(70,50,30,1)');
        x.fillStyle = gr; x.fillRect(i * cw + (on ? 0 : 1), j * chh, cw - 1, chh);
      }
    });
    var t = ctex(cv, true); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(5, 2); t.anisotropy = 4;
    var m = std({ color: 0xffffff, map: t, roughness: 0.75, side: T.DoubleSide, envMapIntensity: 0.4 });
    var grp = new T.Group(); grp.position.set(L.tray.x, 0, L.tray.z);
    mesh(g, m, true, true, grp);
    var rim = new T.TorusGeometry(0.128 * sc, 0.0055, 6, 48); rim.rotateX(Math.PI / 2); rim.translate(0, 0.05, 0);
    mesh(rim, std({ color: 0x8a6a40, roughness: 0.6 }), true, false, grp);
    house.add(grp);
  }

  // ---------- たんす（右の壁ぎわ） ----------
  function buildTansu(trimMat, woodT) {
    var R = L.room, td = 0.42, tw = 0.9, th = 0.74, tx = R.x1 - 0.01 - td / 2, tz = 2.75;
    var wm = std({ color: woodT ? 0xc49e72 : 0xa98258, map: woodT, roughness: 0.58, envMapIntensity: 0.5 });
    var body = [];
    body.push(xf(rbox(td, th - 0.06, tw, 0.008), tx, 0.06 + (th - 0.06) / 2, tz));
    body.push(box(td - 0.04, 0.06, tw - 0.05, tx + 0.01, 0.03, tz));
    body.push(xf(rbox(td + 0.02, 0.026, tw + 0.024, 0.007), tx - 0.005, th + 0.013, tz));
    mesh(worldUV(merge(body), 1.6), wm, true, true, house);
    var fronts = [], hd = (th - 0.06 - 0.03) / 3, fx = tx - td / 2 - 0.006, metal = [];
    for (var i = 0; i < 3; i++) {
      var cy = 0.075 + hd / 2 + i * hd;
      fronts.push(xf(rbox(0.016, hd - 0.008, tw - 0.04, 0.004), fx, cy, tz));
      [-0.22, 0.22].forEach(function (dz) {
        metal.push(xf(rbox(0.004, 0.034, 0.09, 0.0015), fx - 0.009, cy + 0.01, tz + dz));
        metal.push(xf(new T.TorusGeometry(0.03, 0.0035, 6, 14, Math.PI), fx - 0.013, cy + 0.012, tz + dz, 0, Math.PI / 2, Math.PI));
      });
    }
    var fm = std({ color: woodT ? 0xd2ae82 : 0xb18a5e, map: woodT, roughness: 0.55, envMapIntensity: 0.5 });
    mesh(worldUV(merge(fronts), 1.6), fm, true, true, house);
    mesh(merge(metal), std({ color: 0x2b2826, metalness: 0.8, roughness: 0.45 }), true, false, house);
  }

  // ---------- ふすま（左の押し入れ） ----------
  function buildFusuma(trimMat) {
    var R = L.room, z0 = 2.0, z1 = 3.8, hh = 1.8, wpan = (z1 - z0) / 2 + 0.01;
    var fr = [];
    fr.push(box(0.09, 0.04, z1 - z0, R.x0 + 0.045, hh + 0.02, (z0 + z1) / 2));   // 鴨居
    fr.push(box(0.09, 0.012, z1 - z0, R.x0 + 0.045, 0.006, (z0 + z1) / 2));       // 敷居
    mesh(worldUV(merge(fr), 1.4), trimMat, true, true, house);
    var paper = [], edge = [], hik = [];
    [[z0 + wpan / 2, R.x0 + 0.03, 1], [z1 - wpan / 2, R.x0 + 0.055, -1]].forEach(function (a) {
      var cz = a[0], x = a[1], hs = a[2], h = hh - 0.012, e = 0.018;
      paper.push(box(0.018, h - 2 * e, wpan - 2 * e, x, 0.012 + h / 2, cz));
      edge.push(xf(rbox(0.022, e, wpan, 0.003), x, 0.012 + e / 2, cz));
      edge.push(xf(rbox(0.022, e, wpan, 0.003), x, 0.012 + h - e / 2, cz));
      edge.push(xf(rbox(0.022, h, e, 0.003), x, 0.012 + h / 2, cz - wpan / 2 + e / 2));
      edge.push(xf(rbox(0.022, h, e, 0.003), x, 0.012 + h / 2, cz + wpan / 2 - e / 2));
      hik.push(xf(new T.CylinderGeometry(0.03, 0.03, 0.004, 20), x + 0.009, 0.82, cz - hs * (wpan / 2 - 0.07), 0, 0, Math.PI / 2));
    });
    var linT = tex('linen');
    mesh(merge(paper), std({ color: 0xe9e1cd, map: linT, roughness: 0.92, envMapIntensity: 0.3 }), true, true, house);
    mesh(merge(edge), std({ color: 0x1d1a18, roughness: 0.32, envMapIntensity: 0.8 }), true, true, house);
    mesh(merge(hik), std({ color: 0x5a4a32, metalness: 0.6, roughness: 0.4 }), false, true, house);
  }

  // ---------- 和風ペンダント照明 ----------
  function buildLamp(woodT) {
    var R = L.room, cz = 2.6, g = new T.Group(); g.position.set(0, 0, cz);
    var top = 2.2, bot = 2.03, rt = 0.13, rb = 0.25;
    var shade = new T.LatheGeometry([new T.Vector2(rb, bot), new T.Vector2(rt, top)], 4);
    shade.rotateY(Math.PI / 4);
    shadeMat = std({ color: 0xf4ecda, roughness: 0.9, side: T.DoubleSide, emissive: 0xffb070, emissiveIntensity: 0 });
    mesh(shade, shadeMat, false, false, g);
    var fr = [], d = 0.012, k;
    var cr = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (k = 0; k < 4; k++) {
      var a = cr[k], b = cr[(k + 1) % 4];
      fr.push(box(2 * rb * Math.SQRT1_2 * (a[0] === b[0] ? 0 : 1) + (a[0] === b[0] ? d : 0) + d,
        d, 2 * rb * Math.SQRT1_2 * (a[1] === b[1] ? 0 : 1) + (a[1] === b[1] ? d : 0) + d,
        (a[0] + b[0]) / 2 * rb * Math.SQRT1_2, bot, (a[1] + b[1]) / 2 * rb * Math.SQRT1_2));
      fr.push(box(2 * rt * Math.SQRT1_2 * (a[0] === b[0] ? 0 : 1) + d, d, 2 * rt * Math.SQRT1_2 * (a[1] === b[1] ? 0 : 1) + d,
        (a[0] + b[0]) / 2 * rt * Math.SQRT1_2, top, (a[1] + b[1]) / 2 * rt * Math.SQRT1_2));
      // 斜めの隅木
      var x0 = a[0] * rb * Math.SQRT1_2, z0 = a[1] * rb * Math.SQRT1_2, x1 = a[0] * rt * Math.SQRT1_2, z1 = a[1] * rt * Math.SQRT1_2;
      _v2.set(x1 - x0, top - bot, z1 - z0);
      var ln = _v2.length(), bar = new T.BoxGeometry(d, ln, d);
      _q.setFromUnitVectors(_v3.set(0, 1, 0), _v2.normalize());
      _m4.compose(_v.set((x0 + x1) / 2, (top + bot) / 2, (z0 + z1) / 2), _q, _s1);
      bar.applyMatrix4(_m4); fr.push(bar);
    }
    fr.push(xf(new T.CylinderGeometry(0.004, 0.004, R.h - top - 0.02, 6), 0, (R.h + top) / 2 - 0.01, 0)); // コード
    fr.push(xf(new T.CylinderGeometry(0.045, 0.05, 0.022, 20), 0, R.h - 0.011, 0));                         // 引掛シーリング
    mesh(merge(fr), std({ color: woodT ? 0x7a5a3c : 0x6a4c30, map: woodT, roughness: 0.6 }), false, false, g);
    ringMat = std({ color: 0xf6f6f2, roughness: 0.3, emissive: 0xfff6ea, emissiveIntensity: 0 });
    var ring = new T.TorusGeometry(0.12, 0.012, 8, 40); ring.rotateX(Math.PI / 2); ring.translate(0, 2.11, 0);
    mesh(ring, ringMat, false, false, g);
    bulbMat = std({ color: 0xffe6c8, roughness: 0.2, emissive: 0xff9a40, emissiveIntensity: 0, transparent: true, opacity: 0.95 });
    mesh(new T.SphereGeometry(0.017, 14, 10).translate(0, 2.085, 0), bulbMat, false, false, g);
    var cord = [xf(new T.CylinderGeometry(0.0015, 0.0015, 0.32, 4), 0.04, 1.93, 0), xf(new T.SphereGeometry(0.008, 10, 8), 0.04, 1.765, 0)];
    mesh(merge(cord), std({ color: 0xe8e2d4, roughness: 0.8 }), false, false, g);
    lamp = new T.PointLight(0xffa860, 0, 8, 1.2);
    lamp.position.set(0, 2.06, cz);
    house.add(g); house.add(lamp);
  }

  // ---------- ベランダ ----------
  function buildBalcony() {
    var B = L.balcony, RL = L.rail, P = L.pole;
    var conT = tex('concrete'), wallT = tex('wall');
    var floorM = std({ color: conT ? 0xd6d6d4 : 0x9a9c9c, map: conT, roughness: 0.9, envMapIntensity: 0.5 });
    var inZ = RL.z + RL.cap / 2;  // 腰壁内面 (−1.40)
    var outZ = inZ - 0.14;
    var xw = B.x1 + 0.14, fl = [];
    fl.push(box(2 * xw, 0.14, -0.02 - (inZ + 0.12), 0, B.floorY - 0.07, (inZ + 0.12 - 0.02) / 2));
    fl.push(box(2 * xw, 0.12, 0.12, 0, B.floorY - 0.018 - 0.06, inZ + 0.06));     // 排水溝
    mesh(worldUV(merge(fl), 2.4), floorM, false, true, balc);
    // ドレン
    var dr = [xf(new T.CylinderGeometry(0.045, 0.045, 0.006, 20), 2.25, B.floorY - 0.015, inZ + 0.06)];
    mesh(merge(dr), std({ color: 0x3a3a38, metalness: 0.6, roughness: 0.5 }), false, true, balc);
    // 窓下の立ち上がり
    var wallM = std({ color: wallT ? 0xe2dfd8 : 0xcfcac0, map: wallT, roughness: 0.93, envMapIntensity: 0.4 });
    mesh(worldUV(box(2 * B.x1, 0.08, 0.1, 0, 0.04, -0.17), 3.0), wallM, true, true, balc);

    // 腰壁
    var ph = RL.y - 0.032, pw = [];
    pw.push(box(2 * xw, ph, 0.14, 0, ph / 2, (inZ + outZ) / 2));
    [-1, 1].forEach(function (s) { pw.push(box(0.14, ph, -0.2 - outZ, s * (B.x1 + 0.07), ph / 2, (outZ - 0.2) / 2)); });
    mesh(worldUV(merge(pw), 3.0), wallM, true, true, balc);
    // 内面（塗りむら、下の泥はね、笠木の下の陰）
    var face = new T.PlaneGeometry(2 * B.x1, ph, 48, 10);
    face.translate(0, ph / 2, inZ + 0.0012);
    var fp = face.attributes.position, fc = new Float32Array(fp.count * 3);
    for (var i = 0; i < fp.count; i++) {
      var x = fp.getX(i), y = fp.getY(i);
      var n = 0.035 * Math.sin(x * 2.3 + 1.1) * Math.sin(y * 3.1 + x * 0.7) + 0.025 * Math.sin(x * 7.9 + y * 5.3) + 0.015 * Math.sin(x * 17 - y * 11);
      var l = 1 + n - 0.06 * (1 - sstep(0, 0.25, y)) - 0.05 * sstep(ph - 0.12, ph, y);
      fc[i * 3] = l; fc[i * 3 + 1] = l * 0.995; fc[i * 3 + 2] = l * 0.985;
    }
    face.setAttribute('color', new T.BufferAttribute(fc, 3));
    worldUV(face, 3.0);
    mesh(face, std({ color: wallT ? 0xe2dfd8 : 0xcfcac0, map: wallT, roughness: 0.93, vertexColors: true, envMapIntensity: 0.4 }), false, true, balc);
    // 立ち上がりの防水塗り
    var band = new T.PlaneGeometry(2 * B.x1, 0.12); band.translate(0, 0.06, inZ + 0.0022);
    mesh(worldUV(band, 2.4), std({ color: 0x9a9d9e, map: conT, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), false, true, balc);
    // 雨だれのすじ（デカール）
    var stc = canvas(512, 128, function (x, w, h) {
      x.clearRect(0, 0, w, h);
      for (var s = 0; s < 90; s++) {
        var sx = rnd(s * 3.7) * w, sw = 1 + rnd(s * 1.3) * 4, sl = h * (0.25 + rnd(s * 8.1) * 0.75);
        var gr = x.createLinearGradient(0, 0, 0, sl);
        gr.addColorStop(0, 'rgba(70,72,74,' + (0.12 + rnd(s * 2.9) * 0.2).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(70,72,74,0)');
        x.fillStyle = gr; x.fillRect(sx, 0, sw, sl);
      }
      var g2 = x.createLinearGradient(0, 0, 0, 16); g2.addColorStop(0, 'rgba(60,60,60,0.25)'); g2.addColorStop(1, 'rgba(60,60,60,0)');
      x.fillStyle = g2; x.fillRect(0, 0, w, 16);
    });
    var dec = new T.PlaneGeometry(2 * B.x1, 0.45); dec.translate(0, ph - 0.225, inZ + 0.0026);
    mesh(dec, std({ color: 0xffffff, map: ctex(stc, true), transparent: true, depthWrite: false, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false, true, balc);
    // 誘発目地（シーリング）
    var jt = [];
    [-1.83, 1.83].forEach(function (x) { jt.push(box(0.012, ph, 0.004, x, ph / 2, inZ + 0.002)); });
    jt.push(box(2 * B.x1, 0.01, 0.004, 0, 0.12, inZ + 0.0028));
    mesh(merge(jt), std({ color: 0x8e8e8a, roughness: 0.7 }), false, true, balc);

    // 笠木（アルミ押出し、継ぎ目つき）
    var hw = RL.cap / 2 + 0.003;
    var sh = new T.Shape();
    sh.moveTo(-hw, -0.045); sh.lineTo(-hw, -0.008); sh.quadraticCurveTo(-hw, 0, -hw + 0.008, 0);
    sh.lineTo(hw - 0.008, 0); sh.quadraticCurveTo(hw, 0, hw, -0.008); sh.lineTo(hw, -0.045);
    sh.lineTo(hw - 0.004, -0.045); sh.lineTo(hw - 0.004, -0.012); sh.lineTo(-hw + 0.004, -0.012); sh.lineTo(-hw + 0.004, -0.045);
    sh.lineTo(-hw, -0.045);
    function capSeg(len) {
      var g = new T.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 4 });
      g.translate(0, 0, -len / 2); g.rotateY(Math.PI / 2);
      return g;
    }
    var caps = [], segs = [[-xw, -0.92], [-0.92, 0.92], [0.92, xw]];
    segs.forEach(function (sg) { caps.push(xf(capSeg(sg[1] - sg[0] - 0.004), (sg[0] + sg[1]) / 2, RL.y, RL.z)); });
    [-0.92, 0.92].forEach(function (x) {
      var jg = capSeg(0.05); jg.scale(1, 1.06, 1.04); caps.push(xf(jg, x, RL.y + 0.0012, RL.z));
    });
    [-1, 1].forEach(function (s) {
      var sg = capSeg(-0.2 - outZ - RL.cap); sg.rotateY(Math.PI / 2);
      caps.push(xf(sg, s * (B.x1 + 0.07), RL.y, (outZ + RL.cap - 0.2) / 2));
    });
    var aluM = std({ color: 0xc3c5c6, metalness: 0.75, roughness: 0.42, envMapIntensity: 1.0 });
    mesh(merge(caps), aluM, true, true, balc);

    // 物干し金物（腰壁取付）
    var br = [];
    [-2.2, 2.2].forEach(function (x) {
      br.push(xf(rbox(0.06, 0.18, 0.012, 0.003), x, 0.9, inZ + 0.006));
      br.push(xf(rbox(0.026, 0.78, 0.026, 0.004), x, 0.86 + 0.39, inZ + 0.025));
      var z0 = inZ + 0.025, y0 = 1.62, z1 = P.z, y1 = P.y - 0.028;
      var ln = Math.sqrt((z1 - z0) * (z1 - z0) + (y1 - y0) * (y1 - y0));
      var arm = rbox(0.022, 0.022, ln, 0.004);
      arm.rotateX(-Math.atan2(y1 - y0, z1 - z0));
      br.push(xf(arm, x, (y0 + y1) / 2, (z0 + z1) / 2));
      var hook = new T.TorusGeometry(P.r + 0.006, 0.004, 6, 14, Math.PI);
      br.push(xf(hook, x, P.y, P.z, 0, Math.PI / 2, Math.PI));
    });
    mesh(merge(br), aluM, true, true, balc);

    // 物干し竿（揺れるグループ）
    poleG = new T.Group(); poleG.position.set(0, P.y, P.z); balc.add(poleG);
    var pg = new T.CylinderGeometry(P.r, P.r, P.x1 - P.x0, 20, 1); pg.rotateZ(Math.PI / 2); pg.translate((P.x0 + P.x1) / 2, 0, 0);
    mesh(pg, std({ color: 0xdfe2e4, metalness: 0.9, roughness: 0.22, envMapIntensity: 1.2 }), true, true, poleG);
    var ec = [];
    [P.x0, P.x1].forEach(function (x, i) {
      var c = new T.CylinderGeometry(P.r + 0.004, P.r + 0.004, 0.035, 18); c.rotateZ(Math.PI / 2);
      ec.push(xf(c, x + (i ? 0.0175 : -0.0175), 0, 0));
    });
    mesh(merge(ec), std({ color: 0x6f7c86, roughness: 0.45 }), true, false, poleG);
    // 洗濯ばさみ（木）
    var woodT = tex('wood');
    var pinM = std({ color: woodT ? 0xe0c79e : 0xc9a878, map: woodT, roughness: 0.62 });
    var sprM = std({ color: 0xb0b2b4, metalness: 0.85, roughness: 0.35 });
    [1.32, 1.47].forEach(function (x, n) {
      var pv = new T.Group(); pv.position.set(x, 0, 0); poleG.add(pv);
      var legs = [];
      [-1, 1].forEach(function (s) { legs.push(xf(rbox(0.009, 0.075, 0.008, 0.002), 0, -0.02, s * 0.024, s * 0.09, 0, 0)); });
      mesh(merge(legs), pinM, true, false, pv);
      var spg = new T.TorusGeometry(0.006, 0.0013, 4, 10); spg.rotateY(Math.PI / 2); spg.translate(0, -0.02, 0);
      var spg2 = new T.TorusGeometry(0.006, 0.0013, 4, 10); spg2.rotateY(Math.PI / 2); spg2.translate(0.004, -0.02, 0);
      mesh(merge([spg, spg2]), sprM, false, false, pv);
      pv.rotation.x = n ? 0.06 : -0.04;
      pins.push(pv);
    });
    buildChime();
  }

  function buildChime() {
    var P = L.pole, CHI = L.chime;
    chimePivot = new T.Group(); chimePivot.position.set(CHI.x, 0, CHI.z - P.z); poleG.add(chimePivot);
    var by = CHI.y - P.y;  // 鐘の中心（ピボット基準）
    var top = by + 0.034;
    var str = new T.CylinderGeometry(0.0008, 0.0008, -P.r - top, 4); str.translate(0, (top - P.r) / 2, 0);
    var strM = std({ color: 0xe8e0d0, roughness: 0.9 });
    mesh(str, strM, false, false, chimePivot);
    var prof = [[0.0, 0.034], [0.008, 0.034], [0.02, 0.03], [0.029, 0.02], [0.034, 0.005], [0.036, -0.012], [0.036, -0.024], [0.034, -0.03]]
      .map(function (p) { return new T.Vector2(p[0], p[1]); });
    var bell = new T.LatheGeometry(prof, 32); bell.translate(0, by, 0);
    var glassM = std({ color: 0xd6ece9, roughness: 0.06, transparent: true, opacity: 0.38, side: T.DoubleSide, envMapIntensity: 2.0, depthWrite: false });
    var bm = mesh(bell, glassM, true, false, chimePivot); bm.renderOrder = 3;
    // 舌（ガラス棒）
    var tg = new T.CylinderGeometry(0.003, 0.003, 0.03, 6); tg.translate(0, by - 0.02, 0);
    mesh(tg, glassM, false, false, chimePivot);
    // 短冊
    tanzakuPivot = new T.Group(); tanzakuPivot.position.set(0, by - 0.035, 0); chimePivot.add(tanzakuPivot);
    var s2 = new T.CylinderGeometry(0.0007, 0.0007, 0.06, 4); s2.translate(0, -0.03, 0);
    mesh(s2, strM, false, false, tanzakuPivot);
    var tz = new T.PlaneGeometry(0.055, 0.17); tz.translate(0, -0.06 - 0.085, 0);
    mesh(tz, std({ color: 0xece4d2, roughness: 0.95, side: T.DoubleSide }), true, false, tanzakuPivot);
  }

  // ---------- 空・遠景・太陽・雲 ----------
  var SKY_VS = 'varying vec3 vDir;\nvoid main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }';
  var SKY_FS = 'uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGnd; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform float uSunAmt;\n' +
    'varying vec3 vDir;\n' +
    'void main(){ vec3 d = normalize(vDir); float h = d.y;\n' +
    '  float t = pow(clamp(h, 0.0, 1.0), 0.45);\n' +
    '  vec3 c = mix(uHor, uTop, t);\n' +
    '  c = mix(c, uGnd, smoothstep(0.0, -0.1, h));\n' +
    '  float s = max(dot(d, uSunDir), 0.0);\n' +
    '  c += uSunCol * (pow(s, 6.0) * 0.18 + pow(s, 48.0) * 0.35) * uSunAmt;\n' +
    '  c += uHor * pow(1.0 - abs(h), 8.0) * 0.06;\n' +
    '  gl_FragColor = vec4(c, 1.0);\n' +
    '  #include <encodings_fragment>\n}';
  var CLOUD_VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var CLOUD_FS = 'uniform sampler2D uTex; uniform vec3 uTint; uniform vec3 uShade; uniform vec3 uRim;\n' +
    'uniform float uCover; uniform float uGlow; uniform float uTime; uniform float uOpacity; uniform vec2 uSunUV; uniform vec2 uAsp;\n' +
    'varying vec2 vUv;\n' +
    'void main(){ vec2 uv = vUv;\n' +
    '  uv.x += sin(uv.y * 6.0 + uTime * 0.15) * 0.004; uv.y += sin(uv.x * 5.0 - uTime * 0.12) * 0.004;\n' +
    '  float a = texture2D(uTex, uv).g;\n' +
    '  float a2 = texture2D(uTex, uv + vec2(0.0, 0.04)).g;\n' +
    '  float sh = clamp(a2 * 0.9 - (vUv.y - 0.3) * 0.7, 0.0, 1.0);\n' +
    '  vec3 col = mix(uTint, uShade, sh * 0.6);\n' +
    '  vec2 d = (vUv - uSunUV) * uAsp; float sp = exp(-dot(d, d) * 5.0);\n' +
    '  float rim = (1.0 - smoothstep(0.08, 0.6, a)) * smoothstep(0.0, 0.12, a);\n' +
    '  col *= 1.0 - 0.2 * uCover * exp(-dot(d, d) * 2.0) * smoothstep(0.3, 0.9, a);\n' +
    '  col += uRim * rim * (0.35 + 1.4 * sp) * uCover * (1.0 + uGlow * 1.8);\n' +
    '  col += uRim * sp * a * 0.25 * uCover;\n' +
    '  gl_FragColor = vec4(col, a * uOpacity);\n' +
    '  #include <encodings_fragment>\n}';

  function radialTex(stops) {
    var cv = canvas(256, 256, function (x, w, h) {
      var g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
    return ctex(cv, false);
  }

  function buildSky() {
    skyU = {
      uTop: { value: new T.Color() }, uHor: { value: new T.Color() }, uGnd: { value: new T.Color() },
      uSunCol: { value: new T.Color() }, uSunDir: { value: new T.Vector3(0, 0.5, -1).normalize() }, uSunAmt: { value: 1 }
    };
    var sm = new T.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide,
      depthWrite: false, depthTest: false, fog: false });
    sky = new T.Mesh(new T.SphereGeometry(90, 32, 16), sm);
    sky.renderOrder = -100; sky.frustumCulled = false;
    skyG.add(sky);

    // 遠景（円筒の一部）
    var R = 60, th = Math.PI * 2 / 3, asp = 2048 / 878, Hc = R * th / asp, horY = 3.0;
    var cg = new T.CylinderGeometry(R, R, Hc, 48, 1, true, Math.PI - th / 2, th);
    var uv = cg.attributes.uv;
    for (var i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    var bt = tex('backdrop');
    if (bt) { bt.wrapS = bt.wrapT = T.ClampToEdgeWrapping; bt.repeat.set(1, 1); }
    var am = canvas(64, 256, function (x, w, h) {
      var g = x.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, '#fff'); g.addColorStop(0.46, '#fff'); g.addColorStop(0.62, '#888'); g.addColorStop(0.86, '#000'); g.addColorStop(1, '#000');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      var e = x.createLinearGradient(0, 0, w, 0);
      e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(0.08, 'rgba(0,0,0,0)'); e.addColorStop(0.92, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,1)');
      x.fillStyle = e; x.fillRect(0, 0, w, h);
    });
    var bm = new T.MeshBasicMaterial({ color: 0xffffff, map: bt || null, alphaMap: ctex(am, false), transparent: true,
      depthWrite: false, side: T.BackSide, fog: false });
    if (!bt) bm.color = C(0x8f9a94);
    backdrop = new T.Mesh(cg, bm);
    backdrop.position.set(0, horY - 0.42 * Hc + Hc / 2, 0);
    backdrop.renderOrder = -90;
    skyG.add(backdrop);

    // 太陽
    var discT = radialTex([[0, 'rgba(255,255,255,1)'], [0.32, 'rgba(255,255,255,1)'], [0.42, 'rgba(255,250,235,0.55)'], [0.6, 'rgba(255,240,210,0.12)'], [1, 'rgba(255,230,200,0)']]);
    var glowT = radialTex([[0, 'rgba(255,255,255,0.9)'], [0.12, 'rgba(255,248,230,0.45)'], [0.35, 'rgba(255,236,205,0.14)'], [0.7, 'rgba(255,225,190,0.03)'], [1, 'rgba(255,220,180,0)']]);
    sunDisc = new T.Sprite(new T.SpriteMaterial({ map: discT, color: 0xffffff, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false }));
    sunGlow = new T.Sprite(new T.SpriteMaterial({ map: glowT, color: 0xffffff, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false }));
    sunDisc.renderOrder = -79; sunGlow.renderOrder = -80;
    skyG.add(sunGlow); skyG.add(sunDisc);

    // 雲（alphaMap 専用のテクスチャを緑チャンネルで読む）
    var ct = tex('cloud', false);
    if (ct) { ct.wrapS = ct.wrapT = T.ClampToEdgeWrapping; }
    else {
      ct = ctex(canvas(256, 170, function (x, w, h) {
        x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
        for (var i = 0; i < 26; i++) {
          var cx = w * (0.18 + rnd(i) * 0.64), cy = h * (0.35 + rnd(i * 3.3) * 0.35), r = w * (0.06 + rnd(i * 7.1) * 0.1);
          var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(0, 0, w, h);
        }
      }), false);
    }
    cloudU = {
      uTex: { value: ct }, uTint: { value: new T.Color(1, 1, 1) }, uShade: { value: new T.Color(0.7, 0.72, 0.76) }, uRim: { value: new T.Color(1, 0.95, 0.85) },
      uCover: { value: 1 }, uGlow: { value: 0 }, uTime: { value: 0 }, uOpacity: { value: 1 },
      uSunUV: { value: new T.Vector2(0.5, 0.5) }, uAsp: { value: new T.Vector2(1, 683 / 1024) }
    };
    cloud = new T.Mesh(new T.PlaneGeometry(1, 683 / 1024), new T.ShaderMaterial({ uniforms: cloudU, vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS,
      transparent: true, depthWrite: false, fog: false }));
    cloud.renderOrder = -70; cloud.frustumCulled = false;
    skyG.add(cloud);
  }

  // ---------- 光 ----------
  var BOX = { room: [-2.2, 0, -0.3, 2.2, 2.5, 5.0], balcony: [-2.2, 0, -2.0, 2.2, 2.2, 0.6] };
  var sunDir;
  function buildLights() {
    sun = new T.DirectionalLight(0xffffff, 2);
    sun.castShadow = true;
    var ss = (G.quality && G.quality.shadowSize) || 2048;
    sun.shadow.mapSize.set(ss, ss);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.022; sun.shadow.radius = 3;
    G.scene.add(sun); G.scene.add(sun.target);
    hemi = new T.HemisphereLight(0xbfd2ea, 0x8c7d6a, 0.6);
    G.scene.add(hemi);
    fill = new T.DirectionalLight(0xffe6cc, 0.2);
    fill.position.set(0.8, 2.2, 6); fill.target.position.set(0, 0.8, -1);
    G.scene.add(fill); G.scene.add(fill.target);
    if (G.onQuality) G.onQuality(function (q) {
      var n = (q && q.shadowSize) || 2048;
      sun.shadow.mapSize.set(n, n);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    });
  }
  function calcSunDir() {
    var e = k('elev') * Math.PI / 180, a = k('az') * Math.PI / 180;
    sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
    if (!S.sunPlaced) S.sunPos.copy(REF).addScaledVector(sunDir, 50);
  }
  function updateShadowCam() {
    var b = BOX[S.focus] || BOX.room, cam = sun.shadow.camera;
    _c.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    sun.position.copy(_c).addScaledVector(sunDir, 40);
    sun.target.position.copy(_c); sun.target.updateMatrixWorld();
    _m4.lookAt(sun.position, _c, _up);
    _ax.setFromMatrixColumn(_m4, 0); _ay.setFromMatrixColumn(_m4, 1); _az.setFromMatrixColumn(_m4, 2);
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, d0 = 1e9, d1 = -1e9;
    for (var i = 0; i < 8; i++) {
      _v.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]).sub(sun.position);
      var x = _v.dot(_ax), y = _v.dot(_ay), d = -_v.dot(_az);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (d < d0) d0 = d; if (d > d1) d1 = d;
    }
    cam.left = x0 - 0.1; cam.right = x1 + 0.1; cam.bottom = y0 - 0.1; cam.top = y1 + 0.1;
    cam.near = Math.max(0.5, d0 - 12); cam.far = d1 + 1;
    cam.updateProjectionMatrix();
  }

  var _col, _col2;
  function setEnvScale(s) {
    if (Math.abs(s - S.envScale) < 0.02) return;
    S.envScale = s;
    G.scene.traverse(envVisit);
  }
  function envMat(m) {
    if (!m || !m.isMeshStandardMaterial) return;
    if (m.userData.envBase === undefined) m.userData.envBase = m.envMapIntensity;
    m.envMapIntensity = m.userData.envBase * S.envScale;
  }
  function envVisit(o) {
    var m = o.material;
    if (!m) return;
    if (Array.isArray(m)) for (var i = 0; i < m.length; i++) envMat(m[i]); else envMat(m);
  }

  function applyLight() {
    kSet(S.t);
    var room = S.houseVisible, e = room ? 1 : W.sunExposure();
    var open = smooth(clamp(S.curF * 0.85 + S.door * 0.15, 0, 1));
    sun.intensity = k('sunI') * (room ? 1 : lerp(0.25, 1, e));
    kc('sunC', sun.color);
    if (room) hemi.intensity = lerp(k('roomDim'), k('roomOpen'), open);
    else hemi.intensity = k('hemiI') * lerp(1.15, 1, e);
    kc('hemiS', hemi.color); kc('hemiG', hemi.groundColor);
    fill.intensity = k('fillI') * (room ? (0.25 + 0.75 * open) : lerp(0.4, 1, e));
    kc('fillC', fill.color);
    var lp = room ? k('lamp') : 0;
    lamp.intensity = lp * 0.9;
    bulbMat.emissiveIntensity = lp * 2.2;
    shadeMat.emissiveIntensity = lp * 0.22;
    // 空
    kc('skyTop', skyU.uTop.value); kc('skyHor', skyU.uHor.value); kc('skyGnd', skyU.uGnd.value);
    kc('sunC', skyU.uSunCol.value);
    var sv = k('sunVis');
    skyU.uSunAmt.value = sv * lerp(0.35, 1, e);
    if (backdrop.material.map) kc('bdTint', backdrop.material.color);
    // 太陽
    var sd = _v.copy(S.sunPos).sub(REF).length();
    skyU.uSunDir.value.copy(S.sunPos).sub(REF).normalize();
    sunDisc.visible = sunGlow.visible = sv > 0.01;
    sunDisc.position.copy(S.sunPos); sunGlow.position.copy(S.sunPos);
    sunDisc.scale.setScalar(sd * 0.06);
    var cg = S.cloudGlow * (1 - e);            // 雲に隠れている時、ふちから日がもれて脈打つ（次に触る物の手がかり）
    var gs = sd * 0.4 * lerp(0.55, 1.2, e) * (1 + 2.3 * cg);
    sunGlow.scale.setScalar(gs);
    kc('sunC', _col); _col.lerp(_col2.setRGB(1, 1, 1), 0.6);
    sunDisc.material.color.copy(_col).multiplyScalar(sv * lerp(0.3, 1.0, e));
    sunGlow.material.color.copy(_col).multiplyScalar(sv * (lerp(0.25, 0.9, e) + 0.55 * cg));
    // 雲
    kc('cloudT', cloudU.uTint.value); kc('cloudS', cloudU.uShade.value); kc('rim', cloudU.uRim.value);
    cloudU.uCover.value = (1 - e) * sv; cloudU.uGlow.value = S.cloudGlow;
    // カーテンの透け光
    kc('curC', curMat.emissive);
    curMat.emissiveIntensity = k('curI') * (1 - 0.55 * S.curF) * (room ? 1 : 0);
    curU.base.value = 1 + S.curGlow * 0.35;
    curU.edge.value = (0.5 + S.curGlow * 2.0) * (1 - 0.7 * S.curF);
    ringMat.emissiveIntensity = 0;
    if (G.renderer) G.renderer.toneMappingExposure = k('expo') * (room ? lerp(0.96, 1.05, open) : 1);
    setEnvScale(k('envK') * (room ? lerp(0.35, 0.85, open) : 1));
  }

  // ---------- 環境マップ ----------
  function buildEnv() {
    try {
      var cv = canvas(128, 64, function (x, w, h) {
        var g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#7f97b2'); g.addColorStop(0.42, '#c2c4c2'); g.addColorStop(0.5, '#bcb6aa'); g.addColorStop(0.56, '#7a736a'); g.addColorStop(1, '#4e4a45');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        var s = x.createRadialGradient(w * 0.5, h * 0.28, 0, w * 0.5, h * 0.28, h * 0.25);
        s.addColorStop(0, 'rgba(255,250,235,0.9)'); s.addColorStop(1, 'rgba(255,250,235,0)');
        x.fillStyle = s; x.fillRect(0, 0, w, h);
      });
      var t = ctex(cv, true); t.mapping = T.EquirectangularReflectionMapping;
      var pm = new T.PMREMGenerator(G.renderer);
      var rt = pm.fromEquirectangular(t);
      G.scene.environment = rt.texture;
      t.dispose(); pm.dispose();
    } catch (e) { /* 映りこみ無しで続ける */ }
  }

  // ---------- 毎フレーム ----------
  function update(dt, time) {
    S.time = time;
    // カーテン
    spSway.step(dt);
    if (spSway.x > 0.14) spSway.x = 0.14; else if (spSway.x < -0.14) spSway.x = -0.14;
    var moving = Math.abs(spSway.x) > 0.0004 || Math.abs(spSway.v) > 0.002 || S.door > 0.02;
    if (S.houseVisible && (S.curDirty || moving)) { updCurtains(time); S.curDirty = false; }
    // 竿と洗濯ばさみ
    spPole.step(dt); spPin.step(dt);
    poleG.position.y = L.pole.y + spPole.x;
    pins[0].rotation.x = -0.04 + spPin.x; pins[1].rotation.x = 0.06 - spPin.x * 0.8;
    // 風鈴（そよ風 + ばね）
    var wind = 0.03 * Math.sin(time * 0.9) + 0.018 * Math.sin(time * 2.3 + 1.0) + 0.01 * Math.sin(time * 5.1);
    spChX.target = wind; spChZ.target = wind * 0.4 * Math.sin(time * 0.37);
    spChX.step(dt); spChZ.step(dt);
    spTan.target = wind * 2.2 + 0.03 * Math.sin(time * 1.7);
    spTan.step(dt);
    chimePivot.rotation.x = spChX.x; chimePivot.rotation.z = spChZ.x;
    tanzakuPivot.rotation.x = spTan.x - spChX.x * 0.3; tanzakuPivot.rotation.y = 0.15 * Math.sin(time * 0.8);
    // 雲
    cloudU.uTime.value = time;
    W.cloudPos(S.cloudK, cloud.position);
    var cam = G.camera;
    if (cam) {
      cloud.quaternion.copy(cam.quaternion);
      var cw = S.cloudW, chh = cw * 683 / 1024;
      cloud.scale.set(cw, cw, 1);
      _ax.setFromMatrixColumn(cam.matrixWorld, 0); _ay.setFromMatrixColumn(cam.matrixWorld, 1); _az.setFromMatrixColumn(cam.matrixWorld, 2);
      _v.setFromMatrixPosition(cam.matrixWorld);
      var ds = -_v2.copy(S.sunPos).sub(_v).dot(_az), dc = -_v3.copy(cloud.position).sub(_v).dot(_az);
      if (ds > 0.01) {
        _v2.multiplyScalar(dc / ds).add(_v).sub(cloud.position);
        cloudU.uSunUV.value.set(_v2.dot(_ax) / cw + 0.5, _v2.dot(_ay) / chh + 0.5);
      }
      sky.position.copy(_v);
    }
    applyLight();
  }

  // ---------- 公開 API ----------
  W.build = function () {
    if (S.built) return;
    T = window.THREE; L = G.L;
    _m4 = new T.Matrix4(); _q = new T.Quaternion(); _e = new T.Euler(); _v = new T.Vector3(); _v2 = new T.Vector3(); _v3 = new T.Vector3();
    _s1 = new T.Vector3(1, 1, 1); _up = new T.Vector3(0, 1, 0); _ax = new T.Vector3(); _ay = new T.Vector3(); _az = new T.Vector3(); _c = new T.Vector3();
    _col = new T.Color(); _col2 = new T.Color();
    REF = new T.Vector3(0, 1.4, 2.1);
    S.sunPos = new T.Vector3(); S.cloudW = 25;
    sunDir = new T.Vector3(0, 0.4, -1).normalize();
    var n;
    for (n in KCH) KC[n] = KCH[n].map(C);
    spSway = mkSpring(0, 22, 2.2); spPole = mkSpring(0, 260, 5); spPin = mkSpring(0, 90, 2.5);
    spChX = mkSpring(0, 18, 1.0); spChZ = mkSpring(0, 18, 1.0); spTan = mkSpring(0, 10, 1.4);
    if (G.camera && G.camera.far < 300) { G.camera.far = 400; G.camera.updateProjectionMatrix(); }

    house = new T.Group(); house.name = 'house';
    balc = new T.Group(); balc.name = 'balcony';
    skyG = new T.Group(); skyG.name = 'sky';
    G.scene.add(skyG); G.scene.add(balc); G.scene.add(house);
    W.house = house;

    buildRoom();
    buildBalcony();
    buildSky();
    buildLights();
    W.sunLight = sun;
    buildEnv();
    S.built = true;
    W.setTime(S.t);
    W.setShadowFocus(S.focus);
    updCurtains(0);
    if (G.onUpdate) G.onUpdate(update);
  };

  W.setHouseVisible = function (b) {
    S.houseVisible = !!b;
    if (house) house.visible = S.houseVisible;
    S.curDirty = true; S.envScale = -1;
  };

  W.setCurtain = function (f) {
    f = clamp(+f || 0, 0, 1);
    if (Math.abs(f - S.curF) > 1e-5) { S.curF = f; S.curDirty = true; }
  };
  W.curtainSway = function (v) { if (spSway) { spSway.kick((+v || 0) * 0.3); S.curDirty = true; } };
  W.curtainGlow = function (g) { S.curGlow = clamp(+g || 0, 0, 1); };
  W.curtainEdge = function (side, out) {
    out = out || new T.Vector3();
    var s = side < 0 ? -1 : 1, xin = lerp(GAP, L.curtain.half - L.curtain.bunch, S.curF);
    return out.set(s * xin, 1.1, L.curtain.z + 0.012);
  };

  W.setDoor = function (f) {
    S.door = clamp(+f || 0, 0, 1);
    if (movL) { movL.position.x = -0.3 - 0.58 * S.door; movR.position.x = 0.3 + 0.58 * S.door; }
  };
  W.doorHandle = function (out) {
    out = out || new T.Vector3();
    return out.set(0.05 + 0.58 * S.door, 0.9, 0.06);
  };
  W.doorGlow = function (g) {
    S.doorGlow = clamp(+g || 0, 0, 1);
    if (!movFrameMat) return;
    movFrameMat.emissive.setRGB(1, 0.86, 0.62).multiplyScalar(S.doorGlow * 0.22);
    handleMat.emissive.setRGB(1, 0.88, 0.66).multiplyScalar(S.doorGlow * 0.6);
  };

  W.setTime = function (t) {
    S.t = clamp(+t || 0, 0, 3);
    if (!S.built) return;
    kSet(S.t);
    calcSunDir();
    updateShadowCam();
    S.envScale = -1;
  };
  W.setShadowFocus = function (name) {
    S.focus = name === 'balcony' ? 'balcony' : 'room';
    if (S.built) updateShadowCam();
  };

  W.placeSun = function (v) {
    if (!v || !S.sunPos) return;
    S.sunPos.copy(v); S.sunPlaced = true;
    S.cloudW = 0.55 * _v.copy(S.sunPos).sub(REF).length();
  };
  W.setCloud = function (k2) { S.cloudK = clamp(+k2 || 0, -1.3, 1.3); };
  W.cloudPos = function (k2, out) {
    if (out === undefined && k2 && k2.isVector3) { out = k2; k2 = undefined; }
    out = out || new T.Vector3();
    if (k2 === undefined || k2 === null) k2 = S.cloudK;
    k2 = clamp(k2, -1.3, 1.3);
    _v3.copy(S.sunPos).sub(REF);
    var dist = _v3.length();
    S.cloudW = 0.55 * dist;
    _v3.normalize();
    _v2.crossVectors(_v3, _up).normalize();   // カメラから見て右
    out.copy(REF).addScaledVector(_v3, dist * 0.92).addScaledVector(_v2, k2 * S.cloudW * 0.9);
    out.y += Math.sin(S.time * 0.4) * S.cloudW * 0.004;
    return out;
  };
  W.sunExposure = function () { return sstep(0.3, 0.85, Math.abs(S.cloudK)); };
  W.cloudGlow = function (g) { S.cloudGlow = clamp(+g || 0, 0, 1); };

  W.chimeRing = function () {
    if (!spChX) return;
    spChX.kick(2.2); spChZ.kick(1.0 * (Math.random() < 0.5 ? -1 : 1)); spTan.kick(3.5);
  };
  W.poleNudge = function () {
    if (!spPole) return;
    spPole.kick(-0.12); spPin.kick(2.5); spChX.kick(0.8);
  };
})();
