import { normalizeText, uniqueBy } from "../domain/text.mjs";

const KEY_VALUE = /^\s*[・■●○-]?\s*([^：:\n]{2,30}?)(?:\s*[：:]\s*|\s{2,}|\s+)(.+?)\s*$/;

export function createNormalizedDocument(message) {
  const text = normalizeText(message.body || message.bodyVariants?.combined || "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const links = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map(([, label, url]) => ({ label: label.trim(), url }));
  const keyValues = [];
  let section = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionMatch = line.match(/^■\s*(.+)$/);
    if (sectionMatch) section = sectionMatch[1].trim();
    const inline = line.match(KEY_VALUE);
    if (inline && !/^https?:/.test(inline[2])) {
      keyValues.push({ key: cleanKey(inline[1]), value: cleanValue(inline[2]), section, line: index });
      continue;
    }
    if (isLikelyKey(line) && lines[index + 1]) {
      keyValues.push({ key: cleanKey(line), value: cleanValue(lines[index + 1]), section, line: index });
    }
  }
  const dates = uniqueBy([...text.matchAll(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}(?:\([^)]*\))?(?:\s+\d{1,2}:\d{2})?/g)].map(([value]) => value), (value) => value);
  const reservationNumbers = uniqueBy([...text.matchAll(/\b[A-Z]{1,3}[A-Z0-9]{5,}\b/gi)].map(([value]) => value), (value) => value.toLowerCase());
  return { subject: message.subject || "", from: message.from || "", text, lines, keyValues, links, dates, reservationNumbers };
}

export function findValue(document, labels) {
  const normalized = labels.map(cleanKey);
  const item = document.keyValues.find(({ key }) => normalized.some((label) => key.includes(label) || label.includes(key)));
  return item?.value || "";
}

export function findLink(document, pattern) {
  return document.links.find((link) => pattern.test(`${link.label} ${link.url}`))?.url || "";
}

function isLikelyKey(line) {
  return /予約(?:受付)?番号|ホテル名|宿泊施設名|住所|宿泊施設住所|宿泊施設電話番号|チェックイン|チェックアウト|部屋タイプ|プラン名|宿泊プラン/.test(line) && line.length < 40;
}
function cleanKey(value) { return String(value).replace(/^[・■●○-]+/, "").replace(/【|】/g, "").trim(); }
function cleanValue(value) { return String(value).replace(/^【|】$/g, "").replace(/^\[/, "").replace(/\]\([^)]+\)$/, "").trim(); }
