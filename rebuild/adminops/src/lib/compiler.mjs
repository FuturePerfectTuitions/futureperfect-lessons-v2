import {
  compileCatalogueReadModel,
  assertMetadataOnlyCatalogue
} from '../../../shared/read-models/catalogue.mjs';
import {
  compileAccessSnapshot,
  assertNoSensitiveSnapshotFields
} from '../../../shared/read-models/access-snapshot.mjs';
import { compileVideoVariants } from '../../../shared/read-models/video.mjs';
import { collectPhase11ExtensionResources } from '../../../shared/read-models/phase11-extension-resources.mjs';
import { resourcePresentationScopes } from '../../../shared/read-models/resource-visibility.mjs';
import { prepareAccessInputForParity } from './backfill-parity-audit.mjs';

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

function manualSpecialAreas(user) {
  return [...new Set((Array.isArray(user?.manualAccess?.specialBuckets) ? user.manualAccess.specialBuckets : [])
    .map(value => clean(value).toUpperCase())
    .filter(Boolean))].sort();
}

function compileAccessScope(input, catalogue, options = {}) {
  const scopeId = clean(options.scopeId);
  if (!scopeId) throw new Error('An opaque access scopeId is required.');
  const sourceUser = input?.user && typeof input.user === 'object' ? input.user : {};
  const asOfDate = options.asOfDate || input?.asOfDate;
  const normalizedInput = prepareAccessInputForParity({
    ...(input || {}),
    user: {
      ...sourceUser,
      accountStatus: clean(sourceUser.accountStatus || sourceUser.status || 'active') || 'active'
    }
  }, catalogue, { asOfDate });
  const snapshot = compileAccessSnapshot(normalizedInput, catalogue, { asOfDate });
  assertNoSensitiveSnapshotFields(snapshot);
  return {
    schemaVersion: 1,
    kind: 'prepared-access-read-model',
    scopeId,
    manualSpecialAreas: manualSpecialAreas(sourceUser),
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

function mergePresentationScopes(left, right) {
  const combined = new Set([
    ...resourcePresentationScopes(left),
    ...resourcePresentationScopes(right)
  ]);
  if (combined.has('core')) return undefined;
  return [...combined].sort();
}

function deduplicateResources(resources) {
  const byObjectKey = new Map();
  for (const source of resources) {
    const objectKey = clean(source?.objectKey);
    if (!objectKey) continue;
    const existing = byObjectKey.get(objectKey);
    if (!existing) {
      const scopes = resourcePresentationScopes(source);
      byObjectKey.set(objectKey, {
        ...source,
        ...(scopes.length === 1 && scopes[0] === 'core' ? {} : { presentationScopes: scopes })
      });
      continue;
    }
    const presentationScopes = mergePresentationScopes(existing, source);
    const protectedResource = existing.protected === true || source.protected === true;
    const type = protectedResource && (existing.type === 'answer-pack' || source.type === 'answer-pack')
      ? 'answer-pack'
      : (existing.type || source.type);
    byObjectKey.set(objectKey, {
      ...existing,
      type,
      ...(protectedResource ? { protected: true } : {}),
      ...(presentationScopes ? { presentationScopes } : {})
    });
    if (!presentationScopes) delete byObjectKey.get(objectKey).presentationScopes;
  }
  return [...byObjectKey.values()];
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

  resources.push(...collectPhase11ExtensionResources(record));
  return deduplicateResources(resources);
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
    const scopes = resourcePresentationScopes(resource);
    validated.push({
      type: resource.type,
      displayName: resource.displayName,
      objectKey: resource.objectKey,
      ...(resource.protected ? { protected: true } : {}),
      ...(scopes.length === 1 && scopes[0] === 'core' ? {} : { presentationScopes: scopes })
    });
  }

  const videoVariants = compileVideoVariants(record);
  return {
    schemaVersion: 1,
    kind: 'prepared-lesson-detail',
    lessonId,
    title: clean(record.title),
    description: String(record.description || record.desc || ''),
    resourceCount: validated.length + (videoVariants ? 1 : 0),
    resources: validated,
    ...(videoVariants ? { videoVariants } : {})
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
