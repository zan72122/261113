/* audio.js — Web Audio の合成音だけ（音声ファイル無し）「きゅっきゅっ！おさらをふいてしまおう」
 * 公開 API:
 *   G.audio.unlock()                                最初のタッチ内で呼ぶ。AudioContext 生成/resume
 *   G.audio.play(name, {vol, pitch, pan, delay})    単発音
 *   G.audio.loop(name, level)                       持続音 0..1: water rub fizz
 *   G.audio.amb(name, sec)                          環境音クロスフェード: kitchen dusk dinner none
 *   G.audio.music(name) / G.audio.stopMusic(sec)    dinner night
 *   G.audio.suspend() / G.audio.resume()
 * 単発音: leverClick drip pop foam clink glassTing pickup clothThud squeak dropDodge dropCatch
 *   kira kiraSoft sparkle koton whoosh lampClick lampOn itadaki paku gokku gochiso hint
 * どの関数も例外を外へ出さない。読み込み時には AudioContext を作らない。
 */
(function () {
  'use strict';
  var G = window.G = window.G || {};

  var ctx = null, dead = false, paused = false, hooked = false;
  var master, sfxBus, ambBus, musBus, loopBus, revIn;
  var bufW, bufP, bufC;
  var voices = [];          // 鳴っている単発音の終了時刻
  var lastAt = {};          // 同名の最終発音時刻
  var pendAmb = null, pendMus = null;
  var dying = [];           // 後で disconnect するノード {nodes, at}
  var MAXV = 24, MINGAP = 0.035;
  var V = null;             // 組み立て中のボイス {nodes, srcs, end}

  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function disc(n) { try { n.disconnect(); } catch (e) { /* 無視 */ } }
  function stopAt(s, t) { try { s.stop(t); } catch (e) { /* 二重 stop 等 */ } }

  // 音名 → 周波数（'C5' 'F#4' 'Bb4'）
  var NOTE_OFS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var nCache = {};
  function hz(n) {
    if (typeof n === 'number') return n;
    if (nCache[n]) return nCache[n];
    var m = /^([A-G])(#|b)?(-?\d)$/.exec(n || '');
    if (!m) return 0;
    var s = NOTE_OFS[m[1]] + (m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0));
    var midi = (parseInt(m[3], 10) + 1) * 12 + s;
    return (nCache[n] = 440 * Math.pow(2, (midi - 69) / 12));
  }

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

  // 細かいぷちぷち（泡がはじける粒）のバッファ
  function crackleBuf(sec, rate) {
    var sr = ctx.sampleRate, n = Math.floor(sr * sec);
    var b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    var cnt = Math.floor(sec * rate);
    for (var k = 0; k < cnt; k++) {
      var at = Math.floor(Math.random() * (n - 400)), amp = Math.pow(Math.random(), 2.2) * 0.9;
      var len = 40 + Math.floor(Math.random() * 160), sgn = Math.random() < 0.5 ? -1 : 1;
      for (var i = 0; i < len; i++) d[at + i] += sgn * amp * Math.exp(-i / (len * 0.25)) * (Math.random() * 2 - 1);
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
        lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * k); // 後ろほど暗く
        var fade = i < sr * 0.008 ? i / (sr * 0.008) : 1;
        // 台所の早い反射（タイル・天井）を少し
        var er = (i === Math.floor(sr * (0.011 + c * 0.003)) || i === Math.floor(sr * (0.023 + c * 0.004))) ? 0.35 : 0;
        d[i] = (lp * Math.pow(1 - k, 3.6) * fade + er) * 0.55;
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
      shelf.type = 'highshelf'; shelf.frequency.value = 5000; shelf.gain.value = -6;
      var top = ctx.createBiquadFilter();
      top.type = 'lowpass'; top.frequency.value = 11000; top.Q.value = 0.5;
      master = ctx.createGain(); master.gain.value = 0.48;
      master.connect(shelf); shelf.connect(top); top.connect(comp); comp.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
      ambBus = ctx.createGain(); ambBus.gain.value = 1; ambBus.connect(master);
      musBus = ctx.createGain(); musBus.gain.value = 0.55; musBus.connect(master);
      loopBus = ctx.createGain(); loopBus.gain.value = 0.8; loopBus.connect(master);
      bufW = noiseBuf(false, 2);
      bufP = noiseBuf(true, 4);
      bufC = crackleBuf(3, 260);
      revIn = ctx.createGain(); revIn.gain.value = 1;
      var cv = ctx.createConvolver(); cv.buffer = makeIR(1.1);
      var revOut = ctx.createGain(); revOut.gain.value = 0.3;
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

  // 折れ線の音程と音量 fp=[[dt,f]..] gp=[[dt,v]..]（最後の点で 0 へ指数減衰）
  function sweep(dst, t, type, fp, gp) {
    var os = ctx.createOscillator(), g = ctx.createGain(), i;
    os.type = type || 'sine';
    os.frequency.setValueAtTime(fp[0][1], t + fp[0][0]);
    for (i = 1; i < fp.length; i++) os.frequency.linearRampToValueAtTime(fp[i][1], t + fp[i][0]);
    g.gain.setValueAtTime(0.0001, t);
    for (i = 0; i < gp.length; i++) {
      if (i === gp.length - 1) g.gain.exponentialRampToValueAtTime(0.0001, t + gp[i][0]);
      else g.gain.linearRampToValueAtTime(Math.max(gp[i][1], 0.0001), t + gp[i][0]);
    }
    os.connect(g); g.connect(dst);
    var end = t + gp[gp.length - 1][0] + 0.03;
    os.start(t); os.stop(end);
    track(os, end, [g]);
    return { os: os, g: g };
  }

  // フィルタしたノイズ o: {w, buf, type, f, f1, ft, fc:[[dt,f]..], q, a, d, v, rate}
  function nz(dst, t, o) {
    var s = ctx.createBufferSource();
    s.buffer = o.buf || (o.w ? bufW : bufP); s.loop = true;
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

  function filt(dst, type, f, q, gain) {
    var fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.value = f; fl.Q.value = num(q, 0.7);
    if (gain != null) fl.gain.value = gain;
    fl.connect(dst);
    if (V) V.nodes.push(fl);
    return fl;
  }

  function panTo(dst, pan) {
    if (!ctx.createStereoPanner) return dst;
    var p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(dst);
    if (V) V.nodes.push(p);
    return p;
  }

  // 周波数のゆれ（深さが減衰）
  function vib(os, t, rate, depth, dur, keep) {
    var l = ctx.createOscillator(), g = ctx.createGain();
    l.frequency.value = rate;
    g.gain.setValueAtTime(depth, t);
    if (!keep) g.gain.exponentialRampToValueAtTime(Math.max(depth * 0.02, 0.01), t + dur);
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

  // マリンバ風の一音（木のマレット）
  function mar(dst, t, f, v, dur) {
    tone(dst, t, { f: f, a: 0.002, d: dur, v: v });
    tone(dst, t, { f: f * 3.98, a: 0.001, d: Math.min(0.09, dur * 0.3), v: v * (f > 700 ? 0.08 : 0.18) });
    tone(dst, t, { f: f * 2, a: 0.002, d: dur * 0.25, v: v * 0.06 });
    nz(dst, t, { type: 'lowpass', f: Math.min(3000, f * 3), a: 0.001, d: 0.012, v: v * 0.35 });
  }

  // 金属/ガラス/陶器の非整数倍音 list=[[倍率, 音量, 長さ, detune]]
  function partials(dst, t, f0, list) {
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      tone(dst, t, { f: f0 * p[0], a: 0.0015, d: p[2], v: p[1], det: p[3] || 0 });
    }
  }

  // 陶器の「かちゃ」 1 打
  function ceramic(dst, t, f0, v, len) {
    len = len || 1;
    partials(dst, t, f0, [[1, 0.2 * v, 0.11 * len], [1.52, 0.07 * v, 0.08 * len], [2.31, 0.08 * v, 0.06 * len],
      [3.86, 0.035 * v, 0.035 * len], [1.004, 0.06 * v, 0.1 * len, 4]]);
    nz(dst, t, { w: 1, f: Math.min(f0 * 2.2, 7000), q: 2.5, a: 0.0008, d: 0.008, v: 0.4 * v });
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

  // 一時的なボイスで fn を組み立て（後片付け付き）。作った音源 {s,end} の配列を返す
  function withV(fn, extraNodes) {
    var prev = V;
    V = { nodes: extraNodes || [], srcs: [], end: 0 };
    var srcs = V.srcs;
    try { fn(); } catch (e) { /* 無視 */ }
    closeV();
    V = prev;
    return srcs;
  }

  // ---- 単発音の定義 f(out, t, pitch) ----
  var SFX = {
    leverClick: { rev: 0.1, f: function (o, t, p) {
      nz(o, t, { w: 1, f: 4300 * p, q: 4, a: 0.0008, d: 0.01, v: 0.45 });
      partials(o, t, 2650 * p, [[1, 0.06, 0.05], [2.71, 0.025, 0.025], [1.49, 0.03, 0.035]]);
      nz(o, t + 0.028, { w: 1, f: 3600 * p, q: 4, a: 0.0008, d: 0.008, v: 0.22 });
      tone(o, t + 0.028, { f: 3100 * p, a: 0.001, d: 0.03, v: 0.025 });
      tone(o, t, { f: 320 * p, f1: 240 * p, a: 0.001, d: 0.025, v: 0.08 });
    } },
    drip: { rev: 0.28, f: function (o, t, p) {
      var f0 = 620 * p * rnd(0.92, 1.08);
      sweep(o, t, 'sine', [[0, f0], [0.012, f0 * 1.35], [0.05, f0 * 2.3]], [[0.002, 0.34], [0.03, 0.22], [0.075, 0]]);
      nz(o, t, { type: 'lowpass', f: 900, a: 0.001, d: 0.012, v: 0.15 });
      tone(o, t + 0.035, { f: f0 * 2.35, a: 0.003, d: 0.06, v: 0.04 });
    } },
    pop: { rev: 0.15, f: function (o, t, p) {
      var k = rnd(0.9, 1.15);
      nz(o, t, { w: 1, f: 2600 * p * k, q: 1.3, a: 0.0006, d: 0.012, v: 0.45 });
      tone(o, t, { f: 900 * p * k, f1: 1900 * p * k, ft: 0.025, a: 0.001, d: 0.035, v: 0.14 });
      tone(o, t + 0.006, { f: 2400 * p * k, a: 0.001, d: 0.02, v: 0.03 });
      // ちいさな粒が散る
      for (var i = 0; i < 3; i++) nz(o, t + 0.015 + i * rnd(0.01, 0.025), { buf: bufC, type: 'highpass', f: 3000, a: 0.001, d: 0.02, v: 0.12 });
    } },
    foam: { rev: 0.08, f: function (o, t, p) {
      nz(o, t, { type: 'bandpass', f: 900 * p, q: 0.9, fc: [[0.08, 2400 * p], [0.28, 1100 * p]], a: 0.03, d: 0.25, v: 0.32 });
      nz(o, t + 0.02, { buf: bufC, type: 'bandpass', f: 3200 * p, q: 0.7, a: 0.02, d: 0.3, v: 0.5 });
      // むにゅ（やわらかい低い揺れ）
      var lp = filt(o, 'lowpass', 900, 0.8);
      var s = sweep(lp, t + 0.03, 'triangle', [[0, 170 * p], [0.12, 240 * p], [0.26, 200 * p]], [[0.04, 0.09], [0.15, 0.07], [0.28, 0]]);
      vib(s.os, t + 0.03, 11, 18 * p, 0.26);
    } },
    clink: { rev: 0.22, f: function (o, t, p) {
      var f0 = 2050 * p * rnd(0.97, 1.03);
      ceramic(o, t, f0, 1, 1);
      if (Math.random() < 0.55) ceramic(o, t + rnd(0.035, 0.06), f0 * rnd(0.97, 1.02), 0.35, 0.7);
    } },
    glassTing: { rev: 0.35, f: function (o, t, p) {
      var f0 = 3150 * p * rnd(0.98, 1.02);
      partials(o, t, f0, [[1, 0.12, 1.0], [1.0035, 0.06, 0.95], [2.71, 0.035, 0.4], [5.08, 0.01, 0.15], [0.5, 0.02, 0.3]]);
      nz(o, t, { w: 1, f: 6000, q: 3, a: 0.0006, d: 0.006, v: 0.18 });
    } },
    pickup: { rev: 0.1, f: function (o, t, p) {
      nz(o, t, { f: 600 * p, q: 0.9, fc: [[0.06, 1500 * p], [0.16, 800 * p]], a: 0.03, d: 0.12, v: 0.22 });
      ceramic(o, t + 0.005, 1700 * p, 0.32, 0.6);
    } },
    clothThud: { rev: 0.05, f: function (o, t, p) {
      nz(o, t, { type: 'lowpass', f: 520 * p, f1: 220, a: 0.003, d: 0.1, v: 0.6 });
      tone(o, t, { f: 130 * p, f1: 85 * p, a: 0.002, d: 0.09, v: 0.35 });
      nz(o, t, { f: 1400 * p, q: 0.8, a: 0.002, d: 0.03, v: 0.1 });
      partials(o, t + 0.003, 1500 * p, [[1, 0.025, 0.04], [2.3, 0.01, 0.025]]);
    } },
    // きゅっ — ぬれた陶器をふきんでこする。スティックスリップの鋸歯 + 摩擦ノイズ + 共鳴
    squeak: { rev: 0.1, f: function (o, t, p) {
      var f0 = 760 * p * rnd(0.95, 1.05);
      var dur = clamp(rnd(0.085, 0.13) * (p < 1 ? 1 + (1 - p) * 0.35 : 1 - (p - 1) * 0.08), 0.08, 0.145);
      var up = rnd(1.2, 1.34), dip = rnd(0.95, 0.99), pk = rnd(0.5, 0.7);
      var out = filt(o, 'lowpass', Math.min(5200, f0 * 5.5), 0.6);
      var res = filt(out, 'peaking', f0 * 2.05, 2.2, 6);
      // 引っかかり（スティックスリップ）の粗さ: 振幅のゆれ
      var am = ctx.createGain(); am.gain.value = 0.72; am.connect(res); V.nodes.push(am);
      var al = ctx.createOscillator(), ag = ctx.createGain();
      al.type = 'triangle'; al.frequency.value = rnd(22, 34); ag.gain.value = 0.28;
      al.connect(ag); ag.connect(am.gain); al.start(t); al.stop(t + dur + 0.05); track(al, t + dur + 0.05, [ag]);
      var fp = [[0, f0 * 0.8], [dur * pk, f0 * up], [dur, f0 * up * dip]];
      var gp = [[0.012, 0.17], [dur * 0.72, 0.15], [dur, 0]];
      var a = sweep(am, t, 'sawtooth', fp, gp);
      var b = sweep(am, t, 'sine', fp, [[0.01, 0.13], [dur * 0.72, 0.11], [dur, 0]]);
      var jr = rnd(30, 45), jd = f0 * rnd(0.015, 0.03);
      vib(a.os, t, jr, jd, dur, true);
      vib(b.os, t, jr, jd, dur, true);
      // 摩擦のざらつき
      nz(o, t, { type: 'bandpass', f: 2300 * Math.sqrt(p), q: 1.1, fc: [[dur, 2900 * Math.sqrt(p)]], a: 0.006, d: dur, v: 0.16 });
      nz(o, t, { w: 1, f: 3600, q: 1.8, a: 0.0008, d: 0.012, v: 0.08 });
      // 器の小さな鳴り
      tone(o, t + dur * 0.4, { f: f0 * up * 2.6, a: 0.004, d: 0.07, v: 0.012 });
    } },
    dropDodge: { rev: 0.14, f: function (o, t, p) {
      var f0 = 620 * p * rnd(0.95, 1.05);
      var lp = filt(o, 'lowpass', 3500, 0.7);
      var s = sweep(lp, t, 'triangle', [[0, f0], [0.05, f0 * 1.25], [0.2, f0 * 2.7]], [[0.015, 0.16], [0.16, 0.13], [0.24, 0]]);
      vib(s.os, t, 13, f0 * 0.06, 0.22, true);
      sweep(o, t, 'sine', [[0, f0 * 2], [0.2, f0 * 5.4]], [[0.015, 0.025], [0.16, 0.02], [0.24, 0]]);
      nz(o, t, { f: 1500 * p, q: 1, fc: [[0.2, 4000 * p]], a: 0.01, d: 0.15, v: 0.06 });
    } },
    dropCatch: { rev: 0.12, f: function (o, t, p) {
      sweep(o, t, 'sine', [[0, 380 * p], [0.03, 980 * p], [0.06, 820 * p]], [[0.003, 0.3], [0.03, 0.2], [0.075, 0]]);
      nz(o, t, { type: 'lowpass', f: 1600 * p, a: 0.001, d: 0.03, v: 0.25 });
      nz(o, t + 0.02, { buf: bufC, type: 'bandpass', f: 2600, a: 0.002, d: 0.04, v: 0.35 });
      tone(o, t + 0.03, { f: 1500 * p, a: 0.002, d: 0.035, v: 0.05 });
    } },
    kira: { rev: 0.45, f: function (o, t, p) {
      var ns = ['C6', 'E6', 'G6', 'C7'];
      for (var i = 0; i < ns.length; i++) mbox(o, t + i * 0.055, hz(ns[i]) * p, 0.085 - i * 0.008, 0.5 + i * 0.25);
      var top = hz('E7') * p;
      var s = tone(o, t + 0.2, { f: top * 0.985, f1: top, ft: 0.08, a: 0.006, d: 1.3, v: 0.035 });
      vib(s, t + 0.2, 6.5, top * 0.004, 1.3);
      tone(o, t + 0.2, { f: top * 1.5, a: 0.006, d: 0.7, v: 0.008, det: 7 });
      nz(o, t + 0.12, { w: 1, type: 'highpass', f: 6500, a: 0.08, d: 0.55, v: 0.035 });
      for (var j = 0; j < 4; j++) tone(o, t + 0.3 + j * rnd(0.09, 0.14), { f: rnd(3600, 4600) * p, a: 0.001, d: 0.15, v: 0.015 });
    } },
    kiraSoft: { rev: 0.35, f: function (o, t, p) {
      var f = hz('G6') * p;
      mbox(o, t, f, 0.06, 0.4);
      tone(o, t + 0.04, { f: f * 1.5, a: 0.002, d: 0.18, v: 0.012 });
    } },
    sparkle: { rev: 0.35, f: function (o, t, p) {
      var f = rnd(3300, 3900) * p;
      tone(o, t, { f: f, a: 0.001, d: 0.14, v: 0.045 });
      tone(o, t, { f: f * 1.42, a: 0.001, d: 0.06, v: 0.015 });
    } },
    koton: { rev: 0.16, f: function (o, t, p) {
      tone(o, t, { f: 210 * p, f1: 170 * p, a: 0.002, d: 0.13, v: 0.5 });
      partials(o, t, 540 * p, [[1, 0.2, 0.08], [2.42, 0.07, 0.045], [3.9, 0.025, 0.025]]);
      nz(o, t, { type: 'lowpass', f: 1300 * p, a: 0.001, d: 0.03, v: 0.45 });
      ceramic(o, t + 0.002, 1900 * p, 0.25, 0.7);
      if (Math.random() < 0.5) tone(o, t + 0.07, { f: 200 * p, a: 0.002, d: 0.05, v: 0.1 });
    } },
    whoosh: { rev: 0.06, f: function (o, t, p) {
      nz(o, t, { f: 450 * p, q: 1.1, fc: [[0.09, 1500 * p], [0.28, 650 * p]], a: 0.07, d: 0.22, v: 0.32 });
      nz(o, t, { type: 'lowpass', f: 300 * p, a: 0.06, d: 0.2, v: 0.15 });
    } },
    lampClick: { rev: 0.12, f: function (o, t, p) {
      nz(o, t, { w: 1, f: 3200 * p, q: 3, a: 0.0008, d: 0.012, v: 0.45 });
      tone(o, t, { f: 1800 * p, a: 0.001, d: 0.02, v: 0.06 });
      tone(o, t, { f: 260 * p, f1: 200 * p, a: 0.001, d: 0.03, v: 0.1 });
      nz(o, t + 0.05, { w: 1, f: 2800 * p, q: 3, a: 0.0008, d: 0.01, v: 0.16 });
    } },
    lampOn: { rev: 0.45, f: function (o, t, p) {
      var lp = filt(o, 'lowpass', 2200, 0.6);
      var ch = ['C4', 'E4', 'G4', 'C5', 'E5'];
      for (var i = 0; i < ch.length; i++) {
        tone(lp, t + i * 0.035, { f: hz(ch[i]) * p, type: 'triangle', a: 0.22 + i * 0.04, d: 1.3, v: 0.06 });
        tone(lp, t + i * 0.035, { f: hz(ch[i]) * p, det: 6, a: 0.25, d: 1.1, v: 0.025 });
      }
      nz(o, t, { type: 'lowpass', f: 400, fc: [[0.15, 1100], [0.6, 350]], a: 0.08, d: 0.5, v: 0.12 });
      var sp = ['G6', 'C7', 'E6'];
      for (var j = 0; j < sp.length; j++) mbox(o, t + 0.25 + j * 0.16, hz(sp[j]) * p, 0.022, 0.5);
    } },
    itadaki: { rev: 0.3, f: function (o, t, p) {
      // 手を合わせる「ぱん」
      nz(o, t, { f: 1150, q: 0.9, a: 0.0008, d: 0.06, v: 0.75 });
      nz(o, t, { w: 1, type: 'highpass', f: 2600, a: 0.0006, d: 0.025, v: 0.3 });
      nz(o, t, { type: 'lowpass', f: 450, a: 0.001, d: 0.04, v: 0.35 });
      var s = t + 0.32;
      var ph = [['C5', 0], ['E5', 0.13], ['G5', 0.26], ['A5', 0.45], ['G5', 0.58], ['C6', 0.78]];
      for (var i = 0; i < ph.length; i++) {
        var last = i === ph.length - 1;
        mar(o, s + ph[i][1], hz(ph[i][0]) * p, last ? 0.16 : 0.13, last ? 0.8 : 0.4);
      }
      mbox(o, s + 0.78, hz('C7') * p, 0.03, 0.9);
      mbox(o, s + 0.78, hz('E6') * p, 0.03, 0.9);
      mar(o, s, hz('C4') * p, 0.09, 0.6);
      mar(o, s + 0.78, hz('G3') * p, 0.06, 0.5);
      mar(o, s + 0.78, hz('C4') * p, 0.08, 0.8);
    } },
    paku: { rev: 0.08, f: function (o, t, p) {
      var k = rnd(0.94, 1.08) * p;
      nz(o, t, { type: 'lowpass', f: 1100 * k, a: 0.001, d: 0.018, v: 0.35 });
      sweep(o, t, 'sine', [[0, 300 * k], [0.035, 560 * k]], [[0.004, 0.26], [0.03, 0.16], [0.05, 0]]);
      sweep(o, t + 0.07, 'triangle', [[0, 480 * k], [0.05, 300 * k]], [[0.004, 0.14], [0.06, 0]]);
      nz(o, t + 0.07, { type: 'bandpass', f: 900 * k, q: 1.2, a: 0.002, d: 0.03, v: 0.18 });
      tone(o, t + 0.075, { f: 1250 * k, a: 0.001, d: 0.03, v: 0.03 });
    } },
    gokku: { rev: 0.08, f: function (o, t, p) {
      var lp = filt(o, 'lowpass', 900, 1.2);
      sweep(lp, t, 'triangle', [[0, 210 * p], [0.05, 260 * p], [0.16, 110 * p]], [[0.01, 0.3], [0.08, 0.24], [0.2, 0]]);
      sweep(o, t + 0.04, 'sine', [[0, 300 * p], [0.04, 620 * p]], [[0.004, 0.08], [0.06, 0]]);
      nz(o, t, { type: 'lowpass', f: 380 * p, a: 0.01, d: 0.12, v: 0.25 });
      nz(o, t + 0.05, { buf: bufC, type: 'bandpass', f: 1200, a: 0.004, d: 0.05, v: 0.2 });
    } },
    gochiso: { rev: 0.4, f: function (o, t, p) {
      var ph = [['G5', 0], ['E5', 0.26], ['D5', 0.52], ['C5', 0.86]];
      for (var i = 0; i < ph.length; i++) {
        var last = i === ph.length - 1;
        mar(o, t + ph[i][1], hz(ph[i][0]) * p, last ? 0.13 : 0.12, last ? 1.1 : 0.5);
        mbox(o, t + ph[i][1], hz(ph[i][0]) * 2 * p, last ? 0.03 : 0.022, last ? 1.3 : 0.5);
      }
      mar(o, t, hz('C4') * p, 0.08, 0.7);
      mar(o, t + 0.52, hz('G3') * p, 0.07, 0.6);
      var e = t + 0.86;
      mar(o, e, hz('C3') * p, 0.09, 1.2);
      tone(o, e + 0.02, { f: hz('E4') * p, type: 'triangle', a: 0.12, d: 1.2, v: 0.04 });
      tone(o, e + 0.02, { f: hz('G4') * p, type: 'triangle', a: 0.12, d: 1.2, v: 0.035 });
    } },
    hint: { rev: 0.3, f: function (o, t, p) {
      mbox(o, t, hz('G5') * p, 0.08, 0.55);
      mbox(o, t + 0.16, hz('C6') * p, 0.07, 0.75);
    } }
  };

  function play(name, opts) {
    try {
      if (!ready()) return;
      if (!Object.prototype.hasOwnProperty.call(SFX, name)) return;
      var S = SFX[name];
      opts = opts || {};
      var now = ctx.currentTime;
      var t = now + 0.005 + clamp(num(opts.delay, 0), 0, 10);
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

  // ---- 持続音・環境音の部品（まとめて止める） ----
  function hold() { return { srcs: [], nodes: [] }; }
  function npart(h, dst, buf, rate, type, f, q, lvl) {
    var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    var fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    var g = ctx.createGain(); g.gain.value = lvl;
    s.connect(fl); fl.connect(g); g.connect(dst);
    s.start(ctx.currentTime, Math.random() * (buf.duration - 0.5));
    h.srcs.push(s); h.nodes.push(fl, g);
    return { s: s, f: fl, g: g };
  }
  function opart(h, dst, type, f, lvl) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = lvl;
    o.connect(g); g.connect(dst); o.start(ctx.currentTime);
    h.srcs.push(o); h.nodes.push(g);
    return { o: o, g: g };
  }
  function slfo(h, type, freq, depth, param) {
    var l = ctx.createOscillator(), g = ctx.createGain();
    l.type = type; l.frequency.value = freq; g.gain.value = depth;
    l.connect(g); g.connect(param); l.start(ctx.currentTime);
    h.srcs.push(l); h.nodes.push(g);
    return { o: l, g: g };
  }
  function killHold(h, at) {
    var nodes = h.nodes;
    for (var i = 0; i < h.srcs.length; i++) stopAt(h.srcs[i], at);
    dying.push({ nodes: nodes, at: at + 0.2 });
  }
  function setT(param, v, tc) {
    try { param.setTargetAtTime(v, ctx.currentTime, tc); } catch (e) { /* 無視 */ }
  }

  // 持続音: b(h, out) で作り、set(h, lv) で level に応じて音色を変える
  var LOOPDEF = {
    water: { max: 0.5, b: function (h, out) {
      h.hiss = npart(h, out, bufW, 1, 'bandpass', 2600, 0.45, 0.5);
      npart(h, out, bufW, 1, 'highpass', 5500, 0.6, 0.06);
      h.body = npart(h, out, bufP, 0.9, 'lowpass', 700, 0.7, 0.55);
      var gb = npart(h, out, bufP, 0.7, 'bandpass', 320, 4, 0.9);       // ぼこぼこ
      slfo(h, 'sine', 2.3, 120, gb.f.frequency);
      slfo(h, 'sine', 3.7, 80, gb.f.frequency);
      slfo(h, 'triangle', 5.1, 0.45, gb.g.gain);
      var sp = npart(h, out, bufC, 1, 'bandpass', 1800, 0.8, 0.5);       // しぶきの粒
      h.sp = sp;
    }, set: function (h, lv) {
      setT(h.hiss.f.frequency, 1500 + 2200 * lv, 0.03);
      setT(h.body.f.frequency, 400 + 700 * lv, 0.03);
      setT(h.sp.g.gain, 0.2 + 0.5 * lv, 0.03);
    } },
    rub: { max: 0.32, b: function (h, out) {
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500; hp.connect(out); h.nodes.push(hp);
      var am = ctx.createGain(); am.gain.value = 0.5; am.connect(hp); h.nodes.push(am);
      h.a = npart(h, am, bufP, 1.05, 'bandpass', 1900, 0.6, 0.9);
      npart(h, am, bufW, 1, 'bandpass', 4200, 0.9, 0.12);
      h.lfo = slfo(h, 'sine', 4, 0.48, am.gain);
      slfo(h, 'sine', 0.9, 350, h.a.f.frequency);
    }, set: function (h, lv) {
      setT(h.lfo.o.frequency, 2.5 + 5.5 * lv, 0.05);
      setT(h.a.f.frequency, 1500 + 900 * lv, 0.05);
    } },
    fizz: { max: 0.3, b: function (h, out) {
      h.c = npart(h, out, bufC, 1, 'bandpass', 3400, 0.7, 0.9);
      npart(h, out, bufC, 0.73, 'highpass', 5000, 0.7, 0.35);
      npart(h, out, bufW, 1, 'highpass', 7000, 0.7, 0.025);
    }, set: function (h, lv) {
      setT(h.c.s.playbackRate, 0.8 + 0.4 * lv, 0.05);
    } }
  };
  var loops = {};

  function loop(name, level) {
    try {
      if (!ctx || dead) return;
      if (!Object.prototype.hasOwnProperty.call(LOOPDEF, name)) return;
      var lv = clamp(num(level, 0), 0, 1);
      var L = loops[name];
      if (!L) {
        if (!(lv > 0)) return;                    // 鳴らす時に初めて作る
        var D = LOOPDEF[name];
        var g = ctx.createGain(); g.gain.value = 0; g.connect(loopBus);
        var h = hold(); h.nodes.push(g); D.b(h, g);
        L = loops[name] = { g: g, h: h, d: D, max: D.max, lv: -1, zeroAt: 0 };
      }
      if (Math.abs(lv - L.lv) < 0.01) return;
      if (lv === 0) L.zeroAt = ctx.currentTime;
      L.lv = lv;
      setT(L.g.gain, Math.pow(lv, 0.8) * L.max, 0.02);
      if (L.d.set && lv > 0) L.d.set(L.h, lv);
    } catch (e) { /* 無視 */ }
  }

  function loopTick(now) {
    for (var k in loops) {
      if (!Object.prototype.hasOwnProperty.call(loops, k)) continue;
      var L = loops[k];
      if (L.lv === 0 && now - L.zeroAt > 1.2) {   // しばらく無音なら処理を止める
        killHold(L.h, now + 0.02);
        delete loops[k];
      }
    }
  }

  // ---- 環境音 ----
  // ev: 時々起こる小さな出来事 {rate(回/秒), f(dst, t) → 長さ}
  function evCar(dst, t) {
    var len = rnd(3, 5);
    nz(dst, t, { type: 'bandpass', f: 260, q: 0.7, fc: [[len * 0.5, 520], [len, 240]], a: len * 0.5, d: len * 0.5, v: 0.05 });
    return len;
  }
  function evChime(dst, t) {
    var sets = [['G4', 'A4', 'C5', 'A4'], ['C5', 'A4', 'G4', 'E4'], ['E4', 'G4', 'A4', 'G4']];
    var ph = sets[Math.floor(Math.random() * sets.length)], lp = filt(dst, 'lowpass', 1600, 0.5);
    for (var i = 0; i < ph.length; i++) {
      var f = hz(ph[i]), tt = t + i * 0.62;
      tone(lp, tt, { f: f, a: 0.01, d: 1.4, v: 0.022 });
      tone(lp, tt, { f: f * 2.01, a: 0.01, d: 0.6, v: 0.005 });
    }
    return ph.length * 0.62 + 1.4;
  }
  function evDish(dst, t) {
    var d2 = panTo(dst, rnd(-0.6, 0.6)), n = Math.random() < 0.6 ? 1 : 2, tt = t;
    for (var i = 0; i < n; i++) {
      ceramic(d2, tt, rnd(1700, 2700), rnd(0.05, 0.1), 0.8);
      tt += rnd(0.08, 0.2);
    }
    if (Math.random() < 0.3) tone(d2, tt, { f: rnd(400, 520), a: 0.002, d: 0.08, v: 0.02 });  // 箸を置く木の音
    return tt - t + 0.2;
  }

  var AMB = {
    kitchen: { air: 1, fridge: 1, out: 1, ev: { rate: 1 / 22, f: evCar } },
    dusk: { air: 0.6, fridge: 0.8, out: 0.5, ev: { rate: 1 / 30, f: evChime }, rev: 0.5 },
    dinner: { air: 0.8, fridge: 0.5, out: 0.3, ev: { rate: 1 / 6, f: evDish }, rev: 0.25 },
    none: null
  };
  var curAmb = null, curAmbName = null;

  function makeScene(cfg) {
    var h = hold();
    var g = ctx.createGain(); g.gain.value = 0.0001; g.connect(ambBus); h.nodes.push(g);
    h.g = g; h.cfg = cfg; h.next = 0; h.alive = true;
    if (cfg.air) npart(h, g, bufP, 0.8, 'bandpass', 220, 0.4, 0.06 * cfg.air);
    if (cfg.fridge) {
      var hum = ctx.createBiquadFilter(); hum.type = 'lowpass'; hum.frequency.value = 400; hum.connect(g); h.nodes.push(hum);
      var hg = ctx.createGain(); hg.gain.value = cfg.fridge; hg.connect(hum); h.nodes.push(hg);
      opart(h, hg, 'sine', 100, 0.012);
      opart(h, hg, 'sine', 150.4, 0.006);
      opart(h, hg, 'triangle', 200.2, 0.003);
      npart(h, hg, bufP, 0.6, 'lowpass', 160, 0.7, 0.05);
      slfo(h, 'sine', 0.07, 0.25, hg.gain);
    }
    if (cfg.out) {
      var a = npart(h, g, bufP, 0.7, 'bandpass', 600, 0.5, 0.018 * cfg.out);
      slfo(h, 'sine', 0.05, 0.008 * cfg.out, a.g.gain);
    }
    var eg = ctx.createGain(); eg.gain.value = 1; eg.connect(g); h.nodes.push(eg); h.eg = eg;
    if (cfg.rev) { var s = ctx.createGain(); s.gain.value = cfg.rev; eg.connect(s); s.connect(revIn); h.nodes.push(s); }
    return h;
  }

  function killScene(h, sec) {
    h.alive = false;
    var now = ctx.currentTime;
    try {
      h.g.gain.cancelScheduledValues(now);
      h.g.gain.setValueAtTime(Math.max(h.g.gain.value, 0.0001), now);
      h.g.gain.linearRampToValueAtTime(0, now + sec);
    } catch (e) { /* 無視 */ }
    killHold(h, now + sec + 0.1);
  }

  function amb(name, sec) {
    try {
      if (!Object.prototype.hasOwnProperty.call(AMB, name)) return;
      sec = clamp(num(sec, 1.5), 0.05, 30);
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
      h.next = now + rnd(2, 6);
      curAmb = h;
    } catch (e) { /* 無視 */ }
  }

  function ambTick(now) {
    var h = curAmb;
    if (!h || !h.alive || !h.cfg.ev) return;
    var ev = h.cfg.ev, guard = 0;
    if (h.next < now - 0.1) h.next = now + rnd(0.5, 2) / Math.max(ev.rate * 10, 0.2);  // 止まっていた分は鳴らさない
    while (h.next < now + 0.4 && guard++ < 2) {
      var t = h.next, len = 1;
      withV(function () { len = ev.f(h.eg, t) || 1; });
      h.next = t + len + 0.3 + (-Math.log(1 - Math.random() * 0.98)) / ev.rate;
    }
  }

  // ---- 音楽（先読みスケジューラ） ----
  // mel: 'C5:2' = 音名:長さ(ステップ)  '-:2' = 休み。chords: 小節ごと {b:[根音,5度], c:[和音3つ]}
  var MUSDEF = {
    dinner: {
      bpm: 92, spb: 2, bpb: 4,
      mel: ['C5:2', 'E5:2', 'G5:2', 'E5:2', 'A5:3', 'G5:1', 'F5:2', 'A5:2',
        'G5:2', 'E5:2', 'D5:2', 'E5:1', 'F5:1', 'E5:4', 'C5:2', '-:2',
        'A5:2', 'C6:2', 'B5:2', 'A5:2', 'G5:2', 'F5:2', 'E5:2', 'D5:2',
        'E5:2', 'G5:2', 'F5:2', 'D5:2', 'C5:6', '-:2'],
      chords: [
        { b: ['C3', 'G3'], c: ['E4', 'G4', 'C5'] }, { b: ['F3', 'C3'], c: ['F4', 'A4', 'C5'] },
        { b: ['G3', 'D3'], c: ['D4', 'G4', 'B4'] }, { b: ['C3', 'G3'], c: ['E4', 'G4', 'C5'] },
        { b: ['A2', 'E3'], c: ['E4', 'A4', 'C5'] }, { b: ['F3', 'C3'], c: ['F4', 'A4', 'C5'] },
        { b: ['G3', 'D3'], c: ['D4', 'F4', 'B4'] }, { b: ['C3', 'G3'], c: ['E4', 'G4', 'C5'] }],
      acc: function (ev, base, ch) {
        ev[base].push(['bass', hz(ch.b[0]), 4]);
        ev[base + 4].push(['bass', hz(ch.b[1]), 4]);
        ev[base + 2].push(['chord', ch.c]);
        ev[base + 6].push(['chord', ch.c]);
      },
      play: function (o, t, e, sd, firstOfBar) {
        if (e[0] === 'mel') {
          mar(o, t, e[1], 0.15, 0.32 + e[2] * sd * 0.5);
          if (firstOfBar) mbox(o, t, e[1] * 2, 0.025, 0.7);
        } else if (e[0] === 'bass') mar(o, t, e[1], 0.12, 0.7);
        else for (var i = 0; i < 3; i++) mar(o, t + i * 0.008, hz(e[1][i]), 0.035, 0.3);
      }
    },
    night: {
      bpm: 66, spb: 2, bpb: 3,
      mel: ['C5:4', 'A4:2', 'C5:2', 'D5:2', 'C5:2', 'D5:4', 'F5:2', 'C5:6',
        'A4:4', 'D5:2', 'G4:2', 'A4:2', 'Bb4:2', 'G4:4', 'E4:2', 'F4:6'],
      chords: [
        { b: ['F3'], c: ['A3', 'C4', 'F4'] }, { b: ['F3'], c: ['A3', 'C4', 'F4'] },
        { b: ['Bb2'], c: ['F3', 'Bb3', 'D4'] }, { b: ['F3'], c: ['A3', 'C4', 'F4'] },
        { b: ['D3'], c: ['A3', 'D4', 'F4'] }, { b: ['G3'], c: ['Bb3', 'D4', 'G4'] },
        { b: ['C3'], c: ['G3', 'C4', 'E4'] }, { b: ['F3'], c: ['A3', 'C4', 'F4'] }],
      acc: function (ev, base, ch) {
        ev[base].push(['bass', hz(ch.b[0])]);
        ev[base + 2].push(['arp', hz(ch.c[0])]);
        ev[base + 3].push(['arp', hz(ch.c[1])]);
        ev[base + 4].push(['arp', hz(ch.c[2])]);
        ev[base + 5].push(['arp', hz(ch.c[1])]);
      },
      play: function (o, t, e, sd) {
        if (e[0] === 'mel') mbox(o, t + Math.random() * 0.01, e[1], 0.12, 1.1 + e[2] * sd * 0.4);
        else if (e[0] === 'bass') mbox(o, t, e[1], 0.08, 2.2);
        else mbox(o, t + Math.random() * 0.01, e[1], 0.035, 1.0);
      }
    }
  };

  function compile(def) {
    if (def.ev) return def;
    var spBar = def.bpb * def.spb, steps = spBar * def.chords.length, ev = [], i, s = 0;
    for (i = 0; i < steps; i++) ev.push([]);
    for (i = 0; i < def.mel.length; i++) {
      var tk = def.mel[i].split(':'), len = parseInt(tk[1], 10) || 1;
      if (tk[0] !== '-' && s < steps) ev[s].push(['mel', hz(tk[0]), len]);
      s += len;
    }
    for (i = 0; i < def.chords.length; i++) def.acc(ev, i * spBar, def.chords[i]);
    def.ev = ev; def.steps = steps; def.spBar = spBar; def.sd = 60 / def.bpm / def.spb;
    return def;
  }

  var curTrack = null, curTrackName = null;

  function music(name) {
    try {
      if (!Object.prototype.hasOwnProperty.call(MUSDEF, name) || dead) return;
      if (!ctx) { pendMus = name; return; }
      if (curTrack && curTrackName === name) return;   // 同じ曲は鳴り直さない
      if (curTrack) fadeTrack(curTrack, 0.6);
      var def = compile(MUSDEF[name]), now = ctx.currentTime;
      var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(1, now + 0.8);
      g.connect(musBus);
      var s = ctx.createGain(); s.gain.value = 0.35; g.connect(s); s.connect(revIn);
      curTrack = { def: def, g: g, nodes: [g, s], srcs: [], step: 0, t: now + 0.1 };
      curTrackName = name;
    } catch (e) { /* 無視 */ }
  }

  function fadeTrack(tr, sec) {
    var now = ctx.currentTime;
    try {
      tr.g.gain.cancelScheduledValues(now);
      tr.g.gain.setValueAtTime(Math.max(tr.g.gain.value, 0.0001), now);
      tr.g.gain.linearRampToValueAtTime(0, now + sec);
    } catch (e) { /* 無視 */ }
    for (var i = 0; i < tr.srcs.length; i++) stopAt(tr.srcs[i].s, now + sec + 0.05);
    dying.push({ nodes: tr.nodes, at: now + sec + 0.3 });
    tr.dead = true;
  }

  function stopMusic(sec) {
    try {
      pendMus = null;
      if (!ctx || !curTrack) return;
      fadeTrack(curTrack, clamp(num(sec, 1), 0.02, 30));
      curTrack = null; curTrackName = null;
    } catch (e) { /* 無視 */ }
  }

  function musTick(now) {
    var tr = curTrack;
    if (!tr || tr.dead) return;
    var d = tr.def, guard = 0;
    if (tr.t < now - 0.05) tr.t = now + 0.05;          // 止まっていた分は鳴らさず続きから
    while (tr.t < now + 0.3 && guard++ < 12) {
      var list = d.ev[tr.step], t = tr.t, first = (tr.step % d.spBar) === 0;
      if (list.length) {
        var made = withV(function () {
          for (var i = 0; i < list.length; i++) d.play(tr.g, t, list[i], d.sd, first);
        });
        for (var j = 0; j < made.length; j++) tr.srcs.push(made[j]);
      }
      tr.step = (tr.step + 1) % d.steps;
      tr.t += d.sd;
    }
    if (tr.srcs.length > 60) {
      var live = [];
      for (var k = 0; k < tr.srcs.length; k++) if (tr.srcs[k].end > now) live.push(tr.srcs[k]);
      tr.srcs = live;
    }
  }

  function cleanTick(now) {
    if (!dying.length) return;
    var keep = [];
    for (var i = 0; i < dying.length; i++) {
      if (dying[i].at <= now) for (var j = 0; j < dying[i].nodes.length; j++) disc(dying[i].nodes[j]);
      else keep.push(dying[i]);
    }
    dying = keep;
  }

  function tick() {
    try {
      if (!ready()) return;
      var now = ctx.currentTime;
      try { ambTick(now); } catch (e) { /* 無視 */ }
      try { musTick(now); } catch (e) { /* 無視 */ }
      try { loopTick(now); } catch (e) { /* 無視 */ }
      try { cleanTick(now); } catch (e) { /* 無視 */ }
    } catch (e) { /* 無視 */ }
  }

  function hookUpdate() {
    if (hooked) return;
    try {
      if (typeof G.onUpdate === 'function') { G.onUpdate(function () { tick(); }); hooked = true; }
    } catch (e) { /* 無視 */ }
  }

  // ---- 公開 ----
  G.audio = {
    unlock: function () {
      try {
        if (dead) return;
        if (!ctx) { init(); if (!ctx) return; }
        hookUpdate();
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
