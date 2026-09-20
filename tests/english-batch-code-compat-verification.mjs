import assert from 'node:assert/strict';
import {
  legacyEnglishBatchAlias,
  withEnglishBatchAliases,
  augmentSessionProfileRow,
  augmentLegacyAccessRows,
  isLegacyAccessStateQuery,
  isSessionProfileLoadQuery,
  englishBatchCompatEnv,
  needsCompatibility
} from '../worker/src/index-phase25-english-batch-code-compat.js';

// Live owner/Excel batch keys must be translated only for the legacy navigation
// classifier. The exact live key remains present and authoritative.
assert.equal(legacyEnglishBatchAlias('Y511FE'), 'Y5E11');
assert.equal(legacyEnglishBatchAlias('Y511OE1'), 'Y5E11');
assert.equal(legacyEnglishBatchAlias('Y411FE2'), 'Y4E11');
assert.equal(legacyEnglishBatchAlias('Y5FE'), 'Y5E');
assert.equal(legacyEnglishBatchAlias('Y5OE3'), 'Y5E');
assert.equal(legacyEnglishBatchAlias('Y3FE'), 'Y3E');

// Already-legacy/synthetic values and non-English batches are untouched.
assert.equal(legacyEnglishBatchAlias('Y5E11'), '');
assert.equal(legacyEnglishBatchAlias('Y5E'), '');
assert.equal(legacyEnglishBatchAlias('Y511FM'), '');
assert.equal(legacyEnglishBatchAlias('Y5FM'), '');
assert.equal(legacyEnglishBatchAlias('not-a-batch'), '');
assert.equal(legacyEnglishBatchAlias('Y611FE'), '', 'English 11+ exists only in Year 4/5');

const originalUser = {
  firstName:'Fixture',
  batches:['Y511FE','Y5FM'],
  status:'active'
};
const augmentedUser = withEnglishBatchAliases(originalUser);
assert.deepEqual(augmentedUser.batches, ['Y511FE','Y5FM','Y5E11']);
assert.deepEqual(originalUser.batches, ['Y511FE','Y5FM'], 'compatibility must not mutate the source user');

// The cached session-profile path must receive the same request-local alias;
// otherwise established sessions could keep the old misclassification until
// logout even after the live batch parser is corrected.
const profile = augmentSessionProfileRow({
  portal_user_id_norm:'fixture',
  user_json:JSON.stringify(originalUser)
});
assert.deepEqual(JSON.parse(profile.user_json).batches, ['Y511FE','Y5FM','Y5E11']);

// Historical view reconstruction reads source_batch_code from D1. Add a second
// in-memory row carrying the legacy alias while preserving the exact stored row.
const accessResult = augmentLegacyAccessRows({
  success:true,
  results:[
    { lesson_id:'Y5E3', core_access:1, vr_access:1, source_batch_code:'Y511FE' },
    { lesson_id:'Y5M1', core_access:1, vr_access:0, source_batch_code:'Y511FM' }
  ]
});
assert.deepEqual(accessResult.results, [
  { lesson_id:'Y5E3', core_access:1, vr_access:1, source_batch_code:'Y511FE' },
  { lesson_id:'Y5E3', core_access:1, vr_access:1, source_batch_code:'Y5E11' },
  { lesson_id:'Y5M1', core_access:1, vr_access:0, source_batch_code:'Y511FM' }
]);

const legacyAccessSql = `
  SELECT lesson_id, core_access, vr_access, source_batch_code
  FROM lesson_entitlements
  WHERE portal_user_id_norm = ?`;
const sessionProfileSql = `
  SELECT p.portal_user_id_norm, p.user_json
  FROM student_session_profiles p
  JOIN student_sessions s ON s.token_hash = p.token_hash
  WHERE p.token_hash = ?`;
assert.equal(isLegacyAccessStateQuery(legacyAccessSql), true);
assert.equal(isLegacyAccessStateQuery('SELECT * FROM lesson_entitlements'), false);
assert.equal(isSessionProfileLoadQuery(sessionProfileSql), true);
assert.equal(isSessionProfileLoadQuery('SELECT * FROM student_session_profiles'), false);

// Verify the namespace proxies are read-only and preserve ordinary calls.
const fakeKv = {
  async get(key, options) {
    if (key !== 'user:fixture') return null;
    return options?.type === 'json' ? structuredClone(originalUser) : JSON.stringify(originalUser);
  }
};
function fakeStatement(sql, args = []) {
  return {
    bind(...next) { return fakeStatement(sql, next); },
    async first() {
      if (isSessionProfileLoadQuery(sql)) {
        return { portal_user_id_norm:args[0] || 'fixture', user_json:JSON.stringify(originalUser) };
      }
      return { untouched:true };
    },
    async all() {
      if (isLegacyAccessStateQuery(sql)) {
        return {
          success:true,
          results:[{ lesson_id:'Y5E3', core_access:1, vr_access:1, source_batch_code:'Y511FE' }]
        };
      }
      return { success:true, results:[{ untouched:true }] };
    }
  };
}
const fakeDb = { prepare(sql) { return fakeStatement(sql); } };
const compatEnv = englishBatchCompatEnv({ STUDENTS_KV:fakeKv, DB:fakeDb, marker:'kept' });
assert.deepEqual((await compatEnv.STUDENTS_KV.get('user:fixture', { type:'json' })).batches, ['Y511FE','Y5FM','Y5E11']);
assert.deepEqual(
  (await compatEnv.DB.prepare(legacyAccessSql).bind('fixture').all()).results.map(row => row.source_batch_code),
  ['Y511FE','Y5E11']
);
assert.deepEqual(
  JSON.parse((await compatEnv.DB.prepare(sessionProfileSql).bind('fixture').first()).user_json).batches,
  ['Y511FE','Y5FM','Y5E11']
);
assert.equal(compatEnv.marker, 'kept');

assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/home')), true);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/views/english-year5-11plus/lessons')), true);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/auth/login', { method:'POST' })), false);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/auth/logout', { method:'POST' })), false);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/admin/trials/list')), false);

console.log('English live-batch navigation compatibility verification: PASS');
