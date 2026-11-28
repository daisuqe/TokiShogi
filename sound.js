// 刻将棋の効果音：音のファイルは使わず、ブラウザの Web Audio でその場で作る（和風：琴・三味線・太鼓・拍子木・鈴）
// 音階は陰旋法（D E♭ G A B♭）。ゲーム側からは sfx('名前', 側) を呼ぶだけ
// 設定（トップ画面で切り替える）：効果音・BGM・駒をキャラクター表示。ブラウザに覚えておく
const SETTINGS = (() => {
  const d = { se: true, bgm: true, chara: false, sec: 6 }; // sec：1動作の秒数（3・6・9）
  try { Object.assign(d, JSON.parse(localStorage.getItem('toki-settings') || '{}')); } catch (e) {}
  if (![3, 6, 9].includes(d.sec)) d.sec = 6;
  return d;
})();
function saveSettings() { try { localStorage.setItem('toki-settings', JSON.stringify(SETTINGS)); } catch (e) {} }
const SND = (() => {
  let ac = null, master = null, noiseBuf = null;
  const last = {};

  // 陰旋法（D4 を基準に、オクターブごと）
  const SCALE = [293.66, 311.13, 392.0, 440.0, 466.16];
  const note = (i, oct = 0) => SCALE[((i % 5) + 5) % 5] * Math.pow(2, oct + Math.floor(i / 5));

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // iPhone：消音スイッチが入っていても鳴るようにする（iOS 17 以降の Safari / ホーム画面から開いたアプリ）
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.55;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    // 白色雑音（息・撥・拍子木の元）
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }
  // 音を使える状態にする。iPhone では 'suspended' のほかに 'interrupted'（アプリが裏に回ったあとなど）もあるので、
  // 'running' 以外はすべて resume する。ホーム画面から開いたアプリでは、触り終えた時（touchend / click）の
  // 中で、無音の音を1回鳴らさないと解除されないことがある
  let unlocked = false;
  function resume() {
    const a = ensure();
    if (!a) return;
    if (a.state !== 'running') { try { const r = a.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
    if (!unlocked) {
      try {
        const b = a.createBuffer(1, 1, 22050), src = a.createBufferSource();
        src.buffer = b; src.connect(a.destination); src.start(0);
        unlocked = true;
      } catch (e) {}
    }
  }

  const env = (g, t, a, peak, dec) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  };
  const noise = (t, dur, type, f0, f1, q, vol, dec) => {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); env(g, t, 0.003, vol, dec || dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  };
  const tone = (t, freq, dur, type, vol, opt = {}) => {
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(opt.from || freq, t);
    if (opt.from) o.frequency.exponentialRampToValueAtTime(freq, t + (opt.glide || 0.05));
    const g = ac.createGain(); env(g, t, opt.attack || 0.004, vol, dur);
    let out = o;
    if (opt.lp) {
      const f = ac.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(opt.lp, t); f.frequency.exponentialRampToValueAtTime(Math.max(200, opt.lp2 || opt.lp * 0.3), t + dur);
      o.connect(f); out = f;
    }
    out.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  };

  // 琴：はじいた音（少し明るい三角波＋倍音、すぐ減る）
  const koto = (t, f, vol = 0.3, dur = 0.9) => {
    tone(t, f, dur, 'triangle', vol, { from: f * 1.012, glide: 0.04 });
    tone(t, f * 2, dur * 0.5, 'sine', vol * 0.35);
    noise(t, 0.03, 'highpass', 3000, 0, 0.7, vol * 0.25, 0.03);
  };
  // 三味線：撥で強く弾く（鋭い鋸波と、皮を叩く音）
  const shamisen = (t, f, vol = 0.3) => {
    tone(t, f, 0.35, 'sawtooth', vol * 0.55, { lp: 3600, lp2: 500, from: f * 1.04, glide: 0.03 });
    noise(t, 0.06, 'bandpass', 1500, 600, 1.2, vol * 0.9, 0.06);
  };
  // 太鼓：低い胴の音が落ちる＋皮の打音
  const taiko = (t, vol = 0.6, f = 110) => {
    tone(t, f * 0.45, 0.55, 'sine', vol, { from: f * 1.5, glide: 0.12 });
    tone(t, f * 0.9, 0.2, 'triangle', vol * 0.3, { from: f * 2, glide: 0.06 });
    noise(t, 0.12, 'lowpass', 1800, 300, 0.8, vol * 0.7, 0.12);
  };
  // 拍子木：乾いた硬い音
  const clack = (t, vol = 0.4, f = 2400) => {
    noise(t, 0.05, 'bandpass', f, f * 0.7, 9, vol, 0.05);
    tone(t, f * 0.5, 0.05, 'square', vol * 0.18, { from: f * 0.62, glide: 0.02 });
  };
  // 鈴・鐘：高い倍音がのびる
  const bell = (t, f = 880, vol = 0.3, dur = 1.6) => {
    for (const [m, v, d] of [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.35], [8.9, 0.12, 0.2]])
      tone(t, f * m, dur * d, 'sine', vol * v);
  };
  // 銅鑼：低くうなる
  const gong = (t, vol = 0.4) => {
    for (const [f, v, d] of [[110, 1, 2.2], [165, 0.6, 1.8], [246, 0.45, 1.4], [331, 0.3, 1.0]]) tone(t, f * 1.0, d, 'sine', vol * v, { from: f * 1.05, glide: 0.4 });
    noise(t, 0.5, 'bandpass', 900, 400, 0.6, vol * 0.4, 0.5);
  };
  // 刀：刃が鳴る金属音（高い倍音が鋭くのびる）／振る風切り音／斬る音
  const blade = (t, base = 2000, vol = 0.3, dur = 0.7) => {
    for (const [m, v, d] of [[1, 1, 1], [2.32, 0.7, 0.7], [4.17, 0.5, 0.5], [6.7, 0.3, 0.35]])
      tone(t, base * m, dur * d, 'sine', vol * v, { from: base * m * 1.01, glide: 0.03 });
    noise(t, 0.05, 'highpass', 5000, 0, 0.7, vol * 0.8, 0.05);
  };
  const swing = (t, vol = 0.3, dur = 0.14) => noise(t, dur, 'bandpass', 900, 5200, 2.2, vol, dur);
  const cut = (t, vol = 0.4) => {                      // 斬る：鋭い風切り＋肉を断つ低い音
    noise(t, 0.2, 'bandpass', 3800, 500, 1.1, vol, 0.2);
    noise(t, 0.09, 'lowpass', 1100, 200, 0.8, vol * 0.7, 0.09);
    tone(t, 70, 0.18, 'sine', vol * 0.6, { from: 160, glide: 0.07 });
  };
  const whoosh = (t, vol = 0.25, up = true) => noise(t, 0.28, 'bandpass', up ? 500 : 2600, up ? 2600 : 500, 1.4, vol, 0.28);

  const sounds = {
    // 画面・操作
    ui:      t => { clack(t, 0.25, 2000); },
    select:  t => { koto(t, note(3, 1), 0.22, 0.5); },
    ng:      t => { tone(t, 150, 0.14, 'square', 0.16, { from: 190, glide: 0.06, lp: 700 }); clack(t, 0.18, 900); },
    // 試合のはじまり：拍子木を数える。最後は太鼓と琴
    count:   t => { clack(t, 0.45, 2600); clack(t + 0.07, 0.3, 2100); },
    start:   t => {
      taiko(t, 0.8, 120); taiko(t + 0.16, 0.6, 140); gong(t, 0.3);
      [0, 2, 4, 5, 7].forEach((n, i) => koto(t + 0.05 + i * 0.06, note(n, 1), 0.26, 1.1));
    },
    // 駒の動き
    move:    (t, v) => { shamisen(t, note(2, 0), 0.22 * v); whoosh(t, 0.12 * v, true); },
    land:    (t, v) => { noise(t, 0.08, 'lowpass', 900, 200, 0.7, 0.28 * v, 0.08); tone(t, 180, 0.1, 'sine', 0.2 * v, { from: 260, glide: 0.04 }); },
    rotate:  (t, v) => { whoosh(t, 0.22 * v, true); bell(t + 0.12, note(4, 2), 0.1 * v, 0.5); },
    promoteStart: (t, v) => { [0, 2, 3, 4].forEach((n, i) => koto(t + i * 0.09, note(n, 1), 0.2 * v, 0.7)); },
    promoted: (t, v) => { bell(t, note(0, 2), 0.28 * v, 2.0); koto(t, note(4, 2), 0.26 * v, 1.2); taiko(t, 0.35 * v, 130); },
    join:    (t, v) => { bell(t, note(3, 2), 0.14 * v, 0.7); clack(t, 0.18 * v, 3200); },
    // 戦闘：刀の音。組み合い＝刃と刃がぶつかる。攻め＝振って、鳴る。当たる＝斬る
    clash:   (t, v) => { taiko(t, 0.6 * v, 100); swing(t, 0.3 * v, 0.1); blade(t + 0.09, 1900, 0.36 * v, 0.9); blade(t + 0.12, 2700, 0.2 * v, 0.6); },
    strike:  (t, v) => { swing(t, 0.3 * v); blade(t + 0.1, 1500 + Math.random() * 1200, 0.2 * v, 0.45); },
    support: (t, v) => { swing(t, 0.16 * v, 0.1); blade(t + 0.07, 2600 + Math.random() * 1000, 0.1 * v, 0.3); },
    hit:     (t, v) => { cut(t, 0.42 * v); blade(t + 0.02, 2200, 0.12 * v, 0.35); },
    first:   (t, v) => { swing(t, 0.45 * v, 0.18); cut(t + 0.05, 0.55 * v); blade(t + 0.06, 2400, 0.4 * v, 1.0); blade(t + 0.09, 3300, 0.22 * v, 0.7); taiko(t + 0.04, 0.8 * v, 120); },   // 動いた直後の一撃（50）
    ko:      (t, v) => { swing(t, 0.4 * v, 0.2); cut(t + 0.1, 0.6 * v); blade(t + 0.12, 1700, 0.34 * v, 1.2); taiko(t + 0.14, 0.9 * v, 90); gong(t + 0.2, 0.35 * v); },
    // 試合の終わり
    win:     t => { taiko(t, 0.8, 110); [0, 2, 3, 4, 5, 7, 9].forEach((n, i) => koto(t + 0.25 + i * 0.1, note(n, 1), 0.28, 1.4)); bell(t + 0.9, note(0, 2), 0.25, 2.4); },
    draw:    t => { taiko(t, 0.6, 100); bell(t + 0.2, note(0, 2), 0.22, 2.2); [0, 2, 0].forEach((n, i) => koto(t + 0.3 + i * 0.25, note(n, 1), 0.22, 1.2)); },   // 引き分け
    lose:    t => { taiko(t, 0.8, 80); gong(t + 0.05, 0.45); [9, 7, 5, 4, 3, 2].forEach((n, i) => koto(t + 0.3 + i * 0.16, note(n - 5, 0), 0.24, 1.6)); },
  };

  function play(name, side = 0) {
    if (!SETTINGS.se) return;
    const f = sounds[name];
    if (!f) return;
    const a = ensure();
    if (!a) return;
    if (a.state !== 'running') { resume(); if (a.state !== 'running') return; }
    const nowMs = performance.now();
    if (last[name] && nowMs - last[name] < 45) return; // 同じ音が重なりすぎないように
    last[name] = nowMs;
    // 相手（COM）の動きは、少し控えめに
    const v = side === 1 ? 0.6 : 1;
    f(a.currentTime + 0.005, v);
  }
  // ===== BGM（audio/bgm.ogg）：勝負が始まったら鳴らし、終わったら止める。つなぎ目なく繰り返す =====
  let bgmWanted = false, bgmGain = null, bgmSrc = null, bgmBuf = null, bgmLoading = false, bgmEl = null;
  const BGM_URL = 'audio/bgm.ogg', BGM_VOL = 0.32;
  function bgmPlayNow() {
    if (!bgmWanted || !SETTINGS.bgm) return;
    const a = ensure();
    if (!a) return;
    if (bgmBuf) {
      if (bgmSrc) return;
      bgmGain = a.createGain(); bgmGain.gain.value = 0;
      bgmGain.gain.linearRampToValueAtTime(BGM_VOL, a.currentTime + 0.6);
      bgmGain.connect(a.destination);
      bgmSrc = a.createBufferSource(); bgmSrc.buffer = bgmBuf; bgmSrc.loop = true;
      bgmSrc.connect(bgmGain); bgmSrc.start();
    } else if (bgmEl) {
      bgmEl.volume = BGM_VOL; bgmEl.currentTime = 0; bgmEl.play().catch(() => {});
    }
  }
  function bgmLoad() {
    if (bgmBuf || bgmLoading) return;
    bgmLoading = true;
    const a = ensure();
    // 繰り返しのすき間が出ないよう、読み込んでデコードして鳴らす。だめなら普通の audio で
    fetch(BGM_URL).then(r => r.arrayBuffer()).then(b => new Promise((ok, ng) => a.decodeAudioData(b, ok, ng)))
      .then(buf => { bgmBuf = buf; bgmPlayNow(); })
      .catch(() => { bgmEl = new Audio(BGM_URL); bgmEl.loop = true; bgmPlayNow(); });
  }
  function bgmStart() { bgmWanted = true; if (!SETTINGS.bgm) return; resume(); if (bgmBuf || bgmEl) bgmPlayNow(); else bgmLoad(); }
  function bgmStop() {
    bgmWanted = false;
    if (bgmSrc) {
      const g = bgmGain, s = bgmSrc; bgmSrc = null; bgmGain = null;
      try { g.gain.cancelScheduledValues(ac.currentTime); g.gain.setValueAtTime(g.gain.value, ac.currentTime); g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.5); s.stop(ac.currentTime + 0.55); } catch (e) {}
    }
    if (bgmEl) { bgmEl.pause(); }
  }
  // 設定の切り替え
  function setSe(v) { SETTINGS.se = v; saveSettings(); if (v) { resume(); play('ui'); } }
  function setBgm(v) { SETTINGS.bgm = v; saveSettings(); if (v) { if (bgmWanted) bgmStart(); } else { const w = bgmWanted; bgmStop(); bgmWanted = w; } }
  // 最初の操作で音を使えるようにする（ブラウザの決まり）
  for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) window.addEventListener(ev, resume, { once: false, passive: true });
  // アプリに戻ってきたときも、音を戻す（ホーム画面から開いたアプリは、裏に回ると止まる）
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ac) resume(); });
  window.addEventListener('pageshow', () => { if (ac) resume(); });
  return { play, setSe, setBgm, resume, bgmStart, bgmStop };
})();
const sfx = (name, side) => { if (typeof G !== 'undefined' && G && G.sim) return; SND.play(name, side); };
