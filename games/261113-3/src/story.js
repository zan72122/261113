/* story.js — お話の進行（段階ごとの操作・ヒント・カメラ・保存）。最後に G.boot(start)。
   段階: rinse すすぐ → pick えらぶ → wipe ふく → carry しまう →（5 つ置くまで pick へ）
         → lamp あかり → dinner ごはん → clear かたづけ → rinse（つぎの日）
   公開: G.story = { stage, cur }（読み取り専用）
*/
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var U = G.util, L = G.L;
  var ids = L.dishIds.slice();

  // ---------- 安全な呼び出し ----------
  var seen = {};
  function rep(n, e) {
    if (seen[n]) return; seen[n] = 1;
    try { console.warn('[story] ' + n, e); } catch (_) {}
  }
  function call(o, n) {
    if (!o) return undefined;
    var fn = o[n];
    if (typeof fn !== 'function') return undefined;
    try { return fn.apply(o, Array.prototype.slice.call(arguments, 2)); } catch (e) { rep(n, e); return undefined; }
  }
  function has(o, n) { return !!o && typeof o[n] === 'function'; }
  function snd(name, opts) { call(G.audio, 'play', name, opts || {}); }
  function aLoop(name, lv) { call(G.audio, 'loop', name, lv); }
  function amb(name, sec) { call(G.audio, 'amb', name, sec); }
  function W(n, a, b) { return call(G.world, n, a, b); }
  function faucet() { return G.world && G.world.faucet; }
  function lampO() { return G.world && G.world.lamp; }
  function vsub(n) { return G.vfx && G.vfx[n]; }
  function VX(n, a, b, c) { return call(G.vfx, n, a, b, c); }
  function D(id) {
    var ds = G.dishes;
    if (!ds || typeof ds.get !== 'function') return null;
    try { return ds.get(id) || null; } catch (e) { rep('dishes.get', e); return null; }
  }
  function dc(id, m, a, b) { return call(D(id), m, a, b); }
  function hintSet(o) { call(G.hint, 'set', o); }
  function hintClear() { call(G.hint, 'clear'); }
  function view(v, sec, onDone) {
    if (!v) { if (onDone) onDone(); return; }
    if (has(G.cam, 'setView')) G.cam.setView(v, { sec: sec, onDone: onDone });
    else if (onDone) onDone();
  }
  function flash(color, peak, inS, outS, atPeak) {
    if (has(G.fx, 'flash')) G.fx.flash(color, peak, inS, outS, atPeak);
    else if (atPeak) G.after(inS || 0, atPeak);
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function sdist(p, v) { if (!v) return Infinity; var d = G.screenDist(p, v); return d === d ? d : Infinity; }

  // ---------- 状態 ----------
  var S = { stage: null, epoch: 0, busy: false, cur: null, placed: [], loops: 0 };
  var ready = false;
  G.story = {
    get stage() { return S.stage; },
    get cur() { return S.cur; }
  };

  // 段階の通し番号つきの時間待ち（段階が変わったら何もしない）
  function later(sec, fn) {
    var e = S.epoch;
    return G.after(sec, function () { if (e === S.epoch) fn(); });
  }
  function anim(sec, fn, done) {
    var e = S.epoch;
    return G.tween(sec, function (k) { if (e === S.epoch) fn(k); }, {
      onDone: function () { if (e === S.epoch && done) done(); }
    });
  }

  // ---------- 使い回しのベクトル ----------
  var cv = {}, hAt, hTo, spotV, pool = [], poolI = 0, lvV, mthV, knobV;
  var loc = {};            // dishes が無い時の where の代わり
  var food = {};           // 料理の残り（bite の戻り値で更新）
  var lastX = L.mat.x, lastZ = L.mat.z, hasLast = false;
  function initVecs() {
    var V = THREE.Vector3;
    for (var i = 0; i < ids.length; i++) { cv[ids[i]] = new V(); loc[ids[i]] = 'sink'; food[ids[i]] = 0; }
    hAt = new V(); hTo = new V(); spotV = new V(); lvV = new V(); mthV = new V(); knobV = new V();
    for (var j = 0; j < 24; j++) pool.push(new V());
  }
  // 一時的な出来事（きらめき・しずく等）に渡す点。輪番で使い回す
  function tv(src, dx, dy, dz) {
    var v = pool[poolI]; poolI = (poolI + 1) % pool.length;
    v.copy(src); v.x += dx || 0; v.y += dy || 0; v.z += dz || 0;
    return v;
  }

  function rOf(id) { var d = D(id); return d && typeof d.r === 'number' ? d.r : L.dish[id].r; }
  function hOf(id) { var d = D(id); return d && typeof d.h === 'number' ? d.h : L.dish[id].h; }
  function whereOf(id) { var d = D(id); return d && typeof d.where === 'string' ? d.where : loc[id]; }
  function fallbackPos(id, out) {
    var w = loc[id], s;
    if (w === 'sink') { s = L.sinkSlots[id]; out.set(s.x, L.sink.floorY + s.y + 0.03, s.z); }
    else if (w === 'rack') { s = L.rackSlots[id]; out.set(s.x, L.counter.top + 0.08, s.z); }
    else if (w === 'mat') out.set(L.mat.x, L.mat.top + 0.03, L.mat.z);
    else if (w === 'carry') out.set(lastX, surfY(lastZ) + 0.03, lastZ);
    else { s = L.spots[id]; out.set(s.x, L.table.top + 0.03, s.z); }
    return out;
  }
  function center(id) {
    var out = cv[id], d = D(id);
    if (has(d, 'center')) {
      var r = null;
      try { r = d.center(out); } catch (e) { rep('center', e); }
      if (r && r !== out && typeof r.x === 'number') out.copy(r);
      if (r) return out;
    }
    return fallbackPos(id, out);
  }
  function leverPos() {
    var f = faucet();
    if (has(f, 'leverPos')) { var r = call(f, 'leverPos', lvV); if (r) { if (r !== lvV) lvV.copy(r); return lvV; } }
    return lvV.set(L.faucet.x + 0.07, L.counter.top + 0.26, L.faucet.z);
  }
  function mouthPos() {
    var f = faucet();
    if (has(f, 'mouthPos')) { var r = call(f, 'mouthPos', mthV); if (r) { if (r !== mthV) mthV.copy(r); return mthV; } }
    return mthV.set(L.faucet.mouth.x, L.faucet.mouth.y, L.faucet.mouth.z);
  }
  function knobPos() {
    var l = lampO();
    if (has(l, 'knobPos')) { var r = call(l, 'knobPos', knobV); if (r) { if (r !== knobV) knobV.copy(r); return knobV; } }
    return knobV.set(L.lamp.knob.x, L.lamp.knob.y, L.lamp.knob.z);
  }

  // 食器の移動。onDone は必ず 1 回だけ呼ぶ（相手が無い・呼ばない時の保険つき）
  var WHERE = { toSink: 'sink', toRack: 'rack', toMat: 'mat', toSpot: 'spot' };
  function go(id, method, o) {
    o = o || {};
    var cb = o.onDone, done = false;
    var once = function () { if (done) return; done = true; if (cb) cb(); };
    var opts = { instant: !!o.instant, sec: o.sec, delay: o.delay, onDone: once };
    loc[id] = WHERE[method];
    var d = D(id), ok = false;
    if (has(d, method)) { try { d[method](opts); ok = true; } catch (e) { rep(method, e); } }
    if (!cb) return;
    if (!ok && o.instant) { once(); return; }
    var t = (o.delay || 0) + (o.sec != null ? o.sec : 0.6);
    G.after(ok ? t + 1.5 : t, once);
  }
  function eachDish(m, a, b) { for (var i = 0; i < ids.length; i++) dc(ids[i], m, a, b); }
  var glowFn = {};
  function glowAll(g) { eachDish('setGlow', g); }
  function wigFn(id) { return function () { dc(id, 'wiggle'); }; }

  // ---------- 保存 ----------
  function save() {
    var st = S.stage;
    if (st === 'wipe' || st === 'carry') st = 'pick';
    try { G.save.set('st', { v: 1, stage: st, placed: S.placed.slice(), loops: S.loops }); } catch (e) { rep('save', e); }
  }
  function loadSave() {
    var s = null;
    try { s = G.save.get('st', null); } catch (e) { s = null; }
    var r = { stage: 'rinse', placed: [], loops: 0 };
    if (!s || typeof s !== 'object' || s.v !== 1) return r;
    if (typeof s.loops === 'number' && s.loops >= 0 && s.loops < 1e6) r.loops = Math.floor(s.loops);
    var st = s.stage;
    if (['rinse', 'pick', 'lamp', 'dinner', 'clear'].indexOf(st) < 0) return r;
    if (st === 'pick') {
      if (!Array.isArray(s.placed) || s.placed.length > 5) return r;
      var pl = [];
      for (var i = 0; i < s.placed.length; i++) {
        var id = s.placed[i];
        if (ids.indexOf(id) < 0 || pl.indexOf(id) >= 0) return r;
        pl.push(id);
      }
      r.placed = pl;
      r.stage = pl.length >= 5 ? 'lamp' : 'pick';
      if (r.stage === 'lamp') r.placed = ids.slice();
      return r;
    }
    r.stage = st;
    if (st !== 'rinse') r.placed = ids.slice();
    return r;
  }

  // ---------- 段階の出入り ----------
  var lever = 0, flow = 0, foam = 1, rinsed = false, grab = null, leverTw = null, bubT = 0;
  var wiping = false, sqAcc = 0, sqLast = -9, lpx = 0, lpy = 0, ldx = 0, ldy = 0, fakeDry = 0;
  var carrying = false, retLock = false;
  var pulling = false, fired = false, pullAnim = false, lampOn = false, flashH = null;
  var nextId = null, dinT = null, steamH = {};
  var ST = {};

  function leave() {
    aLoop('water', 0); aLoop('fizz', 0); aLoop('rub', 0);
    if (S.stage === 'rinse') { call(vsub('water'), 'setFlow', 0); flow = 0; }
    if (wiping && S.cur) dc(S.cur, 'wipeEnd');
    wiping = false;
    if (pulling || pullAnim) call(lampO(), 'setPull', 0);
    pulling = false; pullAnim = false; fired = false;
    grab = null; carrying = false; retLock = false;
    if (leverTw) { leverTw.cancel(); leverTw = null; }
    if (flashH) { flashH.cancel(); flashH = null; }
    call(vsub('spot'), 'hide');
    glowAll(0);
  }
  function enter(stage, o) {
    if (S.stage) leave();
    S.stage = stage;
    S.epoch++;
    S.busy = false;
    hintClear();
    save();
    try { ST[stage].enter(o || {}); } catch (e) { rep('enter.' + stage, e); }
  }

  // =====================================================================
  // 1. rinse すすぐ
  // =====================================================================
  function rinseHint() {
    hintSet({
      at: function () {
        if (S.busy) return null;
        if (!rinsed && lever > 0.8 && flow > 0.3) return null;   // 流れている最中は見守る
        return hAt.copy(leverPos());
      },
      to: function () { return hTo.copy(leverPos()).setY(hTo.y + (rinsed ? -0.09 : 0.09)); },
      gesture: 'drag',
      wiggle: function () {
        call(faucet(), 'wiggle');
        VX('drip', tv(mouthPos()), L.sink.floorY + 0.05);
        snd('drip');
      }
    });
  }
  ST.rinse = {
    enter: function () {
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        go(id, 'toSink', { instant: true });
        dc(id, 'setFoam', 1); dc(id, 'setWet', 1); dc(id, 'setShiny', false); dc(id, 'setDirty', 0);
        dc(id, 'clearFood'); food[id] = 0;
        if (steamH[id]) { call(steamH[id], 'stop'); steamH[id] = null; }
      }
      call(vsub('steam'), 'clear');
      W('setDusk', 0, 0);
      lampOn = false; call(lampO(), 'setOn', false, true);
      view(L.views.sink, 0);
      amb('kitchen', 1); call(G.audio, 'stopMusic', 1);
      lever = 0; flow = 0; foam = 1; rinsed = false; bubT = 0;
      call(faucet(), 'setLever', 0);
      rinseHint();
    },
    down: function (p) {
      if (S.busy) return;
      if (sdist(p, leverPos()) < 95 || sdist(p, mouthPos()) < 70) {
        if (leverTw) { leverTw.cancel(); leverTw = null; }
        grab = { k0: lever };
        snd('leverClick');
        call(faucet(), 'wiggle');
        return;
      }
      if (call(vsub('bubbles'), 'popAt', p) === true) { snd('pop', { pitch: rnd(0.9, 1.3) }); return; }
      if (foam > 0) {
        var best = null, bd = 85;
        for (var i = 0; i < ids.length; i++) {
          var d = sdist(p, center(ids[i]));
          if (d < bd) { bd = d; best = ids[i]; }
        }
        if (best) {
          dc(best, 'wiggle'); snd('foam');
          call(vsub('bubbles'), 'emit', tv(center(best), 0, 0.02), 2);
        }
      }
    },
    move: function (p) {
      if (!grab || S.busy) return;
      lever = clamp(grab.k0 + (-p.dy) / 110, 0, 1);
    },
    up: function (p) {
      if (!grab) return;
      grab = null;
      if (S.busy) return;
      if (!p.moved) {
        var from = lever, to = lever > 0.5 ? 0 : 1;
        snd('leverClick');
        leverTw = anim(0.18, function (k) { lever = from + (to - from) * k; }, function () { lever = to; leverTw = null; });
      } else if (lever < 0.15) lever = 0;
    },
    update: function (dt) {
      call(faucet(), 'setLever', lever);
      flow = U.damp(flow, lever, 10, dt);
      call(vsub('water'), 'setFlow', flow);
      aLoop('water', flow);
      if (flow > 0.05 && foam > 0) {
        foam = Math.max(0, foam - dt * flow / 3.6);
        eachDish('setFoam', foam);
        aLoop('fizz', foam > 0 ? flow * 0.7 : 0);
        bubT += dt;
        if (bubT >= 0.45) {
          bubT = 0;
          var id = ids[(Math.random() * ids.length) | 0];
          call(vsub('bubbles'), 'emit', tv(center(id), 0, 0.03), 1);
        }
        if (foam <= 0) {
          rinsed = true;
          snd('kiraSoft');
          for (var i = 0; i < ids.length; i++) VX('sparkle', tv(center(ids[i])), { n: 3 });
          rinseHint();
        }
      } else aLoop('fizz', 0);
      if (rinsed && !S.busy && !grab && lever === 0 && flow < 0.03) toRackSeq();
    }
  };
  var CLINK = { plate: 0.9, bowlL: 0.85, bowlM: 1.0, bowlS: 1.15, glass: 1.4 };
  function clinkOf(id, vol) {
    if (id === 'glass') snd('glassTing', { vol: vol != null ? vol : 0.6 });
    else snd('clink', { pitch: CLINK[id], vol: vol });
  }
  function toRackSeq() {
    S.busy = true;
    hintClear();
    aLoop('water', 0); aLoop('fizz', 0);
    view(L.views.rack, 1.6);
    var left = ids.length, e = S.epoch;
    ids.forEach(function (id, i) {
      go(id, 'toRack', {
        delay: 0.3 + 0.28 * i, sec: 0.7,
        onDone: function () {
          if (e !== S.epoch) return;
          clinkOf(id);
          VX('drip', tv(center(id)), L.counter.top + 0.005);
          if (--left === 0) later(0.4, function () { enter('pick'); });
        }
      });
    });
  }

  // =====================================================================
  // 2. pick えらぶ
  // =====================================================================
  ST.pick = {
    enter: function (o) {
      view(L.views.rack, o.instant ? 0 : 1.2);
      call(vsub('spot'), 'hide');
      nextId = null;
      for (var i = 0; i < ids.length; i++) if (S.placed.indexOf(ids[i]) < 0) { nextId = ids[i]; break; }
      if (!nextId) { later(0, function () { enter('lamp'); }); return; }
      var nid = nextId;
      hintSet({
        at: function () { return S.busy ? null : hAt.copy(center(nid)); },
        gesture: 'tap',
        glow: glowFn[nid],
        wiggle: function () { dc(nid, 'wiggle'); snd(nid === 'glass' ? 'glassTing' : 'clink', { vol: 0.4 }); }
      });
    },
    down: function (p) {
      if (S.busy) return;
      var best = null, bd = 150;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (S.placed.indexOf(id) >= 0 || whereOf(id) !== 'rack') continue;
        var d = sdist(p, center(id));
        if (d < bd) { bd = d; best = id; }
      }
      if (!best) return;
      S.cur = best;
      S.busy = true;
      hintClear();
      dc(best, 'setGlow', 0);
      snd('pickup');
      var e = S.epoch;
      go(best, 'toMat', { sec: 0.6, onDone: function () { if (e !== S.epoch) return; snd('clothThud'); enter('wipe'); } });
      var wv = call(G.dishes, 'wipeView', best) ||
        { look: [L.mat.x, L.mat.top + 0.03, L.mat.z], dir: [0, 1.6, 1], w: 0.36, h: 0.36, fovP: 50, fovL: 40 };
      view(wv, 0.9);
    },
    move: function () {}, up: function () {}
  };

  // =====================================================================
  // 3. wipe ふく
  // =====================================================================
  var BASE = { plate: 1.0, bowlL: 0.8, bowlM: 1.0, bowlS: 1.25, glass: 1.6 };
  function dryOf(id) {
    var d = D(id);
    if (has(d, 'dryness')) { var v = call(d, 'dryness'); if (typeof v === 'number') return v; }
    return fakeDry;
  }
  ST.wipe = {
    enter: function () {
      var id = S.cur;
      wiping = false; fakeDry = 0; sqAcc = 0; sqLast = -9;
      hintSet({
        at: function () { return S.busy ? null : hAt.copy(center(id)).setX(hAt.x - rOf(id) * 0.5); },
        to: function () { return hTo.copy(center(id)).setX(hTo.x + rOf(id) * 0.5); },
        gesture: 'drag',
        wiggle: wigFn(id)
      });
    },
    down: function (p) {
      if (S.busy || !S.cur) return;
      dc(S.cur, 'wipeBegin', p);
      wiping = true;
      sqAcc = 0; lpx = p.x; lpy = p.y; ldx = 0; ldy = 0;
      sqLast = G.time;
      snd('squeak', { pitch: BASE[S.cur], vol: 0.5 });
    },
    move: function (p) {
      if (!wiping || S.busy) return;
      var id = S.cur;
      var res = dc(id, 'wipeMove', p) || {};
      var speed = typeof res.speed === 'number' ? res.speed : 0;
      aLoop('rub', clamp(speed / 0.5, 0, 1));
      var dx = p.x - lpx, dy = p.y - lpy, seg2 = dx * dx + dy * dy, rev = false;
      if (seg2 > 36) {
        var segL = Math.sqrt(seg2);
        if (ldx * dx + ldy * dy < 0) rev = true;
        ldx = dx; ldy = dy; lpx = p.x; lpy = p.y;
        if (typeof res.moved !== 'number') { sqAcc += segL * 0.0003; fakeDry = Math.min(1, fakeDry + segL / 1600); }
      }
      if (typeof res.moved === 'number') sqAcc += res.moved;
      if ((rev || sqAcc >= 0.07) && G.time - sqLast >= 0.11) {
        sqAcc = 0; sqLast = G.time;
        var dry = clamp(dryOf(id), 0, 1);
        snd('squeak', {
          pitch: BASE[id] * (0.92 + 0.35 * dry) * rnd(0.96, 1.04),
          vol: 0.45 + 0.35 * clamp(speed / 0.6, 0, 1)
        });
      }
      if (dryOf(id) >= 0.9) wipeDone();
    },
    up: function () {
      if (!wiping) return;
      wiping = false;
      if (S.cur) dc(S.cur, 'wipeEnd');
      aLoop('rub', 0);
    },
    update: function () {
      if (!S.busy && S.cur && dryOf(S.cur) >= 0.9) wipeDone();
    }
  };
  function wipeDone() {
    if (S.busy) return;
    var id = S.cur;
    S.busy = true;
    if (wiping) dc(id, 'wipeEnd');
    wiping = false;
    aLoop('rub', 0);
    hintClear();
    dc(id, 'finishDry');
    snd('kira');
    VX('glint', tv(center(id)), 1);
    later(0.15, function () { VX('sparkle', tv(center(id)), { n: 6, spread: rOf(id) * 1.2 }); });
    dc(id, 'hop', 0.03);
    later(0.9, function () { enter('carry'); });
  }

  // =====================================================================
  // 4. carry しまう
  // =====================================================================
  function surfY(z) {
    var ct = L.counter.top + 0.10, tt = L.table.top + 0.08;
    if (z > -0.5) return ct;
    if (z < -0.95) return tt;
    return U.lerp(ct, tt, (z + 0.5) / -0.45);
  }
  var hitXZ = { x: 0, z: 0 };
  function planeHit(ray, y) {
    var dy = ray.direction.y;
    if (Math.abs(dy) < 1e-5) return false;
    var t = (y - ray.origin.y) / dy;
    if (t < 0) return false;
    hitXZ.x = ray.origin.x + ray.direction.x * t;
    hitXZ.z = ray.origin.z + ray.direction.z * t;
    return true;
  }
  ST.carry = {
    enter: function () {
      var id = S.cur;
      view(L.views.table, 1.2);
      var r = W('spotPos', id, spotV);
      if (r && r !== spotV && typeof r.x === 'number') spotV.copy(r);
      if (!r) spotV.set(L.spots[id].x, L.table.top, L.spots[id].z);
      call(vsub('spot'), 'show', spotV, rOf(id) * 1.25 + 0.03);
      carrying = false; hasLast = false; retLock = false;
      hintSet({
        at: function () { return (S.busy || carrying) ? null : hAt.copy(center(id)); },
        to: function () { return hTo.copy(spotV); },
        gesture: 'drag',
        glow: glowFn[id],
        wiggle: function () { dc(id, 'hop', 0.015); snd('sparkle'); }
      });
    },
    down: function (p) {
      if (S.busy || !S.cur) return;
      if (!retLock && sdist(p, center(S.cur)) < 130) {
        carrying = true; hasLast = false;
        loc[S.cur] = 'carry';
        dc(S.cur, 'beginCarry');
        snd('pickup');
      } else if (sdist(p, spotV) < 90) {
        VX('sparkle', tv(spotV, 0, 0.02), { n: 3 });
        snd('kiraSoft');
      }
    },
    move: function (p) {
      if (!carrying || S.busy) return;
      var ray = G.screenRay(p.nx, p.ny);
      if (!planeHit(ray, L.counter.top + 0.10)) return;
      planeHit(ray, surfY(clamp(hitXZ.z, -2.05, 0.32)));
      var x = clamp(hitXZ.x, -0.35, 0.95), z = clamp(hitXZ.z, -2.05, 0.32);
      var ex = x - spotV.x, ez = z - spotV.z;
      if (ex * ex + ez * ez < 0.16 * 0.16) { x = spotV.x; z = spotV.z; }
      lastX = x; lastZ = z; hasLast = true;
      dc(S.cur, 'carryTo', x, z);
    },
    up: function () {
      if (!carrying) return;
      carrying = false;
      if (S.busy) return;
      var id = S.cur, e = S.epoch;
      var ex = lastX - spotV.x, ez = lastZ - spotV.z;
      if (hasLast && (ex * ex + ez * ez < 0.30 * 0.30 || lastZ < -1.0)) {
        S.busy = true;
        hintClear();
        go(id, 'toSpot', { sec: 0.32, onDone: function () { if (e === S.epoch) land(id); } });
      } else {
        retLock = true;
        go(id, 'toMat', { sec: 0.45 });
        later(0.47, function () { retLock = false; });
        snd('whoosh', { vol: 0.4 });
      }
    }
  };
  var KOTON = { plate: 0.8, bowlL: 0.9, bowlM: 1.05, bowlS: 1.25, glass: 1.5 };
  function land(id) {
    snd('koton', { pitch: KOTON[id] });
    if (id === 'glass') snd('glassTing', { vol: 0.5 });
    W('seatReact', id);
    VX('sparkle', tv(center(id)), { n: 4 });
    call(vsub('spot'), 'hide');
    call(G.cam, 'shake', 0.12);
    dc(id, 'setGlow', 0);
    if (S.placed.indexOf(id) < 0) S.placed.push(id);
    save();
    W('setDusk', S.placed.length / 5 * 0.8, 2.5);
    if (S.placed.length === 3) amb('dusk', 3);
    later(0.9, function () { enter(S.placed.length < ids.length ? 'pick' : 'lamp'); });
  }

  // =====================================================================
  // 5. lamp あかり（ひもの操作は dinner でも使う）
  // =====================================================================
  function lampHint() {
    if (S.stage !== 'lamp') return;
    if (lampOn) { hintClear(); return; }
    hintSet({
      at: function () { return (S.busy || lampOn) ? null : hAt.copy(knobPos()); },
      to: function () { return hTo.copy(knobPos()).setY(hTo.y - 0.10); },
      gesture: 'drag',
      wiggle: function () { call(lampO(), 'kick', 0.6); }
    });
  }
  function toggleLamp() {
    snd('lampClick');
    lampOn = !lampOn;
    call(lampO(), 'setOn', lampOn);
    call(lampO(), 'kick', 0.4);
    if (flashH) { flashH.cancel(); flashH = null; }
    if (lampOn) {
      snd('lampOn');
      ids.forEach(function (id, i) {
        later(0.14 * i, function () {
          VX('sparkle', tv(center(id)), { n: 3 });
          snd('kiraSoft', { pitch: 1 + 0.12 * i });
        });
      });
      if (S.stage === 'lamp') {
        flashH = later(1.7, function () {
          flashH = null;
          if (!lampOn || S.busy) return;
          S.busy = true;
          hintClear();
          var e = S.epoch;
          flash('#fff1d6', 0.92, 0.6, 1.0, function () {
            if (e !== S.epoch) return;
            serveAll();
            enter('dinner');
          });
        });
      }
    }
    lampHint();
  }
  function lampDown(p, rad) {
    if (pullAnim || sdist(p, knobPos()) >= rad) return false;
    pulling = true; fired = false;
    return true;
  }
  function lampMove(p) {
    if (!pulling || S.busy) return;
    var pull = clamp(p.dy / 70, 0, 1);
    call(lampO(), 'setPull', pull);
    if (pull >= 0.85 && !fired) { fired = true; toggleLamp(); }
  }
  function lampUp(p) {
    if (!pulling) return;
    pulling = false;
    if (S.busy) { call(lampO(), 'setPull', 0); return; }
    if (!p.moved && !fired) {
      pullAnim = true;
      anim(0.16, function (k) { call(lampO(), 'setPull', k); }, function () {
        toggleLamp();
        anim(0.2, function (k) { call(lampO(), 'setPull', 1 - k); }, function () { pullAnim = false; });
      });
    } else call(lampO(), 'setPull', 0);
  }
  ST.lamp = {
    enter: function (o) {
      W('setDusk', 1, o.instant ? 0 : 2.5);
      amb('dusk', 2);
      view(L.views.lamp, o.instant ? 0 : 1.8);
      lampHint();
    },
    down: function (p) { if (!S.busy) lampDown(p, 110); },
    move: lampMove,
    up: lampUp
  };

  // =====================================================================
  // 6. dinner ごはん
  // =====================================================================
  function serveAll() {
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], d = D(id);
      dc(id, 'serve');
      food[id] = d && typeof d.foodLeft === 'number' ? d.foodLeft : (d && typeof d.foodMax === 'number' ? d.foodMax : 3);
    }
  }
  var EAT_ORDER = ['bowlS', 'plate', 'bowlM', 'glass', 'bowlL'];
  function dinnerHint() {
    dinT = null;
    for (var i = 0; i < EAT_ORDER.length; i++) if (food[EAT_ORDER[i]] > 0) { dinT = EAT_ORDER[i]; break; }
    if (!dinT) { hintClear(); return; }
    var id = dinT;
    hintSet({
      at: function () { return S.busy ? null : hAt.copy(center(id)); },
      gesture: 'tap',
      glow: glowFn[id],
      wiggle: function () { dc(id, 'hop', 0.012); }
    });
  }
  function anyFood() { for (var i = 0; i < ids.length; i++) if (food[ids[i]] > 0) return true; return false; }
  function dinnerDone() {
    S.busy = true;
    hintClear();
    later(0.9, function () {
      snd('gochiso');
      call(G.audio, 'music', 'night');
      call(vsub('steam'), 'clear');
      for (var i = 0; i < ids.length; i++) steamH[ids[i]] = null;
      later(1.6, function () { enter('clear'); });
    });
  }
  ST.dinner = {
    enter: function () {
      view(L.views.dinner, 0);
      snd('itadaki', { delay: 0.5 });
      call(G.audio, 'music', 'dinner');
      amb('dinner', 2);
      var st = ['plate', 'bowlL', 'bowlM', 'bowlS'];
      for (var i = 0; i < st.length; i++) {
        var id = st[i];
        if (steamH[id]) { call(steamH[id], 'stop'); steamH[id] = null; }
        if (food[id] > 0) {
          var c = center(id);
          steamH[id] = call(vsub('steam'), 'add', new THREE.Vector3(c.x, c.y + hOf(id) + 0.05, c.z), id === 'bowlL' ? 1.3 : 1.0) || null;
        }
      }
      if (!anyFood()) { dinnerDone(); return; }
      dinnerHint();
    },
    down: function (p) {
      if (S.busy) return;
      var best = null, bd = 70;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (!(food[id] > 0)) continue;
        var d = sdist(p, center(id));
        if (d < bd) { bd = d; best = id; }
      }
      if (best) {
        var left = dc(best, 'bite');
        food[best] = typeof left === 'number' ? Math.max(0, left) : Math.max(0, food[best] - 1);
        snd(best === 'glass' ? 'gokku' : 'paku', { pitch: rnd(0.92, 1.12) });
        dc(best, 'hop', 0.012);
        if (food[best] === 0) {
          if (steamH[best]) { call(steamH[best], 'stop'); steamH[best] = null; }
          VX('sparkle', tv(center(best)), { n: 3 });
          snd('kiraSoft');
          if (best !== 'glass') dc(best, 'setDirty', 1);
          dc(best, 'setGlow', 0);
        }
        if (!anyFood()) dinnerDone();
        else dinnerHint();
        return;
      }
      lampDown(p, 90);
    },
    move: lampMove,
    up: lampUp
  };

  // =====================================================================
  // 7. clear かたづけ → つぎの日
  // =====================================================================
  ST.clear = {
    enter: function () {
      hintSet({
        at: function () { return S.busy ? null : hAt.copy(center('plate')); },
        gesture: 'tap',
        glow: glowAll,
        wiggle: function () { eachDish('wiggle'); snd('clink', { vol: 0.3 }); }
      });
    },
    down: function (p) {
      if (S.busy) return;
      var hit = false;
      for (var i = 0; i < ids.length; i++) if (sdist(p, center(ids[i])) < 160) { hit = true; break; }
      if (!hit) return;
      S.busy = true;
      hintClear();
      glowAll(0);
      var left = ids.length, e = S.epoch;
      ids.forEach(function (id, i) {
        snd('whoosh', { vol: 0.35, delay: 0.25 * i });
        go(id, 'toSink', {
          delay: 0.25 * i, sec: 0.95,
          onDone: function () {
            if (e !== S.epoch) return;
            clinkOf(id);
            if (--left === 0) later(0.6, nextDay);
          }
        });
      });
      later(0.5, function () { view(L.views.sink, 2.0); });
    },
    move: function () {}, up: function () {}
  };
  function nextDay() {
    var e = S.epoch;
    flash('#ffe9c8', 1, 0.9, 1.3, function () {
      if (e !== S.epoch) return;
      S.loops++;
      S.placed = [];
      S.cur = null;
      enter('rinse');
    });
  }

  // ---------- 入力・毎フレーム ----------
  function dispatch(kind, p) {
    if (!ready || !S.stage) return;
    var h = ST[S.stage];
    if (h && h[kind]) h[kind](p);
  }

  // ---------- 復元 ----------
  function restore() {
    var r = loadSave();
    S.loops = r.loops;
    S.placed = r.placed.slice();
    S.cur = null;
    var st = r.stage, i, id;
    if (st === 'rinse') { enter('rinse'); return; }
    for (i = 0; i < ids.length; i++) {
      id = ids[i];
      dc(id, 'setFoam', 0); dc(id, 'setDirty', 0); dc(id, 'clearFood'); food[id] = 0;
      if (S.placed.indexOf(id) >= 0) {
        go(id, 'toSpot', { instant: true });
        dc(id, 'setWet', 0); dc(id, 'setShiny', true);
      } else {
        go(id, 'toRack', { instant: true });
        dc(id, 'setWet', 1); dc(id, 'setShiny', false);
      }
    }
    call(faucet(), 'setLever', 0);
    call(vsub('water'), 'setFlow', 0);
    if (st === 'pick') {
      W('setDusk', S.placed.length / 5 * 0.8, 0);
      lampOn = false; call(lampO(), 'setOn', false, true);
      amb(S.placed.length >= 3 ? 'dusk' : 'kitchen', 1);
      view(L.views.rack, 0);
      enter('pick', { instant: true });
      return;
    }
    W('setDusk', 1, 0);
    if (st === 'lamp') {
      lampOn = false; call(lampO(), 'setOn', false, true);
      enter('lamp', { instant: true });
      return;
    }
    lampOn = true; call(lampO(), 'setOn', true, true);
    if (st === 'dinner') { serveAll(); enter('dinner'); return; }
    // clear
    for (i = 0; i < ids.length; i++) if (ids[i] !== 'glass') dc(ids[i], 'setDirty', 1);
    view(L.views.dinner, 0);
    amb('dinner', 1);
    call(G.audio, 'music', 'night');
    enter('clear');
  }

  // ---------- 起動 ----------
  function start() {
    try { call(G.world, 'build'); } catch (e) { rep('world.build', e); }
    try { call(G.vfx, 'build'); } catch (e) { rep('vfx.build', e); }
    try { call(G.dishes, 'build'); } catch (e) { rep('dishes.build', e); }
    initVecs();
    for (var i = 0; i < ids.length; i++) {
      (function (id) { glowFn[id] = function (g) { dc(id, 'setGlow', g); }; })(ids[i]);
    }
    G.input.on('down', function (p) { dispatch('down', p); });
    G.input.on('move', function (p) { dispatch('move', p); });
    G.input.on('up', function (p) { dispatch('up', p); });
    G.onUpdate(function (dt) {
      if (!ready || !S.stage) return;
      var h = ST[S.stage];
      if (h && h.update) h.update(dt);
    });
    ready = true;
    try { restore(); } catch (e) { rep('restore', e); S.placed = []; S.stage = null; enter('rinse'); }
  }

  G.boot(start);
})();
