import test from "node:test";
import assert from "node:assert/strict";
import { clearMigratedTripBoardData, clearTripBoardData, loadTripBoardState, saveTripBoardState } from "./local-store.mjs";

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
    importSessions: [{ id: "import-1" }],
    tripDrafts: [{ id: "draft-1" }],
    settings: { homeAirport: "羽田", lastAnalyzedAt: "2026-06-17T03:00:00.000Z" },
  }, target);

  const loaded = loadTripBoardState(target);
  assert.equal(loaded.bookings[0].id, "booking-1");
  assert.equal(loaded.aiAnalyses[0].messageId, "manual-1");
  assert.equal(loaded.trips[0].bookingIds[0], "booking-1");
  assert.equal(loaded.importSessions[0].id, "import-1");
  assert.equal(loaded.tripDrafts[0].id, "draft-1");
  assert.equal(loaded.settings.homeAirport, "羽田");
});

test("取り込み済みデータクリアはAPIキー以外のTripBoardデータだけ消す", () => {
  const target = storage();
  saveTripBoardState({
    bookings: [{ id: "booking-1" }],
    aiAnalyses: [{ messageId: "manual-1" }],
    trips: [{ id: "trip-1" }],
    importSessions: [{ id: "import-1" }],
    tripDrafts: [{ id: "draft-1" }],
    settings: { homeAirport: "福岡", lastAnalyzedAt: "2026-06-17T03:00:00.000Z" },
  }, target);

  clearTripBoardData(target);
  const loaded = loadTripBoardState(target);
  assert.deepEqual(loaded.bookings, []);
  assert.deepEqual(loaded.aiAnalyses, []);
  assert.deepEqual(loaded.trips, []);
  assert.deepEqual(loaded.importSessions, []);
  assert.deepEqual(loaded.tripDrafts, []);
  assert.equal(loaded.settings.homeAirport, "福岡");
  assert.equal(loaded.settings.lastAnalyzedAt, "");
});

test("Firebase移行完了後は旧TripBoardキーをすべて削除する", () => {
  const target = storage();
  saveTripBoardState({
    bookings: [{ id: "booking-1" }],
    aiAnalyses: [],
    trips: [],
    settings: { homeAirport: "羽田", lastAnalyzedAt: "" },
  }, target);
  target.setItem("tripboard:gemini-api-key", "secret");

  clearMigratedTripBoardData(target);

  assert.deepEqual(loadTripBoardState(target).bookings, []);
  assert.equal(loadTripBoardState(target).settings.homeAirport, "福岡");
  assert.equal(target.getItem("tripboard:gemini-api-key"), "secret");
});
