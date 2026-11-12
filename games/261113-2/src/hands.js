/* hands.js — 手役: ママと子どもの写実的な手と腕（three.js r160, クラシックスクリプト）
 *
 * 作り方:
 *  - 手のひら/甲/母指球/手首は SDF（なめらか合成）を Surface Nets で一度だけメッシュ化。
 *  - 指は付け根から先へ細くなる 1 本のチューブ（丸い指先）。付け根は手のひら側の SDF の
 *    「指の根元」にわずかに内側から埋め込まれ、同じスキンウェイト関数で変形するので継ぎ目が出ない。
 *  - 全体を 1 つの SkinnedMesh（18 本の骨）にまとめ、ポーズ変更は骨の行列だけ（GPU スキニング）。
 *  - 爪・ごはん粒も同じ骨格を共有する SkinnedMesh（各 1 ドローコール）。
 *  - 前腕と袖は手首→elbow の曲線に沿ったチューブを、手首か elbow が動いた時だけ再計算。
 *  - 左手は内側の group を scale.x=-1 にした鏡像（アンカーは鏡像を打ち消すので付けた物は反転しない）。
 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var THREE = window.THREE;
  if (!THREE) return;

  var PI = Math.PI;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smin(a, b, k) { var h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  function srgb2lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function col(r, g, b) { return [srgb2lin(r), srgb2lin(g), srgb2lin(b)]; }
  function mixc(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
  var _qa = new THREE.Quaternion();
  var AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
  function qX(a) { return new THREE.Quaternion().setFromAxisAngle(AX, a); }
  function qY(a) { return new THREE.Quaternion().setFromAxisAngle(AY, a); }
  function qZ(a) { return new THREE.Quaternion().setFromAxisAngle(AZ, a); }
  function v3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }
  function quality() { return (G.quality && G.quality.tier) || 'high'; }

  /* ------------------------------------------------------------------ */
  /* 寸法（右手・手首フレーム。指は -Z、手のひら -Y、親指 -X）               */
  /* ------------------------------------------------------------------ */
  var SPECS = {
    mama: {
      cell: 0.0029,
      palmLen: 0.088, length: 0.170, width: 0.080, thick: 0.027,
      fingers: [
        { mcp: [-0.0270, 0.0030, -0.0835], fan: -0.085, fanC: -0.020, fanO: -0.30, conv: 0.03, L: [0.0335, 0.0210, 0.0172], R: [0.0086, 0.0079, 0.0072, 0.0066], km: 0.0098 },
        { mcp: [-0.0088, 0.0035, -0.0880], fan: -0.015, fanC: -0.004, fanO: -0.07, conv: -0.01, L: [0.0370, 0.0235, 0.0182], R: [0.0088, 0.0081, 0.0074, 0.0067], km: 0.0100 },
        { mcp: [0.0092, 0.0030, -0.0850], fan: 0.055, fanC: 0.012, fanO: 0.16, conv: -0.06, L: [0.0345, 0.0225, 0.0172], R: [0.0083, 0.0076, 0.0070, 0.0063], km: 0.0094 },
        { mcp: [0.0258, 0.0010, -0.0770], fan: 0.130, fanC: 0.030, fanO: 0.38, conv: -0.13, L: [0.0272, 0.0172, 0.0152], R: [0.0073, 0.0067, 0.0061, 0.0056], km: 0.0086 }
      ],
      metaBase: 0.0088, metaSy: 0.80,
      thumb: { cmc: [-0.0205, -0.0072, -0.0150], L: [0.0400, 0.0300, 0.0268], R: [0.0118, 0.0099, 0.0094, 0.0085] },
      pad: { c: [0.0020, -0.0042, -0.0500], r: [0.0290, 0.0105, 0.0360] },
      hypo: { c: [0.0250, -0.0040, -0.0420], r: [0.0105, 0.0102, 0.0300] },
      thenar: { r: [0.0150, 0.0118, 0.0240] },
      wrist: { z0: -0.024, z1: 0.020, r0: 0.0272, r1: 0.0258, sy: 0.64 },
      arm: [[0, 0.0262, 0.0167], [0.05, 0.0288, 0.0200], [0.12, 0.0322, 0.0246], [0.22, 0.0345, 0.0276], [0.40, 0.0400, 0.0330]],
      skinLen: 0.22, sleeveEase: 0.016,
      nail: { len: 0.60, white: 0.13, lift: 0.00036 },
      kPalm: 0.011, kStub: 0.0055,
      colBase: col(236, 199, 176), colPalm: col(240, 193, 178), colTip: col(229, 160, 148), colKnuck: col(214, 160, 145),
      colNail: col(240, 191, 184), colNailTip: col(250, 238, 230)
    },
    child: {
      cell: 0.0021,
      palmLen: 0.061, length: 0.115, width: 0.058, thick: 0.023,
      fingers: [
        { mcp: [-0.0198, 0.0024, -0.0575], fan: -0.090, fanC: -0.020, fanO: -0.30, conv: 0.03, L: [0.0212, 0.0134, 0.0124], R: [0.0066, 0.0063, 0.0060, 0.0057], km: 0.0071 },
        { mcp: [-0.0064, 0.0028, -0.0605], fan: -0.018, fanC: -0.004, fanO: -0.07, conv: -0.01, L: [0.0232, 0.0148, 0.0130], R: [0.0068, 0.0065, 0.0061, 0.0058], km: 0.0073 },
        { mcp: [0.0068, 0.0024, -0.0585], fan: 0.060, fanC: 0.012, fanO: 0.17, conv: -0.06, L: [0.0218, 0.0140, 0.0124], R: [0.0064, 0.0061, 0.0058, 0.0055], km: 0.0069 },
        { mcp: [0.0192, 0.0008, -0.0532], fan: 0.140, fanC: 0.030, fanO: 0.38, conv: -0.13, L: [0.0168, 0.0110, 0.0108], R: [0.0057, 0.0054, 0.0051, 0.0048], km: 0.0062 }
      ],
      metaBase: 0.0070, metaSy: 0.88,
      thumb: { cmc: [-0.0142, -0.0056, -0.0105], L: [0.0265, 0.0195, 0.0182], R: [0.0090, 0.0078, 0.0074, 0.0068] },
      pad: { c: [0.0015, -0.0038, -0.0345], r: [0.0215, 0.0092, 0.0255] },
      hypo: { c: [0.0178, -0.0034, -0.0290], r: [0.0086, 0.0090, 0.0210] },
      thenar: { r: [0.0112, 0.0095, 0.0170] },
      wrist: { z0: -0.017, z1: 0.016, r0: 0.0208, r1: 0.0200, sy: 0.68 },
      arm: [[0, 0.0203, 0.0137], [0.04, 0.0216, 0.0156], [0.10, 0.0240, 0.0184], [0.16, 0.0254, 0.0200], [0.32, 0.0290, 0.0240]],
      skinLen: 0.16, sleeveEase: 0.011,
      nail: { len: 0.52, white: 0.04, lift: 0.00026 },
      kPalm: 0.0085, kStub: 0.0045,
      colBase: col(242, 204, 183), colPalm: col(246, 196, 185), colTip: col(238, 160, 152), colKnuck: col(230, 168, 156),
      colNail: col(243, 196, 190), colNailTip: col(250, 236, 230)
    }
  };

  /* ------------------------------------------------------------------ */
  /* ポーズ                                                              */
  /* ------------------------------------------------------------------ */
  var POSES = {
    relaxed: { curl: [0.17, 0.21, 0.25, 0.30], spread: 0.0, thumbOut: 0.32, thumbCurl: 0.15, thumbOpp: 0.18, arch: 0.15 },
    flat: { curl: [0.01, 0.01, 0.02, 0.03], spread: 0.15, thumbOut: 0.45, thumbCurl: 0.0, thumbOpp: 0.0, arch: 0.0 },
    wall: { curl: [0.035, 0.04, 0.05, 0.06], spread: -0.95, thumbOut: 0.0, thumbCurl: 0.10, thumbOpp: 0.0, arch: 0.05 },
    cup: { curl: [0.40, 0.42, 0.44, 0.46], spread: -0.80, thumbOut: 0.10, thumbCurl: 0.30, thumbOpp: 0.10, arch: 0.55 },
    point: { curl: [0.0, 0.94, 0.97, 0.98], spread: -0.2, thumbOut: 0.30, thumbCurl: 0.55, thumbOpp: 0.70, arch: 0.35 },
    pinch: { curl: [0.40, 0.42, 0.47, 0.52], spread: -0.2, thumbOut: 0.42, thumbCurl: 0.32, thumbOpp: 0.78, arch: 0.30 },
    grip: { curl: [0.72, 0.75, 0.78, 0.80], spread: -0.6, thumbOut: 0.25, thumbCurl: 0.45, thumbOpp: 0.55, arch: 0.45 },
    hold: { curl: [0.36, 0.38, 0.41, 0.45], spread: 0.35, thumbOut: 0.62, thumbCurl: 0.22, thumbOpp: 0.50, arch: 0.40 },
    open: { curl: [0.0, 0.0, 0.0, 0.02], spread: 1.0, thumbOut: 1.0, thumbCurl: 0.0, thumbOpp: 0.0, arch: 0.0 },
    fist: { curl: [1, 1, 1, 1], spread: -0.5, thumbOut: 0.22, thumbCurl: 0.85, thumbOpp: 0.70, arch: 0.6 }
  };
  var BIND_POSE = { curl: [0, 0, 0, 0], spread: 0, thumbOut: 0.32, thumbCurl: 0, thumbOpp: 0.18, arch: 0 };

  function normPose(p) {
    if (typeof p === 'string') p = POSES[p] || POSES.relaxed;
    p = p || POSES.relaxed;
    var c = p.curl || [0, 0, 0, 0];
    if (typeof c === 'number') c = [c, c, c, c];
    return {
      curl: [c[0] || 0, c[1] || 0, c[2] || 0, c[3] || 0],
      spread: p.spread || 0,
      thumbOut: p.thumbOut != null ? p.thumbOut : 0.3,
      thumbCurl: p.thumbCurl || 0,
      thumbOpp: p.thumbOpp != null ? p.thumbOpp : 0.15,
      arch: p.arch || 0
    };
  }
  function lerpPose(a, b, t, out) {
    out = out || { curl: [0, 0, 0, 0] };
    for (var i = 0; i < 4; i++) out.curl[i] = mix(a.curl[i], b.curl[i], t);
    out.spread = mix(a.spread, b.spread, t);
    out.thumbOut = mix(a.thumbOut, b.thumbOut, t);
    out.thumbCurl = mix(a.thumbCurl, b.thumbCurl, t);
    out.thumbOpp = mix(a.thumbOpp, b.thumbOpp, t);
    out.arch = mix(a.arch, b.arch, t);
    return out;
  }
  function copyPose(p) { return lerpPose(p, p, 0); }

  /* ------------------------------------------------------------------ */
  /* 骨格（FK）                                                           */
  /* 0 palm, 1 meta4, 2 meta5, 3..14 指(人,中,薬,小 × 基節,中節,末節),     */
  /* 15 親指中手, 16 親指基節, 17 親指末節                                 */
  /* ------------------------------------------------------------------ */
  var NB = 18;
  function fingerBone(f, seg) { return 3 + f * 3 + seg; }

  function fk(spec, pose, mats) {
    var m, i;
    mats[0].identity();
    var arch = pose.arch;
    var parentDelta = [];
    // ring / pinky metacarpals (palm arch)
    var metaQ = [null, null, qX(-0.07 * arch).multiply(qZ(-0.05 * arch)), qX(-0.16 * arch).multiply(qZ(-0.13 * arch))];
    for (i = 2; i < 4; i++) {
      var W = metaBaseOf(spec, i);
      mats[i - 1].compose(v3(W), metaQ[i], new THREE.Vector3(1, 1, 1));
    }
    var sp = pose.spread;
    for (var f = 0; f < 4; f++) {
      var F = spec.fingers[f];
      var c = clamp(pose.curl[f], 0, 1.05);
      var fan = sp < 0 ? mix(F.fan, F.fanC, -sp) : mix(F.fan, F.fanO, sp);
      fan += F.conv * c;
      var parent = f < 2 ? null : mats[f - 1];
      var pos = v3(F.mcp), q = new THREE.Quaternion();
      if (parent) {
        // MCP rides on the metacarpal: rotate around its base
        var W2 = v3(metaBaseOf(spec, f));
        pos.sub(W2).applyQuaternion(metaQ[f]).add(W2);
        q.copy(metaQ[f]);
      }
      q.multiply(qY(-fan));
      var a1 = c * 1.50, a2 = c * 1.72, a3 = c * 1.10;
      var q1 = q.clone().multiply(qX(-a1));
      mats[fingerBone(f, 0)].compose(pos, q1, new THREE.Vector3(1, 1, 1));
      var p2 = new THREE.Vector3(0, 0, -F.L[0]).applyQuaternion(q1).add(pos);
      var q2 = q1.clone().multiply(qX(-a2));
      mats[fingerBone(f, 1)].compose(p2, q2, new THREE.Vector3(1, 1, 1));
      var p3 = new THREE.Vector3(0, 0, -F.L[1]).applyQuaternion(q2).add(p2);
      var q3 = q2.clone().multiply(qX(-a3));
      mats[fingerBone(f, 2)].compose(p3, q3, new THREE.Vector3(1, 1, 1));
    }
    // thumb
    var T = spec.thumb;
    var tq = thumbMetaQ(pose);
    var C = v3(T.cmc);
    mats[15].compose(C, tq, new THREE.Vector3(1, 1, 1));
    var tc = clamp(pose.thumbCurl, 0, 1);
    var pm = new THREE.Vector3(0, 0, -T.L[0]).applyQuaternion(tq).add(C);
    var tq2 = tq.clone().multiply(qX(-tc * 0.80));
    mats[16].compose(pm, tq2, new THREE.Vector3(1, 1, 1));
    var pi = new THREE.Vector3(0, 0, -T.L[1]).applyQuaternion(tq2).add(pm);
    var tq3 = tq2.clone().multiply(qX(-tc * 1.20));
    mats[17].compose(pi, tq3, new THREE.Vector3(1, 1, 1));
    return mats;
  }
  function thumbMetaQ(pose) {
    var o = clamp(pose.thumbOut, 0, 1), op = clamp(pose.thumbOpp, 0, 1);
    var rho = mix(0.17, 1.05, o) - 0.10 * op;      // 手のひらの面内で人差し指から離れる角
    var pal = mix(0.10, 0.80, op) + 0.12 * o;       // 手のひら側へ倒れる角
    var roll = 1.18 + 0.60 * op;                     // 長軸まわり（爪が外を向く→指と向き合う）
    return qY(rho).multiply(qX(-pal)).multiply(qZ(roll));
  }
  function metaBaseOf(spec, f) {
    var m = spec.fingers[f].mcp;
    return [m[0] * 0.45, 0.001, -spec.palmLen * 0.13];
  }
  function makeMats() { var a = []; for (var i = 0; i < NB; i++) a.push(new THREE.Matrix4()); return a; }

  /* ------------------------------------------------------------------ */
  /* SDF プリミティブ                                                      */
  /* ------------------------------------------------------------------ */
  function basisFromQ(q) {
    return {
      x: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      y: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      z: new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    };
  }
  // round cone along local -Z from o (radius r1) to o-Z*L (radius r2), flattened in local y by sy
  function RCone(o, q, L, r1, r2, sy) {
    var b = basisFromQ(q);
    var l2 = L * L, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    var ox = o.x, oy = o.y, oz = o.z;
    var X = b.x, Y = b.y, Z = b.z;
    var isy = 1 / sy, ms = Math.min(1, sy);
    var srr = rr > 0 ? 1 : rr < 0 ? -1 : 0;
    this.d = function (px, py, pz) {
      var dx = px - ox, dy = py - oy, dz = pz - oz;
      var lx = dx * X.x + dy * X.y + dz * X.z;
      var ly = (dx * Y.x + dy * Y.y + dz * Y.z) * isy;
      var lz = dx * Z.x + dy * Z.y + dz * Z.z;
      var y = -lz * L;               // dot(pa, ba)
      var z = y - l2;
      var x2 = (lx * lx + ly * ly) * l2 * l2;
      var y2 = y * y * l2, z2 = z * z * l2;
      var k = srr * rr * rr * x2;
      var d;
      if ((z > 0 ? 1 : -1) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - r2;
      else if ((y > 0 ? 1 : y < 0 ? -1 : 0) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - r1;
      else d = (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
      return d * ms;
    };
    this.lo = [ox - L - r1, oy - L - r1, oz - L - r1];
    var e = new THREE.Vector3(0, 0, -L).applyQuaternion(q).add(o);
    this.box = [Math.min(ox, e.x) - r1, Math.min(oy, e.y) - r1, Math.min(oz, e.z) - r1, Math.max(ox, e.x) + r1, Math.max(oy, e.y) + r1, Math.max(oz, e.z) + r1];
  }
  function Ellip(c, q, r) {
    var b = basisFromQ(q || new THREE.Quaternion());
    var X = b.x, Y = b.y, Z = b.z, cx = c[0], cy = c[1], cz = c[2];
    var rx = r[0], ry = r[1], rz = r[2];
    this.d = function (px, py, pz) {
      var dx = px - cx, dy = py - cy, dz = pz - cz;
      var lx = dx * X.x + dy * X.y + dz * X.z;
      var ly = dx * Y.x + dy * Y.y + dz * Y.z;
      var lz = dx * Z.x + dy * Z.y + dz * Z.z;
      var ax = lx / rx, ay = ly / ry, az = lz / rz;
      var k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      var bx = ax / rx, by = ay / ry, bz = az / rz;
      var k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      if (k1 < 1e-9) return -Math.min(rx, ry, rz);
      return k0 * (k0 - 1) / k1;
    };
    var m = Math.max(rx, ry, rz);
    this.box = [cx - m, cy - m, cz - m, cx + m, cy + m, cz + m];
  }

  /* ------------------------------------------------------------------ */
  /* Surface Nets                                                        */
  /* ------------------------------------------------------------------ */
  function surfaceNets(sdf, box, h) {
    var x0 = box[0], y0 = box[1], z0 = box[2];
    var nx = Math.ceil((box[3] - x0) / h) + 1, ny = Math.ceil((box[4] - y0) / h) + 1, nz = Math.ceil((box[5] - z0) / h) + 1;
    var N = nx * ny * nz, vals = new Float32Array(N);
    var i, j, k, idx = 0;
    for (k = 0; k < nz; k++) for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) vals[idx++] = sdf(x0 + i * h, y0 + j * h, z0 + k * h);
    var cellV = new Int32Array(N).fill(-1);
    var pos = [];
    var cx = [0, 1, 0, 1, 0, 1, 0, 1], cy = [0, 0, 1, 1, 0, 0, 1, 1], cz = [0, 0, 0, 0, 1, 1, 1, 1];
    var edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    var cv = new Float32Array(8);
    function gid(i, j, k) { return i + nx * (j + ny * k); }
    for (k = 0; k < nz - 1; k++) for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
      var mask = 0;
      for (var c = 0; c < 8; c++) { cv[c] = vals[gid(i + cx[c], j + cy[c], k + cz[c])]; if (cv[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      var sx = 0, sy = 0, sz = 0, cnt = 0;
      for (var e = 0; e < 12; e++) {
        var a = edges[e][0], b = edges[e][1];
        if ((cv[a] < 0) === (cv[b] < 0)) continue;
        var t = cv[a] / (cv[a] - cv[b]);
        sx += cx[a] + (cx[b] - cx[a]) * t; sy += cy[a] + (cy[b] - cy[a]) * t; sz += cz[a] + (cz[b] - cz[a]) * t; cnt++;
      }
      cellV[gid(i, j, k)] = pos.length / 3;
      pos.push(x0 + (i + sx / cnt) * h, y0 + (j + sy / cnt) * h, z0 + (k + sz / cnt) * h);
    }
    var idxs = [];
    function quad(a, b, c, d, flip) {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) { var t = b; b = d; d = t; }
      idxs.push(a, b, c, a, c, d);
    }
    for (k = 0; k < nz; k++) for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var v0 = vals[gid(i, j, k)] < 0;
      if (i < nx - 1 && j > 0 && k > 0 && (vals[gid(i + 1, j, k)] < 0) !== v0)
        quad(cellV[gid(i, j - 1, k - 1)], cellV[gid(i, j, k - 1)], cellV[gid(i, j, k)], cellV[gid(i, j - 1, k)], !v0);
      if (j < ny - 1 && i > 0 && k > 0 && (vals[gid(i, j + 1, k)] < 0) !== v0)
        quad(cellV[gid(i - 1, j, k - 1)], cellV[gid(i - 1, j, k)], cellV[gid(i, j, k)], cellV[gid(i, j, k - 1)], !v0);
      if (k < nz - 1 && i > 0 && j > 0 && (vals[gid(i, j, k + 1)] < 0) !== v0)
        quad(cellV[gid(i - 1, j - 1, k)], cellV[gid(i, j - 1, k)], cellV[gid(i, j, k)], cellV[gid(i - 1, j, k)], !v0);
    }
    // project to surface, gradient normals
    var nv = pos.length / 3, nor = new Float32Array(nv * 3), P = new Float32Array(pos);
    var eps = h * 0.25;
    function grad(x, y, z, out) {
      out[0] = sdf(x + eps, y, z) - sdf(x - eps, y, z);
      out[1] = sdf(x, y + eps, z) - sdf(x, y - eps, z);
      out[2] = sdf(x, y, z + eps) - sdf(x, y, z - eps);
      var l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]) || 1;
      out[0] /= l; out[1] /= l; out[2] /= l;
    }
    var g = [0, 0, 0];
    for (var v = 0; v < nv; v++) {
      var x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      for (var it = 0; it < 3; it++) {
        var d = sdf(x, y, z); grad(x, y, z, g);
        d = clamp(d, -h * 0.5, h * 0.5);
        x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
      }
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
      grad(x, y, z, g);
      nor[v * 3] = g[0]; nor[v * 3 + 1] = g[1]; nor[v * 3 + 2] = g[2];
    }
    // choose the shorter diagonal + fix winding against gradient normal
    var out = [];
    function dist2(a, b) { var dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz; }
    function tri(a, b, c) {
      var ax = P[b * 3] - P[a * 3], ay = P[b * 3 + 1] - P[a * 3 + 1], az = P[b * 3 + 2] - P[a * 3 + 2];
      var bx = P[c * 3] - P[a * 3], by = P[c * 3 + 1] - P[a * 3 + 1], bz = P[c * 3 + 2] - P[a * 3 + 2];
      var fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      var nx2 = nor[a * 3] + nor[b * 3] + nor[c * 3], ny2 = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nz2 = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
      if (fx * nx2 + fy * ny2 + fz * nz2 < 0) out.push(a, c, b); else out.push(a, b, c);
    }
    for (var q = 0; q < idxs.length; q += 6) {
      var A = idxs[q], B = idxs[q + 1], C = idxs[q + 2], D = idxs[q + 5];
      if (dist2(A, C) <= dist2(B, D)) { tri(A, B, C); tri(A, C, D); }
      else { tri(A, B, D); tri(B, C, D); }
    }
    return { pos: P, nor: nor, idx: out };
  }

  /* ------------------------------------------------------------------ */
  /* 指チューブ（バインド姿勢ではまっすぐ）                                  */
  /* ------------------------------------------------------------------ */
  // profile: joints s=[0, L1, L1+L2, ...], radii at those + tip radius; end E
  function makeProfile(Ls, Rs) {
    var J = [0], s = 0;
    for (var i = 0; i < Ls.length - 1; i++) { s += Ls[i]; J.push(s); }
    var E = s + Ls[Ls.length - 1];
    var Rt = Rs[Rs.length - 1];
    var capStart = E - Rt * 1.05;
    var pts = J.slice(), rad = Rs.slice(0, J.length);
    pts.push(capStart); rad.push(Rt);
    return {
      J: J, E: E, Rt: Rt, capStart: capStart,
      r: function (x) {
        if (x <= 0) return rad[0] * (1 + Math.max(x, -0.02) * 6);
        if (x >= capStart) return Rt;
        for (var i = 0; i < pts.length - 1; i++) {
          if (x <= pts[i + 1]) {
            var t = (x - pts[i]) / (pts[i + 1] - pts[i]);
            var c = 0.5 - 0.5 * Math.cos(t * PI);      // 節で少し太く、中ほどで少し細い
            var base = mix(rad[i], rad[i + 1], c);
            var waist = Math.sin(t * PI) * 0.035 * (i > 0 ? 1 : 0.4);
            return base * (1 - waist);
          }
        }
        return Rt;
      }
    };
  }
  // surface point of a finger tube in finger-local coords (axis -Z, dorsal +Y)
  function tubePoint(prof, s, phi, sy, out) {
    var r = prof.r(s), cy = 0, k = 0;
    if (s > prof.capStart) {
      k = clamp((s - prof.capStart) / (prof.E - prof.capStart), 0, 1);
      r *= Math.sqrt(Math.max(0, 1 - k * k));
      cy = prof.Rt * 0.22 * k * k;  // 指先は甲側が平らで腹側が丸い
    }
    var c = Math.cos(phi), sn = Math.sin(phi);
    var b = sn > 0 ? sy : sy * (1 + 0.10 * sstep(prof.J[prof.J.length - 1], prof.E, s)); // 指の腹のふくらみ
    out[0] = r * c;
    out[1] = cy + r * b * sn;
    out[2] = -s;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* モデル（who ごとに一度だけ生成）                                       */
  /* ------------------------------------------------------------------ */
  var MODELS = {};
  function getModel(who) {
    if (MODELS[who]) return MODELS[who];
    var spec = SPECS[who];
    var bindMats = fk(spec, normPose(BIND_POSE), makeMats());
    var bindInv = bindMats.map(function (m) { return m.clone().invert(); });
    var FSY = 0.90; // 指の断面のつぶれ
    var i, f;

    // --- chains for skin weights ---
    var chains = [];
    function mp(m) { return new THREE.Vector3().setFromMatrixPosition(m); }
    for (f = 0; f < 4; f++) {
      var F = spec.fingers[f];
      var tipM = bindMats[fingerBone(f, 2)];
      var tip = new THREE.Vector3(0, 0, -F.L[2]).applyMatrix4(tipM);
      var w = spec.palmLen / 0.088;
      chains.push({
        pts: [v3(metaBaseOf(spec, f)), mp(bindMats[fingerBone(f, 0)]), mp(bindMats[fingerBone(f, 1)]), mp(bindMats[fingerBone(f, 2)]), tip],
        bones: [f < 2 ? 0 : f - 1, fingerBone(f, 0), fingerBone(f, 1), fingerBone(f, 2)],
        widths: [0.0105 * w, 0.0058 * w, 0.0048 * w],
        shift: [0.0015 * w, 0, 0],
        web: [0.002 * w, 0.015 * w], webJ: 1,
        prof: makeProfile(F.L, F.R), finger: f
      });
    }
    var T = spec.thumb, sc = spec.palmLen / 0.088;
    var tipT = new THREE.Vector3(0, 0, -T.L[2]).applyMatrix4(bindMats[17]);
    chains.push({
      pts: [new THREE.Vector3(-0.006 * sc, -0.002 * sc, 0.006 * sc), mp(bindMats[15]), mp(bindMats[16]), mp(bindMats[17]), tipT],
      bones: [0, 15, 16, 17],
      widths: [0.017 * sc, 0.0085 * sc, 0.0058 * sc],
      shift: [0.004 * sc, 0.001 * sc, 0],
      web: [-0.004 * sc, 0.009 * sc], webJ: 2,
      prof: makeProfile([T.L[1], T.L[2]], [T.R[1], T.R[2], T.R[3]]), finger: 4
    });
    chains.forEach(function (ch) {
      ch.cum = [0];
      for (var k = 0; k < 4; k++) ch.cum.push(ch.cum[k] + ch.pts[k].distanceTo(ch.pts[k + 1]));
    });
    var tauSoft = 0.0045 * sc, tauHard = 0.00012;

    function chainInfo(p) {
      var best = [];
      for (var c = 0; c < chains.length; c++) {
        var ch = chains[c], bd = 1e9, bs = 0;
        for (var k = 0; k < 4; k++) {
          var a = ch.pts[k], b = ch.pts[k + 1];
          var abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
          var l2 = abx * abx + aby * aby + abz * abz;
          var t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2;
          var tt = clamp(t, 0, 1);
          if (k === 0 && t < 0) tt = 0;
          var qx = a.x + abx * tt - p.x, qy = a.y + aby * tt - p.y, qz = a.z + abz * tt - p.z;
          var d = Math.sqrt(qx * qx + qy * qy + qz * qz);
          if (d < bd) { bd = d; bs = ch.cum[k] + tt * Math.sqrt(l2); }
        }
        best.push({ r: bd, s: bs });
      }
      return best;
    }
    function segW(ch, s) {
      var J1 = ch.cum[1] + ch.shift[0], J2 = ch.cum[2] + ch.shift[1], J3 = ch.cum[3] + ch.shift[2];
      var t1 = sstep(J1 - ch.widths[0], J1 + ch.widths[0], s);
      var t2 = sstep(J2 - ch.widths[1], J2 + ch.widths[1], s);
      var t3 = sstep(J3 - ch.widths[2], J3 + ch.widths[2], s);
      return [1 - t1, t1 - t2, t2 - t3, t3];
    }
    // returns {bw: Float32Array(NB), main chain index, s}
    function weightsAt(p, forceChain) {
      var info = chainInfo(p);
      var cmin = 0;
      for (var c = 1; c < info.length; c++) if (info[c].r < info[cmin].r) cmin = c;
      if (forceChain != null) cmin = forceChain;
      var chm = chains[cmin];
      var sOwn = info[cmin].s - chm.cum[chm.webJ];
      var web = 1 - sstep(chm.web[0], chm.web[1], sOwn);
      var tau = mix(tauHard, tauSoft, web);
      var rmin = info[cmin].r;
      var bw = new Float32Array(NB), msum = 0, ms = [];
      for (c = 0; c < info.length; c++) {
        var m = c === cmin ? 1 : Math.exp(-Math.max(0, info[c].r - rmin) / tau);
        if (forceChain != null && c !== cmin && web < 0.01) m = 0;
        ms.push(m); msum += m;
      }
      for (c = 0; c < info.length; c++) {
        if (ms[c] < 1e-4) continue;
        var sw = segW(chains[c], info[c].s), bb = chains[c].bones;
        for (var k = 0; k < 4; k++) bw[bb[k]] += sw[k] * ms[c] / msum;
      }
      return { bw: bw, chain: cmin, s: info[cmin].s, r: rmin, info: info };
    }

    // --- palm SDF ---
    var core = [], thumbParts = [], stubs = [];
    for (f = 0; f < 4; f++) {
      var F2 = spec.fingers[f];
      var W = v3(metaBaseOf(spec, f)), M = v3(F2.mcp);
      var dir = M.clone().sub(W), L = dir.length(); dir.normalize();
      var qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      core.push(new RCone(W, qq, L, spec.metaBase, F2.km, spec.metaSy));
      var bq = new THREE.Quaternion().setFromRotationMatrix(bindMats[fingerBone(f, 0)]);
      var stubLen = F2.L[0] * 0.30;
      var pr = chains[f].prof;
      stubs.push(new RCone(M, bq, stubLen, pr.r(0) - 0.00055, pr.r(stubLen) - 0.00055, FSY));
    }
    core.push(new Ellip(spec.pad.c, null, spec.pad.r));
    core.push(new Ellip(spec.hypo.c, null, spec.hypo.r));
    var Wr = spec.wrist;
    core.push(new RCone(new THREE.Vector3(0, 0, Wr.z1), new THREE.Quaternion(), Wr.z1 - Wr.z0, Wr.r1, Wr.r0, Wr.sy));
    // thumb metacarpal + thenar
    var tqB = new THREE.Quaternion().setFromRotationMatrix(bindMats[15]);
    var Cp = v3(T.cmc);
    thumbParts.push(new RCone(Cp, tqB, T.L[0], T.R[0], T.R[1] + 0.0004, 0.92));
    var tb = basisFromQ(tqB);
    var thc = Cp.clone().addScaledVector(tb.z, -T.L[0] * 0.42).add(new THREE.Vector3(0.0055 * sc, -0.0038 * sc, 0.002 * sc));
    thumbParts.push(new Ellip([thc.x, thc.y, thc.z], tqB, [spec.thenar.r[0], spec.thenar.r[1], spec.thenar.r[2]]));
    var tStubLen = T.L[1] * 0.30, tpr = chains[4].prof;
    var tqP = new THREE.Quaternion().setFromRotationMatrix(bindMats[16]);
    stubs.push(new RCone(mp(bindMats[16]), tqP, tStubLen, tpr.r(0) - 0.00055, tpr.r(tStubLen) - 0.00055, FSY));
    var kP = spec.kPalm, kS = spec.kStub;
    function sdfPalm(x, y, z) {
      var d = core[0].d(x, y, z);
      for (var i = 1; i < core.length; i++) d = smin(d, core[i].d(x, y, z), i >= 4 ? kP * 1.2 : kP);
      var dt = smin(thumbParts[0].d(x, y, z), thumbParts[1].d(x, y, z), kP * 0.8);
      d = smin(d, dt, kP * 1.1);
      var r = d;
      for (i = 0; i < stubs.length; i++) r = Math.min(r, smin(d, stubs[i].d(x, y, z), kS));
      return r;
    }
    var box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    core.concat(thumbParts, stubs).forEach(function (p) {
      for (var k = 0; k < 3; k++) { box[k] = Math.min(box[k], p.box[k]); box[k + 3] = Math.max(box[k + 3], p.box[k + 3]); }
    });
    var h = spec.cell;
    for (i = 0; i < 3; i++) { box[i] -= h * 2; box[i + 3] += h * 2; }
    var sn = surfaceNets(sdfPalm, box, h);

    // --- assemble geometry arrays ---
    var P = [], Nn = [], IDX = [], VCH = []; // VCH: forced chain (-1 = none)
    for (i = 0; i < sn.pos.length; i++) { P.push(sn.pos[i]); Nn.push(sn.nor[i]); }
    for (i = 0; i < sn.pos.length / 3; i++) VCH.push(-1);
    for (i = 0; i < sn.idx.length; i++) IDX.push(sn.idx[i]);
    var nRad = quality() === 'low' ? 14 : 18;
    var tubeInfo = [];
    function addTube(ch, boneM) {
      var prof = ch.prof, base = P.length / 3;
      var ss = [];
      var s0 = -0.0035 * sc, step = 0.0024 * sc;
      for (var s = s0; s < prof.capStart; s += step) ss.push(s);
      ss.push(prof.capStart);
      var nCap = 6;
      for (var c = 1; c < nCap; c++) ss.push(prof.capStart + (prof.E - prof.capStart) * Math.sin(c / nCap * PI / 2));
      var tmp = [0, 0, 0], t1 = [0, 0, 0], t2 = [0, 0, 0], t3 = [0, 0, 0], t4 = [0, 0, 0];
      var v = new THREE.Vector3(), nrm = new THREE.Vector3(), da = new THREE.Vector3(), db = new THREE.Vector3();
      var rotM = new THREE.Matrix3().setFromMatrix4(boneM);
      for (var a = 0; a < ss.length; a++) {
        for (var b = 0; b < nRad; b++) {
          var phi = b / nRad * PI * 2;
          tubePoint(prof, ss[a], phi, FSY, tmp);
          v.set(tmp[0], tmp[1], tmp[2]).applyMatrix4(boneM);
          P.push(v.x, v.y, v.z);
          var e = 1e-4, ep = 0.02;
          tubePoint(prof, ss[a] + e, phi, FSY, t1); tubePoint(prof, ss[a] - e, phi, FSY, t2);
          tubePoint(prof, ss[a], phi + ep, FSY, t3); tubePoint(prof, ss[a], phi - ep, FSY, t4);
          da.set(t1[0] - t2[0], t1[1] - t2[1], t1[2] - t2[2]);
          db.set(t3[0] - t4[0], t3[1] - t4[1], t3[2] - t4[2]);
          nrm.crossVectors(da, db).normalize().negate();
          // local axis -Z = +s : da ~ -Z ; outward = cross(Ps,Pphi) with Ps = -da? keep sign check below
          if (nrm.x * tmp[0] + nrm.y * (tmp[1]) < 0 && ss[a] < prof.capStart) nrm.negate();
          nrm.applyMatrix3(rotM).normalize();
          Nn.push(nrm.x, nrm.y, nrm.z);
          VCH.push(ch.finger);
        }
      }
      // pole
      tubePoint(prof, prof.E, 0, FSY, tmp);
      tmp[1] = prof.Rt * 0.22;
      v.set(tmp[0], tmp[1], tmp[2]).applyMatrix4(boneM);
      var pole = P.length / 3;
      P.push(v.x, v.y, v.z);
      nrm.set(0, 0.15, -1).normalize().applyMatrix3(rotM).normalize();
      Nn.push(nrm.x, nrm.y, nrm.z); VCH.push(ch.finger);
      for (a = 0; a < ss.length - 1; a++) for (b = 0; b < nRad; b++) {
        var b1 = (b + 1) % nRad;
        var A = base + a * nRad + b, B = base + (a + 1) * nRad + b, C = base + a * nRad + b1, D = base + (a + 1) * nRad + b1;
        IDX.push(A, C, B, B, C, D);
      }
      var last = base + (ss.length - 1) * nRad;
      for (b = 0; b < nRad; b++) IDX.push(last + b, last + (b + 1) % nRad, pole);
      tubeInfo.push({ base: base, rings: ss.length, ss: ss });
    }
    for (f = 0; f < 4; f++) addTube(chains[f], bindMats[fingerBone(f, 0)]);
    addTube(chains[4], bindMats[16]);
    // fix winding of tubes against normals (robust)
    (function () {
      for (var t = sn.idx.length; t < IDX.length; t += 3) {
        var a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
        var ax = P[b * 3] - P[a * 3], ay = P[b * 3 + 1] - P[a * 3 + 1], az = P[b * 3 + 2] - P[a * 3 + 2];
        var bx = P[c * 3] - P[a * 3], by = P[c * 3 + 1] - P[a * 3 + 1], bz = P[c * 3 + 2] - P[a * 3 + 2];
        var fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
        var nx = Nn[a * 3] + Nn[b * 3] + Nn[c * 3], ny = Nn[a * 3 + 1] + Nn[b * 3 + 1] + Nn[c * 3 + 1], nz = Nn[a * 3 + 2] + Nn[b * 3 + 2] + Nn[c * 3 + 2];
        if (fx * nx + fy * ny + fz * nz < 0) { IDX[t + 1] = c; IDX[t + 2] = b; }
      }
    })();

    // --- weights, colors, tip mask ---
    var nv = P.length / 3;
    var skinI = new Uint16Array(nv * 4), skinW = new Float32Array(nv * 4);
    var COL = new Float32Array(nv * 3), TIP = new Float32Array(nv);
    var pv = new THREE.Vector3(), nl = new THREE.Vector3(), lp = new THREE.Vector3();
    var rot3 = bindInv.map(function (m) { return new THREE.Matrix3().setFromMatrix4(m); });
    for (i = 0; i < nv; i++) {
      pv.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      var W8 = weightsAt(pv, VCH[i] >= 0 ? VCH[i] : null);
      var bw = W8.bw;
      // top 4
      var top = [];
      for (var b = 0; b < NB; b++) if (bw[b] > 1e-4) top.push([b, bw[b]]);
      top.sort(function (x, y) { return y[1] - x[1]; });
      top = top.slice(0, 4);
      var tsum = 0; top.forEach(function (t) { tsum += t[1]; });
      for (var k = 0; k < 4; k++) {
        skinI[i * 4 + k] = top[k] ? top[k][0] : 0;
        skinW[i * 4 + k] = top[k] ? top[k][1] / tsum : 0;
      }
      // dominant bone local normal for palmar/dorsal
      var db = top[0][0];
      nl.set(Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]).applyMatrix3(rot3[db]).normalize();
      var ch = chains[W8.chain], s = W8.s;
      var palmar = sstep(0.15, -0.7, nl.y);
      var dorsal = sstep(0.1, 0.8, nl.y);
      var c0 = mixc(spec.colBase, spec.colPalm, palmar * 0.85);
      var E = ch.cum[4];
      var jStart = ch.cum[ch.webJ];
      var fing = sstep(jStart - 0.004 * sc, jStart + 0.012 * sc, s);
      var tip = sstep(E - (E - ch.cum[3]) * 0.95, E - 0.002 * sc, s) * fing;
      c0 = mixc(c0, spec.colTip, tip * (0.42 + 0.18 * palmar));
      // knuckles (dorsal) + joint creases
      var kn = 0;
      for (k = 1; k <= 3; k++) {
        var J = ch.cum[k], wj = (k === 1 ? 0.007 : 0.0035) * sc;
        var gk = Math.exp(-Math.pow((s - J) / wj, 2));
        if (ch.finger === 4 && k === 1) gk *= 0.3;
        kn += gk * (k === 1 ? 0.30 : 0.42);
      }
      c0 = mixc(c0, spec.colKnuck, clamp(kn, 0, 0.6) * (0.25 + 0.75 * dorsal));
      // fingers in general are slightly rosier than the back of the hand
      c0 = mixc(c0, spec.colTip, fing * 0.10);
      // thenar / palm center a touch pinker
      if (palmar > 0.3) c0 = mixc(c0, spec.colTip, 0.06 * palmar);
      COL[i * 3] = c0[0]; COL[i * 3 + 1] = c0[1]; COL[i * 3 + 2] = c0[2];
      TIP[i] = sstep(E - (E - ch.cum[3]) * 1.8, E - (E - ch.cum[3]) * 0.4, s) * fing;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(COL, 3));
    geo.setAttribute('aTip', new THREE.BufferAttribute(TIP, 1));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
    geo.setIndex(IDX);
    geo.computeBoundingSphere();

    // --- nails (rigid on distal bones) ---
    var nailGeo = buildNails(spec, chains, bindMats, FSY);

    // --- grain slots & glow points (bone, bone-local position, normal) ---
    function surfOnFinger(fi, segFrac, phiDeg) {
      var ch = chains[fi], prof = ch.prof;
      var seg = clamp(Math.floor(segFrac), 0, fi === 4 ? 1 : 2), frac = segFrac - Math.floor(segFrac);
      var bindM = fi === 4 ? bindMats[16] : bindMats[fingerBone(fi, 0)];
      var s = prof.J[seg] + ((seg + 1 < prof.J.length ? prof.J[seg + 1] : prof.E) - prof.J[seg]) * frac;
      var tmp = [0, 0, 0], tmp2 = [0, 0, 0], tmp3 = [0, 0, 0];
      var ph = phiDeg * PI / 180;
      tubePoint(prof, s, ph, FSY, tmp);
      tubePoint(prof, s, ph + 0.03, FSY, tmp2); tubePoint(prof, s + 0.0003, ph, FSY, tmp3);
      var p = new THREE.Vector3(tmp[0], tmp[1], tmp[2]);
      var tA = new THREE.Vector3(tmp2[0] - tmp[0], tmp2[1] - tmp[1], tmp2[2] - tmp[2]);
      var tB = new THREE.Vector3(tmp3[0] - tmp[0], tmp3[1] - tmp[1], tmp3[2] - tmp[2]);
      var n = new THREE.Vector3().crossVectors(tB, tA).normalize();
      if (n.x * tmp[0] + n.y * tmp[1] < 0) n.negate();
      var bone = fi === 4 ? 16 + (seg >= 1 ? 1 : 0) : fingerBone(fi, seg);
      p.applyMatrix4(bindM); n.transformDirection(bindM);
      return { bone: bone, p: p, n: n, t: new THREE.Vector3(0, 0, -1).transformDirection(bindM) };
    }
    function surfOnPalm(start, dir) {
      var p = v3(start), d = v3(dir).normalize();
      for (var it = 0; it < 80; it++) { var v = sdfPalm(p.x, p.y, p.z); if (v > -0.00005) break; p.addScaledVector(d, Math.max(-v, 0.0002)); }
      var e = 0.0003;
      var n = new THREE.Vector3(sdfPalm(p.x + e, p.y, p.z) - sdfPalm(p.x - e, p.y, p.z), sdfPalm(p.x, p.y + e, p.z) - sdfPalm(p.x, p.y - e, p.z), sdfPalm(p.x, p.y, p.z + e) - sdfPalm(p.x, p.y, p.z - e)).normalize();
      var W8 = weightsAt(p);
      var bb = 0, bv = 0; for (var b = 0; b < NB; b++) if (W8.bw[b] > bv) { bv = W8.bw[b]; bb = b; }
      return { bone: bb, p: p, n: n, t: new THREE.Vector3(0.3, 0, -1).normalize() };
    }
    var grains = [
      surfOnFinger(0, 0.55, 205),
      surfOnFinger(4, 1.45, 255),
      surfOnFinger(0, 1.45, 225),
      surfOnPalm([-0.022 * sc, -0.004 * sc, -0.072 * sc], [-0.55, -0.8, 0.0]),
      surfOnFinger(0, 2.45, 245),
      surfOnFinger(4, 0.55, 240),
      surfOnFinger(1, 0.75, 262),
      surfOnPalm([-0.006 * sc, -0.002 * sc, -0.050 * sc], [0, -1, 0])
    ];
    var glowPts = [];
    for (f = 0; f < 5; f++) {
      var g2 = surfOnFinger(f, f === 4 ? 1.62 : 2.55, 90);
      glowPts.push(g2);
    }
    // palm anchor surface point (palm center)
    var palmPt = surfOnPalm([0.002 * sc, 0, -0.050 * sc], [0, -1, 0]).p;

    MODELS[who] = {
      who: who, spec: spec, geo: geo, nailGeo: nailGeo, bindMats: bindMats, bindInv: bindInv,
      chains: chains, grains: grains, glowPts: glowPts, palmPt: palmPt, FSY: FSY, sdf: sdfPalm,
      tris: IDX.length / 3
    };
    return MODELS[who];
  }

  function buildNails(spec, chains, bindMats, FSY) {
    var P = [], N = [], C = [], SI = [], SW = [], I = [];
    var nu = 9, nv = 9;
    for (var f = 0; f < 5; f++) {
      var ch = chains[f], prof = ch.prof;
      var distStart = prof.J[prof.J.length - 1], E = prof.E;
      var Ld = E - distStart;
      var len = Ld * spec.nail.len * (f === 4 ? 0.95 : 1);
      var sEnd = E - prof.Rt * 0.30;
      var sBeg = sEnd - len;
      var halfAng = (f === 4 ? 58 : 52) * PI / 180;
      var boneM = f === 4 ? bindMats[16] : bindMats[fingerBone(f, 0)];
      var boneIdx = f === 4 ? 17 : fingerBone(f, 2);
      var rotM = new THREE.Matrix3().setFromMatrix4(boneM);
      var base = P.length / 3;
      var tmp = [0, 0, 0], grid = [];
      for (var a = 0; a < nu; a++) {
        var u = a / (nu - 1);
        var s = mix(sBeg, sEnd, u);
        var wf = u < 0.32 ? Math.sqrt(Math.max(0.0, 1 - Math.pow((0.32 - u) / 0.32, 2))) : 1 - 0.08 * sstep(0.8, 1, u);
        wf = Math.max(wf, 0.12);
        for (var b = 0; b < nv; b++) {
          var vv = (b / (nv - 1)) * 2 - 1;
          var ph = PI / 2 - vv * halfAng * wf;
          tubePoint(prof, s, ph, FSY, tmp);
          // the nail stays flatter than the rounding finger tip
          var k = clamp((s - prof.capStart) / (E - prof.capStart), 0, 1);
          var r = prof.r(s);
          var nx = Math.cos(ph), ny = Math.sin(ph);
          var lift = spec.nail.lift * Math.sqrt(Math.max(0, 1 - vv * vv)) * sstep(0, 0.18, u) + 0.00006;
          var flat = r * FSY * (1 - Math.sqrt(Math.max(0, 1 - k * k))) * 0.55 * ny;
          grid.push([tmp[0] + nx * lift, tmp[1] + ny * lift + flat, tmp[2]]);
        }
      }
      var v = new THREE.Vector3();
      for (a = 0; a < nu; a++) for (b = 0; b < nv; b++) {
        var g = grid[a * nv + b];
        v.set(g[0], g[1], g[2]).applyMatrix4(boneM);
        P.push(v.x, v.y, v.z);
        var gA = grid[Math.min(a + 1, nu - 1) * nv + b], gB = grid[Math.max(a - 1, 0) * nv + b];
        var gC = grid[a * nv + Math.min(b + 1, nv - 1)], gD = grid[a * nv + Math.max(b - 1, 0)];
        var da = new THREE.Vector3(gA[0] - gB[0], gA[1] - gB[1], gA[2] - gB[2]);
        var dbb = new THREE.Vector3(gC[0] - gD[0], gC[1] - gD[1], gC[2] - gD[2]);
        var n = new THREE.Vector3().crossVectors(da, dbb).normalize();
        if (n.y < 0) n.negate();
        n.applyMatrix3(rotM).normalize();
        N.push(n.x, n.y, n.z);
        var uu = a / (nu - 1), vvv = Math.abs(b / (nv - 1) * 2 - 1);
        var cc = mixc(spec.colNail, spec.colNailTip, sstep(1 - spec.nail.white - 0.02, 1 - spec.nail.white * 0.3, uu));
        // edges blend toward skin (nail fold)
        cc = mixc(cc, spec.colBase, sstep(0.75, 1.0, vvv) * 0.55 + (1 - sstep(0.0, 0.16, uu)) * 0.6);
        C.push(cc[0], cc[1], cc[2]);
        SI.push(boneIdx, 0, 0, 0); SW.push(1, 0, 0, 0);
      }
      for (a = 0; a < nu - 1; a++) for (b = 0; b < nv - 1; b++) {
        var A = base + a * nv + b, B = base + (a + 1) * nv + b, Cc = base + a * nv + b + 1, D = base + (a + 1) * nv + b + 1;
        I.push(A, B, Cc, B, D, Cc);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    geo.setIndex(I);
    // fix winding vs normals
    var idx = geo.index.array, pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
    for (var t = 0; t < idx.length; t += 3) {
      var a0 = idx[t], b0 = idx[t + 1], c0 = idx[t + 2];
      var ax = pos[b0 * 3] - pos[a0 * 3], ay = pos[b0 * 3 + 1] - pos[a0 * 3 + 1], az = pos[b0 * 3 + 2] - pos[a0 * 3 + 2];
      var bx = pos[c0 * 3] - pos[a0 * 3], by = pos[c0 * 3 + 1] - pos[a0 * 3 + 1], bz = pos[c0 * 3 + 2] - pos[a0 * 3 + 2];
      var fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      if (fx * nor[a0 * 3] + fy * nor[a0 * 3 + 1] + fz * nor[a0 * 3 + 2] < 0) { idx[t + 1] = c0; idx[t + 2] = b0; }
    }
    return geo;
  }

  /* ------------------------------------------------------------------ */
  /* 材質（共有）                                                         */
  /* ------------------------------------------------------------------ */
  var MAT = {};
  function skinMaterial(who, glowUniform) {
    var m = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: who === 'child' ? 0.60 : 0.58,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(1.0, 0.72, 0.62),
      specularIntensity: 0.55,
      emissive: new THREE.Color(0.030, 0.008, 0.004)
    });
    var u = glowUniform;
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uGlow = u.uGlow;
      sh.uniforms.uGlowColor = u.uGlowColor;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTip;\nvarying float vTip;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTip = aTip;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform vec3 uGlowColor;\nvarying float vTip;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' +
          // やわらかい透け感: 光の当たらない側をほんのり赤く
          'totalEmissiveRadiance += uGlowColor * (uGlow * vTip * vTip);');
    };
    m.customProgramCacheKey = function () { return 'hand-skin-v1'; };
    return m;
  }
  function nailMaterial() {
    if (MAT.nail) return MAT.nail;
    MAT.nail = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.30, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.22,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2
    });
    return MAT.nail;
  }

  // ---- fabric textures (canvas) ----
  function texSize() { return quality() === 'low' ? 256 : 512; }
  function heightToNormal(hgt, S, strength) {
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d'), img = cx.createImageData(S, S), d = img.data;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var l = hgt[y * S + (x - 1 + S) % S], r = hgt[y * S + (x + 1) % S];
      var t = hgt[((y - 1 + S) % S) * S + x], b = hgt[((y + 1) % S) * S + x];
      var nx = (l - r) * strength, ny = (t - b) * strength, nz = 1;
      var il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      var o = (y * S + x) * 4;
      d[o] = (nx * il * 0.5 + 0.5) * 255; d[o + 1] = (ny * il * 0.5 + 0.5) * 255; d[o + 2] = (nz * il * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    var t2 = new THREE.CanvasTexture(cv);
    t2.wrapS = t2.wrapT = THREE.RepeatWrapping; t2.anisotropy = 4;
    return t2;
  }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function linenTextures() {
    if (MAT.linenTex) return MAT.linenTex;
    var S = texSize(), hgt = new Float32Array(S * S), R = rng(7);
    var n = 64; // threads per tile each way
    var thick = [], thick2 = [];
    for (var i = 0; i < n; i++) { thick.push(0.7 + R() * 0.6 + (R() < 0.08 ? 0.5 : 0)); thick2.push(0.7 + R() * 0.6 + (R() < 0.08 ? 0.5 : 0)); }
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d'), img = cx.createImageData(S, S), d = img.data;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var fx = x / S * n, fy = y / S * n;
      var ix = Math.floor(fx), iy = Math.floor(fy);
      var ux = fx - ix, uy = fy - iy;
      var over = ((ix + iy) & 1) === 0;
      var warp = Math.sin(ux * PI) * thick[ix % n];
      var weft = Math.sin(uy * PI) * thick2[iy % n];
      var hh = over ? warp * 0.8 + weft * 0.35 : weft * 0.8 + warp * 0.35;
      hgt[y * S + x] = hh;
      var o = (y * S + x) * 4;
      var slub = (thick[ix % n] - 1) * 10 + (thick2[iy % n] - 1) * 10;
      var base = 226 + hh * 10 + slub + (R() - 0.5) * 6;
      d[o] = clamp(base + 4, 0, 255); d[o + 1] = clamp(base - 2, 0, 255); d[o + 2] = clamp(base - 18, 0, 255); d[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    var map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
    MAT.linenTex = { map: map, normal: heightToNormal(hgt, S, 1.6) };
    return MAT.linenTex;
  }
  function knitTextures(rib) {
    var key = rib ? 'ribTex' : 'knitTex';
    if (MAT[key]) return MAT[key];
    var S = texSize(), hgt = new Float32Array(S * S), R = rng(rib ? 11 : 5);
    var cols = rib ? 24 : 48, rows = rib ? 64 : 64;
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d'), img = cx.createImageData(S, S), d = img.data;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var fx = x / S * cols, fy = y / S * rows;
      var ux = fx - Math.floor(fx), uy = fy - Math.floor(fy);
      var hh;
      if (rib) {
        // 1x1 rib: raised wale / sunken purl column
        var col2 = Math.floor(fx) & 1;
        var wale = Math.sin(ux * PI);
        var v = Math.abs(ux - 0.5) * 2;
        var loop = 1 - Math.abs(((uy + v * 0.5) % 1) - 0.5) * 2;
        hh = col2 ? wale * (0.75 + 0.25 * loop) : 0.15 * wale;
      } else {
        // jersey: V-shaped loops in columns
        var vx = Math.abs(ux - 0.5) * 2;
        var vy = (uy + vx * 0.55) % 1;
        hh = Math.sin(vy * PI) * (0.6 + 0.4 * Math.sin(ux * PI)) * (1 - 0.35 * vx);
      }
      hh += (R() - 0.5) * 0.05;
      hgt[y * S + x] = hh;
      var o = (y * S + x) * 4;
      var sh2 = hh * 22 - 11;
      d[o] = clamp(246 + sh2 * 0.4, 0, 255); d[o + 1] = clamp(212 + sh2, 0, 255); d[o + 2] = clamp(112 + sh2 * 1.2, 0, 255); d[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    var map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
    MAT[key] = { map: map, normal: heightToNormal(hgt, S, rib ? 2.4 : 1.6) };
    return MAT[key];
  }
  function sleeveMaterial(kind) {
    if (MAT[kind]) return MAT[kind];
    var m;
    if (kind === 'linen') {
      var t = linenTextures();
      m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.92, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xfff6e6), side: THREE.DoubleSide });
    } else {
      var k = knitTextures(kind === 'rib');
      m = new THREE.MeshPhysicalMaterial({ map: k.map, normalMap: k.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, sheen: 0.7, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xfff2c0), side: THREE.DoubleSide });
    }
    MAT[kind] = m;
    return m;
  }
  function glowTexture() {
    if (MAT.glowTex) return MAT.glowTex;
    var S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d');
    var g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.35, 'rgba(255,214,140,0.55)'); g.addColorStop(1, 'rgba(255,190,110,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, S, S);
    MAT.glowTex = new THREE.CanvasTexture(cv);
    MAT.glowTex.colorSpace = THREE.SRGBColorSpace;
    return MAT.glowTex;
  }
  function grainAsset() {
    if (MAT.grain) return MAT.grain;
    var geo = null, mat = null;
    try {
      if (G.Rice && G.Rice.createGrain) {
        var gm = G.Rice.createGrain();
        if (gm && gm.geometry) {
          geo = gm.geometry.clone();
          mat = gm.material || null;
          geo.computeBoundingBox();
          var bb = geo.boundingBox, sz = new THREE.Vector3(); bb.getSize(sz);
          var L = Math.max(sz.x, sz.y, sz.z);
          // align long axis to Z, normalize length ~5mm
          if (sz.x === L) geo.rotateY(PI / 2); else if (sz.y === L) geo.rotateX(PI / 2);
          var c = new THREE.Vector3(); geo.computeBoundingBox(); geo.boundingBox.getCenter(c); geo.translate(-c.x, -c.y, -c.z);
          if (L > 0.008 || L < 0.003) geo.scale(0.005 / L, 0.005 / L, 0.005 / L);
          if (!geo.index) { var n = geo.attributes.position.count, ii = []; for (var i = 0; i < n; i++) ii.push(i); geo.setIndex(ii); }
          if (!geo.attributes.normal) geo.computeVertexNormals();
        }
      }
    } catch (e) { geo = null; }
    if (!geo) { geo = new THREE.SphereGeometry(1, 10, 7); geo.scale(0.00165, 0.00145, 0.0026); }
    if (!mat || !(mat.isMaterial)) mat = new THREE.MeshPhysicalMaterial({ color: 0xf6f3ea, roughness: 0.38, sheen: 0.3, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.3, clearcoatRoughness: 0.4 });
    MAT.grain = { geo: geo, mat: mat };
    return MAT.grain;
  }
  function buildGrainGeo(model) {
    var ga = grainAsset(), src = ga.geo;
    var sp = src.attributes.position, sn = src.attributes.normal, si = src.index.array;
    var P = [], N = [], SI = [], SW = [], I = [];
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), n = new THREE.Vector3();
    var R = rng(3);
    model.grains.forEach(function (g, k) {
      // long axis along tangent t, flat side on the skin normal
      var z = g.t.clone().addScaledVector(g.n, -g.t.dot(g.n)).normalize();
      z.applyAxisAngle(g.n, (R() - 0.5) * 1.6);
      var y = g.n.clone(), x = new THREE.Vector3().crossVectors(y, z).normalize();
      var mm = new THREE.Matrix4().makeBasis(x, y, z);
      var pos = g.p.clone().addScaledVector(g.n, 0.0009);
      mm.setPosition(pos);
      var base = P.length / 3;
      for (var i = 0; i < sp.count; i++) {
        v.fromBufferAttribute(sp, i).applyMatrix4(mm); P.push(v.x, v.y, v.z);
        n.fromBufferAttribute(sn, i).transformDirection(mm); N.push(n.x, n.y, n.z);
        SI.push(g.bone, 0, 0, 0); SW.push(1, 0, 0, 0);
      }
      for (i = 0; i < si.length; i++) I.push(base + si[i]);
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    geo.setIndex(I);
    geo.userData.perGrain = si.length;
    return geo;
  }

  /* ------------------------------------------------------------------ */
  /* 腕と袖（手首→elbow の曲線に沿うチューブ）                              */
  /* ------------------------------------------------------------------ */
  function Arm(hand) {
    var spec = hand.model.spec, who = hand.who;
    this.hand = hand;
    this.spec = spec;
    var low = quality() === 'low';
    this.nr = low ? 16 : 22;
    var sc = spec.palmLen / 0.088;
    // ring stations (s along curve)
    var fs = [], s;
    for (s = -0.010 * sc; s < 0.02 * sc; s += 0.004 * sc) fs.push(s);
    for (; s < spec.skinLen + 0.012; s += 0.012 * sc) fs.push(s);
    fs.push(spec.skinLen + 0.012);
    this.fs = fs;
    var ss = [], s0 = spec.skinLen;
    if (who === 'mama') {
      // folded linen cuff: lip, rolled band, then loose sleeve far off-screen
      var cuff = [0, 0.002, 0.005, 0.009, 0.015, 0.022, 0.029, 0.036, 0.041, 0.045, 0.048, 0.052, 0.058];
      cuff.forEach(function (d) { ss.push(s0 + d); });
      for (s = s0 + 0.07; s < s0 + 0.62; s += 0.03) ss.push(s);
    } else {
      var rb = [0, 0.0015, 0.004, 0.008, 0.013, 0.018, 0.023, 0.027, 0.030, 0.034, 0.040, 0.048];
      rb.forEach(function (d) { ss.push(s0 + d); });
      for (s = s0 + 0.06; s < s0 + 0.55; s += 0.03) ss.push(s);
    }
    this.ss = ss;
    this.cuffEnd = who === 'mama' ? 0.0 : 0.030;
    this.forearm = this._mkMesh(fs.length, this.nr, false, true);
    this.forearm.material = hand.skinMat;
    var sleeveKind = who === 'mama' ? 'linen' : 'knit';
    this.sleeve = this._mkMesh(ss.length, this.nr + 6, true, false);
    this.sleeve.material = sleeveMaterial(sleeveKind);
    if (who === 'child') {
      // rib part rendered with its own material: split by geometry groups
      var nRib = 0; for (var i = 0; i < ss.length; i++) if (ss[i] - s0 <= 0.0305) nRib = i;
      var per = (this.nr + 6) * 6;
      this.sleeve.geometry.clearGroups();
      this.sleeve.geometry.addGroup(0, nRib * per, 0);
      this.sleeve.geometry.addGroup(nRib * per, (ss.length - 1 - nRib) * per, 1);
      this.sleeve.material = [sleeveMaterial('rib'), sleeveMaterial('knit')];
    }
    hand.group.add(this.forearm); hand.group.add(this.sleeve);
    this.sig = new Float32Array(20).fill(NaN);
    // dense path table
    this.NP = 72;
    this.tp = new Float32Array(this.NP * 3); this.tt = new Float32Array(this.NP * 3);
    this.tu = new Float32Array(this.NP * 3); this.tv = new Float32Array(this.NP * 3); this.ts = new Float32Array(this.NP);
    this.R = rng(who === 'mama' ? 21 : 33);
    this.folds = [];
    for (i = 0; i < 6; i++) this.folds.push([this.R() * PI * 2, 2 + Math.floor(this.R() * 3), this.R() * 20 + 8, this.R()]);
  }
  Arm.prototype._mkMesh = function (rings, nr, uv, colors) {
    var n = rings * nr;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
    if (colors) {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('aTip', new THREE.BufferAttribute(new Float32Array(n), 1));
    }
    var idx = [];
    for (var a = 0; a < rings - 1; a++) for (var b = 0; b < nr; b++) {
      var b1 = (b + 1) % nr;
      var A = a * nr + b, B = (a + 1) * nr + b, C = a * nr + b1, D = (a + 1) * nr + b1;
      idx.push(A, B, C, B, D, C);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    var m = new THREE.Mesh(geo);
    m.frustumCulled = false;
    m.castShadow = true; m.receiveShadow = true;
    m.userData.nr = nr; m.userData.rings = rings;
    return m;
  };
  var _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  Arm.prototype.update = function (force) {
    var hand = this.hand;
    hand.group.updateWorldMatrix(true, false);
    hand.inner.updateWorldMatrix(true, false);
    _m4b.copy(hand.group.matrixWorld).invert();
    _m4.multiplyMatrices(_m4b, hand.inner.matrixWorld); // inner in group space
    var e = _v.copy(hand.elbow).applyMatrix4(_m4b);
    var me = _m4.elements, sig = this.sig, changed = !!force;
    for (var i = 0; i < 16; i++) if (Math.abs(sig[i] - me[i]) > 2e-5) { changed = true; break; }
    if (Math.abs(sig[16] - e.x) + Math.abs(sig[17] - e.y) + Math.abs(sig[18] - e.z) > 1e-5) changed = true;
    if (!changed) return false;
    for (i = 0; i < 16; i++) sig[i] = me[i];
    sig[16] = e.x; sig[17] = e.y; sig[18] = e.z;
    this._build(_m4, e.clone());
    return true;
  };
  Arm.prototype._build = function (M, E) {
    var spec = this.spec;
    var W = new THREE.Vector3().setFromMatrixPosition(M);
    var ux = new THREE.Vector3().setFromMatrixColumn(M, 0), uy = new THREE.Vector3().setFromMatrixColumn(M, 1), uz = new THREE.Vector3().setFromMatrixColumn(M, 2);
    var sx = ux.length(); ux.normalize(); uy.normalize(); uz.normalize();
    var flip = ux.clone().cross(uy).dot(uz) < 0;
    if (flip) ux.negate(); // un-mirror the wrist frame for the arm
    // path: wrist -> bend near wrist -> straight to elbow -> continue off-screen
    var sc = spec.palmLen / 0.088;
    var P0 = W.clone().addScaledVector(uz, -0.03 * sc);       // starts inside the hand
    var dE = E.clone().sub(W); var distE = dE.length();
    var bendL = Math.min(0.06 * sc, distE * 0.3);
    var P1 = W.clone().addScaledVector(uz, bendL);
    var D = E.clone().sub(P1).normalize();
    var P2 = P1.clone().addScaledVector(D, bendL * 0.9);
    var ext = E.clone().addScaledVector(D, 0.5);
    // sample dense table: segment A (line P0->W), B (quad bezier W,P1,P2), C (line P2->E->ext)
    var NP = this.NP, tp = this.tp, tt = this.tt, tu = this.tu, tv = this.tv, ts = this.ts;
    var pts = [];
    var nA = 6, nB = 30, nC = NP - nA - nB, k;
    for (k = 0; k < nA; k++) pts.push(P0.clone().lerp(W, k / nA));
    for (k = 0; k < nB; k++) {
      var t = k / nB, it = 1 - t;
      pts.push(new THREE.Vector3().addScaledVector(W, it * it).addScaledVector(P1, 2 * it * t).addScaledVector(P2, t * t));
    }
    for (k = 0; k < nC; k++) pts.push(P2.clone().lerp(ext, k / (nC - 1)));
    var s = -0.03 * sc;
    var prevT = uz.clone(), U = ux.clone(), V = uy.clone();
    for (k = 0; k < NP; k++) {
      if (k > 0) s += pts[k].distanceTo(pts[k - 1]);
      ts[k] = s;
      var T = k < NP - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1]);
      T.normalize();
      // parallel transport U,V
      var ax = new THREE.Vector3().crossVectors(prevT, T), sa = ax.length();
      if (sa > 1e-6) { var ang = Math.asin(clamp(sa, -1, 1)); ax.normalize(); U.applyAxisAngle(ax, ang); V.applyAxisAngle(ax, ang); }
      // re-orthonormalize
      U.addScaledVector(T, -U.dot(T)).normalize(); V.crossVectors(T, U).normalize();
      if (V.dot(uy) < 0 && k < nA + 2) V.negate();
      prevT.copy(T);
      tp[k * 3] = pts[k].x; tp[k * 3 + 1] = pts[k].y; tp[k * 3 + 2] = pts[k].z;
      tt[k * 3] = T.x; tt[k * 3 + 1] = T.y; tt[k * 3 + 2] = T.z;
      tu[k * 3] = U.x; tu[k * 3 + 1] = U.y; tu[k * 3 + 2] = U.z;
      tv[k * 3] = V.x; tv[k * 3 + 1] = V.y; tv[k * 3 + 2] = V.z;
    }
    // handedness of (U,V,T) for winding: we always build V = T x U so it's consistent
    this._fill(this.forearm, this.fs, false);
    this._fill(this.sleeve, this.ss, true);
  };
  Arm.prototype._frame = function (s, o) {
    var ts = this.ts, NP = this.NP, k = 0;
    if (s <= ts[0]) k = 0; else if (s >= ts[NP - 1]) k = NP - 2;
    else { var lo = 0, hi = NP - 1; while (hi - lo > 1) { var md = (lo + hi) >> 1; if (ts[md] <= s) lo = md; else hi = md; } k = lo; }
    var t = clamp((s - ts[k]) / (ts[k + 1] - ts[k] || 1), 0, 1);
    if (s > ts[NP - 1]) t = 1 + (s - ts[NP - 1]) / (ts[NP - 1] - ts[NP - 2]);
    for (var c = 0; c < 3; c++) {
      o.p[c] = mix(this.tp[k * 3 + c], this.tp[k * 3 + 3 + c], t);
      o.u[c] = mix(this.tu[k * 3 + c], this.tu[k * 3 + 3 + c], t);
      o.v[c] = mix(this.tv[k * 3 + c], this.tv[k * 3 + 3 + c], t);
    }
    return o;
  };
  Arm.prototype._skinR = function (s) {
    var a = this.spec.arm, sc = this.spec.palmLen / 0.088;
    var ax, bx;
    if (s <= a[0][0]) { ax = a[0][1]; bx = a[0][2]; }
    else {
      ax = a[a.length - 1][1]; bx = a[a.length - 1][2];
      for (var i = 0; i < a.length - 1; i++) if (s <= a[i + 1][0]) {
        var t = (s - a[i][0]) / (a[i + 1][0] - a[i][0]); t = t * t * (3 - 2 * t);
        ax = mix(a[i][1], a[i + 1][1], t); bx = mix(a[i][2], a[i + 1][2], t); break;
      }
    }
    // inside the hand it is thinner (hidden), emerges a few mm behind the wrist
    var k = sstep(0.006 * sc, 0.016 * sc, s);
    var g = mix(-0.0012, 0.00035, k);
    return [ax + g, bx + g];
  };
  Arm.prototype._fill = function (mesh, stations, isSleeve) {
    var geo = mesh.geometry, nr = mesh.userData.nr;
    var pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
    var uv = geo.attributes.uv ? geo.attributes.uv.array : null;
    var colA = geo.attributes.color ? geo.attributes.color.array : null;
    var spec = this.spec, who = this.hand.who, s0 = spec.skinLen;
    var fr = { p: [0, 0, 0], u: [0, 0, 0], v: [0, 0, 0] };
    var rings = stations.length;
    var folds = this.folds;
    for (var a = 0; a < rings; a++) {
      var s = stations[a];
      this._frame(s, fr);
      var r = this._skinR(s), ra = r[0], rb = r[1];
      var add = 0, addB = 0, d = s - s0, foldAmt = 0;
      if (isSleeve) {
        if (who === 'mama') {
          // rolled cuff: lip -> thick band (two layers) -> back to sleeve
          var band = 0.010 + 0.0035 * Math.sin(clamp(d / 0.046, 0, 1) * PI);
          var lip = sstep(-0.001, 0.006, d);
          var after = sstep(0.046, 0.060, d);
          var loose = spec.sleeveEase + 0.012 * sstep(0.06, 0.40, d) + 0.004;
          add = mix(0.0012, band, lip);
          add = mix(add, loose, after);
          // little dip where the band ends
          add -= 0.002 * Math.exp(-Math.pow((d - 0.050) / 0.003, 2));
          foldAmt = 0.25 * (1 - after) + after * 1.0;
        } else {
          var lip2 = sstep(-0.0005, 0.004, d);
          var ribT = 0.0032;
          add = mix(0.0009, ribT, lip2);
          var puff = spec.sleeveEase + 0.008 * sstep(0.05, 0.35, d);
          var tr = sstep(0.028, 0.045, d);
          add = mix(add, puff, tr);
          add += 0.0025 * Math.exp(-Math.pow((d - 0.040) / 0.006, 2)) * tr; // soft bunching above the rib
          foldAmt = 0.15 * (1 - tr) + tr;
        }
        addB = add;
      }
      for (var b = 0; b < nr; b++) {
        var ph = b / nr * PI * 2;
        var c = Math.cos(ph), sn = Math.sin(ph);
        var A = ra + add, B = rb + addB;
        if (isSleeve) {
          var f = 0;
          for (var q = 0; q < folds.length; q++) {
            var F = folds[q];
            f += Math.sin(ph * F[1] + F[0] + d * F[2]) * (0.5 + 0.5 * Math.sin(d * 9 + F[3] * 6));
          }
          var fa = f * 0.0011 * foldAmt * (who === 'mama' ? 1.3 : 0.9);
          A += fa; B += fa;
          // fabric hangs: slightly lower on the underside (palm side) away from the cuff
          if (sn < 0) B += 0.004 * sstep(0.06, 0.3, d) * -sn;
        }
        var ox = c * A, oy = sn * B;
        var o = (a * nr + b) * 3;
        pos[o] = fr.p[0] + fr.u[0] * ox + fr.v[0] * oy;
        pos[o + 1] = fr.p[1] + fr.u[1] * ox + fr.v[1] * oy;
        pos[o + 2] = fr.p[2] + fr.u[2] * ox + fr.v[2] * oy;
        if (uv) {
          var circ = PI * (A + B);
          var scl = who === 'mama' ? 0.045 : 0.03;
          uv[(a * nr + b) * 2] = (b / nr) * Math.round(circ / scl);
          uv[(a * nr + b) * 2 + 1] = s / scl;
        }
        if (colA && a === 0 && this._colored !== true) { /* colors set below once */ }
      }
    }
    // normals by finite differences on the grid
    var P = pos, n3 = nor;
    for (a = 0; a < rings; a++) for (b = 0; b < nr; b++) {
      var i0 = (a * nr + b) * 3;
      var ap = Math.min(a + 1, rings - 1), am = Math.max(a - 1, 0);
      var bp = (b + 1) % nr, bm = (b - 1 + nr) % nr;
      var iA = (ap * nr + b) * 3, iB = (am * nr + b) * 3, iC = (a * nr + bp) * 3, iD = (a * nr + bm) * 3;
      var sx = P[iA] - P[iB], sy = P[iA + 1] - P[iB + 1], sz = P[iA + 2] - P[iB + 2];
      var tx = P[iC] - P[iD], ty = P[iC + 1] - P[iD + 1], tz = P[iC + 2] - P[iD + 2];
      // outward = (dP/dphi) x (dP/ds) for U,V,T right-handed
      var nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      n3[i0] = nx / l; n3[i0 + 1] = ny / l; n3[i0 + 2] = nz / l;
    }
    if (colA && !mesh.userData.colored) {
      mesh.userData.colored = true;
      var tipA = geo.attributes.aTip.array;
      for (a = 0; a < rings; a++) for (b = 0; b < nr; b++) {
        var snn = Math.sin(b / nr * PI * 2);
        var palmar = sstep(0.15, -0.7, snn);
        var cc = mixc(spec.colBase, spec.colPalm, palmar * 0.85);
        // inner forearm a touch paler
        cc = mixc(cc, col(244, 214, 196), palmar * sstep(0.02, 0.08, stations[a]) * 0.35);
        var o3 = (a * nr + b) * 3;
        colA[o3] = cc[0]; colA[o3 + 1] = cc[1]; colA[o3 + 2] = cc[2];
        tipA[a * nr + b] = 0;
      }
      geo.attributes.color.needsUpdate = true;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    if (uv) geo.attributes.uv.needsUpdate = true;
  };

  /* ------------------------------------------------------------------ */
  /* Hand                                                                */
  /* ------------------------------------------------------------------ */
  var HANDS = [];
  var ELBOWS = { child: [0.09, 0.30, 0.62], mama: [0.36, 0.42, 0.60] };
  var RESTS = { child: [0.075, 0.04, 0.33], mama: [0.215, 0.07, 0.20] };

  function Hand(opts) {
    opts = opts || {};
    var who = this.who = opts.who === 'mama' ? 'mama' : 'child';
    var side = this.side = opts.side === 'L' ? 'L' : 'R';
    var sg = side === 'L' ? -1 : 1;
    this.sign = sg;
    var model = this.model = getModel(who);
    var spec = model.spec;
    this.dims = { length: spec.length, width: spec.width, thick: spec.thick, palmLen: spec.palmLen };
    this.group = new THREE.Group(); this.group.name = 'hand-' + who + side;
    this.root = new THREE.Group(); this.group.add(this.root);
    this.inner = new THREE.Group(); this.root.add(this.inner);
    if (side === 'L') this.inner.scale.x = -1;
    this.skel = new THREE.Group(); this.inner.add(this.skel);
    var bones = this.bones = [];
    for (var i = 0; i < NB; i++) {
      var b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrix.copy(model.bindMats[i]);
      this.skel.add(b); bones.push(b);
    }
    this.skeleton = new THREE.Skeleton(bones, model.bindInv.map(function (m) { return m.clone(); }));
    this.uniforms = { uGlow: { value: 0 }, uGlowColor: { value: new THREE.Color(1.0, 0.62, 0.25) } };
    this.skinMat = skinMaterial(who, this.uniforms);
    var mesh = this.mesh = new THREE.SkinnedMesh(model.geo, this.skinMat);
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    this.skel.add(mesh);
    var nails = this.nails = new THREE.SkinnedMesh(model.nailGeo, nailMaterial());
    nails.bind(this.skeleton, new THREE.Matrix4());
    nails.frustumCulled = false; nails.castShadow = false; nails.receiveShadow = true;
    this.skel.add(nails);
    // grains
    this._grainGeo = buildGrainGeo(model);
    this.grainMesh = new THREE.SkinnedMesh(this._grainGeo, grainAsset().mat);
    this.grainMesh.bind(this.skeleton, new THREE.Matrix4());
    this.grainMesh.frustumCulled = false; this.grainMesh.castShadow = true; this.grainMesh.receiveShadow = true;
    this.grainMesh.visible = false;
    this.skel.add(this.grainMesh);
    this.grains = 0;
    // glow sprites on distal bones
    this.glowSprites = [];
    var gmat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowMat = gmat;
    var self = this;
    model.glowPts.forEach(function (g, k) {
      var sp = new THREE.Sprite(gmat);
      var lp = g.p.clone().addScaledVector(g.n, 0.002).applyMatrix4(model.bindInv[g.bone]);
      sp.position.copy(lp);
      var sz = spec.palmLen / 0.088 * 0.036;
      sp.scale.set(sz, sz, sz);
      sp.visible = false; sp.renderOrder = 5;
      bones[g.bone].add(sp);
      // bones use matrixAutoUpdate=false but children update normally
      self.glowSprites.push(sp);
    });
    this.glow = 0;
    // anchors (children of inner, mirror cancelled)
    this.anchors = {};
    var names = ['palm', 'grip', 'pinch', 'indexTip', 'midTip'];
    for (i = 0; i < names.length; i++) {
      var a = new THREE.Object3D(); a.name = names[i];
      if (side === 'L') a.scale.x = -1;
      this.inner.add(a); this.anchors[names[i]] = a;
    }
    this.mats = makeMats();
    this.pose = normPose('relaxed');
    this._poseFrom = copyPose(this.pose); this._poseTo = copyPose(this.pose);
    this._poseT = 1; this._poseDur = 0;
    this._dirty = true;
    this._sway = 0; this._swayPhase = Math.random() * 10;
    this.idle = false;
    var e = ELBOWS[who], r = RESTS[who];
    this.elbow = new THREE.Vector3(e[0] * sg, e[1], e[2]);
    this.restPos = new THREE.Vector3(r[0] * sg, r[1], r[2]);
    this.restRot = new THREE.Euler();
    this.restRot.copy(defaultRestRot(who, side));
    this.restPose = 'relaxed';
    this.root.position.copy(this.restPos);
    this.root.quaternion.setFromEuler(this.restRot);
    this.arm = new Arm(this);
    this._applyPose();
    this._tw = [];
    this._hidden = false;
    HANDS.push(this);
    ensureLoop();
  }
  function defaultRestRot(who, side) {
    var sg = side === 'L' ? -1 : 1;
    // fingers point forward(-Z) & a little inward, fingertips a bit lower, rests on the little-finger side
    var q = new THREE.Quaternion();
    if (who === 'child') {
      q.setFromEuler(new THREE.Euler(-0.18, 0.16 * sg, -0.22 * sg, 'YXZ'));
    } else {
      q.setFromEuler(new THREE.Euler(-0.14, 0.62 * sg, -0.30 * sg, 'YXZ'));
    }
    return new THREE.Euler().setFromQuaternion(q);
  }

  Hand.prototype._applyPose = function () {
    var model = this.model, spec = model.spec, mats = this.mats;
    fk(spec, this.pose, mats);
    for (var i = 0; i < NB; i++) { this.bones[i].matrix.copy(mats[i]); this.bones[i].matrixWorldNeedsUpdate = true; }
    // anchors (model space, unmirrored; inner applies mirror, anchor scale cancels it)
    var A = this.anchors, sx = this.side === 'L' ? -1 : 1;
    function setA(a, p) { a.position.set(p.x, p.y, p.z); }
    var idxTip = this._tipPoint(0), midTip = this._tipPoint(1), thTip = this._tipPoint(4);
    setA(A.indexTip, idxTip.end);
    setA(A.midTip, midTip.end);
    setA(A.pinch, idxTip.pad.clone().add(thTip.pad).multiplyScalar(0.5));
    // palm anchor follows the arch a little
    var pp = model.palmPt.clone();
    setA(A.palm, pp);
    // grip: center of the cylinder wrapped by the middle finger
    setA(A.grip, this._gripCenter());
    this._dirty = false;
  };
  Hand.prototype._tipPoint = function (f) {
    var spec = this.model.spec, mats = this.mats;
    var M = f === 4 ? mats[17] : mats[fingerBone(f, 2)];
    var L = f === 4 ? spec.thumb.L[2] : spec.fingers[f].L[2];
    var R = f === 4 ? spec.thumb.R[3] : spec.fingers[f].R[3];
    var end = new THREE.Vector3(0, R * 0.1, -L).applyMatrix4(M);
    var pad = new THREE.Vector3(0, -R * 0.75, -L + R * 0.9).applyMatrix4(M);
    return { end: end, pad: pad };
  };
  Hand.prototype._gripCenter = function () {
    var spec = this.model.spec, mats = this.mats;
    // average of middle finger's three phalanx mid points pushed toward the palm side
    var c = new THREE.Vector3(), n = 0;
    for (var f = 1; f < 3; f++) for (var s = 0; s < 3; s++) {
      var F = spec.fingers[f];
      var p = new THREE.Vector3(0, -F.R[s] * 1.0 - 0.0125 * spec.palmLen / 0.088 * 0, -F.L[s] * 0.5).applyMatrix4(mats[fingerBone(f, s)]);
      c.add(p); n++;
    }
    c.multiplyScalar(1 / n);
    var palmSide = new THREE.Vector3(c.x, -spec.thick * 0.5 - 0.0125, c.z);
    return c.lerp(palmSide, 0.35);
  };

  Hand.prototype.setPose = function (p, dur) {
    var to = normPose(p);
    if (dur == null) dur = 0.25;
    this._poseFrom = copyPose(this.pose);
    this._poseTo = to;
    this._poseName = typeof p === 'string' ? p : null;
    if (!(dur > 0) || !hasLoop()) { this.pose = copyPose(to); this._poseT = 1; this._applyPose(); return this; }
    this._poseDur = dur; this._poseT = 0;
    return this;
  };
  Hand.prototype.setGlow = function (v) {
    this.glow = clamp(+v || 0, 0, 1);
    var on = this.glow > 0.001;
    for (var i = 0; i < this.glowSprites.length; i++) this.glowSprites[i].visible = on;
    if (!on) { this.uniforms.uGlow.value = 0; this.glowMat.opacity = 0; }
    else this._updGlow(G.time || 0);
  };
  Hand.prototype._updGlow = function (t) {
    if (this.glow <= 0.001) return;
    var pulse = 0.62 + 0.38 * Math.sin(t * PI * 2 * 0.9);
    this.uniforms.uGlow.value = this.glow * (0.18 + 0.22 * pulse);
    this.glowMat.opacity = this.glow * (0.30 + 0.45 * pulse);
  };
  Hand.prototype.setGrains = function (n) {
    n = clamp(Math.round(+n || 0), 0, 8);
    this.grains = n;
    var per = this._grainGeo.userData.perGrain;
    this._grainGeo.setDrawRange(0, n * per);
    this.grainMesh.visible = n > 0;
  };
  Hand.prototype._killTw = function () {
    for (var i = 0; i < this._tw.length; i++) { try { this._tw[i].kill(); } catch (e) { } }
    this._tw = [];
  };
  Hand.prototype.moveTo = function (o) {
    o = o || {};
    var self = this, root = this.root;
    var dur = o.dur != null ? o.dur : 0.4;
    var fromP = root.position.clone(), fromQ = root.quaternion.clone();
    var toP = o.pos ? o.pos.clone() : fromP.clone();
    var toQ = fromQ.clone();
    if (o.rot) { if (o.rot.isQuaternion) toQ.copy(o.rot); else toQ.setFromEuler(o.rot); }
    if (o.pose) this.setPose(o.pose, Math.min(dur, Math.max(0.15, dur * 0.8)));
    this._killTw();
    var dist = fromP.distanceTo(toP);
    var arc = o.arc != null ? o.arc : Math.min(0.05, dist * 0.22);
    function apply(k) {
      root.position.lerpVectors(fromP, toP, k);
      root.position.y += arc * Math.sin(PI * k);
      root.quaternion.slerpQuaternions(fromQ, toQ, k);
    }
    if (!(dur > 0) || !G.tween) { apply(1); if (o.onDone) { try { o.onDone(); } catch (e) { } } return { kill: function () { } }; }
    var proxy = { k: 0 };
    var ease = o.ease || (G.Ease && G.Ease.inOut);
    var opts = { onUpdate: function () { apply(proxy.k); }, onDone: function () { apply(1); if (o.onDone) o.onDone(); } };
    if (ease) opts.ease = ease;
    if (o.delay) opts.delay = o.delay;
    var tw;
    try { tw = G.tween(proxy, { k: 1 }, dur, opts); } catch (e) { apply(1); if (o.onDone) o.onDone(); return { kill: function () { } }; }
    this._tw.push(tw);
    return tw;
  };
  Hand.prototype.rest = function (dur) {
    this._hidden = false;
    return this.moveTo({ pos: this.restPos, rot: this.restRot, pose: this.restPose, dur: dur != null ? dur : 0.5 });
  };
  Hand.prototype.hide = function (dur) {
    if (!this._hidden) { this._shownPos = this.root.position.clone(); this._shownQ = this.root.quaternion.clone(); }
    this._hidden = true;
    var e = this.elbow.clone(), p = this.root.position.clone();
    var d = e.clone().sub(p); d.y = Math.max(d.y, 0); d.normalize();
    var to = p.clone().addScaledVector(d, 0.30); to.z = Math.max(to.z, e.z * 0.85);
    return this.moveTo({ pos: to, dur: dur != null ? dur : 0.5, arc: 0 });
  };
  Hand.prototype.show = function (dur) {
    var p = this._shownPos || this.restPos, q = this._shownQ || new THREE.Quaternion().setFromEuler(this.restRot);
    this._hidden = false;
    return this.moveTo({ pos: p, rot: q, dur: dur != null ? dur : 0.5, arc: 0 });
  };
  Hand.prototype.attach = function (obj, anchorName) {
    var a = this.anchors[anchorName] || this.anchors.palm;
    if (!obj) return;
    this.group.updateWorldMatrix(true, true);
    a.attach(obj);
  };
  Hand.prototype.detach = function (obj, parent) {
    if (!obj) return;
    var p = parent || G.scene || null;
    if (!p) { var r = this.group; while (r.parent) r = r.parent; p = r; }
    p.updateWorldMatrix(true, false);
    p.attach(obj);
  };
  // 「壁」姿勢の目標（両手でごはんの左右をはさむ）。t: 0=平行 0.5=山 1=丸
  Hand.prototype.wallTarget = function (t, o) {
    o = o || {};
    t = clamp(t || 0, 0, 1);
    var spec = this.model.spec, sg = this.sign, sc = spec.palmLen / 0.088;
    var cx = o.cx || 0, cz = o.cz || 0, topY = o.topY || 0;
    var gap = o.gap != null ? o.gap : 0.03 * sc;   // 中心から手のひらの面まで
    var pose = wallPose(t);
    var yaw = wallYaw(t);
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw * sg, -PI / 2 * sg, 'YXZ'));
    // palm contact point (model space) -> root space (mirror) -> world
    var pc = new THREE.Vector3(0.004 * sc * sg, -spec.thick * 0.42, -spec.palmLen * 0.62);
    var off = pc.applyQuaternion(q);
    var zoff = o.zoff != null ? o.zoff : mix(0.012, 0.035, sstep(0.0, 0.5, t)) * sc - 0.02 * sc * sstep(0.5, 1, t);
    var target = new THREE.Vector3(cx + sg * gap, 0, cz + zoff);
    var pos = target.sub(off);
    var edge = 0.0355 * sc;
    pos.y = topY + edge + 0.0015;
    return { pos: pos, rot: q, pose: pose };
  };
  Hand.prototype.update = function (dt) {
    dt = dt || 0;
    var t = G.time != null ? G.time : (this._t = (this._t || 0) + dt);
    if (this._poseT < 1) {
      this._poseT = Math.min(1, this._poseT + dt / Math.max(1e-3, this._poseDur));
      var k = this._poseT, e = k * k * (3 - 2 * k);
      lerpPose(this._poseFrom, this._poseTo, e, this.pose);
      this._dirty = true;
    }
    if (this._dirty) this._applyPose();
    // idle sway (small, slow)
    var target = this.idle ? 1 : 0;
    this._sway += (target - this._sway) * Math.min(1, dt * 2);
    if (this._sway > 0.001) {
      var ph = t * 0.9 + this._swayPhase;
      var a = this._sway;
      this.inner.position.set(Math.sin(ph * 0.7) * 0.0012 * a, Math.sin(ph) * 0.0016 * a, Math.sin(ph * 0.5 + 1) * 0.0010 * a);
      this.inner.rotation.set(Math.sin(ph * 0.8 + 2) * 0.012 * a, Math.sin(ph * 0.6) * 0.010 * a, 0);
    } else if (this.inner.position.lengthSq() > 0) { this.inner.position.set(0, 0, 0); this.inner.rotation.set(0, 0, 0); }
    this._updGlow(t);
    this.arm.update(false);
  };
  Hand.prototype.dispose = function () {
    var i = HANDS.indexOf(this); if (i >= 0) HANDS.splice(i, 1);
    if (this.group.parent) this.group.parent.remove(this.group);
  };

  /* wall <-> cup の中間ポーズ */
  function wallPose(t) {
    t = clamp(t || 0, 0, 1);
    var w = normPose('wall'), c = normPose('cup');
    var k = sstep(0.5, 1.0, t);
    var p = lerpPose(w, c, k);
    // the mountain keeps fingers straight and closed, thumb tucked a little more
    var m = Math.sin(clamp(t / 0.5, 0, 1) * PI / 2) * (1 - k);
    p.thumbCurl += 0.05 * m;
    return p;
  }
  function wallYaw(t) {
    // 指先を内向きに回す角（rad）。右手は +、左手は鏡像
    var a = 0.48; // ≈27°
    if (t <= 0.5) return a * sstep(0, 0.5, t);
    return mix(a, 0.10, sstep(0.5, 1, t));
  }

  /* ------------------------------------------------------------------ */
  /* ループ                                                               */
  /* ------------------------------------------------------------------ */
  var loopOn = false;
  function hasLoop() { return loopOn; }
  function ensureLoop() {
    if (loopOn) return;
    if (G.Engine && typeof G.Engine.onUpdate === 'function') {
      try { G.Engine.onUpdate(function (dt) { G.Hands.update(dt); }); loopOn = true; } catch (e) { loopOn = false; }
    }
  }
  function hookScene(obj) {
    var r = obj; while (r.parent) r = r.parent;
    if (!r.isScene || r.__handsHook) return;
    r.__handsHook = true;
    var prev = r.onBeforeRender;
    r.onBeforeRender = function () {
      if (typeof prev === 'function') { try { prev.apply(this, arguments); } catch (e) { } }
      for (var i = 0; i < HANDS.length; i++) { try { HANDS[i].arm.update(false); } catch (e2) { } }
      for (i = 0; i < GHOSTS.length; i++) { try { GHOSTS[i]._arm(); } catch (e3) { } }
    };
  }
  function updateAll(dt) {
    for (var i = 0; i < HANDS.length; i++) {
      var h = HANDS[i];
      try { hookScene(h.group); h.update(dt); } catch (e) { }
    }
    for (i = 0; i < GHOSTS.length; i++) { try { hookScene(GHOSTS[i].group); } catch (e) { } }
  }

  /* ------------------------------------------------------------------ */
  /* Ghost（ヒント用の半透明の子どもの右手）                                 */
  /* ------------------------------------------------------------------ */
  var GHOSTS = [];
  function createGhost() {
    var model = getModel('child'), spec = model.spec;
    var group = new THREE.Group(); group.name = 'hand-ghost';
    var holder = new THREE.Group(); group.add(holder);
    var skel = new THREE.Group(); holder.add(skel);
    var bones = [];
    for (var i = 0; i < NB; i++) { var b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrix.copy(model.bindMats[i]); skel.add(b); bones.push(b); }
    var skeleton = new THREE.Skeleton(bones, model.bindInv.map(function (m) { return m.clone(); }));
    var depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, opacity: 1, depthWrite: true });
    var colMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, transparent: true, opacity: 0.45, depthWrite: false, depthFunc: THREE.LessEqualDepth, emissive: new THREE.Color(0.06, 0.035, 0.02) });
    var nailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, transparent: true, opacity: 0.45, depthWrite: false, depthFunc: THREE.LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    var pre = new THREE.SkinnedMesh(model.geo, depthMat); pre.bind(skeleton, new THREE.Matrix4()); pre.renderOrder = 20; pre.frustumCulled = false;
    var mesh = new THREE.SkinnedMesh(model.geo, colMat); mesh.bind(skeleton, new THREE.Matrix4()); mesh.renderOrder = 21; mesh.frustumCulled = false;
    var nails = new THREE.SkinnedMesh(model.nailGeo, nailMat); nails.bind(skeleton, new THREE.Matrix4()); nails.renderOrder = 22; nails.frustumCulled = false;
    skel.add(pre); skel.add(mesh); skel.add(nails);
    // short fading forearm (in holder space; static)
    var nr = 18, stations = [], s;
    for (s = -0.012; s <= 0.075; s += 0.006) stations.push(s);
    var geo = new THREE.BufferGeometry(), P = [], N = [], C = [], I = [];
    var wsp = spec.arm;
    for (var a = 0; a < stations.length; a++) {
      s = stations[a];
      var k2 = sstep(0.004, 0.014, s);
      var ra = mix(spec.wrist.r1 - 0.0012, mix(wsp[0][1], wsp[1][1], clamp(s / wsp[1][0], 0, 1)) + 0.0003, k2);
      var rb = mix(spec.wrist.r1 * spec.wrist.sy - 0.0012, mix(wsp[0][2], wsp[1][2], clamp(s / wsp[1][0], 0, 1)) + 0.0003, k2);
      var alpha = 1 - sstep(0.008, 0.07, s);
      for (var bb = 0; bb < nr; bb++) {
        var ph = bb / nr * PI * 2;
        P.push(Math.cos(ph) * ra, Math.sin(ph) * rb, s);
        var nn = new THREE.Vector3(Math.cos(ph) / ra, Math.sin(ph) / rb, 0).normalize();
        N.push(nn.x, nn.y, nn.z);
        var cc = mixc(spec.colBase, spec.colPalm, sstep(0.15, -0.7, Math.sin(ph)) * 0.85);
        C.push(cc[0], cc[1], cc[2], alpha);
      }
    }
    for (a = 0; a < stations.length - 1; a++) for (bb = 0; bb < nr; bb++) {
      var b1 = (bb + 1) % nr;
      var A = a * nr + bb, B = (a + 1) * nr + bb, Cc = a * nr + b1, D = (a + 1) * nr + b1;
      I.push(A, Cc, B, B, Cc, D);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
    geo.setIndex(I);
    var armMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, transparent: true, opacity: 0.45, depthWrite: false, emissive: new THREE.Color(0.06, 0.035, 0.02) });
    var arm = new THREE.Mesh(geo, armMat); arm.renderOrder = 19; arm.frustumCulled = false;
    holder.add(arm);
    // orientation: fingers toward -Z, tilted down 35deg (wrist up & toward +Z)
    holder.quaternion.setFromEuler(new THREE.Euler(-35 * PI / 180, 0, 0));
    var mats = makeMats();
    var tip = new THREE.Object3D(); group.add(tip);
    var press = 0, base = normPose('point');
    var g = {
      group: group, tip: tip,
      setOpacity: function (v) { v = clamp(+v || 0, 0, 1); colMat.opacity = v; nailMat.opacity = v; armMat.opacity = v; group.visible = v > 0.002; },
      setPress: function (p) { press = clamp(+p || 0, 0, 1); pose(); },
      _arm: function () { }
    };
    function pose() {
      var pz = copyPose(base);
      pz.curl[0] = 0.04 + press * 0.10;
      fk(spec, pz, mats);
      for (var i = 0; i < NB; i++) { bones[i].matrix.copy(mats[i]); bones[i].matrixWorldNeedsUpdate = true; }
      // keep the (unpressed) index tip at the origin; pressing sinks the tip a little
      var M = mats[fingerBone(0, 2)], F = spec.fingers[0];
      var tp = new THREE.Vector3(0, -F.R[3] * 0.5, -F.L[2] + F.R[3] * 0.5).applyMatrix4(M);
      if (!g._tip0) g._tip0 = tp.clone();
      var t0 = g._tip0.clone().applyQuaternion(holder.quaternion);
      holder.position.copy(t0).negate();
      holder.position.y -= press * 0.005;
      holder.position.z -= press * 0.002;
    }
    pose();
    group.traverse(function (o) { o.castShadow = false; o.receiveShadow = false; });
    GHOSTS.push(g);
    ensureLoop();
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* 公開                                                                 */
  /* ------------------------------------------------------------------ */
  G.Hands = {
    POSES: POSES,
    create: function (opts) { return new Hand(opts); },
    createGhost: createGhost,
    update: updateAll,
    wallPose: wallPose,
    wallYaw: wallYaw,
    list: HANDS,
    _models: MODELS,
    _getModel: getModel
  };
  ensureLoop();
})();
