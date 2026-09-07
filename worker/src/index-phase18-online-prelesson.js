import phase17Worker from './index-phase17.js';
import {
  processItem as processPhase13Item,
  validateItemShape as validatePhase13ItemShape
} from './index-phase13.js';

const EXCEL_SYNC_PATH = '/api/v1/admin/excel-entitlements/sync';
const MAX_SYNC_ITEMS = 1000;
const PRELESSON_MESSAGE = 'Only PreLesson Sheets available to download and print. Other resources will be unlocked once the lesson is marked Completed.';
const PRELESSON_DOWNLOAD_KINDS = new Set(['pre', 'p11corepre', 'p11elevenpre', 'vrpre']);

function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
  if (!origin || !allowed.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type,Content-Disposition',
    Vary: 'Origin'
  };
}

const clean = value => String(value ?? '').trim();
const normaliseUser = value => clean(value).toLowerCase();
const onlineBatch = batchKey => clean(batchKey).toUpperCase().includes('O');

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
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
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

function validateSyncItem(raw) {
  const originalOperation = clean(raw?.operation).toLowerCase();
  const prelesson = originalOperation === 'prelesson_grant' || originalOperation === 'prelesson_status_check';
  const translated = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, operation: originalOperation === 'prelesson_status_check' ? 'status_check' : (prelesson ? 'grant' : originalOperation) }
    : raw;
  const shape = validatePhase13ItemShape(translated);
  if (shape.error) return shape;
  if (prelesson && !onlineBatch(shape.value.batchKey)) {
    return { error: 'PRELESSON_ONLINE_BATCH_REQUIRED', message: 'PreLesson-only access is permitted only when Batch ID contains O.' };
  }
  return { value: { ...shape.value, operation: originalOperation } };
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

function validationPassed(status) {
  return status === 'ENTITLEMENT_MISSING' || status === 'BATCH_RELEASE_MISSING' || status === 'CONFIRMED';
}

async function prelessonVrAccess(env, item) {
  const [student, lesson, batch] = await Promise.all([
    env.STUDENTS_KV.get(`user:${item.portalUserIdNorm}`, { type: 'json' }),
    env.LESSONS_KV.get(`lesson:${item.lessonId}`, { type: 'json' }),
    env.DB.prepare(`SELECT stream FROM batch_definitions WHERE batch_key = ?`).bind(item.batchKey).first()
  ]);
  return clean(lesson?.subject).toLowerCase() === 'english' &&
    clean(batch?.stream).toLowerCase() === '11plus' && student?.vrEligible === true ? 1 : 0;
}

async function processPrelessonItem(env, item) {
  const probe = await processPhase13Item(env, { ...item, operation: 'status_check' });
  if (!validationPassed(probe.status)) return probe;
  if (probe.status === 'CONFIRMED') {
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
        portalUserId: item.portalUserId, lessonId: item.lessonId, batchKey: item.batchKey
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
  const vrAccess = await prelessonVrAccess(env, item);
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
  ).bind(item.portalUserIdNorm, item.lessonId, item.batchKey, item.lessonDate, vrAccess,
    item.syncRowId, now, now).run();

  return syncResult(item.syncRowId, existing ? 'CONFIRMED' : 'CREATED', true, {
    operation: item.operation,
    portalUserId: item.portalUserId,
    lessonId: item.lessonId,
    batchKey: item.batchKey,
    lessonDate: item.lessonDate,
    accessMode: 'prelesson'
  });
}

async function processSyncItem(env, rawItem) {
  const shape = validateSyncItem(rawItem);
  if (shape.error) return syncResult(rawItem?.syncRowId, shape.error, false, { message: shape.message });
  const item = shape.value;
  try {
    if (item.operation === 'prelesson_grant' || item.operation === 'prelesson_status_check') {
      return await processPrelessonItem(env, item);
    }
    const result = await processPhase13Item(env, item);
    if (item.operation === 'grant' && result.ok) await clearPrelesson(env, item);
    return result;
  } catch {
    return syncResult(item.syncRowId, 'ERROR', false, {
      portalUserId: item.portalUserId,
      lessonId: item.lessonId,
      batchKey: item.batchKey,
      message: 'V2 could not process this item. It is safe to retry.'
    });
  }
}

async function handleExcelSync(request, env) {
  if (request.headers.get('Origin')) return json({ ok: false, error: 'BROWSER_REQUEST_NOT_ALLOWED' }, { status: 403 });
  if (!env?.STUDENTS_KV || !env?.LESSONS_KV || !env?.DB) return json({ ok: false, error: 'SYNC_BINDINGS_UNAVAILABLE' }, { status: 503 });
  if (!String(env?.EXCEL_SYNC_TOKEN || '')) return json({ ok: false, error: 'SYNC_NOT_CONFIGURED' }, { status: 503 });
  if (!(await syncAuthorised(request, env))) return json({ ok: false, error: 'SYNC_UNAUTHORISED' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'INVALID_JSON' }, { status: 400 }); }
  if (!Array.isArray(body?.items) || body.items.length === 0) return json({ ok: false, error: 'ITEMS_REQUIRED' }, { status: 400 });
  if (body.items.length > MAX_SYNC_ITEMS) return json({ ok: false, error: 'TOO_MANY_ITEMS', maxItems: MAX_SYNC_ITEMS }, { status: 413 });

  const results = [];
  for (const item of body.items) results.push(await processSyncItem(env, item));
  return json({ ok: true, results, summary: {
    total: results.length,
    succeeded: results.filter(item => item.ok).length,
    blocked: results.filter(item => item.status === 'BLOCKED').length,
    failed: results.filter(item => !item.ok && item.status !== 'BLOCKED').length
  }});
}

function parseJson(response) { return response.clone().json().catch(() => null); }

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

async function sessionUser(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await phase17Worker.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  const body = await parseJson(response);
  if (!response.ok || !body?.ok || body.accountLocked) return '';
  return normaliseUser(body.portalUserId);
}

async function rowsForUser(env, portalUserIdNorm) {
  if (!portalUserIdNorm) return [];
  try {
    const result = await env.DB.prepare(
      `SELECT lesson_id, batch_key, lesson_date, vr_access
       FROM online_prelesson_entitlements
       WHERE portal_user_id_norm = ? ORDER BY lesson_date, lesson_id`
    ).bind(portalUserIdNorm).all();
    return Array.isArray(result?.results) ? result.results : [];
  } catch { return []; }
}

function overlayStudentKv(env, portalUserIdNorm, rows, includeVr = false) {
  if (!env?.STUDENTS_KV || !rows.length) return env;
  const coreIds = [...new Set(rows.map(row => clean(row.lesson_id)).filter(Boolean))];
  const vrIds = includeVr
    ? [...new Set(rows.filter(row => Number(row.vr_access) === 1).map(row => clean(row.lesson_id)).filter(Boolean))]
    : [];
  const source = env.STUDENTS_KV;
  const kv = new Proxy(source, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        if (value == null || String(key || '').toLowerCase() !== `user:${portalUserIdNorm}`) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) { try { user = JSON.parse(String(value)); } catch { return value; } }
        const manual = user?.manualAccess || {};
        const coreLessons = [...new Set([...(Array.isArray(manual.coreLessons) ? manual.coreLessons.map(String) : []), ...coreIds])];
        const vrLessons = [...new Set([...(Array.isArray(manual.vrLessons) ? manual.vrLessons.map(String) : []), ...vrIds])];
        const overlaid = { ...user, manualAccess: { ...manual, coreLessons, vrLessons } };
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function lockResource(resource) {
  if (!resource) return null;
  return {
    displayName: resource.displayName,
    available: false,
    locked: true,
    protected: Boolean(resource.protected),
    passwordRequired: Boolean(resource.protected || resource.passwordRequired)
  };
}

const lockHomeworkPair = pair => pair ? { ...pair, homework: lockResource(pair.homework), answerPack: lockResource(pair.answerPack) } : null;
const keepPrelessonPrimary = pair => pair ? { ...pair, primary: pair.primary || null, answerPack: lockResource(pair.answerPack) } : null;
const lockPrimaryPair = pair => pair ? { ...pair, primary: lockResource(pair.primary), answerPack: lockResource(pair.answerPack) } : null;

function restrictLessonToPrelesson(lesson) {
  if (!lesson) return lesson;
  const restricted = {
    ...lesson,
    state: 'prelesson',
    locked: false,
    accessMode: 'prelesson',
    accessMessage: PRELESSON_MESSAGE,
    video: lockResource(lesson.video),
    homeworks: Array.isArray(lesson.homeworks) ? lesson.homeworks.map(lockHomeworkPair) : [],
    otherResources: Array.isArray(lesson.otherResources) ? lesson.otherResources.map(lockResource) : []
  };
  if (lesson.quiz) restricted.quiz = lockResource(lesson.quiz);
  if (lesson.vr) {
    restricted.vr = {
      ...lesson.vr,
      preLesson: Array.isArray(lesson.vr.preLesson) ? lesson.vr.preLesson.map(pair => ({
        ...pair, sheet: pair?.sheet || null, answerKey: lockResource(pair?.answerKey)
      })) : [],
      preLessonVideo: lockResource(lesson.vr.preLessonVideo),
      homeworks: Array.isArray(lesson.vr.homeworks) ? lesson.vr.homeworks.map(lockHomeworkPair) : [],
      homeworkVideo: lockResource(lesson.vr.homeworkVideo)
    };
  }
  const p11 = lesson.phase11Resources;
  if (p11) {
    restricted.phase11Resources = {
      ...p11,
      corePreLessonPairs: Array.isArray(p11.corePreLessonPairs) ? p11.corePreLessonPairs.map(keepPrelessonPrimary) : [],
      coreCumulativeHomeworks: Array.isArray(p11.coreCumulativeHomeworks) ? p11.coreCumulativeHomeworks.map(lockPrimaryPair) : [],
      coreSupplementaryAnswers: Array.isArray(p11.coreSupplementaryAnswers) ? p11.coreSupplementaryAnswers.map(lockResource) : [],
      elevenPlus: p11.elevenPlus ? {
        ...p11.elevenPlus,
        preLessonPairs: Array.isArray(p11.elevenPlus.preLessonPairs) ? p11.elevenPlus.preLessonPairs.map(keepPrelessonPrimary) : [],
        homeworks: Array.isArray(p11.elevenPlus.homeworks) ? p11.elevenPlus.homeworks.map(lockPrimaryPair) : [],
        cumulativeHomeworks: Array.isArray(p11.elevenPlus.cumulativeHomeworks) ? p11.elevenPlus.cumulativeHomeworks.map(lockPrimaryPair) : [],
        supplementaryAnswers: Array.isArray(p11.elevenPlus.supplementaryAnswers) ? p11.elevenPlus.supplementaryAnswers.map(lockResource) : []
      } : null,
      vrSupplementaryAnswers: Array.isArray(p11.vrSupplementaryAnswers) ? p11.vrSupplementaryAnswers.map(lockResource) : []
    };
  }
  if (lesson.phase11OtherResources) {
    restricted.phase11OtherResources = {
      ...lesson.phase11OtherResources,
      elevenPlus: Array.isArray(lesson.phase11OtherResources.elevenPlus)
        ? lesson.phase11OtherResources.elevenPlus.map(lockResource) : []
    };
  }
  return restricted;
}

async function handleHome(request, env, ctx) {
  const baseResponse = await phase17Worker.fetch(request, env, ctx);
  if (!baseResponse.ok) return baseResponse;
  const body = await parseJson(baseResponse);
  const portalUserIdNorm = normaliseUser(body?.student?.portalUserId);
  if (!portalUserIdNorm) return baseResponse;
  const rows = await rowsForUser(env, portalUserIdNorm);
  if (!rows.length) return baseResponse;
  return phase17Worker.fetch(request, overlayStudentKv(env, portalUserIdNorm, rows), ctx);
}

async function handleLessonList(request, env, ctx) {
  const [baseResponse, portalUserIdNorm] = await Promise.all([
    phase17Worker.fetch(request, env, ctx),
    sessionUser(request, env, ctx)
  ]);
  if (!baseResponse.ok || !portalUserIdNorm) return baseResponse;
  const [baseBody, rows] = await Promise.all([parseJson(baseResponse), rowsForUser(env, portalUserIdNorm)]);
  if (!baseBody?.ok || !Array.isArray(baseBody.lessons) || !rows.length) return baseResponse;

  const preIds = new Set(rows.map(row => clean(row.lesson_id)));
  const overlayResponse = await phase17Worker.fetch(request, overlayStudentKv(env, portalUserIdNorm, rows), ctx);
  if (!overlayResponse.ok) return baseResponse;
  const overlayBody = await parseJson(overlayResponse);
  if (!overlayBody?.ok || !Array.isArray(overlayBody.lessons)) return baseResponse;

  const overlayById = new Map(overlayBody.lessons.map(lesson => [String(lesson?.lessonId || ''), lesson]));
  const baseIds = new Set(baseBody.lessons.map(lesson => String(lesson?.lessonId || '')));
  baseBody.lessons = baseBody.lessons.map(lesson => {
    const id = String(lesson?.lessonId || '');
    if (!preIds.has(id) || lesson?.locked === false) return lesson;
    const candidate = overlayById.get(id);
    return candidate?.locked === false
      ? { ...candidate, state: 'prelesson', locked: false, accessMode: 'prelesson', accessMessage: PRELESSON_MESSAGE }
      : lesson;
  });
  for (const id of preIds) {
    if (baseIds.has(id)) continue;
    const candidate = overlayById.get(id);
    if (candidate?.locked === false) {
      baseBody.lessons.push({ ...candidate, state: 'prelesson', locked: false, accessMode: 'prelesson', accessMessage: PRELESSON_MESSAGE });
    }
  }
  return jsonLike(baseResponse, baseBody);
}

async function handleLessonDetail(request, env, ctx, lessonId) {
  const baseResponse = await phase17Worker.fetch(request, env, ctx);
  const baseBody = await parseJson(baseResponse);
  if (baseResponse.ok && baseBody?.lesson?.locked === false) return baseResponse;
  const portalUserIdNorm = await sessionUser(request, env, ctx);
  if (!portalUserIdNorm) return baseResponse;
  const rows = (await rowsForUser(env, portalUserIdNorm)).filter(row => clean(row.lesson_id) === lessonId);
  if (!rows.length) return baseResponse;
  const response = await phase17Worker.fetch(request, overlayStudentKv(env, portalUserIdNorm, rows, true), ctx);
  const body = await parseJson(response);
  if (!response.ok || !body?.ok || !body.lesson || body.lesson.locked) return baseResponse;
  body.lesson = restrictLessonToPrelesson(body.lesson);
  return jsonLike(response, body);
}

function parseResourceRequest(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)(?:\/(download|video|quiz)|\/answer\/authorize)?$/);
  if (!match) return null;
  let resourceKey = '';
  try { resourceKey = decodeURIComponent(match[1]); } catch { return null; }
  const parts = resourceKey.split('~');
  if (parts.length !== 3) return null;
  let lessonId = '';
  try { lessonId = decodeURIComponent(parts[0]); } catch { return null; }
  const kind = String(parts[1] || '');
  const index = Number(parts[2]);
  if (!lessonId || !kind || !Number.isInteger(index) || index < 1) return null;
  return { lessonId, kind, action: match[2] || (url.pathname.endsWith('/answer/authorize') ? 'authorize' : 'direct') };
}

async function hasNormalFullAccess(request, env, ctx, lessonId, viewId) {
  if (!viewId) return false;
  const url = new URL(request.url);
  url.pathname = `/api/v1/student/lessons/${encodeURIComponent(lessonId)}`;
  url.search = `?viewId=${encodeURIComponent(viewId)}`;
  const response = await phase17Worker.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  const body = await parseJson(response);
  return Boolean(response.ok && body?.ok && body?.lesson && body.lesson.locked === false);
}

async function handleResourceRequest(request, env, ctx, parsed) {
  const portalUserIdNorm = await sessionUser(request, env, ctx);
  if (!portalUserIdNorm) return phase17Worker.fetch(request, env, ctx);
  const rows = (await rowsForUser(env, portalUserIdNorm)).filter(row => clean(row.lesson_id) === parsed.lessonId);
  if (!rows.length) return phase17Worker.fetch(request, env, ctx);

  const viewId = clean(new URL(request.url).searchParams.get('viewId'));
  if (await hasNormalFullAccess(request, env, ctx, parsed.lessonId, viewId)) {
    return phase17Worker.fetch(request, env, ctx);
  }
  if (request.method === 'GET' && parsed.action === 'download' && PRELESSON_DOWNLOAD_KINDS.has(parsed.kind)) {
    return phase17Worker.fetch(request, overlayStudentKv(env, portalUserIdNorm, rows, true), ctx);
  }
  return json({ error: 'PRELESSON_ONLY', message: PRELESSON_MESSAGE }, {
    status: 403,
    headers: corsHeaders(request, env)
  });
}

export {
  PRELESSON_MESSAGE,
  PRELESSON_DOWNLOAD_KINDS,
  onlineBatch,
  validateSyncItem,
  processSyncItem,
  restrictLessonToPrelesson,
  parseResourceRequest
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === EXCEL_SYNC_PATH && request.method === 'POST') return handleExcelSync(request, env);

    const disableLegacyPrelessonOverlay = env?.PHASE20_DISABLE_LEGACY_PRELESSON_OVERLAY === true;
    if (disableLegacyPrelessonOverlay) {
      const isStudentHome = request.method === 'GET' && url.pathname === '/api/v1/student/home';
      const isStudentList = request.method === 'GET' && /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname);
      const isStudentDetail = request.method === 'GET' && /^\/api\/v1\/student\/lessons\/[^/]+$/.test(url.pathname);
      const isStudentResource = /^\/api\/v1\/student\/resources\//.test(url.pathname);
      if (isStudentHome || isStudentList || isStudentDetail || isStudentResource) {
        return phase17Worker.fetch(request, env, ctx);
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/student/home') return handleHome(request, env, ctx);
    if (request.method === 'GET' && /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) return handleLessonList(request, env, ctx);

    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    if (lessonMatch && request.method === 'GET') return handleLessonDetail(request, env, ctx, decodeURIComponent(lessonMatch[1]));

    const resource = parseResourceRequest(url);
    if (resource) return handleResourceRequest(request, env, ctx, resource);
    return phase17Worker.fetch(request, env, ctx);
  }
};
