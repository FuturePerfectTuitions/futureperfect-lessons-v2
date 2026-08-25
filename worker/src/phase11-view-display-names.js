import { PHASE11_NAVIGATION_MANIFEST } from './phase11-navigation-manifest.generated.js';

const YEAR5_MATHS_VIEW = 'maths-year5';
const LEGACY_LEVEL2_CODE = /\bL2T\d+M\d+\b/gi;

function displayLessonIdForView(record, viewId) {
  return String(record?.displayIds?.[String(viewId || '').trim()] || '').trim();
}

function displayLessonIdForLesson(lessonId, viewId) {
  const record = PHASE11_NAVIGATION_MANIFEST?.lessons?.[String(lessonId || '').trim()] || null;
  return displayLessonIdForView(record, viewId);
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

function normaliseLessonDisplayNamesForView(lesson, displayLessonId, viewId) {
  if (String(viewId || '').trim() !== YEAR5_MATHS_VIEW) return lesson;
  if (!String(displayLessonId || '').trim()) return lesson;
  return rewriteDisplayNames(lesson, displayLessonId);
}

function normaliseDisplayNameForView(displayName, displayLessonId, viewId) {
  if (String(viewId || '').trim() !== YEAR5_MATHS_VIEW) return String(displayName || '');
  return rewriteLegacyLevel2Code(displayName, displayLessonId);
}

export {
  YEAR5_MATHS_VIEW,
  LEGACY_LEVEL2_CODE,
  displayLessonIdForView,
  displayLessonIdForLesson,
  rewriteLegacyLevel2Code,
  normaliseLessonDisplayNamesForView,
  normaliseDisplayNameForView
};
