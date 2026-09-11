import assert from 'node:assert/strict';
import {
  handleAdminLessonReleaseImport,
  normaliseCsvRow,
  parseLessonDate,
  extractLessonId,
  curriculumCandidatesForDisplayId
} from '../worker/src/admin-lesson-release-import.js';

class BoundStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) { return new BoundStatement(this.db, this.sql, args); }
  async first() { return this.db.first(this.sql, this.args); }
  async run() { return this.db.run(this.sql, this.args); }
}

class MemoryDB {
  constructor() {
    this.entitlements = new Map();
    this.prelessons = new Map();
  }
  prepare(sql) { return new BoundStatement(this, sql); }
  async batch(statements) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success:true }));
  }
  entitlementKey(user, lesson) { return `${user}|${lesson}`; }
  preKey(user, lesson, batch) { return `${user}|${lesson}|${batch}`; }

  rejectBatchRosterDependency(sql) {
    if (
      sql.includes('batch_definitions') ||
      sql.includes('student_batch_assignments') ||
      sql.includes('batch_lesson_releases')
    ) {
      throw new Error(`Importer must not depend on batch roster tables: ${sql}`);
    }
  }

  async first(sql, args) {
    this.rejectBatchRosterDependency(sql);
    if (sql.includes('FROM lesson_entitlements')) {
      return this.entitlements.get(this.entitlementKey(args[0], args[1])) || null;
    }
    if (sql.includes('FROM online_prelesson_entitlements')) {
      const [user, lesson] = args;
      return [...this.prelessons.values()]
        .find(row => row.portal_user_id_norm === user && row.lesson_id === lesson) || null;
    }
    throw new Error(`Unhandled first() SQL: ${sql}`);
  }

  async run(sql, args) {
    this.rejectBatchRosterDependency(sql);

    if (sql.includes('DELETE FROM online_prelesson_entitlements')) {
      const [user, lesson] = args;
      for (const [key, row] of this.prelessons) {
        if (row.portal_user_id_norm === user && row.lesson_id === lesson) {
          this.prelessons.delete(key);
        }
      }
      return { success:true };
    }

    if (sql.includes('INSERT INTO online_prelesson_entitlements')) {
      const [user, lesson, batch, lessonDate, vrAccess, sourceRowId, firstGrantedAt, lastConfirmedAt] = args;
      this.prelessons.set(this.preKey(user, lesson, batch), {
        portal_user_id_norm:user,
        lesson_id:lesson,
        batch_key:batch,
        lesson_date:lessonDate,
        vr_access:vrAccess,
        source_row_id:sourceRowId,
        first_granted_at:firstGrantedAt,
        last_confirmed_at:lastConfirmedAt
      });
      return { success:true };
    }

    if (sql.includes('INSERT INTO lesson_entitlements')) {
      const [user, lesson, vrAccess, firstGrantedAt, lastConfirmedAt, batch, lessonDate] = args;
      const key = this.entitlementKey(user, lesson);
      const existing = this.entitlements.get(key) || {};
      this.entitlements.set(key, {
        ...existing,
        portal_user_id_norm:user,
        lesson_id:lesson,
        core_access:1,
        vr_access:existing.vr_access ?? vrAccess,
        source:'excel',
        first_granted_at:existing.first_granted_at ?? firstGrantedAt,
        last_confirmed_at:lastConfirmedAt,
        source_batch_code:batch,
        source_lesson_date:lessonDate
      });
      return { success:true };
    }

    throw new Error(`Unhandled run() SQL: ${sql}`);
  }
}

const students = new Map([
  ['user:pre0101', { name:'Synthetic Online', vrEligible:true, blockedLessons:[] }],
  ['user:full0202', { name:'Synthetic Full', vrEligible:false, blockedLessons:[] }]
]);

const lessons = new Map([
  ['curriculum:ENGLISH_Y5', { curriculumCode:'ENGLISH_Y5', lessonIds:['Y5E2'] }],
  ['curriculum:MATHS_Y3', { curriculumCode:'MATHS_Y3', lessonIds:['Y3M1'] }],
  ['lesson:Y5E2', {
    lessonId:'Y5E2',
    subject:'English',
    active:true,
    displayIds:{
      'english-year5':'Y5T1E01',
      'english-year5-11plus':'Y5T1EE01'
    }
  }],
  ['lesson:Y3M1', {
    lessonId:'Y3M1',
    subject:'Maths',
    active:true,
    displayIds:{ 'maths-year3':'Y3T1M01' }
  }]
]);

const db = new MemoryDB();
const env = {
  DB:db,
  STUDENTS_KV:{ async get(key) { return students.get(key) || null; } },
  LESSONS_KV:{ async get(key) { return lessons.get(key) || null; } },
  ALLOWED_ORIGINS:'https://futureperfecttuitions.github.io,https://lessons.futureperfect.education',
  ADMIN_IMPORT_PASSWORD:'synthetic-admin-password',
  ADMIN_IMPORT_SESSION_SECRET:'synthetic-session-secret-at-least-long-enough'
};

const onlineReady = {
  Date:'8/23/2026',
  Name:'Synthetic Online',
  Year:'Year 5 11+ S',
  Subject:'English',
  Lesson:'Y5T1E01 Descriptive Writing Settings and Atmosphere',
  LessonDated:'7th September 2026',
  LessonStatus:'Ready',
  Mode:'Y511OE_NEW_NOT_IN_D1',
  Student:'Pre0101'
};

const faceToFaceCompleted = {
  Date:'8/21/2026',
  Name:'Synthetic Full',
  Year:'Year 3',
  Subject:'Maths',
  Lesson:'Y3T1M01 Transitioning to Year 3',
  LessonDated:'7th September 2026',
  LessonStatus:'completed',
  Mode:'Y3FM_NEW_X',
  Student:'Full0202'
};

assert.equal(parseLessonDate('7th September 2026'), '2026-09-07');
assert.equal(parseLessonDate('07/09/2026'), '2026-09-07');
assert.equal(extractLessonId('Y6MS1 SATS Preparation'), 'Y6M51');
assert.deepEqual(curriculumCandidatesForDisplayId('Y5T1E01'), ['ENGLISH_Y5']);
assert.deepEqual(curriculumCandidatesForDisplayId('Y5T1EE01'), ['ENGLISH_Y5']);
assert.deepEqual(curriculumCandidatesForDisplayId('Y3T1M01'), ['MATHS_Y3']);
assert.deepEqual(curriculumCandidatesForDisplayId('Y4T2M07'), ['MATHS_L1']);
assert.deepEqual(curriculumCandidatesForDisplayId('L2T3M09'), ['MATHS_L2']);
assert.deepEqual(curriculumCandidatesForDisplayId('Y6T1M01'), ['MATHS_L3','MATHS_Y6_EXTRA']);

assert.equal(normaliseCsvRow(onlineReady, 0).releaseType, 'PRELESSON_ONLY');
assert.equal(normaliseCsvRow(faceToFaceCompleted, 1).releaseType, 'FULL');
assert.equal(normaliseCsvRow({ ...faceToFaceCompleted, LessonStatus:'Ready' }, 2).releaseType, 'SKIP');
assert.equal(normaliseCsvRow({ ...faceToFaceCompleted, LessonStatus:'Not Completed' }, 3).releaseType, 'SKIP');
assert.equal(normaliseCsvRow({ ...onlineReady, LessonStatus:'Not Completed' }, 4).releaseType, 'PRELESSON_ONLY');
assert.equal(normaliseCsvRow({ ...faceToFaceCompleted, Mode:'' }, 5).releaseType, 'FULL');

// Continuing means the previous lesson is still being taught, but all Portal
// resources for that lesson must now be treated exactly like a Completed row.
assert.equal(
  normaliseCsvRow({ ...onlineReady, LessonStatus:'Continuing' }, 6).releaseType,
  'FULL'
);
assert.equal(
  normaliseCsvRow({ ...onlineReady, Remarks:'Start from slide 16' }, 7).releaseType,
  'FULL'
);
assert.equal(
  normaliseCsvRow({ ...faceToFaceCompleted, LessonStatus:'Ready', Remarks:'Continue from page 4' }, 8).releaseType,
  'FULL'
);
assert.equal(
  normaliseCsvRow({ ...onlineReady, Remarks:'PreLesson Sheets to be printed' }, 9).releaseType,
  'PRELESSON_ONLY'
);

const origin = 'https://futureperfecttuitions.github.io';

async function call(path, body, token='') {
  const headers = { 'content-type':'application/json', Origin:origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request(`https://worker.example${path}`, {
    method:'POST',
    headers,
    body:JSON.stringify(body)
  });
  const response = await handleAdminLessonReleaseImport(request, env);
  return { response, body:await response.json() };
}

const badLogin = await call('/api/v1/admin/lesson-releases/login', { password:'wrong' });
assert.equal(badLogin.response.status, 401);

const login = await call('/api/v1/admin/lesson-releases/login', {
  password:'synthetic-admin-password'
});
assert.equal(login.response.status, 200);
assert.equal(login.body.ok, true);
assert.ok(login.body.token);
const token = login.body.token;

const mixedRows = [onlineReady, faceToFaceCompleted];

const preview = await call(
  '/api/v1/admin/lesson-releases/preview',
  { rows:mixedRows },
  token
);
assert.equal(preview.response.status, 200);
assert.equal(preview.body.summary.total, 2);
assert.equal(preview.body.summary.releasable, 2);
assert.equal(preview.body.summary.errors, 0);
assert.deepEqual(
  preview.body.results.map(r => r.releaseType),
  ['PRELESSON_ONLY', 'FULL']
);
assert.deepEqual(
  preview.body.results.map(r => r.action),
  ['GRANT_PRELESSON', 'GRANT_FULL']
);
assert.deepEqual(
  preview.body.results.map(r => r.lessonId),
  ['Y5E2', 'Y3M1']
);
assert.deepEqual(
  preview.body.results.map(r => r.inputLessonId),
  ['Y5T1E01', 'Y3T1M01']
);
assert.equal(db.prelessons.size, 0, 'Preview must not write PreLesson access');
assert.equal(db.entitlements.size, 0, 'Preview must not write full access');

const confirm = await call(
  '/api/v1/admin/lesson-releases/confirm',
  { rows:mixedRows },
  token
);
assert.equal(confirm.response.status, 200);
assert.equal(confirm.body.summary.total, 2);
assert.equal(confirm.body.summary.succeeded, 2);
assert.equal(confirm.body.summary.failed, 0);
assert.equal(db.prelessons.size, 1);
assert.equal(db.entitlements.get('full0202|Y3M1')?.core_access, 1);
assert.equal(
  db.entitlements.get('full0202|Y3M1')?.source_batch_code,
  'Y3FM_NEW_X',
  'Batch may be retained as audit metadata without requiring a D1 batch definition'
);
assert.equal(db.entitlements.has('pre0101|Y5E2'), false);
const firstPreGrantedAt = [...db.prelessons.values()][0]?.first_granted_at;
const repeatPre = await call('/api/v1/admin/lesson-releases/confirm', { rows:[onlineReady] }, token);
assert.equal(repeatPre.response.status, 200);
assert.equal([...db.prelessons.values()][0]?.first_granted_at, firstPreGrantedAt, 'Idempotent PreLesson confirmation must preserve the original shared timestamp');

// A continuing row upgrades the same PreLesson-only entitlement to FULL. That
// is the entitlement used for the video, Homework and Answer Pack resources.
const continuingUpgradeRow = { ...onlineReady, Remarks:'Start from slide 16' };
const continuingUpgrade = await call(
  '/api/v1/admin/lesson-releases/confirm',
  { rows:[continuingUpgradeRow] },
  token
);
assert.equal(continuingUpgrade.response.status, 200);
assert.equal(continuingUpgrade.body.results[0].releaseType, 'FULL');
assert.equal(continuingUpgrade.body.results[0].accessMode, 'full');
assert.equal(db.entitlements.get('pre0101|Y5E2')?.core_access, 1);
assert.equal(
  [...db.prelessons.values()].some(
    r => r.portal_user_id_norm === 'pre0101' && r.lesson_id === 'Y5E2'
  ),
  false,
  'Continuing FULL release must clear stale PreLesson-only access'
);

const upgradeRow = { ...onlineReady, LessonStatus:'Completed' };
const upgrade = await call(
  '/api/v1/admin/lesson-releases/confirm',
  { rows:[upgradeRow] },
  token
);
assert.equal(upgrade.response.status, 200);
assert.equal(db.entitlements.get('pre0101|Y5E2')?.core_access, 1);
assert.equal(
  [...db.prelessons.values()].some(
    r => r.portal_user_id_norm === 'pre0101' && r.lesson_id === 'Y5E2'
  ),
  false,
  'FULL must clear stale PreLesson-only access'
);

const noDowngrade = await call(
  '/api/v1/admin/lesson-releases/confirm',
  { rows:[onlineReady] },
  token
);
assert.equal(noDowngrade.response.status, 200);
assert.equal(noDowngrade.body.results[0].status, 'ALREADY_FULL');
assert.equal(db.entitlements.get('pre0101|Y5E2')?.core_access, 1);
assert.equal(
  [...db.prelessons.values()].some(
    r => r.portal_user_id_norm === 'pre0101' && r.lesson_id === 'Y5E2'
  ),
  false
);

const elevenPlusDisplayAlias = {
  ...onlineReady,
  Lesson:'Y5T1EE01 Descriptive Writing Settings and Atmosphere'
};
const aliasPreview = await call(
  '/api/v1/admin/lesson-releases/preview',
  { rows:[elevenPlusDisplayAlias] },
  token
);
assert.equal(aliasPreview.response.status, 200);
assert.equal(aliasPreview.body.results[0].lessonId, 'Y5E2');
assert.equal(aliasPreview.body.results[0].action, 'ALREADY_FULL');

console.log('Lesson release importer ignores D1 batch roster and verifies display IDs + FULL/PRELESSON_ONLY + continuing FULL release: PASS');
