import { combineDateTime, parseJapaneseDate } from "../domain/date.mjs";
import { normalizeAirport } from "../domain/location.mjs";
import { sourceFromMessage } from "../domain/booking-builder.mjs";
import { normalizeText } from "../domain/text.mjs";

export const jalDomesticParser = {
  id: "jal-domestic.v1",
  match(message) {
    return String(message.from || "").toLowerCase().includes("jal.com") || String(message.subject || "").includes("JAL国内線");
  },
  parse(message) {
    const body = normalizeText(message.body || "");
    const source = sourceFromMessage(message);
    const reservationNumber = match(body, /予約番号\s*[:：]?\s*([A-Z0-9]{6,})/i);
    const status = /取消|キャンセル/.test(`${message.subject || ""}\n${body}`) ? "cancelled" : "confirmed";
    const itineraryPattern = /((?:20\d{2})年\s*\d{1,2}月\d{1,2}日)(?:（[^）]+）|\([^)]*\))?\s+(JAL\d{2,4})便\s+([^\n]+?)(\d{1,2}:\d{2})発\s+([^\n]+?)(\d{1,2}:\d{2})着/g;
    const matches = [...body.matchAll(itineraryPattern)];
    const parsed = matches.length ? matches.map((item) => buildResult({ message, source, reservationNumber, status, dateText: item[1], flightNumber: item[2], origin: item[3], departureTime: item[4], destination: item[5], arrivalTime: item[6] })) : [parseSingle({ message, body, source, reservationNumber, status })].filter(Boolean);
    return parsed;
  },
};

function parseSingle({ message, body, source, reservationNumber, status }) {
  const flightNumber = normalizeFlightNumber(match(message.subject, /\b(JAL\d{2,4})便?/i) || match(body, /\b(JAL\d{2,4})\b/i));
  const dateText = match(message.subject, /((?:20\d{2}年)?\d{1,2}月\d{1,2}日)/) || match(body, /((?:20\d{2}年)?\s*\d{1,2}月\d{1,2}日)(?:（[^）]+）|\([^)]*\))?\s+JAL/i);
  const route = body.match(/([^\n]+?)\s*(?:→|->)\s*([^\n]+)/);
  const normalTimes = body.match(/定刻\s*(\d{1,2}:\d{2})発\s*-\s*(\d{1,2}:\d{2})着/);
  if (!flightNumber || !dateText) return failedResult({ message, source, reason: "便名または搭乗日なし" });
  return buildResult({ message, source, reservationNumber, status, dateText, flightNumber, origin: route?.[1] || "", departureTime: match(body, /出発予定時刻\s*(\d{1,2}:\d{2})/) || normalTimes?.[1] || "", destination: route?.[2] || "", arrivalTime: normalTimes?.[2] || "", seat: lastMatch(body, /座席(?:番号)?\s*[:：]?\s*\n?\s*(\d{1,2}[A-Z])\b/gi) });
}

function buildResult({ message, source, reservationNumber, status, dateText, flightNumber, origin, departureTime, destination, arrivalTime, seat = "" }) {
  const flightDate = parseJapaneseDate(dateText, source.receivedAt);
  const extracted = { reservationNumber, flightNumber: normalizeFlightNumber(flightNumber), flightDate, startAt: combineDateTime(flightDate, departureTime), endAt: combineDateTime(flightDate, arrivalTime, departureTime && arrivalTime && arrivalTime < departureTime), origin: normalizeAirport(origin), destination: normalizeAirport(destination), seat, status };
  const issues = [["origin", extracted.origin], ["destination", extracted.destination], ["startAt", extracted.startAt]].filter(([, value]) => !value).map(([field]) => ({ field, code: `missing_${field}`, severity: "warning", message: `${field}を取得できませんでした` }));
  return { parserId: jalDomesticParser.id, provider: "JAL", providerKey: "jal", extractedType: "flight", source, status: flightDate && extracted.flightNumber ? "parsed" : "failed", confidence: issues.length ? 0.7 : 0.9, extracted, issues, reason: issues.map((issue) => issue.code).join(", "), hints: { flightNumbers: extracted.flightNumber ? [extracted.flightNumber] : [], dates: flightDate ? [flightDate] : [] } };
}
function failedResult({ source, reason }) { return { parserId: jalDomesticParser.id, provider: "JAL", providerKey: "jal", extractedType: "unknown", source, status: "failed", confidence: 0, extracted: {}, issues: [{ code: "parse_failed", severity: "error", message: reason }], reason, hints: {} }; }
function match(value, regex) { return String(value || "").match(regex)?.[1]?.trim() || ""; }
function lastMatch(value, regex) { let found = ""; for (const item of String(value || "").matchAll(regex)) found = item[1]?.trim() || found; return found; }
function normalizeFlightNumber(value = "") { return value.toUpperCase().replace(/\s+/g, ""); }
