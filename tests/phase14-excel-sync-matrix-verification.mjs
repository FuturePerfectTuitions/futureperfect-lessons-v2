import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EXCEL_SYNC_PATH,
  handleExcelEntitlementSync
} from '../worker/src/index-phase13.js';

const TEST_DATE = '2026-09-15';
const TOKEN = 'phase14-unit-token';

class MockKV {
  constructor(values) {
    this.values = new Map(Object.entries(values));
  }
  async get(key, options) {
    const value = this.values.get(key);
    if (value == null) return null;
    return options?.type === 'json' ? structuredClone(value) : JSON.stringify(value);
  }
}

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    if (this.sql.includes('FROM batch_definitions')) {
      const batchKey = this.args[0];
      if (batchKey === 'P14_RUNTIME') throw new Error('deliberate Phase 14 runtime failure');
      return structuredClone(this.db.batches.get(batchKey) || null);
    }
    if (this.sql.includes('FROM student_batch_assignments')) {
      const [user, batchKey, dateA, dateB] = this.args;
      assert.equal(dateA, dateB);
      const row = this.db.assignments.find(item =>
        item.portal_user_id_norm === user &&
        item.batch_key === batchKey &&
        item.effective_from <= dateA &&
        (!item.effective_to || dateB < item.effective_to)
      );
      return row ? { assignment_id: row.assignment_id } : null;
    }
    if (this.sql.includes('FROM lesson_entitlements')) {
      return structuredClone(this.db.entitlements.get(`${this.args[0]}|${this.args[1]}`) || null);
    }
    if (this.sql.includes('FROM batch_lesson_releases')) {
      return structuredClone(this.db.releases.get(`${this.args[0]}|${this.args[1]}`) || null);
    }
    throw new Error(`Unhandled first() SQL: ${this.sql}`);
  }
  async run() {
    return this.db.apply(this);
  }
}

class MockDB {
  constructor() {
    const common = {
      academic_year: '2026-27',
      school_year: 5,
      maths_level: null,
      active_from: '2026-09-01',
      active_to: null
    };
    this.batches = new Map([
      ['P14_Y5M', { ...common, batch_key: 'P14_Y5M', subject: 'maths', stream: 'normal' }],
      ['P14_Y5E', { ...common, batch_key: 'P14_Y5E', subject: 'english', stream: 'normal' }],
      ['P14_Y511E', { ...common, batch_key: 'P14_Y511E', subject: 'english', stream: '11plus' }],
      ['P14_RUNTIME', { ...common, batch_key: 'P14_RUNTIME', subject: 'english', stream: 'normal' }]
    ]);
    this.assignments = [
      ['testy5p14m', 'P14_Y5M'],
      ['testy5p14e', 'P14_Y5E'],
      ['testy5p1411e', 'P14_Y511E'],
      ['testy5p14full', 'P14_Y5M'],
      ['testy5p14runtime', 'P14_RUNTIME']
    ].map(([portal_user_id_norm, batch_key], index) => ({
      assignment_id: index + 1,
      portal_user_id_norm,
      batch_key,
      effective_from: TEST_DATE,
      effective_to: null
    }));
    this.entitlements = new Map();
    this.releases = new Map();
  }
  prepare(sql) {
    return new MockStatement(this, sql);
  }
  async batch(statements) {
    for (const statement of statements) await this.apply(statement);
    return statements.map(() => ({ success: true }));
  }
  async apply(statement) {
    const { sql, args } = statement;
    if (sql.includes('INSERT INTO lesson_entitlements')) {
      const [user, lessonId, firstVrAccess, firstGrantedAt, lastConfirmedAt, batchKey, lessonDate] = args;
      const key = `${user}|${lessonId}`;
      const existing = this.entitlements.get(key);
      if (existing) {
        existing.core_access = 1;
        existing.last_confirmed_at = lastConfirmedAt;
        existing.source_batch_code = batchKey;
        existing.source_lesson_date = lessonDate;
      } else {
        this.entitlements.set(key, {
          core_access: 1,
          vr_access: firstVrAccess,
          source: 'excel',
          first_granted_at: firstGrantedAt,
          last_confirmed_at: lastConfirmedAt,
          source_batch_code: batchKey,
          source_lesson_date: lessonDate
        });
      }
      return { success: true };
    }
    if (sql.includes('INSERT INTO batch_lesson_releases')) {
      const [batchKey, lessonId, lessonDate, sourceRowId, firstCompletedAt, lastConfirmedAt] = args;
      const key = `${batchKey}|${lessonId}`;
      const existing = this.releases.get(key);
      if (existing) {
        existing.lesson_date = lessonDate;
        existing.source_row_id = sourceRowId;
        existing.last_confirmed_at = lastConfirmedAt;
      } else {
        this.releases.set(key, {
          batch_key: batchKey,
          lesson_id: lessonId,
          lesson_date: lessonDate,
          source_row_id: sourceRowId,
          first_completed_at: firstCompletedAt,
          last_confirmed_at: lastConfirmedAt
        });
      }
      return { success: true };
    }
    throw new Error(`Unhandled batch SQL: ${sql}`);
  }
}

function makeEnv() {
  const users = {
    'user:testy5p14m': { firstName: 'TestY5P14M', vrEligible: false, status: 'active', fullLibraries: [], blockedLessons: [] },
    'user:testy5p14e': { firstName: 'TestY5P14E', vrEligible: false, status: 'active', fullLibraries: [], blockedLessons: [] },
    'user:testy5p1411e': { firstName: 'TestY5P1411E', vrEligible: true, status: 'active', fullLibraries: [], blockedLessons: [] },
    'user:testy5p14full': { firstName: 'TestY5P14FULL', vrEligible: false, status: 'active', fullLibraries: ['MATHS_L2_FULL'], blockedLessons: [] },
    'user:testy5p14runtime': { firstName: 'TestY5P14RUNTIME', vrEligible: false, status: 'active', fullLibraries: [], blockedLessons: [] }
  };
  return {
    ENVIRONMENT: 'development',
    EXCEL_SYNC_TOKEN: TOKEN,
    STUDENTS_KV: new MockKV(users),
    LESSONS_KV: new MockKV({
      'lesson:Y5M1': { lessonId: 'Y5M1', subject: 'maths', active: true, curriculumCodes: ['MATHS_L2'] },
      'lesson:Y5E1': { lessonId: 'Y5E1', subject: 'english', active: true, curriculumCodes: ['ENGLISH_Y5'] }
    }),
    DB: new MockDB()
  };
}

function request(items) {
  return new Request(`https://worker.test${EXCEL_SYNC_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ items })
  });
}

function item(syncRowId, portalUserId, lessonId, batchKey, operation = 'grant') {
  return { syncRowId, operation, portalUserId, lessonId, batchKey, lessonDate: TEST_DATE };
}

const env = makeEnv();

// A manual Full Library is independent access. It must not make an unsynced
// Excel source row appear confirmed; explicit Excel confirmation still creates
// the permanent direct Student + Lesson record.
{
  const response = await handleExcelEntitlementSync(request([
    item('p14-full-precheck', 'TestY5P14FULL', 'Y5M1', 'P14_Y5M', 'status_check')
  ]), env);
  const body = await response.json();
  assert.equal(body.results[0].status, 'ENTITLEMENT_MISSING');
  assert.equal(env.DB.entitlements.size, 0);
  assert.deepEqual(
    env.STUDENTS_KV.values.get('user:testy5p14full').fullLibraries,
    ['MATHS_L2_FULL']
  );
}

// Remaining subject/outcome matrix in one global request: ordinary Maths,
// ordinary English, English 11+ with VR, Full Library overlap, plus one invalid
// item. A bad item must not block valid items.
{
  const response = await handleExcelEntitlementSync(request([
    item('p14-maths', 'TestY5P14M', 'Y5M1', 'P14_Y5M'),
    item('p14-english', 'TestY5P14E', 'Y5E1', 'P14_Y5E'),
    item('p14-english-vr', 'TestY5P1411E', 'Y5E1', 'P14_Y511E'),
    item('p14-full', 'TestY5P14FULL', 'Y5M1', 'P14_Y5M'),
    item('p14-invalid', 'TestY5P14E', '__P14_MISSING__', 'P14_Y5E')
  ]), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map(result => result.status), [
    'CREATED', 'CREATED', 'CREATED', 'CREATED', 'LESSON_NOT_FOUND'
  ]);
  assert.equal(body.summary.succeeded, 4);
  assert.equal(body.summary.failed, 1);
  assert.equal(env.DB.entitlements.size, 4);
  assert.equal(env.DB.releases.size, 3);
  assert.equal(env.DB.entitlements.get('testy5p14m|Y5M1').vr_access, 0);
  assert.equal(env.DB.entitlements.get('testy5p14e|Y5E1').vr_access, 0);
  assert.equal(env.DB.entitlements.get('testy5p1411e|Y5E1').vr_access, 1);
  assert.equal(env.DB.entitlements.get('testy5p14full|Y5M1').vr_access, 0);
}

// Duplicate Student + Lesson remains idempotent and the Full Library-backed
// source row is now confirmed only because its own direct sync succeeded.
{
  const response = await handleExcelEntitlementSync(request([
    item('p14-full-repeat', 'TestY5P14FULL', 'Y5M1', 'P14_Y5M')
  ]), env);
  const body = await response.json();
  assert.equal(body.results[0].status, 'CONFIRMED');
  assert.equal(env.DB.entitlements.size, 4);
  assert.equal(env.DB.releases.size, 3);
}

// A per-item runtime/store failure returns ERROR with an explicit safe-retry
// message and remains isolated from a valid item in the same request.
{
  const response = await handleExcelEntitlementSync(request([
    item('p14-good-with-runtime', 'TestY5P14E', 'Y5E1', 'P14_Y5E'),
    item('p14-runtime', 'TestY5P14RUNTIME', 'Y5E1', 'P14_RUNTIME')
  ]), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].status, 'CONFIRMED');
  assert.equal(body.results[1].status, 'ERROR');
  assert.match(body.results[1].message, /safe to retry/i);
  assert.equal(body.summary.succeeded, 1);
  assert.equal(body.summary.failed, 1);
  assert.equal(env.DB.entitlements.size, 4);
}

const workerSource = fs.readFileSync(new URL('../worker/src/index-phase13.js', import.meta.url), 'utf8');
assert.ok(workerSource.includes('ON CONFLICT(portal_user_id_norm, lesson_id)'));
assert.ok(workerSource.includes('status_check'));
assert.ok(workerSource.includes("status: 'ERROR'") || workerSource.includes("'ERROR'"));
assert.ok(workerSource.includes('safe to retry'));
assert.ok(!workerSource.includes('DELETE FROM lesson_entitlements'));
assert.ok(!workerSource.includes('INSERT INTO student_batch_assignments'));
assert.ok(!workerSource.includes('UPDATE student_batch_assignments'));
assert.ok(!workerSource.includes('DELETE FROM student_batch_assignments'));

console.log('Phase 14 remaining Excel sync gap-matrix verification: PASS');
