import phase19Worker from './index-phase19-access.js';
import { handleAdminLessonReleaseImport } from './admin-lesson-release-import.js';

const EXCEL_SYNC_PATH = '/api/v1/admin/excel-entitlements/sync';
const MAX_SYNC_ITEMS = 1000;
const PRELESSON_OPERATIONS = new Set(['prelesson_grant', 'prelesson_status_check']);

const clean = value => String(value ?? '').trim();
const normaliseUser = value => clean(value).toLowerCase();
const onlineBatch = value => clean(value).toUpperCase().includes('O');
const elevenPlusBatch = value => /^Y[45]11/i.test(clean(value));

function canonicalLessonId(value) {
  const raw = clean(value);
  const match = raw.match(/^Y6MS([1-9]|1[0-9])$/i);
  if (!match) return raw;
  return `Y6M${50 + Number(match[1])}`;
}

function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function validIsoDate(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validIdentifier(value, maxLength = 160) {
  const text = clean(value);
  return text.length >= 1 && text.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(text);
}

function parseBearer(request) {
  const match = String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function timingSafeEqual(left, right) {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function syncAuthorised(request, env) {
  const configured = String(env?.EXCEL_SYNC_TOKEN || '');
  const supplied = parseBearer(request);
  return Boolean(configured && supplied && await timingSafeEqual(supplied, configured));
}

function syncResult(syncRowId, status, ok, extra = {}) {
  return { syncRowId: clean(syncRowId), ok: Boolean(ok), status, ...extra };
}

function requestWithBody(request, body) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body)
  });
}

async function rewriteExcelSyncRequest(request) {
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return { request, body: null, aliasesByRow: new Map() };
  }
  if (!Array.isArray(body?.items)) return { request, body, aliasesByRow: new Map() };

  const aliasesByRow = new Map();
  const items = body.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const supplied = clean(item.lessonId);
    const resolved = canonicalLessonId(supplied);
    if (resolved === supplied) return item;
    const rowId = clean(item.syncRowId);
    if (rowId) aliasesByRow.set(rowId, supplied.toUpperCase());
    return { ...item, lessonId: resolved };
  });
  const rewrittenBody = { ...body, items };
  return { request: requestWithBody(request, rewrittenBody), body: rewrittenBody, aliasesByRow };
}

function restoreResultAlias(result, aliasesByRow) {
  const alias = aliasesByRow.get(clean(result?.syncRowId));
  return alias ? { ...result, lessonId: alias } : result;
}

async function restoreExcelSyncAliases(response, aliasesByRow) {
  if (!aliasesByRow.size) return response;
  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!Array.isArray(body?.results)) return response;
  const results = body.results.map(result => restoreResultAlias(result, aliasesByRow));
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...body, results }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function validatePrelessonItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'INVALID_ITEM', message: 'Item must be an object.' };
  }
  const syncRowId = clean(raw.syncRowId);
  const operation = clean(raw.operation).toLowerCase();
  const portalUserId = clean(raw.portalUserId);
  const lessonId = clean(raw.lessonId);
  const batchKey = clean(raw.batchKey);
  const lessonDate = clean(raw.lessonDate);

  if (!validIdentifier(syncRowId)) return { error: 'INVALID_SYNC_ROW_ID', message: 'Sync Row ID is missing or invalid.' };
  if (!PRELESSON_OPERATIONS.has(operation)) return { error: 'INVALID_OPERATION', message: 'Invalid PreLesson operation.' };
  if (!validIdentifier(portalUserId)) return { error: 'INVALID_PORTAL_USER_ID', message: 'Portal User ID is missing or invalid.' };
  if (!validIdentifier(lessonId)) return { error: 'INVALID_LESSON_ID', message: 'Lesson ID is missing or invalid.' };
  if (!validIdentifier(batchKey)) return { error: 'INVALID_BATCH_KEY', message: 'Batch key is missing or invalid.' };
  if (!validIsoDate(lessonDate)) return { error: 'INVALID_LESSON_DATE', message: 'Lesson date must be YYYY-MM-DD.' };
  if (!onlineBatch(batchKey)) {
    return { error: 'PRELESSON_ONLINE_BATCH_REQUIRED', message: 'PreLesson-only access is permitted only when Batch ID contains O.' };
  }

  return {
    value: {
      syncRowId,
      operation,
      portalUserId,
      portalUserIdNorm: normaliseUser(portalUserId),
      lessonId,
      batchKey,
      lessonDate
    }
  };
}

function isBlocked(student, lessonId) {
  return new Set(Array.isArray(student?.blockedLessons) ? student.blockedLessons.map(String) : []).has(lessonId);
}

async function readFullEntitlement(env, item) {
  return env.DB.prepare(
    `SELECT core_access FROM lesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?`
  ).bind(item.portalUserIdNorm, item.lessonId).first();
}

async function readPrelesson(env, item) {
  return env.DB.prepare(
    `SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access, source_row_id
     FROM online_prelesson_entitlements
     WHERE portal_user_id_norm = ? AND lesson_id = ? AND batch_key = ?`
  ).bind(item.portalUserIdNorm, item.lessonId, item.batchKey).first();
}

async function clearPrelesson(env, item) {
  await env.DB.prepare(
    `DELETE FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?`
  ).bind(item.portalUserIdNorm, item.lessonId).run();
}

async function validatePrelessonExcelItem(env, item) {
  const [student, lesson] = await Promise.all([
    env.STUDENTS_KV.get(`user:${item.portalUserIdNorm}`, { type: 'json' }),
    env.LESSONS_KV.get(`lesson:${item.lessonId}`, { type: 'json' })
  ]);
  if (!student) return { error: 'STUDENT_NOT_FOUND', message: 'Portal student does not exist.' };
  if (!lesson || clean(lesson.lessonId) !== item.lessonId || lesson.active === false) {
    return { error: 'LESSON_NOT_FOUND', message: 'Lesson ID does not resolve to an active V2 lesson.' };
  }
  const subject = clean(lesson.subject).toLowerCase();
  if (!['maths', 'english'].includes(subject)) {
    return { error: 'INVALID_LESSON_SUBJECT', message: 'Lesson subject is not a normal Maths/English entitlement subject.' };
  }
  if (isBlocked(student, item.lessonId)) return { blocked: true, student, lesson, subject };
  return { student, lesson, subject };
}

async function processAuthoritativePrelessonItem(env, rawItem) {
  const shape = validatePrelessonItem(rawItem);
  if (shape.error) return syncResult(rawItem?.syncRowId, shape.error, false, { message: shape.message });
  const item = shape.value;

  try {
    const validated = await validatePrelessonExcelItem(env, item);
    if (validated.error) {
      return syncResult(item.syncRowId, validated.error, false, {
        portalUserId: item.portalUserId,
        lessonId: item.lessonId,
        batchKey: item.batchKey,
        message: validated.message
      });
    }
    if (validated.blocked) {
      return syncResult(item.syncRowId, 'BLOCKED', false, {
        portalUserId: item.portalUserId,
        lessonId: item.lessonId,
        batchKey: item.batchKey
      });
    }

    const fullEntitlement = await readFullEntitlement(env, item);
    if (Number(fullEntitlement?.core_access) === 1) {
      await clearPrelesson(env, item);
      return syncResult(item.syncRowId, 'CONFIRMED', true, {
        operation: item.operation,
        portalUserId: item.portalUserId,
        lessonId: item.lessonId,
        batchKey: item.batchKey,
        lessonDate: item.lessonDate,
        accessMode: 'full'
      });
    }

    const existing = await readPrelesson(env, item);
    if (item.operation === 'prelesson_status_check') {
      if (!existing) {
        return syncResult(item.syncRowId, 'PRELESSON_ENTITLEMENT_MISSING', false, {
          portalUserId: item.portalUserId,
          lessonId: item.lessonId,
          batchKey: item.batchKey
        });
      }
      return syncResult(item.syncRowId, 'CONFIRMED', true, {
        operation: item.operation,
        portalUserId: item.portalUserId,
        lessonId: item.lessonId,
        batchKey: item.batchKey,
        lessonDate: item.lessonDate,
        accessMode: 'prelesson'
      });
    }

    const now = new Date().toISOString();
    const vrAccess = validated.subject === 'english' && elevenPlusBatch(item.batchKey) && validated.student?.vrEligible === true ? 1 : 0;
    await env.DB.prepare(
      `INSERT INTO online_prelesson_entitlements (
         portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access,
         source_row_id, first_granted_at, last_confirmed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(portal_user_id_norm, lesson_id, batch_key) DO UPDATE SET
         lesson_date = excluded.lesson_date,
         vr_access = excluded.vr_access,
         source_row_id = excluded.source_row_id,
         last_confirmed_at = excluded.last_confirmed_at`
    ).bind(
      item.portalUserIdNorm,
      item.lessonId,
      item.batchKey,
      item.lessonDate,
      vrAccess,
      item.syncRowId,
      now,
      now
    ).run();

    return syncResult(item.syncRowId, existing ? 'CONFIRMED' : 'CREATED', true, {
      operation: item.operation,
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey,
      lessonDate: item.lessonDate,
      accessMode: 'prelesson'
    });
  } catch {
    return syncResult(item.syncRowId, 'ERROR', false, {
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey,
      message: 'V2 could not process this PreLesson item. It is safe to retry.'
    });
  }
}

async function processDelegatedItem(request, env, ctx, item) {
  const response = await phase19Worker.fetch(requestWithBody(request, { items: [item] }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (response.ok && Array.isArray(body?.results) && body.results.length === 1) return body.results[0];
  return syncResult(item?.syncRowId, body?.error || 'ERROR', false, {
    portalUserId: clean(item?.portalUserId),
    lessonId: clean(item?.lessonId),
    batchKey: clean(item?.batchKey),
    message: 'V2 could not process this item. It is safe to retry.'
  });
}

async function handleMixedExcelSync(request, env, ctx, body, aliasesByRow) {
  if (request.headers.get('Origin')) return json({ ok: false, error: 'BROWSER_REQUEST_NOT_ALLOWED' }, { status: 403 });
  if (!env?.STUDENTS_KV || !env?.LESSONS_KV || !env?.DB) return json({ ok: false, error: 'SYNC_BINDINGS_UNAVAILABLE' }, { status: 503 });
  if (!String(env?.EXCEL_SYNC_TOKEN || '')) return json({ ok: false, error: 'SYNC_NOT_CONFIGURED' }, { status: 503 });
  if (!(await syncAuthorised(request, env))) return json({ ok: false, error: 'SYNC_UNAUTHORISED' }, { status: 401 });
  if (!Array.isArray(body?.items) || body.items.length === 0) return json({ ok: false, error: 'ITEMS_REQUIRED' }, { status: 400 });
  if (body.items.length > MAX_SYNC_ITEMS) return json({ ok: false, error: 'TOO_MANY_ITEMS', maxItems: MAX_SYNC_ITEMS }, { status: 413 });

  const results = [];
  for (const item of body.items) {
    const operation = clean(item?.operation).toLowerCase();
    const result = PRELESSON_OPERATIONS.has(operation)
      ? await processAuthoritativePrelessonItem(env, item)
      : await processDelegatedItem(request, env, ctx, item);
    results.push(restoreResultAlias(result, aliasesByRow));
  }

  return json({
    ok: true,
    results,
    summary: {
      total: results.length,
      succeeded: results.filter(item => item.ok).length,
      blocked: results.filter(item => item.status === 'BLOCKED').length,
      failed: results.filter(item => !item.ok && item.status !== 'BLOCKED').length
    }
  });
}

export { canonicalLessonId, validatePrelessonItem, processAuthoritativePrelessonItem };

export default {
  async fetch(request, env, ctx) {
    const adminResponse = await handleAdminLessonReleaseImport(request, env);
    if (adminResponse) return adminResponse;

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === EXCEL_SYNC_PATH) {
      const rewritten = await rewriteExcelSyncRequest(request);
      const hasPrelesson = Array.isArray(rewritten.body?.items) && rewritten.body.items.some(item => PRELESSON_OPERATIONS.has(clean(item?.operation).toLowerCase()));
      if (hasPrelesson) return handleMixedExcelSync(rewritten.request, env, ctx, rewritten.body, rewritten.aliasesByRow);
      const response = await phase19Worker.fetch(rewritten.request, env, ctx);
      return restoreExcelSyncAliases(response, rewritten.aliasesByRow);
    }
    return phase19Worker.fetch(request, env, ctx);
  }
};