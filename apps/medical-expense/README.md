# Medipass

医療費控除に向けて、家族の医療費と領収書の保管状況を日々記録する静的Webアプリです。

## 主な機能

- 医療費・補てん金・通院交通費・領収書状態の記録
- 年、家族、区分、キーワードによる絞り込み
- 家族別集計と医療費控除額の概算
- CSV出力、JSONバックアップ・復元
- 未ログイン時にブラウザの `localStorage` を使う端末内保存
- GoogleログインによるPC・スマートフォン間のFirebase同期
- 領収書写真をGemini APIで解析し、入力フォームへ下書き反映

AI読み取りでは利用者自身のGemini APIキーを端末内に保存します。領収書画像は解析時のみGemini APIへ送信し、MedipassやFirebaseには保存しません。

## 開発

```bash
python3 -m http.server 4173
node --test medical-expense/core.test.mjs
```

`http://localhost:4173/medical-expense/` を開いて確認します。

## 注意

控除額は入力値をもとにした概算です。対象費用や申告方法は、申告年の国税庁資料や税務署への相談で確認してください。
