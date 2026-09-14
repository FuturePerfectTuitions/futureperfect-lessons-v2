import assert from 'node:assert/strict';
import { createVrHowToRuntime } from '../rebuild/student/src/lib/vr-howto-runtime.mjs';

let readModelGets=0;
const env={
  READ_MODELS_KV:{
    async get(){
      readModelGets+=1;
      throw new Error('Admin Home must not enter pupil VR How-To access resolution.');
    }
  }
};

const baseRuntime={
  async fetch(){
    return new Response(JSON.stringify({
      ok:true,
      role:'admin',
      superuser:true,
      views:[{viewId:'english-year6',subject:'english',label:'Year 6'}]
    }),{
      status:200,
      headers:{'content-type':'application/json; charset=utf-8'}
    });
  }
};

const runtime=createVrHowToRuntime(baseRuntime);
const response=await runtime.fetch(new Request('https://student.example/api/v2/student/home'),env);
assert.equal(response.status,200);
const body=await response.json();
assert.equal(body.role,'admin');
assert.equal(body.superuser,true);
assert.equal(body.views.length,1);
assert.equal(readModelGets,0,'Admin Home must not attempt a pupil special-area/access read.');

console.log(JSON.stringify({
  marker:'REBUILD_CP12_ADMIN_VR_DECORATOR_PASS',
  adminPupilAccessReads:readModelGets
}));
