import fs from 'node:fs';
import { publishStudentPreparedAccess } from '../worker/src/admin-prepared-access-publisher.js';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const accountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const apiToken = clean(process.env.CLOUDFLARE_API_TOKEN);
const adminWorker = clean(process.env.LEGACY_WORKER || 'fpt-portal-v2-worker');
const prodHost = clean(process.env.PROD_HOST || 'lessons.futureperfect.education');
if (!accountId || !apiToken) throw new Error('Cloudflare credentials are required.');

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const authHeaders = { Authorization:`Bearer ${apiToken}` };

async function cf(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers:{ ...authHeaders, ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(`Cloudflare request failed ${response.status}: ${path}`);
  }
  return body.result;
}

async function workerSettings(name) {
  return cf(`/workers/scripts/${encodeURIComponent(name)}/settings`);
}

function binding(settings, name) {
  return (settings?.bindings || []).find(item => item?.name === name) || null;
}

function kvAdapter(namespaceId) {
  const base = `/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/`;
  return {
    async get(key, options = {}) {
      const response = await fetch(`${apiBase}${base}${encodeURIComponent(key)}`, { headers:authHeaders });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`KV read failed ${response.status}: ${key}`);
      const text = await response.text();
      if (options?.type === 'json') return text ? JSON.parse(text) : null;
      return text;
    },
    async put(key, value) {
      const response = await fetch(`${apiBase}${base}${encodeURIComponent(key)}`, {
        method:'PUT',
        headers:{ ...authHeaders, 'content-type':'text/plain;charset=UTF-8' },
        body:String(value)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) throw new Error(`KV write failed ${response.status}: ${key}`);
    },
    async delete(key) {
      const response = await fetch(`${apiBase}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`, {
        method:'DELETE', headers:authHeaders
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) throw new Error(`KV delete failed ${response.status}: ${key}`);
    }
  };
}

function d1Adapter(databaseId) {
  async function execute(sql, params) {
    const response = await fetch(`${apiBase}/d1/database/${encodeURIComponent(databaseId)}/query`, {
      method:'POST',
      headers:{ ...authHeaders, 'content-type':'application/json' },
      body:JSON.stringify({ sql, params })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true) throw new Error(`D1 query failed ${response.status}`);
    const item = Array.isArray(body.result) ? body.result[0] : body.result;
    if (!item?.success) throw new Error('D1 query result failed.');
    return item;
  }
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) { params = values; return statement; },
        async all() {
          const item = await execute(sql, params);
          return { results:Array.isArray(item.results) ? item.results : [], meta:item.meta || {} };
        },
        async first() {
          const item = await execute(sql, params);
          return Array.isArray(item.results) && item.results.length ? item.results[0] : null;
        },
        async run() {
          const item = await execute(sql, params);
          return { success:true, meta:item.meta || {}, changes:Number(item?.meta?.changes || 0) };
        }
      };
      return statement;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) {
        if (typeof statement?.run !== 'function') throw new Error('Unsupported D1 batch statement.');
        results.push(await statement.run());
      }
      return results;
    }
  };
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  return body || {};
}

async function publicFetch(path, options = {}) {
  return fetch(`https://${prodHost}${path}`, {
    cache:'no-store',
    ...options,
    headers:{ 'cache-control':'no-store', ...(options.headers || {}) }
  });
}

async function clearConsumption(DB, userId) {
  await DB.prepare('DELETE FROM trial_login_consumptions WHERE portal_user_id_norm = ?').bind(norm(userId)).run();
}

async function consumptionCount(DB, userId) {
  const row = await DB.prepare('SELECT COUNT(*) AS count FROM trial_login_consumptions WHERE portal_user_id_norm = ?').bind(norm(userId)).first();
  return Number(row?.count || 0);
}

const settings = await workerSettings(adminWorker);
const studentsBinding = binding(settings, 'STUDENTS_KV');
const readBinding = binding(settings, 'REBUILD_SHADOW_KV');
const d1Binding = binding(settings, 'DB');
if (studentsBinding?.type !== 'kv_namespace' || !studentsBinding.namespace_id) throw new Error('STUDENTS_KV binding unavailable.');
if (readBinding?.type !== 'kv_namespace' || !readBinding.namespace_id) throw new Error('REBUILD_SHADOW_KV binding unavailable.');
if (d1Binding?.type !== 'd1' || !(d1Binding.id || d1Binding.database_id)) throw new Error('DB binding unavailable.');

const STUDENTS_KV = kvAdapter(studentsBinding.namespace_id);
const REBUILD_SHADOW_KV = kvAdapter(readBinding.namespace_id);
const DB = d1Adapter(d1Binding.id || d1Binding.database_id);
const env = { STUDENTS_KV, REBUILD_SHADOW_KV, DB };

const trialSej = await STUDENTS_KV.get('user:trialsej', { type:'json' });
const trialEva = await STUDENTS_KV.get('user:trialeva', { type:'json' });
if (!trialSej || !trialEva) throw new Error('Expected TrialSej and TrialEva profiles are not present.');
if (!Array.isArray(trialSej.trialViews) || !trialSej.trialViews.length) throw new Error('TrialSej has no trialViews.');
if (!Array.isArray(trialEva.trialViews) || !trialEva.trialViews.length) throw new Error('TrialEva has no trialViews.');
if (!clean(trialSej.p)) throw new Error('TrialSej login password is missing.');

// Publish valid rebuilt prepared-access models for the two accounts created by
// the earlier Admin console. This is the only migration required for them.
const sejPublish = await publishStudentPreparedAccess(env, 'trialsej');
const evaPublish = await publishStudentPreparedAccess(env, 'trialeva');
if (!sejPublish?.ok || !evaPublish?.ok) throw new Error('Prepared Trial access publish failed.');

// Start both accounts in the user-requested unused state.
await clearConsumption(DB, 'trialsej');
await clearConsumption(DB, 'trialeva');

const loginBody = JSON.stringify({ username:'TrialSej', password:String(trialSej.p) });
const firstLoginResponse = await publicFetch('/api/v2/auth/login', {
  method:'POST',
  headers:{ Origin:`https://${prodHost}`, 'content-type':'application/json' },
  body:loginBody
});
const firstLogin = await readJson(firstLoginResponse);
if (firstLoginResponse.status !== 200 || firstLogin?.ok !== true || firstLogin?.account?.trial !== true) {
  throw new Error(`Trial first login failed with ${firstLoginResponse.status}: ${clean(firstLogin?.error)}`);
}
const expectedViews = ['english-year4-11plus','maths-level1','maths-level2'];
const loginViews = [...(firstLogin.account.trialViews || [])].map(norm).sort();
if (JSON.stringify(loginViews) !== JSON.stringify([...expectedViews].sort())) throw new Error('Trial login returned wrong trialViews.');
const setCookie = firstLoginResponse.headers.get('set-cookie') || '';
const cookie = setCookie.split(';')[0];
if (!cookie.startsWith('fpt_session=')) throw new Error('Trial first login did not issue rebuilt session cookie.');
if (await consumptionCount(DB, 'trialsej') !== 1) throw new Error('Trial first login was not consumed exactly once.');

const homeResponse = await publicFetch('/api/v2/student/home', { headers:{ Cookie:cookie } });
const home = await readJson(homeResponse);
if (!homeResponse.ok || home?.ok !== true) throw new Error('Trial Home failed.');
const homeViews = (home.views || []).map(view => norm(view?.viewId)).sort();
if (JSON.stringify(homeViews) !== JSON.stringify([...expectedViews].sort())) throw new Error(`Trial Home views incorrect: ${JSON.stringify(homeViews)}`);

const l1ListResponse = await publicFetch('/api/v2/student/views/maths-level1/lessons', { headers:{ Cookie:cookie } });
const l1List = await readJson(l1ListResponse);
const l1LessonId = clean(l1List?.lessons?.[0]?.lessonId);
if (!l1ListResponse.ok || !l1LessonId) throw new Error('Trial L1 catalogue unavailable.');
const l1DetailResponse = await publicFetch(`/api/v2/student/lessons/${encodeURIComponent(l1LessonId)}?viewId=maths-level1`, { headers:{ Cookie:cookie } });
const l1Detail = await readJson(l1DetailResponse);
if (!l1DetailResponse.ok || !Array.isArray(l1Detail.resources)) throw new Error('Trial L1 detail unavailable.');
if (l1Detail.resources.some(resource => norm(resource?.type) !== 'video')) throw new Error('Trial L1 exposed a non-video resource.');

const y4ListResponse = await publicFetch('/api/v2/student/views/english-year4-11plus/lessons', { headers:{ Cookie:cookie } });
const y4List = await readJson(y4ListResponse);
if (!y4ListResponse.ok || !Array.isArray(y4List.lessons) || !y4List.lessons.length) throw new Error('Trial Year 4 11+ catalogue unavailable.');
let vrDetail = null;
for (const row of y4List.lessons) {
  const lessonId = clean(row?.lessonId);
  if (!lessonId) continue;
  const response = await publicFetch(`/api/v2/student/lessons/${encodeURIComponent(lessonId)}?viewId=english-year4-11plus`, { headers:{ Cookie:cookie } });
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body.resources)) continue;
  const vrResources = body.resources.filter(resource => (resource?.presentationScopes || []).map(norm).includes('vr'));
  if (vrResources.length) { vrDetail = body; break; }
}
if (!vrDetail) throw new Error('No Year 4 VR resource was visible to TrialSej.');
const disallowedY4 = vrDetail.resources.filter(resource => norm(resource?.type) !== 'video' && !(resource?.presentationScopes || []).map(norm).includes('vr'));
if (disallowedY4.length) throw new Error('Trial Year 4 11+ exposed non-VR non-video resources.');

const secondLoginResponse = await publicFetch('/api/v2/auth/login', {
  method:'POST',
  headers:{ Origin:`https://${prodHost}`, 'content-type':'application/json' },
  body:loginBody
});
const secondLogin = await readJson(secondLoginResponse);
if (secondLoginResponse.status !== 403 || secondLogin?.error !== 'TRIAL_ACCESS_ENDED') {
  throw new Error(`Trial second login was not blocked: ${secondLoginResponse.status} ${clean(secondLogin?.error)}`);
}
if (await consumptionCount(DB, 'trialsej') !== 1) throw new Error('Second Trial login changed consumption count.');

// Rearm after the smoke exactly as the owner requested. TrialEva remains unused.
await clearConsumption(DB, 'trialsej');
if (await consumptionCount(DB, 'trialsej') !== 0 || await consumptionCount(DB, 'trialeva') !== 0) {
  throw new Error('Final Trial accounts are not in unused state.');
}

const evidence = {
  marker:'REBUILT_TRIAL_LIVE_SMOKE_PASS',
  sourceSha:clean(process.env.GITHUB_SHA),
  trialSej:{
    preparedAccessVersion:sejPublish.version,
    firstLoginPassed:true,
    homeViews:expectedViews,
    mathsNonVideoResourcesBlocked:true,
    year4VrResourcesVisible:true,
    secondLoginBlocked:true,
    finalUnused:true
  },
  trialEva:{ preparedAccessVersion:evaPublish.version, finalUnused:true },
  passwordsLogged:false
};
fs.writeFileSync('/tmp/rebuilt-trial-live-smoke.json', JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
