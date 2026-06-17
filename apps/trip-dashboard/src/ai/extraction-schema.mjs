export const AI_EXTRACTION_SCHEMA_VERSION = "tripboard.aiExtraction.v1";
export const AI_EXTRACTION_PROMPT_VERSION = "2026-06-17.ai-json.v1";
export const AI_EXTRACTION_MODEL_VERSION = "mock-ai-extractor.v1";

export const CATEGORIES = ["flight", "hotel", "trip_related_unknown", "irrelevant"];
const FLIGHT_FIELDS = ["airline", "flightNumber", "departureAirport", "arrivalAirport", "departureDateTime", "arrivalDateTime", "passengerName", "reservationNumber"];
const HOTEL_FIELDS = ["hotelName", "checkInDate", "checkOutDate", "nights", "guestName", "address", "reservationNumber", "planName"];
const TRIP_HINT_FIELDS = ["city", "area", "startDate", "endDate"];
const ROOT_FIELDS = ["category", "confidence", "summary", "flight", "hotel", "tripHints", "warnings"];

export function emptyFlightExtraction() {
  return Object.fromEntries(FLIGHT_FIELDS.map((field) => [field, ""]));
}

export function emptyHotelExtraction() {
  return Object.fromEntries(HOTEL_FIELDS.map((field) => [field, field === "nights" ? null : ""]));
}

export function emptyTripHints() {
  return Object.fromEntries(TRIP_HINT_FIELDS.map((field) => [field, ""]));
}

export function createEmptyExtraction(category = "trip_related_unknown") {
  return {
    category,
    confidence: 0,
    summary: "",
    flight: emptyFlightExtraction(),
    hotel: emptyHotelExtraction(),
    tripHints: emptyTripHints(),
    warnings: [],
  };
}

export function validateAIExtraction(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ["root must be an object"], value: null };
  }
  rejectUnknownKeys(value, ROOT_FIELDS, "root", errors);
  if (!CATEGORIES.includes(value.category)) errors.push("category must be one of flight, hotel, trip_related_unknown, irrelevant");
  if (typeof value.confidence !== "number" || Number.isNaN(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push("confidence must be a number between 0 and 1");
  if (typeof value.summary !== "string") errors.push("summary must be a string");
  validateObjectShape(value.flight, FLIGHT_FIELDS, "flight", errors, { allowNull: false });
  validateObjectShape(value.hotel, HOTEL_FIELDS, "hotel", errors, { allowNull: false, nullableFields: ["nights"] });
  validateObjectShape(value.tripHints, TRIP_HINT_FIELDS, "tripHints", errors, { allowNull: false });
  if (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== "string")) errors.push("warnings must be an array of strings");
  if (value.category === "flight" && !hasAny(value.flight, ["flightNumber", "departureAirport", "arrivalAirport", "departureDateTime", "reservationNumber"])) {
    errors.push("flight category requires at least one flight detail");
  }
  if (value.category === "hotel" && !hasAny(value.hotel, ["hotelName", "checkInDate", "checkOutDate", "reservationNumber", "address"])) {
    errors.push("hotel category requires at least one hotel detail");
  }
  if (value.category === "irrelevant" && (hasAny(value.flight, FLIGHT_FIELDS) || hasAny(value.hotel, HOTEL_FIELDS.filter((field) => field !== "nights")))) {
    errors.push("irrelevant category must not include flight or hotel details");
  }
  return { valid: errors.length === 0, errors, value: errors.length ? null : normalizeExtraction(value) };
}

export function normalizeExtraction(value) {
  return {
    category: value.category,
    confidence: clamp(value.confidence),
    summary: String(value.summary || ""),
    flight: normalizeStringObject(value.flight, FLIGHT_FIELDS, { nights: false }),
    hotel: normalizeHotel(value.hotel),
    tripHints: normalizeStringObject(value.tripHints, TRIP_HINT_FIELDS),
    warnings: [...new Set((value.warnings || []).map(String).filter(Boolean))],
  };
}

function validateObjectShape(value, fields, path, errors, options = {}) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknownKeys(value, fields, path, errors);
  for (const field of fields) {
    if (!(field in value)) {
      errors.push(`${path}.${field} is required`);
      continue;
    }
    if (options.nullableFields?.includes(field)) {
      if (value[field] !== null && typeof value[field] !== "number") errors.push(`${path}.${field} must be a number or null`);
    } else if (typeof value[field] !== "string") {
      errors.push(`${path}.${field} must be a string`);
    }
  }
}
function rejectUnknownKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value || {})) if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
}
function hasAny(object = {}, fields) {
  return fields.some((field) => object?.[field] !== "" && object?.[field] !== null && object?.[field] !== undefined);
}
function normalizeStringObject(value = {}, fields) {
  return Object.fromEntries(fields.map((field) => [field, String(value[field] || "").trim()]));
}
function normalizeHotel(value = {}) {
  const hotel = normalizeStringObject(value, HOTEL_FIELDS.filter((field) => field !== "nights"));
  hotel.nights = value.nights === null || value.nights === undefined ? null : Number(value.nights);
  return hotel;
}
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function clamp(value) { return Math.max(0, Math.min(1, Number(value))); }
