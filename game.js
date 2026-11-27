'use strict';

// ===== 設定（遊んで調整する数字） =====
// 時間はすべて U（3秒）の倍数。U を変えるだけで、ゲーム全体の速さをまとめて変えられる
const U = 3;
const CFG = {
  W: 5, H: 7,                  // 盤の横・縦（LAYOUTS に同じ大きさの並びが必要）
  MOVE_TIME: 1 * U,            // 移動（どの駒も同じ）          3秒
  ROTATE_TIME: 1 * U,          // 90度回転（成った駒も同じ）      3秒
  COOLDOWN: 1 * U,             // 動き・回転が終わったあとの休み  3秒
  PROMOTE_TIME: 1 * U,         // 成りボタンを押してから成るまで  3秒
  COUNTDOWN: 2 * U,            // 試合前のカウントダウン          6秒
  TICK: U / 3,                 // 組み合いの1拍（▲が飛ぶ間隔）    1秒
  ACT_GAP: 1 * U,              // 動かす・回す指示は、この間隔で1回だけ（敵味方それぞれ）3秒
  HIT: 10,                     // 乗られた瞬間の減り（王も同じ）
  BASE: 10,                    // 乗った駒が、1拍ごとに乗られた駒へ与えるダメージ
  SUP: 10,                     // 助太刀の▲1発のダメージ（味方の回復はしない）。助太刀は何体でも入れる
  HUNT: 1.2,                   // COM：敵の王への近づき1マスぶんの点数
  SHIELD: 22,                  // COM：王の守り（助太刀）1体ぶんの点数（2体まで）
  SHOT_TIME: 0.35,             // ▲が飛んで当たるまで（見た目だけ）
};

// COM の強さ。時間はゲーム内の秒
//  think : 次の手を考える間隔（＋ jitter のばらつき）。手は3秒に1回しか出せない
//  react : 相手が動き出してから、それに気づくまで
//  notice: 飛んでくる相手に気づく確率（見落としがある）
//  act   : 手を出すのに必要な「よくなる点数」の最低ライン（大きいほど慎重）
//  noise : 手の選び方のいいかげんさ（大きいほど、ぼんやり選ぶ）
//  roll  : 先読み。k=候補の数、n=1候補ごとに試す回数、h=何秒先まで試すか（多いほど強い）
//  （時間の進む速さは、設定の秒数 SETTINGS.sec から決まる。6秒なら 0.5 = 1/2、移動3秒が実際には6秒になる）
const DIFF = {
  easy:   { think: 2.8, jitter: 1.2, react: 1.4, notice: 0.35, act: 1,   noise: 14, roll: { k: 3, n: 1, h: 8 } },
  normal: { think: 1.8, jitter: 0.8, react: 0.9, notice: 0.7,  act: 1,   noise: 6,  roll: { k: 4, n: 3, h: 12 } },
  hard:   { think: 1.0, jitter: 0.5, react: 0.6, notice: 0.9,  act: 10,  noise: 1,  roll: { k: 8, n: 10, h: 20 } },
};

// ランキング戦の COM：強さ s（0〜1）から、かんたん(0)・ふつう(0.5)・むずかしい(1) の間を補って作る
function diffFor(s) {
  const lo = s < 0.5 ? DIFF.easy : DIFF.normal, hi = s < 0.5 ? DIFF.normal : DIFF.hard;
  const t = s < 0.5 ? s / 0.5 : (s - 0.5) / 0.5;
  const mix = (a, b) => a + (b - a) * t;
  const d = {};
  for (const k of ['think', 'jitter', 'react', 'notice', 'act', 'noise']) d[k] = mix(lo[k], hi[k]);
  d.roll = { k: Math.round(mix(lo.roll.k, hi.roll.k)), n: Math.round(mix(lo.roll.n, hi.roll.n)), h: Math.round(mix(lo.roll.h, hi.roll.h)) };
  return d;
}

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

// 盤の大きさごとの初期配置（自分側。奥の段と、その前の段）
const LAYOUTS = {
  '7x7': { back: ['KY','KE','GI','OU','KI','KE','KY'], mid: ['FU','HI','FU',null,'FU','KA','FU'] },
  '5x7': { back: ['KY','GI','OU','KI','KE'],           mid: ['FU','HI','FU','KA','FU'] },
};
function newGame(diff, watch = false, rank = null) {
  G = {
    rank, style: [null, rank ? rank.params : null], // style：うち筋の傾向（ランキング戦の相手）。stats：あなたのうち筋の記録
    stats: { times: [], moves: 0, caps: 0, fwd: 0, helps: 0, rots: 0, promos: 0, retreats: 0, kdN: 0, kdS: 0, kdNext: 1 },
    pieces: [], grapples: [], fx: [], shots: [], sparks: [], rings: [], pops: [], time: 0, over: false, winner: -1,
    diff, watch, speed: 3 / SETTINGS.sec, realTime: 0, cpuT: 2.0, cpuT0: 2.3, sel: null,
    actAt: [0, 0], lastAct: [0, 0], thinking: [false, false], countdown: CFG.COUNTDOWN, startFlash: 0, nextId: 1, captured: [[], []],
  };
  // 自分（下）の並びを置き、相手（上）は点対称に置く
  const L = LAYOUTS[CFG.W + 'x' + CFG.H];
  for (let x = 0; x < CFG.W; x++) {
    addPiece(0, L.back[x], x, CFG.H - 1, 0);
    addPiece(0, L.mid[x], x, CFG.H - 2, 0);
    addPiece(1, L.back[x], CFG.W - 1 - x, 0, 2);
    addPiece(1, L.mid[x], CFG.W - 1 - x, 1, 2);
  }
}
function addPiece(side, type, x, y, dir) {
  if (!type) return;
  G.pieces.push({
    id: G.nextId++, side, type, x, y, dir, promoted: false, hp: 100,
    state: 'idle', cool: 0, fx: 0, fy: 0, tx: 0, ty: 0, t: 0, dur: 0, rotD: 0,
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
// 次の指示を出せるまで：動かす・回す指示は、敵味方それぞれ ACT_GAP（3秒）に1回だけ
const slotReady = side => G.time >= G.actAt[side];
const slotWait = side => Math.max(0, G.actAt[side] - G.time);
function canAct(p) {
  if (p.cool > 0) return false; // 休み中
  return slotReady(p.side);
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
// あなたのうち筋の記録（ランキング用）：指示の間隔、攻め、助太刀、回転、成り、組み合いから引く回数
function track(p, kind, t) {
  if (G.sim || G.watch || p.side !== 0) return;
  const st = G.stats;
  st.times.push(G.time);
  if (kind === 'move') {
    st.moves++;
    if (t.cap) st.caps++;
    if (t.y < p.y) st.fwd++;
    if (!t.cap && helpsAt(p, t.x, t.y)) st.helps++;
    if (p.state === 'grappled') st.retreats++;
  } else if (kind === 'rot') st.rots++;
  else if (kind === 'promo') st.promos++;
}
// 記録から、うち筋の傾向（0〜1）を作る
function styleFromStats() {
  const st = G.stats, n = Math.max(1, st.times.length), mv = Math.max(1, st.moves);
  const c01 = x => Math.max(0, Math.min(1, x));
  let gap = CFG.ACT_GAP * 2;   // 指示の間隔（ゲーム内の秒）の平均。最小の間隔なら速い、2倍以上なら遅い
  if (st.times.length > 1) gap = (st.times[st.times.length - 1] - st.times[0]) / (st.times.length - 1);
  return {
    aggr: c01(0.5 * c01(st.caps / mv * 3) + 0.5 * st.fwd / mv),
    tempo: c01(1 - (gap / CFG.ACT_GAP - 1) / 2),
    support: c01(st.helps / mv * 3),
    rotation: c01(st.rots / n * 4),
    promote: c01(st.promos / 3),
    kingDef: st.kdN ? c01(st.kdS / st.kdN) : 0.5,
    retreat: c01(st.retreats / n * 8),
  };
}
function startMove(p, t) {
  track(p, 'move', t);
  if (p.state === 'grappled') {
    const g = G.grapples.find(g => g.atk === p);
    if (!g) return;
    live('retreat', g); // 中継：攻めた側が1秒ぶん下がって、画面を閉じる
    G.grapples = G.grapples.filter(q => q !== g);
    g.def.state = 'idle';
  }
  G.actAt[p.side] = G.time + CFG.ACT_GAP; // 次の指示まで3秒
  G.lastAct[p.side] = G.time;
  p.state = 'moving';
  sfx('move', p.side);
  p.noticed = undefined;
  p.fx = p.x; p.fy = p.y; p.tx = t.x; p.ty = t.y;
  p.t = 0;
  p.dur = CFG.MOVE_TIME;
}
// 成れる駒：敵陣（奥の2段）で、動いておらず、休みでもない、まだ成っていない駒（金と王は成れない）
function inPromoZone(p) { return p.side === 0 ? p.y <= 1 : p.y >= CFG.H - 2; }
function canPromote(p) {
  return !p.promoted && p.type !== 'OU' && p.type !== 'KI' && p.state === 'idle' && !(p.cool > 0) && inPromoZone(p);
}
// 成りも1手。回転と同じく、3秒かけて成り、そのあと3秒休む
function startPromote(p) {
  track(p, 'promo');
  G.actAt[p.side] = G.time + CFG.ACT_GAP;
  G.lastAct[p.side] = G.time;
  p.state = 'promoting';
  sfx('promoteStart', p.side);
  p.t = 0; p.dur = CFG.PROMOTE_TIME;
}
function startRotate(p, d) {
  track(p, 'rot');
  G.actAt[p.side] = G.time + CFG.ACT_GAP; // 回し始めるのも1手。回転はそのまま続く
  G.lastAct[p.side] = G.time;
  p.state = 'rotating';
  sfx('rotate', p.side);
  p.rotD = d; p.t = 0;
  p.dur = CFG.ROTATE_TIME;
}

function cooldownFor(p) {
  return CFG.COOLDOWN;
}
function arrive(p) {
  p.cool = cooldownFor(p);
  const occ = occupants(p.tx, p.ty);
  if (occ.length === 0) { p.x = p.tx; p.y = p.ty; p.state = 'idle'; sfx('land', p.side); return; }
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
  sfx('clash', a.side);
  d.hp -= CFG.HIT;
  // fx,fy：乗った駒がどこから来たか（攻撃の向きを描くため）
  const g = { x: d.x, y: d.y, fx: a.fx, fy: a.fy, atk: a, def: d, atkSups: [], defSups: [], tick: 0 };
  G.grapples.push(g);
  // 乗った瞬間の一撃：火花
  const pos = grapplePos(g);
  hitEffect(d, pos.dx, pos.dy, CLR.side[a.side], 1.6);
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
// 画面上の中継（live.js）への知らせ。COMの先読みの試し打ちでは送らない
const live = (fn, ...a) => { if (!G.sim && typeof LIVE !== 'undefined') LIVE[fn](...a); };
function fireTick(g) {
  const pos = grapplePos(g);
  const ca = CLR.side[g.atk.side], cd = CLR.side[g.def.side];
  const hit = (p, n) => () => damagePiece(g, p, n);
  sfx('strike', g.atk.side);
  live('strike', g, g.atk, g.def);
  for (const sp of g.atkSups) live('strike', g, sp, g.def);
  for (const sp of g.defSups) live('strike', g, sp, g.atk);
  if (g.atkSups.length || g.defSups.length) sfx('support');
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
  const isDef = p === g.def;
  p.hp = Math.max(0, p.hp - n);
  sfx('hit');
  live('hit', g, p, n);
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
  live('end', g, atkWins);
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
  sfx('ko');
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
      if (p.t >= p.dur) { p.dir = (p.dir + p.rotD + 4) % 4; p.state = 'idle'; p.cool = cooldownFor(p); } // 回したあとも、動いたあとと同じ休み
    } else if (p.state === 'promoting') {
      p.t += dt;
      if (p.t >= p.dur) {
        p.promoted = true; p.state = 'idle'; p.cool = cooldownFor(p);
        addFx(p.x, p.y, '成', '#c98cff');
        sfx('promoted', p.side);
      }
    }
  }
  if (G.over) return;
  // 王の守り：1秒ごとに、自分の王のまわりに助太刀できる駒がいるかを記録する（ランキング用）
  if (!G.watch && G.time >= G.stats.kdNext) {
    G.stats.kdNext = G.time + 1;
    const ku = G.pieces.find(p => p.side === 0 && p.type === 'OU' && p.state === 'idle');
    if (ku) { G.stats.kdN++; if (supporters(0, ku.x, ku.y, ku).length >= 1) G.stats.kdS++; }
  }

  updateGrapples(dt);
  if (G.over) return;

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
    const tempo = G.style && G.style[1] && typeof G.style[1].tempo === 'number' ? 0.7 + 0.6 * G.style[1].tempo : 1; // 指示の速い人は、考える間隔も短い
    G.cpuT = (d.think + Math.random() * d.jitter) / tempo;
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
    const oldS = new Set([...g.atkSups, ...g.defSups]);
    g.atkSups = pickAll(g, g.atk.side);
    g.defSups = pickAll(g, g.def.side);
    if ([...g.atkSups, ...g.defSups].some(q => !oldS.has(q))) sfx('join');
    g.age = (g.age || 0) + dt;
    g.tick += dt;
    if (g.tick >= CFG.TICK) { g.tick -= CFG.TICK; fireTick(g); }
  }
}

// ===== CPU =====
// COM の考え方（評価で手を選ぶ版）
//  盤の「いまの形」を、危ない駒・狙える駒・組み合いの形勢で点数にして、
//  次の1手（動かす・回す・何もしない）を、点数がいちばん上がるものから選ぶ。
//  1手は3秒に1回しか出せないので、点数が上がらないときは手を出さずに待つ。
function cpuThink(S = 1, dk = G.diff, sync = false) {
  const D = DIFF[dk];
  if (!slotReady(S)) return; // 次の指示を出せるまで待つ
  if (!sync && D.roll && !G.sim && G.thinking[S]) return; // 先読み中は、二重に考えない
  const O = 1 - S;
  const fwd = S === 1 ? 1 : -1; // 前の向き（y が増える／減る）
  // うち筋の傾向（ランキング戦の相手）：0.5 が標準。0〜1 を 0.5〜1.5 倍にして、点数の重みにかける
  const sty = G.style && G.style[S];
  const sm = k => 0.5 + (sty && typeof sty[k] === 'number' ? sty[k] : 0.5);
  const mine = G.pieces.filter(p => p.side === S);
  const readyP = p => p.state === 'idle' && !(p.cool > 0);
  const V = p => p.type === 'OU' ? 120 : (VALUE[p.type] + (p.promoted ? 2 : 0)) * 3;
  const key = (x, y) => x * 16 + y;

  // 自分の駒をねらえる敵の数（いま動ける形の敵）
  const attackedMap = () => {
    const m = new Map();
    for (const e of G.pieces) {
      if (e.side !== O || (e.state !== 'idle' && e.state !== 'rotating' && e.state !== 'promoting')) continue;
      for (const t of legalTargets(e)) if (t.cap) m.set(key(t.x, t.y), (m.get(key(t.x, t.y)) || 0) + 1);
    }
    return m;
  };
  // 飛んでくる敵（気づいている分だけ）
  const incoming = new Map();
  for (const t of G.pieces) {
    if (t.side !== O || t.state !== 'moving' || t.dur - t.t < 0.4) continue;
    if (t.t < D.react) continue;                      // 動き出してすぐには気づかない
    t.noticed = t.noticed || {};
    if (t.noticed[S] === undefined) t.noticed[S] = Math.random() < D.notice; // 見落とす時もある
    if (t.noticed[S]) incoming.set(key(t.tx, t.ty), (incoming.get(key(t.tx, t.ty)) || 0) + 1);
  }

  // 組み合いの形勢（その軍から見た点数）：助太刀の数で、どちらが先に倒れるかを見積もる
  const grappleScore = g => {
    const nAS = supporters(g.atk.side, g.x, g.y, g.atk).length;
    const nDS = supporters(g.def.side, g.x, g.y, g.def).length;
    const tDef = Math.ceil(g.def.hp / (CFG.BASE + CFG.SUP * nAS));
    const tAtk = nDS > 0 ? Math.ceil(g.atk.hp / (CFG.SUP * nDS)) : Infinity;
    const atkWins = tDef <= tAtk;
    const dmg = atkWins ? Math.min(1, (tDef * CFG.SUP * nDS) / Math.max(1, g.atk.hp)) : 1;
    const gainAtk = atkWins ? V(g.def) - V(g.atk) * dmg * 0.6 : -V(g.atk);
    return g.atk.side === S ? gainAtk : -gainAtk;
  };

  // 盤の形を点数にする
  const evaluate = () => {
    const amap = attackedMap();
    let risk = 0, opp = 0, grap = 0;
    for (const p of mine) {
      if (p.state === 'grappled') continue;
      const k = key(p.x, p.y);
      const att = amap.get(k) || 0, inc = incoming.get(k) || 0;
      if (att + inc === 0) continue;
      const sup = supporters(S, p.x, p.y, p).length;
      const lose = sup >= 2 ? 0 : sup === 1 ? 0.5 : 1;
      risk += V(p) * lose * (inc > 0 ? 1 : 0.45) * (1 + (100 - p.hp) / 70);
    }
    // 守りの薄い敵の駒を、いま攻められるか
    for (const e of G.pieces) {
      if (e.side !== O || e.state === 'grappled' || e.state === 'moving') continue;
      let can = false;
      for (const m of mine) {
        if (!readyP(m) && !(m.state === 'idle' && m.cool < CFG.MOVE_TIME)) continue;
        if (legalTargets(m).some(t => t.cap && t.x === e.x && t.y === e.y)) { can = true; break; }
      }
      if (!can) continue;
      const es = supporters(O, e.x, e.y, e).length;
      opp += V(e) * (es === 0 ? 1 : es === 1 ? 0.3 : 0) * (1 + (100 - e.hp) / 150);
    }
    for (const g of G.grapples) if (g.atk.side === S || g.def.side === S) grap += grappleScore(g);
    // 王のまわりの守り：助太刀が2体いれば、乗られても返り討ちにできる。ふだんから形を作っておく
    let shield = 0;
    for (const p of mine) if (p.type === 'OU' && p.state === 'idle') shield += CFG.SHIELD * sm('kingDef') * Math.min(2, supporters(S, p.x, p.y, p).length);
    // 敵の王へ近づく：いちばん近い駒との距離が縮まるほど点数（とどめを刺しに行く道すじ）
    let hunt = 0;
    const ek = G.pieces.find(p => p.side === O && p.type === 'OU');
    if (ek) {
      let dmin = 99;
      for (const p of mine) {
        if (p.type === 'OU' || p.hp < 40 || p.state === 'grappled') continue;
        dmin = Math.min(dmin, Math.max(Math.abs(p.x - ek.x), Math.abs(p.y - ek.y)));
      }
      if (dmin < 99) hunt = -CFG.HUNT * sm('aggr') * dmin;
    }
    return -risk + 0.5 * opp + grap + shield + hunt;
  };

  const base = evaluate();
  const cands = [];
  const noise = () => (Math.random() - 0.5) * 2 * D.noise;

  // 手を出すと、その駒は動いている間（3秒）・回っている間（6秒）は助太刀できない。
  // そこで「動いている間の形」と「着いたあとの形」の2つを見て、平均で点数をつける
  for (const p of mine) {
    if (!readyP(p) && !(p.state === 'grappled' && G.grapples.some(g => g.atk === p) && !(p.cool > 0))) continue;
    const sx = p.x, sy = p.y, sst = p.state, sd = p.dir, spr = p.promoted;
    const sv = { fx: p.fx, fy: p.fy, tx: p.tx, ty: p.ty, t: p.t, dur: p.dur };
    const restore = () => { p.x = sx; p.y = sy; p.state = sst; p.dir = sd; p.promoted = spr; Object.assign(p, sv); };
    // 動かす手
    for (const o of legalTargets(p)) {
      // 飛んでいる間：その駒は、狙われないが、助太刀もできない
      p.state = 'moving'; p.fx = sx; p.fy = sy; p.tx = o.x; p.ty = o.y; p.t = 0; p.dur = CFG.MOVE_TIME;
      const eNow = evaluate();
      let eArr, imm = 0;
      if (o.cap) {
        // 乗る：着いたあとの組み合いの形勢を見積もる
        const e = o.cap;
        const atkSup = supporters(S, o.x, o.y, p).length, defSup = supporters(O, o.x, o.y, e).length;
        const tDef = Math.ceil(Math.max(0, e.hp - CFG.HIT) / (CFG.BASE + CFG.SUP * atkSup)) || 0;
        const tAtk = defSup > 0 ? Math.ceil(p.hp / (CFG.SUP * defSup)) : Infinity;
        const win = tDef <= tAtk;
        const dmg = win ? Math.min(1, (tDef * CFG.SUP * defSup) / Math.max(1, p.hp)) : 1;
        imm = win ? V(e) * (e.type === 'OU' ? 8 : 1) - V(p) * dmg * 0.6 : -V(p);
        imm += (sm('aggr') - 1) * 10; // 攻撃的な人は、乗る手を好む
        if (p.type === 'OU') imm -= 40; // 王で攻めるのは最後の手段
        p.x = o.x; p.y = o.y; p.state = 'grappled'; const es = e.state; e.state = 'grappled';
        eArr = evaluate();
        e.state = es;
      } else {
        p.state = 'idle'; p.x = o.x; p.y = o.y;
        eArr = evaluate() + 0.4 * sm('aggr') * Math.max(0, (o.y - sy) * fwd);
        if (helpsAt(p, o.x, o.y)) imm += (sm('support') - 1) * 8; // 助太刀に入る人は、助太刀になる手を好む
      }
      if (sst === 'grappled') imm += (sm('retreat') - 1) * 8;       // 組み合いから引く人は、引く手を好む
      restore();
      cands.push({ p, o, score: 0.5 * (eNow - base) + 0.5 * (eArr - base) + imm + noise() });
    }
    // 回す手：回っている間は助太刀できず、終わるのは6秒後
    // 回しても動ける先が増えない回転（壁を向く・形が同じ）は、そもそも候補にしない。点数がプラスにならない回転も出さない
    if (readyP(p)) for (const d of [-1, 1]) {
      if (!rotMeaningful(p, d)) continue;
      p.state = 'rotating';
      const eNow = evaluate();
      p.state = 'idle'; p.dir = (p.dir + d + 4) % 4;
      const eArr = evaluate();
      restore();
      const raw = 0.5 * (eNow - base) + 0.5 * (eArr - base) - 1.5 + (sm('rotation') - 1) * 3;
      if (raw <= 0) continue;
      cands.push({ p, rot: d, score: raw + noise() });
    }
    // 成る手：敵陣で成れるなら。成っている間は助太刀できないが、強い駒になる
    if (canPromote(p)) {
      p.state = 'promoting';
      const eNow = evaluate();
      p.state = 'idle'; p.promoted = true;
      const eArr = evaluate();
      restore();
      const bonus = { FU: 6, KY: 6, KE: 7, GI: 5, HI: 12, KA: 12 }[p.type] || 5;
      cands.push({ p, promote: true, score: 0.5 * (eNow - base) + 0.5 * (eArr - base) + bonus * sm('promote') + noise() });
    }
  }

  // 先読みする強さ：評価の高い候補と「何もしない」を、実際のルールで数秒先まで何回か試して選ぶ
  if (D.roll && !G.sim) {
    const applyPick = pick => { if (pick) { if (pick.promote) startPromote(pick.p); else if (pick.rot) startRotate(pick.p, pick.rot); else startMove(pick.p, pick.o); } };
    if (sync) { applyPick(pickByRollouts(S, cands, D.roll)); return; }
    // 画面がカクつかないように、数回に分けて考える。考え終わったときに、まだ手が通るか確かめてから出す
    if (G.thinking[S]) return;
    G.thinking[S] = true;
    const game = G;
    pickByRolloutsAsync(S, cands, D.roll, pick => {
      if (G !== game) return;               // 試合が変わっていたらやめる
      game.thinking[S] = false;
      if (!pick || game.over || game.paused || !slotReady(S)) return;
      const p = pick.p;
      if (!game.pieces.includes(p) || (p.cool > 0)) return;
      if (pick.promote) { if (!canPromote(p)) return; }
      else if (pick.rot) { if (p.state !== 'idle') return; }
      else {
        const leaving = p.state === 'grappled' && game.grapples.some(g => g.atk === p);
        if (p.state !== 'idle' && !leaving) return;
        if (!legalTargets(p).some(t => t.x === pick.o.x && t.y === pick.o.y)) return;
      }
      applyPick(pick);
    });
    return;
  }
  let best = null;
  for (const c of cands) if (!best || c.score > best.score) best = c;
  // よくならないなら、手を出さずに待つ。ただし待ち続けていたら、小さな得でも動く（9秒で最低ライン0.5まで下がる）
  const idle = G.time - G.lastAct[S];
  const need = Math.max(0.5, D.act * (1 - idle / 9));
  if (!best || best.score < need) return;
  if (best.promote) startPromote(best.p); else if (best.rot) startRotate(best.p, best.rot); else startMove(best.p, best.o);
}
// 向き dir で、盤の上で届くマス（駒や壁のじゃまを考えない）の集まり
function reachSet(p, dir) {
  const ms = moveSet(p), set = new Set();
  for (const [sx, sy] of ms.steps) {
    const [dx, dy] = rot(sx, sy, dir);
    if (inB(p.x + dx, p.y + dy)) set.add((p.x + dx) * 16 + p.y + dy);
  }
  for (const [sx, sy] of ms.rays) {
    const [dx, dy] = rot(sx, sy, dir);
    for (let x = p.x + dx, y = p.y + dy; inB(x, y); x += dx, y += dy) set.add(x * 16 + y);
  }
  return set;
}
// 回す意味があるか：回したあとに、今は届かないマスへ届くようになる回転だけ意味がある
// （壁を向く、飛車や王のように形が同じ、いまより狭くなるだけ、は意味がない）
function rotMeaningful(p, d) {
  const now = reachSet(p, p.dir), nxt = reachSet(p, (p.dir + d + 4) % 4);
  for (const k of nxt) if (!now.has(k)) return true;
  return false;
}

// ===== COM の先読み：盤をコピーして、実際のルールで数秒先まで試す =====
function cloneForRollout() {
  const map = new Map();
  const pieces = G.pieces.map(p => { const q = Object.assign({}, p); q.noticed = undefined; map.set(p, q); return q; });
  const grapples = G.grapples.map(g => ({ x: g.x, y: g.y, fx: g.fx, fy: g.fy, atk: map.get(g.atk), def: map.get(g.def), atkSups: [], defSups: [], tick: g.tick, age: g.age || 0 }));
  return {
    map,
    g: {
      pieces, grapples, fx: [], shots: [], sparks: [], rings: [], pops: [],
      time: G.time, over: false, winner: -1, diff: G.diff, style: G.style, watch: false, speed: 1, realTime: 0,
      cpuT: 1e9, cpuT0: 1e9, sel: null, actAt: G.actAt.slice(), lastAct: G.lastAct.slice(),
      countdown: 0, startFlash: 0, nextId: G.nextId, captured: [[...G.captured[0]], [...G.captured[1]]], sim: true,
    },
  };
}
// 試し打ちの中での、敵味方どちらの考え方：避ける・勝てる所を攻める・前へ出る（かんたんなもの）
function rollPolicy(S) {
  if (!slotReady(S)) return;
  const O = 1 - S, fwd = S === 1 ? 1 : -1;
  const mine = G.pieces.filter(p => p.side === S && p.state === 'idle' && !(p.cool > 0));
  for (const t of G.pieces) {
    if (t.side !== O || t.state !== 'moving') continue;
    const v = mine.find(p => p.x === t.tx && p.y === t.ty);
    if (v && supporters(S, v.x, v.y, v).length < 2) {
      const os = legalTargets(v).filter(o => !o.cap);
      if (os.length) { startMove(v, os[Math.floor(Math.random() * os.length)]); return; }
    }
  }
  let best = null, bs = -1e9;
  for (const p of mine) for (const o of legalTargets(p)) {
    if (!o.cap) continue;
    const e = o.cap;
    const aS = supporters(S, o.x, o.y, p).length, dS = supporters(O, o.x, o.y, e).length;
    const tD = Math.ceil(Math.max(0, e.hp - CFG.HIT) / (CFG.BASE + CFG.SUP * aS)) || 0;
    const tA = dS > 0 ? Math.ceil(p.hp / (CFG.SUP * dS)) : Infinity;
    if (tD > tA) continue; // 負ける所へは攻めない
    const s = (e.type === 'OU' ? 1000 : VALUE[e.type]) - VALUE[p.type] * 0.3 + Math.random();
    if (s > bs) { bs = s; best = [p, o]; }
  }
  if (best) { startMove(best[0], best[1]); return; }
  const pr = mine.filter(canPromote);
  if (pr.length && Math.random() < 0.6) { startPromote(pr[Math.floor(Math.random() * pr.length)]); return; }
  if (Math.random() < 0.5) return;
  const adv = [];
  for (const p of mine) { if (p.type === 'OU') continue; for (const o of legalTargets(p)) if (!o.cap && (o.y - p.y) * fwd >= 0) adv.push([p, o]); }
  if (adv.length) { const [p, o] = adv[Math.floor(Math.random() * adv.length)]; startMove(p, o); }
}
function rolloutValue(S) {
  const myK = G.pieces.find(p => p.side === S && p.type === 'OU'), enK = G.pieces.find(p => p.side !== S && p.type === 'OU');
  if (!enK) return 1000;
  if (!myK) return -1000;
  let v = (myK.hp - enK.hp) * 0.4;
  for (const p of G.pieces) { const w = VALUE[p.type] * (0.4 + 0.6 * p.hp / 100); v += p.side === S ? w : -w; }
  return v;
}
function rollout(S, cand, horizon) {
  const saved = G;
  const c = cloneForRollout();
  G = c.g;
  try {
    if (cand) { const p = c.map.get(cand.p); if (cand.promote) startPromote(p); else if (cand.rot) startRotate(p, cand.rot); else startMove(p, cand.o); }
    const T = [0.4, 0.4];
    const end = G.time + horizon, dt = 0.25;
    while (!G.over && G.time < end) {
      update(dt);
      for (const s of [0, 1]) { T[s] -= dt; if (T[s] <= 0 && !G.over) { rollPolicy(s); T[s] = 0.9 + Math.random() * 0.4; } }
    }
    return rolloutValue(S);
  } finally { G = saved; }
}
// 候補ごとに少しずつ試して、そのたびに画面に処理を返す
function pickByRolloutsAsync(S, cands, R, done) {
  const list = cands.slice().sort((a, b) => b.score - a.score).slice(0, R.k);
  const waited = G.time - G.lastAct[S] > 12;
  const options = waited ? list : [null, ...list];
  const game = G;
  let i = 0, best = null, bestV = -1e9;
  const step = () => {
    if (G !== game) { done(null); return; }
    const c = options[i];
    let sum = 0, v;
    if (c && !game.pieces.includes(c.p)) v = -1e9; // 考えている間に、その駒が取られていたら、この候補は使えない
    else {
      try { for (let k = 0; k < R.n; k++) sum += rollout(S, c, R.h); v = sum / R.n; }
      catch (e) { v = -1e9; } // 考えている途中で問題が起きても、COMが止まったままにならないように
    }
    if (v > bestV) { bestV = v; best = c; }
    i++;
    if (i < options.length) setTimeout(step, 0); else done(best);
  };
  setTimeout(step, 0);
}
function pickByRollouts(S, cands, R) {
  const list = cands.slice().sort((a, b) => b.score - a.score).slice(0, R.k);
  let best = null, bestV = -1e9;
  // 手を出さずに待つ（null）も選べる。ただし12秒以上待ち続けていたら、必ず何か動く（試合が止まらないように）
  const waited = G.time - G.lastAct[S] > 12;
  for (const c of waited ? list : [null, ...list]) {
    let sum = 0;
    for (let i = 0; i < R.n; i++) sum += rollout(S, c, R.h);
    const v = sum / R.n;
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

// ===== 描画 =====
const CLR = {
  // 駒以外はレトロフューチャーの緑（暗い緑〜明るい緑）
  board: '#010d06',
  line: 'rgba(63,220,120,0.22)',
  cross: 'rgba(120,255,160,0.65)',
  zone: ['rgba(63,220,120,0.07)', 'rgba(63,220,120,0.07)'],
  sel: '#5dff95',
  // 駒の文字：太字。ゲームで使う文字だけを埋め込んだ字体（font.css）。画面のほかの文字も同じ字体
  pieceFont: '"TokiFont","Yu Gothic UI","Meiryo",sans-serif', // TokiFont＝ゲームで使う文字だけ埋め込んだ字体（どの環境でも同じ。作り方は手元の作業用フォルダにある）
  side: ['#59a8ff', '#ff5c63'],   // 光る色（選択・矢印・札など）
  top: ['#10264d', '#4a1119'],    // 駒の上面：暗い青／暗い赤
  edge: ['#2f7bff', '#ff3344'],   // 駒の縁と断面（はっきりした青・赤）
  text: ['#dde3ec', '#ecdfe0'],   // 駒の文字：明るいグレー（ちょい青／ちょい赤）
  ptext: '#ffd24a',               // 成り駒の文字：金色
  font: '"TokiFont","Yu Gothic UI","Meiryo",sans-serif',
};
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
let dpr = 1, cs = 60;

// 見た目の傾き（3Dエンジンは使わず、CSS の遠近変形で盤を手前に倒す）
const VIEW = {
  TILT: 22,          // 倒す角度（度）
  PERSPECTIVE: 2.2,  // 見る距離（盤の幅の何倍か）。小さいほど遠近が強い
};
const PIECE_THICK = 0.3; // 駒の厚み（駒の幅に対する割合）
// 盤の上と下に、同じ大きさの余白（マスの何個ぶんか）を作る。端で組み合ったときの体力バーや数字が、盤の外に切れないように
const PAD_Y = 0.5;   // 盤の上と下の余白（マスの半分）
function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(w * (CFG.H + 2 * PAD_Y) / CFG.W * dpr);
  canvas.style.transform =
    `perspective(${canvas.offsetWidth * VIEW.PERSPECTIVE}px) rotateX(${VIEW.TILT}deg)`;
  balanceGaps();
}
// 盤を傾けると、奥（上）が遠ざかって上の隙間が広く、手前（下）がせり出して下の隙間が狭くなる。
// 盤の上端と下端が画面のどこに見えるかを式で求め、上下の隙間をマスの半分に詰めて、同じにそろえる
VIEW.shift = 0;
function balanceGaps() {
  const wrap = canvas.parentElement;
  wrap.style.marginBottom = '';                 // いったん元に戻してから測る
  canvas.style.translate = '0 0';
  const bw = canvas.offsetWidth, bh = canvas.offsetHeight;
  const cell = canvas.clientWidth / CFG.W;
  const border = (bw - canvas.clientWidth) / 2;
  const P = bw * VIEW.PERSPECTIVE, th = VIEW.TILT * Math.PI / 180;
  const proj = v => v * P * Math.cos(th) / (P - v * Math.sin(th)); // 盤の上の位置（中心から）→ 画面上の位置
  const cy = wrap.getBoundingClientRect().top + bh / 2;
  const vTop = -bh / 2 + border + PAD_Y * cell;                    // 盤の上端
  const vBottom = vTop + CFG.H * cell;                             // 盤の下端
  const hudTop = document.querySelector('.hud.cpu').getBoundingClientRect().bottom;
  const hudBottom = document.querySelector('.hud.you').getBoundingClientRect().top;
  const gapTop = cy + proj(vTop) - hudTop, gapBottom = hudBottom - (cy + proj(vBottom));
  // 盤の外の上下の隙間は、それぞれマスの半分あれば十分。余った分は、下の情報欄を引き上げて詰める
  // 上（相手の欄との隙間）は、その7割にする
  const wantTop = cell * 0.5 * 0.7, wantBottom = cell * 0.5;
  const excess = Math.max(0, gapTop + gapBottom - wantTop - wantBottom);
  const marginBottom = parseFloat(getComputedStyle(wrap).marginBottom) || 0;
  wrap.style.marginBottom = (marginBottom - excess) + 'px';
  // そのうえで、上下の隙間が、それぞれ狙いの大きさに近づくように、画面上で上下にずらす
  VIEW.shift = ((gapTop - wantTop) - (gapBottom - excess - wantBottom)) / 2;
  canvas.style.translate = `0 ${-VIEW.shift}px`;
}

// 画面上の位置 → 盤のマス（CSS の変形を逆算する）
function screenToCell(clientX, clientY) {
  const box = canvas.parentElement.getBoundingClientRect(); // 変形していない外枠
  const bw = canvas.offsetWidth, bh = canvas.offsetHeight;
  const X = clientX - (box.left + bw / 2);
  const Y = clientY - (box.top + bh / 2) + VIEW.shift; // 画面上でずらした分を戻す
  const P = bw * VIEW.PERSPECTIVE;
  const th = VIEW.TILT * Math.PI / 180;
  const v = Y * P / (P * Math.cos(th) + Y * Math.sin(th));
  const u = X * (P - v * Math.sin(th)) / P;
  const border = (bw - canvas.clientWidth) / 2;
  const lx = u + bw / 2 - border, ly = v + bh / 2 - border;
  const cell = canvas.clientWidth / CFG.W;
  return [Math.floor(lx / cell), Math.floor((ly - PAD_Y * cell) / cell)];
}
// 盤の縦横の比を CSS に渡す（長方形の盤）
canvas.style.setProperty('--ar', CFG.W / (CFG.H + 2 * PAD_Y));
new ResizeObserver(resize).observe(canvas);

const cellC = v => (v + 0.5) * cs;
// 美咲フォントは8ドット単位で並ぶので、文字の大きさを8の倍数にそろえる
const fpx = n => `700 ${Math.max(8, Math.round(n))}`;  // 文字の大きさ（太字）
const pulse = (speed = 4) => 0.5 + 0.5 * Math.sin(performance.now() / 1000 * speed);

// bright：動いている・回っている・成っている・組み合いで乗っている駒は、上面を明るく見せる
// 暗い色と明るい色の中間を、少し白寄りにした色（光らせはしない）
const TOP_BRIGHT = ['#2f6fe6', '#e03a50'];
const EDGE_BRIGHT = ['#5b9aff', '#ff6070'];
function drawPiece(p, px, py, ang, scale, alpha = 1, glow = null, bright = false) {
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
  const edgeC = bright ? EDGE_BRIGHT[p.side] : CLR.edge[p.side];
  ctx.fillStyle = edgeC;
  ctx.strokeStyle = edgeC;
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
  ctx.fillStyle = bright ? TOP_BRIGHT[p.side] : CLR.top[p.side];
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = outline;
  ctx.strokeStyle = edgeC;
  ctx.stroke();
  ctx.fillStyle = p.promoted ? CLR.ptext : bright ? '#ffffff' : CLR.text[p.side];
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
  ctx.font = `700 ${Math.round(cs * 0.48)}px ${CLR.pieceFont}`;
  const tw = ctx.measureText('100').width;
  const x = Math.max(4, Math.min(cx - (w + 4 + tw) / 2, canvas.clientWidth - w - 9 - tw)); // 盤の外へ切れないように
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = CLR.edge[side];
  ctx.shadowColor = CLR.edge[side]; ctx.shadowBlur = 6;
  ctx.fillRect(x, y, w * v / 100, h);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
  ctx.strokeText(v, x + w + 5, y + h / 2 + 1);
  ctx.fillStyle = CLR.edge[side];
  ctx.fillText(v, x + w + 5, y + h / 2 + 1);
  ctx.restore();
}
function drawRing(px, py, frac, color) {
  ctx.beginPath();
  ctx.arc(px, py, cs * 0.47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
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
  const Hp = cs * CFG.H; // 盤の高さ（長方形の盤）
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, canvas.height / dpr); // 盤の外の余白は透明のまま（体力バーなどがはみ出して見える場所）
  ctx.translate(0, PAD_Y * cs);              // 以降は、盤の左上を原点にして描く

  // 盤：真っ黒に細い線と交点の十字
  ctx.fillStyle = CLR.board;
  ctx.fillRect(0, 0, W, Hp);
  for (let x = 0; x < CFG.W; x++) {
    ctx.fillStyle = CLR.zone[0]; ctx.fillRect(x * cs, 0, cs, cs * 2);
    ctx.fillStyle = CLR.zone[1]; ctx.fillRect(x * cs, (CFG.H - 2) * cs, cs, cs * 2);
  }
  ctx.strokeStyle = CLR.line;
  ctx.lineWidth = 1;
  for (let i = 1; i < CFG.W; i++) {
    ctx.beginPath(); ctx.moveTo(i * cs + 0.5, 0); ctx.lineTo(i * cs + 0.5, Hp); ctx.stroke();
  }
  for (let i = 1; i < CFG.H; i++) {
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
  // 盤の枠：盤の部分だけに引く
  ctx.save();
  ctx.strokeStyle = '#3fdc78'; ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(63,220,120,0.55)'; ctx.shadowBlur = 12;
  ctx.strokeRect(1, 1, W - 2, Hp - 2);
  ctx.restore();
  if (!G) return;

  // 選択中の駒：マスを光らせ、四隅に括弧
  const sel = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  if (sel) {
    ctx.fillStyle = `rgba(93,255,149,${0.12 + 0.12 * pulse()})`;
    ctx.fillRect(sel.x * cs, sel.y * cs, cs, cs);
    drawBrackets(sel.x, sel.y, CLR.sel, 2, cs * 0.24, 3);
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
    if (p.state !== 'idle' && p.state !== 'rotating' && p.state !== 'promoting') continue;
    const px = cellC(p.x), py = cellC(p.y);
    let ang = p.dir * Math.PI / 2;
    if (p.state === 'rotating') ang += p.rotD * (p.t / p.dur) * Math.PI / 2;
    const isSel = p === sel;
    // 選んだ駒は少し浮かせて光らせる。回転中・成り中の駒は明るく（そのあいだ、休みのゲージは出さない）
    const acting = p.state !== 'idle';
    drawPiece(p, px, py - (isSel ? cs * 0.08 : 0), ang, isSel ? 1.06 : 1, 1, isSel ? CLR.sel : null, acting);
    if (p.cool > 0 && !acting) drawRing(px, py, p.cool / (cooldownFor(p) || 1), 'rgba(230,240,250,0.95)');
    drawSmallHp(p, px, py);
  }

  // 行き先の候補：太めのリング（駒の上に重ねて、見失わないように）
  if (sel) {
    for (const t of legalTargets(sel)) {
      const tx = cellC(t.x), ty = cellC(t.y);
      const help = !t.cap && helpsAt(sel, t.x, t.y);
      const col = t.cap ? '#ff4757' : '#5dff95';
      const r = t.cap ? cs * 0.43 : help ? cs * 0.27 : cs * 0.2;
      const lw = cs * (help ? 0.1 : 0.09);
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2);
      ctx.lineWidth = lw + 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();   // 暗い縁取り
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke();
      if (help) {
        // ここへ動けば助太刀になる
        ctx.fillStyle = col;
        ctx.font = `${fpx(cs * 0.24)}px ${CLR.font}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('助', tx, ty + 1);
      }
      ctx.restore();
    }
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
    drawPiece(g.atk, pos.ax * cs, pos.ay * cs, g.atk.dir * Math.PI / 2, 0.88, 1, null, true);
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
    drawPiece(p, px, py - lift * cs * 0.5, p.dir * Math.PI / 2, 1 + lift, 0.95, null, true);
    drawSmallHp(p, px, py);
  }

  // 移動中・回転中・成り中の駒の上に、キャラを薄く重ねる（戦闘中は上の中継に出るので重ねない。設定でオフにできる）。
  // 青は右向き、赤は左向きが基本。左へ動くときは左向き、右へ動くときは右向き
  if (SETTINGS.chara && typeof LIVE !== 'undefined') {
    const dflt = p => p.side === 0 ? 1 : -1;
    for (const p of G.pieces) {
      let x, y, pose, face = dflt(p);
      if (p.state === 'moving') {
        const f = Math.min(1, p.t / p.dur);
        x = cellC(p.fx + (p.tx - p.fx) * f); y = cellC(p.fy + (p.ty - p.fy) * f);
        pose = 'attack-1';
        if (p.tx > p.fx) face = 1; else if (p.tx < p.fx) face = -1;
      } else if (p.state === 'rotating' || p.state === 'promoting') {
        x = cellC(p.x); y = cellC(p.y);
        pose = 'idle';
      } else continue;
      LIVE.figure(ctx, p, pose, x, y + cs * 0.5, cs * 1.33, face, 0.45);
    }
  }

  // 移動の矢印・照準・回転の矢印：駒の上に、駒の厚さ1.5個分の高さで描く
  const lift = cs * 0.84 * 0.84 * PIECE_THICK * Math.tan(VIEW.TILT * Math.PI / 180) * 1.5;
  for (const p of G.pieces) {
    const col = CLR.side[p.side];
    if (p.state === 'moving') {
      const x1 = cellC(p.fx), y1 = cellC(p.fy) - lift, x2 = cellC(p.tx), y2 = cellC(p.ty) - lift;
      const a = Math.atan2(y2 - y1, x2 - x1);
      drawArrow(x1, y1, x2 - Math.cos(a) * cs * 0.3, y2 - Math.sin(a) * cs * 0.3, col, 6, cs * 0.374);
      // 行き先に相手の駒がいれば照準
      if (occupants(p.tx, p.ty).some(q => q.side !== p.side)) drawReticle(x2, y2, cs * 0.4 + cs * 0.04 * pulse(8), col);
    } else if (p.state === 'rotating') {
      // 駒の先端が動く90度ぶんの弧
      const cx = cellC(p.x), cy = cellC(p.y) - lift, r = cs * 0.5;
      const a0 = p.dir * Math.PI / 2 - Math.PI / 2, a1 = a0 + p.rotD * Math.PI / 2;
      ctx.save();
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.shadowColor = col; ctx.shadowBlur = cs * 0.2;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1, p.rotD < 0); ctx.stroke();
      // 矢じり：弧の終わりで、進む向きへ
      const ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1);
      const tg = a1 + p.rotD * Math.PI / 2, h = cs * 0.27;
      ctx.translate(ex, ey); ctx.rotate(tg);
      ctx.beginPath(); ctx.moveTo(h, 0); ctx.lineTo(-h * 0.6, h * 0.7); ctx.lineTo(-h * 0.6, -h * 0.7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
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
  // 次の手まで：ゲージが満タンなら指示を出せる（6目盛り）
  const hands = side => {
    const full = 6, fill = slotReady(side) ? full : Math.max(0, Math.min(full - 1, Math.floor((1 - slotWait(side) / CFG.ACT_GAP) * full)));
    return '<i></i>'.repeat(fill) + '<i class="off"></i>'.repeat(full - fill); // 四角は、文字ではなく図形（字体に依存しない）
  };
  const caps = side => G.captured[side].map(t => LABEL[t]).join('') || '—';
  const sel = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  const myGrapple = G.grapples.some(g => g.atk.side === 0 || g.def.side === 0);
  let hint = G.watch ? (G.over && G.overAt ? `${G.winner === 0 ? '青' : '赤'}の勝ち。次の対戦まで ${Math.max(1, Math.ceil(WATCH_NEXT - (performance.now() - G.overAt) / 1000))}秒` : 'COM対戦を観戦中')
    : myGrapple ? '組み合い中! 隣のマスに、そこへ動ける向きの駒を置くと助太刀になります'
    : '自分の駒（青）を選んでください';
  if (sel && !G.watch) {
    if (sel.cool > 0) hint = `休み中（あと${Math.ceil(sel.cool / G.speed)}秒）`;
    else if (sel.state === 'grappled') hint = '行き先を押すと組み合いから離れます';
    else if (sel.state === 'rotating') hint = '回転中。行き先を押すと回転をやめて動きます';
    else if (sel.state === 'promoting') hint = '成っています';
    else if (canPromote(sel)) hint = '成りボタンで成れます';
    else if (legalTargets(sel).some(t => !t.cap && helpsAt(sel, t.x, t.y))) hint = '緑の「助」へ動くと助太刀になります';
    else hint = `行き先を押すか、回すボタンで向きを変える（${Math.round(CFG.ROTATE_TIME / G.speed)}秒）`;
  }
  const cd = G.countdown > 0 ? String(Math.ceil(G.countdown)) : G.startFlash > 0 ? 'START!' : '';
  if (cd !== $('count').textContent) {
    $('count').textContent = cd;
    $('count').classList.toggle('show', cd !== '');
    $('count').classList.toggle('word', cd === 'START!');
    if (cd === 'START!') { sfx('start'); if (!G.sim) SND.bgmStart(); } else if (cd) sfx('count');
  }
  const key = [hands(0), hands(1), caps(0), caps(1), hint, sel ? sel.state : '', sel ? (sel.promoted ? 1 : 0) + ',' + (sel.cool > 0 ? 1 : 0) + ',' + sel.y : ''].join('|');
  if (key === hudCache) return;
  hudCache = key;
  $('handsYou').innerHTML = hands(0);
  $('handsCpu').innerHTML = hands(1);
  $('capsYou').textContent = caps(0);
  $('capsCpu').textContent = caps(1);
  $('hint').textContent = hint;
  const canRot = !G.watch && sel && sel.state === 'idle' && !(sel.cool > 0);
  $('rotL').disabled = !canRot;
  $('rotR').disabled = !canRot;
  $('promoBtn').disabled = !(!G.watch && sel && canPromote(sel));
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  sfx('ng');
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
      if (!canAct(sel)) { toast(`次の手まであと${Math.ceil(slotWait(0) / G.speed)}秒`); return; }
      startMove(sel, t);
      G.sel = null;
      return;
    }
  }
  const p = occupants(x, y).find(selectable);
  G.sel = p && p !== sel ? p : null;
  if (G.sel) sfx('select');
  if (!p && occupants(x, y).some(q => q.side === 0 && q.state === 'grappled')) toast('乗られている駒は動けません');
}
function playerRotate(d) {
  if (!G || G.over || G.countdown > 0 || G.watch) return;
  const p = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  if (!p) { toast('先に駒を選んでください'); return; }
  if (p.state !== 'idle') { toast('今は回せません'); return; }
  if (p.cool > 0) { toast('休み中です'); return; }
  if (!canAct(p)) { toast(`次の手まであと${Math.ceil(slotWait(0) / G.speed)}秒`); return; }
  startRotate(p, d);
}
function playerPromote() {
  if (!G || G.over || G.countdown > 0 || G.watch) return;
  const p = G.sel && G.pieces.includes(G.sel) ? G.sel : null;
  if (!p) { toast('先に駒を選んでください'); return; }
  if (p.promoted || p.type === 'OU' || p.type === 'KI') { toast('この駒は成れません'); return; }
  if (!inPromoZone(p)) { toast('敵陣（色のついた2段）で成れます'); return; }
  if (p.state !== 'idle') { toast('今は成れません'); return; }
  if (p.cool > 0) { toast('休み中です'); return; }
  if (!canAct(p)) { toast(`次の手まであと${Math.ceil(slotWait(0) / G.speed)}秒`); return; }
  startPromote(p);
}

canvas.addEventListener('pointerdown', e => {
  const [x, y] = screenToCell(e.clientX, e.clientY);
  if (inB(x, y)) handleCell(x, y);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
$('rotL').addEventListener('click', () => playerRotate(-1));
$('rotR').addEventListener('click', () => playerRotate(1));
$('promoBtn').addEventListener('click', playerPromote);
window.addEventListener('keydown', e => {
  if (e.key === 'q' || e.key === 'Q') playerRotate(-1);
  else if (e.key === 'e' || e.key === 'E') playerRotate(1);
  else if (e.key === 'r' || e.key === 'R') playerPromote();
  else if (e.key === 'Escape' && G) G.sel = null;
});

// 最初の画面のルール説明の秒数は CFG から入れる（数字を変えても説明がずれないように）
function fillRuleNumbers() {
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = Math.round(CFG[el.dataset.t] * SETTINGS.sec / 3) + '秒'; });
}
fillRuleNumbers();

// ===== 開始と終わり =====
function startGame(diff, watch = false, rank = null) {
  SND.bgmStop();
  if (rank) { DIFF.rank = diffFor(rank.strength); diff = 'rank'; } // ランキング戦：相手の強さで COM の強さを決める
  newGame(diff, watch, rank);
  fillRuleNumbers();
  $('overlay').hidden = true;
  $('result').hidden = true;
  $('rankNext').hidden = true; $('resultRank').hidden = true; $('again').textContent = 'もう一度';
  // COM対戦では下の欄も「COM」と表示し、回すボタンは隠す
  $('whoYou').textContent = watch ? '青COM' : (rank && rank.myName) || 'あなた';
  $('whoCpu').textContent = watch ? '赤COM' : rank ? `${rank.name}（${rank.rankLabel}）` : 'COM';
  document.querySelector('.controls').style.display = watch ? 'none' : '';
  document.documentElement.classList.toggle('watch', !!watch);
  hudCache = '';
}
const WATCH_NEXT = 5; // 観戦：試合が終わってから次の対戦まで（秒）
function endGame(winner) {
  G.over = true;
  G.winner = winner;
  if (G.sim) return; // 先読みの試し打ちでは、画面に触らない
  SND.bgmStop();
  sfx(G.watch || winner === 0 ? 'win' : 'lose');
  const m = Math.floor(G.realTime / 60), s = Math.floor(G.realTime % 60);
  // COM対戦では「青の勝ち」「赤の勝ち」。青は青、赤は赤で表示する
  if (G.watch) $('resultTitle').innerHTML = winner === 0 ? '<span class="c-blue">青</span>の勝ち' : '<span class="c-red">赤</span>の勝ち';
  else $('resultTitle').textContent = winner === 0 ? '勝ち' : '負け';
  $('resultTime').textContent = `${m}分${String(s).padStart(2, '0')}秒`;
  if (G.watch) {
    // 観戦：結果の画面は出さず、5秒たったら次の対戦を始める（メニューを開いている間は待つ）
    const game = G;
    game.overAt = performance.now();
    const next = () => {
      if (G !== game) return;
      if (game.paused) { game.overAt += 500; setTimeout(next, 500); return; }
      if (performance.now() - game.overAt >= WATCH_NEXT * 1000) startGame('hard', true); else setTimeout(next, 200);
    };
    setTimeout(next, 200);
    return;
  }
  if (G.rank) {
    // ランキング戦：結果と順位の画面は rank-ui.js が出す
    const game = G, win = winner === 0, got = G.captured[0].length, lost = G.captured[1].length;
    const margin = Math.max(0, Math.min(1, ((win ? got - lost : lost - got)) / 6));
    const info = { rank: G.rank, win, margin, params: styleFromStats(), duration: G.realTime };
    setTimeout(() => { if (G === game && G.over && typeof RankUI !== 'undefined') RankUI.onEnd(info); }, 900);
    return;
  }
  setTimeout(() => { if (G && G.over) $('result').hidden = false; }, 900);
}
document.querySelectorAll('[data-diff]').forEach(b =>
  b.addEventListener('click', () => startGame(b.dataset.diff)));
$('watch').addEventListener('click', () => startGame('hard', true));
// フリー：押すと強さ（かんたん・ふつう・むずかしい）を出す
$('modeFree').addEventListener('click', () => {
  const h = $('freeDiff').hidden = !$('freeDiff').hidden;
  $('modeFree').setAttribute('aria-expanded', String(!h));
});
// 秒数（3・6・9）：選ぶとルール説明の秒数も変わる。覚えておく
function showSec() {
  document.querySelectorAll('[data-sec]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.sec === SETTINGS.sec)));
  fillRuleNumbers();
}
document.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => { SETTINGS.sec = +b.dataset.sec; saveSettings(); showSec(); }));
showSec();
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
  if (!sideways && !(G && G.paused)) update(dt); // 確認が出ている間は止める
  draw();
  updateHud();
  requestAnimationFrame(frame);
}
resize();
// キャンバスで使うフォントは、先に読み込んでおく
if (document.fonts) {
  document.fonts.load('700 32px "TokiFont"', '王玉飛角金銀桂香歩龍馬全杏圭と0123456789助取成').catch(() => {});
  document.fonts.load('400 16px "TokiFont"', '刻将棋').catch(() => {});
}
requestAnimationFrame(frame);

// ===== 著作権の表示と License 画面 =====
const licenseDlg = $('license');
let licenseReturn = null;
function openLicense() {
  licenseReturn = document.activeElement;
  licenseDlg.hidden = false;
  $('licenseClose').focus();
}
function closeLicense() {
  licenseDlg.hidden = true;
  if (licenseReturn && licenseReturn.focus) licenseReturn.focus();
}
$('copyright').addEventListener('click', openLicense);
$('licenseClose').addEventListener('click', closeLicense);
licenseDlg.addEventListener('click', e => { if (e.target === licenseDlg) closeLicense(); }); // 外側を押したら閉じる

// ===== スタート画面右上：アプリ一覧へ移動するボタン =====
const APPS_ICON = [
  '......###...###.',
  '.....#...#.#...#',
  '.....#...#.#...#',
  '.....#..#..#..#.',
  '.....#..#..#..#.',
  '....##..####..#.',
  '..##.......#..#.',
  '.#............#.',
  '#.............#.',
  '#..............#',
  '############...#',
  '............#..#',
  '.###########...#',
  '.#............#.',
  '..##........##..',
  '....########....'
];
(function drawAppsIcon() {
  const ictx = $('appsIcon').getContext('2d');
  // 画面のUIに合わせた明るい緑で、'#' のドットだけ描く
  ictx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--g4').trim() || '#3fdc78';
  APPS_ICON.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') ictx.fillRect(x, y, 1, 1);
  });
})();

const appsDlg = $('appsDlg');
const isJapanese = () => (navigator.language || '').toLowerCase().startsWith('ja');
function openApps() {
  $('appsMsg').textContent = isJapanese()
    ? 'アプリ一覧に移動します。\nこのゲームを離れますがよろしいですか?'
    : 'This will take you to the app list.\nDo you want to leave this game?';
  appsDlg.hidden = false;
  $('appsNo').focus(); // 誤操作を防ぐため「No」を選んでおく
}
function closeApps() {
  appsDlg.hidden = true;
  $('appsBtn').focus();
}
$('appsBtn').addEventListener('click', openApps);
$('appsYes').addEventListener('click', () => { location.href = 'https://daisuqe.github.io/'; });
$('appsNo').addEventListener('click', closeApps);
appsDlg.addEventListener('click', e => { if (e.target === appsDlg) closeApps(); }); // 外側を押したら閉じる

// ダイアログが開いている間は、ゲームのキー操作を止める（先に受け取って、ゲーム側へ渡さない）。
// Enter / Space はボタンの標準の動き（押す）に任せる
window.addEventListener('keydown', e => {
  const dlg = !menuDlg.hidden ? menuDlg : !quitDlg.hidden ? quitDlg : !appsDlg.hidden ? appsDlg : !licenseDlg.hidden ? licenseDlg : null;
  if (!dlg) return;
  const btns = [...dlg.querySelectorAll('button')];
  if (e.key === 'Escape') {
    e.preventDefault();
    dlg === menuDlg ? closeMenu() : dlg === quitDlg ? cancelQuit() : dlg === appsDlg ? closeApps() : closeLicense();
  } else if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    // フォーカスをダイアログのボタンの中だけで回す
    e.preventDefault();
    const i = btns.indexOf(document.activeElement);
    const back = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey);
    btns[(i + (back ? -1 : 1) + btns.length) % btns.length].focus();
  }
  e.stopImmediatePropagation();
}, true);

// ===== 試合中の右上の×：メニュー（試合に戻る・設定・トップに戻る）=====
const menuDlg = $('menuDlg');
const quitDlg = $('quitDlg');
function openMenu() {
  if (!G) return;
  G.paused = true; // メニューが出ている間は試合を止める
  menuDlg.hidden = false;
  $('menuResume').focus();
}
function closeMenu() {
  if (G) G.paused = false;
  menuDlg.hidden = true;
  $('quitBtn').focus();
}
// 「トップに戻る」：確認を出す（試合は止めたまま）
function openQuit() {
  $('quitMsg').textContent = isJapanese()
    ? '試合を終了してトップ画面に戻りますか?'
    : 'End the game and return to the title screen?';
  menuDlg.hidden = true;
  quitDlg.hidden = false;
  $('quitNo').focus(); // 誤操作を防ぐため「No」を選んでおく
}
// 確認で「No」：メニューに戻る
function cancelQuit() {
  quitDlg.hidden = true;
  menuDlg.hidden = false;
  $('menuTop').focus();
}
function backToTitle() {
  SND.bgmStop();
  quitDlg.hidden = true;
  menuDlg.hidden = true;
  G = null;
  $('result').hidden = true;
  $('overlay').hidden = false;
  document.querySelector('.controls').style.display = '';
  $('toast').classList.remove('show');
  hudCache = '';
}
$('quitBtn').addEventListener('click', openMenu);
$('menuResume').addEventListener('click', closeMenu);
$('menuTop').addEventListener('click', openQuit);
$('quitYes').addEventListener('click', backToTitle);
$('quitNo').addEventListener('click', cancelQuit);
menuDlg.addEventListener('click', e => { if (e.target === menuDlg) closeMenu(); }); // 外側を押したら閉じる
quitDlg.addEventListener('click', e => { if (e.target === quitDlg) cancelQuit(); });

// ボタンを押した音（回す・成りは、それぞれの音があるので除く）
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button');
  if (b && !['rotL', 'rotR', 'promoBtn', 'setSe', 'menuSe'].includes(b.id)) SND.play('ui');
});

// 設定ボタン（スタート画面）：効果音・BGM・駒の上のキャラ
(function () {
  const items = [['se', 'SE', 'サウンド（効果音）', v => SND.setSe(v)], ['bgm', 'BGM', 'サウンド（BGM）', v => SND.setBgm(v)], ['chara', 'CHARA', '駒の上のキャラ', () => {}]];
  const cap = { se: 'Se', bgm: 'Bgm', chara: 'Chara' };
  for (const [key, name, label, fn] of items) {
    // スタート画面（set〜）とメニュー（menu〜）の両方のボタンを同じ設定につなぐ
    const bs = [[$('set' + cap[key]), `${name} `], [$('menu' + cap[key]), `${label} `]];
    const show = () => { for (const [b, t] of bs) { b.textContent = t + (SETTINGS[key] ? 'ON' : 'OFF'); b.setAttribute('aria-pressed', SETTINGS[key] ? 'true' : 'false'); } };
    show();
    for (const [b] of bs) b.addEventListener('click', () => { SETTINGS[key] = !SETTINGS[key]; saveSettings(); fn(SETTINGS[key]); show(); });
  }
})();
