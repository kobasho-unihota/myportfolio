import test from "node:test";
import assert from "node:assert/strict";
import {
  analysesToBookings,
  analysisNeedsReview,
  cacheMatches,
  excludeImportedBookings,
  hashBytes,
  hashMessageSource,
  makeFailedManualAnalysis,
  makeManualMessage,
  normalizeAnalysis,
  normalizeScreenshotAnalysis,
  normalizeScreenshotAnalyses,
  travelCandidateQuery,
  validateAnalysis,
  validateScreenshotAnalysis,
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

test("貼り付けメールから安定したmanual messageIdとsourceHashを生成する", () => {
  const manual = makeManualMessage({
    subject: "楽天トラベル予約確認",
    from: "travel@mail.travel.rakuten.co.jp",
    receivedAt: "2026-06-17T12:00",
    body: "予約本文",
  }, { now: "2026-06-17T03:00:00.000Z" });
  const same = makeManualMessage({
    subject: "楽天トラベル予約確認",
    from: "travel@mail.travel.rakuten.co.jp",
    receivedAt: "2026-06-17T12:00",
    body: "予約本文",
  }, { now: "2026-06-17T03:00:00.000Z" });

  assert.match(manual.id, /^manual-[a-f0-9]{8}$/);
  assert.equal(manual.id, same.id);
  assert.equal(manual.sourceHash, same.sourceHash);
  assert.equal(manual.messageId, manual.id);
});

test("AI失敗時は再解析用に本文とエラーを保持する", () => {
  const manual = makeManualMessage({ body: "予約本文" }, { now: "2026-06-17T03:00:00.000Z" });
  const failed = makeFailedManualAnalysis(manual, new Error("network down"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.rawBody, "予約本文");
  assert.equal(failed.errorMessage, "network down");
});

test("旅行候補Gmailクエリは2か月前からJALと楽天トラベルだけを検索する", () => {
  const query = travelCandidateQuery(new Date("2026-06-17T00:00:00.000Z"));
  assert.match(query, /after:2026\/04\/17/);
  assert.match(query, /booking\.jal\.com/);
  assert.match(query, /JAL国内線/);
  assert.match(query, /楽天トラベル/);
  assert.doesNotMatch(query, /subject:ホテル/);
  assert.doesNotMatch(query, /subject:旅程/);
});

test("JALスクショAI JSONをflight bookingへ変換する", () => {
  const analysis = normalizeScreenshotAnalysis({
    category: "flight",
    confidence: 0.91,
    sourceKind: "flight_screenshot",
    extracted: {
      airline: "JAL",
      flightNumber: "JAL3513",
      departureDate: "2026-07-20",
      departureTime: "11:50",
      arrivalTime: "14:10",
      departureAirport: "福岡",
      arrivalAirport: "札幌（新千歳）",
      reservationNumber: "D6GWOG",
    },
    warnings: [],
  }, { imageHash: "fnv1a-12345678" });

  assert.equal(validateScreenshotAnalysis(analysis).ok, true);
  const [booking] = analysesToBookings([analysis]);
  assert.equal(booking.type, "flight");
  assert.equal(booking.provider, "JAL");
  assert.equal(booking.parsed.flightNumber, "JAL3513");
  assert.equal(booking.parsed.startAt, "2026-07-20T02:50:00.000Z");
  assert.equal(booking.screenshot.imageId, "image-12345678");
});

test("年なしのJAL日付を解析基準年で補完する", () => {
  const analysis = normalizeScreenshotAnalysis({
    category: "flight",
    confidence: 0.9,
    sourceKind: "flight_screenshot",
    extracted: {
      airline: "JAL",
      flightNumber: "JAL304",
      departureDate: "6月24日（水）",
      departureTime: "08:10",
      arrivalTime: "09:50",
      departureAirport: "福岡",
      arrivalAirport: "東京（羽田）",
    },
    warnings: [],
  }, {
    imageHash: "fnv1a-yearless1",
    receivedAt: "2026-06-18T00:00:00.000Z",
  });

  assert.equal(validateScreenshotAnalysis(analysis).ok, true);
  const [booking] = analysesToBookings([analysis]);
  assert.equal(booking.parsed.startAt, "2026-06-23T23:10:00.000Z");
  assert.equal(booking.parsed.endAt, "2026-06-24T00:50:00.000Z");
});

test("年末の年なし日付は翌年として補完する", () => {
  const analysis = normalizeScreenshotAnalysis({
    category: "flight",
    confidence: 0.9,
    sourceKind: "flight_screenshot",
    extracted: {
      airline: "JAL",
      flightNumber: "JAL100",
      departureDate: "1/5",
      departureTime: "08:00",
      arrivalTime: "09:30",
      departureAirport: "福岡",
      arrivalAirport: "羽田",
    },
  }, {
    imageHash: "fnv1a-newyear1",
    receivedAt: "2026-12-28T00:00:00.000Z",
  });

  const [booking] = analysesToBookings([analysis]);
  assert.equal(booking.parsed.startAt, "2027-01-04T23:00:00.000Z");
});

test("楽天スクショAI JSONをhotel bookingへ変換する", () => {
  const analysis = normalizeScreenshotAnalysis({
    category: "hotel",
    confidence: 0.9,
    sourceKind: "hotel_screenshot",
    extracted: {
      hotelName: "HATAGO INN",
      checkInDate: "2026-07-15",
      checkOutDate: "2026-07-17",
      checkInTime: "15:00",
      address: "神奈川県",
      reservationNumber: "RY123",
      planName: "素泊まり",
      guestName: "小林",
    },
    warnings: [],
  }, { imageHash: "fnv1a-abcdef12" });

  assert.equal(validateScreenshotAnalysis(analysis).ok, true);
  const [booking] = analysesToBookings([analysis]);
  assert.equal(booking.type, "hotel");
  assert.equal(booking.provider, "楽天トラベル");
  assert.equal(booking.parsed.name, "HATAGO INN");
  assert.equal(booking.parsed.checkIn, "2026-07-15T06:00:00.000Z");
  assert.equal(booking.parsed.plan, "素泊まり");
});

test("スクショ解析の低confidenceと必須日付欠落は要確認になる", () => {
  const analysis = normalizeScreenshotAnalysis({
    category: "flight",
    confidence: 0.42,
    sourceKind: "flight_screenshot",
    extracted: { airline: "JAL", flightNumber: "JAL3513", departureAirport: "福岡", arrivalAirport: "羽田" },
    warnings: ["日付が読めません"],
  }, { imageHash: "fnv1a-low00001" });

  assert.equal(analysisNeedsReview(analysis), true);
  assert.equal(validateScreenshotAnalysis(analysis).ok, false);
  assert.match(analysis.issues.join(" "), /confidence|必須項目|日付/);
});

test("同一flightスクショは同じbooking idへ統合できる", () => {
  const base = {
    category: "flight",
    confidence: 0.86,
    sourceKind: "flight_screenshot",
    extracted: {
      airline: "JAL",
      flightNumber: "JAL3513",
      departureDate: "2026-07-20",
      departureTime: "11:50",
      arrivalTime: "14:10",
      departureAirport: "福岡",
      arrivalAirport: "札幌",
    },
  };
  const [first] = analysesToBookings([normalizeScreenshotAnalysis(base, { imageHash: "fnv1a-a1111111" })]);
  const [second] = analysesToBookings([normalizeScreenshotAnalysis({ ...base, confidence: 0.93 }, { imageHash: "fnv1a-b2222222" })]);
  assert.equal(first.id, second.id);
});

test("画像bytesから安定したhashを生成する", () => {
  const hash = hashBytes(new Uint8Array([1, 2, 3, 4]));
  assert.equal(hash, hashBytes(new Uint8Array([1, 2, 3, 4])));
  assert.match(hash, /^fnv1a-[a-f0-9]{8}$/);
});

test("1枚のスクショ内の複数予約を予約ごとのanalysisへ展開する", () => {
  const analyses = normalizeScreenshotAnalyses({
    sourceKind: "flight_screenshot",
    summary: "JAL予約一覧",
    warnings: [],
    reservations: [
      {
        category: "flight",
        confidence: 0.94,
        summary: "JAL3513",
        extracted: {
          airline: "JAL",
          flightNumber: "JAL3513",
          departureDate: "2026-07-20",
          departureTime: "11:50",
          arrivalTime: "14:10",
          departureAirport: "福岡",
          arrivalAirport: "札幌",
        },
        warnings: [],
      },
      {
        category: "flight",
        confidence: 0.92,
        summary: "JAL4472",
        extracted: {
          airline: "JAL",
          flightNumber: "JAL4472",
          departureDate: "2026-07-22",
          departureTime: "18:05",
          arrivalTime: "20:55",
          departureAirport: "札幌",
          arrivalAirport: "福岡",
        },
        warnings: [],
      },
    ],
  }, { imageId: "image-list1234", imageHash: "fnv1a-list1234" });

  assert.equal(analyses.length, 2);
  assert.equal(analyses[0].messageId, "image-list1234-1");
  assert.equal(analyses[1].messageId, "image-list1234-2");
  assert.equal(analysesToBookings(analyses).length, 2);
});

test("複数予約のうち取り込み済みだけを除外する", () => {
  const existing = [{
    id: "legacy-flight-id",
    type: "flight",
    parsed: {
      flightNumber: "JAL3513",
      startAt: "2026-07-20T02:50:00.000Z",
      origin: "福岡",
      destination: "札幌（新千歳）",
    },
  }];
  const analyses = normalizeScreenshotAnalyses({
    sourceKind: "flight_screenshot",
    reservations: [
      {
        category: "flight",
        confidence: 0.94,
        extracted: {
          airline: "JAL",
          flightNumber: "JAL3513",
          departureDate: "2026-07-20",
          departureTime: "11:50",
          arrivalTime: "14:10",
          departureAirport: "福岡",
          arrivalAirport: "札幌",
        },
      },
      {
        category: "flight",
        confidence: 0.92,
        extracted: {
          airline: "JAL",
          flightNumber: "JAL4472",
          departureDate: "2026-07-22",
          departureTime: "18:05",
          arrivalTime: "20:55",
          departureAirport: "札幌",
          arrivalAirport: "福岡",
        },
      },
    ],
  }, { imageId: "image-list1234", imageHash: "fnv1a-list1234" });

  const result = excludeImportedBookings(existing, analysesToBookings(analyses));
  assert.equal(result.skipped.length, 1);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.bookings[0].parsed.flightNumber, "JAL4472");
});

test("ホテルは予約番号が一致すれば取り込み済みとして除外する", () => {
  const existing = [{
    id: "old-hotel",
    type: "hotel",
    parsed: { reservationNumber: "RY123", name: "既存ホテル", checkIn: "2026-07-15T06:00:00.000Z" },
  }];
  const analysis = normalizeScreenshotAnalysis({
    category: "hotel",
    confidence: 0.95,
    sourceKind: "hotel_screenshot",
    extracted: {
      hotelName: "表示名が少し違うホテル",
      checkInDate: "2026-07-15",
      checkOutDate: "2026-07-17",
      reservationNumber: "RY123",
    },
  }, { imageHash: "fnv1a-hotel123" });

  const result = excludeImportedBookings(existing, analysesToBookings([analysis]));
  assert.equal(result.skipped.length, 1);
  assert.equal(result.bookings.length, 0);
});
