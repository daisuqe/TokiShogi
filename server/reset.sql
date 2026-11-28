-- ランキングの全リセット（ルールを変えたとき用）。ユーザーの登録も、COM の順位も消えます。
-- COM の100人は、次にサーバーが呼ばれたとき、最初の顔ぶれと強さで作り直されます。
-- 実行: npx wrangler d1 execute toki-rank --remote --file=reset.sql
DELETE FROM entries;
DELETE FROM matches;
DELETE FROM meta;
