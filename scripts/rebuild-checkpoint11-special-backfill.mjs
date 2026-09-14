import crypto from 'node:crypto';
import fs from 'node:fs';
import { publishScopeAtomic, resolveCurrentScope } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const worker = clean(process.env.PROD_WORKER || 'fpt-portal-v2-worker');
const shadowKv = clean(process.env.PROD_SHADOW_KV_ID || '77b35165c8694087bc1b0515c35a7e89');
const expectedStudents = clean(process.env.EXPECTED_STUDENTS_KV_ID || 'c9723c8806334e4ea54d1b456d31b794');
const expectedLessons = clean(process.env.EXPECTED_LESSONS_KV_ID || '49619b1a24b244bc8aaa6223fcd24e80');
const asOf = clean(process.env.CHECKPOINT11_AS_OF_DATE || '2026-09-14');
const runTag = clean(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40);
if (!token || !account || !shadowKv) throw new Error('CP11 special backfill requires Cloudflare credentials and shadow KV.');

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null; try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}
async function envelope(path, options = {}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) throw new Error(`Cloudflare request failed: ${out.response.status} ${path}`);
  return out.body;
}
async function kvText(ns, key) {
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);
  if (out.response.status === 404) return null;
  if (!out.response.ok) throw new Error(`KV read failed ${out.response.status}: ${key}`);
  return out.text;
}
async function kvJson(ns, key) {
  const text = await kvText(ns, key);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { throw new Error(`KV JSON invalid: ${key}`); }
}
async function kvKeys(ns, prefix) {
  const keys = []; let cursor = '';
  do {
    const q = new URLSearchParams({ limit:'1000', prefix }); if (cursor) q.set('cursor', cursor);
    const body = await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);
    keys.push(...(body.result || []).map(row => row.name).filter(Boolean));
    cursor = clean(body.result_info?.cursor);
  } while (cursor);
  return keys;
}
function restStore(ns) {
  return {
    async get(key) { return kvText(ns, key); },
    async put(key, value) {
      const out = await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, {
        method:'PUT', headers:{ 'content-type':'application/json; charset=utf-8' }, body:String(value)
      });
      if (!out.response.ok) throw new Error(`KV write failed ${out.response.status}: ${key}`);
    }
  };
}
function currentStudent(id, user) {
  const role = norm(user?.role || user?.accountType);
  if (id === 'admin' || role.includes('admin') || user?.isAdmin === true || user?.superuser === true) return false;
  const status = norm(user?.accountStatus || user?.status || 'active');
  const expires = clean(user?.expiresOn || user?.expires);
  return !['inactive','disabled','expired','withdrawn'].includes(status) && !(expires && expires <= asOf);
}
function screenpalTarget(item) {
  const id = clean(item?.video?.screenpal);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return '';
  return `https://go.screenpal.com/player/${encodeURIComponent(id)}?ff=1&title=0&dcc=0&bg=transparent&embedded=1`;
}

const settings = (await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result || {};
const binding = name => (settings.bindings || []).find(row => row.name === name) || {};
const studentsNs = clean(binding('STUDENTS_KV').namespace_id);
const lessonsNs = clean(binding('LESSONS_KV').namespace_id);
if (studentsNs !== expectedStudents || lessonsNs !== expectedLessons) throw new Error('Production source KV bindings drifted before special backfill.');
if (!(settings.bindings || []).some(row => clean(row.namespace_id) === shadowKv)) throw new Error('CP4 production shadow KV binding is missing.');

const source = await kvJson(lessonsNs, 'special:VR_HOWTO');
if (!source || source.active === false) throw new Error('Live VR_HOWTO catalogue is unavailable.');
const sourceItems = Array.isArray(source.items) ? source.items : [];
const items = sourceItems.map((item, index) => {
  const itemId = clean(item?.id || `item-${index + 1}`);
  const targetUrl = screenpalTarget(item);
  const separator = item?.type === 'separator' || !targetUrl;
  return {
    itemId,
    title: clean(item?.title || `Item ${index + 1}`),
    description: String(item?.description || ''),
    order:index + 1,
    separator,
    ...(targetUrl ? { targetUrl } : {})
  };
});
const playable = items.filter(item => !item.separator && item.targetUrl);
if (!playable.length) throw new Error('Live VR_HOWTO catalogue has no playable items.');

const payload = {
  schemaVersion:1,
  kind:'prepared-special-area',
  bucketId:'VR_HOWTO',
  type:clean(source.type || 'vr-howto'),
  title:clean(source.title || 'VR How To'),
  description:String(source.description || ''),
  sourceRevision:crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex'),
  items
};
const store = restStore(shadowKv);
const published = await publishScopeAtomic(store, {
  scope:'special:VR_HOWTO',
  payload,
  version:`cp11-vr-${payload.sourceRevision.slice(0, 20)}-${runTag}`
});
const resolved = await resolveCurrentScope(store, 'special:VR_HOWTO');
if (resolved.version !== published.version || resolved.payload?.kind !== 'prepared-special-area') throw new Error('VR_HOWTO prepared model did not resolve after publication.');

let manualGrantedCurrent = 0;
let directGrantedCurrent = 0;
for (const key of (await kvKeys(studentsNs, 'user:')).sort()) {
  const id = norm(key.replace(/^user:/, ''));
  const user = await kvJson(studentsNs, key);
  if (!user || !currentStudent(id, user)) continue;
  const manual = new Set((Array.isArray(user?.manualAccess?.specialBuckets) ? user.manualAccess.specialBuckets : []).map(value => clean(value).toUpperCase()));
  const direct = new Set((Array.isArray(user?.specialAccess) ? user.specialAccess : []).map(value => clean(value).toUpperCase()));
  if (manual.has('VR_HOWTO')) manualGrantedCurrent += 1;
  if (direct.has('VR_HOWTO')) directGrantedCurrent += 1;
}
if (manualGrantedCurrent < 1) throw new Error('No current manual VR_HOWTO grants were found.');
const summary = {
  marker:'REBUILD_CHECKPOINT11_VR_HOWTO_BACKFILL_PASS',
  checkpoint:11,
  sourceRevision:payload.sourceRevision,
  catalogue:{ itemCount:items.length, playableItemCount:playable.length, type:payload.type, title:payload.title },
  access:{ manualGrantedCurrent, directGrantedCurrent },
  publication:{ scope:'special:VR_HOWTO', version:published.version, payloadSha256:published.payloadSha256, previousVersion:published.previousVersion },
  sourceMutated:false,
  studentIdentitiesIncluded:false
};
fs.writeFileSync('/tmp/checkpoint11-vr-howto-backfill.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
