import { VIEW_CURRICULA } from './phase11-navigation-cache.js';

const LIVE_STUDENT_CATALOGUE_OVERLAY_MARKER = 'LIVE_STUDENT_CATALOGUE_OVERLAY_V1';
const PRELESSON_MESSAGE = 'Only PreLesson Sheets are available before the lesson. Other resources will unlock once the lesson starts.';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function rawCatalogueItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.lessonIds)) return raw.lessonIds;
  if (Array.isArray(raw.lessons)) return raw.lessons;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function lessonIdsFromCurriculum(raw) {
  return rawCatalogueItems(raw)
    .map(item => typeof item === 'string' ? clean(item) : clean(item?.lessonId))
    .filter(Boolean);
}

function displayMap(record) {
  for (const source of [record?.displayIds, record?.displayLessonIds, record?.presentation?.displayIds]) {
    if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  }
  return {};
}

function hasView(record, viewId) {
  const wanted = norm(viewId);
  return Object.keys(displayMap(record)).some(key => norm(key) === wanted);
}

function displayLessonId(record, viewId) {
  const source = displayMap(record);
  const wanted = norm(viewId);
  const direct = clean(source[viewId]);
  if (direct) return direct;
  const match = Object.entries(source).find(([key]) => norm(key) === wanted);
  return clean(match?.[1]) || clean(record?.lessonId);
}

function studentTitle(record, shownId) {
  let title = clean(record?.title);
  const canonical = clean(record?.lessonId);
  for (const prefix of [canonical, shownId]) {
    if (!prefix) continue;
    const marker = `${prefix} `;
    if (title.toLowerCase().startsWith(marker.toLowerCase())) title = title.slice(marker.length).trim();
  }
  return title || shownId || canonical;
}

function fullLibraryForView(viewId) {
  const id = norm(viewId);
  let match = id.match(/^maths-level([1-3])$/);
  if (match) return `MATHS_L${match[1]}_FULL`;
  match = id.match(/^maths-year([2-6])$/);
  if (match) return `MATHS_Y${match[1]}_FULL`;
  match = id.match(/^english-year([2-6])(-11plus)?$/);
  if (match) return `ENGLISH_Y${match[1]}${match[2] ? '_11PLUS' : ''}_FULL`;
  return '';
}

function elevenPlusView(viewId) {
  const id = norm(viewId);
  return /^maths-level[1-3]$/.test(id) || /-11plus$/.test(id);
}

function entitlementMatchesView(row, record, viewId) {
  if (!row || !record || !hasView(record, viewId)) return false;
  const batchKey = clean(row.batchKey);
  if (!batchKey) return false;
  return /11/.test(batchKey) === elevenPlusView(viewId);
}

function hasPreLesson(record) {
  const phase11 = record?.phase11Resources;
  return Boolean(
    (Array.isArray(record?.preLessonSheets) && record.preLessonSheets.length) ||
    (Array.isArray(record?.core?.preLessonSheets) && record.core.preLessonSheets.length) ||
    (Array.isArray(phase11?.corePreLessonPairs) && phase11.corePreLessonPairs.length) ||
    (Array.isArray(phase11?.elevenPlus?.preLessonPairs) && phase11.elevenPlus.preLessonPairs.length) ||
    (Array.isArray(record?.vr?.preLesson) && record.vr.preLesson.length)
  );
}

async function liveCatalogueForView(env, viewId) {
  if (!env?.LESSONS_KV) return [];
  const codes = VIEW_CURRICULA[norm(viewId)] || [];
  if (!codes.length) return [];

  const curricula = await Promise.all(codes.map(code => env.LESSONS_KV.get(`curriculum:${code}`, { type:'json' })));
  const lessonIds = [];
  const seen = new Set();
  for (const curriculum of curricula) {
    for (const lessonId of lessonIdsFromCurriculum(curriculum)) {
      if (seen.has(lessonId)) continue;
      seen.add(lessonId);
      lessonIds.push(lessonId);
    }
  }
  if (!lessonIds.length) return [];

  const records = await Promise.all(lessonIds.map(id => env.LESSONS_KV.get(`lesson:${id}`, { type:'json' })));
  const rows = [];
  for (let index = 0; index < lessonIds.length; index += 1) {
    const record = records[index];
    if (!record || record.active === false) continue;
    const shownId = displayLessonId(record, viewId);
    rows.push({
      lessonId: lessonIds[index],
      displayLessonId: shownId,
      title: studentTitle(record, shownId),
      description: String(record?.description || record?.desc || ''),
      record
    });
  }
  return rows;
}

async function sessionUser(request, env, ctx, baseFetch) {
  if (typeof baseFetch !== 'function') return '';
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await baseFetch(new Request(url.toString(), {
    method:'GET',
    headers:request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || body?.accountLocked) return '';
  return norm(body?.portalUserId || body?.student?.portalUserId);
}

async function accessState(env, portalUserIdNorm) {
  const result = {
    fullByLesson: new Map(),
    preByLesson: new Map(),
    blocked: new Set(),
    fullLibraries: new Set()
  };
  if (!portalUserIdNorm) return result;

  const userPromise = env?.STUDENTS_KV
    ? env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type:'json' }).catch(() => null)
    : Promise.resolve(null);

  const accessPromise = env?.DB
    ? Promise.all([
        env.DB.prepare(
          `SELECT lesson_id, source_batch_code
           FROM lesson_entitlements
           WHERE portal_user_id_norm = ? AND core_access = 1`
        ).bind(portalUserIdNorm).all(),
        env.DB.prepare(
          `SELECT lesson_id, batch_key
           FROM online_prelesson_entitlements
           WHERE portal_user_id_norm = ?`
        ).bind(portalUserIdNorm).all()
      ]).catch(() => [])
    : Promise.resolve([]);

  const [user, access] = await Promise.all([userPromise, accessPromise]);
  for (const lessonId of Array.isArray(user?.blockedLessons) ? user.blockedLessons : []) {
    const id = clean(lessonId);
    if (id) result.blocked.add(id);
  }
  for (const library of Array.isArray(user?.fullLibraries) ? user.fullLibraries : []) {
    const id = clean(library).toUpperCase();
    if (id) result.fullLibraries.add(id);
  }

  const [full, pre] = Array.isArray(access) ? access : [];
  for (const row of Array.isArray(full?.results) ? full.results : []) {
    const lessonId = clean(row?.lesson_id);
    if (!lessonId) continue;
    if (!result.fullByLesson.has(lessonId)) result.fullByLesson.set(lessonId, []);
    result.fullByLesson.get(lessonId).push({ batchKey:clean(row?.source_batch_code) });
  }
  for (const row of Array.isArray(pre?.results) ? pre.results : []) {
    const lessonId = clean(row?.lesson_id);
    if (!lessonId) continue;
    if (!result.preByLesson.has(lessonId)) result.preByLesson.set(lessonId, []);
    result.preByLesson.get(lessonId).push({ batchKey:clean(row?.batch_key) });
  }
  return result;
}

function modeForRow(live, existing, viewId, access) {
  if (access.blocked.has(live.lessonId)) return 'blocked';

  const library = fullLibraryForView(viewId);
  if (library && access.fullLibraries.has(library)) return 'full';

  const fullRows = access.fullByLesson.get(live.lessonId) || [];
  if (fullRows.some(row => entitlementMatchesView(row, live.record, viewId))) return 'full';

  // A manual/guest grant can legitimately have no batch key. Only preserve the
  // downstream open result for that specific blank-batch entitlement; never use
  // an open row to override a conflicting normal-vs-11+ batch classification.
  if (
    fullRows.some(row => !clean(row.batchKey)) &&
    existing?.locked === false &&
    existing?.accessMode !== 'prelesson'
  ) return 'full-existing';

  const preRows = access.preByLesson.get(live.lessonId) || [];
  if (preRows.some(row => entitlementMatchesView(row, live.record, viewId))) return 'prelesson';
  if (
    preRows.some(row => !clean(row.batchKey)) &&
    existing?.locked === false &&
    existing?.accessMode === 'prelesson'
  ) return 'prelesson-existing';

  return 'locked';
}

function repairedRow(live, existing, viewId, access) {
  const metadata = {
    ...(existing || {}),
    lessonId:live.lessonId,
    displayLessonId:live.displayLessonId,
    title:live.title,
    description:live.description || existing?.description || ''
  };
  const mode = modeForRow(live, existing, viewId, access);

  if (mode === 'blocked') {
    return { ...metadata, state:'locked', locked:true, blocked:true, preview:false, missedPreview:false };
  }
  if (mode === 'full' || mode === 'full-existing') {
    return { ...metadata, state:'open', locked:false, blocked:false, preview:false, missedPreview:false, accessMode:'full' };
  }
  if (mode === 'prelesson-existing') {
    return metadata;
  }
  if (mode === 'prelesson') {
    const available = hasPreLesson(live.record);
    return {
      ...metadata,
      state:available ? 'prelesson' : 'prelesson-empty',
      locked:!available,
      blocked:false,
      preview:false,
      missedPreview:false,
      accessMode:'prelesson',
      accessMessage:PRELESSON_MESSAGE,
      preLessonAvailable:available,
      clickable:available,
      availabilityLabel:available ? 'PreLesson Sheets only' : 'No PreLesson Sheets'
    };
  }
  return { ...metadata, state:'locked', locked:true, blocked:false, preview:false, missedPreview:false };
}

function responseLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-fpt-catalogue-authority', 'live-kv-v1');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

function pathViewId(url) {
  const match = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
  if (!match) return '';
  try { return norm(decodeURIComponent(match[1])); } catch { return ''; }
}

async function repairLiveStudentCatalogueResponse(request, env, ctx, response, baseFetch) {
  try {
    if (request.method !== 'GET' || !response?.ok) return response;
    const url = new URL(request.url);
    const viewId = pathViewId(url);
    if (!viewId) return response;

    const body = await response.clone().json().catch(() => null);
    if (!body?.ok || !Array.isArray(body.lessons)) return response;

    const live = await liveCatalogueForView(env, viewId);
    if (!live.length) return response;
    const portalUserIdNorm = await sessionUser(request, env, ctx, baseFetch);
    if (!portalUserIdNorm) return response;
    const access = await accessState(env, portalUserIdNorm);
    const existing = new Map(
      body.lessons.filter(row => row?.lessonId).map(row => [clean(row.lessonId), row])
    );

    body.lessons = live.map(row => repairedRow(row, existing.get(row.lessonId), viewId, access));
    if (body.view && typeof body.view === 'object') {
      body.view.catalogueAvailable = true;
      body.view.visibleLessonCount = body.lessons.length;
      body.view.openLessonCount = body.lessons.filter(row => row?.locked === false).length;
      body.view.lockedLessonCount = body.lessons.filter(row => row?.locked !== false).length;
    }
    return responseLike(response, body);
  } catch (error) {
    console.warn('Live catalogue overlay failed; preserving base response.', error?.message || error);
    return response;
  }
}

export {
  LIVE_STUDENT_CATALOGUE_OVERLAY_MARKER,
  lessonIdsFromCurriculum,
  displayLessonId,
  studentTitle,
  fullLibraryForView,
  entitlementMatchesView,
  liveCatalogueForView,
  repairLiveStudentCatalogueResponse
};
