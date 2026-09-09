import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('worker/src/index-phase23-protected-view-stability.js', 'utf8');
const frontend = fs.readFileSync('assets/phase23-protected-view-stability.js', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

assert.match(worker, /index-phase20-change20-configured-upsell\.js/);
assert.match(worker, /ANSWER_VIEW_EXPIRED/);
assert.match(worker, /ANSWER_VIEW_ALREADY_OPENED/);
assert.match(worker, /SET used_at = NULL/);
assert.match(worker, /content_expires_at = lease_expires_at/);
assert.match(worker, /lease_expires_at > \?/);
assert.match(worker, /searchParams\.get\('status'\) === '1'/);
assert.match(worker, /x-fpt-protected-view-stability/);

// Protected-view token requests must recover the original view context. This is
// essential for Phase 12 batch-aware L1/L2/L3 students because the browser's
// /answer-view/<token> URL does not otherwise carry the viewId used at password
// authorisation time.
assert.match(worker, /SELECT token_hash, view_id, lease_expires_at/);
assert.match(worker, /requestWithProtectedViewContext/);
assert.match(worker, /row\?\.view_id/);
assert.match(worker, /url\.searchParams\.set\('viewId', viewId\)/);
assert.match(worker, /currentWorker\.fetch\(contextualRequest, env, ctx\)/);
assert.match(worker, /phase23-protected-view-stability-v2/);

assert.match(frontend, /Number\(delay\) === 30000/);
assert.match(frontend, /status=1/);
assert.match(frontend, /protectedAnswerHeartbeat/);
assert.match(frontend, /This protected answer could not be loaded/);
assert.match(frontend, /FPT_PROTECTED_VIEW_STABILITY/);

if (process.env.REQUIRE_PHASE23_ENTRYPOINT === '1') {
  assert.match(wrangler, /main = "src\/index-phase23-protected-view-stability\.js"/);
}

console.log('PROTECTED_VIEW_STABILITY_STATIC_VERIFICATION_PASS');
