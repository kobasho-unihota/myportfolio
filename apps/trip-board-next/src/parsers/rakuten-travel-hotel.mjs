import { normalizeDateTime } from "../domain/date.mjs";
import { sourceFromMessage } from "../domain/booking-builder.mjs";
import { createNormalizedDocument, findLink, findValue } from "./normalized-document.mjs";

export const rakutenTravelHotelParser = {
  id: "rakuten-travel-hotel.v1",
  match(message) {
    const from = String(message.from || "").toLowerCase();
    return from.includes("travel.rakuten.co.jp") || String(message.subject || "").includes("楽天トラベル");
  },
  parse(message) {
    const document = createNormalizedDocument(message);
    const reservationNumber = findValue(document, ["予約受付番号", "予約番号"]) || document.reservationNumbers.find((value) => /^RY/i.test(value)) || "";
    const name = findValue(document, ["ホテル名", "宿泊施設名"]);
    const checkIn = normalizeDateTime(findValue(document, ["チェックイン日時", "チェックイン"]));
    const checkOut = normalizeDateTime(findValue(document, ["チェックアウト日", "チェックアウト"]));
    const amount = Number((lastMatch(document.text, /(?:差引支払額(?:\s*消費税込)?\s*[：:]?\s*(?:消費税込\s*[：:]?\s*)?|総合計\s*(?:消費税込\s*[：:]?\s*)?)([\d,]+)\s*円/gi) || "0").replace(/,/g, ""));
    const extracted = {
      reservationNumber,
      name,
      address: findValue(document, ["宿泊施設住所", "住所"]),
      phone: findValue(document, ["宿泊施設電話番号"]),
      checkIn,
      checkOut,
      roomType: findValue(document, ["部屋タイプ"]),
      plan: findValue(document, ["プラン名", "宿泊プラン名"]),
      amount,
      breakfast: /朝食[:：].*あり|朝食付/.test(document.text),
      managementLink: findLink(document, /予約確認ページ|予約の詳細確認|変更、キャンセル/i),
      status: /キャンセル確認|予約をキャンセル/.test(`${message.subject || ""}\n${document.text}`) ? "cancelled" : "confirmed",
    };
    const issues = requiredIssues({ reservationNumber, name, checkIn });
    const status = !reservationNumber ? "failed" : issues.length ? "partial" : "parsed";
    return {
      parserId: this.id,
      provider: "楽天トラベル",
      providerKey: "rakuten",
      extractedType: "hotel",
      source: sourceFromMessage(message),
      status,
      confidence: status === "parsed" ? 0.92 : status === "partial" ? 0.45 : 0,
      extracted,
      issues,
      reason: status === "failed" ? "予約番号なし" : issues.map((issue) => issue.code).join(", "),
      hints: { reservationNumbers: document.reservationNumbers, dates: document.dates, hotelNames: name ? [name] : [] },
    };
  },
};

function requiredIssues(values) {
  return [
    ["reservationNumber", values.reservationNumber, "missing_reservation_number", "予約番号を取得できませんでした"],
    ["name", values.name, "missing_hotel_name", "ホテル名を取得できませんでした"],
    ["checkIn", values.checkIn, "missing_check_in", "チェックイン日時を取得できませんでした"],
  ].filter(([, value]) => !value).map(([field, , code, message]) => ({ field, code, severity: "error", message }));
}
function lastMatch(value, regex) { let found = ""; for (const item of String(value).matchAll(regex)) found = item[1]?.trim() || found; return found; }
