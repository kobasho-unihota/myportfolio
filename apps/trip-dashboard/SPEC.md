# TripBoard 仕様書

## 概要

TripBoardは、ユーザーが選択した予約スクリーンショットをAIで分類・構造化し、航空券とホテルを端末内で管理する個人用PWAである。GitHub Pagesで静的配信し、Gmail API、Firebase Auth、Firestore同期は初期導線では使わない。

## アーキテクチャ

- PWA: スクリーンショット複数選択、画像縮小、Gemini呼び出し、schema validation、予約表示、手修正、手動出張まとめを担当する。
- Gemini API: 利用者が設定画面でLocalStorageへ保存したAPIキーを使い、PWAから直接呼び出す。
- LocalStorage: `tripboard:bookings`, `tripboard:ai-analyses`, `tripboard:trips`, `tripboard:settings`, `tripboard:gemini-api-key` を保存する。
- 画像本体は保存しない。AIへ送信する直前だけブラウザメモリ上で縮小JPEGとして扱う。

## AI分類カテゴリ

- `flight`: JAL航空券、予約一覧、予約詳細。
- `hotel`: 楽天トラベルのホテル予約詳細、宿泊予約。
- `trip_related_unknown`: 旅行関連だが航空券/ホテルとして確定できないスクリーンショット。
- `irrelevant`: 出張予約に関係しないスクリーンショット。

## スクショ解析フロー

1. ユーザーが解析画面でスクリーンショットを複数選択する。
2. PWAが各画像を最大長辺1600px、JPEG品質0.82程度へ縮小し、圧縮後bytesから `image-{hash}` と `imageHash` を生成する。
3. ユーザーは画像ごとに `JAL航空券`、`楽天ホテル`、`AIに判定させる` を選べる。
4. PWAがGemini APIへ `text prompt + inline_data` を送り、画面内の予約を `reservations` 配列で返させて予約ごとにschema validationする。
5. 航空券は便名＋出発日時、ホテルは予約番号またはホテル名＋宿泊日で既存bookingと照合し、取り込み済みを除外する。
6. 新規の `flight` / `hotel` だけ予約データへ変換してlocalStorageへ保存する。低confidence、必須項目不足、分類不能、解析失敗は要確認として残す。

## UI

- 「次の出張」: 保存済み予約から次回予定、タイムライン、警告を表示する。
- 「予約一覧」: 予定、すべて、取消、AI要確認、出張まとめ候補を表示する。
- 「解析」: iPhoneの写真選択に適した画像アップロード、サムネイル、種別選択、個別状態、AI解析、選択クリアを提供する。
- 「設定」: 自宅空港、Gemini APIキー保存/削除、非表示解除、端末保存データ削除、プライバシー説明を提供する。

## 出張まとめ

予約は自動確定で出張へ紐付けない。`tripId` をbookingへ持たせ、同じ `tripId` の予約だけ同じ出張として表示する。未分類予約は、開始日が前後3日以内なら「まとめ候補」として表示し、ユーザーが手動で新規出張作成、既存出張へ追加、出張から外す操作を行う。

## テスト方針

- スクショAI JSON validation、低confidence判定、imageHash生成、AI結果から予約への変換、重複統合を単体テストする。
- Gemini画像リクエストがinline_dataを含むことをfetch mockで確認する。
- localStorage保存/読込/クリアを単体テストする。画像本体は保存しない。
- iPhone幅で複数画像選択、プレビュー、種別選択、解析、予約反映、要確認編集を手動確認する。
