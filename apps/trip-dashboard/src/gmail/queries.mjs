function dateAfter(lastSyncedAt, fallbackDays) {
  const after = lastSyncedAt ? new Date(Date.parse(lastSyncedAt) - 30 * 86400000) : new Date(Date.now() - fallbackDays * 86400000);
  return [after.getUTCFullYear(), String(after.getUTCMonth() + 1).padStart(2, "0"), String(after.getUTCDate()).padStart(2, "0")].join("/");
}
export function hotelQuery(lastSyncedAt = "") { return `after:${dateAfter(lastSyncedAt, 365)} {from:travel@mail.travel.rakuten.co.jp from:no-reply@mail.travel.rakuten.co.jp subject:"楽天トラベル"} {subject:"予約" subject:"キャンセル" subject:"予約確認" subject:"予約完了" subject:"キャンセル確認メール"} -in:trash -in:spam`; }
export function flightQuery(lastSyncedAt = "") { return `after:${dateAfter(lastSyncedAt, 365)} {from:jal.com from:skyinfo.jal.com from:booking.jal.com subject:"JAL国内線"} -in:trash -in:spam`; }
