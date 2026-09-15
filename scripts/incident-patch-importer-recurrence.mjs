import fs from 'node:fs';

function replaceExact(source, from, to, label, expected = 1) {
  const count = source.split(from).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} exact matches, found ${count}`);
  return source.split(from).join(to);
}

const importerPath = 'worker/src/admin-lesson-release-import.js';
const testPath = 'tests/admin-lesson-release-import-verification.mjs';

let importer = fs.readFileSync(importerPath, 'utf8');

importer = replaceExact(
  importer,
  `  return { viewId };`,
  `  return { viewId, batch };`,
  'retain validated batch definition'
);

importer = replaceExact(
  importer,
  `  return { student, lesson, subject };`,
  `  return { student, lesson, subject, batch:batchView?.batch || null, viewId:batchView?.viewId || '' };`,
  'return validated batch semantics'
);

const oldVrGate = `validation.subject === 'english' &&\n    elevenPlusBatch(item.batchKey) &&\n    validation.student?.vrEligible === true ? 1 : 0`;
const newVrGate = `validation.subject === 'english' &&\n    clean(validation.batch?.stream).toLowerCase() === '11plus' ? 1 : 0`;
importer = replaceExact(importer, oldVrGate, newVrGate, 'profile-independent validated English11 VR gate', 2);

importer = replaceExact(
  importer,
  `     ON CONFLICT(portal_user_id_norm, lesson_id) DO UPDATE SET\n       core_access = 1,\n       last_confirmed_at = excluded.last_confirmed_at,`,
  `     ON CONFLICT(portal_user_id_norm, lesson_id) DO UPDATE SET\n       core_access = 1,\n       vr_access = CASE\n         WHEN lesson_entitlements.vr_access = 1 OR excluded.vr_access = 1 THEN 1\n         ELSE 0\n       END,\n       last_confirmed_at = excluded.last_confirmed_at,`,
  'monotonic full entitlement VR upsert'
);

fs.writeFileSync(importerPath, importer);

let test = fs.readFileSync(testPath, 'utf8');

test = replaceExact(
  test,
  `      ['Y511OE', {\n        batch_key:'Y511OE', subject:'english', school_year:5,\n        stream:'11plus', maths_level:null, active_from:'2026-09-01', active_to:null\n      }]`,
  `      ['Y511OE', {\n        batch_key:'Y511OE', subject:'english', school_year:5,\n        stream:'11plus', maths_level:null, active_from:'2026-09-01', active_to:null\n      }],\n      ['Y5FE', {\n        batch_key:'Y5FE', subject:'english', school_year:5,\n        stream:'normal', maths_level:null, active_from:'2026-09-01', active_to:null\n      }]`,
  'normal English batch test fixture'
);

test = replaceExact(
  test,
  `        vr_access:existing.vr_access ?? vrAccess,`,
  `        vr_access:(Number(existing.vr_access || 0) === 1 || Number(vrAccess || 0) === 1) ? 1 : 0,`,
  'MemoryDB monotonic VR model'
);

const insertionAnchor = `const elevenPlusDisplayAlias = {\n  ...onlineReady,\n  Lesson:'Y5T1EE01 Descriptive Writing Settings and Atmosphere'\n};`;
const regressionBlock = `// Regression: authoritative English 11+ batch semantics must grant VR even when\n// a stale student profile still says vrEligible=false. A later normal-English\n// confirmation must never revoke previously earned VR access.\nconst staleProfileEnglish11 = {\n  ...onlineReady,\n  Name:'Synthetic Full',\n  Student:'Full0202',\n  Lesson:'Y5T1EE01 Descriptive Writing Settings and Atmosphere',\n  LessonStatus:'Completed',\n  Mode:'Y511OE'\n};\nconst staleProfileEnglish11Confirm = await call(\n  '/api/v1/admin/lesson-releases/confirm',\n  { rows:[staleProfileEnglish11] },\n  token\n);\nassert.equal(staleProfileEnglish11Confirm.response.status, 200);\nassert.equal(staleProfileEnglish11Confirm.body.summary.failed, 0);\nassert.equal(\n  db.entitlements.get('full0202|Y5E2')?.vr_access,\n  1,\n  'Validated English 11+ batch must grant VR even when profile vrEligible is stale/false'\n);\n\nconst normalEnglishReconfirm = {\n  ...staleProfileEnglish11,\n  Mode:'Y5FE'\n};\nconst normalEnglishReconfirmResult = await call(\n  '/api/v1/admin/lesson-releases/confirm',\n  { rows:[normalEnglishReconfirm] },\n  token\n);\nassert.equal(normalEnglishReconfirmResult.response.status, 200);\nassert.equal(normalEnglishReconfirmResult.body.summary.failed, 0);\nassert.equal(\n  db.entitlements.get('full0202|Y5E2')?.vr_access,\n  1,\n  'A later non-11+ import must not downgrade previously earned VR access'\n);\n\n${insertionAnchor}`;
test = replaceExact(test, insertionAnchor, regressionBlock, 'recurrence regression tests');

fs.writeFileSync(testPath, test);

const forbidden = [
  `elevenPlusBatch(item.batchKey) &&\n    validation.student?.vrEligible === true`,
  `vr_access:existing.vr_access ?? vrAccess`
];
for (const needle of forbidden) {
  const aggregate = `${fs.readFileSync(importerPath, 'utf8')}\n${fs.readFileSync(testPath, 'utf8')}`;
  if (aggregate.includes(needle)) throw new Error(`Forbidden legacy entitlement logic remains: ${needle}`);
}

console.log(JSON.stringify({
  marker:'FPT_IMPORTER_RECURRENCE_PATCH_GENERATED',
  importer:importerPath,
  tests:testPath,
  semantics:[
    'validated batch_definitions stream=11plus drives English VR',
    'student profile vrEligible no longer gates release VR',
    'full entitlement vr_access is monotonic 0->1 and never 1->0'
  ]
}, null, 2));
