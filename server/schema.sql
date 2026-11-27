-- 刻将棋のランキング（Cloudflare D1）。作り方は server/README.md
CREATE TABLE IF NOT EXISTS entries (
  name       TEXT PRIMARY KEY,          -- 英大文字4文字
  kind       TEXT NOT NULL,             -- 'com' か 'user'
  rating     REAL NOT NULL,             -- Elo
  games      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  params     TEXT,                      -- うち筋の傾向（JSON：aggr, tempo, support, rotation, promote, kingDef, retreat）
  token_hash TEXT,                      -- 名前の持ち主の印（ユーザーだけ。SHA-256）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_kind_rating ON entries (kind, rating DESC);

-- 渡した相手の記録（結果を送るときの引換券）。ユーザーが未登録のときは user が NULL
CREATE TABLE IF NOT EXISTS matches (
  nonce     TEXT PRIMARY KEY,
  user      TEXT,
  opp       TEXT NOT NULL,
  issued_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS ratelimit (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset_at INTEGER NOT NULL);
