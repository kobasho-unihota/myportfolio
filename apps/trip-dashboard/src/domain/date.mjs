export function normalizeDateTime(value) {
  if (!value) return "";
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime()) && /T|Z|[+-]\d{2}:?\d{2}$/.test(String(value))) return direct.toISOString();
  const text = String(value).replace(/[【】]/g, "").replace(/\([^)]*\)/g, "").trim().replace(/\//g, "-");
  const hasTime = /\d{1,2}:\d{2}/.test(text);
  const parsed = new Date(`${text}${hasTime ? "" : " 00:00"} GMT+0900`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function parseJapaneseDate(value, reference) {
  if (!value) return "";
  const parts = String(value).match(/(?:(20\d{2})年)?\s*(\d{1,2})月(\d{1,2})日/);
  if (!parts) return "";
  let year = Number(parts[1] || new Date(reference).getUTCFullYear());
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const ref = new Date(reference);
  if (!parts[1] && month < ref.getUTCMonth() - 5) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function combineDateTime(date, time, nextDay = false) {
  if (!date) return "";
  const parsed = new Date(`${date}T${time || "00:00"}:00+09:00`);
  if (nextDay) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

export function tokyoDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
