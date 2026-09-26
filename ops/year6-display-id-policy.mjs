export const YEAR6_TERM1_LESSON_IDS = Object.freeze([
  'Y6M2.1','Y6M2.2','Y6M2.3','Y6M2.4','Y6M2.5',
  'Y6M4','Y6M5','Y6M8','Y6M9','Y6M10','Y6M11','Y6M12','Y6M13','Y6M14','Y6M15','Y6M16',
  'Y6M46','Y6M47','Y6M48','Y6M49','Y6M50'
]);

export const YEAR6_TERM2_LESSON_IDS = Object.freeze([
  'Y6M17','Y6M18','Y6M19','Y6M01','Y6M1','Y6M1.2','Y6M1.3','Y6M1.4','Y6M25',
  'Y6M34','Y6M35','Y6M36','Y6M37','Y6M38'
]);

export const YEAR6_TERM3_LESSON_IDS = Object.freeze([
  'Y6M3','Y6M7','Y6M29','Y6M30','Y6M31','Y6M32','Y6M39','Y6M40','Y6M41','Y6M42','Y6M43','Y6M44','Y6M45'
]);

export const YEAR6_STANDARD_LESSON_IDS = Object.freeze([
  ...YEAR6_TERM1_LESSON_IDS,
  ...YEAR6_TERM2_LESSON_IDS,
  ...YEAR6_TERM3_LESSON_IDS
]);

const DISPLAY_BY_ID = new Map([
  ...YEAR6_TERM1_LESSON_IDS.map((id, i) => [id, `Y6T1M${i + 1}`]),
  ...YEAR6_TERM2_LESSON_IDS.map((id, i) => [id, `Y6T2M${i + 1}`]),
  ...YEAR6_TERM3_LESSON_IDS.map((id, i) => [id, `Y6T3M${i + 1}`])
]);

export function expectedYear6DisplayId(lessonId) {
  return DISPLAY_BY_ID.get(String(lessonId || '').trim()) ?? null;
}

export function expectedYear6StandardDisplaySequence() {
  return YEAR6_STANDARD_LESSON_IDS.map(expectedYear6DisplayId);
}

export const YEAR6_DISPLAY_ID_MIGRATIONS = Object.freeze([
  ...YEAR6_TERM2_LESSON_IDS.map((id, i) => ({ id, from: `Y6T2M${i + 22}`, to: `Y6T2M${i + 1}` })),
  ...YEAR6_TERM3_LESSON_IDS.map((id, i) => ({ id, from: `Y6T3M${i + 36}`, to: `Y6T3M${i + 1}` }))
]);
