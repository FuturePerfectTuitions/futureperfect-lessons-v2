import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerSecurityRoute,
  passwordFreeProfile,
  prepareSessionProfileEnv,
  persistSessionProfile,
  sha256Hex
} from '../worker/src/phase11-session-profile.js';
import {
  appendKvAuditHeaders,
  createKvAudit,
  kvAuditEnv,
  readTotal
} from '../worker/src/phase11-kv-audit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(
  path.join(root, 'worker', 'migrations', '0007_student_session_profiles.sql'),
  'utf8'
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS student_session_profiles/);
assert.match(migration, /trg_student_session_profile_delete_on_revoke/);
assert.match(migration, /AFTER UPDATE OF revoked_at ON student_sessions/);

const fullUser = {
  portalUserId: 'TestY511E',
  firstName: 'TestY511E',
  schoolYear: 5,
  status: 'active',
  expires: '2027-08-31',
  p: 'Te12',
  answerPassword: 'Te12',
  currentBatches: ['Y5E11'],
  manualAccess: { specialBuckets: ['VR_HOWTO'] }
};
const safe = passwordFreeProfile(fullUser);
assert.equal(safe.p, undefined);
assert.equal(safe.answerPassword, undefined);
assert.equal(safe.status, 'active');
assert.deepEqual(safe.currentBatches, ['Y5E11']);

function makeDb(profileByToken = new Map()) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (!sql.includes('FROM student_session_profiles')) return null;
              const row = profileByToken.get(values[0]);
              return row ? structuredClone(row) : null;
            },
            async run() {
              writes.push({ sql, values });
              return { success: true, meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

function makeStudentsKv() {
  const stats = { gets: 0 };
  return {
    stats,
    namespace: {
      async get(key, options) {
        stats.gets += 1;
        if (key !== 'user:testy511e' || options?.type !== 'json') return null;
        return structuredClone(fullUser);
      },
      async list() { return { keys: [] }; }
    }
  };
}

const rawToken = 'phase11-session-token';
const tokenHash = await sha256Hex(rawToken);
const profileRows = new Map([
  [tokenHash, {
    portal_user_id_norm: 'testy511e',
    user_json: JSON.stringify(safe)
  }]
]);
const cachedStudents = makeStudentsKv();
const cachedDb = makeDb(profileRows);
const cachedEnv = {
  ENVIRONMENT: 'development',
  STUDENTS_KV: cachedStudents.namespace,
  LESSONS_KV: { async get() { return null; }, async list() { return { keys: [] }; } },
  DB: cachedDb
};
const homeRequest = new Request('https://example.test/api/v1/student/home', {
  headers: { Cookie: `fpt_v2_session=${rawToken}` }
});
const cachedPrepared = await prepareSessionProfileEnv(homeRequest, cachedEnv);
const cachedUser = await cachedPrepared.env.STUDENTS_KV.get('user:testy511e', { type: 'json' });
assert.equal(cachedPrepared.state.cached, true);
assert.equal(cachedStudents.stats.gets, 0, 'Ordinary authenticated request must not re-read STUDENTS_KV.');
assert.equal(cachedUser.firstName, 'TestY511E');
assert.equal(cachedUser.p, undefined);
assert.equal(cachedUser.answerPassword, undefined);

const answerRequest = new Request(
  'https://example.test/api/v1/student/resources/Y5E2~answer~1/answer/authorize?viewId=english-year5-11plus',
  { method: 'POST', headers: { Cookie: `fpt_v2_session=${rawToken}` } }
);
assert.equal(answerSecurityRoute(answerRequest), true);
const answerPrepared = await prepareSessionProfileEnv(answerRequest, cachedEnv);
const currentAnswerUser = await answerPrepared.env.STUDENTS_KV.get('user:testy511e', { type: 'json' });
assert.equal(answerPrepared.state.bypassedForAnswerSecurity, true);
assert.equal(cachedStudents.stats.gets, 1, 'Answer security must retain a live STUDENTS_KV read.');
assert.equal(currentAnswerUser.answerPassword, 'Te12');

const hydrateStudents = makeStudentsKv();
const hydrateDb = makeDb(new Map());
const hydrateEnv = { ...cachedEnv, STUDENTS_KV: hydrateStudents.namespace, DB: hydrateDb };
const hydratePrepared = await prepareSessionProfileEnv(homeRequest, hydrateEnv);
await hydratePrepared.env.STUDENTS_KV.get('user:testy511e', { type: 'json' });
assert.equal(hydrateStudents.stats.gets, 1);
await persistSessionProfile(
  homeRequest,
  new Response('{}', { status: 200 }),
  hydrateEnv,
  hydratePrepared.state
);
const insertWrite = hydrateDb.writes.find(item => item.sql.includes('INSERT INTO student_session_profiles'));
assert.ok(insertWrite, 'Existing sessions must hydrate a server-side profile after one fallback KV read.');
const hydratedJson = JSON.parse(insertWrite.values[2]);
assert.equal(hydratedJson.p, undefined);
assert.equal(hydratedJson.answerPassword, undefined);

const loginStudents = makeStudentsKv();
const loginDb = makeDb(new Map());
const loginEnv = { ...cachedEnv, STUDENTS_KV: loginStudents.namespace, DB: loginDb };
const loginRequest = new Request('https://example.test/api/v1/student/auth/login', { method: 'POST' });
const loginPrepared = await prepareSessionProfileEnv(loginRequest, loginEnv);
await loginPrepared.env.STUDENTS_KV.get('user:testy511e', { type: 'json' });
await persistSessionProfile(
  loginRequest,
  new Response('{}', {
    status: 200,
    headers: { 'Set-Cookie': `fpt_v2_session=${rawToken}; Path=/; HttpOnly; Secure; SameSite=None` }
  }),
  loginEnv,
  loginPrepared.state
);
assert.equal(loginStudents.stats.gets, 1, 'Login must perform the authoritative credential/student read exactly once.');
assert.ok(loginDb.writes.some(item => item.sql.includes('INSERT INTO student_session_profiles')));

const audit = createKvAudit();
const auditedBaseStudents = makeStudentsKv();
const auditedEnv = kvAuditEnv({
  ...cachedEnv,
  STUDENTS_KV: auditedBaseStudents.namespace,
  LESSONS_KV: {
    async get() { return { lessonId: 'Y5E2' }; },
    async list() { return { keys: [] }; }
  }
}, audit);
await auditedEnv.STUDENTS_KV.get('user:testy511e', { type: 'json' });
await auditedEnv.LESSONS_KV.get('lesson:Y5E2', { type: 'json' });
assert.equal(readTotal(audit.students), 1);
assert.equal(readTotal(audit.lessons), 1);
const auditedResponse = appendKvAuditHeaders(new Response('ok'), auditedEnv, audit);
assert.equal(auditedResponse.headers.get('X-FPT-Students-KV-Read-Ops'), '1');
assert.equal(auditedResponse.headers.get('X-FPT-Lessons-KV-Read-Ops'), '1');

const efficientEntrypoint = fs.readFileSync(
  path.join(root, 'worker', 'src', 'index-phase11-efficient.js'),
  'utf8'
);
assert.match(efficientEntrypoint, /prepareSessionProfileEnv/);
assert.match(efficientEntrypoint, /appendKvAuditHeaders/);
assert.match(efficientEntrypoint, /index-phase11-final\.js/);

const finalEntrypoint = fs.readFileSync(
  path.join(root, 'worker', 'src', 'index-phase11-final.js'),
  'utf8'
);
assert.match(finalEntrypoint, /protectedAnswerNavigationEnv/);
assert.match(finalEntrypoint, /syntheticLessonRequest/);
assert.match(finalEntrypoint, /FROM answer_view_tokens/);
assert.match(finalEntrypoint, /phase11NavigationEnv\(env, syntheticLessonRequest\(request, parsed\.lessonId\)\)/);
assert.match(finalEntrypoint, /phase11NavigationEnv\(env, syntheticLessonRequest\(request, lessonId\)\)/);
assert.match(finalEntrypoint, /authorizeMatch/);
assert.match(finalEntrypoint, /answerViewMatch/);

console.log('Phase 11 STUDENTS_KV/session efficiency static verification: PASS');
