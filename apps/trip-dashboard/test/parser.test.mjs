import test from "node:test";
import assert from "node:assert/strict";
import { mergeBookings } from "../src/domain/merge-bookings.mjs";
import { groupTrips } from "../src/domain/trip-grouping.mjs";
import { parseMessages } from "../src/parsers/registry.mjs";

const jalReservation = {
  id: "jal-reservation", threadId: "jal-thread", from: "JAL no_reply@jal.com", subject: "〔JAL国内線〕予約内容のお知らせ 2026年7月10日（金）JAL3513便", receivedAt: "2026-06-17T00:00:00.000Z", url: "https://mail.google.com/",
  body: `予約番号 D6GWOG
フライト詳細
旅程1
2026年7月10日（金） JAL3513便
福岡11:50発
札幌(新千歳)14:10着
旅程2
2026年7月12日（日） JAL4472便
札幌(新千歳)18:05発
福岡20:55着`,
};

const rakutenHotel = {
  id: "rakuten-hotel", threadId: "rakuten-thread", from: "travel@mail.travel.rakuten.co.jp", subject: "「楽天トラベル」予約完了メール", receivedAt: "2026-06-17T00:10:00.000Z", url: "https://mail.google.com/",
  body: `■ご予約内容
・予約番号 ：RYTEST1001
■宿泊施設名 ：コンフォートホテルERA札幌北口
・宿泊施設住所 ：〒060-0808 北海道札幌市北区北8条西4丁目
・宿泊施設電話番号 ：011-000-0000
■チェックイン日時 ：【2026-07-10(金) 19:00】
・チェックアウト日 ：2026-07-12(日)
・部屋タイプ ：禁煙クイーンルーム
プラン名：【連泊割】朝食付
■差引支払額 ：消費税込: 31600円`,
};

test("楽天ホテルはParseResult経由でBookingになる", () => {
  const { bookings, unclassified, results } = parseMessages([rakutenHotel]);
  assert.equal(results[0].parserId, "rakuten-travel-hotel.v1");
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].id, "rakuten-rytest1001");
  assert.equal(bookings[0].parsed.name, "コンフォートホテルERA札幌北口");
  assert.equal(bookings[0].parsed.checkIn, "2026-07-10T10:00:00.000Z");
  assert.equal(unclassified.length, 0);
});

test("必須項目不足の楽天メールは要確認に残る", () => {
  const { bookings, unclassified } = parseMessages([{ ...rakutenHotel, id: "partial", body: "楽天トラベル\n予約番号 ：RYTEST9999" }]);
  assert.equal(bookings.length, 0);
  assert.equal(unclassified.length, 1);
  assert.equal(unclassified[0].parserAttempts[0].missingFields.includes("name"), true);
});

test("JAL予約内容から往復2便を解析する", () => {
  const { bookings } = parseMessages([jalReservation]);
  assert.equal(bookings.length, 2);
  assert.equal(bookings[0].parsed.flightNumber, "JAL3513");
  assert.equal(bookings[1].parsed.flightNumber, "JAL4472");
});

test("航空券とホテルをスコアリングで一つの出張へまとめる", () => {
  const parsed = parseMessages([jalReservation, rakutenHotel]);
  const bookings = mergeBookings([], parsed.bookings);
  const [trip] = groupTrips(bookings, { homeAirport: "福岡" });
  assert.equal(trip.items.length, 3);
  assert.equal(trip.grouping.confidence, "high");
  assert.equal(trip.grouping.reasons.includes("same_prefecture"), true);
});

test("未対応メールはUnclassifiedMessageになる", () => {
  const { unclassified } = parseMessages([{ id: "unknown", from: "other@example.com", subject: "予約", receivedAt: "2026-06-17T00:00:00.000Z", body: "未対応" }]);
  assert.equal(unclassified.length, 1);
  assert.equal(unclassified[0].reviewStatus, "unreviewed");
});
