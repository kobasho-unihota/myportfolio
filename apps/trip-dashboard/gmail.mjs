export async function fetchTravelMessages(accessToken, query, onProgress = () => {}) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const ids = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, headers);
    ids.push(...(response.messages || []).map((item) => item.id));
    pageToken = response.nextPageToken || "";
    onProgress({ phase: "search", current: ids.length, total: response.resultSizeEstimate || ids.length });
  } while (pageToken && ids.length < 500);

  const messages = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = await Promise.all(ids.slice(index, index + 10).map(async (id) => {
      const data = await gmailFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        headers
      );
      return normalizeMessage(data, headers);
    }));
    messages.push(...batch);
    onProgress({ phase: "read", current: Math.min(index + 10, ids.length), total: ids.length });
  }
  return messages;
}

async function gmailFetch(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const error = new Error(details.error?.message || `Gmail API error (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function normalizeMessage(message, requestHeaders) {
  const messageHeaders = Object.fromEntries(
    (message.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value])
  );
  const bodies = await extractBodies(message.payload, message.id, requestHeaders);
  return {
    id: message.id,
    threadId: message.threadId,
    from: messageHeaders.from || "",
    subject: messageHeaders.subject || "",
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    body: bodies.selected,
    bodyVariants: {
      plain: bodies.plain,
      html: bodies.html,
      combined: bodies.combined,
    },
    url: `https://mail.google.com/mail/u/0/#all/${message.id}`,
  };
}

async function extractBodies(payload, messageId, requestHeaders) {
  const plainParts = findParts(payload, "text/plain");
  const htmlParts = findParts(payload, "text/html");
  const plain = (await Promise.all(plainParts.map(async (part) =>
    decodeBody(await readPartBody(part, messageId, requestHeaders), partCharset(part)))))
    .filter(Boolean)
    .join("\n\n");
  const html = (await Promise.all(htmlParts.map(async (part) =>
    htmlToText(decodeBody(await readPartBody(part, messageId, requestHeaders), partCharset(part))))))
    .filter(Boolean)
    .join("\n\n");
  const fallback = !plain && !html
    ? decodeBody(await readPartBody(payload, messageId, requestHeaders), partCharset(payload))
    : "";
  const normalizedPlain = normalizeBodyText(plain || fallback);
  const normalizedHtml = normalizeBodyText(html);
  return {
    plain: normalizedPlain,
    html: normalizedHtml,
    combined: uniqueBodies([normalizedPlain, normalizedHtml]).join("\n\n"),
    selected: chooseBodyText(normalizedPlain, normalizedHtml),
  };
}

export function chooseBodyText(plainText, htmlText) {
  const normalizedPlain = normalizeBodyText(plainText);
  const normalizedHtml = normalizeBodyText(htmlText);
  if (!normalizedPlain) return normalizedHtml;
  if (!normalizedHtml) return normalizedPlain;
  return bodyScore(normalizedHtml) > bodyScore(normalizedPlain) ? normalizedHtml : normalizedPlain;
}

async function readPartBody(part, messageId, headers) {
  if (part?.body?.data) return part.body.data;
  if (!part?.body?.attachmentId) return "";
  const attachmentId = encodeURIComponent(part.body.attachmentId);
  const data = await gmailFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${attachmentId}`,
    headers
  );
  return data.data || "";
}

function findParts(part, mimeType, found = []) {
  if (!part) return found;
  if (part.mimeType === mimeType && (part.body?.data || part.body?.attachmentId)) found.push(part);
  for (const child of part.parts || []) {
    findParts(child, mimeType, found);
  }
  return found;
}
function partCharset(part) {
  const contentType = (part?.headers || []).find((header) => header.name.toLowerCase() === "content-type")?.value || "";
  return contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8";
}
function decodeBody(value, charset = "utf-8") {
  if (!value) return "";
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}
export function htmlToText(html) {
  if (typeof DOMParser === "undefined") return htmlToTextFallback(html);
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  documentNode.querySelectorAll("script, style, noscript").forEach((element) => element.remove());
  documentNode.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.replaceWith(`[${anchor.textContent.trim()}](${anchor.href})`);
  });
  documentNode.querySelectorAll("br").forEach((element) => {
    element.replaceWith(documentNode.createTextNode("\n"));
  });
  documentNode.querySelectorAll("td, th, tr, p, div, li, h1, h2, h3, h4").forEach((element) => {
    element.append(documentNode.createTextNode("\n"));
  });
  return documentNode.body.textContent
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToTextFallback(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) =>
      `[${stripTags(label).trim()}](${href})`)
    .replace(/<(?:br|\/tr|\/td|\/th|\/p|\/div|\/li|\/h[1-4])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, "");
}

function normalizeBodyText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueBodies(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function bodyScore(value) {
  const text = String(value || "");
  const signals = [
    /予約(?:受付)?番号/i,
    /(?:ホテル名|宿泊施設名)/,
    /チェックイン(?:日時)?/,
    /チェックアウト(?:日)?/,
    /宿泊施設(?:住所|電話番号)/,
    /部屋タイプ/,
    /(?:差引支払額|総合計)/,
    /フライト詳細|便情報/,
    /\bJAL\d{2,4}\b/i,
    /(?:→|発[\s\S]{0,30}着)/,
  ];
  return signals.reduce((score, pattern) => score + (pattern.test(text) ? 10 : 0), 0) +
    Math.min(9, Math.floor(text.length / 1000));
}
