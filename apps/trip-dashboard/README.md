# TripBoard

GmailのJAL国内線・楽天トラベル予約メールを読み込み、出張単位でまとめるiPhone向けPWAです。

詳細は [アプリ仕様書](./SPEC.md) を参照してください。

## 開発

```bash
python3 -m http.server 4173
node --test trip-dashboard/core.test.mjs trip-dashboard/gmail.test.mjs
```

`http://localhost:4173/trip-dashboard/` を開きます。

## Firebase

既存の `seed-note-kobasho` Firebaseプロジェクトを使用します。Firestoreルールでは、ログインユーザー本人に次のパスの読み書きを許可してください。

```text
users/{uid}/tripDashboard/bookings/items/{bookingId}
users/{uid}/tripDashboard/settings
```

Google認証プロバイダとGmail APIを有効化し、OAuth同意画面のテストユーザーに利用者本人を追加します。
