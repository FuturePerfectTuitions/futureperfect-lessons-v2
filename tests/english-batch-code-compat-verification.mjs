import assert from 'node:assert/strict';
import {
  legacyLiveBatchAlias,
  legacyEnglishBatchAlias,
  legacyMathsBatchAlias,
  withLiveBatchAliases,
  augmentSessionProfileRow,
  augmentLegacyAccessRows,
  isLegacyAccessStateQuery,
  isSessionProfileLoadQuery,
  liveBatchCompatEnv,
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

// Paired Maths live batches must be translated at the same boundary. Otherwise
// fixing English alone can make a genuinely enrolled Maths view look like a
// cross-subject preview for students enrolled in both subjects.
assert.equal(legacyMathsBatchAlias('Y511FM'), 'Y5M11');
assert.equal(legacyMathsBatchAlias('Y511OM1'), 'Y5M11');
assert.equal(legacyMathsBatchAlias('Y411FM2'), 'Y4M11');
assert.equal(legacyMathsBatchAlias('Y5FM'), 'Y5M');
assert.equal(legacyMathsBatchAlias('Y5OM3'), 'Y5M');
assert.equal(legacyMathsBatchAlias('Y3FM'), 'Y3M');

assert.equal(legacyLiveBatchAlias('Y511FE'), 'Y5E11');
assert.equal(legacyLiveBatchAlias('Y511FM'), 'Y5M11');

// Already-legacy/synthetic values and unrelated batch names are untouched.
assert.equal(legacyLiveBatchAlias('Y5E11'), '');
assert.equal(legacyLiveBatchAlias('Y5E'), '');
assert.equal(legacyLiveBatchAlias('Y5M11'), '');
assert.equal(legacyLiveBatchAlias('Y5M'), '');
assert.equal(legacyLiveBatchAlias('not-a-batch'), '');
assert.equal(legacyEnglishBatchAlias('Y611FE'), '', 'English 11+ exists only in Year 4/5');

const normalPairedUser = {
  firstName:'NormalFixture',
  batches:['Y5FE','Y5FM'],
  status:'active'
};
const augmentedNormal = withLiveBatchAliases(normalPairedUser);
assert.deepEqual(augmentedNormal.batches, ['Y5FE','Y5FM','Y5E','Y5M']);
assert.deepEqual(normalPairedUser.batches, ['Y5FE','Y5FM'], 'compatibility must not mutate the source user');

const elevenPlusPairedUser = {
  firstName:'ElevenFixture',
  batches:['Y511FE','Y511FM'],
  status:'active'
};
const augmentedElevenPlus = withLiveBatchAliases(elevenPlusPairedUser);
assert.deepEqual(augmentedElevenPlus.batches, ['Y511FE','Y511FM','Y5E11','Y5M11']);
assert.deepEqual(elevenPlusPairedUser.batches, ['Y511FE','Y511FM']);

// The cached session-profile path must receive the same request-local aliases;
// otherwise established sessions could keep the old misclassification until
// logout after the compatibility layer is deployed.
const profile = augmentSessionProfileRow({
  portal_user_id_norm:'fixture',
  user_json:JSON.stringify(elevenPlusPairedUser)
});
assert.deepEqual(
  JSON.parse(profile.user_json).batches,
  ['Y511FE','Y511FM','Y5E11','Y5M11']
);

// Historical view reconstruction reads source_batch_code from D1. Add a second
// in-memory row carrying each legacy alias while preserving every exact stored row.
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
  { lesson_id:'Y5M1', core_access:1, vr_access:0, source_batch_code:'Y511FM' },
  { lesson_id:'Y5M1', core_access:1, vr_access:0, source_batch_code:'Y5M11' }
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

// Verify the namespace proxies are read-only transforms and preserve unrelated calls.
const fakeKv = {
  async get(key, options) {
    if (key !== 'user:fixture') return null;
    return options?.type === 'json'
      ? structuredClone(elevenPlusPairedUser)
      : JSON.stringify(elevenPlusPairedUser);
  }
};
function fakeStatement(sql, args = []) {
  return {
    bind(...next) { return fakeStatement(sql, next); },
    async first() {
      if (isSessionProfileLoadQuery(sql)) {
        return {
          portal_user_id_norm:args[0] || 'fixture',
          user_json:JSON.stringify(elevenPlusPairedUser)
        };
      }
      return { untouched:true };
    },
    async all() {
      if (isLegacyAccessStateQuery(sql)) {
        return {
          success:true,
          results:[
            { lesson_id:'Y5E3', core_access:1, vr_access:1, source_batch_code:'Y511FE' },
            { lesson_id:'Y5M1', core_access:1, vr_access:0, source_batch_code:'Y511FM' }
          ]
        };
      }
      return { success:true, results:[{ untouched:true }] };
    }
  };
}
const fakeDb = { prepare(sql) { return fakeStatement(sql); } };
const compatEnv = liveBatchCompatEnv({ STUDENTS_KV:fakeKv, DB:fakeDb, marker:'kept' });
assert.deepEqual(
  (await compatEnv.STUDENTS_KV.get('user:fixture', { type:'json' })).batches,
  ['Y511FE','Y511FM','Y5E11','Y5M11']
);
assert.deepEqual(
  (await compatEnv.DB.prepare(legacyAccessSql).bind('fixture').all()).results.map(row => row.source_batch_code),
  ['Y511FE','Y5E11','Y511FM','Y5M11']
);
assert.deepEqual(
  JSON.parse((await compatEnv.DB.prepare(sessionProfileSql).bind('fixture').first()).user_json).batches,
  ['Y511FE','Y511FM','Y5E11','Y5M11']
);
assert.equal(compatEnv.marker, 'kept');

assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/home')), true);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/views/english-year5-11plus/lessons')), true);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/views/maths-level3/lessons')), true);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/auth/login', { method:'POST' })), false);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/student/auth/logout', { method:'POST' })), false);
assert.equal(needsCompatibility(new Request('https://example.test/api/v1/admin/trials/list')), false);

console.log('Paired live-batch navigation compatibility verification: PASS');
