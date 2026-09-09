import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('worker/src/index-phase23-protected-view-stability.js', 'utf8');
const frontend = fs.readFileSync('assets/phase23-protected-view-stability.js', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

assert.match(worker, /index-phase20-change20-configured-upsell\.js/);
assert.match(worker, /phase11AnswerResource/);
assert.match(worker, /classifyPhase11AnswerIndex/);
assert.match(worker, /phase23-protected-view-stability-v3/);
assert.match(worker, /SELECT[\s\S]*resource_key,[\s\S]*view_id,[\s\S]*password_fingerprint/);
assert.match(worker, /student_sessions/);
assert.match(worker, /passwordFingerprint/);
assert.match(worker, /answerPassword/);
assert.match(worker, /ACCOUNT_LOCKED/);
assert.match(worker, /ANSWER_VIEW_ALREADY_OPENED/);
assert.match(worker, /ANSWER_VIEW_EXPIRED/);
assert.match(worker, /content_expires_at > \?/);
assert.match(worker, /lease_expires_at > \?/);
assert.match(worker, /MATERIALS_R2\.get\(resource\.r2Key\)/);
assert.match(worker, /x-fpt-protected-view-stage/);
assert.match(worker, /direct-token-delivery/);

// Once password authorisation has succeeded, PDF delivery must use the exact
// session-bound token/resource rather than repeating a differently-routed lesson
// visibility check. This is essential for L1/L2/L3 and Phase 11 cumulative or
// supplementary answer resources.
assert.doesNotMatch(worker, /requestWithProtectedViewContext/);
assert.doesNotMatch(worker, /SET used_at = NULL/);
assert.match(worker, /The token exists only because the immediately preceding password-authorize/);

assert.match(frontend, /Number\(delay\) === 30000/);
assert.match(frontend, /status=1/);
assert.match(frontend, /protectedAnswerHeartbeat/);
assert.match(frontend, /FPT_PROTECTED_VIEW_STABILITY/);

if (process.env.REQUIRE_PHASE23_ENTRYPOINT === '1') {
  assert.match(wrangler, /main = "src\/index-phase23-protected-view-stability\.js"/);
}

console.log('PROTECTED_VIEW_STABILITY_STATIC_VERIFICATION_PASS');
