import test from "node:test";
import assert from "node:assert/strict";
import { approveTripDraft, createImportSession, draftWarnings, groupCandidateBookings, recalculateTripDraft } from "./trip-drafts.mjs";

const analysisBase = {
  confidence: 0.94,
  status: "cached",
  updatedAt: "2026-06-18T00:00:00.000Z",
  imageId: "image-1",
  imageHash: "hash-1",
  sourceKind: "unknown_screenshot",
};

test("複数スクショの往路・ホテル・復路を一つの出張候補にまとめる", () => {
  const { session, drafts } = createImportSession({
    images: [{ imageId: "image-1", imageHash: "hash-1" }, { imageId: "image-2", imageHash: "hash-2" }],
    homeAirport: "福岡",
    now: "2026-06-18T01:00:00.000Z",
    analyses: [
      {
        ...analysisBase,
        messageId: "flight-out",
        category: "flight",
        provider: "JAL",
        extracted: { items: [{ flightNumber: "JAL304", origin: "福岡", destination: "東京（羽田）", startAt: "2026-06-23T23:10:00.000Z", endAt: "2026-06-24T00:50:00.000Z" }] },
      },
      {
        ...analysisBase,
        messageId: "hotel",
        category: "hotel",
        provider: "楽天トラベル",
        extracted: { name: "川崎テストホテル", address: "神奈川県川崎市", checkIn: "2026-06-24T06:00:00.000Z", checkOut: "2026-06-26T02:00:00.000Z" },
      },
      {
        ...analysisBase,
        messageId: "flight-in",
        category: "flight",
        provider: "JAL",
        extracted: { items: [{ flightNumber: "JAL333", origin: "東京（羽田）", destination: "福岡", startAt: "2026-06-26T10:15:00.000Z", endAt: "2026-06-26T12:10:00.000Z" }] },
      },
    ],
  });

  assert.equal(session.status, "reviewing");
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].items.map((item) => item.role), ["outbound", "stay", "inbound"]);
  assert.equal(drafts[0].issues.length, 0);
  assert.match(drafts[0].title, /東京出張/);
});

test("復路がない候補は要確認理由を保持する", () => {
  const [draft] = groupCandidateBookings([{
    id: "out",
    type: "flight",
    status: "confirmed",
    parsed: { flightNumber: "JAL304", origin: "FUK", destination: "HND", startAt: "2026-06-24T00:00:00.000Z", endAt: "2026-06-24T02:00:00.000Z" },
    ai: { confidence: 0.9, status: "cached" },
  }], { homeAirport: "福岡" });
  assert.ok(draftWarnings(draft, new Date("2026-06-18T00:00:00.000Z")).includes("復路便が見つかっていません"));
});

test("確認済み候補だけを正式なTripとBookingへ変換する", () => {
  const [draft] = groupCandidateBookings([{
    id: "out",
    type: "flight",
    status: "confirmed",
    parsed: { flightNumber: "JAL304", origin: "福岡", destination: "羽田", startAt: "2026-06-24T00:00:00.000Z", endAt: "2026-06-24T02:00:00.000Z" },
    ai: { confidence: 0.9, status: "cached" },
  }], { homeAirport: "福岡", importSessionId: "import-1" });
  const result = approveTripDraft(draft, { title: "東京出張", notes: "会議", now: "2026-06-18T01:00:00.000Z" });
  assert.equal(result.trip.title, "東京出張");
  assert.equal(result.trip.notes, "会議");
  assert.deepEqual(result.trip.sourceImportIds, ["import-1"]);
  assert.equal(result.bookings[0].tripId, result.trip.id);
  assert.equal(result.bookings[0].tripRole, "outbound");
});

test("ユーザーが往路・復路の割り当てを修正できる", () => {
  const [draft] = groupCandidateBookings([{
    id: "flight",
    type: "flight",
    status: "confirmed",
    parsed: { flightNumber: "JAL333", origin: "羽田", destination: "福岡", startAt: "2026-06-26T10:00:00.000Z", endAt: "2026-06-26T12:00:00.000Z" },
    ai: { confidence: 0.9, status: "cached" },
  }], { homeAirport: "福岡" });
  assert.equal(draft.items[0].role, "inbound");
  draft.items[0].role = "outbound";
  recalculateTripDraft(draft, "2026-06-18T00:00:00.000Z");
  assert.ok(draft.issues.includes("復路便が見つかっていません"));
  assert.ok(!draft.issues.includes("往路便が見つかっていません"));
});
