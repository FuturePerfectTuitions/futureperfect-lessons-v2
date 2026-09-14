import fs from 'node:fs';

const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const worker = String(process.env.WORKER_NAME || 'fpt-portal-v2-worker').trim();
const asOf = String(process.env.CHECKPOINT8_AS_OF_DATE || '2026-09-14').trim();
if (!token || !account) throw new Error('Cloudflare read-only credentials are required.');

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

async function envelope(path) {
  const response = await fetch(`${base}${path}`, { headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw new Error(`Cloudflare read failed: ${response.status} ${path}`);
  return body;
}
async function kvText(ns, key) {
  const response = await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`KV read failed: ${response.status}`);
  return response.text();
}
async function kvJson(ns, key) {
  const text = await kvText(ns, key);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
async function kvKeys(ns, prefix) {
  const keys = [];
  let cursor = '';
  do {
    const q = new URLSearchParams({ limit: '1000', prefix });
    if (cursor) q.set('cursor', cursor);
    const body = await envelope(`/accounts/${account}/storage/kv/namespaces/${ns}/keys?${q}`);
    keys.push(...(body.result || []).map(item => item.name).filter(Boolean));
    cursor = clean(body.result_info?.cursor);
  } while (cursor);
  return keys;
}

const settings = (await envelope(`/accounts/${account}/workers/scripts/${worker}/settings`)).result || {};
const binding = name => (settings.bindings || []).find(item => item.name === name) || {};
const studentsNs = clean(binding('STUDENTS_KV').namespace_id);
const lessonsNs = clean(binding('LESSONS_KV').namespace_id);
if (!studentsNs || !lessonsNs) throw new Error('Production student/lesson bindings were not resolved.');

const counts = new Map();
let currentProfiles = 0;
let profilesWithSpecialAreas = 0;
for (const key of await kvKeys(studentsNs, 'user:')) {
  const id = norm(key.replace(/^user:/, ''));
  const user = await kvJson(studentsNs, key);
  if (!user) continue;
  const role = norm(user.role || user.accountType);
  if (id === 'admin' || role.includes('admin') || user.isAdmin === true || user.superuser === true) continue;
  const status = norm(user.accountStatus || user.status || 'active');
  const expires = clean(user.expiresOn || user.expires);
  if (['inactive','disabled','expired','withdrawn'].includes(status) || (expires && expires <= asOf)) continue;
  currentProfiles += 1;
  const tokens = [...new Set([
    ...(Array.isArray(user.specialAccess) ? user.specialAccess : []),
    ...(Array.isArray(user?.manualAccess?.specialBuckets) ? user.manualAccess.specialBuckets : [])
  ].map(value => clean(value).toUpperCase()).filter(Boolean))];
  if (tokens.length) profilesWithSpecialAreas += 1;
  for (const special of tokens) counts.set(special, (counts.get(special) || 0) + 1);
}

const areas = [];
for (const [special, profileCount] of [...counts.entries()].sort()) {
  const catalogue = await kvJson(lessonsNs, `special:${special}`);
  const items = Array.isArray(catalogue?.items) ? catalogue.items : [];
  const itemTypes = [...new Set(items.map(item => clean(item?.type || (item?.video ? 'video' : 'item'))).filter(Boolean))].sort();
  const videoItems = items.filter(item => Boolean(item?.video?.screenpal || item?.video?.url || item?.video?.targetUrl)).length;
  const r2Items = items.filter(item => Boolean(item?.r2Key || item?.r2 || item?.objectKey || item?.storageKey)).length;
  areas.push({
    bucketId: special,
    profileCount,
    cataloguePresent: Boolean(catalogue),
    active: catalogue?.active !== false,
    type: clean(catalogue?.type) || null,
    title: clean(catalogue?.title) || null,
    itemCount: items.length,
    itemTypes,
    videoItems,
    r2Items
  });
}

const result = {
  marker: 'CP11_SPECIAL_AREA_TOKEN_INVENTORY_READONLY',
  asOfDate: asOf,
  currentProfiles,
  profilesWithSpecialAreas,
  areaCount: areas.length,
  areas,
  studentIdentitiesIncluded: false,
  productionMutation: false
};
fs.writeFileSync('/tmp/cp11-special-area-token-inventory.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
