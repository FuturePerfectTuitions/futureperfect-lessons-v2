import {
  SCOPE_SALT_KEY,
  compileAccessScope,
  globalToCatalogue,
  opaqueAccessScopeId,
  publishScopeAtomic,
  resolveCurrentScope
} from '../worker/src/access-read-model-sync.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
const WORKER_NAME = 'fpt-portal-v2-worker';
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const credentialPath = process.argv[2];
if (!token || !account || !credentialPath) throw new Error('PROVISION_INPUT_REQUIRED');
const { readFile } = await import('node:fs/promises');
const password = (await readFile(credentialPath, 'utf8')).trim();
if (password.length !== 4 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) throw new Error('CREDENTIAL_FORMAT_INVALID');

const headers = { Authorization:`Bearer ${token}` };
async function cfJson(path, init = {}) {
  const response = await fetch(`${CF_API}${path}`, { ...init, headers:{ ...headers, ...(init.headers || {}) } });
  const text = await response.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || body?.success === false) throw new Error(`CF_API_FAILED:${response.status}:${path}`);
  return body;
}
const settings = await cfJson(`/accounts/${account}/workers/scripts/${WORKER_NAME}/settings`);
const bindings = Array.isArray(settings?.result?.bindings) ? settings.result.bindings : [];
if (bindings.find(b => b.name === 'ENVIRONMENT' && b.type === 'plain_text')?.text !== 'production') throw new Error('NOT_PRODUCTION_WORKER');
const ns = name => bindings.find(b => b.name === name && b.type === 'kv_namespace')?.namespace_id || '';
const studentsNs = ns('STUDENTS_KV');
const readModelsNs = ns('READ_MODELS_KV');
if (!studentsNs || !readModelsNs) throw new Error('KV_BINDINGS_UNAVAILABLE');

function kvStore(namespaceId) {
  const valueUrl = key => `${CF_API}/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const r = await fetch(valueUrl(key), { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`KV_GET_FAILED:${r.status}:${key}`);
      return r.text();
    },
    async put(key, value) {
      const r = await fetch(valueUrl(key), { method:'PUT', headers:{ ...headers, 'Content-Type':'text/plain; charset=utf-8' }, body:String(value) });
      const text = await r.text();
      if (!r.ok) throw new Error(`KV_PUT_FAILED:${r.status}:${key}`);
      if (text) { try { const j=JSON.parse(text); if (j?.success === false) throw new Error(`KV_PUT_REJECTED:${key}`); } catch (e) { if (String(e.message).startsWith('KV_PUT_REJECTED')) throw e; } }
    }
  };
}
const students = kvStore(studentsNs);
const readModels = kvStore(readModelsNs);
const ids = ['admin0206','admin0411'];
for (const id of ids) if (await students.get(`user:${id}`) != null) throw new Error(`ACCOUNT_ALREADY_EXISTS:${id}`);

const scopeSalt = String(await readModels.get(SCOPE_SALT_KEY) || '').trim();
if (!/^[0-9a-f]{64}$/i.test(scopeSalt)) throw new Error('READ_MODEL_SCOPE_SALT_INVALID');
const global = await resolveCurrentScope(readModels, 'global');
const catalogue = globalToCatalogue(global.payload);
const sats = Array.from({length:19}, (_,i) => `Y6M${51+i}`);
const viewLessonIds = viewId => {
  const rows = catalogue?.views?.[viewId]?.lessons;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`CATALOGUE_VIEW_UNAVAILABLE:${viewId}`);
  return [...new Set(rows.map(row => String(row?.lessonId || '').trim()).filter(Boolean))];
};
const vrLessons = [...new Set([...viewLessonIds('english-year4-11plus'), ...viewLessonIds('english-year5-11plus')])].sort();
const now = new Date().toISOString();
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const base = (portalUserId, firstName, vrEligible) => ({
  schemaVersion:1, portalUserId, firstName, name:firstName,
  p:password, loginPassword:password, answerPassword:password,
  status:'active', accountStatus:'active', expires:'', expiresOn:null,
  schoolYear:6, vrEligible, mathsYears:[], vrBuckets:[], entitlements:{}, batches:[],
  manualLessonAccess:{}, blockedLessons:[], upsellViews:[],
  studentCreatedAt:now, studentUpdatedAt:now
});
const profiles = {
  admin0206:{
    ...base('admin0206','Admin',false),
    fullLibraries:['MATHS_Y3_FULL','MATHS_Y4_FULL','MATHS_Y5_FULL','MATHS_Y6_FULL','ENGLISH_Y3_FULL','ENGLISH_Y4_FULL','ENGLISH_Y5_FULL','ENGLISH_Y6_FULL'],
    manualAccess:{coreLessons:sats,vrLessons:[],specialBuckets:[]}, specialAccess:[]
  },
  admin0411:{
    ...base('admin0411','Admin',true),
    fullLibraries:['MATHS_L1_FULL','MATHS_L2_FULL','MATHS_L3_FULL','ENGLISH_Y4_11PLUS_FULL','ENGLISH_Y5_11PLUS_FULL'],
    manualAccess:{coreLessons:sats,vrLessons,specialBuckets:['VR_HOWTO']}, specialAccess:['MATHS_11PLUS_QUIZ_L3_COMPLETED']
  }
};

function assertSnapshot(id, payload) {
  const s=payload?.snapshot; if (!s || s.kind!=='prepared-access-snapshot') throw new Error(`SNAPSHOT_INVALID:${id}`);
  const full=new Set(s.fullViewIds||[]), special=new Set(s.specialAreas||[]);
  for (const lessonId of sats) if (s.lessonAccess?.[lessonId]?.core!==true) throw new Error(`SATS_NOT_OPEN:${id}:${lessonId}`);
  if (id==='admin0206') {
    for (const view of ['maths-year3','maths-year4','maths-year5','maths-year6','english-year3','english-year4','english-year5','english-year6']) if (!full.has(view)) throw new Error(`NORMAL_VIEW_MISSING:${view}`);
    for (const view of ['maths-level1','maths-level2','maths-level3','english-year4-11plus','english-year5-11plus']) if (full.has(view)) throw new Error(`NORMAL_11PLUS_LEAK:${view}`);
    if (special.has('VR_HOWTO') || special.has('MATHS_11PLUS_QUIZ_L3_COMPLETED')) throw new Error('NORMAL_SPECIAL_LEAK');
    if (Object.values(s.lessonAccess||{}).some(x=>x?.vr===true)) throw new Error('NORMAL_VR_LEAK');
  } else {
    for (const view of ['maths-level1','maths-level2','maths-level3','english-year4-11plus','english-year5-11plus']) if (!full.has(view)) throw new Error(`ELEVENPLUS_VIEW_MISSING:${view}`);
    for (const view of ['maths-year3','maths-year4','maths-year5','maths-year6']) if (full.has(view)) throw new Error(`ELEVENPLUS_NORMAL_FULL_LEAK:${view}`);
    if (!special.has('VR_HOWTO') || !special.has('MATHS_11PLUS_QUIZ_L3_COMPLETED')) throw new Error('ELEVENPLUS_SPECIAL_MISSING');
    for (const lessonId of vrLessons) if (s.lessonAccess?.[lessonId]?.vr!==true) throw new Error(`VR_NOT_OPEN:${lessonId}`);
  }
}

const compiled={};
for (const id of ids) {
  const scopeId=await opaqueAccessScopeId(id,scopeSalt);
  const payload=compileAccessScope({asOfDate:today,user:profiles[id],batchDefinitions:[],batchAssignments:[],entitlements:[],onlinePreLessonEntitlements:[]},catalogue,scopeId,today);
  assertSnapshot(id,payload); compiled[id]={scopeId,payload};
}

// Forward-only production writes. No delete/restore compensation is performed on failure.
for (const id of ids) {
  await students.put(`user:${id}`,JSON.stringify(profiles[id]));
  const rb=JSON.parse(await students.get(`user:${id}`));
  if (rb?.portalUserId!==id || rb?.p!==password || rb?.loginPassword!==password || rb?.answerPassword!==password) throw new Error(`CANONICAL_READBACK_FAILED:${id}`);
  const published=await publishScopeAtomic(readModels,{scope:`access:${compiled[id].scopeId}`,payload:compiled[id].payload,updatedAt:new Date().toISOString()});
  const current=await resolveCurrentScope(readModels,`access:${compiled[id].scopeId}`);
  if (current.version!==published.version) throw new Error(`PREPARED_READBACK_FAILED:${id}`);
  assertSnapshot(id,current.payload);
}

console.log(JSON.stringify({ok:true,created:ids,globalReadModelVersion:global.version,admin0206:{normalFullViews:8,satsLessons:19,vr:false,quiz:false},admin0411:{elevenPlusFullViews:5,satsLessons:19,vrLessons:vrLessons.length,vrHowTo:true,quiz:true},passwordValuesLogged:false,rollbackPerformed:false}));
