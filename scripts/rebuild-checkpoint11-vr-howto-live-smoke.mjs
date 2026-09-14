import crypto from 'node:crypto';
import fs from 'node:fs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const base = clean(process.env.SMOKE_BASE_URL || 'https://lessons.futureperfect.education').replace(/\/$/, '');
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const studentsNs = clean(process.env.EXPECTED_STUDENTS_KV_ID || 'c9723c8806334e4ea54d1b456d31b794');
const asOf = clean(process.env.CHECKPOINT11_AS_OF_DATE || '2026-09-14');
if (!base || !token || !account || !studentsNs) throw new Error('VR How-To live smoke requires the public base and Cloudflare read credentials.');

const apiBase = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };
const origin = new URL(base).origin;
const timing = {};
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
function assert(condition, message) { if (!condition) throw new Error(message); }
function validLogin(value) { return String(value || '').length === 4; }
function currentStudent(id, user) {
  const role = norm(user?.role || user?.accountType);
  if (id === 'admin' || role.includes('admin') || user?.isAdmin === true || user?.superuser === true) return false;
  const status = norm(user?.accountStatus || user?.status || 'active');
  const expires = clean(user?.expiresOn || user?.expires);
  return !['inactive','disabled','expired','withdrawn'].includes(status) && !(expires && expires <= asOf);
}
async function measured(name, fn) {
  const started = performance.now();
  try { return await fn(); }
  finally { timing[name] = Number((performance.now() - started).toFixed(3)); }
}
async function envelope(path) {
  const response = await fetch(`${apiBase}${path}`, { headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw new Error(`Cloudflare read failed: ${response.status} ${path}`);
  return body;
}
async function kvJson(key) {
  const response = await fetch(`${apiBase}/accounts/${account}/storage/kv/namespaces/${studentsNs}/values/${encodeURIComponent(key)}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Student KV read failed: ${response.status}`);
  return response.json().catch(() => null);
}
async function kvKeys(prefix) {
  const keys = []; let cursor = '';
  do {
    const query = new URLSearchParams({ limit:'1000', prefix });
    if (cursor) query.set('cursor', cursor);
    const body = await envelope(`/accounts/${account}/storage/kv/namespaces/${studentsNs}/keys?${query}`);
    keys.push(...(body.result || []).map(row => row.name).filter(Boolean));
    cursor = clean(body.result_info?.cursor);
  } while (cursor);
  return keys;
}
async function responseJson(response, label) {
  const text = await response.text();
  let body = null; try { body = JSON.parse(text); } catch {}
  if (!body) throw new Error(`${label} returned non-JSON HTTP ${response.status}.`);
  return body;
}
function cookiePair(setCookie) {
  const pair = String(setCookie || '').split(';')[0].trim();
  assert(/^fpt_session=/.test(pair), 'VR smoke login did not return the approved session cookie.');
  return pair;
}
async function requestWithCookie(cookie, path, options = {}) {
  return fetch(`${base}${path}`, { redirect:'manual', ...options, headers:{ cookie, ...(options.headers || {}) } });
}

const candidates = [];
for (const key of (await kvKeys('user:')).sort()) {
  const id = norm(key.replace(/^user:/, ''));
  const user = await kvJson(key);
  if (!user || !currentStudent(id, user) || !validLogin(user.p)) continue;
  const manual = new Set((Array.isArray(user?.manualAccess?.specialBuckets) ? user.manualAccess.specialBuckets : []).map(value => clean(value).toUpperCase()));
  if (manual.has('VR_HOWTO')) candidates.push({ id, login:String(user.p) });
}
assert(candidates.length > 0, 'No current VR How-To manual-grant candidate with a usable login was found.');

let selected = null;
for (const candidate of candidates) {
  const loginResponse = await fetch(`${base}/api/v2/auth/login`, {
    method:'POST', redirect:'manual', headers:{ origin, 'content-type':'application/json' },
    body:JSON.stringify({ username:candidate.id, password:candidate.login })
  });
  if (loginResponse.status !== 200) continue;
  const login = await responseJson(loginResponse, 'VR smoke login');
  if (login?.ok !== true || login?.accountLocked === true) continue;
  const cookie = cookiePair(loginResponse.headers.get('set-cookie'));
  const homeResponse = await requestWithCookie(cookie, '/api/v2/student/home');
  if (homeResponse.status !== 200) continue;
  const home = await responseJson(homeResponse, 'VR smoke home');
  const vrView = (Array.isArray(home?.views) ? home.views : []).find(view => clean(view?.viewId) === 'special-vr-howto' && view?.lockedPreview !== true);
  if (!vrView) continue;
  selected = { id:candidate.id, cookie, vrView };
  break;
}
assert(selected, 'No current manual VR How-To student exposed the virtual English VR How-To view after real login.');

const listResponse = await measured('viewListMs', () => requestWithCookie(selected.cookie, '/api/v2/student/views/special-vr-howto/lessons'));
const list = await responseJson(listResponse, 'VR How-To lesson list');
assert(listResponse.status === 200 && list?.ok === true && Array.isArray(list.lessons) && list.lessons.length > 0, 'VR How-To lesson list failed.');
const lesson = list.lessons.find(row => row?.open === true && row?.locked !== true) || list.lessons[0];
assert(clean(lesson?.lessonId), 'VR How-To did not expose a usable guide.');

const detailResponse = await measured('lessonDetailMs', () => requestWithCookie(selected.cookie, `/api/v2/student/lessons/${encodeURIComponent(lesson.lessonId)}?viewId=special-vr-howto`));
const detail = await responseJson(detailResponse, 'VR How-To guide detail');
assert(detailResponse.status === 200 && detail?.ok === true, 'VR How-To guide detail failed.');
const video = (Array.isArray(detail.resources) ? detail.resources : []).find(resource => clean(resource?.type) === 'video');
assert(clean(video?.resourceId), 'VR How-To guide did not expose a View resource.');

const openResponse = await measured('viewOpenMs', () => requestWithCookie(selected.cookie, `/api/v2/student/lessons/${encodeURIComponent(lesson.lessonId)}/resources/${encodeURIComponent(video.resourceId)}/open?viewId=special-vr-howto`));
assert(openResponse.status === 302, 'VR How-To View did not issue an internal capability redirect.');
const capabilityLocation = clean(openResponse.headers.get('location'));
assert(capabilityLocation.startsWith('/api/v2/student/resource?'), 'VR How-To exposed an unexpected pre-capability target.');
assert(!/screenpal\.com/i.test(capabilityLocation), 'ScreenPal was exposed before capability validation.');

const deliveryResponse = await measured('capabilityDeliveryMs', () => requestWithCookie(selected.cookie, capabilityLocation));
assert(deliveryResponse.status === 302, 'VR How-To capability delivery did not redirect to the provider.');
const provider = clean(deliveryResponse.headers.get('location'));
let providerHost = ''; try { providerHost = new URL(provider).hostname.toLowerCase(); } catch {}
assert(providerHost === 'go.screenpal.com', 'VR How-To provider redirect is not the approved ScreenPal host.');

const logoutResponse = await requestWithCookie(selected.cookie, '/api/v2/auth/logout', { method:'POST', headers:{ origin } });
const logout = await responseJson(logoutResponse, 'VR smoke logout');
assert(logoutResponse.status === 200 && logout?.ok === true, 'VR smoke logout failed.');

const summary = {
  marker:'REBUILD_CHECKPOINT11_VR_HOWTO_LIVE_SMOKE_PASS',
  checkpoint:11,
  baseHost:new URL(base).hostname,
  candidateCount:candidates.length,
  selectedStudentDigest:digest(selected.id),
  viewId:'special-vr-howto',
  guideCount:list.lessons.length,
  providerHost,
  providerContactedOnlyAfterView:true,
  credentialsDisclosed:false,
  timingsMs:timing
};
fs.writeFileSync('/tmp/checkpoint11-vr-howto-live-smoke.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
