import assert from 'node:assert/strict';
import { collectPhase11ExtensionResources } from '../rebuild/shared/read-models/phase11-extension-resources.mjs';

const y5 = {
  vr: {
    preLesson: [{
      sheet: { displayName: 'FAR070225Y5T1EE01VRP01.pdf', r2Key: 'english/year5/Y5E2/vr/prelesson/FAR070225Y5T1EE01VRP01.pdf' },
      answerKey: { displayName: 'Answer key FAR070225Y5T1EE01VRP01A.pdf', r2Key: 'english/year5/Y5E2/vr/prelesson/answers/Answer key FAR070225Y5T1EE01VRP01A.pdf' }
    }],
    homeworks: [{
      homework: { displayName: 'FAR210225Y5T1EE01VRH01.pdf', r2Key: 'english/year5/Y5E2/vr/homework/FAR210225Y5T1EE01VRH01.pdf' },
      answerPack: { displayName: 'Answer Key - FAR210225Y5T1EE01VRH01A.pdf', r2Key: 'english/year5/Y5E2/vr/homework/answers/Answer Key - FAR210225Y5T1EE01VRH01A.pdf' }
    }]
  },
  phase11Resources: {
    vr: {
      supplementaryAnswers: [{ displayName: 'Additional VR Answer Pack.pdf', r2Key: 'english/year5/Y5E2/vr/answers/additional.pdf' }]
    }
  }
};

const y5Rows = collectPhase11ExtensionResources(y5);
assert.equal(y5Rows.length, 5, 'Y5 canonical VR pairs plus supplementary answer must all be retained');
assert.deepEqual(y5Rows.map(row => row.type), ['prelesson', 'answer-pack', 'homework', 'answer-pack', 'answer-pack']);
assert.ok(y5Rows.every(row => row.presentationScopes?.length === 1 && row.presentationScopes[0] === 'vr'));
assert.equal(y5Rows[0].protected, undefined, 'VR PreLesson sheet must remain an ordinary resource');
assert.equal(y5Rows[1].protected, true, 'VR PreLesson answer must stay protected');
assert.equal(y5Rows[2].protected, undefined, 'VR Homework must remain an ordinary resource');
assert.equal(y5Rows[3].protected, true, 'VR Homework Answer Pack must stay protected');
assert.equal(y5Rows[4].protected, true, 'Existing VR supplementary answer protection must remain intact');

const y4 = {
  vr: {
    homeworks: [{
      homework: { displayName: 'PRI260225Y4T1EE01VRH01.pdf', r2Key: 'english/year4/Y4E1/vr/homework/PRI260225Y4T1EE01VRH01.pdf' },
      answerPack: { displayName: 'Y4 VR Homework Answer Pack.pdf', r2Key: 'english/year4/Y4E1/vr/homework/answers/Y4-VR-HW-answer.pdf' }
    }]
  }
};
const y4Rows = collectPhase11ExtensionResources(y4);
assert.equal(y4Rows.length, 2, 'Canonical VR resources must work even without phase11Resources extensions');
assert.equal(y4Rows[0].type, 'homework');
assert.equal(y4Rows[1].type, 'answer-pack');
assert.equal(y4Rows[1].protected, true);
assert.deepEqual(y4Rows[0].presentationScopes, ['vr']);
assert.deepEqual(y4Rows[1].presentationScopes, ['vr']);

const coreOnly = collectPhase11ExtensionResources({
  phase11Resources: {
    core: {
      preLessonPairs: [{ sheet: { r2Key: 'english/year5/Y5E2/prelesson/core.pdf' } }]
    }
  }
});
assert.equal(coreOnly.length, 1);
assert.equal(coreOnly[0].type, 'prelesson');
assert.equal(coreOnly[0].presentationScopes, undefined, 'ordinary core presentation must not acquire a VR scope');

console.log('CP12_VR_RESOURCE_COLLECTOR_VERIFICATION_PASS');
