import fs from 'node:fs';
import assert from 'node:assert/strict';
import { compileLessonDetail } from '../rebuild/adminops/src/lib/compiler.mjs';

const detail = await compileLessonDetail({
  lessonId:'Y5E2', title:'Fixture',
  preLessonSheets:[{r2Key:'core-pre.pdf',displayName:'Core Pre'}],
  homeworks:[{homework:{r2Key:'core-home.pdf',displayName:'Core Homework'},answerPack:{r2Key:'core-home-a.pdf',displayName:'Core Answer'}}],
  phase11Resources:{
    core:{cumulativeHomeworks:[{homework:{r2Key:'core-cum.pdf'},answerPack:{r2Key:'core-cum-a.pdf'}}]},
    elevenPlus:{
      preLessonPairs:[{sheet:{r2Key:'11-pre.pdf'},answerPack:{r2Key:'11-pre-a.pdf'}}],
      homeworks:[{homework:{r2Key:'11-home.pdf'},answerPack:{r2Key:'11-home-a.pdf'}}]
    },
    vr:{supplementaryAnswers:[{r2Key:'vr-extra-a.pdf'}]}
  },
  vr:{
    preLesson:[{sheet:{r2Key:'vr-pre.pdf'},answerKey:{r2Key:'vr-pre-a.pdf'}}],
    homeworks:[{homework:{r2Key:'vr-home.pdf'},answerPack:{r2Key:'vr-home-a.pdf'}}]
  }
},{resourceExists:async()=>true});

const byKey = Object.fromEntries(detail.resources.map(row=>[row.objectKey,row]));
assert.equal(byKey['core-pre.pdf'].presentationGroup,'core-prelesson');
assert.equal(byKey['core-home.pdf'].presentationGroup,'core-homework');
assert.equal(byKey['core-home-a.pdf'].presentationGroup,'core-homework');
assert.equal(byKey['core-home-a.pdf'].protected,true);
assert.equal(byKey['core-cum.pdf'].presentationGroup,'core-cumulative');
assert.equal(byKey['11-pre.pdf'].presentationGroup,'elevenplus-prelesson');
assert.deepEqual(byKey['11-pre.pdf'].presentationScopes,['elevenPlus']);
assert.equal(byKey['11-home-a.pdf'].presentationGroup,'elevenplus-homework');
assert.equal(byKey['vr-pre.pdf'].presentationGroup,'vr-prelesson');
assert.deepEqual(byKey['vr-pre.pdf'].presentationScopes,['vr']);
assert.equal(byKey['vr-pre-a.pdf'].presentationGroup,'vr-prelesson');
assert.equal(byKey['vr-pre-a.pdf'].protected,true);
assert.equal(byKey['vr-home.pdf'].presentationGroup,'vr-homework');
assert.equal(byKey['vr-home-a.pdf'].presentationGroup,'vr-homework');
assert.equal(byKey['vr-extra-a.pdf'].presentationGroup,'vr-answers');

const runtime = fs.readFileSync(new URL('../rebuild/student/src/lib/runtime.mjs', import.meta.url),'utf8');
assert.match(runtime,/presentationScopes:\s*resourcePresentationScopes\(resource\)/);
assert.match(runtime,/presentationGroup:\s*clean\(resource\.presentationGroup\)/);
console.log('REBUILD_CP12_RESOURCE_PRESENTATION_GROUPS_PASS');
