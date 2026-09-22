import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PATHS,
  FORBIDDEN_PASSWORDS,
  validPortalUserId,
  proposedPortalUserId,
  normaliseTrialViews,
  deriveSchoolYear,
  randomPassword,
  buildTrialRecord
} from '../worker/src/admin-trial-manager.js';

const source = fs.readFileSync('worker/src/admin-trial-manager.js', 'utf8');
const projected = fs.readFileSync('worker/src/admin-trial-manager-projected.js', 'utf8');
const outerWorker = fs.readFileSync('worker/src/index-phase20-change17-parent-email.js', 'utf8');
const html = fs.readFileSync('admin-import.html', 'utf8');
const browser = fs.readFileSync('assets/admin-trials.js', 'utf8');

assert.equal(PATHS.create, '/api/v1/admin/trials/create');
assert.equal(PATHS.list, '/api/v1/admin/trials/list');
assert.equal(PATHS.rearm, '/api/v1/admin/trials/rearm');
assert.equal(PATHS.disable, '/api/v1/admin/trials/disable');
assert.equal(PATHS.delete, '/api/v1/admin/trials/delete');
assert.equal(PATHS.resetPasswords, '/api/v1/admin/trials/reset-passwords');

assert.equal(validPortalUserId('TrialEva'), true);
assert.equal(validPortalUserId('trialeva'), true);
assert.equal(validPortalUserId('EvaTrial'), false);
assert.equal(validPortalUserId('AdminTrialEva'), false);
assert.equal(proposedPortalUserId('Eva Smith'), 'TrialEvaSmith');

assert.deepEqual(
  normaliseTrialViews(['maths-level1', 'MATHS-LEVEL2', 'english-year4-11plus']),
  ['maths-level1', 'maths-level2', 'english-year4-11plus']
);
assert.equal(deriveSchoolYear(['maths-level2', 'english-year4-11plus']), 4);

for (let i = 0; i < 100; i += 1) {
  const password = randomPassword();
  assert.equal(password.length, 4);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.notEqual(password.toLowerCase(), 'csl1');
}
assert.equal(FORBIDDEN_PASSWORDS.has('csl1'), true);

const record = buildTrialRecord({
  portalUserId:'TrialEva',
  firstName:'Eva',
  loginPassword:'x9By',
  answerPassword:'SW8g',
  trialViews:['maths-level1', 'maths-level2', 'english-year4-11plus']
});
assert.equal(record.portalUserId, 'TrialEva');
assert.equal(record.p, 'x9By');
assert.equal(record.loginPassword, 'x9By');
assert.equal(record.answerPassword, 'SW8g');
assert.equal(record.vrEligible, true);
assert.equal(record.schoolYear, 4);
assert.equal(record.trialDeletedAt, null);
assert.deepEqual(record.trialViews, ['maths-level1', 'maths-level2', 'english-year4-11plus']);
assert.deepEqual(record.fullLibraries, []);
assert.deepEqual(record.batches, []);

assert.match(source, /DELETE FROM trial_login_consumptions/);
assert.match(source, /DELETE FROM student_sessions WHERE portal_user_id_norm = \?/);
assert.match(source, /prefix:'user:trial'/);
assert.match(source, /trialDeletedAt/);
assert.match(source, /trialLastAction:'deleted'/);
assert.match(source, /!clean\(user\.trialDeletedAt\)/);
assert.match(source, /ACCOUNT_ALREADY_EXISTS/);
assert.match(source, /PROVISION_VERIFY_FAILED/);
assert.doesNotMatch(source, /Csl1[^'"\n]*['"]/);

assert.match(projected, /PATHS\.delete/);
assert.match(projected, /publishTrialPreparedAccess/);
assert.match(projected, /removeDeletedTrialProfile/);
assert.match(projected, /env\.STUDENTS_KV\.delete\(key\)/);
assert.match(projected, /TRIAL_PROFILE_DELETE_VERIFY_FAILED/);
assert.match(projected, /x-fpt-trial-profile/);
assert.match(outerWorker, /handleAdminTrialManager/);
assert.match(outerWorker, /const trialAdminResponse = await handleAdminTrialManager\(request, env\)/);

assert.match(html, /Trial Login Manager/);
assert.match(html, /Create Trial Login/);
assert.match(html, /Year 4 11\+ English/);
assert.match(html, /all Year 4 VR/);
assert.match(html, /Year 5 11\+ English/);
assert.match(html, /all Year 5 VR/);
assert.match(html, /assets\/admin-trials\.js/);

assert.match(browser, /\/api\/v1\/admin\/trials\/create/);
assert.match(browser, /\/api\/v1\/admin\/trials\/rearm/);
assert.match(browser, /\/api\/v1\/admin\/trials\/disable/);
assert.match(browser, /\/api\/v1\/admin\/trials\/delete/);
assert.match(browser, /\/api\/v1\/admin\/trials\/reset-passwords/);
assert.match(browser, /button\('Delete', 'delete'/);
assert.match(browser, /was deleted from Existing Trial logins/);
assert.match(browser, /Answer Pack password/);
assert.match(browser, /one Trial login is still unused/);

console.log('ADMIN_TRIAL_MANAGER_VERIFICATION_PASS');