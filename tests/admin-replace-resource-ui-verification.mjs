import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { File } from 'node:buffer';

const source = fs.readFileSync('assets/admin-replace-resource.js', 'utf8');
const oldKey = 'english/year5/Y5T1E01/vr/homework/sheets/FAR210225Y5E2.pdf';
const newKey = 'english/year5/Y5T1E01/vr/homework/sheets/FAR210225Y5T1EE01VRH01A__replacement_20261028T071709Z_jgid79.pdf';
const pathToken = JSON.stringify(['vr', 'homeworks', 0, 'homework']);
const displayName = 'FAR210225Y5E2.pdf';
const newDisplayName = 'FAR210225Y5T1EE01VRH01A.pdf';

class FakeElement {
  constructor() {
    this.textContent = ''; this.disabled = false; this.files = []; this.children = [];
    this.value = ''; this.handlers = {}; this.classes = new Set(['hidden']);
    this.classList = { add: x => this.classes.add(x), remove: x => this.classes.delete(x), contains: x => this.classes.has(x) };
  }
  set innerHTML(value) { this.html = value; this.children = []; this.value = ''; }
  get innerHTML() { return this.html || ''; }
  appendChild(item) { this.children.push(item); if (this.children.length === 1) this.value = item.value; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  dispatch(type) { assert.ok(this.handlers[type], 'Missing '+type+' handler'); return this.handlers[type](); }
}

async function scenario({ prepared = 'published', marker = true, canonicalReadback = true, reloadFails = false } = {}) {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new FakeElement()); return elements.get(id); };
  let currentKey = oldKey, currentDisplayName = displayName, replaceCalls = 0, lessonCalls = 0;
  el('replaceLessonId').value = 'Y5T1E01';
  el('replacementFile').files = [new File(['%PDF-1.7\nreplacement'], 'FAR210225Y5T1EE01VRH01A.pdf', {type:'application/pdf'})];
  const doc = {
    querySelector: selector => selector === 'meta[name="fpt-worker-base"]' ? {content:'https://worker.example'} : null,
    querySelectorAll: () => [],
    createElement: () => ({value:'',textContent:''}),
    getElementById: el
  };
  const fetch = async (url, options) => {
    assert.match(options.headers.authorization, /^Bearer /);
    if (url.endsWith('/api/v1/admin/resources/lesson')) {
      lessonCalls++;
      if (reloadFails && lessonCalls > 1) return Response.json({ok:false,error:'LESSON_LOOKUP_FAILED'},{status:500});
      return Response.json({ok:true,lesson:{lessonId:'Y5E2',title:'Settings and Atmosphere',subject:'english'},resources:[{
        resourceId:'', displayName:currentDisplayName, kind:'Homework', pathToken, r2Key:currentKey
      }]});
    }
    if (url.endsWith('/api/v1/admin/resources/replace')) {
      replaceCalls++;
      assert.equal(options.body.get('resourcePath'), pathToken);
      assert.equal(options.body.get('expectedR2Key'), oldKey);
      assert.equal(options.body.get('file').name, 'FAR210225Y5T1EE01VRH01A.pdf');
      if (canonicalReadback) { currentKey = newKey; currentDisplayName = newDisplayName; }
      return Response.json({ok:true,lessonId:'Y5E2',displayName:newDisplayName,oldDisplayName:displayName,newDisplayName,oldR2Key:oldKey,newR2Key:newKey,
        sha256:'a'.repeat(64),consistency:marker?'replace-resource-consistency-v1':null,
        preparedReadModel:{status:prepared,version:prepared==='published'?'v42':null,sha256:prepared==='published'?'b'.repeat(64):null}
      });
    }
    throw Error('Unexpected URL '+url);
  };
  const sandbox = {document:doc,window:{confirm:()=>true},localStorage:{getItem:()=> 'signed-admin-token'},
    fetch,Response,File,FormData,console,setTimeout:fn=>fn()};
  vm.runInNewContext(source,sandbox);
  await el('loadReplaceLessonBtn').dispatch('click');
  assert.equal(el('replaceResourceSelect').children.length,2);
  assert.match(el('replaceResourceSelect').children[1].textContent, /FAR210225Y5E2\.pdf/);
  assert.doesNotMatch(el('replaceResourceSelect').children[1].textContent, /__replacement_|Current PDF:/);
  el('replaceResourceSelect').value='0';
  await el('replaceResourceSelect').dispatch('change');
  assert.equal(el('replaceCurrentResourceFile').textContent, 'FAR210225Y5E2.pdf');
  el('replacementFile').files=[new File(['%PDF-1.7\nreplacement'],'FAR210225Y5T1EE01VRH01A.pdf',{type:'application/pdf'})];
  await el('replacementFile').dispatch('change');
  await el('replaceResourceBtn').dispatch('click');
  assert.equal(replaceCalls,1,'Never repeat a replacement upload automatically');
  assert.equal(lessonCalls,2,'Must independently reload canonical resources after upload');
  assert.equal(el('replaceVerifiedDisplayName').textContent,newDisplayName,'Uploaded PDF filename must become student-facing name');
  assert.equal(el('replaceVerifiedCurrentFile').textContent,newKey.split('/').pop());
  const fullyVerified=prepared==='published' && marker && canonicalReadback && !reloadFails;
  assert.equal(el('replaceResourceStatus').className,fullyVerified?'status good':'status warn');
  assert.match(el('replacePreparedVerification').textContent,prepared==='published' && marker?/Verified: current student lesson/:/Not (?:published|verified)/);
  if (fullyVerified) {
    assert.equal(el('replaceResourceSelect').value,'0','Stable pathToken retains selection despite empty resourceId');
    assert.equal(el('replaceCurrentResourceFile').textContent,newKey.split('/').pop());
    assert.equal(el('replaceCurrentResourceName').textContent,newDisplayName);
    assert.match(el('replaceResourceSelect').children[1].textContent,/Homework — FAR210225Y5T1EE01VRH01A\.pdf/);
    assert.doesNotMatch(el('replaceResourceSelect').children[1].textContent,/__replacement_|Current PDF:/);
    assert.match(el('replaceCanonicalVerification').textContent,/Verified/);
    assert.match(el('replaceR2Verification').textContent,/SHA-256/);
  }
}

await scenario();
await scenario({prepared:'not-published'});
await scenario({marker:false});
await scenario({canonicalReadback:false});
await scenario({reloadFails:true});
console.log('ADMIN_REPLACE_RESOURCE_UI_VERIFICATION_PASS');
