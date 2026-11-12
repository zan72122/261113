/* scenes_b.js — 場面役B: S4 のり / S5 おさら / S6 ちび / S7 たべる → ハイタッチ → おしまい → 次の回.
   Classic script. G.Scenes.registerB() registers S4..S7, G.Scenes.debugAfter(opts) jumps to S4
   with the "end of S3" state built directly (dev only, nothing on screen). */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var THREE = window.THREE;
  G.Scenes = G.Scenes || {};
  if (!THREE) { G.Scenes.registerB = function () {}; G.Scenes.debugAfter = function () {}; return; }
  try { if (G.Rice && G.Rice.warm) G.Rice.warm(); } catch (e) { /* ignore */ }

  var PI = Math.PI;
  var FILLS = ['ume', 'sake', 'kombu'];
  var Q0 = new THREE.Quaternion();
  function V(x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function log(tag, e) { if (window.console) console.error('[G:scenesB:' + tag + ']', e); }
  function snd(name, o) { try { if (G.Audio && G.Audio.play) G.Audio.play(name, o || {}); } catch (e) { /* ignore */ } }
  function wpos(o, out) { out = out || V(); if (!o) return out; o.updateWorldMatrix(true, false); return o.getWorldPosition(out); }
  function wquat(o) { var q = new THREE.Quaternion(); o.updateWorldMatrix(true, false); return o.getWorldQuaternion(q); }
  function qE(x, y, z) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ')); }
  function sideQ(hand, x, y, z) { var s = hand.side === 'L' ? -1 : 1; return qE(x, y * s, z * s); }
  function qDir(dir) {   // local -Z -> dir, local X kept horizontal
    var z = dir.clone().normalize().negate(), up = V(0, 1, 0);
    var x = new THREE.Vector3().crossVectors(up, z); if (x.lengthSq() < 1e-8) x.set(1, 0, 0); x.normalize();
    var y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function Wd() { return G.W; }
  function HS() { return G.W.hands; }
  function props() { return G.W.props; }
  function st() { return G.W.state; }
  function bodyTop(b) {
    var p = wpos(b.group), s = V(1, 1, 1); b.group.getWorldScale(s);
    var ty = 0.02; try { ty = b.topY(); } catch (e) { /* ignore */ }
    p.y += ty * s.y; return p;
  }
  /* where the palm goes when a hand holds an onigiri: its near (+Z) shoulder, so the rice stays in view */
  function holdPoint(b) {
    var p = wpos(b.group), s = V(1, 1, 1); b.group.getWorldScale(s);
    var ty = 0.02; try { ty = b.topY(); } catch (e) { /* ignore */ }
    var fr = b.outline ? b.outline[48] * b.size : b.size;
    return p.add(V(0, ty * s.y * 0.7, fr * s.z * 0.78));
  }
  function near(ev, p, px) { return !!(ev && p && G.Input.screenDist(ev, p) < (px || 75)); }
  function pickAny(ev, objs) { try { return G.Input.pick(ev, objs.filter(Boolean)); } catch (e) { return null; } }

  /* ------------------------------------------------------------------ poses */
  var P_HOLD_C = { curl: [0.30, 0.32, 0.35, 0.39], spread: 0.10, thumbOut: 0.52, thumbCurl: 0.24, thumbOpp: 0.40, arch: 0.26 };
  var P_HOLD_M = { curl: [0.30, 0.32, 0.35, 0.39], spread: 0.12, thumbOut: 0.55, thumbCurl: 0.22, thumbOpp: 0.40, arch: 0.26 };
  var P_PAT = { curl: [0.10, 0.12, 0.14, 0.17], spread: 0.05, thumbOut: 0.35, thumbCurl: 0.1, thumbOpp: 0.1, arch: 0.12 };
  var P_SLIDE = { curl: [0.22, 0.25, 0.28, 0.32], spread: -0.1, thumbOut: 0.3, thumbCurl: 0.15, thumbOpp: 0.15, arch: 0.2 };

  /* ------------------------------------------------------------------ anchors */
  var ALC = {};
  function hk(h) { return h.who + h.side; }
  function poseKey(p) { return typeof p === 'string' ? p : JSON.stringify(p); }
  function clonePose(p) { return JSON.parse(JSON.stringify(p)); }
  function anchorLocal(hand, name, pose) {
    pose = pose || 'relaxed';
    var key = hk(hand) + '|' + name + '|' + poseKey(pose);
    if (ALC[key]) return ALC[key].clone();
    var a = hand.anchors && hand.anchors[name];
    if (!a) return V(0, -0.01, -0.06);
    var real = typeof hand._applyPose === 'function';
    var save = null, ip = null, ir = null;
    if (real) {
      save = { pose: clonePose(hand.pose), from: hand._poseFrom, to: hand._poseTo, t: hand._poseT, dur: hand._poseDur, nm: hand._poseName };
      if (hand.inner) { ip = hand.inner.position.clone(); ir = hand.inner.rotation.clone(); hand.inner.position.set(0, 0, 0); hand.inner.rotation.set(0, 0, 0); }
      try { hand.setPose(pose, 0); } catch (e) { /* ignore */ }
    }
    hand.group.updateWorldMatrix(true, true);
    var out = hand.root.worldToLocal(a.getWorldPosition(V()));
    if (real) {
      hand.pose = save.pose; hand._poseFrom = save.from; hand._poseTo = save.to; hand._poseT = save.t; hand._poseDur = save.dur; hand._poseName = save.nm;
      try { hand._applyPose(); } catch (e) { /* ignore */ }
      if (hand.inner) { hand.inner.position.copy(ip); hand.inner.rotation.copy(ir); }
      hand.group.updateWorldMatrix(true, true);
      ALC[key] = out.clone();
    }
    return out;
  }
  function wristFor(hand, anchor, pose, q, target) {
    return target.clone().sub(anchorLocal(hand, anchor, pose).applyQuaternion(q));
  }

  /* orientations (tuned by eye from the game camera) */
  function qHold(h) { return h.who === 'mama' ? sideQ(h, -0.95, 0.42, 0.0) : sideQ(h, -0.98, 0.12, 0.0); }
  function qPinch(h) { return h.who === 'mama' ? sideQ(h, -0.5, 0.75, -0.35) : sideQ(h, -0.55, 0.2, -0.45); }
  function qPoint(h) { return h.who === 'mama' ? sideQ(h, -0.55, 0.55, -0.25) : sideQ(h, -0.5, 0.25, -0.25); }

  /* ------------------------------------------------------------------ scene context */
  var cur = null;
  function Ctx(name) {
    this.name = name; this.tw = []; this.ins = []; this.fx = []; this.drv = {}; this.trem = {};
    this.dead = false; this.ready = false; this.grab = null; this.t = 0;
  }
  var CP = Ctx.prototype;
  CP.ok = function () { return cur === this && !this.dead; };
  CP.T = function (target, to, dur, o) {
    var self = this; o = o || {};
    var oo = {};
    for (var k in o) oo[k] = o[k];
    if (o.onDone) oo.onDone = function () { if (self.ok()) o.onDone(); };
    if (o.onUpdate) oo.onUpdate = function (a, b) { if (self.ok()) o.onUpdate(a, b); };
    var h = G.tween(target, to, dur, oo);
    this.tw.push(h);
    if (this.tw.length > 200) this.tw.splice(0, 100);   // finished ones are harmless to drop
    return h;
  };
  CP.wait = function (sec, fn) { return this.T({ k: 0 }, { k: 1 }, sec, { ease: 'linear', onDone: fn }); };
  CP.on = function (type, fn) {
    var self = this;
    var w = function (ev) { if (self.ok()) { try { fn(ev); } catch (e) { log('input', e); } } };
    G.Input.on(type, w); this.ins.push([type, w]);
  };
  CP.addFx = function (h) { if (h) this.fx.push(h); return h; };
  CP.drive = function (hand, fn) {
    if (hand._killTw) { try { hand._killTw(); } catch (e) { /* ignore */ } }
    var d = { hand: hand, fn: fn, t: 0 };
    this.drv[hk(hand)] = d;
    return d;
  };
  CP.undrive = function (hand, d) { var k = hk(hand); if (!d || this.drv[k] === d) delete this.drv[k]; };
  CP.tremble = function (hand, amp, dur) { this.trem[hk(hand)] = { hand: hand, amp: amp, dur: dur, t: 0 }; };
  CP.run = function (dt) {
    this.t += dt;
    var k, list = [];
    for (k in this.drv) list.push(this.drv[k]);
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (this.drv[hk(d.hand)] !== d) continue;
      d.t += dt;
      try { d.fn(dt, d); } catch (e) { log('drv', e); this.undrive(d.hand, d); }
    }
    for (k in this.trem) {
      var tr = this.trem[k];
      tr.t += dt;
      if (tr.t >= tr.dur || !this.drv[k]) { delete this.trem[k]; continue; }
      var f = 1 - tr.t / tr.dur, a = tr.amp * f, tt = this.t;
      var r = tr.hand.root;
      r.position.x += a * Math.sin(tt * 73.0);
      r.position.y += a * 0.6 * Math.sin(tt * 61.0 + 1.1);
      r.position.z += a * 0.4 * Math.sin(tt * 57.0 + 2.3);
      r.quaternion.multiply(qE(0, 0, a * 9 * Math.sin(tt * 67.0)));
    }
  };
  CP.kill = function () {
    this.dead = true;
    var i;
    for (i = 0; i < this.tw.length; i++) { try { this.tw[i].kill(); } catch (e) { /* ignore */ } }
    this.tw = [];
    for (i = 0; i < this.ins.length; i++) G.Input.off(this.ins[i][0], this.ins[i][1]);
    this.ins = [];
    for (i = 0; i < this.fx.length; i++) {
      var f = this.fx[i];
      try { if (f.dispose) f.dispose(); else if (f.stop) f.stop(); } catch (e) { /* ignore */ }
    }
    this.fx = [];
    this.drv = {}; this.trem = {};
  };
  /* move the wrist along a short eased arc (own driver: no fight with hand tweens) */
  CP.path = function (hand, o) {
    var self = this, root = hand.root;
    var from = root.position.clone(), fq = root.quaternion.clone();
    var to = o.pos ? o.pos.clone() : from.clone(), tq = o.q ? o.q.clone() : fq.clone();
    var dur = Math.max(0, o.dur != null ? o.dur : 0.4);
    if (o.pose) { try { hand.setPose(o.pose, o.poseDur != null ? o.poseDur : clamp(dur * 0.8, 0.1, 0.35)); } catch (e) { /* ignore */ } }
    var arc = o.arc != null ? o.arc : Math.min(0.035, from.distanceTo(to) * 0.18);
    var ease = typeof o.ease === 'function' ? o.ease : (G.Ease[o.ease || 'inOut'] || G.Ease.inOut);
    var done = false;
    var d = this.drive(hand, function (dt, dd) {
      var k = dur > 0 ? Math.min(1, dd.t / dur) : 1, e = ease(k), ec = clamp(e, 0, 1);
      root.position.lerpVectors(from, to, e);
      root.position.y += arc * Math.sin(PI * ec);
      root.quaternion.slerpQuaternions(fq, tq, ec);
      if (k >= 1 && !done) {
        done = true;
        if (o.release) self.undrive(hand, dd);
        if (o.onDone && self.ok()) o.onDone();
      }
    });
    if (dur === 0) d.fn(0, d);
    return d;
  };
  CP.follow = function (hand, getT, rate) {
    var root = hand.root;
    return this.drive(hand, function (dt, d) {
      var g = getT(); if (!g) return;
      var r = (rate || 20) * Math.min(1, 0.35 + d.t * 4);
      var k = 1 - Math.exp(-r * dt);
      root.position.lerp(g.pos, k);
      if (g.q) root.quaternion.slerp(g.q, k);
    });
  };
  CP.rest = function (hand, dur, delay) {
    var self = this;
    var go = function () {
      self.path(hand, { pos: hand.restPos, q: new THREE.Quaternion().setFromEuler(hand.restRot), pose: hand.restPose || 'relaxed', dur: dur != null ? dur : 0.5, release: true });
    };
    if (delay) this.wait(delay, go); else go();
  };
  CP.reach = function (hand, anchor, pose, q, point, dur, onDone, ease) {
    return this.path(hand, { pos: wristFor(hand, anchor, pose, q, point), q: q, pose: pose, dur: dur, arc: 0.012, ease: ease || 'out', onDone: onDone, poseDur: Math.min(0.2, dur) });
  };
  /* carry an object that is attached to the hand so its origin lands on `target` */
  CP.carry = function (hand, obj, target, dur, o) {
    o = o || {};
    var off = target.clone().sub(wpos(obj));
    return this.path(hand, { pos: hand.root.position.clone().add(off), q: o.q || hand.root.quaternion.clone(), dur: dur, arc: o.arc, ease: o.ease, onDone: o.onDone });
  };
  /* settle obj into parent at local position (soft, never a jump) */
  CP.settle = function (obj, parent, local, dur) {
    parent.updateWorldMatrix(true, false);
    parent.attach(obj);
    var l = local || V();
    this.T(obj.position, { x: l.x, y: l.y, z: l.z }, dur || 0.12, { ease: 'out' });
    this.T(obj.rotation, { x: 0, y: 0, z: 0 }, dur || 0.12, { ease: 'out' });
  };
  CP.wobble = function (obj) {
    if (!obj || obj.userData.__wob) return;
    obj.userData.__wob = true;
    var r0 = obj.rotation.z, self = this, p = { k: 0 };
    G.tween(p, { k: 1 }, 0.32, { ease: 'linear', onUpdate: function () { obj.rotation.z = r0 + 0.07 * Math.sin(p.k * PI * 3) * (1 - p.k); }, onDone: function () { obj.rotation.z = r0; obj.userData.__wob = false; } });
    void self;
  };
  CP.hop = function (obj, h, dur) {
    var y0 = obj.position.y, p = { k: 0 };
    this.T(p, { k: 1 }, dur || 0.22, { ease: 'linear', onUpdate: function () { obj.position.y = y0 + (h || 0.006) * Math.sin(PI * p.k); }, onDone: function () { obj.position.y = y0; } });
  };
  /* tap feedback while not the moment to act */
  CP.smallReact = function (ev) {
    var W = Wd(), hs = HS();
    var hit = pickAny(ev, [W.riceC && W.riceC.group, W.riceM && W.riceM.group, W.riceTiny && W.riceTiny.group, hs.mL.group, hs.mR.group]);
    snd('tap', { vol: 0.35 });
    if (!hit) return;
    var o = hit.object;
    while (o && o.parent && !(o.userData && o.userData.body) && !/^hand-/.test(o.name || '')) o = o.parent;
    if (o && o.userData && o.userData.body && !this.isHeld(o)) this.wobble(o);
  };
  CP.isHeld = function (obj) {
    var p = obj.parent;
    while (p) { if (/^hand-/.test(p.name || '')) return true; p = p.parent; }
    return false;
  };

  /* drag helper: o = {hand, anchor, pose, q, obj, grabPoint(), lift, planeY, reachDur, onDrop(p, ev)} */
  CP.startGrab = function (o, ev) {
    var self = this;
    var g = { o: o, phase: 'reach', up: null, target: wpos(o.obj).add(V(0, o.lift, 0)), off: null };
    this.grab = g;
    this.moveGrab(ev);
    this.reach(o.hand, o.anchor, o.pose, o.q, o.grabPoint(), o.reachDur || 0.16, function () {
      if (self.grab !== g) return;
      o.hand.attach(o.obj, o.anchor);
      g.phase = 'carry';
      g.off = wpos(o.obj).sub(wpos(o.hand.anchors[o.anchor] || o.hand.root));
      var al = anchorLocal(o.hand, o.anchor, o.pose);
      self.follow(o.hand, function () {
        var a = g.target.clone().sub(g.off);
        return { pos: a.sub(al.clone().applyQuaternion(o.q)), q: o.q };
      }, 20);
      if (o.onCarry) o.onCarry(g);
      if (g.up) self.finishGrab(g, g.up);
    });
    return g;
  };
  CP.moveGrab = function (ev) {
    var g = this.grab; if (!g || !ev) return;
    var p = ev.onPlane(g.o.planeY + g.o.lift);
    if (p) { p.x = clamp(p.x, -0.28, 0.28); p.z = clamp(p.z, g.o.minZ != null ? g.o.minZ : -0.42, 0.22); g.target.copy(p); }
  };
  CP.upGrab = function (ev) {
    var g = this.grab; if (!g) return;
    if (g.phase === 'reach') { g.up = ev; return; }
    this.finishGrab(g, ev);
  };
  CP.finishGrab = function (g, ev) {
    if (this.grab !== g) return;
    this.grab = null;
    var p = (ev && ev.onPlane(g.o.planeY)) || null;
    g.o.onDrop(p, ev, g);
  };

  /* ------------------------------------------------------------------ shared bits */
  function boardTop() { var b = props().boardChild; return (typeof b.topY === 'number' ? b.topY : 0.012); }
  function boardMTop() { var b = props().boardMama; return (typeof b.topY === 'number' ? b.topY : 0.012); }
  function boardCenter() { var p = wpos(props().boardChild); p.y += boardTop(); return p; }
  function boardMCenter() { var p = wpos(props().boardMama); p.y += boardMTop(); return p; }
  function slots() { return props().plate.slots; }
  function plateCenter() { return wpos(props().plate); }
  function onChildBoard(p) {
    if (!p) return false;
    var c = wpos(props().boardChild);
    return Math.abs(p.x - c.x) < 0.125 && Math.abs(p.z - c.z) < 0.09;
  }
  function makeBody(size, t, filling, amount, n) {
    var b = G.Rice.createBody({ size: size });
    b.setFilling(filling || null);
    for (var i = 0; i < (n || 4) && b.formed < 0.999; i++) b.squeeze(t, amount || 0.42);
    while (b.formed < 0.999) b.squeeze(t, 0.5);
    return b;
  }
  /* make sure the S3 result exists (direct entry / dev) */
  function ensureRice() {
    var W = Wd(), s = st();
    if (!W.riceM || !W.riceM.group) {
      W.riceM = makeBody(0.043, s.mamaT, s.mamaFilling, 0.55, 3);
      var pm = boardMCenter(); W.riceM.group.position.copy(pm); G.scene.add(W.riceM.group);
    }
    if (!W.riceC || !W.riceC.group) {
      W.riceC = makeBody(0.03, s.t || 0, s.filling, 0.42, 4);
      var pc = boardCenter(); W.riceC.group.position.copy(pc); G.scene.add(W.riceC.group);
    }
    if (W.riceC.formed < 0.999) { while (W.riceC.formed < 0.999) W.riceC.squeeze(s.t || 0, 0.5); }
    if (W.riceM.formed < 0.999) { while (W.riceM.formed < 0.999) W.riceM.squeeze(s.mamaT, 0.5); }
  }
  function sameShape() { var s = st(); return Math.abs((s.t || 0) - (s.mamaT || 0)) < 0.1; }
  function restAll(c, dur, except) {
    var hs = HS();
    ['cL', 'cR', 'mL', 'mR'].forEach(function (k) { if (!except || except.indexOf(k) < 0) c.rest(hs[k], dur); });
  }
  function frameOf(name, dur) {
    var f = G.W.FRAMES[name]; if (!f) return;
    var o = {}; for (var k in f) o[k] = f[k];
    o.dur = dur; G.Cam.frame(o);
  }
  function hintDest(c, fn, r) {
    var h = G.FX.halo(fn, { radius: r || 0.045 });
    h.setStrength(0.45);
    return c.addFx(h);
  }
  /* mama points at a spot: index tip above it, tap tap, back to rest */
  function mamaPoint(c, hand, at, done) {
    var q = qPoint(hand);
    var p = at().add(V(0, 0.03, 0.012));
    c.reach(hand, 'indexTip', 'point', q, p, 0.4, function () {
      var w0 = hand.root.position.clone(), n = 0;
      var tap = function () {
        c.path(hand, { pos: w0.clone().add(V(0, -0.016, -0.004)), q: q, dur: 0.12, arc: 0, ease: 'out', onDone: function () {
          c.path(hand, { pos: w0, q: q, dur: 0.14, arc: 0, ease: 'inOut', onDone: function () {
            if (++n < 2) tap(); else { c.rest(hand, 0.55); if (done) done(); }
          } });
        } });
      };
      tap();
    }, 'inOut');
  }
  /* mama slides an object (tray/plate) with one hand following it */
  function slideWith(c, hand, obj, edgeLocal, toPos, dur, clampX, pose, delay) {
    var q = sideQ(hand, -0.3, 0.75, -0.2);
    var al = anchorLocal(hand, 'midTip', pose || P_SLIDE);
    c.follow(hand, function () {
      var e = obj.localToWorld(edgeLocal.clone());
      if (hand.side === 'L') e.x = Math.max(e.x, clampX); else e.x = Math.min(e.x, clampX);
      return { pos: e.sub(al.clone().applyQuaternion(q)), q: q };
    }, 14);
    try { hand.setPose(pose || P_SLIDE, 0.3); } catch (e) { /* ignore */ }
    G.killTweens(obj.position);
    c.T(obj.position, { x: toPos.x, y: toPos.y, z: toPos.z }, dur, { ease: 'inOut', delay: delay || 0 });
  }
  function sparkle(p, n, sp) { try { G.FX.burst(p, { kind: 'sparkle', count: n || 12, speed: sp }); } catch (e) { /* ignore */ } }

  /* ================================================================== S4 のり */
  function makeNori(width, len) {
    var piv = new THREE.Group(); piv.name = 'noriPivot';
    var strip = G.Rice.createNoriStrip({ width: width, length: len });
    strip.position.z = -len / 2;
    piv.add(strip);
    piv.userData.len = len; piv.userData.strip = strip;
    G.scene.add(piv);
    return piv;
  }
  function noriFar(piv) { return piv.localToWorld(V(0, 0, -piv.userData.len)); }
  function noriMid(piv) { return piv.localToWorld(V(0, 0, -piv.userData.len / 2)); }
  /* swap the pivot to the other end (keeps the world look) */
  function rePivot(piv) {
    var np = new THREE.Group(); np.name = 'noriPivot';
    np.userData.len = piv.userData.len; np.userData.strip = piv.userData.strip;
    G.scene.add(np);
    np.position.copy(noriFar(piv));
    np.quaternion.copy(wquat(piv)).multiply(qE(0, PI, 0));
    np.updateWorldMatrix(true, false);
    np.attach(piv.userData.strip);
    if (piv.parent) piv.parent.remove(piv);
    return np;
  }
  function removeObj(o) { if (o && o.parent) o.parent.remove(o); }

  var S4 = {
    enter: function () {
      var c = cur = new Ctx('S4');
      var W = Wd(), hs = HS();
      ensureRice();
      frameOf('nori', 0.6);
      c.nori = [];   // {piv, hand, q}
      c.addFx(G.FX.steam(function () { return bodyTop(W.riceM).add(V(0, 0.004, 0)); }, { rate: 1.6, size: 0.03, rise: 0.10, life: 1.5 }));
      c.addFx(G.FX.steam(function () { return W.riceC ? bodyTop(W.riceC).add(V(0, 0.004, 0)) : null; }, { rate: 1.2, size: 0.024, rise: 0.09, life: 1.3 }));
      c.rest(hs.cL, 0.4); c.rest(hs.cR, 0.4);
      if (W.riceM.nori > 0.99 && W.riceC.nori > 0.99) { c.wait(0.4, function () { G.Director.go('S5'); }); return; }

      // ① mama's left hand lays a strip on her own onigiri
      var mL = hs.mL, mR = hs.mR;
      var rm = W.riceM;
      var go2 = function () { S4.offer(c); };
      if (rm.nori < 0.99) {
        var len = rm.size * 2.2, nM = makeNori(rm.size * 0.95, len);
        var qp = qPinch(mL);
        var pinch0 = wpos(mL.anchors.pinch);
        nM.position.copy(pinch0);
        c.nori.push({ piv: nM, hand: mL, q: qDir(V(0.15, -0.05, -1)) });
        mL.attach(nM, 'pinch');
        var rp = wpos(rm.group), frontR = rm.outline ? rm.outline[48] * rm.size : rm.size;
        var target = V(rp.x, rp.y + rm.topY() + 0.008, rp.z + frontR + 0.004);
        c.reach(mL, 'pinch', 'pinch', qp, target, 0.65, function () {
          var n = c.nori.shift(); if (n) removeObj(n.piv);
          snd('nori', { vol: 0.8 });
          var pr = { v: 0.15 };
          c.T(pr, { v: 1 }, 0.5, { ease: 'out', onUpdate: function () { rm.setNori(pr.v); }, onDone: function () { rm.setNori(1); } });
          c.rest(mL, 0.6, 0.15);
          c.wait(0.35, go2);
        }, 'inOut');
      } else go2();
      void mR;
    },
    /* ② mama's right hand holds a strip out between the boards */
    offer: function (c) {
      var W = Wd(), hs = HS(), mR = hs.mR, rc = W.riceC;
      if (rc.nori > 0.99) { c.wait(0.5, function () { G.Director.go('S5'); }); return; }
      var len = rc.size * 2.3;
      var piv = makeNori(rc.size * 0.95, len);
      var dBA = V(-1, -0.12, 0.42).normalize();
      var bc = boardCenter(), mc = boardMCenter();
      var center = V(bc.x + 0.10, 0.07, (bc.z - 0.08 + mc.z + 0.09) / 2);
      var B = center.clone().addScaledVector(dBA, -len / 2);
      c.offerCenter = center; c.offerDir = dBA;
      var qN = qDir(dBA);
      piv.position.copy(wpos(mR.anchors.pinch));
      piv.quaternion.copy(qN);
      mR.attach(piv, 'pinch');
      var hold = { piv: piv, hand: mR, q: qN };
      c.nori.push(hold);
      c.noriC = piv; c.noriState = 'mama';
      var q = sideQ(mR, -0.42, 0.95, -0.3);
      c.reach(mR, 'pinch', 'pinch', q, B, 0.6, function () {
        // ゆらゆら while waiting
        var base = mR.root.position.clone();
        c.swayAmp = 1;
        c.drive(mR, function (dt, d) {
          var a = c.swayAmp;
          mR.root.position.set(base.x + 0.002 * a * Math.sin(d.t * 2.1), base.y + 0.003 * a * Math.sin(d.t * 2.6 + 0.6), base.z);
          mR.root.quaternion.copy(q).multiply(qE(0.05 * a * Math.sin(d.t * 2.6), 0, 0.04 * a * Math.sin(d.t * 2.1 + 1)));
        });
        S4.setHint(c);
        c.ready = true;
      }, 'inOut');
      c.wait(0.25, function () { snd('nori', { vol: 0.35, pitch: 1.2 }); });
    },
    setHint: function (c) {
      var W = Wd();
      G.Hint.set({
        kind: 'drag', radius: 0.035,
        at: function () { return c.noriC ? noriMid(c.noriC).add(V(0, c.noriState === 'counter' ? -0.0008 : -0.012, 0)) : null; },
        to: function () { return W.riceC ? bodyTop(W.riceC) : null; },
        onLevel: function (lv) { c.swayAmp = lv >= 1 ? 2.2 : 1; if (lv >= 1) snd('nori', { vol: 0.3, pitch: 1.3 }); }
      });
      if (!c.dest) c.dest = hintDest(c, function () { return W.riceC ? wpos(W.riceC.group) : null; }, W.riceC.size * 1.5);
      c.dest.setStrength(0.22);
    },
    down: function (ev) {
      var c = cur, W = Wd(), hs = HS();
      if (!c || c.grab) return;
      if (!c.ready || !c.noriC) { c.smallReact(ev); return; }
      var piv = c.noriC;
      var hit = near(ev, noriMid(piv), 80) || near(ev, noriFar(piv), 70) || near(ev, piv.getWorldPosition(V()), 60) || !!pickAny(ev, [piv]);
      if (!hit) { c.smallReact(ev); return; }
      snd('pick');
      G.Hint.clear();
      c.swayAmp = 0;
      var cR = hs.cR, qp = qPinch(cR);
      if (c.noriState === 'mama') {
        // hand-off: the child pinches the free end, mama lets go
        var np = rePivot(piv);
        c.noriC = piv = np;
        c.nori = c.nori.filter(function (n) { return n.hand !== hs.mR; });
        c.undrive(hs.mR);
        c.rest(hs.mR, 0.6, 0.12);
      }
      c.noriState = 'child';
      var hold = { piv: piv, hand: cR, q: qDir(V(0, -0.12, -1)), flutter: true };
      c.startGrab({
        hand: cR, anchor: 'pinch', pose: 'pinch', q: qp, obj: piv, lift: 0.045, planeY: boardTop(), reachDur: 0.16, minZ: -0.2,
        grabPoint: function () { return piv.getWorldPosition(V()); },
        onCarry: function () { c.nori.push(hold); if (c.dest) c.dest.setStrength(0.7); },
        onDrop: function (p) { S4.drop(c, p, hold); }
      }, ev);
    },
    drop: function (c, p, hold) {
      var W = Wd(), hs = HS(), cR = hs.cR, rc = W.riceC, piv = hold.piv;
      var rp = wpos(rc.group);
      var ok = p && (dist2D(p, rp) < 0.10 || onChildBoard(p));
      if (ok) {
        if (c.dest) c.dest.setStrength(0);
        var frontR = rc.outline ? rc.outline[48] * rc.size : rc.size;
        var target = V(rp.x, rp.y + rc.topY() + 0.006, rp.z + frontR + 0.003);
        hold.flutter = false;
        c.carry(cR, piv, target, 0.26, { ease: 'out', onDone: function () {
          c.nori = c.nori.filter(function (n) { return n !== hold; });
          removeObj(piv); c.noriC = null;
          snd('nori');
          try { G.FX.burst(target.clone().add(V(0, -0.01, 0)), { kind: 'crumb', count: 5, color: 0x1d2418, speed: 0.12, size: 0.0035 }); } catch (e) { /* ignore */ }
          var pr = { v: 0.12 };
          c.T(pr, { v: 1 }, 0.45, { ease: 'out', onUpdate: function () { rc.setNori(pr.v); }, onDone: function () { rc.setNori(1); } });
          c.rest(cR, 0.55, 0.1);
          c.wait(0.8 + 0.45, function () { G.Director.go('S5'); });
        } });
      } else {
        // back to the counter where mama held it out, softly
        var ctr = c.offerCenter, len = piv.userData.len;
        var A = ctr.clone().addScaledVector(c.offerDir, len / 2); A.y = 0.0012;
        hold.q = qDir(c.offerDir.clone().negate().setY(0));
        hold.flutter = false;
        c.carry(cR, piv, A.clone().add(V(0, 0.012, 0)), 0.4, { ease: 'inOut', onDone: function () {
          c.nori = c.nori.filter(function (n) { return n !== hold; });
          G.scene.attach(piv);
          c.T(piv.position, { y: A.y }, 0.25, { ease: 'out' });
          var qf = hold.q.clone(), q0 = piv.quaternion.clone(), pp = { k: 0 };
          c.T(pp, { k: 1 }, 0.25, { ease: 'out', onUpdate: function () { piv.quaternion.slerpQuaternions(q0, qf, pp.k); } });
          c.rest(cR, 0.55, 0.05);
          c.noriState = 'counter';
          c.wait(0.3, function () { S4.setHint(c); });
        } });
      }
    },
    update: function (dt) {
      var c = cur; if (!c || c.dead) return;
      c.run(dt);
      // keep held strips pinched at their pivot, oriented as wanted (+ a little flutter)
      for (var i = 0; i < c.nori.length; i++) {
        var n = c.nori[i], piv = n.piv;
        if (!piv.parent || piv.parent === G.scene) continue;
        var k = 1 - Math.exp(-14 * dt);
        piv.position.lerp(V(), k);
        var aq = wquat(piv.parent).invert();
        var want = n.q.clone();
        if (n.flutter) want.multiply(qE(0.10 * Math.sin(c.t * 9.0), 0, 0.07 * Math.sin(c.t * 7.0 + 1)));
        piv.quaternion.slerp(aq.multiply(want), k);
      }
    },
    exit: function () {
      var c = cur; if (!c) return;
      var W = Wd();
      if (c.nori) c.nori.forEach(function (n) { removeObj(n.piv); });
      removeObj(c.noriC);
      if (W.riceM && W.riceM.nori < 1) W.riceM.setNori(1);
      if (W.riceC && W.riceC.nori < 1) W.riceC.setNori(1);
      // anything still on a hand anchor goes back to the scene
      [W.riceC, W.riceM].forEach(function (b) { if (b && c.isHeld(b.group)) G.scene.attach(b.group); });
      c.kill(); cur = null;
    }
  };

  /* ================================================================== S5 おさら */
  var S5 = {
    enter: function () {
      var c = cur = new Ctx('S5');
      var W = Wd(), hs = HS(), pr = props();
      ensureRice();
      frameOf('plate', 1.0);
      c.rest(hs.cL, 0.4); c.rest(hs.cR, 0.4);
      var plate = pr.plate, tray = pr.tray;
      plate.visible = true;
      var inPlace = plate.position.distanceTo(W.P.plateIn) < 0.01;
      snd('slide');
      if (!inPlace) slideWith(c, hs.mR, plate, V(0.128, 0.022, 0.0), W.P.plateIn, 0.85, 0.62, null, 0.2);
      if (tray.position.distanceTo(W.P.trayOut) > 0.01) slideWith(c, hs.mL, tray, V(-0.153, 0.014, 0.0), W.P.trayOut, 0.85, -0.62, null, 0.1);
      c.wait(1.1, function () {
        G.killTweens(plate.position); plate.position.copy(W.P.plateIn);
        tray.position.copy(W.P.trayOut);
        c.rest(hs.mL, 0.6);
        S5.mamaPlace(c);
      });
    },
    mamaPlace: function (c) {
      var W = Wd(), hs = HS(), mR = hs.mR, rm = W.riceM, sl = slots();
      if (rm.group.parent === sl.mama) { S5.childTurn(c); return; }
      var q = qHold(mR);
      c.reach(mR, 'palm', P_HOLD_M, q, holdPoint(rm), 0.45, function () {
        mR.attach(rm.group, 'palm');
        snd('pick', { vol: 0.6, pitch: 0.85 });
        c.carry(mR, rm.group, wpos(sl.mama), 0.55, { arc: 0.03, ease: 'inOut', onDone: function () {
          mR.detach(rm.group, sl.mama); c.settle(rm.group, sl.mama, V(), 0.12);
          snd('plate', { vol: 0.8, pitch: 0.9 });
          var lift = mR.root.position.clone().add(V(0, 0.03, 0.01));
          c.path(mR, { pos: lift, q: q, pose: 'relaxed', dur: 0.2, arc: 0, onDone: function () {
            mamaPoint(c, mR, function () { return wpos(sl.child); });
            c.wait(0.75, function () { S5.childTurn(c); });
          } });
        } });
      }, 'inOut');
    },
    childTurn: function (c) {
      var W = Wd(), sl = slots();
      if (W.riceC.group.parent === sl.child) { c.wait(0.6, function () { G.Director.go('S6'); }); return; }
      c.dest = hintDest(c, function () { return wpos(sl.child); }, W.riceC.size * 1.5);
      S5.setHint(c);
      c.ready = true;
    },
    setHint: function (c) {
      var W = Wd(), sl = slots();
      G.Hint.set({
        kind: 'drag', radius: W.riceC.size * 1.6,
        at: function () { return W.riceC ? wpos(W.riceC.group) : null; },
        to: function () { return wpos(sl.child); },
        object: W.riceC.mesh || W.riceC.group,
        onLevel: function (lv) {
          if (lv === 1 && !c.grab && !c.pointing) {
            c.pointing = true;
            mamaPoint(c, HS().mR, function () { return wpos(sl.child); }, function () { c.pointing = false; });
          }
        }
      });
      if (c.dest) c.dest.setStrength(0.45);
    },
    down: function (ev) {
      var c = cur, W = Wd(), hs = HS();
      if (!c || c.grab) return;
      var rc = W.riceC;
      if (!c.ready) { c.smallReact(ev); return; }
      var hit = near(ev, wpos(rc.group).add(V(0, 0.01, 0)), 80) || !!pickAny(ev, [rc.group]);
      if (!hit) { c.smallReact(ev); return; }
      snd('pick');
      G.Hint.clear();
      c.hop(rc.group, 0.004, 0.14);
      var cR = hs.cR, q = qHold(cR);
      c.startGrab({
        hand: cR, anchor: 'palm', pose: P_HOLD_C, q: q, obj: rc.group, lift: 0.04, planeY: boardTop(), reachDur: 0.16,
        grabPoint: function () { return holdPoint(rc); },
        onDrop: function (p) { S5.drop(c, p); }
      }, ev);
    },
    drop: function (c, p) {
      var W = Wd(), hs = HS(), cR = hs.cR, rc = W.riceC, sl = slots();
      var plateC = plateCenter();
      if (p && dist2D(p, plateC) < 0.14) {
        c.ready = false;
        if (c.dest) c.dest.setStrength(0);
        c.carry(cR, rc.group, wpos(sl.child), 0.28, { arc: 0.012, ease: 'out', onDone: function () {
          cR.detach(rc.group, sl.child); c.settle(rc.group, sl.child, V(), 0.1);
          snd('plate');
          var sp = wpos(sl.child).add(V(0, 0.03, 0));
          sparkle(sp, 12);
          c.rest(cR, 0.55, 0.05);
          if (sameShape()) {
            c.wait(0.25, function () {
              snd('match');
              sparkle(wpos(sl.mama).add(V(0, 0.035, 0)), 14);
              sparkle(sp, 10);
            });
          }
          c.wait(1.0, function () { G.Director.go('S6'); });
        } });
      } else {
        var home = boardCenter();
        c.carry(cR, rc.group, home, 0.38, { arc: 0.015, ease: 'inOut', onDone: function () {
          cR.detach(rc.group, G.scene); c.settle(rc.group, G.scene, home, 0.1);
          c.rest(cR, 0.55, 0.05);
          c.wait(0.25, function () { S5.setHint(c); });
        } });
      }
    },
    update: function (dt) { var c = cur; if (c && !c.dead) c.run(dt); },
    exit: function () {
      var c = cur; if (!c) return;
      var W = Wd(), pr = props(), sl = slots();
      G.killTweens(pr.plate.position); pr.plate.position.copy(W.P.plateIn);
      G.killTweens(pr.tray.position); pr.tray.position.copy(W.P.trayOut);
      if (W.riceM && W.riceM.group.parent !== sl.mama) { sl.mama.attach(W.riceM.group); W.riceM.group.position.set(0, 0, 0); W.riceM.group.rotation.set(0, 0, 0); }
      if (W.riceC && W.riceC.group.parent !== sl.child) { sl.child.attach(W.riceC.group); W.riceC.group.position.set(0, 0, 0); W.riceC.group.rotation.set(0, 0, 0); }
      c.kill(); cur = null;
    }
  };

  /* ================================================================== S6 ちび */
  var S6 = {
    enter: function () {
      var c = cur = new Ctx('S6');
      var W = Wd(), hs = HS();
      frameOf('nori', 0.8);
      c.rest(hs.cL, 0.4); c.rest(hs.cR, 0.4); c.rest(hs.mL, 0.5);
      c.grains = [];
      c.phase = 'demo';
      var bc = boardCenter();
      c.center = bc.clone();
      // a few grains spilled while squeezing
      var n = 11;
      for (var i = 0; i < n; i++) {
        var g = G.Rice.createGrain ? G.Rice.createGrain() : null;
        if (!g) break;
        g.scale.setScalar(1.15);
        var a = (i / n) * PI * 2 + Math.random() * 0.5, r = 0.022 + Math.random() * 0.03;
        g.position.set(bc.x + Math.cos(a) * r * 1.2, bc.y + 0.0012, bc.z + Math.sin(a) * r * 0.8);
        g.rotation.set(Math.PI / 2 * (Math.random() < 0.5 ? 1 : 0) + (Math.random() - 0.5) * 0.4, Math.random() * PI * 2, (Math.random() - 0.5) * 0.5);
        g.castShadow = true;
        G.scene.add(g); c.grains.push(g);
      }
      if (W.riceTiny && W.riceTiny.group && W.minis.indexOf(W.riceTiny) < 0) {
        // already gathered (re-entry)
        S6.pressTurn(c);
        return;
      }
      c.wait(0.45, function () { S6.gather(c); });
    },
    gather: function (c) {
      var W = Wd(), hs = HS(), mR = hs.mR, bc = c.center;
      var q = sideQ(mR, -0.75, 0.8, -0.35);
      var y = bc.y + 0.0045;
      var sweep = [V(bc.x + 0.07, y, bc.z + 0.03), V(bc.x + 0.012, y, bc.z + 0.004)];
      var sweep2 = [V(bc.x - 0.05, y, bc.z - 0.035), V(bc.x - 0.01, y, bc.z - 0.003)];
      var gathered = 0;
      var pull = function (side) {
        c.grains.forEach(function (g, i) {
          var mine = side > 0 ? g.position.x >= bc.x - 0.01 : g.position.x < bc.x - 0.01;
          if (!mine) return;
          var a = i * 2.4;
          c.T(g.position, { x: bc.x + Math.cos(a) * 0.006, z: bc.z + Math.sin(a) * 0.005 }, 0.28, { ease: 'out', delay: 0.04 + Math.random() * 0.1 });
        });
      };
      var finish = function () {
        if (++gathered < 2) return;
        c.grains.forEach(removeObj); c.grains = [];
        var tiny = G.Rice.createBody({ size: 0.015 });
        tiny.group.position.copy(bc);
        tiny.group.scale.setScalar(0.4);
        G.scene.add(tiny.group);
        W.riceTiny = tiny;
        c.T(tiny.group.scale, { x: 1, y: 1, z: 1 }, 0.3, { ease: 'outBack' });
        snd('plop', { pitch: 1.7, vol: 0.8 });
        c.wait(0.35, function () {
          c.path(mR, { pos: mR.root.position.clone().add(V(0.01, 0.025, 0.015)), q: q, dur: 0.2, arc: 0, onDone: function () {
            mamaPoint(c, mR, function () { return wpos(tiny.group); });
            c.wait(0.7, function () { S6.pressTurn(c); });
          } });
        });
      };
      c.reach(mR, 'indexTip', 'point', q, sweep[0].clone().add(V(0, 0.02, 0)), 0.45, function () {
        c.reach(mR, 'indexTip', 'point', q, sweep[0], 0.12, function () {
          pull(1);
          c.reach(mR, 'indexTip', 'point', q, sweep[1], 0.32, function () {
            finish();
            c.reach(mR, 'indexTip', 'point', q, sweep2[0].clone().add(V(0, 0.02, 0)), 0.28, function () {
              c.reach(mR, 'indexTip', 'point', q, sweep2[0], 0.1, function () {
                pull(-1);
                c.reach(mR, 'indexTip', 'point', q, sweep2[1], 0.3, finish, 'inOut');
              }, 'out');
            }, 'inOut');
          }, 'inOut');
        }, 'out');
      }, 'inOut');
    },
    pressTurn: function (c) {
      var W = Wd(), t = W.riceTiny;
      c.phase = 'press'; c.ready = true;
      G.Hint.set({
        kind: 'press', radius: 0.03,
        at: function () { return W.riceTiny ? wpos(W.riceTiny.group) : null; },
        object: t.mesh || t.group,
        onLevel: function (lv) {
          if (lv === 1 && !c.pointing && c.phase === 'press') {
            c.pointing = true;
            mamaPoint(c, HS().mR, function () { return wpos(t.group); }, function () { c.pointing = false; });
          }
        }
      });
    },
    tinyHands: function (c, press) {
      var W = Wd(), hs = HS(), t = W.riceTiny, p = wpos(t.group);
      var h2 = t.size * 1.2;
      [hs.cL, hs.cR].forEach(function (h) {
        var s = h.side === 'L' ? -1 : 1;
        var q = sideQ(h, -0.4, 1.0, -0.35);
        var gap = press ? t.size * 0.62 : t.size * 1.0 + 0.012;
        var tip = V(p.x + s * gap, p.y + h2 * 0.55, p.z + 0.003);
        c.reach(h, 'indexTip', 'point', q, tip, press ? 0.2 : 0.16, null, 'out');
      });
    },
    down: function (ev) {
      var c = cur, W = Wd(), hs = HS();
      if (!c || c.grab || c.pressing) return;
      var t = W.riceTiny;
      if (!c.ready || !t) { c.smallReact(ev); return; }
      var tp = wpos(t.group);
      if (c.phase === 'press') {
        if (!(near(ev, tp, 80) || pickAny(ev, [t.group]))) { c.smallReact(ev); return; }
        c.pressing = { t0: c.t };
        G.Hint.clear();
        snd('squish', { pitch: 1.6, vol: 0.8 });
        S6.tinyHands(c, true);
        var pr = { v: 0 };
        c.pressTw = c.T(pr, { v: 1 }, 0.3, { ease: 'out', onUpdate: function () { t.setPress(pr.v); } });
      } else if (c.phase === 'carry') {
        if (!(near(ev, tp, 80) || pickAny(ev, [t.group]))) { c.smallReact(ev); return; }
        snd('pick', { pitch: 1.3 });
        G.Hint.clear();
        var cR = hs.cR, q = qPinch(cR);
        c.startGrab({
          hand: cR, anchor: 'pinch', pose: 'pinch', q: q, obj: t.group, lift: 0.035, planeY: boardTop(), reachDur: 0.15,
          grabPoint: function () { return wpos(t.group).add(V(0, t.size * 0.75, 0)); },
          onDrop: function (p) { S6.drop(c, p); }
        }, ev);
      } else c.smallReact(ev);
    },
    up: function () {
      var c = cur; if (!c || !c.pressing) return;
      var held = c.t - c.pressing.t0;
      var go = function () { S6.release(c); };
      if (held < 0.22) c.wait(0.22 - held, go); else go();
    },
    release: function (c) {
      var W = Wd(), hs = HS(), t = W.riceTiny;
      if (!c.pressing || !t) return;
      c.pressing = null; c.ready = false;
      if (c.pressTw) c.pressTw.kill();
      t.setPress(0);
      var s = st();
      t.squeeze(s.t || 0, 1); t.squeeze(s.t || 0, 1);
      snd('pop', { pitch: 1.1 });
      var p = wpos(t.group);
      sparkle(p.clone().add(V(0, 0.015, 0)), 14, 0.16);
      // ぴょんっ: jump with a little spin, land with a bounce
      var y0 = t.group.position.y, j = { k: 0 };
      c.T(j, { k: 1 }, 0.62, { ease: 'linear', onUpdate: function () {
        var k = j.k, h;
        if (k < 0.55) { var u = k / 0.55; h = 0.034 * (1 - (2 * u - 1) * (2 * u - 1)); }
        else { var w = (k - 0.55) / 0.45; h = 0.006 * Math.sin(PI * w) * (1 - w * 0.3); }
        t.group.position.y = y0 + h;
        t.group.rotation.y = k < 0.55 ? PI * 2 * G.Ease.inOut(k / 0.55) : 0;
        var sq = k > 0.5 && k < 0.62 ? 1 - Math.sin(PI * (k - 0.5) / 0.12) * 0.15 : 1;
        t.group.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      }, onDone: function () { t.group.position.y = y0; t.group.rotation.y = 0; t.group.scale.set(1, 1, 1); snd('tap', { pitch: 1.8, vol: 0.4 }); } });
      // child fingers open and go home
      S6.tinyHands(c, false);
      c.rest(hs.cL, 0.5, 0.3); c.rest(hs.cR, 0.5, 0.3);
      // mama claps, small and quick
      c.wait(0.35, function () { S6.mamaClap(c, function () { S6.carryTurn(c); }); });
    },
    mamaClap: function (c, done) {
      var hs = HS(), mL = hs.mL, mR = hs.mR, mc = boardMCenter();
      var ctr = V(mc.x + 0.02, mc.y + 0.10, mc.z + 0.06);
      var qL = sideQ(mL, 0.55, 0.25, PI / 2), qR = sideQ(mR, 0.55, 0.25, -PI / 2);
      var wOpen = function (h, q, gap) {
        var s = h.side === 'L' ? -1 : 1;
        return wristFor(h, 'palm', 'flat', q, ctr.clone().add(V(s * gap, 0, 0)));
      };
      c.path(mL, { pos: wOpen(mL, qL, 0.03), q: qL, pose: 'flat', dur: 0.35 });
      c.path(mR, { pos: wOpen(mR, qR, 0.03), q: qR, pose: 'flat', dur: 0.35, onDone: function () {
        var n = 0;
        var clap = function () {
          c.path(mL, { pos: wOpen(mL, qL, 0.008), q: qL, dur: 0.07, arc: 0, ease: 'in' });
          c.path(mR, { pos: wOpen(mR, qR, 0.008), q: qR, dur: 0.07, arc: 0, ease: 'in', onDone: function () {
            snd('clap', { vol: 0.45, pitch: 1.35 + n * 0.05 });
            c.path(mL, { pos: wOpen(mL, qL, 0.026), q: qL, dur: 0.09, arc: 0, ease: 'out' });
            c.path(mR, { pos: wOpen(mR, qR, 0.026), q: qR, dur: 0.09, arc: 0, ease: 'out', onDone: function () {
              if (++n < 4) clap();
              else { c.rest(mL, 0.55); c.rest(mR, 0.55); if (done) done(); }
            } });
          } });
        };
        clap();
      } });
    },
    nextSlot: function () {
      var W = Wd(), tiny = slots().tiny;
      if (!tiny.length) return null;
      return tiny[Math.min(W.minis.length, tiny.length - 1)];
    },
    carryTurn: function (c) {
      var W = Wd();
      c.phase = 'carry'; c.ready = true;
      frameOf('plate', 0.8);
      var slot = S6.nextSlot();
      if (!c.dest) c.dest = hintDest(c, function () { var s = S6.nextSlot(); return s ? wpos(s) : null; }, 0.022);
      c.dest.setStrength(0.45);
      G.Hint.set({
        kind: 'drag', radius: 0.026,
        at: function () { return W.riceTiny ? wpos(W.riceTiny.group) : null; },
        to: function () { var s = S6.nextSlot(); return s ? wpos(s) : plateCenter(); },
        object: W.riceTiny.mesh || W.riceTiny.group,
        onLevel: function (lv) {
          if (lv === 1 && !c.pointing && !c.grab && slot) {
            c.pointing = true;
            mamaPoint(c, HS().mR, function () { return wpos(S6.nextSlot()); }, function () { c.pointing = false; });
          }
        }
      });
    },
    drop: function (c, p) {
      var W = Wd(), hs = HS(), cR = hs.cR, t = W.riceTiny;
      var slot = S6.nextSlot();
      if (p && slot && dist2D(p, plateCenter()) < 0.14) {
        c.ready = false; c.phase = 'placed';
        if (c.dest) c.dest.setStrength(0);
        var place = function () {
          c.carry(cR, t.group, wpos(slot), 0.26, { arc: 0.01, ease: 'out', onDone: function () {
            cR.detach(t.group, G.scene);
            // remember where everyone is, add (oldest may drop out), then slide them into their seats
            var before = W.minis.map(function (m) { return { m: m, p: wpos(m.group) }; });
            W.addMini(t);
            try { G.Save.set({ round: st().round }); } catch (e) { /* ignore */ }
            before.forEach(function (b) {
              if (W.minis.indexOf(b.m) < 0 || !b.m.group.parent) return;
              var lp = b.m.group.parent.worldToLocal(b.p.clone());
              if (lp.lengthSq() < 1e-8) return;
              b.m.group.position.copy(lp);
              c.T(b.m.group.position, { x: 0, y: 0, z: 0 }, 0.3, { ease: 'inOut' });
            });
            var s = V(); t.group.parent.getWorldScale(s);
            t.group.scale.setScalar(1 / (s.x || 1));
            c.T(t.group.scale, { x: 1, y: 1, z: 1 }, 0.25, { ease: 'out' });
            snd('plate', { pitch: 1.45, vol: 0.8 });
            sparkle(wpos(t.group).add(V(0, 0.015, 0)), 10, 0.14);
            c.rest(cR, 0.5, 0.05);
            c.wait(0.8, function () { G.Director.go('S7'); });
          } });
        };
        if (W.minis.length >= slots().tiny.length && W.minis.length > 0) {
          // しゅっ: the oldest one fades away first
          var old = W.minis[0];
          snd('whoosh', { vol: 0.5, pitch: 1.4 });
          sparkle(wpos(old.group).add(V(0, 0.01, 0)), 8, 0.1);
          c.T(old.group.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.22, { ease: 'in', onDone: function () {
            old.group.visible = false;
            if (old.group.parent) old.group.parent.remove(old.group);
          } });
          c.wait(0.12, place);
        } else place();
      } else {
        var home = c.center.clone();
        c.carry(cR, t.group, home, 0.36, { arc: 0.012, ease: 'inOut', onDone: function () {
          cR.detach(t.group, G.scene); c.settle(t.group, G.scene, home, 0.1);
          c.rest(cR, 0.5, 0.05);
          c.wait(0.25, function () { S6.carryTurn(c); });
        } });
      }
    },
    update: function (dt) { var c = cur; if (c && !c.dead) c.run(dt); },
    exit: function () {
      var c = cur; if (!c) return;
      var W = Wd();
      (c.grains || []).forEach(removeObj);
      var t = W.riceTiny;
      if (t && t.group && W.minis.indexOf(t) < 0) {
        t.setPress(0);
        if (t.formed < 0.999) { var s = st(); t.squeeze(s.t || 0, 1); t.squeeze(s.t || 0, 1); }
        G.scene.attach(t.group);
        t.group.scale.set(1, 1, 1); t.group.rotation.set(0, 0, 0);
        W.addMini(t);
      }
      W.minis.forEach(function (m) { G.killTweens(m.group.position); G.killTweens(m.group.scale); m.group.position.set(0, 0, 0); m.group.scale.set(1, 1, 1); });
      c.kill(); cur = null;
    }
  };

  /* ================================================================== S7 たべる → おしまい */
  var MOUTH_C = V(0.03, 0.30, 0.42), MOUTH_M = V(0.32, 0.34, 0.46);
  var S7 = {
    enter: function () {
      var c = cur = new Ctx('S7');
      var W = Wd(), hs = HS(), sl = slots();
      ensureRice();
      if (W.riceC.group.parent !== sl.child && W.riceC.bites < 3) { sl.child.attach(W.riceC.group); W.riceC.group.position.set(0, 0, 0); W.riceC.group.rotation.set(0, 0, 0); }
      if (W.riceM.group.parent !== sl.mama && W.riceM.bites < 3) { sl.mama.attach(W.riceM.group); W.riceM.group.position.set(0, 0, 0); W.riceM.group.rotation.set(0, 0, 0); }
      frameOf('eat', 1.0);
      restAll(c, 0.5);
      c.phase = 'eat'; c.anim = false; c.mamaQueue = 0; c.mamaBusy = false;
      c.wait(0.6, function () { c.ready = true; S7.setHint(c); });
    },
    setHint: function (c) {
      var W = Wd();
      if (c.phase === 'eat') {
        G.Hint.set({
          kind: 'tap', radius: W.riceC.size * 1.6,
          at: function () { return W.riceC && W.riceC.group.visible ? wpos(W.riceC.group) : null; },
          object: W.riceC.mesh || W.riceC.group
        });
      } else if (c.phase === 'hi5') {
        var mL = HS().mL;
        G.Hint.set({ kind: 'tap', radius: 0.05, at: function () { return wpos(mL.anchors.palm); } });
      }
    },
    down: function (ev) {
      var c = cur, W = Wd(), hs = HS();
      if (!c) return;
      if (c.phase === 'eat') {
        if (!c.ready) { c.smallReact(ev); return; }
        if (c.anim) return;   // ignore taps during a bite
        var rc = W.riceC;
        if (!(near(ev, wpos(rc.group).add(V(0, 0.012, 0)), 85) || pickAny(ev, [rc.group]))) { c.smallReact(ev); return; }
        S7.bite(c);
      } else if (c.phase === 'hi5') {
        var mp = wpos(hs.mL.anchors.palm);
        if (near(ev, mp, 95) || pickAny(ev, [hs.mL.group])) S7.highFive(c);
        else snd('tap', { vol: 0.3 });
      } else if (c.phase !== 'cleanup') snd('tap', { vol: 0.25 });
    },
    bite: function (c) {
      var W = Wd(), hs = HS(), cR = hs.cR, rc = W.riceC, sl = slots();
      c.anim = true;
      G.Hint.clear();
      snd('pick');
      c.hop(rc.group, 0.006, 0.16);
      var q = qHold(cR);
      c.mamaQueue++; S7.mamaNext(c, 0.15);
      c.reach(cR, 'palm', P_HOLD_C, q, holdPoint(rc), 0.18, function () {
        cR.attach(rc.group, 'palm');
        var qm = sideQ(cR, -0.2, 0.05, 0);
        c.carry(cR, rc.group, MOUTH_C, 0.45, { q: qm, arc: 0.0, ease: 'inOut', onDone: function () {
          snd('munch');
          var fin = rc.bite();
          var n = rc.bites;
          c.wait(0.42, function () {
            if (fin) { S7.emptyBack(c); return; }
            var kind = rc.filling;
            if (n === 1) snd('yum', { vol: 0.6 });
            if (n >= 2) {
              if (kind === 'ume') {
                snd('sour');
                G.Cam.shake(0.0045, 0.45);
                c.tremble(cR, 0.005, 0.95);
                var cL = hs.cL;
                var qL = sideQ(cL, -0.1, 0.25, 0.2);
                c.path(cL, { pos: V(-0.07, 0.075, 0.13), q: qL, pose: 'fist', dur: 0.18, onDone: function () {
                  c.tremble(cL, 0.0055, 0.75);
                  c.rest(cL, 0.4, 0.75);
                } });
              } else if (kind === 'kombu') snd('yum', { pitch: 0.8 });
              else snd('yum');
            }
            c.carry(cR, rc.group, wpos(sl.child), 0.45, { q: q, arc: 0.0, ease: 'inOut', onDone: function () {
              cR.detach(rc.group, sl.child); c.settle(rc.group, sl.child, V(), 0.1);
              snd('plate', { vol: 0.35 });
              var lift = cR.root.position.clone().add(V(0, 0.03, 0.03));
              var after = function () { c.rest(cR, 0.45); c.anim = false; S7.setHint(c); };
              if (n >= 2 && kind === 'sake') {
                // ぴょん ぴょん
                c.path(cR, { pos: lift, q: q, pose: 'relaxed', dur: 0.14, arc: 0, ease: 'out', onDone: function () {
                  c.path(cR, { pos: lift.clone().add(V(0, -0.02, 0)), q: q, dur: 0.12, arc: 0, ease: 'in', onDone: function () {
                    c.path(cR, { pos: lift.clone().add(V(0, 0.006, 0)), q: q, dur: 0.14, arc: 0, ease: 'out', onDone: after });
                  } });
                } });
              } else if (n >= 2 && kind === 'kombu') {
                // うん うん (slow nods)
                var qa = q.clone().multiply(qE(-0.22, 0, 0)), qb = q.clone().multiply(qE(0.12, 0, 0));
                c.path(cR, { pos: lift, q: qa, pose: 'relaxed', dur: 0.32, arc: 0, onDone: function () {
                  c.path(cR, { pos: lift, q: qb, dur: 0.32, arc: 0, onDone: function () {
                    c.path(cR, { pos: lift, q: qa, dur: 0.32, arc: 0, onDone: function () {
                      c.path(cR, { pos: lift, q: q, dur: 0.3, arc: 0, onDone: after });
                    } });
                  } });
                } });
              } else {
                c.path(cR, { pos: lift, q: q, pose: 'relaxed', dur: 0.16, arc: 0, ease: 'out', onDone: after });
              }
            } });
          });
        } });
      }, 'out');
    },
    mamaNext: function (c, delay) {
      if (c.mamaBusy || c.mamaQueue <= 0) return;
      var W = Wd(), hs = HS(), mR = hs.mR, rm = W.riceM, sl = slots();
      if (!rm || rm.bites >= 3) { c.mamaQueue = 0; return; }
      c.mamaBusy = true; c.mamaQueue--;
      var q = qHold(mR);
      c.wait(delay || 0.01, function () {
        c.reach(mR, 'palm', P_HOLD_M, q, holdPoint(rm), 0.32, function () {
          mR.attach(rm.group, 'palm');
          c.carry(mR, rm.group, MOUTH_M, 0.45, { q: sideQ(mR, -0.2, 0.4, 0), arc: 0, ease: 'inOut', onDone: function () {
            snd('munch', { vol: 0.5, pitch: 0.85, pan: 0.3 });
            var fin = rm.bite();
            c.wait(0.4, function () {
              var done = function () { c.mamaBusy = false; if (c.mamaQueue > 0) S7.mamaNext(c, 0.05); else if (c.waitMama) { var f = c.waitMama; c.waitMama = null; f(); } };
              if (fin) { mR.detach(rm.group, sl.mama); rm.group.visible = false; c.rest(mR, 0.5); c.wait(0.5, done); return; }
              c.carry(mR, rm.group, wpos(sl.mama), 0.45, { q: q, arc: 0, ease: 'inOut', onDone: function () {
                mR.detach(rm.group, sl.mama); c.settle(rm.group, sl.mama, V(), 0.1);
                c.rest(mR, 0.5, 0.05);
                c.wait(0.3, done);
              } });
            });
          } });
        }, 'inOut');
      });
    },
    emptyBack: function (c) {
      var W = Wd(), hs = HS(), cR = hs.cR, cL = hs.cL, rc = W.riceC, sl = slots();
      if (rc.group.parent && c.isHeld(rc.group)) sl.child.attach(rc.group);
      rc.group.visible = false;
      c.phase = 'brush';
      snd('yum', { vol: 0.8 });
      // ぱん ぱん: brush the grains off
      var bc = boardCenter(), ctr = V(bc.x + 0.005, bc.y + 0.06, bc.z + 0.03);
      var qR = sideQ(cR, 0.35, 0.3, -PI / 2 + 0.25), qL = sideQ(cL, 0.35, 0.3, PI / 2 - 0.25);
      var wAt = function (h, q, gap) { var s = h.side === 'L' ? -1 : 1; return wristFor(h, 'palm', 'flat', q, ctr.clone().add(V(s * gap, 0, 0))); };
      c.path(cL, { pos: wAt(cL, qL, 0.03), q: qL, pose: 'flat', dur: 0.4 });
      c.path(cR, { pos: wAt(cR, qR, 0.03), q: qR, pose: 'flat', dur: 0.45, onDone: function () {
        var n = 0;
        var pat = function () {
          c.path(cL, { pos: wAt(cL, qL, 0.009), q: qL, dur: 0.08, arc: 0, ease: 'in' });
          c.path(cR, { pos: wAt(cR, qR, 0.009), q: qR, dur: 0.08, arc: 0, ease: 'in', onDone: function () {
            snd('tap', { vol: 0.7, pitch: 1.1 });
            try { G.FX.burst(ctr, { kind: 'grain', count: 3, speed: 0.12, floor: bc.y + 0.001 }); } catch (e) { /* ignore */ }
            if (n === 1) { cR.setGrains(0); cL.setGrains(0); st().grains = 0; }
            c.path(cL, { pos: wAt(cL, qL, 0.03), q: qL, dur: 0.12, arc: 0, ease: 'out' });
            c.path(cR, { pos: wAt(cR, qR, 0.03), q: qR, dur: 0.12, arc: 0, ease: 'out', onDone: function () {
              if (++n < 2) pat();
              else {
                c.rest(cL, 0.5);
                var go = function () { S7.hi5Turn(c); };
                if (c.mamaBusy || c.mamaQueue > 0) c.waitMama = go; else go();
              }
            } });
          } });
        };
        pat();
      } });
    },
    hi5Turn: function (c) {
      var hs = HS(), mL = hs.mL, cR = hs.cR;
      var bc = boardCenter(), mc = boardMCenter();
      var spot = V(bc.x - 0.02, 0.10, (bc.z - 0.08 + mc.z + 0.09) / 2 + 0.005);
      c.hiSpot = spot;
      var q = sideQ(mL, 0.55, 0.35, PI);
      c.hiQ = q;
      c.reach(mL, 'palm', 'open', q, spot, 0.6, function () {
        mL.setGlow(0.85);
        c.phase = 'hi5';
        c.hiBase = mL.root.position.clone();
        S7.setHint(c);
      }, 'inOut');
      // the child's hand waits, open, close by
      var qc = sideQ(cR, -0.35, 0.2, 0);
      c.path(cR, { pos: wristFor(cR, 'palm', 'open', qc, V(spot.x + 0.06, 0.05, spot.z + 0.13)), q: qc, pose: 'open', dur: 0.6 });
    },
    highFive: function (c) {
      var hs = HS(), mL = hs.mL, cR = hs.cR;
      if (c.hiBusy) return;
      c.hiBusy = true;
      G.Hint.clear();
      var mp = wpos(mL.anchors.palm);
      var qc = sideQ(cR, -0.55, 0.18, 0);
      var from = cR.root.position.clone();
      c.path(cR, { pos: wristFor(cR, 'palm', 'open', qc, mp.clone().add(V(0.004, 0.013, 0.004))), q: qc, pose: 'open', poseDur: 0.08, dur: 0.12, arc: 0.01, ease: 'in', onDone: function () {
        snd('clap', { vol: 0.9 });
        sparkle(mp.clone().add(V(0, 0.01, 0)), 26, 0.3);
        G.Cam.shake(0.0018, 0.18);
        // mama's palm gives a little
        c.path(mL, { pos: c.hiBase.clone().add(V(0, -0.008, -0.004)), q: c.hiQ, dur: 0.08, arc: 0, ease: 'out', onDone: function () {
          c.path(mL, { pos: c.hiBase, q: c.hiQ, dur: 0.22, arc: 0, ease: 'inOut' });
        } });
        c.path(cR, { pos: from, q: qc, dur: 0.28, arc: 0.01, ease: 'out', onDone: function () {
          c.hiBusy = false;
          if (!c.hiCount) { c.hiCount = 1; c.wait(0.35, function () { S7.ending(c); }); }
          else { c.hiCount++; if (c.phase === 'hi5') S7.setHint(c); }
        } });
      } });
    },
    ending: function (c) {
      var W = Wd(), hs = HS(), mL = hs.mL, mR = hs.mR, cR = hs.cR;
      c.phase = 'ending';
      G.Hint.clear();
      snd('ending');
      mL.setGlow(0);
      c.rest(mL, 0.9);
      // child's hand comes to rest on the board, mama pats the back of it
      var bc = boardCenter();
      var qc = sideQ(cR, -0.12, 0.12, 0);
      var palmAt = V(bc.x + 0.03, bc.y + 0.004, bc.z - 0.035);
      c.path(cR, { pos: wristFor(cR, 'palm', P_PAT, qc, palmAt), q: qc, pose: P_PAT, dur: 0.7 });
      var qm = sideQ(mR, -0.3, 0.55, 0.05);
      c.wait(0.75, function () {
        var back = wpos(cR.anchors.palm).add(V(0.004, 0.024, 0.006));
        var w0 = wristFor(mR, 'palm', P_PAT, qm, back.clone().add(V(0, 0.010, 0)));
        c.path(mR, { pos: w0, q: qm, pose: P_PAT, dur: 0.6, onDone: function () {
          var n = 0;
          var pat = function () {
            c.path(mR, { pos: w0.clone().add(V(0, -0.010, 0)), q: qm, dur: 0.2, arc: 0, ease: 'inOut', onDone: function () {
              snd('tap', { vol: 0.28, pitch: 0.8 });
              c.path(mR, { pos: w0, q: qm, dur: 0.24, arc: 0, ease: 'inOut', onDone: function () {
                if (++n < 2) pat(); else { c.rest(mR, 0.7); c.rest(cR, 0.7, 0.25); }
              } });
            } });
          };
          pat();
        } });
      });
      // sparkles slowly drifting over the little ones (and over the plate)
      var nTick = 0;
      var tick = function () {
        if (!c.ok() || c.phase !== 'ending') return;
        var list = W.minis.filter(function (m) { return m.group.visible && m.group.parent; });
        list.forEach(function (m) { try { G.FX.burst(wpos(m.group).add(V(0, 0.018, 0)), { kind: 'sparkle', count: 2, speed: 0.04, size: 0.009 }); } catch (e) { /* ignore */ } });
        if (!list.length) sparkle(plateCenter().add(V(0, 0.03, 0.05)), 3, 0.05);
        if (++nTick < 9) c.wait(0.45, tick);
      };
      c.wait(0.4, tick);
      c.wait(2.2, function () {
        var pc = plateCenter();
        G.Cam.frame({ cx: pc.x, cz: pc.z + 0.03, w: 0.30, d: 0.36, pad: 0.015, dur: 2.4, ease: 'inOut' });
      });
      c.wait(4.9, function () { S7.cleanup(c); });
    },
    /* mama tidies up (≈2s): plate out / tray in, shamoji home, lid closes */
    cleanup: function (c) {
      var W = Wd(), hs = HS(), mL = hs.mL, mR = hs.mR, pr = props();
      c.phase = 'cleanup';
      // tight on cooker + tray: mama's long reach stays natural (her elbows stay out of view)
      G.Cam.frame({ cx: 0, cz: -0.47, w: 0.30, d: 0.40, pad: 0.015, dur: 1.3, ease: 'inOut' });
      snd('slide');
      slideWith(c, mR, pr.plate, V(0.128, 0.022, 0.0), W.P.plateOut, 0.85, 0.62, null, 0.12);
      pr.tray.visible = true;
      slideWith(c, mL, pr.tray, V(-0.153, 0.014, 0.0), W.P.tray, 0.85, -0.62, null, 0.2);
      // shamoji back home (right hand)
      var sh = pr.shamoji, home = W.shamojiHome;
      var shNeeds = home && wpos(sh).distanceTo(home.pos) > 0.01;
      c.wait(0.75, function () {
        if (!shNeeds) { c.rest(mR, 0.6); return; }
        var ha = sh.handleAnchor || sh;
        var hp = wpos(ha);
        var x = V(0, 0, 1).applyQuaternion(wquat(sh)).normalize();   // handle axis
        var zw = V(0, 0, 1), z = zw.clone().sub(x.clone().multiplyScalar(x.dot(zw))); if (z.lengthSq() < 1e-6) z.set(0, 1, 0); z.normalize();
        var y = new THREE.Vector3().crossVectors(z, x);
        if (y.y < 0) { x.negate(); y.negate(); }
        var qg = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
        c.reach(mR, 'grip', 'grip', qg, hp, 0.35, function () {
          mR.attach(sh, 'grip');
          mR.root.updateWorldMatrix(true, true);
          var Mh = mR.root.matrixWorld.clone(), Ms = sh.matrixWorld.clone();
          var Mhome = new THREE.Matrix4().compose(home.pos, new THREE.Quaternion().setFromEuler(home.rot), V(1, 1, 1));
          var Mt = Mhome.multiply(Ms.invert()).multiply(Mh);
          var tp = V(), tq = new THREE.Quaternion(), ts = V();
          Mt.decompose(tp, tq, ts);
          c.path(mR, { pos: tp, q: tq, dur: 0.45, arc: 0.04, ease: 'inOut', onDone: function () {
            mR.detach(sh, G.scene);
            sh.position.copy(home.pos); sh.rotation.copy(home.rot);
            snd('tap', { vol: 0.3, pitch: 0.9 });
            c.rest(mR, 0.5);
          } });
        }, 'inOut');
      });
      // lid closes (left hand)
      var ck = pr.cooker;
      var lidV = typeof ck.lidValue === 'number' ? ck.lidValue : 1;
      c.wait(shNeeds ? 1.0 : 0.85, function () {
        if (lidV < 0.02) { c.rest(mL, 0.5); return; }
        var btn = ck.button || ck;
        var ql = sideQ(mL, -0.55, -0.25, 0.1);
        var tgt = function () { return wpos(btn).add(V(0, 0.012, 0.006)); };
        c.reach(mL, 'palm', P_PAT, ql, tgt(), 0.32, function () {
          var al = anchorLocal(mL, 'palm', P_PAT);
          c.drive(mL, function () { mL.root.position.copy(tgt().sub(al.clone().applyQuaternion(ql))); mL.root.quaternion.copy(ql); });
          var lv = { v: lidV };
          c.T(lv, { v: 0 }, 0.42, { ease: 'in', onUpdate: function () { ck.setLid(lv.v); }, onDone: function () {
            ck.setLid(0); snd('lidClose');
            c.wait(0.08, function () { c.rest(mL, 0.5); });
          } });
        }, 'inOut');
      });
      c.wait(shNeeds ? 2.0 : 1.85, function () { S7.nextRound(c); });
    },
    nextRound: function () {
      var W = Wd();
      try { W.resetRound(); } catch (e) { log('reset', e); }
      var s = st();
      if (s) {
        s.mamaT = W.SHAPES[((s.round % 3) + 3) % 3];
        s.mamaFilling = FILLS[((s.round % 3) + 3) % 3];
      }
      if (G.Director.has && G.Director.has('S0')) G.Director.go('S0');
      else if (cur) { cur.phase = 'over'; }
    },
    update: function (dt) { var c = cur; if (c && !c.dead) c.run(dt); },
    exit: function () {
      var c = cur; if (!c) return;
      var W = Wd(), pr = props(), hs = HS();
      // nothing stays on a hand
      [W.riceC, W.riceM].forEach(function (b) { if (b && b.group && c.isHeld(b.group)) G.scene.attach(b.group); });
      if (c.isHeld(pr.shamoji)) { G.scene.attach(pr.shamoji); if (W.shamojiHome) { pr.shamoji.position.copy(W.shamojiHome.pos); pr.shamoji.rotation.copy(W.shamojiHome.rot); } }
      if (hs.mL.setGlow) hs.mL.setGlow(0);
      c.kill(); cur = null;
    }
  };

  /* ------------------------------------------------------------------ register */
  function wrap(sc) {
    var onDown = function (ev) { if (cur && sc.down) sc.down(ev); };
    var onMove = function (ev) { if (cur && cur.grab) cur.moveGrab(ev); };
    var onUp = function (ev) { if (!cur) return; if (cur.grab) cur.upGrab(ev); if (sc.up) sc.up(ev); };
    return {
      enter: function () {
        if (cur) { try { cur.kill(); } catch (e) { /* ignore */ } cur = null; }
        sc.enter();
        if (cur) { cur.on('down', onDown); cur.on('move', onMove); cur.on('up', onUp); }
      },
      update: function (dt) { if (sc.update) sc.update(dt); },
      exit: function () { G.Hint.clear(); sc.exit(); }
    };
  }
  G.Scenes.registerB = function () {
    G.Director.add('S4', wrap(S4));
    G.Director.add('S5', wrap(S5));
    G.Director.add('S6', wrap(S6));
    G.Director.add('S7', wrap(S7));
    G.Director.add('B_hold', {});
  };

  /* ------------------------------------------------------------------ dev: jump to "end of S3" */
  G.Scenes.debugAfter = function (opts) {
    opts = opts || {};
    var W = G.W; if (!W || !W.built) return;
    if (!G.Director.has('S4')) G.Scenes.registerB();
    G.Director.go('B_hold');   // leaves whatever runs now
    G.Hint.clear();
    var s = W.state;
    if (opts.round != null) s.round = opts.round;
    s.t = opts.t != null ? opts.t : 0.5;
    s.mamaT = opts.mamaT != null ? opts.mamaT : W.SHAPES[((s.round % 3) + 3) % 3];
    s.filling = opts.filling !== undefined ? opts.filling : 'ume';
    s.mamaFilling = opts.mamaFilling !== undefined ? opts.mamaFilling : FILLS[((s.round % 3) + 3) % 3];
    s.grains = opts.grains != null ? opts.grains : 4; s.scoops = 1;
    var pr = W.props;
    [pr.tray, pr.plate, pr.shamoji].forEach(function (o) { G.killTweens(o.position); G.killTweens(o.rotation); });
    pr.tray.position.copy(W.P.tray); pr.tray.visible = true;
    pr.plate.position.copy(W.P.plateOut);
    try { pr.cooker.setLid(1); if (pr.cooker.ledOn) pr.cooker.ledOn(false); } catch (e) { /* ignore */ }
    // shamoji stuck in the pot, handle toward the child
    var sh = pr.shamoji; G.scene.attach(sh);
    var pa = wpos(pr.cooker.potAnchor);
    sh.rotation.set(-0.85, 0.15, 0);
    sh.position.set(pa.x + 0.01, pa.y + 0.012, pa.z + 0.035);
    // the two onigiri
    [W.riceC, W.riceM, W.riceTiny].forEach(function (b) { if (b && b.group && W.minis.indexOf(b) < 0 && b.group.parent) b.group.parent.remove(b.group); });
    W.riceTiny = null;
    W.riceM = makeBody(0.043, s.mamaT, s.mamaFilling, 0.55, 3);
    W.riceM.group.position.copy(boardMCenter()); G.scene.add(W.riceM.group);
    W.riceC = makeBody(opts.size || 0.03, s.t, s.filling, 0.42, 4);
    W.riceC.group.position.copy(boardCenter()); G.scene.add(W.riceC.group);
    var hs = W.hands;
    for (var k in hs) { var h = hs[k]; try { h.setGlow(0); h.setGrains(0); h.rest(0); } catch (e) { /* ignore */ } }
    try { hs.cR.setGrains(Math.min(6, s.grains)); hs.cL.setGrains(Math.max(0, Math.min(6, s.grains) - 1)); } catch (e) { /* ignore */ }
    if (opts.scene === 'S6' || opts.scene === 'S7') {   // later entry points: nori on, both on the plate
      W.riceC.setNori(1); W.riceM.setNori(1);
      pr.plate.position.copy(W.P.plateIn); pr.tray.position.copy(W.P.trayOut);
      var sl = pr.plate.slots;
      sl.mama.attach(W.riceM.group); W.riceM.group.position.set(0, 0, 0);
      sl.child.attach(W.riceC.group); W.riceC.group.position.set(0, 0, 0);
    }
    G.Director.go(opts.scene || 'S4');
  };
})();
