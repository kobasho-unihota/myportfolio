import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTravelEmails } from "./core.mjs";
import { chooseBodyText, fetchTravelMessages, htmlToText } from "./gmail.mjs";

const attachmentFixture = JSON.parse(await readFile(
  new URL("./fixtures/rakuten/gmail-attachment-body.json", import.meta.url),
  "utf8"
));
const nestedFixture = JSON.parse(await readFile(
  new URL("./fixtures/rakuten/gmail-nested-multipart.json", import.meta.url),
  "utf8"
));
const quotedPrintableFixture = JSON.parse(await readFile(
  new URL("./fixtures/rakuten/gmail-quoted-printable-iso2022jp.json", import.meta.url),
  "utf8"
));

function jsonResponse(value) {
  return { ok: true, json: async () => value };
}

test("楽天メールは構造化されたプレーン本文をHTMLより優先する", () => {
  const plain = "・予約番号 ：RYTEST123\n■チェックイン日時 ：【2026-07-29(水) 22:30】";
  const html = "予約情報のご案内";
  assert.equal(chooseBodyText(plain, html), plain);
});

test("プレーン本文に予約項目がない場合はHTML本文を使用する", () => {
  assert.equal(chooseBodyText("このメールはHTML形式です", "予約番号\nRYTEST123"), "予約番号\nRYTEST123");
});

test("HTML fixtureを本文テキストへ変換する", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/rakuten/reservation-complete-html.json", import.meta.url),
    "utf8"
  ));
  const body = htmlToText(fixture.html);
  assert.match(body, /RYTEST2002/);
  assert.match(body, /\[予約確認ページ\]\(https:\/\/example\.test\/rakuten\/manage\/RYTEST2002\)/);
});

test("HTML本文だけの楽天メールをGmail取得からホテル解析まで処理する", async (context) => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/rakuten/reservation-complete-html.json", import.meta.url),
    "utf8"
  ));
  const message = {
    id: fixture.id,
    threadId: fixture.id,
    internalDate: String(Date.parse(fixture.receivedAt)),
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: fixture.from },
        { name: "Subject", value: fixture.subject },
      ],
      parts: [{
        mimeType: "multipart/alternative",
        parts: [{
          mimeType: "text/html",
          headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }],
          body: { data: Buffer.from(fixture.html).toString("base64url") },
        }],
      }],
    },
  };
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/messages?")) return jsonResponse({ messages: [{ id: message.id }] });
    if (target.includes(`/messages/${message.id}?`)) return jsonResponse(message);
    throw new Error(`Unexpected Gmail URL: ${target}`);
  };

  const [normalized] = await fetchTravelMessages("test-token", "subject:楽天トラベル");
  const [hotel] = parseTravelEmails(normalized);
  assert.equal(normalized.bodyVariants.plain, "");
  assert.match(normalized.bodyVariants.html, /RYTEST2002/);
  assert.equal(hotel.id, "rakuten-rytest2002");
  assert.equal(hotel.parsed.name, "テストホテル大阪");
});

test("attachmentIdで返る楽天本文を取得してホテル解析へ渡す", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/messages?")) {
      return jsonResponse({ messages: [{ id: attachmentFixture.message.id }] });
    }
    if (target.includes(`/messages/${attachmentFixture.message.id}?`)) {
      return jsonResponse(attachmentFixture.message);
    }
    if (target.includes("/attachments/")) {
      return jsonResponse({ data: Buffer.from(attachmentFixture.attachmentText).toString("base64url") });
    }
    throw new Error(`Unexpected Gmail URL: ${target}`);
  };

  const messages = await fetchTravelMessages("test-token", "from:travel@mail.travel.rakuten.co.jp");
  const hotels = messages.flatMap(parseTravelEmails).filter((booking) => booking.type === "hotel");

  assert.equal(messages.length, 1);
  assert.match(messages[0].body, /RYTEST3003/);
  assert.equal(hotels.length, 1);
  assert.equal(hotels[0].id, "rakuten-rytest3003");
});

test("ネストされたmultipartではplainとHTMLを評価して必須項目が揃う本文を使う", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/messages?")) {
      return jsonResponse({ messages: [{ id: nestedFixture.message.id }] });
    }
    if (target.includes(`/messages/${nestedFixture.message.id}?`)) {
      return jsonResponse(nestedFixture.message);
    }
    if (target.endsWith("/attachments/nested-plain")) {
      return jsonResponse({ data: Buffer.from(nestedFixture.plainText).toString("base64url") });
    }
    if (target.endsWith("/attachments/nested-html")) {
      return jsonResponse({ data: Buffer.from(nestedFixture.htmlText).toString("base64url") });
    }
    throw new Error(`Unexpected Gmail URL: ${target}`);
  };

  const [message] = await fetchTravelMessages("test-token", "subject:楽天トラベル");
  const [hotel] = message ? message.body && parseTravelEmails(message) : [];

  assert.equal(hotel.id, "rakuten-rytest4004");
  assert.equal(hotel.parsed.name, "テストホテル札幌");
  assert.equal(hotel.parsed.checkIn, "2026-08-12T10:00:00.000Z");
});

test("quoted-printableのISO-2022-JP楽天本文を復号して解析する", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/messages?")) {
      return jsonResponse({ messages: [{ id: quotedPrintableFixture.message.id }] });
    }
    if (target.includes(`/messages/${quotedPrintableFixture.message.id}?`)) {
      return jsonResponse(quotedPrintableFixture.message);
    }
    throw new Error(`Unexpected Gmail URL: ${target}`);
  };

  const [message] = await fetchTravelMessages("test-token", "subject:楽天トラベル");
  const [hotel] = parseTravelEmails(message);

  assert.match(message.body, /予約番号/);
  assert.equal(hotel.id, "rakuten-rytest5005");
  assert.equal(hotel.parsed.name, "テストホテル横浜");
  assert.equal(hotel.parsed.checkIn, "2026-08-19T11:00:00.000Z");
});
