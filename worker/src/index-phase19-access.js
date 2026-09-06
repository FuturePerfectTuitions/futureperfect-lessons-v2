import phase18Worker, { parseResourceRequest } from './index-phase18-online-prelesson.js';
import { canonicalCatalogueRowsForView, lockedPreviewUserForView } from './index-phase12.js';
import { explicitMainVideo } from './phase11-screenpal.js';

const SESSION_COOKIE = 'fpt_v2_session';
const WINDOW_HEADER = 'X-FPT-Window-Token';
const TRIAL_ENDED_MESSAGE = 'Trial access ended, please contact Future Perfect Tuitions to continue accessing content';
const TRIAL_MESSAGE = 'Trial access includes full lesson descriptions and lesson videos only.';
const SUBJECT_PREVIEW_MESSAGE = 'Full access available to enrolled students of the subject only';

const VIEW_META = Object.freeze({
  'maths-year2': { subject: 'maths', label: 'Year 2' },
  'maths-year3': { subject: 'maths', label: 'Year 3' },
  'maths-year4': { subject: 'maths', label: 'Year 4' },
  'maths-year5': { subject: 'maths', label: 'Year 5' },
  'maths-year6': { subject: 'maths', label: 'Year 6' },
  'maths-level1': { subject: 'maths', label: 'Level 1 (11+)' },
  'maths-level2': { subject: 'maths', label: 'Level 2 (11+)' },
  'maths-level3': { subject: 'maths', label: 'Level 3 (11+)' },
  'english-year2': { subject: 'english', label: 'Year 2' },
  'english-year3': { subject: 'english', label: 'Year 3' },
  'english-year4': { subject: 'english', label: 'Year 4' },
  'english-year5': { subject: 'english', label: 'Year 5' },
  'english-year6': { subject: 'english', label: 'Year 6' },
  'english-year4-11plus': { subject: 'english', label: 'Year 4 (11+)' },
  'english-year5-11plus': { subject: 'english', label: 'Year 5 (11+)' }
});

const clean = value => String(value ?? '').trim();
const normaliseUser = value => clean(value).toLowerCase();
const cleanViewId = value => clean(value).toLowerCase();
const isTrialId = value => normaliseUser(value).startsWith('trial');

function allowedOrigins(env) {
  return new Set([
    'https://futureperfecttuitions.github.io',
    ...String(env?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type,Content-Disposition',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type,Authorization,Accept,${WINDOW_HEADER}`,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

function json(body, init = {}, request = null, env = null) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  if (request && env) {
    for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

function jsonLike(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function sessionTokenFromSetCookie(response) {
  const raw = response?.headers?.get('set-cookie') || '';
  const match = raw.match(/(?:^|,\s*|;\s*)fpt_v2_session=([^;,\s]+)/i);
  return match ? match[1] : '';
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function bindWindow(env, sessionToken, windowToken, portalUserIdNorm) {
  const now = new Date().toISOString();
  const [tokenHash, windowHash] = await Promise.all([sha256Hex(sessionToken), sha256Hex(windowToken)]);
  await env.DB.prepare(
    `INSERT INTO student_session_windows (token_hash, portal_user_id_norm, window_token_hash, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(token_hash) DO UPDATE SET
       portal_user_id_norm = excluded.portal_user_id_norm,
       window_token_hash = excluded.window_token_hash,
       created_at = excluded.created_at`
  ).bind(tokenHash, portalUserIdNorm, windowHash, now).run();
  return tokenHash;
}

async function requireWindow(request, env) {
  const sessionToken = parseCookies(request)[SESSION_COOKIE] || '';
  const windowToken = clean(request.headers.get(WINDOW_HEADER));
  if (!sessionToken || !windowToken) return false;
  const [tokenHash, windowHash] = await Promise.all([sha256Hex(sessionToken), sha256Hex(windowToken)]);
  const row = await env.DB.prepare(
    `SELECT w.token_hash
     FROM student_session_windows w
     JOIN student_sessions s ON s.token_hash = w.token_hash
     WHERE w.token_hash = ?
       AND w.window_token_hash = ?
       AND s.revoked_at IS NULL
       AND s.idle_expires_at > ?`
  ).bind(tokenHash, windowHash, new Date().toISOString()).first();
  return Boolean(row);
}

async function revokeSession(env, sessionToken) {
  if (!sessionToken) return;
  const tokenHash = await sha256Hex(sessionToken);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE student_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`).bind(now, tokenHash),
    env.DB.prepare(`DELETE FROM student_session_windows WHERE token_hash = ?`).bind(tokenHash),
    env.DB.prepare(`DELETE FROM student_session_profiles WHERE token_hash = ?`).bind(tokenHash)
  ]);
}

async function handleLogin(request, env, ctx) {
  const windowToken = clean(request.headers.get(WINDOW_HEADER));
  if (windowToken.length < 24) {
    return json({ error: 'WINDOW_SESSION_REQUIRED' }, { status: 401 }, request, env);
  }

  const response = await phase18Worker.fetch(request, env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  const portalUserIdNorm = normaliseUser(body?.portalUserId);
  const sessionToken = sessionTokenFromSetCookie(response);
  if (!body?.ok || !portalUserIdNorm || !sessionToken) return response;

  if (isTrialId(portalUserIdNorm)) {
    const now = new Date().toISOString();
    const tokenHash = await sha256Hex(sessionToken);
    let claim;
    try {
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO trial_login_consumptions (portal_user_id_norm, consumed_at, first_session_token_hash)
           VALUES (?, ?, ?)`
        ).bind(portalUserIdNorm, now, tokenHash),
        env.DB.prepare(
          `INSERT INTO student_session_windows (token_hash, portal_user_id_norm, window_token_hash, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(token_hash) DO UPDATE SET
             portal_user_id_norm = excluded.portal_user_id_norm,
             window_token_hash = excluded.window_token_hash,
             created_at = excluded.created_at`
        ).bind(tokenHash, portalUserIdNorm, await sha256Hex(windowToken), now)
      ]);
      claim = Number(results?.[0]?.meta?.changes || 0) === 1;
    } catch {
      await revokeSession(env, sessionToken);
      return json({ error: 'LOGIN_TEMPORARILY_UNAVAILABLE' }, { status: 503 }, request, env);
    }

    if (!claim) {
      await revokeSession(env, sessionToken);
      const headers = new Headers(corsHeaders(request, env));
      headers.append('Set-Cookie', clearSessionCookie());
      return json(
        { error: 'TRIAL_ACCESS_ENDED', message: TRIAL_ENDED_MESSAGE },
        { status: 403, headers },
        request,
        env
      );
    }
  } else {
    try {
      await bindWindow(env, sessionToken, windowToken, portalUserIdNorm);
    } catch {
      await revokeSession(env, sessionToken);
      return json({ error: 'LOGIN_TEMPORARILY_UNAVAILABLE' }, { status: 503 }, request, env);
    }
  }

  return response;
}

async function sessionContext(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/student/session';
  url.search = '';
  const response = await phase18Worker.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  if (!response.ok || !body?.ok || body.accountLocked) return null;
  const portalUserIdNorm = normaliseUser(body.portalUserId);
  if (!portalUserIdNorm) return null;
  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
  if (!user) return null;
  return { portalUserIdNorm, user, session: body };
}

function trialViews(user) {
  const values = Array.isArray(user?.trialViews) ? user.trialViews : [];
  return new Set(values.map(cleanViewId).filter(viewId => VIEW_META[viewId]));
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

async function activeBatchRows(env, portalUserIdNorm) {
  const today = londonToday();
  const result = await env.DB.prepare(
    `SELECT a.batch_key, b.subject, b.school_year, b.stream, b.maths_level
     FROM student_batch_assignments a
     JOIN batch_definitions b ON b.batch_key = a.batch_key
     WHERE a.portal_user_id_norm = ?
       AND a.effective_from <= ?
       AND (a.effective_to IS NULL OR ? < a.effective_to)
       AND (b.active_from IS NULL OR b.active_from <= ?)
       AND (b.active_to IS NULL OR ? < b.active_to)`
  ).bind(portalUserIdNorm, today, today, today, today).all();
  return Array.isArray(result?.results) ? result.results : [];
}

function viewForBatch(row) {
  const subject = clean(row?.subject).toLowerCase();
  const stream = clean(row?.stream).toLowerCase();
  const year = Number(row?.school_year || 0);
  const level = Number(row?.maths_level || 0);
  if (subject === 'maths') {
    if (stream === '11plus') {
      const resolvedLevel = level >= 1 && level <= 3 ? level : year - 3;
      return VIEW_META[`maths-level${resolvedLevel}`] ? `maths-level${resolvedLevel}` : '';
    }
    return VIEW_META[`maths-year${year}`] ? `maths-year${year}` : '';
  }
  if (subject === 'english') {
    if (stream === '11plus' && (year === 4 || year === 5)) return `english-year${year}-11plus`;
    return VIEW_META[`english-year${year}`] ? `english-year${year}` : '';
  }
  return '';
}

function counterpartView(row) {
  const subject = clean(row?.subject).toLowerCase();
  const stream = clean(row?.stream).toLowerCase();
  const year = Number(row?.school_year || 0);
  const level = Number(row?.maths_level || 0);
  if (subject === 'maths') {
    if (stream === '11plus' && (year === 4 || year === 5)) return `english-year${year}-11plus`;
    return VIEW_META[`english-year${year}`] ? `english-year${year}` : '';
  }
  if (subject === 'english') {
    if (stream === '11plus') {
      const resolvedLevel = level >= 1 && level <= 3 ? level : year - 3;
      return VIEW_META[`maths-level${resolvedLevel}`] ? `maths-level${resolvedLevel}` : '';
    }
    return VIEW_META[`maths-year${year}`] ? `maths-year${year}` : '';
  }
  return '';
}

async function subjectPreviewViews(env, portalUserIdNorm) {
  const rows = await activeBatchRows(env, portalUserIdNorm);
  const actual = new Set(rows.map(viewForBatch).filter(Boolean));
  const previews = new Set();
  for (const row of rows) {
    const counterpart = counterpartView(row);
    if (counterpart && !actual.has(counterpart)) previews.add(counterpart);
  }
  return previews;
}

async function canonicalRows(env, viewId) {
  const rows = canonicalCatalogueRowsForView(viewId);
  return Promise.all(rows.map(async row => {
    const record = await env.LESSONS_KV.get(`lesson:${row.lessonId}`, { type: 'json' });
    return {
      ...row,
      description: String(record?.description || record?.desc || '')
    };
  }));
}

function viewSummary(viewId, rows, extras = {}) {
  const meta = VIEW_META[viewId] || { subject: '', label: viewId };
  return {
    viewId,
    subject: meta.subject,
    label: meta.label,
    catalogueAvailable: true,
    visibleLessonCount: rows.length,
    openLessonCount: rows.filter(row => row.locked === false).length,
    lockedLessonCount: rows.filter(row => row.locked !== false).length,
    ...extras
  };
}

function ensureSubject(body, subjectName) {
  if (!Array.isArray(body.subjects)) body.subjects = [];
  let subject = body.subjects.find(item => clean(item?.subject).toLowerCase() === subjectName);
  if (!subject) {
    subject = { subject: subjectName, label: subjectName === 'maths' ? 'Maths' : 'English', views: [] };
    body.subjects.push(subject);
  }
  if (!Array.isArray(subject.views)) subject.views = [];
  return subject;
}

function previewEnv(env, viewId, lessonId) {
  if (!env?.STUDENTS_KV) return env;
  const source = env.STUDENTS_KV;
  const kv = new Proxy(source, {
    get(target, prop) {
      if (prop !== 'get') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, options) => {
        const value = await target.get(key, options);
        if (value == null || !String(key || '').startsWith('user:')) return value;
        const wantsJson = options?.type === 'json';
        let user = value;
        if (!wantsJson) {
          try { user = JSON.parse(String(value)); } catch { return value; }
        }
        const overlaid = lockedPreviewUserForView(user, viewId, lessonId);
        return wantsJson ? overlaid : JSON.stringify(overlaid);
      };
    }
  });
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'STUDENTS_KV') return kv;
      if (prop === 'PHASE12_BYPASS_SESSION_PROFILE') return true;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function lockResource(resource, fallbackName = 'Resource') {
  if (!resource) return null;
  return {
    displayName: String(resource.displayName || fallbackName),
    available: false,
    locked: true,
    protected: Boolean(resource.protected),
    passwordRequired: Boolean(resource.protected || resource.passwordRequired)
  };
}

function forceLockedLesson(lesson, message, mode) {
  if (!lesson) return lesson;
  const restricted = {
    ...lesson,
    locked: true,
    state: 'locked',
    accessMode: mode,
    accessMessage: message,
    preLessonSheets: Array.isArray(lesson.preLessonSheets) ? lesson.preLessonSheets.map(item => lockResource(item, 'PreLesson Sheet')) : [],
    video: lesson.video ? lockResource(lesson.video, 'Video') : null,
    homeworks: Array.isArray(lesson.homeworks) ? lesson.homeworks.map(pair => ({
      ...pair,
      homework: lockResource(pair?.homework, 'Homework'),
      answerPack: lockResource(pair?.answerPack, 'Answer Pack')
    })) : [],
    otherResources: Array.isArray(lesson.otherResources) ? lesson.otherResources.map(item => lockResource(item)) : []
  };
  if (lesson.quiz) restricted.quiz = lockResource(lesson.quiz, 'Video');
  if (lesson.vr) {
    restricted.vr = {
      ...lesson.vr,
      preLesson: Array.isArray(lesson.vr.preLesson) ? lesson.vr.preLesson.map(pair => ({
        ...pair,
        sheet: lockResource(pair?.sheet, 'VR PreLesson Sheet'),
        answerKey: lockResource(pair?.answerKey, 'VR PreLesson Answer Key')
      })) : [],
      preLessonVideo: lockResource(lesson.vr.preLessonVideo, 'VR PreLesson Video'),
      homeworks: Array.isArray(lesson.vr.homeworks) ? lesson.vr.homeworks.map(pair => ({
        ...pair,
        homework: lockResource(pair?.homework, 'VR Homework'),
        answerPack: lockResource(pair?.answerPack, 'VR Answer Pack')
      })) : [],
      homeworkVideo: lockResource(lesson.vr.homeworkVideo, 'VR Homework Solution Video')
    };
  }
  const p11 = lesson.phase11Resources;
  const lockPair = pair => pair ? { ...pair, primary: lockResource(pair.primary), answerPack: lockResource(pair.answerPack) } : null;
  if (p11) {
    restricted.phase11Resources = {
      ...p11,
      corePreLessonPairs: Array.isArray(p11.corePreLessonPairs) ? p11.corePreLessonPairs.map(lockPair) : [],
      coreCumulativeHomeworks: Array.isArray(p11.coreCumulativeHomeworks) ? p11.coreCumulativeHomeworks.map(lockPair) : [],
      coreSupplementaryAnswers: Array.isArray(p11.coreSupplementaryAnswers) ? p11.coreSupplementaryAnswers.map(item => lockResource(item)) : [],
      elevenPlus: p11.elevenPlus ? {
        ...p11.elevenPlus,
        preLessonPairs: Array.isArray(p11.elevenPlus.preLessonPairs) ? p11.elevenPlus.preLessonPairs.map(lockPair) : [],
        homeworks: Array.isArray(p11.elevenPlus.homeworks) ? p11.elevenPlus.homeworks.map(lockPair) : [],
        cumulativeHomeworks: Array.isArray(p11.elevenPlus.cumulativeHomeworks) ? p11.elevenPlus.cumulativeHomeworks.map(lockPair) : [],
        supplementaryAnswers: Array.isArray(p11.elevenPlus.supplementaryAnswers) ? p11.elevenPlus.supplementaryAnswers.map(item => lockResource(item)) : []
      } : null,
      vrSupplementaryAnswers: Array.isArray(p11.vrSupplementaryAnswers) ? p11.vrSupplementaryAnswers.map(item => lockResource(item)) : []
    };
  }
  if (lesson.phase11OtherResources) {
    restricted.phase11OtherResources = {
      ...lesson.phase11OtherResources,
      elevenPlus: Array.isArray(lesson.phase11OtherResources.elevenPlus)
        ? lesson.phase11OtherResources.elevenPlus.map(item => lockResource(item)) : []
    };
  }
  return restricted;
}

function basicLockedLesson(record, row) {
  const core = record?.core || {};
  const pre = Array.isArray(record?.preLessonSheets) ? record.preLessonSheets : (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []);
  const homeworks = Array.isArray(record?.homeworks) ? record.homeworks : (Array.isArray(core.homeworks) ? core.homeworks : []);
  const other = Array.isArray(record?.otherResources) ? record.otherResources : (Array.isArray(core.otherResources) ? core.otherResources : []);
  const video = record?.video || core.video || null;
  return {
    lessonId: clean(record?.lessonId || row?.lessonId),
    displayLessonId: clean(row?.displayLessonId || record?.lessonId),
    title: clean(row?.title || record?.title),
    description: String(record?.description || record?.desc || ''),
    subject: clean(record?.subject),
    locked: true,
    state: 'locked',
    preLessonSheets: pre.map(item => lockResource({ displayName: item?.displayName || item?.name || 'PreLesson Sheet' })),
    video: video ? lockResource({ displayName: 'Video' }) : null,
    homeworks: homeworks.map(pair => ({
      homework: (pair?.homework || pair?.r2Key || pair?.r2) ? lockResource({ displayName: pair?.homework?.displayName || pair?.homework?.name || pair?.displayName || pair?.name || 'Homework' }) : null,
      answerPack: pair?.answerPack ? lockResource({ displayName: pair.answerPack.displayName || pair.answerPack.name || 'Answer Pack', protected: true }) : null
    })),
    otherResources: other.map(item => lockResource({ displayName: item?.displayName || item?.name || 'Resource' }))
  };
}

async function richPreviewLesson(request, env, ctx, viewId, lessonId) {
  const response = await phase18Worker.fetch(request, previewEnv(env, viewId, lessonId), ctx);
  const body = await response.clone().json().catch(() => null);
  if (response.ok && body?.ok && body.lesson) return { response, body };
  const row = canonicalCatalogueRowsForView(viewId).find(item => item.lessonId === lessonId);
  if (!row) return { response, body: null };
  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return { response, body: null };
  return {
    response: json({ ok: true }, { status: 200 }, request, env),
    body: { ok: true, view: viewSummary(viewId, []), lesson: basicLockedLesson(record, row) }
  };
}

async function handleTrialHome(request, env, ctx, context) {
  const viewIds = trialViews(context.user);
  const response = await phase18Worker.fetch(request, env, ctx);
  const body = await response.clone().json().catch(() => ({ ok: true }));
  body.ok = true;
  body.student = body.student || {
    firstName: String(context.user.firstName || ''),
    portalUserId: context.portalUserIdNorm,
    schoolYear: Number(context.user.schoolYear || 0) || null,
    accountLocked: false
  };
  body.subjects = [
    { subject: 'maths', label: 'Maths', views: [] },
    { subject: 'english', label: 'English', views: [] }
  ];
  for (const viewId of viewIds) {
    const rows = (await canonicalRows(env, viewId)).map(row => ({ ...row, locked: false }));
    const meta = VIEW_META[viewId];
    ensureSubject(body, meta.subject).views.push(viewSummary(viewId, rows, {
      lockedPreview: false,
      trial: true,
      current: true,
      group: 'current'
    }));
  }
  return jsonLike(response.ok ? response : json({ ok: true }, { status: 200 }, request, env), body);
}

async function handleTrialList(request, env, viewId) {
  const rows = (await canonicalRows(env, viewId)).map(row => ({
    ...row,
    state: 'trial',
    locked: false,
    blocked: false,
    preview: false,
    missedPreview: false,
    accessMode: 'trial',
    accessMessage: TRIAL_MESSAGE
  }));
  return json({ ok: true, view: viewSummary(viewId, rows, { trial: true, current: true, group: 'current' }), lessons: rows }, { status: 200 }, request, env);
}

async function handleTrialDetail(request, env, ctx, viewId, lessonId) {
  const { response, body } = await richPreviewLesson(request, env, ctx, viewId, lessonId);
  if (!body?.ok || !body.lesson) return response;
  const record = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!record || record.active === false) return response;
  const target = explicitMainVideo(record, viewId);
  let lesson = forceLockedLesson(body.lesson, TRIAL_MESSAGE, 'trial');
  lesson = {
    ...lesson,
    locked: false,
    state: 'trial',
    accessMode: 'trial',
    accessMessage: TRIAL_MESSAGE,
    video: target?.embedUrl ? {
      displayName: 'Video',
      resourceKey: `${encodeURIComponent(lessonId)}~video~1`,
      locked: false,
      available: true,
      protected: false
    } : null,
    quiz: null
  };
  body.lesson = lesson;
  body.view = body.view || viewSummary(viewId, []);
  return jsonLike(response, body);
}

async function handleTrialVideo(request, env, viewId, parsed) {
  if (parsed.kind !== 'video' || parsed.action !== 'video') {
    return json({ error: 'TRIAL_VIDEO_ONLY', message: TRIAL_MESSAGE }, { status: 403 }, request, env);
  }
  const rows = canonicalCatalogueRowsForView(viewId);
  if (!rows.some(row => row.lessonId === parsed.lessonId)) {
    return json({ error: 'LESSON_NOT_VISIBLE' }, { status: 404 }, request, env);
  }
  const record = await env.LESSONS_KV.get(`lesson:${parsed.lessonId}`, { type: 'json' });
  const target = explicitMainVideo(record, viewId);
  if (!target?.embedUrl) return json({ error: 'VIDEO_NOT_FOUND' }, { status: 404 }, request, env);
  return json({ ok: true, displayName: 'Video', embedUrl: target.embedUrl }, { status: 200 }, request, env);
}

async function handlePreviewHome(request, env, ctx, context, previews) {
  const response = await phase18Worker.fetch(request, env, ctx);
  if (!response.ok) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.ok) return response;
  for (const viewId of previews) {
    const meta = VIEW_META[viewId];
    if (!meta) continue;
    const rows = await canonicalRows(env, viewId);
    const subject = ensureSubject(body, meta.subject);
    const existing = subject.views.find(view => cleanViewId(view?.viewId) === viewId);
    const openCount = Math.max(0, Math.min(rows.length, Number(existing?.openLessonCount || 0)));
    const summary = {
      viewId,
      subject: meta.subject,
      label: meta.label,
      catalogueAvailable: true,
      visibleLessonCount: rows.length,
      openLessonCount: openCount,
      lockedLessonCount: rows.length - openCount,
      lockedPreview: true,
      current: true,
      group: 'current',
      source: 'crossSubjectPreview'
    };
    if (existing) Object.assign(existing, summary);
    else subject.views.push(summary);
  }
  return jsonLike(response, body);
}

async function handlePreviewList(request, env, ctx, viewId) {
  const response = await phase18Worker.fetch(request, env, ctx);
  const body = await response.clone().json().catch(() => null);
  const existing = new Map(
    Array.isArray(body?.lessons)
      ? body.lessons.filter(row => row?.lessonId).map(row => [String(row.lessonId), row])
      : []
  );
  const canonical = await canonicalRows(env, viewId);
  const lessons = canonical.map(row => {
    const current = existing.get(row.lessonId);
    if (current?.locked === false) return current;
    return {
      ...row,
      state: 'locked',
      locked: true,
      blocked: false,
      preview: true,
      missedPreview: false,
      accessMode: 'subject-preview',
      accessMessage: SUBJECT_PREVIEW_MESSAGE
    };
  });
  const view = viewSummary(viewId, lessons, {
    lockedPreview: true,
    current: true,
    group: 'current',
    source: 'crossSubjectPreview'
  });
  return json({ ok: true, view, lessons }, { status: 200 }, request, env);
}

async function handlePreviewDetail(request, env, ctx, viewId, lessonId) {
  const baseResponse = await phase18Worker.fetch(request, env, ctx);
  const baseBody = await baseResponse.clone().json().catch(() => null);
  if (baseResponse.ok && baseBody?.ok && baseBody?.lesson?.locked === false) return baseResponse;

  const { response, body } = await richPreviewLesson(request, env, ctx, viewId, lessonId);
  if (!body?.ok || !body.lesson) return baseResponse.status !== 404 ? baseResponse : response;
  body.lesson = forceLockedLesson(body.lesson, SUBJECT_PREVIEW_MESSAGE, 'subject-preview');
  return jsonLike(response, body);
}

async function hasExistingLessonAccess(request, env, ctx, lessonId, viewId) {
  const url = new URL(request.url);
  url.pathname = `/api/v1/student/lessons/${encodeURIComponent(lessonId)}`;
  url.search = `?viewId=${encodeURIComponent(viewId)}`;
  const response = await phase18Worker.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  const body = await response.clone().json().catch(() => null);
  return Boolean(response.ok && body?.ok && body?.lesson?.locked === false);
}

export {
  TRIAL_ENDED_MESSAGE,
  TRIAL_MESSAGE,
  SUBJECT_PREVIEW_MESSAGE,
  trialViews,
  viewForBatch,
  counterpartView,
  forceLockedLesson
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (url.pathname === '/api/v1/student/auth/login' && request.method === 'POST') {
      return handleLogin(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/v1/student/')) {
      let validWindow = false;
      try { validWindow = await requireWindow(request, env); } catch { validWindow = false; }
      if (!validWindow) {
        return json({ error: 'WINDOW_SESSION_REQUIRED' }, { status: 401 }, request, env);
      }
    }

    if (!url.pathname.startsWith('/api/v1/student/')) return phase18Worker.fetch(request, env, ctx);

    const context = await sessionContext(request, env, ctx);
    if (!context) return phase18Worker.fetch(request, env, ctx);
    const trial = isTrialId(context.portalUserIdNorm);
    let pathnameViewId = '';
    const viewMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    if (viewMatch) {
      try { pathnameViewId = decodeURIComponent(viewMatch[1]); } catch { pathnameViewId = ''; }
    }
    const viewId = cleanViewId(url.searchParams.get('viewId') || pathnameViewId);
    const lessonMatch = url.pathname.match(/^\/api\/v1\/student\/lessons\/([^/]+)$/);
    let lessonId = '';
    if (lessonMatch) {
      try { lessonId = decodeURIComponent(lessonMatch[1]); } catch { lessonId = ''; }
    }

    if (trial) {
      const allowed = trialViews(context.user);
      if (request.method === 'GET' && url.pathname === '/api/v1/student/home') {
        return handleTrialHome(request, env, ctx, context);
      }
      if (request.method === 'GET' && /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) {
        if (!allowed.has(viewId)) return json({ error: 'VIEW_NOT_AVAILABLE' }, { status: 403 }, request, env);
        return handleTrialList(request, env, viewId);
      }
      if (request.method === 'GET' && lessonId) {
        if (!allowed.has(viewId)) return json({ error: 'VIEW_NOT_AVAILABLE' }, { status: 403 }, request, env);
        return handleTrialDetail(request, env, ctx, viewId, lessonId);
      }
      const resource = parseResourceRequest(url);
      if (resource) {
        if (!allowed.has(viewId)) return json({ error: 'VIEW_NOT_AVAILABLE' }, { status: 403 }, request, env);
        return handleTrialVideo(request, env, viewId, resource);
      }
      return phase18Worker.fetch(request, env, ctx);
    }

    const previews = await subjectPreviewViews(env, context.portalUserIdNorm);
    if (request.method === 'GET' && url.pathname === '/api/v1/student/home' && previews.size) {
      return handlePreviewHome(request, env, ctx, context, previews);
    }
    if (viewId && previews.has(viewId)) {
      if (request.method === 'GET' && /^\/api\/v1\/student\/views\/[^/]+\/lessons$/.test(url.pathname)) {
        return handlePreviewList(request, env, ctx, viewId);
      }
      if (request.method === 'GET' && lessonId) {
        return handlePreviewDetail(request, env, ctx, viewId, lessonId);
      }
      const resource = parseResourceRequest(url);
      if (resource) {
        if (await hasExistingLessonAccess(request, env, ctx, resource.lessonId, viewId)) {
          return phase18Worker.fetch(request, env, ctx);
        }
        return json({ error: 'SUBJECT_ENROLMENT_REQUIRED', message: SUBJECT_PREVIEW_MESSAGE }, { status: 403 }, request, env);
      }
    }

    return phase18Worker.fetch(request, env, ctx);
  }
};
