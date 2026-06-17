export const GEMINI_KEY_STORAGE = "tripboard:gemini-api-key";
export const GEMINI_MODEL = "gemini-2.5-flash-lite";

const CATEGORIES = ["flight", "hotel", "trip_related_unknown", "irrelevant"];

export function getGeminiApiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || "";
}

export function saveGeminiApiKey(value) {
  const key = String(value || "").trim();
  if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
  else localStorage.removeItem(GEMINI_KEY_STORAGE);
  return key;
}

export function clearGeminiApiKey() {
  localStorage.removeItem(GEMINI_KEY_STORAGE);
}

export async function classifyTripEmailWithGemini({ apiKey, message, body, sourceHash }) {
  if (!apiKey) throw new Error("設定画面からGemini APIキーを登録してください。");
  const messageId = message?.id || message?.messageId;
  if (!messageId || !body) throw new Error("AI解析に必要なメール本文がありません。");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: responseSchema(),
      },
      contents: [{
        role: "user",
        parts: [{ text: promptFor(message, body) }],
      }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.error?.message || `Gemini API error (${response.status})`;
    throw new Error(readableGeminiError(details));
  }
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text) throw new Error("Geminiから空の応答が返りました。");
  try {
    return {
      analysis: {
        ...JSON.parse(text),
        messageId,
        threadId: message.threadId || "",
        subject: message.subject || "",
        from: message.from || "",
        receivedAt: message.receivedAt || "",
        url: message.url || "",
        sourceHash: sourceHash || "",
        model: GEMINI_MODEL,
      },
      model: GEMINI_MODEL,
    };
  } catch {
    throw new Error("Geminiの応答をJSONとして読み取れませんでした。");
  }
}

function promptFor(message, body) {
  return `あなたは個人用PWA TripBoard のために、ユーザーが貼り付けた日本語の出張予約メール本文を分類・構造化します。
返答はJSONオブジェクトのみ。Markdownや説明文は禁止。

カテゴリ:
- flight: 航空券、搭乗案内、座席変更、遅延、取消、旅程
- hotel: ホテル予約、予約確認、キャンセル
- trip_related_unknown: 旅行関連だが航空券/ホテルとして確定できないメール
- irrelevant: 出張予約に関係しないメール

ルール:
- 日時はISO 8601文字列。日本国内予約でタイムゾーンが省略されている場合はAsia/Tokyoとして扱う。
- 不明な値は推測せず、空文字、false、空配列を使う。
- confidenceは0から1。
- flightはextracted.itemsに1便以上の区間を入れる。
- hotelはホテル項目をextracted直下に入れる。
- hotel.nameはメール本文にある宿泊施設名・ホテル名の正式名称を省略せず入れる。ブランド名だけに短縮しない。
- hotel.addressには住所だけを入れる。郵便番号や住所をhotel.nameへ混ぜない。
- statusはconfirmedまたはcancelled。

メールメタ情報。空欄の場合は本文だけを根拠にする:
From: ${message.from || ""}
Subject: ${message.subject || ""}
ReceivedAt: ${message.receivedAt || ""}

貼り付け本文:
${String(body || "").slice(0, 24000)}`;
}

function responseSchema() {
  return {
    type: "object",
    required: ["category", "confidence", "summary", "provider", "reservationNumber", "dateRange", "extracted", "warnings"],
    properties: {
      category: { type: "string", enum: CATEGORIES },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string" },
      provider: { type: "string" },
      reservationNumber: { type: "string" },
      dateRange: {
        type: "object",
        properties: {
          startAt: { type: "string" },
          endAt: { type: "string" },
        },
      },
      extracted: {
        type: "object",
        properties: {
          provider: { type: "string" },
          reservationNumber: { type: "string" },
          status: { type: "string", enum: ["confirmed", "cancelled"] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                flightNumber: { type: "string" },
                origin: { type: "string" },
                destination: { type: "string" },
                startAt: { type: "string" },
                endAt: { type: "string" },
                seat: { type: "string" },
                bookingLink: { type: "string" },
                status: { type: "string", enum: ["confirmed", "cancelled"] },
              },
            },
          },
          name: { type: "string" },
          address: { type: "string" },
          phone: { type: "string" },
          checkIn: { type: "string" },
          checkOut: { type: "string" },
          roomType: { type: "string" },
          plan: { type: "string" },
          amount: { type: "string" },
          breakfast: { type: "boolean" },
          managementLink: { type: "string" },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
}

function readableGeminiError(message) {
  if (/API key not valid|API_KEY_INVALID|key.*invalid/i.test(message)) return "Gemini APIキーが正しくありません。";
  if (/quota|rate/i.test(message)) return "Gemini APIの利用上限に達した可能性があります。";
  return message;
}
