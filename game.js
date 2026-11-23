'use strict';

// ===== 設定（遊んで調整する数字） =====
// 時間はすべて U（3秒）の倍数。U を変えるだけで、ゲーム全体の速さをまとめて変えられる
const U = 3;
const CFG = {
  W: 7, H: 7,
  MOVE_TIME: 1 * U,            // 移動（どの駒も同じ）          3秒
  ROTATE_TIME: 3 * U,          // 90度回転                        9秒
  ROTATE_TIME_PROMOTED: 2 * U, // 成った駒の回転                  6秒
  COOLDOWN: 1 * U,             // 動き終わったあとの休み          3秒
  KING_COOLDOWN: 2 * U,        // 王の休み（倍）                  6秒
  PROMOTE_TIME: 2 * U,         // 敵陣で止まっていると成るまで    6秒
  COUNTDOWN: 2 * U,            // 試合前のカウントダウン          6秒
  TICK: U / 3,                 // 組み合いの1拍（▲が飛ぶ間隔）    1秒
  HANDS: 3,                    // 同時に動かせる（回せる）駒の数
  HIT: 10,                     // 乗られた瞬間の減り（王も同じ）
  BASE: 10,                    // 乗った駒が、1拍ごとに乗られた駒へ与えるダメージ
  SUP: 10,                     // 助太刀の▲1発のダメージ（味方の回復はしない）。助太刀は何体でも入れる
  SHOT_TIME: 0.35,             // ▲が飛んで当たるまで（見た目だけ）
};

// COM の強さ（人間らしさの制限）。時間はゲーム内の秒
//  think : 考えて1手指す間隔（＋ jitter のばらつき）
//  react : 相手が動き出してから、それに気づくまで
//  notice: 自分の駒が狙われているのに気づく確率（見落としがある）
//  hands : 同時に動かす駒の数の上限（人が一度に気を配れる数）
//  aggr  : 攻められる場面で、実際に攻めに行く確率（低いと、好機を見逃す）
//  help  : 味方の組み合いに助太刀を送る確率
//  speed : 時間の進む速さ（0.5 = 1/2。移動3秒が実際には6秒になる）
const DIFF = {
  easy:   { think: 2.8, jitter: 1.2, react: 1.4, notice: 0.4, hands: 2, aggr: 0.35, help: 0.3, speed: 1 },
  easy2:  { think: 2.8, jitter: 1.2, react: 1.4, notice: 0.4, hands: 2, aggr: 0.35, help: 0.3, speed: 0.5 },  // おそい やさしい
  normal: { think: 2.0, jitter: 0.9, react: 1.0, notice: 0.6, hands: 2, aggr: 0.65, help: 0.6, speed: 1 },
  hard:   { think: 1.3, jitter: 0.7, react: 0.7, notice: 0.8, hands: 2, aggr: 1.0, help: 1.0, speed: 1 },
};

// ===== 駒の動き（前 = (0,-1)、右 = (1,0) として書き、向きで回す） =====
const KING_STEPS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const GOLD_STEPS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[0,1]];
const ORTHO = [[0,-1],[1,0],[0,1],[-1,0]];
const DIAG = [[-1,-1],[1,-1],[1,1],[-1,1]];
const MOVES = {
  FU: { steps: [[0,-1]], rays: [] },
  KY: { steps: [], rays: [[0,-1]] },
  KE: { steps: [[-1,-2],[1,-2]], rays: [] },
  GI: { steps: [[-1,-1],[0,-1],[1,-1],[-1,1],[1,1]], rays: [] },
  KI: { steps: GOLD_STEPS, rays: [] },
  OU: { steps: KING_STEPS, rays: [] },
  HI: { steps: [], rays: ORTHO },
  KA: { steps: [], rays: DIAG },
  RY: { steps: DIAG, rays: ORTHO },
  UM: { steps: ORTHO, rays: DIAG },
};
const LABEL = { FU:'歩', KY:'香', KE:'桂', GI:'銀', KI:'金', OU:'王', HI:'飛', KA:'角' };
const PLABEL = { FU:'と', KY:'杏', KE:'圭', GI:'全', HI:'龍', KA:'馬' };
const VALUE = { FU:1, KY:3, KE:3, GI:5, KI:6, KA:8, HI:9, OU:50 };

function moveSet(p) {
  if (!p.promoted) return MOVES[p.type];
  if (p.type === 'HI') return MOVES.RY;
  if (p.type === 'KA') return MOVES.UM;
  return MOVES.KI;
}
function label(p) {
  if (p.type === 'OU') return p.side === 0 ? '王' : '玉';
  return p.promoted ? PLABEL[p.type] : LABEL[p.type];
}
// 向き dir: 0=上 1=右 2=下 3=左（時計回り）
function rot(dx, dy, dir) {
  for (let i = 0; i < dir; i++) { const t = dx; dx = -dy; dy = t; }
  return [dx, dy];
}
const inB = (x, y) => x >= 0 && y >= 0 && x < CFG.W && y < CFG.H;

// ===== 状態 =====
let G = null;

function newGame(diff, watch = false) {
  G = {
    pieces: [], grapples: [], fx: [], shots: [], sparks: [], rings: [], pops: [], time: 0, over: false, winner: -1,
    diff, watch, speed: DIFF[diff].speed, realTime: 0, cpuT: 2.0, cpuT0: 2.3, sel: null,
    countdown: CFG.COUNTDOWN, startFlash: 0, nextId: 1, captured: [[], []],
  };
  const back0 = ['KY','KE','GI','OU','KI','KE','KY'];
  const mid0  = ['FU','HI','FU',null,'FU','KA','FU'];
  const back1 = ['KY','KE','KI','OU','GI','KE','KY'];
  const mid1  = ['FU','KA','FU',null,'FU','HI','FU'];
  for (let x = 0; x < CFG.W; x++) {
    addPiece(0, back0[x], x, 6, 0);
    addPiece(0, mid0[x], x, 5, 0);
    addPiece(1, back1[x], x, 0, 2);
    addPiece(1, mid1[x], x, 1, 2);
  }
}
function addPiece(side, type, x, y, dir) {
  if (!type) return;
  G.pieces.push({
    id: G.nextId++, side, type, x, y, dir, promoted: false, hp: 100,
    state: 'idle', promoT: 0, cool: 0, fx: 0, fy: 0, tx: 0, ty: 0, t: 0, dur: 0, rotD: 0,
  });
}

function occupants(x, y) {
  return G.pieces.filter(p => p.state !== 'moving' && p.x === x && p.y === y);
}
function reservedBy(side, x, y) {
  return G.pieces.some(p => p.side === side && p.state === 'moving' && p.tx === x && p.ty === y);
}
function enemyHeading(side, x, y) {
  return G.pieces.some(p => p.side !== side && p.state === 'moving' && p.tx === x && p.ty === y);
}
function handsUsed(side) {
  return G.pieces.filter(p => p.side === side && (p.state === 'moving' || p.state === 'rotating')).length;
}
function canAct(p) {
  if (p.cool > 0) return false; // 休み中
  return p.state === 'rotating' || handsUsed(p.side) < CFG.HANDS;
}

// 空中での正面衝突：同じ直線を逆向きに飛んでいる相手の駒と、通り道が重なる動きは禁止
// （例：飛んでくる金と、王が入れ替わるように逃げる）。桂は跳ぶので関係なし
const jumps = p => p.type === 'KE' && !p.promoted;
function headOn(p, x, y) {
  if (jumps(p)) return false;
  const ax = x - p.x, ay = y - p.y;
  const len2 = ax * ax + ay * ay;
  for (const q of G.pieces) {
    if (q.side === p.side || q.state !== 'moving' || jumps(q)) continue;
    const bx = q.tx - q.fx, by = q.ty - q.fy;
    if (ax * by - ay * bx !== 0 || ax * bx + ay * by >= 0) continue;   // 平行で逆向きか
    if ((q.fx - p.x) * ay - (q.fy - p.y) * ax !== 0) continue;        // 同じ直線上か
    // 相手の今の位置から行き先までを、自分の通り道の上に投影して重なりを見る
    const f = Math.min(1, q.t / q.dur);
    const cx = q.fx + bx * f, cy = q.fy + by * f;
    const t0 = ((cx - p.x) * ax + (cy - p.y) * ay) / len2;
    const t1 = ((q.tx - p.x) * ax + (q.ty - p.y) * ay) / len2;
    if (Math.max(0, Math.min(t0, t1)) < Math.min(1, Math.max(t0, t1))) return true;
  }
  return false;
}

// 動き出した駒が、まだ元のマスから抜けきっていないか（1マス分離れるまでは、そのマスはふさがったまま）
// 歩や金のように1マスだけ動く駒は、着くまでずっとふさがる。飛車が4マス動くなら、最初の1マス分の間だけ
function leavingFrom(q) {
  const len = Math.max(Math.abs(q.tx - q.fx), Math.abs(q.ty - q.fy));
  return (q.t / q.dur) * len < 1;
}
function stillLeaving(x, y) {
  return G.pieces.some(q => q.state === 'moving' && q.fx === x && q.fy === y && leavingFrom(q));
}

// 行き先の候補（通り道は今の時点で判定）
function legalTargets(p) {
  const res = [];
  const ms = moveSet(p);
  const consider = (x, y) => {
    const blocked = headOn(p, x, y); // 空中でぶつかるので行けない
    if (stillLeaving(x, y)) return false; // 抜けきっていないマスは入れないし、通れない
    const occ = occupants(x, y);
    if (occ.length === 0) {
      if (!reservedBy(p.side, x, y) && !blocked) res.push({ x, y, cap: null });
      return true;
    }
    if (!blocked && occ.length === 1 && occ[0].side !== p.side && occ[0].state !== 'grappled') {
      res.push({ x, y, cap: occ[0] });
    }
    return false;
  };
  for (const [sx, sy] of ms.steps) {
    const [dx, dy] = rot(sx, sy, p.dir);
    const x = p.x + dx, y = p.y + dy;
    if (inB(x, y)) consider(x, y);
  }
  for (const [sx, sy] of ms.rays) {
    const [dx, dy] = rot(sx, sy, p.dir);
    let x = p.x + dx, y = p.y + dy;
    while (inB(x, y)) {
      if (!consider(x, y)) break;
      x += dx; y += dy;
    }
  }
  return res;
}

// (x,y) に dir 向きで立ったとき、隣の (cx,cy) に利いているか
function canReachFrom(p, x, y, dir, cx, cy) {
  const ddx = cx - x, ddy = cy - y;
  if (Math.max(Math.abs(ddx), Math.abs(ddy)) !== 1) return false;
  const ms = moveSet(p);
  for (const s of ms.steps.concat(ms.rays)) {
    const [dx, dy] = rot(s[0], s[1], dir);
    if (dx === ddx && dy === ddy) return true;
  }
  return false;
}
// 自分の駒 p が (x,y) へ動いたら、自軍が関わる組み合いの助太刀になるか
function helpsAt(p, x, y) {
  return G.grapples.some(g => g.atk !== p && (g.atk.side === p.side || g.def.side === p.side) &&
    canReachFrom(p, x, y, p.dir, g.x, g.y));
}
function supporters(side, cx, cy, exclude) {
  return G.pieces.filter(p => p.side === side && p.state === 'idle' && p !== exclude &&
    canReachFrom(p, p.x, p.y, p.dir, cx, cy));
}

// ===== 行動 =====
function startMove(p, t) {
  if (p.state === 'grappled') {
    const g = G.grapples.find(g => g.atk === p);
    if (!g) return;
    G.grapples = G.grapples.filter(q => q !== g);
    g.def.state = 'idle';
  }
  p.state = 'moving';
  p.noticed = undefined;
  p.fx = p.x; p.fy = p.y; p.tx = t.x; p.ty = t.y;
  p.t = 0; p.promoT = 0;
  p.dur = CFG.MOVE_TIME;
}
function startRotate(p, d) {
  p.state = 'rotating';
  p.rotD = d; p.t = 0;
  p.dur = p.promoted ? CFG.ROTATE_TIME_PROMOTED : CFG.ROTATE_TIME;
}

function cooldownFor(p) {
  return p.type === 'OU' ? CFG.KING_COOLDOWN : CFG.COOLDOWN;
}
function arrive(p) {
  p.cool = cooldownFor(p);
  const occ = occupants(p.tx, p.ty);
  if (occ.length === 0) { p.x = p.tx; p.y = p.ty; p.state = 'idle'; return; }
  if (occ.length === 1 && occ[0].side !== p.side && occ[0].state !== 'grappled') {
    p.x = p.tx; p.y = p.ty;
    startGrapple(p, occ[0]);
    return;
  }
  // 乗れない（組み合い中のマスなど）→ 近くの空きマスへはじかれる
  const c = nearestEmpty(p.fx, p.fy);
  p.x = c.x; p.y = c.y; p.state = 'idle';
  addFx(p.x, p.y, 'はじかれた', '#aab4c0');
}
function nearestEmpty(x0, y0) {
  for (let r = 0; r < CFG.W; r++) {
    for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
      if (!inB(x, y) || Math.max(Math.abs(x - x0), Math.abs(y - y0)) !== r) continue;
      if (occupants(x, y).length === 0 && !reservedBy(0, x, y) && !reservedBy(1, x, y) && !stillLeaving(x, y)) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}

function startGrapple(a, d) {
  a.state = 'grappled';
  d.state = 'grappled';
  d.hp -= CFG.HIT;
  // fx,fy：乗った駒がどこから来たか（攻撃の向きを描くため）
  const g = { x: d.x, y: d.y, fx: a.fx, fy: a.fy, atk: a, def: d, atkSups: [], defSups: [], tick: 0 };
  G.grapples.push(g);
  // 乗った瞬間の一撃：火花
  const pos = grapplePos(g);
  hitEffect(d, pos.dx, pos.dy, CLR.side[a.side], 1.6);
  popNumber(pos.dx, pos.dy, -CFG.HIT);
  if (d.hp <= 0) resolve(g, true);
}

// 組み合い中の2つの駒の位置（マス単位）。正面から見て縦に重ねる：
// 乗られた駒が奥（上）、乗った駒が手前（下）で上に重なる。どちらの字も見える間隔
// 相手（CPU・赤）の駒がいつも奥（上）、自分（青）の駒がいつも手前（下）で上に重なる
const G_TOP = -0.3, G_BOTTOM = 0.26;
function grapplePos(g) {
  const atkTop = g.atk.side === 1;
  return {
    ax: g.x + 0.5, ay: g.y + 0.5 + (atkTop ? G_TOP : G_BOTTOM),
    dx: g.x + 0.5, dy: g.y + 0.5 + (atkTop ? G_BOTTOM : G_TOP),
  };
}
// 組み合いでのその軍の駒の体力
function grappleValue(g, side) {
  return side === g.def.side ? g.def.hp : g.atk.hp;
}

// 1回分の攻撃：乗った駒が乗られた駒へ▲を撃つ（乗られた駒は撃ち返せない。一方的に受けるだけ）。
// 助太刀はそれぞれ相手の駒へ▲を撃つ。乗った駒を削れるのは守りの助太刀だけ。
// ダメージは減るだけで、回復はしない。体力が0になった駒が取られる
function fireTick(g) {
  const pos = grapplePos(g);
  const ca = CLR.side[g.atk.side], cd = CLR.side[g.def.side];
  const hit = (p, n) => () => damagePiece(g, p, n);
  shoot(pos.ax, pos.ay, pos.dx, pos.dy, ca, g.def, hit(g.def, CFG.BASE));
  for (const sp of g.atkSups) shoot(sp.x + 0.5, sp.y + 0.5, pos.dx, pos.dy, ca, g.def, hit(g.def, CFG.SUP));
  for (const sp of g.defSups) shoot(sp.x + 0.5, sp.y + 0.5, pos.ax, pos.ay, cd, g.atk, hit(g.atk, CFG.SUP));
}
function shoot(x0, y0, x1, y1, color, target, onHit) {
  // 遠くから撃つほど高い山なりにして、味方の駒の上を越えていくのが見えるように
  const arc = 0.35 + 0.45 * Math.hypot(x1 - x0, y1 - y0);
  G.shots.push({ x0, y0, x1, y1, color, target, onHit, arc, t: 0 });
}
function damagePiece(g, p, n) {
  if (!G.grapples.includes(g)) return;
  const pos = grapplePos(g);
  const isDef = p === g.def;
  popNumber((isDef ? pos.dx : pos.ax) + (Math.random() - 0.5) * 0.3, isDef ? pos.dy : pos.ay, -n);
  p.hp = Math.max(0, p.hp - n);
  if (p.hp <= 0) resolve(g, isDef); // 乗られた駒が0なら乗った側の勝ち、乗った駒が0なら乗られた側の勝ち
}
// ダメージの数字（−10 なら赤、+5 なら緑）が上へ飛び出す
function popNumber(x, y, amount) {
  const v = Math.round(amount);
  G.pops.push({ x, y, text: (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v), color: v >= 0 ? '#3ee08f' : '#ff4757', t: 0 });
}
// 当たった時の演出：まず駒が白く光り、少し遅れて火花がはじける
const SPARK_DELAY = 0.09;
// 火花の色：やられた側の軍の色に寄せる（白や黄色も混ぜる）
const SPARK_COLORS = [
  ['#2f7bff', '#6fb0ff', '#ffffff', '#fff3b0', '#a8d4ff', '#4f95ff'],  // 青がやられた
  ['#ff3344', '#ff6a5c', '#ffffff', '#fff3b0', '#ffb36b', '#ff4f4f'],  // 赤がやられた
];
function hitEffect(target, x, y, color, power = 1) {
  if (target) target.flash = 1;
  const cols = target ? SPARK_COLORS[target.side] : [color, '#ffffff', '#fff3b0'];
  spawnSparks(x, y, cols, Math.round(22 * power), SPARK_DELAY);
  G.rings.push({ x, y, color: cols[0], t: -SPARK_DELAY, max: 0.22 + 0.05 * power, r: 0.4 + 0.15 * power });
}
function spawnSparks(x, y, cols, n, delay = 0) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.4 + Math.random() * 2.6;
    G.sparks.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: -delay * (0.8 + Math.random() * 0.4),  // 0になるまでは出さない
      max: 0.18 + Math.random() * 0.22,
      size: 0.04 + Math.random() * 0.05,
      color: cols[i % cols.length],
    });
  }
}
function resolve(g, atkWins) {
  G.grapples = G.grapples.filter(q => q !== g);
  if (atkWins) {
    g.atk.state = 'idle';
    capture(g.def, g.atk.side);
  } else {
    g.def.state = 'idle';
    capture(g.atk, g.def.side);
  }
}
function capture(p, by) {
  G.pieces = G.pieces.filter(q => q !== p);
  G.captured[by].push(p.type);
  if (G.sel === p) G.sel = null;
  addFx(p.x, p.y, '取', CLR.side[by]);
  if (p.type === 'OU') endGame(by);
}
function addFx(x, y, text, color) { G.fx.push({ x, y, text, color, t: 0 }); }

// ===== 更新 =====
function update(realDt) {
  if (!G || G.over) return;
  // 始まる前のカウントダウン（実際の秒）
  if (G.countdown > 0) {
    G.countdown -= realDt;
    if (G.countdown <= 0) G.startFlash = 0.8;
    return;
  }
  if (G.startFlash > 0) G.startFlash -= realDt;
  G.realTime += realDt;
  const dt = realDt * G.speed;
  G.time += dt;

  for (const p of [...G.pieces]) {
    if (p.cool > 0 && p.state !== 'moving') p.cool = Math.max(0, p.cool - dt);
    if (p.state === 'moving') {
      p.t += dt;
      if (p.t >= p.dur) arrive(p);
    } else if (p.state === 'rotating') {
      p.t += dt;
      if (p.t >= p.dur) { p.dir = (p.dir + p.rotD + 4) % 4; p.state = 'idle'; }
    }
  }
  if (G.over) return;

  updateGrapples(dt);
  if (G.over) return;

  // 成り：敵陣で止まっていると溜まる
  for (const p of G.pieces) {
    if (p.promoted || p.type === 'OU' || p.type === 'KI') continue;
    const inZone = p.side === 0 ? p.y <= 1 : p.y >= CFG.H - 2;
    if (p.state === 'moving' || !inZone) { p.promoT = 0; continue; }
    if (p.state === 'grappled') continue;
    p.promoT += dt;
    if (p.promoT >= CFG.PROMOTE_TIME) {
      p.promoted = true;
      addFx(p.x, p.y, '成', '#c98cff');
    }
  }

  for (const f of G.fx) f.t += realDt;
  G.fx = G.fx.filter(f => f.t < 1.2);

  // ▲の弾
  for (const sh of [...G.shots]) {
    sh.t += dt;
    if (sh.t >= CFG.SHOT_TIME) {
      G.shots = G.shots.filter(q => q !== sh);
      hitEffect(G.pieces.includes(sh.target) ? sh.target : null, sh.x1, sh.y1, sh.color, 1);
      if (sh.onHit) sh.onHit();
      if (G.over) return;
    }
  }
  // 火花と、当たった駒の光
  for (const sp of G.sparks) {
    sp.life += realDt;
    if (sp.life < 0) continue;
    sp.x += sp.vx * realDt; sp.y += sp.vy * realDt;
    sp.vx *= 0.9; sp.vy *= 0.9;
  }
  G.sparks = G.sparks.filter(sp => sp.life < sp.max);
  for (const r of G.rings) r.t += realDt;
  G.rings = G.rings.filter(r => r.t < r.max);
  for (const p of G.pieces) if (p.flash > 0) p.flash = Math.max(0, p.flash - realDt * 3.5);
  for (const pp of G.pops) pp.t += realDt;
  G.pops = G.pops.filter(pp => pp.t < 1.0);

  // COM対戦では青（下）もCOMが動かす
  if (G.watch) {
    G.cpuT0 -= dt;
    if (G.cpuT0 <= 0) {
      cpuThink(0, G.diff);
      const d = DIFF[G.diff];
      G.cpuT0 = d.think + Math.random() * d.jitter;
    }
    if (G.over) return;
  }
  G.cpuT -= dt;
  if (G.cpuT <= 0) {
    cpuThink();
    const d = DIFF[G.diff];
    G.cpuT = d.think + Math.random() * d.jitter;
  }
}

function updateGrapples(dt) {
  // 助太刀：隣でそのマスへ動ける向きの駒は、何体でも入る（1つの駒が助太刀するのは1か所だけ）
  const used = new Set();
  const pickAll = (g, side) => {
    const list = [];
    for (const p of G.pieces) {
      if (p.side !== side || p.state !== 'idle' || used.has(p)) continue;
      if (canReachFrom(p, p.x, p.y, p.dir, g.x, g.y)) { used.add(p); list.push(p); }
    }
    return list;
  };
  for (const g of [...G.grapples]) {
    g.atkSups = pickAll(g, g.atk.side);
    g.defSups = pickAll(g, g.def.side);
    g.age = (g.age || 0) + dt;
    g.tick += dt;
    if (g.tick >= CFG.TICK) { g.tick -= CFG.TICK; fireTick(g); }
  }
}

// ===== CPU =====
function cpuThink(S = 1, dk = G.diff) {
  const D = DIFF[dk];
  const O = 1 - S;
  const fwd = S === 1 ? 1 : -1; // 前の向き（y が増える／減る）
  const free = Math.min(CFG.HANDS, D.hands) - handsUsed(S);
  if (free <= 0) return;
  const mine = G.pieces.filter(p => p.side === S);
  const ready = p => !(p.cool > 0); // 休み中でない

  const threat = new Set();
  for (const p of G.pieces) {
    if (p.side !== O || p.state === 'moving' || p.state === 'grappled') continue;
    for (const t of legalTargets(p)) threat.add(t.x + ',' + t.y);
  }
  const safeScore = (p, x, y) => {
    let s = 0;
    if (threat.has(x + ',' + y)) s -= VALUE[p.type] * 1.5 + 2;
    if (enemyHeading(S, x, y)) s -= 10;
    s += supporters(S, x, y, p).length * 1.5;
    return s;
  };
  const bestOf = (list, score) => {
    let best = null;
    for (const it of list) { const s = score(it); if (!best || s > best.s) best = { it, s }; }
    return best;
  };

  // 1. 飛んでくる駒を避ける
  let dodge = null;
  for (const t of G.pieces) {
    if (t.side !== O || t.state !== 'moving' || t.dur - t.t < 0.3) continue;
    // 人と同じく、動き出してすぐには気づかない。気づくかどうかは1回だけ決める（見落としたらそのまま）
    if (t.t < D.react) continue;
    t.noticed = t.noticed || {};
    if (t.noticed[S] === undefined) t.noticed[S] = Math.random() < D.notice;
    if (!t.noticed[S]) continue;
    const v = mine.find(p => (p.state === 'idle' || p.state === 'rotating') && p.x === t.tx && p.y === t.ty);
    if (!v) continue;
    const hit = CFG.HIT;
    if (v.type !== 'OU' && supporters(S, v.x, v.y, v).length > 0 && v.hp - hit > 30) continue; // 受けて立つ
    const pr = VALUE[v.type] + (v.hp < 60 ? 3 : 0);
    if (!dodge || pr > dodge.pr) dodge = { v, pr };
  }
  if (dodge && ready(dodge.v) && canAct(dodge.v)) {
    const b = bestOf(legalTargets(dodge.v).filter(o => !o.cap), o => safeScore(dodge.v, o.x, o.y) + Math.random());
    if (b) { startMove(dodge.v, b.it); return; }
  }

  // 2. 組み合いの手当て（加勢を送る／分が悪ければ離れる）
  for (const g of G.grapples) {
    const ourDef = g.def.side === S, ourAtk = g.atk.side === S;
    if (!ourDef && !ourAtk) continue;
    if ((g.age || 0) < D.react) continue; // 組み合いになったことに気づくまで
    // このままだと乗った駒が先に倒れるなら離れる
    const atkLoss = g.defSups.length * CFG.SUP, defLoss = CFG.BASE + g.atkSups.length * CFG.SUP;
    if (ourAtk && ready(g.atk) && atkLoss > 0 && g.atk.hp / atkLoss < g.def.hp / defLoss) {
      const b = bestOf(legalTargets(g.atk).filter(o => !o.cap), o => safeScore(g.atk, o.x, o.y) + Math.random());
      if (b) { startMove(g.atk, b.it); return; }
    }
    if ((ourDef || g.defSups.length > 0) && Math.random() < D.help) {
      const cands = [];
      for (const q of mine) {
        if (q.state !== 'idle' || q.type === 'OU' || !ready(q)) continue;
        for (const o of legalTargets(q)) {
          if (!o.cap && canReachFrom(q, o.x, o.y, q.dir, g.x, g.y)) cands.push({ q, o });
        }
      }
      const b = bestOf(cands, c => safeScore(c.q, c.o.x, c.o.y) - VALUE[c.q.type] * 0.2 + Math.random());
      if (b) { startMove(b.it.q, b.it.o); return; }
    }
  }

  if (free < 2) return; // 1手は守りに残しておく

  // 3. 攻める
  const atks = [];
  for (const p of mine) {
    if (p.state !== 'idle' || !ready(p)) continue;
    for (const o of legalTargets(p)) if (o.cap) atks.push({ p, o });
  }
  const a = bestOf(atks, ({ p, o }) => {
    const e = o.cap;
    // 着いたあとの撃ち合いで勝てるかを見積もる（助太刀の数で減る速さが変わる）
    const ourN = supporters(S, o.x, o.y, p).length, theirN = supporters(O, o.x, o.y, e).length;
    const atkLoss = theirN * CFG.SUP, defLoss = CFG.BASE + ourN * CFG.SUP;
    const win = atkLoss === 0 || p.hp / atkLoss > Math.max(0, e.hp - CFG.HIT) / defLoss;
    let s = VALUE[e.type] * 1.5 + (win ? 6 : -12) - VALUE[p.type] * 0.4 + Math.random() * 2;
    if (p.type === 'OU') s -= 15;
    return s;
  });
  if (a && a.s > 2.5 && Math.random() < D.aggr) { startMove(a.it.p, a.it.o); return; }

  // 4. 前へ出る
  if (Math.random() < 0.35) return;
  const advs = [];
  for (const p of mine) {
    if (p.state !== 'idle' || p.type === 'OU' || !ready(p)) continue;
    for (const o of legalTargets(p)) if (!o.cap) advs.push({ p, o });
  }
  const v = bestOf(advs, ({ p, o }) => {
    let s = (o.y - p.y) * fwd * 1.2 + safeScore(p, o.x, o.y) + Math.random() * 2.5;
    if (threat.has(p.x + ',' + p.y) && supporters(S, p.x, p.y, p).length === 0) s += 2;
    return s;
  });
  if (v && v.s > 0.5) startMove(v.it.p, v.it.o);
}

// ===== 描画 =====
const CLR = {
  // 駒以外はレトロフューチャーの緑（暗い緑〜明るい緑）
  board: '#010d06',
  line: 'rgba(63,220,120,0.22)',
  cross: 'rgba(120,255,160,0.65)',
  zone: ['rgba(63,220,120,0.07)', 'rgba(63,220,120,0.07)'],
  sel: '#5dff95',
  // 駒の文字：見やすい M PLUS 1 Code の太字（Google Fonts）。画面のほかの文字は美咲
  pieceFont: '"M PLUS 1 Code","Yu Gothic",sans-serif',
  side: ['#59a8ff', '#ff5c63'],   // 光る色（選択・矢印・札など）
  top: ['#10264d', '#4a1119'],    // 駒の上面：暗い青／暗い赤
  edge: ['#2f7bff', '#ff3344'],   // 駒の縁と断面（はっきりした青・赤）
  text: ['#dde3ec', '#ecdfe0'],   // 駒の文字：明るいグレー（ちょい青／ちょい赤）
  ptext: '#ffd24a',               // 成り駒の文字：金色
  font: '"Misaki","Yu Gothic","Meiryo",sans-serif',
};
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
let dpr = 1, cs = 60;

// 見た目の傾き（3Dエンジンは使わず、CSS の遠近変形で盤を手前に倒す）
const VIEW = {
  TILT: 30,          // 倒す角度（度）
  PERSPECTIVE: 2.2,  // 見る距離（盤の幅の何倍か）。小さいほど遠近が強い
};
const PIECE_THICK = 0.3; // 駒の厚み（駒の幅に対する割合）
function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(w * dpr);
  canvas.style.transform =
    `perspective(${canvas.offsetWidth * VIEW.PERSPECTIVE}px) rotateX(${VIEW.TILT}deg)`;
}

// 画面上の位置 → 盤のマス（CSS の変形を逆算する）
function screenToCell(clientX, clientY) {
  const box = canvas.parentElement.getBoundingClientRect(); // 変形していない外枠
  const bw = canvas.offsetWidth, bh = canvas.offsetHeight;
  const X = clientX - (box.left + bw / 2);
  const Y = clientY - (box.top + bh / 2);
  const P = bw * VIEW.PERSPECTIVE;
  const th = VIEW.TILT * Math.PI / 180;
  const v = Y * P / (P * Math.cos(th) + Y * Math.sin(th));
  const u = X * (P - v * Math.sin(th)) / P;
  const border = (bw - canvas.clientWidth) / 2;
  const lx = u + bw / 2 - border, ly = v + bh / 2 - border;
  return [Math.floor(lx / canvas.clientWidth * CFG.W), Math.floor(ly / canvas.clientHeight * CFG.H)];
}
new ResizeObserver(resize).observe(canvas);

const cellC = v => (v + 0.5) * cs;
// 美咲フォントは8ドット単位で並ぶので、文字の大きさを8の倍数にそろえる
const fpx = n => Math.max(8, Math.round(n / 8) * 8);
const pulse = (speed = 4) => 0.5 + 0.5 * Math.sin(performance.now() / 1000 * speed);

function drawPiece(p, px, py, ang, scale, alpha = 1, glow = null) {
  const s = cs * 0.84 * scale;
  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(0, -0.48 * s);
    ctx.lineTo(0.34 * s, -0.32 * s);
    ctx.lineTo(0.42 * s, 0.44 * s);
    ctx.lineTo(-0.42 * s, 0.44 * s);
    ctx.lineTo(-0.34 * s, -0.32 * s);
    ctx.closePath();
  };
  // 厚み（均一）：底から上面まで同じ形を少しずつずらして重ね、側面に見せる。
  // 本物の駒は幅の3割ほどの厚み。盤を倒した見え方に合わせて画面上のずれに直す。
  // 側面にも上面と同じ太さの輪郭を描き、横幅を上面とそろえる。
  const outline = Math.max(2, s * 0.05);
  const th = VIEW.TILT * Math.PI / 180;
  const d = s * 0.84 * PIECE_THICK * Math.tan(th);
  const steps = Math.max(1, Math.ceil(d));
  ctx.save();
  ctx.globalAlpha = alpha;
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = cs * 0.35; }
  ctx.fillStyle = CLR.edge[p.side];
  ctx.strokeStyle = CLR.edge[p.side];
  ctx.lineWidth = outline;
  ctx.lineJoin = 'miter';
  for (let i = 0; i <= steps; i++) {
    ctx.save();
    ctx.translate(px, py + d / 2 - d * i / steps);
    ctx.rotate(ang);
    shape();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0; // 光は一番下の層だけ
  }
  ctx.restore();

  ctx.save();
  ctx.translate(px, py - d / 2);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  shape();
  ctx.fillStyle = CLR.top[p.side];
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = CLR.edge[p.side];
  ctx.stroke();
  ctx.fillStyle = p.promoted ? CLR.ptext : CLR.text[p.side];
  ctx.font = `700 ${Math.round(s * 0.52)}px ${CLR.pieceFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label(p), 0, s * 0.07);
  // 体力が減るほど暗く。当たった瞬間は白く光る
  const dim = Math.max(0, (100 - p.hp) / 100) * 0.65;
  if (dim > 0) { shape(); ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fill(); }
  if (p.flash > 0) {
    // 真っ白に光る
    ctx.save();
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = s * 0.6 * p.flash;
    shape(); ctx.fillStyle = `rgba(255,255,255,${Math.min(1, p.flash * 1.1)})`; ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
function hpColor(hp) { return hp > 60 ? '#3ee08f' : hp > 30 ? '#ffb020' : '#ff4757'; }
function drawBar(x, y, w, h, frac, color) {
  ctx.fillStyle = 'rgba(63,220,120,0.15)';
  ctx.fillRect(x - w / 2, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), h);
}
// 組み合いの綱引きバー：乗られた駒の体力ぶんがその軍の色、減ったぶんが乗った側の色
function drawTug(cx, y, w, h, frac, defSide, atkSide) {
  frac = Math.max(0, Math.min(1, frac));
  const x = cx - w / 2;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = CLR.edge[defSide];
  ctx.fillRect(x, y, w * frac, h);
  ctx.fillStyle = CLR.edge[atkSide];
  ctx.fillRect(x + w * frac, y, w * (1 - frac), h);
  // 境目に白い線
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 6;
  ctx.fillRect(x + w * frac - 1.5, y - 2, 3, h + 4);
  ctx.shadowBlur = 0;
  // 両端に、それぞれの残り（乗られた側＝体力、乗った側＝あと何で押し返されるか）
  const left = Math.round(frac * 100), right = 100 - left;
  ctx.font = `700 ${Math.round(cs * 0.24)}px ${CLR.pieceFont}`;
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
  ctx.textAlign = 'left';
  ctx.strokeText(left, x - 2, y - 2);
  ctx.fillStyle = CLR.edge[defSide]; ctx.fillText(left, x - 2, y - 2);
  ctx.textAlign = 'right';
  ctx.strokeText(right, x + w + 2, y - 2);
  ctx.fillStyle = CLR.edge[atkSide]; ctx.fillText(right, x + w + 2, y - 2);
  ctx.restore();
}
// 対戦していない駒の体力バー：組み合い中より細い。体力100なら出さない
function drawSmallHp(p, px, py) {
  if (p.hp >= 100) return;
  const w = cs * 0.72, h = 5;
  const x = px - w / 2, y = py + cs * 0.47; // 駒の側面と重ならないよう、駒のすぐ下
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = CLR.edge[p.side];
  ctx.shadowColor = CLR.edge[p.side]; ctx.shadowBlur = 4;
  ctx.fillRect(x, y, w * Math.max(0, p.hp) / 100, h);
  ctx.restore();
}
// 組み合いの体力バー（その軍の色、右に数字）
function drawHpBar(cx, y, value, side) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const w = cs * 0.72, h = 9;
  ctx.save();
  ctx.font = `700 ${Math.round(cs * 0.24)}px ${CLR.pieceFont}`;
  const tw = ctx.measureText('100').width;
  const x = cx - (w + 4 + tw) / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = CLR.edge[side];
  ctx.shadowColor = CLR.edge[side]; ctx.shadowBlur = 6;
  ctx.fillRect(x, y, w * v / 100, h);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
  ctx.strokeText(v, x + w + 5, y + h / 2 + 1);
  ctx.fillStyle = CLR.edge[side];
  ctx.fillText(v, x + w + 5, y + h / 2 + 1);
  ctx.restore();
}
function drawRing(px, py, frac, color) {
  ctx.beginPath();
  ctx.arc(px, py, cs * 0.47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
}
// 矢印（x1,y1 → x2,y2）
function drawArrow(x1, y1, x2, y2, color, w, head) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = cs * 0.2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(a) * head * 0.7, y2 - Math.sin(a) * head * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
  ctx.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
// 照準（攻撃される駒の印）
function drawReticle(cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.shadowColor = color; ctx.shadowBlur = cs * 0.15;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    ctx.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
    ctx.lineTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25);
  }
  ctx.stroke();
  ctx.restore();
}
// マスの四隅のかぎ括弧
function drawBrackets(x, y, color, pad, len, w = 3) {
  const x0 = x * cs + pad, y0 = y * cs + pad, x1 = (x + 1) * cs - pad, y1 = (y + 1) * cs - pad;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.shadowColor = color; ctx.shadowBlur = cs * 0.2;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + len); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0);
  ctx.moveTo(x1 - len, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + len);
  ctx.moveTo(x1, y1 - len); ctx.lineTo(x1, y1); ctx.lineTo(x1 - len, y1);
  ctx.moveTo(x0 + len, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - len);
  ctx.stroke();
  ctx.restore();
}
function badge(x, y, text, bg, fg = '#0a0c0f') {
  ctx.font = `${fpx(cs * 0.2)}px ${CLR.font}`;
  const w = ctx.measureText(text).width + cs * 0.12, h = cs * 0.26;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}

function draw() {
  const W = canvas.width / dpr;
  cs = W / CFG.W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 盤：真っ黒に細い線と交点の十字
  ctx.fillStyle = CLR.board;
  ctx.fillRect(0, 0, W, W);
  for (let x = 0; x < CFG.W; x++) {
    ctx.fillStyle = CLR.zone[0]; ctx.fillRect(x * cs, 0, cs, cs * 2);
    ctx.fillStyle = CLR.zone[1]; ctx.fillRect(x * cs, (CFG.H - 2) * cs, cs, cs * 2);
  }
  ctx.strokeStyle = CLR.line;
  ctx.lineWidth = 1;
  for (let i = 1; i < CFG.W; i++) {
    ctx.beginPath(); ctx.moveTo(i * cs + 0.5, 0); ctx.lineTo(i * cs + 0.5, W); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cs + 0.5); ctx.lineTo(W, i * cs + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = CLR.cross;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let y = 1; y < CFG.H; y++) for (let x = 1; x < CFG.W; x++) {
    const k = cs * 0.07;
    ctx.moveTo(x * cs - k, y * cs); ctx.lineTo(x * cs + k, y * cs);
    ctx.moveTo(x * cs, y * cs - k); ctx.lineTo(x * cs, y * cs + k);
  }
  ctx.stroke();
  if (!G) return;

  // 選択中の駒：マスを光らせ、四隅に括弧
  const sel = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  if (sel) {
    ctx.fillStyle = `rgba(93,255,149,${0.12 + 0.12 * pulse()})`;
    ctx.fillRect(sel.x * cs, sel.y * cs, cs, cs);
    drawBrackets(sel.x, sel.y, CLR.sel, 2, cs * 0.24, 3);
    for (const t of legalTargets(sel)) {
      const tx = cellC(t.x), ty = cellC(t.y);
      if (!t.cap && helpsAt(sel, t.x, t.y)) {
        // ここへ動けば助太刀になる
        ctx.beginPath();
        ctx.arc(tx, ty, cs * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(62,224,143,0.9)'; ctx.fill();
        ctx.fillStyle = '#0a0c0f';
        ctx.font = `${fpx(cs * 0.3)}px ${CLR.font}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('助', tx, ty + 1);
      } else if (t.cap) {
        drawReticle(tx, ty, cs * 0.36, '#ff4757');
      } else {
        ctx.fillStyle = 'rgba(93,255,149,0.8)';
        ctx.fillRect(tx - cs * 0.06, ty - cs * 0.06, cs * 0.12, cs * 0.12);
      }
    }
  }

  // 抜けきっていない元のマス：まだ入れないことを示す斜線
  for (const p of G.pieces) {
    if (p.state !== 'moving' || !leavingFrom(p)) continue;
    ctx.save();
    ctx.beginPath(); ctx.rect(p.fx * cs + 2, p.fy * cs + 2, cs - 4, cs - 4); ctx.clip();
    ctx.strokeStyle = p.side === 0 ? 'rgba(89,168,255,0.45)' : 'rgba(255,92,99,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = -cs; k < cs * 2; k += cs * 0.18) {
      ctx.moveTo(p.fx * cs + k, p.fy * cs); ctx.lineTo(p.fx * cs + k - cs, (p.fy + 1) * cs);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 移動中の駒：出発点から行き先へ矢印、行き先のマスを予告
  for (const p of G.pieces) {
    if (p.state !== 'moving') continue;
    const f = p.t / p.dur;
    const col = CLR.side[p.side];
    ctx.fillStyle = p.side === 0 ? `rgba(89,168,255,${0.08 + 0.22 * f})` : `rgba(255,92,99,${0.08 + 0.22 * f})`;
    ctx.fillRect(p.tx * cs, p.ty * cs, cs, cs);
    drawBrackets(p.tx, p.ty, col, 3, cs * 0.18, 2);
    const x1 = cellC(p.fx), y1 = cellC(p.fy), x2 = cellC(p.tx), y2 = cellC(p.ty);
    const a = Math.atan2(y2 - y1, x2 - x1);
    drawArrow(x1, y1, x2 - Math.cos(a) * cs * 0.3, y2 - Math.sin(a) * cs * 0.3, col, 3, cs * 0.22);
    // 行き先に相手の駒がいれば照準
    if (occupants(p.tx, p.ty).some(q => q.side !== p.side)) {
      drawReticle(x2, y2, cs * 0.4 + cs * 0.04 * pulse(8), col);
    }
  }

  // 助太刀の線と光
  const supBadges = [];
  for (const g of G.grapples) {
    for (const [sp, side] of [...g.atkSups.map(p => [p, g.atk.side]), ...g.defSups.map(p => [p, g.def.side])]) {
      supBadges.push([sp, side]);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cellC(sp.x), cellC(sp.y));
      ctx.lineTo(cellC(g.x), cellC(g.y));
      ctx.strokeStyle = CLR.side[side]; ctx.lineWidth = 4;
      ctx.shadowColor = CLR.side[side]; ctx.shadowBlur = cs * 0.25;
      ctx.setLineDash([cs * 0.1, cs * 0.07]);
      ctx.lineDashOffset = -performance.now() / 30;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 組み合いのマス（駒より先に下地）
  for (const g of G.grapples) {
    const col = CLR.side[g.atk.side];
    ctx.fillStyle = g.atk.side === 0 ? 'rgba(89,168,255,0.18)' : 'rgba(255,92,99,0.18)';
    ctx.fillRect(g.x * cs, g.y * cs, cs, cs);
    drawBrackets(g.x, g.y, col, 2, cs * 0.2, 2);
  }

  // 盤上の駒
  for (const p of G.pieces) {
    if (p.state !== 'idle' && p.state !== 'rotating') continue;
    const px = cellC(p.x), py = cellC(p.y);
    let ang = p.dir * Math.PI / 2;
    if (p.state === 'rotating') ang += p.rotD * (p.t / p.dur) * Math.PI / 2;
    const isSel = p === sel;
    // 選んだ駒は少し浮かせて光らせる
    drawPiece(p, px, py - (isSel ? cs * 0.08 : 0), ang, isSel ? 1.06 : 1, 1, isSel ? CLR.sel : null);
    if (p.state === 'rotating') drawRing(px, py, p.t / p.dur, CLR.side[p.side]);
    if (p.cool > 0) drawRing(px, py, p.cool / (cooldownFor(p) || 1), 'rgba(230,240,250,0.95)');
    drawSmallHp(p, px, py);
    if (p.promoT > 0) drawBar(px, py - cs * 0.47, cs * 0.7, 3, p.promoT / CFG.PROMOTE_TIME, '#c98cff');
  }

  // 助太刀している駒に「助」の札
  for (const [sp, side] of supBadges) {
    badge(sp.x * cs + cs * 0.68, sp.y * cs + 2, '助', CLR.side[side]);
  }

  // 組み合い：乗った駒は来た方向側、乗られた駒は反対側。間に攻撃の矢印
  for (const g of G.grapples) {
    const px = cellC(g.x);
    const pos = grapplePos(g);
    // 2つとも見やすいよう大きめに（マスからはみ出してよい）
    // 奥（上）の駒を先に、手前（下）の駒をあとに描いて重ねる。乗った駒は光る
    // 乗られた駒を先（下の層）、乗った駒をあと（上の層）に描いて重ねる。乗った駒は光る
    drawPiece(g.def, pos.dx * cs, pos.dy * cs, g.def.dir * Math.PI / 2, 0.88);
    drawPiece(g.atk, pos.ax * cs, pos.ay * cs, g.atk.dir * Math.PI / 2, 0.88, 1, CLR.side[g.atk.side]);
    // 体力は細い線にしてマスの下端に。増減の札はマスの右上の角に（駒をなるべく隠さない）
    // 体力バー：上に相手（赤）、下に自分（青）。数字つき
    drawHpBar(px, (g.y + 0.5 + G_TOP - 0.42) * cs - 8, grappleValue(g, 1), 1);
    drawHpBar(px, (g.y + 0.5 + G_BOTTOM + 0.4) * cs + 2, grappleValue(g, 0), 0);
  }

  // 移動中の駒（いちばん上に描く）
  for (const p of G.pieces) {
    if (p.state !== 'moving') continue;
    const f = Math.min(1, p.t / p.dur);
    const px = cellC(p.fx + (p.tx - p.fx) * f), py = cellC(p.fy + (p.ty - p.fy) * f);
    const lift = p.type === 'KE' && !p.promoted ? 0.3 * Math.sin(Math.PI * f) : 0.08;
    ctx.fillStyle = 'rgba(63,220,120,0.12)';
    ctx.beginPath(); ctx.ellipse(px, py + cs * 0.3, cs * 0.3, cs * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    drawPiece(p, px, py - lift * cs * 0.5, p.dir * Math.PI / 2, 1 + lift, 0.95, CLR.side[p.side]);
    drawSmallHp(p, px, py);
  }

  // ▲の弾（進む向きを向く）
  for (const sh of G.shots) {
    const f = Math.min(1, sh.t / CFG.SHOT_TIME);
    // 山なりに飛ばす（駒の上を越えて見えるように）
    const arc = sh.arc * Math.sin(Math.PI * f);
    const x = (sh.x0 + (sh.x1 - sh.x0) * f) * cs, y = (sh.y0 + (sh.y1 - sh.y0) * f - arc) * cs;
    const vy = (sh.y1 - sh.y0) - sh.arc * Math.PI * Math.cos(Math.PI * f);
    const a = Math.atan2(vy, sh.x1 - sh.x0) + Math.PI / 2;
    const r = cs * 0.17;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.shadowColor = sh.color; ctx.shadowBlur = cs * 0.3;
    ctx.fillStyle = sh.color;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.75); ctx.lineTo(-r * 0.9, r * 0.75); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // 衝撃の輪と、はじけた瞬間の光
  for (const r of G.rings) {
    if (r.t < 0) continue;
    const k = r.t / r.max;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (k < 0.35) {
      const g = ctx.createRadialGradient(r.x * cs, r.y * cs, 0, r.x * cs, r.y * cs, cs * 0.5);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - k / 0.35)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(r.x * cs - cs * 0.5, r.y * cs - cs * 0.5, cs, cs);
    }
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = r.color; ctx.lineWidth = cs * 0.06 * (1 - k) + 1;
    ctx.shadowColor = r.color; ctx.shadowBlur = cs * 0.3;
    ctx.beginPath(); ctx.arc(r.x * cs, r.y * cs, cs * r.r * (0.2 + 0.8 * Math.sqrt(k)), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // 火花：尾を引く光の筋
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const sp of G.sparks) {
    if (sp.life < 0) continue;
    const k = 1 - sp.life / sp.max;
    const x = sp.x * cs, y = sp.y * cs;
    ctx.globalAlpha = Math.min(1, k * 1.4);
    ctx.strokeStyle = sp.color;
    ctx.shadowColor = sp.color; ctx.shadowBlur = cs * 0.2;
    ctx.lineWidth = cs * sp.size * (0.4 + k);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - sp.vx * cs * 0.05, y - sp.vy * cs * 0.05);
    ctx.stroke();
  }
  ctx.restore();

  // ダメージの数字：ピョンと飛び出して上へ消える
  for (const pp of G.pops) {
    const t = pp.t;
    const rise = Math.min(1, t / 0.25);                       // 最初の0.25秒で飛び出す
    const y = pp.y * cs - cs * (0.35 + 0.35 * (1 - (1 - rise) * (1 - rise)) + 0.25 * Math.max(0, t - 0.25));
    const sc = t < 0.12 ? 0.6 + t / 0.12 * 0.8 : t < 0.25 ? 1.4 - (t - 0.12) / 0.13 * 0.4 : 1; // ふくらんで戻る
    ctx.save();
    ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    ctx.translate(pp.x * cs, y);
    ctx.scale(sc, sc);
    ctx.font = `${fpx(cs * 0.32)}px ${CLR.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    ctx.strokeText(pp.text, 0, 0);
    ctx.fillStyle = pp.color;
    ctx.shadowColor = pp.color; ctx.shadowBlur = cs * 0.15;
    ctx.fillText(pp.text, 0, 0);
    ctx.restore();
  }

  // 文字の演出
  for (const f of G.fx) {
    ctx.save();
    ctx.globalAlpha = 1 - f.t / 1.2;
    ctx.font = `${fpx(cs * 0.4)}px ${CLR.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color; ctx.shadowBlur = cs * 0.2;
    ctx.fillText(f.text, cellC(f.x), cellC(f.y) - f.t * cs * 0.5);
    ctx.restore();
  }
}

// ===== 表示（HTML） =====
const $ = id => document.getElementById(id);
let hudCache = '';
function updateHud() {
  if (!G) return;
  const hands = side => {
    const free = CFG.HANDS - handsUsed(side);
    return '●'.repeat(free) + '○'.repeat(CFG.HANDS - free);
  };
  const caps = side => G.captured[side].map(t => LABEL[t]).join('') || '—';
  const sel = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  const myGrapple = G.grapples.some(g => g.atk.side === 0 || g.def.side === 0);
  let hint = G.watch ? 'COM対戦を観戦中'
    : myGrapple ? '組み合い中！ 隣のマスに、そこへ動ける向きの駒を置くと助太刀になります'
    : '自分の駒（青）を選んでください';
  if (sel && !G.watch) {
    if (sel.cool > 0) hint = `休み中（あと${Math.ceil(sel.cool / G.speed)}秒）`;
    else if (sel.state === 'grappled') hint = '行き先を押すと組み合いから離れます';
    else if (sel.state === 'rotating') hint = '回転中。行き先を押すと回転をやめて動きます';
    else if (legalTargets(sel).some(t => !t.cap && helpsAt(sel, t.x, t.y))) hint = '緑の「助」へ動くと助太刀になります';
    else hint = `行き先を押す／回すボタンで向きを変える（${Math.round((sel.promoted ? CFG.ROTATE_TIME_PROMOTED : CFG.ROTATE_TIME) / G.speed)}秒）`;
  }
  const cd = G.countdown > 0 ? String(Math.ceil(G.countdown)) : G.startFlash > 0 ? '始め！' : '';
  if (cd !== $('count').textContent) {
    $('count').textContent = cd;
    $('count').classList.toggle('show', cd !== '');
  }
  const key = [hands(0), hands(1), caps(0), caps(1), hint, sel ? sel.state : ''].join('|');
  if (key === hudCache) return;
  hudCache = key;
  $('handsYou').textContent = hands(0);
  $('handsCpu').textContent = hands(1);
  $('capsYou').textContent = caps(0);
  $('capsCpu').textContent = caps(1);
  $('hint').textContent = hint;
  const canRot = !G.watch && sel && sel.state === 'idle' && !(sel.cool > 0);
  $('rotL').disabled = !canRot;
  $('rotR').disabled = !canRot;
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

// ===== 操作 =====
function selectable(p) {
  if (p.side !== 0) return false;
  if (p.state === 'idle' || p.state === 'rotating') return true;
  return p.state === 'grappled' && G.grapples.some(g => g.atk === p);
}
function handleCell(x, y) {
  if (!G || G.over || G.countdown > 0 || G.watch) return;
  const sel = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  if (sel && selectable(sel)) {
    const t = legalTargets(sel).find(t => t.x === x && t.y === y);
    if (t) {
      if (sel.cool > 0) { toast('休み中です'); return; }
      if (!canAct(sel)) { toast('手がいっぱいです（同時に3駒まで）'); return; }
      startMove(sel, t);
      G.sel = null;
      return;
    }
  }
  const p = occupants(x, y).find(selectable);
  G.sel = p && p !== sel ? p : null;
  if (!p && occupants(x, y).some(q => q.side === 0 && q.state === 'grappled')) toast('乗られている駒は動けません');
}
function playerRotate(d) {
  if (!G || G.over || G.countdown > 0 || G.watch) return;
  const p = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  if (!p) { toast('先に駒を選んでください'); return; }
  if (p.state !== 'idle') { toast('今は回せません'); return; }
  if (p.cool > 0) { toast('休み中です'); return; }
  if (!canAct(p)) { toast('手がいっぱいです（同時に3駒まで）'); return; }
  startRotate(p, d);
}

canvas.addEventListener('pointerdown', e => {
  const [x, y] = screenToCell(e.clientX, e.clientY);
  if (inB(x, y)) handleCell(x, y);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
$('rotL').addEventListener('click', () => playerRotate(-1));
$('rotR').addEventListener('click', () => playerRotate(1));
window.addEventListener('keydown', e => {
  if (e.key === 'q' || e.key === 'Q') playerRotate(-1);
  else if (e.key === 'e' || e.key === 'E') playerRotate(1);
  else if (e.key === 'Escape' && G) G.sel = null;
});

// 最初の画面のルール説明の秒数は CFG から入れる（数字を変えても説明がずれないように）
function fillRuleNumbers() {
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = CFG[el.dataset.t] + '秒'; });
}
fillRuleNumbers();

// ===== 開始と終わり =====
function startGame(diff, watch = false) {
  newGame(diff, watch);
  fillRuleNumbers();
  $('overlay').hidden = true;
  $('result').hidden = true;
  // COM対戦では下の欄も「COM」と表示し、回すボタンは隠す
  $('whoYou').textContent = watch ? '青COM' : 'あなた';
  $('whoCpu').textContent = watch ? '赤COM' : 'COM';
  document.querySelector('.controls').style.visibility = watch ? 'hidden' : '';
  hudCache = '';
}
function endGame(winner) {
  G.over = true;
  G.winner = winner;
  const m = Math.floor(G.realTime / 60), s = Math.floor(G.realTime % 60);
  $('resultTitle').textContent = G.watch ? (winner === 0 ? '青の勝ち' : '赤の勝ち') : (winner === 0 ? '勝ち' : '負け');
  $('resultTime').textContent = `${m}分${String(s).padStart(2, '0')}秒`;
  setTimeout(() => { $('result').hidden = false; }, 900);
}
document.querySelectorAll('[data-diff]').forEach(b =>
  b.addEventListener('click', () => startGame(b.dataset.diff)));
$('watch').addEventListener('click', () => startGame('hard', true));
$('again').addEventListener('click', () => { $('result').hidden = true; $('overlay').hidden = false; });

// ===== ループ =====
let last = performance.now();
// スマホを横にしているか（指で操作する端末で、横長かつ短い辺が小さい）
const landscapeMQ = window.matchMedia('(pointer: coarse) and (orientation: landscape)');
function phoneIsLandscape() {
  return landscapeMQ.matches && Math.min(window.innerWidth, window.innerHeight) < 600;
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // 横向きの間は試合を止めて「縦にしてください」を出す
  const sideways = phoneIsLandscape();
  if ($('portrait').hidden === sideways) $('portrait').hidden = !sideways;
  if (!sideways) update(dt);
  draw();
  updateHud();
  requestAnimationFrame(frame);
}
resize();
// キャンバスで使うフォントは、先に読み込んでおく
if (document.fonts) {
  document.fonts.load('700 32px "M PLUS 1 Code"', '王玉飛角金銀桂香歩龍馬全杏圭と').catch(() => {});
  document.fonts.load('16px "Misaki"').catch(() => {});
}
requestAnimationFrame(frame);
