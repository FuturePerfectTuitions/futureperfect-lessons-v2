import fs from 'node:fs';
import { compileGlobalScope, compileAccessScope, globalToCatalogue } from '../rebuild/adminops/src/lib/compiler.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';
import { stableStringify, pointerKey, versionKey } from '../rebuild/adminops/src/lib/atomic-publisher.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const token = clean(process.env.CLOUDFLARE_API_TOKEN);
const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const opsWorker = clean(process.env.WORKER_NAME || 'fpt-portal-v2-worker');
const studentWorker = clean(process.env.STUDENT_WORKER_NAME || 'rebuild-student-v2-production');
const browserWorker = clean(process.env.BROWSER_WORKER_NAME || 'fpt-lessons-v2-browser-production');
const asOf = clean(process.env.CHECKPOINT8_AS_OF_DATE || '2026-09-14');
const aylaId = norm(process.env.AYLA_PORTAL_ID || 'Ayla0108');
const reinaId = norm(process.env.REINA_PORTAL_ID || 'Rei0710');
if (!token || !account) throw new Error('Cloudflare read-only credentials are required.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('A deterministic audit date is required.');

const base = 'https://api.cloudflare.com/client/v4';
const headers = { Authorization: `Bearer ${token}` };
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { response, text, body };
}
async function envelope(path, options = {}) {
  const out = await request(path, options);
  if (!out.response.ok || out.body?.success !== true) throw new Error(`Cloudflare read failed: ${out.response.status} ${path}`);
  return out.body;
}
async function workerSettings(name) {
  return (await envelope(`/accounts/${account}/workers/scripts/${name}/settings`)).result || {};
}
function binding(settings, name) {
  return (settings?.bindings || []).find(item => item.name === name) || {};
}
async function kvText(ns, key) {
  const out = await request(`/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`);
  if (out.response.status === 404) return null;
  if (!out.response.ok) throw new Error(`KV read failed: ${out.response.status} ${key}`);
  return out.text;
}
async function kvJson(ns, key) {
  const text = await kvText(ns, key);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { throw new Error(`KV JSON invalid: ${key}`); }
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
async function d1Query(db, sql) {
  if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw new Error('CP12 population audit permits read-only D1 statements only.');
  const body = await envelope(`/accounts/${account}/d1/database/${db}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql })
  });
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  return Array.isArray(first?.results) ? first.results : [];
}
async function mapLimit(values, limit, fn) {
  const out = new Array(values.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      out[index] = await fn(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length || 1) }, runner));
  return out;
}

const [opsSettings, studentSettings, browserSettings] = await Promise.all([
  workerSettings(opsWorker), workerSettings(studentWorker), workerSettings(browserWorker)
]);
const envText = clean(binding(opsSettings, 'ENVIRONMENT').text);
if (envText && envText !== 'production') throw new Error(`Operations Worker is not production: ${envText}`);
const studentsNs = clean(binding(opsSettings, 'STUDENTS_KV').namespace_id);
const lessonsNs = clean(binding(opsSettings, 'LESSONS_KV').namespace_id);
const dbId = clean(binding(opsSettings, 'DB').database_id || binding(opsSettings, 'DB').id);
const readModelsNs = clean(binding(studentSettings, 'READ_MODELS_KV').namespace_id);
const browserStudent = clean(binding(browserSettings, 'STAGING_API').service || binding(browserSettings, 'STUDENT_API').service);
if (!studentsNs || !lessonsNs || !dbId || !readModelsNs) throw new Error('Required production source/read-model bindings could not be resolved.');
if (browserStudent && browserStudent !== studentWorker) throw new Error(`Canonical Browser→Student binding drifted: ${browserStudent}`);

const scopeSecret = clean(await kvText(readModelsNs, 'meta:scope-salt'));
if (!/^[0-9a-f]{64}$/i.test(scopeSecret)) throw new Error('Production read-model scope salt is missing or malformed.');

const curriculumCodes = ['MATHS_Y2','MATHS_Y3','MATHS_L1','MATHS_L2','MATHS_L3','MATHS_Y6_EXTRA','ENGLISH_Y2','ENGLISH_Y3','ENGLISH_Y4','ENGLISH_Y5','ENGLISH_Y6'];
const fallback = {
  MATHS_Y2:['maths-year2'], MATHS_Y3:['maths-year3'], MATHS_L1:['maths-year4','maths-level1'],
  MATHS_L2:['maths-year5','maths-level2'], MATHS_L3:['maths-level3','maths-year6'], MATHS_Y6_EXTRA:['maths-year6-extra'],
  ENGLISH_Y2:['english-year2'], ENGLISH_Y3:['english-year3'], ENGLISH_Y4:['english-year4','english-year4-11plus'],
  ENGLISH_Y5:['english-year5','english-year5-11plus'], ENGLISH_Y6:['english-year6']
};
const items = raw => Array.isArray(raw) ? raw : Array.isArray(raw?.lessonIds) ? raw.lessonIds : Array.isArray(raw?.lessons) ? raw.lessons : Array.isArray(raw?.items) ? raw.items : [];
const curricula = {}, lessonIds = new Set();
for (const code of curriculumCodes) {
  let raw = await kvJson(lessonsNs, `curriculum:${code}`);
  if (!items(raw).length) {
    for (const view of fallback[code] || []) {
      const probe = await kvJson(lessonsNs, `view:${view}`);
      if (items(probe).length) { raw = probe; break; }
    }
  }
  const rows = items(raw);
  if (!rows.length) throw new Error(`Required curriculum missing: ${code}`);
  curricula[code] = { lessonIds: rows.map(row => typeof row === 'string' ? clean(row) : clean(row?.lessonId)).filter(Boolean) };
  for (const id of curricula[code].lessonIds) lessonIds.add(id);
}
const lessonPairs = await mapLimit([...lessonIds].sort(), 24, async id => [id, await kvJson(lessonsNs, `lesson:${id}`)]);
const lessons = Object.fromEntries(lessonPairs.filter(([, row]) => row));
if (Object.keys(lessons).length !== lessonIds.size) throw new Error('One or more live curriculum lesson records are missing.');
const global = compileGlobalScope({ sourceType:'production-authoritative-cp12-audit', sourceRevision:`cp12-${asOf}`, curricula, lessons }, { sourceType:'production-authoritative-cp12-audit', sourceRevision:`cp12-${asOf}` });
const catalogue = globalToCatalogue(global);

const [definitions, assignments, entitlements, preLesson] = await Promise.all([
  d1Query(dbId, 'SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions'),
  d1Query(dbId, 'SELECT a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to, b.subject, b.school_year, b.stream, b.maths_level, b.active_from AS batch_active_from, b.active_to AS batch_active_to FROM student_batch_assignments a JOIN batch_definitions b ON b.batch_key = a.batch_key'),
  d1Query(dbId, 'SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source, first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date FROM lesson_entitlements'),
  d1Query(dbId, 'SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, first_granted_at FROM online_prelesson_entitlements')
]);
const group = rows => {
  const map = new Map();
  for (const row of rows) {
    const key = norm(row?.portal_user_id_norm);
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
};
const byAssignments = group(assignments), byEntitlements = group(entitlements), byPre = group(preLesson);

function currentStudent(id, user) {
  const role = norm(user?.role || user?.accountType);
  if (id === 'admin' || role.includes('admin') || user?.isAdmin === true || user?.superuser === true) return false;
  const status = norm(user?.accountStatus || user?.status || 'active');
  const expires = clean(user?.expiresOn || user?.expires);
  return !['inactive','disabled','expired','withdrawn'].includes(status) && (!expires || expires > asOf);
}
function accessState(snapshot, lessonId) {
  const row = snapshot?.lessonAccess?.[lessonId];
  if (!row) return 'LOCKED';
  if (row.blocked) return 'BLOCKED';
  if (row.core) return 'FULL';
  if (row.preLessonOnly) return 'PRELESSON_ONLY';
  if (row.vr) return 'VR_ONLY';
  return 'LOCKED';
}
function viewMap(snapshot) {
  return Object.fromEntries((snapshot?.views || []).map(row => [row.viewId, {
    current: row.current === true,
    group: row.group,
    lockedPreview: row.lockedPreview === true,
    openLessonCount: Number(row.openLessonCount || 0),
    visibleLessonCount: Number(row.visibleLessonCount || 0)
  }]));
}
function lessonDiff(expected, actual) {
  const e = expected?.lessonAccess || {}, a = actual?.lessonAccess || {};
  const ids = new Set([...Object.keys(e), ...Object.keys(a)]);
  const out = [];
  for (const id of [...ids].sort()) {
    const es = accessState(expected, id), as = accessState(actual, id);
    const evr = e[id]?.vr === true, avr = a[id]?.vr === true;
    if (es !== as || evr !== avr) out.push({ lessonId:id, expected:es, published:as, expectedVr:evr, publishedVr:avr });
  }
  return out;
}
function findLessonCandidates() {
  const target = 'transitioning from year 3 to year 4';
  const found = [];
  for (const [id, row] of Object.entries(lessons)) {
    const title = norm(row?.title);
    if (id.toUpperCase() === 'Y4T1E01' || id.toUpperCase() === 'Y4E1' || title.includes(target)) found.push({ lessonId:id, title:clean(row?.title) });
  }
  return found;
}

const targetLessonCandidates = findLessonCandidates();
const userKeys = (await kvKeys(studentsNs, 'user:')).sort();
const students = [];
let excludedAdmin = 0, excludedInactive = 0;
for (const key of userKeys) {
  const id = norm(key.replace(/^user:/, ''));
  const user = await kvJson(studentsNs, key);
  if (!user) continue;
  const role = norm(user?.role || user?.accountType);
  if (id === 'admin' || role.includes('admin') || user?.isAdmin === true || user?.superuser === true) { excludedAdmin++; continue; }
  if (!currentStudent(id, user)) { excludedInactive++; continue; }

  const userAssignments = byAssignments.get(id) || [];
  const userEntitlements = byEntitlements.get(id) || [];
  const userPre = byPre.get(id) || [];
  const scopeId = await opaqueAccessScopeId(id, scopeSecret);
  const input = { asOfDate:asOf, user, batchDefinitions:definitions, batchAssignments:userAssignments, entitlements:userEntitlements, onlinePreLessonEntitlements:userPre };
  const expectedModel = compileAccessScope(input, catalogue, { scopeId, asOfDate:asOf });
  const scope = `access:${scopeId}`;
  const pointer = await kvJson(readModelsNs, pointerKey(scope));
  let publishedModel = null, pointerProblem = null;
  if (!pointer?.current?.version) {
    pointerProblem = 'MISSING_CURRENT_POINTER';
  } else {
    const envelope = await kvJson(readModelsNs, versionKey(scope, pointer.current.version));
    if (!envelope?.payload) pointerProblem = 'MISSING_CURRENT_ENVELOPE';
    else publishedModel = envelope.payload;
  }
  const expectedSnapshot = expectedModel.snapshot;
  const publishedSnapshot = publishedModel?.snapshot || null;
  const exactMatch = Boolean(publishedModel) && stableStringify(expectedModel) === stableStringify(publishedModel);
  const differences = publishedSnapshot ? lessonDiff(expectedSnapshot, publishedSnapshot) : Object.keys(expectedSnapshot?.lessonAccess || {}).map(lessonId => ({ lessonId, expected:accessState(expectedSnapshot, lessonId), published:'MISSING_SNAPSHOT' }));
  const expectedViews = viewMap(expectedSnapshot), publishedViews = viewMap(publishedSnapshot);
  const missingViews = Object.keys(expectedViews).filter(view => !(view in publishedViews));
  const extraViews = Object.keys(publishedViews).filter(view => !(view in expectedViews));
  const changedViews = Object.keys(expectedViews).filter(view => view in publishedViews && stableStringify(expectedViews[view]) !== stableStringify(publishedViews[view]));
  const targetStates = Object.fromEntries(targetLessonCandidates.map(row => [row.lessonId, { expected:accessState(expectedSnapshot,row.lessonId), published:publishedSnapshot ? accessState(publishedSnapshot,row.lessonId) : 'MISSING_SNAPSHOT' }]));

  students.push({
    portalUserId: id,
    firstName: clean(user?.firstName || user?.name),
    status: exactMatch && !pointerProblem ? 'MATCH' : 'MISMATCH',
    pointerProblem,
    assignments: userAssignments.map(row => ({ batchKey:clean(row.batch_key), effectiveFrom:clean(row.effective_from), effectiveTo:clean(row.effective_to), subject:clean(row.subject), schoolYear:row.school_year, stream:clean(row.stream), mathsLevel:row.maths_level })),
    sourceEntitlements: userEntitlements.map(row => ({ lessonId:clean(row.lesson_id), coreAccess:Number(row.core_access || 0), vrAccess:Number(row.vr_access || 0), source:clean(row.source), sourceBatchCode:clean(row.source_batch_code), sourceLessonDate:clean(row.source_lesson_date) })),
    onlinePreLessonEntitlements: userPre.map(row => ({ lessonId:clean(row.lesson_id), batchKey:clean(row.batch_key), lessonDate:clean(row.lesson_date) })),
    expectedViews,
    publishedViews,
    missingViews,
    extraViews,
    changedViews,
    lessonDifferences: differences,
    targetLessonStates: targetStates,
    expectedAccessCount: Object.keys(expectedSnapshot?.lessonAccess || {}).length,
    publishedAccessCount: Object.keys(publishedSnapshot?.lessonAccess || {}).length
  });
}

const mismatches = students.filter(row => row.status === 'MISMATCH');
const ayla = students.find(row => row.portalUserId === aylaId) || null;
const reina = students.find(row => row.portalUserId === reinaId) || null;
const report = {
  marker: 'CP12_ENTITLEMENT_POPULATION_SOURCE_VS_PUBLISHED_AUDIT',
  generatedAt: new Date().toISOString(),
  asOfDate: asOf,
  readOnly: true,
  topology: { opsWorker, studentWorker, browserWorker, browserStudent: browserStudent || null },
  counts: { profileKeys:userKeys.length, currentStudents:students.length, excludedAdmin, excludedInactive, mismatchedStudents:mismatches.length, sourceEntitlementRows:entitlements.length, onlinePreLessonRows:preLesson.length, batchAssignments:assignments.length },
  targetLessonCandidates,
  ayla: ayla ? { portalUserId:ayla.portalUserId, status:ayla.status, targetLessonStates:ayla.targetLessonStates, missingViews:ayla.missingViews, changedViews:ayla.changedViews, lessonDifferences:ayla.lessonDifferences } : null,
  reina: reina ? { portalUserId:reina.portalUserId, status:reina.status, y5m1:reina.targetLessonStates?.Y5M1 || null, lessonDifferences:reina.lessonDifferences } : null,
  mismatchIds: mismatches.map(row => row.portalUserId),
  students
};
fs.writeFileSync('/tmp/cp12-entitlement-population-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ marker:report.marker, asOfDate:asOf, counts:report.counts, targetLessonCandidates, ayla:report.ayla, mismatchIds:report.mismatchIds }, null, 2));
if (!ayla) throw new Error('Ayla0108 is not present as a current production profile.');
