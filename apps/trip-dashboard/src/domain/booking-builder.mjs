import { removeEmpty, slug } from "./text.mjs";

export function sourceFromMessage(message) {
  return {
    messageId: String(message.id || ""),
    threadId: String(message.threadId || ""),
    subject: String(message.subject || ""),
    from: String(message.from || ""),
    receivedAt: message.receivedAt || new Date().toISOString(),
    url: message.url || "",
  };
}

export function bookingFromParseResult(result) {
  if (result.status !== "parsed") return null;
  const source = result.source;
  const common = {
    provider: result.provider,
    status: result.extracted.status || "confirmed",
    source: [source],
    parsed: removeEmpty(result.extracted),
    overrides: {},
    hidden: false,
    review: { required: result.confidence < 0.8, reasons: result.issues.map((issue) => issue.code) },
    updatedAt: source.receivedAt,
  };
  if (result.extractedType === "hotel") {
    return { id: `${result.providerKey}-${slug(result.extracted.reservationNumber)}`, type: "hotel", ...common };
  }
  if (result.extractedType === "flight") {
    return { id: `${result.providerKey}-${slug(result.extracted.reservationNumber || "unknown")}-${result.extracted.flightDate}-${slug(result.extracted.flightNumber)}`, type: "flight", ...common };
  }
  return null;
}

export function unclassifiedFromResult(result) {
  return {
    id: result.source.messageId,
    sourceMessage: result.source,
    parserAttempts: [{ parserId: result.parserId, status: result.status, reason: result.reason || "", missingFields: result.issues.map((issue) => issue.field).filter(Boolean) }],
    extractedHints: result.hints || {},
    reviewStatus: "unreviewed",
    updatedAt: new Date().toISOString(),
  };
}
