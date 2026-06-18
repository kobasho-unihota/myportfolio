const DAY = 86400000;

export function createImportSession({ images = [], analyses = [], homeAirport = "福岡", now = new Date().toISOString() } = {}) {
  const bookings = analysesToCandidateBookings(analyses);
  const id = `import-${stableHash(images.map((image) => image.imageHash || image.id).join("|") || now)}`;
  return {
    session: {
      id,
      status: "reviewing",
      imageIds: images.map((image) => image.imageId || image.id).filter(Boolean),
      analysisIds: analyses.map((analysis) => analysis.messageId).filter(Boolean),
      createdAt: now,
      updatedAt: now,
    },
    drafts: groupCandidateBookings(bookings, { homeAirport, importSessionId: id, now }),
  };
}

export function groupCandidateBookings(bookings = [], { homeAirport = "福岡", importSessionId = "", now = new Date().toISOString() } = {}) {
  const candidates = bookings.map(normalizeCandidate).filter((item) => Number.isFinite(item.startMs)).sort((a, b) => a.startMs - b.startMs);
  const used = new Set();
  const drafts = [];
  const outboundFlights = candidates.filter((item) => item.type === "flight" && airportMatches(item.data.origin, homeAirport));

  outboundFlights.forEach((outbound) => {
    if (used.has(outbound.id)) return;
    const returnFlight = candidates.find((item) =>
      !used.has(item.id) &&
      item.type === "flight" &&
      item.startMs >= outbound.endMs &&
      item.startMs <= outbound.startMs + 14 * DAY &&
      airportMatches(item.data.destination, homeAirport));
    const tripEnd = returnFlight?.endMs || outbound.endMs + 3 * DAY;
    const hotels = candidates.filter((item) =>
      !used.has(item.id) &&
      item.type === "hotel" &&
      item.startMs <= tripEnd &&
      item.endMs >= outbound.startMs - DAY);
    const items = [outbound, ...hotels, ...(returnFlight ? [returnFlight] : [])];
    items.forEach((item) => used.add(item.id));
    drafts.push(buildDraft(items, { homeAirport, importSessionId, now }));
  });

  candidates.filter((item) => !used.has(item.id)).forEach((candidate) => {
    const matching = drafts.find((draft) =>
      candidate.startMs <= Date.parse(draft.endAt) + DAY &&
      candidate.endMs >= Date.parse(draft.startAt) - DAY);
    if (matching) {
      matching.items.push(draftItem(candidate, matching.items.some((item) => item.role === "outbound") ? "other" : inferRole(candidate, homeAirport)));
      matching.startAt = new Date(Math.min(Date.parse(matching.startAt), candidate.startMs)).toISOString();
      matching.endAt = new Date(Math.max(Date.parse(matching.endAt), candidate.endMs)).toISOString();
      matching.issues = draftIssues(matching.items);
    } else {
      drafts.push(buildDraft([candidate], { homeAirport, importSessionId, now }));
    }
  });

  return drafts.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

export function approveTripDraft(draft, { title = "", notes = "", includedItemIds = null, now = new Date().toISOString() } = {}) {
  const include = includedItemIds ? new Set(includedItemIds) : null;
  const items = (draft.items || []).filter((item) => item.included !== false && (!include || include.has(item.id)));
  if (!items.length) throw new Error("登録する予約を1件以上選択してください。");
  const tripId = `trip-${stableHash(`${draft.id}|${now}`)}`;
  const bookings = items.map((item) => ({
    ...item.booking,
    tripId,
    tripRole: item.role,
    updatedAt: now,
  }));
  return {
    trip: {
      id: tripId,
      title: String(title || draft.title || "出張").trim() || "出張",
      destination: draft.destination || "",
      startAt: new Date(Math.min(...items.map((item) => bookingStart(item.booking)))).toISOString(),
      endAt: new Date(Math.max(...items.map((item) => bookingEnd(item.booking)))).toISOString(),
      notes: String(notes || draft.notes || "").trim(),
      status: "upcoming",
      bookingIds: bookings.map((booking) => booking.id),
      sourceImportIds: draft.importSessionId ? [draft.importSessionId] : [],
      createdAt: now,
      updatedAt: now,
    },
    bookings,
  };
}

export function draftWarnings(draft, reference = new Date()) {
  const warnings = [...(draft.issues || [])];
  if (Date.parse(draft.endAt) < reference.getTime()) warnings.push("過去の旅程です");
  if ((draft.items || []).some((item) => item.booking.status === "cancelled")) warnings.push("取消済みの予約を含みます");
  return [...new Set(warnings)];
}

export function recalculateTripDraft(draft, now = new Date().toISOString()) {
  const active = (draft.items || []).filter((item) => item.included !== false);
  if (active.length) {
    draft.startAt = new Date(Math.min(...active.map((item) => bookingStart(item.booking)))).toISOString();
    draft.endAt = new Date(Math.max(...active.map((item) => bookingEnd(item.booking)))).toISOString();
  }
  draft.issues = draftIssues(draft.items || []);
  draft.updatedAt = now;
  return draft;
}

function analysesToCandidateBookings(analyses) {
  return analyses.flatMap((analysis) => {
    const extracted = analysis.extracted || {};
    if (analysis.category === "flight") {
      return (extracted.items || []).map((item, index) => ({
        id: bookingId("flight", analysis, item, index),
        type: "flight",
        provider: analysis.provider || extracted.provider || "JAL",
        status: item.status || extracted.status || "confirmed",
        parsed: { ...item, reservationNumber: item.reservationNumber || extracted.reservationNumber || analysis.reservationNumber || "" },
        overrides: {},
        source: [sourceFromAnalysis(analysis)],
        ai: { messageId: analysis.messageId, confidence: analysis.confidence, status: analysis.status },
        screenshot: { imageId: analysis.imageId || "", imageHash: analysis.imageHash || "", sourceKind: analysis.sourceKind || "" },
        hidden: false,
        tripId: "",
        updatedAt: analysis.updatedAt || new Date().toISOString(),
      }));
    }
    if (analysis.category === "hotel") {
      return [{
        id: bookingId("hotel", analysis, extracted, 0),
        type: "hotel",
        provider: analysis.provider || extracted.provider || "ホテル",
        status: extracted.status || "confirmed",
        parsed: { ...extracted, reservationNumber: extracted.reservationNumber || analysis.reservationNumber || "" },
        overrides: {},
        source: [sourceFromAnalysis(analysis)],
        ai: { messageId: analysis.messageId, confidence: analysis.confidence, status: analysis.status },
        screenshot: { imageId: analysis.imageId || "", imageHash: analysis.imageHash || "", sourceKind: analysis.sourceKind || "" },
        hidden: false,
        tripId: "",
        updatedAt: analysis.updatedAt || new Date().toISOString(),
      }];
    }
    return [];
  });
}

function buildDraft(items, { homeAirport, importSessionId, now }) {
  const draftItems = items.map((item) => draftItem(item, inferRole(item, homeAirport)));
  const startAt = new Date(Math.min(...items.map((item) => item.startMs))).toISOString();
  const endAt = new Date(Math.max(...items.map((item) => item.endMs))).toISOString();
  const outbound = draftItems.find((item) => item.role === "outbound");
  const hotel = draftItems.find((item) => item.role === "stay");
  const destination = outbound?.booking.parsed.destination || destinationFromHotel(hotel?.booking) || "";
  return {
    id: `draft-${stableHash(items.map((item) => item.id).sort().join("|"))}`,
    importSessionId,
    title: destination ? `${shortPlace(destination)}出張` : hotel?.booking.parsed.name || "出張候補",
    destination,
    startAt,
    endAt,
    status: "pending",
    confidence: Math.min(...items.map((item) => Number(item.booking.ai?.confidence ?? 1))),
    notes: "",
    items: draftItems,
    issues: draftIssues(draftItems),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeCandidate(booking) {
  return {
    id: booking.id,
    type: booking.type,
    booking,
    data: { ...(booking.parsed || {}), ...(booking.overrides || {}) },
    startMs: bookingStart(booking),
    endMs: bookingEnd(booking),
  };
}

function draftItem(candidate, role) {
  return { id: candidate.id, role, included: true, booking: candidate.booking };
}

function inferRole(candidate, homeAirport) {
  if (candidate.type === "hotel") return "stay";
  if (airportMatches(candidate.data.origin, homeAirport)) return "outbound";
  if (airportMatches(candidate.data.destination, homeAirport)) return "inbound";
  return "other";
}

function draftIssues(items) {
  const issues = [];
  const active = items.filter((item) => item.included !== false);
  if (!active.some((item) => item.role === "outbound")) issues.push("往路便が見つかっていません");
  if (!active.some((item) => item.role === "inbound")) issues.push("復路便が見つかっていません");
  if (!active.length) return ["登録する予約が選択されていません"];
  const start = Math.min(...active.map((item) => bookingStart(item.booking)));
  const end = Math.max(...active.map((item) => bookingEnd(item.booking)));
  if (end - start > DAY && !active.some((item) => item.role === "stay")) issues.push("ホテル予約が見つかっていません");
  if (active.some((item) => item.booking.ai?.status === "needs_review")) issues.push("AI解析に要確認項目があります");
  return issues;
}

function bookingStart(booking) {
  const data = { ...(booking.parsed || {}), ...(booking.overrides || {}), ...(booking.data || {}) };
  return Date.parse(data.startAt || data.checkIn || booking.updatedAt || 0);
}

function bookingEnd(booking) {
  const data = { ...(booking.parsed || {}), ...(booking.overrides || {}), ...(booking.data || {}) };
  return Date.parse(data.endAt || data.checkOut || data.startAt || data.checkIn || booking.updatedAt || 0);
}

function airportMatches(value, homeAirport) {
  const aliases = { FUK: "福岡", HND: "羽田", CTS: "新千歳", NRT: "成田" };
  const clean = (text) => {
    const raw = String(text || "").replace(/[（）()空港/\s]/g, "");
    return aliases[raw.toUpperCase()] || raw.replace(/東京|羽田/g, "羽田").replace(/札幌|新千歳/g, "新千歳");
  };
  const a = clean(value);
  const b = clean(homeAirport);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function destinationFromHotel(booking) {
  return String(booking?.parsed?.address || "").replace(/^\s*〒?\s*\d{3}-?\d{4}\s*/, "").match(/(北海道|東京都|大阪府|京都府|.{2,3}県)/)?.[1] || "";
}

function shortPlace(value) {
  return String(value || "").replace(/[（(].*?[）)]/g, "").replace(/空港/g, "").trim();
}

function sourceFromAnalysis(analysis) {
  return { messageId: analysis.messageId || "", subject: analysis.subject || "", receivedAt: analysis.receivedAt || "", url: analysis.url || "" };
}

function bookingId(type, analysis, data, index) {
  const identity = type === "flight"
    ? `${data.flightNumber || "flight"}|${data.startAt || index}`
    : `${data.reservationNumber || data.name || "hotel"}|${data.checkIn || index}`;
  return `draft-${type}-${stableHash(`${analysis.messageId}|${identity}`)}`;
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
