import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectLessonResources, compileLessonDetail } from '../rebuild/adminops/src/lib/compiler.mjs';
import { auditLegacyLessonResourceParity, legacyPhase11Inventory } from '../rebuild/adminops/src/lib/legacy-resource-oracle.mjs';
import { resourceVisibleForView } from '../rebuild/shared/read-models/resource-visibility.mjs';

const lesson = {
  lessonId: 'L3T1M02',
  title: 'Number and Place Value II',
  preLessonSheets: [
    { displayName: 'PreLesson Sheet', r2Key: 'l3/m02/pre.pdf' }
  ],
  homeworks: [
    {
      homework: { displayName: 'Homework', r2Key: 'l3/m02/homework.pdf' },
      answerPack: { displayName: 'Answer Pack', r2Key: 'l3/m02/answer.pdf' }
    }
  ],
  phase11Resources: {
    core: {
      preLessonPairs: [
        {
          sheet: { displayName: 'PreLesson Sheet duplicate', r2Key: 'l3/m02/pre.pdf' },
          answerPack: { displayName: 'PreLesson Answer Pack', r2Key: 'l3/m02/pre-answer.pdf' }
        }
      ],
      cumulativeHomeworks: [
        {
          homework: { displayName: 'Cumulative Homework', r2Key: 'l3/m02/core-cumulative.pdf' },
          answerPack: { displayName: 'Cumulative Answer Pack', r2Key: 'l3/m02/core-cumulative-answer.pdf' }
        }
      ],
      supplementaryAnswers: [
        { displayName: 'Additional Core Answer Pack', r2Key: 'l3/m02/core-extra-answer.pdf' }
      ]
    },
    elevenPlus: {
      preLessonPairs: [
        {
          sheet: { displayName: '11+ PreLesson Sheet', r2Key: 'l3/m02/11plus-pre.pdf' },
          answerPack: { displayName: '11+ PreLesson Answer Pack', r2Key: 'l3/m02/11plus-pre-answer.pdf' }
        }
      ],
      homeworks: [
        {
          homework: { displayName: '11+ Homework', r2Key: 'l3/m02/11plus-homework.pdf' },
          answerPack: { displayName: '11+ Homework Answer Pack', r2Key: 'l3/m02/11plus-homework-answer.pdf' }
        }
      ],
      cumulativeHomeworks: [
        {
          homework: { displayName: '11+ Cumulative Homework', r2Key: 'l3/m02/11plus-cumulative.pdf' },
          answerPack: { displayName: '11+ Cumulative Answer Pack', r2Key: 'l3/m02/11plus-cumulative-answer.pdf' }
        }
      ],
      supplementaryAnswers: [
        { displayName: 'Additional 11+ Answer Pack', r2Key: 'l3/m02/11plus-extra-answer.pdf' }
      ]
    },
    vr: {
      supplementaryAnswers: [
        { displayName: 'Additional VR Answer Pack', r2Key: 'l3/m02/vr-extra-answer.pdf' }
      ]
    }
  }
};

const collected = collectLessonResources(lesson);
const parity = auditLegacyLessonResourceParity(lesson, collected);
assert.equal(parity.pass, true, JSON.stringify(parity, null, 2));
assert.equal(collected.filter(row => row.objectKey === 'l3/m02/pre.pdf').length, 1, 'Phase 11 must not duplicate an existing core resource.');

const inventory = legacyPhase11Inventory(lesson);
assert.equal(inventory.cumulativePairs, 2);
assert.equal(inventory.extensionEntries, 8);

const elevenPlusHomework = collected.find(row => row.objectKey === 'l3/m02/11plus-homework.pdf');
assert.ok(elevenPlusHomework);
assert.deepEqual(elevenPlusHomework.presentationScopes, ['elevenPlus']);
assert.equal(resourceVisibleForView(elevenPlusHomework, 'maths-year6', { vrAvailable: false }), false);
assert.equal(resourceVisibleForView(elevenPlusHomework, 'maths-level3', { vrAvailable: false }), true);

const coreCumulative = collected.find(row => row.objectKey === 'l3/m02/core-cumulative.pdf');
assert.ok(coreCumulative);
assert.equal(coreCumulative.presentationScopes, undefined);
assert.equal(resourceVisibleForView(coreCumulative, 'maths-year6', { vrAvailable: false }), true);
assert.equal(resourceVisibleForView(coreCumulative, 'maths-level3', { vrAvailable: false }), true);

const vrAnswer = collected.find(row => row.objectKey === 'l3/m02/vr-extra-answer.pdf');
assert.ok(vrAnswer?.protected);
assert.deepEqual(vrAnswer.presentationScopes, ['vr']);
assert.equal(resourceVisibleForView(vrAnswer, 'maths-level3', { vrAvailable: false }), false);
assert.equal(resourceVisibleForView(vrAnswer, 'maths-level3', { vrAvailable: true }), true);

const compiled = await compileLessonDetail(lesson, { resourceExists: async () => true });
assert.equal(compiled.resourceCount, collected.length);
assert.ok(compiled.resources.some(row => row.objectKey === 'l3/m02/11plus-cumulative.pdf' && row.presentationScopes?.includes('elevenPlus')));
assert.ok(compiled.resources.some(row => row.objectKey === 'l3/m02/11plus-cumulative-answer.pdf' && row.protected === true && row.presentationScopes?.includes('elevenPlus')));
assert.ok(compiled.resources.some(row => row.objectKey === 'l3/m02/core-cumulative-answer.pdf' && row.protected === true && !row.presentationScopes));

const tampered = collected.map(row => row.objectKey === 'l3/m02/11plus-homework.pdf'
  ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'presentationScopes'))
  : row);
assert.equal(auditLegacyLessonResourceParity(lesson, tampered).pass, false, 'Independent oracle must detect accidental 11+ widening.');

const oracleSource = fs.readFileSync(new URL('../rebuild/adminops/src/lib/legacy-resource-oracle.mjs', import.meta.url), 'utf8');
assert.equal(oracleSource.includes("from './compiler.mjs'"), false);
assert.equal(oracleSource.includes('phase11-extension-resources.mjs'), false);

console.log(JSON.stringify({
  marker: 'REBUILD_CHECKPOINT8_PHASE11_RESOURCE_PARITY_PASS',
  resourceCount: collected.length,
  phase11ExtensionEntries: inventory.extensionEntries,
  cumulativePairs: inventory.cumulativePairs,
  independentTamperDetection: true,
  elevenPlusNormalViewBlocked: true,
  protectedAnswersRetained: true
}));
