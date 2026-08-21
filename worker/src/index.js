const SESSION_COOKIE = 'fpt_v2_session';
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;

const json = (body, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
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
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
    'Access-Control-Max-Age': '600'
  };
}

function browserOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || allowedOrigins(env).has(origin);
}

function isDevelopment(env) {
  return (env.ENVIRONMENT || 'development') === 'development';
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
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

async function timingSafeStringEqual(left, right) {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function validFourCharacterPassword(value) {
  const password = String(value || '');
  return (
    password.length === 4 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

function developmentAllowlist(env) {
  return new Set(
    String(env.DEV_LOGIN_ALLOWLIST || '')
      .split(',')
      .map(normalisePortalUserId)
      .filter(Boolean)
  );
}

function loginPermittedForUser(env, portalUserIdNorm) {
  if (isDevelopment(env)) {
    return developmentAllowlist(env).has(portalUserIdNorm);
  }

  return String(env.STUDENT_LOGIN_ENABLED || '').trim().toLowerCase() === 'true';
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function accountSummary(user) {
  const configuredStatus = String(user?.status || 'active').trim().toLowerCase();
  const expires = String(user?.expires || '').trim();
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expires)
    ? londonToday() > expires
    : false;
  const accountLocked = configuredStatus !== 'active' || expired;

  return {
    status: configuredStatus || 'active',
    expires: expires || null,
    expired,
    accountLocked
  };
}

async function loadPhase4User(env, portalUserIdNorm) {
  return env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
}

async function createSession(env, portalUserIdNorm) {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = base64Url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);

  await env.DB.prepare(
    `INSERT INTO student_sessions (
       token_hash,
       portal_user_id_norm,
       created_at,
       last_activity_at,
       idle_expires_at,
       revoked_at
     ) VALUES (?, ?, ?, ?, ?, NULL)`
  )
    .bind(
      tokenHash,
      portalUserIdNorm,
      now.toISOString(),
      now.toISOString(),
      idleExpiresAt.toISOString()
    )
    .run();

  return {
    token,
    tokenHash,
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    idleExpiresAt: idleExpiresAt.toISOString()
  };
}

async function findSession(env, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT
       token_hash,
       portal_user_id_norm,
       created_at,
       last_activity_at,
       idle_expires_at,
       revoked_at
     FROM student_sessions
     WHERE token_hash = ?`
  )
    .bind(tokenHash)
    .first();

  return row ? { ...row, tokenHash } : null;
}

async function touchSession(env, session, force = true) {
  const now = new Date();
  const lastActivityMs = Date.parse(session.last_activity_at || '');
  const shouldWrite =
    force ||
    !Number.isFinite(lastActivityMs) ||
    now.getTime() - lastActivityMs >= ACTIVITY_WRITE_THROTTLE_MS;

  if (!shouldWrite) {
    return {
      lastActivityAt: session.last_activity_at,
      idleExpiresAt: session.idle_expires_at
    };
  }

  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  await env.DB.prepare(
    `UPDATE student_sessions
     SET last_activity_at = ?, idle_expires_at = ?
     WHERE token_hash = ? AND revoked_at IS NULL`
  )
    .bind(now.toISOString(), idleExpiresAt.toISOString(), session.token_hash)
    .run();

  session.last_activity_at = now.toISOString();
  session.idle_expires_at = idleExpiresAt.toISOString();

  return {
    lastActivityAt: session.last_activity_at,
    idleExpiresAt: session.idle_expires_at
  };
}

async function requireSession(request, env, { touch = true, forceTouch = true } = {}) {
  const token = parseCookies(request)[SESSION_COOKIE] || '';
  const session = await findSession(env, token);

  if (!session || session.revoked_at) {
    return { error: 'SESSION_INVALID', status: 401 };
  }

  const idleExpiresMs = Date.parse(session.idle_expires_at || '');
  if (!Number.isFinite(idleExpiresMs) || Date.now() >= idleExpiresMs) {
    return { error: 'SESSION_EXPIRED', status: 401 };
  }

  const portalUserIdNorm = normalisePortalUserId(session.portal_user_id_norm);
  const user = await loadPhase4User(env, portalUserIdNorm);
  if (!user) {
    return { error: 'SESSION_INVALID', status: 401 };
  }

  const activity = touch
    ? await touchSession(env, session, forceTouch)
    : {
        lastActivityAt: session.last_activity_at,
        idleExpiresAt: session.idle_expires_at
      };

  return {
    session,
    user,
    portalUserIdNorm,
    account: accountSummary(user),
    ...activity
  };
}

async function handleLogin(request, env) {
  const cors = corsHeaders(request, env);

  if (!browserOriginAllowed(request, env)) {
    return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_REQUEST' }, { status: 400, headers: cors });
  }

  const portalUserIdNorm = normalisePortalUserId(body?.username);
  const password = String(body?.password || '');

  if (
    !portalUserIdNorm ||
    !validFourCharacterPassword(password) ||
    !loginPermittedForUser(env, portalUserIdNorm)
  ) {
    return json({ error: 'INVALID_LOGIN' }, { status: 401, headers: cors });
  }

  const user = await loadPhase4User(env, portalUserIdNorm);
  if (!user || !validFourCharacterPassword(String(user.p || ''))) {
    return json({ error: 'INVALID_LOGIN' }, { status: 401, headers: cors });
  }

  const passwordMatches = await timingSafeStringEqual(password, String(user.p));
  if (!passwordMatches) {
    return json({ error: 'INVALID_LOGIN' }, { status: 401, headers: cors });
  }

  const session = await createSession(env, portalUserIdNorm);
  const account = accountSummary(user);
  const headers = new Headers(cors);
  headers.append('Set-Cookie', sessionCookie(session.token));

  return json(
    {
      ok: true,
      firstName: String(user.firstName || ''),
      portalUserId: portalUserIdNorm,
      status: account.status,
      expires: account.expires,
      expired: account.expired,
      accountLocked: account.accountLocked,
      idleExpiresAt: session.idleExpiresAt
    },
    { status: 200, headers }
  );
}

async function handleLogout(request, env) {
  const cors = corsHeaders(request, env);

  if (!browserOriginAllowed(request, env)) {
    return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  }

  const token = parseCookies(request)[SESSION_COOKIE] || '';
  if (token) {
    const session = await findSession(env, token);
    if (session && !session.revoked_at) {
      await env.DB.prepare(
        `UPDATE student_sessions
         SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`
      )
        .bind(new Date().toISOString(), session.token_hash)
        .run();
    }
  }

  const headers = new Headers(cors);
  headers.append('Set-Cookie', clearSessionCookie());
  return json({ ok: true }, { status: 200, headers });
}

async function handleSessionSummary(request, env) {
  const cors = corsHeaders(request, env);
  const auth = await requireSession(request, env, { touch: true, forceTouch: true });

  if (auth.error) {
    return json({ error: auth.error }, { status: auth.status, headers: cors });
  }

  return json(
    {
      ok: true,
      firstName: String(auth.user.firstName || ''),
      portalUserId: auth.portalUserIdNorm,
      status: auth.account.status,
      expires: auth.account.expires,
      expired: auth.account.expired,
      accountLocked: auth.account.accountLocked,
      lastActivityAt: auth.lastActivityAt,
      idleExpiresAt: auth.idleExpiresAt
    },
    { status: 200, headers: cors }
  );
}

async function handleActivity(request, env) {
  const cors = corsHeaders(request, env);

  if (!browserOriginAllowed(request, env)) {
    return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  }

  const auth = await requireSession(request, env, { touch: true, forceTouch: false });
  if (auth.error) {
    return json({ error: auth.error }, { status: auth.status, headers: cors });
  }

  return json(
    {
      ok: true,
      lastActivityAt: auth.lastActivityAt,
      idleExpiresAt: auth.idleExpiresAt
    },
    { status: 200, headers: cors }
  );
}

async function checkBindings(env) {
  const checks = {
    studentsKv: { bound: Boolean(env.STUDENTS_KV), ok: false },
    lessonsKv: { bound: Boolean(env.LESSONS_KV), ok: false },
    d1: { bound: Boolean(env.DB), ok: false },
    materialsR2: { bound: Boolean(env.MATERIALS_R2), ok: false }
  };

  try {
    if (env.STUDENTS_KV) {
      await env.STUDENTS_KV.list({ limit: 1 });
      checks.studentsKv.ok = true;
    }
  } catch {
    checks.studentsKv.error = 'KV_READ_FAILED';
  }

  try {
    if (env.LESSONS_KV) {
      await env.LESSONS_KV.list({ limit: 1 });
      checks.lessonsKv.ok = true;
    }
  } catch {
    checks.lessonsKv.error = 'KV_READ_FAILED';
  }

  try {
    if (env.DB) {
      const row = await env.DB.prepare('SELECT 1 AS ok').first();
      checks.d1.ok = Number(row?.ok) === 1;
    }
  } catch {
    checks.d1.error = 'D1_QUERY_FAILED';
  }

  try {
    if (env.MATERIALS_R2) {
      await env.MATERIALS_R2.list({ limit: 1 });
      checks.materialsR2.ok = true;
    }
  } catch {
    checks.materialsR2.error = 'R2_LIST_FAILED';
  }

  return checks;
}

async function phase2Diagnostics(env) {
  const studentKey = 'student:test0101';
  const lessonKey = 'lesson:DEV-M01';
  const viewKey = 'view:maths-year5-dev';

  const [student, lesson, view, entitlementCountRow, entitlementRow] =
    await Promise.all([
      env.STUDENTS_KV.get(studentKey, { type: 'json' }),
      env.LESSONS_KV.get(lessonKey, { type: 'json' }),
      env.LESSONS_KV.get(viewKey, { type: 'json' }),
      env.DB.prepare('SELECT COUNT(*) AS count FROM lesson_entitlements').first(),
      env.DB.prepare(
        `SELECT
           portal_user_id_norm,
           lesson_id,
           core_access,
           vr_access,
           source,
           first_granted_at,
           last_confirmed_at,
           source_batch_code,
           source_lesson_date
         FROM lesson_entitlements
         WHERE portal_user_id_norm = ? AND lesson_id = ?`
      )
        .bind('test0101', 'DEV-M01')
        .first()
    ]);

  return {
    student: {
      key: studentKey,
      found: Boolean(student),
      portalUserId: student?.portalUserId ?? null,
      firstName: student?.firstName ?? null,
      schoolYear: student?.schoolYear ?? null,
      vrEligible: student?.vrEligible ?? null,
      accountStatus: student?.accountStatus ?? null,
      batches: Array.isArray(student?.batches) ? student.batches : []
    },
    lesson: {
      key: lessonKey,
      found: Boolean(lesson),
      lessonId: lesson?.lessonId ?? null,
      title: lesson?.title ?? null,
      subject: lesson?.subject ?? null,
      active: lesson?.active ?? null,
      testOnly: lesson?.testOnly ?? null
    },
    view: {
      key: viewKey,
      found: Boolean(view),
      viewId: view?.viewId ?? null,
      subject: view?.subject ?? null,
      label: view?.label ?? null,
      lessonIds: Array.isArray(view?.lessonIds) ? view.lessonIds : []
    },
    d1: {
      table: 'lesson_entitlements',
      readable: entitlementCountRow !== null,
      rowCount: Number(entitlementCountRow?.count ?? 0),
      testEntitlement: entitlementRow
        ? {
            found: true,
            portalUserIdNorm: entitlementRow.portal_user_id_norm,
            lessonId: entitlementRow.lesson_id,
            coreAccess: Number(entitlementRow.core_access) === 1,
            vrAccess: Number(entitlementRow.vr_access) === 1,
            source: entitlementRow.source,
            firstGrantedAt: entitlementRow.first_granted_at,
            lastConfirmedAt: entitlementRow.last_confirmed_at,
            sourceBatchCode: entitlementRow.source_batch_code,
            sourceLessonDate: entitlementRow.source_lesson_date
          }
        : { found: false }
    }
  };
}

function collectLessonResources(lesson) {
  const resources = new Map();
  const core = lesson?.core || {};

  for (const item of Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []) {
    if (item?.resourceId && item?.r2Key) {
      resources.set(item.resourceId, {
        resourceId: item.resourceId,
        displayName: item.displayName || 'PreLesson Sheet',
        r2Key: item.r2Key,
        kind: 'preLesson',
        protected: false
      });
    }
  }

  for (const pair of Array.isArray(core.homeworks) ? core.homeworks : []) {
    const homework = pair?.homework;
    const answerPack = pair?.answerPack;

    if (homework?.resourceId && homework?.r2Key) {
      resources.set(homework.resourceId, {
        resourceId: homework.resourceId,
        displayName: homework.displayName || 'Homework',
        r2Key: homework.r2Key,
        kind: 'homework',
        protected: false
      });
    }

    if (answerPack?.resourceId && answerPack?.r2Key) {
      resources.set(answerPack.resourceId, {
        resourceId: answerPack.resourceId,
        displayName: answerPack.displayName || 'Answer Pack',
        r2Key: answerPack.r2Key,
        kind: 'answerPack',
        protected: true
      });
    }
  }

  for (const item of Array.isArray(core.otherResources) ? core.otherResources : []) {
    if (item?.resourceId && item?.r2Key) {
      resources.set(item.resourceId, {
        resourceId: item.resourceId,
        displayName: item.displayName || 'Resource',
        r2Key: item.r2Key,
        kind: 'other',
        protected: Boolean(item.protected)
      });
    }
  }

  return resources;
}

function sanitiseLessonForPortal(lesson, availabilityById) {
  const core = lesson?.core || {};

  return {
    lessonId: lesson.lessonId,
    title: lesson.title,
    description: lesson.description || '',
    subject: lesson.subject,
    active: lesson.active !== false,
    preLessonSheets: (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []).map(item => ({
      resourceId: item.resourceId,
      displayName: item.displayName || 'PreLesson Sheet',
      available: availabilityById.get(item.resourceId) === true
    })),
    video: core.video?.screenpal
      ? {
          resourceId: core.video.resourceId || `${lesson.lessonId}-video`,
          screenpal: core.video.screenpal
        }
      : null,
    homeworks: (Array.isArray(core.homeworks) ? core.homeworks : []).map(pair => ({
      pairId: pair.pairId,
      homework: pair.homework
        ? {
            resourceId: pair.homework.resourceId,
            displayName: pair.homework.displayName || 'Homework',
            available: availabilityById.get(pair.homework.resourceId) === true
          }
        : null,
      answerPack: pair.answerPack
        ? {
            resourceId: pair.answerPack.resourceId,
            displayName: pair.answerPack.displayName || 'Answer Pack',
            available: availabilityById.get(pair.answerPack.resourceId) === true,
            passwordRequired: true
          }
        : null
    }))
  };
}

async function resourceAvailability(env, lesson) {
  const resources = collectLessonResources(lesson);
  const availabilityById = new Map();
  let allRequiredResourcesExist = true;

  await Promise.all(
    [...resources.values()].map(async resource => {
      try {
        const head = await env.MATERIALS_R2.head(resource.r2Key);
        const exists = Boolean(head);
        availabilityById.set(resource.resourceId, exists);
        if (!exists) allRequiredResourcesExist = false;
      } catch {
        availabilityById.set(resource.resourceId, false);
        allRequiredResourcesExist = false;
      }
    })
  );

  return { availabilityById, allRequiredResourcesExist };
}

async function studentHasCoreEntitlement(env, portalUserIdNorm, lessonId) {
  const row = await env.DB.prepare(
    `SELECT core_access
     FROM lesson_entitlements
     WHERE portal_user_id_norm = ? AND lesson_id = ?`
  )
    .bind(portalUserIdNorm, lessonId)
    .first();

  return Number(row?.core_access) === 1;
}

async function getPhase3Context(env, portalUserIdNorm = 'test0101', lessonId = 'Y5M1') {
  const norm = normalisePortalUserId(portalUserIdNorm);
  const [student, lesson] = await Promise.all([
    env.STUDENTS_KV.get(`student:${norm}`, { type: 'json' }),
    env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' })
  ]);

  if (!student) return { error: 'STUDENT_NOT_FOUND', status: 404 };
  if (!lesson || lesson.active === false) return { error: 'LESSON_NOT_FOUND', status: 404 };

  const entitled = await studentHasCoreEntitlement(env, norm, lessonId);
  if (!entitled) return { error: 'NO_LESSON_ACCESS', status: 403 };

  return { student, lesson, portalUserIdNorm: norm };
}

async function buildPhase3Portal(env) {
  const portalUserIdNorm = 'test0101';
  const student = await env.STUDENTS_KV.get(`student:${portalUserIdNorm}`, { type: 'json' });
  const view = await env.LESSONS_KV.get('view:maths-year5', { type: 'json' });

  if (!student || !view) {
    return {
      phase3Healthy: false,
      studentFound: Boolean(student),
      viewFound: Boolean(view),
      student: null,
      subjects: []
    };
  }

  const entitlementRows = await env.DB.prepare(
    `SELECT lesson_id
     FROM lesson_entitlements
     WHERE portal_user_id_norm = ? AND core_access = 1`
  )
    .bind(portalUserIdNorm)
    .all();

  const entitledIds = new Set((entitlementRows?.results || []).map(row => row.lesson_id));
  const orderedIds = (Array.isArray(view.lessonIds) ? view.lessonIds : []).filter(id =>
    entitledIds.has(id)
  );
  const lessonRecords = await Promise.all(
    orderedIds.map(id => env.LESSONS_KV.get(`lesson:${id}`, { type: 'json' }))
  );

  const lessons = [];
  let allRequiredResourcesExist = true;

  for (const lesson of lessonRecords.filter(Boolean)) {
    if (lesson.active === false) continue;
    const availability = await resourceAvailability(env, lesson);
    if (!availability.allRequiredResourcesExist) allRequiredResourcesExist = false;
    lessons.push(sanitiseLessonForPortal(lesson, availability.availabilityById));
  }

  const phase3Healthy =
    student.accountStatus === 'active' &&
    lessons.some(lesson => lesson.lessonId === 'Y5M1') &&
    allRequiredResourcesExist;

  return {
    phase3Healthy,
    studentFound: true,
    viewFound: true,
    student: {
      portalUserId: student.portalUserId,
      firstName: student.firstName,
      schoolYear: student.schoolYear,
      accountStatus: student.accountStatus
    },
    subjects: [
      {
        subject: 'maths',
        label: 'Maths',
        views: [{ viewId: view.viewId, label: view.label, lessons }]
      },
      {
        subject: 'english',
        label: 'English',
        views: [],
        developmentUnavailable: true
      }
    ]
  };
}

async function buildPhase4Portal(env, auth) {
  const view = await env.LESSONS_KV.get('view:maths-year5', { type: 'json' });
  if (!view) {
    return {
      phase4Healthy: false,
      viewFound: false,
      student: null,
      subjects: []
    };
  }

  const entitlementRows = await env.DB.prepare(
    `SELECT lesson_id
     FROM lesson_entitlements
     WHERE portal_user_id_norm = ? AND core_access = 1`
  )
    .bind(auth.portalUserIdNorm)
    .all();

  const entitledIds = new Set((entitlementRows?.results || []).map(row => row.lesson_id));
  const orderedIds = (Array.isArray(view.lessonIds) ? view.lessonIds : []).filter(id =>
    entitledIds.has(id)
  );
  const lessonRecords = await Promise.all(
    orderedIds.map(id => env.LESSONS_KV.get(`lesson:${id}`, { type: 'json' }))
  );

  const lessons = [];
  let allRequiredResourcesExist = true;

  for (const lesson of lessonRecords.filter(Boolean)) {
    if (lesson.active === false) continue;
    const availability = await resourceAvailability(env, lesson);
    if (!availability.allRequiredResourcesExist) allRequiredResourcesExist = false;
    const safeLesson = sanitiseLessonForPortal(lesson, availability.availabilityById);

    if (auth.account.accountLocked) {
      safeLesson.locked = true;
      safeLesson.preLessonSheets = safeLesson.preLessonSheets.map(item => ({
        ...item,
        available: false,
        locked: true
      }));
      if (safeLesson.video) safeLesson.video = { resourceId: safeLesson.video.resourceId, locked: true };
      safeLesson.homeworks = safeLesson.homeworks.map(pair => ({
        ...pair,
        homework: pair.homework ? { ...pair.homework, available: false, locked: true } : null,
        answerPack: pair.answerPack ? { ...pair.answerPack, available: false, locked: true } : null
      }));
    }

    lessons.push(safeLesson);
  }

  return {
    phase4Healthy:
      !auth.account.accountLocked &&
      lessons.some(lesson => lesson.lessonId === 'Y5M1') &&
      allRequiredResourcesExist,
    viewFound: true,
    student: {
      portalUserId: auth.portalUserIdNorm,
      firstName: auth.user.firstName,
      schoolYear: auth.user.schoolYear,
      status: auth.account.status,
      expired: auth.account.expired,
      accountLocked: auth.account.accountLocked
    },
    session: {
      lastActivityAt: auth.lastActivityAt,
      idleExpiresAt: auth.idleExpiresAt
    },
    subjects: [
      {
        subject: 'maths',
        label: 'Maths',
        views: [{ viewId: view.viewId, label: view.label, lessons }]
      },
      {
        subject: 'english',
        label: 'English',
        views: [],
        developmentUnavailable: true
      }
    ]
  };
}

async function serveR2Pdf(request, env, objectKey, displayName) {
  const object = await env.MATERIALS_R2.get(objectKey);
  const cors = corsHeaders(request, env);

  if (!object) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/pdf');
  headers.set('content-disposition', `inline; filename="${safeFilename(displayName)}"`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  if (isDevelopment(env)) headers.set('x-fpt-development', 'true');

  return new Response(object.body, { status: 200, headers });
}

async function handlePhase3Resource(request, env, url) {
  const resourceId = String(url.searchParams.get('resourceId') || '').trim();
  const context = await getPhase3Context(env);
  const cors = corsHeaders(request, env);

  if (context.error) {
    return json({ error: context.error }, { status: context.status, headers: cors });
  }

  const resource = collectLessonResources(context.lesson).get(resourceId);
  if (!resource) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  if (resource.protected) {
    return json({ error: 'PASSWORD_REQUIRED' }, { status: 403, headers: cors });
  }

  return serveR2Pdf(request, env, resource.r2Key, resource.displayName);
}

async function handlePhase3Answer(request, env) {
  const cors = corsHeaders(request, env);
  const context = await getPhase3Context(env);

  if (context.error) {
    return json({ error: context.error }, { status: context.status, headers: cors });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, { status: 400, headers: cors });
  }

  const resourceId = String(body?.resourceId || '').trim();
  const password = String(body?.password || '');
  const resource = collectLessonResources(context.lesson).get(resourceId);

  if (!resource || !resource.protected) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  if (password !== String(context.student.answerPassword || '')) {
    return json({ error: 'ANSWER_PASSWORD_INCORRECT' }, { status: 401, headers: cors });
  }

  return serveR2Pdf(request, env, resource.r2Key, resource.displayName);
}

async function phase4Context(request, env, lessonId = 'Y5M1') {
  const auth = await requireSession(request, env, { touch: true, forceTouch: true });
  if (auth.error) return auth;
  if (auth.account.accountLocked) {
    return { error: 'ACCOUNT_LOCKED', status: 403, auth };
  }

  const lesson = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
  if (!lesson || lesson.active === false) {
    return { error: 'LESSON_NOT_FOUND', status: 404, auth };
  }

  const entitled = await studentHasCoreEntitlement(env, auth.portalUserIdNorm, lessonId);
  if (!entitled) {
    return { error: 'NO_LESSON_ACCESS', status: 403, auth };
  }

  return { auth, lesson };
}

async function handlePhase4Portal(request, env) {
  const cors = corsHeaders(request, env);
  const auth = await requireSession(request, env, { touch: true, forceTouch: true });
  if (auth.error) {
    return json({ error: auth.error }, { status: auth.status, headers: cors });
  }

  const portal = await buildPhase4Portal(env, auth);
  return json(
    {
      ok: true,
      phase: 4,
      developmentStudentOnly: isDevelopment(env),
      ...portal,
      timestamp: new Date().toISOString()
    },
    { status: 200, headers: cors }
  );
}

async function handlePhase4Resource(request, env, url) {
  const cors = corsHeaders(request, env);
  const resourceId = String(url.searchParams.get('resourceId') || '').trim();
  const context = await phase4Context(request, env);

  if (context.error) {
    return json({ error: context.error }, { status: context.status, headers: cors });
  }

  const resource = collectLessonResources(context.lesson).get(resourceId);
  if (!resource) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }
  if (resource.protected) {
    return json({ error: 'PASSWORD_REQUIRED' }, { status: 403, headers: cors });
  }

  return serveR2Pdf(request, env, resource.r2Key, resource.displayName);
}

async function handlePhase4Answer(request, env) {
  const cors = corsHeaders(request, env);
  const context = await phase4Context(request, env);

  if (context.error) {
    return json({ error: context.error }, { status: context.status, headers: cors });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, { status: 400, headers: cors });
  }

  const resourceId = String(body?.resourceId || '').trim();
  const password = String(body?.password || '');
  const resource = collectLessonResources(context.lesson).get(resourceId);

  if (!resource || !resource.protected) {
    return json({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  }

  const matches = await timingSafeStringEqual(
    password,
    String(context.auth.user.answerPassword || '')
  );
  if (!matches) {
    return json({ error: 'ANSWER_PASSWORD_INCORRECT' }, { status: 401, headers: cors });
  }

  return serveR2Pdf(request, env, resource.r2Key, resource.displayName);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      if (!Object.keys(cors).length) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    const protectedBrowserRoute =
      url.pathname.startsWith('/api/v1/student/') ||
      url.pathname.startsWith('/api/dev/phase4');

    if (protectedBrowserRoute && !browserOriginAllowed(request, env)) {
      return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      const bindings = await checkBindings(env);
      const infrastructureHealthy =
        bindings.studentsKv.ok &&
        bindings.lessonsKv.ok &&
        bindings.d1.ok &&
        bindings.materialsR2.ok;

      return json(
        {
          ok: true,
          service: 'fpt-portal-v2-worker',
          environment: env.ENVIRONMENT || 'development',
          studentLoginEnabled:
            !isDevelopment(env) &&
            String(env.STUDENT_LOGIN_ENABLED || '').trim().toLowerCase() === 'true',
          developmentTestLoginEnabled:
            isDevelopment(env) && developmentAllowlist(env).size > 0,
          infrastructureHealthy,
          bindings,
          timestamp: new Date().toISOString()
        },
        { status: 200, headers: cors }
      );
    }

    if (url.pathname === '/api/v1/student/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/api/v1/student/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }

    if (url.pathname === '/api/v1/student/session' && request.method === 'GET') {
      return handleSessionSummary(request, env);
    }

    if (url.pathname === '/api/v1/student/session/activity' && request.method === 'POST') {
      return handleActivity(request, env);
    }

    if (url.pathname === '/api/dev/phase2' && request.method === 'GET') {
      if (!isDevelopment(env)) {
        return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      }

      try {
        const diagnostics = await phase2Diagnostics(env);
        const dataFoundationHealthy =
          diagnostics.student.found &&
          diagnostics.lesson.found &&
          diagnostics.view.found &&
          diagnostics.d1.readable &&
          diagnostics.d1.testEntitlement.found &&
          diagnostics.d1.testEntitlement.portalUserIdNorm === 'test0101' &&
          diagnostics.d1.testEntitlement.lessonId === 'DEV-M01' &&
          diagnostics.d1.testEntitlement.coreAccess === true &&
          diagnostics.d1.testEntitlement.vrAccess === false &&
          diagnostics.d1.testEntitlement.source === 'excel';

        return json(
          {
            ok: true,
            phase: 2,
            dataFoundationHealthy,
            diagnostics,
            timestamp: new Date().toISOString()
          },
          { status: 200, headers: cors }
        );
      } catch {
        return json(
          {
            ok: false,
            phase: 2,
            dataFoundationHealthy: false,
            error: 'PHASE2_DIAGNOSTIC_FAILED'
          },
          { status: 500, headers: cors }
        );
      }
    }

    if (url.pathname === '/api/dev/phase3' && request.method === 'GET') {
      if (!isDevelopment(env)) {
        return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      }

      try {
        const portal = await buildPhase3Portal(env);
        return json(
          {
            ok: true,
            phase: 3,
            studentLoginEnabled: false,
            developmentStudentOnly: true,
            ...portal,
            timestamp: new Date().toISOString()
          },
          { status: 200, headers: cors }
        );
      } catch {
        return json(
          {
            ok: false,
            phase: 3,
            phase3Healthy: false,
            error: 'PHASE3_PORTAL_BUILD_FAILED'
          },
          { status: 500, headers: cors }
        );
      }
    }

    if (url.pathname === '/api/dev/phase3/resource' && request.method === 'GET') {
      if (!isDevelopment(env)) {
        return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      }
      return handlePhase3Resource(request, env, url);
    }

    if (url.pathname === '/api/dev/phase3/answer' && request.method === 'POST') {
      if (!isDevelopment(env)) {
        return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      }
      return handlePhase3Answer(request, env);
    }

    if (url.pathname === '/api/dev/phase4' && request.method === 'GET') {
      if (!isDevelopment(env)) {
        return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      }
      return handlePhase4Portal(request, env);
    }

    if (url.pathname === '/api/dev/phase4/resource' && request.method === 'GET') {
      if (!isDevelopment(env)) {
        return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      }
      return handlePhase4Resource(request, env, url);
    }

    if (url.pathname === '/api/dev/phase4/answer' && request.method === 'POST') {
      if (!isDevelopment(env)) {
        return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      }
      return handlePhase4Answer(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json(
        {
          error: 'NOT_IMPLEMENTED',
          message: 'Portal V2 API route not implemented yet.'
        },
        { status: 501, headers: cors }
      );
    }

    return json(
      {
        service: 'fpt-portal-v2-worker',
        message: 'Future Perfect Tuitions Portal V2 Worker'
      },
      { status: 200, headers: cors }
    );
  }
};
