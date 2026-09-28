import assert from 'node:assert/strict';
import { completedL3ProfileEligible, cp12SignedV2LaunchStillValid } from '../worker/src/index-step10-quiz-bridge.js';

assert.equal(completedL3ProfileEligible({fullLibraries:['MATHS_L3_FULL'],specialAccess:['MATHS_11PLUS_QUIZ_L3_COMPLETED']}),true);
assert.equal(completedL3ProfileEligible({fullLibraries:['MATHS_L3_FULL'],specialAccess:[]}),false);
assert.equal(completedL3ProfileEligible({fullLibraries:[],specialAccess:['MATHS_11PLUS_QUIZ_L3_COMPLETED']}),false);

const now='2026-09-28T09:00:00.000Z';
const base={
  policyVersion:'quiz-release-context-v2.0',
  currentLevel:'L3',
  releasedL2LessonCodes:[],
  releasedL3LessonCodes:['L3T1M01','L3T2M24'],
  inheritedLevels:['L2'],
  portalSessionIssuer:'fpt-portal-v2',
  portalSessionKind:'session',
  portalSessionExpiresAt:'2026-09-28T10:00:00.000Z',
  generatedAt:'2026-09-28T08:59:30.000Z',
  source:'portal-live-maths11plus-release-v2'
};
const row={portal_session_token_hash:'abc'};
assert.equal(cp12SignedV2LaunchStillValid(row,{...base,eligibilityMode:'completed-l3'},now),true);
assert.equal(cp12SignedV2LaunchStillValid(row,{...base,eligibilityMode:'completed-l3',portalAssignmentId:161},now),false);
assert.equal(cp12SignedV2LaunchStillValid(row,{...base,eligibilityMode:'completed-l3',currentLevel:'L2'},now),false);
assert.equal(cp12SignedV2LaunchStillValid(row,{...base,eligibilityMode:'unknown'},now),false);
assert.equal(cp12SignedV2LaunchStillValid(row,{...base,eligibilityMode:'active-assignment',portalAssignmentId:42},now),true);
assert.equal(cp12SignedV2LaunchStillValid(row,{...base,portalAssignmentId:42},now),true);
assert.equal(cp12SignedV2LaunchStillValid(row,{...base,eligibilityMode:'active-assignment'},now),false);
console.log('COMPLETED_L3_QUIZ_REGRESSION_PASS');
