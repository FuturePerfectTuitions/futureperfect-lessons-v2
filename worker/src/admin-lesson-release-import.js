import { processItem as processFullItem } from './index-phase13.js';

const LOGIN_PATH = '/api/v1/admin/lesson-releases/login';
const PREVIEW_PATH = '/api/v1/admin/lesson-releases/preview';
const CONFIRM_PATH = '/api/v1/admin/lesson-releases/confirm';
const MAX_ROWS = 1000;
const SESSION_SECONDS = 30 * 60;

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const onlineBatch = value => clean(value).toUpperCase().includes('O');
const elevenPlusBatch = value => /^Y[45]11/i.test(clean(value));

function json(body, status = 200, request = null, env = null) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  const origin = request?.headers?.get('Origin') || '';
  if (origin && allowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'content-type, authorization');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigin(origin, env) {
  const configured = clean(env?.ALLOWED_ORIGINS)
    .split(',').map(v => v.trim()).filter(Boolean);
  return !origin || configured.includes(origin);
}

function canonicalLessonId(value) {
  const raw = clean(value);
  const match = raw.match(/^Y6MS([1-9]|1[0-9])$/i);
  return match ? `Y6M${50 + Number(match[1])}` : raw;
}

function extractLessonId(value) {
  const first = clean(value).split(/\s+/)[0] || '';
  return canonicalLessonId(first.replace(/^["']|["',;:]$/g, ''));
}

function isoDate(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function parseLessonDate(value) {
  const text = clean(value);
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(m[1], m[2], m[3]);
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return isoDate(m[3], m[2], m[1]);
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (m) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const month = months.indexOf(m[2].toLowerCase()) + 1;
    return month ? isoDate(m[3], month, m[1]) : '';
  }
  return '';
}

function rowValue(row, name) {
  if (!row || typeof row !== 'object') return '';
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(row)) if (clean(key).toLowerCase() === wanted) return clean(value);
  return '';
}

function sourceRowId(row, index) {
  return `csv-${index + 2}-${norm(rowValue(row, 'Student'))}-${extractLessonId(rowValue(row, 'Lesson')).toLowerCase()}`.slice(0, 160);
}

function normaliseCsvRow(row, index) {
  const portalUserId = rowValue(row, 'Student');
  const batchKey = rowValue(row, 'Mode');
  const lessonId = extractLessonId(rowValue(row, 'Lesson'));
  const lessonDate = parseLessonDate(rowValue(row, 'LessonDated'));
  const lessonStatus = rowValue(row, 'LessonStatus');
  const completed = /\bcompleted\b/i.test(lessonStatus);
  const releaseType = completed ? 'FULL' : (onlineBatch(batchKey) ? 'PRELESSON_ONLY' : 'SKIP');
  return {
    index,
    syncRowId: sourceRowId(row, index),
    portalUserId,
    portalUserIdNorm: norm(portalUserId),
    batchKey,
    lessonId,
    lessonDate,
    releaseType,
    lessonStatus,
    name: rowValue(row, 'Name'),
    subjectFromCsv: rowValue(row, 'Subject'),
    lessonLabel: rowValue(row, 'Lesson')
  };
}

function shapeError(item) {
  if (!item.portalUserId) return ['INVALID_PORTAL_USER_ID', 'Student column is empty.'];
  if (!item.batchKey) return ['INVALID_BATCH_KEY', 'Mode column is empty.'];
  if (!item.lessonId) return ['INVALID_LESSON_ID', 'Lesson column does not start with a lesson ID.'];
  if (!item.lessonDate) return ['INVALID_LESSON_DATE', 'LessonDated could not be parsed.'];
  return null;
}

function batchActiveOnDate(batch, lessonDate) {
  const from = clean(batch?.active_from), to = clean(batch?.active_to);
  return (!from || lessonDate >= from) && (!to || lessonDate < to);
}

function isBlocked(student, lessonId) {
  return new Set(Array.isArray(student?.blockedLessons) ? student.blockedLessons.map(String) : []).has(lessonId);
}

async function validatePortalState(env, item) {
  const [student, lesson, batch] = await Promise.all([
    env.STUDENTS_KV.get(`user:${item.portalUserIdNorm}`, { type: 'json' }),
    env.LESSONS_KV.get(`lesson:${item.lessonId}`, { type: 'json' }),
    env.DB.prepare(`SELECT batch_key, subject, school_year, stream, maths_level, active_from, active_to FROM batch_definitions WHERE batch_key = ?`).bind(item.batchKey).first()
  ]);
  if (!student) return { error: 'STUDENT_NOT_FOUND', message: 'Portal student does not exist.' };
  if (!lesson || clean(lesson.lessonId) !== item.lessonId || lesson.active === false) return { error: 'LESSON_NOT_FOUND', message: 'Lesson ID does not resolve to an active V2 lesson.' };
  const subject = norm(lesson.subject);
  if (!['maths','english'].includes(subject)) return { error: 'INVALID_LESSON_SUBJECT', message: 'Lesson subject is not a normal Maths/English entitlement subject.' };
  if (!batch) return { error: 'BATCH_NOT_FOUND', message: 'Exact batch key is not configured in V2.' };
  if (norm(batch.subject) !== subject) return { error: 'BATCH_SUBJECT_MISMATCH', message: 'Batch subject does not match the lesson subject.' };
  if (!batchActiveOnDate(batch, item.lessonDate)) return { error: 'BATCH_INACTIVE_ON_LESSON_DATE', message: 'Batch is not active on the lesson date.' };
  const assigned = await env.DB.prepare(`SELECT assignment_id FROM student_batch_assignments WHERE portal_user_id_norm = ? AND batch_key = ? AND effective_from <= ? AND (effective_to IS NULL OR ? < effective_to) ORDER BY effective_from DESC, assignment_id DESC LIMIT 1`).bind(item.portalUserIdNorm, item.batchKey, item.lessonDate, item.lessonDate).first();
  if (!assigned) return { error: 'NOT_ASSIGNED_ON_LESSON_DATE', message: 'Student is not effectively assigned to this batch on the lesson date.' };
  if (isBlocked(student, item.lessonId)) return { error: 'BLOCKED', message: 'Lesson is blocked for this student.' };
  if (item.releaseType === 'PRELESSON_ONLY' && !onlineBatch(item.batchKey)) return { error: 'PRELESSON_ONLINE_BATCH_REQUIRED', message: 'PreLesson-only access requires an Online batch.' };
  return { student, lesson, batch, subject };
}

async function existingAccess(env, item) {
  const [full, pre] = await Promise.all([
    env.DB.prepare(`SELECT core_access FROM lesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(item.portalUserIdNorm, item.lessonId).first(),
    env.DB.prepare(`SELECT batch_key FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ? LIMIT 1`).bind(item.portalUserIdNorm, item.lessonId).first()
  ]);
  return { full: Number(full?.core_access) === 1, pre: Boolean(pre) };
}

async function previewRows(env, rows) {
  const normalized = rows.map(normaliseCsvRow);
  const results = [];
  const seen = new Set();
  for (const item of normalized) {
    const key = `${item.portalUserIdNorm}|${item.lessonId}|${item.batchKey}|${item.releaseType}`;
    if (seen.has(key)) {
      results.push({ ...item, ok: true, action: 'SKIP_DUPLICATE', message: 'Duplicate CSV row; no second action will be applied.' });
      continue;
    }
    seen.add(key);
    const shape = shapeError(item);
    if (shape) {
      results.push({ ...item, ok: false, action: shape[0], message: shape[1] });
      continue;
    }
    if (item.releaseType === 'SKIP') {
      results.push({ ...item, ok: true, action: 'NO_RELEASE', message: 'Face-to-face lesson is not Completed, so nothing will be released.' });
      continue;
    }
    const validation = await validatePortalState(env, item);
    if (validation.error) {
      results.push({ ...item, ok: false, action: validation.error, message: validation.message });
      continue;
    }
    const access = await existingAccess(env, item);
    let action = item.releaseType === 'FULL' ? 'GRANT_FULL' : 'GRANT_PRELESSON';
    let message = item.releaseType === 'FULL' ? 'Full lesson access will be granted.' : 'Only PreLesson Sheets will be granted.';
    if (access.full) { action = 'ALREADY_FULL'; message = 'Full access already exists; no downgrade will occur.'; }
    else if (item.releaseType === 'FULL' && access.pre) { action = 'UPGRADE_TO_FULL'; message = 'Existing PreLesson-only access will be upgraded to full access.'; }
    else if (item.releaseType === 'PRELESSON_ONLY' && access.pre) { action = 'ALREADY_PRELESSON'; message = 'PreLesson-only access already exists; import is idempotent.'; }
    results.push({ ...item, ok: true, action, message });
  }
  return results;
}

function applyCandidates(results) {
  return results.filter(r => r.ok && ['GRANT_FULL','GRANT_PRELESSON','UPGRADE_TO_FULL','ALREADY_FULL','ALREADY_PRELESSON'].includes(r.action));
}

async function grantPrelesson(env, item, validation) {
  const access = await existingAccess(env, item);
  if (access.full) {
    await env.DB.prepare(`DELETE FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(item.portalUserIdNorm, item.lessonId).run();
    return { ok: true, status: 'ALREADY_FULL', accessMode: 'full' };
  }
  const now = new Date().toISOString();
  const vrAccess = validation.subject === 'english' && elevenPlusBatch(item.batchKey) && validation.student?.vrEligible === true ? 1 : 0;
  await env.DB.prepare(`INSERT INTO online_prelesson_entitlements (portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access, source_row_id, first_granted_at, last_confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(portal_user_id_norm, lesson_id, batch_key) DO UPDATE SET lesson_date = excluded.lesson_date, vr_access = excluded.vr_access, source_row_id = excluded.source_row_id, last_confirmed_at = excluded.last_confirmed_at`).bind(item.portalUserIdNorm, item.lessonId, item.batchKey, item.lessonDate, vrAccess, item.syncRowId, now, now).run();
  return { ok: true, status: access.pre ? 'CONFIRMED' : 'CREATED', accessMode: 'prelesson' };
}

async function applyItem(env, item) {
  const validation = await validatePortalState(env, item);
  if (validation.error) return { ...item, ok: false, status: validation.error, message: validation.message };
  if (item.releaseType === 'PRELESSON_ONLY') {
    const result = await grantPrelesson(env, item, validation);
    return { ...item, ...result };
  }
  const result = await processFullItem(env, {
    syncRowId: item.syncRowId,
    operation: 'grant',
    portalUserId: item.portalUserId,
    lessonId: item.lessonId,
    batchKey: item.batchKey,
    lessonDate: item.lessonDate
  });
  if (result.ok) await env.DB.prepare(`DELETE FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(item.portalUserIdNorm, item.lessonId).run();
  return { ...item, ...result, releaseType: 'FULL' };
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64UrlToText(value) {
  const base64 = value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(base64);
}
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}
async function timingSafeTextEqual(a, b) {
  const aa = new TextEncoder().encode(String(a)), bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0; for (let i=0;i<aa.length;i++) diff |= aa[i]^bb[i]; return diff === 0;
}
async function issueSession(env) {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now()/1000)+SESSION_SECONDS, scope:'lesson-release-import' })));
  return `${payload}.${await hmac(String(env.ADMIN_IMPORT_SESSION_SECRET), payload)}`;
}
async function sessionAuthorised(request, env) {
  const match = clean(request.headers.get('Authorization')).match(/^Bearer\s+(.+)$/i);
  if (!match || !env?.ADMIN_IMPORT_SESSION_SECRET) return false;
  const parts = match[1].split('.'); if (parts.length !== 2) return false;
  const expected = await hmac(String(env.ADMIN_IMPORT_SESSION_SECRET), parts[0]);
  if (!(await timingSafeTextEqual(parts[1], expected))) return false;
  try {
    const payload = JSON.parse(base64UrlToText(parts[0]));
    return payload.scope === 'lesson-release-import' && Number(payload.exp) >= Math.floor(Date.now()/1000);
  } catch { return false; }
}
async function passwordMatches(supplied, env) {
  const configured = String(env?.ADMIN_IMPORT_PASSWORD || '');
  return Boolean(configured && supplied && await timingSafeTextEqual(await hmac(configured, supplied), await hmac(configured, configured)));
}

function configured(env) {
  return Boolean(env?.STUDENTS_KV && env?.LESSONS_KV && env?.DB && env?.ADMIN_IMPORT_PASSWORD && env?.ADMIN_IMPORT_SESSION_SECRET);
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function handleLogin(request, env) {
  if (!configured(env)) return json({ ok:false, error:'ADMIN_IMPORT_NOT_CONFIGURED' }, 503, request, env);
  const body = await readJson(request);
  if (!body || !(await passwordMatches(clean(body.password), env))) return json({ ok:false, error:'UNAUTHORISED' }, 401, request, env);
  return json({ ok:true, token: await issueSession(env), expiresIn: SESSION_SECONDS }, 200, request, env);
}

async function handlePreview(request, env) {
  if (!(await sessionAuthorised(request, env))) return json({ ok:false, error:'UNAUTHORISED' }, 401, request, env);
  const body = await readJson(request);
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return json({ ok:false, error:'ROWS_REQUIRED' }, 400, request, env);
  if (body.rows.length > MAX_ROWS) return json({ ok:false, error:'TOO_MANY_ROWS', maxRows:MAX_ROWS }, 413, request, env);
  const results = await previewRows(env, body.rows);
  const candidates = applyCandidates(results);
  return json({ ok:true, results, summary:{ total:results.length, releasable:candidates.length, skipped:results.filter(r=>r.action==='NO_RELEASE'||r.action==='SKIP_DUPLICATE').length, errors:results.filter(r=>!r.ok).length } }, 200, request, env);
}

async function handleConfirm(request, env) {
  if (!(await sessionAuthorised(request, env))) return json({ ok:false, error:'UNAUTHORISED' }, 401, request, env);
  const body = await readJson(request);
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return json({ ok:false, error:'ROWS_REQUIRED' }, 400, request, env);
  if (body.rows.length > MAX_ROWS) return json({ ok:false, error:'TOO_MANY_ROWS', maxRows:MAX_ROWS }, 413, request, env);
  const preview = await previewRows(env, body.rows);
  if (preview.some(r => !r.ok)) return json({ ok:false, error:'VALIDATION_FAILED', results:preview }, 409, request, env);
  const candidates = applyCandidates(preview);
  const results = [];
  for (const item of candidates) results.push(await applyItem(env, item));
  return json({ ok:true, results, summary:{ total:results.length, succeeded:results.filter(r=>r.ok).length, failed:results.filter(r=>!r.ok).length } }, 200, request, env);
}

export async function handleAdminLessonReleaseImport(request, env) {
  const url = new URL(request.url);
  if (![LOGIN_PATH, PREVIEW_PATH, CONFIRM_PATH].includes(url.pathname)) return null;
  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigin(origin, env)) return json({ ok:false, error:'ORIGIN_NOT_ALLOWED' }, 403, request, env);
  if (request.method === 'OPTIONS') return json({ ok:true }, 200, request, env);
  if (request.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405, request, env);
  if (url.pathname === LOGIN_PATH) return handleLogin(request, env);
  if (!configured(env)) return json({ ok:false, error:'ADMIN_IMPORT_NOT_CONFIGURED' }, 503, request, env);
  if (url.pathname === PREVIEW_PATH) return handlePreview(request, env);
  return handleConfirm(request, env);
}

export { normaliseCsvRow, parseLessonDate, extractLessonId, previewRows };
