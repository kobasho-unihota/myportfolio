import { mergeBookings } from "./src/domain/merge-bookings.mjs";
import { bookingWarnings, groupTrips } from "./src/domain/trip-grouping.mjs";
import { parseMessages } from "./src/parsers/registry.mjs";
import { demoMessages } from "./src/ui/demo-data.mjs";

const state = { bookings: [], unclassified: [] };
const formatter = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });

bootstrap();

function bootstrap() {
  const parsed = parseMessages(demoMessages);
  state.bookings = mergeBookings([], parsed.bookings);
  state.unclassified = parsed.unclassified;
  render();
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  navigator.serviceWorker?.register("./sw.js").catch(() => {});
}

function render() {
  const trips = groupTrips(state.bookings, { homeAirport: "福岡" });
  const next = trips[0];
  document.querySelector("#nextTrip").innerHTML = next ? tripCard(next, true) : `<section class="empty">次の出張はありません</section>`;
  document.querySelector("#tripList").innerHTML = trips.slice(1).map((trip) => tripCard(trip)).join("") || `<p class="muted">その次の予定はありません。</p>`;
  document.querySelector("#bookingList").innerHTML = state.bookings.map(bookingCard).join("");
  document.querySelector("#reviewList").innerHTML = state.unclassified.map(issueCard).join("") || `<p class="muted">要確認メールはありません。</p>`;
}

function tripCard(trip, hero = false) {
  const warnings = bookingWarnings(trip);
  return `<article class="card ${hero ? "hero" : ""}"><p class="eyebrow">${dateRange(trip.startAt, trip.endAt)} · ${trip.grouping.confidence.toUpperCase()}</p><h2>${escapeHtml(trip.title)}</h2>${warnings.map((warning) => `<span class="warning">${escapeHtml(warning)}</span>`).join("")}<div class="timeline">${trip.items.map(bookingCard).join("")}</div></article>`;
}
function bookingCard(booking) {
  const data = booking.parsed || booking.data || {};
  const title = booking.type === "flight" ? `${data.flightNumber || "航空券"} ${data.origin || ""} → ${data.destination || ""}` : data.name || "ホテル";
  const when = booking.type === "flight" ? data.startAt : data.checkIn;
  return `<article class="booking"><b>${escapeHtml(title)}</b><small>${escapeHtml(booking.provider)} · ${when ? formatter.format(new Date(when)) : "日時未定"}</small></article>`;
}
function issueCard(item) { return `<article class="card issue"><p class="eyebrow">要確認</p><h3>${escapeHtml(item.sourceMessage.subject || item.id)}</h3><p>${escapeHtml(item.parserAttempts[0]?.reason || "対応parserなし")}</p></article>`; }
function showView(name) { document.querySelectorAll(".view").forEach((view) => view.hidden = view.id !== name); document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name)); }
function dateRange(start, end) { return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`; }
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
