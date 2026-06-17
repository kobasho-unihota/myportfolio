# TripBoard 仕様書

## 概要

TripBoardは、ユーザーが貼り付けた出張予約メール本文をAIで分類・構造化し、航空券とホテルを端末内で管理する個人用PWAである。GitHub Pagesで静的配信し、Gmail API、Firebase Auth、Firestore同期は初期導線では使わない。

## アーキテクチャ

- PWA: メール本文貼り付け、Gemini呼び出し、schema validation、予約表示、手修正、手動出張まとめを担当する。
- Gemini API: 利用者が設定画面でLocalStorageへ保存したAPIキーを使い、PWAから直接呼び出す。
- LocalStorage: `tripboard:bookings`, `tripboard:ai-analyses`, `tripboard:trips`, `tripboard:settings`, `tripboard:gemini-api-key` を保存する。
- 成功したAI解析では本文を保存しない。解析失敗時のみ、再解析用に本文とエラーを保存する。

## AI分類カテゴリ

- `flight`: 航空券、搭乗案内、座席変更、遅延、取消、旅程。
- `hotel`: ホテル予約、予約確認、キャンセル。
- `trip_related_unknown`: 旅行関連だが航空券/ホテルとして確定できないメール。
- `irrelevant`: 出張予約に関係しないメール。

## 解析フロー

1. ユーザーが解析画面で件名、差出人、受信日時、メール本文を入力する。件名、差出人、受信日時は任意。
2. PWAが本文とメタ情報から `manual-{hash}` のmessageIdとsourceHashを生成する。
3. PWAがGemini APIへ本文を送り、JSON応答をschema validationする。
4. `flight` / `hotel` かつ要確認でない結果、またはユーザーが承認した結果だけ予約データへ変換する。
5. 低confidence、分類不能、対象外、必須項目不足、解析失敗は要確認として保存する。
6. 解析失敗時は本文とエラーを保存し、後から再解析できるようにする。

## UI

- 「次の出張」: 保存済み予約から次回予定、タイムライン、警告を表示する。
- 「予約一覧」: 予定、すべて、取消、AI要確認、出張まとめ候補を表示する。
- 「解析」: iPhoneで貼り付けやすい大きな本文欄、任意メタ情報、AI解析、下書きクリア、失敗分再解析を提供する。
- 「設定」: 自宅空港、Gemini APIキー保存/削除、非表示解除、端末保存データ削除、プライバシー説明を提供する。

## 出張まとめ

予約は自動確定で出張へ紐付けない。`tripId` をbookingへ持たせ、同じ `tripId` の予約だけ同じ出張として表示する。未分類予約は、開始日が前後3日以内なら「まとめ候補」として表示し、ユーザーが手動で新規出張作成、既存出張へ追加、出張から外す操作を行う。

## テスト方針

- 手動貼り付けmessageId/sourceHash生成、AI JSON validation、低confidence判定、失敗解析保存、AI結果から予約への変換を単体テストする。
- localStorage保存/読込/クリアを単体テストする。
- 既存の予約編集、非表示、取消、手動追加、PWAキャッシュ更新を手動確認する。
