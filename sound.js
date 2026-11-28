// 殺陣の素材をPCM合成。刀は高い衝突、盾は長い金属共鳴、大筒は低い爆圧。
// 音声ファイル不要。render() は試聴/WAV書き出しにも使える純粋関数。
const TokiWeaponVoice = (() => {
  const names = {
    fu: '歩・槍', tokin: 'と金・旗槍', kyosha: '香車・長槍', narikyo: '成香・十文字槍',
    keima: '桂馬・短刀', narikei: '成桂・太刀', ginsho: '銀将・双刀', narigin: '成銀・大小',
    kinsho: '金将・盾', hisha: '飛車・大筒', ryuo: '龍王・龍筒',
    kakugyo: '角行・薙刀', ryuma: '龍馬・大薙刀', osho: '王将・軍配', gyokusho: '玉将・軍配',
  };
  function weapon(p) {
    if (typeof p === 'string' && names[p]) return p;
    if (!p) return 'ginsho';
    if (p.type === 'OU') return p.side === 1 ? 'gyokusho' : 'osho';
    return (p.promoted
      ? { FU: 'tokin', KY: 'narikyo', KE: 'narikei', GI: 'narigin', KI: 'kinsho', HI: 'ryuo', KA: 'ryuma' }
      : { FU: 'fu', KY: 'kyosha', KE: 'keima', GI: 'ginsho', KI: 'kinsho', HI: 'hisha', KA: 'kakugyo' })[p.type] || 'ginsho';
  }
  function render(event = 'strike', piece = 'ginsho', variant = 0, sampleRate = 44100) {
    const id = weapon(piece), cannon = id === 'hisha' || id === 'ryuo';
    const heavy = ['narigin', 'narikei', 'narikyo', 'ryuma', 'ryuo'].includes(id);
    const shield = id === 'kinsho', fan = id === 'osho' || id === 'gyokusho';
    const spear = ['fu', 'tokin', 'kyosha', 'narikyo'].includes(id);
    const pole = spear || id === 'kakugyo' || id === 'ryuma';
    const double = id === 'ginsho' || id === 'narigin';
    const blade = double || ['keima', 'narikei', 'kakugyo', 'ryuma'].includes(id);
    const hitOnly = event === 'hit', finish = event === 'ko';
    const big = event === 'first' || event === 'clash' || finish;
    const dur = cannon ? (id === 'ryuo' ? .8 : .65) : shield ? 1.3 : finish ? .46 : pole ? .37 : .34;
    const samples = new Float32Array(Math.ceil((dur + .035) * sampleRate));
    let seed = (2166136261 ^ (variant + 1) * 2654435761) >>> 0;
    for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619) >>> 0;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const jitter = .94 + random() * .12;
    function add(offset, length, fn) {
      const start = Math.max(0, Math.floor(offset * sampleRate));
      const count = Math.min(Math.ceil(length * sampleRate), samples.length - start);
      for (let i = 0; i < count; i++) samples[start + i] += fn(i / sampleRate, i / Math.max(1, count - 1), i);
    }
    // 帯域を絞った雑音。Qの高い発振フィルターを避け、息・擦れ・破裂として鳴らす。
    function noise(offset, length, vol, low, high, shape = 'decay') {
      let lp = 0, hpBase = 0;
      const al = 1 - Math.exp(-2 * Math.PI * Math.min(low, sampleRate * .42) / sampleRate);
      const ah = high ? 1 - Math.exp(-2 * Math.PI * high / sampleRate) : 0;
      add(offset, length, (t, u) => {
        const n = random() * 2 - 1; lp += al * (n - lp); hpBase += ah * (lp - hpBase);
        const env = shape === 'swell' ? Math.pow(Math.sin(Math.PI * u), 1.3) : Math.min(1, t / .0015) * Math.exp(-u * 6.2) * (1 - u);
        return (lp - (high ? hpBase : 0)) * env * vol;
      });
    }
    function thump(offset, vol, pitch = 115, length = .13) {
      let phase = 0;
      add(offset, length, (t, u) => {
        phase += 2 * Math.PI * (pitch * (.36 + .85 * Math.exp(-t * 60))) / sampleRate;
        return Math.sin(phase) * Math.exp(-u * 8) * Math.min(1, t / .001) * (1 - u) * vol;
      });
    }
    // 「ドゴーン」：短い発火、急な爆圧、低い砲声。長い雑音の尾を残さない。
    function cannonBlast() {
      const dragon = id === 'ryuo', length = dur - .04;
      noise(0, .016, 1.35, 5100, 450);
      noise(.004, .085, .8, 1150, 35);
      noise(.024, .13, .32, 650, 45);
      let bass = 0, body = 0, phase = 0, phase2 = 0, phase3 = 0;
      const b = 1-Math.exp(-2*Math.PI*180/sampleRate);
      const m = 1-Math.exp(-2*Math.PI*850/sampleRate);
      add(.005, length, (t,u) => {
        const n = random()*2-1;
        bass += b*(n-bass); body += m*(n-body);
        const f = (dragon ? 43 : 55)+100*Math.exp(-t*32);
        phase += 2*Math.PI*f/sampleRate;
        phase2 += 2*Math.PI*((dragon ? 79 : 99)+75*Math.exp(-t*25))/sampleRate;
        phase3 += 2*Math.PI*(dragon ? 143 : 181)/sampleRate;
        const pressure = Math.tanh((Math.sin(phase)+.4*Math.sin(phase2)*Math.exp(-t*5)+.19*Math.sin(phase3)*Math.exp(-t*12))*1.65);
        const rumble = bass*.9 + (body-bass)*.35;
        const attack = Math.min(1,t/.002);
        const env = attack*Math.exp(-t*(dragon ? 6.5 : 8.2))*Math.pow(1-u,.8);
        return (pressure+rumble)*env*(hitOnly ? .9 : 1);
      });
    }
    // ごく短い不協和の金属/木の共鳴。数百ms～秒単位の「歌う」余韻は残さない。
    function knock(offset, vol, metal = true) {
      const fs = metal ? [730, 1691, 2873] : [210, 473, 1091];
      fs.forEach((f, k) => add(offset, metal ? .065 : .08, (t, u) =>
        Math.sin(2 * Math.PI * f * jitter * t) * Math.exp(-t * (metal ? 100 : 82) * (1 + k * .24)) * Math.min(1, t / .0007) * (1 - u) * vol / (k + 1)));
    }
    // 刀は高い「キィン」、盾は誇張した大型金属板の「ゴォーン」。
    function metalClash(offset, vol) {
      if (shield) {
        noise(offset, .025, 1.2 * vol, 900, 0);
        noise(offset + .003, .065, .5 * vol, 500, 0);
        thump(offset, .9 * vol, 58, .16);
        noise(offset + .01, .5, .45 * vol, 650, 25);
      } else {
        noise(offset, .012, .95 * vol, 11500, blade ? 4700 : 3100);
        noise(offset + .002, .042, .42 * vol, blade ? 11000 : 9000, blade ? 4200 : 2400);
      }
      // 刀系は従来の約1オクターブ上。盾は低い板と胴の共鳴に分ける。
      const modes = shield ? [[65, 1, 3.2], [108, .8, 3.8], [183, .25, 5], [311, .09, 7]]
        : blade ? [[4800, 1, 14], [6833, .58, 20], [9071, .3, 28], [12137, .12, 42]]
        : [[2350, 1, 14], [3767, .64, 18], [5881, .35, 26], [8137, .16, 40]];
      modes.forEach(([freq, strength, decay]) => {
        if (freq > sampleRate * .44) return; // 低いサンプルレートで折り返さない。
        let phase = random() * .35;
        add(offset, shield ? 1.15 : .23, (t, u) => {
          phase += 2 * Math.PI * freq * jitter * (1 + .018 * Math.exp(-t * 190)) / sampleRate;
          const attack = Math.min(1, t / .0006);
          return Math.sin(phase) * strength * vol * attack * Math.exp(-t * decay) * Math.pow(1-u, .65);
        });
      });
    }
    const wind = pole ? .105 : id === 'keima' ? .036 : double ? .06 : .07;
    const impact = hitOnly ? 0 : cannon ? .008 : wind * .65;
    if (cannon) cannonBlast();
    if (!hitOnly && !cannon) {
        noise(0, wind, heavy ? 1.6 : 1.2, shield ? 1400 : pole ? 4100 : 7400, shield ? 120 : pole ? 400 : 1100, 'swell');
        if (double) noise(.038, .055, .7, 8500, 1600, 'swell');
        if (id === 'tokin') noise(.014, .12, .24, 2100, 500, 'swell');
    }
    if (!cannon && (hitOnly || big || shield || fan || spear)) {
      noise(impact, .075, shield ? 1.8 : fan ? 1.2 : 1.3, shield ? 1450 : 3100, 0);
      thump(impact, shield ? 1.1 : heavy ? .85 : .65, shield ? 95 : 145, .12);
      if (shield || fan || spear) knock(impact, shield ? .65 : .4, false);
    }
    if (!cannon && !fan) {
      noise(impact, shield ? .04 : .055, .65, shield ? 1900 : 10000, shield ? 300 : 3100);
      if (!hitOnly || big) knock(impact + .002, spear ? .18 : shield ? .2 : .36, !spear && !shield);
    }
    if (!cannon && !hitOnly && !big && !spear && !shield && !fan) {
      noise(impact, .07, .9, 3300, 120); thump(impact, .35, 155, .08);
    }
    // 攻撃自体も接触音として成立させ、命中時にはさらに明確な金属の打撃を鳴らす。
    const clashWeight = cannon && !hitOnly ? .42 : fan ? .55 : shield ? 1.05 : 1;
    if (!cannon) metalClash(impact, clashWeight * (event === 'support' ? .7 : hitOnly ? .92 : big ? 1.2 : 1));
    if (finish) { noise(.08, .22, .8, 1700, 0); thump(.08, .8, 95, .2); }
    let peak = 0; for (const v of samples) peak = Math.max(peak, Math.abs(v));
    // 機種/サンプルレートが違っても出力を一定範囲に収める。
    const gain = peak > 0 ? .82 / peak : 0;
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    return { samples, sampleRate, weapon: id, duration: samples.length / sampleRate };
  }
  return { names, weapon, render };
})();

// 刻将棋：武器別の殺陣SE。sound.jsのみ差し替え、game.js / BGM / 設定UIは従来互換。
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
    comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = .003; comp.release.value = .12;
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
  const whoosh = (t, vol = 0.25, up = true) => noise(t, 0.28, 'bandpass', up ? 500 : 2600, up ? 2600 : 500, 1.4, vol, 0.28);

  // 既存の sfx(name, side) と、駒を指定する外部呼出しの両方に対応。
  let soundContext = null, combatLevel = 1.44, activeCombatVoices = 0, variation = 0;
  const combatEvents = new Set(['clash', 'strike', 'support', 'hit', 'first', 'ko']);   // combatLevel：武器の音の大きさ（2026-11-29 に 0.72 から倍の 1.44 に）
  const combatBuffers = new Map();
  function withContext(value, fn) {
    const prev = soundContext; soundContext = value;
    try { return fn(); } finally { soundContext = prev; }
  }
  function gameIsSimulating() {
    try { return typeof G !== 'undefined' && G && G.sim; } catch (e) { return false; }
  }
  function contextPiece() {
    if (soundContext && soundContext.attacker) return soundContext.attacker;
    return null;
  }
  function weaponVoice(t, v, event, piece) {
    if (activeCombatVoices >= 14) return;
    const id = TokiWeaponVoice.weapon(piece), variant = variation++ % 3;
    const key = [id, event, variant].join(':');
    let buffer = combatBuffers.get(key);
    if (!buffer) {
      const pcm = TokiWeaponVoice.render(event, id, variant, ac.sampleRate);
      buffer = ac.createBuffer(1, pcm.samples.length, pcm.sampleRate);
      buffer.getChannelData(0).set(pcm.samples); combatBuffers.set(key, buffer);
    }
    const levels = { strike: .48, support: .26, hit: .34, clash: .66, first: .78, ko: .62 };
    const src = ac.createBufferSource(), gain = ac.createGain();
    src.buffer = buffer; gain.gain.value = (levels[event] || .45) * v * combatLevel;
    let pan = null;
    if (typeof ac.createStereoPanner === 'function') {
      pan = ac.createStereoPanner(); pan.pan.value = piece && piece.side === 1 ? .2 : -.2;
      src.connect(gain); gain.connect(pan); pan.connect(master);
    } else { src.connect(gain); gain.connect(master); }
    activeCombatVoices++;
    src.onended = () => {
      activeCombatVoices--; src.disconnect(); gain.disconnect(); if (pan) pan.disconnect();
    };
    src.start(t); src.stop(t + buffer.duration + .005);
  }
  function combat(t, v, event) {
    if (event === 'support' && soundContext && soundContext.grapple) {
      const g = soundContext.grapple;
      // 助太刀の全員を大音量で重ねず、最大3駒まで各々の武器を控えめに。
      const ps = [...(g.atkSups || []), ...(g.defSups || [])].slice(0, 3);
      ps.forEach((p, i) => weaponVoice(t + i * .013, (p.side === 1 ? .6 : 1) / Math.sqrt(ps.length), 'support', p));
      return;
    }
    const piece = contextPiece();
    const level = ['hit', 'first', 'ko'].includes(event) && piece && piece.side === 1 ? v * .6 : v;
    weaponVoice(t, level, event, piece);
  }

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
    join:    (t, v) => { clack(t, 0.22 * v, 1500); },
    // 戦闘：駒の武器ごとに短い殺陣音を鳴らす（琴や鈴は戦闘に使わない）
    clash: (t, v) => combat(t, v, 'clash'),
    strike: (t, v) => combat(t, v, 'strike'),
    support: (t, v) => combat(t, v, 'support'),
    hit: (t, v) => combat(t, v, 'hit'),
    first: (t, v) => combat(t, v, 'first'),
    ko: (t, v) => combat(t, v, 'ko'),
    // 試合の終わり
    win:     t => { taiko(t, 0.8, 110); [0, 2, 3, 4, 5, 7, 9].forEach((n, i) => koto(t + 0.25 + i * 0.1, note(n, 1), 0.28, 1.4)); bell(t + 0.9, note(0, 2), 0.25, 2.4); },
    draw:    t => { taiko(t, 0.6, 100); bell(t + 0.2, note(0, 2), 0.22, 2.2); [0, 2, 0].forEach((n, i) => koto(t + 0.3 + i * 0.25, note(n, 1), 0.22, 1.2)); },   // 引き分け
    lose:    t => { taiko(t, 0.8, 80); gong(t + 0.05, 0.45); [9, 7, 5, 4, 3, 2].forEach((n, i) => koto(t + 0.3 + i * 0.16, note(n - 5, 0), 0.24, 1.6)); },
  };

  function play(name, side = 0, piece = null) {
    if (gameIsSimulating()) return;
    if (piece) return withContext({ ...(soundContext || {}), attacker: piece }, () => play(name, side));
    // startGrapple は直後に firstBurst も呼ぶため、最初の衝突は重ね鳴らししない。
    if (name === 'clash' && soundContext && soundContext.initial) return;
    if (!SETTINGS.se) return;
    const f = sounds[name];
    if (!f) return;
    const a = ensure();
    if (!a) return;
    if (a.state !== 'running') { resume(); if (a.state !== 'running') return; }
    const nowMs = performance.now();
    const key = combatEvents.has(name) ? [name, TokiWeaponVoice.weapon(contextPiece()), side].join(':') : name;
    if (last[key] !== undefined && nowMs - last[key] < (name === 'hit' ? 30 : 45)) return;
    last[key] = nowMs;
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
  return { play, setSe, setBgm, resume, bgmStart, bgmStop,
    playWeapon: (event, piece, side = piece && piece.side || 0) => play(event, side, piece),
    withContext, context: () => soundContext, render: TokiWeaponVoice.render,
    weapons: TokiWeaponVoice.names,
    setCombatVolume: value => { combatLevel = Math.max(0, Math.min(2, Number(value) || 0)); },
  };
})();
const sfx = (name, side) => { if (typeof G !== 'undefined' && G && G.sim) return; SND.play(name, side); };


// メイン側の関数は編集せず、呼出し中だけ音へ駒情報を渡す薄いアダプター。
// 引数・戻り値・this・例外とゲーム状態をそのまま維持。先読み G.sim は無音。
(() => {
  function install() {
    function wrap(name, context) {
      const original = window[name];
      if (typeof original !== 'function' || original.__tokiAudioWrapped) return;
      const wrapped = function (...args) {
        const parent = SND.context();
        return SND.withContext({ ...(parent || {}), ...context(args, parent) }, () => original.apply(this, args));
      };
      Object.defineProperty(wrapped, '__tokiAudioWrapped', { value: true });
      window[name] = wrapped;
    }
    for (const n of ['startMove', 'startRotate', 'startPromote', 'arrive']) wrap(n, a => ({ attacker: a[0] }));
    wrap('startGrapple', a => ({ attacker: a[0], defender: a[1], initial: true }));
    wrap('fireTick', a => ({ attacker: a[0].atk, defender: a[0].def, grapple: a[0], initial: false }));
    wrap('damagePiece', (a, parent) => ({
      attacker: parent && parent.attacker || (a[1] === a[0].def ? a[0].atk : a[0].def),
      defender: a[1], grapple: a[0], initial: false,
    }));
    wrap('capture', a => ({ defender: a[0] }));
    // 着弾は約0.35秒後。発射した駒をコールバックへ閉じ込め、別戦闘と混線させない。
    const shoot = window.shoot;
    if (typeof shoot === 'function' && !shoot.__tokiAudioWrapped) {
      const wrapped = function (...args) {
        const ctx = SND.context();
        if (ctx && typeof args[6] === 'function') {
          const g = ctx.grapple, hit = args[6];
          const support = g && [...(g.atkSups || []), ...(g.defSups || [])].find(p =>
            Math.abs(p.x + .5 - args[0]) < .001 && Math.abs(p.y + .5 - args[1]) < .001);
          const pending = { ...ctx, attacker: support || ctx.attacker, defender: args[5], initial: false };
          args[6] = function (...hitArgs) { return SND.withContext(pending, () => hit.apply(this, hitArgs)); };
        }
        return shoot.apply(this, args);
      };
      Object.defineProperty(wrapped, '__tokiAudioWrapped', { value: true }); window.shoot = wrapped;
    }
  }
  // 通常はsound.js→game.jsの順。後から読む場合にも対応する。
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
  window.TokiSFX = SND;
})();
