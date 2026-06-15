import { mergeBookings, parseRakutenHotelDetailed } from "./core.mjs?v=10";

export function runHotelPipeline(messages) {
  const results = messages.map((message) => {
    if (!isRakutenMessage(message)) {
      return { message, booking: null, reason: "楽天メール判定外", missingFields: [] };
    }
    return { message, ...parseRakutenHotelDetailed(message) };
  });
  const parsed = results.filter((result) => result.booking).map((result) => result.booking);
  const failures = results.filter((result) => !result.booking);
  const bookings = mergeBookings([], parsed);
  const reasonCounts = Object.entries(failures.reduce((counts, result) => {
    counts[result.reason] = (counts[result.reason] || 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]);

  return {
    bookings,
    parsed,
    failures,
    diagnostics: {
      searchCount: messages.length,
      bodyCount: messages.filter(hasMessageBody).length,
      candidateCount: results.filter((result) => result.reason !== "楽天メール判定外").length,
      parsedMessageCount: parsed.length,
      bookingCount: bookings.length,
      failureCount: failures.length,
      failureReasons: reasonCounts.map(([reason, count]) => ({ reason, count })),
      failureExamples: failures.slice(0, 3).map((result) => ({
        messageId: result.message.id || "",
        subject: result.message.subject || "",
        reason: result.reason,
      })),
    },
  };
}

export function isRakutenMessage(message) {
  const from = String(message.from || message.from_ || "").toLowerCase();
  const subject = String(message.subject || "");
  return from.includes("travel.rakuten.co.jp") || subject.includes("楽天トラベル");
}

function hasMessageBody(message) {
  return [message.body, ...Object.values(message.bodyVariants || {})]
    .some((value) => String(value || "").trim());
}
