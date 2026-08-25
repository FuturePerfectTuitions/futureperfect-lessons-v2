import assert from 'node:assert/strict';
import { loadPhase11Catalogue } from '../scripts/phase11-catalogue.mjs';
import {
  ANSWER_BASE,
  answerIdentity,
  normalisePhase11Resources,
  phase11AnswerResource
} from '../worker/src/phase11-resources.js';

const catalogue = loadPhase11Catalogue();
const target = catalogue.lessons.Y5M26;
assert.ok(target, 'Y5M26 must remain in the canonical catalogue.');
assert.equal(target.displayIds?.['maths-year5'], 'Y5T1M11');
assert.equal(target.core?.homeworks?.length, 1);
assert.equal(target.phase11Resources?.core?.supplementaryAnswers?.length, 1);

const paired = target.core.homeworks[0].answerPack;
const duplicate = target.phase11Resources.core.supplementaryAnswers[0];
assert.equal(answerIdentity(paired), answerIdentity(duplicate));

const targetModel = normalisePhase11Resources(target);
assert.equal(targetModel.core.supplementaryAnswers.length, 1, 'Duplicate slot must be retained as a tombstone for stable protected-resource indices.');
assert.equal(targetModel.core.supplementaryAnswers[0], null, 'Y5T1M11 duplicate supplementary Answer Pack must be suppressed.');
assert.equal(
  phase11AnswerResource(target, ANSWER_BASE.CORE_SUPPLEMENTARY + 1),
  null,
  'Suppressed duplicate must not remain addressable through the protected Answer Pack route.'
);
assert.equal(
  target.core.homeworks[0].answerPack.r2Key,
  'maths/level2/Y5M26/homework/answers/Answer Pack Homework L2T1M11 Multiplications and Divisions 5.pdf',
  'The canonical homework-paired Answer Pack must remain authoritative.'
);

let sourceDuplicateCount = 0;
for (const record of Object.values(catalogue.lessons)) {
  const ordinary = Array.isArray(record?.homeworks)
    ? record.homeworks
    : (Array.isArray(record?.core?.homeworks) ? record.core.homeworks : []);
  const pairedIdentities = new Set(
    ordinary
      .map(pair => answerIdentity(pair?.answerPack || pair?.answerKey || pair?.answer))
      .filter(Boolean)
  );

  const sourceSupplementary = Array.isArray(record?.phase11Resources?.core?.supplementaryAnswers)
    ? record.phase11Resources.core.supplementaryAnswers
    : [];
  for (const answer of sourceSupplementary) {
    if (pairedIdentities.has(answerIdentity(answer))) sourceDuplicateCount += 1;
  }

  const model = normalisePhase11Resources(record);
  for (const answer of model.core.supplementaryAnswers.filter(Boolean)) {
    assert.ok(
      !pairedIdentities.has(answerIdentity(answer)),
      `${record.lessonId} still exposes a homework-paired Answer Pack as a core supplementary Answer Pack.`
    );
  }
}

assert.ok(sourceDuplicateCount > 0, 'The regression fixture must contain at least one known duplicate source entry.');
console.log(`Phase 11 Answer Pack dedup verification: PASS (suppressed ${sourceDuplicateCount} catalogue duplicates)`);
