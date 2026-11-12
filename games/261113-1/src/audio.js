/* audio.js — Web Audio の合成音だけ（音声ファイル無し）
 * 公開 API:
 *   G.audio.unlock()                        最初のタッチ内で呼ぶ。AudioContext 生成/resume
 *   G.audio.play(name, {vol, pitch, pan, delay})   単発音
 *   G.audio.loop(name, level)               持続音の音量 0..1: curtainSlide doorRoll clothDrag cloudWind
 *   G.audio.amb(name, sec)                  環境音クロスフェード: roomDim roomOpen outside evening night none
 *   G.audio.music(name)                     lullaby morning fluffy
 *   G.audio.stopMusic(sec)
 *   G.audio.suspend() / G.audio.resume()
 * 単発音: curtainEnd doorThunk futonFlop beatFlat beatFluffy dustPuff clip clipPop pop ballBounce
 *   blockClack spoonTing marbleRoll sockFlop railKaan poleKon chime fuwa sunReveal press boing
 *   pillow hint pickup whoosh lampClick
 * どの関数も例外を外へ出さない。読み込み時には AudioContext を作らない。
 */
(function () {
  'use strict';
  var G = window.G = window.G || {};

  var ctx = null, dead = false, paused = false, hooked = false;
  var master, sfxBus, ambBus, musBus, loopBus, revIn;
  var bufW, bufP;
  var voices = [];          // 鳴っている単発音の終了時刻
  var lastAt = {};          // 同名の最終発音時刻
  var pendAmb = null, pendMus = null;
  var MAXV = 24, MINGAP = 0.035;
  var V = null;             // 組み立て中のボイス {nodes, srcs, end}

  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function disc(n) { try { n.disconnect(); } catch (e) { /* 無視 */ } }
  function stopAt(s, t) { try { s.stop(t); } catch (e) { /* 二重 stop 等 */ } }

  // ---- 初期化 ----
  function noiseBuf(pink, sec) {
    var sr = ctx.sampleRate, n = Math.floor(sr * sec);
    var b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < n; i++) {
      var w = Math.random() * 2 - 1;
      if (!pink) { d[i] = w * 0.5; continue; }
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return b;
  }

  function makeIR(sec) {
    var sr = ctx.sampleRate, n = Math.floor(sr * sec);
    var b = ctx.createBuffer(2, n, sr);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c), lp = 0;
      for (var i = 0; i < n; i++) {
        var k = i / n;
        lp += ((Math.random() * 2 - 1) - lp) * (0.5 - 0.35 * k); // 後ろほど暗く
        var fade = i < sr * 0.012 ? i / (sr * 0.012) : 1;
        d[i] = lp * Math.pow(1 - k, 3.2) * fade * 0.6;
      }
    }
    return b;
  }

  function init() {
    if (ctx || dead) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) { dead = true; return; }
      try { ctx = new C({ latencyHint: 'interactive' }); } catch (e) { ctx = new C(); }
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.2;
      var shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 5500; shelf.gain.value = -5;
      master = ctx.createGain(); master.gain.value = 0.5;
      master.connect(shelf); shelf.connect(comp); comp.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
      ambBus = ctx.createGain(); ambBus.gain.value = 1; ambBus.connect(master);
      musBus = ctx.createGain(); musBus.gain.value = 0.75; musBus.connect(master);
      loopBus = ctx.createGain(); loopBus.gain.value = 0.8; loopBus.connect(master);
      bufW = noiseBuf(false, 2);
      bufP = noiseBuf(true, 4);
      revIn = ctx.createGain(); revIn.gain.value = 1;
      var cv = ctx.createConvolver(); cv.buffer = makeIR(1.6);
      var revOut = ctx.createGain(); revOut.gain.value = 0.32;
      revIn.connect(cv); cv.connect(revOut); revOut.connect(master);
    } catch (e) {
      dead = true; ctx = null;
    }
  }

  function resumeCtx() {
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') {
        var pr = ctx.resume();
        if (pr && pr.catch) pr.catch(function () {});
      }
    } catch (e) { /* 無視 */ }
  }

  function silentKick() {
    try {
      var s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination); s.start(0);
      s.onended = function () { disc(s); };
    } catch (e) { /* 無視 */ }
  }

  function ready() { return !!ctx && !dead && !paused && ctx.state === 'running'; }

  // ---- 単発音の部品 ----
  function track(src, end, nodes) {
    if (!V) return;
    V.srcs.push({ s: src, end: end });
    for (var i = 0; i < nodes.length; i++) V.nodes.push(nodes[i]);
    if (end > V.end) V.end = end;
  }

  function envG(p, t, a, v, d) {
    v = Math.max(v, 0.0002);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(v, t + Math.max(a, 0.001));
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(a, 0.001) + Math.max(d, 0.005));
  }

  // 減衰する音程 o: {f, f1, ft, type, a, d, v, det}
  function tone(dst, t, o) {
    var os = ctx.createOscillator(), g = ctx.createGain();
    var a = num(o.a, 0.002), d = num(o.d, 0.2);
    os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f, t);
    if (o.f1) os.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t + num(o.ft, d * 0.6));
    if (o.det && os.detune) os.detune.setValueAtTime(o.det, t);
    envG(g.gain, t, a, num(o.v, 0.5), d);
    os.connect(g); g.connect(dst);
    var end = t + a + d + 0.03;
    os.start(t); os.stop(end);
    track(os, end, [g]);
    return os;
  }

  // フィルタしたノイズ o: {w, type, f, f1, ft, fc:[[dt,f]..], q, a, d, v, rate}
  function nz(dst, t, o) {
    var s = ctx.createBufferSource();
    s.buffer = o.w ? bufW : bufP; s.loop = true;
    if (o.rate) s.playbackRate.value = o.rate;
    var f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f, t);
    f.Q.value = num(o.q, f.type === 'bandpass' ? 0.8 : 0.7);
    var a = num(o.a, 0.002), d = num(o.d, 0.1);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 20), t + num(o.ft, (a + d) * 0.7));
    if (o.fc) for (var i = 0; i < o.fc.length; i++) f.frequency.linearRampToValueAtTime(o.fc[i][1], t + o.fc[i][0]);
    var g = ctx.createGain();
    envG(g.gain, t, a, num(o.v, 0.5), d);
    s.connect(f); f.connect(g); g.connect(dst);
    var end = t + a + d + 0.03;
    s.start(t, Math.random() * (s.buffer.duration - 0.6)); s.stop(end);
    track(s, end, [f, g]);
    return f;
  }

  function filt(dst, type, f, q) {
    var fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.value = f; fl.Q.value = num(q, 0.7);
    fl.connect(dst);
    if (V) V.nodes.push(fl);
    return fl;
  }

  // 周波数のゆれ（深さが減衰）
  function vib(os, t, rate, depth, dur) {
    var l = ctx.createOscillator(), g = ctx.createGain();
    l.frequency.value = rate;
    g.gain.setValueAtTime(depth, t);
    g.gain.exponentialRampToValueAtTime(Math.max(depth * 0.02, 0.01), t + dur);
    l.connect(g); g.connect(os.frequency);
    var end = t + dur + 0.03;
    l.start(t); l.stop(end);
    track(l, end, [g]);
  }

  // オルゴール/グロッケン風の一音
  function mbox(dst, t, f, v, dur) {
    tone(dst, t, { f: f, a: 0.003, d: dur, v: v });
    tone(dst, t, { f: f, det: 5, a: 0.003, d: dur * 0.9, v: v * 0.35 });
    tone(dst, t, { f: f * 2, a: 0.002, d: dur * 0.4, v: v * 0.16 });
    tone(dst, t, { f: f * 4.2, a: 0.001, d: 0.07, v: v * 0.05 });
  }

  // 金属/ガラスの非整数倍音
  function partials(dst, t, f0, list) {
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      tone(dst, t, { f: f0 * p[0], a: 0.0015, d: p[2], v: p[1], det: p[3] || 0 });
    }
  }

  function voice(t, vol, pan, rev) {
    var g = ctx.createGain(); g.gain.value = vol;
    var nodes = [g];
    if (pan && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      g.connect(p); p.connect(sfxBus); nodes.push(p);
    } else g.connect(sfxBus);
    if (rev > 0) {
      var s = ctx.createGain(); s.gain.value = rev;
      g.connect(s); s.connect(revIn); nodes.push(s);
    }
    V = { nodes: nodes, srcs: [], end: t };
    return g;
  }

  function closeV() {
    var v = V; V = null;
    if (!v) return 0;
    var last = null;
    for (var i = 0; i < v.srcs.length; i++) if (!last || v.srcs[i].end >= last.end) last = v.srcs[i];
    var nodes = v.nodes;
    if (!last) { for (var j = 0; j < nodes.length; j++) disc(nodes[j]); return 0; }
    last.s.onended = function () { for (var k = 0; k < nodes.length; k++) disc(nodes[k]); };
    return v.end;
  }

  // ---- 単発音の定義 f(out, t, pitch) ----
  var N = { A3: 220, G3: 196, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440,
    C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66,
    E6: 1318.5, G6: 1568, A6: 1760, C7: 2093 };

  var SFX = {
    beatFlat: { rev: 0.06, f: function (o, t, p) {
      tone(o, t, { f: 125 * p, f1: 78 * p, ft: 0.1, a: 0.002, d: 0.17, v: 0.85 });
      nz(o, t, { f: 900 * p, q: 0.9, a: 0.002, d: 0.06, v: 0.75 });
      nz(o, t, { w: 1, f: 2400 * p, q: 1.3, a: 0.001, d: 0.025, v: 0.25 });
    } },
    beatFluffy: { rev: 0.08, f: function (o, t, p) {
      tone(o, t, { f: 88 * p, f1: 55 * p, ft: 0.18, a: 0.012, d: 0.26, v: 0.75 });
      nz(o, t, { type: 'lowpass', f: 750 * p, f1: 240, ft: 0.3, a: 0.012, d: 0.34, v: 0.65 });
      nz(o, t, { f: 1300 * p, q: 0.7, a: 0.004, d: 0.05, v: 0.18 });
    } },
    dustPuff: { rev: 0.05, f: function (o, t, p) {
      nz(o, t, { type: 'lowpass', f: 520 * p, f1: 170, ft: 0.4, a: 0.035, d: 0.45, v: 0.8 });
      tone(o, t, { f: 72 * p, f1: 52, a: 0.03, d: 0.25, v: 0.3 });
    } },
    futonFlop: { rev: 0.1, f: function (o, t, p) {
      nz(o, t, { f: 620 * p, q: 0.8, a: 0.005, d: 0.13, v: 0.8 });
      nz(o, t + 0.07, { w: 1, f: 2200 * p, f1: 1300, q: 0.7, a: 0.012, d: 0.22, v: 0.3 });
      nz(o, t, { type: 'lowpass', f: 240 * p, f1: 120, a: 0.06, d: 0.5, v: 0.6 });
      tone(o, t, { f: 66 * p, f1: 48, a: 0.02, d: 0.3, v: 0.4 });
    } },
    curtainEnd: { rev: 0.12, f: function (o, t, p) {
      nz(o, t, { w: 1, f: 3200 * p, q: 4, a: 0.001, d: 0.022, v: 0.55 });
      nz(o, t + 0.028, { w: 1, f: 2600 * p, q: 5, a: 0.001, d: 0.03, v: 0.35 });
      tone(o, t, { f: 1850 * p, type: 'triangle', a: 0.001, d: 0.04, v: 0.06 });
      tone(o, t + 0.028, { f: 2330 * p, a: 0.001, d: 0.05, v: 0.04 });
    } },
    doorThunk: { rev: 0.15, f: function (o, t, p) {
      tone(o, t, { f: 96 * p, f1: 70 * p, a: 0.003, d: 0.22, v: 0.8 });
      nz(o, t, { type: 'lowpass', f: 650 * p, a: 0.002, d: 0.09, v: 0.6 });
      nz(o, t, { w: 1, f: 1600 * p, q: 2, a: 0.001, d: 0.03, v: 0.2 });
      tone(o, t + 0.075, { f: 90 * p, a: 0.003, d: 0.08, v: 0.22 });
    } },
    clip: { rev: 0.06, f: function (o, t, p) {
      nz(o, t, { w: 1, f: 2800 * p, q: 3, a: 0.001, d: 0.018, v: 0.8 });
      tone(o, t, { f: 1400 * p, f1: 900 * p, type: 'triangle', a: 0.001, d: 0.04, v: 0.12 });
      nz(o, t, { f: 900 * p, q: 1, a: 0.001, d: 0.04, v: 0.3 });
    } },
    clipPop: { rev: 0.1, f: function (o, t, p) {
      nz(o, t, { w: 1, f: 2400 * p, q: 2.5, a: 0.001, d: 0.025, v: 1 });
      nz(o, t, { type: 'lowpass', f: 1200 * p, a: 0.001, d: 0.06, v: 0.5 });
      var lp = filt(o, 'lowpass', 1800, 0.7);
      var s = tone(lp, t + 0.01, { f: 360 * p, f1: 250 * p, ft: 0.35, type: 'triangle', a: 0.005, d: 0.36, v: 0.2 });
      vib(s, t + 0.01, 22, 70 * p, 0.36);
    } },
    pop: { rev: 0.12, f: function (o, t, p) {
      tone(o, t, { f: 520 * p, f1: 1050 * p, ft: 0.11, a: 0.012, d: 0.16, v: 0.3 });
      tone(o, t, { f: 1040 * p, f1: 2100 * p, ft: 0.11, a: 0.012, d: 0.1, v: 0.03 });
      nz(o, t, { f: 1200 * p, q: 1, a: 0.002, d: 0.05, v: 0.1 });
    } },
    ballBounce: { rev: 0.1, f: function (o, t, p) {
      tone(o, t, { f: 185 * p, f1: 120 * p, a: 0.002, d: 0.1, v: 0.7 });
      tone(o, t, { f: 430 * p, a: 0.001, d: 0.04, v: 0.12 });
      nz(o, t, { f: 1000 * p, q: 1, a: 0.001, d: 0.02, v: 0.2 });
    } },
    blockClack: { rev: 0.15, f: function (o, t, p) {
      partials(o, t, 1150 * p, [[1, 0.32, 0.05], [2.3, 0.1, 0.03]]);
      nz(o, t, { w: 1, f: 2000 * p, q: 3, a: 0.001, d: 0.015, v: 0.4 });
      partials(o, t + 0.09, 850 * p, [[1, 0.28, 0.07], [2.4, 0.09, 0.04]]);
      nz(o, t + 0.09, { w: 1, f: 1700 * p, q: 3, a: 0.001, d: 0.015, v: 0.3 });
    } },
    spoonTing: { rev: 0.3, f: function (o, t, p) {
      partials(o, t, 1850 * p, [[1, 0.22, 1.2], [2.24, 0.06, 0.6], [3.95, 0.018, 0.25]]);
      nz(o, t, { w: 1, f: 4000 * p, q: 2, a: 0.001, d: 0.01, v: 0.2 });
      partials(o, t + 0.18, 1850 * p, [[1, 0.1, 0.8], [2.24, 0.03, 0.4]]);
    } },
    marbleRoll: { rev: 0.18, f: function (o, t, p) {
      var tt = t;
      for (var i = 0; i < 10; i++) {
        tt += 0.045 + i * 0.008 + Math.random() * 0.025;
        var vv = 0.05 + Math.random() * 0.04;
        tone(o, tt, { f: (3000 + Math.random() * 700) * p, a: 0.001, d: 0.02, v: vv });
        nz(o, tt, { w: 1, f: 3800 * p, q: 4, a: 0.001, d: 0.01, v: vv * 1.8 });
      }
      nz(o, t, { type: 'lowpass', f: 320 * p, a: 0.1, d: 0.65, v: 0.12 });
      var e = tt + 0.12;
      partials(o, e, 2600 * p, [[1, 0.18, 0.09], [2.27, 0.06, 0.05]]);
      nz(o, e, { w: 1, f: 3000 * p, q: 3, a: 0.001, d: 0.012, v: 0.3 });
    } },
    sockFlop: { rev: 0.06, f: function (o, t, p) {
      nz(o, t, { f: 700 * p, q: 0.8, a: 0.004, d: 0.07, v: 0.6 });
      tone(o, t, { f: 140 * p, f1: 110 * p, a: 0.003, d: 0.05, v: 0.2 });
    } },
    railKaan: { rev: 0.25, f: function (o, t, p) {
      partials(o, t, 620 * p, [[1, 0.24, 1.2], [1.004, 0.1, 1.1], [2.32, 0.13, 0.8], [3.87, 0.06, 0.5], [5.4, 0.025, 0.3]]);
      nz(o, t, { w: 1, f: 3000 * p, q: 1, a: 0.001, d: 0.02, v: 0.22 });
    } },
    poleKon: { rev: 0.2, f: function (o, t, p) {
      partials(o, t, 480 * p, [[1, 0.36, 0.5], [2.76, 0.11, 0.25], [5.4, 0.035, 0.12]]);
      nz(o, t, { w: 1, f: 1800 * p, q: 1.5, a: 0.001, d: 0.015, v: 0.25 });
    } },
    chime: { rev: 0.4, f: function (o, t, p) {
      var f0 = 1900 * p;
      partials(o, t, f0, [[1, 0.1, 1.6], [1.004, 0.05, 1.5], [2.48, 0.035, 0.9], [4.1, 0.012, 0.4]]);
      nz(o, t, { w: 1, f: 5000, q: 3, a: 0.001, d: 0.008, v: 0.06 });
      partials(o, t + 0.32, f0 * 1.003, [[1, 0.045, 1.1], [2.48, 0.014, 0.6]]);
    } },
    fuwa: { rev: 0.3, f: function (o, t, p) {
      nz(o, t, { type: 'lowpass', f: 380, fc: [[0.12, 900], [0.45, 300]], a: 0.07, d: 0.4, v: 0.45 });
      var f = N.C5 * p;
      tone(o, t + 0.04, { f: f * 0.97, f1: f, ft: 0.06, a: 0.02, d: 0.6, v: 0.15 });
      tone(o, t + 0.04, { f: f * 2, a: 0.02, d: 0.3, v: 0.025 });
    } },
    sunReveal: { rev: 0.45, f: function (o, t, p) {
      var ch = [N.C5, N.E5, N.G5, N.C6];
      for (var i = 0; i < ch.length; i++) {
        tone(o, t + i * 0.05, { f: ch[i] * p, a: 0.28 + i * 0.05, d: 0.95, v: 0.075 });
        tone(o, t + i * 0.05, { f: ch[i] * 2 * p, a: 0.3, d: 0.5, v: 0.01 });
      }
      var sp = [N.C7, 2637, 3136, 2349];
      for (var j = 0; j < sp.length; j++) tone(o, t + 0.12 + j * 0.17 + Math.random() * 0.06, { f: sp[j] * p, a: 0.002, d: 0.3, v: 0.018 });
    } },
    press: { rev: 0.05, f: function (o, t, p) {
      nz(o, t, { type: 'lowpass', f: 360 * p, f1: 150, a: 0.04, d: 0.35, v: 0.7 });
      tone(o, t, { f: 76 * p, f1: 55, a: 0.03, d: 0.3, v: 0.38 });
    } },
    boing: { rev: 0.15, f: function (o, t, p) {
      var lp = filt(o, 'lowpass', 900, 0.7);
      var s = tone(lp, t, { f: 140 * p, type: 'triangle', a: 0.02, d: 0.7, v: 0.4 });
      s.frequency.linearRampToValueAtTime(178 * p, t + 0.08);
      s.frequency.linearRampToValueAtTime(160 * p, t + 0.7);
      vib(s, t, 5.5, 22 * p, 0.7);
      nz(o, t, { type: 'lowpass', f: 300, a: 0.01, d: 0.12, v: 0.3 });
    } },
    pillow: { rev: 0.05, f: function (o, t, p) {
      nz(o, t, { type: 'lowpass', f: 620 * p, f1: 250, a: 0.008, d: 0.15, v: 0.55 });
      tone(o, t, { f: 110 * p, f1: 80, a: 0.004, d: 0.12, v: 0.28 });
    } },
    hint: { rev: 0.3, f: function (o, t, p) {
      mbox(o, t, N.G5 * p, 0.09, 0.6);
      mbox(o, t + 0.17, N.C6 * p, 0.08, 0.8);
    } },
    pickup: { rev: 0.1, f: function (o, t, p) {
      partials(o, t, 900 * p, [[1, 0.14, 0.04], [2.55, 0.05, 0.025]]);
      nz(o, t, { w: 1, f: 1500 * p, q: 2, a: 0.001, d: 0.02, v: 0.3 });
      nz(o, t + 0.05, { w: 1, f: 1300 * p, q: 2, a: 0.001, d: 0.015, v: 0.15 });
    } },
    whoosh: { rev: 0.05, f: function (o, t, p) {
      nz(o, t, { f: 500 * p, q: 1.2, fc: [[0.08, 1600 * p], [0.26, 700 * p]], a: 0.06, d: 0.2, v: 0.4 });
    } },
    lampClick: { rev: 0.12, f: function (o, t, p) {
      nz(o, t, { w: 1, f: 3500 * p, q: 3, a: 0.001, d: 0.012, v: 0.4 });
      tone(o, t, { f: 2200 * p, a: 0.001, d: 0.015, v: 0.05 });
      nz(o, t + 0.06, { w: 1, f: 3000 * p, q: 3, a: 0.001, d: 0.01, v: 0.15 });
    } }
  };

  function play(name, opts) {
    try {
      if (!ready()) return;
      var S = SFX[name]; if (!S) return;
      opts = opts || {};
      var now = ctx.currentTime;
      var t = now + 0.005 + Math.max(0, num(opts.delay, 0));
      if (lastAt[name] != null && Math.abs(t - lastAt[name]) < MINGAP) return;
      var vol = clamp(num(opts.vol, 1), 0, 1.5); if (vol <= 0) return;
      var live = [];
      for (var i = 0; i < voices.length; i++) if (voices[i] > now) live.push(voices[i]);
      voices = live;
      if (voices.length >= MAXV) return;
      lastAt[name] = t;
      var p = clamp(num(opts.pitch, 1), 0.25, 4);
      var out = voice(t, vol, num(opts.pan, 0), S.rev || 0);
      try { S.f(out, t, p); } catch (e) { /* 無視 */ }
      var end = closeV();
      if (end > 0) voices.push(end);
    } catch (e) { V = null; }
  }

  // ---- 持続音・環境音の部品（止めない/まとめて止める） ----
  function hold() { return { srcs: [], nodes: [] }; }
  function npart(h, dst, buf, rate, type, f, q, lvl) {
    var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    var fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    var g = ctx.createGain(); g.gain.value = lvl;
    s.connect(fl); fl.connect(g); g.connect(dst);
    s.start(ctx.currentTime, Math.random() * (buf.duration - 0.5));
    h.srcs.push(s); h.nodes.push(fl, g);
    return { f: fl, g: g };
  }
  function slfo(h, type, freq, depth, param) {
    var l = ctx.createOscillator(), g = ctx.createGain();
    l.type = type; l.frequency.value = freq; g.gain.value = depth;
    l.connect(g); g.connect(param); l.start(ctx.currentTime);
    h.srcs.push(l); h.nodes.push(g);
  }

  var LOOPDEF = {
    curtainSlide: { max: 0.14, b: function (h, out) {
      var a = npart(h, out, bufW, 1, 'bandpass', 3800, 0.9, 0.6);
      slfo(h, 'sawtooth', 31, 0.3, a.g.gain);
      slfo(h, 'square', 47, 0.15, a.g.gain);
      npart(h, out, bufW, 1, 'highpass', 6500, 0.7, 0.08);
    } },
    doorRoll: { max: 0.5, b: function (h, out) {
      var a = npart(h, out, bufP, 0.9, 'lowpass', 380, 1.2, 0.7);
      slfo(h, 'triangle', 11, 0.3, a.g.gain);
      slfo(h, 'sine', 17.3, 0.2, a.g.gain);
      var c = npart(h, out, bufP, 1, 'bandpass', 1200, 2, 0.15);
      slfo(h, 'square', 23, 0.13, c.g.gain);
    } },
    clothDrag: { max: 0.24, b: function (h, out) {
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400; hp.connect(out); h.nodes.push(hp);
      var a = npart(h, hp, bufP, 1.05, 'bandpass', 2000, 0.6, 0.8);
      slfo(h, 'sine', 0.7, 500, a.f.frequency);
      slfo(h, 'sine', 3.1, 0.2, a.g.gain);
    } },
    cloudWind: { max: 0.36, b: function (h, out) {
      var a = npart(h, out, bufP, 0.95, 'lowpass', 600, 0.5, 0.75);
      slfo(h, 'sine', 0.15, 250, a.f.frequency);
      slfo(h, 'sine', 0.23, 0.25, a.g.gain);
    } }
  };
  var loops = {};

  function loop(name, level) {
    try {
      if (!ctx || dead) return;
      var L = loops[name];
      if (!L) {
        var D = LOOPDEF[name]; if (!D) return;
        if (!(num(level, 0) > 0)) return;          // 鳴らす時に初めて作る
        var g = ctx.createGain(); g.gain.value = 0; g.connect(loopBus);
        var h = hold(); D.b(h, g);
        L = loops[name] = { g: g, max: D.max, lv: 0 };
      }
      var lv = clamp(num(level, 0), 0, 1);
      if (Math.abs(lv - L.lv) < 0.01 && !(lv === 0 && L.lv !== 0)) return;
      L.lv = lv;
      L.g.gain.setTargetAtTime(lv * L.max, ctx.currentTime, 0.02);
    } catch (e) { /* 無視 */ }
  }

  // ---- 環境音 ----
  var AMB = {
    roomDim: { air: 1, birds: { rate: 0.15, vol: 0.35, lp: 2200, pan: 0.4 } },
    roomOpen: { air: 0.7, town: 0.55, breeze: 0.5, rev: 0.25, birds: { rate: 0.45, vol: 0.6, lp: 5000, pan: 0.6 } },
    outside: { town: 1, breeze: 1, birds: { rate: 0.7, vol: 1, lp: 9000, pan: 0.85 } },
    evening: { town: 0.8, breeze: 0.35, birds: { rate: 0.07, vol: 0.5, lp: 6000, pan: 0.7 } },
    night: { air: 0.6 },
    none: null
  };
  var curAmb = null, curAmbName = null;

  function makeScene(cfg) {
    var h = hold();
    var g = ctx.createGain(); g.gain.value = 0.0001; g.connect(ambBus); h.nodes.push(g);
    h.g = g; h.cfg = cfg; h.next = 0; h.alive = true;
    if (cfg.rev) { var s = ctx.createGain(); s.gain.value = cfg.rev; g.connect(s); s.connect(revIn); h.nodes.push(s); }
    if (cfg.air) npart(h, g, bufP, 0.8, 'bandpass', 200, 0.4, 0.07 * cfg.air);
    if (cfg.town) {
      var a = npart(h, g, bufP, 0.7, 'bandpass', 140, 0.5, 0.12 * cfg.town);
      slfo(h, 'sine', 0.04, 0.03 * cfg.town, a.g.gain);
      npart(h, g, bufP, 1.1, 'bandpass', 700, 0.7, 0.015 * cfg.town);
    }
    if (cfg.breeze) {
      var b = npart(h, g, bufP, 0.97, 'bandpass', 500, 0.5, 0.09 * cfg.breeze);
      slfo(h, 'sine', 0.09, 180, b.f.frequency);
      slfo(h, 'sine', 0.06, 0.05 * cfg.breeze, b.g.gain);
    }
    if (cfg.birds) {
      var bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = cfg.birds.lp; bf.Q.value = 0.5;
      bf.connect(g); h.nodes.push(bf); h.bf = bf;
    }
    return h;
  }

  function killScene(h, sec) {
    h.alive = false;
    var now = ctx.currentTime, end = now + sec + 0.1;
    try {
      h.g.gain.cancelScheduledValues(now);
      h.g.gain.setValueAtTime(Math.max(h.g.gain.value, 0.0001), now);
      h.g.gain.linearRampToValueAtTime(0, now + sec);
    } catch (e) { /* 無視 */ }
    var nodes = h.nodes;
    for (var i = 0; i < h.srcs.length; i++) stopAt(h.srcs[i], end);
    if (h.srcs.length) h.srcs[0].onended = function () { for (var k = 0; k < nodes.length; k++) disc(nodes[k]); };
    else for (var j = 0; j < nodes.length; j++) disc(nodes[j]);
  }

  function amb(name, sec) {
    try {
      if (!Object.prototype.hasOwnProperty.call(AMB, name)) return;
      sec = Math.max(0.05, num(sec, 1.5));
      if (dead) return;
      if (!ctx) { pendAmb = { name: name, sec: sec }; return; }
      if (name === curAmbName) return;
      curAmbName = name;
      if (curAmb) { killScene(curAmb, sec); curAmb = null; }
      var cfg = AMB[name];
      if (!cfg) return;
      var h = makeScene(cfg), now = ctx.currentTime;
      h.g.gain.setValueAtTime(0.0001, now);
      h.g.gain.linearRampToValueAtTime(1, now + sec);
      h.next = now + rnd(0.5, 2);
      curAmb = h;
    } catch (e) { /* 無視 */ }
  }

  // 小鳥の一声（上がって下がる チュン、FM で少しざらつき）
  function chirp(dst, t, f, len, v, extra) {
    var c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    c.frequency.setValueAtTime(f * 0.82, t);
    c.frequency.linearRampToValueAtTime(f * 1.06, t + len * 0.3);
    c.frequency.exponentialRampToValueAtTime(f * 0.72, t + len);
    m.frequency.value = 70 + Math.random() * 80; mg.gain.value = f * 0.035;
    m.connect(mg); mg.connect(c.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    c.connect(g); g.connect(dst);
    c.start(t); m.start(t); c.stop(t + len + 0.02); m.stop(t + len + 0.02);
    c.onended = function () { disc(g); disc(mg); if (extra) disc(extra); };
  }

  function birdPhrase(h, t) {
    var b = h.cfg.birds, dst = h.bf, pn = null;
    if (ctx.createStereoPanner) {
      pn = ctx.createStereoPanner(); pn.pan.value = rnd(-b.pan, b.pan); pn.connect(h.bf); dst = pn;
    }
    var base = rnd(3500, 4700), r = Math.random();
    var n = r < 0.4 ? 1 : (r < 0.8 ? 2 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 2));
    var vv = 0.06 * b.vol * rnd(0.45, 1), tt = t;
    for (var i = 0; i < n; i++) {
      var lastOne = i === n - 1;
      var len = lastOne ? rnd(0.09, 0.13) : rnd(0.05, 0.08);
      var f = base * (lastOne ? 0.93 : rnd(0.97, 1.08));
      chirp(dst, tt, f, len, vv * (lastOne ? 1 : rnd(0.6, 0.9)), lastOne ? pn : null);
      tt += len + rnd(0.03, 0.07);
    }
    return tt - t;
  }

  function tick() {
    try {
      if (!ready() || !curAmb || !curAmb.alive || !curAmb.cfg.birds) return;
      var h = curAmb, b = h.cfg.birds, now = ctx.currentTime, guard = 0;
      if (h.next < now) h.next = now + rnd(0.2, 1.2);
      while (h.next < now + 1 && guard++ < 4) {
        var len = birdPhrase(h, h.next);
        h.next += len + 0.25 + (-Math.log(1 - Math.random() * 0.98)) / b.rate;
      }
    } catch (e) { /* 無視 */ }
  }

  function hookUpdate() {
    if (hooked) return;
    hooked = true;
    try {
      if (typeof G.onUpdate === 'function') G.onUpdate(function () { tick(); });
      else setInterval(tick, 300);
    } catch (e) { /* 無視 */ }
  }

  // ---- 音楽 ----
  var curTrack = null;

  var MUS = {
    lullaby: function (o, t0) {
      var B = 0.58;
      var mel = [['E5', 2], ['G5', 1], ['A5', 2], ['G5', 1], ['E5', 1], ['D5', 1], ['E5', 1], ['G5', 3],
        ['A5', 1], ['G5', 1], ['E5', 1], ['D5', 2], ['E5', 1], ['D5', 1], ['C5', 1], ['A4', 1], ['C5', 3]];
      var acc = [['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['C4', 'E4', 'G4'], ['G3', 'D4', 'G4'],
        ['A3', 'C4', 'E4'], ['G3', 'D4', 'G4'], ['A3', 'C4', 'E4'], ['C4', 'G4', null]];
      // 拍の時刻（最後の小節で少しゆっくり）
      var bt = [], tt = t0;
      for (var i = 0; i <= 24; i++) { bt.push(tt); tt += B * (i >= 20 ? 1 + (i - 19) * 0.09 : 1); }
      var beat = 0;
      for (var m = 0; m < mel.length; m++) {
        var last = m === mel.length - 1;
        mbox(o, bt[beat] + Math.random() * 0.008, N[mel[m][0]], last ? 0.17 : 0.2, last ? 3.2 : 1.4 + mel[m][1] * 0.25);
        beat += mel[m][1];
      }
      for (var k = 0; k < 8; k++) {
        var a = acc[k], b0 = k * 3;
        mbox(o, bt[b0], N[a[0]], 0.11, k === 7 ? 3.4 : 1.8);
        if (k === 7) { mbox(o, bt[b0] + 0.04, N.G4, 0.06, 3); continue; }
        mbox(o, bt[b0 + 1], N[a[1]], 0.065, 1.1);
        mbox(o, bt[b0 + 2], N[a[2]], 0.06, 1.1);
      }
    },
    morning: function (o, t0) {
      var ns = ['C5', 'D5', 'E5', 'G5', 'C6'];
      for (var i = 0; i < ns.length; i++) mbox(o, t0 + i * 0.15, N[ns[i]], i === 4 ? 0.17 : 0.14, i === 4 ? 1.6 : 0.7);
      mbox(o, t0 + 0.6, N.E5, 0.06, 1.4);
      mbox(o, t0 + 0.6, N.G5, 0.06, 1.4);
    },
    fluffy: function (o, t0) {
      var ar = ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'];
      for (var i = 0; i < ar.length; i++) mbox(o, t0 + i * 0.14, N[ar[i]], 0.13 - i * 0.01, 1.2);
      var pad = [N.C5, N.E5, N.G5];
      for (var j = 0; j < pad.length; j++) tone(o, t0 + 0.2, { f: pad[j] / 2, a: 0.6, d: 2.3, v: 0.05 });
      var sp = ['E6', 'G6', 'A6', 'C7', 'G6'];
      for (var k = 0; k < sp.length; k++) mbox(o, t0 + rnd(0.9, 2.6), N[sp[k]], 0.035, 0.5);
    }
  };

  function fadeTrack(tr, sec) {
    var now = ctx.currentTime;
    try {
      tr.g.gain.cancelScheduledValues(now);
      tr.g.gain.setValueAtTime(tr.g.gain.value, now);
      tr.g.gain.linearRampToValueAtTime(0, now + sec);
    } catch (e) { /* 無視 */ }
    for (var i = 0; i < tr.srcs.length; i++) stopAt(tr.srcs[i].s, now + sec + 0.05);
  }

  function music(name) {
    try {
      if (!MUS[name] || dead) return;
      if (!ctx) { pendMus = name; return; }
      if (curTrack) { fadeTrack(curTrack, 0.3); curTrack = null; }
      var t0 = ctx.currentTime + 0.06;
      var g = ctx.createGain(); g.gain.value = 1; g.connect(musBus);
      var s = ctx.createGain(); s.gain.value = 0.4; g.connect(s); s.connect(revIn);
      V = { nodes: [g, s], srcs: [], end: t0 };
      var srcs = V.srcs;
      try { MUS[name](g, t0); } catch (e) { /* 無視 */ }
      closeV();
      curTrack = { g: g, srcs: srcs };
    } catch (e) { V = null; }
  }

  function stopMusic(sec) {
    try {
      pendMus = null;
      if (!ctx || !curTrack) return;
      fadeTrack(curTrack, Math.max(0.02, num(sec, 1)));
      curTrack = null;
    } catch (e) { /* 無視 */ }
  }

  // ---- 公開 ----
  G.audio = {
    unlock: function () {
      try {
        if (dead) return;
        if (!ctx) { init(); if (!ctx) return; hookUpdate(); }
        paused = false;
        if (ctx.state !== 'running') silentKick();
        resumeCtx();
        if (pendAmb) { var a = pendAmb; pendAmb = null; amb(a.name, a.sec); }
        if (pendMus) { var m = pendMus; pendMus = null; music(m); }
      } catch (e) { /* 無視 */ }
    },
    play: play,
    loop: loop,
    amb: amb,
    music: music,
    stopMusic: stopMusic,
    suspend: function () {
      try {
        paused = true;
        if (ctx && ctx.state === 'running') {
          var pr = ctx.suspend();
          if (pr && pr.catch) pr.catch(function () {});
        }
      } catch (e) { /* 無視 */ }
    },
    resume: function () {
      try { paused = false; resumeCtx(); } catch (e) { /* 無視 */ }
    }
  };
})();
