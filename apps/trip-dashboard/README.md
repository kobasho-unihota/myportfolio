# TripBoard

JAL予約一覧や楽天トラベル予約詳細のスクリーンショットをGeminiで解析し、航空券・ホテル・要確認項目をFirebaseへ保存するiPhone向けPWAです。

公開URL: https://kobasho-unihota.github.io/myportfolio/apps/trip-dashboard/

## 開発

```bash
python3 -m http.server 4173
node --test apps/trip-dashboard/ai-core.test.mjs apps/trip-dashboard/gemini-client.test.mjs apps/trip-dashboard/firebase-state.test.mjs apps/trip-dashboard/local-store.test.mjs apps/trip-dashboard/core.test.mjs
```

`http://localhost:4173/apps/trip-dashboard/` を開きます。

## 構成

- GoogleログインとFirestoreを使い、予約、AI解析結果、出張まとめ、設定を端末間で同期します。
- ユーザーがスクリーンショットを複数選択し、ブラウザからGemini APIへ送ります。
- 1枚に複数予約が見える場合は予約ごとに抽出し、取り込み済みと一致する予約を除外して新規分だけ保存します。
- 送信前に画像を最大長辺1600px、JPEG品質0.82程度へ縮小します。
- Gemini APIキーだけは端末のLocalStorageに保存します。
- スクリーンショット画像本体はLocalStorageにもFirestoreにも保存しません。失敗時の再解析は再アップロード前提です。
- 初回ログイン時にFirestoreが空なら、既存localStorageデータを自動移行して端末側を削除します。
- `confidence < 0.75`、分類不能、必須項目不足、解析失敗は要確認として残します。

## 出張まとめ

- 予約はまず未分類として保存します。
- 日付が前後3日以内の未分類予約を「まとめ候補」として表示します。
- ユーザーが「まとめる」「追加」「出張から外す」を操作して、同じ出張に手動でまとめます。

## Firebase

既存の `seed-note-kobasho` Firebaseプロジェクトを使用します。Google Authenticationを有効にし、Firestore Rulesで本人だけに次のドキュメントの読み書きを許可します。

```text
users/{uid}/tripDashboard/state
```

ルール例:

```text
match /users/{uid}/tripDashboard/state {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```
