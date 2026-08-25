import assert from 'node:assert/strict';
import {
  SHARED_LEVEL2_R2_KEY,
  YEAR5_R2_KEY,
  answerR2KeyForView,
  parseAnswerResourceKey,
  prepareYear5AnswerPdfEnv
} from '../worker/src/phase11-year5-answer-pdf.js';

assert.deepEqual(parseAnswerResourceKey('Y5M1~answer~1'), {
  lessonId: 'Y5M1',
  answerIndex: 1
});
assert.equal(parseAnswerResourceKey('Y5M1~homework~1'), null);

assert.equal(
  answerR2KeyForView({
    viewId: 'maths-year5',
    lessonId: 'Y5M1',
    answerIndex: 1,
    defaultR2Key: SHARED_LEVEL2_R2_KEY
  }),
  YEAR5_R2_KEY
);
assert.equal(
  answerR2KeyForView({
    viewId: 'maths-level2',
    lessonId: 'Y5M1',
    answerIndex: 1,
    defaultR2Key: SHARED_LEVEL2_R2_KEY
  }),
  SHARED_LEVEL2_R2_KEY
);
assert.equal(
  answerR2KeyForView({
    viewId: 'maths-year5',
    lessonId: 'Y5M2',
    answerIndex: 1,
    defaultR2Key: 'another.pdf'
  }),
  'another.pdf'
);

const r2Calls = [];
const sourceR2 = {
  async head(key) {
    r2Calls.push(['head', key]);
    return { key };
  },
  async get(key) {
    r2Calls.push(['get', key]);
    return { key, body: new Uint8Array([1]) };
  }
};

const authorizeEnv = {
  MATERIALS_R2: sourceR2,
  DB: {
    prepare() {
      throw new Error('Authorize routing must not read D1');
    }
  }
};
const authorizeRequest = new Request(
  'https://example.test/api/v1/student/resources/Y5M1~answer~1/answer/authorize?viewId=maths-year5',
  { method: 'POST' }
);
const year5Env = await prepareYear5AnswerPdfEnv(authorizeRequest, authorizeEnv);
await year5Env.MATERIALS_R2.head(SHARED_LEVEL2_R2_KEY);
assert.deepEqual(r2Calls.pop(), ['head', YEAR5_R2_KEY]);

const level2Request = new Request(
  'https://example.test/api/v1/student/resources/Y5M1~answer~1/answer/authorize?viewId=maths-level2',
  { method: 'POST' }
);
const level2Env = await prepareYear5AnswerPdfEnv(level2Request, authorizeEnv);
await level2Env.MATERIALS_R2.head(SHARED_LEVEL2_R2_KEY);
assert.deepEqual(r2Calls.pop(), ['head', SHARED_LEVEL2_R2_KEY]);

const tokenHashBytes = new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test-token'))
);
const testTokenHash = [...tokenHashBytes]
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('');

let remoteFirstReads = 0;
const tokenRow = {
  token_hash: testTokenHash,
  session_token_hash: 'session-hash',
  portal_user_id_norm: 'testy5em',
  lesson_id: 'Y5M1',
  resource_key: 'Y5M1~answer~1',
  view_id: 'maths-year5',
  password_fingerprint: 'fingerprint',
  created_at: '2026-08-25T00:00:00.000Z',
  content_expires_at: '2026-08-25T00:02:00.000Z',
  lease_expires_at: '2026-08-25T00:30:00.000Z',
  used_at: null
};
const sourceDb = {
  prepare() {
    return {
      bind() {
        return {
          async first() {
            remoteFirstReads += 1;
            return { ...tokenRow };
          }
        };
      }
    };
  }
};
const answerViewEnv = { MATERIALS_R2: sourceR2, DB: sourceDb };
const answerViewRequest = new Request(
  'https://example.test/api/v1/student/answer-view/test-token',
  { method: 'GET' }
);
const cachedEnv = await prepareYear5AnswerPdfEnv(answerViewRequest, answerViewEnv);
assert.equal(remoteFirstReads, 1, 'wrapper should perform one authoritative token-row read');

const cachedRowOne = await cachedEnv.DB.prepare(
  'SELECT lesson_id FROM answer_view_tokens WHERE token_hash = ?'
).bind(tokenRow.token_hash).first();
const cachedRowTwo = await cachedEnv.DB.prepare(
  'SELECT token_hash, lesson_id, resource_key, view_id FROM answer_view_tokens WHERE token_hash = ?'
).bind(tokenRow.token_hash).first();
assert.equal(remoteFirstReads, 1, 'downstream answer-token SELECTs should use the request cache');
assert.equal(cachedRowOne.lesson_id, 'Y5M1');
assert.equal(cachedRowTwo.view_id, 'maths-year5');

await cachedEnv.MATERIALS_R2.get(SHARED_LEVEL2_R2_KEY);
assert.deepEqual(r2Calls.pop(), ['get', YEAR5_R2_KEY]);

console.log('Phase 11 Year 5 Answer Pack PDF routing static verification: PASS');
