import test from "node:test";
import assert from "node:assert/strict";
import {
  analysesToBookings,
  analysisNeedsReview,
  cacheMatches,
  hashMessageSource,
  normalizeAnalysis,
  travelCandidateQuery,
  validateAnalysis,
} from "./ai-core.mjs";

const message = {
  id: "msg-1",
  threadId: "thread-1",
  from: "travel@mail.travel.rakuten.co.jp",
  subject: "楽天トラベル 予約完了メール",
  receivedAt: "2026-06-10T01:00:00.000Z",
  url: "https://mail.google.com/mail/u/0/#all/msg-1",
  body: "予約完了",
};

test("AIホテル解析結果を検証しbookingへ変換する", () => {
  const analysis = normalizeAnalysis({
    category: "hotel",
    confidence: 0.92,
    summary: "ホテル予約",
    provider: "楽天トラベル",
    extracted: {
      provider: "楽天トラベル",
      reservationNumber: "RYTEST1001",
      name: "テストホテル東京",
      checkIn: "2026-07-29T22:30:00+09:00",
      checkOut: "2026-07-31T10:00:00+09:00",
      amount: 34650,
      breakfast: true,
    },
  }, message, { sourceHash: "hash-1", now: "2026-06-10T02:00:00.000Z" });

  assert.equal(validateAnalysis(analysis).ok, true);
  assert.equal(analysis.status, "cached");
  const [booking] = analysesToBookings([analysis]);
  assert.equal(booking.id, "ai-hotel-rytest1001");
  assert.equal(booking.type, "hotel");
  assert.equal(booking.parsed.name, "テストホテル東京");
  assert.equal(booking.parsed.checkIn, "2026-07-29T13:30:00.000Z");
});

test("AI航空券解析結果は複数便bookingへ変換する", () => {
  const analysis = normalizeAnalysis({
    category: "flight",
    confidence: 0.88,
    provider: "JAL",
    extracted: {
      provider: "JAL",
      reservationNumber: "D6GWOG",
      items: [
        { flightNumber: "JAL3513", origin: "福岡", destination: "札幌（新千歳）", startAt: "2026-06-14T11:50:00+09:00", endAt: "2026-06-14T14:10:00+09:00" },
        { flightNumber: "JAL4472", origin: "札幌（新千歳）", destination: "福岡", startAt: "2026-06-16T18:05:00+09:00", endAt: "2026-06-16T20:55:00+09:00" },
      ],
    },
  }, { ...message, id: "jal-1", subject: "JAL国内線 予約内容" });

  const bookings = analysesToBookings([analysis]);
  assert.equal(bookings.length, 2);
  assert.equal(bookings[0].id, "ai-flight-d6gwog-2026-06-14-jal3513");
  assert.equal(bookings[1].parsed.destination, "福岡");
});

test("低confidenceとunknownは要確認にする", () => {
  const low = normalizeAnalysis({ category: "hotel", confidence: 0.4, extracted: { name: "ホテル" } }, message);
  const unknown = normalizeAnalysis({ category: "trip_related_unknown", confidence: 0.9, summary: "旅程らしい" }, message);
  assert.equal(analysisNeedsReview(low), true);
  assert.equal(analysisNeedsReview(unknown), true);
  assert.equal(low.status, "needs_review");
});

test("messageIdとsourceHashが一致する解析結果だけキャッシュとして使う", async () => {
  const sourceHash = await hashMessageSource(message);
  const analysis = normalizeAnalysis({ category: "irrelevant", confidence: 0.99 }, message, { sourceHash });
  assert.equal(cacheMatches(analysis, { ...message, sourceHash }), true);
  assert.equal(cacheMatches(analysis, { ...message, sourceHash: "changed" }), false);
});

test("旅行候補Gmailクエリは広めの分類対象を検索する", () => {
  const query = travelCandidateQuery("2026-06-13T00:00:00.000Z");
  assert.match(query, /after:2026\/05\/14/);
  assert.match(query, /booking\.jal\.com/);
  assert.match(query, /楽天トラベル/);
  assert.match(query, /subject:ホテル/);
});
