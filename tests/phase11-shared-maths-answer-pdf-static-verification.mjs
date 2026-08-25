import assert from 'node:assert/strict';
import {
  parseAnswerResourceKey,
  answerOverrideTarget,
  prepareSharedMathsAnswerPdfEnv
} from '../worker/src/phase11-shared-maths-answer-pdf.js';

assert.deepEqual(parseAnswerResourceKey('Y4M1~answer~1'), { lessonId: 'Y4M1', answerIndex: 1 });
assert.deepEqual(parseAnswerResourceKey('Y5M1~answer~1'), { lessonId: 'Y5M1', answerIndex: 1 });
assert.deepEqual(parseAnswerResourceKey('Y6M1~answer~1'), { lessonId: 'Y6M1', answerIndex: 1 });
assert.equal(parseAnswerResourceKey('Y5M1~homework~1'), null);

assert.deepEqual(answerOverrideTarget({ viewId: 'maths-year4', lessonId: 'Y4M1', answerIndex: 1 }), {
  viewId: 'maths-year4',
  lessonId: 'Y4M1',
  answerIndex: 1,
  yearCode: 'Y4T3M23',
  levelCode: 'L1T3M23',
  r2Key: 'phase11/view-overrides/maths-year4/Y4M1/homework/answers/01-Y4T3M23.pdf'
});
assert.deepEqual(answerOverrideTarget({ viewId: 'maths-year5', lessonId: 'Y5M1', answerIndex: 1 }), {
  viewId: 'maths-year5',
  lessonId: 'Y5M1',
  answerIndex: 1,
  yearCode: 'Y5T1M01',
  levelCode: 'L2T1M01',
  r2Key: 'phase11/view-overrides/maths-year5/Y5M1/homework/answers/01-Y5T1M01.pdf'
});
assert.deepEqual(answerOverrideTarget({ viewId: 'maths-year6', lessonId: 'Y6M1', answerIndex: 1 }), {
  viewId: 'maths-year6',
  lessonId: 'Y6M1',
  answerIndex: 1,
  yearCode: 'Y6T2M26',
  levelCode: 'L3T2M21',
  r2Key: 'phase11/view-overrides/maths-year6/Y6M1/homework/answers/01-Y6T2M26.pdf'
});
assert.equal(answerOverrideTarget({ viewId: 'maths-level2', lessonId: 'Y5M1', answerIndex: 1 }), null);

const calls=[];
const sourceR2={
  async head(key){ calls.push(['head',key]); return {key}; },
  async get(key){ calls.push(['get',key]); return {key,body:new Uint8Array([1])}; }
};
const authorizeEnv={ MATERIALS_R2: sourceR2, DB:{prepare(){ throw new Error('authorize must not read D1'); }} };
for (const [viewId,lessonId,expectedKey] of [
  ['maths-year4','Y4M1','phase11/view-overrides/maths-year4/Y4M1/homework/answers/01-Y4T3M23.pdf'],
  ['maths-year5','Y5M1','phase11/view-overrides/maths-year5/Y5M1/homework/answers/01-Y5T1M01.pdf'],
  ['maths-year6','Y6M1','phase11/view-overrides/maths-year6/Y6M1/homework/answers/01-Y6T2M26.pdf']
]) {
  const req=new Request(`https://example.test/api/v1/student/resources/${lessonId}~answer~1/answer/authorize?viewId=${viewId}`,{method:'POST'});
  const env=await prepareSharedMathsAnswerPdfEnv(req,authorizeEnv);
  await env.MATERIALS_R2.head('canonical-source.pdf');
  assert.deepEqual(calls.pop(),['head',expectedKey]);
}

const levelReq=new Request('https://example.test/api/v1/student/resources/Y5M1~answer~1/answer/authorize?viewId=maths-level2',{method:'POST'});
const levelEnv=await prepareSharedMathsAnswerPdfEnv(levelReq,authorizeEnv);
await levelEnv.MATERIALS_R2.head('canonical-source.pdf');
assert.deepEqual(calls.pop(),['head','canonical-source.pdf']);

console.log('Phase 11 shared Maths Answer Pack PDF routing static verification: PASS');
