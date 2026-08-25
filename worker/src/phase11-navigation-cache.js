import { PHASE11_NAVIGATION_MANIFEST } from './phase11-navigation-manifest.generated.js';

const PHASE11_CATALOGUE_SHA256 = '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663';
const PHASE11_CURRICULUM_CODES = Object.freeze([
  'MATHS_Y2',
  'MATHS_Y3',
  'MATHS_L1',
  'MATHS_L2',
  'MATHS_L3',
  'MATHS_Y6_EXTRA',
  'ENGLISH_Y2',
  'ENGLISH_Y3',
  'ENGLISH_Y4',
  'ENGLISH_Y5',
  'ENGLISH_Y6'
]);

// Retained for fail-safe legacy fallback and as a deployed feature marker.
const HOME_ORDER_SENSITIVE_CURRICULA = Object.freeze(['MATHS_L2', 'MATHS_L3']);
const PREFETCH_CONCURRENCY = 64;

const VIEW_CURRICULA = Object.freeze({
  'maths-year2': ['MATHS_Y2'],
  'maths-year3': ['MATHS_Y3'],
  'maths-year4': ['MATHS_L1'],
  'maths-level1': ['MATHS_L1'],
  'maths-year5': ['MATHS_L2'],
  'maths-level2': ['MATHS_L2'],
  'maths-level3': ['MATHS_L3'],
  'maths-year6': ['MATHS_L3', 'MATHS_Y6_EXTRA'],
  'english-year2': ['ENGLISH_Y2'],
  'english-year3': ['ENGLISH_Y3'],
  'english-year4': ['ENGLISH_Y4'],
  'english-year4-11plus': ['ENGLISH_Y4'],
  'english-year5': ['ENGLISH_Y5'],
  'english-year5-11plus': ['ENGLISH_Y5'],
  'english-year6': ['ENGLISH_Y6']
});

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
    .map(item => typeof item === 'string' ? item : String(item?.lessonId || '').trim())
    .filter(Boolean);
}

async function readJsonInBatches(namespace, keys, batchSize = PREFETCH_CONCURRENCY) {
  const values = new Map();
  const clean = [...new Set(keys.filter(Boolean))];

  for (let offset = 0; offset < clean.length; offset += batchSize) {
    const batch = clean.slice(offset, offset + batchSize);
    const rows = await Promise.all(
      batch.map(async key => [key, await namespace.get(key, { type: 'json' })])
    );
    for (const [key, value] of rows) {
      if (value != null) values.set(key, value);
    }
  }

  return values;
}

function validBundledManifest(manifest = PHASE11_NAVIGATION_MANIFEST) {
  if (!manifest || typeof manifest !== 'object') return false;
  if (manifest.catalogueSha256 !== PHASE11_CATALOGUE_SHA256) return false;
  if (!manifest.curricula || !manifest.lessons) return false;
  if (Object.keys(manifest.curricula).length !== 11) return false;
  if (Object.keys(manifest.lessons).length !== 369) return false;
  return PHASE11_CURRICULUM_CODES.every(code => {
    const curriculum = manifest.curricula[code];
    return curriculum?.curriculumCode === code && Array.isArray(curriculum.lessonIds);
  });
}

const BUNDLED_MANIFEST_VALID = validBundledManifest();

function bundledJsonValue(key) {
  if (!BUNDLED_MANIFEST_VALID || typeof key !== 'string') return undefined;
  if (key.startsWith('curriculum:')) {
    return PHASE11_NAVIGATION_MANIFEST.curricula[key.slice('curriculum:'.length)];
  }
  if (key.startsWith('lesson:')) {
    return PHASE11_NAVIGATION_MANIFEST.lessons[key.slice('lesson:'.length)];
  }
  return undefined;
}

function cacheNamespace(namespace, overrides = new Map(), bundled = false) {
  return new Proxy(namespace, {
    get(target, prop) {
      if (prop === 'get') {
        return async (key, options) => {
          const wantsJson = options?.type === 'json';
          if (wantsJson && overrides.has(key)) return structuredClone(overrides.get(key));
          if (wantsJson && bundled) {
            const value = bundledJsonValue(key);
            if (value !== undefined) return structuredClone(value);
          }
          return target.get(key, options);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function cacheEnv(env, overrides = new Map(), bundled = false) {
  const lessonsKv = cacheNamespace(env.LESSONS_KV, overrides, bundled);
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'LESSONS_KV') return lessonsKv;
      return target[prop];
    }
  });
}

function viewIdFromRequest(request) {
  const url = new URL(request.url);
  const viewMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (viewMatch) {
    try { return decodeURIComponent(viewMatch[1]).toLowerCase(); } catch { return ''; }
  }
  return String(url.searchParams.get('viewId') || '').trim().toLowerCase();
}

function lessonIdFromRequest(request) {
  const url = new URL(request.url);
  const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
  if (lessonMatch) {
    try { return decodeURIComponent(lessonMatch[1]); } catch { return ''; }
  }

  const resourceMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)(?:\/.*)?$/);
  if (!resourceMatch) return '';
  let resourceKey = '';
  try { resourceKey = decodeURIComponent(resourceMatch[1]); } catch { return ''; }
  const encodedLessonId = String(resourceKey.split('~')[0] || '');
  try { return decodeURIComponent(encodedLessonId); } catch { return encodedLessonId; }
}

function realCurriculaForRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/api/v1/student/home') {
    return [...HOME_ORDER_SENSITIVE_CURRICULA];
  }

  const viewId = viewIdFromRequest(request);
  if (!viewId) return [...PHASE11_CURRICULUM_CODES];
  const selected = VIEW_CURRICULA[viewId];
  return selected ? [...selected] : [...PHASE11_CURRICULUM_CODES];
}

function seedSyntheticLessons(cache, curriculumKeys) {
  for (const key of curriculumKeys) {
    const curriculum = cache.get(key);
    if (!curriculum) continue;
    for (const lessonId of lessonIdsFromCurriculum(curriculum)) {
      const lessonKey = `lesson:${lessonId}`;
      if (!cache.has(lessonKey)) {
        cache.set(lessonKey, { lessonId, title: lessonId, active: true });
      }
    }
  }
}

async function legacyTargetedNavigationEnv(env, request) {
  const curriculumKeys = PHASE11_CURRICULUM_CODES.map(code => `curriculum:${code}`);
  const cache = await readJsonInBatches(
    env.LESSONS_KV,
    curriculumKeys,
    PHASE11_CURRICULUM_CODES.length
  );
  seedSyntheticLessons(cache, curriculumKeys);

  const realCurricula = new Set(realCurriculaForRequest(request));
  const realLessonIds = new Set();
  for (const code of realCurricula) {
    const curriculum = cache.get(`curriculum:${code}`);
    if (!curriculum) continue;
    for (const lessonId of lessonIdsFromCurriculum(curriculum)) realLessonIds.add(lessonId);
  }
  const targetLessonId = lessonIdFromRequest(request);
  if (targetLessonId) realLessonIds.add(targetLessonId);

  const realValues = await readJsonInBatches(
    env.LESSONS_KV,
    [...realLessonIds].map(id => `lesson:${id}`)
  );
  for (const [key, value] of realValues) cache.set(key, value);
  return cacheEnv(env, cache, false);
}

async function phase11NavigationEnv(env, request) {
  if (!env?.LESSONS_KV || !request) return env;

  // Normal Phase 11 path: identity/order/title/display metadata remains
  // module-resident in the deterministic canonical manifest. The proxy clones
  // only the records downstream code actually requests; it does not rebuild or
  // clone the complete 380-record navigation catalogue per invocation.
  if (BUNDLED_MANIFEST_VALID) {
    const overrides = new Map();
    const targetLessonId = lessonIdFromRequest(request);
    if (targetLessonId) {
      const real = await env.LESSONS_KV.get(`lesson:${targetLessonId}`, { type: 'json' });
      if (real != null) overrides.set(`lesson:${targetLessonId}`, real);
    }
    return cacheEnv(env, overrides, true);
  }

  // Fail-safe only: an accidental/manual build that did not generate the
  // canonical manifest preserves the previously verified targeted KV behavior
  // rather than trusting stale or incomplete metadata.
  return legacyTargetedNavigationEnv(env, request);
}

function shouldPrefetchPhase11Navigation(request) {
  if (request.method !== 'GET') return false;
  const pathname = new URL(request.url).pathname;
  return (
    pathname === '/api/v1/student/home' ||
    /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(pathname) ||
    /^\/api\/v1\/student\/lessons\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/student\/resources\/[^/]+(?:\/(?:video|quiz|download))?$/.test(pathname)
  );
}

export {
  PHASE11_CATALOGUE_SHA256,
  PHASE11_CURRICULUM_CODES,
  HOME_ORDER_SENSITIVE_CURRICULA,
  VIEW_CURRICULA,
  PREFETCH_CONCURRENCY,
  validBundledManifest,
  phase11NavigationEnv,
  shouldPrefetchPhase11Navigation
};
