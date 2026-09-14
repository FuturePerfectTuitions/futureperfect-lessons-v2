import fs from 'node:fs';

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase().replace(/\s+/g, ' ');
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const worker = clean(process.env.WORKER_NAME || 'fpt-portal-v2-worker');
const targets = ['Y4M24', 'Y4M36'];
if (!token || !account) throw new Error('Cloudflare read-only credentials are required.');

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };
async function request(path, options = {}) {
  const r = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!r.ok || body?.success !== true) throw new Error(`Cloudflare read failed: ${r.status} ${path}`);
  return body;
}
async function kv(ns, key) {
  const r = await fetch(`${base}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`KV read failed: ${r.status} ${key}`);
  return r.json().catch(() => null);
}
const items = raw => Array.isArray(raw) ? raw : Array.isArray(raw?.lessonIds) ? raw.lessonIds : Array.isArray(raw?.lessons) ? raw.lessons : Array.isArray(raw?.items) ? raw.items : [];
const lessonIdOf = x => typeof x === 'string' ? clean(x) : clean(x?.lessonId || x?.id || x?.code);

const settings = (await request(`/accounts/${account}/workers/scripts/${worker}/settings`)).result || {};
const lessonsBinding = (settings.bindings || []).find(x => x.name === 'LESSONS_KV') || {};
const lessonsNs = clean(lessonsBinding.namespace_id);
if (!lessonsNs) throw new Error('Production LESSONS_KV binding unavailable.');

const curriculumCodes = ['MATHS_Y2','MATHS_Y3','MATHS_L1','MATHS_L2','MATHS_L3','MATHS_Y6_EXTRA','ENGLISH_Y2','ENGLISH_Y3','ENGLISH_Y4','ENGLISH_Y5','ENGLISH_Y6'];
const fallback = {
  MATHS_Y2:['maths-year2'], MATHS_Y3:['maths-year3'], MATHS_L1:['maths-year4','maths-level1'],
  MATHS_L2:['maths-year5','maths-level2'], MATHS_L3:['maths-level3','maths-year6'], MATHS_Y6_EXTRA:['maths-year6-extra'],
  ENGLISH_Y2:['english-year2'], ENGLISH_Y3:['english-year3'], ENGLISH_Y4:['english-year4','english-year4-11plus'],
  ENGLISH_Y5:['english-year5','english-year5-11plus'], ENGLISH_Y6:['english-year6']
};

const curricula = {};
const currentIds = new Set();
for (const code of curriculumCodes) {
  let sourceKey = `curriculum:${code}`;
  let raw = await kv(lessonsNs, sourceKey);
  if (!items(raw).length) {
    for (const view of fallback[code] || []) {
      const probeKey = `view:${view}`;
      const probe = await kv(lessonsNs, probeKey);
      if (items(probe).length) { raw = probe; sourceKey = probeKey; break; }
    }
  }
  const ids = items(raw).map(lessonIdOf).filter(Boolean);
  curricula[code] = { sourceKey, lessonIds: ids };
  ids.forEach(id => currentIds.add(id));
}

const currentRecords = [];
for (const id of [...currentIds].sort()) {
  const row = await kv(lessonsNs, `lesson:${id}`);
  if (!row) continue;
  currentRecords.push({
    lessonId: id,
    title: clean(row.title || row.name),
    active: row.active === true,
    lessonCode: clean(row.lessonCode || row.code),
    subject: clean(row.subject),
    year: clean(row.year || row.schoolYear),
    track: clean(row.track || row.stream)
  });
}

const diagnostics = [];
for (const lessonId of targets) {
  const record = await kv(lessonsNs, `lesson:${lessonId}`);
  const memberships = Object.entries(curricula).filter(([,v]) => v.lessonIds.includes(lessonId)).map(([code,v]) => ({ curriculumCode: code, sourceKey: v.sourceKey }));
  const title = clean(record?.title || record?.name);
  const exactTitleMatches = title ? currentRecords.filter(r => r.lessonId !== lessonId && norm(r.title) === norm(title)) : [];
  diagnostics.push({
    lessonId,
    inCurrentCurriculum: memberships.length > 0,
    memberships,
    lessonRecordExists: Boolean(record),
    lessonRecord: record ? {
      title,
      active: record.active === true,
      lessonCode: clean(record.lessonCode || record.code),
      subject: clean(record.subject),
      year: clean(record.year || record.schoolYear),
      track: clean(record.track || record.stream),
      replacedBy: clean(record.replacedBy || record.replacementLessonId || record.redirectTo),
      legacyIds: Array.isArray(record.legacyIds) ? record.legacyIds.map(clean).filter(Boolean) : []
    } : null,
    exactTitleMatchesInCurrentCurriculum: exactTitleMatches
  });
}

const out = {
  marker: 'CP12_ENTITLEMENT_ORPHAN_DIAGNOSTIC',
  generatedAt: new Date().toISOString(),
  readOnly: true,
  worker,
  currentCurriculumLessonCount: currentIds.size,
  targets: diagnostics
};
fs.writeFileSync('/tmp/cp12-entitlement-orphan-diagnostic.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
