export function calc({
  shogo,
  kana,
  loan,
}: {
  shogo: number;
  kana: number;
  loan: number;
}) {
  const total = shogo + kana;
  const source = total - loan;

  const household = Math.round(source * 0.8);
  const personal = source - household;

  const shogoP = Math.floor(personal / 2) + (personal % 2);
  const kanaP = personal - shogoP;

  const suki = Math.floor(household * 0.2);
  const toku = Math.floor(household * 0.3);
  const gachi = household - suki - toku;

  return {
    total,
    loan,
    household,
    suki,
    toku,
    gachi,
    personal,
    shogoP,
    kanaP,
  };
}
