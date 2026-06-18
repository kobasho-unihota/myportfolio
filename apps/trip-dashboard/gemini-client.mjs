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

export async function classifyTripScreenshotWithGemini({ apiKey, image, sourceKind = "unknown_screenshot", imageHash = "", analyzedAt = "" }) {
  if (!apiKey) throw new Error("設定画面からGemini APIキーを登録してください。");
  if (!image?.base64 || !image?.mimeType) throw new Error("AI解析に必要なスクリーンショットがありません。");
  const first = await requestScreenshotAnalysis({
    apiKey,
    image,
    prompt: screenshotPromptFor(sourceKind, analyzedAt),
  });
  const missing = missingScreenshotFields(first);
  const parsed = missing.length
    ? mergeScreenshotResponses(first, await requestScreenshotAnalysis({
      apiKey,
      image,
      prompt: screenshotRetryPromptFor(sourceKind, analyzedAt, missing),
    }))
    : first;
  return {
    analysis: {
      ...parsed,
      sourceType: "screenshot",
      sourceKind,
      imageHash,
      imageId: imageHash ? `image-${String(imageHash).replace(/^fnv1a-/, "")}` : "",
      messageId: imageHash ? `image-${String(imageHash).replace(/^fnv1a-/, "")}` : "",
      sourceHash: imageHash,
      model: GEMINI_MODEL,
    },
    model: GEMINI_MODEL,
  };
}

async function requestScreenshotAnalysis({ apiKey, image, prompt }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: screenshotResponseSchema(),
      },
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: image.mimeType,
              data: image.base64,
            },
          },
        ],
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
    return JSON.parse(text);
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

function screenshotPromptFor(sourceKind, analyzedAt = "") {
  const hint = {
    flight_screenshot: "これはJALの予約一覧または予約詳細スクリーンショットです。航空券として抽出してください。",
    hotel_screenshot: "これは楽天トラベルの予約詳細スクリーンショットです。ホテル予約として抽出してください。",
    unknown_screenshot: "これは出張予約に関係する可能性があるスクリーンショットです。JAL航空券、楽天ホテル、要確認、対象外のどれかに分類してください。",
  }[sourceKind] || "予約スクリーンショットを分類してください。";
  const referenceDate = formatReferenceDate(analyzedAt);
  return `あなたは個人用PWA TripBoard のために、日本語の予約スクリーンショットを分類・構造化します。
返答はJSONオブジェクトのみ。Markdownや説明文は禁止。

入力ヒント:
${hint}

解析基準日:
${referenceDate}

カテゴリ:
- flight: JAL航空券、搭乗予定、予約一覧、予約詳細
- hotel: 楽天トラベルのホテル予約詳細、宿泊予約
- trip_related_unknown: 旅行関連だが航空券/ホテルとして確定できないスクリーンショット
- irrelevant: 出張予約に関係しないスクリーンショット

ルール:
- 画面に見えている文字だけを根拠にする。推測は禁止。
- 読めない値、不明な値は空文字、false、空配列を使う。
- スクリーンショット内に複数の予約が見える場合、reservationsへ予約ごとに分けてすべて返す。先頭の1件だけに省略しない。
- 往路と復路、複数日、スクロール一覧に見える各予約を別要素として返す。
- 各予約のconfidenceは0から1。
- warningsは必ず配列で返し、読めない項目や矛盾を入れる。
- 日付は必ずYYYY-MM-DD、時刻はHH:mmで返す。
- 年が画面にない場合は解析基準日と、「出発まであとN日」の表示を使って年を補完する。例えば解析基準日が2026-06-18で「6月24日・あと6日」なら2026-06-24。
- JALのカードは左側が出発空港と出発時刻、右側が到着空港と到着時刻、上部右側が便名と日付である。
- JAL航空券は flightNumber, departureDate, departureTime, arrivalTime, departureAirport, arrivalAirport を必ず個別に確認する。
- 「1時間40分」「1時間55分」などの所要時間はdurationMinutesへ分単位で入れる。
- 楽天ホテルは hotelName, checkInDate, checkOutDate, reservationNumber, planName, guestName, checkInTime を優先する。
- ホテル名に住所や郵便番号を混ぜない。
- statusはconfirmedまたはcancelled。取消・キャンセル画面ならcancelled。`;
}

function screenshotRetryPromptFor(sourceKind, analyzedAt, missing) {
  return `${screenshotPromptFor(sourceKind, analyzedAt)}

前回の読み取りでは次の重要項目が空でした:
${missing.join("\n")}

画像をもう一度拡大して確認し、reservations全体を完全なJSONとして返してください。
JALカードでは中央線の左と右を混同せず、右側の空港コード・空港名・時刻をarrivalAirportとarrivalTimeへ入れてください。
見えている到着時刻を00:00に置換しないでください。`;
}

function missingScreenshotFields(result) {
  const missing = [];
  (result?.reservations || []).forEach((reservation, index) => {
    if (reservation.category !== "flight") return;
    const extracted = reservation.extracted || {};
    ["flightNumber", "departureDate", "departureTime", "arrivalTime", "departureAirport", "arrivalAirport"].forEach((field) => {
      if (!String(extracted[field] || "").trim()) missing.push(`予約${index + 1}: ${field}`);
    });
  });
  return missing;
}

function mergeScreenshotResponses(first, retry) {
  const firstReservations = Array.isArray(first?.reservations) ? first.reservations : [];
  const retryReservations = Array.isArray(retry?.reservations) ? retry.reservations : [];
  const reservations = retryReservations.map((reservation, index) => {
    const previous = firstReservations.find((item) =>
      item?.extracted?.flightNumber &&
      item.extracted.flightNumber === reservation?.extracted?.flightNumber) || firstReservations[index] || {};
    return {
      ...previous,
      ...reservation,
      extracted: fillEmptyValues(reservation.extracted || {}, previous.extracted || {}),
      warnings: Array.isArray(reservation.warnings) ? reservation.warnings : [],
    };
  });
  return {
    ...first,
    ...retry,
    reservations: reservations.length ? reservations : firstReservations,
    warnings: Array.isArray(retry?.warnings) ? retry.warnings : [],
  };
}

function fillEmptyValues(primary, fallback) {
  const result = { ...primary };
  Object.entries(fallback).forEach(([key, value]) => {
    if (result[key] === "" || result[key] === null || result[key] === undefined) result[key] = value;
  });
  return result;
}

function formatReferenceDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function screenshotResponseSchema() {
  return {
    type: "object",
    required: ["summary", "sourceKind", "reservations", "warnings"],
    properties: {
      summary: { type: "string" },
      sourceKind: { type: "string", enum: ["flight_screenshot", "hotel_screenshot", "unknown_screenshot"] },
      reservations: {
        type: "array",
        items: {
          type: "object",
          required: ["category", "confidence", "summary", "extracted", "warnings"],
          properties: {
            category: { type: "string", enum: CATEGORIES },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            summary: { type: "string" },
            provider: { type: "string" },
            reservationNumber: { type: "string" },
            extracted: {
              type: "object",
              required: [
                "airline", "flightNumber", "departureDate", "departureTime", "arrivalTime",
                "departureAirport", "arrivalAirport", "reservationNumber", "durationMinutes",
                "hotelName", "checkInDate", "checkOutDate", "nights", "address", "planName",
                "guestName", "checkInTime", "status"
              ],
              properties: {
                airline: { type: "string" },
                flightNumber: { type: "string" },
                departureDate: { type: "string" },
                departureTime: { type: "string" },
                arrivalTime: { type: "string" },
                departureAirport: { type: "string" },
                arrivalAirport: { type: "string" },
                durationMinutes: { type: "number" },
                hotelName: { type: "string" },
                checkInDate: { type: "string" },
                checkOutDate: { type: "string" },
                nights: { type: "number" },
                address: { type: "string" },
                reservationNumber: { type: "string" },
                planName: { type: "string" },
                guestName: { type: "string" },
                checkInTime: { type: "string" },
                status: { type: "string", enum: ["confirmed", "cancelled"] },
              },
            },
            warnings: { type: "array", items: { type: "string" } },
          },
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
