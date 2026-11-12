/* world.js — board layout and shared state (G.W). Uses G.Props / G.Hands / G.Rice when present,
   simple stand-in meshes otherwise. Classic script. */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var THREE = window.THREE;
  function V(x, y, z) { return new THREE.Vector3(x, y, z); }
  function warn(tag, e) { if (window.console) console.error('[G:world:' + tag + ']', e); }
  function tryCall(fn, self, args, tag) { try { return fn.apply(self, args || []); } catch (e) { warn(tag, e); } }

  var P = {
    cooker: V(0, 0, -0.63),
    tray: V(0, 0, -0.345),
    boardM: V(0, 0, -0.135),
    boardC: V(0, 0, 0.095),
    plateIn: V(0, 0, -0.345),
    plateOut: V(1.0, 0, -0.345),   // far enough to stay hidden on wide screens
    trayOut: V(-1.0, 0, -0.345),
    shamoji: V(0.165, 0, -0.56),
    cupL: V(-0.16, 0, -0.50),
    cupR: V(0.16, 0, -0.50),
    cupsIn: V(0, 0, -0.50),   // (cups are not used in the story; kept hidden)
    cupsOut: V(1.0, 0, -0.50)
  };
  var PLATE_SCALE = 0.92;     // 0.27 plate -> ~0.25 so it sits between cooker and mama's board

  var FRAMES = {
    cooker: { cx: 0, cz: -0.60, w: 0.27, d: 0.36, pad: 0.015 },
    scoop: { cx: 0, cz: -0.28, w: 0.30, d: 0.94, pad: 0.015 },
    fill: { cx: 0, cz: -0.11, w: 0.30, d: 0.60, pad: 0.015 },
    shape: { cx: 0, cz: -0.025, w: 0.27, d: 0.42, pad: 0.015 },
    nori: { cx: 0, cz: -0.025, w: 0.27, d: 0.42, pad: 0.015 },
    plate: { cx: 0, cz: -0.15, w: 0.29, d: 0.66, pad: 0.015 },
    eat: { cx: 0, cz: -0.19, w: 0.29, d: 0.58, pad: 0.015 }
  };

  var SHAPES = [0.5, 1, 0];

  // ---------------------------------------------------------------- stand-ins
  var M = null;
  function mats() {
    if (M) return M;
    M = {
      wood: new THREE.MeshStandardMaterial({ color: 0xd2a777, roughness: 0.55 }),
      board: new THREE.MeshStandardMaterial({ color: 0xe6c9a0, roughness: 0.7 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: 0.4 }),
      rice: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xeab89a, roughness: 0.6 }),
      tea: new THREE.MeshStandardMaterial({ color: 0x9fb46a, roughness: 0.2 }),
      red: new THREE.MeshStandardMaterial({ color: 0xb8352f, roughness: 0.6 }),
      pink: new THREE.MeshStandardMaterial({ color: 0xe9876a, roughness: 0.6 }),
      kombu: new THREE.MeshStandardMaterial({ color: 0x2a2418, roughness: 0.3 }),
      wall: new THREE.MeshStandardMaterial({ color: 0xf1e4cf, roughness: 0.85 })
    };
    return M;
  }
  function mesh(geo, mat, cast) { var m = new THREE.Mesh(geo, mat); m.castShadow = cast !== false; m.receiveShadow = true; return m; }
  function rbox(w, h, d, r) {
    // rounded-ish box: a box with a slight bevel via extrusion of a rounded rect
    var s = new THREE.Shape(), x = -w / 2, z = -d / 2;
    r = Math.min(r, w / 2, d / 2);
    s.moveTo(x + r, z); s.lineTo(x + w - r, z); s.quadraticCurveTo(x + w, z, x + w, z + r);
    s.lineTo(x + w, z + d - r); s.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
    s.lineTo(x + r, z + d); s.quadraticCurveTo(x, z + d, x, z + d - r);
    s.lineTo(x, z + r); s.quadraticCurveTo(x, z, x + r, z);
    var g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: Math.min(0.003, h * 0.2), bevelSize: Math.min(0.003, r * 0.5), bevelSegments: 3, curveSegments: 8 });
    g.rotateX(Math.PI / 2); g.translate(0, h, 0);
    return g;
  }

  var stand = {
    counter: function () {
      var g = new THREE.Group();
      var top = mesh(new THREE.BoxGeometry(2.6, 0.04, 2.6), mats().wood, false);
      top.position.y = -0.02; g.add(top);
      return g;
    },
    cooker: function () {
      var g = new THREE.Group();
      var body = mesh(rbox(0.25, 0.17, 0.30, 0.05), mats().white); g.add(body);
      var lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.17, -0.14); g.add(lidPivot);
      var lid = mesh(rbox(0.245, 0.04, 0.29, 0.05), mats().white); lid.position.set(0, 0, 0.14); lidPivot.add(lid);
      var btnMat = mats().white.clone();
      var button = mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.008, 32), btnMat);
      button.position.set(0, 0.044, 0.25); lidPivot.add(button);
      var pot = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.004, 40), mats().rice, false);
      pot.position.set(0, 0.15, 0.0); g.add(pot);
      var potAnchor = new THREE.Object3D(); potAnchor.position.set(0, 0.152, 0); g.add(potAnchor);
      var steamAnchor = new THREE.Object3D(); steamAnchor.position.set(0, 0.04, 0.05); lidPivot.add(steamAnchor);
      var panel = mesh(new THREE.BoxGeometry(0.11, 0.04, 0.004), mats().dark, false);
      panel.position.set(0, 0.11, 0.151); g.add(panel);
      g.button = button; g.potAnchor = potAnchor; g.steamAnchor = steamAnchor; g.potRadius = 0.1;
      g.setLid = function (v) { lidPivot.rotation.x = -G.clamp(v, 0, 1) * 95 * Math.PI / 180; };
      g.pressButton = function (p) { button.position.y = 0.044 - 0.004 * G.clamp(p, 0, 1); };
      g.ledOn = function () {};
      return g;
    },
    shamoji: function () {
      var g = new THREE.Group();
      var blade = new THREE.SphereGeometry(1, 24, 12); blade.scale(0.035, 0.005, 0.045);
      g.add(mesh(blade, mats().white));
      var handle = mesh(new THREE.BoxGeometry(0.024, 0.008, 0.11), mats().white); handle.position.set(0, 0.002, 0.095); g.add(handle);
      g.handleAnchor = new THREE.Object3D(); g.handleAnchor.position.set(0, 0.004, 0.10); g.add(g.handleAnchor);
      g.bladeAnchor = new THREE.Object3D(); g.bladeAnchor.position.set(0, 0.005, 0); g.add(g.bladeAnchor);
      return g;
    },
    board: function (w, d) {
      var g = new THREE.Group();
      g.add(mesh(rbox(w, 0.012, d, 0.015), mats().board));
      g.topY = 0.012 + 0.003;
      return g;
    },
    tray: function () {
      var g = new THREE.Group();
      g.add(mesh(rbox(0.30, 0.012, 0.095, 0.01), mats().wood));
      var kinds = ['ume', 'sake', 'kombu'], fm = [mats().red, mats().pink, mats().kombu];
      g.dishes = kinds.map(function (k, i) {
        var dish = mesh(new THREE.CylinderGeometry(0.035, 0.026, 0.014, 32), mats().white);
        dish.position.set((i - 1) * 0.095, 0.019, 0); g.add(dish);
        var anchor = new THREE.Object3D(); anchor.position.set((i - 1) * 0.095, 0.022, 0); g.add(anchor);
        var heap = null;
        if (G.Rice && G.Rice.createFillingHeap) heap = tryCall(G.Rice.createFillingHeap, G.Rice, [k], 'heap');
        if (!heap) { heap = mesh(new THREE.SphereGeometry(0.02, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), fm[i]); }
        anchor.add(heap);
        return { kind: k, anchor: anchor, heap: heap };
      });
      return g;
    },
    plate: function () {
      var g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.135, 0.10, 0.018, 48), mats().white));
      var slots = { mama: new THREE.Object3D(), child: new THREE.Object3D(), tiny: [] };
      slots.mama.position.set(-0.05, 0.018, -0.01); slots.child.position.set(0.05, 0.018, -0.01);
      g.add(slots.mama); g.add(slots.child);
      for (var i = 0; i < 5; i++) { var t = new THREE.Object3D(); t.position.set((i - 2) * 0.03, 0.018, 0.075); g.add(t); slots.tiny.push(t); }
      g.slots = slots;
      return g;
    },
    cups: function () {
      var g = new THREE.Group();
      g.steamAnchors = [];
      [[P.cupL, 0.04, 0.085], [P.cupR, 0.033, 0.07]].forEach(function (c) {
        var cup = mesh(new THREE.CylinderGeometry(c[1], c[1] * 0.85, c[2], 32), mats().white);
        cup.position.set(c[0].x, c[2] / 2, 0); g.add(cup);
        var tea = mesh(new THREE.CylinderGeometry(c[1] * 0.92, c[1] * 0.92, 0.002, 32), mats().tea, false);
        tea.position.set(c[0].x, c[2] - 0.008, 0); g.add(tea);
        var a = new THREE.Object3D(); a.position.set(c[0].x, c[2], 0); g.add(a); g.steamAnchors.push(a);
      });
      return g;
    }
  };

  function fillProps(props) {
    props = props || {};
    if (!props.counter) props.counter = stand.counter();
    if (!props.cooker) props.cooker = stand.cooker();
    if (!props.shamoji) props.shamoji = stand.shamoji();
    if (!props.boardMama) props.boardMama = stand.board(0.27, 0.18);
    if (!props.boardChild) props.boardChild = stand.board(0.23, 0.16);
    if (!props.tray) props.tray = stand.tray();
    if (!props.plate) props.plate = stand.plate();
    if (!props.cups) props.cups = stand.cups();
    var c = props.cooker;
    if (typeof c.setLid !== 'function') c.setLid = function () {};
    if (typeof c.pressButton !== 'function') c.pressButton = function () {};
    if (typeof c.ledOn !== 'function') c.ledOn = function () {};
    if (!c.steamAnchor) { c.steamAnchor = new THREE.Object3D(); c.steamAnchor.position.set(0, 0.22, -0.05); c.add(c.steamAnchor); }
    if (!c.potAnchor) { c.potAnchor = new THREE.Object3D(); c.potAnchor.position.set(0, 0.15, 0); c.add(c.potAnchor); }
    if (!c.button) c.button = c;
    if (!c.potRadius) c.potRadius = 0.1;
    var s = props.shamoji;
    if (!s.handleAnchor) { s.handleAnchor = new THREE.Object3D(); s.handleAnchor.position.set(0, 0, 0.1); s.add(s.handleAnchor); }
    if (!s.bladeAnchor) { s.bladeAnchor = new THREE.Object3D(); s.add(s.bladeAnchor); }
    [props.boardMama, props.boardChild].forEach(function (b) { if (typeof b.topY !== 'number') b.topY = 0.012; });
    if (!Array.isArray(props.tray.dishes)) props.tray.dishes = [];
    if (!props.plate.slots) props.plate.slots = stand.plate().slots;
    if (!Array.isArray(props.plate.slots.tiny)) props.plate.slots.tiny = [];
    if (!Array.isArray(props.cups.steamAnchors)) props.cups.steamAnchors = [];
    return props;
  }

  function hasCasting(obj) {
    var any = false;
    obj.traverse(function (o) { if (o.isMesh && o.castShadow) any = true; });
    return any;
  }
  function ensureShadows(obj, cast) {
    if (hasCasting(obj)) return;
    obj.traverse(function (o) { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; } });
  }

  // ---------------------------------------------------------------- stand-in hand
  function stubHand(who, side) {
    var mama = who === 'mama', sx = side === 'L' ? -1 : 1, sc = mama ? 1 : 0.68;
    var group = new THREE.Group(), root = new THREE.Group();
    group.add(root);
    var palm = new THREE.SphereGeometry(1, 24, 16); palm.scale(0.04 * sc, 0.014 * sc, 0.05 * sc); palm.translate(0, 0.012 * sc, -0.045 * sc);
    root.add(mesh(palm, mats().skin));
    for (var i = 0; i < 4; i++) {
      var f = new THREE.CapsuleGeometry(0.0085 * sc, 0.05 * sc, 4, 10); f.rotateX(Math.PI / 2);
      var fm = mesh(f, mats().skin); fm.position.set(sx * (i - 1.5) * -0.018 * sc, 0.01 * sc, -0.115 * sc); root.add(fm);
    }
    var arm = new THREE.CapsuleGeometry(0.024 * sc, 0.2 * sc, 4, 12); arm.rotateX(Math.PI / 2); arm.translate(0, 0.012 * sc, 0.11 * sc);
    root.add(mesh(arm, mats().skin));
    function anchor(x, y, z) { var a = new THREE.Object3D(); a.position.set(x * sc, y * sc, z * sc); root.add(a); return a; }
    var restPos = mama ? V(sx * 0.215, 0.07, 0.20) : V(sx * 0.075, 0.04, 0.33);
    var h = {
      who: who, side: side, group: group, root: root, stub: true,
      elbow: mama ? V(sx * 0.36, 0.42, 0.60) : V(sx * 0.09, 0.30, 0.62),
      dims: mama ? { length: 0.17, width: 0.08, thick: 0.03, palmLen: 0.095 } : { length: 0.115, width: 0.058, thick: 0.022, palmLen: 0.064 },
      anchors: { palm: anchor(0, 0, -0.05), grip: anchor(0, -0.01, -0.06), pinch: anchor(sx * -0.02, 0, -0.1), indexTip: anchor(sx * -0.027, 0.01, -0.145), midTip: anchor(sx * -0.009, 0.01, -0.15) },
      restPos: restPos, restRot: new THREE.Euler(0, 0, 0), pose: {}, idle: true,
      setPose: function () {}, setGlow: function () {}, setGrains: function () {}, update: function () {},
      moveTo: function (o) {
        o = o || {};
        var dur = o.dur != null ? o.dur : 0.4;
        G.killTweens(root.position); G.killTweens(root.rotation);
        if (o.pos) G.tween(root.position, { x: o.pos.x, y: o.pos.y, z: o.pos.z }, dur, { ease: o.ease, onDone: o.onDone });
        else if (o.onDone) G.wait(dur, o.onDone);
        if (o.rot) {
          var e = o.rot.isQuaternion ? new THREE.Euler().setFromQuaternion(o.rot) : o.rot;
          G.tween(root.rotation, { x: e.x, y: e.y, z: e.z }, dur, { ease: o.ease });
        }
      },
      rest: function (dur) { h.moveTo({ pos: h.restPos, rot: h.restRot, dur: dur != null ? dur : 0.5 }); },
      hide: function (dur) { h.moveTo({ pos: V(h.restPos.x, h.restPos.y, h.restPos.z + 0.4), dur: dur != null ? dur : 0.5 }); },
      show: function (dur) { h.rest(dur); },
      attach: function (obj, name) { var a = h.anchors[name] || root; if (obj) a.attach(obj); },
      detach: function (obj, parent) { if (obj) (parent || G.scene).attach(obj); }
    };
    root.position.copy(restPos);
    return h;
  }

  // ---------------------------------------------------------------- build
  function place(obj, p) { obj.position.set(p.x, p.y, p.z); }

  var W = {
    P: P, FRAMES: FRAMES, SHAPES: SHAPES,
    props: null, hands: null, riceC: null, riceM: null, riceTiny: null, minis: [],
    state: null,
    built: false
  };
  G.W = W;

  function freshState(round) {
    return { round: round, mamaT: SHAPES[((round % 3) + 3) % 3], t: 0, filling: null, mamaFilling: null, scoops: 0, grains: 0, matched: false };
  }

  W.build = function () {
    if (W.built || !G.scene) return W;
    W.built = true;
    var scene = G.scene;
    var save = (G.Save && G.Save.get()) || {};
    var round = (typeof save.round === 'number' && isFinite(save.round) && save.round >= 0) ? Math.floor(save.round) : 0;
    W.state = freshState(round);

    var props = null;
    if (G.Props && typeof G.Props.build === 'function') props = tryCall(G.Props.build, G.Props, [], 'props');
    props = fillProps(props);
    W.props = props;

    // a soft back wall so wide screens never look into the void
    var wall = mesh(new THREE.PlaneGeometry(4, 1.6), mats().wall, false);
    wall.position.set(0, 0.8, -1.0); wall.receiveShadow = false;
    scene.add(wall); W.wall = wall;

    scene.add(props.counter);
    props.counter.traverse(function (o) { if (o.isMesh) { o.receiveShadow = true; } });

    place(props.cooker, P.cooker); scene.add(props.cooker); ensureShadows(props.cooker, true);
    place(props.tray, P.tray); scene.add(props.tray); ensureShadows(props.tray, true);
    place(props.boardMama, P.boardM); scene.add(props.boardMama); ensureShadows(props.boardMama, true);
    place(props.boardChild, P.boardC); scene.add(props.boardChild); ensureShadows(props.boardChild, true);
    place(props.plate, P.plateOut); props.plate.scale.setScalar(PLATE_SCALE); scene.add(props.plate); ensureShadows(props.plate, true);
    place(props.cups, P.cupsOut); scene.add(props.cups); ensureShadows(props.cups, true);
    props.cups.visible = false;

    var sh = props.shamoji;
    sh.position.copy(P.shamoji); sh.rotation.set(0, 0.1, 0);
    scene.add(sh); ensureShadows(sh, true);
    sh.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(sh);
    if (isFinite(box.min.y)) sh.position.y -= box.min.y;
    W.shamojiHome = { pos: sh.position.clone(), rot: sh.rotation.clone() };

    try { props.cooker.setLid(0); } catch (e) { warn('lid', e); }

    // hands
    var mk = function (who, side) {
      var h = null;
      if (G.Hands && typeof G.Hands.create === 'function') h = tryCall(G.Hands.create, G.Hands, [{ who: who, side: side }], 'hands');
      if (!h || !h.group) h = stubHand(who, side);
      scene.add(h.group);
      if (typeof h.rest === 'function') tryCall(h.rest, h, [0], 'rest');
      return h;
    };
    W.hands = { cL: mk('child', 'L'), cR: mk('child', 'R'), mL: mk('mama', 'L'), mR: mk('mama', 'R') };

    // little onigiri from earlier rounds
    W.minis = [];
    var data = Array.isArray(save.minis) ? save.minis.slice(-5) : [];
    for (var i = 0; i < data.length; i++) {
      if (!data[i] || typeof data[i] !== 'object') continue;
      if (!(G.Rice && typeof G.Rice.fromData === 'function')) break;
      var b = null;
      try { b = G.Rice.fromData(data[i]); } catch (e) { b = null; }
      if (!b || !b.group) continue;
      W.minis.push(b);
    }
    layoutMinis();

    if (G.Cam) G.Cam.frame({ cx: FRAMES.cooker.cx, cz: FRAMES.cooker.cz, w: FRAMES.cooker.w, d: FRAMES.cooker.d, pad: FRAMES.cooker.pad, dur: 0 });
    return W;
  };

  function layoutMinis() {
    var slots = W.props && W.props.plate.slots.tiny;
    if (!slots) return;
    for (var i = 0; i < W.minis.length; i++) {
      var slot = slots[i] || slots[slots.length - 1];
      var g = W.minis[i].group;
      if (!slot) { if (g.parent) g.parent.remove(g); continue; }
      slot.add(g);
      g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
    }
  }

  /* extra helper: keep a finished tiny onigiri (max 5, oldest dropped) and save them */
  W.addMini = function (body) {
    if (!body || !body.group) return;
    if (W.minis.indexOf(body) < 0) W.minis.push(body);
    while (W.minis.length > 5) { var old = W.minis.shift(); if (old.group.parent) old.group.parent.remove(old.group); }
    if (W.riceTiny === body) W.riceTiny = null;
    layoutMinis();
    W.saveMinis();
  };
  W.saveMinis = function () {
    var arr = [];
    for (var i = 0; i < W.minis.length; i++) {
      var b = W.minis[i];
      if (b && typeof b.serialize === 'function') { try { arr.push(b.serialize()); } catch (e) { /* skip */ } }
    }
    if (G.Save) G.Save.set({ minis: arr });
  };

  /* extra helper: slide the tea cups in (S5) / out */
  W.showCups = function (dur) {
    var c = W.props && W.props.cups; if (!c) return;
    c.visible = true;
    G.tween(c.position, { x: P.cupsIn.x, z: P.cupsIn.z }, dur != null ? dur : 0.9, { ease: 'out' });
  };
  W.hideCups = function () {
    var c = W.props && W.props.cups; if (!c) return;
    G.killTweens(c.position); c.position.copy(P.cupsOut); c.visible = false;
  };

  function removeBody(b) { if (b && b.group && b.group.parent) b.group.parent.remove(b.group); }

  W.resetRound = function () {
    if (!W.built) return;
    var props = W.props;
    var round = (W.state ? W.state.round : 0) + 1;
    W.state = freshState(round);
    if (G.Save) G.Save.set({ round: round });
    if (G.Hint) G.Hint.clear();
    try { props.cooker.setLid(0); props.cooker.pressButton(0); } catch (e) { warn('lid', e); }
    removeBody(W.riceC); removeBody(W.riceM);
    if (W.riceTiny && W.minis.indexOf(W.riceTiny) < 0) removeBody(W.riceTiny);
    W.riceC = null; W.riceM = null; W.riceTiny = null;
    [props.tray, props.plate, props.cups, props.shamoji].forEach(function (o) { G.killTweens(o.position); G.killTweens(o.rotation); });
    place(props.tray, P.tray); props.tray.visible = true;
    place(props.plate, P.plateOut);
    W.hideCups();
    var sh = props.shamoji;
    G.scene.attach(sh);
    sh.position.copy(W.shamojiHome.pos); sh.rotation.copy(W.shamojiHome.rot); sh.visible = true;
    var hs = W.hands;
    for (var k in hs) {
      var h = hs[k];
      if (typeof h.setGlow === 'function') tryCall(h.setGlow, h, [0], 'glow');
      if (typeof h.setGrains === 'function') tryCall(h.setGrains, h, [0], 'grains');
      if (typeof h.rest === 'function') tryCall(h.rest, h, [0.6], 'rest');
    }
    layoutMinis();
  };
})();
