import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const token=clean(process.env.CLOUDFLARE_API_TOKEN);
const account=clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const portalOrigin=clean(process.env.PORTAL_ORIGIN||'https://lessons.futureperfect.education').replace(/\/$/,'');
const opsWorker=clean(process.env.WORKER_NAME||'fpt-portal-v2-worker');
const studentWorker=clean(process.env.STUDENT_WORKER_NAME||'fpt-portal-v2-rebuild-student-prod');
const asOf=clean(process.env.CHECKPOINT8_AS_OF_DATE||'2026-09-14');
const evidenceDir='/tmp/cp12-production-browser-population';
if(!token||!account)throw new Error('Cloudflare read credentials are required.');
fs.mkdirSync(evidenceDir,{recursive:true});

const cfBase='https://api.cloudflare.com/client/v4';
const cfHeaders={Authorization:`Bearer ${token}`};
async function cf(p){const r=await fetch(`${cfBase}${p}`,{headers:cfHeaders});const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{};if(!r.ok||body?.success!==true)throw new Error(`Cloudflare read failed ${r.status}: ${p}`);return body;}
async function settings(name){return (await cf(`/accounts/${account}/workers/scripts/${name}/settings`)).result||{};}
function binding(s,n){return (s.bindings||[]).find(x=>x.name===n)||{};}
async function kvText(ns,key){const r=await fetch(`${cfBase}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`,{headers:cfHeaders});if(r.status===404)return null;if(!r.ok)throw new Error(`KV read failed ${r.status}: ${key}`);return r.text();}
async function kvJson(ns,key){const t=await kvText(ns,key);if(t==null)return null;return JSON.parse(t);}
async function kvKeys(ns,prefix){const out=[];let cursor='';do{const q=new URLSearchParams({limit:'1000',prefix});if(cursor)q.set('cursor',cursor);const b=await cf(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);out.push(...(b.result||[]).map(x=>x.name));cursor=clean(b.result_info?.cursor);}while(cursor);return out;}
function isCurrent(id,u){const role=norm(u?.role||u?.accountType);if(id==='admin'||role.includes('admin')||u?.isAdmin===true||u?.superuser===true)return false;const status=norm(u?.accountStatus||u?.status||'active');const expires=clean(u?.expiresOn||u?.expires);return !['inactive','disabled','expired','withdrawn'].includes(status)&&(!expires||expires>asOf);}
async function returnHome(page,id){
  await page.goto(`${portalOrigin}/?cp12-population-home=${Date.now()}-${encodeURIComponent(id)}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('heading',{name:/Welcome/}).waitFor({state:'visible',timeout:15000});
}

const [opsSettings,studentSettings]=await Promise.all([settings(opsWorker),settings(studentWorker)]);
const studentsNs=clean(binding(opsSettings,'STUDENTS_KV').namespace_id);
const readModelsNs=clean(binding(studentSettings,'READ_MODELS_KV').namespace_id);
assert(studentsNs&&readModelsNs,'Production KV bindings missing');
const scopeSecret=clean(await kvText(readModelsNs,'meta:scope-salt'));
assert(/^[0-9a-f]{64}$/i.test(scopeSecret),'Scope salt missing');

const browser=await chromium.launch({headless:true});
const results=[];
let bundleEvidence=null;
try{
  for(const key of (await kvKeys(studentsNs,'user:')).sort()){
    const id=norm(key.replace(/^user:/,''));
    const user=await kvJson(studentsNs,key);
    if(!user||!isCurrent(id,user))continue;
    const password=String(user.p||'');
    const row={portalUserId:id,firstName:clean(user.firstName||user.name),expectedViews:[],renderedViews:[],subjects:{},aylaY4E1:null,status:'UNKNOWN',errors:[]};
    if(!password){row.status='FAIL';row.errors.push('MISSING_STORED_PASSWORD');results.push(row);continue;}

    const scopeId=await opaqueAccessScopeId(id,scopeSecret);
    const pointer=await kvJson(readModelsNs,pointerKey(`access:${scopeId}`));
    const version=clean(pointer?.current?.version);
    const envelope=version?await kvJson(readModelsNs,versionKey(`access:${scopeId}`,version)):null;
    const snapshot=envelope?.payload?.snapshot;
    if(!snapshot){row.status='FAIL';row.errors.push('PUBLISHED_ACCESS_MISSING');results.push(row);continue;}
    const expected=(snapshot.views||[]).filter(v=>clean(v.viewId)!=='special-vr-howto');
    row.expectedViews=expected.map(v=>clean(v.viewId)).sort();

    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
    const page=await context.newPage();
    const apiErrors=[];
    let authenticated=false;
    page.on('response',r=>{try{const p=new URL(r.url()).pathname;if(authenticated&&p.startsWith('/api/v2/')&&r.status()>=400)apiErrors.push(`${r.status()} ${p}`);}catch{}});
    try{
      await page.goto(`${portalOrigin}/?cp12-population=${Date.now()}-${encodeURIComponent(id)}`,{waitUntil:'domcontentloaded',timeout:30000});
      if(!bundleEvidence){
        const scriptSrc=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.src));
        const bundle=scriptSrc.find(u=>/\/assets\/portal-[^/]+\.js(?:\?|$)/.test(u))||scriptSrc[0]||'';
        if(bundle){const resp=await page.request.get(bundle,{headers:{'cache-control':'no-cache'}});bundleEvidence={path:new URL(bundle).pathname,status:resp.status(),cacheControl:resp.headers()['cache-control']||'',etag:resp.headers().etag||'',age:resp.headers().age||''};}
      }
      await page.getByRole('heading',{name:'Student Login'}).waitFor({state:'visible',timeout:15000});
      await page.getByLabel('Username').fill(id);
      await page.getByRole('textbox',{name:'Password',exact:true}).fill(password);
      await page.getByRole('button',{name:'Log in'}).click();
      await page.getByRole('heading',{name:/Welcome/}).waitFor({state:'visible',timeout:15000});
      authenticated=true;

      for(const subject of ['english','maths']){
        const subjectExpected=expected.filter(v=>norm(v.subject)===subject).map(v=>clean(v.viewId));
        if(!subjectExpected.length){row.subjects[subject]={expected:[],skipped:true};continue;}
        await returnHome(page,id);
        const subjectButton=page.locator(`[data-subject="${subject}"]`);
        await subjectButton.waitFor({state:'visible',timeout:10000});
        await subjectButton.click();
        await page.getByRole('heading',{name:subject==='english'?'English':'Maths',exact:true}).waitFor({state:'visible',timeout:15000});
        const firstExpected=page.locator(`[data-view="${subjectExpected[0]}"]`);
        const blank=page.getByText('No years or levels are currently available.');
        await Promise.race([
          firstExpected.waitFor({state:'visible',timeout:15000}).catch(()=>null),
          blank.waitFor({state:'visible',timeout:15000}).catch(()=>null)
        ]);
        const rendered=await page.locator('[data-view]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-view')).filter(Boolean));
        const renderedSet=new Set(rendered);
        const missing=subjectExpected.filter(v=>!renderedSet.has(v));
        const blankVisible=await blank.isVisible().catch(()=>false);
        row.renderedViews.push(...rendered);
        row.subjects[subject]={expected:subjectExpected.sort(),rendered:[...renderedSet].sort(),missing,blankVisible};
        if(missing.length||blankVisible)row.errors.push(`${subject.toUpperCase()}_VIEW_RENDER_MISMATCH`);

        if(id==='ayla0108'&&subject==='english'){
          const view=page.locator('[data-view="english-year4-11plus"]');
          const visible=await view.isVisible().catch(()=>false);
          if(visible){
            await view.click();
            await page.getByLabel('Search lessons').waitFor({state:'visible',timeout:15000});
            const lesson=page.locator('[data-lesson="Y4E1"]').first();
            const lessonVisible=await lesson.isVisible().catch(()=>false);
            row.aylaY4E1={viewVisible:true,lessonVisible};
            if(!lessonVisible)row.errors.push('AYLA_Y4E1_NOT_RENDERED');
            await page.screenshot({path:path.join(evidenceDir,'ayla-english-y4.png'),fullPage:true});
          }else{
            row.aylaY4E1={viewVisible:false,lessonVisible:false};
            row.errors.push('AYLA_Y4_VIEW_NOT_RENDERED');
            await page.screenshot({path:path.join(evidenceDir,'ayla-english-blank.png'),fullPage:true});
          }
        }
      }
      if(apiErrors.length)row.errors.push(...apiErrors.map(x=>`API_${x}`));
      row.renderedViews=[...new Set(row.renderedViews)].sort();
      row.status=row.errors.length?'FAIL':'PASS';
      if(row.status==='FAIL'&&id!=='ayla0108')await page.screenshot({path:path.join(evidenceDir,`${id}-failure.png`),fullPage:true});
    }catch(error){
      row.status='FAIL';row.errors.push(`BROWSER:${error.message}`);
      await page.screenshot({path:path.join(evidenceDir,`${id}-exception.png`),fullPage:true}).catch(()=>{});
    }finally{await context.close();}
    results.push(row);
  }
} finally {await browser.close();}

const failures=results.filter(r=>r.status!=='PASS');
const out={marker:'CP12_PRODUCTION_BROWSER_POPULATION_AUDIT',generatedAt:new Date().toISOString(),readOnly:true,portalOrigin,bundleEvidence,currentStudentCount:results.length,passCount:results.length-failures.length,failCount:failures.length,failureIds:failures.map(r=>r.portalUserId),results};
fs.writeFileSync('/tmp/cp12-production-browser-population-audit.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({marker:out.marker,bundleEvidence:out.bundleEvidence,currentStudentCount:out.currentStudentCount,passCount:out.passCount,failCount:out.failCount,failureIds:out.failureIds,results:results.map(({portalUserId,firstName,status,subjects,aylaY4E1,errors})=>({portalUserId,firstName,status,subjects,aylaY4E1,errors}))},null,2));
if(failures.length)throw new Error(`Production browser population audit failed for ${failures.length} current student(s).`);
