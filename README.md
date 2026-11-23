# 刻将棋（TokiShogi）

順番のない、リアルタイムの将棋です。ブラウザで遊べます（スマホは縦向き）。

**遊ぶ：** https://daisuqe.github.io/TokiShogi/

## ルール

- 順番はありません。王（玉）を取ったら勝ち。
- 駒を選んで行き先を押すと動きます。
- 回すボタンで90度回転。向きで動ける方向が変わります。
- 相手の駒に乗ると組み合い。体力が0になった方が取られます。
- 組み合いの隣で、そのマスへ動ける向きの駒は自動で助太刀します。

細かい秒数（移動3秒・回転9秒・休み3秒／王6秒など）は、ゲームの最初の画面に出ます。
数字はすべて `game.js` の先頭の `CFG` にまとまっていて、`U`（3秒）を変えると全体の速さが変わります。

## ファイル

| ファイル | 中身 |
|---|---|
| `index.html` | 画面 |
| `style.css` | 見た目 |
| `game.js` | ルール・COM・描画 |
| `misaki_gothic.woff2` | 美咲ゴシック（画面の文字） |
| `icons/` | タブのアイコン（16・32px）と、iPhone のホーム画面用アイコン（180px） |

## 使っているフォント

- [美咲フォント](https://littlelimit.net/misaki.htm)（美咲ゴシック）：画面の文字
- [M PLUS 1 Code](https://fonts.google.com/specimen/M+PLUS+1+Code)（Google Fonts）：駒の文字とルール説明

Copyright (c) 2026 daisuqe. All rights reserved.
無断での複製・改変・再配布・転載を禁じます(詳しくは `LICENSE` を見てください)。
