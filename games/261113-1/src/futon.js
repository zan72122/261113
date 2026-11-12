/* futon.js — かけぶとん（主役）と粒子
   公開 API:
   G.futon.build()                   メッシュと粒子を作り、G.onUpdate に登録
   G.futon.setPose(a, b, t)          形 'bed' | 'bundleRoom' | 'carry' | 'rail' の間を t(0..1) で補間（v 位置ごとに少し遅れる）
   G.futon.setCarryAnchor(vec3)      'carry' の束の中心
   G.futon.setFluff(f) / G.futon.fluff   0=ぺちゃんこ … 1=ふっくら（内部はばねで ぽふっ と追従。fluff は目標値）
   G.futon.kick(s)                   ぷるんと揺れる
   G.futon.resetDust(seed)           まだらな汚れを付け直す
   G.futon.dustLeft()                残りの汚れ 0..1
   G.futon.dustiestUV()              {u,v} 残りが最も濃い所（v は 0.06..0.46 = 笠木で見えている側）
   G.futon.pick(ray)                 'rail'/'bed'（t≥0.9）の時 null | {u,v,point}（外へ 12cm まで端に clamp）
   G.futon.hit(u, v, power)          波紋 + 汚れが取れる → {removed, point, normal}（中身は使い回し）
   G.futon.press(u, v, depth)        'bed' で押す。depth は 0..1（1 で fluff=1 時 15cm）
   G.futon.release()                 離して ぼよーん
   G.futon.pointAt(u, v, out)        見えている側の表面の世界座標
   G.futon.center(out)               今の形の中心
   G.futon.setGlow(g)                ヒント用の発光 0..1
   G.futon.mesh                      （build 後）ふとんのメッシュ
   G.puff.dust(pos, normal, amount)  ほこりの煙 + 逆光のきらきら
   G.puff.feather(pos, n)            羽毛がひらひら落ちる
   G.puff.air(pos, amount)           ほこり無しの空気のふわっ
*/
(function () {
  'use strict';
  var G = (window.G = window.G || {});

  // ---- 格子 ----
  var NU = 28, NV = 44, nu = NU + 1, nv = NV + 1, NG = nu * nv;
  var K = 4;                       // ふちの帯の中間リング数
  var NP = 2 * (NU + NV);          // 外周の頂点数
  var QU = 4, QV = 6;              // キルトのマス（布テクスチャの repeat [2,3] と揃える）
  var DU = 32, DV = 44;            // 汚れの密度グリッド
  var PI = Math.PI;
  var POSE = { bed: 0, bundleRoom: 1, carry: 2, rail: 3 };

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  // 小さなばね（部分ステップで安定）
  function Spr(x, k, c) { this.x = x; this.v = 0; this.t = x; this.k = k; this.c = c; }
  Spr.prototype.step = function (dt) {
    var n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (var i = 0; i < n; i++) { this.v += (this.k * (this.t - this.x) - this.c * this.v) * h; this.x += this.v * h; }
  };
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 状態 ----
  var built = false, mesh = null, geo = null, mat = null, posArr = null, colArr = null;
  var W = 1.1, LEN = 1.5;
  var C = new Float32Array(NG * 3), N = new Float32Array(NG * 3);
  var TU = new Float32Array(NG * 3), TV = new Float32Array(NG * 3);
  var H = new Float32Array(NG);
  var qb = new Float32Array(NG), ed = new Float32Array(NG), wr = new Float32Array(NG), wr2 = new Float32Array(NG);
  var DG = new Float32Array(NG);
  var per = new Int32Array(NP), perSu = new Int8Array(NP), perSv = new Int8Array(NP);
  var poseA = 0, poseB = 0, poseT = 1;
  var anc = { x: 0, y: 0.9, z: 0.3 };
  var fluffT = 0;
  var fl = new Spr(0, 160, 13);
  var wob = new Spr(0, 95, 4.5);
  var prs = new Spr(0, 180, 22);
  var pressOn = false, pu = 0.5, pv = 0.5, pTU = 0.5, pTV = 0.5;
  var RIP = 6, ripU = new Float32Array(RIP), ripV = new Float32Array(RIP), ripAge = new Float32Array(RIP), ripPw = new Float32Array(RIP), ripOn = new Uint8Array(RIP);
  var dust = new Float32Array(DU * DV), dustSum0 = 1, dustDirty = true;
  var glow = 0, dirty = true, sgn = 1, wBed = 1, wRail = 0, lastFc = -1;
  var cx = 0, cy = 0, cz = 0;
  // 形の補助値（毎回 prep で決める）
  var base = 0.025, Hb = 0.03, bLs = 0.47, rFl = 0.045, rRho = 0.04, rQa = 0.06, rYc = 1.0, rLs = 0.6, fcNow = 0;
  var RC = 0.025;                  // 笠木の角の丸み
  var OX = 0, OY = 0, OZ = 0;      // evalPose の出力
  var hitRes = null, pickRes = null, dustUV = { u: 0.5, v: 0.25 };
  var colDull = null, colBright = null, hasFabric = false;

  // ---- 準備（格子の静的な値） ----
  function prepStatic() {
    for (var iv = 0; iv < nv; iv++) {
      var v = iv / NV;
      for (var iu = 0; iu < nu; iu++) {
        var u = iu / NU, i = iv * nu + iu;
        var cu = u * QU - Math.floor(u * QU), cvv = v * QV - Math.floor(v * QV);
        if (iu === NU) cu = 0; if (iv === NV) cvv = 0;
        qb[i] = Math.pow(Math.max(0, Math.sin(PI * cu) * Math.sin(PI * cvv)), 0.55);
        ed[i] = Math.min(u * W, (1 - u) * W, v * LEN, (1 - v) * LEN);
        var X = u * W, Z = v * LEN;
        // しわ（斜めのよれ）
        wr[i] = 0.42 * Math.sin(X * 7.1 + Z * 4.3 + 0.7) * Math.sin(Z * 5.3 - X * 2.9 + 1.1) +
                0.33 * Math.sin(X * 15.7 - Z * 11.9 + 2.0) + 0.25 * Math.sin(X * 3.3 + Z * 13.1 + 4.1);
        wr2[i] = 0.5 * Math.sin(X * 11.3 + Z * 8.7 + 0.3) * Math.sin(Z * 3.1 + X * 1.7) + 0.5 * Math.sin(X * 4.9 - Z * 9.6 + 1.9);
      }
    }
    var k = 0, iu2, iv2;
    function addP(a, b) { per[k] = b * nu + a; perSu[k] = a === 0 ? -1 : a === NU ? 1 : 0; perSv[k] = b === 0 ? -1 : b === NV ? 1 : 0; k++; }
    for (iu2 = 0; iu2 < NU; iu2++) addP(iu2, 0);
    for (iv2 = 0; iv2 < NV; iv2++) addP(NU, iv2);
    for (iu2 = NU; iu2 > 0; iu2--) addP(iu2, NV);
    for (iv2 = NV; iv2 > 0; iv2--) addP(0, iv2);
  }

  // ---- 形ごとの中心面 ----
  function prepPose(fc, f) {
    base = (0.025 + 0.195 * f) * (1 + 0.18 * wob.x);
    if (base < 0.012) base = 0.012;
    Hb = base * (1 + 0.22 * (1 - fc)) * 1.03;
    bLs = Math.max(0.08, (LEN - PI * Hb) / 3);
    var L = G.L;
    rFl = Math.max(0.005, L.rail.cap / 2 - RC);
    rRho = RC + Hb / 2;
    rQa = PI / 2 * rRho;
    rYc = L.rail.y - RC;
    rLs = LEN / 2 - rFl - rQa;
  }

  function evalPose(id, i, u, v, h, fc) {
    var L = G.L, s, phi;
    if (id === 0) {
      // しきぶとんの上に広げた（少し斜めによれる）
      var sk = 0.035 * (1 - 0.5 * fc);
      var x = L.futon.xBed + (u - 0.5) * W + (v - 0.5) * LEN * sk;
      var z = L.futon.zBed0 + v * LEN - (u - 0.5) * W * sk;
      var ex = Math.abs(x - L.mattress.x) - L.mattress.w * 0.5;
      var ez = Math.max(L.mattress.z0 - z, z - L.mattress.z1);
      if (ez > ex) ex = ez;
      var yb = L.mattress.top;
      if (ex > 0) { var dr = smooth(ex / 0.085); yb -= (L.mattress.top - 0.004) * (1 - (1 - dr) * (1 - dr)); }
      var ew = 1 - smooth(ed[i] / 0.16);
      yb += (1 - fc) * 0.012 * ew * (0.5 + 0.5 * Math.sin(u * W * 13 + v * LEN * 9 + 1.3)) * (1 - smooth(ex / 0.02));
      OX = x; OY = yb + h * 0.5; OZ = z;
      return;
    }
    if (id === 1 || id === 2) {
      // 三つ折りの束（Z 字に折り返す）
      var bx, by0, bz;
      if (id === 1) { bx = L.futon.bundleRoom.x; bz = L.futon.bundleRoom.z; by0 = 0; }
      else { bx = anc.x; bz = anc.z; by0 = anc.y - 1.5 * Hb; }
      var Ls = bLs, r = Hb * 0.5, arc = PI * r, y, zz;
      s = v * LEN;
      if (s < Ls) { zz = bz - Ls / 2 + s; y = by0 + Hb / 2 - (Hb - h) / 2 * smooth((Ls - s) / 0.06); }
      else if (s < Ls + arc) { phi = (s - Ls) / r; zz = bz + Ls / 2 + r * Math.sin(phi); y = by0 + Hb - r * Math.cos(phi); }
      else if (s < 2 * Ls + arc) { zz = bz + Ls / 2 - (s - Ls - arc); y = by0 + 1.5 * Hb; }
      else if (s < 2 * Ls + 2 * arc) { phi = (s - 2 * Ls - arc) / r; zz = bz - Ls / 2 - r * Math.sin(phi); y = by0 + 2 * Hb - r * Math.cos(phi); }
      else { zz = bz - Ls / 2 + (s - 2 * Ls - 2 * arc); y = by0 + 2.5 * Hb; }
      if (id === 2) { var q = 2 * u - 1; y += 0.08 * q * q - 0.03; }
      OX = bx + (u - 0.5) * W; OY = y; OZ = zz;
      return;
    }
    // 'rail' 笠木に二つ折りで掛けた。v<0.5 が室内側（+z）
    var side = v < 0.5 ? 1 : -1, rz = L.rail.z, zr, yr;
    s = Math.abs(v - 0.5) * LEN;
    if (s <= rFl) { zr = rz + side * s; yr = L.rail.y + Hb / 2; }
    else if (s <= rFl + rQa) { phi = (s - rFl) / rRho; zr = rz + side * (rFl + rRho * Math.sin(phi)); yr = rYc + rRho * Math.cos(phi); }
    else {
      var d = s - rFl - rQa, dn = rLs > 0.01 ? d / rLs : 0;
      zr = rz + side * (rFl + rRho); yr = rYc - d;
      var hem = smooth((d - (rLs - 0.32)) / 0.32);
      zr += side * (0.012 + 0.035 * fc) * hem * hem;
      zr += side * 0.012 * dn * (0.5 + 0.5 * Math.sin(u * W * 11 + side * 1.7 + 0.4));
      zr += side > 0 ? Math.max(0, wob.x) * 0.08 * dn : -wob.x * 0.08 * dn;
      if (yr < h * 0.5 + 0.01) yr = h * 0.5 + 0.01;
    }
    OX = L.futon.xRail + (u - 0.5) * W; OY = yr; OZ = zr;
  }

  // ---- 毎フレームの形の作り直し ----
  function rebuild() {
    dirty = false;
    var f = Math.max(0, fl.x), fc = clamp(f, 0, 1), i, iu, iv, j, k, o;
    fcNow = fc;
    prepPose(fc, f);
    var a = poseA, b = poseB, t = poseT, same = a === b;
    wBed = (a === 0 ? 1 - t : 0) + (b === 0 ? t : 0);
    wRail = (a === 3 ? 1 - t : 0) + (b === 3 ? t : 0);
    sgn = wRail > 0.5 ? -1 : 1;
    var Re = 0.035 + 0.085 * fc, em = 0.6 - 0.28 * fc;
    for (iv = 0; iv < nv; iv++) {
      var v = iv / NV;
      var tv = same ? 1 : clamp(t * 1.35 - 0.35 * v, 0, 1);
      var e = smooth(tv), bump = same ? 0 : Math.sin(PI * tv);
      for (iu = 0; iu < nu; iu++) {
        var u = iu / NU; i = iv * nu + iu;
        // 厚み = 基本厚 × キルト × ふちの絞り × しわ
        var qf = 1 - fc * (1 - (0.42 + 0.58 * qb[i]));
        var dd = Math.min(ed[i] / Re, 1), ef = em + (1 - em) * Math.sqrt(1 - (1 - dd) * (1 - dd));
        var h = base * qf * ef * (1 + (1 - fc) * 0.22 * wr[i]) * (1 + 0.12 * bump);
        if (h < 0.008) h = 0.008;
        H[i] = h;
        o = i * 3;
        if (same || e >= 1) { evalPose(same ? a : b, i, u, v, h, fc); C[o] = OX; C[o + 1] = OY; C[o + 2] = OZ; }
        else {
          evalPose(a, i, u, v, h, fc); var ax = OX, ay = OY, az = OZ;
          evalPose(b, i, u, v, h, fc);
          var ddx = OX - ax, ddy = OY - ay, ddz = OZ - az, dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          C[o] = ax + ddx * e; C[o + 1] = ay + ddy * e + bump * (0.05 + 0.28 * dist); C[o + 2] = az + ddz * e;
        }
      }
    }
    // 中心面の法線 N = Pv × Pu
    for (iv = 0; iv < nv; iv++) {
      var v0 = iv > 0 ? iv - 1 : 0, v1 = iv < NV ? iv + 1 : NV;
      for (iu = 0; iu < nu; iu++) {
        var u0 = iu > 0 ? iu - 1 : 0, u1 = iu < NU ? iu + 1 : NU;
        i = iv * nu + iu; o = i * 3;
        var A = (iv * nu + u1) * 3, B = (iv * nu + u0) * 3, Cc = (v1 * nu + iu) * 3, D = (v0 * nu + iu) * 3;
        var pux = C[A] - C[B], puy = C[A + 1] - C[B + 1], puz = C[A + 2] - C[B + 2];
        var pvx = C[Cc] - C[D], pvy = C[Cc + 1] - C[D + 1], pvz = C[Cc + 2] - C[D + 2];
        var nx = pvy * puz - pvz * puy, ny = pvz * pux - pvx * puz, nz = pvx * puy - pvy * pux;
        var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (l < 1e-10) { nx = 0; ny = 1; nz = 0; l = 1; }
        N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
        l = Math.sqrt(pux * pux + puy * puy + puz * puz) || 1; TU[o] = pux / l; TU[o + 1] = puy / l; TU[o + 2] = puz / l;
        l = Math.sqrt(pvx * pvx + pvy * pvy + pvz * pvz) || 1; TV[o] = pvx / l; TV[o + 1] = pvy / l; TV[o + 2] = pvz / l;
      }
    }
    // 変位: しわ・揺れ・波紋・押し込み
    var pAmt = prs.x * wBed, anyRip = false;
    for (k = 0; k < RIP; k++) if (ripOn[k]) anyRip = true;
    var wobJ = wob.x * 0.04, wrA = (1 - fc) * 0.006;
    var sx = 0, sy = 0, sz = 0;
    for (iv = 0; iv < nv; iv++) {
      var vv = iv / NV, sinV = Math.sin(PI * vv);
      for (iu = 0; iu < nu; iu++) {
        var uu = iu / NU; i = iv * nu + iu; o = i * 3;
        var dsp = wrA * wr2[i] + wobJ * Math.sin(PI * uu) * sinV;
        if (anyRip) {
          var inw = 0;
          for (k = 0; k < RIP; k++) {
            if (!ripOn[k]) continue;
            var rx = (uu - ripU[k]) * W, ry = (vv - ripV[k]) * LEN, rr = Math.sqrt(rx * rx + ry * ry);
            if (rr > 0.9) continue;
            var ag = ripAge[k], Am = ripPw[k] * (0.035 + 0.05 * fc), fr = 1.1 * ag, q = (rr - fr) / 0.13;
            inw += Am * Math.exp(-rr * rr / 0.012) * Math.exp(-ag * 9) +
                   Am * 0.55 * Math.sin((rr - fr) * 22) * Math.exp(-q * q) * (1 - ag / 0.5);
          }
          dsp -= sgn * inw;
        }
        if (pAmt !== 0) {
          var px = (uu - pu) * W, py = (vv - pv) * LEN, pr2 = px * px + py * py, pr = Math.sqrt(pr2);
          var rq = (pr - 0.3) / 0.1;
          var dh = pAmt * (Math.exp(-pr2 / 0.0288) - 0.18 * Math.exp(-rq * rq));
          var hn = Math.max(H[i] - dh, 0.01), del = H[i] - hn;
          H[i] = hn; dsp -= del * 0.5;
        }
        C[o] += N[o] * dsp; C[o + 1] += N[o + 1] * dsp; C[o + 2] += N[o + 2] * dsp;
        sx += C[o]; sy += C[o + 1]; sz += C[o + 2];
      }
    }
    cx = sx / NG; cy = sy / NG; cz = sz / NG;
    // 頂点位置: 表・裏
    var P = posArr, hh;
    for (i = 0; i < NG; i++) {
      o = i * 3; hh = H[i] * 0.5;
      P[o] = C[o] + N[o] * hh; P[o + 1] = C[o + 1] + N[o + 1] * hh; P[o + 2] = C[o + 2] + N[o + 2] * hh;
      var ob = (NG + i) * 3;
      P[ob] = C[o] - N[o] * hh; P[ob + 1] = C[o + 1] - N[o + 1] * hh; P[ob + 2] = C[o + 2] - N[o + 2] * hh;
    }
    // ふちの丸い帯
    for (k = 0; k < NP; k++) {
      i = per[k]; o = i * 3; hh = H[i] * 0.5;
      var su = perSu[k], sv = perSv[k];
      var Ox = su * TU[o] + sv * TV[o], Oy = su * TU[o + 1] + sv * TV[o + 1], Oz = su * TU[o + 2] + sv * TV[o + 2];
      var dn = Ox * N[o] + Oy * N[o + 1] + Oz * N[o + 2];
      Ox -= dn * N[o]; Oy -= dn * N[o + 1]; Oz -= dn * N[o + 2];
      var ol = Math.sqrt(Ox * Ox + Oy * Oy + Oz * Oz) || 1; Ox /= ol; Oy /= ol; Oz /= ol;
      var ro = hh * 0.95 + 0.004;
      for (j = 1; j <= K; j++) {
        var th = PI / 2 - PI * j / (K + 1), sn = Math.sin(th) * hh, cs = Math.cos(th) * ro;
        var ov = (2 * NG + k * K + j - 1) * 3;
        P[ov] = C[o] + N[o] * sn + Ox * cs; P[ov + 1] = C[o + 1] + N[o + 1] * sn + Oy * cs; P[ov + 2] = C[o + 2] + N[o + 2] * sn + Oz * cs;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    if (dustDirty || Math.abs(fc - lastFc) > 0.003) updateColors(fc);
    // 布の色: ふくらむほど わずかに明るく暖かく
    mat.color.copy(colDull).lerp(colBright, fc);
  }

  function dustAt(u, v) {
    var x = clamp(u, 0, 1) * (DU - 1), y = clamp(v, 0, 1) * (DV - 1);
    var x0 = Math.min(Math.floor(x), DU - 2), y0 = Math.min(Math.floor(y), DV - 2), ax = x - x0, ay = y - y0, o = y0 * DU + x0;
    return (dust[o] * (1 - ax) + dust[o + 1] * ax) * (1 - ay) + (dust[o + DU] * (1 - ax) + dust[o + DU + 1] * ax) * ay;
  }

  function updateColors(fc) {
    var i, iu, iv, o, k, j;
    if (dustDirty) {
      for (iv = 0; iv < nv; iv++) for (iu = 0; iu < nu; iu++) DG[iv * nu + iu] = dustAt(iu / NU, iv / NV);
      dustDirty = false;
    }
    lastFc = fc;
    var cA = colArr;
    function setC(vi, gi, mul) {
      var d = DG[gi], ao = (1 - 0.16 * fc * (1 - qb[gi]) - (1 - fc) * 0.07 * Math.max(0, wr[gi])) * mul, p = vi * 3;
      cA[p] = (1 - d * 0.38) * ao; cA[p + 1] = (1 - d * 0.42) * ao; cA[p + 2] = (1 - d * 0.48) * ao;
    }
    for (i = 0; i < NG; i++) { setC(i, i, 1); setC(NG + i, i, 1); }
    for (k = 0; k < NP; k++) for (j = 1; j <= K; j++) setC(2 * NG + k * K + j - 1, per[k], j === 2 || j === 3 ? 0.9 : 0.95);
    geo.attributes.color.needsUpdate = true;
  }

  // ---- ダイナミクス ----
  function step(dt) {
    fl.step(dt); wob.step(dt);
    if (pressOn) { var kf = 1 - Math.exp(-14 * dt); pu += (pTU - pu) * kf; pv += (pTV - pv) * kf; }
    prs.step(dt);
    for (var k = 0; k < RIP; k++) if (ripOn[k]) { ripAge[k] += dt; if (ripAge[k] > 0.5) ripOn[k] = 0; }
    dirty = true;
  }

  function ensure() { if (built && dirty) rebuild(); }

  // ---- テクスチャ（Canvas） ----
  function makeNormalMap() {
    var S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var g = cv.getContext('2d'), img = g.createImageData(S, S), Hh = new Float32Array(S * S), x, y;
    var rnd = mulberry(7);
    var noise = new Float32Array(S * S); for (x = 0; x < S * S; x++) noise[x] = rnd();
    for (y = 0; y < S; y++) {
      var ty = y / S;
      for (x = 0; x < S; x++) {
        var tx = x / S;
        // タイル = キルト 2×2 マス。縫い目は 0, 0.5, 1
        var dx = Math.min(Math.abs(tx), Math.abs(tx - 0.5), Math.abs(1 - tx)), dy = Math.min(Math.abs(ty), Math.abs(ty - 0.5), Math.abs(1 - ty));
        var gx = Math.exp(-(dx / 0.014) * (dx / 0.014)), gy = Math.exp(-(dy / 0.012) * (dy / 0.012));
        var st = 0.5 + 0.5 * Math.sin((dx < dy ? ty : tx) * PI * 2 * 70);   // ステッチ
        var groove = Math.max(gx, gy) * (0.85 + 0.15 * st);
        var dome = Math.sin(PI * ((tx * 2) % 1)) * Math.sin(PI * ((ty * 2) % 1));
        var weave = 0.5 * Math.sin(x * PI * 0.5) * Math.sin(y * PI * 0.5) + 0.5 * (noise[y * S + x] - 0.5);
        Hh[y * S + x] = dome * 0.6 - groove * 1.2 + weave * 0.05;
      }
    }
    var sc = 6.0, d = img.data;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var xl = (x + S - 1) % S, xr = (x + 1) % S, yu = (y + S - 1) % S, yd = (y + 1) % S;
      var nx = -(Hh[y * S + xr] - Hh[y * S + xl]) * sc, ny = -(Hh[yu * S + x] - Hh[yd * S + x]) * sc, nz = 1;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz), p = (y * S + x) * 4;
      d[p] = (nx / l * 0.5 + 0.5) * 255; d[p + 1] = (ny / l * 0.5 + 0.5) * 255; d[p + 2] = (nz / l * 0.5 + 0.5) * 255; d[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(QU / 2, QV / 2);
    return t;
  }

  // ---- メッシュ ----
  function buildMesh() {
    var nVert = 2 * NG + NP * K;
    posArr = new Float32Array(nVert * 3); colArr = new Float32Array(nVert * 3);
    var uv = new Float32Array(nVert * 2), idx = [], iu, iv, k, j, i;
    for (iv = 0; iv < nv; iv++) for (iu = 0; iu < nu; iu++) {
      i = iv * nu + iu;
      uv[i * 2] = iu / NU; uv[i * 2 + 1] = iv / NV; uv[(NG + i) * 2] = iu / NU; uv[(NG + i) * 2 + 1] = iv / NV;
    }
    for (k = 0; k < NP; k++) for (j = 1; j <= K; j++) {
      var vi = 2 * NG + k * K + j - 1; uv[vi * 2] = uv[per[k] * 2]; uv[vi * 2 + 1] = uv[per[k] * 2 + 1];
    }
    for (iv = 0; iv < NV; iv++) for (iu = 0; iu < NU; iu++) {
      var a = iv * nu + iu, b = a + nu, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
      idx.push(NG + a, NG + c, NG + b, NG + c, NG + d, NG + b);
    }
    function ring(kk, jj) { var g = per[kk % NP]; return jj === 0 ? g : jj === K + 1 ? NG + g : 2 * NG + (kk % NP) * K + jj - 1; }
    for (k = 0; k < NP; k++) for (j = 0; j <= K; j++) {
      var A = ring(k, j), B = ring(k + 1, j), Cc = ring(k, j + 1), D = ring(k + 1, j + 1);
      idx.push(A, B, Cc, B, D, Cc);
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nVert * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);

    var map = null;
    hasFabric = !!(G.assets && G.assets.has && G.assets.has('fabric'));
    if (hasFabric) { try { map = G.assets.tex('fabric', { repeat: [QU / 2, QV / 2], aniso: true }); } catch (e) { map = null; hasFabric = false; } }
    var nmap = null; try { nmap = makeNormalMap(); } catch (e2) { nmap = null; }
    mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: map, normalMap: nmap, roughness: 0.93, metalness: 0,
      vertexColors: true, emissive: 0x000000
    });
    if (nmap) mat.normalScale.set(0.55, 0.55);
    // くすんだ色 → 明るく暖かい色
    if (hasFabric) { colDull = new THREE.Color(0.80, 0.78, 0.74); colBright = new THREE.Color(1.0, 0.985, 0.95); }
    else { colDull = new THREE.Color(0.76, 0.735, 0.68); colBright = new THREE.Color(0.95, 0.915, 0.84); }
    mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'kakebuton';
    G.scene.add(mesh);
  }

  // ---- 汚れ ----
  function resetDust(seed) {
    var r = mulberry(((seed | 0) ^ 0x9e3779b9) >>> 0), x, y, s;
    var ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28], fq = [3 + r() * 3, 2 + r() * 3, 6 + r() * 4, 5 + r() * 4];
    var ns = 5 + Math.floor(r() * 3), st = [];
    for (s = 0; s < ns; s++) {
      st.push({ u: 0.12 + r() * 0.76, v: s < 3 ? 0.08 + r() * 0.37 : 0.08 + r() * 0.84, ru: 0.06 + r() * 0.1, rv: 0.05 + r() * 0.09,
        k: 0.45 + r() * 0.4, a: r() * 6.28, w: 0.15 + r() * 0.2 });
    }
    var sum = 0;
    for (y = 0; y < DV; y++) {
      var v = y / (DV - 1);
      for (x = 0; x < DU; x++) {
        var u = x / (DU - 1);
        var d = 0.2 + 0.07 * Math.sin(u * fq[0] + ph[0]) * Math.sin(v * fq[1] + ph[1]) + 0.05 * Math.sin(u * fq[2] + v * fq[3] + ph[2]) +
                0.04 * Math.sin(v * 17 + u * 9 + ph[3]);
        for (s = 0; s < ns; s++) {
          var S = st[s], dx = (u - S.u) / S.ru, dy = (v - S.v) / S.rv, ang = Math.atan2(dy, dx);
          var rr = (dx * dx + dy * dy) / Math.pow(1 + S.w * Math.sin(ang * 3 + S.a), 2);
          d += S.k * Math.exp(-rr * 1.3);
        }
        d = clamp(d, 0, 1); dust[y * DU + x] = d; sum += d;
      }
    }
    dustSum0 = sum || 1; dustDirty = true; dirty = true;
  }
  function dustTotal() { var s = 0; for (var i = 0; i < DU * DV; i++) s += dust[i]; return s; }

  // ---- 交差・表面 ----
  function curPose() { return poseT >= 0.9 ? poseB : poseT <= 0.1 ? poseA : -1; }

  function pointAt(u, v, out) {
    out = out || new THREE.Vector3();
    if (!built) return out.set(0, 0, 0);
    ensure();
    var x = clamp(u, 0, 1) * NU, y = clamp(v, 0, 1) * NV;
    var x0 = Math.min(Math.floor(x), NU - 1), y0 = Math.min(Math.floor(y), NV - 1), ax = x - x0, ay = y - y0;
    var off = sgn > 0 ? 0 : NG, i00 = (off + y0 * nu + x0) * 3, i10 = i00 + 3, i01 = i00 + nu * 3, i11 = i01 + 3, P = posArr;
    var w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
    return out.set(P[i00] * w00 + P[i10] * w10 + P[i01] * w01 + P[i11] * w11,
      P[i00 + 1] * w00 + P[i10 + 1] * w10 + P[i01 + 1] * w01 + P[i11 + 1] * w11,
      P[i00 + 2] * w00 + P[i10 + 2] * w10 + P[i01 + 2] * w01 + P[i11 + 2] * w11);
  }
  function normalAt(u, v, out) {
    ensure();
    var x = clamp(u, 0, 1) * NU, y = clamp(v, 0, 1) * NV;
    var x0 = Math.min(Math.floor(x), NU - 1), y0 = Math.min(Math.floor(y), NV - 1), ax = x - x0, ay = y - y0;
    var i00 = (y0 * nu + x0) * 3, i10 = i00 + 3, i01 = i00 + nu * 3, i11 = i01 + 3;
    var w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
    out.set(N[i00] * w00 + N[i10] * w10 + N[i01] * w01 + N[i11] * w11,
      N[i00 + 1] * w00 + N[i10 + 1] * w10 + N[i01 + 1] * w01 + N[i11 + 1] * w11,
      N[i00 + 2] * w00 + N[i10 + 2] * w10 + N[i01 + 2] * w01 + N[i11 + 2] * w11);
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
    return out.normalize().multiplyScalar(sgn);
  }

  function pick(ray) {
    if (!built || !ray) return null;
    ensure();
    var cp = curPose(), L = G.L, o = ray.origin, d = ray.direction, t, px, py, pz, u, v;
    var mu = 0.12 / W, mv = 0.12 / LEN;
    if (cp === 3) {
      var rz = L.rail.z, zf = rz + L.rail.cap / 2 + Hb, yt = L.rail.y + Hb, s = -1;
      if (Math.abs(d.z) > 1e-6) {
        t = (zf - o.z) / d.z;
        if (t > 0) {
          px = o.x + d.x * t; py = o.y + d.y * t;
          if (py <= rYc) s = rFl + rQa + (rYc - py);
          else if (py <= rYc + rRho) s = rFl + rRho * Math.acos(clamp((py - rYc) / rRho, -1, 1));
        }
      }
      if (s < 0 && d.y < -1e-6) {
        t = (yt - o.y) / d.y;
        if (t > 0) {
          px = o.x + d.x * t; pz = o.z + d.z * t;
          var dz = pz - rz;
          if (dz >= -(rFl + rRho) - 0.12 && dz <= zf - rz + 0.12) s = dz <= rFl ? 0 : rFl + rRho * Math.asin(clamp((dz - rFl) / rRho, 0, 1));
        }
      }
      if (s < 0 || s > LEN / 2 + 0.12) return null;
      u = (px - L.futon.xRail) / W + 0.5;
      if (u < -mu || u > 1 + mu) return null;
      u = clamp(u, 0, 1); v = clamp(0.5 - s / LEN, 0, 0.5);
    } else if (cp === 0) {
      if (Math.abs(d.y) < 1e-6) return null;
      var yp = L.mattress.top + base * 0.9;
      t = (yp - o.y) / d.y; if (t <= 0) return null;
      px = o.x + d.x * t; pz = o.z + d.z * t;
      var sk = 0.035 * (1 - 0.5 * fcNow);
      u = (px - L.futon.xBed) / W + 0.5; v = (pz - L.futon.zBed0) / LEN;
      for (var it = 0; it < 2; it++) {
        v = (pz - L.futon.zBed0 + (u - 0.5) * W * sk) / LEN;
        u = (px - L.futon.xBed - (v - 0.5) * LEN * sk) / W + 0.5;
      }
      if (u < -mu || u > 1 + mu || v < -mv || v > 1 + mv) return null;
      u = clamp(u, 0, 1); v = clamp(v, 0, 1);
    } else return null;
    pickRes.u = u; pickRes.v = v; pointAt(u, v, pickRes.point);
    return pickRes;
  }

  function addRipple(u, v, p) {
    var k, best = 0, ba = -1;
    for (k = 0; k < RIP; k++) { if (!ripOn[k]) { best = k; ba = 99; break; } if (ripAge[k] > ba) { ba = ripAge[k]; best = k; } }
    ripU[best] = u; ripV[best] = v; ripAge[best] = 0; ripPw[best] = p; ripOn[best] = 1;
  }

  function hit(u, v, power) {
    var p = power == null ? 1 : clamp(power, 0, 1.5);
    u = clamp(u, 0, 1); v = clamp(v, 0, 1);
    if (!hitRes) hitRes = { removed: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };
    if (!built) { hitRes.removed = 0; return hitRes; }
    addRipple(u, v, p);
    wob.v += 0.6 * p;
    // 汚れを取る（rail では二つ折りの裏側も一緒に）
    var frac = Math.min(0.95, 0.65 * p), rem = 0, both = curPose() === 3 || wRail > 0.5, mv2 = 1 - v;
    for (var y = 0; y < DV; y++) {
      var vn = y / (DV - 1), dv1 = vn - v, dv2 = vn - mv2;
      for (var x = 0; x < DU; x++) {
        var du = x / (DU - 1) - u, g = Math.exp(-2 * (du * du + dv1 * dv1) / 0.04);
        if (both) { var g2 = Math.exp(-2 * (du * du + dv2 * dv2) / 0.04); if (g2 > g) g = g2; }
        if (g < 0.002) continue;
        var o = y * DU + x, r = dust[o] * frac * g; dust[o] -= r; rem += r;
      }
    }
    dustDirty = true; dirty = true;
    hitRes.removed = rem / dustSum0;
    pointAt(u, v, hitRes.point); normalAt(u, v, hitRes.normal);
    return hitRes;
  }

  function dustiestUV() {
    var best = -1, bu = 0.5, bv = 0.25;
    for (var by = 0; by < 8; by++) {
      var v0 = 0.06 + by * 0.05;
      for (var bx = 0; bx < 6; bx++) {
        var u0 = bx / 6, s = 0;
        for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) {
          var uu = u0 + (i + 0.5) / 18, vv = v0 + (j + 0.5) * 0.05 / 3;
          s += dustAt(uu, vv) + dustAt(uu, 1 - vv);
        }
        if (s > best) { best = s; bu = u0 + 1 / 12; bv = v0 + 0.025; }
      }
    }
    dustUV.u = bu; dustUV.v = bv;
    return dustUV;
  }

  // ---- 粒子 G.puff ----
  var MAXP = 300, pts = null, pPos, pVel, pAge, pLife, pS0, pS1, pA0, pCol, pAdd, pKind, pPh, aAlpha, aSize, pCur = 0, pUni = null;
  var FE = 8, fMesh = null, fOn = new Uint8Array(FE), fP = new Float32Array(FE * 3), fV = new Float32Array(FE * 3), fPh = new Float32Array(FE),
    fRy = new Float32Array(FE), fSpin = new Float32Array(FE), fLand = new Float32Array(FE), fAge = new Float32Array(FE), fDummy = null, tmpV2 = null;

  function softTex() {
    var S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var g = cv.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.62, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(cv);
  }
  function featherTex() {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
    var g = cv.getContext('2d'), r = mulberry(11);
    g.clearRect(0, 0, 64, 128); g.lineCap = 'round';
    for (var i = 0; i < 70; i++) {
      var y = 10 + i * 1.5, half = Math.sin(PI * clamp((y - 6) / 112, 0, 1)) * 26 + 2;
      for (var sd = -1; sd <= 1; sd += 2) {
        g.strokeStyle = 'rgba(255,255,255,' + (0.35 + r() * 0.35).toFixed(2) + ')'; g.lineWidth = 1 + r();
        g.beginPath(); g.moveTo(32, y); g.quadraticCurveTo(32 + sd * half * 0.5, y - 4, 32 + sd * half * (0.8 + r() * 0.2), y - 10 - r() * 4); g.stroke();
      }
    }
    // 根もとのふわふわ
    for (var k = 0; k < 40; k++) {
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1;
      var a = -PI / 2 + (r() - 0.5) * 2.4; g.beginPath(); g.moveTo(32, 112); g.lineTo(32 + Math.cos(a) * 14 * r(), 112 - Math.sin(a) * 14 * r()); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(32, 124); g.quadraticCurveTo(33, 60, 31, 4); g.stroke();
    return new THREE.CanvasTexture(cv);
  }

  function buildPuff() {
    pPos = new Float32Array(MAXP * 3); pVel = new Float32Array(MAXP * 3); pCol = new Float32Array(MAXP * 3);
    pAge = new Float32Array(MAXP); pLife = new Float32Array(MAXP); pS0 = new Float32Array(MAXP); pS1 = new Float32Array(MAXP);
    pA0 = new Float32Array(MAXP); pAdd = new Float32Array(MAXP); pKind = new Uint8Array(MAXP); pPh = new Float32Array(MAXP);
    aAlpha = new Float32Array(MAXP); aSize = new Float32Array(MAXP);
    for (var i = 0; i < MAXP; i++) { pLife[i] = 0; pPos[i * 3 + 1] = -100; }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAdd', new THREE.BufferAttribute(pAdd, 1).setUsage(THREE.DynamicDrawUsage));
    pUni = { uTex: { value: softTex() }, uScale: { value: 600 } };
    var m = new THREE.ShaderMaterial({
      uniforms: pUni, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: [
        'attribute vec3 aColor; attribute float aAlpha; attribute float aSize; attribute float aAdd;',
        'uniform float uScale; varying vec3 vColor; varying float vAlpha; varying float vAdd;',
        'void main(){ vColor=aColor; vAlpha=aAlpha; vAdd=aAdd;',
        ' vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;',
        ' float s=aSize*uScale/max(0.05,-mv.z); gl_PointSize = aAlpha>0.0 ? clamp(s,0.0,300.0) : 0.0; }'
      ].join('\n'),
      // 乗算済みアルファ: 煙は通常合成、きらきら（vAdd=1）は加算
      fragmentShader: [
        'uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha; varying float vAdd;',
        'void main(){ float a=texture2D(uTex,gl_PointCoord).a*vAlpha; if(a<0.003) discard;',
        ' gl_FragColor=vec4(vColor*a, a*(1.0-vAdd)); }'
      ].join('\n')
    });
    pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 10; pts.name = 'puff';
    G.scene.add(pts);

    var fg = new THREE.PlaneGeometry(0.034, 0.062);
    var fm = new THREE.MeshLambertMaterial({ color: 0xffffff, map: featherTex(), transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: false, emissive: 0x404040 });
    fMesh = new THREE.InstancedMesh(fg, fm, FE);
    fMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fMesh.frustumCulled = false; fMesh.renderOrder = 9;
    fDummy = new THREE.Object3D(); tmpV2 = new THREE.Vector2();
    for (var k = 0; k < FE; k++) { fDummy.scale.set(0, 0, 0); fDummy.updateMatrix(); fMesh.setMatrixAt(k, fDummy.matrix); }
    G.scene.add(fMesh);
  }

  function pLimit() { var q = G.quality && G.quality.maxParticles; return Math.min(MAXP, q > 0 ? q : MAXP); }
  function spawn(kind, x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b, add) {
    var lim = pLimit(), i = -1, n;
    for (n = 0; n < lim; n++) { var c = (pCur + n) % lim; if (pAge[c] >= pLife[c]) { i = c; break; } }
    if (i < 0) i = pCur % lim;
    pCur = (i + 1) % lim;
    var o = i * 3;
    pPos[o] = x; pPos[o + 1] = y; pPos[o + 2] = z; pVel[o] = vx; pVel[o + 1] = vy; pVel[o + 2] = vz;
    pCol[o] = r; pCol[o + 1] = g; pCol[o + 2] = b;
    pAge[i] = 0; pLife[i] = life; pS0[i] = s0; pS1[i] = s1; pA0[i] = a0; pAdd[i] = add; pKind[i] = kind; pPh[i] = Math.random() * 6.28;
  }
  function rr(a, b) { return a + Math.random() * (b - a); }

  function puffDust(pos, normal, amount) {
    if (!pts || !pos) return;
    var am = clamp(amount == null ? 1 : amount, 0, 1.5);
    var nx = normal ? normal.x : 0, ny = normal ? normal.y : 1, nz = normal ? normal.z : 0;
    var n = Math.max(2, Math.round(40 * am)), sz = 0.6 + 0.4 * Math.min(am, 1), i;
    for (i = 0; i < n; i++) {
      var sp = rr(0.5, 1.4) * (0.6 + 0.6 * Math.min(am, 1)), br = rr(0.9, 1.08);
      spawn(0, pos.x + rr(-0.05, 0.05), pos.y + rr(-0.05, 0.05), pos.z + rr(-0.05, 0.05),
        nx * sp + rr(-0.35, 0.35), ny * sp + rr(-0.25, 0.35), nz * sp + rr(-0.35, 0.35),
        rr(1.5, 2.5), rr(0.06, 0.12) * sz, rr(0.25, 0.45) * sz, rr(0.25, 0.4), 0.80 * br, 0.76 * br, 0.70 * br, 0);
    }
    var ns = Math.max(1, Math.round(n / 3));
    for (i = 0; i < ns; i++) {
      var s2 = rr(0.3, 0.8);
      spawn(1, pos.x + rr(-0.08, 0.08), pos.y + rr(-0.06, 0.08), pos.z + rr(-0.08, 0.08),
        nx * s2 + rr(-0.3, 0.3), ny * s2 + rr(-0.15, 0.3), nz * s2 + rr(-0.3, 0.3),
        rr(2.0, 3.0), rr(0.01, 0.022), rr(0.01, 0.02), rr(0.6, 0.9), 1.0, 0.93, 0.78, 1);
    }
  }
  function puffAir(pos, amount) {
    if (!pts || !pos) return;
    var am = clamp(amount == null ? 1 : amount, 0, 1.5), n = Math.round(6 + 10 * am);
    for (var i = 0; i < n; i++) {
      var a = rr(0, 6.28), b = rr(-0.6, 1), sp = rr(0.3, 0.7) * (0.6 + 0.5 * am);
      spawn(2, pos.x + rr(-0.04, 0.04), pos.y + rr(-0.03, 0.04), pos.z + rr(-0.04, 0.04),
        Math.cos(a) * sp, b * 0.3 + 0.15, Math.sin(a) * sp, rr(0.45, 0.75), rr(0.07, 0.1), rr(0.28, 0.4), rr(0.12, 0.18), 0.97, 0.97, 0.96, 0);
    }
  }
  function puffFeather(pos, n) {
    if (!fMesh || !pos) return;
    n = n == null ? 2 : Math.max(0, Math.round(n));
    for (var c = 0; c < n; c++) {
      var k = -1, i, oldest = -1;
      for (i = 0; i < FE; i++) if (!fOn[i]) { k = i; break; }
      if (k < 0) { for (i = 0; i < FE; i++) if (fAge[i] > oldest) { oldest = fAge[i]; k = i; } }
      var o = k * 3;
      fOn[k] = 1; fAge[k] = 0; fLand[k] = -1; fPh[k] = Math.random() * 6.28; fRy[k] = Math.random() * 6.28; fSpin[k] = rr(-1.2, 1.2);
      fP[o] = pos.x + rr(-0.08, 0.08); fP[o + 1] = pos.y + rr(-0.04, 0.06); fP[o + 2] = pos.z + rr(-0.08, 0.08);
      fV[o] = rr(-0.3, 0.3); fV[o + 1] = rr(0.2, 0.6); fV[o + 2] = rr(-0.3, 0.3);
    }
  }

  function puffUpdate(dt, time) {
    if (!pts) return;
    var lim = pLimit(), i, o;
    if (G.renderer && G.camera) {
      G.renderer.getDrawingBufferSize(tmpV2);
      pUni.uScale.value = tmpV2.y / (2 * Math.tan(G.camera.fov * PI / 360));
    }
    var e35 = Math.exp(-3.5 * dt), e2 = Math.exp(-2 * dt), e4 = Math.exp(-4 * dt);
    for (i = 0; i < MAXP; i++) {
      o = i * 3;
      if (i >= lim) pAge[i] = pLife[i];
      if (pAge[i] >= pLife[i]) { aAlpha[i] = 0; aSize[i] = 0; continue; }
      pAge[i] += dt;
      var k = clamp(pAge[i] / pLife[i], 0, 1), kd = pKind[i], a;
      if (kd === 0) {
        pVel[o] *= e35; pVel[o + 1] = pVel[o + 1] * e35 + 0.10 * dt; pVel[o + 2] *= e35; pVel[o] += 0.03 * dt;
        a = pA0[i] * smooth(k / 0.06) * Math.pow(1 - k, 1.5);
      } else if (kd === 1) {
        pVel[o] = pVel[o] * e2 + Math.sin(time * 1.3 + pPh[i]) * 0.03 * dt; pVel[o + 1] = pVel[o + 1] * e2 + 0.015 * dt; pVel[o + 2] *= e2;
        a = pA0[i] * (0.5 + 0.5 * Math.sin(time * 9 + pPh[i] * 3)) * smooth(k / 0.05) * (1 - k);
      } else {
        pVel[o] *= e4; pVel[o + 1] *= e4; pVel[o + 2] *= e4;
        a = pA0[i] * smooth(k / 0.1) * (1 - k) * (1 - k);
      }
      pPos[o] += pVel[o] * dt; pPos[o + 1] += pVel[o + 1] * dt; pPos[o + 2] += pVel[o + 2] * dt;
      var ke = 1 - (1 - k) * (1 - k);
      aAlpha[i] = a > 0 ? a : 0; aSize[i] = pS0[i] + (pS1[i] - pS0[i]) * ke;
      if (pAge[i] >= pLife[i]) aAlpha[i] = 0;
    }
    var ga = pts.geometry.attributes;
    ga.position.needsUpdate = true; ga.aColor.needsUpdate = true; ga.aAlpha.needsUpdate = true; ga.aSize.needsUpdate = true; ga.aAdd.needsUpdate = true;

    // 羽毛
    var fe = Math.exp(-3 * dt);
    for (i = 0; i < FE; i++) {
      if (!fOn[i]) continue;
      o = i * 3; fAge[i] += dt;
      var sc = 1, sw = Math.sin(time * 2.4 + fPh[i]);
      if (fLand[i] < 0) {
        fV[o] *= fe; fV[o + 2] *= fe; fV[o + 1] = -0.13 + (fV[o + 1] + 0.13) * fe;
        fP[o] += (fV[o] + Math.cos(time * 2.4 + fPh[i]) * 0.22) * dt;
        fP[o + 1] += (fV[o + 1] - 0.05 * Math.abs(sw)) * dt;
        fP[o + 2] += (fV[o + 2] + Math.sin(time * 1.7 + fPh[i]) * 0.07) * dt;
        fRy[i] += fSpin[i] * dt;
        if (fP[o + 1] <= 0.004) { fP[o + 1] = 0.004; fLand[i] = 0; }
        fDummy.rotation.set(0.35 * Math.cos(time * 1.9 + fPh[i]), fRy[i], sw * 0.7);
      } else {
        fLand[i] += dt;
        fDummy.rotation.set(-PI / 2, 0, fRy[i]);
        if (fLand[i] > 3) sc = 1 - smooth((fLand[i] - 3) / 0.4);
        if (fLand[i] > 3.4) { fOn[i] = 0; sc = 0; }
      }
      fDummy.position.set(fP[o], fP[o + 1], fP[o + 2]);
      fDummy.scale.set(sc, sc, sc); fDummy.updateMatrix(); fMesh.setMatrixAt(i, fDummy.matrix);
    }
    fMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- 公開 ----
  function build() {
    if (built) return;
    W = G.L.futon.w; LEN = G.L.futon.len;
    prepStatic();
    buildMesh();
    pickRes = { u: 0, v: 0, point: new THREE.Vector3() };
    hitRes = { removed: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };
    if (dustSum0 === 1 && dustTotal() === 0) resetDust(1);
    buildPuff();
    built = true;
    rebuild();
    G.onUpdate(function (dt, time) { step(dt); rebuild(); puffUpdate(dt, time); });
  }

  G.futon = {
    build: build,
    setPose: function (a, b, t) {
      var ia = POSE[a], ib = b == null ? ia : POSE[b];
      if (ia == null) return; if (ib == null) ib = ia;
      poseA = ia; poseB = ib; poseT = t == null ? 1 : clamp(t, 0, 1); dirty = true;
    },
    setCarryAnchor: function (p) { if (p) { anc.x = p.x; anc.y = p.y; anc.z = p.z; dirty = true; } },
    setFluff: function (f) { fluffT = clamp(+f || 0, 0, 1); fl.t = fluffT; },
    kick: function (s) { wob.v += 3 * (s == null ? 1 : s); },
    resetDust: resetDust,
    dustLeft: function () { return clamp(dustTotal() / dustSum0, 0, 1); },
    dustiestUV: dustiestUV,
    pick: pick,
    hit: hit,
    press: function (u, v, depth) {
      var fc = clamp(fl.x, 0, 1);
      pTU = clamp(u, 0, 1); pTV = clamp(v, 0, 1);
      if (!pressOn) { pu = pTU; pv = pTV; }
      pressOn = true; prs.k = 180; prs.c = 22;
      prs.t = clamp(depth == null ? 1 : depth, 0, 1) * 0.15 * (0.3 + 0.7 * fc);
    },
    release: function () {
      var fc = clamp(fl.x, 0, 1);
      pressOn = false; prs.t = 0; prs.k = 70 - 35 * fc; prs.c = 4.2 - 1.8 * fc;
    },
    pointAt: pointAt,
    center: function (out) { out = out || new THREE.Vector3(); ensure(); return out.set(cx, cy, cz); },
    setGlow: function (g) {
      glow = clamp(g || 0, 0, 1);
      if (mat) mat.emissive.setRGB(0.25 * glow, 0.18 * glow, 0.105 * glow);
    }
  };
  Object.defineProperty(G.futon, 'fluff', { get: function () { return fluffT; }, enumerable: true });
  Object.defineProperty(G.futon, 'mesh', { get: function () { return mesh; }, enumerable: true });

  G.puff = { dust: puffDust, feather: puffFeather, air: puffAir };
})();
