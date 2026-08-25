const YEAR5_MATHS_VIEW = 'maths-year5';
const LEGACY_LEVEL2_CODE = /\bL2T\d+M\d+\b/gi;

function displayLessonIdForView(record, viewId) {
  return String(record?.displayIds?.[String(viewId || '').trim()] || '').trim();
}

function rewriteLegacyLevel2Code(value, displayLessonId) {
  const text = String(value || '');
  const replacement = String(displayLessonId || '').trim();
  if (!text || !replacement) return text;
  return text.replace(LEGACY_LEVEL2_CODE, replacement);
}

function rewriteDisplayNames(value, displayLessonId) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) rewriteDisplayNames(item, displayLessonId);
    return value;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'displayName' && typeof child === 'string') {
      value[key] = rewriteLegacyLevel2Code(child, displayLessonId);
      continue;
    }
    rewriteDisplayNames(child, displayLessonId);
  }
  return value;
}

function normaliseLessonDisplayNamesForView(lesson, record, viewId) {
  if (String(viewId || '').trim() !== YEAR5_MATHS_VIEW) return lesson;
  const displayLessonId = displayLessonIdForView(record, viewId);
  if (!displayLessonId) return lesson;
  return rewriteDisplayNames(lesson, displayLessonId);
}

function normaliseDisplayNameForView(displayName, record, viewId) {
  if (String(viewId || '').trim() !== YEAR5_MATHS_VIEW) return String(displayName || '');
  const displayLessonId = displayLessonIdForView(record, viewId);
  return rewriteLegacyLevel2Code(displayName, displayLessonId);
}

export {
  YEAR5_MATHS_VIEW,
  LEGACY_LEVEL2_CODE,
  displayLessonIdForView,
  rewriteLegacyLevel2Code,
  normaliseLessonDisplayNamesForView,
  normaliseDisplayNameForView
};
