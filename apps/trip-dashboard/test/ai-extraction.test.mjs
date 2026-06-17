import test from "node:test";
import assert from "node:assert/strict";
import { extractMessagesWithAI } from "../src/ai/ai-extraction-pipeline.mjs";
import { createMemoryExtractionCache } from "../src/ai/extraction-cache.mjs";
import { extractionRecordsToTripBoardItems } from "../src/ai/extraction-to-booking.mjs";
import { createEmptyExtraction, validateAIExtraction } from "../src/ai/extraction-schema.mjs";
import { mergeBookings } from "../src/domain/merge-bookings.mjs";
import { groupTrips } from "../src/domain/trip-grouping.mjs";

const flightMessage = { id: "jal-demo-out", threadId: "t1", from: "JAL no_reply@jal.com", subject: "JAL予約", receivedAt: "2026-06-17T00:00:00.000Z", body: "JAL予約" };
const hotelMessage = { id: "rakuten-demo", threadId: "t2", from: "travel@mail.travel.rakuten.co.jp", subject: "楽天トラベル予約", receivedAt: "2026-06-17T00:00:00.000Z", body: "楽天ホテル予約" };
const unknownMessage = { id: "unknown-demo", threadId: "t3", from: "booking@example.com", subject: "予約のお知らせ", receivedAt: "2026-06-17T00:00:00.000Z", body: "予約らしいメール" };

test("AI抽出JSON schemaはカテゴリと詳細の整合性を検証する", () => {
  const valid = createEmptyExtraction("flight");
  valid.confidence = 0.9;
  valid.summary = "航空券予約";
  valid.flight.flightNumber = "JAL3513";
  assert.equal(validateAIExtraction(valid).valid, true);

  const invalid = { ...valid, category: "flight", flight: { ...valid.flight, flightNumber: "" }, confidence: 1.2 };
  const result = validateAIExtraction(invalid);
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((error) => error.includes("confidence")), true);
  assert.equal(result.errors.some((error) => error.includes("flight category")), true);
});

test("messageId単位のキャッシュがあればAI extractorを再実行しない", async () => {
  const cache = createMemoryExtractionCache();
  let calls = 0;
  const extractor = async () => {
    calls += 1;
    const value = createEmptyExtraction("irrelevant");
    value.confidence = 0.8;
    value.summary = "対象外";
    return value;
  };
  await extractMessagesWithAI([{ id: "cache-test", subject: "その他", body: "対象外" }], { cache, extractor });
  const second = await extractMessagesWithAI([{ id: "cache-test", subject: "その他", body: "対象外" }], { cache, extractor });
  assert.equal(calls, 1);
  assert.equal(second.diagnostics.cacheHits, 1);
  assert.equal(second.diagnostics.aiRequests, 0);
});

test("AI抽出結果から航空券・ホテル・要確認アイテムを生成する", async () => {
  const { records } = await extractMessagesWithAI([flightMessage, hotelMessage, unknownMessage], { cache: createMemoryExtractionCache() });
  const converted = extractionRecordsToTripBoardItems(records);
  assert.equal(converted.bookings.length, 2);
  assert.equal(converted.reviewItems.length, 1);
  assert.equal(converted.bookings[0].type, "flight");
  assert.equal(converted.bookings[1].type, "hotel");
  assert.equal(converted.reviewItems[0].category, "trip_related_unknown");
});

test("AI由来の航空券とホテルを出張にまとめる", async () => {
  const { records } = await extractMessagesWithAI([flightMessage, hotelMessage], { cache: createMemoryExtractionCache() });
  const converted = extractionRecordsToTripBoardItems(records);
  const bookings = mergeBookings([], converted.bookings);
  const [trip] = groupTrips(bookings, { homeAirport: "福岡" });
  assert.equal(trip.items.length, 2);
  assert.equal(trip.grouping.confidence, "high");
});
