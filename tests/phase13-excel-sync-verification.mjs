import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EXCEL_SYNC_PATH,
  MAX_SYNC_ITEMS,
  batchActiveOnDate,
  handleExcelEntitlementSync,
  normalisePortalUserId,
  validateItemShape
} from '../worker/src/index-phase13.js';

assert.equal(EXCEL_SYNC_PATH, '/api/v1/admin/excel-entitlements/sync');
assert.equal(MAX_SYNC_ITEMS, 1000);
assert.equal(normalisePortalUserId('  Kiaan1312  '), 'kiaan1312');
assert.equal(batchActiveOnDate({ active_from: '2026-09-01', active_to: null }, '2026-09-08'), true);
assert.equal(batchActiveOnDate({ active_from: '2026-09-09', active_to: null }, '2026-09-08'), false);
assert.equal(batchActiveOnDate({ active_from: null, active_to: '2026-09-08' }, '2026-09-08'), false);

const validShape = validateItemShape({
  syncRowId: 'sync-row-1',
  operation: 'grant',
  portalUserId: 'TestY511E',
  lessonId: 'Y5E1',
  batchKey: 'Y511FE',
  lessonDate: '2026-09-12'
});
assert.ok(validShape.value);
assert.equal(validShape.value.portalUserIdNorm, 'testy511e');
assert.equal(validateItemShape({ ...validShape.value, lessonDate: '2026-02-31' }).error, 'INVALID_LESSON_DATE');
assert.equal(validateItemShape({ ...validShape.value, operation: 'revoke' }).error, 'INVALID_OPERATION');

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
    const sql = this.sql;
    if (sql.includes('FROM batch_definitions')) {
      return structuredClone(this.db.batches.get(this.args[0]) || null);
    }
    if (sql.includes('FROM student_batch_assignments')) {
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
    if (sql.includes('FROM lesson_entitlements')) {
      const key = `${this.args[0]}|${this.args[1]}`;
      return structuredClone(this.db.entitlements.get(key) || null);
    }
    if (sql.includes('FROM batch_lesson_releases')) {
      const key = `${this.args[0]}|${this.args[1]}`;
      return structuredClone(this.db.releases.get(key) || null);
    }
    throw new Error(`Unhandled first() SQL: ${sql}`);
  }
  async run() {
    return this.db.apply(this);
  }
}

class MockDB {
  constructor() {
    this.batches = new Map([
      ['Y511FE', {
        batch_key: 'Y511FE',
        subject: 'english',
        school_year: 5,
        stream: '11plus',
        maths_level: null,
        active_from: '2026-09-01',
        active_to: null
      }]
    ]);
    this.assignments = [{
      assignment_id: 1,
      portal_user_id_norm: 'testy511e',
      batch_key: 'Y511FE',
      effective_from: '2026-09-12',
      effective_to: null
    }];
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

function makeEnv({ blocked = false } = {}) {
  const DB = new MockDB();
  return {
    ENVIRONMENT: 'development',
    EXCEL_SYNC_TOKEN: 'phase13-unit-secret',
    STUDENTS_KV: new MockKV({
      'user:testy511e': {
        firstName: 'TestY511E',
        vrEligible: true,
        status: 'active',
        blockedLessons: blocked ? ['Y5E1'] : []
      }
    }),
    LESSONS_KV: new MockKV({
      'lesson:Y5E1': {
        lessonId: 'Y5E1',
        subject: 'english',
        active: true
      }
    }),
    DB
  };
}

function request(items, token = 'phase13-unit-secret', extraHeaders = {}) {
  return new Request(`https://worker.test${EXCEL_SYNC_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: JSON.stringify({ items })
  });
}

const baseItem = {
  syncRowId: 'sync-row-1',
  operation: 'grant',
  portalUserId: 'TestY511E',
  lessonId: 'Y5E1',
  batchKey: 'Y511FE',
  lessonDate: '2026-09-12'
};

{
  const env = makeEnv();
  const first = await handleExcelEntitlementSync(request([baseItem]), env);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.results[0].status, 'CREATED');
  assert.equal(firstBody.results[0].entitlement, 'created');
  assert.equal(firstBody.results[0].batchRelease, 'created');
  assert.equal(env.DB.entitlements.size, 1);
  assert.equal(env.DB.releases.size, 1);
  assert.equal(env.DB.entitlements.get('testy511e|Y5E1').vr_access, 1);

  const second = await handleExcelEntitlementSync(request([baseItem]), env);
  const secondBody = await second.json();
  assert.equal(secondBody.results[0].status, 'CONFIRMED');
  assert.equal(secondBody.results[0].entitlement, 'confirmed');
  assert.equal(secondBody.results[0].batchRelease, 'confirmed');
  assert.equal(env.DB.entitlements.size, 1);
  assert.equal(env.DB.releases.size, 1);

  const statusItem = { ...baseItem, operation: 'status_check' };
  const statusResponse = await handleExcelEntitlementSync(request([statusItem]), env);
  const statusBody = await statusResponse.json();
  assert.equal(statusBody.results[0].status, 'CONFIRMED');
  assert.equal(statusBody.results[0].operation, 'status_check');
  assert.equal(env.DB.entitlements.size, 1);
  assert.equal(env.DB.releases.size, 1);
}

{
  const env = makeEnv();
  const response = await handleExcelEntitlementSync(request([
    { ...baseItem, syncRowId: 'good' },
    { ...baseItem, syncRowId: 'bad', lessonId: 'NO-SUCH-LESSON' }
  ]), env);
  const body = await response.json();
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].status, 'CREATED');
  assert.equal(body.results[1].status, 'LESSON_NOT_FOUND');
  assert.equal(body.summary.succeeded, 1);
  assert.equal(body.summary.failed, 1);
  assert.equal(env.DB.entitlements.size, 1);
}

{
  const env = makeEnv({ blocked: true });
  const response = await handleExcelEntitlementSync(request([baseItem]), env);
  const body = await response.json();
  assert.equal(body.results[0].status, 'BLOCKED');
  assert.equal(env.DB.entitlements.size, 0);
  assert.equal(env.DB.releases.size, 0);
}

{
  const env = makeEnv();
  const tooEarly = { ...baseItem, lessonDate: '2026-09-11' };
  const response = await handleExcelEntitlementSync(request([tooEarly]), env);
  const body = await response.json();
  assert.equal(body.results[0].status, 'NOT_ASSIGNED_ON_LESSON_DATE');
  assert.equal(env.DB.entitlements.size, 0);
}

{
  const env = makeEnv();
  const response = await handleExcelEntitlementSync(request([baseItem], 'wrong-token'), env);
  assert.equal(response.status, 401);
}

{
  const env = makeEnv();
  env.ENVIRONMENT = 'production';
  const response = await handleExcelEntitlementSync(request([baseItem]), env);
  assert.equal(response.status, 404);
}

{
  const env = makeEnv();
  const response = await handleExcelEntitlementSync(
    request([baseItem], 'phase13-unit-secret', { Origin: 'https://futureperfecttuitions.github.io' }),
    env
  );
  assert.equal(response.status, 403);
}

const source = fs.readFileSync(new URL('../worker/src/index-phase13.js', import.meta.url), 'utf8');
const downstreamSource = fs.readFileSync(new URL('../worker/src/phase15-manual-access.js', import.meta.url), 'utf8');
// Phase 15 may wrap the established Phase 12 student renderer for additional
// presentation-only persona rules. Preserve the Phase 13 contract by proving the
// sync entrypoint still delegates every non-sync request through that wrapper and
// that the wrapper itself delegates to the accepted Phase 12 Worker.
assert.ok(source.includes("import phase12Worker from './phase15-manual-access.js'"));
assert.ok(downstreamSource.includes("import phase12Worker from './index-phase12.js'"));
assert.ok(source.includes('return phase12Worker.fetch(request, env, ctx)'));
assert.ok(source.includes("'/api/v1/admin/excel-entitlements/sync'"));
assert.ok(source.includes('EXCEL_SYNC_TOKEN'));
assert.ok(source.includes("ENVIRONMENT"));
assert.ok(source.includes("'development'"));
assert.ok(source.includes('student_batch_assignments'));
assert.ok(source.includes('batch_definitions'));
assert.ok(source.includes('batch_lesson_releases'));
assert.ok(source.includes('lesson_entitlements'));
assert.ok(source.includes('blockedLessons'));
assert.ok(source.includes('effective_from <= ?'));
assert.ok(source.includes('ON CONFLICT(portal_user_id_norm, lesson_id)'));
assert.ok(source.includes('ON CONFLICT(batch_key, lesson_id)'));
assert.ok(!source.includes('DELETE FROM lesson_entitlements'));
assert.ok(!source.includes('DELETE FROM student_batch_assignments'));
assert.ok(!source.includes('INSERT INTO student_batch_assignments'));
assert.ok(!source.includes('UPDATE student_batch_assignments'));
assert.ok(!downstreamSource.includes('INSERT INTO lesson_entitlements'));
assert.ok(!downstreamSource.includes('DELETE FROM lesson_entitlements'));
assert.ok(!downstreamSource.includes('UPDATE lesson_entitlements'));
assert.ok(!downstreamSource.includes('INSERT INTO student_batch_assignments'));
assert.ok(!downstreamSource.includes('DELETE FROM student_batch_assignments'));
assert.ok(!downstreamSource.includes('UPDATE student_batch_assignments'));

console.log('Phase 13 Excel entitlement sync Worker verification: PASS');
