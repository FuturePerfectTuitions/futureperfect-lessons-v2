import crypto from 'node:crypto';
import fs from 'node:fs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const base = clean(process.env.SMOKE_BASE_URL || 'https://lessons.futureperfect.education').replace(/\/$/, '');
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const studentsKv = clean(process.env.STUDENTS_KV_ID);
const phase = clean(process.env.SMOKE_PHASE || 'candidate');
const expectedAdminStatus = Number(process.env.EXPECT_ADMIN_STATUS || 200);
const expectedAdminError = clean(process.env.EXPECT_ADMIN_ERROR);
const overrideWorker = clean(process.env.OVERRIDE_WORKER);
const overrideVersion = clean(process.env.OVERRIDE_VERSION);
const output = clean(process.env.SMOKE_OUTPUT || `/tmp/cp12-admin-auth-smoke-${phase}.json`);

if (!base || !account || !token || !studentsKv) throw new Error('CP12 auth smoke requires base URL and protected Cloudflare read credentials.');
if ((overrideWorker && !overrideVersion) || (!overrideWorker && overrideVersion)) throw new Error('Version override worker/version must be supplied together.');

const origin = clean(process.env.SMOKE_ORIGIN || new URL(base).origin);
const cfBase = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const cfHeaders = { Authorization: `Bearer ${token}` };
const timings = {};
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const valid4 = value => { const p = String(value || ''); return p.length === 4 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p); };
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const active = user => {
  const status = norm(user?.status || user?.accountStatus || 'active');
  const expires = clean(user?.expires || user?.expiresOn);
  return !['inactive','disabled','expired','withdrawn'].includes(status) && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || expires >= londonToday());
};
function versionHeaders(extra = {}) {
  const headers = { ...extra };
  if (overrideWorker) headers['Cloudflare-Workers-Version-Overrides'] = `${overrideWorker}="${overrideVersion}"`;
  return headers;
}
async function measured(name, fn) {
  const start = performance.now();
  try { return await fn(); }
  finally { timings[name] = Number((performance.now() - start).toFixed(3)); }
}
async function bodyJson(response, label) {
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!body) throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);
  return body;
}
async function cfJson(path) {
  const response = await fetch(`${cfBase}${path}`, { headers: cfHeaders });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok || body?.success !== true) throw new Error(`Cloudflare protected read failed HTTP ${response.status}.`);
  return body;
}
async function kvUser(userId) {
  const response = await fetch(`${cfBase}/storage/kv/namespaces/${studentsKv}/values/${encodeURIComponent(`user:${norm(userId)}`)}`, { headers: cfHeaders });
  if (!response.ok) return null;
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}
async function userKeys() {
  const body = await cfJson(`/storage/kv/namespaces/${studentsKv}/keys?prefix=${encodeURIComponent('user:')}&limit=1000`);
  return (body.result || []).map(row => clean(row?.name)).filter(Boolean);
}
async function login(userId, password, label) {
  const response = await measured(`${label}LoginMs`, () => fetch(`${base}/api/v2/auth/login`, {
    method:'POST', redirect:'manual',
    headers:versionHeaders({ origin, 'content-type':'application/json' }),
    body:JSON.stringify({ username:userId, password:String(password) })
  }));
  const body = await bodyJson(response, `${label} login`);
  return { response, body };
}
function cookiePair(response) {
  const raw = response.headers.get('set-cookie') || '';
  const pair = raw.split(';')[0].trim();
  if (!/^fpt_session=/.test(pair)) throw new Error('Authenticated response did not issue the expected session cookie.');
  return pair;
}
async function authGet(path, cookie, label) {
  const response = await measured(`${label}Ms`, () => fetch(`${base}${path}`, { redirect:'manual', headers:versionHeaders({ cookie }) }));
  const body = await bodyJson(response, label);
  return { response, body };
}

const admin = await kvUser('admin');
if (!admin || !valid4(admin.p)) throw new Error('Protected Admin credential record is unavailable or malformed.');
const adminAttempt = await login('admin', admin.p, 'admin');
if (adminAttempt.response.status !== expectedAdminStatus) throw new Error(`Admin login expected HTTP ${expectedAdminStatus}, got ${adminAttempt.response.status}.`);
if (expectedAdminStatus !== 200) {
  if (expectedAdminError && clean(adminAttempt.body?.error) !== expectedAdminError) throw new Error(`Admin baseline error mismatch: ${clean(adminAttempt.body?.error)}`);
  const summary = {
    marker:'REBUILD_CP12_ADMIN_INCIDENT_AUTH_SMOKE_PASS', phase, baseHost:new URL(base).hostname,
    versionOverride:Boolean(overrideWorker), expectedAdminFailure:true,
    admin:{ status:adminAttempt.response.status, error:clean(adminAttempt.body?.error), credentialDisclosed:false },
    timingsMs:timings
  };
  fs.writeFileSync(output, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
if (adminAttempt.body?.ok !== true || adminAttempt.body?.principal !== 'admin') throw new Error('Admin candidate login did not return signed Admin principal semantics.');
const adminCookie = cookiePair(adminAttempt.response);
const adminHome = await authGet('/api/v2/student/home', adminCookie, 'adminHome');
if (adminHome.response.status !== 200 || adminHome.body?.ok !== true || adminHome.body?.role !== 'admin' || !Array.isArray(adminHome.body?.views) || !adminHome.body.views.length) throw new Error('Admin Home smoke failed.');
const mathsView = adminHome.body.views.find(view => norm(view?.subject) === 'maths' && (/year6|level3/i.test(clean(view?.viewId)) || /year\s*6|level\s*3/i.test(clean(view?.label)))) || adminHome.body.views.find(view => norm(view?.subject) === 'maths');
if (!mathsView?.viewId) throw new Error('Admin Home did not expose a Maths view.');
const adminSubject = await authGet('/api/v2/student/subjects/maths', adminCookie, 'adminSubject');
if (adminSubject.response.status !== 200 || adminSubject.body?.ok !== true || !(adminSubject.body.views || []).some(view => clean(view?.viewId) === clean(mathsView.viewId))) throw new Error('Admin Maths subject smoke failed.');
const adminView = await authGet(`/api/v2/student/views/${encodeURIComponent(mathsView.viewId)}/lessons`, adminCookie, 'adminView');
if (adminView.response.status !== 200 || adminView.body?.ok !== true || !Array.isArray(adminView.body?.lessons) || !adminView.body.lessons.length) throw new Error('Admin Year/Level smoke failed.');
const adminLessonRow = adminView.body.lessons.find(row => row?.open === true && row?.locked === false) || adminView.body.lessons[0];
const adminLesson = await authGet(`/api/v2/student/lessons/${encodeURIComponent(adminLessonRow.lessonId)}?viewId=${encodeURIComponent(mathsView.viewId)}`, adminCookie, 'adminLesson');
if (adminLesson.response.status !== 200 || adminLesson.body?.ok !== true || adminLesson.body?.resourcesIncluded !== true) throw new Error('Admin lesson-detail smoke failed.');

let studentResult = null;
for (const key of await userKeys()) {
  const id = norm(key.replace(/^user:/, ''));
  if (!id || id === 'admin') continue;
  const user = await kvUser(id);
  if (!user || !active(user) || !valid4(user.p)) continue;
  const attempt = await login(id, user.p, 'student');
  if (attempt.response.status !== 200 || attempt.body?.ok !== true || attempt.body?.accountLocked === true) continue;
  const cookie = cookiePair(attempt.response);
  const home = await authGet('/api/v2/student/home', cookie, 'studentHome');
  if (home.response.status !== 200 || home.body?.ok !== true || !Array.isArray(home.body?.views) || !home.body.views.length) continue;
  const openView = home.body.views.find(view => view?.lockedPreview !== true);
  if (!openView?.viewId) continue;
  const view = await authGet(`/api/v2/student/views/${encodeURIComponent(openView.viewId)}/lessons`, cookie, 'studentView');
  if (view.response.status !== 200 || view.body?.ok !== true) continue;
  studentResult = { digest:digest(id), homeViewCount:home.body.views.length, viewIdDigest:digest(openView.viewId), credentialDisclosed:false };
  break;
}
if (!studentResult) throw new Error('No representative current student completed login/Home/navigation smoke.');

const summary = {
  marker:'REBUILD_CP12_ADMIN_INCIDENT_AUTH_SMOKE_PASS', phase, baseHost:new URL(base).hostname,
  versionOverride:Boolean(overrideWorker), expectedAdminFailure:false,
  admin:{ login:true, home:true, mathsSubject:true, yearOrLevel:true, lesson:true, viewCount:adminHome.body.views.length, resourceCount:Array.isArray(adminLesson.body?.resources)?adminLesson.body.resources.length:0, credentialDisclosed:false },
  student:studentResult,
  security:{ passwordsLogged:false, cookiesLogged:false, protectedReadsOnly:true },
  timingsMs:timings
};
fs.writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
