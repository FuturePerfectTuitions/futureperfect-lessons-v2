import phase11ScreenPalWorker from './index-phase11.js';
import phase8Worker from './index-phase8.js';
import { presentationForView } from './phase11-screenpal.js';
import {
  normalisePhase11Resources,
  classifyPhase11AnswerIndex,
  phase11AnswerResource,
  bridgePhase11Answers,
  primaryDownloadResource,
  answerIndexFor
} from './phase11-resources.js';

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

function safeFilename(value, fallback = 'document.pdf') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  );
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function downstreamJson(request, env, pathname, search = '') {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = search;
  const internal = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const response = await phase11ScreenPalWorker.fetch(internal, env);
  const body = await response.clone().json().catch(() => null);
  return { response, body };
}

async function loadLessonRecord(env, lessonId) {
  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return null;
  return record;
}

async function requireVisibleOpenLesson(request, env, lessonId, viewId) {
  if (!viewId) {
    return {
      error: json({ error: 'VIEW_REQUIRED' }, { status: 400, headers: corsHeaders(request, env) })
    };
  }

  const path = `/api/v1/student/views/${encodeURIComponent(viewId)}/lessons`;
  const { response, body } = await downstreamJson(request, env, path);
  if (!response.ok || !body?.ok) return { error: response };

  const visible = (Array.isArray(body.lessons) ? body.lessons : [])
    .find(item => String(item?.lessonId || '') === String(lessonId));
  if (!visible) {
    return {
      error: json({ error: 'LESSON_NOT_VISIBLE' }, { status: 404, headers: corsHeaders(request, env) })
    };
  }
  if (visible.locked) {
    return {
      error: json({ error: 'LESSON_LOCKED' }, { status: 403, headers: corsHeaders(request, env) })
    };
  }

  const record = await loadLessonRecord(env, lessonId);
  if (!record) {
    return {
      error: json({ error: 'LESSON_NOT_FOUND' }, { status: 404, headers: corsHeaders(request, env) })
    };
  }

  return {
    visible,
    record,
    view: {
      ...(body.view || {}),
      presentation: body.view?.presentation || presentationForView(viewId)
    }
  };
}

async function authorisedLessonDetail(request, env, lessonId, viewId) {
  if (!viewId) {
    return {
      error: json({ error: 'VIEW_REQUIRED' }, { status: 400, headers: corsHeaders(request, env) })
    };
  }

  const path = `/api/v1/student/lessons/${encodeURIComponent(lessonId)}`;
  const search = `?viewId=${encodeURIComponent(viewId)}`;
  const { response, body } = await downstreamJson(request, env, path, search);
  if (!response.ok || !body?.ok || !body.lesson) return { error: response };

  const record = await loadLessonRecord(env, lessonId);
  if (!record) {
    return {
      error: json({ error: 'LESSON_NOT_FOUND' }, { status: 404, headers: corsHeaders(request, env) })
    };
  }

  return {
    lesson: body.lesson,
    record,
    view: {
      ...(body.view || {}),
      presentation: body.lesson?.presentation || body.view?.presentation || presentationForView(viewId)
    }
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

async function safePair(env, lessonId, pair, index, primaryKind, answerCategory, locked) {
  if (!pair) return null;
  const primary = pair.primary || null;
  const answerPack = pair.answerPack || null;

  if (locked) {
    return {
      primary: primary?.r2Key ? lockedFile(primary.displayName) : null,
      answerPack: answerPack?.r2Key ? lockedFile(answerPack.displayName, true) : null
    };
  }

  const answerIndex = answerIndexFor(answerCategory, index);
  const [primaryAvailable, answerAvailable] = await Promise.all([
    r2Available(env, primary?.r2Key),
    r2Available(env, answerPack?.r2Key)
  ]);

  return {
    primary: primary?.r2Key
      ? openFile(primary.displayName, makeResourceKey(lessonId, primaryKind, index), primaryAvailable)
      : null,
    answerPack: answerPack?.r2Key && answerIndex
      ? openFile(answerPack.displayName, makeResourceKey(lessonId, 'answer', answerIndex), answerAvailable, true)
      : null
  };
}

async function safePairList(env, lessonId, pairs, primaryKind, answerCategory, locked) {
  return Promise.all(
    pairs.map((pair, offset) => safePair(
      env,
      lessonId,
      pair,
      offset + 1,
      primaryKind,
      answerCategory,
      locked
    ))
  );
}

async function safeAnswerList(env, lessonId, answers, answerCategory, locked) {
  return Promise.all(answers.map(async (answer, offset) => {
    if (!answer?.r2Key) return null;
    if (locked) return lockedFile(answer.displayName, true);
    const answerIndex = answerIndexFor(answerCategory, offset + 1);
    const available = await r2Available(env, answer.r2Key);
    return answerIndex
      ? openFile(answer.displayName, makeResourceKey(lessonId, 'answer', answerIndex), available, true)
      : null;
  }));
}

function extensionModelHasContent(model) {
  if (!model) return false;
  return Boolean(
    model.corePreLessonPairs?.length ||
    model.coreCumulativeHomeworks?.length ||
    model.coreSupplementaryAnswers?.length ||
    model.elevenPlus?.preLessonPairs?.length ||
    model.elevenPlus?.homeworks?.length ||
    model.elevenPlus?.cumulativeHomeworks?.length ||
    model.elevenPlus?.supplementaryAnswers?.length ||
    model.vrSupplementaryAnswers?.length
  );
}

async function buildExtensionModel(request, env, lessonId, record, lessonModel, viewId) {
  const source = normalisePhase11Resources(record);
  const locked = Boolean(lessonModel?.locked);
  const presentation = lessonModel?.presentation || presentationForView(viewId);

  // R2 existence checks are independent. Run all Phase 11 resource groups in
  // parallel so lesson rendering is bounded by the slowest R2 head request,
  // rather than the sum of several sequential availability-check waves.
  const corePromise = Promise.all([
    safePairList(
      env,
      lessonId,
      source.core.preLessonPairs,
      'p11corepre',
      'corePreLesson',
      locked
    ),
    safePairList(
      env,
      lessonId,
      source.core.cumulativeHomeworks,
      'p11corecum',
      'coreCumulative',
      locked
    ),
    safeAnswerList(
      env,
      lessonId,
      source.core.supplementaryAnswers,
      'coreSupplementary',
      locked
    )
  ]);

  const elevenPlusPromise = presentation === '11plus'
    ? Promise.all([
      safePairList(
        env,
        lessonId,
        source.elevenPlus.preLessonPairs,
        'p11elevenpre',
        'elevenPlusPreLesson',
        locked
      ),
      safePairList(
        env,
        lessonId,
        source.elevenPlus.homeworks,
        'p11elevenhw',
        'elevenPlusHomework',
        locked
      ),
      safePairList(
        env,
        lessonId,
        source.elevenPlus.cumulativeHomeworks,
        'p11elevencum',
        'elevenPlusCumulative',
        locked
      ),
      safeAnswerList(
        env,
        lessonId,
        source.elevenPlus.supplementaryAnswers,
        'elevenPlusSupplementary',
        locked
      )
    ])
    : Promise.resolve(null);

  // Phase 9 has already applied the authoritative VR entitlement check. Only
  // expose supplementary VR answers when the downstream safe VR model exists.
  const vrPromise = lessonModel?.vr
    ? safeAnswerList(
      env,
      lessonId,
      source.vr.supplementaryAnswers,
      'vrSupplementary',
      locked
    )
    : Promise.resolve([]);

  const [core, elevenPlus, vrSupplementaryAnswers] = await Promise.all([
    corePromise,
    elevenPlusPromise,
    vrPromise
  ]);

  const model = {
    corePreLessonPairs: core[0],
    coreCumulativeHomeworks: core[1],
    coreSupplementaryAnswers: core[2],
    elevenPlus: elevenPlus
      ? {
        preLessonPairs: elevenPlus[0],
        homeworks: elevenPlus[1],
        cumulativeHomeworks: elevenPlus[2],
        supplementaryAnswers: elevenPlus[3]
      }
      : null,
    vrSupplementaryAnswers
  };

  return extensionModelHasContent(model) ? model : null;
}

async function augmentLessonDetail(request, env, lessonId) {
  // The canonical record lookup is independent of the downstream Phase 9/ScreenPal
  // lesson-detail request, so start both together and avoid another serial KV wait.
  const [response, record] = await Promise.all([
    phase11ScreenPalWorker.fetch(request, env),
    loadLessonRecord(env, lessonId)
  ]);

  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!response.ok || !body?.ok || !body.lesson) return response;
  if (!record) return response;

  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();

  body.lesson.phase11Resources = await buildExtensionModel(
    request,
    env,
    lessonId,
    record,
    body.lesson,
    viewId
  );

  return jsonLike(response, body);
}

function isElevenPlusDownloadKind(kind) {
  return ['p11elevenpre', 'p11elevenhw', 'p11elevencum'].includes(kind);
}

async function handleExtensionDownload(request, env, parsed) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await requireVisibleOpenLesson(request, env, parsed.lessonId, viewId);
  if (context.error) return context.error;

  if (isElevenPlusDownloadKind(parsed.kind) && context.view.presentation !== '11plus') {
    return json({ error: 'RESOURCE_NOT_AVAILABLE' }, { status: 403, headers: cors });
  }

  const resource = primaryDownloadResource(context.record, parsed.kind, parsed.index);
  if (!resource?.r2Key) {
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

function phase11AnswerCategory(parsed) {
  if (!parsed || parsed.kind !== 'answer') return null;
  return classifyPhase11AnswerIndex(parsed.index);
}

async function requirePhase11AnswerContext(request, env, parsed, viewId) {
  const category = phase11AnswerCategory(parsed);
  if (!category) return { error: 'RESOURCE_NOT_FOUND', status: 404 };

  if (category === 'vrSupplementary') {
    const detail = await authorisedLessonDetail(request, env, parsed.lessonId, viewId);
    if (detail.error) return { response: detail.error };
    if (detail.lesson?.locked || !detail.lesson?.vr) {
      return { error: 'VR_NOT_AVAILABLE', status: 403 };
    }
    const resource = phase11AnswerResource(detail.record, parsed.index);
    if (!resource?.r2Key) return { error: 'RESOURCE_NOT_FOUND', status: 404 };
    return { record: detail.record, resource, category };
  }

  const context = await requireVisibleOpenLesson(request, env, parsed.lessonId, viewId);
  if (context.error) return { response: context.error };

  if (
    ['elevenPlusPreLesson', 'elevenPlusHomework', 'elevenPlusCumulative', 'elevenPlusSupplementary']
      .includes(category) &&
    context.view.presentation !== '11plus'
  ) {
    return { error: 'RESOURCE_NOT_AVAILABLE', status: 403 };
  }

  const resource = phase11AnswerResource(context.record, parsed.index);
  if (!resource?.r2Key) return { error: 'RESOURCE_NOT_FOUND', status: 404 };
  return { record: context.record, resource, category };
}

function bridgeLessonsKv(env) {
  const source = env.LESSONS_KV;
  return new Proxy(source, {
    get(target, prop) {
      if (prop === 'get') {
        return async (key, options) => {
          const value = await target.get(key, options);
          if (!String(key || '').startsWith('lesson:') || !value || typeof value !== 'object') {
            return value;
          }
          return bridgePhase11Answers(value);
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

async function gatePhase11ProtectedAuthorize(request, env, parsed) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await requirePhase11AnswerContext(request, env, parsed, viewId);
  if (context.response) return context.response;
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

async function gatePhase11AnswerView(request, env, token) {
  const row = await loadAnswerTokenRow(env, token);
  const parsed = parseResourceKey(row?.resource_key || '');
  const category = phase11AnswerCategory(parsed);
  if (!category) return phase11ScreenPalWorker.fetch(request, env);

  const context = await requirePhase11AnswerContext(
    request,
    env,
    parsed,
    String(row?.view_id || '')
  );
  if (context.response) return context.response;
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

    if (request.method === 'OPTIONS') return phase11ScreenPalWorker.fetch(request, env, ctx);

    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    if (lessonMatch && request.method === 'GET') {
      return augmentLessonDetail(request, env, decodeURIComponent(lessonMatch[1]));
    }

    const downloadMatch = url.pathname.match(/^\/api\/v1\/student\/resources\/([^/]+)\/download$/);
    if (downloadMatch && request.method === 'GET') {
      const parsed = parseResourceKey(decodeURIComponent(downloadMatch[1]));
      if (parsed && [
        'p11corepre',
        'p11corecum',
        'p11elevenpre',
        'p11elevenhw',
        'p11elevencum'
      ].includes(parsed.kind)) {
        return handleExtensionDownload(request, env, parsed);
      }
    }

    const authorizeMatch = url.pathname.match(
      /^\/api\/v1\/student\/resources\/([^/]+)\/answer\/authorize$/
    );
    if (authorizeMatch && request.method === 'POST') {
      const parsed = parseResourceKey(decodeURIComponent(authorizeMatch[1]));
      if (phase11AnswerCategory(parsed)) {
        return gatePhase11ProtectedAuthorize(request, env, parsed);
      }
    }

    const answerViewMatch = url.pathname.match(/^\/api\/v1\/student\/answer-view\/([^/]+)$/);
    if (answerViewMatch && request.method === 'GET') {
      return gatePhase11AnswerView(request, env, decodeURIComponent(answerViewMatch[1]));
    }

    return phase11ScreenPalWorker.fetch(request, env, ctx);
  }
};