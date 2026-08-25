import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  OWNER_HOMEWORK_OVERRIDES,
  CONFIRMED_NO_HOMEWORK_LESSONS,
  applyOwnerHomeworks,
  withOwnerHomeworkCatalogue,
  ownerHomeworkR2Keys
} from '../worker/src/phase11-owner-homeworks.js';
import { buildPhase11ApplyPackage } from '../scripts/phase11-apply-package.mjs';

const manifest = JSON.parse(
  fs.readFileSync(new URL('../docs/data/phase11/change7-owner-homeworks.json', import.meta.url), 'utf8')
);

assert.equal(manifest.phase, 11);
assert.equal(manifest.change, 7);
assert.equal(manifest.status, 'owner_review_complete');
assert.deepEqual(Object.keys(OWNER_HOMEWORK_OVERRIDES).sort(), manifest.confirmedHomeworkLessons.slice().sort());
assert.deepEqual(CONFIRMED_NO_HOMEWORK_LESSONS.slice().sort(), manifest.confirmedNoHomeworkLessons.slice().sort());
assert.equal(Object.prototype.hasOwnProperty.call(OWNER_HOMEWORK_OVERRIDES, 'Y5E14'), false);
assert.equal(JSON.stringify(OWNER_HOMEWORK_OVERRIDES).includes('Y5E14'), false);

const pairs = Object.values(OWNER_HOMEWORK_OVERRIDES).flat();
const answerPacks = pairs.filter(pair => pair.answerPack?.r2Key);
const r2Keys = ownerHomeworkR2Keys();
assert.equal(Object.keys(OWNER_HOMEWORK_OVERRIDES).length, 11);
assert.equal(pairs.length, 12);
assert.equal(answerPacks.length, 9);
assert.equal(r2Keys.length, 21);
assert.equal(new Set(r2Keys).size, 21);
assert.equal(manifest.totals.lessonsWithHomework, 11);
assert.equal(manifest.totals.homeworkPairs, 12);
assert.equal(manifest.totals.answerPacks, 9);
assert.equal(manifest.totals.r2Files, 21);

const manifestR2 = [];
for (const lesson of Object.values(manifest.lessons)) {
  for (const pair of lesson.homeworks) {
    if (pair.homework?.r2Key) manifestR2.push(pair.homework.r2Key);
    if (pair.answerPack?.r2Key) manifestR2.push(pair.answerPack.r2Key);
  }
}
assert.deepEqual(r2Keys.slice().sort(), manifestR2.slice().sort());

assert.equal(OWNER_HOMEWORK_OVERRIDES.Y4E23.length, 2);
assert.equal(OWNER_HOMEWORK_OVERRIDES.Y4E23[1].answerPack, null);
assert.equal(OWNER_HOMEWORK_OVERRIDES.Y5E11[0].answerPack, null);
assert.equal(OWNER_HOMEWORK_OVERRIDES.Y5E31[0].answerPack, null);

for (const lessonId of CONFIRMED_NO_HOMEWORK_LESSONS) {
  assert.equal(OWNER_HOMEWORK_OVERRIDES[lessonId], undefined, `${lessonId} must remain without core Homework`);
}

const baseY4E23 = { lessonId: 'Y4E23', active: true, core: { homeworks: [] } };
const patched = applyOwnerHomeworks(baseY4E23);
assert.equal(patched.homeworks.length, 2);
assert.equal(patched.homeworks[0].homework.displayName, 'Homework Y4E23 Editing.pdf');
assert.equal(patched.homeworks[0].answerPack.displayName, 'Answer Pack Homework Y4E23 Editing.pdf');
assert.equal(patched.homeworks[1].answerPack, null);
assert.equal(baseY4E23.homeworks, undefined, 'source record must not be mutated');

const idempotent = applyOwnerHomeworks(patched);
assert.equal(idempotent.homeworks.length, 2, 'reapplying overlay must not duplicate Homework');

const existingRecord = {
  lessonId: 'Y5E11',
  homeworks: [{ homework: { displayName: 'Existing', r2Key: 'english/year5/Y5E11/homework/sheets/existing.pdf' } }]
};
const appended = applyOwnerHomeworks(existingRecord);
assert.equal(appended.homeworks.length, 2, 'owner Homework should append without destroying an existing future record');
assert.equal(appended.homeworks[0].homework.r2Key, 'english/year5/Y5E11/homework/sheets/existing.pdf');
assert.equal(appended.homeworks[1].homework.r2Key, OWNER_HOMEWORK_OVERRIDES.Y5E11[0].homework.r2Key);

let getCalls = 0;
let getWithMetadataCalls = 0;
const fakeKv = {
  async get(key, options) {
    getCalls += 1;
    const record = { lessonId: key.replace(/^lesson:/, ''), active: true, homeworks: [] };
    return options === 'text' ? JSON.stringify(record) : record;
  },
  async getWithMetadata(key) {
    getWithMetadataCalls += 1;
    return { value: { lessonId: key.replace(/^lesson:/, ''), active: true, homeworks: [] }, metadata: { ok: true } };
  }
};
const env = withOwnerHomeworkCatalogue({ LESSONS_KV: fakeKv, marker: 'preserved' });
const jsonValue = await env.LESSONS_KV.get('lesson:Y5E12', { type: 'json' });
assert.equal(getCalls, 1);
assert.equal(jsonValue.homeworks.length, 1);
assert.equal(jsonValue.homeworks[0].answerPack.r2Key, OWNER_HOMEWORK_OVERRIDES.Y5E12[0].answerPack.r2Key);

const textValue = await env.LESSONS_KV.get('lesson:Y5E31', 'text');
assert.equal(getCalls, 2);
assert.equal(JSON.parse(textValue).homeworks.length, 1);

const untouched = await env.LESSONS_KV.get('lesson:Y4E38', { type: 'json' });
assert.equal(getCalls, 3);
assert.equal(untouched.homeworks.length, 0);

const meta = await env.LESSONS_KV.getWithMetadata('lesson:Y4E25', { type: 'json' });
assert.equal(getWithMetadataCalls, 1);
assert.equal(meta.metadata.ok, true);
assert.equal(meta.value.homeworks.length, 1);
assert.equal(env.marker, 'preserved');

const canonical = buildPhase11ApplyPackage().summary;
assert.equal(canonical.catalogueLessons, 369);
assert.equal(canonical.catalogueCurricula, 11);
assert.equal(canonical.lessonsKvWrites, 380);
assert.equal(canonical.r2References, 1669, 'Change 7 overlay must not rewrite the locked canonical catalogue payload');

console.log('Phase 11 Change 7 owner Homework static verification: PASS');
