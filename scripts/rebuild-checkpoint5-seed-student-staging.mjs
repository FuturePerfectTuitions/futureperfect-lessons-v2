import fs from 'node:fs';
import {
  stableStringify,
  publishScopeAtomic,
  resolveCurrentScope
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';
import {
  compileAccessScope,
  globalToCatalogue
} from '../rebuild/adminops/src/lib/compiler.mjs';

const evidencePath = process.argv[2] || '/tmp/rebuild-checkpoint5-student-access.json';
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const readModelsNamespaceId = String(process.env.READ_MODELS_KV_NAMESPACE_ID || '').trim();
const expectedNamespaceTitle = String(process.env.READ_MODELS_KV_TITLE || 'FPT_PORTAL_V2_REBUILD_READ_MODELS_STAGING').trim();
const scopeId = 'u-917b05289ef8fa1f2c7bb6369bff9cbd2a59cd3c';
const asOfDate = '2026-09-13';

if (!token || !accountId || !readModelsNamespaceId) {
  throw new Error('Cloudflare account/token and staging read-model KV namespace ID are required.');
}

async function cfJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || body?.success === false) {
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}.`);
  }
  return body;
}

await (async () => {
  const body = await cfJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${readModelsNamespaceId}`
  );
  if (String(body?.result?.id || '') !== readModelsNamespaceId) {
    throw new Error('Read-model KV namespace identity could not be confirmed.');
  }
  if (expectedNamespaceTitle && String(body?.result?.title || '') !== expectedNamespaceTitle) {
    throw new Error('Read-model KV namespace is not the isolated staging namespace.');
  }
})();

function kvValueUrl(key) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${readModelsNamespaceId}/values/${encodeURIComponent(key)}`;
}

const store = {
  async get(key) {
    const response = await fetch(kvValueUrl(key), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Read-model KV read failed with HTTP ${response.status}.`);
    return response.text();
  },
  async put(key, value) {
    const response = await fetch(kvValueUrl(key), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8'
      },
      body: String(value)
    });
    if (!response.ok) throw new Error(`Read-model KV write failed with HTTP ${response.status}.`);
  }
};

const globalResolved = await resolveCurrentScope(store, 'global');
if (globalResolved?.payload?.kind !== 'prepared-global-read-model') {
  throw new Error('Staging global read model is unavailable or invalid.');
}
const year5Lessons = globalResolved.payload?.catalogues?.['maths-year5']?.lessons || [];
if (year5Lessons.length < 3) {
  throw new Error('Checkpoint 5 requires at least three Year 5 maths catalogue lessons.');
}
const [fullLessonId, preLessonId, blockedLessonId] = year5Lessons.slice(0, 3).map(row => String(row?.lessonId || '').trim());
if (!fullLessonId || !preLessonId || !blockedLessonId) {
  throw new Error('Checkpoint 5 could not resolve three deterministic Year 5 lesson IDs.');
}

const fixture = {
  asOfDate,
  user: {
    firstName: 'Checkpoint5',
    accountStatus: 'active',
    fullLibraries: [],
    blockedLessons: [blockedLessonId],
    upsellViews: ['maths-level2'],
    specialAccess: ['CP5_SYNTHETIC_AREA'],
    manualAccess: { coreLessons: [], vrLessons: [], specialBuckets: [] }
  },
  batchAssignments: [
    {
      assignment_id: 5001,
      portal_user_id_norm: 'cp5synthetic',
      batch_key: 'CP5-Y5M',
      effective_from: '2026-09-01',
      effective_to: null,
      subject: 'maths',
      school_year: 5,
      stream: 'normal',
      maths_level: null,
      batch_active_from: '2026-09-01',
      batch_active_to: null
    },
    {
      assignment_id: 5002,
      portal_user_id_norm: 'cp5synthetic',
      batch_key: 'CP5-Y4M-HISTORY',
      effective_from: '2025-09-01',
      effective_to: '2026-08-31',
      subject: 'maths',
      school_year: 4,
      stream: 'normal',
      maths_level: null,
      batch_active_from: '2025-09-01',
      batch_active_to: '2026-08-31'
    }
  ],
  batchDefinitions: [
    { batch_key:'CP5-Y5M', academic_year:'2026-27', subject:'maths', school_year:5, stream:'normal', maths_level:null, active_from:'2026-09-01', active_to:null },
    { batch_key:'CP5-Y4M-HISTORY', academic_year:'2025-26', subject:'maths', school_year:4, stream:'normal', maths_level:null, active_from:'2025-09-01', active_to:'2026-08-31' }
  ],
  entitlements: [
    { portal_user_id_norm:'cp5synthetic', lesson_id:fullLessonId, core_access:1, vr_access:0, source_batch_code:'CP5-Y5M', source_lesson_date:'2026-09-10' },
    { portal_user_id_norm:'cp5synthetic', lesson_id:blockedLessonId, core_access:1, vr_access:0, source_batch_code:'CP5-Y5M', source_lesson_date:'2026-09-11' }
  ],
  onlinePreLessonEntitlements: [
    { portal_user_id_norm:'cp5synthetic', lesson_id:preLessonId, batch_key:'CP5-Y5M', lesson_date:'2026-09-15', vr_access:0 }
  ]
};

const access = compileAccessScope(fixture, globalToCatalogue(globalResolved.payload), { scopeId, asOfDate });
const viewsById = Object.fromEntries((access.snapshot?.views || []).map(view => [view.viewId, view]));
if (viewsById['maths-year5']?.current !== true || viewsById['maths-year5']?.lockedPreview === true) {
  throw new Error('Synthetic fixture did not compile Year 5 Maths as current open view.');
}
if (viewsById['maths-year4']?.group !== 'previous') {
  throw new Error('Synthetic fixture did not compile Year 4 Maths as previous history.');
}
if (viewsById['maths-level2']?.lockedPreview !== true) {
  throw new Error('Synthetic fixture did not compile L2 as locked preview.');
}
if (access.snapshot?.lessonAccess?.[fullLessonId]?.core !== true) throw new Error('Full lesson fixture did not compile as core access.');
if (access.snapshot?.lessonAccess?.[preLessonId]?.preLessonOnly !== true) throw new Error('PreLesson fixture did not compile as PreLesson-only access.');
if (access.snapshot?.lessonAccess?.[blockedLessonId]?.blocked !== true || access.snapshot?.lessonAccess?.[blockedLessonId]?.core !== false) {
  throw new Error('Blocked lesson did not override entitlement access.');
}
if (!Array.isArray(access.snapshot?.specialAreas) || !access.snapshot.specialAreas.includes('CP5_SYNTHETIC_AREA')) {
  throw new Error('Synthetic special area fixture did not compile.');
}

const version = `a-cp5-${globalResolved.sha256.slice(0, 12)}-${Date.now()}`;
const published = await publishScopeAtomic(store, {
  scope: `access:${scopeId}`,
  payload: access,
  version,
  updatedAt: new Date().toISOString()
});
const resolved = await resolveCurrentScope(store, `access:${scopeId}`);
if (resolved.version !== published.version || resolved.sha256 !== published.payloadSha256) {
  throw new Error('Checkpoint 5 synthetic access model did not resolve to the newly published version.');
}

const evidence = {
  marker: 'REBUILD_CHECKPOINT5_SYNTHETIC_ACCESS_PASS',
  fixture: 'synthetic-only',
  studentIdentityDisclosed: false,
  scopeId,
  asOfDate,
  globalVersion: globalResolved.version,
  globalSha256: globalResolved.sha256,
  accessVersion: published.version,
  accessSha256: published.payloadSha256,
  accessPayloadBytes: Buffer.byteLength(stableStringify(access)),
  fullLessonId,
  preLessonId,
  blockedLessonId,
  expectedViews: {
    current: 'maths-year5',
    previous: 'maths-year4',
    lockedPreview: 'maths-level2'
  },
  specialArea: 'CP5_SYNTHETIC_AREA',
  ordinaryTo11PlusWidening: false,
  productionMutationPerformed: false
};
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(evidence));
