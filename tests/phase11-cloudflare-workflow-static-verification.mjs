import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/phase11-cloudflare-apply.yml', 'utf8');
for (const required of [
  "github.event.pull_request.head.ref == 'ops/phase11-catalogue-apply'",
  'test "$(git diff --name-only',
  'fpt-materials-dev',
  'STUDENT_LOGIN_ENABLED',
  'phase11-prewrite-backup',
  'worker-before.bin',
  'phase11-lessons-kv-bulk.json',
  'phase11-test-students-kv-bulk.json',
  'src/index-phase11-final.js',
  'kv bulk put',
  'phase11-kv-remote-verify.mjs',
  'phase11-verify-test-d1.mjs',
  'special:Y4MAssT1',
  'special:MOCKS',
  'tests/phase11-api-verification.sh',
  'tests/phase11-browser-verification.mjs'
]) {
  assert.ok(workflow.includes(required), `Phase 11 apply workflow missing guard/step: ${required}`);
}
assert.ok(!workflow.includes('STUDENT_LOGIN_ENABLED = "true"'), 'Phase 11 workflow must not enable production student login.');
assert.ok(!workflow.includes('kv key delete'), 'Phase 11 apply workflow must not delete KV keys.');
assert.ok(!workflow.includes('r2 object delete'), 'Phase 11 apply workflow must not delete R2 objects.');

const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');
assert.ok(wrangler.includes('main = "src/index-phase10-history.js"'), 'Implementation PR must not switch the checked-in Worker entrypoint before guarded apply.');

console.log('Phase 11 guarded Cloudflare workflow static verification: PASS');
