import test from "node:test";
import assert from "node:assert/strict";
import { clearTripBoardData, loadTripBoardState, saveTripBoardState } from "./local-store.mjs";

function storage() {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

test("TripBoard状態をlocalStorageへ保存して読み込む", () => {
  const target = storage();
  saveTripBoardState({
    bookings: [{ id: "booking-1" }],
    aiAnalyses: [{ messageId: "manual-1" }],
    trips: [{ id: "trip-1", bookingIds: ["booking-1"] }],
    settings: { homeAirport: "羽田", lastAnalyzedAt: "2026-06-17T03:00:00.000Z" },
  }, target);

  const loaded = loadTripBoardState(target);
  assert.equal(loaded.bookings[0].id, "booking-1");
  assert.equal(loaded.aiAnalyses[0].messageId, "manual-1");
  assert.equal(loaded.trips[0].bookingIds[0], "booking-1");
  assert.equal(loaded.settings.homeAirport, "羽田");
});

test("取り込み済みデータクリアはAPIキー以外のTripBoardデータだけ消す", () => {
  const target = storage();
  saveTripBoardState({
    bookings: [{ id: "booking-1" }],
    aiAnalyses: [{ messageId: "manual-1" }],
    trips: [{ id: "trip-1" }],
    settings: { homeAirport: "福岡", lastAnalyzedAt: "2026-06-17T03:00:00.000Z" },
  }, target);

  clearTripBoardData(target);
  const loaded = loadTripBoardState(target);
  assert.deepEqual(loaded.bookings, []);
  assert.deepEqual(loaded.aiAnalyses, []);
  assert.deepEqual(loaded.trips, []);
  assert.equal(loaded.settings.homeAirport, "福岡");
  assert.equal(loaded.settings.lastAnalyzedAt, "");
});
