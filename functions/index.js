import { initializeApp } from "firebase-admin/app";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const MODEL = "gemini-2.5-flash-lite";
const CATEGORIES = ["flight", "hotel", "trip_related_unknown", "irrelevant"];
const LOW_CONFIDENCE = 0.75;

export const classifyTripEmail = onCall({
  region: "asia-northeast1",
  secrets: [GEMINI_API_KEY],
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Firebase login is required.");
  }
  const { message, body, sourceHash } = request.data || {};
  if (!message?.id || !body || typeof body !== "string") {
    throw new HttpsError("invalid-argument", "message.id and body are required.");
  }
  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "GEMINI_API_KEY secret is not configured.");
  }

  const raw = await callGemini(apiKey, message, body);
  const analysis = normalizeAnalysis(raw, message, { sourceHash, model: MODEL });
  return { analysis, model: MODEL };
});

async function callGemini(apiKey, message, body) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: responseSchema(),
      },
      contents: [{
        role: "user",
        parts: [{ text: promptFor(message, body) }],
      }],
    }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new HttpsError("internal", `Gemini API error ${response.status}: ${details.slice(0, 300)}`);
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text) throw new HttpsError("internal", "Gemini returned an empty response.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpsError("internal", "Gemini returned invalid JSON.");
  }
}

function promptFor(message, body) {
  return `You classify Japanese business travel reservation emails for a private PWA.
Return only one strict JSON object. Do not include markdown.

Categories:
- flight: airline reservation, boarding, delay, seat change, cancellation, itinerary
- hotel: hotel reservation, confirmation, cancellation
- trip_related_unknown: travel related but not enough evidence for flight or hotel
- irrelevant: not related to business travel reservations

Rules:
- Use ISO 8601 strings with timezone when dates/times are present. Assume Asia/Tokyo for Japanese domestic reservations when timezone is omitted.
- Do not invent missing values. Use empty strings, false, empty arrays, or null-like absence.
- confidence must be 0..1.
- For flight, use extracted.items for one or more flight segments.
- For hotel, put hotel fields directly under extracted.
- status inside extracted is confirmed or cancelled.

Required JSON shape:
{
  "category": "flight|hotel|trip_related_unknown|irrelevant",
  "confidence": 0.0,
  "summary": "short Japanese summary",
  "provider": "JAL|楽天トラベル|...",
  "reservationNumber": "",
  "dateRange": { "startAt": "", "endAt": "" },
  "extracted": {
    "provider": "",
    "reservationNumber": "",
    "status": "confirmed",
    "items": [
      { "flightNumber": "", "origin": "", "destination": "", "startAt": "", "endAt": "", "seat": "", "bookingLink": "", "status": "confirmed" }
    ],
    "name": "",
    "address": "",
    "phone": "",
    "checkIn": "",
    "checkOut": "",
    "roomType": "",
    "plan": "",
    "amount": "",
    "breakfast": false,
    "managementLink": ""
  },
  "warnings": []
}

Message metadata:
From: ${message.from || ""}
Subject: ${message.subject || ""}
ReceivedAt: ${message.receivedAt || ""}

Email body:
${body.slice(0, 24000)}`;
}

function responseSchema() {
  return {
    type: "object",
    required: ["category", "confidence", "summary", "provider", "reservationNumber", "dateRange", "extracted", "warnings"],
    properties: {
      category: { type: "string", enum: CATEGORIES },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string" },
      provider: { type: "string" },
      reservationNumber: { type: "string" },
      dateRange: {
        type: "object",
        properties: {
          startAt: { type: "string" },
          endAt: { type: "string" },
        },
      },
      extracted: {
        type: "object",
        properties: {
          provider: { type: "string" },
          reservationNumber: { type: "string" },
          status: { type: "string", enum: ["confirmed", "cancelled"] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                flightNumber: { type: "string" },
                origin: { type: "string" },
                destination: { type: "string" },
                startAt: { type: "string" },
                endAt: { type: "string" },
                seat: { type: "string" },
                bookingLink: { type: "string" },
                status: { type: "string", enum: ["confirmed", "cancelled"] },
              },
            },
          },
          name: { type: "string" },
          address: { type: "string" },
          phone: { type: "string" },
          checkIn: { type: "string" },
          checkOut: { type: "string" },
          roomType: { type: "string" },
          plan: { type: "string" },
          amount: { type: "string" },
          breakfast: { type: "boolean" },
          managementLink: { type: "string" },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
}

function normalizeAnalysis(raw, message, options = {}) {
  const now = new Date().toISOString();
  const input = raw && typeof raw === "object" ? raw : {};
  const category = CATEGORIES.includes(input.category) ? input.category : "trip_related_unknown";
  const confidence = clamp(Number(input.confidence));
  const extracted = normalizeExtracted(category, input.extracted || {});
  const issues = [...strings(input.issues), ...strings(input.warnings), ...validationIssues(category, confidence, extracted)];
  const status = category === "irrelevant"
    ? "irrelevant"
    : confidence < LOW_CONFIDENCE || issues.length || category === "trip_related_unknown" ? "needs_review" : "cached";
  return {
    messageId: String(message.id),
    threadId: String(message.threadId || ""),
    subject: String(message.subject || ""),
    from: String(message.from || ""),
    receivedAt: iso(message.receivedAt) || now,
    url: String(message.url || ""),
    category,
    confidence,
    status,
    summary: String(input.summary || ""),
    provider: String(input.provider || extracted.provider || ""),
    reservationNumber: String(input.reservationNumber || extracted.reservationNumber || ""),
    dateRange: normalizeDateRange(input.dateRange),
    extracted,
    issues: [...new Set(issues.filter(Boolean))],
    model: options.model || MODEL,
    schemaVersion: 1,
    sourceHash: String(options.sourceHash || ""),
    createdAt: now,
    updatedAt: now,
    userReviewedAt: "",
    overrides: {},
  };
}

function normalizeExtracted(category, input) {
  const value = input && typeof input === "object" ? input : {};
  if (category === "flight") {
    return {
      provider: String(value.provider || ""),
      reservationNumber: String(value.reservationNumber || ""),
      status: bookingStatus(value.status),
      items: Array.isArray(value.items) ? value.items.map((item) => ({
        flightNumber: String(item?.flightNumber || "").toUpperCase().replace(/\s+/g, ""),
        origin: String(item?.origin || ""),
        destination: String(item?.destination || ""),
        startAt: iso(item?.startAt),
        endAt: iso(item?.endAt),
        seat: String(item?.seat || ""),
        bookingLink: String(item?.bookingLink || ""),
        status: bookingStatus(item?.status || value.status),
      })) : [],
    };
  }
  if (category === "hotel") {
    return {
      provider: String(value.provider || ""),
      reservationNumber: String(value.reservationNumber || ""),
      status: bookingStatus(value.status),
      name: String(value.name || ""),
      address: String(value.address || ""),
      phone: String(value.phone || ""),
      checkIn: iso(value.checkIn),
      checkOut: iso(value.checkOut),
      roomType: String(value.roomType || ""),
      plan: String(value.plan || ""),
      amount: value.amount === "" ? "" : Number(value.amount) || "",
      breakfast: Boolean(value.breakfast),
      managementLink: String(value.managementLink || ""),
    };
  }
  return {
    provider: String(value.provider || ""),
    reservationNumber: String(value.reservationNumber || ""),
    note: String(value.note || ""),
  };
}

function validationIssues(category, confidence, extracted) {
  const issues = [];
  if (confidence < LOW_CONFIDENCE) issues.push("confidenceが低いため確認してください");
  if (category === "flight" && !extracted.items.length) issues.push("航空券の便情報がありません");
  if (category === "hotel" && (!extracted.name || !extracted.checkIn)) issues.push("ホテル名またはチェックインが不足しています");
  return issues;
}

function normalizeDateRange(value) {
  return { startAt: iso(value?.startAt), endAt: iso(value?.endAt) };
}

function bookingStatus(value) {
  return String(value || "").toLowerCase() === "cancelled" ? "cancelled" : "confirmed";
}

function iso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function clamp(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function strings(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}
