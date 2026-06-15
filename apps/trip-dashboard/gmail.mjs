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
  return {
    id: message.id,
    threadId: message.threadId,
    from: messageHeaders.from || "",
    subject: messageHeaders.subject || "",
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    body: await extractBody(message.payload, message.id, requestHeaders),
    url: `https://mail.google.com/mail/u/0/#all/${message.id}`,
  };
}

async function extractBody(payload, messageId, requestHeaders) {
  const plain = findPart(payload, "text/plain");
  const html = findPart(payload, "text/html");
  const plainText = plain ? decodeBody(await readPartBody(plain, messageId, requestHeaders), partCharset(plain)) : "";
  const htmlText = html ? htmlToText(decodeBody(await readPartBody(html, messageId, requestHeaders), partCharset(html))) : "";
  if (plainText || htmlText) return chooseBodyText(plainText, htmlText);
  return decodeBody(await readPartBody(payload, messageId, requestHeaders), partCharset(payload));
}

export function chooseBodyText(plainText, htmlText) {
  const normalizedPlain = plainText.trim();
  const normalizedHtml = htmlText.trim();
  const hasStructuredTravelDetails = /予約(?:受付)?番号|チェックイン(?:日時)?|チェックアウト|フライト詳細|便情報/.test(normalizedPlain);
  if (hasStructuredTravelDetails) return normalizedPlain;
  return normalizedHtml || normalizedPlain;
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

function findPart(part, mimeType) {
  if (!part) return null;
  if (part.mimeType === mimeType && (part.body?.data || part.body?.attachmentId)) return part;
  for (const child of part.parts || []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
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
