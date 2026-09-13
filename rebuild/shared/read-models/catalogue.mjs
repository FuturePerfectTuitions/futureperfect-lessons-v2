import { VIEW_DEFINITIONS, sortedViewIds, viewDefinition, clean, norm } from './view-registry.mjs';

function rawCatalogueItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.lessonIds)) return raw.lessonIds;
  if (Array.isArray(raw.lessons)) return raw.lessons;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function lessonIdsFromCurriculum(raw) {
  return rawCatalogueItems(raw)
    .map(item => typeof item === 'string' ? clean(item) : clean(item?.lessonId))
    .filter(Boolean);
}

function displayLessonId(record, viewId) {
  const target = norm(viewId);
  const sources = [record?.displayIds, record?.displayLessonIds, record?.presentation?.displayIds];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const direct = clean(source[target]);
    if (direct) return direct;
    const match = Object.entries(source).find(([key]) => norm(key) === target);
    if (match) {
      const value = clean(match[1]);
      if (value) return value;
    }
  }
  return clean(record?.lessonId);
}

function cleanStudentTitle(record, shownId) {
  let title = clean(record?.title);
  const canonical = clean(record?.lessonId);
  for (const prefix of [canonical, shownId]) {
    if (!prefix) continue;
    const marker = `${prefix} `;
    if (title.toLowerCase().startsWith(marker.toLowerCase())) {
      title = title.slice(marker.length).trim();
    }
  }
  return title || shownId || canonical;
}

function safeLessonMetadata(record, viewId) {
  if (!record || typeof record !== 'object' || record.active === false) return null;
  const lessonId = clean(record.lessonId);
  if (!lessonId) return null;
  const shownId = displayLessonId(record, viewId);
  const numericOrder = Number(record.order);
  return {
    lessonId,
    displayLessonId: shownId,
    title: cleanStudentTitle(record, shownId),
    description: String(record.description || record.desc || ''),
    order: Number.isFinite(numericOrder) ? numericOrder : Number.MAX_SAFE_INTEGER
  };
}

function compileViewCatalogue(input, viewId) {
  const definition = viewDefinition(viewId);
  if (!definition) return null;
  const curricula = input?.curricula || {};
  const lessons = input?.lessons || {};
  const lessonIds = [];
  const seen = new Set();

  for (const curriculumCode of definition.curricula) {
    const raw = curricula[curriculumCode] ?? curricula[`curriculum:${curriculumCode}`];
    for (const lessonId of lessonIdsFromCurriculum(raw)) {
      if (seen.has(lessonId)) continue;
      seen.add(lessonId);
      lessonIds.push(lessonId);
    }
  }

  const rows = lessonIds
    .map(lessonId => lessons[lessonId] ?? lessons[`lesson:${lessonId}`])
    .map(record => safeLessonMetadata(record, definition.viewId))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order || left.lessonId.localeCompare(right.lessonId));

  return {
    viewId: definition.viewId,
    subject: definition.subject,
    label: definition.label,
    rank: definition.rank,
    schoolYear: definition.schoolYear,
    stream: definition.stream,
    ...(definition.mathsLevel ? { mathsLevel: definition.mathsLevel } : {}),
    lessonCount: rows.length,
    lessons: rows
  };
}

function compileCatalogueReadModel(input, options = {}) {
  const sourceType = clean(options.sourceType || input?.sourceType || 'unknown');
  const sourceRevision = clean(options.sourceRevision || input?.sourceRevision || '');
  const views = {};
  const orderedViewIds = sortedViewIds(Object.keys(VIEW_DEFINITIONS));
  for (const viewId of orderedViewIds) {
    views[viewId] = compileViewCatalogue(input, viewId);
  }

  const navigation = orderedViewIds.map(viewId => {
    const view = views[viewId];
    return {
      viewId: view.viewId,
      subject: view.subject,
      label: view.label,
      rank: view.rank,
      schoolYear: view.schoolYear,
      stream: view.stream,
      ...(view.mathsLevel ? { mathsLevel: view.mathsLevel } : {}),
      lessonCount: view.lessonCount
    };
  });

  const lessonToViews = {};
  for (const viewId of orderedViewIds) {
    for (const row of views[viewId].lessons) {
      if (!lessonToViews[row.lessonId]) lessonToViews[row.lessonId] = [];
      lessonToViews[row.lessonId].push(viewId);
    }
  }
  for (const lessonId of Object.keys(lessonToViews).sort()) {
    lessonToViews[lessonId] = sortedViewIds(lessonToViews[lessonId]);
  }

  return {
    schemaVersion: 1,
    kind: 'prepared-catalogue',
    source: {
      type: sourceType || 'unknown',
      revision: sourceRevision
    },
    navigation,
    views,
    lessonToViews
  };
}

function assertMetadataOnlyCatalogue(model) {
  const forbidden = /(r2Key|embedUrl|watchUrl|contentUrl|shareUrl|password|token|cookie|email)/i;
  const stack = [model];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) throw new Error(`Prepared catalogue contains forbidden field: ${key}`);
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return true;
}

export {
  rawCatalogueItems,
  lessonIdsFromCurriculum,
  displayLessonId,
  cleanStudentTitle,
  safeLessonMetadata,
  compileViewCatalogue,
  compileCatalogueReadModel,
  assertMetadataOnlyCatalogue
};
