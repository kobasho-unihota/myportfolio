"use client";

import { useEffect, useMemo, useState } from "react";

type SplitResult = {
  shogoBonus: number;
  kanaBonus: number;
  totalBonus: number;

  loan: number;
  remaining: number;

  householdTotal: number; // 家計貯金(80%相当、端数調整込み)
  suki: number;           // すきちょ(20%)
  toku: number;           // 特ちょ(30%)
  gachi: number;          // ガチちょ(残り)

  personalTotal: number;  // 個人枠(20%相当、偶数に調整済み)
  shogoPocket: number;    // 夫婦で必ず同額
  kanaPocket: number;     // 夫婦で必ず同額
};

type Season = "winter" | "summer";

export default function Page() {
  const [shogoBonus, setShogoBonus] = useState<string>("");
  const [kanaBonus, setKanaBonus] = useState<string>("");

  // 初期値（URLがあればそちらが優先）
  const [loan, setLoan] = useState<string>("259,436");

  // 表示用：年と季節
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [season, setSeason] = useState<Season>("winter");

  // ---- URL → state 初期化（初回のみ） ----
  useEffect(() => {
    // URLはブラウザでのみ読めるため、マウント後に一度だけフォームへ反映する。
    /* eslint-disable react-hooks/set-state-in-effect */
    const p = new URLSearchParams(window.location.search);

    const qShogo = p.get("shogo");
    const qKana = p.get("kana");
    const qLoan = p.get("loan");
    const qYear = p.get("year");
    const qSeason = p.get("season");

    if (qShogo != null) {
      const n = toNumber(qShogo);
      if (n != null) setShogoBonus(n.toLocaleString("ja-JP"));
    }
    if (qKana != null) {
      const n = toNumber(qKana);
      if (n != null) setKanaBonus(n.toLocaleString("ja-JP"));
    }
    if (qLoan != null) {
      const n = toNumber(qLoan);
      if (n != null) setLoan(n.toLocaleString("ja-JP"));
    }
    if (qYear != null) {
      const y = normalizeYear(qYear);
      if (y) setYear(String(y));
    }
    if (qSeason != null) {
      const s = normalizeSeason(qSeason);
      if (s) setSeason(s);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // ---- state → URL 反映（共有用） ----
  useEffect(() => {
    const url = new URL(window.location.href);

    const s = toNumber(shogoBonus);
    const k = toNumber(kanaBonus);
    const l = toNumber(loan);
    const y = normalizeYear(year);

    setOrDelete(url, "shogo", s);
    setOrDelete(url, "kana", k);
    setOrDelete(url, "loan", l);

    if (y) url.searchParams.set("year", String(y));
    else url.searchParams.delete("year");

    url.searchParams.set("season", season);

    window.history.replaceState(null, "", url);
  }, [shogoBonus, kanaBonus, loan, year, season]);

  const nShogo = toNumber(shogoBonus);
  const nKana = toNumber(kanaBonus);
  const nLoan = toNumber(loan);

  const nTotal = useMemo(() => {
    if (nShogo == null || nKana == null) return null;
    return nShogo + nKana;
  }, [nShogo, nKana]);

  const error = useMemo(() => {
    if (nShogo == null && nKana == null && (nLoan == null || loan.trim() === "")) return "";
    if (nShogo == null) return "しょうごのボーナスを入力してください。";
    if (nKana == null) return "かなのボーナスを入力してください。";
    if (nLoan == null) return "住宅ローン（ボーナス払い）を入力してください。";
    if (nShogo < 0 || nKana < 0 || nLoan < 0) return "金額は0以上で入力してください。";
    if (nTotal == null) return "ボーナス合計の計算に失敗しました。";
    if (nLoan > nTotal) return "ローンのボーナス払いが、ボーナス合計を超えています。";
    return "";
  }, [nShogo, nKana, nLoan, nTotal, loan]);

  const result: SplitResult | null = useMemo(() => {
    if (error) return null;
    if (nShogo == null || nKana == null || nLoan == null) return null;
    return calcSplitEvenPersonal(nShogo, nKana, nLoan);
  }, [nShogo, nKana, nLoan, error]);

  const heading = useMemo(() => {
    const label = season === "winter" ? "冬" : "夏";
    const y = normalizeYear(year);
    return y ? `${y}年 ${label}のボーナス` : `${label}のボーナス`;
  }, [year, season]);

  const outText = useMemo(() => {
    if (!result) return "";
    return (
`【${heading}】

▶ 総支給額：${yen(result.totalBonus)}
・しょうご：${yen(result.shogoBonus)}
・かな　　：${yen(result.kanaBonus)}

■ 支出：住宅ローンボーナス払い：${yen(result.loan)}

■ 家計貯金（80%）：${yen(result.householdTotal)}
・すきちょ：${yen(result.suki)}
・特ちょ　：${yen(result.toku)}
・ガチちょ：${yen(result.gachi)}

■ 個人枠（20%）：${yen(result.personalTotal)}
・しょうご：${yen(result.shogoPocket)}
・かな　　：${yen(result.kanaPocket)}
`
    );
  }, [result, heading]);

  return (
    <main style={{ padding: 20 }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <header style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            ボーナス分配（家計貯金 / 個人枠）
          </h1>
        </header>

        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow)",
            padding: 14,
          }}
        >
          {/* 年 / 季節 */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <MiniField label="年" value={year} onChange={setYear} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
                季節
              </label>
              <select
                value={season}
                onChange={(e) => setSeason(e.target.value as Season)}
                style={{
                  width: "100%",
                  padding: 12,
                  fontSize: 16,
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                  background: "#fff",
                }}
              >
                <option value="winter">冬</option>
                <option value="summer">夏</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="しょうご ボーナス" value={shogoBonus} onChange={setShogoBonus} />
            <Field label="かな ボーナス" value={kanaBonus} onChange={setKanaBonus} />
            <Field label="住宅ローン ボーナス払い" value={loan} onChange={setLoan} />
            <ReadOnlyField label="ボーナス合計" value={nTotal == null ? "—" : yen(nTotal)} />
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(220,38,38,.25)",
                background: "rgba(220,38,38,.08)",
                color: "#8a1f1f",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: "var(--radius-s)",
              border: "1px solid var(--line)",
              background: "#fafafa",
            }}
          >
            <KV label="支出：住宅ローンボーナス払い" value={result ? yen(result.loan) : "—"} big />
            <div style={{ height: 10 }} />
            <KV label="家計貯金（80%）" value={result ? yen(result.householdTotal) : "—"} />
            <KV label="・すきちょ" value={result ? yen(result.suki) : "—"} />
            <KV label="・特ちょ　" value={result ? yen(result.toku) : "—"} />
            <KV label="・ガチちょ" value={result ? yen(result.gachi) : "—"} />
            <div style={{ height: 10 }} />
            <KV label="個人枠（20%）" value={result ? yen(result.personalTotal) : "—"} />
            <KV label="・しょうご" value={result ? yen(result.shogoPocket) : "—"} />
            <KV label="・かな　　" value={result ? yen(result.kanaPocket) : "—"} />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <button
              onClick={async () => outText && navigator.clipboard.writeText(outText)}
              style={{
                padding: "12px 14px",
                fontSize: 14,
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--accent-soft)",
                color: "#355f55",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              フォーマットをコピー
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              URLに入力が反映されます
            </span>
          </div>

          <textarea
            readOnly
            value={outText}
            style={{
              width: "100%",
              marginTop: 12,
              minHeight: 190,
              padding: 12,
              borderRadius: 14,
              border: "1px solid var(--line)",
              background: "#fff",
              fontSize: 13,
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
        </section>
      </div>
    </main>
  );
}

/**
 * 個人枠が奇数円になった場合の「1円差」をなくす：
 * - まず「理論上の個人枠(20%)」を計算
 * - 夫婦で必ず同額にできるよう、個人枠を偶数円に丸める（1円だけ家計へ寄せる）
 * - 残りを家計枠として再計算（合計は必ず一致）
 */
function calcSplitEvenPersonal(shogoBonus: number, kanaBonus: number, loan: number): SplitResult {
  const totalBonus = shogoBonus + kanaBonus;
  const remaining = totalBonus - loan;

  // 理論上の個人枠（20%）
  const personalIdeal = Math.floor(remaining * 0.2);

  // 偶数円に調整（奇数なら1円を家計側に寄せる）
  const personalTotal = personalIdeal % 2 === 0 ? personalIdeal : personalIdeal - 1;

  // 家計は残り（端数調整込み）
  const householdTotal = remaining - personalTotal;

  const suki = Math.floor(householdTotal * 0.2);
  const toku = Math.floor(householdTotal * 0.3);
  const gachi = householdTotal - suki - toku;

  // 必ず同額
  const each = personalTotal / 2;

  return {
    shogoBonus,
    kanaBonus,
    totalBonus,
    loan,
    remaining,
    householdTotal,
    suki,
    toku,
    gachi,
    personalTotal,
    shogoPocket: each,
    kanaPocket: each,
  };
}

// URL の query 更新ヘルパー（null は削除）
function setOrDelete(url: URL, key: string, value: number | null) {
  if (value == null) url.searchParams.delete(key);
  else url.searchParams.set(key, String(Math.trunc(value)));
}

function normalizeSeason(s: string): Season | null {
  const t = s.trim().toLowerCase();
  if (t === "winter" || t === "w" || t === "冬") return "winter";
  if (t === "summer" || t === "s" || t === "夏") return "summer";
  return null;
}

function normalizeYear(s: string): number | null {
  const n = toNumber(s);
  if (n == null) return null;
  const y = Math.trunc(n);
  if (y < 2000 || y > 2100) return null;
  return y;
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px 1fr",
        gap: 10,
        alignItems: "center",
      }}
    >
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = toNumber(value);
          if (n != null) onChange(n.toLocaleString("ja-JP"));
        }}
        inputMode="numeric"
        style={{
          width: "100%",
          padding: 12,
          fontSize: 16,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "#fff",
          minWidth: 0,
        }}
      />
    </div>
  );
}

function MiniField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        style={{
          width: "100%",
          padding: 12,
          fontSize: 16,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "#fff",
        }}
      />
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px 1fr",
        gap: 10,
        alignItems: "center",
      }}
    >
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {label}
      </label>
      <input
        readOnly
        value={value}
        style={{
          width: "100%",
          padding: 12,
          fontSize: 16,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--soft)",
          color: "var(--muted)",
          minWidth: 0,
        }}
      />
    </div>
  );
}

function KV({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 0",
        borderBottom: "1px dashed var(--line)",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</div>
      <div
        style={{
          fontWeight: 700,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontSize: big ? 18 : 14,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// カンマ/全角/円 を許容
function toNumber(s: string): number | null {
  if (!s) return null;
  let t = s.trim();
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  t = t.replace(/[，,￥¥円\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}
