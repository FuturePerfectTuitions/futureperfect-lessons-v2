import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  bearerSessionToken,
  withBearerSessionCookie,
  webKitBearerFallbackEligible,
  sessionTokenFromSetCookie,
  exposeWebKitLoginFallback
} from '../worker/src/phase15-manual-access.js';

const token = 'Ab1_' + 'x'.repeat(39);
assert.equal(token.length, 43);

const bearerRequest = new Request('https://example.test/api/v1/student/session', {
  headers: { Authorization: `Bearer ${token}` }
});
assert.equal(bearerSessionToken(bearerRequest), token, 'Exact opaque bearer token was not accepted.');
assert.equal(
  bearerSessionToken(new Request('https://example.test/', { headers: { Authorization: 'Bearer too-short' } })),
  '',
  'Malformed bearer token was accepted.'
);

const adapted = withBearerSessionCookie(bearerRequest);
assert.match(adapted.headers.get('Cookie') || '', new RegExp(`fpt_v2_session=${token}`));
assert.equal(adapted.headers.get('Authorization'), `Bearer ${token}`);

const cookiePrimary = withBearerSessionCookie(new Request('https://example.test/api/v1/student/session', {
  headers: {
    Authorization: `Bearer ${token}`,
    Cookie: 'fpt_v2_session=COOKIE_PRIMARY; other=1'
  }
}));
assert.match(cookiePrimary.headers.get('Cookie') || '', /fpt_v2_session=COOKIE_PRIMARY/);
assert.equal((cookiePrimary.headers.get('Cookie') || '').includes(token), false, 'Bearer fallback overwrote primary cookie transport.');

const safariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ipadUa = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const chromeUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const firefoxUa = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';
const loginRequest = ua => new Request('https://example.test/api/v1/student/auth/login', {
  method: 'POST',
  headers: { 'User-Agent': ua, 'Content-Type': 'application/json' },
  body: '{"username":"test","password":"Te12"}'
});
assert.equal(webKitBearerFallbackEligible(loginRequest(safariUa)), true);
assert.equal(webKitBearerFallbackEligible(loginRequest(ipadUa)), true);
assert.equal(webKitBearerFallbackEligible(loginRequest(chromeUa)), false);
assert.equal(webKitBearerFallbackEligible(loginRequest(firefoxUa)), false);

const loginResponse = new Response(JSON.stringify({ ok: true, firstName: 'Test' }), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': `fpt_v2_session=${token}; Path=/; HttpOnly; Secure; SameSite=None`
  }
});
assert.equal(sessionTokenFromSetCookie(loginResponse), token);

const safariResponse = await exposeWebKitLoginFallback(loginRequest(safariUa), loginResponse);
const safariBody = await safariResponse.clone().json();
assert.equal(safariBody.sessionToken, token, 'Safari/WebKit login did not receive controlled in-memory fallback token.');
assert.equal(safariBody.sessionTransportFallback, 'in-memory-bearer');
assert.match(safariResponse.headers.get('Set-Cookie') || '', /HttpOnly; Secure; SameSite=None/);

const chromeResponse = await exposeWebKitLoginFallback(loginRequest(chromeUa), loginResponse);
const chromeBody = await chromeResponse.clone().json();
assert.equal(Object.prototype.hasOwnProperty.call(chromeBody, 'sessionToken'), false, 'Chrome login unnecessarily exposed bearer fallback token.');

const frontend = await fs.readFile('assets/phase7.js', 'utf8');
const baseWorker = await fs.readFile('worker/src/index.js', 'utf8');
assert.match(baseWorker, /HttpOnly; Secure; SameSite=None/, 'Primary secure HttpOnly cookie contract changed.');
assert.match(frontend, /sessionToken:\s*null/, 'Frontend has no explicit in-memory session state.');
assert.match(frontend, /url\.origin === workerOrigin && url\.pathname\.startsWith\('\/api\/v1\/student\/'\)/, 'Bearer fallback is not restricted to the exact Worker student API origin/path.');
assert.match(frontend, /headers\.set\('Authorization', `Bearer \$\{state\.sessionToken\}`\)/, 'Frontend does not attach the in-memory bearer token to guarded student API requests.');
assert.match(frontend, /state\.sessionToken = null;/, 'Frontend does not clear the in-memory bearer token.');

// Inspect executable persistence/write patterns rather than merely searching for
// security terminology that may legitimately appear in comments.
assert.doesNotMatch(frontend, /\blocalStorage\s*\.\s*(?:setItem|getItem|removeItem|clear)\s*\(/, 'Session bearer fallback must never be persisted in localStorage.');
assert.doesNotMatch(frontend, /\bsessionStorage\s*\.\s*(?:setItem|getItem|removeItem|clear)\s*\(/, 'Session bearer fallback must never be persisted in sessionStorage.');
assert.doesNotMatch(frontend, /\bdocument\s*\.\s*cookie\s*=/, 'Frontend must not downgrade session security to a script-readable cookie.');
assert.doesNotMatch(frontend, /[?&]sessionToken\s*=/, 'Session bearer token must never be placed in a URL query string.');

console.log('PHASE16_SESSION_TRANSPORT_STATIC_PASS');
