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

// These two curricula can use curriculum_start_points on the home screen for
// current 11+ Maths missed-lesson previews. Keep their real canonical `order`
// values on /home; all other home calculations need lesson identity only.
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

function cacheNamespace(namespace, cache) {
  return new Proxy(namespace, {
    get(target, prop) {
      if (prop === 'get') {
        return async (key, options) => {
          const wantsJson = options?.type === 'json';
          if (wantsJson && cache.has(key)) return structuredClone(cache.get(key));
          return target.get(key, options);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function cacheEnv(env, cache) {
  const lessonsKv = cacheNamespace(env.LESSONS_KV, cache);
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
        // Downstream home/descriptor logic needs identity, active state and a
        // stable fallback title. `order` is intentionally omitted so the
        // established loader falls back to the curriculum-index position.
        cache.set(lessonKey, { lessonId, title: lessonId, active: true });
      }
    }
  }
}

async function phase11NavigationEnv(env, request) {
  if (!env?.LESSONS_KV || !request) return env;

  const curriculumKeys = PHASE11_CURRICULUM_CODES.map(code => `curriculum:${code}`);
  const cache = await readJsonInBatches(
    env.LESSONS_KV,
    curriculumKeys,
    PHASE11_CURRICULUM_CODES.length
  );

  // The unchanged downstream navigation builder probes all curricula. Seed
  // lightweight request-local lesson records so those probes never trigger a
  // second wave of hundreds of KV reads merely to establish membership/counts.
  seedSyntheticLessons(cache, curriculumKeys);

  const realCurricula = new Set(realCurriculaForRequest(request));
  const realLessonIds = new Set();
  for (const code of realCurricula) {
    const curriculum = cache.get(`curriculum:${code}`);
    if (!curriculum) continue;
    for (const lessonId of lessonIdsFromCurriculum(curriculum)) realLessonIds.add(lessonId);
  }

  // Lesson/resource requests must always receive the real target record even
  // if an unknown or future view id is supplied.
  const targetLessonId = lessonIdFromRequest(request);
  if (targetLessonId) realLessonIds.add(targetLessonId);

  const realValues = await readJsonInBatches(
    env.LESSONS_KV,
    [...realLessonIds].map(id => `lesson:${id}`)
  );
  for (const [key, value] of realValues) cache.set(key, value);

  return cacheEnv(env, cache);
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
  PHASE11_CURRICULUM_CODES,
  HOME_ORDER_SENSITIVE_CURRICULA,
  VIEW_CURRICULA,
  PREFETCH_CONCURRENCY,
  phase11NavigationEnv,
  shouldPrefetchPhase11Navigation
};
