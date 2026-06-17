import { airportMatches, locationFromAirport, locationsMatch, parseJapaneseAddress } from "./location.mjs";
import { effectiveBooking } from "./merge-bookings.mjs";

export function groupTrips(bookings, settings = {}) {
  const homeAirport = settings.homeAirport || "福岡";
  const active = bookings.filter((booking) => !booking.hidden && booking.status !== "cancelled").map(effectiveBooking).filter((booking) => booking.data.startAt || booking.data.checkIn).sort((a, b) => bookingStart(a) - bookingStart(b));
  const used = new Set();
  const trips = [];
  const outboundFlights = active.filter((booking) => booking.type === "flight" && airportMatches(booking.data.origin, homeAirport));
  for (const outbound of outboundFlights) {
    if (used.has(outbound.id)) continue;
    const start = bookingStart(outbound);
    const inbound = active.find((candidate) => candidate.type === "flight" && !used.has(candidate.id) && bookingStart(candidate) > start && bookingStart(candidate) - start <= 14 * 86400000 && airportMatches(candidate.data.destination, homeAirport));
    const end = inbound ? bookingEnd(inbound) : start + 4 * 86400000;
    const items = [outbound, ...(inbound ? [inbound] : [])];
    for (const hotel of active.filter((candidate) => candidate.type === "hotel" && !used.has(candidate.id))) {
      const score = hotelScore({ outbound, inbound, hotel, start, end });
      if (score.score >= 40) items.push({ ...hotel, grouping: score });
    }
    items.forEach((item) => used.add(item.id));
    trips.push(buildTrip(items, homeAirport));
  }
  active.filter((booking) => !used.has(booking.id)).forEach((booking) => trips.push(buildTrip([booking], homeAirport)));
  return trips.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

export function bookingWarnings(trip) {
  const warnings = [];
  const flights = trip.items.filter((item) => item.type === "flight");
  const hotels = trip.items.filter((item) => item.type === "hotel");
  if (!flights.length) warnings.push("航空券が見つかっていません");
  if (flights.length === 1) warnings.push("復路便が見つかっていません");
  if (!hotels.length && trip.durationDays > 1) warnings.push("ホテル予約が見つかっていません");
  if (trip.grouping.confidence !== "high") warnings.push("出張への紐付けを確認してください");
  return [...new Set(warnings)];
}

function hotelScore({ outbound, inbound, hotel, start, end }) {
  let score = 0;
  const reasons = [];
  const checkIn = bookingStart(hotel);
  const checkOut = bookingEnd(hotel);
  if (checkIn >= start - 12 * 3600000 && checkIn <= end + 12 * 3600000) { score += 50; reasons.push("date_overlap"); }
  if (sameTokyoDate(outbound.data.startAt, hotel.data.checkIn)) { score += 20; reasons.push("checkin_matches_outbound"); }
  if (inbound && sameTokyoDate(inbound.data.startAt, hotel.data.checkOut)) { score += 20; reasons.push("checkout_matches_return"); }
  if (locationsMatch(locationFromAirport(outbound.data.destination), parseJapaneseAddress(hotel.data.address))) { score += 30; reasons.push("same_prefecture"); }
  if (Math.abs(checkIn - start) > 7 * 86400000) { score -= 50; reasons.push("far_date"); }
  return { score, reasons, confidence: score >= 80 ? "high" : score >= 50 ? "medium" : "low" };
}
function buildTrip(items, homeAirport) {
  const start = new Date(Math.min(...items.map(bookingStart)));
  const end = new Date(Math.max(...items.map(bookingEnd)));
  const outbound = items.find((item) => item.type === "flight" && airportMatches(item.data.origin, homeAirport));
  const hotel = items.find((item) => item.type === "hotel");
  const destination = outbound?.data.destination || hotel?.data.address || "出張";
  const title = `${String(destination).replace(/^〒[\d-]+\s*/, "").replace(/[（(].*?[）)]/g, "").replace(/空港/g, "").slice(0, 8) || "出張"}出張`;
  const childScores = items.map((item) => item.grouping).filter(Boolean);
  const minConfidence = childScores.some((item) => item.confidence === "low") ? "low" : childScores.some((item) => item.confidence === "medium") ? "medium" : "high";
  return { id: items.map((item) => item.id).sort().join("__"), title, startAt: start.toISOString(), endAt: end.toISOString(), durationDays: Math.max(1, Math.ceil((end - start) / 86400000)), items: items.sort((a, b) => bookingStart(a) - bookingStart(b)), grouping: { confidence: minConfidence, score: childScores.reduce((sum, item) => sum + item.score, 0), reasons: [...new Set(childScores.flatMap((item) => item.reasons))] } };
}
function bookingStart(booking) { return Date.parse(booking.data.startAt || booking.data.checkIn || booking.updatedAt || 0); }
function bookingEnd(booking) { return Date.parse(booking.data.endAt || booking.data.checkOut || booking.data.startAt || booking.data.checkIn || 0); }
function sameTokyoDate(a, b) { return a && b && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(a)) === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(b)); }
