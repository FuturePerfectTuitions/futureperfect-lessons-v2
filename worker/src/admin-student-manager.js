import { randomPassword } from './admin-trial-manager.js';
import {
  assertReadModelReconciliationReady,
  refreshStudentAccessReadModel
} from './access-read-model-sync.js';

const PATHS = Object.freeze({
  batches: '/api/v1/admin/students/batches',
  create: '/api/v1/admin/students/create'
});

const SESSION_SCOPE = 'lesson-release-import';
const MAX_BATCHES_PER_STUDENT = 20;
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function allowedOrigin(origin, env) {
  const configured = clean(env?.ALLOWED_ORIGINS)
    .split(',').map(value => value.trim()).filter(Boolean);
  return !origin || configured.includes(origin) || origin === 'https://futureperfecttuitions.github.io';
}

function json(body, status = 200, request = null, env = null) {
  const headers = new Headers({
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store'
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

function base64UrlToText(value) {
  const base64 = value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(base64);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign']
  );
  return bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  ));
}

async function timingSafeTextEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function adminSessionAuthorised(request, env) {
  const match = clean(request.headers.get('Authorization')).match(/^Bearer\s+(.+)$/i);
  if (!match || !env?.ADMIN_IMPORT_SESSION_SECRET) return false;
  const parts = match[1].split('.');
  if (parts.length !== 2) return false;
  const expected = await hmac(String(env.ADMIN_IMPORT_SESSION_SECRET), parts[0]);
  if (!(await timingSafeTextEqual(parts[1], expected))) return false;
  try {
    const payload = JSON.parse(base64UrlToText(parts[0]));
    return payload.scope === SESSION_SCOPE && Number(payload.exp) >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function configured(env) {
  return Boolean(
    env?.STUDENTS_KV &&
    env?.DB &&
    env?.READ_MODELS_KV &&
    env?.ADMIN_IMPORT_SESSION_SECRET
  );
}

function validIsoDate(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'
  }).format(now);
}

function proposedStudentPortalUserId(firstName, dateOfBirth) {
  if (!validIsoDate(dateOfBirth)) return '';
  const name = clean(firstName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '');
  if (!name) return '';
  const ddmm = `${dateOfBirth.slice(8, 10)}${dateOfBirth.slice(5, 7)}`;
  return `${name}${ddmm}`.slice(0, 40);
}

function validStudentPortalUserId(value) {
  const id = clean(value);
  return (
    /^[A-Za-z][A-Za-z0-9_-]{2,39}$/.test(id) &&
    !/^trial/i.test(id) &&
    !/^admin/i.test(id)
  );
}

function batchActiveOn(row, date) {
  const from = clean(row?.active_from ?? row?.activeFrom);
  const to = clean(row?.active_to ?? row?.activeTo);
  if (from && from > date) return false;
  return !to || date < to;
}

function normaliseBatchKeys(values) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const key = clean(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function deriveSchoolYear(batchDefinitions) {
  const years = (Array.isArray(batchDefinitions) ? batchDefinitions : [])
    .map(row => Number(row?.school_year ?? row?.schoolYear ?? 0))
    .filter(year => year >= 2 && year <= 6);
  return years.length ? Math.max(...years) : 0;
}

function deriveVrEligible(batchDefinitions) {
  return (Array.isArray(batchDefinitions) ? batchDefinitions : []).some(row =>
    norm(row?.subject) === 'english' && norm(row?.stream) === '11plus'
  );
}

function buildStudentRecord({ portalUserId, firstName, loginPassword, answerPassword, batchDefinitions }) {
  const now = new Date().toISOString();
  const batches = (Array.isArray(batchDefinitions) ? batchDefinitions : [])
    .map(row => clean(row?.batch_key ?? row?.batchKey)).filter(Boolean);
  return {
    schemaVersion:1,
    portalUserId,
    firstName,
    name:firstName,
    p:loginPassword,
    loginPassword,
    answerPassword,
    status:'active',
    accountStatus:'active',
    expires:'',
    expiresOn:null,
    schoolYear:deriveSchoolYear(batchDefinitions),
    vrEligible:deriveVrEligible(batchDefinitions),
    mathsYears:[],
    vrBuckets:[],
    entitlements:{},
    batches,
    fullLibraries:[],
    manualAccess:{ coreLessons:[], vrLessons:[], specialBuckets:[] },
    manualLessonAccess:{},
    specialAccess:[],
    blockedLessons:[],
    studentCreatedAt:now,
    studentUpdatedAt:now
  };
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function activeBatches(env, date = londonToday()) {
  const rows = await allRows(env.DB.prepare(
    `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
     FROM batch_definitions
     ORDER BY school_year, subject, stream, batch_key`
  ));
  return rows.filter(row => batchActiveOn(row, date));
}

async function definitionsForKeys(env, batchKeys) {
  if (!batchKeys.length) return [];
  const placeholders = batchKeys.map(() => '?').join(',');
  const rows = await allRows(env.DB.prepare(
    `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
     FROM batch_definitions
     WHERE batch_key IN (${placeholders})`
  ).bind(...batchKeys));
  const byKey = new Map(rows.map(row => [clean(row.batch_key), row]));
  return batchKeys.map(key => byKey.get(key)).filter(Boolean);
}

async function handleBatches(request, env) {
  const rows = await activeBatches(env);
  return json({
    ok:true,
    batches:rows.map(row => ({
      batchKey:clean(row.batch_key),
      academicYear:clean(row.academic_year),
      subject:clean(row.subject),
      schoolYear:Number(row.school_year),
      stream:clean(row.stream),
      mathsLevel:row.maths_level == null ? null : Number(row.maths_level),
      activeFrom:clean(row.active_from) || null,
      activeTo:clean(row.active_to) || null
    }))
  }, 200, request, env);
}

async function rollbackProvision(env, portalUserIdNorm) {
  try {
    await env.DB.prepare(
      `DELETE FROM student_batch_assignments WHERE portal_user_id_norm = ?`
    ).bind(portalUserIdNorm).run();
  } catch { /* best-effort compensation */ }
  try {
    await env.DB.prepare(
      `DELETE FROM student_session_profiles
       WHERE token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm = ?)`
    ).bind(portalUserIdNorm).run();
  } catch { /* best-effort compensation */ }
  try {
    await env.DB.prepare(`DELETE FROM student_session_windows WHERE portal_user_id_norm = ?`)
      .bind(portalUserIdNorm).run();
  } catch { /* best-effort compensation */ }
  try {
    await env.DB.prepare(`DELETE FROM student_sessions WHERE portal_user_id_norm = ?`)
      .bind(portalUserIdNorm).run();
  } catch { /* best-effort compensation */ }
  try { await env.STUDENTS_KV.delete(`user:${portalUserIdNorm}`); } catch { /* best-effort compensation */ }
}

async function handleCreate(request, env) {
  const body = await readJson(request);
  const firstName = clean(body?.firstName);
  const dateOfBirth = clean(body?.dateOfBirth);
  const joinDate = clean(body?.joinDate);
  const batchKeys = normaliseBatchKeys(body?.batchKeys);
  const portalUserId = proposedStudentPortalUserId(firstName, dateOfBirth);
  const portalUserIdNorm = norm(portalUserId);

  if (!firstName || firstName.length > 60) {
    return json({ ok:false, error:'FIRST_NAME_REQUIRED' }, 400, request, env);
  }
  if (!validIsoDate(dateOfBirth)) {
    return json({ ok:false, error:'DATE_OF_BIRTH_REQUIRED' }, 400, request, env);
  }
  if (!validIsoDate(joinDate)) {
    return json({ ok:false, error:'JOIN_DATE_REQUIRED' }, 400, request, env);
  }
  if (!validStudentPortalUserId(portalUserId)) {
    return json({ ok:false, error:'INVALID_PORTAL_USER_ID' }, 400, request, env);
  }
  if (!batchKeys.length || batchKeys.length > MAX_BATCHES_PER_STUDENT) {
    return json({ ok:false, error:'BATCH_REQUIRED' }, 400, request, env);
  }

  const key = `user:${portalUserIdNorm}`;
  if (await env.STUDENTS_KV.get(key, { type:'json' })) {
    return json({ ok:false, error:'ACCOUNT_ALREADY_EXISTS', portalUserId }, 409, request, env);
  }

  let definitions;
  try {
    definitions = await definitionsForKeys(env, batchKeys);
  } catch {
    return json({ ok:false, error:'BATCH_LOOKUP_FAILED' }, 500, request, env);
  }
  if (definitions.length !== batchKeys.length) {
    return json({ ok:false, error:'INVALID_BATCH' }, 400, request, env);
  }
  const inactive = definitions.filter(row => !batchActiveOn(row, joinDate));
  if (inactive.length) {
    return json({
      ok:false,
      error:'BATCH_NOT_ACTIVE_ON_JOIN_DATE',
      batches:inactive.map(row => clean(row.batch_key))
    }, 400, request, env);
  }

  try {
    await assertReadModelReconciliationReady(env);
  } catch {
    return json({ ok:false, error:'READ_MODEL_RECONCILIATION_NOT_READY' }, 503, request, env);
  }

  const loginPassword = randomPassword();
  const answerPassword = randomPassword(new Set([loginPassword]));
  const record = buildStudentRecord({
    portalUserId,
    firstName,
    loginPassword,
    answerPassword,
    batchDefinitions:definitions
  });
  const now = new Date().toISOString();

  try {
    await env.STUDENTS_KV.put(key, JSON.stringify(record));
    await env.DB.batch(definitions.map(row => env.DB.prepare(
      `INSERT INTO student_batch_assignments (
         portal_user_id_norm, batch_key, effective_from, effective_to, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, ?)`
    ).bind(portalUserIdNorm, clean(row.batch_key), joinDate, now, now)));

    const published = await refreshStudentAccessReadModel(env, portalUserIdNorm, { asOfDate:joinDate });
    const [readback, assignmentRows] = await Promise.all([
      env.STUDENTS_KV.get(key, { type:'json' }),
      allRows(env.DB.prepare(
        `SELECT batch_key, effective_from, effective_to
         FROM student_batch_assignments
         WHERE portal_user_id_norm = ? AND effective_to IS NULL`
      ).bind(portalUserIdNorm))
    ]);
    const assigned = new Set(assignmentRows.map(row => clean(row.batch_key)));
    const verified = Boolean(
      readback &&
      readback.portalUserId === portalUserId &&
      readback.p === loginPassword &&
      readback.loginPassword === loginPassword &&
      readback.answerPassword === answerPassword &&
      batchKeys.every(batchKey => assigned.has(batchKey)) &&
      published?.version
    );
    if (!verified) throw new Error('STUDENT_PROVISION_VERIFY_FAILED');

    return json({
      ok:true,
      portalUserId,
      firstName,
      loginPassword,
      answerPassword,
      joinDate,
      schoolYear:record.schoolYear,
      vrEligible:record.vrEligible,
      batchKeys,
      readModelVersion:published.version
    }, 200, request, env);
  } catch (error) {
    await rollbackProvision(env, portalUserIdNorm);
    return json({
      ok:false,
      error:'STUDENT_PROVISION_FAILED',
      detail:clean(error?.message)
    }, 500, request, env);
  }
}

export async function handleAdminStudentManager(request, env) {
  const url = new URL(request.url);
  if (!Object.values(PATHS).includes(url.pathname)) return null;

  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigin(origin, env)) {
    return json({ ok:false, error:'ORIGIN_NOT_ALLOWED' }, 403, request, env);
  }
  if (request.method === 'OPTIONS') return json({ ok:true }, 200, request, env);
  if (request.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405, request, env);
  if (!configured(env)) return json({ ok:false, error:'ADMIN_STUDENTS_NOT_CONFIGURED' }, 503, request, env);
  if (!(await adminSessionAuthorised(request, env))) {
    return json({ ok:false, error:'UNAUTHORISED' }, 401, request, env);
  }

  if (url.pathname === PATHS.batches) return handleBatches(request, env);
  return handleCreate(request, env);
}

export {
  PATHS,
  MAX_BATCHES_PER_STUDENT,
  validIsoDate,
  londonToday,
  proposedStudentPortalUserId,
  validStudentPortalUserId,
  batchActiveOn,
  normaliseBatchKeys,
  deriveSchoolYear,
  deriveVrEligible,
  buildStudentRecord
};