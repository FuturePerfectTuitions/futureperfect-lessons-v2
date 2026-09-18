import assert from 'node:assert/strict';
import { issueSessionToken } from '../rebuild/shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { createQuizRuntime } from '../rebuild/student/src/lib/quiz-runtime.mjs';
import { pointerKey, versionKey, sha256Hex, stableStringify } from '../rebuild/student/src/lib/read-model-resolver.mjs';

const AUTH_SECRET = 'step10-gate-d-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const SCOPE_SECRET = 'step10-gate-d-access-scope-secret-0123456789';
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
  constructor() { this.rows = []; }
  prepare(sql) {
    const db = this;
    const text = String(sql);
    const state = { args: [] };
    return {
      bind(...args) { state.args = args; return this; },
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
    'maths-level3': {
      viewId: 'maths-level3',
      subject: 'maths',
      label: 'L3',
      stream: '11plus',
      mathsLevel: 3,
      lessons: [
        { lessonId: 'L3T1M01', displayLessonId: 'L3T1M01', title: 'Released' },
        { lessonId: 'L3T1M02', displayLessonId: 'L3T1M02', title: 'Blocked' },
        { lessonId: 'NOT-A-CODE', displayLessonId: 'NOT-A-CODE', title: 'Ignored' }
      ]
    }
  }
};

function accessModel({ trial = false, status = 'active', expiresOn = null, lockedPreview = false, current = true, group = 'current', catalogueAvailable = true, subject = 'maths' } = {}) {
  return {
    schemaVersion: 1,
    kind: 'prepared-access-read-model',
    scopeId,
    snapshot: {
      schemaVersion: 1,
      kind: 'prepared-access-snapshot',
      account: { firstName: 'Kiaan', status, expiresOn, trial },
      views: [{
        viewId: 'maths-level3',
        subject,
        label: 'L3',
        current,
        group,
        lockedPreview,
        catalogueAvailable
      }],
      lessonAccess: {
        L3T1M01: { core: true, blocked: false, preLessonOnly: false, sources: ['earned'] },
        L3T1M02: { core: true, blocked: true, preLessonOnly: false, sources: ['earned'] },
        'NOT-A-CODE': { core: true, blocked: false, preLessonOnly: false, sources: ['earned'] }
      }
    }
  };
}

await publish('global', globalModel, 'g1');
await publish(`access:${scopeId}`, accessModel(), 'a1');

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
assert.equal(res.status, 299, 'Non-quiz requests must pass through unchanged.');

res = await call('/api/v2/student/quiz/eligibility', { useCookie: false });
assert.equal(res.status, 401);
let body = await res.json();
assert.equal(body.eligible, false);

res = await call('/api/v2/student/quiz/eligibility');
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.eligible, true);
assert.equal(body.label, '11+ Practice');

res = await call('/api/v2/student/quiz/launch', { method: 'POST', origin: 'https://evil.example' });
assert.equal(res.status, 403);
assert.equal(db.rows.length, 0);

const beforeLaunch = Date.now();
res = await call('/api/v2/student/quiz/launch', { method: 'POST' });
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.ok, true);
assert.match(body.launchUrl, /^https:\/\/quiz\.futureperfect\.education\/launch\?code=/);
assert.equal(db.rows.length, 1);
const row = db.rows[0];
assert.equal(row.portal_user_id_norm, USER);
const rawCode = new URL(body.launchUrl).searchParams.get('code');
assert.ok(rawCode && rawCode.length >= 40);
assert.equal(row.code_hash, await sha256Hex(rawCode));
assert.notEqual(row.code_hash, rawCode);
assert.equal(row.portal_session_token_hash, await sha256Hex(issued.token));
assert.notEqual(row.portal_session_token_hash, issued.token);
assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 90_000);
const context = JSON.parse(row.release_context_json);
assert.deepEqual(context.releasedL3LessonCodes, ['L3T1M01']);
assert.equal(context.source, 'portal-api-v2-live-l3-view-v1');
assert.equal(context.portalSessionIssuer, 'fpt-portal-v2');
assert.equal(context.portalSessionKind, 'session');
assert.equal(context.portalSessionExpiresAt, new Date(issued.session.exp * 1000).toISOString());
assert.equal(context.l3Eligible, true);
assert.equal(context.l2Inherited, true);
assert.equal(context.portalViewId, 'maths-level3');
assert.ok(Date.parse(body.expiresAt) >= beforeLaunch + 89_000);

await publish(`access:${scopeId}`, accessModel({ trial: true }), 'a2');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(res.status, 200);
assert.equal(body.eligible, false, 'Trial must fail closed.');
res = await call('/api/v2/student/quiz/launch', { method: 'POST' });
assert.equal(res.status, 403);
assert.equal(db.rows.length, 1);

await publish(`access:${scopeId}`, accessModel({ lockedPreview: true }), 'a3');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false, 'Locked/upsell L3 preview must fail closed.');

await publish(`access:${scopeId}`, accessModel({ status: 'inactive' }), 'a4');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false, 'Inactive account must fail closed.');

await publish(`access:${scopeId}`, accessModel({ expiresOn: '2026-09-17' }), 'a5');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false, 'Expired account must fail closed.');

await publish(`access:${scopeId}`, accessModel({ current: false }), 'a6');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false, 'Historical/non-current L3 must fail closed.');

await publish(`access:${scopeId}`, accessModel({ group: 'previous' }), 'a7');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false, 'Previous-group L3 must fail closed.');

await publish(`access:${scopeId}`, accessModel({ subject: 'english' }), 'a8');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false, 'English-only 11+ must fail closed.');

await publish(`access:${scopeId}`, accessModel({ catalogueAvailable: false }), 'a9');
res = await call('/api/v2/student/quiz/eligibility');
body = await res.json();
assert.equal(body.eligible, false, 'Unverifiable catalogue must fail closed.');

kv.delete(pointerKey(`access:${scopeId}`));
res = await call('/api/v2/student/quiz/eligibility');
assert.equal(res.status, 503);
body = await res.json();
assert.equal(body.eligible, false, 'Read-model failure must fail closed.');

console.log(JSON.stringify({
  marker: 'STEP10_GATE_D_V2_QUIZ_RUNTIME_TEST_PASS',
  eligibleSessionAccepted: true,
  trialExcluded: true,
  lockedPreviewExcluded: true,
  inactiveExpiredExcluded: true,
  nonCurrentExcluded: true,
  englishOnlyExcluded: true,
  failClosedOnReadModelError: true,
  trustedOriginRequiredForLaunch: true,
  hashedLaunchCodeOnly: true,
  ttlSeconds: 90,
  releaseContext: context.releasedL3LessonCodes
}, null, 2));
