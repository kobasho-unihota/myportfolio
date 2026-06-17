# TripBoard 仕様書

## 概要

TripBoardは、Gmailに届く出張関連メールをAIで分類・構造化し、航空券とホテルを出張単位で確認する個人用PWAである。GitHub Pagesで静的配信し、Firebase Authentication、Firestore、Gmail API、Geminiを利用する。

## アーキテクチャ

- PWA: Gmail候補メール取得、対象選択、キャッシュ確認、AI解析結果表示、予約編集、出張表示を担当する。
- Gemini API: 利用者が設定画面でLocalStorageへ保存したAPIキーを使い、PWAから直接呼び出す。
- Firestore: 予約表示用データと、Gmail messageId単位のAI解析キャッシュを保存する。
- Gmail本文とGmailアクセストークンは永続保存しない。Gemini APIキーはFirestoreへ保存せず、端末LocalStorageへ保存する。

## AI分類カテゴリ

- `flight`: 航空券、搭乗案内、座席変更、遅延、取消、旅程。
- `hotel`: ホテル予約、予約確認、キャンセル。
- `trip_related_unknown`: 旅行関連だが航空券/ホテルとして確定できないメール。
- `irrelevant`: 出張予約に関係しないメール。

## Firestore

```text
users/{uid}/tripDashboard/bookings/items/{bookingId}
users/{uid}/tripDashboard/aiAnalyses/items/{messageId}
users/{uid}/tripDashboard/settings
```

`aiAnalyses/items/{messageId}` は `messageId`, `threadId`, `subject`, `from`, `receivedAt`, `url`, `category`, `confidence`, `status`, `summary`, `provider`, `reservationNumber`, `dateRange`, `extracted`, `issues`, `model`, `schemaVersion`, `sourceHash`, `createdAt`, `updatedAt`, `userReviewedAt`, `overrides` を保持する。

`status` は `cached`, `needs_review`, `approved`, `irrelevant`, `failed` のいずれかとする。

## 更新フロー

1. ユーザーが更新画面で候補メールを取得する。
2. PWAが今日から2か月前までのJAL国内線・楽天トラベル候補メールを取得し、本文を一時的にメモリへ保持する。
3. 各メールについて `messageId + sourceHash` が既存AI解析キャッシュと一致するか確認する。
4. 未解析または本文変更ありのメールだけ、ユーザー選択後にGemini APIへ送る。
5. PWAがGeminiレスポンスをschema validationし、AI解析結果をFirestoreへ保存する。
6. `flight` / `hotel` かつ要確認でない結果、またはユーザーが承認した結果だけ予約データへ変換する。

## UI

- 「次の出張」: 予約データから次回出張、タイムライン、警告を表示する。
- 「予約一覧」: 予定、すべて、取消を表示し、低confidence・分類不能・失敗は要確認として残す。
- 「更新」: 直近2か月のJAL国内線・楽天トラベル候補メール取得、チェックボックス選択、AI解析、キャッシュ済み表示、進捗を提供する。
- 「設定」: 自宅空港、Googleログイン、Gemini APIキー保存/削除、非表示解除、プライバシー説明を提供する。

## グルーピング

自宅空港発のflightを出張開始候補、自宅空港着のflightを復路候補とする。ホテルはチェックイン日時が往路から復路までに入る場合に同じ出張へ紐付ける。紐付け不能な予約やAI要確認項目は削除せず一覧に残す。

## テスト方針

- AI JSON validation、低confidence判定、messageId/sourceHashキャッシュ、AI結果から予約への変換を単体テストする。
- Gmail本文取得、multipart、attachment、charset、HTML変換の既存テストを維持する。
- 出張グルーピングと既存予約編集の退行を既存coreテストで確認する。
