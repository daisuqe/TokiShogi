-- 顔（avatar）の列を足す（2026-11-28）。すでに動いているデータベースに1回だけ実行する
-- npx wrangler d1 execute toki-rank --remote --file=migrate-avatar.sql
ALTER TABLE entries ADD COLUMN avatar TEXT;
