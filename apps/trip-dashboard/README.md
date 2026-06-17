# TripBoard

Gmailの出張関連メールをAIで分類し、航空券・ホテル・要確認メールを出張単位でまとめるiPhone向けPWAです。

公開URL: https://kobasho-unihota.github.io/myportfolio/apps/trip-dashboard/

## 開発

```bash
python3 -m http.server 4173
node --test apps/trip-dashboard/ai-core.test.mjs apps/trip-dashboard/core.test.mjs apps/trip-dashboard/gmail.test.mjs
```

`http://localhost:4173/apps/trip-dashboard/` を開きます。

## AI分類

- PWAは直近2か月のJAL国内線・楽天トラベル候補メールをGmailから取得し、ユーザーが選択したメールだけブラウザからGemini APIへ送ります。
- Gemini APIキーは利用者の端末のLocalStorageに保存します。公開コードへキーを直接記載しません。
- FirestoreにはGmail本文を保存しません。保存するのはmessageId単位のAI JSON、検証状態、予約表示用データです。
- `confidence < 0.75`、分類不能、必須項目不足、解析失敗は要確認として残します。

## Firebase

既存の `seed-note-kobasho` Firebaseプロジェクトを使用します。Firestoreルールでは、ログインユーザー本人に次のパスの読み書きを許可してください。

```text
users/{uid}/tripDashboard/bookings/items/{bookingId}
users/{uid}/tripDashboard/aiAnalyses/items/{messageId}
users/{uid}/tripDashboard/settings
```

Google認証プロバイダとGmail APIを有効化し、OAuth同意画面のテストユーザーに利用者本人を追加します。
