import test from "node:test";
import assert from "node:assert/strict";
import {
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
