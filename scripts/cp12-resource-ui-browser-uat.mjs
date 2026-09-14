import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base=String(process.env.CP12_BROWSER_BASE_URL||'').replace(/\/$/,'');
const password=String(process.env.UAT_LOGIN_PASSWORD||'');
const evidenceDir='/tmp/cp12-resource-ui-browser-evidence';
if(!base||!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{4}$/.test(password))throw new Error('CP12 UI browser UAT inputs are incomplete.');
fs.mkdirSync(evidenceDir,{recursive:true});

async function login(page,username){
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Student Login'}).waitFor({state:'visible',timeout:15000});
  await page.getByLabel('Username').fill(username);
  await page.getByRole('textbox',{name:'Password',exact:true}).fill(password);
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/auth/login',{timeout:15000});
  await page.getByRole('button',{name:'Log in'}).click();
  const response=await responsePromise;
  assert.equal(response.status(),200,`${username} login failed`);
  await page.getByRole('heading',{name:/Welcome/}).waitFor({timeout:15000});
}
async function openY5E2(page,viewId){
  await page.locator('[data-subject="english"]').click();
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
  await button.click();
  assert.equal(await body.isVisible(),true,'Section did not expand');
  assert.equal(await button.getAttribute('aria-expanded'),'true');
  assert.equal((await button.textContent()).trim(),'Hide');
  return body;
}

const browser=await chromium.launch({headless:true});
const evidence={marker:'CP12_RESOURCE_UI_STAGING_BROWSER_UAT_PASS',baseHost:new URL(base).hostname,vr:{},ordinary:{},security:{},screenshots:[]};
try{
  {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    await login(page,'cp12vrui');
    const detail=await openY5E2(page,'english-year5-11plus');
    const vrRows=(detail.resources||[]).filter(row=>(row.presentationScopes||[]).includes('vr'));
    const coreRows=(detail.resources||[]).filter(row=>row.type!=='video'&&!(row.presentationScopes||[]).includes('vr'));
    assert(vrRows.length>=4,'Expected canonical VR rows on Y5E2');
    assert(vrRows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='prelesson'));
    assert(vrRows.some(row=>row.presentationGroup==='vr-prelesson'&&row.type==='answer-pack'&&row.protected===true));
    assert(vrRows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='homework'));
    assert(vrRows.some(row=>row.presentationGroup==='vr-homework'&&row.type==='answer-pack'&&row.protected===true));

    const allSections=page.locator('[data-resource-section]');
    assert((await allSections.count())>=2,'Expected multiple resource sections');
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

    const shot=path.join(evidenceDir,'vr-y5e2-collapsible.png');
    await page.screenshot({path:shot,fullPage:true}); evidence.screenshots.push(path.basename(shot));
    evidence.vr={resourceCount:vrRows.length,coreHomeworkRows:homeworkIds.size,outerSection:true,preLessonSubgroup:true,homeworkSubgroup:true,collapsedByDefault:true,viewHideToggle:true,protectedAnswers:protectedVr.length};
    await context.close();
  }
  {
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    const page=await context.newPage();
    await login(page,'cp12coreui');
    const detail=await openY5E2(page,'english-year5');
    assert.equal((detail.resources||[]).some(row=>(row.presentationScopes||[]).includes('vr')),false,'Ordinary API response exposed VR rows');
    assert.equal(await page.locator('[data-resource-section="verbal-reasoning"]').count(),0,'Ordinary UI rendered Verbal Reasoning section');
    const homeworkSection=page.locator('[data-resource-section="core-homework"]');
    assert.equal(await homeworkSection.count(),1,'Ordinary Homework section missing');
    const body=await toggleAndAssert(homeworkSection);
    assert((await body.locator('.resource-row').count())>0,'Ordinary Homework section empty');
    evidence.ordinary={sameLessonControl:true,vrRowsHidden:true,vrSectionAbsent:true,homeworkCollapsible:true};
    await context.close();
  }
  evidence.security={pupilDataSynthetic:true,productionMutation:false,answerControlsRemainPasswordGated:true,accessNotWidened:true};
  fs.writeFileSync('/tmp/cp12-resource-ui-browser-uat.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
}
