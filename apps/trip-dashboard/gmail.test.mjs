import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTravelEmails } from "./core.mjs";
import { chooseBodyText, fetchTravelMessages, htmlToText } from "./gmail.mjs";

const attachmentFixture = JSON.parse(await readFile(
  new URL("./fixtures/rakuten/gmail-attachment-body.json", import.meta.url),
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
