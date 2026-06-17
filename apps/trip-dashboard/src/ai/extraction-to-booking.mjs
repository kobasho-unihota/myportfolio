export function extractionRecordsToTripBoardItems(records) {
  const bookings = [];
  const reviewItems = [];
  const irrelevant = [];
  for (const record of records) {
    const extraction = record.extraction;
    if (record.status !== "succeeded" || !extraction) {
      reviewItems.push(reviewItemFromRecord(record, "AI抽出に失敗しました"));
      continue;
    }
    if (extraction.category === "flight") bookings.push(flightBookingFromRecord(record));
    else if (extraction.category === "hotel") bookings.push(hotelBookingFromRecord(record));
    else if (extraction.category === "trip_related_unknown") reviewItems.push(reviewItemFromRecord(record, extraction.summary));
    else irrelevant.push(record);
  }
  return { bookings, reviewItems, irrelevant };
}

export function flightBookingFromRecord(record) {
  const flight = record.extraction.flight;
  return {
    id: `flight-ai-${record.messageId}`,
    type: "flight",
    provider: flight.airline || "AI",
    status: "confirmed",
    source: [sourceFromRecord(record)],
    parsed: {
      airline: flight.airline,
      flightNumber: flight.flightNumber,
      reservationNumber: flight.reservationNumber,
      origin: flight.departureAirport,
      destination: flight.arrivalAirport,
      startAt: toIso(flight.departureDateTime),
      endAt: toIso(flight.arrivalDateTime),
      passengerName: flight.passengerName,
      summary: record.extraction.summary,
      tripHints: record.extraction.tripHints,
      confidence: record.extraction.confidence,
    },
    overrides: {},
    hidden: false,
    review: reviewFromRecord(record),
    updatedAt: record.updatedAt,
  };
}

export function hotelBookingFromRecord(record) {
  const hotel = record.extraction.hotel;
  return {
    id: `hotel-ai-${record.messageId}`,
    type: "hotel",
    provider: "AI",
    status: "confirmed",
    source: [sourceFromRecord(record)],
    parsed: {
      name: hotel.hotelName,
      reservationNumber: hotel.reservationNumber,
      checkIn: toIsoDateStart(hotel.checkInDate),
      checkOut: toIsoDateStart(hotel.checkOutDate),
      nights: hotel.nights,
      guestName: hotel.guestName,
      address: hotel.address,
      plan: hotel.planName,
      summary: record.extraction.summary,
      tripHints: record.extraction.tripHints,
      confidence: record.extraction.confidence,
    },
    overrides: {},
    hidden: false,
    review: reviewFromRecord(record),
    updatedAt: record.updatedAt,
  };
}

export function reviewItemFromRecord(record, summary = "") {
  return {
    id: record.messageId,
    sourceMessage: record.source,
    category: record.extraction?.category || "failed",
    confidence: record.extraction?.confidence || 0,
    summary,
    warnings: record.extraction?.warnings || record.validationErrors || [],
    reviewStatus: "unreviewed",
    updatedAt: record.updatedAt,
  };
}

function sourceFromRecord(record) {
  return {
    messageId: record.messageId,
    threadId: record.threadId,
    subject: record.source.subject,
    from: record.source.from,
    receivedAt: record.source.receivedAt,
    url: record.source.gmailUrl,
  };
}
function reviewFromRecord(record) { return { required: record.review.required, reasons: record.review.reasons, warnings: record.extraction?.warnings || [] }; }
function toIso(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toISOString() : ""; }
function toIsoDateStart(value) { return value ? toIso(`${value}T00:00:00+09:00`) : ""; }
