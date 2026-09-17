import assert from 'node:assert/strict';
import {
  trialCompilationSource,
  applyTrialMetadata
} from '../worker/src/admin-prepared-access-publisher.js';
import {
  randomPassword,
  buildTrialRecord,
  FORBIDDEN_PASSWORDS
} from '../worker/src/admin-trial-manager.js';
import {
  trialAccount,
  trialResourceAllowed,
  consumeTrialLogin
} from '../rebuild/student/src/lib/trial-runtime.mjs';

const source = {
  asOfDate:'2026-09-17',
  user:{
    portalUserId:'TrialSej',
    firstName:'Sej',
    p:'qYY2',
    answerPassword:'jcE3',
    status:'active',
    accountStatus:'active',
    fullLibraries:[],
    manualAccess:{ coreLessons:[], vrLessons:[], specialBuckets:[] },
    trialViews:['maths-level1','maths-level2','english-year4-11plus']
  },
  batchDefinitions:[],
  batchAssignments:[],
  entitlements:[],
  onlinePreLessonEntitlements:[]
};

const catalogue = {
  kind:'prepared-catalogue',
  views:{
    'maths-level1':{ lessons:[{ lessonId:'Y4M1' },{ lessonId:'Y4M2' }] },
    'maths-level2':{ lessons:[{ lessonId:'Y5M1' }] },
    'english-year4-11plus':{ lessons:[{ lessonId:'Y4E1' },{ lessonId:'Y4E2' }] }
  },
  lessonToViews:{
    Y4M1:['maths-level1'], Y4M2:['maths-level1'], Y5M1:['maths-level2'],
    Y4E1:['english-year4-11plus'], Y4E2:['english-year4-11plus']
  }
};

const prepared = trialCompilationSource(source, catalogue);
assert.deepEqual(prepared.trialViews, ['maths-level1','maths-level2','english-year4-11plus']);
assert.deepEqual(
  [...prepared.source.user.fullLibraries].sort(),
  ['ENGLISH_Y4_11PLUS_FULL','MATHS_L1_FULL','MATHS_L2_FULL']
);
assert.deepEqual(prepared.source.user.manualAccess.vrLessons, ['Y4E1','Y4E2']);
assert.deepEqual(prepared.source.user.upsellViews, []);

const compiled = applyTrialMetadata({
  snapshot:{
    account:{ firstName:'Sej', status:'active', expiresOn:null },
    views:[
      { viewId:'maths-level1', current:false, group:'previous', lockedPreview:false },
      { viewId:'maths-level2', current:false, group:'previous', lockedPreview:false },
      { viewId:'english-year4-11plus', current:false, group:'previous', lockedPreview:false },
      { viewId:'english-year4', current:true, group:'current', lockedPreview:true }
    ],
    fullViewIds:['maths-level1','maths-level2','english-year4-11plus'],
    specialAreas:['VRHOWTO']
  }
}, prepared.trialViews);
assert.equal(compiled.snapshot.account.trial, true);
assert.deepEqual(compiled.snapshot.account.trialViews, prepared.trialViews);
assert.deepEqual(compiled.snapshot.views.map(view => view.viewId), prepared.trialViews);
assert.ok(compiled.snapshot.views.every(view => view.current === true && view.group === 'current' && view.lockedPreview === false));
assert.deepEqual(compiled.snapshot.specialAreas, []);

const account = compiled.snapshot.account;
assert.equal(trialAccount(account), true);
assert.equal(trialResourceAllowed({ type:'video', presentationScopes:['core'] }, 'maths-level1', account), true);
assert.equal(trialResourceAllowed({ type:'homework', presentationScopes:['core'] }, 'maths-level1', account), false);
assert.equal(trialResourceAllowed({ type:'homework', presentationScopes:['elevenPlus'] }, 'english-year4-11plus', account), false);
assert.equal(trialResourceAllowed({ type:'homework', presentationScopes:['vr'] }, 'english-year4-11plus', account), true);
assert.equal(trialResourceAllowed({ type:'answer-pack', protected:true, presentationScopes:['vr'] }, 'english-year4-11plus', account), true);
assert.equal(trialResourceAllowed({ type:'answer-pack', protected:true, presentationScopes:['vr'] }, 'maths-level1', account), false);

for (let i = 0; i < 250; i += 1) {
  const password = randomPassword();
  assert.equal(password.length, 4);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.equal(FORBIDDEN_PASSWORDS.has(password.toLowerCase()), false);
  assert.notEqual(password.toLowerCase(), 'csl1');
}

const record = buildTrialRecord({
  portalUserId:'TrialTest',
  firstName:'Test',
  loginPassword:'aB3x',
  answerPassword:'C4dy',
  trialViews:['english-year5-11plus']
});
assert.equal(record.p, 'aB3x');
assert.equal(record.answerPassword, 'C4dy');
assert.deepEqual(record.fullLibraries, []);
assert.deepEqual(record.trialViews, ['english-year5-11plus']);

let insertCount = 0;
const fakeEnv = {
  DB:{
    prepare(sql) {
      assert.match(sql, /INSERT INTO trial_login_consumptions/);
      return {
        bind(userId, consumedAt, fingerprint) {
          assert.equal(userId, 'trialsej');
          assert.match(consumedAt, /^2026-|^20\d\d-/);
          assert.match(fingerprint, /^[0-9a-f]{64}$/);
          return {
            async run() {
              insertCount += 1;
              return { meta:{ changes:insertCount === 1 ? 1 : 0 } };
            }
          };
        }
      };
    }
  }
};

assert.equal(await consumeTrialLogin(fakeEnv, 'TrialSej', 'fpt_session=fake-session; HttpOnly; Secure'), true);
assert.equal(await consumeTrialLogin(fakeEnv, 'TrialSej', 'fpt_session=fake-session-2; HttpOnly; Secure'), false);

console.log('REBUILT_TRIAL_MANAGER_VERIFICATION_PASS');