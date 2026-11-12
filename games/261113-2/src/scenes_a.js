/* scenes_a.js — 場面 S0 ふた / S1 よそう / S2 ぐ / S3 かたち＋にぎる（ゲームの中心）。
   クラシックスクリプト。G.Scenes.registerA() で G.Director に登録する。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var THREE = window.THREE;
  G.Scenes = G.Scenes || {};
  if (!THREE) { G.Scenes.registerA = function () {}; return; }

  var PI = Math.PI, TAU = PI * 2;
  var V3 = THREE.Vector3, Q = THREE.Quaternion;
  function V(x, y, z) { return new V3(x, y, z); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function qE(x, y, z) { return new Q().setFromEuler(new THREE.Euler(x, y, z, 'YXZ')); }
  function qSide(h, x, y, z) { var s = h.sign || (h.side === 'L' ? -1 : 1); return qE(x, y * s, z * s); }
  function wpos(o) { if (!o) return V(0, 0, 0); o.updateWorldMatrix(true, false); return o.getWorldPosition(new V3()); }
  function err(tag, e) { if (window.console) console.error('[G:scenesA:' + tag + ']', e); }
  function snd(name, o) { try { if (G.Audio && G.Audio.play) G.Audio.play(name, o || {}); } catch (e) { /* ignore */ } }
  function aud(m, a) { try { if (G.Audio && typeof G.Audio[m] === 'function') G.Audio[m](a); } catch (e) { /* ignore */ } }
  function fx(name) {
    var args = [].slice.call(arguments, 1);
    try { if (G.FX && G.FX[name]) return G.FX[name].apply(G.FX, args); } catch (e) { err('fx', e); }
    return null;
  }
  function W() { return G.W; }
  function S() { return G.W.state; }
  function H() { return G.W.hands; }
  function props() { return G.W.props; }
  function dist(ev, v) { return G.Input.screenDist(ev, v); }
  var KINDS = ['ume', 'sake', 'kombu'];
  var SCOOP_SIZES = [0.030, 0.034, 0.037];
  var MAMA_SIZE = 0.045;

  /* ------------------------------------------------------------------ 場面ごとの後片付け */
  function Ctx(name) { this.name = name; this.alive = true; this.tws = []; this.fx = []; this.ins = []; }
  Ctx.prototype.live = function (fn) {
    var self = this;
    return function () { if (!self.alive || !fn) return; try { return fn.apply(null, arguments); } catch (e) { err(self.name, e); } };
  };
  Ctx.prototype.tw = function (target, to, dur, o) {
    o = o || {};
    var oo = { ease: o.ease, delay: o.delay };
    if (o.onUpdate) oo.onUpdate = this.live(o.onUpdate);
    if (o.onDone) oo.onDone = this.live(o.onDone);
    var h = G.tween(target, to, dur, oo);
    this.tws.push(h);
    if (this.tws.length > 300) this.tws.splice(0, 150);
    return h;
  };
  Ctx.prototype.wait = function (sec, fn) { return this.tw({ k: 0 }, { k: 1 }, sec, { ease: 'linear', onDone: fn }); };
  Ctx.prototype.keep = function (h) { if (h) this.fx.push(h); return h; };
  Ctx.prototype.on = function (type, fn) { var f = this.live(fn); G.Input.on(type, f); this.ins.push([type, f]); };
  Ctx.prototype.end = function () {
    this.alive = false;
    for (var i = 0; i < this.tws.length; i++) { try { this.tws[i].kill(); } catch (e) { /* ignore */ } }
    for (i = 0; i < this.fx.length; i++) {
      var h = this.fx[i];
      try { if (h.stop) h.stop(); else if (h.dispose) h.dispose(); } catch (e) { /* ignore */ }
    }
    for (i = 0; i < this.ins.length; i++) G.Input.off(this.ins[i][0], this.ins[i][1]);
    this.tws = []; this.fx = []; this.ins = [];
  };

  /* ------------------------------------------------------------------ 手の補助 */
  var ancCache = {};
  function poseCopy(p) { try { return JSON.parse(JSON.stringify(p)); } catch (e) { return 'relaxed'; } }
  // ポーズ pose のときのアンカー位置（手首フレーム内）
  function ancLocal(h, pose, name) {
    var key = (h.who || '') + (h.side || '') + '|' + pose + '|' + name;
    if (ancCache[key]) return ancCache[key];
    var a = h.anchors && h.anchors[name];
    if (!a) return V(0, 0, -0.06);
    var saved = h.pose ? poseCopy(h.pose) : null;
    try { h.setPose(pose, 0); } catch (e) { /* stub */ }
    h.root.updateMatrixWorld(true);
    var l = h.root.worldToLocal(a.getWorldPosition(new V3()));
    if (saved) { try { h.setPose(saved, 0); } catch (e) { /* stub */ } }
    ancCache[key] = l;
    return l;
  }
  function warmAnchors() {
    var hs = H(); if (!hs) return;
    [['cR', 'point', 'indexTip'], ['cR', 'grip', 'grip'], ['cR', 'pinch', 'pinch'], ['cL', 'pinch', 'pinch'],
      ['mR', 'point', 'indexTip'], ['mR', 'grip', 'grip'], ['mR', 'pinch', 'pinch'], ['mL', 'pinch', 'pinch']].forEach(function (r) {
      if (hs[r[0]]) ancLocal(hs[r[0]], r[1], r[2]);
    });
  }
  // アンカーを world 点に置くための手首位置
  function rootFor(h, pose, name, pt, q) { return pt.clone().sub(ancLocal(h, pose, name).clone().applyQuaternion(q)); }
  function stopHand(h) { try { h.moveTo({ dur: 0 }); } catch (e) { /* ignore */ } }
  function rest(h, dur) { try { h.idle = true; h.rest(dur != null ? dur : 0.5); } catch (e) { /* ignore */ } }
  var busy = { mL: false, mR: false, cL: false, cR: false };
  function wiggle(ctx, key) {
    var h = H()[key]; if (!h || busy[key]) return;
    busy[key] = true;
    var prev = h._poseTo ? poseCopy(h._poseTo) : 'relaxed';
    try { h.setPose('open', 0.12); } catch (e) { /* ignore */ }
    G.wait(0.16, function () { try { h.setPose(prev, 0.12); } catch (e) { /* ignore */ } });
    G.wait(0.3, function () { try { h.setPose('open', 0.1); } catch (e) { /* ignore */ } });
    G.wait(0.42, function () { try { h.setPose(prev, 0.2); } catch (e) { /* ignore */ } busy[key] = false; });
    snd('tap', { vol: 0.45, pitch: 1.15 });
  }
  function jiggle(obj, amt) {
    if (!obj || obj.__jig) return;
    obj.__jig = true;
    var r = obj.rotation, z0 = r.z, x0 = r.x, a = amt || 0.06;
    G.tween(r, { z: z0 + a, x: x0 - a * 0.4 }, 0.07, { ease: 'out', onDone: function () {
      G.tween(r, { z: z0 - a * 0.6, x: x0 + a * 0.2 }, 0.09, { ease: 'inOut', onDone: function () {
        G.tween(r, { z: z0, x: x0 }, 0.12, { ease: 'out', onDone: function () { obj.__jig = false; } });
      } });
    } });
  }
  function jiggleBody(body) {
    if (!body || body.__jig) return;
    body.__jig = true;
    var p = { v: 0 };
    G.tween(p, { v: 1 }, 0.32, { ease: 'linear', onUpdate: function (e) {
      var s = Math.sin(e * PI * 3) * (1 - e) * 0.08;
      body.group.scale.set(1 + s, 1 - s, 1 + s);
    }, onDone: function () { body.group.scale.set(1, 1, 1); body.__jig = false; } });
  }
  // 何の操作でもない所を触った時の小さな反応（否定なし）
  function pokeAny(ctx, ev, skip) {
    skip = skip || {};
    var hs = H();
    var keys = ['mL', 'mR'];
    for (var i = 0; i < keys.length; i++) {
      var h = hs[keys[i]];
      if (h && h.anchors && dist(ev, wpos(h.anchors.palm)) < 55) { wiggle(ctx, keys[i]); return true; }
    }
    var P = props(), w = W();
    if (!skip.rice) {
      var bodies = [w.riceC, w.riceM];
      for (i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b && b.group && b.group.parent && dist(ev, wpos(b.group).add(V(0, b.size * 0.5, 0))) < 50) { jiggleBody(b); snd('squish', { vol: 0.35, pitch: 1.4 }); return true; }
      }
    }
    if (!skip.tray && P.tray && P.tray.dishes) {
      for (i = 0; i < P.tray.dishes.length; i++) {
        var d = P.tray.dishes[i];
        if (dist(ev, wpos(d.anchor)) < 45) { jiggle(d.group || d.anchor, 0.08); snd('tap', { vol: 0.4, pitch: 1.3 }); return true; }
      }
    }
    if (!skip.shamoji && P.shamoji && P.shamoji.parent === G.scene && G.Input.pick(ev, P.shamoji)) { jiggle(P.shamoji, 0.04); snd('tap', { vol: 0.4 }); return true; }
    if (!skip.cooker && P.cooker && G.Input.pick(ev, P.cooker)) {
      lidRattle(); return true;
    }
    return false;
  }
  var rattling = false;
  function lidRattle() {
    var c = props().cooker; if (!c || rattling) return;
    var v0 = c.lidValue != null ? c.lidValue : 0;
    rattling = true;
    snd('tap', { vol: 0.5, pitch: 0.8 });
    var p = { k: 0 };
    G.tween(p, { k: 1 }, 0.3, { ease: 'linear', onUpdate: function (e) { c.setLid(v0 + Math.sin(e * PI * 2) * (1 - e) * 0.035 * (v0 > 0.5 ? -1 : 1)); },
      onDone: function () { c.setLid(v0); rattling = false; } });
    if (v0 < 0.5) fx('puff', wpos(c.steamAnchor), { count: 4, size: 0.03 });
  }

  /* ------------------------------------------------------------------ 位置 */
  function boardTop(b) { var p = wpos(b); p.y += (typeof b.topY === 'number' ? b.topY : 0.012); return p; }
  function boardC() { return boardTop(props().boardChild); }
  function boardM() { return boardTop(props().boardMama); }
  function riceTop(body) { var p = wpos(body.group); p.y += (body.topY ? body.topY() : body.size * 0.8); return p; }
  function potTop() { return wpos(props().cooker.potAnchor); }
  function shamojiStuck() {
    var pa = potTop();
    return { pos: pa.add(V(0.014, 0.016, -0.026)), q: qE(-0.85, 0.16, 0) };
  }
  function ensureRice(which) {
    var w = W(), st = S();
    if (which === 'M') {
      if (!w.riceM) {
        w.riceM = G.Rice.createBody({ size: MAMA_SIZE });
        G.scene.add(w.riceM.group);
        w.riceM.group.position.copy(boardM());
      }
      return w.riceM;
    }
    if (!w.riceC) {
      st.scoops = Math.max(1, st.scoops || 0);
      w.riceC = G.Rice.createBody({ size: SCOOP_SIZES[Math.min(SCOOP_SIZES.length, st.scoops) - 1] });
      G.scene.add(w.riceC.group);
      w.riceC.group.position.copy(boardC());
    }
    return w.riceC;
  }
  function mamaFilling() {
    var st = S();
    if (!st.mamaFilling) st.mamaFilling = KINDS[((st.round % 3) + 3) % 3];
    return st.mamaFilling;
  }

  /* ------------------------------------------------------------------ 共有の小物 */
  var potSteam = null;
  function startPotSteam(ctx) {
    var c = props().cooker;
    if (!c || (c.lidValue != null && c.lidValue < 0.5)) return;
    potSteam = ctx.keep(fx('steam', function () { return wpos(c.potAnchor).add(V((Math.random() - 0.5) * 0.08, 0.01, (Math.random() - 0.5) * 0.06)); }, { rate: 3.2, size: 0.06, rise: 0.17, life: 2.0 }));
  }
  var firstEnter = true;

  /* ================================================================== S0 ふた */
  var S0 = {
    enter: function () {
      var ctx = this.ctx = new Ctx('S0');
      var c = props().cooker, hs = H(), st = S();
      this.pressed = false;
      warmAnchors();
      if (G.Rice && G.Rice.warm) G.Rice.warm();
      G.Cam.frame({ cx: W().FRAMES.cooker.cx, cz: W().FRAMES.cooker.cz, w: W().FRAMES.cooker.w, d: W().FRAMES.cooker.d, pad: W().FRAMES.cooker.pad, dur: firstEnter ? 0 : 1.0 });
      firstEnter = false;
      try { c.setLid(0); c.pressButton(0); c.ledOn(true); } catch (e) { err('cooker', e); }
      ctx.keep(fx('steam', function () { return wpos(c.steamAnchor); }, { rate: 2.2, size: 0.028, rise: 0.16, life: 1.6 }));
      for (var k in hs) { hs[k].idle = true; if (hs[k].setGlow) hs[k].setGlow(0); }
      var self = this;
      G.Hint.set({ kind: 'tap', at: function () { return wpos(c.button); }, object: c.button, radius: 0.034 });
      // ママの右手が とん とん と指さす
      this.demo = true;
      ctx.wait(st.round > 0 ? 1.1 : 0.6, function () { self.mamaPoint(); });
      ctx.on('down', function (ev) { self.down(ev); });
    },
    mamaPoint: function () {
      var ctx = this.ctx, self = this, h = H().mR, c = props().cooker;
      if (this.pressed) { this.demo = false; return; }
      busy.mR = true; h.idle = false;
      var q = qSide(h, -0.75, 0.42, -0.25);
      var b = wpos(c.button);
      var up = rootFor(h, 'point', 'indexTip', b.clone().add(V(0, 0.045, 0.012)), q);
      var dn = rootFor(h, 'point', 'indexTip', b.clone().add(V(0, 0.016, 0.004)), q);
      h.moveTo({ pos: up, rot: q, pose: 'point', dur: 0.75, onDone: ctx.live(function () {
        snd('tap', { vol: 0.35, pitch: 1.2 });
        h.moveTo({ pos: dn, dur: 0.14, arc: 0, ease: G.Ease.out, onDone: ctx.live(function () {
          h.moveTo({ pos: up, dur: 0.16, arc: 0, onDone: ctx.live(function () {
            snd('tap', { vol: 0.35, pitch: 1.2 });
            h.moveTo({ pos: dn, dur: 0.14, arc: 0, ease: G.Ease.out, onDone: ctx.live(function () {
              h.moveTo({ pos: up, dur: 0.18, arc: 0, onDone: ctx.live(function () {
                ctx.wait(0.25, function () { rest(h, 0.7); busy.mR = false; self.demo = false; });
              }) });
            }) });
          }) });
        }) });
      }) });
    },
    down: function (ev) {
      var c = props().cooker;
      if (this.pressed) { pokeAny(this.ctx, ev, { cooker: true }); return; }
      var hitBtn = dist(ev, wpos(c.button)) < 78 || !!G.Input.pick(ev, c.button);
      if (hitBtn) { this.press(); return; }
      pokeAny(this.ctx, ev);
    },
    press: function () {
      var ctx = this.ctx, c = props().cooker, hs = H(), self = this;
      this.pressed = true;
      G.Hint.clear();
      c.pressButton(1);
      snd('button');
      aud('ambience', true); aud('music', true);
      // ママの手は引っ込める
      if (this.demo) { rest(hs.mR, 0.45); busy.mR = false; }
      // 子どもの人差し指が押しに来る（飾り）
      var h = hs.cR, q = qSide(h, -0.85, 0.22, -0.35), b = wpos(c.button);
      h.idle = false;
      h.moveTo({ pos: rootFor(h, 'point', 'indexTip', b.clone().add(V(0, 0.006, 0.002)), q), rot: q, pose: 'point', dur: 0.26, onDone: ctx.live(function () {
        ctx.wait(0.06, function () { rest(h, 0.5); });
      }) });
      ctx.wait(0.16, function () { c.pressButton(0); try { c.ledOn(false); } catch (e) { /* ignore */ } });
      ctx.wait(0.24, function () {
        snd('lidOpen');
        var p = { v: 0 };
        ctx.tw(p, { v: 1 }, 0.7, { ease: 'outBack', onUpdate: function () { c.setLid(clamp(p.v, 0, 1.04)); }, onDone: function () { c.setLid(1); } });
        ctx.wait(0.18, function () {
          var pt = potTop();
          fx('puff', pt.clone().add(V(0, 0.02, 0)), { count: 14, size: 0.07 });
          snd('steam');
          for (var i = 0; i < ctx.fx.length; i++) { try { ctx.fx[i].stop(); } catch (e) { /* ignore */ } }
          ctx.fx = [];
          startPotSteam(ctx);
        });
        ctx.wait(0.9 + 0.7, function () { if (G.Director.current === 'S0') G.Director.go('S1'); });
      });
    },
    update: function () {},
    exit: function () {
      var c = props().cooker;
      if (this.ctx) this.ctx.end();
      busy.mR = false;
      if (this.pressed) { try { c.setLid(1); c.pressButton(0); c.ledOn(false); } catch (e) { /* ignore */ } }
      G.Hint.clear();
    }
  };

  /* ================================================================== しゃもじ（S1） */
  // しゃもじは握り(grip)アンカーに対し、柄の中心を原点に置き、柄を手の X/Z の斜めに通す（へらは親指と人差し指の間から前へ）
  var SG_Q = qE(-0.18, 0.62, 0.10);
  function sgLocal() {
    var sh = props().shamoji;
    var ha = sh.handleAnchor ? sh.handleAnchor.position.clone() : V(0, 0, 0.1);
    return { pos: ha.applyQuaternion(SG_Q).negate(), q: SG_Q.clone() };
  }
  // 手首の向き q のとき、しゃもじの bladeAnchor（ごはんをのせる所）の手首からのずれ
  function bladeOffset(h, q) {
    var sh = props().shamoji;
    var ha = sh.handleAnchor ? sh.handleAnchor.position : V(0, 0, 0.1);
    var ba = sh.bladeAnchor ? sh.bladeAnchor.position : V(0, 0, 0);
    var v = ba.clone().sub(ha).applyQuaternion(SG_Q).add(ancLocal(h, 'grip', 'grip'));
    return v.applyQuaternion(q);
  }
  // 手に持たせる（今の世界姿勢から 手の中の姿勢へ dur で寄せる）
  function grabShamoji(ctx, h, dur) {
    var sh = props().shamoji;
    G.killTweens(sh.position); G.killTweens(sh.rotation);
    h.attach(sh, 'grip');
    var L = sgLocal(), p0 = sh.position.clone(), q0 = sh.quaternion.clone(), k = { v: 0 };
    ctx.tw(k, { v: 1 }, dur, { ease: 'out', onUpdate: function () {
      if (sh.parent !== h.anchors.grip) return;
      sh.position.lerpVectors(p0, L.pos, k.v); sh.quaternion.slerpQuaternions(q0, L.q, k.v);
    } });
  }
  function placeShamoji(ctx, h, pose, dur, onDone) {
    var sh = props().shamoji;
    h.detach(sh, G.scene);
    var p0 = sh.position.clone(), q0 = sh.quaternion.clone(), k = { v: 0 };
    ctx.tw(k, { v: 1 }, dur, { ease: 'inOut', onUpdate: function () {
      sh.position.lerpVectors(p0, pose.pos, k.v); sh.quaternion.slerpQuaternions(q0, pose.q, k.v);
    }, onDone: onDone });
  }
  // 手を動かして へらを pt へ
  function moveBlade(ctx, h, q, pt, dur, onDone, arc) {
    h.moveTo({ pos: pt.clone().sub(bladeOffset(h, q)), rot: q, dur: dur, arc: arc, onDone: ctx.live(onDone) });
  }
  function scoopOnBlade(size) {
    var sh = props().shamoji;
    removeScoop();
    var g = G.Rice.createScoop ? G.Rice.createScoop(size) : null;
    if (!g) return null;
    (sh.bladeAnchor || sh).add(g);
    g.position.set(0, 0, 0);
    g.scale.setScalar(0.4);
    G.tween(g.scale, { x: 1, y: 1, z: 1 }, 0.22, { ease: 'outBack' });
    sh.__scoop = g;
    return g;
  }
  function removeScoop() {
    var sh = props().shamoji;
    if (sh.__scoop) { if (sh.__scoop.parent) sh.__scoop.parent.remove(sh.__scoop); var b = sh.__scoop.userData.body; if (b && b.dispose) { try { b.dispose(); } catch (e) { /* ignore */ } } sh.__scoop = null; }
  }
  function digPot() { try { var pr = props().cooker.potRice; if (pr && pr.dig) pr.dig(); } catch (e) { /* ignore */ } }
  function carryQ(h) { return h.who === 'mama' ? qSide(h, -0.32, 0.55, -0.42) : qSide(h, -0.36, 0.45, -0.40); }

  /* ================================================================== S1 よそう */
  var S1 = {
    enter: function () {
      var ctx = this.ctx = new Ctx('S1'), self = this;
      var F = W().FRAMES.scoop, c = props().cooker;
      G.Cam.frame({ cx: F.cx, cz: F.cz, w: F.w, d: F.d, pad: F.pad, dur: 1.2 });
      if (c.lidValue == null || c.lidValue < 1) c.setLid(1);
      startPotSteam(ctx);
      this.phase = 'demo'; this.drag = null; this.delivered = false;
      warmAnchors();
      if (W().riceM) { this.phase = 'play'; this.setHint(); }
      else ctx.wait(0.5, function () { self.mamaDemo(); });
      ctx.on('down', function (ev) { self.down(ev); });
      ctx.on('move', function (ev) { self.move(ev); });
      ctx.on('up', function (ev) { self.up(ev); });
    },
    setHint: function () {
      var sh = props().shamoji;
      G.Hint.set({ kind: 'drag', at: function () { return wpos(sh.handleAnchor); }, to: function () { return boardC().add(V(0, 0.01, 0)); }, object: sh, radius: 0.04 });
      if (!this.dest) this.dest = this.ctx.keep(fx('halo', function () { return boardC(); }, { radius: 0.06 }));
      if (this.dest) this.dest.setStrength(0.45);
    },
    mamaDemo: function () {
      var ctx = this.ctx, self = this, h = H().mR, sh = props().shamoji;
      busy.mR = true; h.idle = false;
      var q = carryQ(h);
      var hp = wpos(sh.handleAnchor);
      // 柄の少し上から握りに行く
      h.moveTo({ pos: rootFor(h, 'grip', 'grip', hp.clone().add(V(0, 0.02, 0.01)), q), rot: q, pose: 'relaxed', dur: 0.65, onDone: ctx.live(function () {
        h.setPose('grip', 0.16);
        h.moveTo({ pos: rootFor(h, 'grip', 'grip', hp, q), dur: 0.16, arc: 0, onDone: ctx.live(function () {
          grabShamoji(ctx, h, 0.2);
          snd('pick', { vol: 0.6 });
          var pt = potTop();
          moveBlade(ctx, h, q, pt.clone().add(V(0.0, 0.05, 0.01)), 0.55, function () {
            moveBlade(ctx, h, q, pt.clone().add(V(0.0, 0.006, 0.0)), 0.22, function () {
              snd('scoop'); digPot(); scoopOnBlade(MAMA_SIZE * 0.75);
              var bm = boardM();
              moveBlade(ctx, h, q, pt.clone().add(V(0, 0.06, 0.02)), 0.25, function () {
                moveBlade(ctx, h, q, bm.clone().add(V(0, 0.06, 0)), 0.65, function () {
                  moveBlade(ctx, h, q, bm.clone().add(V(0, 0.022, 0)), 0.2, function () {
                    self.dropMama();
                    moveBlade(ctx, h, q, bm.clone().add(V(0.0, 0.07, 0.02)), 0.25, function () {
                      var sp = shamojiStuck();
                      moveBlade(ctx, h, q, sp.pos.clone().add(V(0, 0.03, 0.0)), 0.6, function () {
                        placeShamoji(ctx, h, sp, 0.3);
                        h.setPose('relaxed', 0.2);
                        ctx.wait(0.12, function () { rest(h, 0.65); busy.mR = false; });
                        self.phase = 'play'; self.setHint();
                      });
                    });
                  });
                });
              });
            });
          });
        }) });
      }) });
    },
    dropMama: function () {
      removeScoop();
      var w = W();
      if (w.riceM) return;
      var b = w.riceM = G.Rice.createBody({ size: MAMA_SIZE });
      G.scene.add(b.group);
      b.group.position.copy(boardM()).add(V(0, 0.012, 0));
      b.group.scale.set(0.85, 1.15, 0.85);
      G.tween(b.group.position, { y: boardM().y }, 0.12, { ease: 'in' });
      G.tween(b.group.scale, { x: 1, y: 1, z: 1 }, 0.35, { ease: 'outBack' });
      snd('plop', { vol: 0.8 });
      fx('puff', riceTop(b), { count: 5, size: 0.04 });
    },
    down: function (ev) {
      var sh = props().shamoji;
      if (this.phase === 'play' && !this.drag && !this.delivering) {
        var hit = dist(ev, wpos(sh.handleAnchor)) < 80 || dist(ev, wpos(sh)) < 60 || !!G.Input.pick(ev, sh);
        if (hit) { this.grab(ev); return; }
      }
      pokeAny(this.ctx, ev, { shamoji: this.phase !== 'demo' });
    },
    grab: function (ev) {
      var ctx = this.ctx, self = this, h = H().cR, sh = props().shamoji, st = S();
      G.Hint.clear();
      if (this.dest) this.dest.setStrength(0.8);
      busy.cR = true; h.idle = false;
      var q = carryQ(h);
      var d = this.drag = { ev: ev, q: q, held: false, target: null, steam: null, up: false };
      jiggle(sh, 0.03);
      snd('scoop');
      var hp = wpos(sh.handleAnchor);
      h.moveTo({ pos: rootFor(h, 'grip', 'grip', hp, q), rot: q, pose: 'grip', dur: 0.22, onDone: ctx.live(function () {
        if (self.drag !== d) return;
        grabShamoji(ctx, h, 0.16);
        digPot();
        var n = Math.min(SCOOP_SIZES.length - 1, st.scoops || 0);
        scoopOnBlade(SCOOP_SIZES[n] * 0.85);
        d.steam = ctx.keep(fx('steam', function () { return wpos(sh.bladeAnchor || sh).add(V(0, 0.02, 0)); }, { rate: 3, size: 0.025, rise: 0.12, life: 1.1 }));
        d.held = true;
        d.pos = h.root.position.clone();
        if (d.up) self.deliver();
      }) });
    },
    move: function (ev) { if (this.drag) this.drag.ev = ev; },
    up: function (ev) {
      var d = this.drag;
      if (!d) return;
      d.ev = ev; d.up = true;
      if (d.held) this.deliver();
    },
    deliver: function () {
      var ctx = this.ctx, self = this, d = this.drag, h = H().cR, st = S();
      if (!d || this.delivering) return;
      this.drag = null; this.delivering = true;
      if (d.steam) d.steam.stop();
      var q = d.q, bc = boardC();
      var rc = W().riceC;
      var dropAt = rc ? riceTop(rc).add(V(0, 0.012, 0)) : bc.clone().add(V(0, 0.026, 0));
      moveBlade(ctx, h, q, dropAt.clone().add(V(0, 0.035, 0)), 0.38, function () {
        moveBlade(ctx, h, q, dropAt, 0.14, function () {
          self.dropChild();
          moveBlade(ctx, h, q, dropAt.clone().add(V(0, 0.06, 0.0)), 0.2, function () {
            var sp = shamojiStuck();
            moveBlade(ctx, h, q, sp.pos.clone().add(V(0, 0.03, 0)), 0.55, function () {
              placeShamoji(ctx, h, sp, 0.25);
              h.setPose('relaxed', 0.2);
              ctx.wait(0.1, function () { rest(h, 0.6); busy.cR = false; self.delivering = false; });
            });
          });
        });
      });
    },
    dropChild: function () {
      removeScoop();
      var w = W(), st = S();
      st.scoops = (st.scoops || 0) + 1;
      var size = SCOOP_SIZES[Math.min(SCOOP_SIZES.length, st.scoops) - 1];
      var bc = boardC(), b = w.riceC;
      if (!b) {
        b = w.riceC = G.Rice.createBody({ size: size });
        G.scene.add(b.group);
        b.group.position.copy(bc).add(V(0, 0.01, 0));
        b.group.scale.set(0.8, 1.2, 0.8);
        G.tween(b.group.position, { y: bc.y }, 0.11, { ease: 'in' });
      } else {
        b.setSize(size);
        b.group.scale.set(0.9, 1.12, 0.9);
      }
      G.tween(b.group.scale, { x: 1, y: 1, z: 1 }, 0.35, { ease: 'outBack' });
      snd('plop');
      fx('puff', riceTop(b), { count: 5, size: 0.035 });
      fx('burst', riceTop(b), { kind: 'grain', count: 3, speed: 0.18, floor: bc.y + 0.001 });
      if (this.dest) { this.dest.dispose(); this.dest = null; }
      if (G.Director.current === 'S1' && !this.leaving) {
        this.leaving = true;
        this.ctx.wait(0.6 + 0.9, function () { G.Director.go('S2'); });
      }
    },
    update: function (dt) {
      var d = this.drag;
      if (!d || !d.held) return;
      var h = H().cR, ev = d.ev;
      var c = props().cooker;
      // 指の下に握り。炊飯器の近くでは高く
      var nearPot = 0;
      var p0 = ev.onPlane(0.08);
      if (p0) nearPot = sstep(wpos(c).z + 0.22, wpos(c).z + 0.12, p0.z);
      var y = lerp(0.075, potTop().y + 0.06, nearPot);
      var p = ev.onPlane(y);
      if (!p) return;
      var tgt = rootFor(h, 'grip', 'grip', p, d.q);
      d.pos.x = G.smooth(d.pos.x, tgt.x, 18, dt);
      d.pos.z = G.smooth(d.pos.z, tgt.z, 18, dt);
      d.pos.y = G.smooth(d.pos.y, tgt.y, 12, dt);
      h.root.position.copy(d.pos);
    },
    exit: function () {
      if (this.drag || this.delivering) {
        // 途中で終わっても、しゃもじは釜へ、ごはんはまな板へ
        var h = H().cR;
        if (!W().riceC && this.drag && this.drag.held) this.dropChild();
        removeScoop();
        var sh = props().shamoji, sp = shamojiStuck();
        G.scene.attach(sh); sh.position.copy(sp.pos); sh.quaternion.copy(sp.q);
        rest(h, 0.4); busy.cR = false;
      }
      if (busy.mR) { rest(H().mR, 0.4); busy.mR = false; }
      this.drag = null; this.delivering = false; this.leaving = false; this.dest = null;
      if (this.ctx) this.ctx.end();
      G.Hint.clear();
    }
  };

  /* ================================================================== S2 ぐ */
  function pinchQ(h) { return h.who === 'mama' ? qSide(h, -0.62, 0.35, -0.30) : qSide(h, -0.7, 0.25, -0.3); }
  function dishOf(kind) { var ds = props().tray.dishes; for (var i = 0; i < ds.length; i++) if (ds[i].kind === kind) return ds[i]; return ds[1] || ds[0]; }
  function heapTop(d) { return wpos(d.anchor).add(V(0, 0.012, 0)); }
  function makePiece(kind) {
    var p = G.Rice.createFillingPiece ? G.Rice.createFillingPiece(kind) : null;
    if (!p) { p = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 10), new THREE.MeshStandardMaterial({ color: 0xb8352f })); }
    p.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
    return p;
  }
  function dropPiece(p) { if (p && p.parent) p.parent.remove(p); }
  // ひょいと弧を描いて運ぶ
  function arcTo(ctx, obj, to, dur, hgt, onDone) {
    var from = obj.position.clone(), k = { v: 0 };
    ctx.tw(k, { v: 1 }, dur, { ease: 'inOut', onUpdate: function () {
      obj.position.lerpVectors(from, to, k.v); obj.position.y += Math.sin(PI * k.v) * hgt;
    }, onDone: onDone });
  }

  var S2 = {
    enter: function () {
      var ctx = this.ctx = new Ctx('S2'), self = this;
      var F = W().FRAMES.fill;
      G.Cam.frame({ cx: F.cx, cz: F.cz, w: F.w, d: F.d, pad: F.pad, dur: 1.0 });
      startPotSteam(ctx);
      ensureRice('M'); ensureRice('C');
      warmAnchors();
      this.drag = null; this.leaving = false; this.pulses = [];
      this.phase = 'demo';
      if (W().riceM.filling) { this.phase = 'play'; this.setHint(); }
      else ctx.wait(0.7, function () { self.mamaDemo(); });
      ctx.on('down', function (ev) { self.down(ev); });
      ctx.on('move', function (ev) { if (self.drag) self.drag.ev = ev; });
      ctx.on('up', function (ev) { self.up(ev); });
    },
    setHint: function () {
      var ctx = this.ctx, ds = props().tray.dishes;
      G.Hint.set({ kind: 'drag', at: function () { return heapTop(ds[1] || ds[0]); }, to: function () { return riceTop(W().riceC); }, radius: 0.075 });
      if (!this.pulses.length) {
        for (var i = 0; i < ds.length; i++) this.pulses.push(ctx.keep(fx('pulse', ds[i].heap || ds[i].anchor, { strength: 0 })));
      }
      if (!this.dest) this.dest = ctx.keep(fx('halo', function () { return riceTop(W().riceC); }, { radius: 0.028 }));
      if (this.dest) this.dest.setStrength(0.5);
    },
    mamaDemo: function () {
      var ctx = this.ctx, self = this, h = H().mR, kind = mamaFilling();
      var d = dishOf(kind), q = pinchQ(h);
      if (d.anchor.getWorldPosition(new V3()).x < -0.04) { h = H().mL; q = pinchQ(h); }
      var key = h === H().mL ? 'mL' : 'mR';
      busy[key] = true; h.idle = false;
      var top = heapTop(d);
      h.moveTo({ pos: rootFor(h, 'pinch', 'pinch', top.clone().add(V(0, 0.03, 0)), q), rot: q, pose: 'open', dur: 0.6, onDone: ctx.live(function () {
        h.setPose('pinch', 0.14);
        h.moveTo({ pos: rootFor(h, 'pinch', 'pinch', top, q), dur: 0.14, arc: 0, onDone: ctx.live(function () {
          var p = makePiece(kind);
          h.anchors.pinch.add(p); p.position.set(0, -0.007, 0);
          snd('pick', { vol: 0.6 });
          var rt = riceTop(W().riceM);
          h.moveTo({ pos: rootFor(h, 'pinch', 'pinch', rt.clone().add(V(0, 0.03, 0)), q), dur: 0.5, onDone: ctx.live(function () {
            h.moveTo({ pos: rootFor(h, 'pinch', 'pinch', rt.clone().add(V(0, 0.008, 0)), q), dur: 0.14, arc: 0, onDone: ctx.live(function () {
              dropPiece(p);
              W().riceM.setFilling(kind);
              snd('drop', { vol: 0.8 });
              h.setPose('open', 0.15);
              ctx.wait(0.15, function () { rest(h, 0.6); busy[key] = false; self.phase = 'play'; self.setHint(); });
            }) });
          }) });
        }) });
      }) });
    },
    down: function (ev) {
      if (this.phase === 'play' && !this.drag) {
        var ds = props().tray.dishes, best = null, bd = 1e9;
        for (var i = 0; i < ds.length; i++) { var dd = dist(ev, heapTop(ds[i])); if (dd < bd) { bd = dd; best = ds[i]; } }
        if (best && (bd < 80 || G.Input.pick(ev, best.group || best.anchor))) { this.grab(ev, best); return; }
      }
      pokeAny(this.ctx, ev, { tray: this.phase === 'play', rice: false });
    },
    grab: function (ev, dish) {
      var ctx = this.ctx, self = this;
      var left = wpos(dish.anchor).x < -0.04;
      var key = left ? 'cL' : 'cR', h = H()[key];
      if (busy[key]) return;
      G.Hint.clear();
      busy[key] = true; h.idle = false;
      var q = pinchQ(h);
      var p = makePiece(dish.kind);
      G.scene.add(p);
      p.position.copy(heapTop(dish)).add(V(0, -0.004, 0));
      p.scale.setScalar(0.6);
      G.tween(p.scale, { x: 1, y: 1, z: 1 }, 0.12, { ease: 'out' });
      G.tween(p.position, { y: p.position.y + 0.025 }, 0.2, { ease: 'out' });
      snd('pick');
      jiggle(dish.group || dish.anchor, 0.05);
      var d = this.drag = { ev: ev, h: h, key: key, q: q, piece: p, dish: dish, held: false, up: false };
      h.moveTo({ pos: rootFor(h, 'pinch', 'pinch', p.position.clone().add(V(0, 0.032, 0)), q), rot: q, pose: 'pinch', dur: 0.2, onDone: ctx.live(function () {
        if (self.drag !== d) return;
        h.attach(p, 'pinch');
        G.killTweens(p.position);
        var k = { v: 0 }, p0 = p.position.clone(), p1 = V(0, -0.007, 0);
        ctx.tw(k, { v: 1 }, 0.1, { onUpdate: function () { if (p.parent === h.anchors.pinch) p.position.lerpVectors(p0, p1, k.v); } });
        d.held = true; d.pos = h.root.position.clone();
        if (d.up) self.release();
      }) });
    },
    up: function (ev) {
      var d = this.drag; if (!d) return;
      d.ev = ev; d.up = true;
      if (d.held) this.release();
    },
    release: function () {
      var ctx = this.ctx, self = this, d = this.drag;
      if (!d) return;
      this.drag = null;
      var h = d.h, p = d.piece, rc = W().riceC, st = S();
      var bc = boardC();
      var pt = d.ev.onPlane(bc.y + 0.02);
      var bw = props().boardChild;
      var onBoard = pt && Math.abs(pt.x - bc.x) < 0.14 && Math.abs(pt.z - bc.z) < 0.11;
      var near = pt && rc && Math.hypot(pt.x - wpos(rc.group).x, pt.z - wpos(rc.group).z) < 0.10;
      h.detach(p, G.scene);
      h.setPose('open', 0.12);
      ctx.wait(0.1, function () { rest(h, 0.55); busy[d.key] = false; });
      if (onBoard || near) {
        var prev = rc.filling;
        arcTo(ctx, p, riceTop(rc).add(V(0, -0.004, 0)), 0.3, 0.03, function () {
          dropPiece(p);
          rc.setFilling(d.dish.kind);
          st.filling = d.dish.kind;
          snd('drop');
          fx('burst', riceTop(rc), { kind: 'grain', count: 3, speed: 0.14, floor: bc.y + 0.001 });
          jiggleBody(rc);
          if (prev && prev !== d.dish.kind) self.sendHome(prev);
          if (self.dest) { self.dest.dispose(); self.dest = null; }
          for (var i = 0; i < self.pulses.length; i++) self.pulses[i].setStrength(0);
          G.Hint.clear();
          if (!self.leaving) { self.leaving = true; ctx.wait(0.7, function () { self.goNext(); }); }
        });
      } else {
        arcTo(ctx, p, heapTop(d.dish).add(V(0, -0.004, 0)), 0.32, 0.025, function () {
          dropPiece(p); snd('tap', { vol: 0.3, pitch: 1.3 });
          if (!rc.filling) self.setHint();
        });
      }
    },
    sendHome: function (kind) {
      var p = makePiece(kind), rc = W().riceC;
      G.scene.add(p); p.position.copy(riceTop(rc));
      arcTo(this.ctx, p, heapTop(dishOf(kind)), 0.45, 0.06, function () { dropPiece(p); snd('tap', { vol: 0.3, pitch: 1.5 }); });
    },
    goNext: function () {
      if (this.drag) { var self = this; this.ctx.wait(0.2, function () { self.goNext(); }); return; }
      if (G.Director.current === 'S2') G.Director.go('S3');
    },
    update: function (dt, time) {
      var ps = this.pulses;
      if (ps && ps.length && this.phase === 'play' && !(W().riceC && W().riceC.filling) && !this.drag) {
        for (var i = 0; i < ps.length; i++) {
          var s = Math.sin((G.time || time) * 2.2 - i * 0.9);
          ps[i].setStrength(0.05 + 0.32 * Math.max(0, s) * Math.max(0, s));
        }
      } else if (ps) for (var j = 0; j < ps.length; j++) ps[j].setStrength(0);
      var d = this.drag;
      if (!d || !d.held) return;
      var p = d.ev.onPlane(boardC().y + 0.05);
      if (!p) return;
      var tgt = rootFor(d.h, 'pinch', 'pinch', p, d.q);
      d.pos.x = G.smooth(d.pos.x, tgt.x, 18, dt); d.pos.y = G.smooth(d.pos.y, tgt.y, 14, dt); d.pos.z = G.smooth(d.pos.z, tgt.z, 18, dt);
      d.h.root.position.copy(d.pos);
    },
    exit: function () {
      var d = this.drag;
      if (d) { dropPiece(d.piece); rest(d.h, 0.4); busy[d.key] = false; this.drag = null; }
      ['mL', 'mR', 'cL', 'cR'].forEach(function (k) { if (busy[k]) { rest(H()[k], 0.4); busy[k] = false; } });
      if (W().riceM && !W().riceM.filling) W().riceM.setFilling(mamaFilling());
      if (this.ctx) this.ctx.end();
      this.pulses = []; this.dest = null;
      G.Hint.clear();
    }
  };

  /* ================================================================== S3 かたち＋にぎる */
  // 両手の「壁」: 手のひらの面をごはんの輪郭（上から見た支持距離）に当てる
  function support(outline, theta) {
    var n = outline.length, best = -1e9;
    for (var i = 0; i < n; i++) { var v = outline[i] * Math.cos(i / n * TAU - theta); if (v > best) best = v; }
    return best;
  }
  var _tgtCache = {};
  function tgtOutline(t) {
    var k = Math.round(t * 200);
    if (!_tgtCache[k]) _tgtCache[k] = G.Rice.targetOutline(k / 200);
    return _tgtCache[k];
  }
  // 片手ぶんの壁姿勢。o = {c:中心(板の上面), size, t, body, press 0..1, open(m)}
  function wallRig(h, o) {
    var t = clamp(o.t, 0, 1), sg = h.sign || (h.side === 'L' ? -1 : 1);
    var psi = G.Hands.wallYaw ? G.Hands.wallYaw(t) : 0.48 * sstep(0, 0.5, t);
    var sc = h.dims.palmLen / 0.088, size = o.size;
    var thn = sg > 0 ? psi : PI - psi;
    var hT = support(tgtOutline(t), thn) * size;
    var hA = o.body ? support(o.body.outline, thn) * size : hT;
    var f = o.body ? clamp(o.body.formed, 0, 1) : 1;
    var hRest = Math.max(hA, hT * 0.96) + 0.07 * size * (1 - f) + 0.0016;
    var hPress = Math.min(hA, hT) * (1 - 0.08) - 0.0004;
    var hh = lerp(hRest, hPress, clamp(o.press || 0, 0, 1)) + (o.open || 0);
    var sp = Math.sin(psi), cp = Math.cos(psi);
    var zd = lerp(0.012, 0.035, sstep(0, 0.5, t)) * sc - 0.02 * sc * sstep(0.5, 1, t);
    var zoff = zd;
    if (sp > 0.05) {
      var L = (h.dims.length - h.dims.palmLen * 0.62) * 0.93, eps = 0.0032 * sc + (o.open || 0) * 0.6;
      var zM = ((eps + L * sp) * cp - hh) / sp;
      var wm = t <= 0.5 ? sstep(0.12, 0.5, t) : 1 - sstep(0.5, 0.85, t);
      zoff = lerp(zd, zM, wm);
    }
    var gap = (hh + zoff * sp) / cp;
    return h.wallTarget(t, { cx: o.c.x, cz: o.c.z, topY: o.c.y, gap: gap, zoff: zoff });
  }
  // 両手の組（ママ / 子ども）
  function Pair(L, R, body, c) {
    this.L = L; this.R = R; this.body = body; this.c = c;
    this.t = 0; this.tShown = 0; this.press = 0; this.open = 0; this.on = false; this.approaching = false;
  }
  Pair.prototype.targets = function (tt) {
    var o = { c: this.c, size: this.body.size, t: tt != null ? tt : this.tShown, body: this.body, press: this.press, open: this.open };
    return [wallRig(this.L, o), wallRig(this.R, o)];
  };
  Pair.prototype.approach = function (ctx, dur, onDone) {
    var self = this, n = 0;
    this.on = false; this.approaching = true;
    this.tShown = this.t;
    var tg = this.targets();
    [this.L, this.R].forEach(function (h, i) {
      h.idle = false;
      h.moveTo({ pos: tg[i].pos, rot: tg[i].rot, pose: tg[i].pose, dur: dur, onDone: ctx.live(function () {
        if (++n === 2) { self.approaching = false; self.on = true; if (onDone) onDone(); }
      }) });
    });
  };
  Pair.prototype.release = function () { this.on = false; this.approaching = false; };
  var _qq = new Q();
  Pair.prototype.update = function (dt) {
    if (!this.on) return;
    this.tShown = G.smooth(this.tShown, this.t, 16, dt);
    if (Math.abs(this.tShown - this.t) < 0.002) this.tShown = this.t;
    var tg = this.targets(), hs = [this.L, this.R], k = 1 - Math.exp(-18 * dt);
    for (var i = 0; i < 2; i++) {
      var h = hs[i];
      h.root.position.lerp(tg[i].pos, k);
      h.root.quaternion.slerp(tg[i].rot, k);
      try { h.setPose(tg[i].pose, 0); } catch (e) { /* ignore */ }
    }
  };
  Pair.prototype.snapNow = function () {
    var tg = this.targets(), hs = [this.L, this.R];
    for (var i = 0; i < 2; i++) { stopHand(hs[i]); hs[i].root.position.copy(tg[i].pos); hs[i].root.quaternion.copy(tg[i].rot); }
  };
  Pair.prototype.glow = function (v) { if (this.L.setGlow) this.L.setGlow(v); if (this.R.setGlow) this.R.setGlow(v); };
  Pair.prototype.tips = function () {
    var a = wpos(this.L.anchors.midTip), b = wpos(this.R.anchors.midTip);
    return { L: a, R: b, mid: a.clone().add(b).multiplyScalar(0.5) };
  };

  var lastT = 0;      // 前の回の子どもの形（回をまたいで保つ）
  var S3 = {
    enter: function () {
      var ctx = this.ctx = new Ctx('S3'), self = this, w = W(), st = S(), hs = H();
      var F = w.FRAMES.shape;
      G.Cam.frame({ cx: F.cx, cz: F.cz, w: F.w, d: F.d, pad: F.pad, dur: 1.0 });
      var rm = ensureRice('M'), rc = ensureRice('C');
      if (!rm.filling) rm.setFilling(mamaFilling());
      if (!st.filling && rc.filling) st.filling = rc.filling;
      if (!st.__tInit) { st.t = lastT; st.__tInit = true; }
      warmAnchors();
      for (var k in hs) { busy[k] = false; if (hs[k].setGlow) hs[k].setGlow(0); }
      this.mama = new Pair(hs.mL, hs.mR, rm, boardM());
      this.kid = new Pair(hs.cL, hs.cR, rc, boardC());
      this.kid.t = st.t;
      this.phase = 'demo';
      this.op = null;          // {kind:'shape'|'squeeze', ...}
      this.squeezed = false; this.hintMode = null; this.idleT = 0; this.redoing = false;
      this.matchShown = Math.abs(st.t - st.mamaT) < 0.05;
      this.pressing = false; this.relAt = -1; this.peak = 0;
      if (rm.formed >= 0.999) { this.mama.t = st.mamaT; this.mama.open = 0.008; this.mama.approach(ctx, 0.7); ctx.wait(0.5, function () { self.kidTurn(); }); }
      else ctx.wait(0.5, function () { self.mamaDemo(); });
      ctx.on('down', function (ev) { self.down(ev); });
      ctx.on('move', function (ev) { self.move(ev); });
      ctx.on('up', function (ev) { self.up(ev); });
    },
    // ママのお手本 約5秒
    mamaDemo: function () {
      var ctx = this.ctx, self = this, m = this.mama, st = S(), rm = W().riceM;
      m.t = 0; m.open = 0.012; m.press = 0;
      m.approach(ctx, 0.75, function () {
        var mt = st.mamaT;
        var k = { v: 0 };
        // 形へ すーっと
        var shapeDur = mt > 0.01 ? 0.85 : 0.5;
        ctx.tw(m, { open: 0.003 }, shapeDur, { ease: 'inOut' });
        ctx.tw(k, { v: 1 }, shapeDur, { ease: 'inOut', onUpdate: function () { m.t = mt * k.v; }, onDone: function () {
          m.t = mt;
          snd('tick');
          m.glow(1);
          ctx.wait(0.8, function () { m.glow(0); });
          ctx.wait(0.35, function () { self.mamaSqueeze(0); });
        } });
      });
    },
    mamaSqueeze: function (n) {
      var ctx = this.ctx, self = this, m = this.mama, rm = W().riceM, mt = S().mamaT;
      var p = { v: 0 };
      snd('squish', { vol: 0.8 });
      ctx.tw(m, { open: 0 }, 0.2);
      ctx.tw(p, { v: 1 }, 0.25, { ease: 'inOut', onUpdate: function () { m.press = p.v; rm.setPress(p.v); }, onDone: function () {
        ctx.wait(0.1, function () {
          rm.squeeze(mt, 0.55);
          if (n === 2) rm.squeeze(mt, 0.3);
          snd('release', { vol: 0.6 });
          ctx.tw(p, { v: 0 }, 0.16, { ease: 'out', onUpdate: function () { m.press = p.v; rm.setPress(p.v); } });
          ctx.tw(m, { open: 0.004 }, 0.16);
          if (n < 2) ctx.wait(0.32, function () { self.mamaSqueeze(n + 1); });
          else {
            snd('done', { vol: 0.5 });
            fx('burst', riceTop(rm), { kind: 'sparkle', count: 8, speed: 0.12 });
            ctx.tw(m, { open: 0.009 }, 0.35, { ease: 'out' });
            ctx.wait(0.45, function () { self.kidTurn(); });
          }
        });
      } });
    },
    kidTurn: function () {
      var self = this, kid = this.kid;
      kid.t = S().t; kid.open = 0.004; kid.press = 0;
      this.phase = 'approach';
      kid.approach(this.ctx, 0.7, function () { self.phase = 'play'; self.idleT = 0; self.hintMode = null; });
    },
    mamaRedo: function () {
      var ctx = this.ctx, self = this, m = this.mama, mt = S().mamaT;
      if (this.redoing || !m.on) return;
      this.redoing = true;
      var k = { v: 1 };
      ctx.tw(m, { open: 0.016 }, 0.4, { ease: 'inOut' });
      ctx.tw(k, { v: 0 }, 0.45, { ease: 'inOut', onUpdate: function () { m.t = mt > 0.01 ? mt * k.v : 0.25 * (1 - k.v) * k.v * 4; }, onDone: function () {
        ctx.tw(m, { open: 0.008 }, 0.6, { ease: 'inOut' });
        ctx.tw(k, { v: 1 }, 0.6, { ease: 'inOut', onUpdate: function () { m.t = mt > 0.01 ? mt * k.v : 0; }, onDone: function () {
          m.t = mt; snd('tick', { vol: 0.7 }); m.glow(1);
          ctx.wait(0.8, function () { m.glow(0); self.redoing = false; });
        } });
      } });
    },
    // 触った場所の帯: 'shape'（指先）/ 'squeeze'（ごはん・手のひら）/ null
    band: function (ev) {
      var rc = W().riceC, c = this.kid.c;
      var p = ev.onPlane(c.y + 0.015);
      var R = rc.size * 1.15;
      var dRice = dist(ev, riceTop(rc));
      if (dRice < 62) return 'squeeze';
      if (p) {
        var dx = p.x - c.x, dz = p.z - c.z;
        var tips = this.kid.tips();
        var dTips = Math.min(dist(ev, tips.L), dist(ev, tips.R), dist(ev, tips.mid));
        var edge = -R * 0.92;
        if (Math.abs(dx) < 0.10 && dz < edge && dz > -0.13) return 'shape';
        if (dTips < 52 && dz < edge + 0.012) return 'shape';
        if (Math.abs(dx) < 0.095 && dz >= edge && dz < 0.085) return 'squeeze';
      }
      return null;
    },
    down: function (ev) {
      this.idleT = 0;
      if (this.phase !== 'play' || this.op) {
        if (this.phase !== 'play') pokeAny(this.ctx, ev, { rice: false });
        return;
      }
      var b = this.band(ev);
      if (b === 'shape') {
        var p = ev.onPlane(this.kid.c.y + 0.03) || this.kid.c.clone();
        var side = p.x - this.kid.c.x;
        this.op = { kind: 'shape', p0: p, t0: S().t, side: Math.abs(side) < 0.008 ? 1 : Math.sign(side), lastSnap: Math.round(S().t * 2) / 2, x0: ev.x };
        snd('tap', { vol: 0.35, pitch: 1.2 });
        this.kid.glow(1);
      } else if (b === 'squeeze') {
        this.op = { kind: 'squeeze' };
        this.pressing = true; this.relAt = -1; this.peak = Math.max(this.peak, 0);
        aud('squeezeStart');
        snd('squish', { vol: 0.5 });
        G.Hint.clear(); this.hintMode = null;
        this.kid.glow(0);
      } else {
        pokeAny(this.ctx, ev, { rice: true });
      }
    },
    move: function (ev) {
      var op = this.op;
      if (!op || op.kind !== 'shape') return;
      var p = ev.onPlane(this.kid.c.y + 0.03);
      if (!p) return;
      var inward = -(p.x - op.p0.x) * op.side;
      var t = clamp(op.t0 + inward * 20, 0, 1);
      var st = S();
      st.t = t; lastT = t; this.kid.t = t;
      var near = Math.round(t * 2) / 2;
      if (near !== op.lastSnap && Math.abs(t - near) < 0.06) { op.lastSnap = near; snd('tick', { vol: 0.45 }); }
    },
    up: function (ev) {
      var op = this.op, st = S(), self = this;
      if (!op) return;
      this.op = null;
      if (op.kind === 'shape') {
        var tapLike = ev.moved < 10 && ev.duration < 0.4;
        var target;
        if (tapLike) {
          var cur = Math.round(st.t * 2) / 2;
          target = cur >= 1 ? 0 : cur + 0.5;
        } else target = Math.round(st.t * 2) / 2;
        var o = { v: st.t };
        this.ctx.tw(o, { v: target }, tapLike ? 0.28 : 0.15, { ease: 'out', onUpdate: function () { st.t = o.v; self.kid.t = o.v; } , onDone: function () {
          st.t = target; self.kid.t = target; lastT = target;
          self.checkShapeMatch();
        } });
        snd('tick');
        this.hintMode = null;
      } else if (op.kind === 'squeeze') {
        if (this.kid.press < 0.6) this.relAt = 0.6; else this.releaseSqueeze();
        this.pressing = false;
      }
    },
    checkShapeMatch: function () {
      var st = S();
      var m = Math.abs(st.t - st.mamaT) < 0.05;
      if (m && !this.matchShown) {
        this.matchShown = true;
        snd('match');
        this.kid.glow(1); this.mama.glow(1);
        var tips = this.kid.tips(), mt = this.mama.tips();
        fx('burst', tips.mid.clone().add(V(0, 0.02, 0)), { kind: 'sparkle', count: 10, speed: 0.12 });
        fx('burst', mt.mid.clone().add(V(0, 0.02, 0)), { kind: 'sparkle', count: 8, speed: 0.1 });
        var self = this;
        this.ctx.wait(1.0, function () { self.mama.glow(0); if (self.hintMode !== 'tips') self.kid.glow(0); });
      } else if (!m) this.matchShown = false;
      if (!m && !this.squeezed) { this.kid.glow(0.8); }
    },
    releaseSqueeze: function () {
      var rc = W().riceC, st = S(), kid = this.kid;
      var peak = kid.press;
      this.relAt = -1;
      aud('squeezeEnd');
      rc.squeeze(st.t, 0.22 + 0.20 * peak);
      snd('release');
      this.releasing = true;
      this.squeezed = true;
      if (peak > 0.95) fx('puff', riceTop(rc), { count: 3, size: 0.03 });
      st.grains = Math.min(6, (st.grains || 0) + 1);
      if (kid.L.setGrains) kid.L.setGrains(st.grains);
      if (kid.R.setGrains) kid.R.setGrains(st.grains);
      var c = kid.c, side = Math.random() < 0.5 ? -1 : 1;
      fx('burst', c.clone().add(V(side * rc.size * 0.9, 0.012, rc.size * 0.3)), { kind: 'grain', count: 2 + (Math.random() < 0.5 ? 1 : 0), speed: 0.12, floor: c.y + 0.001 });
      this.ctx.tw(kid, { open: 0.006 }, 0.18, { ease: 'out' });
      if (rc.formed >= 0.999) this.complete();
    },
    complete: function () {
      var ctx = this.ctx, self = this, st = S(), rc = W().riceC, rm = W().riceM, kid = this.kid, mama = this.mama;
      if (this.phase === 'done') return;
      this.phase = 'done';
      G.Hint.clear(); kid.glow(0); mama.glow(0);
      // 両手が ぱっと開く
      kid.release();
      [kid.L, kid.R].forEach(function (h) {
        var sg = h.sign || (h.side === 'L' ? -1 : 1);
        h.moveTo({ pos: h.root.position.clone().add(V(sg * 0.035, 0.018, 0.02)), pose: 'open', dur: 0.24, ease: G.Ease.out });
      });
      snd('done');
      fx('burst', riceTop(rc).add(V(0, 0.01, 0)), { kind: 'sparkle', count: 16, speed: 0.2 });
      var tg = G.Rice.targetOutline(st.mamaT), e = 0;
      for (var i = 0; i < tg.length; i++) e += (rc.outline[i] - tg[i]) * (rc.outline[i] - tg[i]);
      e = Math.sqrt(e / tg.length);
      var match = Math.abs(rc.t - st.mamaT) < 0.1 && Math.abs(st.t - st.mamaT) < 0.1 && e < 0.07;
      st.matched = match;
      mama.release();
      if (match) {
        ctx.wait(0.25, function () {
          snd('match');
          var p1 = ctx.keep(fx('pulse', rc.group, { strength: 0.45 })), p2 = ctx.keep(fx('pulse', rm.group, { strength: 0.45 }));
          fx('burst', riceTop(rm).add(V(0, 0.01, 0)), { kind: 'sparkle', count: 14, speed: 0.18 });
          ctx.wait(1.1, function () { if (p1) p1.stop(); if (p2) p2.stop(); });
          self.mamaClap();
        });
      } else {
        ctx.wait(0.25, function () { self.mamaWave(); });
      }
      ctx.wait(1.5 + 0.3, function () {
        ['cL', 'cR', 'mL', 'mR'].forEach(function (k) { rest(H()[k], 0.6); });
        ctx.wait(0.25, function () { if (G.Director.current === 'S3' && G.Director.has('S4')) G.Director.go('S4'); });
      });
    },
    mamaClap: function () {
      var ctx = this.ctx, hs = H(), c = this.mama.c;
      var L = hs.mL, R = hs.mR;
      function pose(h, gap) {
        var sg = h.sign || (h.side === 'L' ? -1 : 1);
        var q = qSide(h, 0.35, 0.15, -PI / 2 * 0.92);
        var tip = c.clone().add(V(sg * gap, 0.085, 0.03));
        return { pos: tip.sub(V(0, 0, -0.07).applyQuaternion(q)), rot: q };
      }
      function step(n) {
        if (n >= 2) { ctx.wait(0.2, function () { rest(L, 0.6); rest(R, 0.6); }); return; }
        var a = pose(L, 0.05), b = pose(R, 0.05);
        L.moveTo({ pos: a.pos, rot: a.rot, pose: 'flat', dur: n === 0 ? 0.35 : 0.12, arc: 0 });
        R.moveTo({ pos: b.pos, rot: b.rot, pose: 'flat', dur: n === 0 ? 0.35 : 0.12, arc: 0, onDone: ctx.live(function () {
          var a2 = pose(L, 0.012), b2 = pose(R, 0.012);
          L.moveTo({ pos: a2.pos, dur: 0.09, arc: 0, ease: G.Ease.in });
          R.moveTo({ pos: b2.pos, dur: 0.09, arc: 0, ease: G.Ease.in, onDone: ctx.live(function () {
            snd('clap', { vol: 0.45 }); step(n + 1);
          }) });
        }) });
      }
      step(0);
    },
    mamaWave: function () {
      var ctx = this.ctx, h = H().mR, c = this.mama.c;
      snd('yum');
      var base = c.clone().add(V(0.07, 0.07, 0.02));
      var n = 0;
      function sw() {
        if (n >= 4) { rest(h, 0.6); return; }
        var q = qSide(h, 0.3, (n % 2 ? -0.25 : 0.25), -0.25);
        n++;
        h.moveTo({ pos: base, rot: q, pose: 'open', dur: n === 1 ? 0.35 : 0.2, arc: 0, onDone: ctx.live(sw) });
      }
      sw();
    },
    update: function (dt) {
      var st = S(), kid = this.kid, mama = this.mama, rc = W().riceC;
      if (!kid) return;
      // 押し込み
      if (this.phase === 'play' || this.phase === 'done') {
        if (this.pressing || this.relAt > 0) {
          kid.press = Math.min(1, kid.press + dt / 0.35);
          if (kid.open > 0) kid.open = Math.max(0, kid.open - dt * 0.05);
          aud('squeezeSet', kid.press);
          if (this.relAt > 0 && kid.press >= this.relAt) this.releaseSqueeze();
        } else if (kid.press > 0) {
          kid.press = Math.max(0, kid.press - dt / 0.18);
        }
        if (rc.press !== kid.press) rc.setPress(kid.press);
      }
      mama.update(dt); kid.update(dt);
      if (this.phase !== 'play') return;
      // 放置
      if (!G.Input.active) this.idleT += dt; else this.idleT = 0;
      if (this.idleT > 6 && !this.op && kid.press === 0) { this.idleT = 0; this.mamaRedo(); }
      // 主役の案内
      if (this.op) return;
      var mode = (!this.squeezed && Math.abs(st.t - st.mamaT) > 0.05) ? 'tips' : 'rice';
      if (mode !== this.hintMode) {
        this.hintMode = mode;
        if (mode === 'tips') {
          kid.glow(0.8);
          var inward = st.mamaT > st.t;
          G.Hint.set({ kind: 'drag', at: function () { return wpos(kid.R.anchors.midTip); },
            to: function () { return wpos(kid.R.anchors.midTip).add(V(inward ? -0.028 : 0.028, 0, 0)); }, radius: 0.03 });
        } else {
          if (!this.matchShown) kid.glow(0);
          else this.ctx.wait(0.6, function () { kid.glow(0); });
          G.Hint.set({ kind: 'press', at: function () { return riceTop(W().riceC); }, object: rc.group, radius: Math.max(0.035, rc.size * 1.1) });
        }
      }
    },
    exit: function () {
      var st = S();
      if (this.pressing || this.relAt > 0) aud('squeezeEnd');
      this.pressing = false; this.relAt = -1; this.op = null;
      if (W().riceC) W().riceC.setPress(0);
      if (W().riceM) W().riceM.setPress(0);
      if (this.kid) { this.kid.release(); this.kid.glow(0); }
      if (this.mama) { this.mama.release(); this.mama.glow(0); }
      ['cL', 'cR', 'mL', 'mR'].forEach(function (k) { var h = H()[k]; if (h && !h._moving) rest(h, 0.5); busy[k] = false; });
      lastT = st.t;
      if (this.ctx) this.ctx.end();
      G.Hint.clear();
    }
  };

  /* 子どもの手が遠く（炊飯器・盆）へ届く時は、肘をカメラ側へ持ち上げて腕を手前から差し入れる（長い袖が画面を横切らない） */
  var elbow0 = {};
  function reachElbows() {
    var hs = G.W && G.W.hands; if (!hs) return;
    var mine = /^S[0-3]$/.test(G.Director.current || '');
    ['cL', 'cR'].forEach(function (k) {
      var h = hs[k]; if (!h || !h.elbow || !h.root) return;
      if (!elbow0[k]) elbow0[k] = h.elbow.clone();
      var e0 = elbow0[k], w = h.root.position;
      var r = mine ? sstep(0.36, 0.62, e0.z - w.z) : 0;
      if (r <= 0) { if (h.__reach) { h.elbow.copy(e0); h.__reach = false; } return; }
      var sg = h.sign || (h.side === 'L' ? -1 : 1);
      var re = w.clone().add(V(sg * 0.06, 0.15, 0.25));
      h.elbow.copy(e0).lerp(re, r); h.__reach = true;
    });
  }

  G.Scenes.registerA = function () {
    if (!G.Director) return;
    if (G.Engine && G.Engine.onUpdate) G.Engine.onUpdate(function () { try { reachElbows(); } catch (e) { /* ignore */ } });
    if (G.Rice && G.Rice.warm) { try { G.Rice.warm(); } catch (e) { /* ignore */ } }
    G.Director.add('S0', S0);
    G.Director.add('S1', S1);
    G.Director.add('S2', S2);
    G.Director.add('S3', S3);
  };
})();
