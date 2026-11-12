/* audio.js — にぎにぎ！ママとおなじおにぎり : すべて Web Audio の合成（音ファイルなし）
 * G.Audio.unlock / suspend / resume / play(name, {vol, pitch, pan, delay})
 * G.Audio.squeezeStart / squeezeSet(p) / squeezeEnd
 * G.Audio.ambience(on) / music(on)
 * コンテキストが無い・止まっている時は全メソッドが何もしない（例外を出さない）。
 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});

  var ctx = null;          // AudioContext
  var failed = false;      // 生成できなかった
  var userSuspended = false;
  var bus = null;          // {master, sfx, music, amb}
  var noiseBuf = null;     // 共有ホワイトノイズ (2s)
  var brownBuf = null;     // 共有ブラウンノイズ (4s, ループ用)
  var schedHooked = false;
  var lastResumeTry = 0;

  // ---------- 小物 ----------
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return ctx ? ctx.currentTime : 0; }

  function running() {
    if (!ctx || failed) return false;
    if (ctx.state === 'running') return true;
    // iOS の interrupted / 予期しない suspended からの復帰を控えめに試す
    if (!userSuspended && ctx.state !== 'closed') {
      var t = Date.now();
      if (t - lastResumeTry > 1000) {
        lastResumeTry = t;
        try { var pr = ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
      }
    }
    return false;
  }

  // ---------- コンテキストとマスター ----------
  function createContext() {
    if (ctx || failed) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { failed = true; return; }
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    } catch (e) { ctx = null; failed = true; return; }
    try { buildGraph(); } catch (e) { failed = true; ctx = null; }
  }

  function buildGraph() {
    var master = ctx.createGain();
    master.gain.value = 0.55;            // 全体は控えめ
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3.5;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.12;
    // 耳に痛い超高域を少し落とす
    var shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf'; shelf.frequency.value = 7000; shelf.gain.value = -4;
    master.connect(shelf); shelf.connect(comp); comp.connect(lim); lim.connect(ctx.destination);

    var sfx = ctx.createGain(); sfx.gain.value = 1; sfx.connect(master);
    var music = ctx.createGain(); music.gain.value = 0; music.connect(master);
    var amb = ctx.createGain(); amb.gain.value = 0; amb.connect(master);
    bus = { master: master, sfx: sfx, music: music, amb: amb };

    var sr = ctx.sampleRate, i, n;
    n = Math.floor(sr * 2);
    noiseBuf = ctx.createBuffer(1, n, sr);
    var d = noiseBuf.getChannelData(0);
    for (i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    n = Math.floor(sr * 4);
    brownBuf = ctx.createBuffer(1, n, sr);
    d = brownBuf.getChannelData(0);
    var last = 0;
    for (i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    // ループの継ぎ目をなめらかに
    var fade = Math.floor(sr * 0.05);
    for (i = 0; i < fade; i++) {
      var k = i / fade;
      d[n - fade + i] = d[n - fade + i] * (1 - k) + d[i] * k;
    }
  }

  // ---------- 合成の部品 ----------
  // 減衰エンベロープ: 0 → peak (a 秒) → ほぼ0 (d 秒)
  function env(param, t, a, peak, d) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
    param.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, a) + Math.max(0.005, d));
  }

  // ノイズ一発: o = {t, a, d, g, type, f, f2, q, dest}
  function noise(o) {
    var t = o.t, a = o.a || 0.003, d = o.d || 0.1, end = t + a + d + 0.03;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    if (o.rate) src.playbackRate.value = o.rate;
    var f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(clamp(o.f || 1000, 20, 18000), t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(clamp(o.f2, 20, 18000), t + (o.ft || (a + d)));
    f.Q.value = o.q != null ? o.q : 0.8;
    var g = ctx.createGain();
    env(g.gain, t, a, o.g || 0.2, d);
    src.connect(f); f.connect(g); g.connect(o.dest);
    src.start(t, rnd(0, 1.9 - Math.min(1.8, a + d)), a + d + 0.03);
    src.stop(end);
    return g;
  }

  // 音程一発: o = {t, f, f2, ft, type, a, d, g, dest}
  function tone(o) {
    var t = o.t, a = o.a || 0.004, d = o.d || 0.2;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(clamp(o.f, 20, 18000), t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(clamp(o.f2, 20, 18000), t + (o.ft || (a + d)));
    var g = ctx.createGain();
    env(g.gain, t, a, o.g || 0.1, d);
    osc.connect(g);
    if (o.lp) {
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.5;
      g.connect(f); f.connect(o.dest);
    } else g.connect(o.dest);
    osc.start(t); osc.stop(t + a + d + 0.05);
    return osc;
  }

  // カリンバ/鉄琴風の1音
  function kal(t, f, g, d, dest, bright) {
    d = d || 1.2;
    tone({ t: t, f: f, a: 0.003, d: d, g: g, dest: dest });
    tone({ t: t, f: f * 2.0, a: 0.002, d: d * 0.35, g: g * 0.12, dest: dest });
    tone({ t: t, f: f * (bright ? 4.2 : 5.93), a: 0.001, d: 0.07, g: g * (bright ? 0.22 : 0.16), dest: dest });
    noise({ t: t, a: 0.001, d: 0.012, g: g * 0.25, type: 'bandpass', f: Math.min(9000, f * 3), q: 1.5, dest: dest });
  }

  // ---------- 効果音 ----------
  // 各関数: (t, p=pitch, out)
  var NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5, D6: 1174.66, E6: 1318.5, G6: 1567.98 };

  var V = {
    tap: function (t, p, o) {
      noise({ t: t, a: 0.002, d: 0.035, g: 0.22, type: 'bandpass', f: 1600 * p, q: 0.9, dest: o });
      tone({ t: t, f: 230 * p, f2: 150 * p, a: 0.002, d: 0.05, g: 0.16, dest: o });
    },
    button: function (t, p, o) {
      noise({ t: t, a: 0.001, d: 0.012, g: 0.32, type: 'highpass', f: 2600 * p, q: 0.7, dest: o });
      tone({ t: t, f: 190 * p, f2: 140 * p, a: 0.001, d: 0.04, g: 0.2, dest: o });
      noise({ t: t + 0.03, a: 0.001, d: 0.01, g: 0.16, type: 'bandpass', f: 3200 * p, q: 1, dest: o });
      tone({ t: t + 0.07, f: 1320 * p, a: 0.006, d: 0.14, g: 0.05, dest: o });
      tone({ t: t + 0.07, f: 2640 * p, a: 0.004, d: 0.05, g: 0.01, dest: o });
    },
    lidOpen: function (t, p, o) {
      noise({ t: t, a: 0.001, d: 0.018, g: 0.3, type: 'bandpass', f: 2400 * p, q: 1.2, dest: o });
      tone({ t: t, f: 330 * p, f2: 210 * p, a: 0.001, d: 0.06, g: 0.16, dest: o });
      noise({ t: t + 0.05, a: 0.001, d: 0.03, g: 0.14, type: 'bandpass', f: 1300 * p, q: 1.5, dest: o });
      // 空気の ふわっ
      noise({ t: t + 0.06, a: 0.14, d: 0.45, g: 0.11, type: 'bandpass', f: 500 * p, f2: 1600 * p, q: 0.6, dest: o });
    },
    lidClose: function (t, p, o) {
      noise({ t: t, a: 0.002, d: 0.025, g: 0.12, type: 'bandpass', f: 1100 * p, q: 0.8, dest: o });
      noise({ t: t + 0.03, a: 0.001, d: 0.08, g: 0.38, type: 'lowpass', f: 1000 * p, q: 0.7, dest: o });
      tone({ t: t + 0.03, f: 150 * p, f2: 85 * p, a: 0.001, d: 0.13, g: 0.34, dest: o });
      noise({ t: t + 0.035, a: 0.001, d: 0.012, g: 0.12, type: 'bandpass', f: 2800 * p, q: 1, dest: o });
    },
    steam: function (t, p, o) {
      noise({ t: t, a: 0.18, d: 0.95, g: 0.1, type: 'bandpass', f: 4200 * p, f2: 2300 * p, q: 0.5, dest: o });
      noise({ t: t, a: 0.25, d: 0.7, g: 0.05, type: 'lowpass', f: 900 * p, q: 0.5, dest: o });
    },
    scoop: function (t, p, o) {
      noise({ t: t, a: 0.012, d: 0.14, g: 0.3, type: 'lowpass', f: 1400 * p, f2: 450 * p, q: 1.2, dest: o });
      noise({ t: t + 0.045, a: 0.006, d: 0.09, g: 0.2, type: 'bandpass', f: 800 * p, f2: 500 * p, q: 1.5, dest: o });
      for (var i = 0; i < 3; i++) noise({ t: t + 0.02 + i * rnd(0.025, 0.04), a: 0.001, d: 0.012, g: 0.07, type: 'bandpass', f: rnd(1800, 2600) * p, q: 2, dest: o });
      tone({ t: t, f: 130 * p, f2: 95 * p, a: 0.01, d: 0.1, g: 0.1, dest: o });
    },
    plop: function (t, p, o) {
      tone({ t: t, f: 250 * p, f2: 105 * p, ft: 0.08, a: 0.002, d: 0.12, g: 0.3, dest: o });
      noise({ t: t, a: 0.002, d: 0.06, g: 0.24, type: 'lowpass', f: 750 * p, q: 1, dest: o });
    },
    pick: function (t, p, o) {
      noise({ t: t, a: 0.001, d: 0.022, g: 0.16, type: 'bandpass', f: 2600 * p, q: 2, dest: o });
      tone({ t: t, f: 880 * p, f2: 700 * p, a: 0.002, d: 0.04, g: 0.04, dest: o });
    },
    drop: function (t, p, o) {
      tone({ t: t, f: 540 * p, f2: 500 * p, a: 0.001, d: 0.08, g: 0.2, dest: o });
      tone({ t: t, f: 1270 * p, a: 0.001, d: 0.035, g: 0.06, dest: o });
      noise({ t: t, a: 0.001, d: 0.018, g: 0.18, type: 'bandpass', f: 2100 * p, q: 1.4, dest: o });
      tone({ t: t, f: 160 * p, a: 0.001, d: 0.05, g: 0.1, dest: o });
    },
    slide: function (t, p, o) {
      noise({ t: t, a: 0.09, d: 0.55, g: 0.13, type: 'bandpass', f: 330 * p, f2: 520 * p, q: 0.9, dest: o });
      noise({ t: t, a: 0.12, d: 0.45, g: 0.05, type: 'bandpass', f: 1500 * p, f2: 1900 * p, q: 1.2, dest: o });
    },
    tick: function (t, p, o) {
      tone({ t: t, f: 1050 * p, a: 0.001, d: 0.03, g: 0.08, dest: o });
      noise({ t: t, a: 0.001, d: 0.01, g: 0.1, type: 'bandpass', f: 3000 * p, q: 1.5, dest: o });
    },
    squish: function (t, p, o) {
      noise({ t: t, a: 0.035, d: 0.32, g: 0.75, type: 'lowpass', f: 1000 * p, f2: 380 * p, q: 1.6, dest: o });
      noise({ t: t + 0.01, a: 0.03, d: 0.28, g: 0.45, type: 'bandpass', f: 720 * p, f2: 360 * p, q: 3.5, dest: o });
      tone({ t: t, f: 150 * p, f2: 98 * p, a: 0.03, d: 0.26, g: 0.2, dest: o });
      for (var i = 0; i < 4; i++) noise({ t: t + 0.03 + i * rnd(0.04, 0.07), a: 0.001, d: 0.015, g: 0.05, type: 'bandpass', f: rnd(1200, 2000) * p, q: 2.5, dest: o });
    },
    release: function (t, p, o) {
      noise({ t: t, a: 0.04, d: 0.24, g: 0.11, type: 'bandpass', f: 800 * p, f2: 1900 * p, q: 0.7, dest: o });
      tone({ t: t, f: 300 * p, f2: 390 * p, a: 0.03, d: 0.18, g: 0.035, dest: o });
    },
    match: function (t, p, o) {
      kal(t, NOTE.G5 * p, 0.17, 1.3, o);
      kal(t + 0.2, NOTE.D6 * p, 0.15, 1.6, o);
    },
    done: function (t, p, o) {
      // ぽんっ
      tone({ t: t, f: 520 * p, f2: 260 * p, ft: 0.05, a: 0.002, d: 0.08, g: 0.26, dest: o });
      noise({ t: t, a: 0.001, d: 0.03, g: 0.18, type: 'bandpass', f: 1400 * p, q: 1.2, dest: o });
      // 上がる3音
      kal(t + 0.13, NOTE.C6 * p, 0.12, 1.0, o, true);
      kal(t + 0.26, NOTE.E6 * p, 0.11, 1.0, o, true);
      kal(t + 0.39, NOTE.G6 * p, 0.11, 1.4, o, true);
      V.sparkle(t + 0.45, p, o, 0.6);
    },
    sparkle: function (t, p, o, s) {
      s = s || 1;
      var pent = [2093, 2349, 2637, 3136, 3520, 4186];
      var tt = t;
      for (var i = 0; i < 5; i++) {
        var f = pent[(Math.random() * pent.length) | 0] * p;
        tone({ t: tt, f: f, a: 0.002, d: rnd(0.12, 0.25), g: 0.04 * s, dest: o });
        tone({ t: tt, f: f * 2.76, a: 0.001, d: 0.05, g: 0.008 * s, dest: o });
        tt += rnd(0.04, 0.08);
      }
    },
    ping: function (t, p, o) {
      kal(t, NOTE.A5 * p, 0.09, 1.1, o);
    },
    nori: function (t, p, o) {
      var n = 2 + ((Math.random() * 2) | 0), tt = t;
      for (var i = 0; i < n; i++) {
        noise({ t: tt, a: 0.001, d: rnd(0.01, 0.022), g: rnd(0.22, 0.32), type: 'highpass', f: rnd(2200, 3400) * p, q: 0.9, dest: o });
        noise({ t: tt, a: 0.001, d: 0.008, g: 0.1, type: 'bandpass', f: rnd(5000, 7000) * p, q: 2, dest: o });
        tt += rnd(0.025, 0.055);
      }
    },
    plate: function (t, p, o) {
      tone({ t: t, f: 210 * p, a: 0.001, d: 0.05, g: 0.14, dest: o });
      noise({ t: t, a: 0.001, d: 0.015, g: 0.16, type: 'bandpass', f: 3200 * p, q: 1.2, dest: o });
      tone({ t: t, f: 1760 * p, a: 0.001, d: 0.35, g: 0.05, dest: o });
      tone({ t: t, f: 1760 * 2.31 * p, a: 0.001, d: 0.18, g: 0.025, dest: o });
      tone({ t: t, f: 1760 * 3.87 * p, a: 0.001, d: 0.08, g: 0.012, dest: o });
    },
    pop: function (t, p, o) {
      tone({ t: t, f: 600 * p, f2: 1250 * p, ft: 0.03, a: 0.001, d: 0.07, g: 0.22, dest: o });
      noise({ t: t, a: 0.001, d: 0.02, g: 0.14, type: 'bandpass', f: 1800 * p, q: 1.3, dest: o });
      tone({ t: t + 0.03, f: 1800 * p, a: 0.002, d: 0.1, g: 0.025, dest: o });
    },
    munch: function (t, p, o) {
      for (var k = 0; k < 2; k++) {
        var tt = t + k * 0.24;
        noise({ t: tt, a: 0.012, d: 0.11, g: 0.32, type: 'lowpass', f: 620 * p, q: 1.2, dest: o });
        tone({ t: tt, f: 115 * p, f2: 80 * p, a: 0.01, d: 0.1, g: 0.2, dest: o, lp: 400 });
        for (var i = 0; i < 2; i++) noise({ t: tt + 0.01 + i * 0.03, a: 0.001, d: 0.015, g: 0.05, type: 'bandpass', f: rnd(1100, 1600) * p, q: 2, dest: o });
      }
    },
    sour: function (t, p, o) {
      // きゅ〜（上がって震える）
      var osc = ctx.createOscillator(); osc.type = 'triangle';
      var f0 = 380 * p;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 2.3, t + 0.22);
      var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 9;
      var lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.22);
      lg.gain.linearRampToValueAtTime(f0 * 0.12, t + 0.32);
      lfo.connect(lg); lg.connect(osc.frequency);
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800 * p; f.Q.value = 0.7;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.05);
      g.gain.setValueAtTime(0.13, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      osc.connect(f); f.connect(g); g.connect(o);
      osc.start(t); lfo.start(t); osc.stop(t + 0.9); lfo.stop(t + 0.9);
    },
    yum: function (t, p, o) {
      tone({ t: t, f: NOTE.C5 * p, a: 0.02, d: 0.45, g: 0.1, dest: o });
      tone({ t: t, f: NOTE.C5 * 2 * p, a: 0.02, d: 0.2, g: 0.015, dest: o });
      tone({ t: t + 0.2, f: NOTE.G5 * p, a: 0.025, d: 0.7, g: 0.1, dest: o });
      tone({ t: t + 0.2, f: NOTE.G5 * 2 * p, a: 0.02, d: 0.25, g: 0.015, dest: o });
    },
    sip: function (t, p, o) {
      noise({ t: t, a: 0.03, d: 0.17, g: 0.11, type: 'bandpass', f: 1400 * p, f2: 2600 * p, q: 1.8, dest: o });
      noise({ t: t + 0.2, a: 0.03, d: 0.26, g: 0.13, type: 'bandpass', f: 1600 * p, f2: 3000 * p, q: 1.8, dest: o });
      tone({ t: t + 0.5, f: 180 * p, f2: 140 * p, a: 0.01, d: 0.08, g: 0.05, dest: o });
    },
    clap: function (t, p, o) {
      noise({ t: t, a: 0.001, d: 0.06, g: 0.5, type: 'bandpass', f: 1300 * p, q: 0.6, dest: o });
      noise({ t: t + 0.008, a: 0.001, d: 0.04, g: 0.25, type: 'highpass', f: 2500 * p, q: 0.7, dest: o });
      tone({ t: t, f: 190 * p, f2: 95 * p, a: 0.001, d: 0.09, g: 0.28, dest: o });
    },
    whoosh: function (t, p, o) {
      noise({ t: t, a: 0.1, d: 0.22, g: 0.07, type: 'bandpass', f: 450 * p, f2: 1300 * p, ft: 0.15, q: 0.9, dest: o });
    },
    ending: function (t, p, o) {
      var seq = [
        [0.0, NOTE.E5, 0.12], [0.5, NOTE.G5, 0.11], [1.0, NOTE.A5, 0.11], [1.5, NOTE.C6, 0.12],
        [2.05, NOTE.A5, 0.1], [2.55, NOTE.G5, 0.1], [3.1, NOTE.C6, 0.12]
      ];
      for (var i = 0; i < seq.length; i++) kal(t + seq[i][0], seq[i][1] * p, seq[i][2], i === seq.length - 1 ? 2.2 : 1.4, o);
      kal(t + 3.1, NOTE.E5 * p, 0.06, 2.0, o);
      kal(t + 0.0, NOTE.C4 * p, 0.07, 2.0, o);
      kal(t + 2.05, NOTE.A4 / 2 * p, 0.06, 1.8, o);
      kal(t + 3.1, NOTE.C4 * p, 0.07, 2.4, o);
    }
  };

  function voiceOut(vol, pan, t) {
    var g = ctx.createGain();
    g.gain.value = clamp(vol, 0, 2);
    if (pan && ctx.createStereoPanner) {
      try {
        var sp = ctx.createStereoPanner();
        sp.pan.value = clamp(pan, -1, 1);
        g.connect(sp); sp.connect(bus.sfx);
        return g;
      } catch (e) {}
    }
    g.connect(bus.sfx);
    return g;
  }

  function play(name, opts) {
    try {
      if (!running()) return;
      var fn = V[name]; if (!fn) return;
      opts = opts || {};
      var vol = opts.vol != null ? +opts.vol : 1;
      if (!(vol > 0)) return;
      var p = opts.pitch > 0 ? +opts.pitch : 1;
      var t = now() + 0.005 + Math.max(0, +opts.delay || 0);
      fn(t, p, voiceOut(vol, +opts.pan || 0, t));
    } catch (e) {}
  }

  // ---------- 連続音: ぎゅーっ ----------
  var sq = null;
  function squeezeStart() {
    try {
      if (!running()) return;
      if (sq) squeezeEnd();
      var t = now();
      var src = ctx.createBufferSource(); src.buffer = brownBuf; src.loop = true;
      var src2 = ctx.createBufferSource(); src2.buffer = noiseBuf; src2.loop = true;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1.2;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 3;
      var bpg = ctx.createGain(); bpg.gain.value = 0.25;
      var mix = ctx.createGain(); mix.gain.value = 1;
      var trem = ctx.createGain(); trem.gain.value = 1;
      var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
      var lfoG = ctx.createGain(); lfoG.gain.value = 0.18;
      var out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.setTargetAtTime(0.03, t, 0.04);
      src.connect(lp); lp.connect(mix);
      src2.connect(bp); bp.connect(bpg); bpg.connect(mix);
      mix.connect(trem); lfo.connect(lfoG); lfoG.connect(trem.gain);
      trem.connect(out); out.connect(bus.sfx);
      src.start(t, rnd(0, 3)); src2.start(t, rnd(0, 1.5)); lfo.start(t);
      sq = { src: src, src2: src2, lfo: lfo, lp: lp, bp: bp, out: out, lfoO: lfo, p: 0, lastP: 0, lastT: 0 };
    } catch (e) { sq = null; }
  }
  function squeezeSet(p) {
    try {
      if (!sq || !ctx) return;
      p = clamp(+p || 0, 0, 1);
      var t = now();
      // 押すほど詰まって低く・少し大きく
      sq.out.gain.setTargetAtTime(0.025 + p * 0.13, t, 0.05);
      sq.lp.frequency.setTargetAtTime(950 - p * 520, t, 0.06);
      sq.bp.frequency.setTargetAtTime(560 - p * 220, t, 0.06);
      sq.lfoO.frequency.setTargetAtTime(5.5 + p * 4, t, 0.1);
      // 押し込みが進んだ時だけ、湿った小さな粒の音
      if (p - sq.lastP > 0.1 && t - sq.lastT > 0.07 && running()) {
        sq.lastP = p; sq.lastT = t;
        noise({ t: t + 0.005, a: 0.002, d: 0.03, g: 0.05 + p * 0.05, type: 'lowpass', f: 800 - p * 250, q: 2, dest: bus.sfx });
      } else if (p < sq.lastP - 0.15) sq.lastP = p;
      sq.p = p;
    } catch (e) {}
  }
  function squeezeEnd() {
    try {
      if (!sq || !ctx) { sq = null; return; }
      var s = sq; sq = null;
      var t = now();
      s.out.gain.cancelScheduledValues(t);
      s.out.gain.setTargetAtTime(0.0001, t, 0.04);
      s.src.stop(t + 0.35); s.src2.stop(t + 0.35); s.lfo.stop(t + 0.35);
    } catch (e) { sq = null; }
  }

  // ---------- 環境音と音楽（先読みスケジューラ） ----------
  var ambOn = false, ambNodes = null, nextKoto = 0;
  var musOn = false, musNext = 0, musPhrase = 0, motif = null;
  var BEAT = 60 / 80, LOOKAHEAD = 0.6;
  // 長調ペンタトニック（C D E G A）
  var SCALE = [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6];
  var BASS = [130.81, 110.0, 146.83, 98.0]; // C3 A2 D3 G2

  function ambience(on) {
    try {
      ambOn = !!on;
      if (!ctx || failed) return;
      var t = now();
      if (ambOn) {
        if (!ambNodes) {
          var src = ctx.createBufferSource(); src.buffer = brownBuf; src.loop = true;
          var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.4;
          var g = ctx.createGain(); g.gain.value = 0.18;
          src.connect(lp); lp.connect(g); g.connect(bus.amb);
          src.start(t, rnd(0, 3));
          ambNodes = { src: src };
          nextKoto = t + rnd(6, 14);
        }
        bus.amb.gain.cancelScheduledValues(t);
        bus.amb.gain.setTargetAtTime(0.3, t, 0.8);
      } else {
        bus.amb.gain.cancelScheduledValues(t);
        bus.amb.gain.setTargetAtTime(0.0001, t, 0.5);
      }
      hookScheduler();
    } catch (e) {}
  }

  function music(on) {
    try {
      var was = musOn;
      musOn = !!on;
      if (!ctx || failed) return;
      var t = now();
      bus.music.gain.cancelScheduledValues(t);
      if (musOn) {
        bus.music.gain.setTargetAtTime(0.32, t, 0.9);
        if (!was || musNext < t) musNext = t + 0.3;
      } else {
        bus.music.gain.setTargetAtTime(0.0001, t, 0.6);
      }
      hookScheduler();
    } catch (e) {}
  }

  // 1フレーズ（8拍）を作る。前のフレーズの動機を少し変えて使う
  function makePhrase() {
    var notes = [], i;
    if (!motif || musPhrase % 4 === 0) {
      motif = [];
      var idx = 6 + ((Math.random() * 3) | 0) - 1;
      for (i = 0; i < 8; i++) {
        var on = i === 0 || Math.random() < (i % 2 === 0 ? 0.6 : 0.35);
        idx = clamp(idx + [-2, -1, -1, 0, 1, 1, 2][(Math.random() * 7) | 0], 3, 10);
        motif.push(on ? { i: idx, half: Math.random() < 0.18 } : null);
      }
    } else {
      // 2か所だけ変える
      for (var k = 0; k < 2; k++) {
        var j = 1 + ((Math.random() * 7) | 0);
        if (motif[j]) motif[j] = Math.random() < 0.3 ? null : { i: clamp(motif[j].i + [-1, 1][(Math.random() * 2) | 0], 3, 10), half: false };
        else if (Math.random() < 0.5) motif[j] = { i: 5 + ((Math.random() * 4) | 0), half: false };
      }
    }
    var rest = musPhrase % 4 === 3; // 4つ目は間を多く
    for (i = 0; i < 8; i++) {
      var m = motif[i];
      if (!m) continue;
      if (rest && i > 3) continue;
      notes.push({ b: i, f: SCALE[m.i], g: 0.09 });
      if (m.half && i < 7) notes.push({ b: i + 0.5, f: SCALE[clamp(m.i + 1, 3, 10)], g: 0.06 });
    }
    // フレーズの終わりは ド か ソ で落ち着く
    var endB = rest ? 3 : 6;
    var hasEnd = false;
    for (i = 0; i < notes.length; i++) if (notes[i].b >= endB) { notes[i].f = Math.random() < 0.6 ? NOTE.C5 : NOTE.G4; hasEnd = true; }
    if (!hasEnd) notes.push({ b: endB, f: NOTE.C5, g: 0.08 });
    // ベース（小節頭）
    var r = musPhrase % 2 === 0 ? 0 : 2;
    notes.push({ b: 0, f: BASS[r], g: 0.07, d: 2.2 });
    if (!rest) notes.push({ b: 4, f: BASS[r + 1], g: 0.06, d: 2.2 });
    musPhrase++;
    return notes;
  }

  function schedule() {
    if (!ctx || failed || ctx.state !== 'running') return;
    var t = now();
    if (musOn) {
      if (musNext < t) musNext = t + 0.1; // 止まっていた分は飛ばす
      while (musNext < t + LOOKAHEAD) {
        var ph = makePhrase();
        for (var i = 0; i < ph.length; i++) {
          var n = ph[i];
          var nt = musNext + n.b * BEAT + rnd(0, 0.012);
          kal(nt, n.f, n.g, n.d || 1.5, bus.music);
        }
        musNext += 8 * BEAT + (musPhrase % 4 === 0 ? BEAT * 2 : 0);
      }
    }
    if (ambOn && ambNodes && t > nextKoto) {
      // ごく稀な小さな ことこと（遠くの鍋ぶた）
      var kt = t + 0.05, pp = rnd(0.8, 1.2), o = voiceOut(0.07, rnd(-0.6, 0.6), kt);
      V.drop(kt, pp, o);
      if (Math.random() < 0.7) V.drop(kt + rnd(0.12, 0.2), pp * 1.06, o);
      nextKoto = t + rnd(12, 26);
    }
  }

  function hookScheduler() {
    if (schedHooked) return;
    schedHooked = true;
    try {
      if (G.Engine && typeof G.Engine.onUpdate === 'function') {
        G.Engine.onUpdate(function () { try { schedule(); } catch (e) {} });
        return;
      }
    } catch (e) {}
    var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
    if (!raf) return;
    var loop = function () { try { schedule(); } catch (e) {} raf(loop); };
    raf(loop);
  }

  // ---------- 解錠・停止・再開 ----------
  function unlock() {
    try {
      if (failed) return;
      if (!ctx) createContext();
      if (!ctx) return;
      userSuspended = false;
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        var pr = ctx.resume(); if (pr && pr.catch) pr.catch(function () {});
      }
      if (!unlock._primed) {
        unlock._primed = true;
        // iOS 用: 無音の1サンプルを鳴らす
        var b = ctx.createBuffer(1, 1, ctx.sampleRate);
        var s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
      }
      hookScheduler();
      if (ambOn && !ambNodes) ambience(true);
      if (musOn) music(true);
    } catch (e) {}
  }

  function suspend() {
    try {
      if (!ctx || failed) return;
      userSuspended = true;
      if (sq) squeezeEnd();
      if (ctx.state === 'running') { var pr = ctx.suspend(); if (pr && pr.catch) pr.catch(function () {}); }
    } catch (e) {}
  }

  function resume() {
    try {
      if (!ctx || failed) return;
      userSuspended = false;
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        var pr = ctx.resume(); if (pr && pr.catch) pr.catch(function () {});
      }
    } catch (e) {}
  }

  G.Audio = {
    unlock: unlock,
    suspend: suspend,
    resume: resume,
    play: play,
    squeezeStart: squeezeStart,
    squeezeSet: squeezeSet,
    squeezeEnd: squeezeEnd,
    ambience: ambience,
    music: music,
    names: Object.keys(V)
  };
})();
