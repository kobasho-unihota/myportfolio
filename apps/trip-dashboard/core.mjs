const AIRPORT_ALIASES = {
  "札幌/新千歳": "札幌（新千歳）",
  "札幌(新千歳)": "札幌（新千歳）",
  "新千歳": "札幌（新千歳）",
  "福岡": "福岡",
  "東京/羽田": "東京（羽田）",
  "東京(羽田)": "東京（羽田）",
  "羽田": "東京（羽田）",
};

export function parseTravelEmail(message) {
  const from = String(message.from || message.from_ || "").toLowerCase();
  const subject = String(message.subject || "");
  const body = normalizeText(message.body || "");
  const receivedAt = normalizeDateTime(message.receivedAt || message.email_ts) || new Date().toISOString();
  const source = {
    messageId: String(message.id || ""),
    threadId: String(message.threadId || message.thread_id || ""),
    subject,
    from: String(message.from || message.from_ || ""),
    receivedAt,
    url: message.url || message.display_url || "",
  };

  if (from.includes("jal.com") || subject.includes("JAL国内線")) {
    return parseJal({ subject, body, source });
  }
  if (from.includes("travel.rakuten.co.jp") || subject.includes("楽天トラベル")) {
    return parseRakuten({ subject, body, source });
  }
  return null;
}

export function mergeBookings(existing, incoming) {
  const merged = new Map(existing.map((booking) => [booking.id, structuredCloneSafe(booking)]));
  [...incoming].sort((a, b) => sourceTime(a) - sourceTime(b)).forEach((booking) => {
    let key = booking.id;
    let current = merged.get(key);
    if (!current && booking.type === "flight") {
      const matching = [...merged.entries()].find(([, candidate]) =>
        candidate.type === "flight" && flightSignature(candidate) === flightSignature(booking));
      if (matching) {
        [key, current] = matching;
      }
    }
    if (!current) {
      merged.set(booking.id, structuredCloneSafe(booking));
      return;
    }
    const latestSource = latestByTime([...(current.source || []), ...(booking.source || [])]);
    const incomingIsNewer = sourceTime(booking) >= sourceTime(current);
    const targetId = current.parsed?.reservationNumber
      ? current.id
      : booking.parsed?.reservationNumber ? booking.id : key;
    if (targetId !== key) merged.delete(key);
    merged.set(targetId, {
      ...current,
      id: targetId,
      provider: booking.provider || current.provider,
      status: current.status === "cancelled" || booking.status === "cancelled"
        ? "cancelled"
        : incomingIsNewer ? booking.status : current.status,
      parsed: incomingIsNewer
        ? { ...current.parsed, ...removeEmpty(booking.parsed) }
        : { ...booking.parsed, ...removeEmpty(current.parsed) },
      source: uniqueBy(latestSource, (item) => item.messageId || `${item.subject}:${item.receivedAt}`),
      updatedAt: new Date(Math.max(Date.parse(current.updatedAt || 0), Date.parse(booking.updatedAt || 0))).toISOString(),
    });
  });
  return [...merged.values()];
}

export function effectiveBooking(booking) {
  return {
    ...booking,
    data: { ...(booking.parsed || {}), ...(booking.overrides || {}) },
  };
}

export function groupTrips(bookings, settings = {}) {
  const homeAirport = settings.homeAirport || "福岡";
  const active = bookings
    .filter((booking) => !booking.hidden && booking.status !== "cancelled")
    .map(effectiveBooking)
    .filter((booking) => booking.data.startAt || booking.data.checkIn)
    .sort((a, b) => bookingStart(a) - bookingStart(b));

  const outbound = active.filter((booking) =>
    booking.type === "flight" && airportMatches(booking.data.origin, homeAirport));
  const used = new Set();
  const trips = [];

  outbound.forEach((flight) => {
    if (used.has(flight.id)) return;
    const start = bookingStart(flight);
    const returnFlight = active.find((candidate) =>
      candidate.type === "flight" &&
      !used.has(candidate.id) &&
      bookingStart(candidate) > start &&
      bookingStart(candidate) - start <= 14 * 86400000 &&
      airportMatches(candidate.data.destination, homeAirport));
    const end = returnFlight ? bookingEnd(returnFlight) : start + 4 * 86400000;
    const items = active.filter((candidate) => {
      const time = bookingStart(candidate);
      return !used.has(candidate.id) && time >= start - 12 * 3600000 && time <= end;
    });
    items.forEach((item) => used.add(item.id));
    trips.push(buildTrip(items, homeAirport));
  });

  active.filter((booking) => !used.has(booking.id)).forEach((booking) => {
    trips.push(buildTrip([booking], homeAirport));
  });
  return trips.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

export function bookingWarnings(trip) {
  const warnings = [];
  const flights = trip.items.filter((item) => item.type === "flight");
  const hotels = trip.items.filter((item) => item.type === "hotel");
  if (!flights.length) warnings.push("航空券が見つかっていません");
  if (flights.length === 1) warnings.push("復路便が見つかっていません");
  if (!hotels.length && trip.durationDays > 1) warnings.push("ホテル予約が見つかっていません");
  trip.items.forEach((item) => {
    if (item.type === "flight" && (!item.data.startAt || !item.data.origin || !item.data.destination)) {
      warnings.push(`${item.data.flightNumber || "航空券"}に未解析項目があります`);
    }
    if (item.type === "hotel" && (!item.data.checkIn || !item.data.checkOut || !item.data.name)) {
      warnings.push(`${item.data.name || "ホテル"}に未解析項目があります`);
    }
  });
  return [...new Set(warnings)];
}

export function gmailQuery(lastSyncedAt) {
  const after = lastSyncedAt
    ? new Date(Date.parse(lastSyncedAt) - 30 * 86400000)
    : new Date(Date.now() - 365 * 86400000);
  const date = [
    after.getUTCFullYear(),
    String(after.getUTCMonth() + 1).padStart(2, "0"),
    String(after.getUTCDate()).padStart(2, "0"),
  ].join("/");
  return `after:${date} {from:jal.com from:skyinfo.jal.com from:travel@mail.travel.rakuten.co.jp from:mail.travel.rakuten.co.jp subject:"JAL国内線" subject:"楽天トラベル"} -in:trash -in:spam`;
}

export function hotelRescanQuery() {
  return `newer_than:2y from:travel@mail.travel.rakuten.co.jp {subject:"予約完了メール" subject:"予約確認メール" subject:"キャンセル確認メール"} -in:trash -in:spam`;
}

export function flightRescanQuery() {
  return `newer_than:1y {from:jal.com from:skyinfo.jal.com} subject:"JAL国内線" -in:trash -in:spam`;
}

function parseJal({ subject, body, source }) {
  const reservationNumber = match(body, /予約番号\s*[:：]?\s*([A-Z0-9]{6,})/i);
  const flightNumber = normalizeFlightNumber(
    match(subject, /\b(JAL\d{2,4})便?/i) ||
    match(body, /\b(JAL\d{2,4})\b/i)
  );
  const dateText =
    match(subject, /((?:20\d{2}年)?\d{1,2}月\d{1,2}日)/) ||
    match(body, /((?:20\d{2}年)?\s*\d{1,2}月\d{1,2}日)(?:（[^）]+）|\([^)]*\))?\s+JAL/i) ||
    match(body, /((?:20\d{2}年)\s*\d{1,2}月\d{1,2}日)/);
  const flightDate = parseJapaneseDate(dateText, source.receivedAt);
  const route = body.match(/([^\n]+?)\s*(?:→|->)\s*([^\n]+)/);
  const normalTimes = body.match(/定刻\s*(\d{1,2}:\d{2})発\s*-\s*(\d{1,2}:\d{2})着/);
  const changedTimes = [...body.matchAll(/\n(\d{1,2}:\d{2})\s*\n(?:\1\s*\n)?\n?([^\n]+)/g)];
  let origin = route ? cleanAirport(route[1]) : "";
  let destination = route ? cleanAirport(route[2]) : "";
  let departureTime = match(body, /出発予定時刻\s*(\d{1,2}:\d{2})/) || normalTimes?.[1] || "";
  let arrivalTime = normalTimes?.[2] || "";
  if ((!origin || !destination) && changedTimes.length >= 2) {
    departureTime = changedTimes[0][1];
    origin = cleanAirport(changedTimes[0][2]);
    arrivalTime = changedTimes[1][1];
    destination = cleanAirport(changedTimes[1][2]);
  }
  const seat = lastMatch(body, /座席(?:番号)?\s*[:：]?\s*\n?\s*(\d{1,2}[A-Z])\b/gi);
  const status = /取消|キャンセル/.test(subject + body) ? "cancelled" : "confirmed";
  if (!flightNumber || !flightDate) return null;
  const startAt = combineDateTime(flightDate, departureTime);
  const endAt = combineDateTime(flightDate, arrivalTime, departureTime && arrivalTime && arrivalTime < departureTime);
  const statusLink = firstLink(body, /運航状況|flight-status/i);
  const bookingLink = firstLink(body, /2次元バーコード|予約詳細|手続きに進む/i);
  const id = `jal-${slug(reservationNumber || "unknown")}-${flightDate}-${slug(flightNumber)}`;
  return {
    id,
    type: "flight",
    provider: "JAL",
    status,
    source: [source],
    parsed: {
      reservationNumber,
      flightNumber,
      startAt,
      endAt,
      origin,
      destination,
      seat,
      statusLink,
      bookingLink,
    },
    overrides: {},
    hidden: false,
    updatedAt: source.receivedAt,
  };
}

function parseRakuten({ subject, body, source }) {
  if (!/予約|キャンセル|チェックイン/.test(subject + body)) return null;
  const reservationNumber = match(body, /予約(?:受付)?番号\s*[:：]?\s*([A-Z0-9]+)/i);
  if (!reservationNumber) return null;
  const cancelled = /キャンセル確認|予約をキャンセル/.test(subject + body);
  const separator = String.raw`\s*(?:[:：]\s*|\n\s*)`;
  const name = match(body, new RegExp(String.raw`(?:ホテル名|宿泊施設名)${separator}(?:\[)?([^\]\n]+?)(?:\]\([^)]+\))?(?=\n|$)`));
  const address = match(body, new RegExp(String.raw`(?:住所|宿泊施設住所)${separator}([^\n]+)`));
  const phone = match(body, new RegExp(String.raw`宿泊施設電話番号${separator}([\d-]{10,})`));
  const checkInText = match(body, new RegExp(String.raw`チェックイン(?:日時)?${separator}【?((?:20\d{2})[-/]\d{1,2}[-/]\d{1,2}(?:\([^)]*\))?\s*\d{1,2}:\d{2})`));
  const checkOutText = match(body, new RegExp(String.raw`チェックアウト(?:日)?${separator}【?((?:20\d{2})[-/]\d{1,2}[-/]\d{1,2})`));
  const roomType = match(body, new RegExp(String.raw`部屋タイプ${separator}([^\n]+)`));
  const plan = match(body, /(?:宿泊プラン名|プラン名)\s*(?:[:：]\s*|\n\s*)(?:\[)?([^\]\n]+?)(?:\]\([^)]+\))?(?=\n|$)/);
  const amount = Number((lastMatch(body, /(?:差引支払額(?:\s*消費税込)?\s*[:：]?\s*(?:消費税込\s*[:：]?\s*)?|総合計\s*(?:消費税込\s*[:：]?\s*)?)([\d,]+)\s*円/gi) || "0").replace(/,/g, ""));
  const breakfast = /朝食[:：].*あり|朝食付/.test(body);
  const managementLink = firstLink(body, /予約確認ページ|予約の詳細確認|変更、キャンセル/i);
  return {
    id: `rakuten-${slug(reservationNumber)}`,
    type: "hotel",
    provider: "楽天トラベル",
    status: cancelled ? "cancelled" : "confirmed",
    source: [source],
    parsed: {
      reservationNumber,
      name: cleanMarkdown(name),
      address: cleanMarkdown(address),
      phone,
      checkIn: normalizeDateTime(checkInText),
      checkOut: normalizeDateTime(checkOutText),
      roomType: cleanMarkdown(roomType),
      plan: cleanMarkdown(plan),
      amount,
      breakfast,
      managementLink,
    },
    overrides: {},
    hidden: false,
    updatedAt: source.receivedAt,
  };
}

function buildTrip(items, homeAirport) {
  const effective = items.map((item) => item.data ? item : effectiveBooking(item));
  const start = new Date(Math.min(...effective.map(bookingStart)));
  const end = new Date(Math.max(...effective.map(bookingEnd)));
  const outbound = effective.find((item) => item.type === "flight" && airportMatches(item.data.origin, homeAirport));
  const destination = outbound?.data.destination ||
    effective.find((item) => item.type === "hotel")?.data.address?.replace(/^〒[\d-]+\s*/, "").split(/[都道府県]/)[0] ||
    "出張";
  const destinationLabel = String(destination).replace(/[（(].*?[）)]/g, "").replace(/空港/g, "").trim();
  return {
    id: effective.map((item) => item.id).sort().join("__"),
    title: destinationLabel === "出張" ? "出張" : `${destinationLabel}出張`,
    destination,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationDays: Math.max(1, Math.ceil((end - start) / 86400000)),
    items: effective.sort((a, b) => bookingStart(a) - bookingStart(b)),
  };
}

function bookingStart(booking) {
  return Date.parse(booking.data.startAt || booking.data.checkIn || booking.updatedAt || 0);
}
function bookingEnd(booking) {
  return Date.parse(booking.data.endAt || booking.data.checkOut || booking.data.startAt || booking.data.checkIn || 0);
}
function airportMatches(value, homeAirport) {
  const a = cleanAirport(value).replace(/[（）()空港/\s]/g, "");
  const b = cleanAirport(homeAirport).replace(/[（）()空港/\s]/g, "");
  return a.includes(b) || b.includes(a);
}
function cleanAirport(value = "") {
  const cleaned = String(value).trim().replace(/^(変更前|変更後)\s*/, "");
  return AIRPORT_ALIASES[cleaned] || cleaned;
}
function normalizeText(value) {
  return String(value).replace(/\r/g, "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n");
}
function match(value, regex) {
  return value.match(regex)?.[1]?.trim() || "";
}
function lastMatch(value, regex) {
  let found = "";
  for (const item of value.matchAll(regex)) found = item[1]?.trim() || found;
  return found;
}
function normalizeFlightNumber(value = "") {
  return value.toUpperCase().replace(/\s+/g, "");
}
function parseJapaneseDate(value, reference) {
  if (!value) return "";
  const parts = value.match(/(?:(20\d{2})年)?\s*(\d{1,2})月(\d{1,2})日/);
  if (!parts) return "";
  let year = Number(parts[1] || new Date(reference).getUTCFullYear());
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const ref = new Date(reference);
  if (!parts[1] && month < ref.getUTCMonth() - 5) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function combineDateTime(date, time, nextDay = false) {
  if (!date) return "";
  const parsed = new Date(`${date}T${time || "00:00"}:00+09:00`);
  if (nextDay) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}
function normalizeDateTime(value) {
  if (!value) return "";
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime()) && /T|Z|[+-]\d{2}:?\d{2}$/.test(String(value))) {
    return direct.toISOString();
  }
  const text = String(value).replace(/\([^)]*\)/g, "").trim().replace(/\//g, "-");
  const hasTime = /\d{1,2}:\d{2}/.test(text);
  const parsed = new Date(`${text}${hasTime ? "" : " 00:00"} GMT+0900`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
function firstLink(body, labelPattern) {
  const markdown = [...body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)];
  return markdown.find((item) => labelPattern.test(item[1] + item[2]))?.[2] || "";
}
function cleanMarkdown(value = "") {
  return String(value).replace(/^\[/, "").replace(/\]\([^)]+\)$/, "").trim();
}
function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}
function removeEmpty(object = {}) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}
function latestByTime(items) {
  return items.sort((a, b) => Date.parse(a.receivedAt || 0) - Date.parse(b.receivedAt || 0));
}
function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
function sourceTime(booking) {
  return Math.max(Date.parse(booking.updatedAt || 0), ...((booking.source || []).map((item) => Date.parse(item.receivedAt || 0))));
}
function flightSignature(booking) {
  const data = booking.parsed || booking.data || {};
  if (!data.flightNumber || !data.startAt) return "";
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(data.startAt));
  return `${normalizeFlightNumber(data.flightNumber)}:${date}`;
}
function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
