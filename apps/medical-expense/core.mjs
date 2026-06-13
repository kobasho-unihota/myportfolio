export const STORAGE_KEY = "medipass:v1";

export const emptyState = () => ({
  version: 1,
  records: [],
  settings: { incomesByYear: {} },
});

export function normalizeState(value) {
  if (!value || typeof value !== "object") return emptyState();
  return {
    version: 1,
    records: Array.isArray(value.records)
      ? value.records.map(normalizeRecord).filter(Boolean)
      : [],
    settings: { incomesByYear: normalizeIncomes(value.settings) },
  };
}

export function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const amount = toNonNegativeNumber(record.amount);
  const id = String(record.id || "");
  const personName = String(record.personName || "").trim().slice(0, 40);
  const providerName = String(record.providerName || "").trim().slice(0, 80);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !record.paidDate || !personName || !providerName || amount === null || amount === 0) return null;
  return {
    id,
    paidDate: String(record.paidDate),
    personName,
    providerName,
    category: String(record.category || "診療・治療"),
    paymentMethod: String(record.paymentMethod || "現金"),
    amount,
    compensation: toNonNegativeNumber(record.compensation) ?? 0,
    transportation: toNonNegativeNumber(record.transportation) ?? 0,
    receiptStatus: String(record.receiptStatus || "未整理"),
    eligible: record.eligible !== false,
    memo: String(record.memo || "").trim().slice(0, 300),
    createdAt: String(record.createdAt || new Date().toISOString()),
    updatedAt: String(record.updatedAt || new Date().toISOString()),
  };
}

export function calculateSummary(records, year, income = null) {
  const yearRecords = records.filter((record) => getYear(record.paidDate) === Number(year));
  const paid = sum(yearRecords, (record) => record.amount + record.transportation);
  const eligibleRecords = yearRecords.filter((record) => record.eligible);
  const eligiblePaid = sum(eligibleRecords, (record) => record.amount + record.transportation);
  const compensation = sum(eligibleRecords, (record) =>
    Math.min(record.amount + record.transportation, record.compensation)
  );
  const netEligible = Math.max(0, eligiblePaid - compensation);
  const threshold = income !== null && income < 2_000_000
    ? Math.floor(income * 0.05)
    : 100_000;
  const deduction = Math.min(2_000_000, Math.max(0, netEligible - threshold));
  return {
    count: yearRecords.length,
    paid,
    eligiblePaid,
    compensation,
    netEligible,
    threshold,
    deduction,
  };
}

export function groupByPerson(records, year) {
  const totals = new Map();
  records
    .filter((record) => getYear(record.paidDate) === Number(year))
    .forEach((record) => {
      const current = totals.get(record.personName) || 0;
      totals.set(record.personName, current + record.amount + record.transportation);
    });
  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

export function filterRecords(records, { year, person = "", category = "", query = "" }) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  return records
    .filter((record) => getYear(record.paidDate) === Number(year))
    .filter((record) => !person || record.personName === person)
    .filter((record) => !category || record.category === category)
    .filter((record) => {
      if (!normalizedQuery) return true;
      return [record.providerName, record.personName, record.memo]
        .some((value) => value.toLocaleLowerCase("ja").includes(normalizedQuery));
    })
    .sort((a, b) => b.paidDate.localeCompare(a.paidDate) || b.updatedAt.localeCompare(a.updatedAt));
}

export function toCsv(records, year) {
  const headers = [
    "支払日",
    "医療を受けた方の氏名",
    "病院・薬局などの支払先の名称",
    "医療費の区分",
    "支払った医療費の額",
    "左のうち補てんされる金額",
    "通院交通費",
    "支払方法",
    "領収書",
    "集計対象",
    "メモ",
  ];
  const rows = filterRecords(records, { year }).map((record) => [
    record.paidDate,
    record.personName,
    record.providerName,
    record.category,
    record.amount,
    record.compensation,
    record.transportation,
    record.paymentMethod,
    record.receiptStatus,
    record.eligible ? "はい" : "いいえ",
    record.memo,
  ]);
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

function escapeCsv(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function getYear(date) {
  return Number(String(date).slice(0, 4));
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function toOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  return toNonNegativeNumber(value);
}

function normalizeIncomes(settings) {
  const source = settings?.incomesByYear && typeof settings.incomesByYear === "object"
    ? settings.incomesByYear
    : {};
  const incomes = {};
  Object.entries(source).forEach(([year, value]) => {
    if (!/^\d{4}$/.test(year)) return;
    const income = toOptionalNumber(value);
    if (income !== null) incomes[year] = income;
  });
  const legacyIncome = toOptionalNumber(settings?.income);
  if (!Object.keys(incomes).length && legacyIncome !== null) {
    incomes[String(new Date().getFullYear())] = legacyIncome;
  }
  return incomes;
}
