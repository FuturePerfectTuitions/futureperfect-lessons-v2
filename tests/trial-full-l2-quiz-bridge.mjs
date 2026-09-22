import assert from 'node:assert/strict';
import { trialDemoLaunchStillValid } from '../worker/src/index-step10-quiz-bridge-trial-demo.js';

const now = '2026-09-22T07:15:00.000Z';
const row = { portal_session_token_hash:'abc123' };
const base = {
  policyVersion:'quiz-release-context-v2.0',
  currentLevel:'L2',
  releasedL2LessonCodes:['L2T1M01','L2T1M02'],
  releasedL3LessonCodes:[],
  inheritedLevels:[],
  portalAssignmentId:null,
  generatedAt:'2026-09-22T07:14:30.000Z',
  source:'portal-live-maths11plus-release-v2',
  portalSessionIssuer:'fpt-portal-v2',
  portalSessionKind:'session',
  portalSessionExpiresAt:'2026-09-22T08:00:00.000Z',
  trialDemo:true
};

assert.equal(trialDemoLaunchStillValid(row, base, now), true, 'valid Trial full-L2 context');
assert.equal(trialDemoLaunchStillValid(row, { ...base, trialDemo:false }, now), false, 'explicit Trial flag required');
assert.equal(trialDemoLaunchStillValid(row, { ...base, currentLevel:'L3', inheritedLevels:['L2'] }, now), false, 'Trial demo cannot become L3');
assert.equal(trialDemoLaunchStillValid(row, { ...base, portalAssignmentId:2001 }, now), false, 'Trial demo cannot fabricate assignment');
assert.equal(trialDemoLaunchStillValid(row, { ...base, releasedL2LessonCodes:[] }, now), false, 'Trial demo requires L2 pool');
assert.equal(trialDemoLaunchStillValid(row, { ...base, releasedL3LessonCodes:['L3T1M01'] }, now), false, 'Trial demo cannot expose L3');
assert.equal(trialDemoLaunchStillValid(row, { ...base, inheritedLevels:['L2'] }, now), false, 'Trial demo cannot use L3 inheritance semantics');
assert.equal(trialDemoLaunchStillValid(row, { ...base, portalSessionExpiresAt:'2026-09-22T07:14:59.000Z' }, now), false, 'expired Portal session');
assert.equal(trialDemoLaunchStillValid({}, base, now), false, 'stored Portal token hash required');

console.log(JSON.stringify({ marker:'TRIAL_FULL_L2_QUIZ_BRIDGE_PASS', fullL2:true, noFakeAssignment:true, l3Blocked:true }, null, 2));
