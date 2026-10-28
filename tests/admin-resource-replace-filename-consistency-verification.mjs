import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { handleAdminResourceRequest, projectPreparedPayload } from '../worker/src/admin-resource-replace-consistency.js';
import { publishScopeAtomic, resolveCurrentScope } from '../worker/src/access-read-model-sync.js';

const lessonId = 'Y5E2';
const oldDisplayName = 'FAR210225Y5E2.pdf';
const newDisplayName = 'FAR210225Y5T1EE01VRH01A.pdf';
const oldKey = 'english/year5/Y5T1E01/vr/homework/sheets/FAR210225Y5E2.pdf';
const path = ['vr','homeworks',0,'homework'];
const pathToken = JSON.stringify(path);
const origin = 'https://futureperfecttuitions.github.io';
const secret = 'test-only-session-secret';

class MockKV {
  constructor() { this.data = new Map(); this.failPreparedVersion = false; }
  async get(key, opts = {}) { const v = this.data.get(key); return v == null ? null : opts?.type === 'json' ? JSON.parse(v) : v; }
  async put(key, value) { if(this.failPreparedVersion && key.includes(':version:')) throw Error('SIMULATED_PREPARED_WRITE_FAIL'); this.data.set(key, String(value)); }
}
class MockR2 {
  constructor() { this.objects=new Map(); this.deleted=[]; this.objects.set(oldKey,new TextEncoder().encode('%PDF-1.4\nold').buffer); }
  async head(k) {return this.objects.has(k)?{key:k}:null;}
  async put(k,b) {this.objects.set(k,b.slice(0));}
  async get(k) {const bytes=this.objects.get(k);return bytes?{arrayBuffer:async()=>bytes.slice(0)}:null;}
  async delete(k) {this.objects.delete(k);this.deleted.push(k);}
}
async function authToken() {
  const encoded = Buffer.from(JSON.stringify({scope:'lesson-release-import',exp:Math.floor(Date.now()/1000)+600})).toString('base64url');
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(encoded))).toString('base64url');
  return encoded+'.'+sig;
}
function canonical() {return {lessonId,active:true,title:'Descriptive Writing Settings and Atmosphere',subject:'english',
  vr:{homeworks:[{homework:{displayName:oldDisplayName,r2Key:oldKey,resourceId:'vr-homework'},
  answerPack:{displayName:'Answer key.pdf',r2Key:'english/year5/Y5T1E01/vr/homework/answers/answer.pdf',resourceId:'answer'}}]}};}
function prepared(name=oldDisplayName) {return {kind:'prepared-lesson-read-model',lessonId,resources:[
  {resourceId:'vr-homework',type:'homework',displayName:name,objectKey:oldKey},
  {resourceId:'answer',type:'answer-pack',displayName:'Answer key.pdf',objectKey:'english/year5/Y5T1E01/vr/homework/answers/answer.pdf'}]};}
async function envFor({preparedName=oldDisplayName,withPrepared=true}={}) {
  const lessons=new MockKV(), readModels=new MockKV(), r2=new MockR2();
  await lessons.put('lesson:'+lessonId,JSON.stringify(canonical()));
  if(withPrepared) await publishScopeAtomic(readModels,{scope:'lesson:'+lessonId,version:'before',payload:prepared(preparedName)});
  return {ADMIN_IMPORT_SESSION_SECRET:secret,ALLOWED_ORIGINS:origin,LESSONS_KV:lessons,READ_MODELS_KV:readModels,MATERIALS_R2:r2};
}
async function replace(env, name=newDisplayName) {
  const form=new FormData();form.append('lessonId',lessonId);form.append('resourcePath',pathToken);form.append('expectedR2Key',oldKey);
  form.append('file',new File([new TextEncoder().encode('%PDF-1.7\nreplacement')],name,{type:'application/pdf'}));
  return handleAdminResourceRequest(new Request('https://worker.example/api/v1/admin/resources/replace',{method:'POST',headers:{origin,authorization:'Bearer '+await authToken()},body:form}),env);
}

const payload=projectPreparedPayload(prepared(),oldKey,'new-key',oldDisplayName,newDisplayName);
assert.equal(payload.resources[0].objectKey,'new-key');
assert.equal(payload.resources[0].displayName,newDisplayName);
assert.equal(payload.resources[1].displayName,'Answer key.pdf');
assert.equal(prepared().resources[0].displayName,oldDisplayName);
assert.throws(()=>projectPreparedPayload(prepared('different'),oldKey,'new-key',oldDisplayName,newDisplayName),/PREPARED_ORIGINAL_DISPLAY_NAME_MISMATCH/);

{
  const env=await envFor(); const response=await replace(env);
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.consistency,'replace-resource-consistency-v1');
  assert.equal(result.preparedReadModel.status,'published');
  assert.equal(result.oldDisplayName,oldDisplayName);
  assert.equal(result.newDisplayName,newDisplayName);
  assert.equal(result.displayName,newDisplayName);
  const c=await env.LESSONS_KV.get('lesson:'+lessonId,{type:'json'});
  assert.equal(c.vr.homeworks[0].homework.displayName,newDisplayName);
  assert.equal(c.vr.homeworks[0].homework.r2Key,result.newR2Key);
  assert.equal(c.vr.homeworks[0].answerPack.displayName,'Answer key.pdf');
  const p=await resolveCurrentScope(env.READ_MODELS_KV,'lesson:'+lessonId);
  assert.equal(p.payload.resources[0].objectKey,result.newR2Key);
  assert.equal(p.payload.resources[0].displayName,newDisplayName);
  assert.equal(p.payload.resources[1].displayName,'Answer key.pdf');
  assert.ok(await env.MATERIALS_R2.head(oldKey),'Previous R2 PDF retained');
  assert.ok(await env.MATERIALS_R2.head(result.newR2Key));
}
{
  const env=await envFor({preparedName:'other-name.pdf'});
  const response=await replace(env);
  assert.equal(response.status,500);
  const result=await response.json();
  assert.equal(result.error,'RESOURCE_REPLACE_PROJECTION_FAILED');
  assert.equal(result.rollback.canonical,'restored');
  assert.match(result.detail,/PREPARED_ORIGINAL_DISPLAY_NAME_MISMATCH/);
  const c=await env.LESSONS_KV.get('lesson:'+lessonId,{type:'json'});
  assert.equal(c.vr.homeworks[0].homework.displayName,oldDisplayName,'Rollback must restore original student name');
  assert.equal(c.vr.homeworks[0].homework.r2Key,oldKey);
  const p=await resolveCurrentScope(env.READ_MODELS_KV,'lesson:'+lessonId);
  assert.equal(p.payload.resources[0].displayName,'other-name.pdf');
  assert.equal(p.payload.resources[0].objectKey,oldKey);
  assert.equal(env.MATERIALS_R2.objects.size,1,'Rolled-back R2 object removed');
}
{
  const env=await envFor();env.READ_MODELS_KV.failPreparedVersion=true;
  const response=await replace(env);assert.equal(response.status,500);
  const result=await response.json();
  assert.equal(result.rollback.canonical,'restored');
  assert.equal((await env.LESSONS_KV.get('lesson:'+lessonId,{type:'json'})).vr.homeworks[0].homework.displayName,oldDisplayName);
  assert.equal((await resolveCurrentScope(env.READ_MODELS_KV,'lesson:'+lessonId)).payload.resources[0].displayName,oldDisplayName);
}
{
  const env=await envFor({withPrepared:false});
  const response=await replace(env);assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.preparedReadModel.status,'not-published');
  assert.equal(result.newDisplayName,newDisplayName);
}
console.log('ADMIN_RESOURCE_REPLACE_FILENAME_CONSISTENCY_PASS');
