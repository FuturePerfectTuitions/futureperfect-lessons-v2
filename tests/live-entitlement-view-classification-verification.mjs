import assert from 'node:assert/strict';
import {
  LIVE_ENTITLEMENT_BATCH_DEFINITION_MARKER,
  batchDefinitionViewId,
  mathsEquivalentViews,
  entitlementMatchesView
} from '../worker/src/live-student-catalogue-overlay.js';

assert.equal(LIVE_ENTITLEMENT_BATCH_DEFINITION_MARKER, 'LIVE_ENTITLEMENT_BATCH_DEFINITION_V1');

const allMathsViews = {
  displayIds:{
    'maths-year4':'Y4T1M1',
    'maths-level1':'L1T1M1',
    'maths-year5':'Y5T1M1',
    'maths-level2':'L2T1M1',
    'maths-year6':'Y6T1M1',
    'maths-level3':'L3T1M1'
  }
};

const l3Without11InBatchCode = {
  batchKey:'L3M-A',
  batchSubject:'maths',
  batchStream:'11plus',
  batchSchoolYear:5,
  batchMathsLevel:3
};
assert.equal(batchDefinitionViewId(l3Without11InBatchCode), 'maths-level3');
assert.equal(entitlementMatchesView(l3Without11InBatchCode, allMathsViews, 'maths-level3'), true);
assert.equal(entitlementMatchesView(l3Without11InBatchCode, allMathsViews, 'maths-year6'), true, 'Year 6/L3 are equivalent curriculum presentations.');
assert.equal(entitlementMatchesView(l3Without11InBatchCode, allMathsViews, 'maths-year5'), false);

const ordinaryYear6 = {
  batchKey:'Y6M-A',
  batchSubject:'maths',
  batchStream:'normal',
  batchSchoolYear:6,
  batchMathsLevel:null
};
assert.equal(batchDefinitionViewId(ordinaryYear6), 'maths-year6');
assert.equal(entitlementMatchesView(ordinaryYear6, allMathsViews, 'maths-year6'), true);
assert.equal(entitlementMatchesView(ordinaryYear6, allMathsViews, 'maths-level3'), true, 'Transfers keep equivalent Year 6/L3 access.');

const l2Without11InBatchCode = {
  batchKey:'L2M-B',
  batchSubject:'maths',
  batchStream:'11plus',
  batchSchoolYear:5,
  batchMathsLevel:2
};
assert.equal(batchDefinitionViewId(l2Without11InBatchCode), 'maths-level2');
assert.equal(entitlementMatchesView(l2Without11InBatchCode, allMathsViews, 'maths-level2'), true);
assert.equal(entitlementMatchesView(l2Without11InBatchCode, allMathsViews, 'maths-year5'), true);
assert.equal(entitlementMatchesView(l2Without11InBatchCode, allMathsViews, 'maths-level3'), false);

assert.equal(mathsEquivalentViews('maths-year4', 'maths-level1'), true);
assert.equal(mathsEquivalentViews('maths-year5', 'maths-level2'), true);
assert.equal(mathsEquivalentViews('maths-year6', 'maths-level3'), true);
assert.equal(mathsEquivalentViews('maths-year6', 'maths-level2'), false);

const englishRecord = {
  displayIds:{
    'english-year5':'Y5E1',
    'english-year5-11plus':'Y5E1-11+'
  }
};
const english11 = {
  batchKey:'L2E-B',
  batchSubject:'english',
  batchStream:'11plus',
  batchSchoolYear:5,
  batchMathsLevel:2
};
assert.equal(batchDefinitionViewId(english11), 'english-year5-11plus');
assert.equal(entitlementMatchesView(english11, englishRecord, 'english-year5-11plus'), true);
assert.equal(entitlementMatchesView(english11, englishRecord, 'english-year5'), false, 'English normal and 11+ remain distinct.');

const legacy11 = { batchKey:'Y6-11-M' };
assert.equal(entitlementMatchesView(legacy11, allMathsViews, 'maths-level3'), true, 'Legacy unresolved batch rows retain compatibility fallback.');
const legacyNormal = { batchKey:'Y6M' };
assert.equal(entitlementMatchesView(legacyNormal, allMathsViews, 'maths-year6'), true);

console.log('LIVE_ENTITLEMENT_VIEW_CLASSIFICATION_PASS');
