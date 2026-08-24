import assert from 'node:assert/strict';
import {
  ANSWER_BASE,
  normalisePhase11Resources,
  classifyPhase11AnswerIndex,
  phase11AnswerResource,
  bridgePhase11Answers,
  primaryDownloadResource,
  answerIndexFor
} from '../worker/src/phase11-resources.js';

assert.ok(ANSWER_BASE.CORE_PRELESSON > 2000, 'Phase 11 answer ranges must not overlap Phase 9 VR ranges.');
assert.equal(classifyPhase11AnswerIndex(3001), 'corePreLesson');
assert.equal(classifyPhase11AnswerIndex(4001), 'elevenPlusPreLesson');
assert.equal(classifyPhase11AnswerIndex(5001), 'elevenPlusHomework');
assert.equal(classifyPhase11AnswerIndex(6001), 'coreCumulative');
assert.equal(classifyPhase11AnswerIndex(7001), 'elevenPlusCumulative');
assert.equal(classifyPhase11AnswerIndex(8001), 'coreSupplementary');
assert.equal(classifyPhase11AnswerIndex(9001), 'elevenPlusSupplementary');
assert.equal(classifyPhase11AnswerIndex(10001), 'vrSupplementary');
assert.equal(classifyPhase11AnswerIndex(2001), null);

const record = {
  lessonId: 'Y5M1',
  core: {
    homeworks: [
      {
        homework: { displayName: 'Core Homework', r2Key: 'core/homework.pdf' },
        answerPack: { displayName: 'Core Answer', r2Key: 'core/answer.pdf' }
      }
    ]
  },
  phase11Resources: {
    core: {
      preLessonPairs: [
        {
          sheet: { displayName: 'PreLesson Sheet', r2Key: 'core/pre.pdf' },
          answerPack: { displayName: 'PreLesson Answer Pack', r2Key: 'core/pre-answer.pdf' }
        }
      ],
      cumulativeHomeworks: [
        {
          homework: { displayName: 'Cumulative Homework', r2Key: 'core/cumulative.pdf' },
          answerPack: { displayName: 'Cumulative Answer Pack', r2Key: 'core/cumulative-answer.pdf' }
        }
      ],
      supplementaryAnswers: [
        { displayName: 'EOS Answer Pack', r2Key: 'core/eos-answer.pdf' }
      ]
    },
    elevenPlus: {
      preLessonPairs: [
        {
          sheet: { displayName: '11+ PreLesson', r2Key: '11plus/pre.pdf' },
          answerPack: { displayName: '11+ PreLesson Answer', r2Key: '11plus/pre-answer.pdf' }
        }
      ],
      homeworks: [
        {
          homework: { displayName: '11+ Homework', r2Key: '11plus/homework.pdf' },
          answerPack: { displayName: '11+ Homework Answer', r2Key: '11plus/homework-answer.pdf' }
        }
      ],
      cumulativeHomeworks: [
        {
          homework: { displayName: '11+ Cumulative Homework', r2Key: '11plus/cumulative.pdf' },
          answerPack: { displayName: '11+ Cumulative Answer', r2Key: '11plus/cumulative-answer.pdf' }
        }
      ],
      supplementaryAnswers: [
        { displayName: 'Additional 11+ Answer', r2Key: '11plus/additional-answer.pdf' }
      ]
    },
    vr: {
      supplementaryAnswers: [
        { displayName: 'Additional VR Answer', r2Key: 'vr/additional-answer.pdf' }
      ]
    }
  }
};

const model = normalisePhase11Resources(record);
assert.equal(model.core.preLessonPairs.length, 1);
assert.equal(model.elevenPlus.homeworks.length, 1);
assert.equal(model.vr.supplementaryAnswers.length, 1);

assert.equal(primaryDownloadResource(record, 'p11corepre', 1).r2Key, 'core/pre.pdf');
assert.equal(primaryDownloadResource(record, 'p11elevenhw', 1).r2Key, '11plus/homework.pdf');
assert.equal(primaryDownloadResource(record, 'p11elevencum', 1).r2Key, '11plus/cumulative.pdf');

assert.equal(answerIndexFor('corePreLesson', 1), 3001);
assert.equal(answerIndexFor('elevenPlusHomework', 1), 5001);
assert.equal(answerIndexFor('vrSupplementary', 1), 10001);
assert.equal(phase11AnswerResource(record, 3001).r2Key, 'core/pre-answer.pdf');
assert.equal(phase11AnswerResource(record, 5001).r2Key, '11plus/homework-answer.pdf');
assert.equal(phase11AnswerResource(record, 10001).r2Key, 'vr/additional-answer.pdf');

const bridged = bridgePhase11Answers(record);
assert.equal(bridged.homeworks[0].answerPack.r2Key, 'core/answer.pdf');
assert.equal(bridged.homeworks[3000].answerPack.r2Key, 'core/pre-answer.pdf');
assert.equal(bridged.homeworks[5000].answerPack.r2Key, '11plus/homework-answer.pdf');
assert.equal(bridged.homeworks[6000].answerPack.r2Key, 'core/cumulative-answer.pdf');
assert.equal(bridged.homeworks[7000].answerPack.r2Key, '11plus/cumulative-answer.pdf');
assert.equal(bridged.homeworks[8000].answerPack.r2Key, 'core/eos-answer.pdf');
assert.equal(bridged.homeworks[9000].answerPack.r2Key, '11plus/additional-answer.pdf');
assert.equal(bridged.homeworks[10000].answerPack.r2Key, 'vr/additional-answer.pdf');

// Sheet-only and answer-only resources are legal; the helper must not fabricate counterparts.
const asymmetric = normalisePhase11Resources({
  phase11Resources: {
    core: {
      preLessonPairs: [
        { sheet: { displayName: 'Sheet only', r2Key: 'sheet-only.pdf' } },
        { answerPack: { displayName: 'Answer only', r2Key: 'answer-only.pdf' } }
      ]
    }
  }
});
assert.equal(asymmetric.core.preLessonPairs[0].primary.r2Key, 'sheet-only.pdf');
assert.equal(asymmetric.core.preLessonPairs[0].answerPack, null);
assert.equal(asymmetric.core.preLessonPairs[1].primary, null);
assert.equal(asymmetric.core.preLessonPairs[1].answerPack.r2Key, 'answer-only.pdf');

console.log('Phase 11 extra-resource model static verification: PASS');
