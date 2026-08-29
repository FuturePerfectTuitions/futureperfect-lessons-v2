import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { withPartitionedSessionCookie } from '../worker/src/phase15-manual-access.js';

const token = 'Ab1_' + 'x'.repeat(39);
assert.equal(token.length, 43);

const loginRequest = new Request('https://example.test/api/v1/student/auth/login', {
  method: 'POST'
});
const loginResponse = new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': `fpt_v2_session=${token}; Path=/; HttpOnly; Secure; SameSite=None`
  }
});
const partitionedLogin = withPartitionedSessionCookie(loginRequest, loginResponse);
const loginCookie = partitionedLogin.headers.get('Set-Cookie') || '';
assert.match(loginCookie, /^fpt_v2_session=/, 'Phase 16 changed the authoritative session cookie name.');
assert.match(loginCookie, /;\s*HttpOnly(?:;|$)/i, 'Partitioned session cookie lost HttpOnly.');
assert.match(loginCookie, /;\s*Secure(?:;|$)/i, 'Partitioned session cookie lost Secure.');
assert.match(loginCookie, /;\s*SameSite=None(?:;|$)/i, 'Partitioned session cookie lost SameSite=None.');
assert.match(loginCookie, /;\s*Partitioned(?:;|$)/i, 'Login session cookie is not CHIPS Partitioned.');
assert.equal((loginCookie.match(/\bPartitioned\b/gi) || []).length, 1, 'Partitioned attribute was duplicated.');
assert.equal(partitionedLogin.headers.get('X-FPT-Session-Mode'), 'partitioned', 'Non-secret partitioned-session diagnostic marker missing.');

const logoutRequest = new Request('https://example.test/api/v1/student/auth/logout', {
  method: 'POST'
});
const logoutResponse = new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': 'fpt_v2_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0'
  }
});
const partitionedLogout = withPartitionedSessionCookie(logoutRequest, logoutResponse);
const logoutCookie = partitionedLogout.headers.get('Set-Cookie') || '';
assert.match(logoutCookie, /;\s*HttpOnly(?:;|$)/i);
assert.match(logoutCookie, /;\s*Secure(?:;|$)/i);
assert.match(logoutCookie, /;\s*SameSite=None(?:;|$)/i);
assert.match(logoutCookie, /;\s*Partitioned(?:;|$)/i, 'Logout clearing cookie is not partitioned consistently.');
assert.match(logoutCookie, /;\s*Max-Age=0(?:;|$)/i, 'Logout cookie no longer clears the session.');
assert.equal(partitionedLogout.headers.get('X-FPT-Session-Mode'), 'partitioned');

const ordinaryRequest = new Request('https://example.test/api/v1/student/session', { method: 'GET' });
const ordinaryResponse = new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': `fpt_v2_session=${token}; Path=/; HttpOnly; Secure; SameSite=None`
  }
});
const ordinaryResult = withPartitionedSessionCookie(ordinaryRequest, ordinaryResponse);
assert.equal(
  ordinaryResult.headers.get('Set-Cookie'),
  ordinaryResponse.headers.get('Set-Cookie'),
  'Phase 16 cookie compatibility wrapper mutated an unrelated endpoint.'
);
assert.equal(ordinaryResult.headers.get('X-FPT-Session-Mode'), null, 'Session-mode diagnostic marker leaked onto an unrelated endpoint.');

const alreadyPartitioned = new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: {
    'Set-Cookie': `fpt_v2_session=${token}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned`
  }
});
const idempotent = withPartitionedSessionCookie(loginRequest, alreadyPartitioned);
assert.equal(
  (String(idempotent.headers.get('Set-Cookie') || '').match(/\bPartitioned\b/gi) || []).length,
  1,
  'Partitioned cookie compatibility is not idempotent.'
);
assert.equal(idempotent.headers.get('X-FPT-Session-Mode'), 'partitioned');

const frontend = await fs.readFile('assets/phase7.js', 'utf8');
const baseWorker = await fs.readFile('worker/src/index.js', 'utf8');
const manualWorker = await fs.readFile('worker/src/phase15-manual-access.js', 'utf8');

assert.match(
  baseWorker,
  /HttpOnly; Secure; SameSite=None/,
  'Primary secure HttpOnly session-cookie contract changed unexpectedly.'
);
assert.match(
  manualWorker,
  /Set-Cookie[\s\S]*Partitioned|Partitioned[\s\S]*Set-Cookie/,
  'Phase 16 outer Worker layer does not apply the Partitioned session-cookie attribute.'
);
assert.match(manualWorker, /X-FPT-Session-Mode/, 'Phase 16 non-secret session-mode diagnostic marker is not present in the outer Worker layer.');
assert.doesNotMatch(
  manualWorker,
  /\bbearerSessionToken\b|\bwithBearerSessionCookie\b|\bwebKitBearerFallbackEligible\b|\bsessionTokenFromSetCookie\b|\bexposeWebKitLoginFallback\b/,
  'Obsolete JavaScript bearer fallback remains in the Worker layer.'
);
assert.doesNotMatch(
  manualWorker,
  /sessionTransportFallback\s*:|sessionToken\s*:/,
  'Worker must not expose the opaque session token in a JSON response.'
);
assert.doesNotMatch(
  frontend,
  /\bsessionToken\s*:/,
  'Frontend must not hold the opaque session token in JavaScript state.'
);
assert.doesNotMatch(
  frontend,
  /headers\s*\.\s*set\s*\(\s*['"]Authorization['"]/,
  'Frontend must not attach a session bearer token.'
);
assert.doesNotMatch(
  frontend,
  /\blocalStorage\s*\.\s*(?:setItem|getItem|removeItem|clear)\s*\(/,
  'Session transport must never be persisted in localStorage.'
);
assert.doesNotMatch(
  frontend,
  /\bsessionStorage\s*\.\s*(?:setItem|getItem|removeItem|clear)\s*\(/,
  'Session transport must never be persisted in sessionStorage.'
);
assert.doesNotMatch(
  frontend,
  /\bdocument\s*\.\s*cookie\s*=/,
  'Frontend must not downgrade session security to a script-readable cookie.'
);
assert.doesNotMatch(
  frontend,
  /[?&]sessionToken\s*=/,
  'Session token must never be placed in a URL query string.'
);

console.log('PHASE16_SESSION_TRANSPORT_STATIC_PASS mode=partitioned-http-only-cookie');
