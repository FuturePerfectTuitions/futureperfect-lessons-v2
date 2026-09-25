import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LOOKUP_PATH,
  RESET_CREDENTIALS_PATH,
  validPortalId,
  resettablePortalId,
  credentialPresence
} from '../worker/src/admin-portal-login-lookup.js';

const backend = fs.readFileSync('worker/src/admin-portal-login-lookup.js', 'utf8');
const adminTools = fs.readFileSync('worker/src/index-admin-tools.js', 'utf8');
const browser = fs.readFileSync('assets/admin-create-batch.js', 'utf8');
const resetBrowser = fs.readFileSync('assets/admin-portal-reset-credentials.js', 'utf8');

assert.equal(LOOKUP_PATH, '/api/v1/admin/students/lookup');
assert.equal(RESET_CREDENTIALS_PATH, '/api/v1/admin/students/reset-credentials');
assert.equal(validPortalId('Eva2409'), true);
assert.equal(validPortalId('bad id'), false);
assert.equal(resettablePortalId('Eva2409'), true);
assert.equal(resettablePortalId('TrialEva'), false);
assert.equal(resettablePortalId('Admin'), false);

assert.deepEqual(credentialPresence({ p:'x', answerPassword:'y' }), {
  loginPasswordStored:true,
  answerPasswordStored:true
});

assert.match(backend, /STUDENTS_KV\.get\(key/);
assert.match(backend, /STUDENTS_KV\.put\(found\.key/);
assert.match(backend, /CREDENTIAL_RESET_VERIFY_FAILED/);
assert.match(backend, /CREDENTIAL_RESET_FAILED/);
assert.doesNotMatch(backend, /DB\.prepare/);
assert.doesNotMatch(backend, /student_batch_assignments/);
assert.doesNotMatch(backend, /lesson_entitlements/);
assert.doesNotMatch(backend, /online_prelesson_entitlements/);

assert.match(adminTools, /handleAdminPortalLoginLookup/);
assert.match(browser, /Portal Login Details/);
assert.match(browser, /admin-portal-reset-credentials\.js/);
assert.match(resetBrowser, /\/api\/v1\/admin\/students\/reset-credentials/);
assert.match(resetBrowser, /portalResetCredentialsBtn/);

console.log('ADMIN_PORTAL_LOGIN_LOOKUP_VERIFICATION_PASS');
