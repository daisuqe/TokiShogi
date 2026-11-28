// 刻将棋のランキングの計算（ブラウザの端末内ランキングと、Cloudflare のサーバーの、両方で同じものを使う）
// 1位〜100位。最初は COM が100人。ユーザーは必ずランキングに入り（最大100人）、入った分だけ弱い COM から押し出される。
// 強さは Elo（チェス・FIFA と同じ。勝てば上がり、格上に勝つほど大きく上がる）。順位はレーティングの高い順。
(function (root) {
  'use strict';

  const MAX_ENTRIES = 100;       // ランキングの人数
  const NEAR = 20;               // 自分の順位の上下何人と戦うか
  const FIRST_LO = 90, FIRST_HI = 100;   // 登録前の1戦目の相手：90〜100位
  const R_TOP = 1940, R_BOTTOM = 1200;   // 最初の COM のレーティング（1位 〜 100位）
  const K_NEW = 64, K_USER = 40, K_OPP = 20, K_COM = 16, NEW_GAMES = 10;   // 1戦での動きの大きさ（新人は大きめ）
  const DRAW_RATE = 0.08, DAILY_MATCHES_PER_COM = 4;
  const STYLE_KEYS = ['aggr', 'tempo', 'support', 'rotation', 'promote', 'kingDef', 'retreat'];
  // aggr 攻撃性 / tempo 指示の速さ / support 助太刀に入る / rotation 回す / promote 成る / kingDef 王の守り / retreat 組み合いから引く
  const STYLE_EMA = 0.3;         // うち筋の傾向の更新：新しい試合の重み

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const clamp01 = x => clamp(x, 0, 1);

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));   // ra が rb に勝つ見込み
  // レーティング → COM の強さ（0〜1）。0 = かんたん、0.5 = ふつう、1 = むずかしい
  const strengthOf = rating => clamp01((rating - R_BOTTOM) / (1900 - R_BOTTOM));
  const neutralStyle = () => Object.fromEntries(STYLE_KEYS.map(k => [k, 0.5]));

  // 名前：英大文字4文字
  const NAME_RE = /^[A-Z]{4}$/;
  const validName = name => typeof name === 'string' && NAME_RE.test(name);
  const cleanName = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  // 最初の COM 100人：読みやすい名前（子音＋母音を2回）と、うち筋の傾向をランダムに決める（いつも同じ顔ぶれ）
  function makeComs() {
    const rng = mulberry32(20261127);
    const C = 'BDGKMNPRSTZ', V = 'AEIOU';
    const names = new Set();
    while (names.size < MAX_ENTRIES) {
      const n = [C, V, C, V].map(s => s[Math.floor(rng() * s.length)]).join('');
      names.add(n);
    }
    return [...names].map((name, i) => {
      const params = {};
      for (const k of STYLE_KEYS) params[k] = Math.round((0.2 + rng() * 0.6) * 100) / 100;
      return {
        name, isCom: true, params, games: 0,
        rating: Math.round((R_TOP - i * (R_TOP - R_BOTTOM) / (MAX_ENTRIES - 1)) * 10) / 10,
      };
    });
  }

  const byRating = (a, b) => b.rating - a.rating || (a.name < b.name ? -1 : 1);

  // 順位表：ユーザー（最大100人）が先に席をとり、残りの席を、強い順に COM が埋める。順位はレーティングの高い順
  function standings(users, coms) {
    const us = users.slice().sort(byRating).slice(0, MAX_ENTRIES);
    const cs = coms.slice().sort(byRating).slice(0, MAX_ENTRIES - us.length);
    const rows = us.map(u => ({ ...u, isCom: false })).concat(cs.map(c => ({ ...c, isCom: true }))).sort(byRating);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  // 登録前の1戦目の相手：90〜100位の誰か
  function firstOpponent(rows, rng = Math.random) {
    const pool = rows.filter(r => r.rank >= FIRST_LO && r.rank <= FIRST_HI);
    const list = pool.length ? pool : rows.slice(-11);
    return list[Math.floor(rng() * list.length)];
  }

  // 登録後の相手：自分の順位の上下 NEAR 位以内。上位の人は、上にいる人数と同じ人数だけ下と戦う（1位は2〜5位）
  function pickOpponent(rows, name, rng = Math.random) {
    const me = rows.find(r => r.name === name);
    const rank = me ? me.rank : MAX_ENTRIES;   // ランキング外の人は、100位として扱う
    const k = Math.min(NEAR, rank - 1);
    const lo = rank === 1 ? 2 : rank - k, hi = rank === 1 ? 5 : rank + k;
    const pool = rows.filter(r => r.name !== name && r.rank >= lo && r.rank <= hi);
    return pool.length ? pool[Math.floor(rng() * pool.length)] : rows.find(r => r.name !== name);
  }

  // 1戦目の結果から、登録するときのレーティングを決める。勝てば相手より上、負けるなら負けっぷりの分だけ下
  // margin：0〜1（勝ったときは圧勝ぶり、負けたときは負けっぷり）
  function initialRating(oppRating, result, margin = 0) {
    const m = clamp01(margin);
    return Math.round((result >= 1 ? oppRating + 30 + 60 * m : oppRating - 40 - 120 * m) * 10) / 10;
  }

  // 登録するとどうなるか：ランキング内なら順位。100人がすでにユーザーで、それより弱いときは、圏外（101〜120位で表示）
  function previewEntry(users, coms, rating) {
    const probe = { name: '\u0000', rating, isCom: false };
    const rows = standings(users.concat(probe), coms);
    const me = rows.find(r => r.name === probe.name);
    if (me) return { registered: true, rank: me.rank };
    const lowest = rows[rows.length - 1].rating;
    return { registered: false, rank: 101 + clamp(Math.floor((lowest - rating) / 12), 0, 19) };
  }

  // 1戦の結果を反映する。result: 1 = あなたの勝ち、0 = 負け。me / opp のレーティングを書き換える
  function applyResult(me, opp, result) {
    const e = expected(me.rating, opp.rating);
    const k = (me.games || 0) < NEW_GAMES ? K_NEW : K_USER;
    const delta = k * (result - e);
    me.rating += delta;
    opp.rating -= K_OPP * (result - e);
    me.games = (me.games || 0) + 1;
    opp.games = (opp.games || 0) + 1;
    if (result >= 1) me.wins = (me.wins || 0) + 1; else me.losses = (me.losses || 0) + 1;
    return delta;
  }

  // うち筋の傾向（0〜1 の数個）を、新しい試合の分だけ少し動かす
  function mergeStyle(old, obs) {
    if (!old) return { ...obs };
    const out = {};
    for (const k of STYLE_KEYS) out[k] = Math.round(((old[k] ?? 0.5) * (1 - STYLE_EMA) + clamp01(obs[k] ?? 0.5) * STYLE_EMA) * 1000) / 1000;
    return out;
  }
  function cleanStyle(p) {
    const out = {};
    for (const k of STYLE_KEYS) { const v = p ? Number(p[k]) : NaN; out[k] = Number.isFinite(v) ? Math.round(clamp01(v) * 1000) / 1000 : 0.5; }
    return out;
  }

  // COM どうしの対戦（1日1回）：順位の近い COM と対戦して、COM の順位も入れ替える
  function dailyUpdate(coms, rng) {
    const order = coms.slice().sort(byRating);
    const n = coms.length * DAILY_MATCHES_PER_COM;
    for (let i = 0; i < n; i++) {
      const ia = Math.floor(rng() * order.length);
      const lo = Math.max(0, ia - NEAR), hi = Math.min(order.length - 1, ia + NEAR);
      let ib = lo + Math.floor(rng() * (hi - lo + 1));
      if (ib === ia) ib = ia === hi ? ia - 1 : ia + 1;
      if (ib < 0 || ib >= order.length) continue;
      const a = order[ia], b = order[ib], e = expected(a.rating, b.rating);
      const s = rng() < DRAW_RATE ? 0.5 : rng() < e ? 1 : 0;
      a.rating += K_COM * (s - e);
      b.rating -= K_COM * (s - e);
    }
  }

  // 顔（キャラクターエディットの部品と色）：形だけ確かめる。部品の名前が本当にあるかは、表示する側（face.js）で確かめる
  function cleanAvatar(a) {
    if (!a || typeof a !== 'object') return null;
    const part = v => typeof v === 'string' && /^[a-z0-9]{1,10}$/.test(v);
    const col = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
    if (!part(a.hair) || !part(a.eyes) || !part(a.mouth) || !col(a.skinColor) || !col(a.hairColor) || !col(a.clothColor)) return null;
    return { hair: a.hair, eyes: a.eyes, mouth: a.mouth, skinColor: a.skinColor.toUpperCase(), hairColor: a.hairColor.toUpperCase(), clothColor: a.clothColor.toUpperCase() };
  }

  const API = {
    MAX_ENTRIES, NEAR, STYLE_KEYS, clamp, clamp01, hash, mulberry32, expected, strengthOf, neutralStyle,
    validName, cleanName, makeComs, standings, firstOpponent, pickOpponent, initialRating, previewEntry,
    applyResult, mergeStyle, cleanStyle, dailyUpdate, byRating, cleanAvatar,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RankCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
