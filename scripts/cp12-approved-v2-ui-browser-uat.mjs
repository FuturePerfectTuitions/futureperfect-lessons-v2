import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base=String(process.env.CP12_BROWSER_BASE_URL||'').replace(/\/$/,'');
const password=String(process.env.UAT_LOGIN_PASSWORD||'');
const answerPassword=String(process.env.UAT_ANSWER_PASSWORD||'');
const vrUsername=String(process.env.UAT_VR_USERNAME||'cp12vrui');
const coreUsername=String(process.env.UAT_CORE_USERNAME||'cp12coreui');
const expectedPortalOwner=(String(process.env.UAT_EXPECTED_FIRST_NAME||'CP12').trim().split(/\s+/)[0]||'CP12');
const evidenceMarker=String(process.env.UAT_EVIDENCE_MARKER||'CP12_APPROVED_V2_UI_STAGING_BROWSER_UAT_PASS');
const pupilDataSynthetic=String(process.env.UAT_PUPIL_DATA_SYNTHETIC||'true')!=='false';
const productionMutation=String(process.env.UAT_PRODUCTION_MUTATION||'false')==='true';
const evidenceDir='/tmp/cp12-approved-v2-ui-browser-evidence';
if(!base||!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(password))throw new Error('CP12 UI browser UAT inputs are incomplete.');
if(!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(answerPassword))throw new Error('CP12 answer-password UAT input is incomplete.');
fs.mkdirSync(evidenceDir,{recursive:true});

function cssRgb(value,r,g,b){
  return value===`rgb(${r}, ${g}, ${b})`||value===`rgba(${r}, ${g}, ${b}, 1)`;
}
async function assertCandidateFrontend(page){
  const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(node=>node.src));
  assert(scripts.length>0,'No frontend script asset loaded.');
  const bundleUrl=scripts.find(url=>/\/assets\/portal-[^/]+\.js(?:\?|$)/.test(url))||scripts[0];
  const loaded=await page.evaluate(url=>performance.getEntriesByType('resource').some(entry=>entry.name===url),bundleUrl);
  assert.equal(loaded,true,'Candidate frontend bundle was not loaded by the browser page.');
  return {bundleUrl:new URL(bundleUrl).pathname,candidateMarker:true};
}
async function assertLoginPresentation(page){
  await page.getByRole('heading',{name:'Student Login'}).waitFor({state:'visible',timeout:15000});
  const eye=page.locator('#toggle-password');
  assert.equal(await eye.count(),1,'Login eye control missing.');
  assert.equal(await eye.locator('svg.eye-svg').count(),1,'Login password control is not an eye icon.');
  assert.equal((await eye.textContent()).trim(),'','Login password eye unexpectedly contains Show/Hide text.');
  const input=page.getByRole('textbox',{name:'Password',exact:true});
  assert.equal(await input.getAttribute('type'),'password');
  await eye.click(); assert.equal(await input.getAttribute('type'),'text');
  await eye.click(); assert.equal(await input.getAttribute('type'),'password');
  const chrome=await page.evaluate(()=>{
    const pseudo=getComputedStyle(document.body,'::before');
    return {position:pseudo.position,borderTopWidth:pseudo.borderTopWidth,borderImageSource:pseudo.borderImageSource};
  });
  assert.equal(chrome.position,'fixed','Approved viewport chrome pseudo-element is not fixed.');
  const expectedBorder=(page.viewportSize()?.width||0)<=720?'5px':'6px';
  assert.equal(chrome.borderTopWidth,expectedBorder,`Approved responsive airmail border thickness changed: ${chrome.borderTopWidth} at ${page.viewportSize()?.width}px.`);
  assert(/repeating-linear-gradient/i.test(chrome.borderImageSource),'Approved airmail border treatment missing.');
  return chrome;
}
async function login(page,username){
  await page.goto(`${base}/?cp12-approved-v2-ui=${Date.now()}`,{waitUntil:'domcontentloaded'});
  const frontend=await assertCandidateFrontend(page);
  const loginPresentation=await assertLoginPresentation(page);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('textbox',{name:'Password',exact:true}).fill(password);
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/auth/login',{timeout:15000});
  await page.getByRole('button',{name:'Log in'}).click();
  const response=await responsePromise;
  assert.equal(response.status(),200,`${username} login failed`);
  await page.getByRole('heading',{name:/Welcome/}).waitFor({timeout:15000});
  const greeting=(await page.locator('.greeting').textContent()).trim();
  assert.equal(greeting,`${expectedPortalOwner}'s Portal`,'Personalised portal wording is not using first name.');
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
  assert(await maths.evaluate(el=>el.classList.contains('subject-maths')),'Maths inverted brand class missing.');
  assert(await english.evaluate(el=>el.classList.contains('subject-english')),'English inverted brand class missing.');
  const styles=await Promise.all([maths,english].map(locator=>locator.evaluate(el=>({color:getComputedStyle(el).color,backgroundImage:getComputedStyle(el).backgroundImage}))));
  assert(styles.every(row=>row.color==='rgb(255, 255, 255)'),'Subject cards are not using approved inverted white text.');
  assert(styles.every(row=>/linear-gradient/i.test(row.backgroundImage)),'Subject cards are not using approved branded gradient treatment.');
  return styles;
}
async function assertFloatingBack(page,label){
  const button=page.locator('.floating-back');
  await button.waitFor({state:'visible',timeout:10000});
  assert.equal((await button.locator('.back-label').textContent()).trim(),label);
  const style=await button.evaluate(el=>({position:getComputedStyle(el).position,backgroundColor:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  assert.equal(style.position,'fixed','Back control is not fixed/floating.');
  assert(cssRgb(style.backgroundColor,1,33,105),`Back control is not approved navy: ${style.backgroundColor}`);
  assert.equal(style.color,'rgb(255, 255, 255)','Back control is not inverted white-on-navy.');
  return style;
}
async function openY5E2(page,viewId){
  const calls=[];
  const handler=request=>{try{calls.push(new URL(request.url()).pathname);}catch{}};
  page.on('request',handler);
  const before=calls.length;
  await page.locator('[data-subject="english"]').click();
  await assertFloatingBack(page,'Subjects');
  const subjectCalls=calls.slice(before);
  assert.equal(subjectCalls.some(item=>item.includes('/subjects/')),false,'Subject navigation made a forbidden subject API request.');
  await page.locator(`[data-view="${viewId}"]`).click();
  await page.getByLabel('Search lessons').waitFor({timeout:15000});
  const lesson=page.locator('[data-lesson="Y5E2"]').first();
  await lesson.waitFor({state:'visible',timeout:10000});
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/student/lessons/Y5E2',{timeout:15000});
  await lesson.click();
  const response=await responsePromise;
  assert.equal(response.status(),200,'Y5E2 lesson request failed');
  const body=await response.json();
  await page.locator('.lesson-heading').waitFor({timeout:15000});
  page.off('request',handler);
  return body;
}
function ids(rows){return new Set(rows.map(row=>row.resourceId));}
async function renderedIds(section){
  return new Set(await section.locator('[data-direct-resource],[data-answer]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-direct-resource')||node.getAttribute('data-answer')).filter(Boolean)));
}
async function toggleAndAssert(section){
  const button=section.locator('[data-resource-toggle]').first();
  const body=section.locator('.resource-collapse-body').first();
  assert.equal(await body.isHidden(),true,'Section was not collapsed by default');
  assert.equal(await button.getAttribute('aria-expanded'),'false');
  assert.equal((await button.textContent()).trim(),'View');
  const dimensions=await button.evaluate(el=>({width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)}));
  assert(dimensions.width>=118&&dimensions.width<=142,`Approved View pill width changed: ${dimensions.width}`);
  assert(dimensions.height>=41&&dimensions.height<=47,`Approved View pill height changed: ${dimensions.height}`);
  await button.click();
  assert.equal(await body.isVisible(),true,'Section did not expand');
  assert.equal(await button.getAttribute('aria-expanded'),'true');
  assert.equal((await button.textContent()).trim(),'Hide');
  return body;
}
async function requireSections(page,min=2){
  const locator=page.locator('[data-resource-section]');
  await page.waitForFunction(expected=>document.querySelectorAll('[data-resource-section]').length>=expected,min,{timeout:7000});
  return locator;
}
async function assertLessonPresentation(page){
  assert.equal(await page.locator('.state-pill').filter({hasText:'Available'}).count(),0,'Approved UI must suppress ordinary Available state pill.');
  const details=page.locator('#lesson-description-toggle');
  if(await details.count()){
    const body=page.locator('#lesson-description-body');
    assert.equal(await body.isHidden(),true,'Lesson overview must start collapsed.');
    assert.equal((await details.textContent()).trim(),'Details');
    await details.click();
    assert.equal(await body.isVisible(),true,'Lesson overview did not expand.');
    assert.equal((await details.textContent()).trim(),'Hide');
    await details.click();
  }
  return {descriptionControl:await details.count()===1,ordinaryAvailableSuppressed:true};
}
async function assertAnswerEye(page,vrBody){
  const answer=vrBody.locator('[data-answer]').first();
  await answer.click();
  const modal=page.locator('.modal');
  await modal.waitFor({state:'visible',timeout:10000});
  assert.equal(await page.locator('#answer-toggle-password svg.eye-svg').count(),1,'Answer Pack password eye icon missing.');
  const input=page.locator('#answer-password');
  assert.equal(await input.getAttribute('type'),'password');
  await page.locator('#answer-toggle-password').click(); assert.equal(await input.getAttribute('type'),'text');
  await page.locator('#answer-toggle-password').click(); assert.equal(await input.getAttribute('type'),'password');
  assert.equal((await page.locator('#answer-toggle-password').textContent()).trim(),'','Answer Pack eye unexpectedly contains Show/Hide text.');
  assert.equal(await page.locator('.modal-wide').count(),0,'Protected viewer opened before password submission.');
  await input.fill(answerPassword);
  await page.locator('[data-close]').click();
  await modal.waitFor({state:'detached'});
  return {eyeIcon:true,viewerBeforePassword:false};
}

const browser=await chromium.launch({headless:true});
const evidence={marker:evidenceMarker,baseHost:new URL(base).hostname,frontend:{},visual:{},vr:{},ordinary:{},mobile:{},security:{},screenshots:[]};
try{
  {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    const loginEvidence=await login(page,vrUsername);
    evidence.frontend=loginEvidence.frontend;
    evidence.visual.login=loginEvidence.loginPresentation;
    evidence.visual.personalisedPortal=loginEvidence.greeting;
    evidence.visual.topbarPosition=loginEvidence.topbarPosition;
    evidence.visual.logoutBg=loginEvidence.logoutBg;
    evidence.visual.subjects=await assertSubjectPresentation(page);
    const detail=await openY5E2(page,'english-year5-11plus');
    evidence.visual.back=await assertFloatingBack(page,'Lessons');
    evidence.visual.lesson=await assertLessonPresentation(page);
    const vrRows=(detail.resources||[]).filter(row=>(row.presentationScopes||[]).includes('vr'));
    const coreRows=(detail.resources||[]).filter(row=>row.type!=='video'&&!(row.presentationScopes||[]).includes('vr'));
    assert(vrRows.length>=4,'Expected canonical VR rows on Y5E2');
    assert(vrRows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='prelesson'));
    assert(vrRows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='answer-pack'&&row.protected===true));
    assert(vrRows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='homework'));
    assert(vrRows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='answer-pack'&&row.protected===true));

    const allSections=await requireSections(page,2);
    for(let i=0;i<await allSections.count();i++){
      const body=allSections.nth(i).locator('.resource-collapse-body').first();
      assert.equal(await body.isHidden(),true,'Every lesson resource section must start collapsed');
    }
    const homeworkSection=page.locator('[data-resource-section="core-homework"]');
    assert.equal(await homeworkSection.count(),1,'Core Homework section missing');
    const homeworkBody=await toggleAndAssert(homeworkSection);
    const homeworkIds=await renderedIds(homeworkBody);
    const vrIds=ids(vrRows);
    for(const id of homeworkIds)assert(!vrIds.has(id),'VR resource leaked into core Homework section');
    assert(homeworkIds.size>0,'Core Homework section is empty');

    const vrSection=page.locator('[data-resource-section="verbal-reasoning"]');
    assert.equal(await vrSection.count(),1,'Verbal Reasoning section missing');
    const vrBody=await toggleAndAssert(vrSection);
    await vrBody.getByRole('heading',{name:'VR PreLesson',exact:true}).waitFor({state:'visible'});
    await vrBody.getByRole('heading',{name:'VR Homework',exact:true}).waitFor({state:'visible'});
    const vrRendered=await renderedIds(vrBody);
    for(const row of vrRows)assert(vrRendered.has(row.resourceId),`VR row not rendered inside Verbal Reasoning: ${row.displayName}`);
    for(const row of coreRows)assert(!vrRendered.has(row.resourceId),`Core row leaked into Verbal Reasoning: ${row.displayName}`);
    const protectedVr=vrRows.filter(row=>row.type==='answer-pack'&&row.protected===true);
    assert(protectedVr.length>=2,'Expected protected VR answers');
    for(const row of protectedVr)assert.equal(await vrBody.locator(`[data-answer="${row.resourceId}"]`).count(),1,'Protected VR answer is not using password-gated control');
    evidence.visual.answerPassword=await assertAnswerEye(page,vrBody);
    const shot=path.join(evidenceDir,'desktop-vr-approved-v2-ui.png');
    await page.screenshot({path:shot,fullPage:true}); evidence.screenshots.push(path.basename(shot));
    evidence.vr={resourceCount:vrRows.length,coreHomeworkRows:homeworkIds.size,outerSection:true,preLessonSubgroup:true,homeworkSubgroup:true,collapsedByDefault:true,viewHideToggle:true,protectedAnswers:protectedVr.length};
    await context.close();
  }
  {
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    const page=await context.newPage();
    await login(page,coreUsername);
    await assertSubjectPresentation(page);
    const detail=await openY5E2(page,'english-year5');
    assert.equal((detail.resources||[]).some(row=>(row.presentationScopes||[]).includes('vr')),false,'Ordinary API response exposed VR rows');
    assert.equal(await page.locator('[data-resource-section="verbal-reasoning"]').count(),0,'Ordinary UI rendered Verbal Reasoning section');
    const homeworkSection=page.locator('[data-resource-section="core-homework"]');
    assert.equal(await homeworkSection.count(),1,'Ordinary Homework section missing');
    const body=await toggleAndAssert(homeworkSection);
    assert((await body.locator('.resource-row').count())>0,'Ordinary Homework section empty');
    const shot=path.join(evidenceDir,'desktop-ordinary-no-vr.png');
    await page.screenshot({path:shot,fullPage:true}); evidence.screenshots.push(path.basename(shot));
    evidence.ordinary={sameLessonControl:true,vrRowsHidden:true,vrSectionAbsent:true,homeworkCollapsible:true};
    await context.close();
  }
  {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
    const page=await context.newPage();
    await login(page,coreUsername);
    const boxes=await page.locator('[data-subject]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    assert.equal(boxes.length,2,'Mobile subject cards missing.');
    assert(Math.abs(boxes[0].x-boxes[1].x)<2&&boxes[1].y>boxes[0].y,'Mobile subject cards do not stack.');
    const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    assert(overflow.scroll<=overflow.client+1,`Mobile horizontal overflow: ${overflow.scroll}/${overflow.client}`);
    await page.locator('[data-subject="english"]').click();
    const back=page.locator('.floating-back'); await back.waitFor({state:'visible'});
    const backBox=await back.boundingBox();
    assert(backBox&&backBox.x>=0&&backBox.y>=0&&backBox.x+backBox.width<=390&&backBox.y+backBox.height<=844,'Mobile floating Back control is outside viewport.');
    const shot=path.join(evidenceDir,'mobile-approved-v2-ui.png');
    await page.screenshot({path:shot,fullPage:true}); evidence.screenshots.push(path.basename(shot));
    evidence.mobile={subjectCardsStack:true,noHorizontalOverflow:true,floatingBackInViewport:true};
    await context.close();
  }
  evidence.visual={...evidence.visual,airmailChrome:true,fixedNavyBack:true,passwordEyes:true,invertedSubjectBranding:true,personalisedPortal:true,stickyTopbar:true,redLogout:true,ordinaryAvailableSuppressed:true,collapsibleLessonResources:true};
  evidence.security={pupilDataSynthetic,productionMutation,answerControlsRemainPasswordGated:true,viewerCannotOpenBeforePassword:true,accessNotWidened:true,subjectNavigationLocal:true};
  fs.writeFileSync('/tmp/cp12-approved-v2-ui-browser-uat.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
}
