import { canonicalLessonId } from './index-phase20-change7.js';
import { canonicalCatalogueRowsForView } from './index-phase12.js';
import { VIEW_CURRICULA } from './phase11-navigation-cache.js';
import { clean, normaliseTitle } from './phase21-admin-import-core.js';

const CURRICULUM_FALLBACK_VIEWS = Object.freeze({
  MATHS_Y2: ['maths-year2'],
  MATHS_Y3: ['maths-year3'],
  MATHS_L1: ['maths-year4', 'maths-level1'],
  MATHS_L2: ['maths-year5', 'maths-level2'],
  MATHS_L3: ['maths-level3', 'maths-year6'],
  MATHS_Y6_EXTRA: ['maths-year6-extra'],
  ENGLISH_Y2: ['english-year2'],
  ENGLISH_Y3: ['english-year3'],
  ENGLISH_Y4: ['english-year4', 'english-year4-11plus'],
  ENGLISH_Y5: ['english-year5', 'english-year5-11plus'],
  ENGLISH_Y6: ['english-year6']
});

let lessonAliasIndex = null;

function addLessonAlias(index, alias, row) {
  const key = clean(alias).toUpperCase();
  if (!key || !row?.lessonId) return;
  let matches = index.get(key);
  if (!matches) {
    matches = new Map();
    index.set(key, matches);
  }
  if (!matches.has(row.lessonId)) matches.set(row.lessonId, { lessonId: row.lessonId, title: row.title || '' });
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

function curriculumCodesForSourceCode(sourceCode) {
  const code = clean(sourceCode).toUpperCase();
  let match = code.match(/^Y([2-6])T\d+M\d+$/);
  if (match) {
    const year = Number(match[1]);
    if (year === 2) return ['MATHS_Y2'];
    if (year === 3) return ['MATHS_Y3'];
    if (year === 4) return ['MATHS_L1'];
    if (year === 5) return ['MATHS_L2'];
    if (year === 6) return ['MATHS_L3', 'MATHS_Y6_EXTRA'];
  }
  match = code.match(/^L([1-3])T\d+M\d+$/);
  if (match) return [`MATHS_L${Number(match[1])}`];
  match = code.match(/^Y([2-6])T\d+E\d+$/);
  if (match) return [`ENGLISH_Y${Number(match[1])}`];
  return [];
}

function rawCatalogueItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.lessonIds)) return raw.lessonIds;
  if (Array.isArray(raw.lessons)) return raw.lessons;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

async function lessonIdsForCurriculum(env, curriculumCode) {
  let raw = await env.LESSONS_KV.get(`curriculum:${curriculumCode}`, { type: 'json' });
  let items = rawCatalogueItems(raw);
  if (!items.length) {
    for (const viewId of CURRICULUM_FALLBACK_VIEWS[curriculumCode] || []) {
      raw = await env.LESSONS_KV.get(`view:${viewId}`, { type: 'json' });
      items = rawCatalogueItems(raw);
      if (items.length) break;
    }
  }
  return items
    .map(item => typeof item === 'string' ? item : clean(item?.lessonId))
    .filter(Boolean);
}

function displayValues(record) {
  const values = [];
  for (const source of [record?.displayIds, record?.displayLessonIds, record?.presentation?.displayIds]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const value of Object.values(source)) {
      const text = clean(value).toUpperCase();
      if (text) values.push(text);
    }
  }
  return values;
}

async function resolveFromLiveKv(env, sourceCode, sourceTitle) {
  if (!env?.LESSONS_KV) return null;
  const code = clean(sourceCode).toUpperCase();
  const curriculumCodes = curriculumCodesForSourceCode(code);
  if (!curriculumCodes.length) return null;

  const ids = new Set();
  for (const curriculumCode of curriculumCodes) {
    for (const lessonId of await lessonIdsForCurriculum(env, curriculumCode)) ids.add(lessonId);
  }
  if (!ids.size) return null;

  const records = [];
  for (const lessonId of ids) {
    const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
    if (record && record.active !== false) records.push(record);
  }

  const byDisplay = records.filter(record => displayValues(record).includes(code));
  if (byDisplay.length === 1) {
    return { lessonId: clean(byDisplay[0].lessonId), sourceCode: code, title: clean(byDisplay[0].title) };
  }
  if (byDisplay.length > 1) {
    return { error: 'LESSON_CODE_AMBIGUOUS', message: `Lesson code ${code} resolves to more than one Portal lesson.` };
  }

  const title = normaliseTitle(sourceTitle);
  if (title) {
    const byTitle = records.filter(record => normaliseTitle(record?.title) === title);
    if (byTitle.length === 1) {
      return { lessonId: clean(byTitle[0].lessonId), sourceCode: code, title: clean(byTitle[0].title) };
    }
    if (byTitle.length > 1) {
      return { error: 'LESSON_TITLE_AMBIGUOUS', message: `Lesson title "${sourceTitle}" matches more than one Portal lesson.` };
    }
  }
  return null;
}

async function resolveLessonCode(env, sourceCode, sourceTitle = '') {
  const raw = clean(sourceCode).toUpperCase();
  if (!raw) return { error: 'LESSON_CODE_MISSING', message: 'Lesson code is missing.' };

  const phase20Alias = canonicalLessonId(raw);
  if (phase20Alias !== raw) return { lessonId: phase20Alias, sourceCode: raw, title: '' };

  const matches = buildLessonAliasIndex().get(raw);
  if (matches?.size === 1) {
    const [resolved] = matches.values();
    return { ...resolved, sourceCode: raw };
  }
  if (matches?.size > 1) {
    return { error: 'LESSON_CODE_AMBIGUOUS', message: `Lesson code ${raw} resolves to more than one Portal lesson.` };
  }

  const live = await resolveFromLiveKv(env, raw, sourceTitle);
  if (live) return live;
  return { error: 'LESSON_CODE_NOT_FOUND', message: `Lesson code ${raw} could not be resolved to an active Portal V2 lesson.` };
}

export {
  buildLessonAliasIndex,
  curriculumCodesForSourceCode,
  resolveFromLiveKv,
  resolveLessonCode
};
