import { bookingWarnings, effectiveBooking, gmailQuery, groupTrips, hotelRescanQuery, mergeBookings, parseTravelEmail } from "./core.mjs?v=4";
import { fetchTravelMessages } from "./gmail.mjs?v=4";
import { cloudSync } from "./firebase-sync.mjs?v=4";

const state = {
  user: null,
  bookings: [],
  settings: { homeAirport: "福岡", lastSyncedAt: "" },
  syncStatus: "loading",
  bookingFilter: "active",
};
const demoMode = new URLSearchParams(location.search).has("demo");
const dateTime = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" });
const currency = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));

cloudSync.subscribe((snapshot) => {
  state.user = snapshot.user;
  state.syncStatus = snapshot.status;
  if (snapshot.status === "synced" || snapshot.status === "syncing") {
    state.bookings = snapshot.state.bookings || [];
    state.settings = { ...state.settings, ...snapshot.state.settings };
  }
  if (demoMode && !state.bookings.length) state.bookings = demoBookings();
  updateAuthUI(snapshot.error);
  render();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.bookingFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderBookings();
  });
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => elements.bookingDialog.close()));

elements.heroSyncButton.addEventListener("click", () => showView("sync"));
elements.syncNowButton.addEventListener("click", syncGmail);
elements.rescanHotelsButton.addEventListener("click", rescanHotels);
elements.accountButton.addEventListener("click", handleAccount);
elements.accountSettingsButton.addEventListener("click", handleAccount);
elements.addBookingButton.addEventListener("click", () => openBookingDialog());
elements.bookingType.addEventListener("change", updateBookingFields);
elements.bookingForm.addEventListener("submit", saveBooking);
elements.saveSettingsButton.addEventListener("click", saveSettings);
elements.resetHiddenButton.addEventListener("click", resetHiddenBookings);
elements.bookingList.addEventListener("click", handleBookingAction);

elements.todayLabel.textContent = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric", month: "long", day: "numeric", weekday: "long",
}).format(new Date());

async function handleAccount() {
  try {
    if (state.user) await cloudSync.signOut();
    else await cloudSync.signIn();
  } catch (error) {
    showToast(readableError(error));
  }
}

async function syncGmail() {
  try {
    setSyncing(true);
    const token = await cloudSync.authorizeGmail();
    const messages = await fetchTravelMessages(token, gmailQuery(state.settings.lastSyncedAt), updateProgress);
    const parsed = messages.map(parseTravelEmail).filter(Boolean);
    const merged = mergeBookings(state.bookings, parsed);
    const changed = merged.filter((next) => JSON.stringify(state.bookings.find((item) => item.id === next.id)) !== JSON.stringify(next));
    updateProgress({ phase: "save", current: 0, total: changed.length });
    for (let index = 0; index < changed.length; index += 1) {
      await cloudSync.saveBooking(changed[index]);
      updateProgress({ phase: "save", current: index + 1, total: changed.length });
    }
    await cloudSync.saveSettings({ ...state.settings, lastSyncedAt: new Date().toISOString() });
    showToast(`${parsed.length}件の予約メールを確認しました`);
    showView("home");
  } catch (error) {
    showToast(error.status === 401 ? "認証期限が切れました。もう一度更新してください。" : readableError(error));
  } finally {
    setSyncing(false);
  }
}

async function rescanHotels() {
  try {
    setSyncing(true, true);
    const token = await cloudSync.authorizeGmail();
    const messages = await fetchTravelMessages(token, hotelRescanQuery(), updateProgress);
    const parsed = messages.map(parseTravelEmail).filter((booking) => booking?.type === "hotel");
    const rebuilt = mergeBookings([], parsed);
    updateProgress({ phase: "save", current: 0, total: rebuilt.length });
    await cloudSync.replaceHotelBookings(rebuilt);
    updateProgress({ phase: "save", current: rebuilt.length, total: rebuilt.length });
    await cloudSync.saveSettings({ ...state.settings, lastSyncedAt: new Date().toISOString() });
    const active = rebuilt.filter((booking) => booking.status !== "cancelled").length;
    showToast(`ホテル${active}件を復元、取消${rebuilt.length - active}件を反映しました`);
    showView("bookings");
  } catch (error) {
    showToast(error.status === 401 ? "認証期限が切れました。もう一度実行してください。" : readableError(error));
  } finally {
    setSyncing(false, true);
  }
}

function updateProgress(progress) {
  const labels = { search: "予約メールを検索中", read: "メール本文を確認中", save: "予約を保存中" };
  elements.syncProgressTitle.textContent = labels[progress.phase] || "更新中";
  const ratio = progress.total ? Math.min(100, Math.round(progress.current / progress.total * 100)) : 12;
  elements.syncProgressBar.style.width = `${ratio}%`;
  elements.syncProgressText.textContent = progress.total ? `${progress.current} / ${progress.total}件` : `${progress.current}件見つかりました`;
}

function setSyncing(active, hotelRescan = false) {
  elements.syncNowButton.disabled = active;
  elements.rescanHotelsButton.disabled = active;
  elements.syncNowButton.textContent = active ? "更新しています..." : "Gmailから更新する";
  elements.rescanHotelsButton.textContent = active && hotelRescan ? "ホテルを再構築しています..." : "ホテルを完全再取得";
  elements.syncProgress.hidden = !active;
  document.querySelector(".sync-orbit").classList.toggle("running", active);
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  document.querySelectorAll(".bottom-nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  elements.homeAirportInput.value = state.settings.homeAirport || "福岡";
  elements.lastSyncLabel.textContent = state.settings.lastSyncedAt
    ? `最終更新 ${new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.settings.lastSyncedAt))}`
    : "まだ更新されていません";
  renderTrips();
  renderBookings();
}

function renderTrips() {
  const trips = groupTrips(state.bookings, state.settings);
  const upcoming = trips.filter((trip) => Date.parse(trip.endAt) >= Date.now() - 12 * 3600000);
  elements.nextTrip.innerHTML = upcoming[0] ? tripHero(upcoming[0]) : emptyState("次の出張はありません", "Gmailから更新すると、JALと楽天トラベルの予約をここにまとめます。", "更新画面を開く");
  elements.nextTrip.querySelector("[data-open-sync]")?.addEventListener("click", () => showView("sync"));
  elements.upcomingTrips.innerHTML = upcoming.slice(1, 5).length
    ? upcoming.slice(1, 5).map(tripMini).join("")
    : `<div class="empty-state"><strong>その次の予定はありません</strong><p>新しい予約メールを受信したら更新してください。</p></div>`;
}

function tripHero(trip) {
  const flight = trip.items.find((item) => item.type === "flight");
  const data = flight?.data || {};
  const days = Math.ceil((Date.parse(trip.startAt) - Date.now()) / 86400000);
  const countdown = days > 0 ? `<strong>${days}</strong><span>日後</span>` : `<strong>${days === 0 ? "今日" : "出張中"}</strong><span>TRIP</span>`;
  const warnings = bookingWarnings(trip);
  return `
    <article class="trip-hero">
      <div class="trip-top"><div><small>${formatDateRange(trip.startAt, trip.endAt)}</small><h2>${escapeHtml(trip.title)}</h2></div><div class="countdown">${countdown}</div></div>
      <div class="route">
        <div><strong>${escapeHtml(shortAirport(data.origin || state.settings.homeAirport))}</strong><small>${formatTime(data.startAt)}</small></div>
        <div class="route-line"><svg viewBox="0 0 24 24"><path d="M3 15.5 21 8l-7.5 13-2-7-8.5 1.5Z"/></svg></div>
        <div><strong>${escapeHtml(shortAirport(data.destination || trip.destination))}</strong><small>${formatTime(data.endAt)}</small></div>
      </div>
      <div class="trip-meta"><span>${trip.durationDays}日間</span><span>${trip.items.length}件の予約</span>${data.flightNumber ? `<span>${escapeHtml(data.flightNumber)}</span>` : ""}</div>
    </article>
    <div class="timeline">${trip.items.map(timelineItem).join("")}</div>
    ${warnings.length ? `<div class="warning-box"><strong>確認してください</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
  `;
}

function timelineItem(booking) {
  const data = booking.data;
  if (booking.type === "flight") {
    return `<article class="timeline-card">
      <div class="item-icon">${flightIcon()}</div>
      <div class="item-copy"><strong>${escapeHtml(data.flightNumber || "航空券")} ${escapeHtml(shortAirport(data.origin))} → ${escapeHtml(shortAirport(data.destination))}</strong><p>${dateTimeSafe(data.startAt)}発</p><small>予約 ${escapeHtml(data.reservationNumber || "未取得")} ・ 座席 ${escapeHtml(data.seat || "未指定")}</small></div>
      <div class="item-side"><strong>${formatTime(data.startAt)}</strong><span>${formatTime(data.endAt)}着</span></div>
    </article>`;
  }
  return `<article class="timeline-card">
    <div class="item-icon hotel">${hotelIcon()}</div>
    <div class="item-copy"><strong>${escapeHtml(data.name || "ホテル")}</strong><p>${dateOnlySafe(data.checkIn)} チェックイン</p><small>${escapeHtml(data.roomType || data.address || "詳細未取得")}</small></div>
    <div class="item-side"><strong>${formatTime(data.checkIn)}</strong><span>${data.breakfast ? "朝食あり" : "宿泊"}</span></div>
  </article>`;
}

function tripMini(trip) {
  return `<article class="trip-mini"><time>${formatDateRange(trip.startAt, trip.endAt)}</time><h3>${escapeHtml(trip.title)}</h3><p>${trip.items.map((item) => item.type === "flight" ? item.data.flightNumber : item.data.name).filter(Boolean).join(" / ")}</p></article>`;
}

function renderBookings() {
  const bookings = [...state.bookings].map(effectiveBooking).sort((a, b) => Date.parse(bookingDate(a)) - Date.parse(bookingDate(b)));
  const filtered = bookings.filter((booking) => {
    if (state.bookingFilter === "cancelled") return booking.status === "cancelled";
    if (state.bookingFilter === "active") return booking.status !== "cancelled" && !booking.hidden && Date.parse(bookingDate(booking)) >= Date.now() - 86400000;
    return true;
  });
  elements.bookingList.innerHTML = filtered.length ? filtered.map(bookingCard).join("") : `<div class="empty-state"><strong>該当する予約はありません</strong><p>更新するか、手動で予約を追加してください。</p></div>`;
}

function bookingCard(booking) {
  const data = booking.data;
  const title = booking.type === "flight" ? `${data.flightNumber || "航空券"} ${shortAirport(data.origin)} → ${shortAirport(data.destination)}` : data.name || "ホテル";
  const detail = booking.type === "flight" ? dateTimeSafe(data.startAt) : `${dateOnlySafe(data.checkIn)} - ${dateOnlySafe(data.checkOut)}`;
  const sourceUrl = [...(booking.source || [])].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0]?.url;
  return `<article class="booking-card ${booking.status === "cancelled" ? "cancelled" : ""} ${booking.hidden ? "hidden-booking" : ""}">
    <div class="item-icon ${booking.type === "hotel" ? "hotel" : ""}">${booking.type === "flight" ? flightIcon() : hotelIcon()}</div>
    <div class="booking-copy"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><small>${escapeHtml(booking.provider)} ・ ${escapeHtml(data.reservationNumber || "手動登録")}</small><span class="status-badge ${booking.status === "cancelled" ? "cancelled" : ""}">${booking.status === "cancelled" ? "取消" : booking.hidden ? "非表示" : "予約済み"}</span></div>
    <div class="booking-actions">
      ${sourceUrl ? `<a class="mini-button" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer" aria-label="元メール">${mailIcon()}</a>` : ""}
      <button class="mini-button" data-action="edit" data-id="${escapeAttribute(booking.id)}" type="button" aria-label="編集">${editIcon()}</button>
      <button class="mini-button" data-action="hide" data-id="${escapeAttribute(booking.id)}" type="button" aria-label="${booking.hidden ? "再表示" : "非表示"}">${eyeIcon(booking.hidden)}</button>
    </div>
  </article>`;
}

function handleBookingAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const booking = state.bookings.find((item) => item.id === button.dataset.id);
  if (!booking) return;
  if (button.dataset.action === "edit") openBookingDialog(booking);
  if (button.dataset.action === "hide") cloudSync.saveBooking({ ...booking, hidden: !booking.hidden, updatedAt: new Date().toISOString() }).catch((error) => showToast(readableError(error)));
}

function openBookingDialog(booking = null) {
  elements.bookingForm.reset();
  elements.formError.textContent = "";
  elements.bookingId.value = booking?.id || "";
  elements.bookingDialogTitle.textContent = booking ? "予約を編集" : "予約を追加";
  elements.bookingType.value = booking?.type || "flight";
  const data = booking ? effectiveBooking(booking).data : {};
  elements.flightNumber.value = data.flightNumber || "";
  elements.flightReservationNumber.value = data.reservationNumber || "";
  elements.flightOrigin.value = data.origin || "";
  elements.flightDestination.value = data.destination || "";
  elements.flightStartAt.value = toLocalInput(data.startAt);
  elements.flightEndAt.value = toLocalInput(data.endAt);
  elements.flightSeat.value = data.seat || "";
  elements.hotelName.value = data.name || "";
  elements.hotelCheckIn.value = toLocalInput(data.checkIn);
  elements.hotelCheckOut.value = toLocalInput(data.checkOut);
  elements.hotelAddress.value = data.address || "";
  elements.hotelPhone.value = data.phone || "";
  elements.hotelReservationNumber.value = data.reservationNumber || "";
  elements.hotelRoomType.value = data.roomType || "";
  elements.hotelAmount.value = data.amount || "";
  elements.hotelBreakfast.checked = Boolean(data.breakfast);
  updateBookingFields();
  elements.bookingDialog.showModal();
}

function updateBookingFields() {
  const flight = elements.bookingType.value === "flight";
  elements.flightFields.hidden = !flight;
  elements.hotelFields.hidden = flight;
}

async function saveBooking(event) {
  event.preventDefault();
  if (!state.user) {
    elements.formError.textContent = "先にGoogleでログインしてください。";
    return;
  }
  const type = elements.bookingType.value;
  const existing = state.bookings.find((item) => item.id === elements.bookingId.value);
  const parsed = existing?.parsed || {};
  const overrides = type === "flight" ? {
    flightNumber: elements.flightNumber.value.trim(),
    reservationNumber: elements.flightReservationNumber.value.trim(),
    origin: elements.flightOrigin.value.trim(),
    destination: elements.flightDestination.value.trim(),
    startAt: fromLocalInput(elements.flightStartAt.value),
    endAt: fromLocalInput(elements.flightEndAt.value),
    seat: elements.flightSeat.value.trim(),
  } : {
    name: elements.hotelName.value.trim(),
    reservationNumber: elements.hotelReservationNumber.value.trim(),
    checkIn: fromLocalInput(elements.hotelCheckIn.value),
    checkOut: fromLocalInput(elements.hotelCheckOut.value),
    address: elements.hotelAddress.value.trim(),
    phone: elements.hotelPhone.value.trim(),
    roomType: elements.hotelRoomType.value.trim(),
    amount: Number(elements.hotelAmount.value || 0),
    breakfast: elements.hotelBreakfast.checked,
  };
  const required = type === "flight" ? overrides.startAt && overrides.flightNumber : overrides.checkIn && overrides.name;
  if (!required) {
    elements.formError.textContent = type === "flight" ? "便名と出発日時を入力してください。" : "ホテル名とチェックインを入力してください。";
    return;
  }
  const id = existing?.id || `manual-${type}-${crypto.randomUUID()}`;
  await cloudSync.saveBooking({
    id, type, provider: existing?.provider || "手動",
    status: existing?.status || "confirmed",
    source: existing?.source || [],
    parsed, overrides, hidden: existing?.hidden || false,
    updatedAt: new Date().toISOString(),
  });
  elements.bookingDialog.close();
  showToast("予約を保存しました");
}

async function saveSettings() {
  if (!state.user) {
    showToast("先にGoogleでログインしてください");
    return;
  }
  const homeAirport = elements.homeAirportInput.value.trim();
  if (!homeAirport) return showToast("自宅空港を入力してください");
  await cloudSync.saveSettings({ ...state.settings, homeAirport });
  showToast("設定を保存しました");
}

async function resetHiddenBookings() {
  if (!state.user) {
    showToast("先にGoogleでログインしてください");
    return;
  }
  elements.resetHiddenButton.disabled = true;
  elements.resetHiddenButton.textContent = "再表示しています...";
  try {
    const count = await cloudSync.resetHiddenBookings();
    showToast(count ? `${count}件の予約を再表示しました` : "非表示の予約はありません");
    if (count) showView("bookings");
  } catch (error) {
    showToast(readableError(error));
  } finally {
    elements.resetHiddenButton.disabled = false;
    elements.resetHiddenButton.textContent = "非表示をすべて解除";
  }
}

function updateAuthUI(error) {
  const signedIn = Boolean(state.user);
  elements.accountLabel.textContent = signedIn ? state.user.displayName || state.user.email : "Googleで同期";
  elements.accountSettingsTitle.textContent = signedIn ? state.user.email : "Googleアカウント";
  elements.accountSettingsCopy.textContent = signedIn ? "予約情報をこのGoogleアカウントで同期しています。" : "ログインすると、予約と手修正内容をiPhone・PC間で同期できます。";
  elements.accountSettingsButton.textContent = signedIn ? "ログアウト" : "Googleでログイン";
  elements.syncDot.className = `sync-dot ${state.syncStatus === "synced" ? "synced" : state.syncStatus === "error" ? "error" : state.syncStatus === "syncing" ? "syncing" : ""}`;
  elements.connectionBanner.hidden = !error && navigator.onLine;
  elements.connectionBanner.classList.toggle("error", Boolean(error));
  elements.connectionMessage.textContent = error ? readableError(error) : "オフラインです。保存済みの予約を表示しています。";
}

window.addEventListener("online", () => updateAuthUI());
window.addEventListener("offline", () => updateAuthUI());
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
const initialView = location.hash.replace("#", "");
if (["home", "bookings", "sync", "settings"].includes(initialView)) showView(initialView);

function emptyState(title, copy, button) {
  return `<div class="empty-state"><strong>${title}</strong><p>${copy}</p><button class="primary-button compact" data-open-sync type="button">${button}</button></div>`;
}
function bookingDate(booking) { return booking.data.startAt || booking.data.checkIn || booking.updatedAt; }
function formatDateRange(start, end) { return `${dateOnlySafe(start)} - ${dateOnlySafe(end)}`; }
function dateOnlySafe(value) { return value ? dateOnly.format(new Date(value)) : "日時未定"; }
function dateTimeSafe(value) { return value ? dateTime.format(new Date(value)) : "日時未定"; }
function formatTime(value) { return value ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "--:--"; }
function shortAirport(value = "") { return String(value).replace(/空港/g, "").replace(/[（(].*?[）)]/g, "").replace(/東京|札幌/g, (item) => item); }
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function fromLocalInput(value) { return value ? new Date(value).toISOString() : ""; }
function readableError(error) {
  const message = String(error?.message || error || "エラーが発生しました。");
  if (message.includes("popup-closed")) return "認証画面が閉じられました。";
  if (message.includes("permission-denied")) return "Firestoreのアクセス権限を確認してください。";
  return message.replace(/^Firebase:\s*/, "");
}
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
}
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function escapeAttribute(value = "") { return escapeHtml(value); }
function flightIcon() { return `<svg viewBox="0 0 24 24"><path d="M3 15.5 21 8l-7.5 13-2-7-8.5 1.5Z"/><path d="m11.5 14 4-4"/></svg>`; }
function hotelIcon() { return `<svg viewBox="0 0 24 24"><path d="M4 20V5h11v15M15 10h5v10M8 9h3M8 13h3M8 17h3M2 20h20"/></svg>`; }
function mailIcon() { return `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>`; }
function editIcon() { return `<svg viewBox="0 0 24 24"><path d="m14 5 5 5L8 21H3v-5Z"/><path d="m12 7 5 5"/></svg>`; }
function eyeIcon(hidden) { return hidden ? `<svg viewBox="0 0 24 24"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.2A10.8 10.8 0 0 1 12 5c5 0 9 7 9 7a15 15 0 0 1-2 2.7M6.2 6.2C3.8 7.8 3 12 3 12s4 7 9 7a9 9 0 0 0 3-.5"/></svg>` : `<svg viewBox="0 0 24 24"><path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7Z"/><circle cx="12" cy="12" r="2.5"/></svg>`; }

function demoBookings() {
  const now = new Date();
  const departure = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 11, 50);
  const arrival = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 14, 10);
  const returning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 18, 5);
  const returned = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 20, 55);
  const source = [{ messageId: "demo", subject: "デモ予約", receivedAt: now.toISOString(), url: "https://mail.google.com/" }];
  return [
    {
      id: "demo-flight-out", type: "flight", provider: "JAL", status: "confirmed", source,
      parsed: { reservationNumber: "ABC123", flightNumber: "JAL3513", startAt: departure.toISOString(), endAt: arrival.toISOString(), origin: "福岡", destination: "札幌（新千歳）", seat: "30J" },
      overrides: {}, hidden: false, updatedAt: now.toISOString(),
    },
    {
      id: "demo-hotel", type: "hotel", provider: "楽天トラベル", status: "confirmed", source,
      parsed: { reservationNumber: "RYdemo123", name: "コンフォートホテルERA札幌北口", address: "北海道札幌市北区", phone: "011-000-0000", checkIn: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 15).toISOString(), checkOut: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 11).toISOString(), roomType: "禁煙ダブルルーム", amount: 28400, breakfast: true },
      overrides: {}, hidden: false, updatedAt: now.toISOString(),
    },
    {
      id: "demo-flight-in", type: "flight", provider: "JAL", status: "confirmed", source,
      parsed: { reservationNumber: "ABC123", flightNumber: "JAL4472", startAt: returning.toISOString(), endAt: returned.toISOString(), origin: "札幌（新千歳）", destination: "福岡", seat: "17A" },
      overrides: {}, hidden: false, updatedAt: now.toISOString(),
    },
  ];
}
