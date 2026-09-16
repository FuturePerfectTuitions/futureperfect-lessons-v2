import assert from 'node:assert/strict';
import {
  MemoryStore,
  publishScopeAtomic,
  resolveCurrentScope
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';
import { publishStudentPreparedAccess } from '../worker/src/admin-prepared-access-publisher.js';

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async all() { return { results:this.db.rows(this.sql, this.args) }; }
}

class FakeDB {
  constructor() {
    this.entitlements = [{
      portal_user_id_norm:'test0101', lesson_id:'Y3M1', core_access:1, vr_access:0,
      source:'excel', first_granted_at:'2026-09-16T09:00:00Z', last_confirmed_at:'2026-09-16T09:00:00Z',
      source_batch_code:'Y3FM', source_lesson_date:'2026-09-16'
    }];
  }
  prepare(sql) { return new Statement(this, sql); }
  rows(sql, args) {
    if (sql.includes('FROM batch_definitions')) return [{
      batch_key:'Y3FM', academic_year:'2026-27', subject:'maths', school_year:3,
      stream:'normal', maths_level:null, active_from:'2026-09-01', active_to:null
    }];
    if (sql.includes('FROM student_batch_assignments')) return [{
      portal_user_id_norm:'test0101', batch_key:'Y3FM', effective_from:'2026-09-01', effective_to:null,
      subject:'maths', school_year:3, stream:'normal', maths_level:null,
      batch_active_from:'2026-09-01', batch_active_to:null
    }];
    if (sql.includes('FROM lesson_entitlements')) {
      return this.entitlements.filter(row => row.portal_user_id_norm === String(args[0] || '').toLowerCase());
    }
    if (sql.includes('FROM online_prelesson_entitlements')) return [];
    throw new Error(`Unhandled test query: ${sql}`);
  }
}

const readModels = new MemoryStore();
await readModels.put('meta:scope-salt', 'a'.repeat(64));
await publishScopeAtomic(readModels, {
  scope:'global',
  payload:{
    schemaVersion:1,
    kind:'prepared-global-read-model',
    source:{ sourceType:'test' },
    navigation:[{ viewId:'maths-year3', subject:'maths', label:'Year 3', lessonCount:2 }],
    catalogues:{
      'maths-year3':{
        viewId:'maths-year3', subject:'maths', label:'Year 3', lessonCount:2,
        lessons:[{ lessonId:'Y3M1', title:'One' }, { lessonId:'Y3M2', title:'Two' }]
      }
    },
    lessonToViews:{ Y3M1:['maths-year3'], Y3M2:['maths-year3'] },
    counts:{ 'maths-year3':2 }
  },
  version:'test-global'
});

const db = new FakeDB();
const env = {
  DB:db,
  REBUILD_SHADOW_KV:readModels,
  STUDENTS_KV:{
    async get(key) {
      if (key !== 'user:test0101') return null;
      return { name:'Test', accountStatus:'active', blockedLessons:[], fullLibraries:[] };
    }
  }
};

const first = await publishStudentPreparedAccess(env, 'Test0101', { asOfDate:'2026-09-16' });
assert.equal(first.ok, true);
assert.equal(first.published, true);
const current1 = await resolveCurrentScope(readModels, first.scope);
assert.equal(current1.payload.kind, 'prepared-access-read-model');
assert.equal(current1.payload.snapshot.lessonAccess.Y3M1.core, true);
assert.equal(current1.payload.snapshot.lessonAccess.Y3M2, undefined);

const repeated = await publishStudentPreparedAccess(env, 'test0101', { asOfDate:'2026-09-16' });
assert.equal(repeated.reused, true);
assert.equal(repeated.version, first.version);

db.entitlements.push({
  portal_user_id_norm:'test0101', lesson_id:'Y3M2', core_access:1, vr_access:0,
  source:'excel', first_granted_at:'2026-09-16T10:00:00Z', last_confirmed_at:'2026-09-16T10:00:00Z',
  source_batch_code:'Y3FM', source_lesson_date:'2026-09-16'
});
const second = await publishStudentPreparedAccess(env, 'test0101', { asOfDate:'2026-09-16' });
assert.equal(second.published, true);
assert.notEqual(second.version, first.version);
assert.equal(second.previousVersion, first.version);
const current2 = await resolveCurrentScope(readModels, second.scope);
assert.equal(current2.payload.snapshot.lessonAccess.Y3M2.core, true);
assert.equal(current2.pointer.previous.version, first.version);

console.log('Canonical prepared-access publication after entitlement change: PASS');
