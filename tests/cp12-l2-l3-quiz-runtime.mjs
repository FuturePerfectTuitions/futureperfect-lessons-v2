import assert from 'node:assert/strict';
import { issueSessionToken } from '../rebuild/shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { createQuizRuntime } from '../rebuild/student/src/lib/quiz-runtime.mjs';
import { pointerKey, versionKey, sha256Hex, stableStringify } from '../rebuild/student/src/lib/read-model-resolver.mjs';

const AUTH_SECRET = 'cp12-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const SCOPE_SECRET = 'cp12-access-scope-secret-0123456789';
const USER = 'kiaan1312';
const ORIGIN = 'https://lessons.futureperfect.education';
const NOW = Date.now();

class KV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  put(key, value) { this.values.set(key, value); }
  delete(key) { this.values.delete(key); }
}

class D1 {
  constructor() {
    this.rows = [];
    this.currentLevel = 'L3';
    this.ambiguous = false;
  }
  prepare(sql) {
    const db = this;
    const text = String(sql);
    const state = { args: [] };
    return {
      bind(...args) { state.args = args; return this; },
      async all() {
        assert.match(text, /student_batch_assignments/i);
        if (db.ambiguous) {
          return { results: [
            { assignment_id: 3001, maths_level: 3, effective_from: '2026-09-01' },
            { assignment_id: 2001, maths_level: 2, effective_from: '2026-09-01' }
          ] };
        }
        const mathsLevel = db.currentLevel === 'L2' ? 2 : 3;
        return { results: [{ assignment_id: mathsLevel === 2 ? 2001 : 3001, maths_level: mathsLevel, effective_from: '2026-09-01' }] };
      },
      async run() {
        assert.match(text, /INSERT INTO quiz_launch_codes/i);
        const [code_hash, portal_user_id_norm, portal_session_token_hash, release_context_json, created_at, expires_at] = state.args;
        db.rows.push({ code_hash, portal_user_id_norm, portal_session_token_hash, release_context_json, created_at, expires_at, used_at: null });
        return { meta: { changes: 1 } };
      }
    };
  }
}

const kv = new KV();
const db = new D1();
const scopeId = await opaqueAccessScopeId(USER, SCOPE_SECRET);

async function publish(scope, payload, version) {
  const sha256 = await sha256Hex(stableStringify(payload));
  const envelope = { schemaVersion: 1, kind: 'prepared-read-model-envelope', scope, version, sha256, payload };
  kv.put(versionKey(scope, version), JSON.stringify(envelope));
  kv.put(pointerKey(scope), JSON.stringify({ schemaVersion: 1, kind: 'prepared-read-model-pointer', scope, current: { version, sha256 }, previous: null }));
}

const globalModel = {
  schemaVersion: 1,
  kind: 'prepared-global-read-model',
  catalogues: {
    'maths-level2': {
      viewId: 'maths-level2', subject: 'maths', label: 'L2', stream: '11plus', mathsLevel: 2,
      lessons: [
        { lessonId: 'L2T1M01', displayLessonId: 'L2T1M01', title: 'Released L2' },
        { lessonId: 'L2T1M02', displayLessonId: 'L2T1M02', title: 'Blocked L2' }
      ]
    },
    'maths-level3': {
      viewId: 'maths-level3', subject: 'maths', label: 'L3', stream: '11plus', mathsLevel: 3,
      lessons: [
        { lessonId: 'L3T1M01', displayLessonId: 'L3T1M01', title: 'Released L3' },
        { lessonId: 'L3T1M02', displayLessonId: 'L3T1M02', title: 'Blocked L3' }
      ]
    }
  }
};

function accessModel(level = 'L3', { trial = false, status = 'active', expiresOn = null, lockedPreview = false, current = true, group = 'current', catalogueAvailable = true, subject = 'maths' } = {}) {
  const n = level === 'L2' ? 2 : 3;
  const prefix = `L${n}T1M`;
  return {
    schemaVersion: 1,
    kind: 'prepared-access-read-model',
    scopeId,
    snapshot: {
      schemaVersion: 1,
      kind: 'prepared-access-snapshot',
      account: { firstName: 'Kiaan', status, expiresOn, trial },
      views: [{
        viewId: `maths-level${n}`,
        subject,
        label: `L${n}`,
        current,
        group,
        lockedPreview,
        catalogueAvailable
      }],
      lessonAccess: {
        [`${prefix}01`]: { core: true, blocked: false, preLessonOnly: false, sources: ['earned'] },
        [`${prefix}02`]: { core: true, blocked: true, preLessonOnly: false, sources: ['earned'] }
      }
    }
  };
}

await publish('global', globalModel, 'g1');
await publish(`access:${scopeId}`, accessModel('L3'), 'a1');

const issued = await issueSessionToken({ secret: AUTH_SECRET, userId: USER, now: NOW });
const cookie = `fpt_session=${issued.token}`;
const env = {
  AUTH_SIGNING_SECRET: AUTH_SECRET,
  ACCESS_SCOPE_SECRET: SCOPE_SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  READ_MODELS_KV: kv,
  DB: db
};
const nextRuntime = { async fetch() { return new Response('next', { status: 299 }); } };
const runtime = createQuizRuntime(nextRuntime);

async function call(path, { method = 'GET', origin = ORIGIN, useCookie = true } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (useCookie) headers.cookie = cookie;
  return runtime.fetch(new Request(new URL(path, ORIGIN), { method, headers }), env);
}

let res = await call('/not-quiz');
assert.equal(res.status, 299);

res = await call('/api/v2/student/quiz/eligibility', { useCookie: false });
assert.equal(res.status, 401);
let body = await res.json();
assert.equal(body.eligible, false);

res = await call('/api/v2/student/quiz/eligibility');
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.eligible, true);
assert.equal(body.currentLevel, 'L3');

res = await call('/api/v2/student/quiz/launch', { method: 'POST', origin: 'https://evil.example' });
assert.equal(res.status, 403);
assert.equal(db.rows.length, 0);

res = await call('/api/v2/student/quiz/launch', { method: 'POST' });
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.ok, true);
assert.equal(db.rows.length, 1);
let row = db.rows[0];
assert.equal(row.portal_user_id_norm, USER);
let rawCode = new URL(body.launchUrl).searchParams.get('code');
assert.equal(row.code_hash, await sha256Hex(rawCode));
assert.equal(row.portal_session_token_hash, await sha256Hex(issued.token));
assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 90_000);
let context = JSON.parse(row.release_context_json);
assert.equal(context.policyVersion, 'quiz-release-context-v2.0');
assert.equal(context.source, 'portal-live-maths11plus-release-v2');
assert.equal(context.currentLevel, 'L3');
assert.deepEqual(context.releasedL2LessonCodes, []);
assert.deepEqual(context.releasedL3LessonCodes, ['L3T1M01']);
assert.deepEqual(context.inheritedLevels, ['L2']);
assert.equal(context.portalAssignmentId, 3001);
assert.equal(context.portalSessionIssuer, 'fpt-portal-v2');
assert.equal(context.portalSessionKind, 'session');
assert.ok(Date.parse(context.generatedAt));
assert.ok(Date.parse(context.portalSessionExpiresAt));

// L2 must keep the same student identity/history key but only expose actually released L2 content.
db.currentLevel = 'L2';
await publish(`access:${scopeId}`, accessModel('L2'), 'a2');
res = await call('/api/v2/student/quiz/eligibility');
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.eligible, true);
assert.equal(body.currentLevel, 'L2');
res = await call('/api/v2/student/quiz/launch', { method: 'POST' });
assert.equal(res.status, 200);
assert.equal(db.rows.length, 2);
row = db.rows[1];
assert.equal(row.portal_user_id_norm, USER, 'L2/L3 transition must preserve the same Quiz student identity.');
context = JSON.parse(row.release_context_json);
assert.equal(context.currentLevel, 'L2');
assert.deepEqual(context.releasedL2LessonCodes, ['L2T1M01']);
assert.deepEqual(context.releasedL3LessonCodes, []);
assert.deepEqual(context.inheritedLevels, []);
assert.equal(context.portalAssignmentId, 2001);

// Fail closed on contradictory simultaneous active L2/L3 assignments.
db.ambiguous = true;
res = await call('/api/v2/student/quiz/eligibility');
assert.equal(res.status, 503);
db.ambiguous = false;

// Trial, inactive, locked-preview and stale read model must remain excluded/fail closed.
await publish(`access:${scopeId}`, accessModel('L2', { trial: true }), 'a3');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(res.status, 200);
assert.equal(body.eligible, false);

await publish(`access:${scopeId}`, accessModel('L2', { lockedPreview: true }), 'a4');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false);

await publish(`access:${scopeId}`, accessModel('L2', { status: 'inactive' }), 'a5');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false);

kv.delete(pointerKey(`access:${scopeId}`));
res = await call('/api/v2/student/quiz/eligibility');
assert.equal(res.status, 503);
body = await res.json();
assert.equal(body.eligible, false);

console.log(JSON.stringify({
  marker: 'CP12_L2_L3_SIGNED_PORTAL_QUIZ_RUNTIME_PASS',
  signedPortalSession: true,
  activeAssignmentAuthority: true,
  l2ReleasedOnly: true,
  l3FullL2Inheritance: true,
  sameStudentIdentityAcrossLevels: true,
  ambiguousLevelFailsClosed: true,
  trustedOriginRequiredForLaunch: true,
  hashedLaunchCodeOnly: true,
  ttlSeconds: 90
}, null, 2));
