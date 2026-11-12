/* dishes.js — 食器5つ・ぬれ/ふき・ふきん・あわ・ごはん（契約 G.dishes）
   食器の group の原点 = 底の中心（Y 上）。group → pivot（ひと口のつぶれ）→ 本体・水滴・泡・料理。
   ぬれ/ふき: 食器ローカルの平面投影（皿・茶わん = XZ、コップ = XY）の canvas マスク（白 = 乾いた）を
   onBeforeCompile で読み、roughness / clearcoat / 色を切り替える。水滴は同じマスクの JS 版グリッドで縮む。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var D = (G.dishes = { ids: [], list: [], built: false, cloth: null });
  var T = null, byId = {}, V = null;
  var TAU = Math.PI * 2;

  // ---------- 小道具 ----------
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sm(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ex(l, dt) { return 1 - Math.exp(-l * dt); }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0; var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function fbm(x, y, z, sd) {
    var s = 0, a = 0.5, f = 1;
    for (var i = 0; i < 4; i++) {
      s += a * Math.sin(x * f * 1.7 + sd + i * 1.3) * Math.sin(y * f * 2.3 + sd * 1.7 + i) * Math.sin(z * f * 1.9 + sd * 0.7 + i * 2.1);
      f *= 2.03; a *= 0.5;
    }
    return s;
  }
  function cvs(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function ctex(c, srgb, rep) {
    var t = new T.CanvasTexture(c);
    if (srgb) t.encoding = T.sRGBEncoding;
    t.flipY = false;
    if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    try { t.anisotropy = Math.min(8, G.renderer.capabilities.getMaxAnisotropy()); } catch (e) {}
    return t;
  }
  function rgb(hex, k, add) {
    add = add || 0;
    var r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    return 'rgb(' + Math.round(clamp(r * k + add, 0, 255)) + ',' + Math.round(clamp(g * k + add, 0, 255)) + ',' + Math.round(clamp(b * k + add, 0, 255)) + ')';
  }
  function audio(n) { try { if (G.audio && G.audio.play) G.audio.play(n); } catch (e) {} }
  function interp(tab, ki, vi, x) {   // tab: [[..],..] ki 列が昇順
    var n = tab.length;
    if (x <= tab[0][ki]) return tab[0][vi];
    for (var i = 1; i < n; i++) {
      if (x <= tab[i][ki]) {
        var a = tab[i - 1], b = tab[i], t = (x - a[ki]) / ((b[ki] - a[ki]) || 1e-9);
        return lerp(a[vi], b[vi], t);
      }
    }
    return tab[n - 1][vi];
  }

  // ---------- 断面（[ρ, y] の列。外→上→内の順で lathe の表が外を向く） ----------
  function bowlProfile(R, H, footF) {
    var fr = R * footF, fh = H * 0.12, ft = R * 0.075, t = R * 0.052;
    var out = [[0, fh * 0.55], [fr - ft * 0.55, fh * 0.55], [fr - ft * 0.48, fh * 0.25], [fr - ft * 0.36, fh * 0.04],
      [fr - ft * 0.2, 0], [fr + ft * 0.15, 0], [fr + ft * 0.33, fh * 0.05], [fr + ft * 0.45, fh * 0.4], [fr + ft * 0.48, fh * 0.9]];
    var nFoot = out.length - 1;
    var b0 = fr + ft * 0.48, Hb = H - t * 0.5, N = 30, i, a;
    function P(s) {
      var q = s * Math.PI / 2;
      return [b0 + (R * 0.965 - b0) * Math.sin(q) + R * 0.035 * Math.pow(s, 4), fh + (Hb - fh) * Math.pow(1 - Math.cos(q), 0.9)];
    }
    for (i = 1; i <= N; i++) out.push(P(i / N));
    var nLip = out.length - 1;
    for (i = 1; i <= 4; i++) { a = i / 4 * Math.PI / 2; out.push([R - t / 2 + t / 2 * Math.cos(a), Hb + t / 2 * Math.sin(a)]); }
    var inner = [];
    for (i = 0; i <= 4; i++) { a = Math.PI / 2 + i / 4 * Math.PI / 2; inner.push([R - t / 2 + t / 2 * Math.cos(a), Hb + t / 2 * Math.sin(a)]); }
    for (i = N - 1; i >= 0; i--) {
      var s = i / N, p0 = P(Math.max(0, s - 0.01)), p1 = P(Math.min(1, s + 0.01)), p = P(s);
      var dr = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.sqrt(dr * dr + dy * dy) || 1;
      inner.push([p[0] - t * dy / l, p[1] + t * dr / l]);
    }
    var fy = inner[inner.length - 1][1];
    inner.push([b0 * 0.6, fy - t * 0.08], [b0 * 0.25, fy - t * 0.12], [0, fy - t * 0.13]);
    var tab = [];
    for (i = inner.length - 1; i >= 5; i--) tab.push(inner[i]);   // ρ 昇順
    return { outer: out, inner: inner, nFoot: nFoot, nLip: nLip, tab: tab, t: t, fh: fh };
  }
  function plateProfile(R, H) {
    var t = 0.0042, fr = R * 0.477, ft = 0.0065, yw = 0.0094, yr = H - 0.0005, rw = R * 0.40, rr = R * 0.93, i, a;
    function top(r) { return yw + (yr - yw) * sm((r - rw) / (rr - rw)); }
    var under = [[0, 0.0043], [fr - ft * 0.5, 0.0043], [fr - ft * 0.42, 0.0013], [fr - ft * 0.28, 0.0001], [fr - ft * 0.05, 0],
      [fr + ft * 0.2, 0.0002], [fr + ft * 0.4, 0.0018]];
    var rc = R - t * 0.5;
    for (i = 0; i <= 20; i++) { var r = lerp(fr + ft * 0.5, rc, i / 20); under.push([r, top(r) - t]); }
    var cy = top(rc) - t / 2;
    for (i = 1; i <= 6; i++) { a = -Math.PI / 2 + i / 6 * Math.PI; under.push([rc + t / 2 * Math.cos(a), cy + t / 2 * Math.sin(a)]); }
    var topP = [];
    for (i = 0; i <= 34; i++) { var r2 = lerp(rc, 0, i / 34); topP.push([r2, top(r2)]); }
    return { outer: under, top: topP, topFn: top, t: t };
  }
  function glassProfile(R, H) {
    var rb = R * 0.86, t = 0.0021, tb = 0.0105, i;
    function rad(y) { return rb + (R - rb) * (y / H); }
    var out = [[0, 0.0009], [rb - 0.005, 0.0003], [rb - 0.0018, 0], [rb - 0.0005, 0.0007], [rad(0.0025), 0.0025]];
    for (i = 1; i <= 14; i++) { var y = lerp(0.0025, H - t / 2, i / 14); out.push([rad(y), y]); }
    var nOut = out.length;
    var cx = rad(H - t / 2) - t / 2;
    for (i = 1; i <= 8; i++) { var a = i / 8 * Math.PI; out.push([cx + t / 2 * Math.cos(a), H - t / 2 + t / 2 * Math.sin(a)]); }
    for (i = 1; i <= 14; i++) { var y2 = lerp(H - t / 2, tb + 0.0035, i / 14); out.push([rad(y2) - t, y2]); }
    out.push([rad(tb) - t - 0.0016, tb + 0.0009], [rad(tb) - t - 0.0042, tb + 0.0001], [rb * 0.4, tb - 0.0004], [0, tb - 0.0006]);
    return { all: out, outer: out.slice(0, nOut), rad: rad, innerR: function (y) { return rad(y) - t - 0.0007; }, tb: tb, t: t };
  }
  function arcs(p) {
    var a = [0];
    for (var i = 1; i < p.length; i++) { var dr = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1]; a.push(a[i - 1] + Math.sqrt(dr * dr + dy * dy)); }
    return a;
  }
  function lathe(p, seg, mode, R) {
    var v2 = [], i, j, n = p.length;
    for (i = 0; i < n; i++) v2.push(new T.Vector2(p[i][0], p[i][1]));
    var g = new T.LatheGeometry(v2, seg), uv = g.attributes.uv, pos = g.attributes.position;
    if (mode === 'arc') {
      var a = arcs(p), L = a[n - 1] || 1;
      for (i = 0; i <= seg; i++) for (j = 0; j < n; j++) uv.setY(i * n + j, a[j] / L);
    } else if (mode === 'plan') {
      for (i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, pos.getZ(i) / (2 * R) + 0.5);
    }
    return g;
  }
  // 断面の上の面積に比例した点選び
  function sampler(p, filt) {
    var cum = [], tot = 0;
    for (var i = 0; i < p.length - 1; i++) {
      var a = p[i], b = p[i + 1], dr = b[0] - a[0], dy = b[1] - a[1];
      var w = (a[0] + b[0]) / 2 * Math.sqrt(dr * dr + dy * dy);
      if (filt && !filt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) w = 0;
      tot += w; cum.push(tot);
    }
    return { p: p, cum: cum, tot: tot };
  }
  function sample(S, r, o, phMin, phMax) {
    var x = r() * S.tot, i = 0;
    while (i < S.cum.length - 1 && S.cum[i] < x) i++;
    var a = S.p[i], b = S.p[i + 1], t = r();
    var rho = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t), dr = b[0] - a[0], dy = b[1] - a[1], l = Math.sqrt(dr * dr + dy * dy) || 1;
    var nr = dy / l, ny = -dr / l, ph = phMin != null ? lerp(phMin, phMax, r()) : r() * TAU, s = Math.sin(ph), c = Math.cos(ph);
    o.x = rho * s; o.y = y; o.z = rho * c; o.nx = nr * s; o.ny = ny; o.nz = nr * c; o.rho = rho;
    return o;
  }

  // ---------- シェーダ（ぬれマスク・光の帯・ヒントの光・ガラスの不透明度） ----------
  var FS_HEAD = '#include <common>\nvarying vec3 vLP;\nuniform sampler2D uMask;\nuniform vec4 uMS;\nuniform float uWet;\nuniform float uGlow;\nuniform float uBand;\nuniform vec3 uGlowC;\n';
  var FS_COLOR = '#include <color_fragment>\n' +
    '#ifdef MASK_XY\nvec2 mUV = vec2(vLP.x * uMS.x + 0.5, vLP.y * uMS.y);\n#else\nvec2 mUV = vLP.xz * uMS.x + 0.5;\n#endif\n' +
    'float wetK = uWet * (1.0 - texture2D(uMask, mUV).r);\n' +
    'wetK *= 0.8 + 0.2 * sin(vLP.x * 260.0 + sin(vLP.z * 190.0 + vLP.y * 150.0) * 2.0);\n' +
    'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.50 + vec3(0.13, 0.16, 0.20), wetK * 0.95);\n' +
    '#ifdef ABOOST\ndiffuseColor.a += wetK * 0.16;\n#endif\n' +
    'float bandS = (vLP.x * 0.8 + vLP.z * 0.25 + vLP.y * 0.6) * uMS.z;\n' +
    'diffuseColor.rgb *= 1.0 - 0.42 * max(0.0, exp(-pow((bandS - uBand) * 1.3, 2.0)) - exp(-pow((bandS - uBand) * 3.2, 2.0)));\n';
  var FS_ROUGH = '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, wetK);\n';
  var FS_EMIS = '#include <emissivemap_fragment>\n' +
    '{ float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);\n' +
    '  totalEmissiveRadiance += uGlowC * uGlow * (0.07 + 0.5 * fres);\n' +
    '  float band = exp(-pow((bandS - uBand) * 4.0, 2.0));\n' +
    '  totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * band * (0.7 + 1.2 * fres); }\n';
  var FS_LIGHT = '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - 0.8 * wetK;\nmaterial.clearcoatRoughness = mix(material.clearcoatRoughness, 0.5, wetK);\n#endif\n';
  var FS_OUT = '#include <output_fragment>\n#ifdef ABOOST\n{ float fr2 = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);\n' +
    '  vec3 spc = reflectedLight.directSpecular + reflectedLight.indirectSpecular;\n' +
    '  gl_FragColor.a = clamp(diffuseColor.a + fr2 * ABOOST_F + dot(spc, vec3(0.3, 0.59, 0.11)) * ABOOST_S, 0.0, 1.0); }\n#endif\n';
  function mkOBC(Un) {
    return function (sh) {
      for (var k in Un) sh.uniforms[k] = Un[k];
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FS_HEAD)
        .replace('#include <color_fragment>', FS_COLOR).replace('#include <roughnessmap_fragment>', FS_ROUGH)
        .replace('#include <emissivemap_fragment>', FS_EMIS).replace('#include <lights_physical_fragment>', FS_LIGHT)
        .replace('#include <output_fragment>', FS_OUT);
    };
  }
  function dropOBC(sh) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>', FS_OUT +
      '{ vec3 vd = normalize(vViewPosition); float fr3 = pow(1.0 - abs(dot(normal, vd)), 2.0);\n' +
      '  vec3 rf = reflect(-vd, normal); float hl = pow(max(dot(rf, normalize(vec3(-0.35, 0.75, 0.55))), 0.0), 70.0) * 2.2;\n' +
      '  hl += pow(max(dot(rf, normalize(vec3(0.5, 0.6, 0.6))), 0.0), 140.0) * 0.8;\n' +
      '  gl_FragColor.rgb = gl_FragColor.rgb * mix(1.0, 0.45, fr3) + vec3(hl);\n' +
      '  gl_FragColor.a = clamp(gl_FragColor.a + fr3 * 0.35 + hl, 0.0, 1.0); }\n');
  }

  // ---------- 共有の素材 ----------
  var S = null;
  function shared() {
    if (S) return S;
    S = {};
    S.dropGeo = new T.SphereGeometry(1, 9, 4, 0, TAU, 0, Math.PI / 2);
    S.dropMat = new T.MeshPhysicalMaterial({ color: 0xa9b8c2, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.3,
      depthWrite: false, envMapIntensity: 1.8, ior: 1.33, clearcoat: 1, clearcoatRoughness: 0.02 });
    S.dropMat.defines = { ABOOST: 1, ABOOST_F: '0.5', ABOOST_S: '1.5' };
    S.dropMat.onBeforeCompile = dropOBC;
    S.dropMat.customProgramCacheKey = function () { return 'dishDrop'; };
    S.foamGeo = new T.SphereGeometry(1, 10, 7);
    // 泡: つやを抑えた白いかたまり（真珠の玉に見えないよう、陰影をやわらげる）
    S.foamMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0,
      emissive: 0xeef3f6, emissiveIntensity: 0.34, envMapIntensity: 0.5 });
    S.riceTex = texRice();
    S.riceMat = new T.MeshPhysicalMaterial({ color: 0xffffff, map: S.riceTex, bumpMap: S.riceTex, bumpScale: 0.9, roughness: 0.5,
      clearcoat: 0.25, clearcoatRoughness: 0.35, sheen: 0.3, sheenColor: new T.Color(0xffffff), sheenRoughness: 0.6 });
    S.grainMat = new T.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.45 });
    S.grainGeo = new T.SphereGeometry(1, 8, 6);
    S.riceGeo = riceGeo(false);
    S.heapGeo = riceGeo(true);
    var kt = texKaraage();
    S.karaMat = new T.MeshPhysicalMaterial({ color: 0xffffff, map: kt, bumpMap: kt, bumpScale: 1.6, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    S.karaGeo = [karaGeo(1.3), karaGeo(4.1)];
    S.shadowTex = (function () {
      var c = cvs(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return ctex(c, false);
    })();
    return S;
  }

  // ---------- canvas テクスチャ ----------
  function texPlate() {
    var Sz = 1024, c = cvs(Sz, Sz), x = c.getContext('2d'), h = Sz / 2, r = rng(11), i, a;
    x.fillStyle = '#f4f4ef'; x.fillRect(0, 0, Sz, Sz);
    var g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(232,235,233,0.7)'); g.addColorStop(0.6, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, Sz, Sz);
    function ring(f0, f1, col) { x.beginPath(); x.arc(h, h, f1 * h, 0, TAU); x.arc(h, h, f0 * h, 0, TAU, true); x.fillStyle = col; x.fill(); }
    ring(0.785, 0.925, '#29467f');
    for (i = 0; i < 1100; i++) {
      a = r() * TAU; var f = lerp(0.79, 0.92, r());
      x.fillStyle = r() < 0.5 ? 'rgba(18,32,74,0.16)' : 'rgba(80,110,170,0.12)';
      x.beginPath(); x.arc(h + Math.cos(a) * f * h, h + Math.sin(a) * f * h, 2 + r() * 7, 0, TAU); x.fill();
    }
    var fm = 0.855 * h, n = 44;
    for (i = 0; i < n; i++) {
      a = i / n * TAU; var px = h + Math.cos(a) * fm, py = h + Math.sin(a) * fm;
      x.strokeStyle = 'rgba(242,243,238,0.8)'; x.lineWidth = 2.4;
      x.beginPath(); x.arc(px, py, 0.026 * h, 0, TAU); x.stroke();
      x.fillStyle = 'rgba(242,243,238,0.85)'; x.beginPath(); x.arc(px, py, 0.009 * h, 0, TAU); x.fill();
    }
    ring(0.71, 0.721, '#2e4d88');
    ring(0.951, 0.961, '#2e4d88');
    return ctex(c, true);
  }
  function texBowl(id, pr, R) {
    var W = 1024, H = 256, c = cvs(W, H), x = c.getContext('2d'), r = rng(id.length * 31 + 7), i, j;
    var base = G.L.seatColor[id];
    var a = arcs(pr.outer), L = a[a.length - 1], vF = a[pr.nFoot] / L, vL = a[pr.nLip] / L;
    var pu = W / (TAU * R * 0.85), pv = H / L;
    x.fillStyle = '#cfb894'; x.fillRect(0, 0, W, H);
    for (i = 0; i < 600; i++) { x.fillStyle = r() < 0.5 ? 'rgba(120,90,60,0.12)' : 'rgba(255,240,215,0.12)'; x.fillRect(r() * W, r() * vF * H, 2, 2); }
    // 釉薬（高台の手前で波打って終わる）
    var y0 = (vF + 0.035) * H;
    var g = x.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, rgb(base, 0.62)); g.addColorStop(0.18, rgb(base, 0.86)); g.addColorStop(0.55, rgb(base, 1));
    g.addColorStop(0.92, rgb(base, id === 'bowlL' ? 1.12 : 1.04, id === 'bowlL' ? 6 : 0)); g.addColorStop(1, rgb(base, 0.9));
    x.fillStyle = g; x.beginPath(); x.moveTo(0, H);
    for (i = 0; i <= 64; i++) { var px = i / 64 * W; x.lineTo(px, y0 + Math.sin(i * 0.9) * 3 + Math.sin(i * 2.7) * 2); }
    x.lineTo(W, H); x.closePath(); x.fill();
    for (i = 0; i < 2600; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
      x.beginPath(); x.arc(r() * W, lerp(y0, H, r()), 1 + r() * 3, 0, TAU); x.fill();
    }
    function at(px, py, fn) { fn(px, py); if (px < 40) fn(px + W, py); if (px > W - 40) fn(px - W, py); }
    if (id === 'bowlM') {
      var fr0 = 0.0047, rx = fr0 * pu, ry = fr0 * pv;
      for (j = 0; j < 3; j++) {
        var vv = lerp(vF + 0.2, vL - 0.12, j / 2), nn = 15;
        for (i = 0; i < nn; i++) {
          at(((i + (j % 2) * 0.5) / nn) * W + (r() - 0.5) * 18, vv * H + (r() - 0.5) * 8, function (cx, cy) {
            x.fillStyle = 'rgba(250,246,238,0.96)';
            for (var k = 0; k < 5; k++) {
              var an = k / 5 * TAU + 0.3;
              x.beginPath(); x.ellipse(cx + Math.cos(an) * rx * 0.55, cy + Math.sin(an) * ry * 0.55, rx * 0.42, ry * 0.42, 0, 0, TAU); x.fill();
            }
            x.fillStyle = 'rgba(236,198,96,0.95)'; x.beginPath(); x.ellipse(cx, cy, rx * 0.22, ry * 0.22, 0, 0, TAU); x.fill();
          });
        }
      }
    } else if (id === 'bowlS') {
      var dr = 0.0043;
      for (j = 0; j < 3; j++) {
        var v2 = lerp(vF + 0.17, vL - 0.1, j / 2), n2 = 12;
        for (i = 0; i < n2; i++) {
          at(((i + (j % 2) * 0.5) / n2) * W, v2 * H, function (cx, cy) {
            x.fillStyle = 'rgba(252,250,244,0.97)'; x.beginPath(); x.ellipse(cx, cy, dr * pu, dr * pv, 0, 0, TAU); x.fill();
          });
        }
      }
    } else {
      x.fillStyle = '#b48658'; x.fillRect(0, vL * H - 2, W, H);   // 口のふちの素焼き色
    }
    return ctex(c, true);
  }
  function texCloth() {
    var Sz = 256, c = cvs(Sz, Sz), x = c.getContext('2d'), r = rng(5), i;
    x.fillStyle = '#f3f1ea'; x.fillRect(0, 0, Sz, Sz);
    for (i = 0; i < Sz; i += 2) { x.fillStyle = 'rgba(0,0,0,0.035)'; x.fillRect(0, i, Sz, 1); x.fillRect(i, 0, 1, Sz); }
    for (i = 0; i < 900; i++) { x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.12)'; x.fillRect(r() * Sz, r() * Sz, 1 + r() * 3, 1); }
    function stripe(v0, w) {
      x.fillStyle = 'rgba(52,86,150,0.92)';
      x.beginPath(); x.moveTo(0, v0);
      for (var k = 0; k <= 32; k++) x.lineTo(k / 32 * Sz, v0 + Math.sin(k * 0.6) * 3);
      for (k = 32; k >= 0; k--) x.lineTo(k / 32 * Sz, v0 + w + Math.sin(k * 0.6) * 3);
      x.closePath(); x.fill();
    }
    stripe(Sz * 0.28, 11); stripe(Sz * 0.38, 7);
    return ctex(c, true);
  }
  function texRice() {
    var Sz = 512, c = cvs(Sz, Sz), x = c.getContext('2d'), r = rng(77);
    x.fillStyle = '#e9e5da'; x.fillRect(0, 0, Sz, Sz);
    for (var i = 0; i < 3200; i++) {
      var px = r() * Sz, py = r() * Sz, an = r() * Math.PI, L = 7 + r() * 3, w = 3.3 + r() * 1.2;
      var tone = 238 + Math.floor(r() * 16);
      x.save(); x.translate(px, py); x.rotate(an);
      x.fillStyle = 'rgba(150,140,120,0.2)'; x.beginPath(); x.ellipse(0.8, 1.0, L, w, 0, 0, TAU); x.fill();
      x.fillStyle = 'rgb(' + tone + ',' + tone + ',' + (tone - 6) + ')'; x.beginPath(); x.ellipse(0, 0, L, w, 0, 0, TAU); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.7)'; x.beginPath(); x.ellipse(-L * 0.25, -w * 0.3, L * 0.45, w * 0.3, 0, 0, TAU); x.fill();
      x.restore();
    }
    return ctex(c, true, [3, 1.6]);
  }
  function texKaraage() {
    var Sz = 256, c = cvs(Sz, Sz), x = c.getContext('2d'), r = rng(23), i;
    x.fillStyle = '#b06a2c'; x.fillRect(0, 0, Sz, Sz);
    var pal = ['rgba(122,62,20,0.55)', 'rgba(212,150,70,0.55)', 'rgba(160,90,34,0.5)', 'rgba(232,180,96,0.45)', 'rgba(96,46,14,0.5)'];
    for (i = 0; i < 2600; i++) {
      x.fillStyle = pal[(r() * pal.length) | 0];
      x.beginPath(); x.arc(r() * Sz, r() * Sz, 0.8 + r() * r() * 6, 0, TAU); x.fill();
    }
    return ctex(c, true, [2, 2]);
  }
  function texSmudge() {
    var Sz = 512, c = cvs(Sz, Sz), x = c.getContext('2d'), r = rng(9), i;
    x.clearRect(0, 0, Sz, Sz);
    for (i = 0; i < 30; i++) {
      var px = Sz / 2 + (r() - 0.5) * Sz * 0.5, py = Sz / 2 + (r() - 0.5) * Sz * 0.5, rr = 10 + r() * 34;
      var g = x.createRadialGradient(px, py, 0, px, py, rr);
      var oil = r() < 0.5;
      g.addColorStop(0, oil ? 'rgba(214,170,80,0.32)' : 'rgba(110,60,24,0.42)'); g.addColorStop(1, 'rgba(110,60,24,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, rr * (1 + r()), rr, r() * 3, 0, TAU); x.fill();
    }
    x.strokeStyle = 'rgba(96,52,20,0.35)'; x.lineCap = 'round';
    for (i = 0; i < 5; i++) {
      x.lineWidth = 3 + r() * 6; x.beginPath();
      var sx = Sz / 2 + (r() - 0.5) * 200, sy = Sz / 2 + (r() - 0.5) * 200;
      x.moveTo(sx, sy); x.quadraticCurveTo(sx + (r() - 0.5) * 140, sy + (r() - 0.5) * 140, sx + (r() - 0.5) * 160, sy + (r() - 0.5) * 160); x.stroke();
    }
    return ctex(c, true);
  }

  // ---------- 料理・ふきんの形 ----------
  function riceGeo(heap) {
    var p = [[0.84, -0.5], [0.97, -0.14], [1.0, 0]], i, n = 22;
    for (i = 1; i <= n; i++) {
      var rho = 1 - i / n;
      p.push([rho, heap ? Math.pow(1 - Math.pow(rho, 1.7), 1.1) : Math.sqrt(Math.max(0, 1 - rho * rho))]);
    }
    var g = lathe(p, 48, 'arc'), pos = g.attributes.position;
    for (i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var k = 1 + 0.035 * fbm(x * 9, y * 9, z * 9, 2.2), up = y > 0 ? 1 : 0;
      pos.setXYZ(i, x * k, y + up * 0.035 * fbm(x * 7 + 3, y * 7, z * 7, 5.1), z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function karaGeo(sd) {
    var g = new T.SphereGeometry(1, 26, 18), pos = g.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var k = 1 + 0.2 * fbm(x * 1.2, y * 1.2, z * 1.2, sd) + 0.07 * fbm(x * 4.2, y * 4.2, z * 4.2, sd + 3) + 0.03 * Math.abs(Math.sin(x * 9 + z * 7 + sd));
      x *= k; y *= k; z *= k;
      if (y < -0.5) y = -0.5 + (y + 0.5) * 0.25;
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }
  function clothGeo() {
    var g = new T.SphereGeometry(1, 44, 30), pos = g.attributes.position, minY = 9;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var k = 1 + 0.12 * Math.abs(Math.sin(x * 2.4 + z * 0.9 + Math.sin(y * 2.0) * 0.8)) + 0.09 * Math.abs(Math.sin(z * 2.8 - x * 1.1 + 0.7))
        + 0.05 * Math.abs(Math.sin(x * 4.1 - z * 3.3 + 1.9)) + 0.18 * fbm(x * 0.9, y * 0.9, z * 0.9, 0.7) - 0.1;
      x *= k * 0.056; y *= k * 0.032; z *= k * 0.046;
      if (y < -0.012) y = -0.012 + (y + 0.012) * 0.22;
      pos.setXYZ(i, x, y, z);
      if (y < minY) minY = y;
    }
    g.computeVertexNormals();
    var uv = g.attributes.uv;
    for (i = 0; i < pos.count; i++) {
      var px = pos.getX(i), pz = pos.getZ(i);
      uv.setXY(i, px / 0.12 + 0.5 + 0.05 * Math.sin(pz * 70), pz / 0.1 + 0.5 + 0.04 * Math.sin(px * 55 + 1));
    }
    g.userData.minY = minY;
    return g;
  }
  function foldedGeo() {
    var g = new T.BoxGeometry(0.118, 0.014, 0.094, 18, 2, 14), pos = g.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var ex2 = Math.max(Math.abs(x) / 0.059, Math.abs(z) / 0.047), e = sm((ex2 - 0.86) / 0.14);
      var yy = y * (1 - 0.55 * e) + 0.007 + 0.0009 * Math.sin(x * 120 + z * 40) * (y > 0 ? 1 : 0);
      if (y > 0) yy -= 0.0016 * e;
      pos.setXYZ(i, x * (1 - 0.015 * e), yy, z * (1 - 0.015 * e));
    }
    g.computeVertexNormals();
    return g;
  }

  // ---------- マスク（canvas = 見た目、grid = 乾き具合と水滴） ----------
  var MS = 128, GN = 40;
  function Mask(d) {
    var c = cvs(MS, MS);
    this.c = c; this.x = c.getContext('2d');
    this.tex = new T.CanvasTexture(c);
    this.tex.flipY = false; this.tex.generateMipmaps = false;
    this.tex.minFilter = this.tex.magFilter = T.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = T.ClampToEdgeWrapping;
    var gr = this.x.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    this.grad = gr;
    this.xy = d.isGlass;
    var Rr = d.r * 1.1;
    this.ax = 1 / (2 * Rr); this.bx = 0.5;
    if (this.xy) { this.ay = 1 / (d.h * 1.02); this.by = 0; } else { this.ay = this.ax; this.by = 0.5; }
    this.grid = new Float32Array(GN * GN);
    this.valid = new Uint8Array(GN * GN);
    this.nValid = 0; this.sum = 0; this.dirty = true;
    for (var gy = 0; gy < GN; gy++) for (var gx = 0; gx < GN; gx++) {
      var X = ((gx + 0.5) / GN - this.bx) / this.ax, Y = ((gy + 0.5) / GN - this.by) / this.ay, ok;
      ok = this.xy ? (Math.abs(X) <= d.r * 0.95 && Y >= 0.006 && Y <= d.h - 0.003) : (X * X + Y * Y <= d.r * d.r);
      if (ok) { this.valid[gy * GN + gx] = 1; this.nValid++; }
    }
    this.clear();
  }
  Mask.prototype.clear = function () {
    this.x.fillStyle = '#000'; this.x.fillRect(0, 0, MS, MS);
    this.grid.fill(0); this.sum = 0; this.dirty = true;
  };
  Mask.prototype.fill = function () {
    this.x.fillStyle = '#fff'; this.x.fillRect(0, 0, MS, MS);
    this.grid.fill(1); this.sum = this.nValid; this.dirty = true;
  };
  Mask.prototype.stamp = function (X, Y, br) {
    var u = X * this.ax + this.bx, v = Y * this.ay + this.by, ru = br * this.ax, rv = br * this.ay, x = this.x;
    x.save(); x.translate(u * MS, v * MS); x.scale(ru * MS, rv * MS);
    x.fillStyle = this.grad; x.beginPath(); x.arc(0, 0, 1, 0, TAU); x.fill(); x.restore();
    this.dirty = true;
    var g0 = Math.max(0, Math.floor((u - ru) * GN)), g1 = Math.min(GN - 1, Math.ceil((u + ru) * GN));
    var h0 = Math.max(0, Math.floor((v - rv) * GN)), h1 = Math.min(GN - 1, Math.ceil((v + rv) * GN));
    for (var gy = h0; gy <= h1; gy++) for (var gx = g0; gx <= g1; gx++) {
      var du = ((gx + 0.5) / GN - u) / ru, dv = ((gy + 0.5) / GN - v) / rv, dd = Math.sqrt(du * du + dv * dv);
      if (dd >= 1) continue;
      var val = 1 - sm((dd - 0.55) / 0.45), k = gy * GN + gx;
      if (val > this.grid[k]) { if (this.valid[k]) this.sum += val - this.grid[k]; this.grid[k] = val; }
    }
  };
  Mask.prototype.at = function (u, v) {
    var gx = clamp((u * GN) | 0, 0, GN - 1), gy = clamp((v * GN) | 0, 0, GN - 1);
    return this.grid[gy * GN + gx];
  };

  // =====================================================================
  // Dish
  // =====================================================================
  var CFG = {
    plate: { seed: 101, drops: 100, du: 0.0066, cloth: 1.0 },
    bowlL: { seed: 202, drops: 92, du: 0.0048, cloth: 0.78, foot: 0.47 },
    bowlM: { seed: 303, drops: 84, du: 0.0043, cloth: 0.7, foot: 0.46 },
    bowlS: { seed: 404, drops: 72, du: 0.0038, cloth: 0.62, foot: 0.48 },
    glass: { seed: 505, drops: 80, du: 0.0034, cloth: 0.7 }
  };
  var FOODMAX = { plate: 5, bowlL: 6, bowlM: 3, bowlS: 3, glass: 3 };

  function Dish(id) {
    var Ld = G.L.dish[id], cf = CFG[id];
    this.id = id; this.r = Ld.r; this.h = Ld.h; this.cf = cf;
    this.isGlass = id === 'glass'; this.isPlate = id === 'plate'; this.isBowl = !this.isGlass && !this.isPlate;
    this.group = new T.Group(); this.group.name = 'dish-' + id;
    this.pivot = new T.Group(); this.group.add(this.pivot);
    this.where = 'sink'; this.shiny = false; this.sk = 0; this._skSet = -1;
    this.foodLeft = 0; this.foodMax = FOODMAX[id];
    this.basePos = new T.Vector3(); this.baseQuat = new T.Quaternion();
    this.P = {};
    this.moving = false; this._mv = null; this._mvD = null;
    this._fromP = new T.Vector3(); this._fromQ = new T.Quaternion();
    this.carry = { x: 0, z: 0, vx: 0, vz: 0, y: 0, lx: 0, lz: 0 };
    this.wigT = 9; this.hopT = 9; this.hopDur = 0.4; this.hopH = 0; this.hopY = 0;
    this.biteT = 9; this.dripT = 3 + Math.random() * 3;
    this.foamK = 0; this.dirtyK = 0;
    this.U = { uMask: { value: null }, uMS: { value: new T.Vector4() }, uWet: { value: 1 }, uGlow: { value: 0 },
      uBand: { value: -9 }, uGlowC: { value: new T.Color(1.0, 0.7, 0.4) } };
    this.mats = [];
    this.lastX = 0; this.lastY = 0; this.lastPT = 0; this.wiping = false;
    this.clothLP = new T.Vector3(); this.clothLN = new T.Vector3(0, 1, 0);
    this._ret = { dried: 0, moved: 0, speed: 0 };
    this._speed = 0;
    buildBody(this);
    this.mask = new Mask(this);
    this.U.uMask.value = this.mask.tex;
    this.U.uMS.value.set(this.mask.ax, this.mask.ay, 1 / this.r, 0);
    buildDrops(this);
    buildFood(this);
    buildDirt(this);
  }

  function glaze(d, o) {
    var m = new T.MeshPhysicalMaterial({ color: o.color != null ? o.color : 0xffffff, map: o.map || null, roughness: 0.24, metalness: 0,
      clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.85 });
    m.color.multiplyScalar(0.87);   // 白とびを防ぐ（磁器の白は 0.8 台）
    m.onBeforeCompile = mkOBC(d.U);
    m.userData.kind = 'glaze';
    d.mats.push(m);
    return m;
  }
  function addMesh(d, g, m, shadow) {
    var me = new T.Mesh(g, m);
    me.castShadow = shadow !== false; me.receiveShadow = true;
    d.pivot.add(me);
    return me;
  }
  function buildBody(d) {
    var R = d.r, H = d.h, seg = 96;
    if (d.isPlate) {
      var pp = plateProfile(R, H);
      d.prof = pp;
      d.topFn = pp.topFn;
      addMesh(d, lathe(pp.top, seg, 'plan', R), glaze(d, { map: texPlate() }));
      addMesh(d, lathe(pp.outer, seg, 'arc'), glaze(d, { color: 0xf3f3ee }));
      d.hull = pp.outer.concat(pp.top);
      d.surf = [sampler(pp.top, function (r) { return r < R * 0.96; })];
      d.surfN = [1];
      d.hitY = 0.014;
    } else if (d.isBowl) {
      var bp = bowlProfile(R, H, d.cf.foot);
      d.prof = bp;
      addMesh(d, lathe(bp.outer, seg, 'arc'), glaze(d, { map: texBowl(d.id, bp, R) }));
      addMesh(d, lathe(bp.inner, seg, 'arc'), glaze(d, { color: 0xf2f3ee }));
      d.hull = bp.outer;
      d.surf = [sampler(bp.inner.slice(3)), sampler(bp.outer, function (r, y) { return y > H * 0.38; })];
      d.surfN = [0.62, 0.38];
      d.hitY = H * 0.7;
    } else {
      var gp = glassProfile(R, H);
      d.prof = gp;
      var gg = lathe(gp.all, seg, 'arc');
      for (var s = 0; s < 2; s++) {
        var m = new T.MeshPhysicalMaterial({ color: 0x1b2628, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.1,
          depthWrite: false, side: s ? T.FrontSide : T.BackSide, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.5 });
        m.defines = { MASK_XY: 1, ABOOST: 1, ABOOST_F: '0.42', ABOOST_S: '1.25' };
        m.onBeforeCompile = mkOBC(d.U);
        m.userData.kind = 'glass';
        d.mats.push(m);
        var me = addMesh(d, gg, m, false);
        me.renderOrder = s ? 12 : 10;
      }
      d.hull = gp.outer;
      d.surf = [sampler(gp.outer, function (r, y) { return y > 0.008 && y < H - 0.004; })];
      d.surfN = [1];
      // 接地の影（ガラスは影を落とさないので、置いた時だけ足もとにうすい影）
      var sh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: S.shadowTex, transparent: true, depthWrite: false, opacity: 0.5, color: 0x000000 }));
      sh.material.color.setRGB(1, 1, 1);
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.0007; sh.scale.setScalar(R * 2.3); sh.renderOrder = 9;
      d.pivot.add(sh); d.contact = sh;
    }
  }

  // ---------- 水滴 ----------
  function buildDrops(d) {
    var cf = d.cf, N = cf.drops, r = rng(cf.seed), o = {}, i, k;
    var mesh = new T.InstancedMesh(S.dropGeo, S.dropMat, N);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.renderOrder = d.isGlass ? 13 : 5;
    d.dropMesh = mesh; d.dropN = N;
    d.dP = new Float32Array(N * 3); d.dQ = new Float32Array(N * 4); d.dS = new Float32Array(N);
    d.dU = new Float32Array(N); d.dV = new Float32Array(N); d.dCur = new Float32Array(N);
    var q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), nv = new T.Vector3();
    var cnt = [], acc = 0;
    for (k = 0; k < d.surf.length; k++) { acc += d.surfN[k]; cnt.push(acc * N); }
    for (i = 0; i < N; i++) {
      var si = 0; while (si < cnt.length - 1 && i >= cnt[si]) si++;
      var s = cf.du * (0.45 + 1.4 * Math.pow(r(), 2.2)); if (r() < 0.08) s *= 1.5;
      for (var tr = 0; tr < 8; tr++) {
        sample(d.surf[si], r, o);
        var ok = true;
        for (var j = 0; j < i && ok; j++) {
          var dx = d.dP[j * 3] - o.x, dy = d.dP[j * 3 + 1] - o.y, dz = d.dP[j * 3 + 2] - o.z;
          var mn = (d.dS[j] + s) * 0.85;
          if (dx * dx + dy * dy + dz * dz < mn * mn) ok = false;
        }
        if (ok) break;
      }
      nv.set(o.nx, o.ny, o.nz).normalize();
      d.dP[i * 3] = o.x + nv.x * 0.0002; d.dP[i * 3 + 1] = o.y + nv.y * 0.0002; d.dP[i * 3 + 2] = o.z + nv.z * 0.0002;
      q.setFromUnitVectors(up, nv); q.toArray(d.dQ, i * 4);
      d.dS[i] = s;
      var X = o.x, Y = d.isGlass ? o.y : o.z;
      d.dU[i] = X * d.mask.ax + d.mask.bx; d.dV[i] = Y * d.mask.ay + d.mask.by;
      d.dCur[i] = 1;
    }
    d.pivot.add(mesh);
    d.dropsBusy = true; d.dropsSnap = true;
    if (d.isPlate) {
      var b = new T.Mesh(S.dropGeo, S.dropMat);
      b.renderOrder = 6; b.castShadow = false;
      d.pivot.add(b);
      d.big = { mesh: b, x: 0, z: 0, alive: false, dodges: 0, anim: null, cool: 0, s: 1, catching: false };
    }
  }
  var MT = null;
  function tmps() {
    if (MT) return MT;
    MT = { m: new T.Matrix4(), p: new T.Vector3(), q: new T.Quaternion(), s: new T.Vector3(), v: new T.Vector3(), v2: new T.Vector3(),
      e: new T.Euler(), q2: new T.Quaternion(), inv: new T.Matrix4(), ro: new T.Vector3(), rd: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    return MT;
  }
  Dish.prototype._updDrops = function (dt) {
    if (!this.dropsBusy) return;
    var M = tmps(), N = this.dropN, wet = this.U.uWet.value, mk = this.mask, any = false, snap = this.dropsSnap;
    var shrink = dt * (this._fastDry ? 3.5 : 7), grow = dt * 4;
    for (var i = 0; i < N; i++) {
      var g = mk.at(this.dU[i], this.dV[i]);
      var tg = wet * (1 - sm((g - 0.3) / 0.35)), c = this.dCur[i], nc;
      if (snap) nc = tg; else nc = tg < c ? Math.max(tg, c - shrink) : Math.min(tg, c + grow);
      if (nc !== c || snap) {
        this.dCur[i] = nc; any = true;
        M.p.fromArray(this.dP, i * 3); M.q.fromArray(this.dQ, i * 4);
        var s = this.dS[i] * nc + 1e-6;
        M.s.set(s, s * (0.5 + 0.1 * nc), s);
        M.m.compose(M.p, M.q, M.s);
        this.dropMesh.setMatrixAt(i, M.m);
      }
    }
    this.dropsSnap = false;
    if (any) this.dropMesh.instanceMatrix.needsUpdate = true;
    else { this.dropsBusy = false; this._fastDry = false; }
  };

  // ---------- にげるしずく（大皿） ----------
  Dish.prototype._bigReset = function () {
    var b = this.big; if (!b) return;
    var a = 0.9 + Math.random() * 0.8;
    b.x = Math.cos(a) * this.r * 0.45; b.z = Math.sin(a) * this.r * 0.45;
    b.alive = true; b.dodges = 0; b.anim = null; b.cool = 0; b.s = 1; b.catching = false;
    this._bigPlace(1, 0, 0);
  };
  Dish.prototype._bigPlace = function (s, dx, dz) {
    var b = this.big, m = b.mesh, rho = Math.sqrt(b.x * b.x + b.z * b.z);
    m.visible = s > 0.01;
    m.position.set(b.x, this.topFn(rho) + 0.0002, b.z);
    var st = Math.sqrt(dx * dx + dz * dz);
    m.rotation.set(0, st > 1e-6 ? Math.atan2(dx, dz) : 0, 0);
    var R0 = 0.0074 * s;
    m.scale.set(R0 * (1 - 0.25 * st), R0 * 0.62 * (1 - 0.2 * st), R0 * (1 + 0.9 * st));
  };
  Dish.prototype._bigCheck = function (X, Y, br) {
    var b = this.big;
    if (!b || !b.alive || b.anim || b.cool > 0 || this.U.uWet.value <= 0) return;
    var dx = b.x - X, dz = b.z - Y, dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > br * 0.85 + 0.005) return;
    var raw = this.mask.sum / this.mask.nValid, R = this.r, tx, tz, sec;
    if (raw < 0.55) {   // まだ早い: 先へ押しやられる（数えない）
      var l = dist > 1e-5 ? dist : 1; var ux = dist > 1e-5 ? dx / l : 1, uz = dist > 1e-5 ? dz / l : 0;
      tx = X + ux * br * 1.2; tz = Y + uz * br * 1.2;
      var rr = Math.sqrt(tx * tx + tz * tz);
      if (rr > R * 0.75) { var cl = Math.sqrt(X * X + Y * Y) || 1; tx = -X / cl * R * 0.55; tz = -Y / cl * R * 0.55; }
      sec = 0.18;
    } else if (b.dodges < 2) {
      b.dodges++;
      var cr = Math.sqrt(X * X + Y * Y), dir;
      if (cr < R * 0.22) dir = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.0;
      else dir = Math.atan2(-Y, -X) + (Math.random() - 0.5) * 1.0;
      tx = Math.cos(dir) * R * 0.58; tz = Math.sin(dir) * R * 0.58;
      sec = 0.4;
      audio('dropDodge');
    } else {
      b.catching = true; b.anim = { t: 0, sec: 0.22, x0: b.x, z0: b.z, x1: X, z1: Y };
      audio('dropCatch');
      return;
    }
    b.anim = { t: 0, sec: sec, x0: b.x, z0: b.z, x1: tx, z1: tz };
  };
  Dish.prototype._updBig = function (dt) {
    var b = this.big;
    if (!b) return;
    if (b.cool > 0) b.cool -= dt;
    if (!b.alive) { if (b.mesh.visible) { b.s = Math.max(0, b.s - dt * 6); this._bigPlace(b.s, 0, 0); } return; }
    if (this.U.uWet.value <= 0) { b.mesh.visible = false; return; }
    var a = b.anim;
    if (!a) { this._bigPlace(b.s, 0, 0); return; }
    a.t += dt;
    var k = Math.min(1, a.t / a.sec), e = G.util.easeOutCubic(k);
    b.x = lerp(a.x0, a.x1, e); b.z = lerp(a.z0, a.z1, e);
    var st = Math.sin(Math.PI * k) * 0.6;
    if (b.catching) { b.s = 1 - k; }
    var dl = Math.sqrt((a.x1 - a.x0) * (a.x1 - a.x0) + (a.z1 - a.z0) * (a.z1 - a.z0)) || 1;
    this._bigPlace(b.s, (a.x1 - a.x0) / dl * st, (a.z1 - a.z0) / dl * st);
    if (k >= 1) {
      b.anim = null; b.cool = 0.25;
      if (b.catching) { b.alive = false; b.catching = false; b.s = 0; b.mesh.visible = false; }
    }
  };

  // ---------- 泡 ----------
  function buildFoam(d) {
    var N = d.isPlate ? 96 : d.isGlass ? 44 : 70, r = rng(d.cf.seed + 9), o = {}, i;
    var inv = d.P.sink.q.clone().invert();
    var up = new T.Vector3(0, 1, 0).applyQuaternion(inv);
    d.foamDown = up.clone().negate();
    var t1 = new T.Vector3(1, 0, 0); if (Math.abs(up.x) > 0.9) t1.set(0, 0, 1);
    t1.sub(up.clone().multiplyScalar(t1.dot(up))).normalize();
    var t2 = new T.Vector3().crossVectors(up, t1);
    var centers = [], R = d.r;
    if (d.isBowl) centers.push(new T.Vector3(0, d.h * 0.72, 0).addScaledVector(up, d.h * 0.1));
    var all = d.isGlass ? [sampler(d.prof.outer)] : d.surf;
    for (var tr = 0; tr < 200 && centers.length < (d.isBowl ? 3 : 3); tr++) {
      var sm0 = all[tr % all.length];
      sample(sm0, r, o);
      if (o.nx * up.x + o.ny * up.y + o.nz * up.z < 0.35) continue;
      var c = new T.Vector3(o.x, o.y, o.z), far = true;
      for (var j = 0; j < centers.length; j++) if (centers[j].distanceTo(c) < R * 0.6) far = false;
      if (far) centers.push(c);
    }
    if (!centers.length) centers.push(new T.Vector3(0, d.h, 0));
    var mesh = new T.InstancedMesh(S.foamGeo, S.foamMat, N);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    d.foamMesh = mesh; d.foamN = N; d.foamP = new Float32Array(N * 3); d.foamR = new Float32Array(N);
    d.foamTh = new Float32Array(N); d.foamFall = new Float32Array(N);
    var cr = R * (d.isPlate ? 0.62 : 0.82);
    for (i = 0; i < N; i++) {
      var cc = centers[i < N * 0.45 ? 0 : (i % centers.length)];
      var a = r() * TAU, rr = Math.sqrt(r()) * cr, fall = 1 - rr / cr;
      var rad = R * (r() < 0.3 ? lerp(0.2, 0.34, r()) * (0.6 + 0.4 * fall) : lerp(0.045, 0.13, r()));
      if (d.isPlate) rad *= 0.75;
      var p = cc.clone().addScaledVector(t1, Math.cos(a) * rr).addScaledVector(t2, Math.sin(a) * rr)
        .addScaledVector(up, rad * 0.35 + r() * cr * 0.42 * fall);
      p.toArray(d.foamP, i * 3);
      d.foamR[i] = rad; d.foamTh[i] = r(); d.foamFall[i] = 0.5 + r() * 0.5;
    }
    d.pivot.add(mesh);
    d.setFoam(0);
  }

  // ---------- 料理 ----------
  function buildFood(d) {
    var F = d.food = { meshes: [] };
    if (d.isPlate) {
      var top = d.topFn, r = rng(66);
      var kp = [[-0.03, 0.032], [0.004, 0.047], [0.036, 0.03], [-0.012, 0.006], [0.022, -0.002]];
      F.kara = [];
      for (var i = 0; i < 5; i++) {
        var m = new T.Mesh(S.karaGeo[i % 2], S.karaMat);
        var sx = 0.0215 + r() * 0.003, sy = 0.015 + r() * 0.002, sz = 0.019 + r() * 0.003;
        var x = kp[i][0], z = kp[i][1], rho = Math.sqrt(x * x + z * z);
        m.position.set(x, top(rho) + 0.5 * sy - 0.0006, z);
        m.rotation.set((r() - 0.5) * 0.2, r() * TAU, (r() - 0.5) * 0.2);
        m.scale.set(sx, sy, sz);
        m.castShadow = m.receiveShadow = true;
        m.userData.s = m.scale.clone();
        d.pivot.add(m); F.kara.push(m); F.meshes.push(m);
      }
      F.order = [3, 4, 0, 2, 1];
      // 千切りキャベツ
      var N = 190, cab = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), N);
      var M = tmps(), col = new T.Color(), cx = -0.022, cz = -0.042, CR = 0.044, CH = 0.036;
      for (i = 0; i < N; i++) {
        var rr = Math.sqrt(r()) * CR, a = r() * TAU, px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
        var hm = CH * Math.pow(1 - rr / CR, 0.9), py = top(Math.sqrt(px * px + pz * pz)) + 0.001 + r() * hm;
        M.e.set((r() - 0.5) * 0.7, r() * TAU, (r() - 0.5) * 0.5); M.q.setFromEuler(M.e);
        M.p.set(px, py, pz); M.s.set(0.026 + r() * 0.016, 0.0007, 0.0015 + r() * 0.0006);
        M.m.compose(M.p, M.q, M.s); cab.setMatrixAt(i, M.m);
        col.setRGB(lerp(0.78, 0.93, r()), lerp(0.86, 0.95, r()), lerp(0.55, 0.78, r()));
        cab.setColorAt(i, col);
      }
      cab.castShadow = true; cab.receiveShadow = true; cab.frustumCulled = false;
      d.pivot.add(cab); F.cab = cab; F.meshes.push(cab);
      // ミニトマト
      F.tom = [];
      var tg = new T.SphereGeometry(0.0125, 24, 16), tm = new T.MeshPhysicalMaterial({ color: 0xc8200f, roughness: 0.16, clearcoat: 0.9, clearcoatRoughness: 0.08 });
      var leafM = new T.MeshStandardMaterial({ color: 0x3d6a22, roughness: 0.6 }), leafG = new T.BoxGeometry(0.0065, 0.0008, 0.0019);
      var tp = [[0.058, -0.048], [0.07, -0.016]];
      for (i = 0; i < 2; i++) {
        var tgp = new T.Group(), ts = new T.Mesh(tg, tm);
        ts.scale.set(1, 0.9, 1); ts.castShadow = ts.receiveShadow = true; tgp.add(ts);
        for (var k = 0; k < 5; k++) {
          var lf = new T.Mesh(leafG, leafM), an = k / 5 * TAU;
          lf.position.set(Math.cos(an) * 0.0028, 0.0113, Math.sin(an) * 0.0028); lf.rotation.set(0, -an, -0.25); tgp.add(lf);
        }
        var stem = new T.Mesh(new T.CylinderGeometry(0.0007, 0.0009, 0.004, 6), leafM); stem.position.y = 0.0128; tgp.add(stem);
        var tx = tp[i][0], tz = tp[i][1];
        tgp.position.set(tx, top(Math.sqrt(tx * tx + tz * tz)) + 0.0112, tz);
        tgp.rotation.set(0.2 * i, i * 1.3, 0.15);
        d.pivot.add(tgp); F.tom.push(tgp); F.meshes.push(tgp);
      }
    } else if (d.isBowl) {
      var heap = d.id === 'bowlL';
      var rm = new T.Mesh(heap ? S.heapGeo : S.riceGeo, S.riceMat);
      rm.castShadow = rm.receiveShadow = true;
      d.pivot.add(rm); F.rice = rm; F.meshes.push(rm);
      F.full = heap ? d.h * 1.25 : d.h * 0.34; F.baseF = heap ? 0.8 : 0.76;
    } else {
      var lg = new T.CylinderGeometry(1, 1, 1, 48, 1, false);
      var lm = new T.MeshPhysicalMaterial({ color: 0x6e3308, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.88,
        depthWrite: false, envMapIntensity: 1.2, ior: 1.33 });
      var liq = new T.Mesh(lg, lm); liq.renderOrder = 11; liq.castShadow = false;
      F.liq = liq; F.liqBase = lg.attributes.position.array.slice(0); F.meshes.push(liq);
      d.pivot.add(liq);
    }
    F.k = 0; F.target = 0;
    for (var q = 0; q < F.meshes.length; q++) F.meshes[q].visible = false;
  }
  Dish.prototype._setLevel = function (k) {
    var F = this.food, gp = this.prof, liq = F.liq;
    if (k <= 0.002) { liq.visible = false; return; }
    liq.visible = true;
    var y0 = gp.tb - 0.0002, L = lerp(y0 + 0.002, this.h * 0.8, k), a = F.liqBase, pos = liq.geometry.attributes.position, arr = pos.array;
    var rt = gp.innerR(L), rb = gp.innerR(y0 + 0.003) - 0.0012;
    for (var i = 0; i < arr.length; i += 3) {
      var top = a[i + 1] > 0, rs = top ? rt : rb;
      arr[i] = a[i] * rs; arr[i + 1] = top ? L : y0; arr[i + 2] = a[i + 2] * rs;
    }
    pos.needsUpdate = true;
    liq.geometry.computeBoundingSphere();
  };
  Dish.prototype._setRice = function (k) {
    var F = this.food, m = F.rice;
    if (k <= 0.002) { m.visible = false; return; }
    m.visible = true;
    var by = this.h * (F.baseF - 0.42 * (1 - k)), br = interp(this.prof.tab, 1, 0, by) * 0.985;
    m.position.set(0, by, 0);
    m.scale.set(br, F.full * (0.28 + 0.72 * k), br);
  };

  // ---------- よごれ ----------
  function buildDirt(d) {
    if (d.isPlate) {
      var p = [], tp = d.prof.top;
      for (var i = 6; i < tp.length; i++) p.push([tp[i][0], tp[i][1] + 0.0003]);
      var m = new T.Mesh(lathe(p, 64, 'plan', d.r), new T.MeshStandardMaterial({ map: texSmudge(), transparent: true, depthWrite: false,
        roughness: 0.25, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.renderOrder = 4; m.visible = false; m.receiveShadow = true;
      d.pivot.add(m); d.dirt = m;
    } else if (d.isBowl) {
      var N = 8, gm = new T.InstancedMesh(S.grainGeo, S.grainMat, N), r = rng(d.cf.seed + 3), o = {}, M = tmps();
      var sp = sampler(d.prof.inner.slice(3), function (rho, y) { return y < d.h * 0.62; });
      d.grainM = [];
      for (var j = 0; j < N; j++) {
        sample(sp, r, o, -1.2, 1.2);
        var n = new T.Vector3(o.nx, o.ny, o.nz).normalize(), q = new T.Quaternion().setFromUnitVectors(M.up, n);
        q.multiply(new T.Quaternion().setFromAxisAngle(M.up, r() * TAU));
        var pp = new T.Vector3(o.x, o.y, o.z).addScaledVector(n, 0.0009);
        d.grainM.push({ p: pp, q: q });
      }
      gm.frustumCulled = false; gm.castShadow = false; gm.visible = false;
      d.pivot.add(gm); d.dirt = gm;
    }
  }

  // ---------- 置き場所の姿勢 ----------
  function lowest(d, q, outLocal) {
    var M = tmps(); M.m.makeRotationFromQuaternion(q);
    var e = M.m.elements, hp = d.hull, mn = 1e9;
    for (var i = 0; i < hp.length; i++) {
      var rho = hp[i][0], y = hp[i][1];
      for (var k = 0; k < 48; k++) {
        var ph = k / 48 * TAU, x = rho * Math.sin(ph), z = rho * Math.cos(ph);
        var wy = e[1] * x + e[5] * y + e[9] * z;
        if (wy < mn) { mn = wy; if (outLocal) outLocal.set(x, y, z); }
      }
      if (rho < 1e-6) continue;
    }
    return mn;
  }
  function computePoses() {
    var L = G.L, X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0), plate = byId.plate, i;
    for (i = 0; i < D.list.length; i++) {
      var d = D.list[i], id = d.id, P = d.P;
      P.mat = { p: new T.Vector3(L.mat.x, L.mat.top, L.mat.z), q: new T.Quaternion() };
      var sp = L.spots[id];
      P.spot = { p: new T.Vector3(sp.x, L.table.top, sp.z), q: new T.Quaternion() };
      var rs = L.rackSlots[id], qr = new T.Quaternion();
      if (d.isGlass) qr.setFromAxisAngle(X, Math.PI); else qr.setFromAxisAngle(X, Math.PI / 2 - (rs.lean || 0));
      d.rackLow = new T.Vector3();
      var mn = lowest(d, qr, d.rackLow);
      P.rack = { p: new T.Vector3(rs.x, L.counter.top + 0.012 - mn, rs.z), q: qr };
    }
    // シンク: 大皿が先。ほかは大皿から離れる向きに傾け、大皿にめり込まないよう持ち上げる
    var ps = L.sinkSlots.plate;
    plate.P.sink = { p: new T.Vector3(ps.x, L.sink.floorY - lowest(plate, new T.Quaternion()) + 0.0005, ps.z), q: new T.Quaternion() };
    var pp = plate.P.sink.p, M = tmps();
    for (i = 0; i < D.list.length; i++) {
      var dd = D.list[i]; if (dd.isPlate) continue;
      var s = L.sinkSlots[dd.id], q = new T.Quaternion();
      var dx = pp.x - s.x, dz = pp.z - s.z, dl = Math.sqrt(dx * dx + dz * dz) || 1; dx /= dl; dz /= dl;
      if (dd.isGlass) {
        q.setFromUnitVectors(Y, new T.Vector3(-dz, 0, dx).normalize());
      } else {
        var ax = new T.Vector3().crossVectors(Y, new T.Vector3(-dx, 0, -dz)).normalize();
        q.setFromAxisAngle(ax, Math.abs(s.tilt || 0) + 0.04);
      }
      q.multiply(new T.Quaternion().setFromAxisAngle(Y, dd.cf.seed * 0.37));
      var p = new T.Vector3(s.x, L.sink.floorY - lowest(dd, q) + 0.0005, s.z);
      M.m.makeRotationFromQuaternion(q);
      var e = M.m.elements, lift = 0, hp = dd.hull;
      for (var a = 0; a < hp.length; a++) for (var k = 0; k < 32; k++) {
        var ph = k / 32 * TAU, x = hp[a][0] * Math.sin(ph), y = hp[a][1], z = hp[a][0] * Math.cos(ph);
        var wx = p.x + e[0] * x + e[4] * y + e[8] * z, wy = p.y + e[1] * x + e[5] * y + e[9] * z, wz = p.z + e[2] * x + e[6] * y + e[10] * z;
        var rr = Math.sqrt((wx - pp.x) * (wx - pp.x) + (wz - pp.z) * (wz - pp.z));
        if (rr < plate.r * 0.98) lift = Math.max(lift, pp.y + plate.topFn(rr) + 0.0012 - wy);
      }
      p.y += lift;
      dd.P.sink = { p: p, q: q };
    }
  }

  // ---------- 移動 ----------
  Dish.prototype._cancelMove = function () {
    if (this._mv) { this._mv.cancel(); this._mv = null; }
    if (this._mvD) { this._mvD.cancel(); this._mvD = null; }
    this.moving = false;
  };
  Dish.prototype._moveTo = function (where, o) {
    o = o || {};
    var self = this, P = this.P[where];
    this._cancelMove();
    if (!P) return;
    if (o.instant) {
      this.basePos.copy(P.p); this.baseQuat.copy(P.q); this.where = where;
      this._compose();
      if (o.onDone) { try { o.onDone(); } catch (e) {} }
      return;
    }
    var start = function () {
      self._mvD = null;
      self._fromP.copy(self.basePos); self._fromQ.copy(self.baseQuat);
      var dist = self._fromP.distanceTo(P.p);
      var sec = o.sec > 0 ? o.sec : clamp(0.5 + dist * 0.55, 0.55, 1.3);
      var arc = Math.min(0.32, 0.05 + dist * 0.22), fp = self._fromP, fq = self._fromQ;
      var sway = (Math.random() - 0.5) * 0.5;
      self.moving = true;
      self._mv = G.tween(sec, function (k) {
        self.basePos.lerpVectors(fp, P.p, k);
        self.basePos.y += Math.sin(Math.PI * k) * arc;
        self.baseQuat.slerpQuaternions(fq, P.q, k);
        var M = tmps(); M.e.set(Math.sin(Math.PI * k) * 0.18, 0, Math.sin(Math.PI * k) * sway);
        M.q2.setFromEuler(M.e); self.baseQuat.premultiply(M.q2);
      }, { ease: 'easeInOutCubic', onDone: function () {
        self._mv = null; self.moving = false;
        self.basePos.copy(P.p); self.baseQuat.copy(P.q); self.where = where;
        if (o.onDone) { try { o.onDone(); } catch (e) {} }
      } });
    };
    if (o.delay > 0) this._mvD = G.after(o.delay, start); else start();
  };
  Dish.prototype.toSink = function (o) { this._moveTo('sink', o); };
  Dish.prototype.toRack = function (o) { this._moveTo('rack', o); };
  Dish.prototype.toMat = function (o) { this._moveTo('mat', o); };
  Dish.prototype.toSpot = function (o) { this._moveTo('spot', o); };
  Dish.prototype.beginCarry = function () {
    this._cancelMove();
    var c = this.carry;
    c.x = c.lx = this.basePos.x; c.z = c.lz = this.basePos.z; c.vx = c.vz = 0; c.y = this.basePos.y;
    this.where = 'carry';
  };
  Dish.prototype.carryTo = function (x, z) {
    if (this.where !== 'carry') this.beginCarry();
    if (isFinite(x)) this.carry.x = x;
    if (isFinite(z)) this.carry.z = z;
  };
  function carryY(x, z) {
    var L = G.L, C = L.counter, Tb = L.table, Rk = L.rack;
    var zc = C.z0 - 0.05, zt = Tb.z + Tb.r * 0.85, yC = C.top + 0.09, yT = Tb.top + 0.07, y;
    var dx = x - Tb.x, dz = z - Tb.z, inT = dx * dx + dz * dz < Tb.r * Tb.r;
    if (z > zc) y = yC; else if (inT || z < zt) y = yT; else y = lerp(yT, yC, sm((z - zt) / (zc - zt)));
    var ex2 = Math.max(0, Math.abs(x - Rk.x) - Rk.w / 2), ez = Math.max(0, Math.abs(z - Rk.z) - Rk.d / 2);
    return y + 0.16 * (1 - sm(Math.sqrt(ex2 * ex2 + ez * ez) / 0.07));
  }
  Dish.prototype._updCarry = function (dt) {
    if (this.where !== 'carry' || this.moving || dt <= 0) return;
    var c = this.carry, U = G.util, bp = this.basePos, M = tmps();
    var nx = U.damp(bp.x, c.x, 18, dt), nz = U.damp(bp.z, c.z, 18, dt);
    var vx = (nx - bp.x) / dt, vz = (nz - bp.z) / dt;
    c.vx = U.damp(c.vx, vx, 10, dt); c.vz = U.damp(c.vz, vz, 10, dt);
    bp.x = nx; bp.z = nz;
    bp.y = U.damp(bp.y, carryY(nx, nz), 12, dt);
    var sp = Math.sqrt(c.vx * c.vx + c.vz * c.vz), ang = Math.min(0.32, sp * 0.22);
    if (sp > 1e-4) { M.v.set(c.vz / sp, 0, -c.vx / sp); M.q2.setFromAxisAngle(M.v, -ang); } else M.q2.identity();
    this.baseQuat.slerp(M.q2, ex(12, dt));
  };
  Dish.prototype.center = function (out) {
    out = out || new T.Vector3();
    this.group.updateMatrixWorld(true);
    out.set(0, this.h * 0.5, 0);
    return this.group.localToWorld(out);
  };
  Dish.prototype.wiggle = function () { this.wigT = 0; };
  Dish.prototype.hop = function (h) {
    this.hopH = h > 0 ? h : 0.03; this.hopT = 0; this.hopDur = clamp(0.26 + this.hopH * 2.2, 0.3, 0.6);
  };
  Dish.prototype.setGlow = function (g) { this.U.uGlow.value = clamp(+g || 0, 0, 1); };
  Dish.prototype._compose = function () {
    var g = this.group, M = tmps();
    g.position.copy(this.basePos); g.position.y += this.hopY;
    g.quaternion.copy(this.baseQuat);
    if (this.wigT < 0.35) {
      var k = this.wigT / 0.35, a = (1 - k) * 0.07;
      M.e.set(Math.sin(this.wigT * 61) * a * 0.6, 0, Math.sin(this.wigT * 47 + 1) * a);
      M.q2.setFromEuler(M.e); g.quaternion.multiply(M.q2);
    }
    g.updateMatrixWorld(true);
  };

  // ---------- ぬれ・ふき ----------
  Dish.prototype.setWet = function (k) {
    k = clamp(+k || 0, 0, 1);
    this.U.uWet.value = k;
    if (k > 0) {
      this.mask.clear(); this.shiny = false; this.sk = 0;
      if (this.big) this._bigReset();
    } else {
      this.mask.fill();
      if (this.big) { this.big.alive = false; this.big.anim = null; this.big.mesh.visible = false; }
    }
    this.dropsBusy = true; this.dropsSnap = true;
  };
  Dish.prototype.dryness = function () {
    if (this.U.uWet.value <= 0) return 1;
    var v = clamp(this.mask.sum / this.mask.nValid, 0, 1);
    if (this.big && this.big.alive) v = Math.min(v, 0.89);
    return v;
  };
  Dish.prototype.setShiny = function (b) { this.shiny = !!b; this.sk = b ? 1 : 0; };
  Dish.prototype.finishDry = function () {
    var self = this;
    this.mask.fill(); this.dropsBusy = true; this._fastDry = true;
    if (this.big && this.big.alive) { this.big.alive = false; this.big.anim = null; }
    this.shiny = true;
    var s0 = this.sk;
    if (this._shT) this._shT.cancel();
    this._shT = G.tween(0.45, function (k) { self.sk = lerp(s0, 1, k); }, { ease: 'easeOutCubic' });
    if (this._bandT) this._bandT.cancel();
    this._bandT = G.tween(0.5, function (k) { self.U.uBand.value = lerp(-1.7, 2.7, k); },
      { ease: function (t) { return t; }, onDone: function () { self.U.uBand.value = -9; self._bandT = null; } });
  };
  // 指 → 食器ローカルの投影面の点（X, Y）。外にそれたらふちへ寄せる
  Dish.prototype._hit = function (p, out) {
    var M = tmps(), ray = G.screenRay(p.nx || 0, p.ny || 0);
    this.group.updateMatrixWorld(true);
    M.inv.copy(this.group.matrixWorld).invert();
    M.ro.copy(ray.origin).applyMatrix4(M.inv);
    M.rd.copy(ray.direction).transformDirection(M.inv);
    var o = M.ro, d = M.rd, t, X, Y;
    if (this.isGlass) {
      t = Math.abs(d.z) > 1e-4 ? -o.z / d.z : -1;
      if (t < 0) t = -(o.x * d.x + (o.y - this.h / 2) * d.y + o.z * d.z);
      X = o.x + d.x * t; Y = o.y + d.y * t;
      Y = clamp(Y, 0.012, this.h - 0.006);
      var rr = this.prof.rad(Y) * 0.9;
      X = clamp(X, -rr, rr);
    } else {
      t = Math.abs(d.y) > 1e-4 ? (this.hitY - o.y) / d.y : -1;
      if (t < 0) t = -(o.x * d.x + (o.y - this.hitY) * d.y + o.z * d.z);
      X = o.x + d.x * t; Y = o.z + d.z * t;
      var rl = Math.sqrt(X * X + Y * Y), lim = this.r * 0.93;
      if (rl > lim) { X *= lim / rl; Y *= lim / rl; }
    }
    out.x = X; out.y = Y;
    return out;
  };
  // 投影面の点 → ふきんが乗る面の点と法線（ローカル）
  Dish.prototype._surfAt = function (X, Y) {
    var lp = this.clothLP, ln = this.clothLN;
    if (this.isGlass) {
      var rho = this.prof.rad(Y), x = clamp(X, -rho * 0.92, rho * 0.92), z = Math.sqrt(Math.max(0, rho * rho - x * x));
      lp.set(x, Y, z); ln.set(x, 0, z).normalize();
    } else if (this.isPlate) {
      var r = Math.sqrt(X * X + Y * Y), e = 0.004, sl = (this.topFn(r + e) - this.topFn(Math.max(0, r - e))) / (2 * e);
      lp.set(X, this.topFn(r), Y);
      if (r > 1e-5) ln.set(-sl * X / r, 1, -sl * Y / r).normalize(); else ln.set(0, 1, 0);
    } else {
      var tb = this.prof.tab, rmax = tb[tb.length - 1][0], r2 = Math.min(Math.sqrt(X * X + Y * Y), rmax);
      var y = interp(tb, 0, 1, r2), e2 = 0.003;
      var sl2 = (interp(tb, 0, 1, Math.min(rmax, r2 + e2)) - interp(tb, 0, 1, Math.max(0, r2 - e2))) / (2 * e2);
      var rl = Math.sqrt(X * X + Y * Y) || 1, ux = X / rl, uz = Y / rl;
      lp.set(ux * r2, y, uz * r2);
      ln.set(-sl2 * ux, 1, -sl2 * uz).normalize();
      // 茶わんの内側では、ふきんを少し中へ寄せて壁へのめり込みを減らす
      lp.x *= 0.88; lp.z *= 0.88; lp.y = Math.max(lp.y, interp(tb, 0, 1, r2 * 0.88));
    }
  };
  Dish.prototype._brush = function () { return this.r * 0.38; };
  var HP = { x: 0, y: 0 };
  Dish.prototype.wipeBegin = function (p) {
    if (!p) return;
    if (W.dish && W.dish !== this) W.dish.wiping = false;
    W.dish = this; this.wiping = true;
    this._hit(p, HP);
    this.lastX = HP.x; this.lastY = HP.y; this.lastPT = p.time != null ? p.time : G.time;
    this._speed = 0;
    var br = this._brush();
    if (this.big) this._bigCheck(HP.x, HP.y, br);
    if (this.U.uWet.value > 0) { this.mask.stamp(HP.x, HP.y, br * 0.8); this.dropsBusy = true; }
    this._surfAt(HP.x, HP.y);
  };
  Dish.prototype.wipeMove = function (p) {
    var ret = this._ret;
    ret.dried = 0; ret.moved = 0; ret.speed = 0;
    if (!p) return ret;
    if (!this.wiping) { this.wipeBegin(p); return ret; }
    this._hit(p, HP);
    var dx = HP.x - this.lastX, dy = HP.y - this.lastY, dist = Math.sqrt(dx * dx + dy * dy), br = this._brush();
    var before = this.mask.sum, wet = this.U.uWet.value > 0;
    var n = Math.max(1, Math.ceil(dist / (br * 0.3)));
    for (var i = 1; i <= n; i++) {
      var x = this.lastX + dx * i / n, y = this.lastY + dy * i / n;
      if (this.big) this._bigCheck(x, y, br);
      if (wet) this.mask.stamp(x, y, br);
    }
    if (wet) this.dropsBusy = true;
    var pt = p.time != null ? p.time : G.time, dtm = pt - this.lastPT;
    if (!(dtm > 0.004)) dtm = 0.016;
    this._speed = lerp(this._speed, dist / dtm, 0.5);
    this.lastX = HP.x; this.lastY = HP.y; this.lastPT = pt;
    this._surfAt(HP.x, HP.y);
    C.phase += dist * 55;
    ret.dried = wet ? Math.max(0, (this.mask.sum - before) / this.mask.nValid) : 0;
    ret.moved = dist; ret.speed = this._speed;
    return ret;
  };
  Dish.prototype.wipeEnd = function () {
    this.wiping = false;
    if (W.dish === this) W.dish = null;
  };

  // ---------- 泡・料理・よごれ ----------
  Dish.prototype.setFoam = function (k) {
    k = clamp(+k || 0, 0, 1);
    this.foamK = k;
    var mesh = this.foamMesh; if (!mesh) return;
    mesh.visible = k > 0.001;
    if (!mesh.visible) return;
    var M = tmps(), dn = this.foamDown;
    M.q.identity();
    for (var i = 0; i < this.foamN; i++) {
      var th = this.foamTh[i] * 0.8, v = sm((k - th) / 0.2), s = this.foamR[i] * (0.15 + 0.85 * v) * (v > 0.001 ? 1 : 0) + 1e-6;
      var f = (1 - k) * this.foamFall[i] * this.r * 0.5 * (1 - v * 0.5);
      M.p.fromArray(this.foamP, i * 3).addScaledVector(dn, f);
      M.s.set(s, s * (0.86 + 0.14 * v), s);
      M.m.compose(M.p, M.q, M.s); mesh.setMatrixAt(i, M.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  Dish.prototype.serve = function () {
    var F = this.food;
    this.foodLeft = this.foodMax;
    F.target = 1; F.k = 1;
    if (this.isPlate) {
      for (var i = 0; i < F.kara.length; i++) { var m = F.kara[i]; m.visible = true; m.scale.copy(m.userData.s); m.userData.pop = -1; }
      F.cab.visible = true; F.cab.scale.set(1, 1, 1);
      for (i = 0; i < F.tom.length; i++) { F.tom[i].visible = true; F.tom[i].scale.set(1, 1, 1); }
      F.sidePop = -1;
    } else if (this.isBowl) this._setRice(1);
    else this._setLevel(1);
  };
  Dish.prototype.clearFood = function () {
    var F = this.food;
    this.foodLeft = 0; F.target = 0; F.k = 0;
    for (var i = 0; i < F.meshes.length; i++) F.meshes[i].visible = false;
  };
  Dish.prototype.bite = function () {
    if (this.foodLeft <= 0) return 0;
    this.foodLeft--;
    var F = this.food;
    F.target = this.foodLeft / this.foodMax;
    this.biteT = 0;
    if (this.isPlate) {
      var idx = F.order[this.foodMax - this.foodLeft - 1], m = F.kara[idx];
      if (m) m.userData.pop = 0;
      if (this.foodLeft === 0) F.sidePop = 0;
    }
    return this.foodLeft;
  };
  Dish.prototype.setDirty = function (k) {
    k = clamp(+k || 0, 0, 1);
    this.dirtyK = k;
    var m = this.dirt; if (!m) return;
    m.visible = k > 0.001;
    if (this.isPlate) { m.material.opacity = k * 0.9; return; }
    var M = tmps();
    for (var i = 0; i < this.grainM.length; i++) {
      var g = this.grainM[i], v = sm(k * 1.6 - i * 0.07);
      M.s.set(0.0029 * v + 1e-6, 0.0012 * v + 1e-6, 0.0015 * v + 1e-6);
      M.m.compose(g.p, g.q, M.s); m.setMatrixAt(i, M.m);
    }
    m.instanceMatrix.needsUpdate = true;
  };
  Dish.prototype._updFood = function (dt) {
    var F = this.food;
    if (this.biteT < 0.32) {
      this.biteT += dt;
      var k = Math.min(1, this.biteT / 0.32), w = Math.sin(Math.PI * k) * (1 - k * 0.3);
      this.pivot.scale.set(1 + 0.04 * w, 1 - 0.08 * w, 1 + 0.04 * w);
    } else if (this.pivot.scale.y !== 1) this.pivot.scale.set(1, 1, 1);
    if (this.isPlate) {
      for (var i = 0; i < F.kara.length; i++) {
        var m = F.kara[i], u = m.userData;
        if (u.pop >= 0) {
          u.pop += dt;
          var t = u.pop / 0.2, s = t < 0.35 ? 1 + 0.25 * (t / 0.35) : Math.max(0, 1.25 * (1 - (t - 0.35) / 0.65));
          m.scale.copy(u.s).multiplyScalar(s);
          if (t >= 1) { u.pop = -1; m.visible = false; }
        }
      }
      if (F.sidePop >= 0) {
        F.sidePop += dt;
        var t2 = F.sidePop / 0.25, s2 = t2 < 0.3 ? 1 + 0.15 * t2 / 0.3 : Math.max(0, 1.15 * (1 - (t2 - 0.3) / 0.7));
        F.cab.scale.setScalar(s2 + 1e-4);
        for (i = 0; i < F.tom.length; i++) F.tom[i].scale.setScalar(s2 + 1e-4);
        if (t2 >= 1) { F.sidePop = -1; F.cab.visible = false; for (i = 0; i < F.tom.length; i++) F.tom[i].visible = false; }
      }
      return;
    }
    if (Math.abs(F.k - F.target) > 1e-4) {
      F.k = G.util.damp(F.k, F.target, 9, dt);
      if (Math.abs(F.k - F.target) < 0.002) F.k = F.target;
      if (this.isBowl) this._setRice(F.k); else this._setLevel(F.k);
    }
  };

  // ---------- 毎フレーム ----------
  Dish.prototype._update = function (dt) {
    this._updCarry(dt);
    if (this.wigT < 0.35) this.wigT += dt;
    if (this.hopT < this.hopDur) {
      this.hopT += dt;
      var k = Math.min(1, this.hopT / this.hopDur);
      this.hopY = this.hopH * 4 * k * (1 - k);
      if (k >= 1) this.hopY = 0;
    }
    this._compose();
    if (this.mask.dirty) { this.mask.tex.needsUpdate = true; this.mask.dirty = false; }
    this._updDrops(dt);
    this._updBig(dt);
    this._updFood(dt);
    if (this._skSet !== this.sk) {
      this._skSet = this.sk;
      var sk = this.sk;
      for (var i = 0; i < this.mats.length; i++) {
        var m = this.mats[i];
        if (m.userData.kind === 'glass') { m.roughness = lerp(0.07, 0.015, sk); m.envMapIntensity = lerp(1.5, 2.6, sk); }
        else {
          m.roughness = lerp(0.14, 0.05, sk); m.clearcoat = lerp(0.75, 1, sk);
          m.clearcoatRoughness = lerp(0.07, 0.015, sk); m.envMapIntensity = lerp(1.0, 1.9, sk);
        }
      }
    }
    if (this.contact) {
      var up = this.group.matrixWorld.elements[5];
      this.contact.visible = up > 0.95 && !this.moving && (this.where === 'mat' || this.where === 'spot');
    }
    if (this.where === 'rack' && !this.moving && this.dryness() < 0.5) {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 3 + Math.random() * 3;
        if (G.vfx && G.vfx.drip) {
          var M = tmps();
          M.v.copy(this.rackLow); this.group.localToWorld(M.v); M.v.y += 0.004;
          try { G.vfx.drip(M.v, G.L.counter.top + 0.012); } catch (e) {}
        }
      }
    }
  };

  // =====================================================================
  // ふきん
  // =====================================================================
  var C = { phase: 0 }, W = { dish: null };
  function buildCloth() {
    var tex = texCloth();
    var bump = G.assets && G.assets.has && G.assets.has('linen') ? G.assets.tex('linen', { repeat: [3, 3], srgb: false }) : tex;
    var mat = new T.MeshPhysicalMaterial({ color: 0xffffff, map: tex, bumpMap: bump, bumpScale: 0.6, roughness: 0.92, metalness: 0,
      sheen: 0.6, sheenColor: new T.Color(0xffffff), sheenRoughness: 0.75 });
    var ftex = tex.clone(); ftex.needsUpdate = true; ftex.repeat.set(1, 1); ftex.rotation = Math.PI / 2; ftex.center.set(0.5, 0.5);
    var fmat = mat.clone(); fmat.map = ftex;
    C.root = new T.Group(); C.root.name = 'cloth';
    var cg = clothGeo();
    C.crumple = new T.Mesh(cg, mat); C.crumple.castShadow = C.crumple.receiveShadow = true; C.minY = cg.userData.minY;
    C.folded = new T.Mesh(foldedGeo(), fmat); C.folded.castShadow = C.folded.receiveShadow = true;
    C.root.add(C.crumple); C.root.add(C.folded);
    C.pos = new T.Vector3(); C.quat = new T.Quaternion(); C.tq = new T.Quaternion(); C.tp = new T.Vector3(); C.tn = new T.Vector3();
    C.foldK = 1; C.sq = 0; C.s = 0.9; C.init = false;
    G.scene.add(C.root);
    D.cloth = C.root;
  }
  function qUp(n, yaw, out) {
    var M = tmps();
    out.setFromUnitVectors(M.up, n);
    M.q2.setFromAxisAngle(M.up, yaw); out.multiply(M.q2);
  }
  function clothUpdate(dt) {
    var L = G.L, tp = C.tp, tq = C.tq, M = tmps(), fold = 0, s = 0.9, sq = 0, lam = 10, d = W.dish;
    if (d && d.wiping) {
      tp.copy(d.clothLP); d.group.localToWorld(tp);
      C.tn.copy(d.clothLN).applyQuaternion(d.group.quaternion).normalize();
      qUp(C.tn, 0.5 + 0.35 * Math.sin(C.phase), tq);
      s = d.cf.cloth; sq = 1; lam = 42;
    } else {
      var md = null;
      for (var i = 0; i < D.list.length; i++) if (D.list[i].where === 'mat') { md = D.list[i]; break; }
      if (md) {
        tp.set(md.basePos.x + md.r + 0.062, L.mat.top, md.basePos.z + 0.05 + md.r * 0.22);
        qUp(M.up, 0.5, tq);
      } else {
        tp.set(L.mat.x + L.mat.w / 2 - 0.075, L.mat.top, L.mat.z + L.mat.d / 2 - 0.065);
        qUp(M.up, 0.12, tq); fold = 1;
      }
    }
    if (!C.init) { C.pos.copy(tp); C.quat.copy(tq); C.foldK = fold; C.sq = sq; C.s = s; C.init = true; }
    C.pos.lerp(tp, ex(lam, dt));
    C.quat.slerp(tq, ex(Math.min(lam, 26), dt));
    C.foldK = G.util.damp(C.foldK, fold, 9, dt);
    C.sq = G.util.damp(C.sq, sq, 16, dt);
    C.s = G.util.damp(C.s, s, 12, dt);
    C.root.position.copy(C.pos); C.root.quaternion.copy(C.quat);
    var a = 1 - C.foldK, sc = C.s * a, sy = sc * (1 - 0.32 * C.sq);
    C.crumple.visible = a > 0.02;
    C.crumple.scale.set(sc * (1 + 0.1 * C.sq), sy, sc * (1 + 0.1 * C.sq));
    C.crumple.position.y = -C.minY * sy - 0.003 * C.sq;
    C.folded.visible = C.foldK > 0.02;
    C.folded.scale.setScalar(Math.max(1e-4, C.foldK));
  }

  // =====================================================================
  // 公開
  // =====================================================================
  D.build = function () {
    if (D.built) return;
    T = window.THREE;
    if (!T || !G.scene || !G.L) return;
    D.built = true;
    shared();
    D.ids = G.L.dishIds.slice(0);
    D.list = [];
    for (var i = 0; i < D.ids.length; i++) {
      var d = new Dish(D.ids[i]);
      byId[d.id] = d; D.list.push(d);
      G.scene.add(d.group);
    }
    computePoses();
    for (i = 0; i < D.list.length; i++) {
      var dd = D.list[i];
      buildFoam(dd);
      dd.toSink({ instant: true });
      dd.setFoam(0);
      dd.setWet(1);
    }
    buildCloth();
    G.onUpdate(function (dt) {
      for (var j = 0; j < D.list.length; j++) D.list[j]._update(dt);
      clothUpdate(dt);
    });
    G.onQuality(function (q) {
      for (var j = 0; j < D.list.length; j++) {
        var x = D.list[j];
        if (q.low) { x.dropMesh.count = Math.floor(x.dropN * 0.7); x.foamMesh.count = Math.floor(x.foamN * 0.75); }
      }
    });
  };
  D.get = function (id) { return byId[id]; };
  D.wipeView = function (id) {
    var d = byId[id] || byId.plate, L = G.L.mat, r = d ? d.r : 0.1, h = d ? d.h : 0.05;
    var w = Math.max(0.25, r * 2 * 1.62);
    return { look: [L.x + 0.02 + r * 0.16, L.top + h * 0.5, L.z + 0.02], dir: d && d.isGlass ? [0, 0.8, 1] : [0, 1.8, 1],
      w: w, h: w * 0.95, fovP: 46, fovL: 38 };
  };
})();
