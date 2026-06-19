import test from "node:test";
import assert from "node:assert/strict";
import { calculateSummary, filterRecords, normalizeState, toCsv } from "./core.mjs";

const records = [
  {
    id: "1", paidDate: "2026-01-10", personName: "本人", providerName: "A病院",
    category: "診療・治療", paymentMethod: "現金", amount: 90000, compensation: 10000,
    transportation: 2000, receiptStatus: "保管済み", eligible: true, memo: "",
    createdAt: "2026-01-10T00:00:00Z", updatedAt: "2026-01-10T00:00:00Z",
  },
  {
    id: "2", paidDate: "2026-02-10", personName: "配偶者", providerName: "B薬局",
    category: "医薬品", paymentMethod: "現金", amount: 30000, compensation: 0,
    transportation: 0, receiptStatus: "保管済み", eligible: true, memo: "定期薬",
    createdAt: "2026-02-10T00:00:00Z", updatedAt: "2026-02-10T00:00:00Z",
  },
];

test("10万円基準で控除額を集計する", () => {
  const summary = calculateSummary(records, 2026, 3_000_000);
  assert.equal(summary.netEligible, 112000);
  assert.equal(summary.deduction, 12000);
});

test("所得200万円未満は5%を基準にする", () => {
  const summary = calculateSummary(records, 2026, 1_000_000);
  assert.equal(summary.threshold, 50000);
  assert.equal(summary.deduction, 62000);
});

test("年・人・検索語で絞り込める", () => {
  assert.equal(filterRecords(records, { year: 2026, person: "配偶者", query: "定期" }).length, 1);
  assert.equal(filterRecords(records, { year: 2025 }).length, 0);
});

test("不正なバックアップ行を除外する", () => {
  const state = normalizeState({ records: [{ id: "bad" }, records[0]], settings: {} });
  assert.equal(state.records.length, 1);
});

test("空白だけの受診者・支払先と0円を拒否する", () => {
  const state = normalizeState({
    records: [
      { ...records[0], id: "blank", personName: "   " },
      { ...records[0], id: "zero", amount: 0 },
    ],
  });
  assert.equal(state.records.length, 0);
});

test("危険なIDを持つインポート行を除外する", () => {
  const state = normalizeState({ records: [{ ...records[0], id: 'x" onclick="alert(1)' }], settings: {} });
  assert.equal(state.records.length, 0);
});

test("所得金額を年度別に正規化する", () => {
  const state = normalizeState({ records: [], settings: { incomesByYear: { 2025: 1000000, bad: 5 } } });
  assert.deepEqual(state.settings.incomesByYear, { 2025: 1000000 });
});

test("CSVの式インジェクションになりうる値も文字列として囲む", () => {
  const csv = toCsv([{ ...records[0], memo: '=SUM(A1:A2),"引用"' }], 2026);
  assert.match(csv, /'=SUM/);
  assert.match(csv, /""引用""/);
});
