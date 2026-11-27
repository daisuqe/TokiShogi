// ランキングの窓口。サーバー（Cloudflare）につなぐか、つなげない・まだ用意していないときは、この端末の中だけで動く。
// どちらも同じ形で使える：
//   ranking()                          順位表（1〜100位）
//   me()                               自分の登録の状態 { registered, name, rank, rating, ... }
//   opponent()                         次の相手 { name, rank, rating, isCom, params, nonce, first }
//   preview(opp, result, margin)       登録したらどうなるか { registered, rank }
//   register(name, opp, result, margin) 名前を登録する { ok, error, registered, rank }
//   submit(nonce, result, params)      結果を送る { oldRank, newRank, rating, delta }
// サーバーを用意したら、ここに URL を入れる（例：'https://toki-rank.<あなたのアカウント>.workers.dev'）。空なら端末の中だけ。
const RANK_API = '';

const RankClient = (() => {
  const RC = RankCore;
  const KEY_ME = 'toki-rank-me';     // { name, token }（この端末の名前の持ち主の印）
  const KEY_LOCAL = 'toki-rank-local-v1';
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } };
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const pubRow = r => ({ name: r.name, rank: r.rank, rating: Math.round(r.rating), isCom: !!r.isCom, params: r.params || RC.neutralStyle() });

  // ===== この端末の中だけのランキング（サーバーがないとき）=====
  function localBackend() {
    let st = load(KEY_LOCAL);
    if (!st || !Array.isArray(st.coms)) st = { coms: RC.makeComs(), user: null, lastDaily: '', pending: null };
    const persist = () => save(KEY_LOCAL, st);
    const today = () => new Date().toISOString().slice(0, 10);
    if (st.lastDaily !== today()) { RC.dailyUpdate(st.coms, RC.mulberry32(RC.hash(today()))); st.lastDaily = today(); persist(); }
    const users = () => st.user ? [st.user] : [];
    const rows = () => RC.standings(users(), st.coms);
    return {
      async ranking() { return rows().map(pubRow); },
      async me() {
        if (!st.user) return { registered: false };
        const r = rows().find(x => x.name === st.user.name);
        return { registered: true, name: st.user.name, rank: r ? r.rank : 101, rating: Math.round(st.user.rating), inRanking: !!r };
      },
      async opponent() {
        const all = rows();
        const first = !st.user;
        const o = first ? RC.firstOpponent(all) : RC.pickOpponent(all, st.user.name);
        st.pending = { name: o.name, t: Date.now(), nonce: newToken() };
        persist();
        return { ...pubRow(o), nonce: st.pending.nonce, first };
      },
      async preview(opp, result, margin) {
        const rating = RC.initialRating(opp.rating, result, margin);
        return RC.previewEntry(users(), st.coms, rating);
      },
      async register(name, opp, result, margin) {
        name = RC.cleanName(name);
        if (!RC.validName(name)) return { ok: false, error: '英大文字4文字で入力してください' };
        if (st.coms.some(c => c.name === name)) return { ok: false, error: 'その名前は使われています' };
        const rating = RC.initialRating(opp.rating, result, margin);
        const pv = RC.previewEntry(users(), st.coms, rating);
        const token = newToken();
        st.user = { name, rating, games: 1, wins: result >= 1 ? 1 : 0, losses: result >= 1 ? 0 : 1, params: null };
        save(KEY_ME, { name, token });
        persist();
        return { ok: true, registered: pv.registered, rank: pv.rank };
      },
      async submit(nonce, result, params) {
        if (!st.user || !st.pending || st.pending.nonce !== nonce) return { error: 'no-match' };
        const before = rows().find(x => x.name === st.user.name);
        const oldRank = before ? before.rank : 101, oldRating = st.user.rating;
        const opp = st.coms.find(c => c.name === st.pending.name);
        const dummy = opp || { rating: 1500, games: 0 };
        RC.applyResult(st.user, dummy, result);
        st.user.params = RC.mergeStyle(st.user.params, RC.cleanStyle(params));
        st.pending = null;
        persist();
        const after = rows().find(x => x.name === st.user.name);
        return { oldRank, newRank: after ? after.rank : 101, rating: Math.round(st.user.rating), delta: Math.round(st.user.rating - oldRating) };
      },
    };
  }

  // ===== サーバー（Cloudflare Workers）のランキング =====
  function remoteBackend(base) {
    const api = async (path, body) => {
      const mine = load(KEY_ME);
      const res = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify({ ...body, name: body.name || (mine && mine.name), token: mine && mine.token }) : undefined,
      });
      return res.json();
    };
    return {
      async ranking() { return (await api('/api/ranking')).rows || []; },
      async me() {
        const mine = load(KEY_ME);
        if (!mine) return { registered: false };
        const r = await api('/api/me', {});
        return r.registered ? r : { registered: false };
      },
      async opponent() { return api('/api/opponent', {}); },
      async preview(opp, result, margin) { return api('/api/preview', { opp: opp.name, result, margin }); },
      async register(name, opp, result, margin) {
        const token = newToken();
        const mine = load(KEY_ME);
        const r = await fetch(base + '/api/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, token, opp: opp.name, nonce: opp.nonce, result, margin }),
        }).then(x => x.json());
        if (r.ok) save(KEY_ME, { name, token });
        else if (mine) save(KEY_ME, mine);
        return r;
      },
      async submit(nonce, result, params) { return api('/api/result', { nonce, result, params }); },
    };
  }

  const backend = RANK_API ? remoteBackend(RANK_API.replace(/\/$/, '')) : localBackend();
  return { ...backend, remote: !!RANK_API };
})();
