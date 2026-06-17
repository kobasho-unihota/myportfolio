export const MAX_AI_BODY_CHARS = 12000;

export function prepareMessageForAI(message) {
  const bodyText = compactBody(message.bodyVariants?.combined || message.body || "").slice(0, MAX_AI_BODY_CHARS);
  return {
    messageId: String(message.id || message.messageId || ""),
    threadId: String(message.threadId || ""),
    from: String(message.from || ""),
    subject: String(message.subject || ""),
    receivedAt: String(message.receivedAt || ""),
    gmailUrl: String(message.url || ""),
    bodyText,
    bodyFingerprint: fingerprint([message.subject || "", message.from || "", bodyText].join("\n")),
  };
}

export function compactBody(value = "") {
  return String(value)
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fingerprint(value = "") {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return `djb2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
