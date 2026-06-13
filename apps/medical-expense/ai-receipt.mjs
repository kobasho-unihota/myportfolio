const MODEL_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

export const GEMINI_KEY_STORAGE = "medipass:gemini-api-key";

export async function analyzeReceipt({ apiKey, image }) {
  if (!apiKey?.trim()) throw new Error("API_KEY_REQUIRED");
  if (!image?.data || !image?.mimeType) throw new Error("IMAGE_REQUIRED");

  let lastError = null;
  for (const model of MODEL_CANDIDATES) {
    try {
      return await callModel(apiKey.trim(), model, image);
    } catch (error) {
      lastError = error;
      if (!["MODEL_NOT_FOUND", "MODEL_UNAVAILABLE"].includes(error.message)) throw error;
    }
  }
  throw lastError || new Error("MODEL_UNAVAILABLE");
}

export function normalizeReceiptResult(value) {
  const categories = ["診療・治療", "医薬品", "介護保険サービス", "その他"];
  const paymentMethods = ["現金", "クレジットカード", "電子マネー", "口座振替", "その他"];
  const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value?.paidDate || ""))
    ? String(value.paidDate)
    : "";
  const amount = toPositiveInteger(value?.amount);
  const providerName = String(value?.providerName || "").trim().slice(0, 80);
  if (!providerName || !amount) throw new Error("INVALID_RESULT");
  return {
    paidDate,
    providerName,
    amount,
    category: categories.includes(value?.category) ? value.category : "診療・治療",
    paymentMethod: paymentMethods.includes(value?.paymentMethod) ? value.paymentMethod : "その他",
    memo: String(value?.memo || "").trim().slice(0, 300),
    confidence: clamp(Number(value?.confidence) || 0, 0, 1),
    warnings: Array.isArray(value?.warnings)
      ? value.warnings.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : [],
  };
}

export async function prepareImage(file, maxSize = 1600) {
  if (!file?.type?.startsWith("image/")) throw new Error("INVALID_IMAGE");
  if (file.size > 10 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
  const image = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  image.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
  return {
    dataUrl,
    data: dataUrl.split(",")[1],
    mimeType: "image/jpeg",
  };
}

async function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.(),
      };
    } catch {
      // Safari may need the HTMLImageElement path for camera files.
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.src = objectUrl;
    await element.decode();
    return {
      source: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function callModel(apiKey, model, image) {
  const schema = {
    type: "object",
    properties: {
      paidDate: { type: "string", description: "YYYY-MM-DD。読めない場合は空文字" },
      providerName: { type: "string" },
      amount: { type: "integer" },
      category: { type: "string" },
      paymentMethod: { type: "string" },
      memo: { type: "string" },
      confidence: { type: "number" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["paidDate", "providerName", "amount", "category", "paymentMethod", "memo", "confidence", "warnings"],
  };
  const legacySchema = {
    ...schema,
    type: "OBJECT",
    properties: Object.fromEntries(Object.entries(schema.properties).map(([key, property]) => [
      key,
      {
        ...property,
        type: property.type.toUpperCase(),
        ...(property.items ? { items: { ...property.items, type: property.items.type.toUpperCase() } } : {}),
      },
    ])),
  };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            text: [
              "日本の病院・薬局等の領収書画像から、医療費記録の下書きを作成してください。",
              "領収書に印字された支払日、支払先名称、実際の支払合計額を読み取ってください。",
              "患者氏名、保険者番号、記号番号などの個人識別情報は出力しないでください。",
              "金額は自己負担として実際に支払った合計額を整数で返してください。",
              "読み取れない項目は推測せず、warningsへ日本語で記載してください。",
              "categoryは 診療・治療 / 医薬品 / 介護保険サービス / その他 のいずれかです。",
              "paymentMethodは 現金 / クレジットカード / 電子マネー / 口座振替 / その他 のいずれかです。",
              "memoには診療科や但し書きなど、申告確認に役立つ短い情報だけを入れてください。",
            ].join("\n"),
          },
          { inline_data: { mime_type: image.mimeType, data: image.data } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        ...(model.startsWith("gemini-3.")
          ? { responseFormat: { text: { mimeType: "application/json", schema } } }
          : { responseMimeType: "application/json", responseSchema: legacySchema }),
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(body?.error?.message || "");
    if (response.status === 404) throw new Error("MODEL_NOT_FOUND");
    if (response.status === 429 || response.status >= 500) throw new Error("MODEL_UNAVAILABLE");
    if (response.status === 400 && /API key/i.test(message)) throw new Error("INVALID_API_KEY");
    if (response.status === 400 && /(responseFormat|responseSchema|not supported|Invalid JSON payload)/i.test(message)) {
      throw new Error("MODEL_NOT_FOUND");
    }
    throw new Error("API_ERROR");
  }
  const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("EMPTY_RESULT");
  try {
    return normalizeReceiptResult(JSON.parse(text));
  } catch (error) {
    if (error.message === "INVALID_RESULT") throw error;
    throw new Error("INVALID_RESULT");
  }
}

function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
