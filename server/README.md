# 刻将棋 ランキングサーバー（Cloudflare Workers + D1）

ゲーム側（`rank-client.js`）は、`RANK_API` が空の間は、この端末の中だけでランキングが動きます。
このサーバーを用意して URL を入れると、全員で同じランキングを共有します。

計算（Elo・順位・相手選び）は、ゲームと同じ `../rank-core.js` を使っています。サーバーは保存と受け付けだけです。

## 用意の手順（最初の1回）

```
cd server
npm install
npx wrangler login                        # ブラウザで Cloudflare にログイン
npx wrangler d1 create toki-rank          # 出てきた database_id を wrangler.toml の database_id に書く
npx wrangler d1 execute toki-rank --remote --file=schema.sql
npx wrangler deploy                       # 出てきた URL（https://toki-rank.<アカウント>.workers.dev）を控える
```

そのあと、`../rank-client.js` の先頭の `RANK_API` にその URL を入れて、公開します。
`wrangler.toml` の `ALLOW_ORIGINS` は、ゲームのページの URL（`https://daisuqe.github.io`）が入っています。ほかの場所から呼びたいときは足してください。

COM の100人は、最初の呼び出しのときに自動で作られます。COM どうしの順位の入れ替えは、毎日 03:00（日本時間）に自動で行われます。

## 手元で試す

```
cd server
npx wrangler d1 execute toki-rank --local --file=schema.sql
npx wrangler dev --local --port 8787
```

`rank-client.js` の `RANK_API` を `http://localhost:8787` にして、ゲームを開きます（`ALLOW_ORIGINS` に、開いている URL が入っている必要があります）。

## API

| | |
|---|---|
| `GET /api/ranking` | 順位表（1〜100位） |
| `POST /api/me` | 自分の登録の状態 |
| `POST /api/opponent` | 次の相手と、結果を送るときの引換券（登録前は90〜100位の誰か） |
| `POST /api/preview` | 登録したらどうなるか |
| `POST /api/register` | 名前（英大文字4文字）を登録。端末が作った秘密の印（token）の SHA-256 だけを保存 |
| `POST /api/result` | 結果を送る（引換券は1回きり。相手を受け取ってから15秒たたないと送れない） |

## ルール

- 名前は英大文字4文字。COM の名前や、すでにいる人の名前は使えない
- ユーザーは最大100人まで席をとり、その分、弱い COM から押し出される
- 100人がすべてユーザーのとき、100位より弱い人は「○○位なのでランキングには登録されません」（101〜120位で表示）
- うち筋の傾向（aggr 攻撃性・tempo 指示の速さ・support 助太刀・rotation 回す・promote 成る・kingDef 王の守り・retreat 引く）を、試合ごとに少しずつ更新して保存。他のユーザーと戦うときは、その人の強さと傾向で COM が戦う

## 不正への備え（簡易）

結果はゲーム側から送るため、悪意があれば偽装できます。個人のゲームとして、次までにしています。
引換券（1回きり・15秒以上・2時間以内）、登録は同じ接続元から1時間に5回まで、名前の持ち主は token で確認。
