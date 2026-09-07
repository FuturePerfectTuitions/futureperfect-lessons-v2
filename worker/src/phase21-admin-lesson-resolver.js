import { canonicalLessonId } from './index-phase20-change7.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';
import { VIEW_CURRICULA } from './phase11-navigation-cache.js';
import { clean } from './phase21-admin-import-core.js';

let lessonAliasIndex = null;

function addLessonAlias(index, alias, row) {
  const key = clean(alias).toUpperCase();
  if (!key || !row?.lessonId) return;
  let matches = index.get(key);
  if (!matches) {
    matches = new Map();
    index.set(key, matches);
  }
  if (!matches.has(row.lessonId)) {
    matches.set(row.lessonId, { lessonId: row.lessonId, title: row.title || '' });
  }
}

function buildLessonAliasIndex() {
  if (lessonAliasIndex) return lessonAliasIndex;
  const index = new Map();
  for (const viewId of Object.keys(VIEW_CURRICULA)) {
    for (const row of canonicalCatalogueRowsForView(viewId)) {
      addLessonAlias(index, row.lessonId, row);
      addLessonAlias(index, row.displayLessonId, row);
    }
  }
  lessonAliasIndex = index;
  return index;
}

function resolveLessonCode(sourceCode) {
  const raw = clean(sourceCode).toUpperCase();
  if (!raw) return { error: 'LESSON_CODE_MISSING', message: 'Lesson code is missing.' };

  const phase20Alias = canonicalLessonId(raw);
  if (phase20Alias !== raw) return { lessonId: phase20Alias, sourceCode: raw, title: '' };

  const matches = buildLessonAliasIndex().get(raw);
  if (!matches?.size) {
    return { error: 'LESSON_CODE_NOT_FOUND', message: `Lesson code ${raw} is not in the Portal V2 catalogue.` };
  }
  if (matches.size > 1) {
    return { error: 'LESSON_CODE_AMBIGUOUS', message: `Lesson code ${raw} resolves to more than one Portal lesson.` };
  }
  const [resolved] = matches.values();
  return { ...resolved, sourceCode: raw };
}

export { buildLessonAliasIndex, resolveLessonCode };
