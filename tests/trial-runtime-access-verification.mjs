import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRIAL_RUNTIME_ACCESS_VERSION,
  TRIAL_VIEW_RULES,
  liveLessonInView,
  overlayTrialAccessEnv,
  reconcileTrialHomeBody
} from '../worker/src/index-phase24-trial-vr.js';

const selectedViews = ['maths-level1', 'maths-level2', 'english-year4-11plus'];
const originalUser = {
  portalUserId:'TrialEva',
  firstName:'Eva',
  schoolYear:4,
  status:'active',
  trialViews:[...selectedViews],
  batches:[],
  fullLibraries:[],
  upsellViews:['maths-level3'],
  vrEligible:false
};

const studentsKv = {
  async get(key, options) {
    if (String(key).toLowerCase() !== 'user:trialeva') return null;
    return options?.type === 'json'
      ? structuredClone(originalUser)
      : JSON.stringify(originalUser);
  }
};

const curriculumFixtures = {
  'curriculum:MATHS_L1': { lessonIds:['L1T1M01'] },
  'curriculum:MATHS_L2': { lessonIds:['L2T1M01'] },
  'curriculum:ENGLISH_Y4': { lessonIds:['Y4T1E01'] }
};
const lessonsKv = {
  async get(key, options) {
    const value = curriculumFixtures[String(key)] || null;
    if (value == null) return null;
    return options?.type === 'json' ? structuredClone(value) : JSON.stringify(value);
  }
};

const baseEnv = { STUDENTS_KV:studentsKv, LESSONS_KV:lessonsKv };

assert.equal(TRIAL_RUNTIME_ACCESS_VERSION, 'trial-runtime-access-v2');
assert.equal(TRIAL_VIEW_RULES['maths-level1'].fullLibrary, 'MATHS_L1_FULL');
assert.equal(TRIAL_VIEW_RULES['maths-level2'].fullLibrary, 'MATHS_L2_FULL');
assert.equal(TRIAL_VIEW_RULES['english-year4-11plus'].fullLibrary, 'ENGLISH_Y4_11PLUS_FULL');

const l1Env = overlayTrialAccessEnv(baseEnv, 'trialeva', ['maths-level1']);
const l1User = await l1Env.STUDENTS_KV.get('user:trialeva', { type:'json' });
assert.equal(l1Env.PHASE12_BYPASS_SESSION_PROFILE, true, 'Trial access must bypass a stale session-profile projection.');
assert.deepEqual(l1User.fullLibraries, ['MATHS_L1_FULL']);
assert.deepEqual(l1User.batches, ['Y4M11']);
assert.deepEqual(l1User.trialViews, ['maths-level1']);
assert.equal(l1User.schoolYear, 4);
assert.equal(l1User.vrEligible, false);
assert.deepEqual(l1User.upsellViews, [], 'Trial runtime must not leak configured upsell previews.');
assert.equal(await liveLessonInView(l1Env, 'maths-level1', 'L1T1M01'), true);
assert.equal(await liveLessonInView(l1Env, 'maths-level1', 'L2T1M01'), false);

const l2Env = overlayTrialAccessEnv(baseEnv, 'trialeva', ['maths-level2']);
const l2User = await l2Env.STUDENTS_KV.get('user:trialeva', { type:'json' });
assert.deepEqual(l2User.fullLibraries, ['MATHS_L2_FULL']);
assert.deepEqual(l2User.batches, ['Y4M11']);
assert.equal(l2User.schoolYear, 4);
assert.equal(await liveLessonInView(l2Env, 'maths-level2', 'L2T1M01'), true);

const englishEnv = overlayTrialAccessEnv(baseEnv, 'trialeva', ['english-year4-11plus']);
const englishUser = await englishEnv.STUDENTS_KV.get('user:trialeva', { type:'json' });
assert.deepEqual(englishUser.fullLibraries, ['ENGLISH_Y4_11PLUS_FULL']);
assert.deepEqual(englishUser.batches, ['Y4E11']);
assert.equal(englishUser.vrEligible, true);
assert.equal(await liveLessonInView(englishEnv, 'english-year4-11plus', 'Y4T1E01'), true);

const allEnv = overlayTrialAccessEnv(baseEnv, 'trialeva', selectedViews);
const allUser = await allEnv.STUDENTS_KV.get('user:trialeva', { type:'json' });
assert.deepEqual(new Set(allUser.fullLibraries), new Set([
  'MATHS_L1_FULL',
  'MATHS_L2_FULL',
  'ENGLISH_Y4_11PLUS_FULL'
]));
assert.deepEqual(new Set(allUser.batches), new Set(['Y4M11', 'Y4E11']));
assert.equal(allUser.vrEligible, true);

const homeBody = {
  ok:true,
  subjects:[
    { subject:'maths', label:'Maths', views:[{ viewId:'maths-level3', label:'L3', lockedPreview:true }] },
    { subject:'english', label:'English', views:[] }
  ]
};
const resolved = new Map([
  ['maths-level1', { viewId:'maths-level1', label:'L1', visibleLessonCount:1, openLessonCount:0, lockedLessonCount:1, trialCatalogueCount:1 }],
  ['maths-level2', { viewId:'maths-level2', label:'L2', visibleLessonCount:1, openLessonCount:0, lockedLessonCount:1, trialCatalogueCount:1 }],
  ['english-year4-11plus', { viewId:'english-year4-11plus', label:'Year 4 11+', visibleLessonCount:1, openLessonCount:0, lockedLessonCount:1, trialCatalogueCount:1 }]
]);
reconcileTrialHomeBody(homeBody, selectedViews, resolved);

const mathsViews = homeBody.subjects.find(subject => subject.subject === 'maths').views;
const englishViews = homeBody.subjects.find(subject => subject.subject === 'english').views;
assert.deepEqual(mathsViews.map(view => view.viewId), ['maths-level1', 'maths-level2']);
assert.deepEqual(englishViews.map(view => view.viewId), ['english-year4-11plus']);
assert.ok(mathsViews.every(view => view.visibleLessonCount > 0 && view.openLessonCount === view.visibleLessonCount));
assert.ok(englishViews.every(view => view.visibleLessonCount > 0 && view.openLessonCount === view.visibleLessonCount));
assert.ok([...mathsViews, ...englishViews].every(view => view.lockedLessonCount === 0 && view.lockedPreview === false && view.source === 'trial'));

const source = readFileSync(new URL('../worker/src/index-phase24-trial-vr.js', import.meta.url), 'utf8');
for (const marker of [
  "url.pathname === '/api/v1/student/home'",
  "url.pathname === '/api/v1/student/navigation'",
  'handleTrialHome(request, env, ctx, context)',
  'handleTrialList(request, env, ctx, context, viewId)',
  'handleTrialDetail(request, env, ctx, context, viewId, lessonId)',
  'handleTrialResource(request, env, ctx, context, viewId, parsed)',
  'handleTrialAnswerView(request, env, ctx, context)',
  'liveCatalogueLessonIds(env, viewId)'
]) {
  assert.ok(source.includes(marker), `Missing Trial runtime route wiring marker: ${marker}`);
}

console.log('TRIAL_RUNTIME_ACCESS_VERIFICATION_PASS');
