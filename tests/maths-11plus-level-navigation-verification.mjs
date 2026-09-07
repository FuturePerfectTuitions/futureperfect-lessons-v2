import assert from 'node:assert/strict';
import { normaliseMathsElevenPlusHome } from '../worker/src/index-phase20-change15.js';

const body = {
  ok:true,
  subjects:[
    {
      subject:'maths',
      views:[
        { viewId:'maths-year3', label:'Year 3', visibleLessonCount:34, openLessonCount:34, lockedLessonCount:0, current:false, group:'previous' },
        { viewId:'maths-year4', label:'Year 4', visibleLessonCount:35, openLessonCount:35, lockedLessonCount:0, current:false, group:'previous' },
        { viewId:'maths-level1', label:'Level 1 11+', visibleLessonCount:35, openLessonCount:35, lockedLessonCount:0, current:true, group:'current' },
        { viewId:'maths-year5', label:'Year 5', visibleLessonCount:32, openLessonCount:1, lockedLessonCount:31, current:true, group:'current' }
      ]
    },
    {
      subject:'english',
      views:[{ viewId:'english-year4-11plus', label:'Year 4 11+' }]
    }
  ],
  recentShares:[
    { viewId:'maths-year5', viewLabel:'Year 5' },
    { viewId:'maths-level1', viewLabel:'Level 1 11+' }
  ]
};

normaliseMathsElevenPlusHome(body, true);

const maths = body.subjects.find(subject => subject.subject === 'maths');
assert.deepEqual(
  maths.views.map(view => view.viewId),
  ['maths-year3','maths-level1','maths-level2']
);
assert.equal(maths.views.find(view => view.viewId === 'maths-level1').label, 'L1');
assert.equal(maths.views.find(view => view.viewId === 'maths-level2').label, 'L2');
assert.equal(maths.views.find(view => view.viewId === 'maths-level1').current, true, 'Existing level/current metadata must win when Year 4 alias is merged');
assert.equal(maths.views.find(view => view.viewId === 'maths-level2').openLessonCount, 1);
assert.equal(maths.views.some(view => view.viewId === 'maths-year4'), false);
assert.equal(maths.views.some(view => view.viewId === 'maths-year5'), false);
assert.equal(body.recentShares[0].viewId, 'maths-level2');
assert.equal(body.recentShares[0].viewLabel, 'L2');
assert.equal(body.recentShares[1].viewLabel, 'L1');
assert.equal(body.subjects.find(subject => subject.subject === 'english').views[0].label, 'Year 4 11+');

const normal = {
  ok:true,
  subjects:[{ subject:'maths', views:[{ viewId:'maths-year4', label:'Year 4' }] }]
};
normaliseMathsElevenPlusHome(normal, false);
assert.equal(normal.subjects[0].views[0].viewId, 'maths-year4', 'Normal Maths student navigation must stay Year 4');

const list = { ok:true, view:{ viewId:'maths-level2', label:'Level 2 11+' } };
normaliseMathsElevenPlusHome(list, false);
assert.equal(list.view.label, 'L2');

console.log('Maths 11+ level navigation verification: PASS');
