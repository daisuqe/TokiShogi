// 刻将棋のランキングサーバー（Cloudflare Workers + D1）
// 計算は、ゲーム側と同じ rank-core.js を使う。ここは「保存」と「受け付け」だけ。
//   GET  /api/ranking                      順位表（1〜100位）
//   POST /api/me        { name, token }    自分の登録の状態
//   POST /api/opponent  { name?, token? }  次の相手（登録前は90〜100位の誰か）と、結果を送るときの引換券（nonce）
//   POST /api/preview   { opp, result, margin }                    登録するとどうなるか
//   POST /api/register  { name, token, opp, nonce, result, margin } 名前を登録（tokenは端末が作った秘密の印）
//   POST /api/result    { name, token, nonce, result, params }     結果を送る
import RC from '../../rank-core.js';

const MIN_GAME_SEC = 15;          // 相手を受け取ってから、結果を送れるまでの最短（秒）
const MAX_GAME_SEC = 2 * 60 * 60; // この時間を過ぎた引換券は使えない
const REGISTER_PER_HOUR = 5;      // 同じ接続元から、1時間に登録できる回数

const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', ...headers } });
const now = () => Date.now();

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allow = (env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allow.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' } : { 'Vary': 'Origin' };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
const newNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

// ----- 保存 -----
const rowOf = r => ({ name: r.name, rating: r.rating, games: r.games, wins: r.wins, losses: r.losses, isCom: r.kind === 'com', params: r.params ? JSON.parse(r.params) : RC.neutralStyle() });

async function seedComs(env) {
  const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE kind='com'").all();
  if (results[0].n > 0) return;
  const t = now();
  const stmts = RC.makeComs().map(c => env.DB.prepare("INSERT OR IGNORE INTO entries (name, kind, rating, games, params, created_at, updated_at) VALUES (?1, 'com', ?2, 0, ?3, ?4, ?4)")
    .bind(c.name, c.rating, JSON.stringify(c.params), t));
  await env.DB.batch(stmts);
}
async function loadAll(env) {
  await seedComs(env);
  const { results } = await env.DB.prepare('SELECT name, kind, rating, games, wins, losses, params FROM entries').all();
  const all = results.map(rowOf);
  return { users: all.filter(r => !r.isCom), coms: all.filter(r => r.isCom) };
}
const standingsOf = ({ users, coms }) => RC.standings(users, coms);
const pub = r => ({ name: r.name, rank: r.rank, rating: Math.round(r.rating), isCom: !!r.isCom, params: r.params || RC.neutralStyle() });

async function authUser(env, name, token) {
  if (!RC.validName(name) || typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  const row = await env.DB.prepare("SELECT name, rating, games, wins, losses, params, token_hash FROM entries WHERE name=?1 AND kind='user'").bind(name).first();
  if (!row || row.token_hash !== await sha256(token)) return null;
  return row;
}

async function rateLimit(env, key, limit, windowSec) {
  const t = now();
  const row = await env.DB.prepare('SELECT n, reset_at FROM ratelimit WHERE k=?1').bind(key).first();
  if (!row || row.reset_at < t) {
    await env.DB.prepare('INSERT OR REPLACE INTO ratelimit (k, n, reset_at) VALUES (?1, 1, ?2)').bind(key, t + windowSec * 1000).run();
    return true;
  }
  if (row.n >= limit) return false;
  await env.DB.prepare('UPDATE ratelimit SET n = n + 1 WHERE k=?1').bind(key).run();
  return true;
}

async function takeNonce(env, nonce, user) {
  if (typeof nonce !== 'string' || nonce.length > 64) return null;
  const m = await env.DB.prepare('SELECT nonce, user, opp, issued_at FROM matches WHERE nonce=?1').bind(nonce).first();
  if (!m) return null;
  if ((m.user || null) !== (user || null)) return null;
  const age = (now() - m.issued_at) / 1000;
  if (age < MIN_GAME_SEC || age > MAX_GAME_SEC) return null;
  await env.DB.prepare('DELETE FROM matches WHERE nonce=?1').bind(nonce).run();   // 1回きり
  return m;
}

// ----- 受け付け -----
async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch (e) { return json({ error: 'bad-json' }, 400); } }

  if (path === '/api/ranking' && request.method === 'GET') {
    const rows = standingsOf(await loadAll(env));
    return json({ rows: rows.map(pub) });
  }

  if (path === '/api/me') {
    const u = await authUser(env, body.name, body.token);
    if (!u) return json({ registered: false });
    const rows = standingsOf(await loadAll(env));
    const r = rows.find(x => x.name === u.name);
    return json({ registered: true, name: u.name, rank: r ? r.rank : 101, rating: Math.round(u.rating), inRanking: !!r });
  }

  if (path === '/api/opponent' && request.method === 'POST') {
    const rows = standingsOf(await loadAll(env));
    const u = await authUser(env, body.name, body.token);
    const opp = u ? RC.pickOpponent(rows, u.name) : RC.firstOpponent(rows);
    const nonce = newNonce();
    await env.DB.prepare('INSERT INTO matches (nonce, user, opp, issued_at) VALUES (?1, ?2, ?3, ?4)').bind(nonce, u ? u.name : null, opp.name, now()).run();
    await env.DB.prepare('DELETE FROM matches WHERE issued_at < ?1').bind(now() - MAX_GAME_SEC * 1000).run();   // 古い引換券の掃除
    return json({ ...pub(opp), nonce, first: !u });
  }

  if (path === '/api/preview' && request.method === 'POST') {
    const all = await loadAll(env);
    const opp = [...all.users, ...all.coms].find(r => r.name === body.opp);
    if (!opp) return json({ error: 'no-opponent' }, 400);
    const rating = RC.initialRating(opp.rating, body.result >= 1 ? 1 : 0, Number(body.margin) || 0);
    return json(RC.previewEntry(all.users, all.coms, rating));
  }

  if (path === '/api/register' && request.method === 'POST') {
    const name = RC.cleanName(body.name);
    if (!RC.validName(name)) return json({ ok: false, error: '英大文字4文字で入力してください' });
    if (typeof body.token !== 'string' || body.token.length < 16 || body.token.length > 128) return json({ ok: false, error: 'bad-token' }, 400);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await rateLimit(env, 'reg:' + await sha256(ip), REGISTER_PER_HOUR, 3600)) return json({ ok: false, error: 'しばらくしてからもう一度' }, 429);
    const all = await loadAll(env);
    if ([...all.users, ...all.coms].some(r => r.name === name)) return json({ ok: false, error: 'その名前は使われています' });
    const m = await takeNonce(env, body.nonce, null);
    if (!m) return json({ ok: false, error: 'もう一度対戦してください' });
    const opp = [...all.users, ...all.coms].find(r => r.name === m.opp);
    if (!opp) return json({ ok: false, error: 'もう一度対戦してください' });
    const result = body.result >= 1 ? 1 : 0;
    const rating = RC.initialRating(opp.rating, result, Number(body.margin) || 0);
    const pv = RC.previewEntry(all.users, all.coms, rating);
    if (pv.registered) {
      const t = now();
      await env.DB.prepare("INSERT INTO entries (name, kind, rating, games, wins, losses, params, token_hash, created_at, updated_at) VALUES (?1, 'user', ?2, 1, ?3, ?4, NULL, ?5, ?6, ?6)")
        .bind(name, rating, result, 1 - result, await sha256(body.token), t).run();
    }
    return json({ ok: true, registered: pv.registered, rank: pv.rank });
  }

  if (path === '/api/result' && request.method === 'POST') {
    const u = await authUser(env, body.name, body.token);
    if (!u) return json({ error: 'auth' }, 401);
    const m = await takeNonce(env, body.nonce, u.name);
    if (!m) return json({ error: 'no-match' }, 400);
    const all = await loadAll(env);
    const rowsBefore = standingsOf(all);
    const meBefore = rowsBefore.find(r => r.name === u.name);
    const me = all.users.find(r => r.name === u.name);
    const opp = [...all.users, ...all.coms].find(r => r.name === m.opp);
    if (!me || !opp) return json({ error: 'no-match' }, 400);
    const oldRating = me.rating;
    RC.applyResult(me, opp, body.result >= 1 ? 1 : 0);
    const params = RC.mergeStyle(u.params ? JSON.parse(u.params) : null, RC.cleanStyle(body.params));
    const t = now();
    await env.DB.batch([
      env.DB.prepare('UPDATE entries SET rating=?2, games=?3, wins=?4, losses=?5, params=?6, updated_at=?7 WHERE name=?1').bind(me.name, me.rating, me.games, me.wins || 0, me.losses || 0, JSON.stringify(params), t),
      env.DB.prepare('UPDATE entries SET rating=?2, games=?3, updated_at=?4 WHERE name=?1').bind(opp.name, opp.rating, opp.games || 0, t),
    ]);
    const rowsAfter = standingsOf(all);
    const meAfter = rowsAfter.find(r => r.name === u.name);
    return json({ oldRank: meBefore ? meBefore.rank : 101, newRank: meAfter ? meAfter.rank : 101, rating: Math.round(me.rating), delta: Math.round(me.rating - oldRating) });
  }

  return json({ error: 'not-found' }, 404);
}

// 毎日1回：COM どうしの対戦で、COM の順位を入れ替える
async function daily(env) {
  const { coms } = await loadAll(env);
  const day = new Date().toISOString().slice(0, 10);
  const last = await env.DB.prepare("SELECT v FROM meta WHERE k='lastDaily'").first();
  if (last && last.v === day) return;
  RC.dailyUpdate(coms, RC.mulberry32(RC.hash(day)));
  const t = now();
  await env.DB.batch([
    ...coms.map(c => env.DB.prepare('UPDATE entries SET rating=?2, updated_at=?3 WHERE name=?1').bind(c.name, c.rating, t)),
    env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('lastDaily', ?1)").bind(day),
  ]);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await handle(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return json({ error: 'server' }, 500, cors);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(daily(env)); },
};
