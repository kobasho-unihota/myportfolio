# TripBoard

JAL予約一覧や楽天トラベル予約詳細のスクリーンショットをGeminiで解析し、航空券・ホテル・要確認項目を端末内に保存するiPhone向けPWAです。

公開URL: https://kobasho-unihota.github.io/myportfolio/apps/trip-dashboard/

## 開発

```bash
python3 -m http.server 4173
node --test apps/trip-dashboard/ai-core.test.mjs apps/trip-dashboard/gemini-client.test.mjs apps/trip-dashboard/local-store.test.mjs apps/trip-dashboard/core.test.mjs
```

`http://localhost:4173/apps/trip-dashboard/` を開きます。

## 最小構成

- Gmail API、Firebase Auth、Firestore同期は初期導線では使いません。
- ユーザーがスクリーンショットを複数選択し、ブラウザからGemini APIへ送ります。
- 送信前に画像を最大長辺1600px、JPEG品質0.82程度へ縮小します。
- Gemini APIキー、AI解析結果、予約、出張まとめ、自宅空港設定は端末のLocalStorageに保存します。
- スクリーンショット画像本体はLocalStorageへ保存しません。失敗時の再解析は再アップロード前提です。
- `confidence < 0.75`、分類不能、必須項目不足、解析失敗は要確認として残します。

## 出張まとめ

- 予約はまず未分類として保存します。
- 日付が前後3日以内の未分類予約を「まとめ候補」として表示します。
- ユーザーが「まとめる」「追加」「出張から外す」を操作して、同じ出張に手動でまとめます。
