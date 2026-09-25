import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PATHS,
  validIsoDate,
  proposedStudentPortalUserId,
  validStudentPortalUserId,
  normaliseBatchKey,
  validBatchKey,
  batchActiveOn,
  normaliseBatchKeys,
  deriveSchoolYear,
  deriveVrEligible,
  buildStudentRecord
} from '../worker/src/admin-student-manager.js';
import {
  CREATE_PATH,
  validBatchKey as validBatchKeyV2,
  validIsoDate as validIsoDateV2,
  batchActiveOn as batchActiveOnV2
} from '../worker/src/admin-batch-manager-v2.js';

const source = fs.readFileSync('worker/src/admin-student-manager.js', 'utf8');
const batchManagerV2 = fs.readFileSync('worker/src/admin-batch-manager-v2.js', 'utf8');
const adminTools = fs.readFileSync('worker/src/index-admin-tools.js', 'utf8');
const outerWorker = fs.readFileSync('worker/src/index-phase20-change17-parent-email.js', 'utf8');
const browser = fs.readFileSync('assets/admin-trials.js', 'utf8');
const batchBrowser = fs.readFileSync('assets/admin-create-batch.js', 'utf8');
const html = fs.readFileSync('admin-import.html', 'utf8');

assert.equal(PATHS.batches, '/api/v1/admin/students/batches');
assert.equal(PATHS.batchCreate, '/api/v1/admin/students/batches/create');
assert.equal(PATHS.create, '/api/v1/admin/students/create');
assert.equal(CREATE_PATH, '/api/v1/admin/students/batches/create');

assert.equal(validIsoDate('2016-12-13'), true);
assert.equal(validIsoDate('2016-02-30'), false);
assert.equal(validIsoDateV2('2026-09-25'), true);
assert.equal(validIsoDateV2('2026-02-30'), false);
assert.equal(proposedStudentPortalUserId('Eva', '2016-12-13'), 'Eva1312');
assert.equal(proposedStudentPortalUserId('Aarav Singh', '2017-04-02'), 'AaravSingh0204');
assert.equal(proposedStudentPortalUserId('Éva', '2016-12-13'), 'Eva1312');
assert.equal(proposedStudentPortalUserId('Eva', 'bad-date'), '');
assert.equal(validStudentPortalUserId('Eva1312'), true);
assert.equal(validStudentPortalUserId('TrialEva'), false);
assert.equal(validStudentPortalUserId('Admin'), false);

assert.equal(normaliseBatchKey(' y411oe2 '), 'Y411OE2');
assert.equal(validBatchKey('Y411OE2'), true);
assert.equal(validBatchKeyV2('Y411OE2'), true);
assert.equal(validBatchKey('Y411 OE2'), false);
assert.equal(validBatchKeyV2('Y411 OE2'), false);

assert.deepEqual(normaliseBatchKeys(['Y511FM', 'Y511FM', ' Y511FE ']), ['Y511FM', 'Y511FE']);
assert.equal(batchActiveOn({ active_from:'2026-09-01', active_to:null }, '2026-09-22'), true);
assert.equal(batchActiveOnV2({ active_from:'2026-10-01', active_to:null }, '2026-09-22'), false);
assert.equal(batchActiveOnV2({ active_from:'2026-09-01', active_to:'2026-09-20' }, '2026-09-22'), false);

const definitions = [
  { batch_key:'Y511FM', subject:'maths', school_year:5, stream:'11plus', maths_level:2 },
  { batch_key:'Y511FE', subject:'english', school_year:5, stream:'11plus', maths_level:null }
];
assert.equal(deriveSchoolYear(definitions), 5);
assert.equal(deriveVrEligible(definitions), true);

const record = buildStudentRecord({
  portalUserId:'Eva1312',
  firstName:'Eva',
  loginPassword:'x9By',
  answerPassword:'SW8g',
  batchDefinitions:definitions
});
assert.equal(record.portalUserId, 'Eva1312');
assert.equal(record.answerPassword, 'SW8g');
assert.equal(record.schoolYear, 5);
assert.equal(record.vrEligible, true);
assert.deepEqual(record.batches, ['Y511FM', 'Y511FE']);

assert.match(source, /INSERT INTO student_batch_assignments/);
assert.match(source, /assertReadModelReconciliationReady/);
assert.match(source, /refreshStudentAccessReadModel/);
assert.match(source, /STUDENT_PROVISION_FAILED/);
assert.match(source, /await rollbackProvision/);
assert.doesNotMatch(source, /trial_login_consumptions/);

assert.match(batchManagerV2, /INSERT INTO batch_definitions/);
assert.match(batchManagerV2, /created_at, updated_at/);
assert.match(batchManagerV2, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/);
assert.match(batchManagerV2, /BATCH_ALREADY_EXISTS/);
assert.match(batchManagerV2, /UNIQUE constraint failed:\\s\*batch_definitions\\\.batch_key/);
assert.doesNotMatch(batchManagerV2, /\/unique\|constraint\/i/);
assert.match(batchManagerV2, /TEMPLATE_NOT_ACTIVE_ON_DATE/);
assert.doesNotMatch(batchManagerV2, /BATCH_REACTIVATE/);
assert.doesNotMatch(batchManagerV2, /UPDATE batch_definitions/);

assert.match(adminTools, /handleAdminBatchManagerV2/);
assert.match(adminTools, /const batchResponse = await handleAdminBatchManagerV2\(request, env\)/);
assert.match(outerWorker, /handleAdminStudentManager/);
assert.match(browser, /Create Student Login/);
assert.match(browser, /\/api\/v1\/admin\/students\/batches/);
assert.match(browser, /\/api\/v1\/admin\/students\/create/);

assert.match(batchBrowser, /Create a new batch/);
assert.match(batchBrowser, /\$\{key\} \$\{detail\}/);
assert.match(batchBrowser, /\/api\/v1\/admin\/students\/batches\/create/);
assert.doesNotMatch(batchBrowser, /\/api\/v1\/admin\/students\/batches\/reactivate/);
assert.doesNotMatch(batchBrowser, /Reactivate existing batch/);
assert.match(batchBrowser, /created and selected\. Continue with Create Student Login/);
assert.match(batchBrowser, /Batch code \$\{batchKey\} is already in use\. Choose a different batch code\./);
assert.match(batchBrowser, /refreshAndSelectBatch/);
assert.match(html, /assets\/admin-create-batch\.js/);
assert.ok(html.indexOf('assets/admin-trials.js') < html.indexOf('assets/admin-create-batch.js'));

console.log('ADMIN_STUDENT_MANAGER_VERIFICATION_PASS');
