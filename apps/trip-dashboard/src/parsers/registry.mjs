import { bookingFromParseResult, unclassifiedFromResult } from "../domain/booking-builder.mjs";
import { jalDomesticParser } from "./jal-domestic.mjs";
import { rakutenTravelHotelParser } from "./rakuten-travel-hotel.mjs";

export const parserRegistry = [rakutenTravelHotelParser, jalDomesticParser];

export function parseMessages(messages, parsers = parserRegistry) {
  const results = [];
  const bookings = [];
  const unclassified = [];
  for (const message of messages) {
    const matched = parsers.filter((parser) => parser.match(message));
    if (!matched.length) {
      unclassified.push({ id: message.id, sourceMessage: { messageId: message.id, subject: message.subject || "", from: message.from || "", receivedAt: message.receivedAt || "" }, parserAttempts: [], extractedHints: {}, reviewStatus: "unreviewed", updatedAt: new Date().toISOString() });
      continue;
    }
    for (const parser of matched) {
      const parsed = parser.parse(message);
      for (const result of Array.isArray(parsed) ? parsed : [parsed]) {
        results.push(result);
        const booking = bookingFromParseResult(result);
        if (booking) bookings.push(booking);
        else unclassified.push(unclassifiedFromResult(result));
      }
    }
  }
  return { results, bookings, unclassified };
}
