import assert from 'node:assert/strict';
import {
  compileGlobalScope,
  compileAccessScope,
  collectLessonResources,
  globalToCatalogue
} from '../rebuild/adminops/src/lib/compiler.mjs';
import {
  prepareAccessInputForParity,
  buildAuthoritativeParityOracle,
  diffAccessParity,
  auditLessonResourceParity
} from '../rebuild/adminops/src/lib/backfill-parity-audit.mjs';

const lessons = {
  Y3A: { lessonId:'Y3A', title:'Year 3 Guest Lesson', order:1, active:true },
  L1A: { lessonId:'L1A', title:'Level 1 Historic', order:1, active:true },
  L1B: { lessonId:'L1B', title:'Level 1 Other', order:2, active:true },
  L2A: { lessonId:'L2A', title:'Level 2 Current', order:1, active:true },
  L2B: { lessonId:'L2B', title:'Level 2 Blocked', order:2, active:true },
  L3A: {
    lessonId:'L3A', title:'Level 3 Core', order:1, active:true,
    preLessonSheets:[{ displayName:'PreLesson Sheet', r2Key:'maths/L3A/pre.pdf' }],
    homeworks:[
      { homework:{ displayName:'Homework', r2Key:'maths/L3A/homework.pdf' }, answerPack:{ displayName:'Answer Pack', r2Key:'maths/L3A/answer.pdf' } },
      { homework:{ displayName:'Cumulative Homework', r2Key:'maths/L3A/cumulative.pdf' }, answerPack:{ displayName:'Answer Pack Cumulative Homework', r2Key:'maths/L3A/cumulative-answer.pdf' } }
    ]
  },
  SAT1: {
    lessonId:'SAT1', title:'SATs Preparation Measurement', order:1, active:true,
    homeworks:[{ homework:{ displayName:'SATs Homework', r2Key:'maths/SAT1/homework.pdf' }, answerPack:{ displayName:'SATs Answer Pack', r2Key:'maths/SAT1/answer.pdf' } }]
  },
  E5A: { lessonId:'E5A', title:'English Year 5', order:1, active:true }
};

const catalogueInput = {
  sourceType:'checkpoint8-synthetic',
  sourceRevision:'cp8-fixture-1',
  curricula:{
    MATHS_Y2:{ lessonIds:[] },
    MATHS_Y3:{ lessonIds:['Y3A'] },
    MATHS_L1:{ lessonIds:['L1A','L1B'] },
    MATHS_L2:{ lessonIds:['L2A','L2B'] },
    MATHS_L3:{ lessonIds:['L3A'] },
    MATHS_Y6_EXTRA:{ lessonIds:['SAT1'] },
    ENGLISH_Y2:{ lessonIds:[] }, ENGLISH_Y3:{ lessonIds:[] }, ENGLISH_Y4:{ lessonIds:[] },
    ENGLISH_Y5:{ lessonIds:['E5A'] }, ENGLISH_Y6:{ lessonIds:[] }
  },
  lessons
};

const global = compileGlobalScope(catalogueInput, { sourceType:'checkpoint8-synthetic', sourceRevision:'cp8-fixture-1' });
const catalogue = globalToCatalogue(global);
const batchDefinitions = [
  { batch_key:'Y4M11-A', subject:'maths', school_year:4, stream:'11plus', maths_level:1 },
  { batch_key:'Y5M-A', subject:'maths', school_year:5, stream:'normal', maths_level:null },
  { batch_key:'Y5E-A', subject:'english', school_year:5, stream:'normal', maths_level:null }
];

const input = {
  asOfDate:'2026-09-13',
  user:{
    firstName:'Synthetic', accountStatus:'active',
    batches:['Y5M'],
    historicalViews:['maths-level1'],
    fullLibraries:['MATHS_L2_FULL'],
    blockedLessons:['L2B'],
    manualAccess:{ coreLessons:['SAT1'], vrLessons:[] },
    upsellViews:['english-year5']
  },
  batchDefinitions,
  batchAssignments:[
    { batch_key:'Y4M11-A', subject:'maths', school_year:4, stream:'11plus', maths_level:1, effective_from:'2025-09-01', effective_to:'2026-01-15' },
    { batch_key:'Y5M-A', subject:'maths', school_year:5, stream:'normal', effective_from:'2026-01-20', effective_to:'2026-03-20' },
    { batch_key:'Y5M-A', subject:'maths', school_year:5, stream:'normal', effective_from:'2026-09-05', effective_to:null }
  ],
  entitlements:[
    { lesson_id:'L1A', core_access:1, vr_access:1, source_batch_code:null, source_lesson_date:'2025-10-10' },
    { lesson_id:'L2A', core_access:1, vr_access:0, source_batch_code:'Y5M-A', source_lesson_date:'2026-09-10' }
  ],
  onlinePreLessonEntitlements:[
    { lesson_id:'E5A', batch_key:'Y5E-A', lesson_date:'2026-09-12' }
  ],
  temporaryLessonAccess:[
    { lessonId:'Y3A', core:true, source:'guest' }
  ]
};

const prepared = prepareAccessInputForParity(input, catalogue, { asOfDate:input.asOfDate });
assert.ok(prepared.entitlements.some(row => row.lesson_id === 'L1A' && row.viewId === 'maths-level1'), 'historic 11+ hint must resolve an otherwise ambiguous shared curriculum');
assert.ok(prepared.entitlements.some(row => row.lesson_id === 'Y3A' && row.source === 'guest'), 'guest access must be represented in the compiled backfill input');

const compiled = compileAccessScope(input, catalogue, { scopeId:'cp8-synthetic', asOfDate:input.asOfDate });
const oracle = buildAuthoritativeParityOracle(input, catalogue, { asOfDate:input.asOfDate });
const parity = diffAccessParity(compiled.snapshot, oracle);
assert.equal(parity.unexplained.length, 0, `unexplained parity differences: ${JSON.stringify(parity.unexplained)}`);

const byView = new Map(compiled.snapshot.views.map(row => [row.viewId, row]));
assert.equal(byView.get('maths-level1')?.group, 'previous', 'historic 11+ access remains previous');
assert.equal(byView.get('maths-year5')?.group, 'current', 'rejoin/current batch remains current');
assert.equal(compiled.snapshot.lessonAccess.L2A?.core, true, 'Full Library/current entitlement opens L2A');
assert.equal(compiled.snapshot.lessonAccess.L2B?.blocked, true, 'blocked lesson is represented');
assert.equal(compiled.snapshot.lessonAccess.L2B?.core, false, 'blocked lesson overrides Full Library');
assert.equal(compiled.snapshot.lessonAccess.E5A?.preLessonOnly, true, 'online PreLesson-only remains limited');
assert.equal(compiled.snapshot.lessonAccess.Y3A?.core, true, 'guest grant remains full lesson access');
assert.equal(compiled.snapshot.lessonAccess.SAT1?.core, true, 'manual SATs grant is preserved');
assert.equal(byView.get('english-year5')?.lockedPreview, false, 'an actual PreLesson-only English view must not remain a locked preview');
assert.equal(byView.has('maths-year4'), false, 'historic L1 evidence must not widen into normal Year 4');

const cumulativeResources = collectLessonResources(lessons.L3A);
const resourceParity = auditLessonResourceParity(lessons.L3A, cumulativeResources);
assert.equal(resourceParity.pass, true, 'cumulative Homework and its Answer Pack must compile as separate exact resources');
assert.equal(cumulativeResources.filter(item => item.type === 'homework').length, 2);
assert.equal(cumulativeResources.filter(item => item.type === 'answer-pack').length, 2);
assert.equal(cumulativeResources.filter(item => item.type === 'answer-pack').every(item => item.protected === true), true);

const satsResources = collectLessonResources(lessons.SAT1);
assert.equal(auditLessonResourceParity(lessons.SAT1, satsResources).pass, true, 'SATs Homework/Answer Pack resource surface must remain exact');
assert.ok(global.catalogues['maths-year6'].lessons.some(row => row.lessonId === 'SAT1'), 'SATs curriculum must be part of the Year 6 presentation catalogue');
assert.ok(!global.catalogues['maths-level3'].lessons.some(row => row.lessonId === 'SAT1'), 'SATs extra curriculum must not widen into L3');

const autoPreviewInput = {
  ...input,
  user:{ ...input.user, upsellViews:undefined, fullLibraries:[] },
  batchAssignments:[
    { batch_key:'Y5M-A', subject:'maths', school_year:5, stream:'normal', effective_from:'2026-09-01', effective_to:null },
    { batch_key:'Y5E-A', subject:'english', school_year:5, stream:'normal', effective_from:'2026-09-01', effective_to:null }
  ],
  onlinePreLessonEntitlements:[]
};
const autoCompiled = compileAccessScope(autoPreviewInput, catalogue, { scopeId:'cp8-auto-preview', asOfDate:input.asOfDate });
assert.equal(autoCompiled.snapshot.views.some(row => row.lockedPreview), false, 'automatic preview is suppressed when both subjects already have actual views');

const widened = structuredClone(compiled.snapshot);
widened.lessonAccess.L2B = { ...widened.lessonAccess.L2B, core:true, blocked:false };
assert.equal(diffAccessParity(widened, oracle).pass, false, 'unexplained access widening is a security failure');
const lost = structuredClone(compiled.snapshot);
lost.lessonAccess.L2A = { ...lost.lessonAccess.L2A, core:false };
assert.equal(diffAccessParity(lost, oracle).pass, false, 'unexplained access loss is a regression');

console.log(JSON.stringify({
  marker:'REBUILD_CHECKPOINT8_BACKFILL_ACCESS_PARITY_PASS',
  zeroUnexplained:true,
  panels:{
    lateJoin:true,
    transfer:true,
    rejoin:true,
    previousAccess:true,
    fullLibrary:true,
    blockedLesson:true,
    preLessonOnly:true,
    guestManual:true,
    normal11plus:true,
    preview:true,
    sats:true,
    cumulativeHomework:true,
    answerPacks:true
  }
}));
