import assert from 'node:assert/strict';
import { issueSessionToken } from '../rebuild/shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { createQuizRuntime, completedL3ProfileEligible } from '../rebuild/student/src/lib/quiz-runtime.mjs';
import { pointerKey, versionKey, sha256Hex, stableStringify } from '../rebuild/student/src/lib/read-model-resolver.mjs';

const AUTH_SECRET = 'completed-l3-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const SCOPE_SECRET = 'completed-l3-scope-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const USER = 'aar1811';
const ORIGIN = 'https://lessons.futureperfect.education';
const NOW = Date.now();

class KV {
  constructor() { this.values = new Map(); }
  async get(key, options) {
    const value = this.values.get(key) ?? null;
    if (value == null) return null;
    return options?.type === 'json' && typeof value === 'string' ? JSON.parse(value) : value;
  }
  put(key, value) { this.values.set(key, value); }
}

class D1 {
  constructor() { this.active = false; this.rows = []; }
  prepare(sql) {
    const db = this;
    const text = String(sql);
    const state = { args: [] };
    return {
      bind(...args) { state.args = args; return this; },
      async all() {
        assert.match(text, /student_batch_assignments/i);
        return db.active
          ? { results: [{ assignment_id: 3001, maths_level: 3, effective_from: '2026-09-01' }] }
          : { results: [] };
      },
      async run() {
        assert.match(text, /INSERT INTO quiz_launch_codes/i);
        const [code_hash, portal_user_id_norm, portal_session_token_hash, release_context_json, created_at, expires_at] = state.args;
        db.rows.push({ code_hash, portal_user_id_norm, portal_session_token_hash, release_context_json, created_at, expires_at });
        return { meta: { changes: 1 } };
      }
    };
  }
}

async function publish(kv, scope, payload, version) {
  const sha256 = await sha256Hex(stableStringify(payload));
  const envelope = { schemaVersion: 1, kind: 'prepared-read-model-envelope', scope, version, sha256, payload };
  kv.put(versionKey(scope, version), JSON.stringify(envelope));
  kv.put(pointerKey(scope), JSON.stringify({ schemaVersion: 1, kind: 'prepared-read-model-pointer', scope, current: { version, sha256 }, previous: null }));
}

const readModels = new KV();
const students = new KV();
const db = new D1();
const scopeId = await opaqueAccessScopeId(USER, SCOPE_SECRET);

await publish(readModels, 'global', {
  schemaVersion: 1,
  kind: 'prepared-global-read-model',
  catalogues: {
    'maths-level3': {
      viewId: 'maths-level3', subject: 'maths', stream: '11plus', mathsLevel: 3,
      lessons: [
        { lessonId: 'L3T1M01', displayLessonId: 'L3T1M01' },
        { lessonId: 'L3T1M02', displayLessonId: 'L3T1M02' }
      ]
    }
  }
}, 'g1');

await publish(readModels, `access:${scopeId}`, {
  schemaVersion: 1,
  kind: 'prepared-access-read-model',
  scopeId,
  snapshot: {
    schemaVersion: 1,
    kind: 'prepared-access-snapshot',
    account: { firstName: 'Aarav', status: 'active', trial: false },
    views: [{ viewId: 'maths-level3', subject: 'maths', current: true, group: 'current', lockedPreview: false, catalogueAvailable: true }],
    lessonAccess: {
      L3T1M01: { core: true, blocked: false, preLessonOnly: false },
      L3T1M02: { core: true, blocked: true, preLessonOnly: false }
    }
  }
}, 'a1');

const issued = await issueSessionToken({ secret: AUTH_SECRET, userId: USER, now: NOW });
const cookie = `fpt_session=${issued.token}`;
const env = {
  AUTH_SIGNING_SECRET: AUTH_SECRET,
  ACCESS_SCOPE_SECRET: SCOPE_SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  READ_MODELS_KV: readModels,
  STUDENTS_KV: students,
  DB: db
};
const runtime = createQuizRuntime({ async fetch() { return new Response('next', { status: 299 }); } });

async function call(path, method = 'GET') {
  return runtime.fetch(new Request(new URL(path, ORIGIN), { method, headers: { origin: ORIGIN, cookie } }), env);
}

assert.equal(completedL3ProfileEligible({ fullLibraries: ['MATHS_L3_FULL'], specialAccess: ['MATHS_11PLUS_QUIZ_L3_COMPLETED'] }), true);
assert.equal(completedL3ProfileEligible({ fullLibraries: ['MATHS_L3_FULL'], specialAccess: [] }), false);
assert.equal(completedL3ProfileEligible({ fullLibraries: [], specialAccess: ['MATHS_11PLUS_QUIZ_L3_COMPLETED'] }), false);

students.put(`user:${USER}`, JSON.stringify({ fullLibraries: ['MATHS_L3_FULL'], specialAccess: [] }));
let response = await call('/api/v2/student/quiz/eligibility');
let body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.eligible, false, 'Completed-L3 fallback must fail closed without explicit special-access marker.');

students.put(`user:${USER}`, JSON.stringify({ fullLibraries: [], specialAccess: ['MATHS_11PLUS_QUIZ_L3_COMPLETED'] }));
response = await call('/api/v2/student/quiz/eligibility');
body = await response.json();
assert.equal(body.eligible, false, 'Marker alone must not grant L3 Quiz access without MATHS_L3_FULL.');

students.put(`user:${USER}`, JSON.stringify({ fullLibraries: ['MATHS_L3_FULL'], specialAccess: ['MATHS_11PLUS_QUIZ_L3_COMPLETED'] }));
response = await call('/api/v2/student/quiz/eligibility');
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.eligible, true);
assert.equal(body.currentLevel, 'L3');

response = await call('/api/v2/student/quiz/launch', 'POST');
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.ok, true);
assert.equal(db.rows.length, 1);
let context = JSON.parse(db.rows[0].release_context_json);
assert.equal(context.currentLevel, 'L3');
assert.equal(context.eligibilityMode, 'completed-l3');
assert.equal(Object.hasOwn(context, 'portalAssignmentId'), false);
assert.deepEqual(context.releasedL3LessonCodes, ['L3T1M01']);
assert.deepEqual(context.releasedL2LessonCodes, []);
assert.deepEqual(context.inheritedLevels, ['L2']);
assert.equal(context.portalViewId, 'maths-level3');

// Existing active-L3 behaviour remains assignment-authoritative and keeps the legacy release-context shape.
db.active = true;
students.put(`user:${USER}`, JSON.stringify({ fullLibraries: [], specialAccess: [] }));
response = await call('/api/v2/student/quiz/eligibility');
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.eligible, true);
assert.equal(body.currentLevel, 'L3');
response = await call('/api/v2/student/quiz/launch', 'POST');
assert.equal(response.status, 200);
context = JSON.parse(db.rows[1].release_context_json);
assert.equal(context.portalAssignmentId, 3001);
assert.equal(Object.hasOwn(context, 'eligibilityMode'), false);

console.log(JSON.stringify({
  marker: 'COMPLETED_L3_V2_QUIZ_RUNTIME_PASS',
  explicitMarkerRequired: true,
  l3FullLibraryRequired: true,
  completedL3LaunchContext: true,
  activeAssignmentBehaviourPreserved: true
}, null, 2));
