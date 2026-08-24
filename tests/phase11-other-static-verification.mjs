import assert from 'node:assert/strict';
import {
  normaliseElevenPlusOther,
  elevenPlusOtherAt
} from '../worker/src/phase11-other-resources.js';

const record = {
  phase11OtherResources: {
    elevenPlus: [
      { displayName: 'Creative Writing Task', r2Key: 'english/year5/Y5E2/11plus/other/task.pdf' },
      { displayName: 'Display Posters', r2Key: 'english/year5/Y5E19/11plus/other/posters.pdf' }
    ]
  }
};

const model = normaliseElevenPlusOther(record);
assert.equal(model.length, 2);
assert.equal(model[0].displayName, 'Creative Writing Task');
assert.equal(elevenPlusOtherAt(record, 2).r2Key, 'english/year5/Y5E19/11plus/other/posters.pdf');
assert.equal(elevenPlusOtherAt(record, 3), null);
assert.equal(normaliseElevenPlusOther({}).length, 0);

console.log('Phase 11 11+ other-resource helper verification: PASS');
