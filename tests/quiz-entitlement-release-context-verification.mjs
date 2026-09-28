import assert from 'node:assert/strict';
import { releasedLessonCodesFromView } from '../worker/src/index-step10-quiz-bridge.js';

const lessons=[
  {lessonId:'CAN-A',displayLessonId:'L3T1M01',state:'open',locked:false,accessMode:'core'},
  {lessonId:'CAN-B',displayLessonId:'L3T1M02',state:'open',locked:false,accessMode:'core'},
  {lessonId:'CAN-C',displayLessonId:'L3T1M03',state:'open',locked:false,accessMode:'core'},
  {lessonId:'CAN-D',displayLessonId:'L3T1M04',state:'open',locked:false,accessMode:'prelesson'},
  {lessonId:'CAN-E',displayLessonId:'L3T1M05',state:'blocked',locked:false,accessMode:'core'}
];

// Full-library/open presentation alone must never be quiz release evidence.
assert.deepEqual(releasedLessonCodesFromView(lessons,[],3),[]);

// Only actual core lesson entitlements are projected into the quiz release context.
assert.deepEqual(
  releasedLessonCodesFromView(lessons,['CAN-B','CAN-D','CAN-E'],3),
  ['L3T1M02']
);

// The same filter is level-specific.
assert.deepEqual(releasedLessonCodesFromView(lessons,['CAN-B'],2),[]);

console.log('QUIZ_ENTITLEMENT_RELEASE_CONTEXT_VERIFICATION_PASS');
