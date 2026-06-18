export const AI_SCHEMA_VERSION = 3;
export const LOW_CONFIDENCE_THRESHOLD = 0.75;
export const AI_CATEGORIES = ["flight", "hotel", "trip_related_unknown", "irrelevant"];
export const SCREENSHOT_SOURCE_KINDS = ["flight_screenshot", "hotel_screenshot", "unknown_screenshot"];

export function travelCandidateQuery(referenceDate = new Date()) {
  const after = twoMonthsAgo(referenceDate);
  const date = [
    after.getUTCFullYear(),
    String(after.getUTCMonth() + 1).padStart(2, "0"),
    String(after.getUTCDate()).padStart(2, "0"),
  ].join("/");
  return [
    `after:${date}`,
    "{",
    "from:jal.com",
    "from:skyinfo.jal.com",
    "from:booking.jal.com",
    "subject:\"JAL国内線\"",
    "from:travel@mail.travel.rakuten.co.jp",
    "from:no-reply@mail.travel.rakuten.co.jp",
    "subject:\"楽天トラベル\"",
    "}",
    "-in:trash",
    "-in:spam",
  ].join(" ");
}

function twoMonthsAgo(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  date.setUTCMonth(date.getUTCMonth() - 2);
  return date;
}

export function normalizeAnalysis(raw, message = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const analysis = raw && typeof raw === "object" ? raw : {};
  const category = AI_CATEGORIES.includes(analysis.category) ? analysis.category : "trip_related_unknown";
  const confidence = clampConfidence(analysis.confidence);
  const extracted = normalizeExtracted(category, analysis.extracted || analysis);
  const source = sourceFromMessage(message);
  const issues = [
    ...normalizeStringArray(analysis.issues),
    ...normalizeStringArray(analysis.warnings),
    ...validationIssues(category, confidence, extracted),
  ];
  const status = normalizeStatus(analysis.status, category, confidence, issues);
  return {
    messageId: String(analysis.messageId || source.messageId || ""),
    threadId: String(analysis.threadId || source.threadId || ""),
    subject: String(analysis.subject || source.subject || ""),
    from: String(analysis.from || source.from || ""),
    receivedAt: normalizeIso(analysis.receivedAt || source.receivedAt) || now,
    url: String(analysis.url || source.url || ""),
    category,
    confidence,
    status,
    summary: String(analysis.summary || ""),
    provider: String(analysis.provider || extracted.provider || ""),
    reservationNumber: String(analysis.reservationNumber || extracted.reservationNumber || ""),
    dateRange: normalizeDateRange(analysis.dateRange || extracted.dateRange),
    extracted,
    issues: [...new Set(issues.filter(Boolean))],
    model: String(analysis.model || options.model || ""),
    schemaVersion: Number(analysis.schemaVersion || AI_SCHEMA_VERSION),
    sourceHash: String(analysis.sourceHash || options.sourceHash || ""),
    createdAt: normalizeIso(analysis.createdAt) || now,
    updatedAt: now,
    userReviewedAt: analysis.userReviewedAt || "",
    overrides: analysis.overrides && typeof analysis.overrides === "object" ? analysis.overrides : {},
    sourceType: String(analysis.sourceType || options.sourceType || ""),
    imageId: String(analysis.imageId || options.imageId || ""),
    imageHash: String(analysis.imageHash || options.imageHash || ""),
    sourceKind: SCREENSHOT_SOURCE_KINDS.includes(analysis.sourceKind || options.sourceKind) ? String(analysis.sourceKind || options.sourceKind) : "",
  };
}

export function validateAnalysis(analysis) {
  const normalized = normalizeAnalysis(analysis);
  const errors = [];
  if (!normalized.messageId) errors.push("messageId is required");
  if (!AI_CATEGORIES.includes(normalized.category)) errors.push("category is invalid");
  if (normalized.confidence < 0 || normalized.confidence > 1) errors.push("confidence must be 0..1");
  if (normalized.category === "flight" && !normalized.extracted.items.length) errors.push("flight items are required");
  if (normalized.category === "hotel" && (!normalized.extracted.name || !normalized.extracted.checkIn)) {
    errors.push("hotel name and checkIn are required");
  }
  return { ok: errors.length === 0, errors, analysis: normalized };
}

export function analysisNeedsReview(analysis) {
  return analysis.status === "needs_review" ||
    analysis.category === "trip_related_unknown" ||
    analysis.category === "irrelevant" ||
    analysis.confidence < LOW_CONFIDENCE_THRESHOLD ||
    Boolean(analysis.issues?.length);
}

export function cacheMatches(analysis, message) {
  return Boolean(analysis?.messageId && message?.id &&
    analysis.messageId === message.id &&
    analysis.sourceHash &&
    analysis.sourceHash === message.sourceHash &&
    analysis.status !== "failed");
}

export function analysesToBookings(analyses) {
  return analyses.flatMap((analysis) => {
    const normalized = normalizeAnalysis(analysis);
    if (normalized.category === "flight") return flightBookings(normalized);
    if (normalized.category === "hotel") return hotelBooking(normalized);
    return [];
  });
}

export function normalizeScreenshotAnalyses(raw, image = {}, options = {}) {
  const reservations = Array.isArray(raw?.reservations) && raw.reservations.length
    ? raw.reservations
    : [raw];
  return reservations.map((reservation, index) => normalizeScreenshotAnalysis({
    ...reservation,
    sourceKind: reservation?.sourceKind || raw?.sourceKind,
    model: reservation?.model || raw?.model,
    warnings: [
      ...normalizeStringArray(raw?.warnings),
      ...normalizeStringArray(reservation?.warnings),
    ],
  }, image, {
    ...options,
    messageId: reservations.length > 1
      ? `${image.imageId || `image-${String(image.imageHash || options.imageHash || "").replace(/^fnv1a-/, "")}`}-${index + 1}`
      : image.imageId || options.messageId,
  }));
}

export function normalizeScreenshotAnalysis(raw, image = {}, options = {}) {
  const sourceKind = SCREENSHOT_SOURCE_KINDS.includes(raw?.sourceKind || image.sourceKind || options.sourceKind)
    ? String(raw?.sourceKind || image.sourceKind || options.sourceKind)
    : "unknown_screenshot";
  const imageHash = String(raw?.imageHash || image.imageHash || options.imageHash || "");
  const imageId = String(raw?.imageId || image.imageId || (imageHash ? `image-${imageHash.replace(/^fnv1a-/, "")}` : ""));
  const messageId = String(raw?.messageId || options.messageId || imageId);
  const category = AI_CATEGORIES.includes(raw?.category) ? raw.category : categoryFromSourceKind(sourceKind);
  const receivedAt = image.receivedAt || options.now || new Date().toISOString();
  const extracted = screenshotExtracted(category, raw?.extracted || raw || {}, sourceKind, receivedAt);
  return normalizeAnalysis({
    category,
    confidence: raw?.confidence,
    summary: raw?.summary || screenshotSummary(category, extracted),
    provider: raw?.provider || extracted.provider,
    reservationNumber: raw?.reservationNumber || extracted.reservationNumber,
    dateRange: raw?.dateRange || extracted.dateRange,
    extracted,
    issues: raw?.issues,
    warnings: raw?.warnings,
    status: raw?.status,
    sourceType: "screenshot",
    imageId,
    imageHash,
    sourceKind,
    messageId,
    threadId: imageId,
    subject: screenshotSubject(sourceKind),
    from: "",
    receivedAt,
    sourceHash: imageHash,
    model: raw?.model || options.model || "",
    schemaVersion: AI_SCHEMA_VERSION,
  }, {
    id: imageId,
    threadId: imageId,
    subject: screenshotSubject(sourceKind),
    receivedAt,
  }, { ...options, sourceHash: imageHash, sourceType: "screenshot", imageId, imageHash, sourceKind });
}

export function validateScreenshotAnalysis(analysis) {
  const normalized = analysis?.sourceType === "screenshot" && (analysis?.extracted?.items || analysis?.extracted?.name || analysis?.extracted?.note)
    ? normalizeAnalysis(analysis)
    : normalizeScreenshotAnalysis(analysis);
  const errors = [];
  if (!normalized.imageId) errors.push("imageId is required");
  if (!SCREENSHOT_SOURCE_KINDS.includes(normalized.sourceKind)) errors.push("sourceKind is invalid");
  if (!AI_CATEGORIES.includes(normalized.category)) errors.push("category is invalid");
  if (normalized.category === "flight") {
    const item = normalized.extracted.items[0] || {};
    if (!item.flightNumber || !item.startAt || !item.endAt || !item.origin || !item.destination) {
      errors.push("flight number, date, times and airports are required");
    }
  }
  if (normalized.category === "hotel" && (!normalized.extracted.name || !normalized.extracted.checkIn)) {
    errors.push("hotel name and checkIn are required");
  }
  return { ok: errors.length === 0, errors, analysis: normalized };
}

export function makeScreenshotSource({ imageHash = "", sourceKind = "unknown_screenshot", receivedAt = "" } = {}) {
  const hash = String(imageHash || "");
  const id = `image-${hash.replace(/^fnv1a-/, "")}`;
  return {
    id,
    messageId: id,
    threadId: id,
    subject: screenshotSubject(sourceKind),
    from: "",
    receivedAt: normalizeIso(receivedAt) || new Date().toISOString(),
    url: "",
    sourceType: "screenshot",
    imageId: id,
    imageHash: hash,
    sourceKind,
    sourceHash: hash,
  };
}

export function makeFailedScreenshotAnalysis(image, error) {
  const source = makeScreenshotSource(image);
  return {
    ...makeFailedAnalysis(source, error, source.imageHash),
    sourceType: "screenshot",
    imageId: source.imageId,
    imageHash: source.imageHash,
    sourceKind: source.sourceKind,
    errorMessage: String(error?.message || error || "AI analysis failed"),
  };
}

export function hashBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let hash = 0x811c9dc5;
  for (let index = 0; index < view.length; index += 1) {
    hash ^= view[index];
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function excludeImportedBookings(existing = [], incoming = []) {
  const known = new Set(existing.map(bookingDuplicateKey).filter(Boolean));
  const bookings = [];
  const skipped = [];
  incoming.forEach((booking) => {
    const key = bookingDuplicateKey(booking);
    if (key && known.has(key)) {
      skipped.push(booking);
      return;
    }
    if (key) known.add(key);
    bookings.push(booking);
  });
  return { bookings, skipped };
}

export function bookingDuplicateKey(booking = {}) {
  const data = { ...(booking.parsed || {}), ...(booking.overrides || {}), ...(booking.data || {}) };
  if (booking.type === "flight") {
    const flightNumber = normalizeFlightNumber(data.flightNumber || "");
    const startAt = normalizeIso(data.startAt);
    if (!flightNumber || !startAt) return "";
    return ["flight", flightNumber, startAt].join("|");
  }
  if (booking.type === "hotel") {
    const reservationNumber = normalizeIdentityText(data.reservationNumber);
    if (reservationNumber) return `hotel|reservation|${reservationNumber}`;
    const name = normalizeIdentityText(data.name);
    const checkIn = normalizeIso(data.checkIn);
    const checkOut = normalizeIso(data.checkOut);
    if (!name || !checkIn) return "";
    return ["hotel", name, checkIn, checkOut].join("|");
  }
  return "";
}

export function bookingHasRequiredFields(booking = {}) {
  const data = { ...(booking.parsed || {}), ...(booking.overrides || {}), ...(booking.data || {}) };
  if (booking.type === "flight") {
    return Boolean(data.flightNumber && data.startAt && data.endAt && data.origin && data.destination);
  }
  if (booking.type === "hotel") return Boolean(data.name && data.checkIn);
  return false;
}

export function makeFailedAnalysis(message, error, sourceHash = "") {
  const source = sourceFromMessage(message);
  return normalizeAnalysis({
    ...source,
    category: "trip_related_unknown",
    confidence: 0,
    status: "failed",
    summary: "AI解析に失敗しました",
    issues: [String(error?.message || error || "AI analysis failed")],
    extracted: {},
    sourceHash,
  }, message);
}

export function makeManualMessage({ subject = "", from = "", receivedAt = "", body = "" } = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const normalizedBody = String(body || "").trim();
  const normalizedReceivedAt = normalizeIso(receivedAt) || now;
  const sourceHash = hashText([
    subject,
    from,
    normalizedReceivedAt,
    normalizedBody,
  ].join("\n"));
  const id = `manual-${sourceHash.replace(/^fnv1a-/, "")}`;
  return {
    id,
    messageId: id,
    threadId: id,
    subject: String(subject || "").trim() || "貼り付けメール",
    from: String(from || "").trim(),
    receivedAt: normalizedReceivedAt,
    url: "",
    body: normalizedBody,
    sourceHash,
  };
}

export function makeFailedManualAnalysis(message, error, sourceHash = message?.sourceHash || "") {
  return {
    ...makeFailedAnalysis(message, error, sourceHash),
    rawBody: String(message?.body || ""),
    errorMessage: String(error?.message || error || "AI analysis failed"),
  };
}

export async function hashMessageSource(message) {
  const value = [
    message?.id || "",
    message?.threadId || "",
    message?.subject || "",
    message?.from || "",
    message?.receivedAt || "",
    message?.body || "",
  ].join("\n");
  return hashText(value);
}

export function hashText(value) {
  return `fnv1a-${fnv1a(String(value || ""))}`;
}

function flightBookings(analysis) {
  const extracted = { ...analysis.extracted, ...analysis.overrides };
  const items = extracted.items?.length ? extracted.items : [extracted];
  return items.map((item, index) => {
    const flight = { ...item };
    const reservationNumber = String(flight.reservationNumber || extracted.reservationNumber || analysis.reservationNumber || "");
    const flightNumber = normalizeFlightNumber(flight.flightNumber || extracted.flightNumber || "");
    const startAt = normalizeIso(flight.startAt || extracted.startAt);
    const dedupeKey = analysis.sourceType === "screenshot"
      ? slug(flight.dedupeKey || extracted.dedupeKey || [analysis.provider || extracted.provider, flightNumber, startAt, flight.origin || extracted.origin, flight.destination || extracted.destination].join("-"))
      : slug(reservationNumber || analysis.messageId);
    return {
      id: `ai-flight-${dedupeKey}-${dateKey(startAt || analysis.receivedAt)}-${slug(flightNumber || index)}`,
      type: "flight",
      provider: analysis.provider || extracted.provider || "AI",
      status: normalizeBookingStatus(flight.status || extracted.status),
      source: [sourceFromAnalysis(analysis)],
      parsed: removeEmpty({
        reservationNumber,
        flightNumber,
        startAt,
        endAt: normalizeIso(flight.endAt || extracted.endAt),
        origin: String(flight.origin || extracted.origin || ""),
        destination: String(flight.destination || extracted.destination || ""),
        seat: String(flight.seat || extracted.seat || ""),
        bookingLink: String(flight.bookingLink || extracted.bookingLink || ""),
      }),
      overrides: {},
      hidden: false,
      ai: { messageId: analysis.messageId, confidence: analysis.confidence, status: analysis.status },
      screenshot: analysis.sourceType === "screenshot" ? { imageId: analysis.imageId, imageHash: analysis.imageHash, sourceKind: analysis.sourceKind } : undefined,
      updatedAt: analysis.updatedAt,
    };
  });
}

function hotelBooking(analysis) {
  const data = { ...analysis.extracted, ...analysis.overrides };
  const reservationNumber = String(data.reservationNumber || analysis.reservationNumber || "");
  const dedupeKey = analysis.sourceType === "screenshot"
    ? slug(data.dedupeKey || reservationNumber || [data.name, data.checkIn, data.checkOut].join("-"))
    : slug(reservationNumber || analysis.messageId);
  return [{
    id: `ai-hotel-${dedupeKey}`,
    type: "hotel",
    provider: analysis.provider || data.provider || "AI",
    status: normalizeBookingStatus(data.status),
    source: [sourceFromAnalysis(analysis)],
    parsed: removeEmpty({
      reservationNumber,
      name: String(data.name || ""),
      address: String(data.address || ""),
      phone: String(data.phone || ""),
      checkIn: normalizeIso(data.checkIn),
      checkOut: normalizeIso(data.checkOut),
      roomType: String(data.roomType || ""),
      plan: String(data.plan || ""),
      amount: numberOrEmpty(data.amount),
      breakfast: typeof data.breakfast === "boolean" ? data.breakfast : "",
      managementLink: String(data.managementLink || data.bookingLink || ""),
    }),
    overrides: {},
    hidden: false,
    ai: { messageId: analysis.messageId, confidence: analysis.confidence, status: analysis.status },
    screenshot: analysis.sourceType === "screenshot" ? { imageId: analysis.imageId, imageHash: analysis.imageHash, sourceKind: analysis.sourceKind } : undefined,
    updatedAt: analysis.updatedAt,
  }];
}

function normalizeExtracted(category, value) {
  const input = value && typeof value === "object" ? value : {};
  if (category === "flight") {
    return {
      provider: String(input.provider || ""),
      reservationNumber: String(input.reservationNumber || ""),
      status: normalizeBookingStatus(input.status),
      items: Array.isArray(input.items) ? input.items.map(normalizeFlightItem) : [],
    };
  }
  if (category === "hotel") {
    return {
      provider: String(input.provider || ""),
      reservationNumber: String(input.reservationNumber || ""),
      status: normalizeBookingStatus(input.status),
      name: String(input.name || ""),
      address: String(input.address || ""),
      phone: String(input.phone || ""),
      checkIn: normalizeIso(input.checkIn),
      checkOut: normalizeIso(input.checkOut),
      roomType: String(input.roomType || ""),
      plan: String(input.plan || ""),
      amount: numberOrEmpty(input.amount),
      breakfast: typeof input.breakfast === "boolean" ? input.breakfast : false,
      managementLink: String(input.managementLink || input.bookingLink || ""),
    };
  }
  return {
    provider: String(input.provider || ""),
    reservationNumber: String(input.reservationNumber || ""),
    note: String(input.note || input.summary || ""),
  };
}

function screenshotExtracted(category, value, sourceKind, referenceDate = "") {
  const input = value && typeof value === "object" ? value : {};
  if (category === "flight") {
    const airline = String(input.airline || input.provider || (sourceKind === "flight_screenshot" ? "JAL" : ""));
    const flightNumber = normalizeFlightNumber(input.flightNumber || "");
    const departureDate = String(input.departureDate || "");
    const departureTime = String(input.departureTime || "");
    const arrivalTime = String(input.arrivalTime || "");
    const origin = String(input.departureAirport || input.origin || "");
    const destination = String(input.arrivalAirport || input.destination || "");
    const startAt = combineScreenshotDateTime(departureDate, departureTime, "", referenceDate);
    const parsedEndAt = arrivalTime
      ? combineScreenshotDateTime(departureDate, arrivalTime, startAt, referenceDate)
      : "";
    const durationMinutes = numberOrEmpty(input.durationMinutes);
    const endAt = parsedEndAt || addMinutes(startAt, durationMinutes);
    const dedupeKey = [airline, flightNumber, departureDate, departureTime, origin, destination].join("|");
    return {
      provider: airline,
      reservationNumber: String(input.reservationNumber || ""),
      status: normalizeBookingStatus(input.status),
      dateRange: { startAt, endAt },
      dedupeKey,
      items: [{
        flightNumber,
        origin,
        destination,
        startAt,
        endAt,
        seat: String(input.seat || ""),
        bookingLink: "",
        status: normalizeBookingStatus(input.status),
        reservationNumber: String(input.reservationNumber || ""),
        durationMinutes,
        dedupeKey,
      }],
    };
  }
  if (category === "hotel") {
    const name = String(input.hotelName || input.name || "");
    const checkIn = combineScreenshotDateTime(input.checkInDate || input.checkIn || "", input.checkInTime || "", "", referenceDate);
    const checkOut = combineScreenshotDateTime(input.checkOutDate || input.checkOut || "", "", "", referenceDate);
    const reservationNumber = String(input.reservationNumber || "");
    return {
      provider: String(input.provider || (sourceKind === "hotel_screenshot" ? "楽天トラベル" : "")),
      reservationNumber,
      status: normalizeBookingStatus(input.status),
      name,
      address: String(input.address || ""),
      phone: String(input.phone || ""),
      checkIn,
      checkOut,
      roomType: String(input.roomType || ""),
      plan: String(input.planName || input.plan || ""),
      amount: numberOrEmpty(input.amount),
      breakfast: typeof input.breakfast === "boolean" ? input.breakfast : false,
      managementLink: "",
      guestName: String(input.guestName || ""),
      nights: numberOrEmpty(input.nights),
      dedupeKey: reservationNumber || [name, input.checkInDate || input.checkIn || "", input.checkOutDate || input.checkOut || ""].join("|"),
      dateRange: { startAt: checkIn, endAt: checkOut },
    };
  }
  return {
    provider: String(input.provider || ""),
    reservationNumber: String(input.reservationNumber || ""),
    note: String(input.note || input.summary || ""),
  };
}

function normalizeIdentityText(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, "").replace(/[（(]/g, "(").replace(/[）)]/g, ")");
}

function normalizeFlightItem(item) {
  const input = item && typeof item === "object" ? item : {};
  return {
    flightNumber: normalizeFlightNumber(input.flightNumber || ""),
    origin: String(input.origin || ""),
    destination: String(input.destination || ""),
    startAt: normalizeIso(input.startAt),
    endAt: normalizeIso(input.endAt),
    seat: String(input.seat || ""),
    bookingLink: String(input.bookingLink || ""),
    status: normalizeBookingStatus(input.status),
  };
}

function validationIssues(category, confidence, extracted) {
  const issues = [];
  if (confidence < LOW_CONFIDENCE_THRESHOLD) issues.push("confidenceが低いため確認してください");
  if (category === "flight") {
    if (!extracted.items.length) issues.push("航空券の便情報がありません");
    extracted.items.forEach((item) => {
      if (!item.flightNumber || !item.startAt || !item.origin || !item.destination) {
        issues.push("航空券の必須項目が不足しています");
      }
    });
  }
  if (category === "hotel") {
    if (!extracted.name || !extracted.checkIn) issues.push("ホテル名またはチェックインが不足しています");
  }
  return issues;
}

function categoryFromSourceKind(sourceKind) {
  if (sourceKind === "flight_screenshot") return "flight";
  if (sourceKind === "hotel_screenshot") return "hotel";
  return "trip_related_unknown";
}

function screenshotSubject(sourceKind) {
  if (sourceKind === "flight_screenshot") return "JAL航空券スクリーンショット";
  if (sourceKind === "hotel_screenshot") return "楽天ホテルスクリーンショット";
  return "予約スクリーンショット";
}

function screenshotSummary(category, extracted) {
  if (category === "flight") {
    const item = extracted.items?.[0] || {};
    return [item.flightNumber, item.origin && item.destination ? `${item.origin} → ${item.destination}` : ""].filter(Boolean).join(" ");
  }
  if (category === "hotel") return extracted.name || "ホテルスクリーンショット";
  return extracted.note || "スクリーンショット解析結果";
}

function combineScreenshotDateTime(dateValue, timeValue, referenceStart = "", referenceDate = "") {
  const dateText = String(dateValue || "").trim();
  if (!dateText) return "";
  if (/T\d{2}:\d{2}/.test(dateText)) return normalizeIso(dateText);
  const normalizedDate = normalizeScreenshotDate(dateText, referenceDate);
  if (!normalizedDate) return "";
  const timeText = String(timeValue || "").trim();
  const normalizedTime = /^\d{1,2}:\d{2}/.test(timeText) ? timeText.match(/\d{1,2}:\d{2}/)[0] : "00:00";
  const iso = normalizeIso(`${normalizedDate}T${normalizedTime}:00+09:00`);
  if (!iso || !referenceStart || !timeText) return iso;
  const start = new Date(referenceStart);
  const end = new Date(iso);
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
    end.setUTCDate(end.getUTCDate() + 1);
    return end.toISOString();
  }
  return iso;
}

function normalizeScreenshotDate(value, referenceDate = "") {
  const text = String(value || "")
    .trim()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/,/g, "");
  const full = text.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/);
  if (full) return dateParts(Number(full[1]), Number(full[2]), Number(full[3]));
  const numeric = text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (numeric) return dateParts(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  const partial = text.match(/(\d{1,2})\s*[月./-]\s*(\d{1,2})/);
  if (!partial) return "";
  const month = Number(partial[1]);
  const day = Number(partial[2]);
  const base = new Date(referenceDate || Date.now());
  if (Number.isNaN(base.getTime())) return "";
  let year = base.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const difference = candidate.getTime() - base.getTime();
  if (difference < -120 * 86400000) year += 1;
  if (difference > 300 * 86400000) year -= 1;
  return dateParts(year, month, day);
}

function dateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addMinutes(value, minutes) {
  if (!value || !Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCMinutes(date.getUTCMinutes() + Number(minutes));
  return date.toISOString();
}

function normalizeStatus(status, category, confidence, issues) {
  if (status === "failed") return "failed";
  if (category === "irrelevant") return "irrelevant";
  if (status === "approved") return "approved";
  if (confidence < LOW_CONFIDENCE_THRESHOLD || issues.length || category === "trip_related_unknown") return "needs_review";
  return "cached";
}

function sourceFromMessage(message) {
  return {
    messageId: String(message?.id || message?.messageId || ""),
    threadId: String(message?.threadId || ""),
    subject: String(message?.subject || ""),
    from: String(message?.from || ""),
    receivedAt: normalizeIso(message?.receivedAt) || "",
    url: String(message?.url || ""),
  };
}

function sourceFromAnalysis(analysis) {
  return {
    messageId: analysis.messageId,
    threadId: analysis.threadId,
    subject: analysis.subject,
    from: analysis.from,
    receivedAt: analysis.receivedAt,
    url: analysis.url,
  };
}

function normalizeDateRange(value) {
  const input = value && typeof value === "object" ? value : {};
  return { startAt: normalizeIso(input.startAt), endAt: normalizeIso(input.endAt) };
}

function normalizeIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeBookingStatus(value) {
  return String(value || "").toLowerCase() === "cancelled" ? "cancelled" : "confirmed";
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function numberOrEmpty(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function removeEmpty(object = {}) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

function normalizeFlightNumber(value = "") {
  return String(value).toUpperCase().replace(/\s+/g, "");
}

function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function dateKey(value) {
  return value ? value.slice(0, 10) : "unknown-date";
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
