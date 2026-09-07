import assert from 'node:assert/strict';
import {
  consistentViewLabel,
  normaliseNavigationLabels
} from '../worker/src/index-phase20-change9.js';

assert.equal(consistentViewLabel('english-year5-11plus'), 'Year 5 11+');
assert.equal(consistentViewLabel('english-year4-11plus'), 'Year 4 11+');
assert.equal(consistentViewLabel('maths-level1'), 'Level 1 11+');
assert.equal(consistentViewLabel('maths-level2'), 'Level 2 11+');
assert.equal(consistentViewLabel('maths-level3'), 'Level 3 11+');
assert.equal(consistentViewLabel('maths-year6'), 'Year 6');
assert.equal(consistentViewLabel('english-year3'), 'Year 3');

const body = {
  ok:true,
  subjects:[
    { subject:'english', views:[
      { viewId:'english-year5-11plus', label:'Year 5 (11+)' },
      { viewId:'english-year4-11plus', label:'Year 4 11+' }
    ] },
    { subject:'maths', views:[
      { viewId:'maths-level3', label:'Level 3 (11+)' },
      { viewId:'maths-level1', label:'Level 1' },
      { viewId:'maths-level2', label:'Level 2' }
    ] }
  ],
  recentShares:[
    { viewId:'english-year5-11plus', viewLabel:'Year 5 (11+)' }
  ],
  view:{ viewId:'maths-level3', label:'Level 3 (11+)' }
};

normaliseNavigationLabels(body);
assert.deepEqual(body.subjects[0].views.map(view => view.label), ['Year 5 11+', 'Year 4 11+']);
assert.deepEqual(body.subjects[1].views.map(view => view.label), ['Level 3 11+', 'Level 1 11+', 'Level 2 11+']);
assert.equal(body.recentShares[0].viewLabel, 'Year 5 11+');
assert.equal(body.view.label, 'Level 3 11+');

console.log('Phase 20 Change 9 UI label consistency verification: PASS');
