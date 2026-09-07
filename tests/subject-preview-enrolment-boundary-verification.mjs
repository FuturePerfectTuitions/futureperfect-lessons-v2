import assert from 'node:assert/strict';
import {
  suppressCrossSubjectPreviewsForEnrolledSubjects,
  suppressedCrossSubjectViewIds
} from '../worker/src/index-phase20-change16.js';

// Dharm-shaped case: English Year 4 is real access from the admin CSV.
// Year 5 English exists only because Maths L2 generated a cross-subject upsell preview.
const dharm = {
  ok:true,
  subjects:[
    {
      subject:'english',
      views:[
        {
          viewId:'english-year4',
          label:'Year 4',
          lockedPreview:false,
          source:'lessonReleaseEntitlement',
          visibleLessonCount:34,
          openLessonCount:34
        },
        {
          viewId:'english-year5-11plus',
          label:'Year 5 11+',
          lockedPreview:true,
          source:'crossSubjectPreview',
          visibleLessonCount:36,
          openLessonCount:0
        }
      ]
    }
  ]
};

const suppressedBefore = suppressedCrossSubjectViewIds(dharm);
assert.equal(suppressedBefore.has('english-year5-11plus'), true);

suppressCrossSubjectPreviewsForEnrolledSubjects(dharm);
assert.deepEqual(
  dharm.subjects[0].views.map(view => view.viewId),
  ['english-year4'],
  'A student with real English access must not receive extra English years from Maths cross-subject previews'
);

// Zara-shaped upsell case: student has no actual Maths access at all.
// The locked Maths counterpart must remain visible for upsell.
const zara = {
  ok:true,
  subjects:[
    {
      subject:'maths',
      views:[
        {
          viewId:'maths-year5',
          label:'Year 5',
          lockedPreview:true,
          source:'crossSubjectPreview',
          visibleLessonCount:32,
          openLessonCount:0
        }
      ]
    },
    {
      subject:'english',
      views:[
        {
          viewId:'english-year5',
          label:'Year 5',
          lockedPreview:false,
          source:'lessonReleaseEntitlement'
        }
      ]
    }
  ]
};

suppressCrossSubjectPreviewsForEnrolledSubjects(zara);
assert.equal(zara.subjects[0].views.length, 1);
assert.equal(zara.subjects[0].views[0].viewId, 'maths-year5');
assert.equal(zara.subjects[0].views[0].lockedPreview, true);

// Multiple explicit views in an enrolled subject remain untouched.
const explicit = {
  ok:true,
  subjects:[{
    subject:'english',
    views:[
      { viewId:'english-year4', lockedPreview:false, source:'lessonReleaseEntitlement' },
      { viewId:'english-year5', lockedPreview:false, source:'lessonReleaseEntitlement' }
    ]
  }]
};
suppressCrossSubjectPreviewsForEnrolledSubjects(explicit);
assert.deepEqual(explicit.subjects[0].views.map(view => view.viewId), ['english-year4','english-year5']);

console.log('Subject preview enrolment boundary verification: PASS');
