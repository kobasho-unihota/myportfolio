import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildProviderReplacementOperations,
  effectiveBooking,
  flightRescanQuery,
  gmailQuery,
  groupTrips,
  hotelGmailQuery,
  hotelRescanQuery,
  mergeBookings,
  parseTravelEmail,
  parseTravelEmails,
} from "./core.mjs";
import { runHotelPipeline } from "./hotel-pipeline.mjs";

async function readFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/rakuten/${name}`, import.meta.url), "utf8"));
}

const rakutenCompleteFixture = await readFixture("reservation-complete-plain.json");
const rakutenConfirmationFixture = await readFixture("reservation-confirmation-plain.json");
const rakutenCancellationFixture = await readFixture("cancellation-confirmation-plain.json");
const rakutenHtmlFixture = await readFixture("reservation-complete-html.json");

const jalBoarding = {
  id: "jal-1",
  from: '"JAL国内線" no_reply@jal.com',
  subject: "【JAL国内線】ご搭乗案内 6月14日(日) JAL3513便",
  receivedAt: "2026-06-12T02:51:20Z",
  body: `■便情報 6月12日(金) 11:51現在(日本時間)
6月14日(日) JAL3513便
福岡 → 札幌/新千歳
定刻 11:50発 - 14:10着
座席番号 30J
予約番号
D6GWOG
[ご予約便の最新の運航状況、搭乗口についてはこちら](https://www.jal.co.jp/flight-status/)`,
};

const jalSeatChange = {
  id: "jal-2",
  from: "JAL_INFO noreply@skyinfo.jal.com",
  subject: "〔JAL国内線〕座席変更のお知らせ 2026年6月16日（火） JAL4472（FDA518）",
  receivedAt: "2026-03-21T09:52:30Z",
  body: `予約番号 D6GWOG
フライト詳細
JAL4472
（FDA518）
2026年
6月16日（火）
18:05
札幌(新千歳)
2026年
6月16日（火）
20:55
福岡
普通席
座席
17A`,
};

const rakutenBooking = {
  id: "hotel-1",
  from: "travel@mail.travel.rakuten.co.jp",
  subject: "「楽天トラベル」予約完了メール (チェックイン日：07/29)",
  receivedAt: "2026-06-09T09:47:18Z",
  body: `ご予約内容
予約受付番号
RYa0mx6tjs
ホテル名
[天然温泉 テストホテル](https://example.com/hotel)
住所
〒210-0005 神奈川県 川崎市川崎区東田町9-3
宿泊施設電話番号
044-230-5489
チェックイン
2026-07-29(水) 22:30
チェックアウト
2026-07-31(金)
部屋タイプ
◆禁煙◆クイーンルーム
宿泊プラン
【連泊割】朝食付
総合計 消費税込:35150円
クーポン利用 -500円
差引支払額 消費税込: 34650円
[予約確認ページ](https://example.com/manage)`,
};

const rakutenCancel = {
  id: "hotel-2",
  from: "travel@mail.travel.rakuten.co.jp",
  subject: "「楽天トラベル」キャンセル確認メール",
  receivedAt: "2026-06-10T09:47:18Z",
  body: `以下のご予約をキャンセルいたしました。
予約番号 RYa0mx6tjs
宿泊施設名 天然温泉 テストホテル
チェックイン日時 2026-07-29(水) 22:30
チェックアウト日 2026-07-31(金)`,
};

const rakutenPlainBooking = {
  id: "hotel-plain",
  from: "travel@mail.travel.rakuten.co.jp",
  subject: "「楽天トラベル」予約完了メール (チェックイン日：07/29)",
  receivedAt: "2026-06-09T09:47:18Z",
  body: `■ご予約内容
・予約番号                 ：RYa0mx6tjs
・予約受付日               ：2026-06-09(火)
■宿泊施設名               ：天然温泉　テストホテル
・宿泊施設住所             ：〒210-0005 神奈川県川崎市
・宿泊施設電話番号         ：044-230-5489
■チェックイン日時         ：【2026-07-29(水) 22:30】
・チェックアウト日         ：2026-07-31(金)
・部屋タイプ               ：◆禁煙◆クイーンルーム
■宿泊プラン
プラン名：【連泊割】朝食付
■差引支払額               ：消費税込: 34650円`,
};

const jalDelay = {
  id: "jal-delay",
  from: '"JAL国内線" no_reply@jal.com',
  subject: "【JAL国内線】出発遅延のお知らせ 6月14日(日) JAL3513便",
  receivedAt: "2026-06-14T09:37:36Z",
  body: `■便情報 6月14日(日) 18:36現在(日本時間)
6月14日(日) JAL3513便
福岡 → 札幌/新千歳
定刻 11:50発 - 14:10着
出発予定時刻 12:20 (遅延時間 0時間30分)`,
};

const jalReservation = {
  id: "jal-reservation",
  from: '"JAL国内線" no_reply-dom@booking.jal.com',
  subject: "〔JAL国内線〕予約内容のお知らせ 6月14日（日）JAL3513便",
  receivedAt: "2026-03-21T09:37:06Z",
  body: `ご予約内容（2026年3月21日 18時37分現在）
予約番号
D6GWOG
フライト詳細
旅程1
2026年6月14日（日） JAL3513便
福岡11:50発
札幌(新千歳)14:10着
座席：普通席 座席番号：未指定
旅程2
2026年6月16日（火） JAL4472便
札幌(新千歳)18:05発
福岡20:55着
座席：普通席 座席番号：未指定`,
};

const futureHotels = [
  ["RYa0mi5z76", "コンフォートホテルERA札幌北口", "2026-06-14", "2026-06-16", 31600],
  ["RYa0mx6p34", "天然温泉 テストホテル", "2026-07-01", "2026-07-03", 29450],
  ["RYa0mx6rrh", "天然温泉 テストホテル", "2026-07-15", "2026-07-17", 32750],
  ["RYa0mx6srm", "天然温泉 テストホテル", "2026-07-22", "2026-07-24", 29900],
  ["RYa0mx6tjs", "天然温泉 テストホテル", "2026-07-29", "2026-07-31", 34650],
].map(([reservationNumber, name, checkIn, checkOut, amount]) => ({
  id: `future-${reservationNumber}`,
  from: "travel@mail.travel.rakuten.co.jp",
  subject: `「楽天トラベル」予約完了メール (チェックイン日：${checkIn.slice(5).replace("-", "/")})`,
  receivedAt: "2026-06-09T09:47:18Z",
  body: `ご予約内容
予約受付番号
${reservationNumber}
ホテル名
${name}
チェックイン
${checkIn}(水) 19:00
チェックアウト
${checkOut}(金)
差引支払額 消費税込: ${amount}円`,
}));

test("JAL搭乗案内を解析する", () => {
  const booking = parseTravelEmail(jalBoarding);
  assert.equal(booking.id, "jal-d6gwog-2026-06-14-jal3513");
  assert.equal(booking.parsed.origin, "福岡");
  assert.equal(booking.parsed.destination, "札幌（新千歳）");
  assert.equal(booking.parsed.seat, "30J");
  assert.equal(booking.parsed.startAt, "2026-06-14T02:50:00.000Z");
});

test("JAL座席変更メールの共同運航便を解析する", () => {
  const booking = parseTravelEmail(jalSeatChange);
  assert.equal(booking.parsed.flightNumber, "JAL4472");
  assert.equal(booking.parsed.reservationNumber, "D6GWOG");
  assert.equal(booking.parsed.seat, "17A");
  assert.equal(booking.parsed.origin, "札幌（新千歳）");
  assert.equal(booking.parsed.destination, "福岡");
});

test("楽天トラベル予約を解析する", () => {
  const booking = parseTravelEmail(rakutenBooking);
  assert.equal(booking.id, "rakuten-rya0mx6tjs");
  assert.equal(booking.parsed.name, "天然温泉 テストホテル");
  assert.equal(booking.parsed.amount, 34650);
  assert.equal(booking.parsed.breakfast, true);
  assert.equal(booking.parsed.checkIn, "2026-07-29T13:30:00.000Z");
});

test("楽天トラベルのプレーンテキスト形式を解析する", () => {
  const booking = parseTravelEmail(rakutenPlainBooking);
  assert.equal(booking.parsed.name, "天然温泉　テストホテル");
  assert.equal(booking.parsed.checkIn, "2026-07-29T13:30:00.000Z");
  assert.equal(booking.parsed.checkOut, "2026-07-30T15:00:00.000Z");
  assert.equal(booking.parsed.roomType, "◆禁煙◆クイーンルーム");
  assert.equal(booking.parsed.amount, 34650);
});

test("fixture: 楽天予約完了メールの全必須項目を解析する", () => {
  const booking = parseTravelEmail(rakutenCompleteFixture);
  assert.equal(booking.id, "rakuten-rytest1001");
  assert.deepEqual({
    reservationNumber: booking.parsed.reservationNumber,
    name: booking.parsed.name,
    address: booking.parsed.address,
    phone: booking.parsed.phone,
    roomType: booking.parsed.roomType,
    amount: booking.parsed.amount,
    managementLink: booking.parsed.managementLink,
  }, {
    reservationNumber: "RYTEST1001",
    name: "テストホテル東京",
    address: "〒100-0001 東京都千代田区千代田1-1",
    phone: "03-1234-5678",
    roomType: "禁煙クイーンルーム",
    amount: 34650,
    managementLink: "https://example.test/rakuten/manage/RYTEST1001",
  });
  assert.equal(booking.parsed.checkIn, "2026-07-29T13:30:00.000Z");
  assert.equal(booking.parsed.checkOut, "2026-07-30T15:00:00.000Z");
});

test("fixture: 楽天予約確認メールを同じ予約IDで解析する", () => {
  const booking = parseTravelEmail(rakutenConfirmationFixture);
  assert.equal(booking.id, "rakuten-rytest1001");
  assert.equal(booking.parsed.name, "テストホテル東京");
  assert.equal(booking.parsed.checkIn, "2026-07-29T13:30:00.000Z");
  assert.equal(booking.parsed.checkOut, "2026-07-30T15:00:00.000Z");
  assert.equal(booking.parsed.address, "〒100-0001 東京都千代田区千代田1-1");
  assert.equal(booking.parsed.phone, "03-1234-5678");
  assert.equal(booking.parsed.roomType, "禁煙クイーンルーム");
  assert.equal(booking.parsed.amount, 34650);
  assert.equal(booking.parsed.managementLink, "https://example.test/rakuten/manage/RYTEST1001");
});

test("fixture: 楽天キャンセル確認メールを同じ予約ID・取消状態で解析する", () => {
  const booking = parseTravelEmail(rakutenCancellationFixture);
  assert.equal(booking.id, "rakuten-rytest1001");
  assert.equal(booking.status, "cancelled");
  assert.equal(booking.parsed.name, "テストホテル東京");
  assert.equal(booking.parsed.checkIn, "2026-07-29T13:30:00.000Z");
  assert.equal(booking.parsed.checkOut, "2026-07-30T15:00:00.000Z");
  assert.equal(booking.parsed.address, "〒100-0001 東京都千代田区千代田1-1");
  assert.equal(booking.parsed.phone, "03-1234-5678");
  assert.equal(booking.parsed.roomType, "禁煙クイーンルーム");
  assert.equal(booking.parsed.amount, 34650);
  assert.equal(booking.parsed.managementLink, "https://example.test/rakuten/manage/RYTEST1001");
});

test("fixture: HTML本文をテキスト化した楽天予約を解析する", () => {
  const booking = parseTravelEmail({ ...rakutenHtmlFixture, body: rakutenHtmlFixture.normalizedBody });
  assert.equal(booking.id, "rakuten-rytest2002");
  assert.equal(booking.parsed.name, "テストホテル大阪");
  assert.equal(booking.parsed.checkIn, "2026-08-05T09:00:00.000Z");
  assert.equal(booking.parsed.checkOut, "2026-08-06T15:00:00.000Z");
  assert.equal(booking.parsed.address, "〒530-0001 大阪府大阪市北区梅田1-1");
  assert.equal(booking.parsed.phone, "06-1234-5678");
  assert.equal(booking.parsed.roomType, "禁煙ツインルーム");
  assert.equal(booking.parsed.amount, 28000);
  assert.equal(booking.parsed.managementLink, "https://example.test/rakuten/manage/RYTEST2002");
});

test("fixture: 同一楽天予約の完了・確認・取消を統合し手修正を維持する", () => {
  const complete = parseTravelEmail(rakutenCompleteFixture);
  complete.overrides = { name: "手修正ホテル名" };
  complete.hidden = true;
  const confirmation = parseTravelEmail(rakutenConfirmationFixture);
  const cancellation = parseTravelEmail(rakutenCancellationFixture);
  const [merged] = mergeBookings([complete], [confirmation, cancellation]);
  assert.equal(merged.id, "rakuten-rytest1001");
  assert.equal(merged.status, "cancelled");
  assert.equal(merged.overrides.name, "手修正ホテル名");
  assert.equal(merged.hidden, true);
  assert.equal(merged.source.length, 3);
});

test("Firestore置換操作は楽天予約のoverridesとhiddenを維持する", () => {
  const current = parseTravelEmail(rakutenCompleteFixture);
  current.overrides = { name: "手修正ホテル名" };
  current.hidden = true;
  const refreshed = parseTravelEmail(rakutenConfirmationFixture);
  const operations = buildProviderReplacementOperations([current], "楽天トラベル", [refreshed]);
  const setOperation = operations.find((operation) => operation.type === "set");
  assert.deepEqual(setOperation.booking.overrides, { name: "手修正ホテル名" });
  assert.equal(setOperation.booking.hidden, true);
  assert.equal(operations.some((operation) => operation.type === "delete"), false);
});

test("解析ホテル0件ではFirestore削除操作を生成しない", () => {
  const current = parseTravelEmail(rakutenCompleteFixture);
  const operations = buildProviderReplacementOperations(
    [current],
    "楽天トラベル",
    [],
    { preserveExistingOnEmpty: true }
  );
  assert.deepEqual(operations, []);
});

test("完全再取得で楽天メール0件なら既存ホテルを削除しない", () => {
  const current = parseTravelEmail(rakutenCompleteFixture);
  const result = runHotelPipeline([]);
  const operations = buildProviderReplacementOperations(
    [current],
    "楽天トラベル",
    result.bookings,
    { preserveExistingOnEmpty: true }
  );
  assert.equal(result.diagnostics.searchCount, 0);
  assert.deepEqual(operations, []);
});

test("完全再取得でホテル解析0件なら既存ホテルを削除しない", () => {
  const current = parseTravelEmail(rakutenCompleteFixture);
  const invalid = {
    ...rakutenCompleteFixture,
    body: "楽天トラベル\n予約に関するお知らせ",
  };
  const result = runHotelPipeline([invalid]);
  const operations = buildProviderReplacementOperations(
    [current],
    "楽天トラベル",
    result.bookings,
    { preserveExistingOnEmpty: true }
  );
  assert.equal(result.diagnostics.searchCount, 1);
  assert.equal(result.diagnostics.bookingCount, 0);
  assert.deepEqual(operations, []);
});

test("fixture: 予約番号がない楽天メールはホテル予約にしない", () => {
  const message = { ...rakutenCompleteFixture, body: rakutenCompleteFixture.body.replace("RYTEST1001", "") };
  assert.equal(parseTravelEmail(message), null);
});

test("空欄の手修正値は解析済み日付を消さない", () => {
  const booking = parseTravelEmail(rakutenPlainBooking);
  booking.overrides = { checkIn: "", checkOut: "" };
  assert.equal(effectiveBooking(booking).data.checkIn, "2026-07-29T13:30:00.000Z");
  assert.equal(effectiveBooking(booking).data.checkOut, "2026-07-30T15:00:00.000Z");
});

test("Gmail上の有効な将来ホテル5件を解析する", () => {
  const bookings = futureHotels.map(parseTravelEmail);
  assert.equal(bookings.length, 5);
  assert.deepEqual(bookings.map((booking) => booking.parsed.amount), [31600, 29450, 32750, 29900, 34650]);
  assert.deepEqual(bookings.map((booking) => booking.parsed.checkIn.slice(0, 10)), [
    "2026-06-14",
    "2026-07-01",
    "2026-07-15",
    "2026-07-22",
    "2026-07-29",
  ]);
  assert.ok(bookings.every((booking) => booking.parsed.checkOut));
});

test("予約番号のないJAL遅延メールを同じ便へ統合する", () => {
  const booked = parseTravelEmail(jalBoarding);
  const delayed = parseTravelEmail(jalDelay);
  const [merged] = mergeBookings([], [booked, delayed]);
  assert.equal(merged.id, booked.id);
  assert.equal(merged.source.length, 2);
  assert.equal(merged.parsed.reservationNumber, "D6GWOG");
  assert.equal(merged.parsed.startAt, "2026-06-14T03:20:00.000Z");
});

test("JAL予約内容メールから往復2便を解析する", () => {
  const bookings = parseTravelEmails(jalReservation);
  assert.equal(bookings.length, 2);
  assert.equal(bookings[0].id, "jal-d6gwog-2026-06-14-jal3513");
  assert.equal(bookings[0].parsed.origin, "福岡");
  assert.equal(bookings[0].parsed.destination, "札幌（新千歳）");
  assert.equal(bookings[0].parsed.startAt, "2026-06-14T02:50:00.000Z");
  assert.equal(bookings[1].id, "jal-d6gwog-2026-06-16-jal4472");
  assert.equal(bookings[1].parsed.origin, "札幌（新千歳）");
  assert.equal(bookings[1].parsed.destination, "福岡");
});

test("取消メールが同じ予約を取消状態へ更新する", () => {
  const booked = parseTravelEmail(rakutenBooking);
  booked.overrides = { name: "手修正ホテル名" };
  const cancelled = parseTravelEmail(rakutenCancel);
  const [merged] = mergeBookings([booked], [cancelled]);
  assert.equal(merged.status, "cancelled");
  assert.equal(merged.overrides.name, "手修正ホテル名");
  assert.equal(effectiveBooking(merged).data.name, "手修正ホテル名");
  assert.equal(merged.source.length, 2);
});

test("往復便とホテルを一つの出張へまとめる", () => {
  const outbound = parseTravelEmail(jalBoarding);
  const inbound = parseTravelEmail(jalSeatChange);
  const hotel = parseTravelEmail(rakutenBooking);
  hotel.parsed.checkIn = "2026-06-14T06:00:00.000Z";
  hotel.parsed.checkOut = "2026-06-16T02:00:00.000Z";
  const [trip] = groupTrips([outbound, inbound, hotel], { homeAirport: "福岡" });
  assert.equal(trip.items.length, 3);
  assert.match(trip.title, /札幌/);
});

test("初回と差分同期のGmail検索期間を生成する", () => {
  assert.match(gmailQuery("2026-06-13T00:00:00Z"), /after:2026\/05\/14/);
  assert.match(gmailQuery(""), /after:/);
  assert.match(gmailQuery(""), /JAL国内線/);
  assert.match(gmailQuery(""), /booking\.jal\.com/);
  assert.match(hotelGmailQuery("2026-06-13T00:00:00Z"), /after:2026\/05\/14/);
  assert.match(hotelGmailQuery(""), /subject:"楽天トラベル"/);
});

test("対象外メールを無視する", () => {
  assert.equal(parseTravelEmail({
    id: "other",
    from: "shop@example.com",
    subject: "ご注文ありがとうございます",
    body: "商品を発送しました",
  }), null);
});

test("取消後に届いた確認メールで予約を復活させない", () => {
  const booked = parseTravelEmail(rakutenBooking);
  const cancelled = parseTravelEmail(rakutenCancel);
  const reminder = structuredClone(booked);
  reminder.source[0].receivedAt = "2026-06-13T01:00:00.000Z";
  reminder.updatedAt = reminder.source[0].receivedAt;
  const [merged] = mergeBookings([], [booked, cancelled, reminder]);
  assert.equal(merged.status, "cancelled");
});

test("ホテル完全再取得は楽天トラベルを過去2年検索する", () => {
  assert.match(hotelRescanQuery(), /newer_than:2y/);
  assert.match(hotelRescanQuery(), /キャンセル確認メール/);
  assert.match(hotelRescanQuery(), /no-reply@mail\.travel\.rakuten\.co\.jp/);
  assert.match(hotelRescanQuery(), /subject:"楽天トラベル"/);
  assert.match(hotelRescanQuery(), /subject:"予約"/);
  assert.match(hotelRescanQuery(), /subject:"キャンセル"/);
});

test("予約番号だけで施設名とチェックインがない楽天メールは保存対象外にする", () => {
  const message = {
    ...rakutenCompleteFixture,
    body: "楽天トラベル\n予約受付番号\nRYTEST-NO-DETAILS",
  };
  assert.equal(parseTravelEmail(message), null);
});

test("ホテルパイプラインは段階別件数と失敗理由を返す", () => {
  const missingNumber = {
    ...rakutenCompleteFixture,
    id: "missing-number",
    body: rakutenCompleteFixture.body.replace("RYTEST1001", ""),
  };
  const unrelated = {
    id: "unrelated-reservation",
    from: "other@example.com",
    subject: "予約のお知らせ",
    receivedAt: "2026-06-10T00:00:00.000Z",
    body: "一般的な予約メールです",
  };
  const result = runHotelPipeline([rakutenCompleteFixture, missingNumber, unrelated]);
  assert.equal(result.diagnostics.searchCount, 3);
  assert.equal(result.diagnostics.bodyCount, 3);
  assert.equal(result.diagnostics.candidateCount, 2);
  assert.equal(result.diagnostics.parsedMessageCount, 1);
  assert.equal(result.diagnostics.bookingCount, 1);
  assert.equal(result.diagnostics.failureCount, 2);
  assert.deepEqual(result.diagnostics.failureReasons, [
    { reason: "予約番号なし", count: 1 },
    { reason: "楽天メール判定外", count: 1 },
  ]);
});

test("ホテルパイプラインは同じ予約番号のメールを1予約へ統合する", () => {
  const result = runHotelPipeline([
    rakutenCompleteFixture,
    rakutenConfirmationFixture,
    rakutenCancellationFixture,
  ]);
  assert.equal(result.diagnostics.parsedMessageCount, 3);
  assert.equal(result.diagnostics.bookingCount, 1);
  assert.equal(result.bookings[0].id, "rakuten-rytest1001");
  assert.equal(result.bookings[0].status, "cancelled");
  assert.equal(result.bookings[0].source.length, 3);
});

test("ホテルパイプラインの予約は次の出張表示用データになる", () => {
  const result = runHotelPipeline([rakutenCompleteFixture]);
  const [trip] = groupTrips(result.bookings, { homeAirport: "福岡" });
  assert.equal(trip.items.length, 1);
  assert.equal(trip.items[0].type, "hotel");
  assert.equal(trip.items[0].data.name, "テストホテル東京");
  assert.equal(trip.startAt, "2026-07-29T13:30:00.000Z");
});

test("ホテルだけの出張タイトルは郵便番号を含めず市区町村を優先する", () => {
  const hotel = {
    id: "hotel-address",
    type: "hotel",
    provider: "AI",
    status: "confirmed",
    source: [],
    parsed: {
      name: "HATAGO INN",
      address: "210-0005 神奈川県川崎市川崎区東田町9-3",
      checkIn: "2026-06-24T06:00:00.000Z",
      checkOut: "2026-06-26T02:00:00.000Z",
    },
    overrides: {},
    hidden: false,
    updatedAt: "2026-06-17T00:00:00.000Z",
  };
  const [trip] = groupTrips([hotel], { homeAirport: "福岡" });
  assert.equal(trip.title, "川崎出張");
  assert.equal(trip.destination, "川崎");
});

test("航空券完全再取得はJAL国内線を過去1年検索する", () => {
  assert.match(flightRescanQuery(), /newer_than:1y/);
  assert.match(flightRescanQuery(), /JAL国内線/);
  assert.match(flightRescanQuery(), /booking\.jal\.com/);
});

test("改行された差引支払額を優先する", () => {
  const message = structuredClone(rakutenBooking);
  message.body = message.body.replace(
    "差引支払額 消費税込: 34650円",
    "総合計 34000円\n差引支払額\n31600 円"
  );
  assert.equal(parseTravelEmail(message).parsed.amount, 31600);
});
