import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'phase11-session-efficiency-deploy.yml'),
  'utf8'
);

assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'ops\/phase11-session-efficiency-apply'/);
assert.match(workflow, /git diff --name-only/);
assert.match(workflow, /\.github\/phase11-session-efficiency-trigger\.txt/);
assert.match(workflow, /ENVIRONMENT.*development/s);
assert.match(workflow, /STUDENT_LOGIN_ENABLED/);
assert.match(workflow, /fpt-materials-dev/);
assert.match(workflow, /0007_student_session_profiles\.sql/);
assert.match(workflow, /main = "src\/index-phase11-efficient\.js"/);
assert.match(workflow, /main = "src\/index-phase11-final\.js"/);
assert.match(workflow, /phase11-api-verification\.sh/);
assert.match(workflow, /phase11-browser-verification\.mjs/);
assert.match(workflow, /phase11-kv-journey\.sh/);
assert.match(workflow, /student_session_profiles/);
assert.match(workflow, /trg_student_sessions_single_active/);
assert.match(workflow, /PRAGMA quick_check/);

// This path must not mutate the catalogue/data stores that caused the original
// quota incident. The only intended persistent mutation is the additive D1
// session-profile schema migration plus ordinary session/test activity.
assert.doesNotMatch(workflow, /kv\s+bulk\s+put/i);
assert.doesNotMatch(workflow, /kv:key\s+put/i);
assert.doesNotMatch(workflow, /r2\s+object\s+put/i);
assert.doesNotMatch(workflow, /r2\s+object\s+delete/i);
assert.doesNotMatch(workflow, /STUDENT_LOGIN_ENABLED\s*=\s*"?true/i);
assert.doesNotMatch(workflow, /futureperfect\.education/);

console.log('Phase 11 session efficiency guarded workflow static verification: PASS');
