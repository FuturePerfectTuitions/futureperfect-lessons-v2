import assert from 'node:assert/strict';
import { loadPhase11Catalogue, validatePhase11Catalogue } from '../scripts/phase11-catalogue.mjs';
import { collectLessonResources, compileLessonDetail } from '../rebuild/adminops/src/lib/compiler.mjs';
import { resourceVisibleForView } from '../rebuild/shared/read-models/resource-visibility.mjs';

const catalogue = loadPhase11Catalogue();
const summary = validatePhase11Catalogue(catalogue);
assert.equal(summary.catalogueSha256, '7ef38f56d9891e4e1ae5aaa3874ae43b18a2fcd70f8f02e34b54ff9066306663');

const y5 = catalogue.lessons?.Y5E2;
const y4 = catalogue.lessons?.Y4E1;
assert.ok(y5, 'Canonical Y5E2 must exist');
assert.ok(y4, 'Canonical Y4E1 must exist');
assert.ok(Array.isArray(y5.vr?.preLesson) && y5.vr.preLesson.length > 0, 'Y5E2 canonical VR PreLesson pair missing');
assert.ok(Array.isArray(y5.vr?.homeworks) && y5.vr.homeworks.length > 0, 'Y5E2 canonical VR Homework pair missing');
assert.ok(Array.isArray(y4.vr?.homeworks) && y4.vr.homeworks.length > 0, 'Y4E1 canonical VR Homework pair missing');

const y5Rows = collectLessonResources(y5);
const y4Rows = collectLessonResources(y4);
const findBySuffix = (rows, suffix) => rows.find(row => String(row.objectKey || '').endsWith(suffix));

const y5Pre = findBySuffix(y5Rows, 'FAR070225Y5T1EE01VRP01.pdf');
const y5PreAnswer = findBySuffix(y5Rows, 'Answer key FAR070225Y5T1EE01VRP01A.pdf');
const y5Homework = findBySuffix(y5Rows, 'FAR210225Y5T1EE01VRH01.pdf');
const y5HomeworkAnswer = findBySuffix(y5Rows, 'Answer Key - FAR210225Y5T1EE01VRH01A.pdf');
const y4Homework = findBySuffix(y4Rows, 'PRI260225Y4T1EE01VRH01.pdf');
const y4HomeworkAnswer = findBySuffix(y4Rows, 'Answer Key PRI260225Y4T1EE01VRH01A.pdf');

for (const [name, row] of Object.entries({ y5Pre, y5PreAnswer, y5Homework, y5HomeworkAnswer, y4Homework, y4HomeworkAnswer })) {
  assert.ok(row, `${name} was not compiled from the immutable canonical record`);
  assert.deepEqual(row.presentationScopes, ['vr'], `${name} must remain VR-scoped`);
  assert.equal(resourceVisibleForView(row, 'english-year5', { vrAvailable: false }), false, `${name} must not widen to ordinary non-VR students`);
  assert.equal(resourceVisibleForView(row, 'english-year5-11plus', { vrAvailable: true }), true, `${name} must be visible when VR is available`);
}
assert.equal(y5Pre.type, 'prelesson');
assert.equal(y5Pre.protected, undefined);
assert.equal(y5PreAnswer.type, 'answer-pack');
assert.equal(y5PreAnswer.protected, true);
assert.equal(y5Homework.type, 'homework');
assert.equal(y5Homework.protected, undefined);
assert.equal(y5HomeworkAnswer.type, 'answer-pack');
assert.equal(y5HomeworkAnswer.protected, true);
assert.equal(y4Homework.type, 'homework');
assert.equal(y4HomeworkAnswer.type, 'answer-pack');
assert.equal(y4HomeworkAnswer.protected, true);

const y5Detail = await compileLessonDetail(y5, { resourceExists: async () => true });
const y4Detail = await compileLessonDetail(y4, { resourceExists: async () => true });
for (const suffix of [
  'FAR070225Y5T1EE01VRP01.pdf',
  'Answer key FAR070225Y5T1EE01VRP01A.pdf',
  'FAR210225Y5T1EE01VRH01.pdf',
  'Answer Key - FAR210225Y5T1EE01VRH01A.pdf'
]) {
  assert.ok(findBySuffix(y5Detail.resources, suffix), `Prepared Y5E2 detail missing ${suffix}`);
}
for (const suffix of ['PRI260225Y4T1EE01VRH01.pdf', 'Answer Key PRI260225Y4T1EE01VRH01A.pdf']) {
  assert.ok(findBySuffix(y4Detail.resources, suffix), `Prepared Y4E1 detail missing ${suffix}`);
}

console.log(JSON.stringify({
  marker: 'CP12_VR_CANONICAL_SOURCE_VERIFICATION_PASS',
  catalogueSha256: summary.catalogueSha256,
  y5VrPreLessonPairs: y5.vr.preLesson.length,
  y5VrHomeworkPairs: y5.vr.homeworks.length,
  y4VrHomeworkPairs: y4.vr.homeworks.length,
  y5PreparedResources: y5Detail.resources.length,
  y4PreparedResources: y4Detail.resources.length,
  ordinaryNonVrWidening: false,
  protectedAnswersRetained: true
}));
