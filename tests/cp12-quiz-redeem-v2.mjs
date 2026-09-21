import assert from 'node:assert/strict';
import { cp12SignedV2LaunchStillValid } from '../worker/src/index-step10-quiz-bridge.js';

const now='2026-09-21T10:00:00.000Z';
const row={portal_session_token_hash:'abc123'};
const base={
  policyVersion:'quiz-release-context-v2.0',
  portalAssignmentId:1234,
  generatedAt:'2026-09-21T09:59:30.000Z',
  source:'portal-live-maths11plus-release-v2',
  portalSessionIssuer:'fpt-portal-v2',
  portalSessionKind:'session',
  portalSessionExpiresAt:'2026-09-21T11:00:00.000Z'
};

const l2={...base,currentLevel:'L2',releasedL2LessonCodes:['L2T1M01'],releasedL3LessonCodes:[],inheritedLevels:[]};
const l3={...base,currentLevel:'L3',releasedL2LessonCodes:[],releasedL3LessonCodes:['L3T1M01'],inheritedLevels:['L2']};
assert.equal(cp12SignedV2LaunchStillValid(row,l2,now),true,'valid L2 context');
assert.equal(cp12SignedV2LaunchStillValid(row,l3,now),true,'valid L3 context');
assert.equal(cp12SignedV2LaunchStillValid(row,{...l2,portalSessionExpiresAt:'2026-09-21T09:59:59.000Z'},now),false,'expired Portal session');
assert.equal(cp12SignedV2LaunchStillValid(row,{...l2,portalAssignmentId:0},now),false,'invalid assignment id');
assert.equal(cp12SignedV2LaunchStillValid(row,{...l2,inheritedLevels:['L2']},now),false,'L2 cannot inherit full L2');
assert.equal(cp12SignedV2LaunchStillValid(row,{...l2,releasedL3LessonCodes:['L3T1M01']},now),false,'L2 cannot expose L3');
assert.equal(cp12SignedV2LaunchStillValid(row,{...l3,inheritedLevels:[]},now),false,'L3 must inherit L2');
assert.equal(cp12SignedV2LaunchStillValid(row,{...l2,releasedL2LessonCodes:['BAD']},now),false,'invalid lesson code');
assert.equal(cp12SignedV2LaunchStillValid({},l2,now),false,'stored Portal token hash required');

const legacy={
  source:'portal-api-v2-live-l3-view-v1',
  l3Eligible:true,
  l2Inherited:true,
  portalSessionIssuer:'fpt-portal-v2',
  portalSessionKind:'session',
  portalSessionExpiresAt:'2026-09-21T11:00:00.000Z'
};
assert.equal(cp12SignedV2LaunchStillValid(row,legacy,now),true,'already-issued Step10 L3 launch remains redeemable');

console.log(JSON.stringify({marker:'CP12_QUIZ_REDEEM_V2_VALIDATION_PASS',l2:true,l3:true,legacyContinuity:true,failClosed:true},null,2));
