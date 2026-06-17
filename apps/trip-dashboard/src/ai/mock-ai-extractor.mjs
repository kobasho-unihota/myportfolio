import { createEmptyExtraction } from "./extraction-schema.mjs";

const FIXTURE_EXTRACTIONS = {
  "jal-demo-out": {
    category: "flight",
    confidence: 0.94,
    summary: "JAL国内線の福岡〜札幌往復予約メールです。",
    flight: {
      airline: "JAL",
      flightNumber: "JAL3513 / JAL4472",
      departureAirport: "福岡",
      arrivalAirport: "札幌（新千歳）",
      departureDateTime: "2026-07-10T11:50:00+09:00",
      arrivalDateTime: "2026-07-10T14:10:00+09:00",
      passengerName: "",
      reservationNumber: "D6GWOG",
    },
    hotel: emptyHotelForMock(),
    tripHints: { city: "札幌", area: "北海道", startDate: "2026-07-10", endDate: "2026-07-12" },
    warnings: ["復路便の情報はsummaryに含めています。最小構成では代表便として保存します。"],
  },
  "rakuten-demo": {
    category: "hotel",
    confidence: 0.96,
    summary: "札幌のホテル予約メールです。",
    flight: emptyFlightForMock(),
    hotel: {
      hotelName: "コンフォートホテルERA札幌北口",
      checkInDate: "2026-07-10",
      checkOutDate: "2026-07-12",
      nights: 2,
      guestName: "",
      address: "〒060-0808 北海道札幌市北区北8条西4丁目",
      reservationNumber: "RYTEST1001",
      planName: "【連泊割】朝食付",
    },
    tripHints: { city: "札幌", area: "北海道", startDate: "2026-07-10", endDate: "2026-07-12" },
    warnings: [],
  },
  "unknown-demo": {
    category: "trip_related_unknown",
    confidence: 0.42,
    summary: "予約に関係しそうですが、航空券またはホテル予約とは断定できません。",
    flight: emptyFlightForMock(),
    hotel: emptyHotelForMock(),
    tripHints: { city: "", area: "", startDate: "", endDate: "" },
    warnings: ["分類不能のため要確認です。"],
  },
};

export async function mockAIExtractTravelEmail(preparedMessage) {
  if (FIXTURE_EXTRACTIONS[preparedMessage.messageId]) return structuredCloneSafe(FIXTURE_EXTRACTIONS[preparedMessage.messageId]);
  const base = createEmptyExtraction(classify(preparedMessage));
  base.summary = base.category === "irrelevant" ? "出張予約メールではありません。" : "出張に関係する可能性がありますが、詳細分類できません。";
  base.confidence = base.category === "irrelevant" ? 0.7 : 0.35;
  if (base.category === "trip_related_unknown") base.warnings.push("AI mockでは詳細抽出できませんでした。");
  return base;
}

function classify(message) {
  const text = `${message.from}\n${message.subject}\n${message.bodyText}`.toLowerCase();
  if (text.includes("予約") || text.includes("flight") || text.includes("hotel") || text.includes("jal") || text.includes("楽天トラベル")) return "trip_related_unknown";
  return "irrelevant";
}
function emptyFlightForMock() { return createEmptyExtraction().flight; }
function emptyHotelForMock() { return createEmptyExtraction().hotel; }
function structuredCloneSafe(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
