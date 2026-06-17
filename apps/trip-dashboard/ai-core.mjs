export const AI_SCHEMA_VERSION = 1;
export const LOW_CONFIDENCE_THRESHOLD = 0.75;
export const AI_CATEGORIES = ["flight", "hotel", "trip_related_unknown", "irrelevant"];

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
    return {
      id: `ai-flight-${slug(reservationNumber || analysis.messageId)}-${dateKey(startAt || analysis.receivedAt)}-${slug(flightNumber || index)}`,
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
      updatedAt: analysis.updatedAt,
    };
  });
}

function hotelBooking(analysis) {
  const data = { ...analysis.extracted, ...analysis.overrides };
  const reservationNumber = String(data.reservationNumber || analysis.reservationNumber || "");
  return [{
    id: `ai-hotel-${slug(reservationNumber || analysis.messageId)}`,
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
