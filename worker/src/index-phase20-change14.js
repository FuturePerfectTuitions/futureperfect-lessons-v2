import change13Worker from './index-phase20-change13.js';

const ADMIN_RELEASE_PATHS = new Set([
  '/api/v1/admin/lesson-releases/preview',
  '/api/v1/admin/lesson-releases/confirm'
]);
const MAX_IMPORT_ROWS = 1000;

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToText(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(base64);
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign']
  );
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
  );
}

async function timingSafeTextEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
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
    return payload.scope === 'lesson-release-import' &&
      Number(payload.exp) >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function rowValue(row, name) {
  if (!row || typeof row !== 'object') return '';
  const wanted = norm(name);
  for (const [key, value] of Object.entries(row)) {
    if (norm(key) === wanted) return clean(value);
  }
  return '';
}

function isYear4ElevenPlusMathsRow(row) {
  const batch = rowValue(row, 'Mode');
  const subject = norm(rowValue(row, 'Subject'));
  return /^Y411/i.test(batch) && /M$/i.test(batch) && subject === 'maths';
}

function curriculumLessonIds(raw) {
  const items = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.lessonIds)
        ? raw.lessonIds
        : (Array.isArray(raw?.lessons)
            ? raw.lessons
            : (Array.isArray(raw?.items) ? raw.items : [])));

  return [...new Set(items
    .map(item => typeof item === 'string' ? clean(item) : clean(item?.lessonId))
    .filter(Boolean))];
}

export async function expandYear4ElevenPlusMathsBaselineRows(rows, env) {
  const source = Array.isArray(rows) ? rows : [];
  const byStudent = new Map();

  for (const row of source) {
    if (!isYear4ElevenPlusMathsRow(row)) continue;
    const student = norm(rowValue(row, 'Student'));
    if (student && !byStudent.has(student)) byStudent.set(student, row);
  }

  if (!byStudent.size) return source;

  const curriculum = await env?.LESSONS_KV?.get('curriculum:MATHS_L1', { type:'json' });
  const l1LessonIds = curriculumLessonIds(curriculum);
  if (!l1LessonIds.length) {
    const error = new Error('Year 4 11+ Maths baseline could not be resolved because MATHS_L1 is unavailable.');
    error.code = 'MATHS_L1_BASELINE_UNAVAILABLE';
    throw error;
  }

  const extras = [];
  for (const row of byStudent.values()) {
    for (const lessonId of l1LessonIds) {
      extras.push({
        ...row,
        Subject: 'Maths',
        Lesson: `${lessonId} Year 4 11+ L1 baseline`,
        LessonStatus: 'completed'
      });
    }
  }

  const expanded = [...source, ...extras];
  if (expanded.length > MAX_IMPORT_ROWS) {
    const error = new Error(`Year 4 11+ baseline expansion would create ${expanded.length} import rows; maximum is ${MAX_IMPORT_ROWS}.`);
    error.code = 'IMPORT_TOO_LARGE_AFTER_Y411_BASELINE';
    throw error;
  }

  return expanded;
}

function allowedOrigin(origin, env) {
  if (!origin) return false;
  return clean(env?.ALLOWED_ORIGINS)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .includes(origin);
}

function jsonError(request, env, error) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  const origin = request.headers.get('Origin') || '';
  if (allowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify({
    ok: false,
    error: clean(error?.code) || 'Y411_BASELINE_EXPANSION_FAILED',
    message: clean(error?.message) || 'Unable to prepare Year 4 11+ Maths baseline access.'
  }), { status: 503, headers });
}

function requestWithRows(request, payload, rows) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...payload, rows })
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !ADMIN_RELEASE_PATHS.has(url.pathname)) {
      return change13Worker.fetch(request, env, ctx);
    }

    // Preserve the existing admin-import security boundary: unauthorised calls
    // are delegated unchanged and never reach the baseline-expansion logic.
    if (!(await adminSessionAuthorised(request, env))) {
      return change13Worker.fetch(request, env, ctx);
    }

    const payload = await request.clone().json().catch(() => null);
    if (!payload || !Array.isArray(payload.rows) || !payload.rows.some(isYear4ElevenPlusMathsRow)) {
      return change13Worker.fetch(request, env, ctx);
    }

    try {
      const rows = await expandYear4ElevenPlusMathsBaselineRows(payload.rows, env);
      return change13Worker.fetch(requestWithRows(request, payload, rows), env, ctx);
    } catch (error) {
      return jsonError(request, env, error);
    }
  }
};
