/* story.js — お話の進行（段階ごとの操作・ヒント・カメラ・遷移）。最後に G.boot(start)。
   段階（次の 1 操作は常に 1 つ）:
     CURTAIN  朝の和室。カーテンを横に引いて開ける
     DOOR     ガラス戸を横に引いて開ける
     FOLD     かけぶとんを上（窓の方）へ引いてたたむ → 外へ出る遷移
     HANG     ベランダ。腕の束を上へ引いて笠木に掛ける
     CLIP     ふとんばさみ 2 個をかごから運んではさむ
     BEATER   ふとんたたきをタップして持つ
     BEAT     ふとんを叩く（ほこり・物が飛び出す）
     SUN      雲をどかす → 日が当たって段々ふくらむ → ばさみが はじけ飛ぶ → 夕方へ
     TAKE     ふとんを下へ引いて取りこむ → 部屋へ戻る遷移
     SPREAD   夕方の和室。束を手前へ引いて広げる
     PRESS    ふとんを押して ぼよーん（3 回か 10 秒で次へ）
     NIGHT    カーテンを閉める
     SLEEP    夜。17 秒後に翌朝へ（CURTAIN）
   公開:
     G.VIEW = {bed, door, balcony, bedEve}   カメラの view（司令塔が数値を調整）
     G.story = { S, goto(step) }             S は状態。goto は任意の段階の入口状態を作って飛ぶ
*/
(function () {
  'use strict';
  var G = window.G;
  var U = G.util, L = G.L;

  // ---------- カメラ ----------
  var VIEW = G.VIEW = {
    bed: { look: [-0.05, 0.80, 1.30], dir: [0, 0.27, 1], w: 1.75, h: 3.0, fovP: 64, fovL: 50 },
    door: { look: [0, 1.15, 0.0], dir: [0, 0.06, 1], w: 1.3, h: 2.0, fovP: 64, fovL: 50 },
    balcony: { look: [0, 1.25, -1.40], dir: [0, 0.16, 1], w: 1.9, h: 3.0, fovP: 66, fovL: 48 },
    bedEve: { look: [0.03, 0.35, 1.5], dir: [0, 0.6, 1], w: 1.72, h: 2.3, fovP: 64, fovL: 50 }
  };

  var STEPS = ['CURTAIN', 'DOOR', 'FOLD', 'HANG', 'CLIP', 'BEATER', 'BEAT', 'SUN', 'TAKE', 'SPREAD', 'PRESS', 'NIGHT', 'SLEEP'];
  var IDS = ['sockA', 'ball', 'block', 'spoon', 'marble', 'sockB'];
  var FUWA = [1, 1.125, 1.25, 1.5, 1.667];
  var CUR_TRAVEL = 0.88;   // カーテンの端が動く距離 m（だいたい）
  var DOOR_TRAVEL = 0.58;

  var S = {
    step: null, day: 0, found: [], hits: 0, popped: 0, stage: 0, presses: 0,
    curtain: 0, door: 0, cloudK: 0, time: 0,
    // 内部
    scene: 'room', busy: false, trans: false, stepT: 0, busyT: 0, pt: 0, sunT: 0, revealed: false,
    clipSlot: [-1, -1], today: ['sockA', 'ball'], carryLive: false
  };
  G.story = { S: S, goto: goto };

  // ---------- 安全な呼び出し ----------
  var seen = {};
  function rep(n, e) {
    if (seen[n]) return; seen[n] = 1;
    try { console.warn('[story] ' + n, e); } catch (_) {}
  }
  function call(o, n, a, b, c, d) {
    if (!o) return undefined;
    var fn = o[n];
    if (typeof fn !== 'function') return undefined;
    try { return fn.call(o, a, b, c, d); } catch (e) { rep(n, e); return undefined; }
  }
  function W(n, a, b, c) { return call(G.world, n, a, b, c); }
  function F(n, a, b, c) { return call(G.futon, n, a, b, c); }
  function P(n, a, b, c) { return call(G.props, n, a, b, c); }
  function A(n, a, b) { return call(G.audio, n, a, b); }
  function X(n, a, b, c) { return call(G.puff, n, a, b, c); }
  function snd(name, vol, pitch) { A('play', name, { vol: vol == null ? 1 : vol, pitch: pitch == null ? 1 : pitch }); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function fluffNow() { var f = G.futon && G.futon.fluff; return typeof f === 'number' ? f : 0; }

  // 世代: goto で進むと古いタイマーは何もしない
  var gen = 0;
  function later(sec, fn) {
    var g = gen;
    return G.after(sec, function () { if (g === gen) fn(); });
  }
  function anim(sec, fn, done, ease) {
    var g = gen;
    return G.tween(sec, function (k) { if (g === gen) fn(k); }, {
      ease: ease, onDone: function () { if (g === gen && done) done(); }
    });
  }
  var autoH = null;   // カーテン・戸・ふとんの自動の動き（つかみ直しで止める）
  function cancelAuto() { if (autoH) { autoH.cancel(); autoH = null; } }

  // ---------- 使い回しのベクトル ----------
  var hA, hB, tC, tD, tE, bP, bN, carryAnc, lastAnc, rayPt, clipPlane, railPlane, so1, so2, rs, uvR;
  function initVecs() {
    var V = THREE.Vector3;
    hA = new V(); hB = new V(); tC = new V(); tD = new V(); tE = new V();
    bP = new V(); bN = new V(); carryAnc = new V(0, 0.9, 0.3); lastAnc = new V(1e9, 0, 0); rayPt = new V();
    clipPlane = new THREE.Plane(new V(0, 0, 1), -(L.rail.z + 0.2));
    railPlane = new THREE.Plane(new V(0, 0, 1), -L.rail.z);
    so1 = {}; so2 = {}; rs = { l: 0, r: 0, t: 0, b: 0 };
    uvR = { u: 0.5, v: 0.5, point: new V() };
  }

  // ---------- 画面 ----------
  var SW = 390, SH = 844;
  function sd(p, v) {
    G.toScreen(v, so1);
    if (so1.behind) return 1e9;
    var dx = p.x - so1.x, dy = p.y - so1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function sdSeg(p, a, b) {   // 画面上の点と線分の距離
    G.toScreen(a, so1); G.toScreen(b, so2);
    if (so1.behind || so2.behind) return 1e9;
    var ex = so2.x - so1.x, ey = so2.y - so1.y, l2 = ex * ex + ey * ey;
    var t = l2 > 0 ? clamp(((p.x - so1.x) * ex + (p.y - so1.y) * ey) / l2, 0, 1) : 0;
    var dx = p.x - (so1.x + ex * t), dy = p.y - (so1.y + ey * t);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function pxPerM(x, y, z) {
    tE.set(x, y, z); G.toScreen(tE, so1);
    tE.set(x + 1, y, z); G.toScreen(tE, so2);
    return Math.max(40, Math.abs(so2.x - so1.x));
  }
  function rectScreen(x0, x1, y0, y1, z) {
    rs.l = 1e9; rs.r = -1e9; rs.t = 1e9; rs.b = -1e9;
    for (var i = 0; i < 4; i++) {
      tE.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, z);
      G.toScreen(tE, so1);
      if (so1.x < rs.l) rs.l = so1.x; if (so1.x > rs.r) rs.r = so1.x;
      if (so1.y < rs.t) rs.t = so1.y; if (so1.y > rs.b) rs.b = so1.y;
    }
    return rs;
  }
  function inRect(p, r, m) { return p.x >= r.l - m && p.x <= r.r + m && p.y >= r.t - m && p.y <= r.b + m; }
  function screenX(x, y, z) { tE.set(x, y, z); G.toScreen(tE, so1); return so1.x; }
  // 今のカメラの NDC 方向・距離 dist の点（割り当て無し）
  function camPoint(nx, ny, dist, out) {
    var c = G.camera;
    out.set(nx, ny, 0.5).unproject(c).sub(c.position).normalize().multiplyScalar(dist).add(c.position);
    return out;
  }

  // ふとんの当たり: pick → 外れても中心から 130px 以内なら成立。mode 'rail'|'bed' で uv を画面から推定
  function futonUV(p, mode) {
    var r = F('pick', G.screenRay(p.nx, p.ny));
    if (r) { uvR.u = r.u; uvR.v = r.v; uvR.point.copy(r.point); return uvR; }
    F('center', tC);
    if (sd(p, tC) > 130) return null;
    uvR.point.copy(tC); uvR.u = 0.5; uvR.v = mode === 'rail' ? 0.3 : 0.5;
    if (mode === 'rail' || mode === 'bed') {
      var vm = mode === 'rail' ? 0.25 : 0.5, v0 = 0, v1 = mode === 'rail' ? 0.5 : 1;
      F('pointAt', 0, vm, tD); G.toScreen(tD, so1); var x0 = so1.x;
      F('pointAt', 1, vm, tD); G.toScreen(tD, so1); var x1 = so1.x;
      if (Math.abs(x1 - x0) > 1) uvR.u = clamp((p.x - x0) / (x1 - x0), 0, 1);
      F('pointAt', 0.5, v0, tD); G.toScreen(tD, so1); var y0 = so1.y;
      F('pointAt', 0.5, v1, tD); G.toScreen(tD, so1); var y1 = so1.y;
      if (Math.abs(y1 - y0) > 1) uvR.v = clamp(v0 + (v1 - v0) * (p.y - y0) / (y1 - y0), v0, v1);
    }
    return uvR;
  }

  // ---------- 状態の小道具 ----------
  function setCurtain(f) { S.curtain = clamp(f, 0, 1); W('setCurtain', S.curtain); }
  function setDoor(f) { S.door = clamp(f, 0, 1); W('setDoor', S.door); }
  function setCloud(k) { S.cloudK = clamp(k, -1.3, 1.3); W('setCloud', S.cloudK); }
  function setTime(t) { S.time = t; W('setTime', t); }
  function exposure() { var e = W('sunExposure'); return typeof e === 'number' ? e : 0; }
  function dustLeft() { var d = F('dustLeft'); return typeof d === 'number' ? d : 0; }
  function todayOf(day) { return [IDS[(2 * day) % 6], IDS[(2 * day + 1) % 6]]; }
  function trayIds(excludeToday) {
    var out = [];
    for (var i = 0; i < S.found.length; i++) {
      var id = S.found[i];
      if (excludeToday && S.today.indexOf(id) >= 0) continue;
      out.push(id);
    }
    return out;
  }
  function addFound(id) {
    if (S.found.indexOf(id) >= 0) return;
    S.found.push(id);
    try { G.save.set('found', S.found.slice()); } catch (e) {}
  }
  function loadSave() {
    var d = 0, f = [];
    try { d = G.save.get('day', 0); } catch (e) {}
    if (typeof d !== 'number' || !isFinite(d) || d < 0) d = 0;
    S.day = Math.floor(d) % 600;
    try { f = G.save.get('found', []); } catch (e) {}
    S.found = [];
    if (Array.isArray(f)) for (var i = 0; i < f.length; i++) if (IDS.indexOf(f[i]) >= 0 && S.found.indexOf(f[i]) < 0) S.found.push(f[i]);
    S.today = todayOf(S.day);
  }
  function placeSun() {
    try { W('placeSun', G.cam.pointIn(VIEW.balcony, 0.10, 0.58, 150)); } catch (e) { rep('placeSun', e); }
  }
  function calcCarry() {
    try { carryAnc.copy(G.cam.pointIn(VIEW.balcony, 0, -0.80, 0.95)); } catch (e) { rep('pointIn', e); }
  }

  // ---------- ドラッグ（指 1 本） ----------
  var drag = null;
  var LOOPS = ['curtainSlide', 'doorRoll', 'clothDrag', 'cloudWind'];
  function mkDrag(o) { o.acc = 0; o.lv = 0; if (o.ping == null) o.ping = 0.15; if (!o.gain) o.gain = 1.5; drag = o; return o; }
  function cancelDrag() {
    var d = drag; drag = null;
    if (d && d.cancel) { try { d.cancel(); } catch (e) { rep('cancel', e); } }
  }

  // ---------- ヒント ----------
  var dUV = { u: 0.5, v: 0.25 }, dUVt = 0;
  function freeSlot(u) {
    var used0 = false, used1 = false;
    for (var i = 0; i < 2; i++) {
      var st = P('clipState', i);
      if (st === 'on') { if (S.clipSlot[i] === 0) used0 = true; if (S.clipSlot[i] === 1) used1 = true; }
    }
    var su = L.clipSlots;
    if (used0 && used1) return -1;
    if (used0) return 1;
    if (used1) return 0;
    if (u == null) return 0;
    return Math.abs(u - su[0]) <= Math.abs(u - su[1]) ? 0 : 1;
  }
  function basketClip() {
    for (var i = 0; i < 2; i++) if (P('clipState', i) === 'basket') return i;
    return -1;
  }
  var futonGlow = function (g) { F('setGlow', g); };
  var futonWig3 = function () { F('kick', 0.3); };
  var HINT = {
    CURTAIN: {
      gesture: 'drag',
      at: function () { return W('curtainEdge', 1, hA); },
      to: function () { if (!W('curtainEdge', 1, hB)) return null; hB.x += 0.75; return hB; },
      glow: function (g) { W('curtainGlow', g); },
      wiggle: function () { W('curtainSway', 1); }
    },
    DOOR: {
      gesture: 'drag',
      at: function () { return W('doorHandle', hA); },
      to: function () { if (!W('doorHandle', hB)) return null; hB.x += 0.55; return hB; },
      glow: function (g) { W('doorGlow', g); }
    },
    FOLD: {
      gesture: 'drag',
      at: function () { return F('pointAt', 0.5, 0.8, hA); },
      to: function () { return hB.set(L.futon.bundleRoom.x, 0.25, L.futon.bundleRoom.z); },
      glow: futonGlow, wiggle: futonWig3
    },
    HANG: {
      gesture: 'drag',
      at: function () { return F('center', hA); },
      to: function () { return hB.set(0, L.rail.y + 0.1, L.rail.z); },
      glow: futonGlow, wiggle: futonWig3
    },
    CLIP: {
      gesture: 'drag',
      at: function () { var i = basketClip(); if (i < 0 || !P('clipPoint', i, hA)) return null; hA.y += 0.07; return hA; },
      to: function () { var s = freeSlot(null); return s < 0 ? null : F('pointAt', L.clipSlots[s], 0.5, hB); },
      glow: function (g) { P('clipGlow', g); },
      wiggle: function () { P('clipWiggle'); }
    },
    BEATER: {
      gesture: 'tap',
      at: function () { return P('beaterPoint', hA); },
      glow: function (g) { P('beaterGlow', g); },
      wiggle: function () { P('beaterWiggle'); }
    },
    BEAT: {
      gesture: 'tap',
      at: function () { return F('pointAt', dUV.u, dUV.v, hA); },
      glow: futonGlow
    },
    SUN: {
      gesture: 'drag',
      at: function () { return exposure() > 0.6 ? null : W('cloudPos', undefined, hA); },
      to: function () { return W('cloudPos', S.cloudK < 0 ? -1 : 1, hB); },
      glow: function (g) { W('cloudGlow', g); }
    },
    TAKE: {
      gesture: 'drag',
      at: function () { return F('pointAt', 0.5, 0.25, hA); },
      to: function () { if (!F('pointAt', 0.5, 0.25, hB)) return null; hB.y -= 0.7; return hB; },
      glow: futonGlow, wiggle: futonWig3
    },
    SPREAD: {
      gesture: 'drag',
      at: function () { return F('center', hA); },
      to: function () { if (!P('pillowPoint', hB)) return null; hB.z -= 0.45; return hB; },
      glow: futonGlow, wiggle: futonWig3
    },
    PRESS: {
      gesture: 'hold',
      at: function () { return F('pointAt', 0.5, 0.5, hA); },
      glow: futonGlow,
      wiggle: function () { F('kick', 0.4); }
    },
    NIGHT: {
      gesture: 'drag',
      at: function () { return W('curtainEdge', 1, hA); },
      to: function () { return hB.set(0.05, 1.1, L.curtain.z); },
      glow: function (g) { W('curtainGlow', g); },
      wiggle: function () { W('curtainSway', 1); }
    }
  };
  function hintFor(step) { if (HINT[step]) G.hint.set(HINT[step]); else G.hint.clear(); }

  // =====================================================================
  // 操作
  // =====================================================================

  // ---- カーテン（open=+1 開ける / -1 閉める） ----
  function curtainArea(p) {
    var C = L.curtain;
    return inRect(p, rectScreen(-C.half - 0.05, C.half + 0.05, 0.02, C.yTop, C.z), 24);
  }
  function curtainDown(p, open) {
    if (!curtainArea(p)) return false;
    cancelAuto();
    var side = p.x >= screenX(0, 1.1, L.curtain.z) ? 1 : -1;
    var f0 = S.curtain, ppm = pxPerM(0, 1.1, L.curtain.z), prev = f0;
    W('curtainSway', 0.6 * side);
    mkDrag({
      loop: 'curtainSlide', gain: 1.6,
      move: function (q) {
        var f = clamp(f0 + side * q.dx / (ppm * CUR_TRAVEL), 0, 1);   // 端が指についてくる
        drag.acc += Math.abs(f - prev);
        if (Math.abs(f - prev) > 1e-4) W('curtainSway', clamp((f - prev) * 6 * side, -0.4, 0.4));
        prev = f;
        setCurtain(f);
      },
      up: function (q) {
        var tgt = S.curtain;
        if (!q.moved) { tgt = clamp(S.curtain + 0.12 * open, 0, 1); W('curtainSway', side); }
        if (open > 0 ? tgt >= 0.45 : tgt <= 0.55) { curtainDone(open); return; }
        if (tgt !== S.curtain) {
          var c0 = S.curtain;
          autoH = anim(0.3, function (k) { setCurtain(U.lerp(c0, tgt, k)); });
        }
      }
    });
    return true;
  }
  function curtainDone(open) {
    if (S.busy) return;
    S.busy = true;
    G.hint.clear();
    cancelAuto();
    var c0 = S.curtain, tgt = open > 0 ? 1 : 0, sec = 0.25 + 0.4 * Math.abs(tgt - c0);
    autoH = anim(sec, function (k) { setCurtain(U.lerp(c0, tgt, k)); }, function () {
      autoH = null;
      snd('curtainEnd');
      W('curtainSway', 0.8);
      if (open > 0) { A('music', 'morning'); enter('DOOR'); }
      else {
        snd('lampClick', 0.9);
        var t0 = S.time;
        anim(3, function (k) { setTime(U.lerp(t0, 3, k)); });
        A('amb', 'night', 3);
        later(0.6, function () { A('music', 'lullaby'); });
        enter('SLEEP');
      }
    }, 'easeOutCubic');
  }

  // ---- ガラス戸 ----
  function doorDown(p) {
    var D = L.door;
    if (!inRect(p, rectScreen(D.x0, D.x1, 0.02, D.h, D.z), 16)) return false;
    cancelAuto();
    var side = p.x >= screenX(0, 0.9, 0) ? 1 : -1;
    var f0 = S.door, ppm = pxPerM(0, 0.9, 0), prev = f0;
    mkDrag({
      loop: 'doorRoll', gain: 1.8,
      move: function (q) {
        var f = clamp(f0 + side * q.dx / (ppm * DOOR_TRAVEL), 0, 1);
        drag.acc += Math.abs(f - prev); prev = f;
        setDoor(f);
      },
      up: function (q) {
        var tgt = S.door;
        if (!q.moved) tgt = clamp(S.door + 0.12, 0, 1);
        if (tgt >= 0.45) { doorDone(); return; }
        if (tgt !== S.door) { var d0 = S.door; autoH = anim(0.3, function (k) { setDoor(U.lerp(d0, tgt, k)); }); }
      }
    });
    return true;
  }
  function doorDone() {
    if (S.busy) return;
    S.busy = true;
    G.hint.clear();
    cancelAuto();
    var d0 = S.door, sec = 0.25 + 0.4 * (1 - d0);
    autoH = anim(sec, function (k) { setDoor(U.lerp(d0, 1, k)); A('loop', 'doorRoll', 0.5 * (1 - k)); }, function () {
      autoH = null;
      A('loop', 'doorRoll', 0);
      snd('doorThunk');
      A('amb', 'roomOpen', 1.5);
      W('curtainSway', 0.6);
      enter('FOLD');
    }, 'easeOutCubic');
  }

  // ---- ふとんの形を引く（FOLD / HANG / TAKE / SPREAD） ----
  var POSE_CFG = {
    FOLD: { a: 'bed', b: 'bundleRoom', dir: -1, mode: 'bed', done: foldDone },
    HANG: { a: 'carry', b: 'rail', dir: -1, mode: null, done: hangDone },
    TAKE: { a: 'rail', b: 'carry', dir: 1, mode: 'rail', done: takeDone },
    SPREAD: { a: 'bundleRoom', b: 'bed', dir: 1, mode: null, done: spreadDone }
  };
  function setPT(cfg, t) { S.pt = clamp(t, 0, 1); F('setPose', cfg.a, cfg.b, S.pt); }
  function poseDown(p) {
    var cfg = POSE_CFG[S.step];
    if (!cfg) return false;
    var ok = futonUV(p, cfg.mode);
    if (!ok && S.step === 'HANG' && p.y > SH * 0.72) ok = uvR;   // 画面下の束は広く
    if (!ok) return false;
    cancelAuto();
    var t0 = S.pt, prev = t0, y0 = p.y;
    F('kick', 0.25);
    mkDrag({
      loop: 'clothDrag', gain: 2.2,
      move: function (q) {
        var t = clamp(t0 + cfg.dir * (q.y - y0) / (0.30 * SH), 0, 1);
        drag.acc += Math.abs(t - prev);
        if (S.step === 'FOLD') {
          if ((prev < 0.3 && t >= 0.3) || (prev < 0.65 && t >= 0.65)) { F('center', tD); X('dust', tD, null, 0.25); }
        }
        prev = t;
        setPT(cfg, t);
      },
      up: function (q) {
        if (S.step !== 'FOLD' && S.step !== 'HANG' && S.step !== 'TAKE' && S.step !== 'SPREAD') return;
        if (!q.moved && S.pt < 0.05) {
          // 動かさないタップ: 小さく応える
          if (S.step === 'FOLD' && uvR) { morningPat(p); }
          else { F('kick', 0.4); snd(S.step === 'SPREAD' ? 'pillow' : 'press', 0.5); }
        }
        if (S.pt >= 0.4) { poseFinish(cfg); return; }
        if (S.pt > 0) {
          var s0 = S.pt;
          autoH = anim(0.3, function (k) { setPT(cfg, U.lerp(s0, 0, k)); });
        }
      }
    });
    return true;
  }
  function poseFinish(cfg) {
    if (S.busy) return;
    S.busy = true;
    G.hint.clear();
    cancelAuto();
    var s0 = S.pt;
    autoH = anim(0.25 + 0.2 * (1 - s0), function (k) { setPT(cfg, U.lerp(s0, 1, k)); }, function () {
      autoH = null; cfg.done();
    }, 'easeOutCubic');
  }
  function foldDone() {
    snd('futonFlop', 0.55);
    F('center', tD); X('dust', tD, null, 0.3);
    F('kick', 0.5);
    later(0.4, goOutside);
  }
  function hangDone() {
    snd('futonFlop');
    F('kick', 1);
    tD.set(0, L.rail.y + 0.08, L.rail.z); X('dust', tD, null, 0.5);
    G.cam.shake(0.4);
    later(0.35, function () { enter('CLIP'); });
  }
  function takeDone() { snd('futonFlop', 0.6); goBack(); }
  function spreadDone() {
    snd('futonFlop');
    F('center', tD); X('air', tD, 1.4);
    F('kick', 1.3);
    P('pillowBounce', 0.7);
    P('trayJiggle', 0.6);
    S.trans = true;
    G.cam.setView(VIEW.bedEve, { sec: 1.6 });
    later(1.65, function () { enter('PRESS'); });
  }

  // ---- ふとんばさみ ----
  function clipDown(p) {
    var best = -1, bd = 110;
    for (var i = 0; i < 2; i++) {
      if (P('clipState', i) !== 'basket') continue;
      var d = sd(p, P('clipPoint', i, tD));
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return false;
    var ci = best;
    P('clipGrab', ci);
    snd('clip', 0.25, 1.3);
    var follow = function (q) {
      var r = G.screenRay(q.nx, q.ny);
      if (r.intersectPlane(clipPlane, rayPt)) P('clipDragTo', ci, rayPt);
    };
    follow(p);
    mkDrag({
      ping: 0, kind: 'clip',
      move: follow,
      up: function (q) {
        follow(q);
        var r = G.screenRay(q.nx, q.ny), okp = !!r.intersectPlane(clipPlane, rayPt);
        var ok = false, slot = -1;
        if (okp && q.moved && Math.abs(rayPt.x - L.futon.xRail) <= L.futon.w / 2 + 0.2) {
          tE.set(rayPt.x, L.rail.y, L.rail.z); G.toScreen(tE, so1);
          if (!so1.behind && Math.abs(q.y - so1.y) <= 110) {
            slot = freeSlot((rayPt.x - L.futon.xRail) / L.futon.w + 0.5);
            ok = slot >= 0;
          }
        }
        if (ok && S.step === 'CLIP') { S.clipSlot[ci] = slot; P('clipAttach', ci, slot); }
        else P('clipRelease', ci);
      },
      cancel: function () { P('clipRelease', ci); }
    });
    return true;
  }

  // ---- ふとんたたきを取る ----
  function beaterDown(p) {
    if (sd(p, P('beaterPoint', tD)) > 120) return false;
    S.busy = true;
    G.hint.clear();
    P('beaterTake');
    later(0.45, function () { enter('BEAT'); });
    return true;
  }

  // ---- 叩く ----
  function doBeat(u, v) {
    var r = F('hit', u, v, 1);
    if (!r) return;
    bP.copy(r.point); bN.copy(r.normal);
    var rem = r.removed || 0;
    P('beaterSwing', bP);
    var fl = fluffNow();
    snd(fl < 0.45 ? 'beatFlat' : 'beatFluffy', 0.9, 1 + U.rand(-0.06, 0.06));
    if (dustLeft() > 0.08 || rem > 0.004) {
      var am = clamp(rem * 22, 0.3, 1);      // 汚れが残るうちは、はっきり見える ほこりの煙
      X('dust', bP, bN, am);
      snd('dustPuff', 0.25 + 0.75 * am);
    } else X('air', bP, 0.5);                 // きれいになったら空気だけ ぽふっ
    G.cam.shake(0.25);
    if (fl >= 0.6 && Math.random() < 0.35) X('feather', bP, 2);
    S.hits++;
    if (S.step === 'SUN' && exposure() > 0.6) S.sunT += 0.4;
    checkPops();
  }
  function popToday(i) {
    var id = S.today[i];
    S.popped = i + 1;
    P('popItem', id, bP);
    addFound(id);
  }
  function checkPops() {
    if (S.popped === 0 && S.hits >= 3) popToday(0);
    else if (S.popped === 1 && dustLeft() < 0.45) popToday(1);
  }
  function beatDown(p) {
    if (P('beaterState') !== 'held') return false;
    var r = futonUV(p, 'rail');
    if (!r) return false;
    doBeat(r.u, r.v);
    var lx = p.x, ly = p.y, lt = p.time;
    mkDrag({
      ping: 0, kind: 'beat',
      move: function (q) {
        var dx = q.x - lx, dy = q.y - ly;
        if (dx * dx + dy * dy < 26 * 26 || q.time - lt < 0.13) return;
        var r2 = futonUV(q, 'rail');
        if (!r2) return;
        lx = q.x; ly = q.y; lt = q.time;
        doBeat(r2.u, r2.v);
      },
      up: function () {}
    });
    return true;
  }

  // ---- 雲 ----
  function cloudDown(p) {
    if (!W('cloudPos', undefined, tC)) return false;
    var k0 = S.cloudK;
    W('cloudPos', k0 > 0 ? k0 - 1 : k0 + 1, tD);
    G.toScreen(tC, so1); var sx = so1.x, sy = so1.y, beh = so1.behind;
    G.toScreen(tD, so2);
    if (beh) return false;
    var pxk = Math.max(120, Math.abs(so2.x - sx));
    var dx = p.x - sx, dy = p.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) > Math.max(140, pxk * 0.35)) return false;
    var prev = k0;
    W('cloudGlow', 0.6);
    mkDrag({
      kind: 'cloud', loop: 'cloudWind', gain: 1.4,
      move: function (q) {
        var k = clamp(k0 + q.dx / pxk, -1.3, 1.3);
        drag.acc += Math.abs(k - prev); prev = k;
        setCloud(k);
      },
      up: function () {}
    });
    return true;
  }

  // ---- 押す（夕方・夜のふとん） ----
  function pressDown(p) {
    var r = futonUV(p, 'bed');
    if (!r) return false;
    F('press', r.u, r.v, 1);
    snd('press');
    var rel = function () { F('release'); };
    mkDrag({
      ping: 0, kind: 'press',
      move: function (q) { var r2 = futonUV(q, 'bed'); if (r2) F('press', r2.u, r2.v, 1); },
      up: function () {
        rel();
        snd('boing');
        P('pillowBounce', 0.5);
        P('trayJiggle', 0.5);
        S.presses++;
      },
      cancel: rel
    });
    return true;
  }

  // ---- 発見（おまけ） ----
  function morningPat(p) {
    var r = futonUV(p, 'bed');
    if (!r) return false;
    tD.set(0, 1, 0);
    X('dust', r.point, tD, 0.15);
    snd('beatFlat', 0.4, 1 + U.rand(-0.05, 0.05));
    F('kick', 0.2);
    return true;
  }
  function handPon(p) {
    var r = futonUV(p, 'rail');
    if (!r) return false;
    var h = F('hit', r.u, r.v, 0.25);
    if (h) { bP.copy(h.point); bN.copy(h.normal); X('dust', bP, bN, 0.12); }
    snd('beatFlat', 0.45, 1 + U.rand(-0.06, 0.06));
    return true;
  }
  function discoverBalcony(p) {
    var it = P('balconyItems');
    if (it && it.length) {
      for (var i = 0; i < it.length; i++) {
        if (sd(p, it[i].pos) < 70) { P('pokeItem', it[i].id); return true; }
      }
    }
    tD.set(L.chime.x, L.chime.y - 0.06, L.chime.z);
    if (sd(p, tD) < 70) { W('chimeRing'); snd('chime'); return true; }
    tD.set(L.pole.x0, L.pole.y, L.pole.z); tE.set(L.pole.x1, L.pole.y, L.pole.z);
    if (sdSeg(p, tD, tE) < 34) { W('poleNudge'); snd('poleKon'); return true; }
    var held = P('beaterState') === 'held';
    if (!held && S.step !== 'HANG' && handPon(p)) return true;
    if (held) {
      tD.set(L.balcony.x0, L.rail.y, L.rail.z); tC.set(L.balcony.x1, L.rail.y, L.rail.z);
      if (sdSeg(p, tD, tC) < 48) {
        var r = G.screenRay(p.nx, p.ny);
        if (r.intersectPlane(railPlane, rayPt)) {
          rayPt.y = L.rail.y + 0.01; rayPt.z = L.rail.z;
          P('beaterSwing', rayPt);
          snd('railKaan', 0.8, 1 + U.rand(-0.03, 0.03));
          return true;
        }
      }
    }
    if (STEPS.indexOf(S.step) < 7 && cloudDown(p)) return true;
    return false;
  }
  function discoverRoom(p) {
    if (sd(p, P('pillowPoint', tD)) < 80) { P('pillowBounce', 0.6); snd('pillow'); return true; }
    tD.set(L.tray.x, 0.05, L.tray.z);
    if (sd(p, tD) < 70) { P('trayJiggle', 0.8); snd('blockClack', 0.3, 1.2); return true; }
    var i = STEPS.indexOf(S.step);
    if (i <= 2) return morningPat(p);
    if (i >= 10) return pressDown(p);
    return false;
  }

  // 段階ごとの主役の操作
  var MAIN = {
    CURTAIN: function (p) { return curtainDown(p, 1); },
    DOOR: doorDown,
    FOLD: poseDown,
    HANG: poseDown,
    CLIP: clipDown,
    BEATER: beaterDown,
    BEAT: beatDown,
    SUN: function (p) { return cloudDown(p) || beatDown(p); },
    TAKE: poseDown,
    SPREAD: poseDown,
    PRESS: pressDown,
    NIGHT: function (p) { return curtainDown(p, -1); }
  };

  function onDown(p) {
    if (drag) { var d = drag; drag = null; try { if (d.up) d.up(p); } catch (e) { rep('up', e); } }
    if (S.trans || !S.step) return;
    var m = MAIN[S.step];
    if (m && !S.busy && m(p)) return;
    if (S.scene === 'balcony') discoverBalcony(p); else discoverRoom(p);
  }
  function onMove(p) {
    if (!drag || !drag.move) return;
    drag.move(p);
  }
  function onUp(p) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.up) d.up(p);
  }

  // =====================================================================
  // 遷移
  // =====================================================================
  function goOutside() {
    S.trans = true;
    G.hint.clear();
    G.cam.setView(VIEW.door, { sec: 1.3 });
    S.carryLive = true;
    anim(1.3, function (k) { if (S.carryLive) F('setPose', 'bundleRoom', 'carry', k); });
    later(0.85, function () {
      G.fx.flash('#fff6e0', 1, 0.45, 0.9, function () {
        if (S.step !== 'FOLD') return;
        S.carryLive = false;
        balconyBase(1);
        F('setPose', 'carry', 'carry', 1);
        S.pt = 0;
        A('amb', 'outside', 1.2);
        later(0.45, function () { enter('HANG'); });
      });
    });
  }
  function goBack() {
    S.trans = true;
    G.hint.clear();
    G.fx.flash('#1c1208', 0.94, 0.5, 0.9, function () {
      if (S.step !== 'TAKE') return;
      roomBase();
      setTime(2);
      A('amb', 'evening', 1.5);
      P('clearBalconyItems');
      P('setTrayItems', trayIds(false));
      P('clipsReset'); S.clipSlot[0] = S.clipSlot[1] = -1;
      F('setPose', 'bundleRoom', 'bundleRoom', 1);
      S.pt = 0;
      later(0.45, function () { enter('SPREAD'); });
    });
  }
  function goNight() {
    S.busy = true; S.trans = true;
    G.hint.clear();
    G.cam.setView(VIEW.bed, { sec: 1.6 });
    var t0 = S.time;
    anim(6, function (k) { setTime(U.lerp(t0, 2.4, k)); }, null, 'easeInOutCubic');
    later(1.65, function () { enter('NIGHT'); });
  }
  function nextMorning() {
    S.day = (S.day + 1) % 600;
    try { G.save.set('day', S.day); } catch (e) {}
    goto('CURTAIN');
  }

  // 場面の土台
  function roomBase() {
    S.scene = 'room';
    W('setHouseVisible', true);
    W('setShadowFocus', 'room');
    G.cam.setView(VIEW.bed, { sec: 0 });
  }
  function balconyBase(t) {
    S.scene = 'balcony';
    W('setHouseVisible', false);
    W('setShadowFocus', 'balcony');
    setTime(t);
    setCloud(0);
    placeSun();
    G.cam.setView(VIEW.balcony, { sec: 0 });
    calcCarry();
    F('setCarryAnchor', carryAnc); lastAnc.copy(carryAnc);
  }

  // 段階に入る（ヒント・段階の変数）
  function enter(step) {
    S.step = step;
    S.stepT = 0; S.busy = false; S.trans = false; S.busyT = 0;
    if (POSE_CFG[step]) S.pt = 0;
    if (step === 'SUN') { S.sunT = 0; }
    if (step === 'PRESS') S.presses = 0;
    if (step === 'BEAT') { dUVt = 0; refreshDUV(); }
    if (step === 'SLEEP') {
      G.hint.clear();
      later(17, function () {
        G.fx.flash('#05060c', 0.92, 1.6, 1.6, function () { if (S.step === 'SLEEP') nextMorning(); });
      });
      return;
    }
    hintFor(step);
  }
  function refreshDUV() {
    var r = F('dustiestUV');
    if (r) { dUV.u = r.u; dUV.v = r.v; }
  }

  function cleanDust() {
    for (var u = 0.0; u <= 1.0001; u += 0.125)
      for (var v = 0.04; v <= 0.5001; v += 0.065) F('hit', u, v, 1.5);
  }

  // 任意の段階の入口状態を作って飛ぶ
  function goto(step) {
    if (typeof step === 'number') step = STEPS[step];
    var i = STEPS.indexOf(step);
    if (i < 0) return;
    gen++;
    cancelAuto();
    cancelDrag();
    for (var n = 0; n < LOOPS.length; n++) A('loop', LOOPS[n], 0);
    G.hint.clear();
    S.carryLive = false;
    S.today = todayOf(S.day);
    S.hits = 0; S.popped = 0; S.stage = 0; S.presses = 0; S.revealed = false; S.sunT = 0;
    S.clipSlot[0] = S.clipSlot[1] = -1;
    A('stopMusic', 0.8);
    F('release');
    W('cloudGlow', 0);
    P('clipsReset');
    P('clearBalconyItems');
    F('resetDust', S.day);

    if (i <= 2) {                        // 朝の和室
      roomBase();
      setTime(0);
      setCurtain(i >= 1 ? 1 : 0);
      setDoor(i >= 2 ? 1 : 0);
      setCloud(0);
      F('setFluff', 0);
      F('setPose', 'bed', 'bed', 1);
      P('beaterReturn');
      P('setTrayItems', trayIds(true));
      A('amb', i >= 2 ? 'roomOpen' : 'roomDim', 0.8);
    } else if (i <= 8) {                 // ベランダ
      setCurtain(1); setDoor(1);
      balconyBase(step === 'TAKE' ? 1.8 : 1);
      P('setTrayItems', trayIds(false));
      F('setFluff', step === 'TAKE' ? 1 : 0);
      F('setPose', step === 'HANG' ? 'carry' : 'rail', step === 'HANG' ? 'carry' : 'rail', 1);
      if (i >= 5 && i <= 7) {
        S.clipSlot[0] = 0; S.clipSlot[1] = 1;
        P('clipAttach', 0, 0); P('clipAttach', 1, 1);
      }
      if (i === 6 || i === 7) P('beaterTake'); else P('beaterReturn');
      if (i >= 7) {
        cleanDust();
        S.hits = 3;
        F('pointAt', 0.35, 0.3, bP); popToday(0);
        F('pointAt', 0.65, 0.3, bP); popToday(1);
      }
      if (step === 'TAKE') { S.stage = 5; S.revealed = true; setCloud(1); }
      A('amb', 'outside', 0.8);
    } else {                             // 夕方〜夜の和室
      roomBase();
      setCurtain(step === 'SLEEP' ? 0 : 1);
      setDoor(1);
      setCloud(1);
      setTime(step === 'SLEEP' ? 3 : step === 'NIGHT' ? 2.4 : 2);
      F('setFluff', 1);
      F('setPose', step === 'SPREAD' ? 'bundleRoom' : 'bed', step === 'SPREAD' ? 'bundleRoom' : 'bed', 1);
      P('beaterReturn');
      P('setTrayItems', trayIds(false));
      if (step === 'PRESS') G.cam.setView(VIEW.bedEve, { sec: 0 });
      A('amb', step === 'SLEEP' ? 'night' : 'evening', 0.8);
    }
    S.pt = 0;
    enter(step);
  }

  // =====================================================================
  // 毎フレーム
  // =====================================================================
  function update(dt) {
    if (!S.step) return;
    S.stepT += dt;

    // 持続音（ドラッグしていない時は 0）
    for (var n = 0; n < LOOPS.length; n++) {
      var name = LOOPS[n], lv = 0;
      if (drag && drag.loop === name) {
        var rate = dt > 1e-4 ? drag.acc / dt : 0;
        drag.acc = 0;
        drag.lv = U.damp(drag.lv, clamp(rate * drag.gain, 0, 1), 16, dt);
        lv = drag.lv;
        if (drag.ping > 0) { drag.ping -= dt; lv = Math.max(lv, 0.45); }
      }
      if (!(S.step === 'DOOR' && S.busy && name === 'doorRoll')) A('loop', name, lv);
    }

    // 腕にかかえた束の位置
    if (S.carryLive && G.camera) {
      camPoint(0, -0.80, 0.95, tE);
      F('setCarryAnchor', tE);
    } else if (S.scene === 'balcony' && lastAnc.distanceToSquared(carryAnc) > 1e-10) {
      F('setCarryAnchor', carryAnc); lastAnc.copy(carryAnc);
    }

    var si = STEPS.indexOf(S.step);
    // SUN より前: 雲は離すと風で元へ戻る
    if (S.scene === 'balcony' && si < 7 && !(drag && drag.kind === 'cloud') && Math.abs(S.cloudK) > 1e-4) {
      setCloud(Math.abs(S.cloudK) < 0.002 ? 0 : U.damp(S.cloudK, 0, 0.8, dt));
    }

    if (S.step === 'CLIP' && !S.busy && P('clipState', 0) === 'on' && P('clipState', 1) === 'on') {
      S.busy = true;
      G.hint.clear();
      later(0.5, function () { enter('BEATER'); });
    }

    if (S.step === 'BEAT') {
      dUVt += dt;
      if (dUVt > 0.4) { dUVt = 0; refreshDUV(); }
      if (!S.busy && dustLeft() < 0.14) {
        S.busy = true;
        G.hint.clear();
        if (S.popped < 1) popToday(0);
        if (S.popped < 2) later(0.3, function () { if (S.popped < 2) { F('center', bP); popToday(1); } });
        F('kick', 0.6);
        later(0.7, function () { enter('SUN'); });
      }
    }

    if (S.step === 'SUN' && !S.busy) sunUpdate(dt);

    if (S.step === 'PRESS' && !S.busy && !drag && (S.presses >= 3 || S.stepT >= 10)) goNight();

    // 立て直し: 進行が長く止まったら次の段階の入口へ
    if (S.busy || S.trans) {
      S.busyT += dt;
      if (S.busyT > 12) {
        S.busyT = 0;
        goto(STEPS[Math.min(STEPS.length - 1, si + 1)]);
      }
    } else S.busyT = 0;
  }

  function sunUpdate(dt) {
    if (exposure() <= 0.6) return;
    if (!S.revealed) { S.revealed = true; snd('sunReveal'); }
    S.sunT += dt;
    if (S.sunT < 1.1) return;
    S.sunT = 0;
    S.stage = Math.min(5, S.stage + 1);
    F('setFluff', S.stage / 5);
    F('kick', 0.6);
    snd('fuwa', 0.9, FUWA[S.stage - 1]);
    F('center', tD); X('air', tD, 0.6 + 0.1 * S.stage);
    if (S.stage < 5) return;
    S.busy = true;
    G.hint.clear();
    later(0.6, function () {
      P('clipsPopOff');
      F('kick', 1.2);
      A('music', 'fluffy');
      P('beaterReturn');
      var t0 = S.time;
      anim(4, function (k) { setTime(U.lerp(t0, 1.8, k)); }, null, 'easeInOutCubic');
      later(1.6, function () { enter('TAKE'); });
    });
  }

  function onResize(w, h) {
    SW = w || SW; SH = h || SH;
    if (S.scene === 'balcony') { placeSun(); calcCarry(); }
  }

  // =====================================================================
  function start() {
    initVecs();
    G.onUpdate(update);          // 各モジュールより先に動かす（同じフレームで形に反映）
    try { W('build'); } catch (e) { rep('world.build', e); }
    try { F('build'); } catch (e) { rep('futon.build', e); }
    try { P('build'); } catch (e) { rep('props.build', e); }
    loadSave();
    G.onResize(onResize);
    G.input.on('down', onDown);
    G.input.on('move', onMove);
    G.input.on('up', onUp);
    goto('CURTAIN');
  }

  G.boot(start);
})();
