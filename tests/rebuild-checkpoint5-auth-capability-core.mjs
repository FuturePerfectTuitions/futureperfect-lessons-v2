import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  AuthTokenError,
  CAPABILITY_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  clearSessionCookie,
  createAuthenticatedSession,
  issueCapability,
  issueSessionToken,
  sessionTokenFromCookie,
  verifyCapability,
  verifySessionToken
} from '../rebuild/shared/auth/auth-core.mjs';
import { authorizeAnswerPackOpen } from '../rebuild/shared/auth/answer-pack-authorization.mjs';

const SECRET = 'checkpoint5-synthetic-signing-secret-64-bytes-minimum-0000000000000000';
const T0 = Date.UTC(2026, 8, 13, 12, 0, 0);
const plus = seconds => T0 + seconds * 1000;

async function rejectsCode(fn, code) {
  await assert.rejects(fn, error => error instanceof AuthTokenError && error.code === code);
}

const loginA = await createAuthenticatedSession({ secret: SECRET, userId: 'Synthetic0101', now: T0 });
assert.equal(loginA.session.exp - loginA.session.iat, SESSION_MAX_AGE_SECONDS);
assert.match(loginA.setCookie, /^fpt_session=/);
assert.match(loginA.setCookie, /Max-Age=28800/);
assert.match(loginA.setCookie, /HttpOnly/);
assert.match(loginA.setCookie, /Secure/);
assert.match(loginA.setCookie, /SameSite=Lax/);
assert.equal(sessionTokenFromCookie(`other=x; ${loginA.setCookie.split(';')[0]}`), loginA.token);
assert.match(clearSessionCookie(), /Max-Age=0/);
assert.ok(!loginA.token.includes('Synthetic0101'));

const verifiedA = await verifySessionToken({ secret: SECRET, token: loginA.token, now: plus(1) });
assert.equal(verifiedA.sub, 'synthetic0101');
await rejectsCode(
  () => verifySessionToken({ secret: SECRET, token: loginA.token, now: plus(SESSION_MAX_AGE_SECONDS) }),
  'token_expired'
);

const modifiedSession = loginA.token.slice(0, -1) + (loginA.token.endsWith('A') ? 'B' : 'A');
await assert.rejects(() => verifySessionToken({ secret: SECRET, token: modifiedSession, now: plus(1) }));

// Approved multi-device semantics: two independent logins for one user coexist.
const loginB = await issueSessionToken({ secret: SECRET, userId: 'Synthetic0101', now: plus(2) });
assert.notEqual(loginA.session.sid, loginB.session.sid);
await verifySessionToken({ secret: SECRET, token: loginA.token, now: plus(3), expectedUserId: 'synthetic0101' });
await verifySessionToken({ secret: SECRET, token: loginB.token, now: plus(3), expectedUserId: 'synthetic0101' });

const base = {
  secret: SECRET,
  session: verifiedA,
  viewId: 'maths-year6',
  lessonId: 'Y6T1M01',
  resourceId: 'resource-homework-1',
  accessVersion: 'access-snapshot-42',
  now: plus(10)
};
const expected = {
  type: 'download',
  userId: verifiedA.sub,
  sessionId: verifiedA.sid,
  viewId: base.viewId,
  lessonId: base.lessonId,
  resourceId: base.resourceId,
  accessVersion: base.accessVersion
};

for (const type of ['video', 'download', 'answer-view']) {
  const issued = await issueCapability({ ...base, type, resourceId: `resource-${type}` });
  assert.equal(issued.capability.cap, type);
  assert.ok(issued.capability.exp - issued.capability.iat <= CAPABILITY_MAX_AGE_SECONDS);
}

const download = await issueCapability({ ...base, type: 'download' });
await verifyCapability({ secret: SECRET, token: download.token, expected, now: plus(11) });

const modifiedCapability = download.token.slice(0, -1) + (download.token.endsWith('A') ? 'B' : 'A');
await assert.rejects(() => verifyCapability({ secret: SECRET, token: modifiedCapability, expected, now: plus(11) }));
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected, now: plus(10 + CAPABILITY_MAX_AGE_SECONDS) }),
  'token_expired'
);
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected: { ...expected, userId: 'wrong-user' }, now: plus(11) }),
  'capability_user_mismatch'
);
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected: { ...expected, sessionId: 'wrong-session' }, now: plus(11) }),
  'capability_session_mismatch'
);
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected: { ...expected, resourceId: 'wrong-resource' }, now: plus(11) }),
  'capability_resource_mismatch'
);
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected: { ...expected, viewId: 'maths-level3' }, now: plus(11) }),
  'capability_view_mismatch'
);
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected: { ...expected, lessonId: 'wrong-lesson' }, now: plus(11) }),
  'capability_lesson_mismatch'
);
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected: { ...expected, type: 'video' }, now: plus(11) }),
  'capability_type_mismatch'
);
await rejectsCode(
  () => verifyCapability({ secret: SECRET, token: download.token, expected: { ...expected, accessVersion: 'wrong-access-version' }, now: plus(11) }),
  'capability_access_mismatch'
);
await assert.rejects(
  () => issueCapability({ ...base, type: 'download', ttlSeconds: CAPABILITY_MAX_AGE_SECONDS + 1 }),
  /capability ttl/
);

// Answer Pack password is live/current on every open, never cached into capability.
let currentPassword = 'Aa1x';
let validationCalls = 0;
let failedAttempts = 0;
let blocked = false;
const answerAdapters = {
  checkRateLimit: async () => ({ allowed: !blocked, retryAfterSeconds: blocked ? 60 : 0 }),
  validateCurrentPassword: async ({ password }) => {
    validationCalls += 1;
    return password === currentPassword;
  },
  recordFailedAttempt: async () => { failedAttempts += 1; },
  clearFailedAttempts: async () => { failedAttempts = 0; }
};
const answerRequest = {
  viewId: 'maths-year6',
  lessonId: 'Y6T1M01',
  resourceId: 'answer-pack-1',
  accessVersion: 'access-snapshot-42',
  password: 'Aa1x'
};
const answer1 = await authorizeAnswerPackOpen({
  secret: SECRET,
  session: verifiedA,
  request: answerRequest,
  ...answerAdapters,
  now: plus(20)
});
assert.equal(answer1.ok, true);
assert.equal(validationCalls, 1);
assert.ok(!answer1.token.includes('Aa1x'));
assert.equal(JSON.stringify(answer1.capability).includes('Aa1x'), false);

currentPassword = 'Bb2y';
const oldPassword = await authorizeAnswerPackOpen({
  secret: SECRET,
  session: verifiedA,
  request: answerRequest,
  ...answerAdapters,
  now: plus(21)
});
assert.equal(oldPassword.ok, false);
assert.equal(oldPassword.code, 'answer_password_invalid');
assert.equal(validationCalls, 2);
assert.equal(failedAttempts, 1);

const newPassword = await authorizeAnswerPackOpen({
  secret: SECRET,
  session: verifiedA,
  request: { ...answerRequest, password: 'Bb2y' },
  ...answerAdapters,
  now: plus(22)
});
assert.equal(newPassword.ok, true);
assert.equal(validationCalls, 3);

blocked = true;
const blockedAttempt = await authorizeAnswerPackOpen({
  secret: SECRET,
  session: verifiedA,
  request: { ...answerRequest, password: 'Bb2y' },
  ...answerAdapters,
  now: plus(23)
});
assert.equal(blockedAttempt.ok, false);
assert.equal(blockedAttempt.status, 429);
assert.equal(validationCalls, 3, 'rate-limited requests must not invoke password validation');

await verifyCapability({
  secret: SECRET,
  token: newPassword.token,
  expected: {
    type: 'answer-view',
    userId: verifiedA.sub,
    sessionId: verifiedA.sid,
    viewId: answerRequest.viewId,
    lessonId: answerRequest.lessonId,
    resourceId: answerRequest.resourceId,
    accessVersion: answerRequest.accessVersion
  },
  now: plus(23)
});

// The Checkpoint 5 core is deliberately stateless on request verification.
const authCoreSource = await fs.readFile(new URL('../rebuild/shared/auth/auth-core.mjs', import.meta.url), 'utf8');
const answerSource = await fs.readFile(new URL('../rebuild/shared/auth/answer-pack-authorization.mjs', import.meta.url), 'utf8');
const combinedSource = `${authCoreSource}\n${answerSource}`;
assert.doesNotMatch(combinedSource, /\.prepare\s*\(/);
assert.doesNotMatch(combinedSource, /student_sessions|last_activity_at|idle_expires_at|touchSession/);

console.log('Checkpoint 5 authentication/capability gate: PASS');
console.log('Verified: 8h absolute signed sessions, multi-device coexistence, 5m scoped capabilities, exact binding failures, live Answer Pack password/rate adapters, no per-request D1 session lookup.');
