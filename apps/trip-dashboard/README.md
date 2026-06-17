# TripBoard

Gmailに届く出張予約メールを解析し、航空券・ホテルを別々に保持したうえで出張単位にまとめるiPhone向けPWAです。

公開URLは既存どおり次を維持します。

```text
https://kobasho-unihota.github.io/myportfolio/apps/trip-dashboard/
```

## 方針

- GitHub Pagesで配信できる静的PWA
- iPhone優先のカードUI
- parser registryで航空会社・ホテル予約サイトを追加しやすくする
- parserは直接Bookingにせず、ParseResultを経由する
- 解析できないメールはUnclassifiedMessageとして要確認に残す

## 開発

```bash
python3 -m http.server 4173
node --test apps/trip-dashboard/test/*.test.mjs
node --test apps/trip-dashboard/core.test.mjs apps/trip-dashboard/gmail.test.mjs
```

`http://localhost:4173/apps/trip-dashboard/` を開きます。
