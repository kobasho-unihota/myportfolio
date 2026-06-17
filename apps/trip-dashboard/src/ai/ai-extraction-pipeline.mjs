import { buildExtractionRecord, cacheIsFresh, createLocalStorageExtractionCache, defaultVersions } from "./extraction-cache.mjs";
import { validateAIExtraction } from "./extraction-schema.mjs";
import { mockAIExtractTravelEmail } from "./mock-ai-extractor.mjs";
import { prepareMessageForAI } from "./message-preparer.mjs";

export async function extractMessagesWithAI(messages, options = {}) {
  const cache = options.cache || createLocalStorageExtractionCache();
  const extractor = options.extractor || mockAIExtractTravelEmail;
  const versions = options.versions || defaultVersions();
  const records = [];
  const diagnostics = { total: messages.length, cacheHits: 0, aiRequests: 0, invalid: 0, failed: 0 };
  for (const message of messages) {
    const prepared = prepareMessageForAI(message);
    const cached = await cache.get(prepared.messageId);
    if (!options.force && cacheIsFresh(cached, prepared, versions)) {
      diagnostics.cacheHits += 1;
      records.push(cached);
      continue;
    }
    diagnostics.aiRequests += 1;
    try {
      const raw = await extractor(prepared);
      const validation = validateAIExtraction(raw);
      if (!validation.valid) diagnostics.invalid += 1;
      const record = buildExtractionRecord({
        prepared,
        extraction: validation.value,
        status: validation.valid ? "succeeded" : "schema_invalid",
        validationErrors: validation.errors,
        versions,
      });
      await cache.set(record);
      records.push(record);
    } catch (error) {
      diagnostics.failed += 1;
      const record = buildExtractionRecord({
        prepared,
        extraction: null,
        status: "failed",
        validationErrors: [String(error?.message || error)],
        versions,
      });
      await cache.set(record);
      records.push(record);
    }
  }
  return { records, diagnostics };
}
