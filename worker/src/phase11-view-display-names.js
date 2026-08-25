import { PHASE11_NAVIGATION_MANIFEST } from './phase11-navigation-manifest.generated.js';

const MATHS_YEAR_VIEW_RULES = Object.freeze({
  'maths-year4': Object.freeze({ levelViewId: 'maths-level1', legacyCode: /\bL1T\d+M\d+\b/gi }),
  'maths-year5': Object.freeze({ levelViewId: 'maths-level2', legacyCode: /\bL2T\d+M\d+\b/gi }),
  'maths-year6': Object.freeze({ levelViewId: 'maths-level3', legacyCode: /\bL3T\d+M\d+\b/gi })
});

const YEAR4_MATHS_VIEW = 'maths-year4';
const YEAR5_MATHS_VIEW = 'maths-year5';
const YEAR6_MATHS_VIEW = 'maths-year6';

function viewRule(viewId) {
  return MATHS_YEAR_VIEW_RULES[String(viewId || '').trim()] || null;
}

function displayLessonIdForView(record, viewId) {
  return String(record?.displayIds?.[String(viewId || '').trim()] || '').trim();
}

function displayLessonIdForLesson(lessonId, viewId) {
  const record = PHASE11_NAVIGATION_MANIFEST?.lessons?.[String(lessonId || '').trim()] || null;
  return displayLessonIdForView(record, viewId);
}

function pairedLevelDisplayIdForLesson(lessonId, viewId) {
  const rule = viewRule(viewId);
  if (!rule) return '';
  return displayLessonIdForLesson(lessonId, rule.levelViewId);
}

function rewriteLegacyLevelCode(value, displayLessonId, viewId) {
  const text = String(value || '');
  const replacement = String(displayLessonId || '').trim();
  const rule = viewRule(viewId);
  if (!text || !replacement || !rule) return text;
  return text.replace(rule.legacyCode, replacement);
}

// Compatibility export retained for existing Phase 11 tests/callers.
function rewriteLegacyLevel2Code(value, displayLessonId) {
  return rewriteLegacyLevelCode(value, displayLessonId, YEAR5_MATHS_VIEW);
}

function rewriteDisplayNames(value, displayLessonId, viewId) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) rewriteDisplayNames(item, displayLessonId, viewId);
    return value;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'displayName' && typeof child === 'string') {
      value[key] = rewriteLegacyLevelCode(child, displayLessonId, viewId);
      continue;
    }
    rewriteDisplayNames(child, displayLessonId, viewId);
  }
  return value;
}

function normaliseLessonDisplayNamesForView(lesson, displayLessonId, viewId) {
  if (!viewRule(viewId)) return lesson;
  if (!String(displayLessonId || '').trim()) return lesson;
  return rewriteDisplayNames(lesson, displayLessonId, viewId);
}

function normaliseDisplayNameForView(displayName, displayLessonId, viewId) {
  if (!viewRule(viewId)) return String(displayName || '');
  return rewriteLegacyLevelCode(displayName, displayLessonId, viewId);
}

function isNormalMathsYearView(viewId) {
  return Boolean(viewRule(viewId));
}

export {
  MATHS_YEAR_VIEW_RULES,
  YEAR4_MATHS_VIEW,
  YEAR5_MATHS_VIEW,
  YEAR6_MATHS_VIEW,
  displayLessonIdForView,
  displayLessonIdForLesson,
  pairedLevelDisplayIdForLesson,
  rewriteLegacyLevelCode,
  rewriteLegacyLevel2Code,
  normaliseLessonDisplayNamesForView,
  normaliseDisplayNameForView,
  isNormalMathsYearView
};
