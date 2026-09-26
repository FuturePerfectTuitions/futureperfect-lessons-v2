export const YEAR6_STANDARD_LESSON_IDS = Object.freeze([
  ...Array.from({ length: 35 }, (_, i) => `M3.L${i + 1}`),
  ...Array.from({ length: 13 }, (_, i) => `Y6.EXTRA.L${i + 1}`)
]);

export function expectedYear6DisplayId(lessonId) {
  const id = String(lessonId || '').trim();
  let m = /^M3\.L(\d+)$/.exec(id);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 21) return `Y6T1M${n}`;
    if (n >= 22 && n <= 35) return `Y6T2M${n - 21}`;
    return null;
  }
  m = /^Y6\.EXTRA\.L(\d+)$/.exec(id);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 13) return `Y6T3M${n}`;
  }
  return null;
}

export function expectedYear6StandardDisplaySequence() {
  return YEAR6_STANDARD_LESSON_IDS.map(expectedYear6DisplayId);
}
