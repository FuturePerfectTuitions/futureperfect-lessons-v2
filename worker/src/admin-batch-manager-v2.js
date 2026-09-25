const CREATE_PATH = '/api/v1/admin/students/batches/create';
const REACTIVATE_PATH = '/api/v1/admin/students/batches/reactivate';
const SESSION_SCOPE = 'lesson-release-import';

const clean = value => String(value ?? '').trim();
const normaliseBatchKey = value => clean(value).toUpperCase();

function validBatchKey(value) {
  return /^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(normaliseBatchKey(value));
}

function validIsoDate(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function batchActiveOn(row, date) {
  const from = clean(row?.active_from ?? row?.activeFrom);
  const to = clean(row?.active_to ?? row?.activeTo);
  if (from && from > date) return false;
  return !to || date < to;
}

function allowedOrigin(origin, env) {
  const configured = clean(env?.ALLOWED_ORIGINS).split(',').map(value => value.trim()).filter(Boolean);
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

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function serialiseBatch(row) {
  if (!row) return null;
  return {
    batchKey:clean(row.batch_key),
    academicYear:clean(row.academic_year),
    subject:clean(row.subject),
    schoolYear:Number(row.school_year),
    stream:clean(row.stream),
    mathsLevel:row.maths_level == null ? null : Number(row.maths_level),
    activeFrom:clean(row.active_from) || null,
    activeTo:clean(row.active_to) || null
  };
}

function sameDefinition(a, b) {
  return Boolean(a && b &&
    clean(a.academic_year) === clean(b.academic_year) &&
    clean(a.subject) === clean(b.subject) &&
    Number(a.school_year) === Number(b.school_year) &&
    clean(a.stream) === clean(b.stream) &&
    (a.maths_level == null ? null : Number(a.maths_level)) === (b.maths_level == null ? null : Number(b.maths_level))
  );
}

async function definition(env, batchKey) {
  return env.DB.prepare(
    `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to, created_at, updated_at
     FROM batch_definitions
     WHERE UPPER(batch_key) = ?
     LIMIT 1`
  ).bind(batchKey).first();
}

async function validateCommon(request, env) {
  const body = await readJson(request);
  const batchKey = normaliseBatchKey(body?.batchKey);
  const copyFromBatchKey = normaliseBatchKey(body?.copyFromBatchKey);
  const activeFrom = clean(body?.activeFrom);

  if (!validBatchKey(batchKey)) return { response:json({ ok:false, error:'INVALID_BATCH_KEY' }, 400, request, env) };
  if (!validBatchKey(copyFromBatchKey) || copyFromBatchKey === batchKey) {
    return { response:json({ ok:false, error:'INVALID_BATCH_TEMPLATE' }, 400, request, env) };
  }
  if (!validIsoDate(activeFrom)) return { response:json({ ok:false, error:'ACTIVE_FROM_REQUIRED' }, 400, request, env) };

  let existing;
  let template;
  try {
    [existing, template] = await Promise.all([
      definition(env, batchKey),
      definition(env, copyFromBatchKey)
    ]);
  } catch {
    return { response:json({ ok:false, error:'BATCH_LOOKUP_FAILED' }, 500, request, env) };
  }

  if (!template) return { response:json({ ok:false, error:'TEMPLATE_BATCH_NOT_FOUND', copyFromBatchKey }, 404, request, env) };
  if (!batchActiveOn(template, activeFrom)) {
    return { response:json({ ok:false, error:'TEMPLATE_NOT_ACTIVE_ON_DATE', copyFromBatchKey, activeFrom }, 400, request, env) };
  }
  return { body, batchKey, copyFromBatchKey, activeFrom, existing, template };
}

async function handleCreate(request, env) {
  const state = await validateCommon(request, env);
  if (state.response) return state.response;
  const { batchKey, copyFromBatchKey, activeFrom, existing, template } = state;

  if (existing) {
    return json({
      ok:false,
      error:'BATCH_ALREADY_EXISTS',
      batchKey,
      existing:serialiseBatch(existing),
      sameDefinition:sameDefinition(existing, template),
      activeOnRequestedDate:batchActiveOn(existing, activeFrom)
    }, 409, request, env);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO batch_definitions (
         batch_key, academic_year, subject, school_year, stream, maths_level,
         active_from, active_to, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      batchKey,
      clean(template.academic_year),
      clean(template.subject),
      Number(template.school_year),
      clean(template.stream),
      template.maths_level == null ? null : Number(template.maths_level),
      activeFrom,
      clean(template.active_to) || null,
      now,
      now
    ).run();

    const created = await definition(env, batchKey);
    if (!created || !batchActiveOn(created, activeFrom)) throw new Error('BATCH_CREATE_VERIFY_FAILED');
    return json({ ok:true, batch:serialiseBatch(created), copiedFromBatchKey:copyFromBatchKey }, 200, request, env);
  } catch (error) {
    const detail = clean(error?.message);
    if (/unique|constraint/i.test(detail)) {
      const collided = await definition(env, batchKey).catch(() => null);
      return json({
        ok:false,
        error:'BATCH_ALREADY_EXISTS',
        batchKey,
        existing:serialiseBatch(collided),
        sameDefinition:sameDefinition(collided, template),
        activeOnRequestedDate:batchActiveOn(collided, activeFrom)
      }, 409, request, env);
    }
    return json({ ok:false, error:'BATCH_CREATE_FAILED', detail }, 500, request, env);
  }
}

async function handleReactivate(request, env) {
  const state = await validateCommon(request, env);
  if (state.response) return state.response;
  const { batchKey, copyFromBatchKey, activeFrom, existing, template } = state;

  if (!existing) return json({ ok:false, error:'BATCH_NOT_FOUND', batchKey }, 404, request, env);
  if (!sameDefinition(existing, template)) {
    return json({
      ok:false,
      error:'BATCH_REACTIVATE_TEMPLATE_MISMATCH',
      batchKey,
      existing:serialiseBatch(existing),
      template:serialiseBatch(template)
    }, 409, request, env);
  }

  const now = new Date().toISOString();
  const activeTo = clean(template.active_to) || null;
  try {
    await env.DB.prepare(
      `UPDATE batch_definitions
       SET active_from = ?, active_to = ?, updated_at = ?
       WHERE batch_key = ?`
    ).bind(activeFrom, activeTo, now, clean(existing.batch_key)).run();

    const updated = await definition(env, batchKey);
    if (!updated || !batchActiveOn(updated, activeFrom)) throw new Error('BATCH_REACTIVATE_VERIFY_FAILED');
    return json({
      ok:true,
      batch:serialiseBatch(updated),
      copiedDatesFromBatchKey:copyFromBatchKey,
      reactivated:true
    }, 200, request, env);
  } catch (error) {
    return json({ ok:false, error:'BATCH_REACTIVATE_FAILED', detail:clean(error?.message) }, 500, request, env);
  }
}

export async function handleAdminBatchManagerV2(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== CREATE_PATH && url.pathname !== REACTIVATE_PATH) return null;

  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigin(origin, env)) return json({ ok:false, error:'ORIGIN_NOT_ALLOWED' }, 403, request, env);
  if (request.method === 'OPTIONS') return json({ ok:true }, 200, request, env);
  if (request.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405, request, env);
  if (!env?.DB || !env?.ADMIN_IMPORT_SESSION_SECRET) return json({ ok:false, error:'ADMIN_BATCHES_NOT_CONFIGURED' }, 503, request, env);
  if (!(await adminSessionAuthorised(request, env))) return json({ ok:false, error:'UNAUTHORISED' }, 401, request, env);

  return url.pathname === CREATE_PATH ? handleCreate(request, env) : handleReactivate(request, env);
}

export { CREATE_PATH, REACTIVATE_PATH, validBatchKey, validIsoDate, batchActiveOn, sameDefinition };
