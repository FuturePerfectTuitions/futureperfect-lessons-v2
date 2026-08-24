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

const PREFETCH_CONCURRENCY = 64;

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

async function phase11NavigationEnv(env) {
  if (!env?.LESSONS_KV) return env;

  const curriculumKeys = PHASE11_CURRICULUM_CODES.map(code => `curriculum:${code}`);
  const cache = await readJsonInBatches(
    env.LESSONS_KV,
    curriculumKeys,
    PHASE11_CURRICULUM_CODES.length
  );
  const lessonIds = [];

  for (const key of curriculumKeys) {
    const curriculum = cache.get(key);
    if (!curriculum) continue;
    lessonIds.push(...lessonIdsFromCurriculum(curriculum));
  }

  const lessonKeys = [...new Set(lessonIds)].map(id => `lesson:${id}`);
  const lessonValues = await readJsonInBatches(env.LESSONS_KV, lessonKeys);
  for (const [key, value] of lessonValues) cache.set(key, value);

  return cacheEnv(env, cache);
}

function shouldPrefetchPhase11Navigation(request) {
  if (request.method !== 'GET') return false;
  const pathname = new URL(request.url).pathname;
  return (
    pathname === '/api/v1/student/home' ||
    /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(pathname) ||
    /^\/api\/v1\/student\/lessons\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/student\/resources\/[^/]+\/(?:video|quiz|download)$/.test(pathname)
  );
}

export {
  PHASE11_CURRICULUM_CODES,
  PREFETCH_CONCURRENCY,
  phase11NavigationEnv,
  shouldPrefetchPhase11Navigation
};
