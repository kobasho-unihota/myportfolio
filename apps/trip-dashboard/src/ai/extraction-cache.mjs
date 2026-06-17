import { AI_EXTRACTION_MODEL_VERSION, AI_EXTRACTION_PROMPT_VERSION, AI_EXTRACTION_SCHEMA_VERSION } from "./extraction-schema.mjs";

export function createMemoryExtractionCache(initial = []) {
  const records = new Map(initial.map((record) => [record.messageId, record]));
  return {
    async get(messageId) { return records.get(messageId) || null; },
    async set(record) { records.set(record.messageId, record); return record; },
    snapshot() { return [...records.values()]; },
  };
}

export function createLocalStorageExtractionCache(storage = globalThis.localStorage, prefix = "tripboard:aiExtraction:") {
  return {
    async get(messageId) {
      if (!storage) return null;
      const raw = storage.getItem(`${prefix}${messageId}`);
      return raw ? JSON.parse(raw) : null;
    },
    async set(record) {
      if (storage) storage.setItem(`${prefix}${record.messageId}`, JSON.stringify(record));
      return record;
    },
  };
}

export function cacheIsFresh(record, prepared, versions = defaultVersions()) {
  return Boolean(
    record &&
    record.messageId === prepared.messageId &&
    record.bodyFingerprint === prepared.bodyFingerprint &&
    record.schemaVersion === versions.schemaVersion &&
    record.promptVersion === versions.promptVersion &&
    record.modelVersion === versions.modelVersion &&
    ["succeeded", "schema_invalid", "invalid_json"].includes(record.status)
  );
}

export function buildExtractionRecord({ prepared, extraction, status = "succeeded", validationErrors = [], versions = defaultVersions() }) {
  const now = new Date().toISOString();
  return {
    id: prepared.messageId,
    messageId: prepared.messageId,
    threadId: prepared.threadId,
    source: {
      from: prepared.from,
      subject: prepared.subject,
      receivedAt: prepared.receivedAt,
      gmailUrl: prepared.gmailUrl,
    },
    bodyFingerprint: prepared.bodyFingerprint,
    schemaVersion: versions.schemaVersion,
    promptVersion: versions.promptVersion,
    modelVersion: versions.modelVersion,
    status,
    extraction,
    validationErrors,
    review: {
      required: status !== "succeeded" || !extraction || extraction.confidence < 0.8 || extraction.category === "trip_related_unknown",
      reasons: reviewReasons({ status, extraction, validationErrors }),
    },
    extractedAt: now,
    updatedAt: now,
  };
}

export function defaultVersions() {
  return {
    schemaVersion: AI_EXTRACTION_SCHEMA_VERSION,
    promptVersion: AI_EXTRACTION_PROMPT_VERSION,
    modelVersion: AI_EXTRACTION_MODEL_VERSION,
  };
}

function reviewReasons({ status, extraction, validationErrors }) {
  const reasons = [];
  if (status !== "succeeded") reasons.push(status);
  if (validationErrors?.length) reasons.push("schema_validation_failed");
  if (extraction?.confidence < 0.8) reasons.push("low_confidence");
  if (extraction?.category === "trip_related_unknown") reasons.push("trip_related_unknown");
  return [...new Set(reasons)];
}
