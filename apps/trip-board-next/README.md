# TripBoard Next

Gmailに届く出張予約メールを解析し、航空券・ホテルを別々に保持したうえで出張単位にまとめるTripBoardの再構築版です。

## 方針

- GitHub Pagesで配信できる静的PWA
- iPhone優先のカードUI
- parser registryで航空会社・ホテル予約サイトを追加しやすくする
- parserは直接Bookingにせず、ParseResultを経由する
- 解析できないメールはUnclassifiedMessageとして要確認に残す

## 開発

```bash
python3 -m http.server 4173
node --test apps/trip-board-next/test/*.test.mjs
```

`http://localhost:4173/apps/trip-board-next/` を開きます。
