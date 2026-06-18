import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTripScreenshotWithGemini,
  classifyTripEmailWithGemini,
  clearGeminiApiKey,
  getGeminiApiKey,
  saveGeminiApiKey,
} from "./gemini-client.mjs";

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

test("Gemini APIキーをLocalStorageへ保存・削除する", () => {
  installLocalStorage();
  assert.equal(getGeminiApiKey(), "");
  saveGeminiApiKey("  AIzaSy-test  ");
  assert.equal(getGeminiApiKey(), "AIzaSy-test");
  clearGeminiApiKey();
  assert.equal(getGeminiApiKey(), "");
});

test("Gemini APIのJSON応答を解析する", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({
              category: "irrelevant",
              confidence: 0.99,
              summary: "対象外",
              provider: "",
              reservationNumber: "",
              dateRange: { startAt: "", endAt: "" },
              extracted: {},
              warnings: [],
            }) }],
          },
        }],
      }),
    };
  };
  const result = await classifyTripEmailWithGemini({
    apiKey: "AIzaSy-test",
    message: { id: "msg-1", subject: "広告" },
    body: "セールのお知らせ",
    sourceHash: "hash-1",
  });
  assert.equal(result.analysis.category, "irrelevant");
  assert.equal(result.analysis.messageId, "msg-1");
  assert.equal(result.analysis.sourceHash, "hash-1");
});

test("Gemini画像解析はinline_dataでスクショを送る", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    const body = JSON.parse(options.body);
    const parts = body.contents[0].parts;
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.ok(parts[0].text.includes("JAL"));
    assert.ok(parts[0].text.includes("複数"));
    assert.ok(parts[0].text.includes("2026-06-18"));
    assert.ok(body.generationConfig.responseSchema.required.includes("reservations"));
    assert.equal(parts[1].inline_data.mime_type, "image/jpeg");
    assert.equal(parts[1].inline_data.data, "abc123");
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({
              sourceKind: "flight_screenshot",
              summary: "JAL予約一覧",
              reservations: [{
                category: "flight",
                confidence: 0.91,
                summary: "JAL3513",
                extracted: {
                  airline: "JAL",
                  flightNumber: "JAL3513",
                  departureDate: "2026-07-20",
                  departureTime: "11:50",
                  arrivalTime: "14:10",
                  departureAirport: "福岡",
                  arrivalAirport: "札幌",
                },
                warnings: [],
              }],
              warnings: [],
            }) }],
          },
        }],
      }),
    };
  };
  const result = await classifyTripScreenshotWithGemini({
    apiKey: "AIzaSy-test",
    image: { base64: "abc123", mimeType: "image/jpeg" },
    sourceKind: "flight_screenshot",
    imageHash: "fnv1a-12345678",
    analyzedAt: "2026-06-18T00:00:00.000Z",
  });
  assert.equal(result.analysis.sourceType, "screenshot");
  assert.equal(result.analysis.imageId, "image-12345678");
});
