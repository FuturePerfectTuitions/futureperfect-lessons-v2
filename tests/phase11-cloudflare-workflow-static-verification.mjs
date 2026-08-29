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

const workerOnly = fs.readFileSync('.github/workflows/phase11-worker-performance-deploy.yml', 'utf8');
for (const required of [
  "github.event.pull_request.head.ref == 'ops/phase11-worker-performance-apply'",
  '.github/phase11-worker-performance-trigger.txt',
  'fpt-materials-dev',
  'STUDENT_LOGIN_ENABLED',
  'src/index-phase11-final.js',
  'phase11-worker-before-performance',
  'ROLLBACK_REF',
  'HOME_ORDER_SENSITIVE_CURRICULA',
  'tests/phase11-home-performance.sh',
  'tests/phase11-api-verification.sh',
  'tests/phase11-browser-verification.mjs',
  'Roll back to previous known-good Phase 11 Worker on acceptance failure'
]) {
  assert.ok(workerOnly.includes(required), `Phase 11 Worker-only workflow missing guard/step: ${required}`);
}
assert.ok(!workerOnly.includes('phase11-kv-snapshot.mjs'), 'Worker-only deploy must not require or mutate KV snapshot state.');
assert.ok(!workerOnly.includes('kv bulk put'), 'Worker-only deploy must not write KV catalogue data.');
assert.ok(!workerOnly.includes('d1 execute'), 'Worker-only deploy must not directly write or alter D1 catalogue/entitlement data.');
assert.ok(!workerOnly.includes('r2 object'), 'Worker-only deploy must not mutate R2 objects.');
assert.ok(!workerOnly.includes('STUDENT_LOGIN_ENABLED = "true"'), 'Worker-only deploy must not enable production student login.');

const diagnostic = fs.readFileSync('.github/workflows/phase11-login-diagnostic.yml', 'utf8');
for (const required of [
  "github.event.pull_request.head.ref == 'ops/phase11-login-diagnostic'",
  '.github/phase11-login-diagnostic-trigger.txt',
  'ENVIRONMENT',
  'STUDENT_LOGIN_ENABLED',
  'PRAGMA quick_check',
  'sqlite_master',
  'trg_student_sessions_single_active',
  'wrangler@${WRANGLER_VERSION} tail',
  '--format json --status error',
  'testy411m',
  'phase11-login-diagnostic'
]) {
  assert.ok(diagnostic.includes(required), `Phase 11 login diagnostic missing guard/evidence rule: ${required}`);
}
assert.ok(!diagnostic.includes('--sampling-rate 1'), 'Login diagnostic must not use Wrangler-invalid sampling rate 1.');
assert.ok(!diagnostic.includes('wrangler@${WRANGLER_VERSION} deploy'), 'Login diagnostic must never deploy a Worker.');
assert.ok(!diagnostic.includes('kv bulk put'), 'Login diagnostic must not write KV.');
assert.ok(!diagnostic.includes('r2 object'), 'Login diagnostic must not mutate R2.');
assert.ok(!diagnostic.includes('INSERT INTO'), 'Login diagnostic D1 command must not insert rows directly.');
assert.ok(!diagnostic.includes('UPDATE student_sessions'), 'Login diagnostic D1 command must not update session rows directly.');
assert.ok(!diagnostic.includes('DELETE FROM'), 'Login diagnostic D1 command must not delete rows directly.');
assert.ok(!diagnostic.includes('STUDENT_LOGIN_ENABLED = "true"'), 'Login diagnostic must not enable production student login.');

const quotaSafe = fs.readFileSync('.github/workflows/phase11-quota-safe-worker-deploy.yml', 'utf8');
for (const required of [
  "github.event.pull_request.head.ref == 'ops/phase11-quota-safe-worker-apply'",
  '.github/phase11-quota-safe-worker-trigger.txt',
  'navigationManifestSha256',
  'd82ab8d3dbefc83f1b81b1d888a85eb1de9c759326042f446ad94efdfdb22083',
  'Home navigation must use zero LESSONS_KV gets.',
  'KV get() limit exceeded for the day.',
  'loadPhase4User',
  'phase11-quota-safe-worker-before',
  'BUNDLED_MANIFEST_VALID',
  'Student/API/Chrome acceptance remains pending KV quota availability.',
  'Roll back if quota-safe Worker deployment or marker verification fails'
]) {
  assert.ok(quotaSafe.includes(required), `Phase 11 quota-safe deploy missing guard/evidence rule: ${required}`);
}
assert.ok(!quotaSafe.includes('phase11-kv-snapshot.mjs'), 'Quota-safe Worker deploy must not call KV snapshot endpoints.');
assert.ok(!quotaSafe.includes('kv bulk put'), 'Quota-safe Worker deploy must not write KV catalogue data.');
assert.ok(!quotaSafe.includes('d1 execute'), 'Quota-safe Worker deploy must not directly read/write D1 via wrangler.');
assert.ok(!quotaSafe.includes('r2 object'), 'Quota-safe Worker deploy must not mutate R2 objects.');
assert.ok(!quotaSafe.includes('tests/phase11-api-verification.sh'), 'Quota-blocked recovery deploy must not pretend full API acceptance ran.');
assert.ok(!quotaSafe.includes('tests/phase11-browser-verification.mjs'), 'Quota-blocked recovery deploy must not pretend Chrome acceptance ran.');
assert.ok(!quotaSafe.includes('STUDENT_LOGIN_ENABLED = "true"'), 'Quota-safe Worker deploy must not enable production student login.');

const homePerformance = fs.readFileSync('tests/phase11-home-performance.sh', 'utf8');
for (const required of [
  'login_with_transient_retry',
  'for attempt in 1 2 3 4 5 6',
  "[[ \"$http_code\" =~ ^5[0-9][0-9]$ ]]",
  'Deliberately single-shot',
  '/api/v1/student/home'
]) {
  assert.ok(homePerformance.includes(required), `Phase 11 home performance probe missing safety/measurement rule: ${required}`);
}
assert.equal((homePerformance.match(/\/api\/v1\/student\/home/g) || []).length, 1, 'Home performance probe must keep exactly one single-shot /home request in its measurement path.');

const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');
assert.ok(
  wrangler.includes('main = "src/index-phase10-history.js"') ||
    wrangler.includes('main = "src/index-phase12.js"') ||
    wrangler.includes('main = "src/index-phase17.js"'),
  'Checked-in Worker entrypoint must be the guarded baseline, Phase 12 progression, or frozen Phase 17 wrapper.'
);
assert.ok(!wrangler.includes('STUDENT_LOGIN_ENABLED = "true"'), 'Progressed checked-in Worker configuration must not enable normal student login.');
if (wrangler.includes('main = "src/index-phase17.js"')) {
  const phase17 = fs.readFileSync('worker/src/index-phase17.js', 'utf8');
  assert.ok(phase17.includes("import phase13Worker from './index-phase13.js';"), 'Frozen Phase 17 wrapper must inherit the accepted Phase 13 Worker.');
  assert.ok(wrangler.includes('DEV_LOGIN_ALLOWLIST = ""'), 'Frozen Phase 17 source must keep the development allowlist empty.');
}

console.log('Phase 11 guarded Cloudflare workflow static verification: PASS');
