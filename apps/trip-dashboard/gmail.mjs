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
      return normalizeMessage(data);
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

function normalizeMessage(message) {
  const headers = Object.fromEntries(
    (message.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value])
  );
  return {
    id: message.id,
    threadId: message.threadId,
    from: headers.from || "",
    subject: headers.subject || "",
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    body: extractBody(message.payload),
    url: `https://mail.google.com/mail/u/0/#all/${message.id}`,
  };
}

function extractBody(payload) {
  const plain = findPart(payload, "text/plain");
  const html = findPart(payload, "text/html");
  if (plain) return decodeBody(plain.body?.data || "", partCharset(plain));
  if (html) return htmlToText(decodeBody(html.body?.data || "", partCharset(html)));
  return decodeBody(payload?.body?.data || "", partCharset(payload));
}
function findPart(part, mimeType) {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part;
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
function htmlToText(html) {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  documentNode.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.replaceWith(`[${anchor.textContent.trim()}](${anchor.href})`);
  });
  return documentNode.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
}
