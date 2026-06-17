const AIRPORTS = {
  "福岡": { label: "福岡", prefecture: "福岡県", city: "福岡市" },
  "福岡空港": { label: "福岡", prefecture: "福岡県", city: "福岡市" },
  "札幌/新千歳": { label: "札幌（新千歳）", prefecture: "北海道", city: "千歳市" },
  "札幌(新千歳)": { label: "札幌（新千歳）", prefecture: "北海道", city: "千歳市" },
  "札幌（新千歳）": { label: "札幌（新千歳）", prefecture: "北海道", city: "千歳市" },
  "新千歳": { label: "札幌（新千歳）", prefecture: "北海道", city: "千歳市" },
  "東京/羽田": { label: "東京（羽田）", prefecture: "東京都", city: "大田区" },
  "東京(羽田)": { label: "東京（羽田）", prefecture: "東京都", city: "大田区" },
  "東京（羽田）": { label: "東京（羽田）", prefecture: "東京都", city: "大田区" },
  "羽田": { label: "東京（羽田）", prefecture: "東京都", city: "大田区" },
};

export function normalizeAirport(value = "") {
  const cleaned = String(value).trim().replace(/^(変更前|変更後)\s*/, "");
  return AIRPORTS[cleaned]?.label || cleaned;
}

export function locationFromAirport(value = "") {
  const label = normalizeAirport(value);
  return AIRPORTS[label] || AIRPORTS[String(value).trim()] || { label, prefecture: "", city: "" };
}

export function parseJapaneseAddress(address = "") {
  const text = String(address).replace(/^〒[\d-]+\s*/, "").trim();
  const match = text.match(/^(北海道|東京都|京都府|大阪府|.{2,3}県)([^\s]*)?/);
  return { label: match ? `${match[1]}${match[2] || ""}` : text, prefecture: match?.[1] || "", city: match?.[2] || "" };
}

export function locationsMatch(a, b) {
  if (!a || !b) return false;
  const left = typeof a === "string" ? locationFromAirport(a) : a;
  const right = typeof b === "string" ? parseJapaneseAddress(b) : b;
  return Boolean(left.prefecture && right.prefecture && left.prefecture === right.prefecture);
}

export function airportMatches(value, homeAirport) {
  const a = normalizeAirport(value).replace(/[（）()空港/\s]/g, "");
  const b = normalizeAirport(homeAirport).replace(/[（）()空港/\s]/g, "");
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}
