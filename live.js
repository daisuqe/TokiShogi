// 対戦の中継：試合中、画面の上に「いま組み合っている1試合」を派手に映す。
//  ・青（自分）が左、赤（COM）が右。組み合いが同時に起きていたら1試合だけ映し、終わったら次の試合へ切り替える
//  ・戦いの絵は image/ の PNG（駒ごとに idle・attack-1/2・defense-1/2・ko）
//  ・体力が減ると、減ったほうが押されていく。助太刀は後ろに小さく並び、撃つときは光の筋が飛ぶ
const LIVE = (() => {
  const canvas = document.getElementById('live');
  const ctx = canvas.getContext('2d');
  const FONT = '"TokiFont","Yu Gothic UI","Meiryo",sans-serif';
  const MISAKI = '"TokiMisaki", monospace';
  const COL = { 0: '#59a8ff', 1: '#ff5c63' };              // 青・赤
  const COL_D = { 0: '#2f7bff', 1: '#ff3344' };
  const SPARK = { 0: ['#6fb0ff', '#a8d4ff', '#ffffff', '#fff3b0'], 1: ['#ff6a5c', '#ffb36b', '#ffffff', '#fff3b0'] };

  // ===== 絵（image/） =====
  const BASE = { FU: 'fu', KY: 'kyosha', KE: 'keima', GI: 'ginsho', KI: 'kinsho', HI: 'hisha', KA: 'kakugyo' };
  const PBASE = { FU: 'tokin', KY: 'narikyo', KE: 'narikei', GI: 'narigin', HI: 'ryuo', KA: 'ryuma' };
  const POSES = ['idle', 'attack-1', 'attack-2', 'defense-1', 'defense-2', 'ko'];
  const imgs = {};
  function baseName(p) {
    if (p.type === 'OU') return p.side === 0 ? 'osho' : 'gyokusho';
    return (p.promoted ? PBASE : BASE)[p.type];
  }
  // 上の画面での駒の大きさ：王は1.3倍、歩は9割、ほかは強さに合わせて0.9〜1.1倍
  const SIZE = { OU: 1.3, FU: 0.9, KY: 0.95, KE: 1.0, GI: 1.02, KI: 1.05, KA: 1.08, HI: 1.1 };
  const PSIZE = { FU: 0.95, KY: 1.0, KE: 1.02, GI: 1.05, KA: 1.1, HI: 1.1 };
  const sizeOf = p => p.type === 'OU' ? SIZE.OU : (p.promoted ? PSIZE : SIZE)[p.type] || 1;
  function img(name, pose) {
    const k = name + '-' + pose;
    let im = imgs[k];
    if (!im) { im = imgs[k] = new Image(); im.src = `image/${k}.png`; }
    return im;
  }
  // 線を軍の色（青・赤）に塗る：白い線を色に、黒い塗りはそのまま
  const tinted = {};
  // ピクセルを読み出さず、重ね方（合成）だけで塗る。ファイルを直接開いた（file://）ときも動く
  function tint(im, key, color) {
    if (tinted[key] !== undefined) return tinted[key];
    try {
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      x.globalCompositeOperation = 'multiply';          // 白→色、黒→黒
      x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'destination-in';    // 絵のあった所だけ残す
      x.drawImage(im, 0, 0);
      return (tinted[key] = c);
    } catch (e) { return (tinted[key] = null); }
  }
  // 最初に全部読み込んでおく（切り替えのときに絵が遅れないように）
  for (const n of [...Object.values(BASE), ...Object.values(PBASE), 'osho', 'gyokusho']) for (const po of POSES) img(n, po);

  // ===== 状態 =====
  let cur = null;                 // いま映している試合
  let seenG = null;
  let last = performance.now();
  let parts = [], rings = [], slashes = [], beams = [], texts = [];
  let glowC = null;
  let shake = 0, flash = 0, flashColor = '255,255,255', glitch = 0;
  const now = () => performance.now() / 1000;

  const isKing = g => g.atk.type === 'OU' || g.def.type === 'OU';
  function pickNext() {
    // 王が関わる試合を優先して映す。なければ、いちばん古い試合
    const g = G.grapples.find(isKing) || G.grapples[0];
    if (!g) return null;
    const L = g.atk.side === 0 ? g.atk : g.def, R = g.atk.side === 0 ? g.def : g.atk;
    return {
      g, G, L, R, atkIsL: g.atk === L,
      t0: now(), end: null,
      hpL: L.hp, hpR: R.hp, chipL: L.hp, chipR: R.hp,
      xl: 0, xr: 0, init: false,
      seen: new Map(), // 助太刀の駒 → 見えはじめた時刻
    };
  }

  // ===== ゲームからの知らせ =====
  function strike(g, p, target) {
    if (!cur || cur.g !== g) return;
    p._ls = now();
    // 助太刀は光の筋を飛ばす
    if (p !== g.atk) beams.push({ from: p, to: target, t0: now(), dur: 0.32, side: p.side });
  }
  function hit(g, p, n) {
    if (!cur || cur.g !== g) return;
    p._lh = now();
    const t = now();
    const isL = p === cur.L;
    const pos = fighterPos(isL);
    const dir = isL ? -1 : 1;                      // 食らった駒から見た、のけぞる向き
    const c = SPARK[p.side];
    const u = unit();
    for (let i = 0; i < 16; i++) {
      const a = (Math.random() - 0.5) * 2.2 + (isL ? Math.PI : 0);
      const sp = (60 + Math.random() * 190) * u;
      parts.push({ x: pos.x - dir * 6 * u, y: pos.y - 48 * u, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30 * u, life: 0, max: 0.3 + Math.random() * 0.35, size: (1.5 + Math.random() * 2.5) * u, color: c[i % c.length] });
    }
    rings.push({ x: pos.x - dir * 6 * u, y: pos.y - 48 * u, t, max: 0.3, r: 38 * u, color: COL[p.side] });
    slashes.push({ x: pos.x, y: pos.y - 48 * u, ang: (isL ? -0.7 : -2.4) + (Math.random() - 0.5) * 0.4, t, max: 0.22, len: 90 * u, color: '#ffffff' });
    shake = Math.max(shake, 3.5 * u);
    flash = Math.max(flash, 0.22); flashColor = p.side === 0 ? '120,170,255' : '255,110,120';
  }
  function end(g, atkWins) {
    if (!cur || cur.g !== g) return;
    const loser = atkWins ? g.def : g.atk;
    cur.end = { t: now(), loser, winner: atkWins ? g.atk : g.def };
    cur.hpL = cur.L.hp; cur.hpR = cur.R.hp;
    const isL = loser === cur.L;
    const pos = fighterPos(isL);
    const u = unit();
    const c = SPARK[loser.side];
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, sp = (60 + Math.random() * 280) * u;
      parts.push({ x: pos.x, y: pos.y - 45 * u, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * u, life: 0, max: 0.5 + Math.random() * 0.7, size: (2 + Math.random() * 3.5) * u, color: c[i % c.length] });
    }
    for (let k = 0; k < 3; k++) rings.push({ x: pos.x, y: pos.y - 45 * u, t: now() + k * 0.12, max: 0.55, r: (70 + k * 40) * u, color: k === 0 ? '#ffffff' : COL[loser.side] });
    shake = 9 * u; flash = 0.75; flashColor = '255,255,255';
  }

  // ===== 位置など =====
  let W = 360, H = 160, DPR = 1;
  // 上の空きを削った分（--live-cut）は、キャラの大きさに数えない（キャラを小さくしない）
  let CUT = 0;
  const unit = () => (H + CUT) / 160;
  function fighterPos(isL) {
    const u = unit();
    return { x: isL ? cur.xl : cur.xr, y: H - 12 * u };
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    DPR = window.devicePixelRatio || 1;
    if (!w || !h) return false;
    if (canvas.width !== Math.round(w * DPR) || canvas.height !== Math.round(h * DPR)) {
      canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
    }
    W = w; H = h;
    CUT = parseFloat(getComputedStyle(canvas).getPropertyValue('--live-cut')) || 0;
    return true;
  }

  // ===== 描く部品 =====
  function drawSprite(p, pose, x, y, k, face, alpha, glow, white = 0) {
    const im = img(baseName(p), pose);
    if (!im.complete || !im.naturalWidth) return;
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(face, 1);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = glow; ctx.shadowBlur = 7 * unit();
    ctx.drawImage(tint(im, baseName(p) + '-' + pose + '-' + p.side, COL[p.side]) || im, -w / 2, -h, w, h);
    if (white > 0) {                                   // 当たった瞬間：真っ白に光る
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 22 * unit(); ctx.globalAlpha = Math.min(1, white);
      ctx.drawImage(im, -w / 2, -h, w, h);
    }
    ctx.restore();
  }
  function text(str, x, y, size, color, align = 'left', font = FONT, stroke = '#000', weight = '700') {
    ctx.save();
    ctx.font = font === MISAKI ? `${size}px ${MISAKI}` : `${weight} ${size}px ${font}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineWidth = Math.max(2, size * 0.18); ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    ctx.restore();
  }
  function bar(x0, x1, y, h, frac, chip, side, fromRight, p) {
    const w = x1 - x0;
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(x0 - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x0, y, w, h);
    const fx = f => fromRight ? x1 - w * f : x0;
    // 白い残像（ダメージを食らった分が遅れて縮む）
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(fx(chip), y, w * chip, h);
    ctx.fillStyle = COL_D[side];
    ctx.shadowColor = COL[side]; ctx.shadowBlur = 8;
    ctx.fillRect(fx(frac), y, w * frac, h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(fx(frac), y, w * frac, h * 0.35);
    ctx.restore();
    // 駒の名前と体力（数字は美咲のドット）
    const u = unit(), v = Math.max(0, Math.round(frac * 100));
    const nameX = fromRight ? x1 - 4 : x0 + 4, numX = fromRight ? x0 + 4 : x1 - 4;
    text(label(p), nameX, y + h / 2 + 1, Math.round(h * 0.95), '#ffffff', fromRight ? 'right' : 'left');
    text(String(v), numX, y + h / 2 + 1, 16, '#ffffff', fromRight ? 'left' : 'right', MISAKI);
  }

  // ===== 1コマ =====
  function frame() {
    requestAnimationFrame(frame);
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!resize()) return;
    const u = unit();

    // どの試合を映すか
    if (seenG !== G) { seenG = G; cur = null; parts = []; rings = []; slashes = []; beams = []; texts = []; }
    if (G) {
      if (cur && !cur.end && !G.grapples.includes(cur.g)) cur.end = cur.end || { t: now(), loser: null, winner: null }; // 知らせが来なかったとき
      if (cur && cur.end && now() - cur.end.t > 2.2) cur = null;
      // 王の試合が始まったら、いまの試合の途中でも切り替える
      if (cur && !cur.end && !isKing(cur.g) && G.grapples.some(isKing)) cur = null;
      if (!cur && !G.over) {
        const nx = pickNext();
        if (nx) { cur = nx; glitch = 0.3; flash = 0.35; flashColor = '255,255,255'; }
      }
    }

    // 体力の見せ方：表の体力へ素早く、白い残像はゆっくり
    if (cur) {
      const hl = cur.end ? cur.L.hp : cur.L.hp, hr = cur.R.hp;
      cur.hpL += (hl - cur.hpL) * Math.min(1, dt * 14);
      cur.hpR += (hr - cur.hpR) * Math.min(1, dt * 14);
      cur.chipL = Math.max(cur.hpL, cur.chipL - 38 * dt);
      cur.chipR = Math.max(cur.hpR, cur.chipR - 38 * dt);
      // 押されていく：体力が少ないほうが後ろへ下がる。2人とも同じ向きにずれる
      const push = (cur.hpL - cur.hpR) / 100 * 0.15 * W;
      let tl = W * 0.31 + push, tr = W * 0.69 + push;
      tl = Math.max(W * 0.16, Math.min(tl, W * 0.5 - 14 * u)); tr = Math.min(W * 0.84, Math.max(tr, W * 0.5 + 14 * u));
      if (!cur.init) { cur.init = true; cur.xl = -W * 0.1; cur.xr = W * 1.1; }
      const k = Math.min(1, dt * 7);
      cur.xl += (tl - cur.xl) * k; cur.xr += (tr - cur.xr) * k;
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0.1) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.0005, dt); }
    background(u, t / 1000);
    if (cur) drawMatch(u, dt); else standby(u, t / 1000);
    effects(u, dt);
    ctx.restore();

    // 全体の演出：フラッシュ・走査線・枠
    if (flash > 0.01) { ctx.fillStyle = `rgba(${flashColor},${flash})`; ctx.fillRect(0, 0, W, H); flash *= Math.pow(0.002, dt); }
    if (glitch > 0) {                                   // 試合が切り替わった瞬間のノイズ
      glitch -= dt;
      for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(120,255,160,${0.12 + Math.random() * 0.2})`; ctx.fillRect(0, Math.random() * H, W, 1 + Math.random() * 4 * u); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }

  function background(u, ts) {
    // 背景色は塗らない（ページの背景がそのまま見える）。地面のあたりの青・赤だけ
    // 左は青、右は赤の気配：地面のあたり（下から3割）だけ。下が濃く、上へ向かって消える
    const w = Math.round(W * DPR), h = Math.round(H * DPR);
    if (!glowC || glowC.width !== w || glowC.height !== h) {
      glowC = document.createElement('canvas'); glowC.width = w; glowC.height = h;
      const c = glowC.getContext('2d');
      const gl = c.createLinearGradient(0, 0, w * 0.62, 0);
      gl.addColorStop(0, 'rgba(47,123,255,1)'); gl.addColorStop(1, 'rgba(47,123,255,0)');
      c.fillStyle = gl; c.fillRect(0, 0, w, h);
      const gr = c.createLinearGradient(w, 0, w * 0.38, 0);
      gr.addColorStop(0, 'rgba(255,51,68,1)'); gr.addColorStop(1, 'rgba(255,51,68,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'destination-in';
      const gv = c.createLinearGradient(0, h, 0, h * 0.73);
      gv.addColorStop(0, 'rgba(0,0,0,0.5)'); gv.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gv; c.fillRect(0, 0, w, h);
    }
    ctx.drawImage(glowC, 0, 0, W, H);
  }

  function header(u, ts, idx, total) {
    // 上の段：LIVE（赤い点が点滅）と、同時の試合の何番目か。左右の角には音・×のボタンが重なる
    if (total > 1) text(`${idx}/${total}`, W / 2, 16 * u, 16, '#a8ffc4', 'center', MISAKI, '#000');
  }

  function drawMatch(u, dt) {
    const ts = performance.now() / 1000, tn = now();
    const g = cur.g, L = cur.L, R = cur.R;
    const total = G.grapples.length, idx = Math.max(1, G.grapples.indexOf(g) + 1);
    header(u, ts, cur.end ? 1 : idx, Math.max(total, 1));
    const intro = Math.min(1, (tn - cur.t0) / 0.5);

    // 体力バー（上）：キャラより後ろに描く（キャラが体力バーや数字の上に出る）。左が青、右が赤。真ん中に VS
    const by = 34 * u, bh = 17 * u, mid = W / 2;
    bar(14, mid - 20 * u, by, bh, cur.hpL / 100, cur.chipL / 100, 0, false, L);
    bar(mid + 20 * u, W - 14, by, bh, cur.hpR / 100, cur.chipR / 100, 1, true, R);
    text('VS', mid, by + bh / 2 + 1, 16, '#fff3b0', 'center', MISAKI, '#000');

    // 押し合いの矢印
    if (!cur.end) {
      const d = cur.hpL - cur.hpR;
      if (Math.abs(d) > 8) {
        const dir = d > 0 ? 1 : -1, side = d > 0 ? 0 : 1;
        const cx = (cur.xl + cur.xr) / 2, gy = H - 14 * u;
        for (let i = 0; i < 3; i++) {
          const ph = ((ts * 2.2 + i / 3) % 1);
          const x = cx + dir * (ph - 0.5) * 70 * u;
          ctx.save(); ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
          ctx.fillStyle = COL[side]; ctx.shadowColor = COL[side]; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.moveTo(x + dir * 8 * u, gy - 6 * u); ctx.lineTo(x - dir * 5 * u, gy - 14 * u); ctx.lineTo(x - dir * 5 * u, gy + 2 * u); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
    }

    // 助太刀：後ろに小さく並べる
    const sup = (list, isL) => {
      const arr = cur.end ? [] : list.slice(0, 3);
      arr.forEach((p, i) => {
        if (!cur.seen.has(p)) cur.seen.set(p, tn);
        const age = tn - cur.seen.get(p);
        const base = isL ? cur.xl : cur.xr;
        let x = base + (isL ? -1 : 1) * (42 + i * 22) * u + (isL ? -1 : 1) * (1 - Math.min(1, age / 0.3)) * 30 * u;
        x = Math.max(16 * u, Math.min(W - 16 * u, x));
        const y = H - (12 + (i % 2) * 7) * u;
        const struck = tn - (p._ls || -9) < 0.35;
        const k = 0.34 * 160 * u / 148 * sizeOf(p) * (struck ? 1.08 : 1);
        drawSprite(p, struck ? 'attack-2' : 'idle', x, y, k, isL ? 1 : -1, 0.92, COL[p.side]);
        // 「助」の札（現れた直後は大きく弾む）
        const pop = Math.max(0, 1 - age / 0.35);
        text('助', x, y - 56 * u * 0.6 - 8 * u - pop * 6 * u, Math.round((11 + pop * 7) * u), '#3ee08f', 'center');
      });
      if (!cur.end && list.length > 3) text('+' + (list.length - 3), (isL ? cur.xl - 46 * u : cur.xr + 46 * u), H - 52 * u, 16, '#3ee08f', 'center', MISAKI);
    };
    const lSup = g.atkSups.concat(g.defSups).filter(p => p.side === 0);
    const rSup = g.atkSups.concat(g.defSups).filter(p => p.side === 1);
    sup(lSup, true); sup(rSup, false);

    // 戦っている2人
    const fighter = (p, isL, isAtk) => {
      const pos = fighterPos(isL);
      let pose, dx = 0, white = 0;
      const sinceHit = tn - (p._lh || -9), sinceStrike = tn - (p._ls || -9);
      if (cur.end) {
        pose = p === cur.end.loser ? 'ko' : 'idle';
        if (p === cur.end.loser) dx = (isL ? -1 : 1) * Math.min(1, (tn - cur.end.t) / 0.5) * 22 * u;
      } else if (intro < 0.6) pose = 'idle';
      else if (sinceHit < 0.45) { pose = 'defense-1'; white = 1 - sinceHit / 0.18; dx = (isL ? -1 : 1) * (1 - sinceHit / 0.45) * 7 * u; }
      else if (isAtk) {
        pose = sinceStrike < 0.6 ? 'attack-2' : 'attack-1';
        if (sinceStrike < 0.5) dx = (isL ? 1 : -1) * Math.sin(Math.PI * Math.min(1, sinceStrike / 0.5)) * 12 * u;   // 踏み込む
      } else pose = 'defense-2';
      const breath = cur.end && p !== cur.end.loser ? -Math.abs(Math.sin(ts * 5)) * 5 * u : 0;
      const k = 100 * u / 148 * sizeOf(p);
      drawSprite(p, pose, pos.x + dx, pos.y + breath, k, isL ? 1 : -1, 1, COL[p.side], white);
    };
    // 手前（組み合いの上に乗った駒）を後から描く
    if (cur.atkIsL) { fighter(R, false, false); fighter(L, true, true); } else { fighter(L, true, false); fighter(R, false, true); }

    // 助太刀の光の筋
    for (const b of beams) {
      const f = Math.min(1, (tn - b.t0) / b.dur);
      const sx = b.from.side === 0 ? cur.xl : cur.xr, tx = b.to.side === 0 ? cur.xl : cur.xr;
      const ix = sx + (b.from.side === 0 ? -1 : 1) * 42 * u, iy = H - 40 * u;
      const x = ix + (tx - ix) * f, y = iy + ((H - 52 * u) - iy) * f - Math.sin(Math.PI * f) * 22 * u;
      ctx.save(); ctx.globalAlpha = 1 - f * 0.3;
      ctx.strokeStyle = COL[b.side]; ctx.lineWidth = 3 * u; ctx.shadowColor = COL[b.side]; ctx.shadowBlur = 12;
      const f0 = Math.max(0, f - 0.25);
      const x0 = ix + (tx - ix) * f0, y0 = iy + ((H - 52 * u) - iy) * f0 - Math.sin(Math.PI * f0) * 22 * u;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3 * u, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    beams = beams.filter(b => tn - b.t0 < b.dur);
  }

  // 組み合いがないとき：王が向かい合って待つ
  function standby(u, ts) {
    header(u, ts, 0, 0);
    if (!G) return;
    const ks = [G.pieces.find(p => p.side === 0 && p.type === 'OU'), G.pieces.find(p => p.side === 1 && p.type === 'OU')];
    ks.forEach((p, i) => {
      const k = 92 * u / 148 * sizeOf(p);
      if (!p) return;
      const bob = Math.sin(ts * 2 + i) * 1.5 * u;
      drawSprite(p, 'idle', i === 0 ? W * 0.27 : W * 0.73, H - 12 * u + bob, k, i === 0 ? 1 : -1, 0.6, COL[i]);
    });
  }

  // 火花・衝撃波・斬撃・文字
  function effects(u, dt) {
    const tn = now();
    for (const p of parts) {
      p.life += dt;
      if (p.life < 0) continue;
      p.vy += 260 * u * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - p.life / p.max;
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); ctx.restore();
    }
    parts = parts.filter(p => p.life < p.max);
    for (const r of rings) {
      const f = (tn - r.t) / r.max;
      if (f < 0 || f > 1) continue;
      ctx.save(); ctx.globalAlpha = 1 - f; ctx.strokeStyle = r.color; ctx.lineWidth = 4 * u * (1 - f) + 1; ctx.shadowColor = r.color; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.2 + 0.8 * f), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    rings = rings.filter(r => tn - r.t < r.max);
    for (const s of slashes) {
      const f = (tn - s.t) / s.max;
      if (f < 0 || f > 1) continue;
      const len = s.len * Math.min(1, f * 3), tail = s.len * Math.max(0, f * 1.4 - 0.4);
      ctx.save(); ctx.globalAlpha = 1 - f * f; ctx.strokeStyle = s.color; ctx.lineWidth = 3.5 * u; ctx.lineCap = 'round'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(s.ang) * (tail - s.len / 2), s.y + Math.sin(s.ang) * (tail - s.len / 2));
      ctx.lineTo(s.x + Math.cos(s.ang) * (len - s.len / 2), s.y + Math.sin(s.ang) * (len - s.len / 2));
      ctx.stroke(); ctx.restore();
    }
    slashes = slashes.filter(s => tn - s.t < s.max);
    for (const tx of texts) {
      const f = (tn - tx.t) / tx.max;
      if (f < 0 || f > 1) continue;
      const pop = f < 0.12 ? 2.4 - 1.4 * (f / 0.12) : 1;           // ドンと大きく出て縮む
      const a = f > 0.8 ? 1 - (f - 0.8) / 0.2 : 1;
      ctx.save(); ctx.globalAlpha = a;
      ctx.shadowColor = tx.glow; ctx.shadowBlur = 24;
      const size = Math.round(tx.size * u * pop / 8) * 8 || 8;
      text(tx.text, W / 2, H * 0.5, size, tx.color, 'center', MISAKI, tx.glow);
      ctx.restore();
    }
    texts = texts.filter(t => tn - t.t < t.max);
  }

  // 盤の上の駒に重ねる、薄く大きなキャラ（別のキャンバスに描く）。bottom の位置に足、高さ height
  function figure(c, p, pose, x, bottom, height, face, alpha, light) {
    const im = img(baseName(p), pose);
    if (!im.complete || !im.naturalWidth) return;
    const k = height / im.naturalHeight, w = im.naturalWidth * k;
    c.save();
    c.translate(x, bottom); c.scale(face, 1); c.globalAlpha = alpha;
    c.drawImage(tint(im, baseName(p) + '-' + pose + '-' + (light ? 'l' : 'd') + p.side, (light ? COL : COL_D)[p.side]) || im, -w / 2, -height, w, height);   // 盤の上は、濃い青・赤の線
    c.restore();
  }
  // スタート画面の題名の左右：王（青）と玉（赤）
  function titleFigs() {
    const L = document.getElementById('figL'), R = document.getElementById('figR');
    if (!L || !R) return;
    const dpr = window.devicePixelRatio || 1;
    const draw = (cv, p, face) => {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return false;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const im = img(baseName(p), 'idle');
      if (!im.complete || !im.naturalWidth) return false;
      c.shadowColor = COL[p.side]; c.shadowBlur = 10;
      figure(c, p, 'idle', w / 2, h - 4, h - 8, face, 0.5, true);   // 半透明
      return true;
    };
    let tries = 0;
    const go = () => {
      const a = draw(L, { type: 'OU', side: 0, promoted: false }, 1), b = draw(R, { type: 'OU', side: 1, promoted: false }, -1);
      if (!(a && b) && tries++ < 40) setTimeout(go, 150);
    };
    go();
    window.addEventListener('resize', () => { tries = 0; go(); });
  }
  titleFigs();
  requestAnimationFrame(frame);
  return { strike, hit, end, figure };
})();
