# TripBoard

Gmailに届く出張予約メールを解析し、航空券・ホテルを別々に保持したうえで出張単位にまとめるiPhone向けPWAです。

公開URLは既存どおり次を維持します。

```text
https://kobasho-unihota.github.io/myportfolio/apps/trip-dashboard/
```

## 方針

- GitHub Pagesで配信できる静的PWA
- iPhone優先のカードUI
- Gmail messageId単位でAI抽出結果をキャッシュする
- AI JSONはschema validationしてからBookingへ変換する
- confidenceが低いメールや分類不能メールは要確認に残す
- GitHub PagesにはAI APIキーを置かず、将来は認証付きAI proxyから呼び出す

## 開発

```bash
python3 -m http.server 4173
node --test apps/trip-dashboard/test/*.test.mjs
node --test apps/trip-dashboard/core.test.mjs apps/trip-dashboard/gmail.test.mjs
```

`http://localhost:4173/apps/trip-dashboard/` を開きます。
