import assert from 'node:assert/strict';
import { createAuthenticatedSession } from '../rebuild/shared/auth/auth-core.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { createVrHowToRuntime, VR_HOWTO_VIEW } from '../rebuild/student/src/lib/vr-howto-runtime.mjs';
import { MemoryStore, publishScopeAtomic } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const AUTH_SIGNING_SECRET = 'a'.repeat(64);
const ACCESS_SCOPE_SECRET = 'b'.repeat(64);
const USER = 'cp11-vr-runtime';
const store = new MemoryStore();
const scopeId = await opaqueAccessScopeId(USER, ACCESS_SCOPE_SECRET);

await publishScopeAtomic(store, {
  scope:`access:${scopeId}`,
  version:'cp11-vr-access',
  payload:{
    schemaVersion:1,
    kind:'prepared-access-read-model',
    scopeId,
    manualSpecialAreas:['VR_HOWTO'],
    snapshot:{
      asOfDate:'2026-09-14',
      account:{ firstName:'CP11', status:'active', expiresOn:'2027-08-31' },
      views:[
        { viewId:'english-year5-11plus', subject:'english', label:'Year 5 11+', current:true, group:'current', lockedPreview:false, visibleLessonCount:1, openLessonCount:1, lockedLessonCount:0 }
      ],
      specialAreas:['VR_HOWTO'],
      lessonAccess:{}
    }
  }
});
await publishScopeAtomic(store, {
  scope:'special:VR_HOWTO',
  version:'cp11-vr-special',
  payload:{
    schemaVersion:1,
    kind:'prepared-special-area',
    bucketId:'VR_HOWTO',
    type:'vr-howto',
    title:'VR How To',
    description:'Short guides',
    items:[
      { itemId:'analogy-1', title:'Analogies', description:'Guide', order:1, separator:false, targetUrl:'https://go.screenpal.com/player/cTEST123?ff=1&title=0&dcc=0&bg=transparent&embedded=1' }
    ]
  }
});

const session = await createAuthenticatedSession({ secret:AUTH_SIGNING_SECRET, userId:USER });
const cookie = session.setCookie.split(';')[0];
const baseRuntime = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/v2/student/home') {
      return new Response(JSON.stringify({ ok:true, account:{ firstName:'CP11' }, views:[{ viewId:'english-year5-11plus', subject:'english', label:'Year 5 11+', current:true, group:'current', lockedPreview:false, visibleLessonCount:1, openLessonCount:1, lockedLessonCount:0 }] }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    if (url.pathname === '/api/v2/student/subjects/english') {
      return new Response(JSON.stringify({ ok:true, subject:'english', views:[{ viewId:'english-year5-11plus', subject:'english', label:'Year 5 11+', current:true, group:'current', lockedPreview:false, visibleLessonCount:1, openLessonCount:1, lockedLessonCount:0 }] }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    return new Response(JSON.stringify({ ok:false, error:'NOT_FOUND' }), { status:404, headers:{ 'content-type':'application/json' } });
  }
};
const runtime = createVrHowToRuntime(baseRuntime);
const env = { READ_MODELS_KV:store, AUTH_SIGNING_SECRET, ACCESS_SCOPE_SECRET };
const req = (path, init={}) => new Request(`https://portal.example${path}`, { ...init, headers:{ cookie, ...(init.headers || {}) } });

const homeResponse = await runtime.fetch(req('/api/v2/student/home'), env);
assert.equal(homeResponse.status, 200);
const home = await homeResponse.json();
const vrView = home.views.find(view => view.viewId === VR_HOWTO_VIEW);
assert.ok(vrView);
assert.equal(vrView.subject, 'english');
assert.equal(vrView.lockedPreview, false);
assert.equal(vrView.openLessonCount, 1);

const subjectResponse = await runtime.fetch(req('/api/v2/student/subjects/english'), env);
const subject = await subjectResponse.json();
assert.ok(subject.views.some(view => view.viewId === VR_HOWTO_VIEW));

const listResponse = await runtime.fetch(req(`/api/v2/student/views/${VR_HOWTO_VIEW}/lessons`), env);
assert.equal(listResponse.status, 200);
const list = await listResponse.json();
assert.equal(list.lessonCount, 1);
assert.equal(list.lessons[0].title, 'Analogies');
const lessonId = list.lessons[0].lessonId;

const detailResponse = await runtime.fetch(req(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}?viewId=${VR_HOWTO_VIEW}`), env);
assert.equal(detailResponse.status, 200);
const detail = await detailResponse.json();
assert.equal(detail.resources.length, 1);
assert.equal(detail.resources[0].type, 'video');
const resourceId = detail.resources[0].resourceId;

const openResponse = await runtime.fetch(req(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}/resources/${encodeURIComponent(resourceId)}/open?viewId=${VR_HOWTO_VIEW}`), env);
assert.equal(openResponse.status, 302);
const deliveryLocation = openResponse.headers.get('location');
assert.ok(deliveryLocation.startsWith('/api/v2/student/resource?'));
assert.equal(deliveryLocation.includes('screenpal.com'), false, 'ScreenPal must not be exposed before the capability delivery hop.');

const deliveryResponse = await runtime.fetch(req(deliveryLocation), env);
assert.equal(deliveryResponse.status, 302);
assert.match(deliveryResponse.headers.get('location'), /^https:\/\/go\.screenpal\.com\/player\//);

const noSpecialScopeId = await opaqueAccessScopeId('cp11-no-vr', ACCESS_SCOPE_SECRET);
await publishScopeAtomic(store, {
  scope:`access:${noSpecialScopeId}`,
  version:'cp11-no-vr-access',
  payload:{ schemaVersion:1, kind:'prepared-access-read-model', scopeId:noSpecialScopeId, manualSpecialAreas:[], snapshot:{ asOfDate:'2026-09-14', account:{ firstName:'No VR', status:'active', expiresOn:'2027-08-31' }, views:[{ viewId:'english-year5-11plus', subject:'english', label:'Year 5 11+', current:true, group:'current', lockedPreview:false }], specialAreas:[], lessonAccess:{} } }
});
const noSpecialSession = await createAuthenticatedSession({ secret:AUTH_SIGNING_SECRET, userId:'cp11-no-vr' });
const noSpecialCookie = noSpecialSession.setCookie.split(';')[0];
const noSpecialHome = await runtime.fetch(new Request('https://portal.example/api/v2/student/home', { headers:{ cookie:noSpecialCookie } }), env);
assert.equal((await noSpecialHome.json()).views.some(view => view.viewId === VR_HOWTO_VIEW), false);

const directOnlyScopeId = await opaqueAccessScopeId('cp11-vr-direct-only', ACCESS_SCOPE_SECRET);
await publishScopeAtomic(store, {
  scope:`access:${directOnlyScopeId}`,
  version:'cp11-vr-direct-only-access',
  payload:{ schemaVersion:1, kind:'prepared-access-read-model', scopeId:directOnlyScopeId, manualSpecialAreas:[], snapshot:{ asOfDate:'2026-09-14', account:{ firstName:'Direct', status:'active', expiresOn:'2027-08-31' }, views:[{ viewId:'english-year5-11plus', subject:'english', label:'Year 5 11+', current:true, group:'current', lockedPreview:false }], specialAreas:['VR_HOWTO'], lessonAccess:{} } }
});
const directOnlySession = await createAuthenticatedSession({ secret:AUTH_SIGNING_SECRET, userId:'cp11-vr-direct-only' });
const directOnlyCookie = directOnlySession.setCookie.split(';')[0];
const directOnlyHome = await runtime.fetch(new Request('https://portal.example/api/v2/student/home', { headers:{ cookie:directOnlyCookie } }), env);
assert.equal((await directOnlyHome.json()).views.some(view => view.viewId === VR_HOWTO_VIEW), false, 'Direct-only specialAccess must not grant VR How-To.');

const lockedScopeId = await opaqueAccessScopeId('cp11-vr-locked', ACCESS_SCOPE_SECRET);
await publishScopeAtomic(store, {
  scope:`access:${lockedScopeId}`,
  version:'cp11-vr-locked-access',
  payload:{ schemaVersion:1, kind:'prepared-access-read-model', scopeId:lockedScopeId, manualSpecialAreas:['VR_HOWTO'], snapshot:{ asOfDate:'2026-09-14', account:{ firstName:'Locked', status:'active', expiresOn:'2027-08-31' }, views:[{ viewId:'english-year5-11plus', subject:'english', label:'Year 5 11+', current:true, group:'current', lockedPreview:true }], specialAreas:['VR_HOWTO'], lessonAccess:{} } }
});
const lockedSession = await createAuthenticatedSession({ secret:AUTH_SIGNING_SECRET, userId:'cp11-vr-locked' });
const lockedCookie = lockedSession.setCookie.split(';')[0];
const lockedList = await runtime.fetch(new Request(`https://portal.example/api/v2/student/views/${VR_HOWTO_VIEW}/lessons`, { headers:{ cookie:lockedCookie } }), env);
assert.equal(lockedList.status, 404, 'Locked preview must expose no VR How-To capability surface.');

console.log('REBUILD_CHECKPOINT11_VR_HOWTO_RUNTIME_PASS');
