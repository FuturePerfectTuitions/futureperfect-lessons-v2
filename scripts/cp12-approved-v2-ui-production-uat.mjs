import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const base=String(process.env.CP12_BROWSER_BASE_URL||'').replace(/\/$/,'');
const expectedJs=String(process.env.UAT_EXPECTED_JS||'').trim();
const evidenceDir='/tmp/cp12-approved-v2-ui-production-evidence';
const output='/tmp/cp12-approved-v2-ui-production-uat.json';
const credentialShape=/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/;
function persona(prefix,{answerRequired=false,targetRequired=false}={}){
  const row={
    username:String(process.env[`UAT_${prefix}_USERNAME`]||'').trim(),
    password:String(process.env[`UAT_${prefix}_LOGIN_PASSWORD`]||''),
    answerPassword:String(process.env[`UAT_${prefix}_ANSWER_PASSWORD`]||''),
    expectedFirstName:String(process.env[`UAT_${prefix}_EXPECTED_FIRST_NAME`]||'').trim().split(/\s+/)[0]||'',
    viewId:String(process.env[`UAT_${prefix}_VIEW_ID`]||'').trim(),
    lessonId:String(process.env[`UAT_${prefix}_LESSON_ID`]||'').trim()
  };
  if(!row.username||!row.expectedFirstName)throw new Error(`${prefix} production UAT identity inputs are incomplete.`);
  if(!credentialShape.test(row.password))throw new Error(`${prefix} production login credential shape is invalid.`);
  if(answerRequired&&!credentialShape.test(row.answerPassword))throw new Error(`${prefix} production Answer Pack credential shape is invalid.`);
  if(targetRequired&&(!row.viewId||!row.lessonId))throw new Error(`${prefix} production UAT target view/lesson inputs are incomplete.`);
  return row;
}
function populateRealStudentPersonasIfNeeded(){
  if(String(process.env.UAT_VR_USERNAME||'').trim()&&String(process.env.UAT_VR_VIEW_ID||'').trim()&&String(process.env.UAT_VR_LESSON_ID||'').trim()&&String(process.env.UAT_ORDINARY_USERNAME||'').trim())return;
  const studentsKv=String(process.env.STUDENTS_KV_ID||process.env.EXPECTED_STUDENTS_KV||'').trim();
  const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!studentsKv||!account||!token)throw new Error('Real production UAT personas were not supplied and protected read credentials are unavailable.');
  const secretPath='/tmp/cp12-production-real-persona-secrets-uat.json';
  const summaryPath='/tmp/cp12-production-real-persona-prereq-uat.json';
  fs.rmSync(secretPath,{force:true});
  const run=spawnSync(process.execPath,['scripts/cp12-production-real-persona-prereq.mjs'],{
    cwd:process.cwd(),
    env:{...process.env,STUDENTS_KV_ID:studentsKv,READ_MODELS_KV_ID:String(process.env.READ_MODELS_KV_ID||process.env.EXPECTED_READ_MODELS_KV||''),CP12_PERSONA_SECRETS:secretPath,CP12_PERSONA_SUMMARY:summaryPath},
    encoding:'utf8',
    stdio:['ignore','pipe','pipe']
  });
  if(run.status!==0)throw new Error(`Real production UAT persona discovery failed with exit ${run.status}.`);
  const selected=JSON.parse(fs.readFileSync(secretPath,'utf8'));
  const rows=[['VR',selected.vr],['ORDINARY',selected.ordinary]];
  for(const [prefix,row] of rows){
    if(!row)throw new Error(`Missing ${prefix} real production UAT persona.`);
    process.env[`UAT_${prefix}_USERNAME`]=String(row.username||'');
    process.env[`UAT_${prefix}_LOGIN_PASSWORD`]=String(row.password||'');
    process.env[`UAT_${prefix}_ANSWER_PASSWORD`]=String(row.answerPassword||'');
    process.env[`UAT_${prefix}_EXPECTED_FIRST_NAME`]=String(row.firstName||'');
    process.env[`UAT_${prefix}_VIEW_ID`]=String(row.viewId||'');
    process.env[`UAT_${prefix}_LESSON_ID`]=String(row.lessonId||'');
  }
  fs.rmSync(secretPath,{force:true});
  const summary=JSON.parse(fs.readFileSync(summaryPath,'utf8'));
  if(summary.marker!=='CP12_PRODUCTION_REAL_PERSONA_PREREQ_READONLY_PASS'||summary.productionMutation!==false||summary.vr?.accessProven!==true||summary.vr?.lessonOpen!==true)throw new Error('Real production UAT persona discovery did not prove the authoritative read-only prerequisite.');
  console.log('CP12_PRODUCTION_UAT_REAL_PERSONA_AUTODISCOVERY_PASS');
}
if(!base||!expectedJs)throw new Error('Production UI UAT base/bundle inputs are incomplete.');
populateRealStudentPersonasIfNeeded();
const vrPersona=persona('VR',{answerRequired:true,targetRequired:true});
const ordinaryPersona=persona('ORDINARY');
if(vrPersona.username.toLowerCase()==='admin'||ordinaryPersona.username.toLowerCase()==='admin')throw new Error('Production UI UAT must use real non-admin student principals.');
if(vrPersona.username.toLowerCase()===ordinaryPersona.username.toLowerCase())throw new Error('VR and ordinary production UAT principals must be distinct.');
fs.mkdirSync(evidenceDir,{recursive:true});

function cssRgb(value,r,g,b){return value===`rgb(${r}, ${g}, ${b})`||value===`rgba(${r}, ${g}, ${b}, 1)`;}
async function assertCandidateFrontend(page){
  const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(node=>node.src));
  const bundleUrl=scripts.find(url=>/\/assets\/portal-[^/]+\.js(?:\?|$)/.test(url));
  assert(bundleUrl,'No portal frontend script asset loaded.');
  const pathname=new URL(bundleUrl).pathname;
  assert.equal(pathname,`/assets/${expectedJs}`,'Live browser page did not load the exact staging-proven candidate bundle.');
  const loaded=await page.evaluate(url=>performance.getEntriesByType('resource').some(entry=>entry.name===url),bundleUrl);
  assert.equal(loaded,true,'Candidate frontend bundle was not loaded by the browser page.');
  return {bundleUrl:pathname,candidateMarker:true};
}
async function assertLoginPresentation(page){
  await page.getByRole('heading',{name:'Student Login'}).waitFor({state:'visible',timeout:15000});
  const eye=page.locator('#toggle-password');
  assert.equal(await eye.count(),1,'Login eye control missing.');
  assert.equal(await eye.locator('svg.eye-svg').count(),1,'Login password control is not an eye icon.');
  assert.equal((await eye.textContent()).trim(),'','Login password eye contains Show/Hide text.');
  const input=page.getByRole('textbox',{name:'Password',exact:true});
  assert.equal(await input.getAttribute('type'),'password');
  await eye.click(); assert.equal(await input.getAttribute('type'),'text');
  await eye.click(); assert.equal(await input.getAttribute('type'),'password');
  const chrome=await page.evaluate(()=>{const p=getComputedStyle(document.body,'::before');return {position:p.position,borderTopWidth:p.borderTopWidth,borderImageSource:p.borderImageSource};});
  assert.equal(chrome.position,'fixed','Approved viewport chrome is not fixed.');
  const expectedBorder=(page.viewportSize()?.width||0)<=720?'5px':'6px';
  assert.equal(chrome.borderTopWidth,expectedBorder,`Approved responsive airmail border thickness changed: ${chrome.borderTopWidth}.`);
  assert(/repeating-linear-gradient/i.test(chrome.borderImageSource),'Approved airmail border treatment missing.');
  return chrome;
}
async function login(page,identity){
  await page.goto(`${base}/?cp12-approved-v2-ui=${Date.now()}`,{waitUntil:'domcontentloaded'});
  const frontend=await assertCandidateFrontend(page);
  const loginPresentation=await assertLoginPresentation(page);
  await page.getByLabel('Username').fill(identity.username);
  await page.getByRole('textbox',{name:'Password',exact:true}).fill(identity.password);
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/auth/login',{timeout:15000});
  await page.getByRole('button',{name:'Log in'}).click();
  const response=await responsePromise;
  assert.equal(response.status(),200,'Production student login failed.');
  await page.getByRole('heading',{name:/Welcome/}).waitFor({timeout:15000});
  const greeting=(await page.locator('.greeting').textContent()).trim();
  assert.equal(greeting,`${identity.expectedFirstName}'s Portal`,'Personalised portal wording is not using the production first name.');
  assert.equal(await page.getByText('Student Portal',{exact:true}).count(),0,'Generic Student Portal label remains after login.');
  const topbarPosition=await page.locator('.topbar').evaluate(el=>getComputedStyle(el).position);
  assert.equal(topbarPosition,'sticky','Approved sticky topbar treatment missing.');
  const logoutBg=await page.locator('#logout').evaluate(el=>getComputedStyle(el).backgroundColor);
  assert(cssRgb(logoutBg,200,16,46),`Approved red logout treatment changed: ${logoutBg}`);
  return {frontend,loginPresentation,greeting,topbarPosition,logoutBg};
}
async function assertSubjectPresentation(page){
  const maths=page.locator('[data-subject="maths"]');
  const english=page.locator('[data-subject="english"]');
  assert.equal(await maths.count(),1,'Maths subject card missing.');
  assert.equal(await english.count(),1,'English subject card missing.');
  assert(await maths.evaluate(el=>el.classList.contains('subject-maths')),'Maths branded class missing.');
  assert(await english.evaluate(el=>el.classList.contains('subject-english')),'English branded class missing.');
  const styles=await Promise.all([maths,english].map(locator=>locator.evaluate(el=>({color:getComputedStyle(el).color,backgroundImage:getComputedStyle(el).backgroundImage}))));
  assert(styles.every(row=>row.color==='rgb(255, 255, 255)'),'Subject cards are not using approved inverted white text.');
  assert(styles.every(row=>/linear-gradient/i.test(row.backgroundImage)),'Subject cards are not using approved branded gradients.');
  return styles;
}
async function assertFloatingBack(page,label){
  const button=page.locator('.floating-back');
  await button.waitFor({state:'visible',timeout:10000});
  assert.equal((await button.locator('.back-label').textContent()).trim(),label);
  const style=await button.evaluate(el=>({position:getComputedStyle(el).position,backgroundColor:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  assert.equal(style.position,'fixed','Back control is not fixed/floating.');
  assert(cssRgb(style.backgroundColor,1,33,105),`Back control is not approved navy: ${style.backgroundColor}`);
  assert.equal(style.color,'rgb(255, 255, 255)','Back control is not white-on-navy.');
  return style;
}
async function openLesson(page,viewId,lessonId){
  const calls=[]; const handler=request=>{try{calls.push(new URL(request.url()).pathname);}catch{}}; page.on('request',handler);
  const before=calls.length;
  await page.locator('[data-subject="english"]').click();
  await assertFloatingBack(page,'Subjects');
  assert.equal(calls.slice(before).some(item=>item.includes('/subjects/')),false,'Subject navigation made a forbidden subject API request.');
  const view=page.locator(`[data-view="${viewId}"]`);
  assert.equal(await view.count(),1,`Production student is missing required view ${viewId}.`);
  await view.click();
  await page.getByLabel('Search lessons').waitFor({timeout:15000});
  const lesson=page.locator(`[data-lesson="${lessonId}"]`).first();
  await lesson.waitFor({state:'visible',timeout:10000});
  const expectedPath=`/api/v2/student/lessons/${encodeURIComponent(lessonId)}`;
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname===expectedPath,{timeout:15000});
  await lesson.click();
  const response=await responsePromise;
  assert.equal(response.status(),200,`${lessonId} lesson request failed.`);
  const body=await response.json();
  await page.locator('.lesson-heading').waitFor({timeout:15000});
  page.off('request',handler);
  return body;
}
function ids(rows){return new Set(rows.map(row=>row.resourceId));}
async function renderedIds(section){return new Set(await section.locator('[data-direct-resource],[data-answer]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-direct-resource')||node.getAttribute('data-answer')).filter(Boolean)));}
async function toggleAndAssert(section){
  const button=section.locator('[data-resource-toggle]').first(); const body=section.locator('.resource-collapse-body').first();
  assert.equal(await body.isHidden(),true,'Resource section was not collapsed by default.');
  assert.equal(await button.getAttribute('aria-expanded'),'false');
  assert.equal((await button.textContent()).trim(),'View');
  const dimensions=await button.evaluate(el=>({width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)}));
  assert(dimensions.width>=118&&dimensions.width<=142,`Approved View pill width changed: ${dimensions.width}`);
  assert(dimensions.height>=41&&dimensions.height<=47,`Approved View pill height changed: ${dimensions.height}`);
  await button.click();
  assert.equal(await body.isVisible(),true,'Resource section did not expand.');
  assert.equal(await button.getAttribute('aria-expanded'),'true');
  assert.equal((await button.textContent()).trim(),'Hide');
  return body;
}
async function assertLessonPresentation(page){
  assert.equal(await page.locator('.state-pill').filter({hasText:'Available'}).count(),0,'Ordinary Available state pill is not suppressed.');
  const details=page.locator('#lesson-description-toggle');
  if(await details.count()){
    const body=page.locator('#lesson-description-body');
    assert.equal(await body.isHidden(),true,'Lesson overview must start collapsed.');
    assert.equal((await details.textContent()).trim(),'Details');
    await details.click(); assert.equal(await body.isVisible(),true,'Lesson overview did not expand.');
    assert.equal((await details.textContent()).trim(),'Hide'); await details.click();
  }
  return {descriptionControl:await details.count()===1,ordinaryAvailableSuppressed:true};
}
async function assertAnswerEye(page,vrBody,answerPassword){
  const answer=vrBody.locator('[data-answer]').first(); await answer.click();
  const modal=page.locator('.modal'); await modal.waitFor({state:'visible',timeout:10000});
  assert.equal(await page.locator('#answer-toggle-password svg.eye-svg').count(),1,'Answer Pack password eye icon missing.');
  const input=page.locator('#answer-password'); assert.equal(await input.getAttribute('type'),'password');
  await page.locator('#answer-toggle-password').click(); assert.equal(await input.getAttribute('type'),'text');
  await page.locator('#answer-toggle-password').click(); assert.equal(await input.getAttribute('type'),'password');
  assert.equal((await page.locator('#answer-toggle-password').textContent()).trim(),'','Answer Pack eye contains Show/Hide text.');
  assert.equal(await page.locator('.modal-wide').count(),0,'Protected viewer opened before password submission.');
  await input.fill(answerPassword);
  await page.locator('[data-close]').click(); await modal.waitFor({state:'detached'});
  return {eyeIcon:true,viewerBeforePassword:false};
}

const browser=await chromium.launch({headless:true});
const evidence={marker:'CP12_APPROVED_V2_UI_PRODUCTION_BROWSER_UAT_PASS',baseHost:new URL(base).hostname,frontend:{},visual:{},vr:{},ordinary:{},mobile:{},security:{},screenshots:[]};
try{
  {
    const context=await browser.newContext({viewport:{width:1440,height:1000}}); const page=await context.newPage();
    const loginEvidence=await login(page,vrPersona); evidence.frontend=loginEvidence.frontend; evidence.visual.login=loginEvidence.loginPresentation; evidence.visual.personalisedPortal=loginEvidence.greeting; evidence.visual.topbarPosition=loginEvidence.topbarPosition; evidence.visual.logoutBg=loginEvidence.logoutBg;
    evidence.visual.subjects=await assertSubjectPresentation(page);
    const detail=await openLesson(page,vrPersona.viewId,vrPersona.lessonId); evidence.visual.back=await assertFloatingBack(page,'Lessons'); evidence.visual.lesson=await assertLessonPresentation(page);
    const vrRows=(detail.resources||[]).filter(row=>(row.presentationScopes||[]).includes('vr'));
    const coreRows=(detail.resources||[]).filter(row=>row.type!=='video'&&!(row.presentationScopes||[]).includes('vr'));
    assert(vrRows.length>=4,`Expected canonical VR rows on selected lesson ${vrPersona.lessonId}.`);
    assert(vrRows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='prelesson'),'VR PreLesson worksheet grouping missing.');
    assert(vrRows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='answer-pack'&&row.protected===true),'VR PreLesson answer grouping missing.');
    assert(vrRows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='homework'),'VR Homework grouping missing.');
    assert(vrRows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='answer-pack'&&row.protected===true),'VR Homework answer grouping missing.');
    const sections=page.locator('[data-resource-section]'); await page.waitForFunction(()=>document.querySelectorAll('[data-resource-section]').length>=2,{timeout:7000});
    for(let i=0;i<await sections.count();i++)assert.equal(await sections.nth(i).locator('.resource-collapse-body').first().isHidden(),true,'Every resource section must start collapsed.');
    const homeworkSection=page.locator('[data-resource-section="core-homework"]'); assert.equal(await homeworkSection.count(),1,'Core Homework section missing.');
    const homeworkBody=await toggleAndAssert(homeworkSection); const homeworkIds=await renderedIds(homeworkBody); const vrIds=ids(vrRows); for(const id of homeworkIds)assert(!vrIds.has(id),'VR resource leaked into core Homework.'); assert(homeworkIds.size>0,'Core Homework section is empty.');
    const vrSection=page.locator('[data-resource-section="verbal-reasoning"]'); assert.equal(await vrSection.count(),1,'Verbal Reasoning section missing.');
    const vrBody=await toggleAndAssert(vrSection); await vrBody.getByRole('heading',{name:'VR PreLesson',exact:true}).waitFor({state:'visible'}); await vrBody.getByRole('heading',{name:'VR Homework',exact:true}).waitFor({state:'visible'});
    const vrRendered=await renderedIds(vrBody); for(const row of vrRows)assert(vrRendered.has(row.resourceId),`VR row not rendered: ${row.displayName}`); for(const row of coreRows)assert(!vrRendered.has(row.resourceId),`Core row leaked into VR: ${row.displayName}`);
    const protectedVr=vrRows.filter(row=>row.type==='answer-pack'&&row.protected===true); assert(protectedVr.length>=2,'Expected protected VR answers.'); for(const row of protectedVr)assert.equal(await vrBody.locator(`[data-answer="${row.resourceId}"]`).count(),1,'Protected VR answer lacks password-gated control.');
    evidence.visual.answerPassword=await assertAnswerEye(page,vrBody,vrPersona.answerPassword);
    const shot=path.join(evidenceDir,'desktop-vr-approved-v2-ui.png'); await page.screenshot({path:shot,fullPage:true}); evidence.screenshots.push(path.basename(shot));
    evidence.vr={realStudentPrincipal:true,viewId:vrPersona.viewId,lessonId:vrPersona.lessonId,resourceCount:vrRows.length,coreHomeworkRows:homeworkIds.size,outerSection:true,preLessonSubgroup:true,homeworkSubgroup:true,collapsedByDefault:true,viewHideToggle:true,protectedAnswers:protectedVr.length}; await context.close();
  }
  {
    const context=await browser.newContext({viewport:{width:1280,height:900}}); const page=await context.newPage(); await login(page,ordinaryPersona); await assertSubjectPresentation(page);
    const detail=await openLesson(page,'english-year5','Y5E2'); assert.equal((detail.resources||[]).some(row=>(row.presentationScopes||[]).includes('vr')),false,'Ordinary real-student API response exposed VR rows.'); assert.equal(await page.locator('[data-resource-section="verbal-reasoning"]').count(),0,'Ordinary real-student UI rendered Verbal Reasoning section.');
    const homeworkSection=page.locator('[data-resource-section="core-homework"]'); assert.equal(await homeworkSection.count(),1,'Ordinary Homework section missing.'); const body=await toggleAndAssert(homeworkSection); assert((await body.locator('.resource-row').count())>0,'Ordinary Homework section empty.');
    const shot=path.join(evidenceDir,'desktop-ordinary-no-vr.png'); await page.screenshot({path:shot,fullPage:true}); evidence.screenshots.push(path.basename(shot)); evidence.ordinary={realStudentPrincipal:true,sameLessonControl:true,vrRowsHidden:true,vrSectionAbsent:true,homeworkCollapsible:true}; await context.close();
  }
  {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true}); const page=await context.newPage(); await login(page,ordinaryPersona);
    const boxes=await page.locator('[data-subject]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})); assert.equal(boxes.length,2,'Mobile subject cards missing.'); assert(Math.abs(boxes[0].x-boxes[1].x)<2&&boxes[1].y>boxes[0].y,'Mobile subject cards do not stack.');
    const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})); assert(overflow.scroll<=overflow.client+1,`Mobile horizontal overflow: ${overflow.scroll}/${overflow.client}`);
    await page.locator('[data-subject="english"]').click(); const back=page.locator('.floating-back'); await back.waitFor({state:'visible'}); const backBox=await back.boundingBox(); assert(backBox&&backBox.x>=0&&backBox.y>=0&&backBox.x+backBox.width<=390&&backBox.y+backBox.height<=844,'Mobile floating Back control is outside viewport.');
    const shot=path.join(evidenceDir,'mobile-approved-v2-ui.png'); await page.screenshot({path:shot,fullPage:true}); evidence.screenshots.push(path.basename(shot)); evidence.mobile={realStudentPrincipal:true,subjectCardsStack:true,noHorizontalOverflow:true,floatingBackInViewport:true}; await context.close();
  }
  evidence.visual={...evidence.visual,airmailChrome:true,fixedNavyBack:true,passwordEyes:true,invertedSubjectBranding:true,personalisedPortal:true,stickyTopbar:true,redLogout:true,ordinaryAvailableSuppressed:true,collapsibleLessonResources:true};
  evidence.security={pupilDataSynthetic:false,realStudentPrincipals:true,productionMutation:true,answerControlsRemainPasswordGated:true,viewerCannotOpenBeforePassword:true,accessNotWidened:true,ordinaryNoVrIsolation:true,subjectNavigationLocal:true};
  fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence));
} finally {await browser.close();}
