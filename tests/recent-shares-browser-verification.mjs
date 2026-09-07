import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();

const mockHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Recent shares test</title></head><body>
<main id="login-screen"><form id="login-form"><input id="username"><input id="login-password" type="password"><button id="toggle-login-password" type="button"><span id="eye-open"></span><span id="eye-closed" hidden></span></button><button id="login-button" type="submit">Log in</button><div id="login-error" hidden></div></form></main>
<div id="portal-screen" hidden><span id="student-greeting"></span><button id="logout-button"></button><main>
<section id="screen-subjects"><h1 id="welcome-heading"></h1><section id="recent-shares-panel" hidden><h2>Just shared with you</h2><div id="recent-shares-list"></div></section><div id="subject-grid"><button id="maths-choice">Maths</button><button id="english-choice">English</button></div><div id="phase7-message" hidden></div></section>
<section id="screen-views" hidden><button id="back-to-subjects"></button><h1 id="views-heading"></h1><div id="view-grid"></div></section>
<section id="screen-lessons" hidden><button id="back-to-views"></button><span id="lessons-eyebrow"></span><h1 id="lessons-heading"></h1><input id="lesson-search"><div id="lesson-list"></div><div id="lesson-empty" hidden></div></section>
<section id="screen-lesson" hidden><button id="back-to-lessons"></button><div id="lesson-loading" hidden></div><div id="lesson-error" hidden></div><div id="lesson-content" hidden>
<div class="phase7-lesson-heading"><div><span id="lesson-code"></span><h1 id="lesson-title"></h1><div id="lesson-description" class="phase7-description"></div></div><span id="lesson-state"></span></div><div id="lesson-locked-note" hidden></div>
<div class="phase7-resource-sections">
<section id="prelesson-section" class="phase7-resource-section" hidden><div class="phase7-section-heading"><span>Before the lesson</span><h2>PreLesson Sheets</h2></div><div id="prelesson-list"></div></section>
<section id="video-section" class="phase7-resource-section" hidden><div class="phase7-section-heading"><span>Main lesson</span><h2>Lesson Video</h2></div><div id="video-locked-row" hidden></div><div id="video-loading" hidden></div><div id="video-error" hidden></div><div id="video-frame" hidden><iframe id="lesson-player"></iframe></div></section>
<section id="homework-section" class="phase7-resource-section" hidden><div class="phase7-section-heading"><span>After the lesson</span><h2>Homework</h2></div><div id="homework-list"></div></section>
<section id="other-section" class="phase7-resource-section" hidden><div class="phase7-section-heading"><span>Extra material</span><h2>Other Resources</h2></div><div id="other-list"></div></section>
</div></div></section></main></div>
<script>window.FPT_V2_CONFIG={workerBaseUrl:'https://worker.example'};window.scrollTo=()=>{};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.href);const p=u.pathname;
if(p==='/api/v1/student/session')return json({ok:true,portalUserId:'student0101',firstName:'Student',accountLocked:false});
if(p==='/api/v1/student/home')return json({ok:true,student:{portalUserId:'student0101'},subjects:[{subject:'english',label:'English',views:[{viewId:'english-year5-11plus',label:'Year 5 (11+)',catalogueAvailable:true,openLessonCount:1,lockedLessonCount:31}]}],recentShares:[
{lessonId:'Y5E2',displayLessonId:'Y5T1EE01',title:'Descriptive Writing Settings and Atmosphere',subject:'english',viewId:'english-year5-11plus',viewLabel:'Year 5 (11+)',accessMode:'prelesson',accessLabel:'PreLesson Sheets only',sharedAt:'2026-09-07T09:00:00.000Z'},
{lessonId:'Y3M1',displayLessonId:'Y3T1M01',title:'Transitioning to Year 3',subject:'maths',viewId:'maths-year3',viewLabel:'Year 3',accessMode:'full',accessLabel:'Full lesson',sharedAt:'2026-09-06T09:00:00.000Z'}]});
if(p==='/api/v1/student/session/activity')return json({ok:true});
if(p==='/api/v1/student/views/english-year5-11plus/lessons')return json({ok:true,view:{viewId:'english-year5-11plus',label:'Year 5 (11+)',catalogueAvailable:true},lessons:[{lessonId:'Y5E2',displayLessonId:'Y5T1EE01',title:'Descriptive Writing Settings and Atmosphere',locked:false}]});
if(p==='/api/v1/student/lessons/Y5E2')return json({ok:true,lesson:{lessonId:'Y5E2',displayLessonId:'Y5T1EE01',title:'Descriptive Writing Settings and Atmosphere',description:'A deliberately long lesson description for collapse testing.',locked:false,preLessonSheets:[{displayName:'Y5T1EE01 PreLesson.pdf',resourceKey:'Y5E2~pre~1',available:true}],video:{displayName:'Video',resourceKey:'Y5E2~video~1',locked:true},homeworks:[{homework:{displayName:'Homework.pdf',resourceKey:'Y5E2~homework~1',available:true},answerPack:{displayName:'Answer Pack.pdf',resourceKey:'Y5E2~answer~1',locked:true,protected:true}}],otherResources:[{displayName:'Extra.pdf',resourceKey:'Y5E2~other~1',available:true}]}});
if(p==='/api/v1/student/auth/logout')return json({ok:true});
return json({ok:false,error:'UNMOCKED '+p},404);};</script>
<script src="/assets/phase7.js"></script><script src="/assets/phase20-collapsible-lessons.js"></script></body></html>`;

const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/mock.html'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(mockHtml);return;
    }
    if(url.pathname.startsWith('/assets/')){
      const file=path.join(root,url.pathname.slice(1));
      const data=await fs.readFile(file);res.writeHead(200,{'content-type':'application/javascript'});res.end(data);return;
    }
    res.writeHead(404);res.end('not found');
  } catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try {
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/mock.html`);
  await page.waitForSelector('#recent-shares-panel:not([hidden])');

  const labels=await page.locator('.phase20-recent-share-link').allTextContents();
  assert.deepEqual(labels,[
    'Y5T1EE01 Descriptive Writing Settings and Atmosphere',
    'Y3T1M01 Transitioning to Year 3'
  ]);
  assert.equal(await page.locator('.phase20-recent-share-access').first().textContent(),'PreLesson Sheets only');
  assert.match(await page.locator('.phase20-recent-share-meta').first().textContent(),/Shared 7 Sept 2026/);
  assert.equal(await page.evaluate(()=>document.querySelector('#recent-shares-panel').compareDocumentPosition(document.querySelector('#subject-grid')) & Node.DOCUMENT_POSITION_FOLLOWING),4);
  assert.equal(await page.locator('#maths-choice').isVisible(),true);
  assert.equal(await page.locator('#english-choice').isVisible(),true);

  await page.locator('.phase20-recent-share-link').first().click();
  await page.waitForSelector('#lesson-content:not([hidden])');
  assert.equal(await page.locator('#lesson-code').textContent(),'Y5T1EE01');

  await page.waitForFunction(()=>document.querySelectorAll('.phase20-collapse-toggle').length>=5);
  const desc=page.locator('#lesson-description');
  assert.equal(await desc.isHidden(),true);
  const descButton=page.locator('.phase20-description-bar .phase20-collapse-toggle');
  assert.equal(await descButton.textContent(),'View');
  await descButton.click();
  assert.equal(await desc.isVisible(),true);
  assert.equal(await descButton.textContent(),'Hide');

  for(const id of ['prelesson-section','video-section','homework-section','other-section']){
    const section=page.locator(`#${id}`);
    assert.equal(await section.isVisible(),true);
    const button=section.locator('.phase20-collapse-toggle');
    const body=section.locator('.phase20-collapse-body');
    assert.equal(await button.textContent(),'View');
    assert.equal(await body.isHidden(),true);
    await button.click();
    assert.equal(await body.isVisible(),true);
    assert.equal(await button.textContent(),'Hide');
  }

  await page.evaluate(()=>{
    const s=document.createElement('section');s.id='synthetic-vr';s.className='phase7-resource-section';
    s.innerHTML='<div class="phase7-section-heading"><span>11+ English extension</span><h2>Verbal Reasoning</h2></div><div id="synthetic-vr-body">VR resources</div>';
    document.querySelector('.phase7-resource-sections').appendChild(s);
  });
  await page.waitForSelector('#synthetic-vr .phase20-collapse-toggle');
  assert.equal(await page.locator('#synthetic-vr .phase20-collapse-toggle').textContent(),'View');
  assert.equal(await page.locator('#synthetic-vr .phase20-collapse-body').isHidden(),true);

  console.log('Recent shares isolated browser acceptance: PASS');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
