import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync('worker/src/index-step10-quiz-bridge.js', 'utf8');
const migration = fs.readFileSync('worker/migrations/0011_quiz_launch_codes.sql', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

assert.match(bridge, /import currentWorker from ['"]\.\/index-admin-tools\.js['"]/);
assert.match(bridge, /const TTL_MS\s*=\s*90_000/);
assert.match(bridge, /QUIZ_BRIDGE_SECRET/);
assert.match(bridge, /\/api\/v1\/student\/quiz\/eligibility/);
assert.match(bridge, /\/api\/v1\/student\/quiz\/launch/);
assert.match(bridge, /\/api\/v1\/quiz-bridge\/redeem/);
assert.match(bridge, /quiz_launch_codes/);
assert.match(bridge, /return currentWorker\.fetch\(request,env,ctx\)/);
assert.doesNotMatch(bridge, /QUIZ_BRIDGE_SECRET\s*=\s*['"][^'"]+['"]/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS quiz_launch_codes/);
assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_quiz_launch_expiry/);
assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_quiz_launch_user/);

// Gate C deploys the bridge with WORKER_ENTRYPOINT override. The canonical checked-in
// production config stays unchanged so the established regression suites continue to
// assert the normal Portal chain independently of the hidden bridge rollout.
assert.match(wrangler, /main\s*=\s*"src\/index-admin-tools\.js"/);

console.log('STEP10_QUIZ_BRIDGE_STATIC_VERIFICATION_PASS');
