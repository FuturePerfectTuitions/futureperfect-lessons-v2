import phase12Worker from './index-phase12.js';

const EXCEL_SYNC_PATH = '/api/v1/admin/excel-entitlements/sync';
const MAX_SYNC_ITEMS = 1000;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function isDevelopment(env) {
  return String(env?.ENVIRONMENT || '').trim().toLowerCase() === 'development';
}

function normalisePortalUserId(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function validIsoDate(value) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validAuditId(value) {
  const text = cleanText(value);
  return text.length >= 1 && text.length <= 160 && !/[\u0000-\u001f\u007f]/.test(text);
}

function validIdentifier(value, maxLength = 160) {
  const text = cleanText(value);
  return text.length >= 1 && text.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(text);
}

function batchActiveOnDate(batch, lessonDate) {
  const from = cleanText(batch?.active_from);
  const to = cleanText(batch?.active_to);
  if (from && lessonDate < from) return false;
  if (to && lessonDate >= to) return false;
  return true;
}

function parseBearer(request) {
  const raw = String(request.headers.get('Authorization') || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function sha256Bytes(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
}

async function timingSafeEqual(left, right) {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function authorised(request, env) {
  const configured = String(env?.EXCEL_SYNC_TOKEN || '');
  if (!configured) return false;
  const supplied = parseBearer(request);
  if (!supplied) return false;
  return timingSafeEqual(supplied, configured);
}

function result(syncRowId, status, ok, extra = {}) {
  return {
    syncRowId: cleanText(syncRowId),
    ok: Boolean(ok),
    status,
    ...extra
  };
}

function validateItemShape(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { error: 'INVALID_ITEM', message: 'Item must be an object.' };
  }

  const syncRowId = cleanText(item.syncRowId);
  const operation = cleanText(item.operation).toLowerCase();
  const portalUserId = cleanText(item.portalUserId);
  const lessonId = cleanText(item.lessonId);
  const batchKey = cleanText(item.batchKey);
  const lessonDate = cleanText(item.lessonDate);

  if (!validAuditId(syncRowId)) {
    return { error: 'INVALID_SYNC_ROW_ID', message: 'Sync Row ID is missing or invalid.' };
  }
  if (!['grant', 'status_check'].includes(operation)) {
    return { error: 'INVALID_OPERATION', message: 'Operation must be grant or status_check.' };
  }
  if (!validIdentifier(portalUserId)) {
    return { error: 'INVALID_PORTAL_USER_ID', message: 'Portal User ID is missing or invalid.' };
  }
  if (!validIdentifier(lessonId)) {
    return { error: 'INVALID_LESSON_ID', message: 'Lesson ID is missing or invalid.' };
  }
  if (!validIdentifier(batchKey)) {
    return { error: 'INVALID_BATCH_KEY', message: 'Batch key is missing or invalid.' };
  }
  if (!validIsoDate(lessonDate)) {
    return { error: 'INVALID_LESSON_DATE', message: 'Lesson date must be YYYY-MM-DD.' };
  }

  return {
    value: {
      syncRowId,
      operation,
      portalUserId,
      portalUserIdNorm: normalisePortalUserId(portalUserId),
      lessonId,
      batchKey,
      lessonDate
    }
  };
}

async function loadStudent(env, portalUserIdNorm) {
  return env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
}

async function loadLesson(env, lessonId) {
  return env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
}

async function loadBatch(env, batchKey) {
  return env.DB.prepare(
    `SELECT batch_key, subject, school_year, stream, maths_level, active_from, active_to
     FROM batch_definitions
     WHERE batch_key = ?`
  ).bind(batchKey).first();
}

async function hasEffectiveAssignment(env, portalUserIdNorm, batchKey, lessonDate) {
  const row = await env.DB.prepare(
    `SELECT assignment_id
     FROM student_batch_assignments
     WHERE portal_user_id_norm = ?
       AND batch_key = ?
       AND effective_from <= ?
       AND (effective_to IS NULL OR ? < effective_to)
     ORDER BY effective_from DESC, assignment_id DESC
     LIMIT 1`
  ).bind(portalUserIdNorm, batchKey, lessonDate, lessonDate).first();
  return Boolean(row);
}

function isBlocked(student, lessonId) {
  return new Set(
    Array.isArray(student?.blockedLessons)
      ? student.blockedLessons.map(value => String(value))
      : []
  ).has(lessonId);
}

async function validateAgainstStores(env, item) {
  const student = await loadStudent(env, item.portalUserIdNorm);
  if (!student) {
    return { error: 'STUDENT_NOT_FOUND', message: 'Portal student does not exist.' };
  }

  const lesson = await loadLesson(env, item.lessonId);
  if (!lesson || cleanText(lesson.lessonId) !== item.lessonId || lesson.active === false) {
    return { error: 'LESSON_NOT_FOUND', message: 'Lesson ID does not resolve to an active V2 lesson.' };
  }

  const subject = cleanText(lesson.subject).toLowerCase();
  if (!['maths', 'english'].includes(subject)) {
    return { error: 'INVALID_LESSON_SUBJECT', message: 'Lesson subject is not a normal Maths/English entitlement subject.' };
  }

  const batch = await loadBatch(env, item.batchKey);
  if (!batch) {
    return { error: 'BATCH_NOT_FOUND', message: 'Exact batch key is not configured in V2.' };
  }

  if (cleanText(batch.subject).toLowerCase() !== subject) {
    return { error: 'BATCH_SUBJECT_MISMATCH', message: 'Batch subject does not match the lesson subject.' };
  }

  if (!batchActiveOnDate(batch, item.lessonDate)) {
    return { error: 'BATCH_INACTIVE_ON_LESSON_DATE', message: 'Batch is not active on the supplied lesson date.' };
  }

  const assigned = await hasEffectiveAssignment(
    env,
    item.portalUserIdNorm,
    item.batchKey,
    item.lessonDate
  );
  if (!assigned) {
    return {
      error: 'NOT_ASSIGNED_ON_LESSON_DATE',
      message: 'Student is not effectively assigned to this batch on the lesson date.'
    };
  }

  if (isBlocked(student, item.lessonId)) {
    return { blocked: true, student, lesson, batch, subject };
  }

  return { student, lesson, batch, subject };
}

async function readDirectEntitlement(env, item) {
  return env.DB.prepare(
    `SELECT core_access, vr_access
     FROM lesson_entitlements
     WHERE portal_user_id_norm = ? AND lesson_id = ?`
  ).bind(item.portalUserIdNorm, item.lessonId).first();
}

async function readBatchRelease(env, item) {
  return env.DB.prepare(
    `SELECT batch_key, lesson_id, lesson_date, source_row_id
     FROM batch_lesson_releases
     WHERE batch_key = ? AND lesson_id = ?`
  ).bind(item.batchKey, item.lessonId).first();
}

async function statusCheck(env, item, validated) {
  if (validated.blocked) {
    return result(item.syncRowId, 'BLOCKED', false, {
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey
    });
  }

  const [entitlement, release] = await Promise.all([
    readDirectEntitlement(env, item),
    readBatchRelease(env, item)
  ]);

  if (!entitlement || Number(entitlement.core_access) !== 1) {
    return result(item.syncRowId, 'ENTITLEMENT_MISSING', false, {
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey
    });
  }

  if (!release) {
    return result(item.syncRowId, 'BATCH_RELEASE_MISSING', false, {
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey
    });
  }

  return result(item.syncRowId, 'CONFIRMED', true, {
    operation: 'status_check',
    portalUserId: item.portalUserId,
    lessonId: item.lessonId,
    batchKey: item.batchKey,
    lessonDate: item.lessonDate,
    entitlement: 'confirmed',
    batchRelease: 'confirmed'
  });
}

async function grant(env, item, validated) {
  if (validated.blocked) {
    return result(item.syncRowId, 'BLOCKED', false, {
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey
    });
  }

  const [existingEntitlement, existingRelease] = await Promise.all([
    readDirectEntitlement(env, item),
    readBatchRelease(env, item)
  ]);

  const now = new Date().toISOString();
  const firstVrAccess =
    validated.subject === 'english' &&
    cleanText(validated.batch?.stream).toLowerCase() === '11plus' &&
    validated.student?.vrEligible === true
      ? 1
      : 0;

  const entitlementStatement = env.DB.prepare(
    `INSERT INTO lesson_entitlements (
       portal_user_id_norm,
       lesson_id,
       core_access,
       vr_access,
       source,
       first_granted_at,
       last_confirmed_at,
       source_batch_code,
       source_lesson_date
     ) VALUES (?, ?, 1, ?, 'excel', ?, ?, ?, ?)
     ON CONFLICT(portal_user_id_norm, lesson_id) DO UPDATE SET
       core_access = 1,
       last_confirmed_at = excluded.last_confirmed_at,
       source_batch_code = excluded.source_batch_code,
       source_lesson_date = excluded.source_lesson_date`
  ).bind(
    item.portalUserIdNorm,
    item.lessonId,
    firstVrAccess,
    now,
    now,
    item.batchKey,
    item.lessonDate
  );

  const releaseStatement = env.DB.prepare(
    `INSERT INTO batch_lesson_releases (
       batch_key,
       lesson_id,
       lesson_date,
       source_row_id,
       first_completed_at,
       last_confirmed_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(batch_key, lesson_id) DO UPDATE SET
       lesson_date = excluded.lesson_date,
       source_row_id = excluded.source_row_id,
       last_confirmed_at = excluded.last_confirmed_at`
  ).bind(
    item.batchKey,
    item.lessonId,
    item.lessonDate,
    item.syncRowId,
    now,
    now
  );

  await env.DB.batch([entitlementStatement, releaseStatement]);

  return result(item.syncRowId, existingEntitlement ? 'CONFIRMED' : 'CREATED', true, {
    operation: 'grant',
    portalUserId: item.portalUserId,
    lessonId: item.lessonId,
    batchKey: item.batchKey,
    lessonDate: item.lessonDate,
    entitlement: existingEntitlement ? 'confirmed' : 'created',
    batchRelease: existingRelease ? 'confirmed' : 'created'
  });
}

async function processItem(env, rawItem) {
  const shape = validateItemShape(rawItem);
  if (shape.error) {
    return result(rawItem?.syncRowId, shape.error, false, { message: shape.message });
  }

  const item = shape.value;
  try {
    const validated = await validateAgainstStores(env, item);
    if (validated.error) {
      return result(item.syncRowId, validated.error, false, {
        portalUserId: item.portalUserId,
        lessonId: item.lessonId,
        batchKey: item.batchKey,
        message: validated.message
      });
    }

    return item.operation === 'status_check'
      ? statusCheck(env, item, validated)
      : grant(env, item, validated);
  } catch {
    return result(item.syncRowId, 'ERROR', false, {
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey,
      message: 'V2 could not process this item. It is safe to retry.'
    });
  }
}

async function handleExcelEntitlementSync(request, env) {
  if (!isDevelopment(env)) {
    return json({ ok: false, error: 'DEVELOPMENT_ONLY' }, 404);
  }

  if (request.headers.get('Origin')) {
    return json({ ok: false, error: 'BROWSER_REQUEST_NOT_ALLOWED' }, 403);
  }

  if (!env?.STUDENTS_KV || !env?.LESSONS_KV || !env?.DB) {
    return json({ ok: false, error: 'SYNC_BINDINGS_UNAVAILABLE' }, 503);
  }

  if (!String(env?.EXCEL_SYNC_TOKEN || '')) {
    return json({ ok: false, error: 'SYNC_NOT_CONFIGURED' }, 503);
  }

  if (!(await authorised(request, env))) {
    return json({ ok: false, error: 'SYNC_UNAUTHORISED' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400);
  }

  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return json({ ok: false, error: 'ITEMS_REQUIRED' }, 400);
  }
  if (body.items.length > MAX_SYNC_ITEMS) {
    return json({ ok: false, error: 'TOO_MANY_ITEMS', maxItems: MAX_SYNC_ITEMS }, 413);
  }

  const results = [];
  for (const item of body.items) {
    results.push(await processItem(env, item));
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

export {
  EXCEL_SYNC_PATH,
  MAX_SYNC_ITEMS,
  normalisePortalUserId,
  validIsoDate,
  validateItemShape,
  batchActiveOnDate,
  isBlocked,
  handleExcelEntitlementSync,
  processItem
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === EXCEL_SYNC_PATH) {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      }
      return handleExcelEntitlementSync(request, env);
    }
    return phase12Worker.fetch(request, env, ctx);
  }
};
