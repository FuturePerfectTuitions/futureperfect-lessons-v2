import assert from 'node:assert/strict';
import {
  stableStringify,
  sha256Hex,
  pointerKey,
  versionKey,
  inferViewIdFromLessonAndBatch,
  refreshStudentAccessReadModel
} from '../worker/src/access-read-model-sync.js';
import {
  successfulStudents,
  applySyncOutcome
} from '../worker/src/admin-lesson-release-import-reconciled.js';

class MemoryKV {
  constructor() {
    this.values = new Map();
    this.failPointer = false;
  }
  async get(key, options) {
    const value = this.values.get(key);
    if (value == null) return null;
    if (options?.type === 'json') return typeof value === 'string' ? JSON.parse(value) : value;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  async put(key, value) {
    if (this.failPointer && key.includes(':current')) throw new Error('injected-pointer-failure');
    this.values.set(key, value);
  }
}

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async all() { return { results:this.db.query(this.sql, this.args) }; }
}

class MemoryDB {
  constructor() {
    this.entitlements = [];
    this.prelessons = [];
    this.assignments = [];
    this.definitions = [];
  }
  prepare(sql) { return new Statement(this, sql); }
  query(sql, args) {
    if (sql.includes('FROM batch_definitions') && !sql.includes('student_batch_assignments')) return this.definitions;
    if (sql.includes('FROM student_batch_assignments')) {
      return this.assignments.filter(row => row.portal_user_id_norm === args[0]);
    }
    if (sql.includes('FROM lesson_entitlements')) {
      return this.entitlements.filter(row => row.portal_user_id_norm === args[0]);
    }
    if (sql.includes('FROM online_prelesson_entitlements')) {
      return this.prelessons.filter(row => row.portal_user_id_norm === args[0]);
    }
    throw new Error(`Unhandled query: ${sql}`);
  }
}

async function seedScope(kv, scope, payload, version = 'seed') {
  const payloadText = stableStringify(payload);
  const sha256 = await sha256Hex(payloadText);
  const envelope = {
    schemaVersion:1,
    kind:'prepared-read-model-envelope',
    scope,
    version,
    sha256,
    payload
  };
  const envelopeText = stableStringify(envelope);
  const envelopeSha256 = await sha256Hex(envelopeText);
  await kv.put(versionKey(scope, version), envelopeText);
  await kv.put(pointerKey(scope), stableStringify({
    schemaVersion:1,
    kind:'prepared-read-model-pointer',
    scope,
    current:{ version, sha256, envelopeSha256 },
    previous:null,
    updatedAt:'2026-09-20T00:00:00Z'
  }));
}

async function currentPayload(kv, scope) {
  const pointer = JSON.parse(await kv.get(pointerKey(scope)));
  return JSON.parse(await kv.get(versionKey(scope, pointer.current.version))).payload;
}

const global = {
  schemaVersion:1,
  kind:'prepared-global-read-model',
  source:{ marker:'test' },
  navigation:[],
  catalogues:{
    'english-year5':{ viewId:'english-year5', lessonCount:1, lessons:[{ lessonId:'Y5E2' }] },
    'english-year5-11plus':{ viewId:'english-year5-11plus', lessonCount:1, lessons:[{ lessonId:'Y5E2' }] },
    'maths-year5':{ viewId:'maths-year5', lessonCount:1, lessons:[{ lessonId:'Y5M1' }] },
    'maths-level2':{ viewId:'maths-level2', lessonCount:1, lessons:[{ lessonId:'Y5M1' }] }
  },
  lessonToViews:{
    Y5E2:['english-year5','english-year5-11plus'],
    Y5M1:['maths-year5','maths-level2']
  },
  counts:{}
};
const catalogue = {
  kind:'prepared-catalogue',
  views:global.catalogues,
  lessonToViews:global.lessonToViews
};

assert.equal(inferViewIdFromLessonAndBatch({ lesson_id:'Y5E2', source_batch_code:'Y511OE_NEW' }, catalogue), 'english-year5-11plus');
assert.equal(inferViewIdFromLessonAndBatch({ lesson_id:'Y5E2', source_batch_code:'Y5OE' }, catalogue), 'english-year5');
assert.equal(inferViewIdFromLessonAndBatch({ lesson_id:'Y5M1', source_batch_code:'Y511OM1' }, catalogue), 'maths-level2');
assert.equal(inferViewIdFromLessonAndBatch({ lesson_id:'Y5M1', source_batch_code:'Y5FM' }, catalogue), 'maths-year5');

const kv = new MemoryKV();
kv.values.set('meta:scope-salt', 'a'.repeat(64));
await seedScope(kv, 'global', global, 'global-v1');

const students = new Map([
  ['user:alice', { firstName:'Alice', status:'active', upsellViews:['maths-level2'], blockedLessons:[] }],
  ['user:blocked', { firstName:'Blocked', status:'active', upsellViews:[], blockedLessons:['Y5E2'] }],
  ['user:pre', { firstName:'Pre', status:'active', upsellViews:[], blockedLessons:[] }]
]);
const db = new MemoryDB();
db.entitlements.push({
  portal_user_id_norm:'alice', lesson_id:'Y5E2', core_access:1, vr_access:1, source:'excel',
  source_batch_code:'Y511OE_NEW_NOT_IN_D1', source_lesson_date:'2026-09-07'
});
db.entitlements.push({
  portal_user_id_norm:'blocked', lesson_id:'Y5E2', core_access:1, vr_access:0, source:'excel',
  source_batch_code:'Y511OE_NEW_NOT_IN_D1', source_lesson_date:'2026-09-07'
});
db.prelessons.push({
  portal_user_id_norm:'pre', lesson_id:'Y5E2', batch_key:'Y511OE_NEW_NOT_IN_D1',
  lesson_date:'2026-09-07', vr_access:1
});
const env = {
  READ_MODELS_KV:kv,
  STUDENTS_KV:{ async get(key) { return students.get(key) || null; } },
  DB:db
};

// A D1 FULL row must become real 11+ English access, while an explicit Maths
// upsell remains a locked preview. This is the regression that previously left
// a student on a description-only card after the importer reported success.
const alice = await refreshStudentAccessReadModel(env, 'Alice', { asOfDate:'2026-09-20' });
assert.equal(alice.ok, true);
const alicePayload = await currentPayload(kv, `access:${alice.scopeId}`);
assert.equal(alicePayload.snapshot.lessonAccess.Y5E2.core, true);
assert.equal(alicePayload.snapshot.lessonAccess.Y5E2.preLessonOnly, false);
const english11 = alicePayload.snapshot.views.find(view => view.viewId === 'english-year5-11plus');
assert.equal(english11.lockedPreview, false);
assert.equal(english11.openLessonCount, 1);
const mathsUpsell = alicePayload.snapshot.views.find(view => view.viewId === 'maths-level2');
assert.equal(mathsUpsell.lockedPreview, true);
assert.equal(mathsUpsell.openLessonCount, 0);

// Blocked lessons remain blocked even if canonical D1 contains FULL access.
const blocked = await refreshStudentAccessReadModel(env, 'blocked', { asOfDate:'2026-09-20' });
const blockedPayload = await currentPayload(kv, `access:${blocked.scopeId}`);
assert.equal(blockedPayload.snapshot.lessonAccess.Y5E2.blocked, true);
assert.equal(blockedPayload.snapshot.lessonAccess.Y5E2.core, false);

// PreLesson-only remains PreLesson-only until canonical D1 is upgraded to FULL.
const pre = await refreshStudentAccessReadModel(env, 'pre', { asOfDate:'2026-09-20' });
let prePayload = await currentPayload(kv, `access:${pre.scopeId}`);
assert.equal(prePayload.snapshot.lessonAccess.Y5E2.preLessonOnly, true);
assert.equal(prePayload.snapshot.lessonAccess.Y5E2.core, false);

db.prelessons = [];
db.entitlements.push({
  portal_user_id_norm:'pre', lesson_id:'Y5E2', core_access:1, vr_access:1, source:'excel',
  source_batch_code:'Y511OE_NEW_NOT_IN_D1', source_lesson_date:'2026-09-07'
});
await refreshStudentAccessReadModel(env, 'pre', { asOfDate:'2026-09-20' });
prePayload = await currentPayload(kv, `access:${pre.scopeId}`);
assert.equal(prePayload.snapshot.lessonAccess.Y5E2.core, true);
assert.equal(prePayload.snapshot.lessonAccess.Y5E2.preLessonOnly, false);

// Candidate publication is atomic: a pointer-write failure must leave the last
// verified current pointer untouched, so students never see a partial model.
const beforePointer = await kv.get(pointerKey(`access:${alice.scopeId}`));
db.entitlements.push({
  portal_user_id_norm:'alice', lesson_id:'Y5M1', core_access:1, vr_access:0, source:'excel',
  source_batch_code:'Y511OM1', source_lesson_date:'2026-09-08'
});
kv.failPointer = true;
await assert.rejects(
  () => refreshStudentAccessReadModel(env, 'alice', { asOfDate:'2026-09-20' }),
  /injected-pointer-failure/
);
kv.failPointer = false;
assert.equal(await kv.get(pointerKey(`access:${alice.scopeId}`)), beforePointer);

// Import result decoration is fail-closed for parent email delivery: a canonical
// D1 write whose read-model publication fails is reported as a Portal failure and
// is safe to replay. Multiple rows for one child compile/publish only once.
assert.deepEqual(
  successfulStudents([
    { ok:true, portalUserId:'Alice' },
    { ok:true, portalUserIdNorm:'alice' },
    { ok:false, portalUserId:'Other' }
  ]),
  ['alice']
);
const decorated = applySyncOutcome({
  ok:true,
  results:[{ ok:true, portalUserId:'Alice', portalUserIdNorm:'alice', status:'CREATED' }],
  summary:{ total:1, succeeded:1, failed:0 }
}, new Map([['alice', { ok:false }]]));
assert.equal(decorated.results[0].ok, false);
assert.equal(decorated.results[0].status, 'READ_MODEL_SYNC_FAILED');
assert.equal(decorated.results[0].legacyApplied, true);
assert.equal(decorated.summary.succeeded, 0);
assert.equal(decorated.summary.failed, 1);
assert.equal(decorated.summary.readModelsFailed, 1);

console.log('Access read-model reconciliation verification: PASS');
