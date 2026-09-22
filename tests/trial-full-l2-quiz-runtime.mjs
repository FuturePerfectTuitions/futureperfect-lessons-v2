import assert from 'node:assert/strict';
import { issueSessionToken } from '../rebuild/shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { createTrialQuizRuntime, TRIAL_11PLUS_VIEWS } from '../rebuild/student/src/lib/trial-quiz-runtime.mjs';
import { pointerKey, versionKey, sha256Hex, stableStringify } from '../rebuild/student/src/lib/read-model-resolver.mjs';

const AUTH_SECRET = 'trial-quiz-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const SCOPE_SECRET = 'trial-quiz-scope-secret-0123456789';
const USER = 'trialeva';
const ORIGIN = 'https://lessons.futureperfect.education';
const NOW = Date.now();

class KV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  put(key, value) { this.values.set(key, value); }
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
        db.rows.push({ code_hash, portal_user_id_norm, portal_session_token_hash, release_context_json, created_at, expires_at, used_at:null });
        return { meta:{ changes:1 } };
      }
    };
  }
}

const kv = new KV();
const db = new D1();
const scopeId = await opaqueAccessScopeId(USER, SCOPE_SECRET);

async function publish(scope, payload, version) {
  const sha256 = await sha256Hex(stableStringify(payload));
  const envelope = { schemaVersion:1, kind:'prepared-read-model-envelope', scope, version, sha256, payload };
  kv.put(versionKey(scope, version), JSON.stringify(envelope));
  kv.put(pointerKey(scope), JSON.stringify({ schemaVersion:1, kind:'prepared-read-model-pointer', scope, current:{ version, sha256 }, previous:null }));
}

const globalModel = {
  schemaVersion:1,
  kind:'prepared-global-read-model',
  catalogues:{
    'maths-level2':{
      viewId:'maths-level2', subject:'maths', label:'L2', stream:'11plus', mathsLevel:2,
      lessons:[
        { lessonId:'L2T1M01', displayLessonId:'L2T1M01', title:'L2 first' },
        { lessonId:'L2T1M02', displayLessonId:'L2T1M02', title:'L2 second' }
      ]
    }
  }
};

function accessModel(trialViews, { trial = true } = {}) {
  return {
    schemaVersion:1,
    kind:'prepared-access-read-model',
    scopeId,
    snapshot:{
      schemaVersion:1,
      kind:'prepared-access-snapshot',
      account:{ firstName:'Eva', status:'active', expiresOn:null, trial, trialViews },
      views:trialViews.map(viewId => ({ viewId, current:true, group:'current', lockedPreview:false, catalogueAvailable:true })),
      // Deliberately block one L2 lesson here. Trial Quiz authority is full-L2
      // demonstration, not the Trial lesson-resource release state.
      lessonAccess:{
        L2T1M01:{ core:true, blocked:false, preLessonOnly:false, sources:['trial'] },
        L2T1M02:{ core:true, blocked:true, preLessonOnly:false, sources:['trial'] }
      }
    }
  };
}

await publish('global', globalModel, 'g1');
const issued = await issueSessionToken({ secret:AUTH_SECRET, userId:USER, now:NOW });
const cookie = `fpt_session=${issued.token}`;
const env = {
  AUTH_SIGNING_SECRET:AUTH_SECRET,
  ACCESS_SCOPE_SECRET:SCOPE_SECRET,
  ALLOWED_ORIGINS:ORIGIN,
  READ_MODELS_KV:kv,
  DB:db
};
const nextRuntime = { async fetch() { return new Response('next', { status:299 }); } };
const runtime = createTrialQuizRuntime(nextRuntime);

async function call(path, { method='GET', origin=ORIGIN, useCookie=true } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (useCookie) headers.cookie = cookie;
  return runtime.fetch(new Request(new URL(path, ORIGIN), { method, headers }), env);
}

let version = 1;
for (const viewId of TRIAL_11PLUS_VIEWS) {
  await publish(`access:${scopeId}`, accessModel([viewId]), `a${version++}`);
  let response = await call('/api/v2/student/quiz/eligibility');
  assert.equal(response.status, 200, `${viewId} eligibility status`);
  let body = await response.json();
  assert.equal(body.eligible, true, `${viewId} must receive Quiz`);
  assert.equal(body.currentLevel, 'L2');
  assert.equal(body.trialDemo, true);

  response = await call('/api/v2/student/quiz/launch', { method:'POST' });
  assert.equal(response.status, 200, `${viewId} launch status`);
  body = await response.json();
  assert.equal(body.ok, true);
  const row = db.rows.at(-1);
  assert.equal(row.portal_user_id_norm, USER);
  const context = JSON.parse(row.release_context_json);
  assert.equal(context.currentLevel, 'L2');
  assert.equal(context.trialDemo, true);
  assert.equal(context.portalAssignmentId, null);
  assert.deepEqual(context.releasedL2LessonCodes, ['L2T1M01','L2T1M02'], `${viewId} must receive the complete L2 catalogue including blocked Trial lesson resources`);
  assert.deepEqual(context.releasedL3LessonCodes, []);
  assert.deepEqual(context.inheritedLevels, []);
}

await publish(`access:${scopeId}`, accessModel(['maths-year4']), `a${version++}`);
let response = await call('/api/v2/student/quiz/eligibility');
assert.equal(response.status, 200);
let body = await response.json();
assert.equal(body.eligible, false, 'non-11+ Trial must not receive Quiz');

await publish(`access:${scopeId}`, accessModel(['maths-level2'], { trial:false }), `a${version++}`);
response = await call('/api/v2/student/quiz/eligibility');
assert.equal(response.status, 299, 'non-Trial must delegate unchanged to normal Quiz runtime');

console.log(JSON.stringify({
  marker:'TRIAL_FULL_L2_QUIZ_RUNTIME_PASS',
  elevenPlusTrialViews:[...TRIAL_11PLUS_VIEWS],
  fullL2:true,
  canonicalAssignmentFabricated:false,
  normalRuntimeDelegation:true
}, null, 2));
