import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReceiptResult } from "./ai-receipt.mjs";

test("AI解析結果を入力候補へ正規化する", () => {
  assert.deepEqual(normalizeReceiptResult({
    paidDate: "2026-06-13",
    providerName: "中央病院",
    amount: 12340,
    category: "診療・治療",
    paymentMethod: "現金",
    memo: "内科",
    confidence: 1.2,
    warnings: ["患者名は出力しない"],
  }), {
    paidDate: "2026-06-13",
    providerName: "中央病院",
    amount: 12340,
    category: "診療・治療",
    paymentMethod: "現金",
    memo: "内科",
    confidence: 1,
    warnings: ["患者名は出力しない"],
  });
});

test("不正な区分と支払方法は安全な値へ戻す", () => {
  const result = normalizeReceiptResult({
    providerName: "薬局",
    amount: "980",
    category: "自由診療",
    paymentMethod: "不明",
  });
  assert.equal(result.category, "診療・治療");
  assert.equal(result.paymentMethod, "その他");
  assert.equal(result.paidDate, "");
});

test("支払先または金額がない解析結果を拒否する", () => {
  assert.throws(() => normalizeReceiptResult({ providerName: "", amount: 100 }), /INVALID_RESULT/);
  assert.throws(() => normalizeReceiptResult({ providerName: "病院", amount: 0 }), /INVALID_RESULT/);
});
