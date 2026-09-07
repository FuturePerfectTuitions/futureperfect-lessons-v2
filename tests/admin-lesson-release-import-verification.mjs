import assert from 'node:assert/strict';
import { handleAdminLessonReleaseImport, normaliseCsvRow, parseLessonDate, extractLessonId } from '../worker/src/admin-lesson-release-import.js';

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
    this.batches = new Map([
      ['Y511OE1', { batch_key:'Y511OE1', subject:'english', school_year:'Y5', stream:'11plus', maths_level:null, active_from:'2026-09-01', active_to:null }],
      ['Y3FM', { batch_key:'Y3FM', subject:'maths', school_year:'Y3', stream:'normal', maths_level:null, active_from:'2026-09-01', active_to:null }]
    ]);
    this.assignments = [
      { assignment_id:1, portal_user_id_norm:'pre0101', batch_key:'Y511OE1', effective_from:'2026-09-01', effective_to:null },
      { assignment_id:2, portal_user_id_norm:'full0202', batch_key:'Y3FM', effective_from:'2026-09-01', effective_to:null }
    ];
    this.entitlements = new Map();
    this.releases = new Map();
    this.prelessons = new Map();
  }
  prepare(sql) { return new BoundStatement(this, sql); }
  async batch(statements) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success:true }));
  }
  entitlementKey(user, lesson) { return `${user}|${lesson}`; }
  releaseKey(batch, lesson) { return `${batch}|${lesson}`; }
  preKey(user, lesson, batch) { return `${user}|${lesson}|${batch}`; }
  async first(sql, args) {
    if (sql.includes('FROM batch_definitions')) return this.batches.get(args[0]) || null;
    if (sql.includes('FROM student_batch_assignments')) {
      const [user, batch, date] = args;
      return this.assignments.find(a => a.portal_user_id_norm === user && a.batch_key === batch && a.effective_from <= date && (!a.effective_to || date < a.effective_to)) || null;
    }
    if (sql.includes('FROM lesson_entitlements')) return this.entitlements.get(this.entitlementKey(args[0], args[1])) || null;
    if (sql.includes('FROM batch_lesson_releases')) return this.releases.get(this.releaseKey(args[0], args[1])) || null;
    if (sql.includes('FROM online_prelesson_entitlements')) {
      const [user, lesson] = args;
      return [...this.prelessons.values()].find(row => row.portal_user_id_norm === user && row.lesson_id === lesson) || null;
    }
    throw new Error(`Unhandled first() SQL: ${sql}`);
  }
  async run(sql, args) {
    if (sql.includes('INSERT INTO online_prelesson_entitlements')) {
      const [user, lesson, batch, lessonDate, vrAccess, sourceRowId, firstGrantedAt, lastConfirmedAt] = args;
      this.prelessons.set(this.preKey(user, lesson, batch), {
        portal_user_id_norm:user, lesson_id:lesson, batch_key:batch, lesson_date:lessonDate,
        vr_access:vrAccess, source_row_id:sourceRowId, first_granted_at:firstGrantedAt, last_confirmed_at:lastConfirmedAt
      });
      return { success:true };
    }
    if (sql.includes('DELETE FROM online_prelesson_entitlements')) {
      const [user, lesson] = args;
      for (const [key, row] of this.prelessons) if (row.portal_user_id_norm === user && row.lesson_id === lesson) this.prelessons.delete(key);
      return { success:true };
    }
    if (sql.includes('INSERT INTO lesson_entitlements')) {
      const [user, lesson, vrAccess, firstGrantedAt, lastConfirmedAt, batch, lessonDate] = args;
      const key = this.entitlementKey(user, lesson);
      const existing = this.entitlements.get(key) || {};
      this.entitlements.set(key, {
        ...existing, portal_user_id_norm:user, lesson_id:lesson, core_access:1,
        vr_access:existing.vr_access ?? vrAccess, source:'excel', first_granted_at:existing.first_granted_at ?? firstGrantedAt,
        last_confirmed_at:lastConfirmedAt, source_batch_code:batch, source_lesson_date:lessonDate
      });
      return { success:true };
    }
    if (sql.includes('INSERT INTO batch_lesson_releases')) {
      const [batch, lesson, lessonDate, sourceRowId, firstCompletedAt, lastConfirmedAt] = args;
      const key = this.releaseKey(batch, lesson);
      const existing = this.releases.get(key) || {};
      this.releases.set(key, {
        ...existing, batch_key:batch, lesson_id:lesson, lesson_date:lessonDate, source_row_id:sourceRowId,
        first_completed_at:existing.first_completed_at ?? firstCompletedAt, last_confirmed_at:lastConfirmedAt
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
  ['lesson:Y5T1E01', { lessonId:'Y5T1E01', subject:'English', active:true }],
  ['lesson:Y3T1M01', { lessonId:'Y3T1M01', subject:'Maths', active:true }]
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
  Date:'8/23/2026', Name:'Synthetic Online', Year:'Year 5 11+ S', Subject:'English',
  Lesson:'Y5T1E01 Descriptive Writing Settings and Atmosphere', LessonDated:'7th September 2026',
  LessonStatus:'Ready', Mode:'Y511OE1', Student:'Pre0101'
};
const faceToFaceCompleted = {
  Date:'8/21/2026', Name:'Synthetic Full', Year:'Year 3', Subject:'Maths',
  Lesson:'Y3T1M01 Transitioning to Year 3', LessonDated:'7th September 2026',
  LessonStatus:'completed', Mode:'Y3FM', Student:'Full0202'
};

assert.equal(parseLessonDate('7th September 2026'), '2026-09-07');
assert.equal(parseLessonDate('07/09/2026'), '2026-09-07');
assert.equal(extractLessonId('Y6MS1 SATS Preparation'), 'Y6M51');
assert.equal(normaliseCsvRow(onlineReady, 0).releaseType, 'PRELESSON_ONLY');
assert.equal(normaliseCsvRow(faceToFaceCompleted, 1).releaseType, 'FULL');
assert.equal(normaliseCsvRow({ ...faceToFaceCompleted, LessonStatus:'Ready' }, 2).releaseType, 'SKIP');

const origin = 'https://futureperfecttuitions.github.io';
async function call(path, body, token='') {
  const headers = { 'content-type':'application/json', Origin:origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request(`https://worker.example${path}`, { method:'POST', headers, body:JSON.stringify(body) });
  const response = await handleAdminLessonReleaseImport(request, env);
  return { response, body:await response.json() };
}

const badLogin = await call('/api/v1/admin/lesson-releases/login', { password:'wrong' });
assert.equal(badLogin.response.status, 401);

const login = await call('/api/v1/admin/lesson-releases/login', { password:'synthetic-admin-password' });
assert.equal(login.response.status, 200);
assert.equal(login.body.ok, true);
assert.ok(login.body.token);
const token = login.body.token;

const mixedRows = [onlineReady, faceToFaceCompleted];
const preview = await call('/api/v1/admin/lesson-releases/preview', { rows:mixedRows }, token);
assert.equal(preview.response.status, 200);
assert.equal(preview.body.summary.total, 2);
assert.equal(preview.body.summary.releasable, 2);
assert.equal(preview.body.summary.errors, 0);
assert.deepEqual(preview.body.results.map(r => r.releaseType), ['PRELESSON_ONLY', 'FULL']);
assert.deepEqual(preview.body.results.map(r => r.action), ['GRANT_PRELESSON', 'GRANT_FULL']);
assert.equal(db.prelessons.size, 0, 'Preview must not write PreLesson access');
assert.equal(db.entitlements.size, 0, 'Preview must not write full access');

const confirm = await call('/api/v1/admin/lesson-releases/confirm', { rows:mixedRows }, token);
assert.equal(confirm.response.status, 200);
assert.equal(confirm.body.summary.total, 2);
assert.equal(confirm.body.summary.succeeded, 2);
assert.equal(confirm.body.summary.failed, 0);
assert.equal(db.prelessons.size, 1);
assert.equal(db.entitlements.get('full0202|Y3T1M01')?.core_access, 1);
assert.equal(db.entitlements.has('pre0101|Y5T1E01'), false);

const upgradeRow = { ...onlineReady, LessonStatus:'Completed' };
const upgrade = await call('/api/v1/admin/lesson-releases/confirm', { rows:[upgradeRow] }, token);
assert.equal(upgrade.response.status, 200);
assert.equal(db.entitlements.get('pre0101|Y5T1E01')?.core_access, 1);
assert.equal([...db.prelessons.values()].some(r => r.portal_user_id_norm === 'pre0101' && r.lesson_id === 'Y5T1E01'), false, 'FULL must clear stale PreLesson-only access');

const noDowngrade = await call('/api/v1/admin/lesson-releases/confirm', { rows:[onlineReady] }, token);
assert.equal(noDowngrade.response.status, 200);
assert.equal(noDowngrade.body.results[0].status, 'ALREADY_FULL');
assert.equal(db.entitlements.get('pre0101|Y5T1E01')?.core_access, 1);
assert.equal([...db.prelessons.values()].some(r => r.portal_user_id_norm === 'pre0101' && r.lesson_id === 'Y5T1E01'), false);

console.log('Lesson release importer mixed FULL/PRELESSON_ONLY verification: PASS');
