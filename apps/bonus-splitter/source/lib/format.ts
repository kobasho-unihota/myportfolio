import { calc } from "./calc";

const yen = (n: number) => n.toLocaleString("ja-JP") + "円";

export function formatLine(
  year: number,
  season: string,
  shogo: number,
  kana: number,
  loan: number
) {
  const r = calc({ shogo, kana, loan });

  return `
【${year}年 ${season}のボーナス】

▶ 総支給額：${yen(r.total)}
・しょうご：${yen(shogo)}
・かな　　：${yen(kana)}

■ 支出：住宅ローンボーナス払い：${yen(loan)}

■ 家計貯金（80%）：${yen(r.household)}
・すきちょ：${yen(r.suki)}
・特ちょ　：${yen(r.toku)}
・ガチちょ：${yen(r.gachi)}

■ 個人枠（20%）：${yen(r.personal)}
・しょうご：${yen(r.shogoP)}
・かな　　：${yen(r.kanaP)}
`.trim();
}
