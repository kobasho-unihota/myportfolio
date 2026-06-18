import test from "node:test";
import assert from "node:assert/strict";
import { cleanCloudState, emptyCloudState, hasMigrationData, isEmptyCloudState } from "./firebase-state.mjs";

test("空のFirebase状態を判定する", () => {
  assert.equal(isEmptyCloudState(emptyCloudState()), true);
  assert.equal(isEmptyCloudState({ ...emptyCloudState(), bookings: [{ id: "b1" }] }), false);
});

test("旧localStorageに予約があれば移行対象にする", () => {
  assert.equal(hasMigrationData(emptyCloudState()), false);
  assert.equal(hasMigrationData({ ...emptyCloudState(), trips: [{ id: "t1" }] }), true);
  assert.equal(hasMigrationData({ ...emptyCloudState(), settings: { homeAirport: "羽田", lastAnalyzedAt: "" } }), true);
});

test("Firestore保存前にundefinedを除去して既定値を補う", () => {
  const state = cleanCloudState({
    bookings: [{ id: "b1", screenshot: undefined }],
    settings: {},
  });
  assert.deepEqual(state.bookings, [{ id: "b1" }]);
  assert.equal(state.settings.homeAirport, "福岡");
  assert.deepEqual(state.aiAnalyses, []);
  assert.deepEqual(state.trips, []);
});
