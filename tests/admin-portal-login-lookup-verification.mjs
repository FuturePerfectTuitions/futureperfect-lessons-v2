import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LOOKUP_PATH,
  validPortalId,
  credentialPresence
} from '../worker/src/admin-portal-login-lookup.js';

const backend = fs.readFileSync('worker/src/admin-portal-login-lookup.js', 'utf8');
const adminTools = fs.readFileSync('worker/src/index-admin-tools.js', 'utf8');
const browser = fs.readFileSync('assets/admin-create-batch.js', 'utf8');

assert.equal(LOOKUP_PATH, '/api/v1/admin/students/lookup');
assert.equal(validPortalId('Eva2409'), true);
assert.equal(validPortalId('eva2409'), true);
assert.equal(validPortalId('bad id'), false);

assert.deepEqual(
  credentialPresence({ loginPassword:'Ab1c', answerPassword:'Cd2e' }),
  { loginPasswordStored:true, answerPasswordStored:true }
);
assert.deepEqual(
  credentialPresence({ p:'Ab1c' }),
  { loginPasswordStored:true, answerPasswordStored:false }
);

assert.match(backend, /STUDENTS_KV\.get\(`user:\$\{norm\(suppliedId\)\}`/);
assert.match(backend, /cache-control':'no-store/);
assert.match(backend, /loginPasswordStored/);
assert.match(backend, /answerPasswordStored/);
assert.doesNotMatch(backend, /STUDENTS_KV\.put/);
assert.doesNotMatch(backend, /STUDENTS_KV\.delete/);
assert.doesNotMatch(backend, /DB\.prepare/);
assert.doesNotMatch(backend, /student_batch_assignments/);
assert.doesNotMatch(backend, /entitlements\s*=/);

assert.match(adminTools, /handleAdminPortalLoginLookup/);
assert.match(adminTools, /const lookupResponse = await handleAdminPortalLoginLookup\(request, env\)/);
assert.match(browser, /Portal Login Details/);
assert.match(browser, /\/api\/v1\/admin\/students\/lookup/);
assert.match(browser, /No account data was changed/);
assert.match(browser, /Login password<\/div><div id="portalLookupLoginStored"/);
assert.match(browser, /Answer Pack password<\/div><div id="portalLookupAnswerStored"/);
assert.doesNotMatch(browser, /Reset Passwords/);

console.log('ADMIN_PORTAL_LOGIN_LOOKUP_VERIFICATION_PASS');
