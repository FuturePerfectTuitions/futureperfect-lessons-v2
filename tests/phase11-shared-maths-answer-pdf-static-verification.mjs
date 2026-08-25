import assert from 'node:assert/strict';
import {
  parseAnswerResourceKey,
  answerOverrideTarget,
  prepareSharedMathsAnswerPdfEnv
} from '../worker/src/phase11-shared-maths-answer-pdf.js';
import { SHARED_MATHS_ANSWER_PDF_OVERRIDES } from '../worker/src/phase11-shared-maths-answer-pdf-overrides.js';

assert.equal(SHARED_MATHS_ANSWER_PDF_OVERRIDES.length, 31);
assert.equal(SHARED_MATHS_ANSWER_PDF_OVERRIDES.filter(x => x.viewId === 'maths-year4').length, 10);
assert.equal(SHARED_MATHS_ANSWER_PDF_OVERRIDES.filter(x => x.viewId === 'maths-year5').length, 6);
assert.equal(SHARED_MATHS_ANSWER_PDF_OVERRIDES.filter(x => x.viewId === 'maths-year6').length, 15);
assert.equal(new Set(SHARED_MATHS_ANSWER_PDF_OVERRIDES.map(x => x.overrideR2Key)).size, 31);

assert.deepEqual(parseAnswerResourceKey('Y4M10~answer~1'), { lessonId: 'Y4M10', answerIndex: 1 });
assert.deepEqual(parseAnswerResourceKey('Y5M1~answer~1'), { lessonId: 'Y5M1', answerIndex: 1 });
assert.deepEqual(parseAnswerResourceKey('Y6M2.1~answer~1'), { lessonId: 'Y6M2.1', answerIndex: 1 });
assert.equal(parseAnswerResourceKey('Y5M1~homework~1'), null);

for (const [viewId, lessonId, answerIndex, yearCode, levelCode, expectedKey] of [
  ['maths-year4','Y4M10',1,'Y4T1M09','L1T1M09','phase11/view-overrides/maths-year4/Y4M10/homework/answers/01-Y4T1M09.pdf'],
  ['maths-year5','Y5M1',1,'Y5T1M01','L2T1M01','phase11/view-overrides/maths-year5/Y5M1/homework/answers/01-Y5T1M01.pdf'],
  ['maths-year6','Y6M2.1',1,'Y6T1M01','L3T1M01','phase11/view-overrides/maths-year6/Y6M2.1/homework/answers/01-Y6T1M01.pdf'],
  ['maths-year6','Y6M10',2,'Y6T1M10','L3T1M10','phase11/view-overrides/maths-year6/Y6M10/homework/answers/02-Y6T1M10.pdf']
]) {
  const target = answerOverrideTarget({ viewId, lessonId, answerIndex });
  assert.ok(target);
  assert.equal(target.yearCode, yearCode);
  assert.equal(target.levelCode, levelCode);
  assert.equal(target.r2Key, expectedKey);
  assert.match(target.sourceSha256, /^[a-f0-9]{64}$/);
  assert.ok(target.sourceLevelTextCount > 0);
}

// These PDFs were scanned and contain neither the Year nor Level code internally,
// so they must keep using their canonical shared object rather than creating a
// pointless derived copy.
assert.equal(answerOverrideTarget({ viewId: 'maths-year4', lessonId: 'Y4M1', answerIndex: 1 }), null);
assert.equal(answerOverrideTarget({ viewId: 'maths-year6', lessonId: 'Y6M1', answerIndex: 1 }), null);
assert.equal(answerOverrideTarget({ viewId: 'maths-level2', lessonId: 'Y5M1', answerIndex: 1 }), null);

const calls=[];
const sourceR2={
  async head(key){ calls.push(['head',key]); return {key}; },
  async get(key){ calls.push(['get',key]); return {key,body:new Uint8Array([1])}; }
};
const authorizeEnv={ MATERIALS_R2: sourceR2, DB:{prepare(){ throw new Error('authorize must not read D1'); }} };
for (const [viewId,lessonId,answerIndex,expectedKey] of [
  ['maths-year4','Y4M10',1,'phase11/view-overrides/maths-year4/Y4M10/homework/answers/01-Y4T1M09.pdf'],
  ['maths-year5','Y5M1',1,'phase11/view-overrides/maths-year5/Y5M1/homework/answers/01-Y5T1M01.pdf'],
  ['maths-year6','Y6M2.1',1,'phase11/view-overrides/maths-year6/Y6M2.1/homework/answers/01-Y6T1M01.pdf']
]) {
  const req=new Request(`https://example.test/api/v1/student/resources/${lessonId}~answer~${answerIndex}/answer/authorize?viewId=${viewId}`,{method:'POST'});
  const env=await prepareSharedMathsAnswerPdfEnv(req,authorizeEnv);
  await env.MATERIALS_R2.head('canonical-source.pdf');
  assert.deepEqual(calls.pop(),['head',expectedKey]);
}

const unchangedReq=new Request('https://example.test/api/v1/student/resources/Y4M1~answer~1/answer/authorize?viewId=maths-year4',{method:'POST'});
const unchangedEnv=await prepareSharedMathsAnswerPdfEnv(unchangedReq,authorizeEnv);
await unchangedEnv.MATERIALS_R2.head('canonical-source.pdf');
assert.deepEqual(calls.pop(),['head','canonical-source.pdf']);

const levelReq=new Request('https://example.test/api/v1/student/resources/Y5M1~answer~1/answer/authorize?viewId=maths-level2',{method:'POST'});
const levelEnv=await prepareSharedMathsAnswerPdfEnv(levelReq,authorizeEnv);
await levelEnv.MATERIALS_R2.head('canonical-source.pdf');
assert.deepEqual(calls.pop(),['head','canonical-source.pdf']);

console.log('Phase 11 shared Maths Answer Pack PDF routing static verification: PASS');
