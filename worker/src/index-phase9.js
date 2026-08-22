import phase8Worker from './index-phase8.js';

const VR_PRE_ANSWER_INDEX_BASE = 1000;
const VR_HOMEWORK_ANSWER_INDEX_BASE = 2000;
const VR_INDEX_SPAN = 999;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ]);
}

function browserOriginAllowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  return !origin || allowedOrigins(env).has(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

function normalisePortalUserId(value) {
  return String(value || '').trim().toLowerCase();
}

function safeFilename(value, fallback = 'document.pdf') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

async function sha256Bytes(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
}

async function sha256Hex(value) {
  const bytes = await sha256Bytes(value);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function makeResourceKey(lessonId, kind, index) {
  return `${encodeURIComponent(String(lessonId))}~${kind}~${index}`;
}

function parseResourceKey(resourceKey) {
  const parts = String(resourceKey || '').split('~');
  if (parts.length !== 3) return null;

  let lessonId = '';
  try {
    lessonId = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }

  const kind = String(parts[1] || '');
  const index = Number(parts[2]);
  if (!lessonId || !Number.isInteger(index) || index < 1) return null;
  return { lessonId, kind, index };
}

function presentationForView(viewId) {
  const id = String(viewId || '').trim().toLowerCase();
  if (/^english-year[45]-11plus$/.test(id)) return '11plus';
  if (/^maths-level[123]$/.test(id)) return '11plus';
  return 'normal';
}

function isEnglishElevenPlusView(viewId, view = null) {
  return (
    String(view?.subject || '').toLowerCase() === 'english' &&
    presentationForView(viewId) === '11plus'
  );
}

function isVrPreAnswerIndex(index) {
  return index > VR_PRE_ANSWER_INDEX_BASE && index <= VR_PRE_ANSWER_INDEX_BASE + VR_INDEX_SPAN;
}

function isVrHomeworkAnswerIndex(index) {
  return index > VR_HOMEWORK_ANSWER_INDEX_BASE && index <= VR_HOMEWORK_ANSWER_INDEX_BASE + VR_INDEX_SPAN;
}

function isVrProtectedAnswerKey(parsed) {
  return Boolean(
    parsed?.kind === 'answer' &&
    (isVrPreAnswerIndex(parsed.index) || isVrHomeworkAnswerIndex(parsed.index))
  );
}

function coreHomeworks(record) {
  if (Array.isArray(record?.homeworks)) return record.homeworks;
  if (Array.isArray(record?.core?.homeworks)) return record.core.homeworks;
  return [];
}

function normaliseVr(record) {
  const vr = record?.vr;
  if (!vr || typeof vr !== 'object') return null;

  const preLesson = Array.isArray(vr.preLesson) ? vr.preLesson : [];
  const homeworks = Array.isArray(vr.homeworks) ? vr.homeworks : [];

  const normaliseVideo = value => {
    if (!value) return null;
    if (typeof value === 'string') {
      const screenpal = value.trim();
      return screenpal ? { screenpal } : null;
    }
    const screenpal = String(value.screenpal || value.sp || '').trim();
    return screenpal ? { screenpal } : null;
  };

  return {
    preLesson: preLesson.map((item, index) => {
      const answerKey = item?.answerKey || null;
      return {
        index: index + 1,
        sheet: item
          ? {
              displayName: String(item.displayName || item.name || `VR PreLesson Sheet ${index + 1}`),
              r2Key: String(item.r2Key || item.r2 || '').trim()
            }
          : null,
        answerKey: answerKey
          ? {
              displayName: String(answerKey.displayName || answerKey.name || `VR PreLesson Answer Key ${index + 1}`),
              r2Key: String(answerKey.r2Key || answerKey.r2 || '').trim()
            }
          : null
      };
    }),
    preLessonVideo: normaliseVideo(vr.preLessonVideo),
    homeworks: homeworks.map((pair, index) => {
      const homework = pair?.homework || (pair?.r2Key || pair?.r2 ? pair : null);
      const answerPack = pair?.answerPack || null;
      return {
        index: index + 1,
        homework: homework
          ? {
              displayName: String(homework.displayName || homework.name || pair?.name || `VR Homework ${index + 1}`),
              r2Key: String(homework.r2Key || homework.r2 || '').trim()
            }
          : null,
        answerPack: answerPack
          ? {
              displayName: String(answerPack.displayName || answerPack.name || `VR Homework Answer Pack ${index + 1}`),
              r2Key: String(answerPack.r2Key || answerPack.r2 || '').trim()
            }
          : null
      };
    }),
    homeworkVideo: normaliseVideo(vr.homeworkVideo)
  };
}

function vrHasContent(vr) {
  if (!vr) return false;
  return Boolean(
    vr.preLesson.some(pair => pair.sheet?.r2Key || pair.answerKey?.r2Key) ||
    vr.preLessonVideo?.screenpal ||
    vr.homeworks.some(pair => pair.homework?.r2Key || pair.answerPack?.r2Key) ||
    vr.homeworkVideo?.screenpal
  );
}

function canonicalVideo(record) {
  return record?.video || record?.core?.video || null;
}

function quizReference(record) {
  const video = canonicalVideo(record);
  if (!video || typeof video !== 'object') return null;
  const value = video.quiz;
  if (!value) return null;

  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    return {
      id: raw,
      embedUrl: String(video.quizEmbedUrl || '').trim() || null,
      shareUrl: String(video.quizShareUrl || '').trim() || null,
      displayName: String(video.quizDisplayName || 'ScreenPal Quiz').trim() || 'ScreenPal Quiz'
    };
  }

  if (typeof value !== 'object') return null;
  const id = String(value.id || value.quizId || value.ref || '').trim();
  const embedUrl = String(value.embedUrl || video.quizEmbedUrl || '').trim();
  const shareUrl = String(value.shareUrl || value.url || video.quizShareUrl || '').trim();
  if (!id && !embedUrl && !shareUrl) return null;
  return {
    id: id || null,
    embedUrl: embedUrl || null,
    shareUrl: shareUrl || null,
    displayName: String(value.displayName || value.name || 'ScreenPal Quiz').trim() || 'ScreenPal Quiz'
  };
}

function safeAbsoluteScreenPalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (!['screenpal.com', 'www.screenpal.com', 'go.screenpal.com'].includes(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function quizOpenTarget(reference) {
  if (!reference) return null;
  const embedUrl = safeAbsoluteScreenPalUrl(reference.embedUrl);
  if (embedUrl) return { mode: 'embed', url: embedUrl };

  const shareUrl = safeAbsoluteScreenPalUrl(reference.shareUrl);
  if (shareUrl) return { mode: 'link', url: shareUrl };

  // A bare quiz ID is intentionally not converted into a guessed URL. ScreenPal's
  // supported workflow is to copy a direct link or website embed code.
  const idAsUrl = safeAbsoluteScreenPalUrl(reference.id);
  if (idAsUrl) return { mode: 'link', url: idAsUrl };
  return null;
}

async function requestPhase8Json(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  const internalRequest = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await phase8Worker.fetch(internalRequest, env);
  let body = null;
  try {
    body = await response.json();
  } catch (_) {}
  return { response, body };
}

async function sessionSummary(request, env) {
  const { response, body } = await requestPhase8Json(request, env, '/api/v1/student/session');
  if (!response.ok || !body?.ok) {
    return { error: body?.error || 'SESSION_INVALID', status: response.status || 401 };
  }
  if (body.accountLocked) return { error: 'ACCOUNT_LOCKED', status: 403 };
  return {
    portalUserIdNorm: normalisePortalUserId(body.portalUserId),
    firstName: String(body.firstName || '')
  };
}

async function visibleLessonContext(request, env, viewId, lessonId) {
  if (!viewId) return { error: 'VIEW_REQUIRED', status: 400 };
  const path = `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`;
  const { response, body } = await requestPhase8Json(request, env, path);
  if (!response.ok || !body?.ok) {
    return { error: body?.error || 'LESSON_ACCESS_CHECK_FAILED', status: response.status || 500 };
  }

  const visible = (Array.isArray(body.lessons) ? body.lessons : [])
    .find(item => String(item?.lessonId || '') === String(lessonId));
  if (!visible) return { error: 'LESSON_NOT_VISIBLE', status: 404 };

  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return { error: 'LESSON_NOT_FOUND', status: 404 };

  return {
    visible,
    record,
    view: {
      ...(body.view || {}),
      presentation: presentationForView(viewId)
    }
  };
}

function fullLibraryGrantsVr(user, viewId) {
  const libraries = new Set(
    Array.isArray(user?.fullLibraries)
      ? user.fullLibraries.map(value => String(value || '').trim().toUpperCase()).filter(Boolean)
      : []
  );
  const id = String(viewId || '').toLowerCase();
  if (id === 'english-year4-11plus') return libraries.has('ENGLISH_Y4_11PLUS_FULL');
  if (id === 'english-year5-11plus') return libraries.has('ENGLISH_Y5_11PLUS_FULL');
  return false;
}

async function vrEntitlement(request, env, viewId, lessonId) {
  const session = await sessionSummary(request, env);
  if (session.error) return session;

  const [row, user] = await Promise.all([
    env.DB.prepare(
      `SELECT vr_access
       FROM lesson_entitlements
       WHERE portal_user_id_norm = ? AND lesson_id = ?`
    )
      .bind(session.portalUserIdNorm, lessonId)
      .first(),
    env.STUDENTS_KV.get(`user:${session.portalUserIdNorm}`, { type: 'json' })
  ]);

  if (!user) return { error: 'SESSION_INVALID', status: 401 };

  const manualVr = new Set(
    Array.isArray(user?.manualAccess?.vrLessons)
      ? user.manualAccess.vrLessons.map(value => String(value || '').trim()).filter(Boolean)
      : []
  );

  return {
    entitled:
      Number(row?.vr_access) === 1 ||
      manualVr.has(String(lessonId)) ||
      fullLibraryGrantsVr(user, viewId),
    portalUserIdNorm: session.portalUserIdNorm
  };
}

async function r2Available(env, r2Key) {
  if (!r2Key) return false;
  try {
    return Boolean(await env.MATERIALS_R2.head(r2Key));
  } catch {
    return false;
  }
}

function lockedFile(displayName, protectedResource = false) {
  return {
    displayName,
    locked: true,
    protected: protectedResource,
    passwordRequired: protectedResource
  };
}

function openFile(displayName, resourceKey, available, protectedResource = false) {
  return {
    displayName,
    resourceKey: available ? resourceKey : undefined,
    available,
    locked: false,
    protected: protectedResource,
    passwordRequired: protectedResource
  };
}

function lockedVideo(displayName) {
  return { displayName, locked: true };
}

function openVideo(displayName, resourceKey) {
  return { displayName, resourceKey, locked: false };
}

async function safeVrModel(env, lessonId, vr, locked) {
  if (!vrHasContent(vr)) return null;

  if (locked) {
    return {
      preLesson: vr.preLesson.map(pair => ({
        sheet: pair.sheet?.r2Key ? lockedFile(pair.sheet.displayName) : null,
        answerKey: pair.answerKey?.r2Key ? lockedFile(pair.answerKey.displayName, true) : null
      })),
      preLessonVideo: vr.preLessonVideo?.screenpal ? lockedVideo('VR PreLesson Video') : null,
      homeworks: vr.homeworks.map(pair => ({
        homework: pair.homework?.r2Key ? lockedFile(pair.homework.displayName) : null,
        answerPack: pair.answerPack?.r2Key ? lockedFile(pair.answerPack.displayName, true) : null
      })),
      homeworkVideo: vr.homeworkVideo?.screenpal ? lockedVideo('VR Homework Solution Video') : null
    };
  }

  const preLesson = await Promise.all(vr.preLesson.map(async pair => {
    const [sheetAvailable, answerAvailable] = await Promise.all([
      r2Available(env, pair.sheet?.r2Key),
      r2Available(env, pair.answerKey?.r2Key)
    ]);
    return {
      sheet: pair.sheet?.r2Key
        ? openFile(pair.sheet.displayName, makeResourceKey(lessonId, 'vrpre', pair.index), sheetAvailable)
        : null,
      answerKey: pair.answerKey?.r2Key
        ? openFile(
            pair.answerKey.displayName,
            makeResourceKey(lessonId, 'answer', VR_PRE_ANSWER_INDEX_BASE + pair.index),
            answerAvailable,
            true
          )
        : null
    };
  }));

  const homeworks = await Promise.all(vr.homeworks.map(async pair => {
    const [homeworkAvailable, answerAvailable] = await Promise.all([
      r2Available(env, pair.homework?.r2Key),
      r2Available(env, pair.answerPack?.r2Key)
    ]);
    return {
      homework: pair.homework?.r2Key
        ? openFile(pair.homework.displayName, makeResourceKey(lessonId, 'vrhomework', pair.index), homeworkAvailable)
        : null,
      answerPack: pair.answerPack?.r2Key
        ? openFile(
            pair.answerPack.displayName,
            makeResourceKey(lessonId, 'answer', VR_HOMEWORK_ANSWER_INDEX_BASE + pair.index),
            answerAvailable,
            true
          )
        : null
    };
  }));

  return {
    preLesson,
    preLessonVideo: vr.preLessonVideo?.screenpal
      ? openVideo('VR PreLesson Video', makeResourceKey(lessonId, 'vrprevideo', 1))
      : null,
    homeworks,
    homeworkVideo: vr.homeworkVideo?.screenpal
      ? openVideo('VR Homework Solution Video', makeResourceKey(lessonId, 'vrhomeworkvideo', 1))
      : null
  };
}

function safeQuizModel(lessonId, reference, locked) {
  if (!reference) return null;
  if (locked) return { displayName: reference.displayName || 'ScreenPal Quiz', locked: true };
  return {
    displayName: reference.displayName || 'ScreenPal Quiz',
    resourceKey: makeResourceKey(lessonId, 'quiz', 1),
    locked: false
  };
}

async function augmentLessonList(request, env, viewId) {
  const response = await phase8Worker.fetch(request, env);
  let body = null;
  try {
    body = await response.json();
  } catch {
    return response;
  }
  if (!body?.ok || !body.view) return jsonLike(response, body);
  body.view.presentation = presentationForView(viewId);
  return jsonLike(response, body);
}

async function augmentLessonDetail(request, env, lessonId) {
  const response = await phase8Worker.fetch(request, env);
  let body = null;
  try {
    body = await response.json();
  } catch {
    return response;
  }
  if (!response.ok || !body?.ok || !body.lesson) return jsonLike(response, body);

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await visibleLessonContext(request, env, viewId, lessonId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: corsHeaders(request, env) });

  const presentation = context.view.presentation;
  body.lesson.presentation = presentation;

  const reference = quizReference(context.record);
  body.lesson.quiz = presentation === '11plus'
    ? safeQuizModel(lessonId, reference, Boolean(body.lesson.locked))
    : null;

  const vr = normaliseVr(context.record);
  body.lesson.vr = null;

  if (isEnglishElevenPlusView(viewId, context.view) && vrHasContent(vr)) {
    if (body.lesson.locked) {
      // Locked 11+ cross-subject previews may show the real VR structure, but never usable keys.
      body.lesson.vr = await safeVrModel(env, lessonId, vr, true);
    } else {
      const access = await vrEntitlement(request, env, viewId, lessonId);
      if (access.error) {
        return json({ error: access.error }, { status: access.status, headers: corsHeaders(request, env) });
      }
      if (access.entitled) body.lesson.vr = await safeVrModel(env, lessonId, vr, false);
    }
  }

  return jsonLike(response, body);
}

function vrResourceFromRecord(record, parsed) {
  const vr = normaliseVr(record);
  if (!vr || !parsed) return null;

  if (parsed.kind === 'vrpre') {
    const pair = vr.preLesson[parsed.index - 1];
    if (!pair?.sheet?.r2Key) return null;
    return { type: 'download', displayName: pair.sheet.displayName, r2Key: pair.sheet.r2Key };
  }

  if (parsed.kind === 'vrhomework') {
    const pair = vr.homeworks[parsed.index - 1];
    if (!pair?.homework?.r2Key) return null;
    return { type: 'download', displayName: pair.homework.displayName, r2Key: pair.homework.r2Key };
  }

  if (parsed.kind === 'vrprevideo' && parsed.index === 1 && vr.preLessonVideo?.screenpal) {
    return { type: 'video', displayName: 'VR PreLesson Video', screenpal: vr.preLessonVideo.screenpal };
  }

  if (parsed.kind === 'vrhomeworkvideo' && parsed.index === 1 && vr.homeworkVideo?.screenpal) {
    return { type: 'video', displayName: 'VR Homework Solution Video', screenpal: vr.homeworkVideo.screenpal };
  }

  return null;
}

async function requireOpenVrContext(request, env, parsed, viewId) {
  const context = await visibleLessonContext(request, env, viewId, parsed.lessonId);
  if (context.error) return context;
  if (context.visible.locked) return { error: 'LESSON_LOCKED', status: 403 };
  if (!isEnglishElevenPlusView(viewId, context.view)) return { error: 'VR_NOT_AVAILABLE', status: 403 };

  const access = await vrEntitlement(request, env, viewId, parsed.lessonId);
  if (access.error) return access;
  if (!access.entitled) return { error: 'VR_NOT_ENTITLED', status: 403 };
  return context;
}

async function handleVrDownload(request, env, parsed) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await requireOpenVrContext(request, env, parsed, viewId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });

  const resource = vrResourceFromRecord(context.record, parsed);
  if (!resource || resource.type !== 'download') {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const object = await env.MATERIALS_R2.get(resource.r2Key);
  if (!object?.body) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', `attachment; filename="${safeFilename(resource.displayName)}"`);
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

function screenpalEmbedUrl(screenpalId) {
  return `https://go.screenpal.com/player/${encodeURIComponent(String(screenpalId))}?ff=1&ahc=1&dcc=1&bg=transparent`;
}

async function handleVrVideo(request, env, parsed) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await requireOpenVrContext(request, env, parsed, viewId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });

  const resource = vrResourceFromRecord(context.record, parsed);
  if (!resource || resource.type !== 'video') {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  return json(
    { ok: true, displayName: resource.displayName, embedUrl: screenpalEmbedUrl(resource.screenpal) },
    { status: 200, headers: cors }
  );
}

async function handleQuiz(request, env, parsed) {
  const cors = corsHeaders(request, env);
  if (parsed.kind !== 'quiz' || parsed.index !== 1) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await visibleLessonContext(request, env, viewId, parsed.lessonId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });
  if (context.visible.locked) return json({ error: 'LESSON_LOCKED' }, { status: 403, headers: cors });
  if (context.view.presentation !== '11plus') {
    return json({ error: 'QUIZ_NOT_AVAILABLE' }, { status: 403, headers: cors });
  }

  const reference = quizReference(context.record);
  if (!reference) return json({ error: 'QUIZ_NOT_FOUND' }, { status: 404, headers: cors });
  const target = quizOpenTarget(reference);
  if (!target) {
    return json(
      {
        error: 'QUIZ_SHARE_URL_REQUIRED',
        message: 'The lesson has quiz metadata, but no explicit ScreenPal share/embed URL is configured.'
      },
      { status: 409, headers: cors }
    );
  }

  return json({ ok: true, displayName: reference.displayName, ...target }, { status: 200, headers: cors });
}

function bridgeLessonRecord(record) {
  const vr = normaliseVr(record);
  if (!vrHasContent(vr)) return record;

  const existingHomeworks = coreHomeworks(record);
  if (existingHomeworks.length >= VR_PRE_ANSWER_INDEX_BASE) {
    throw new Error('CORE_HOMEWORK_INDEX_COLLISION');
  }

  const homeworks = [...existingHomeworks];
  for (const pair of vr.preLesson) {
    if (!pair.answerKey?.r2Key) continue;
    homeworks[VR_PRE_ANSWER_INDEX_BASE + pair.index - 1] = {
      answerPack: {
        displayName: pair.answerKey.displayName,
        r2Key: pair.answerKey.r2Key
      }
    };
  }
  for (const pair of vr.homeworks) {
    if (!pair.answerPack?.r2Key) continue;
    homeworks[VR_HOMEWORK_ANSWER_INDEX_BASE + pair.index - 1] = {
      answerPack: {
        displayName: pair.answerPack.displayName,
        r2Key: pair.answerPack.r2Key
      }
    };
  }

  return { ...record, homeworks };
}

function bridgeLessonsKv(env) {
  const source = env.LESSONS_KV;
  return new Proxy(source, {
    get(target, prop) {
      if (prop === 'get') {
        return async (key, options) => {
          const value = await target.get(key, options);
          if (!String(key || '').startsWith('lesson:') || !value || typeof value !== 'object') return value;
          return bridgeLessonRecord(value);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function bridgeEnv(env) {
  const lessonsKv = bridgeLessonsKv(env);
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'LESSONS_KV') return lessonsKv;
      return target[prop];
    }
  });
}

async function gateVrProtectedAuthorize(request, env, parsed) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await requireOpenVrContext(request, env, parsed, viewId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });
  return phase8Worker.fetch(request, bridgeEnv(env));
}

async function loadAnswerTokenRow(env, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(
    `SELECT lesson_id, resource_key, view_id
     FROM answer_view_tokens
     WHERE token_hash = ?`
  )
    .bind(tokenHash)
    .first();
}

async function gateAnswerView(request, env, token) {
  const row = await loadAnswerTokenRow(env, token);
  const parsed = parseResourceKey(row?.resource_key || '');
  if (!isVrProtectedAnswerKey(parsed)) return phase8Worker.fetch(request, env);

  const context = await requireOpenVrContext(
    request,
    env,
    parsed,
    String(row?.view_id || '')
  );
  if (context.error) {
    return json(
      { error: context.error },
      { status: context.status, headers: corsHeaders(request, env) }
    );
  }
  return phase8Worker.fetch(request, bridgeEnv(env));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return phase8Worker.fetch(request, env, ctx);

    if (url.pathname.startsWith('/api/v1/student/') && !browserOriginAllowed(request, env)) {
      return json(
        { error: 'FORBIDDEN_ORIGIN' },
        { status: 403, headers: corsHeaders(request, env) }
      );
    }

    const listMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    if (listMatch && request.method === 'GET') {
      return augmentLessonList(request, env, decodeURIComponent(listMatch[1]));
    }

    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    if (lessonMatch && request.method === 'GET') {
      return augmentLessonDetail(request, env, decodeURIComponent(lessonMatch[1]));
    }

    const downloadMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/download$/);
    if (downloadMatch && request.method === 'GET') {
      const parsed = parseResourceKey(decodeURIComponent(downloadMatch[1]));
      if (parsed && ['vrpre', 'vrhomework'].includes(parsed.kind)) {
        return handleVrDownload(request, env, parsed);
      }
    }

    const videoMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/video$/);
    if (videoMatch && request.method === 'GET') {
      const parsed = parseResourceKey(decodeURIComponent(videoMatch[1]));
      if (parsed && ['vrprevideo', 'vrhomeworkvideo'].includes(parsed.kind)) {
        return handleVrVideo(request, env, parsed);
      }
    }

    const quizMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/quiz$/);
    if (quizMatch && request.method === 'GET') {
      const parsed = parseResourceKey(decodeURIComponent(quizMatch[1]));
      if (!parsed) return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: corsHeaders(request, env) });
      return handleQuiz(request, env, parsed);
    }

    const authorizeMatch = url.pathname.match(
      /^\/api\/v1\/student\/resources\/([^/]+)\/answer\/authorize$/
    );
    if (authorizeMatch && request.method === 'POST') {
      const parsed = parseResourceKey(decodeURIComponent(authorizeMatch[1]));
      if (isVrProtectedAnswerKey(parsed)) return gateVrProtectedAuthorize(request, env, parsed);
    }

    const answerViewMatch = url.pathname.match(/^\/api\/v1\/student\/answer-view\/([^/]+)$/);
    if (answerViewMatch && request.method === 'GET') {
      return gateAnswerView(request, env, decodeURIComponent(answerViewMatch[1]));
    }

    return phase8Worker.fetch(request, env, ctx);
  }
};
