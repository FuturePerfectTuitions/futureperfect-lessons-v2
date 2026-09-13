import {
  compileCatalogueReadModel,
  assertMetadataOnlyCatalogue
} from '../../../shared/read-models/catalogue.mjs';
import {
  compileAccessSnapshot,
  assertNoSensitiveSnapshotFields
} from '../../../shared/read-models/access-snapshot.mjs';

const clean = value => String(value ?? '').trim();

function compileGlobalScope(input, options = {}) {
  const catalogue = compileCatalogueReadModel(input, options);
  assertMetadataOnlyCatalogue(catalogue);
  const counts = Object.fromEntries(
    catalogue.navigation.map(view => [view.viewId, Number(view.lessonCount || 0)])
  );
  return {
    schemaVersion: 1,
    kind: 'prepared-global-read-model',
    source: catalogue.source,
    navigation: catalogue.navigation,
    catalogues: catalogue.views,
    lessonToViews: catalogue.lessonToViews,
    counts
  };
}

function compileAccessScope(input, catalogue, options = {}) {
  const scopeId = clean(options.scopeId);
  if (!scopeId) throw new Error('An opaque access scopeId is required.');
  const snapshot = compileAccessSnapshot(input, catalogue, { asOfDate: options.asOfDate || input?.asOfDate });
  assertNoSensitiveSnapshotFields(snapshot);
  return {
    schemaVersion: 1,
    kind: 'prepared-access-read-model',
    scopeId,
    snapshot
  };
}

function resourceObjectKey(value) {
  if (!value || typeof value !== 'object') return '';
  return clean(value.r2Key || value.r2 || value.objectKey || value.storageKey || value.key);
}

function namedResource(value, fallbackName) {
  if (!value || typeof value !== 'object') return null;
  const objectKey = resourceObjectKey(value);
  if (!objectKey) return null;
  return {
    displayName: clean(value.displayName || value.name || value.title || fallbackName) || fallbackName,
    objectKey
  };
}

function collectLessonResources(record) {
  const core = record?.core && typeof record.core === 'object' ? record.core : {};
  const pre = Array.isArray(record?.preLessonSheets)
    ? record.preLessonSheets
    : (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []);
  const homeworks = Array.isArray(record?.homeworks)
    ? record.homeworks
    : (Array.isArray(core.homeworks) ? core.homeworks : []);
  const other = Array.isArray(record?.otherResources)
    ? record.otherResources
    : (Array.isArray(core.otherResources) ? core.otherResources : []);

  const resources = [];
  pre.forEach((item, index) => {
    const resource = namedResource(item, `PreLesson Sheet ${index + 1}`);
    if (resource) resources.push({ type: 'prelesson', ...resource });
  });
  homeworks.forEach((pair, index) => {
    const homeworkSource = pair?.homework && typeof pair.homework === 'object' ? pair.homework : pair;
    const homework = namedResource(homeworkSource, `Homework ${index + 1}`);
    if (homework) resources.push({ type: 'homework', ...homework });
    const answer = namedResource(pair?.answerPack, `Answer Pack ${index + 1}`);
    if (answer) resources.push({ type: 'answer-pack', protected: true, ...answer });
  });
  other.forEach((item, index) => {
    const resource = namedResource(item, `Resource ${index + 1}`);
    if (resource) resources.push({ type: 'other', ...resource });
  });
  return resources;
}

async function compileLessonDetail(record, options = {}) {
  if (!record || typeof record !== 'object') throw new Error('Lesson record is required.');
  const lessonId = clean(record.lessonId);
  if (!lessonId) throw new Error('Lesson record must have lessonId.');
  const resourceExists = options.resourceExists;
  if (typeof resourceExists !== 'function') throw new Error('resourceExists validator is required.');

  const resources = collectLessonResources(record);
  const validated = [];
  for (const resource of resources) {
    const exists = await resourceExists(resource.objectKey, resource);
    if (!exists) throw new Error(`RESOURCE_MISSING:${lessonId}:${resource.objectKey}`);
    validated.push({
      type: resource.type,
      displayName: resource.displayName,
      objectKey: resource.objectKey,
      ...(resource.protected ? { protected: true } : {})
    });
  }

  return {
    schemaVersion: 1,
    kind: 'prepared-lesson-detail',
    lessonId,
    title: clean(record.title),
    description: String(record.description || record.desc || ''),
    resourceCount: validated.length,
    resources: validated
  };
}

async function compileOperationsBundle(input, options = {}) {
  const global = compileGlobalScope(input.catalogueInput, options.catalogueOptions || {});
  const access = [];
  for (const item of Array.isArray(input.accessInputs) ? input.accessInputs : []) {
    access.push(compileAccessScope(item.input, globalToCatalogue(global), {
      scopeId: item.scopeId,
      asOfDate: item.asOfDate
    }));
  }
  return { global, access };
}

function globalToCatalogue(global) {
  return {
    schemaVersion: 1,
    kind: 'prepared-catalogue',
    source: global.source,
    navigation: global.navigation,
    views: global.catalogues,
    lessonToViews: global.lessonToViews
  };
}

export {
  compileGlobalScope,
  compileAccessScope,
  collectLessonResources,
  compileLessonDetail,
  compileOperationsBundle,
  globalToCatalogue
};
