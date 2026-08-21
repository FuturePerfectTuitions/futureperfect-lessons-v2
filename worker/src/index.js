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
    Vary: 'Origin',
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
  const masterPre = Array.isArray(lesson?.preLessonSheets) ? lesson.preLessonSheets : null;
  const masterHomework = Array.isArray(lesson?.homeworks) ? lesson.homeworks : null;
  const masterOther = Array.isArray(lesson?.otherResources) ? lesson.otherResources : null;

  const preLessonSheets = masterPre || (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []);
  const homeworks = masterHomework || (Array.isArray(core.homeworks) ? core.homeworks : []);
  const otherResources = masterOther || (Array.isArray(core.otherResources) ? core.otherResources : []);

  for (const item of preLessonSheets) {
    const resourceId = item?.resourceId || item?.id;
    const r2Key = item?.r2Key || item?.r2;
    if (resourceId && r2Key) {
      resources.set(resourceId, {
        resourceId,
        displayName: item.displayName || item.name || 'PreLesson Sheet',
        r2Key,
        kind: 'preLesson',
        protected: false
      });
    }
  }

  for (const pair of homeworks) {
    const homework = pair?.homework || (pair?.r2 || pair?.r2Key ? pair : null);
    const answerPack = pair?.answerPack;

    if (homework) {
      const resourceId =
        homework.resourceId ||
        homework.id ||
        pair.resourceId ||
        pair.id ||
        (pair.pairId ? `${pair.pairId}-file` : null);
      const r2Key = homework.r2Key || homework.r2;
      if (resourceId && r2Key) {
        resources.set(resourceId, {
          resourceId,
          displayName: homework.displayName || homework.name || pair.name || 'Homework',
          r2Key,
          kind: 'homework',
          protected: false
        });
      }
    }

    if (answerPack) {
      const resourceId =
        answerPack.resourceId ||
        answerPack.id ||
        (pair.pairId ? `${pair.pairId}-answer` : null);
      const r2Key = answerPack.r2Key || answerPack.r2;
      if (resourceId && r2Key) {
        resources.set(resourceId, {
          resourceId,
          displayName: answerPack.displayName || answerPack.name || 'Answer Pack',
          r2Key,
          kind: 'answerPack',
          protected: true
        });
      }
    }
  }

  for (const item of otherResources) {
    const resourceId = item?.resourceId || item?.id;
    const r2Key = item?.r2Key || item?.r2;
    if (resourceId && r2Key) {
      resources.set(resourceId, {
        resourceId,
        displayName: item.displayName || item.name || 'Resource',
        r2Key,
        kind: 'other',
        protected: Boolean(item.protected)
      });
    }
  }

  return resources;
}

function sanitiseLessonForPortal(lesson, availabilityById) {
  const core = lesson?.core || {};
  const preLessonSheets = Array.isArray(lesson?.preLessonSheets)
    ? lesson.preLessonSheets
    : (Array.isArray(core.preLessonSheets) ? core.preLessonSheets : []);
  const homeworks = Array.isArray(lesson?.homeworks)
    ? lesson.homeworks
    : (Array.isArray(core.homeworks) ? core.homeworks : []);
  const video = lesson?.video || core.video || null;

  return {
    lessonId: lesson.lessonId,
    title: lesson.title,
    description: lesson.description || lesson.desc || '',
    subject: lesson.subject,
    active: lesson.active !== false,
    preLessonSheets: preLessonSheets.map((item, index) => {
      const resourceId = item.resourceId || item.id || `${lesson.lessonId}-pre-${index + 1}`;
      return {
        resourceId,
        displayName: item.displayName || item.name || 'PreLesson Sheet',
        available: availabilityById.get(resourceId) === true
      };
    }),
    video: video?.screenpal || video?.sp
      ? {
          resourceId: video.resourceId || `${lesson.lessonId}-video`,
          screenpal: video.screenpal || video.sp
        }
      : null,
    homeworks: homeworks.map((pair, index) => {
      const homework = pair.homework || (pair?.r2 || pair?.r2Key ? pair : null);
      const answerPack = pair.answerPack || null;
      const pairId = pair.pairId || `${lesson.lessonId}-hw-${index + 1}`;
      const homeworkResourceId = homework
        ? (homework.resourceId || homework.id || `${pairId}-file`)
        : null;
      const answerResourceId = answerPack
        ? (answerPack.resourceId || answerPack.id || `${pairId}-answer`)
        : null;

      return {
        pairId,
        homework: homework
          ? {
              resourceId: homeworkResourceId,
              displayName: homework.displayName || homework.name || pair.name || 'Homework',
              available: availabilityById.get(homeworkResourceId) === true
            }
          : null,
        answerPack: answerPack
          ? {
              resourceId: answerResourceId,
              displayName: answerPack.displayName || answerPack.name || 'Answer Pack',
              available: availabilityById.get(answerResourceId) === true,
              passwordRequired: true
            }
          : null
      };
    })
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
      if (safeLesson.video) {
        safeLesson.video = { resourceId: safeLesson.video.resourceId, locked: true };
      }
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

const CURRICULUM_FALLBACK_VIEWS = {
  MATHS_Y2: ['maths-year2'],
  MATHS_Y3: ['maths-year3'],
  MATHS_L1: ['maths-year4', 'maths-level1'],
  MATHS_L2: ['maths-year5', 'maths-level2'],
  MATHS_L3: ['maths-level3', 'maths-year6'],
  MATHS_Y6_EXTRA: ['maths-year6-extra'],
  ENGLISH_Y2: ['english-year2'],
  ENGLISH_Y3: ['english-year3'],
  ENGLISH_Y4: ['english-year4', 'english-year4-11plus'],
  ENGLISH_Y5: ['english-year5', 'english-year5-11plus'],
  ENGLISH_Y6: ['english-year6']
};

const FULL_LIBRARY_RULES = {
  MATHS_L1_FULL: { curriculumCodes: ['MATHS_L1'] },
  MATHS_L2_FULL: { curriculumCodes: ['MATHS_L2'] },
  MATHS_L3_FULL: { curriculumCodes: ['MATHS_L3'] },
  MATHS_Y6_FULL: { curriculumCodes: ['MATHS_L3', 'MATHS_Y6_EXTRA'] },
  ENGLISH_Y4_FULL: { curriculumCodes: ['ENGLISH_Y4'] },
  ENGLISH_Y4_11PLUS_FULL: { curriculumCodes: ['ENGLISH_Y4'], includesVr: true },
  ENGLISH_Y5_FULL: { curriculumCodes: ['ENGLISH_Y5'] },
  ENGLISH_Y5_11PLUS_FULL: { curriculumCodes: ['ENGLISH_Y5'], includesVr: true }
};

function makeDescriptor({
  viewId,
  subject,
  label,
  curriculumCodes,
  sortOrder,
  presentation = 'normal',
  current = false,
  lockedPreview = false,
  source = 'historical'
}) {
  return {
    viewId,
    subject,
    label,
    curriculumCodes,
    sortOrder,
    presentation,
    current,
    lockedPreview,
    source
  };
}

function mathsNormalDescriptor(year, extras = {}) {
  const config = {
    2: ['maths-year2', 'Year 2', ['MATHS_Y2'], 20],
    3: ['maths-year3', 'Year 3', ['MATHS_Y3'], 30],
    4: ['maths-year4', 'Year 4', ['MATHS_L1'], 40],
    5: ['maths-year5', 'Year 5', ['MATHS_L2'], 50],
    6: ['maths-year6', 'Year 6', ['MATHS_L3', 'MATHS_Y6_EXTRA'], 60]
  }[Number(year)];

  if (!config) return null;
  return makeDescriptor({
    viewId: config[0],
    subject: 'maths',
    label: config[1],
    curriculumCodes: config[2],
    sortOrder: config[3],
    ...extras
  });
}

function mathsLevelDescriptor(level, extras = {}) {
  const config = {
    1: ['maths-level1', 'Level 1', ['MATHS_L1'], 40],
    2: ['maths-level2', 'Level 2', ['MATHS_L2'], 50],
    3: ['maths-level3', 'Level 3', ['MATHS_L3'], 60]
  }[Number(level)];

  if (!config) return null;
  return makeDescriptor({
    viewId: config[0],
    subject: 'maths',
    label: config[1],
    curriculumCodes: config[2],
    sortOrder: config[3],
    presentation: '11plus',
    ...extras
  });
}

function englishDescriptor(year, elevenPlus = false, extras = {}) {
  const y = Number(year);
  if (![2, 3, 4, 5, 6].includes(y)) return null;

  const is11 = Boolean(elevenPlus && (y === 4 || y === 5));
  return makeDescriptor({
    viewId: `english-year${y}${is11 ? '-11plus' : ''}`,
    subject: 'english',
    label: `Year ${y}${is11 ? ' 11+' : ''}`,
    curriculumCodes: [`ENGLISH_Y${y}`],
    sortOrder: y * 10,
    presentation: is11 ? '11plus' : 'normal',
    ...extras
  });
}

function descriptorForFullLibrary(code) {
  switch (String(code || '').toUpperCase()) {
    case 'MATHS_L1_FULL': return mathsLevelDescriptor(1, { source: 'fullLibrary' });
    case 'MATHS_L2_FULL': return mathsLevelDescriptor(2, { source: 'fullLibrary' });
    case 'MATHS_L3_FULL': return mathsLevelDescriptor(3, { source: 'fullLibrary' });
    case 'MATHS_Y6_FULL': return mathsNormalDescriptor(6, { source: 'fullLibrary' });
    case 'ENGLISH_Y4_FULL': return englishDescriptor(4, false, { source: 'fullLibrary' });
    case 'ENGLISH_Y4_11PLUS_FULL': return englishDescriptor(4, true, { source: 'fullLibrary' });
    case 'ENGLISH_Y5_FULL': return englishDescriptor(5, false, { source: 'fullLibrary' });
    case 'ENGLISH_Y5_11PLUS_FULL': return englishDescriptor(5, true, { source: 'fullLibrary' });
    default: return null;
  }
}

function classifyCurrentBatches(user) {
  const batches = Array.isArray(user?.batches)
    ? user.batches.map(value => String(value || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const maths = batches.filter(code => /^Y[2-6]M/.test(code));
  const english = batches.filter(code => /^Y[2-6]E/.test(code));

  return {
    mathsCurrent: maths.length > 0,
    maths11Plus: maths.some(code => /^Y[45]M11/.test(code)),
    englishCurrent: english.length > 0,
    english11Plus: english.some(code => /^Y[45]E11/.test(code)),
    unclassifiedCount: batches.length - maths.length - english.length
  };
}

function currentMathsDescriptor(user, classification) {
  if (!classification.mathsCurrent) return null;
  const year = Number(user?.schoolYear || 0);
  if (classification.maths11Plus && year === 4) {
    return mathsLevelDescriptor(2, { current: true, source: 'current' });
  }
  if (classification.maths11Plus && year === 5) {
    return mathsLevelDescriptor(3, { current: true, source: 'current' });
  }
  return mathsNormalDescriptor(year, { current: true, source: 'current' });
}

function currentEnglishDescriptor(user, classification) {
  if (!classification.englishCurrent) return null;
  const year = Number(user?.schoolYear || 0);
  return englishDescriptor(year, classification.english11Plus, {
    current: true,
    source: 'current'
  });
}

function descriptorSignature(descriptor) {
  return `${descriptor.subject}:${[...descriptor.curriculumCodes].sort().join('+')}`;
}

function addDescriptorDedup(map, descriptor, priority) {
  if (!descriptor) return;
  const signature = descriptorSignature(descriptor);
  const existing = map.get(signature);
  if (!existing || priority > existing.priority) {
    map.set(signature, { descriptor, priority });
  }
}

function rawCatalogueItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.lessonIds)) return raw.lessonIds;
  if (Array.isArray(raw.lessons)) return raw.lessons;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function lessonMetadata(record, fallbackId, fallbackOrder, curriculumCode) {
  if (!record || typeof record !== 'object') return null;
  const lessonId = String(record.lessonId || fallbackId || '').trim();
  if (!lessonId) return null;
  const orderValue = Number(record.order);
  const order = Number.isFinite(orderValue) ? orderValue : fallbackOrder;

  return {
    lessonId,
    title: String(record.title || lessonId),
    description: String(record.description || record.desc || ''),
    active: record.active !== false,
    order,
    hasVr: Boolean(record.vr),
    curriculumCodes: [curriculumCode]
  };
}

async function loadCurriculum(env, curriculumCode) {
  const raw = await env.LESSONS_KV.get(`curriculum:${curriculumCode}`, { type: 'json' });
  let items = rawCatalogueItems(raw);
  let found = Boolean(items.length);

  if (!items.length) {
    for (const legacyViewId of CURRICULUM_FALLBACK_VIEWS[curriculumCode] || []) {
      const legacy = await env.LESSONS_KV.get(`view:${legacyViewId}`, { type: 'json' });
      const legacyItems = rawCatalogueItems(legacy);
      if (legacyItems.length) {
        items = legacyItems;
        found = true;
        break;
      }
    }
  }

  if (!items.length) return { found: false, lessons: [] };

  const lessons = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof item === 'string') {
      const record = await env.LESSONS_KV.get(`lesson:${item}`, { type: 'json' });
      const meta = lessonMetadata(record, item, index + 1, curriculumCode);
      if (meta) lessons.push(meta);
      continue;
    }
    if (item && typeof item === 'object') {
      const lessonId = String(item.lessonId || '').trim();
      let record = item;
      if (lessonId) {
        const canonicalLesson = await env.LESSONS_KV.get(`lesson:${lessonId}`, { type: 'json' });
        if (canonicalLesson) record = canonicalLesson;
      }
      const meta = lessonMetadata(record, lessonId, index + 1, curriculumCode);
      if (meta) lessons.push(meta);
    }
  }

  lessons.sort((a, b) => a.order - b.order || a.lessonId.localeCompare(b.lessonId));
  return { found, lessons };
}

async function loadDescriptorCatalogue(env, descriptor) {
  const merged = new Map();
  let foundAny = false;

  for (const code of descriptor.curriculumCodes) {
    const curriculum = await loadCurriculum(env, code);
    if (curriculum.found) foundAny = true;
    for (const lesson of curriculum.lessons) {
      const existing = merged.get(lesson.lessonId);
      if (!existing) {
        merged.set(lesson.lessonId, { ...lesson });
      } else {
        existing.curriculumCodes = [...new Set([
          ...(existing.curriculumCodes || []),
          ...(lesson.curriculumCodes || [])
        ])];
        existing.order = Math.min(existing.order, lesson.order);
        existing.hasVr = existing.hasVr || lesson.hasVr;
      }
    }
  }

  return {
    found: foundAny,
    lessons: [...merged.values()]
      .filter(lesson => lesson.active !== false)
      .sort((a, b) => a.order - b.order || a.lessonId.localeCompare(b.lessonId))
  };
}

async function loadStudentAccessState(env, auth) {
  const rows = await env.DB.prepare(
    `SELECT lesson_id, core_access, vr_access, source_batch_code
     FROM lesson_entitlements
     WHERE portal_user_id_norm = ?`
  )
    .bind(auth.portalUserIdNorm)
    .all();

  const d1Rows = Array.isArray(rows?.results) ? rows.results : [];
  const d1Core = new Set();
  const d1Vr = new Set();
  const batchByLesson = new Map();

  for (const row of d1Rows) {
    const lessonId = String(row.lesson_id || '').trim();
    if (!lessonId) continue;
    if (Number(row.core_access) === 1) d1Core.add(lessonId);
    if (Number(row.vr_access) === 1) d1Vr.add(lessonId);
    if (row.source_batch_code) {
      const existing = batchByLesson.get(lessonId) || new Set();
      existing.add(String(row.source_batch_code).toUpperCase());
      batchByLesson.set(lessonId, existing);
    }
  }

  const manual = auth.user?.manualAccess || {};
  const manualCore = new Set(Array.isArray(manual.coreLessons) ? manual.coreLessons.map(String) : []);
  const manualVr = new Set(Array.isArray(manual.vrLessons) ? manual.vrLessons.map(String) : []);
  const blocked = new Set(Array.isArray(auth.user?.blockedLessons) ? auth.user.blockedLessons.map(String) : []);
  const fullLibraries = new Set(
    Array.isArray(auth.user?.fullLibraries)
      ? auth.user.fullLibraries.map(value => String(value).toUpperCase())
      : []
  );

  return { d1Core, d1Vr, batchByLesson, manualCore, manualVr, blocked, fullLibraries };
}

function fullLibraryCoversLesson(access, lesson) {
  const lessonCodes = new Set(lesson.curriculumCodes || []);
  for (const code of access.fullLibraries) {
    const rule = FULL_LIBRARY_RULES[code];
    if (rule?.curriculumCodes.some(curriculumCode => lessonCodes.has(curriculumCode))) {
      return true;
    }
  }
  return false;
}

function sourceCoreEntitled(access, lesson) {
  return (
    access.d1Core.has(lesson.lessonId) ||
    access.manualCore.has(lesson.lessonId) ||
    fullLibraryCoversLesson(access, lesson)
  );
}

function hasDirectOrManualCore(access, lessonId) {
  return access.d1Core.has(lessonId) || access.manualCore.has(lessonId);
}

function historicalDescriptorForCurriculum(curriculumCode, access, lessonIds) {
  const sourceBatches = [];
  for (const [lessonId, batches] of access.batchByLesson.entries()) {
    if (!lessonIds.has(lessonId) || !hasDirectOrManualCore(access, lessonId)) continue;
    sourceBatches.push(...batches);
  }
  const had11Maths = sourceBatches.some(code => /^Y[45]M11/.test(code));
  const had11English = sourceBatches.some(code => /^Y[45]E11/.test(code));

  switch (curriculumCode) {
    case 'MATHS_Y2': return mathsNormalDescriptor(2);
    case 'MATHS_Y3': return mathsNormalDescriptor(3);
    case 'MATHS_L1': return mathsNormalDescriptor(4);
    case 'MATHS_L2': return had11Maths ? mathsLevelDescriptor(2) : mathsNormalDescriptor(5);
    case 'MATHS_L3': return had11Maths ? mathsLevelDescriptor(3) : mathsNormalDescriptor(6);
    case 'MATHS_Y6_EXTRA': return mathsNormalDescriptor(6);
    case 'ENGLISH_Y2': return englishDescriptor(2);
    case 'ENGLISH_Y3': return englishDescriptor(3);
    case 'ENGLISH_Y4': return englishDescriptor(4, had11English);
    case 'ENGLISH_Y5': return englishDescriptor(5, had11English);
    case 'ENGLISH_Y6': return englishDescriptor(6);
    default: return null;
  }
}

async function safeCurriculumStartPoint(env, portalUserIdNorm, curriculumCode) {
  try {
    const row = await env.DB.prepare(
      `SELECT lesson_id, lesson_order, established_at
       FROM curriculum_start_points
       WHERE portal_user_id_norm = ? AND curriculum_code = ?`
    )
      .bind(portalUserIdNorm, curriculumCode)
      .first();
    return row ? { lessonOrder: Number(row.lesson_order) } : null;
  } catch {
    return null;
  }
}

async function visibleLessonsForDescriptor(env, auth, access, descriptor) {
  const catalogue = await loadDescriptorCatalogue(env, descriptor);
  if (!catalogue.found) {
    return { catalogueAvailable: false, lessons: [], openLessonCount: 0, lockedLessonCount: 0 };
  }

  let missedPreviewIds = new Set();
  if (
    descriptor.current &&
    descriptor.subject === 'maths' &&
    descriptor.presentation === '11plus' &&
    descriptor.curriculumCodes.length === 1
  ) {
    const startPoint = await safeCurriculumStartPoint(
      env,
      auth.portalUserIdNorm,
      descriptor.curriculumCodes[0]
    );
    if (startPoint && Number.isFinite(startPoint.lessonOrder)) {
      missedPreviewIds = new Set(
        catalogue.lessons
          .filter(lesson => lesson.order < startPoint.lessonOrder)
          .map(lesson => lesson.lessonId)
      );
    }
  }

  const result = [];
  for (const lesson of catalogue.lessons) {
    const sourceEntitled = sourceCoreEntitled(access, lesson);
    const blocked = access.blocked.has(lesson.lessonId);
    const open = sourceEntitled && !blocked && !auth.account.accountLocked;
    const missedPreview = missedPreviewIds.has(lesson.lessonId);

    let visible = false;
    if (descriptor.lockedPreview) visible = true;
    else if (descriptor.current) visible = sourceEntitled || missedPreview;
    else visible = sourceEntitled;
    if (!visible) continue;

    result.push({
      lessonId: lesson.lessonId,
      title: lesson.title,
      description: lesson.description,
      state: open ? 'open' : 'locked',
      locked: !open,
      blocked,
      preview: Boolean(descriptor.lockedPreview && !sourceEntitled),
      missedPreview: Boolean(missedPreview && !sourceEntitled)
    });
  }

  return {
    catalogueAvailable: true,
    lessons: result,
    openLessonCount: result.filter(lesson => lesson.state === 'open').length,
    lockedLessonCount: result.filter(lesson => lesson.state === 'locked').length
  };
}

async function buildVisibleDescriptors(env, auth, access) {
  const classification = classifyCurrentBatches(auth.user);
  const bySignature = new Map();

  addDescriptorDedup(bySignature, currentMathsDescriptor(auth.user, classification), 100);
  addDescriptorDedup(bySignature, currentEnglishDescriptor(auth.user, classification), 100);

  for (const code of access.fullLibraries) {
    addDescriptorDedup(bySignature, descriptorForFullLibrary(code), 95);
  }

  if (classification.mathsCurrent && !classification.englishCurrent) {
    addDescriptorDedup(
      bySignature,
      englishDescriptor(Number(auth.user?.schoolYear || 0), classification.maths11Plus, {
        lockedPreview: true,
        source: 'crossSubjectPreview'
      }),
      90
    );
  }

  if (classification.englishCurrent && !classification.mathsCurrent) {
    addDescriptorDedup(
      bySignature,
      mathsNormalDescriptor(Number(auth.user?.schoolYear || 0), {
        lockedPreview: true,
        source: 'crossSubjectPreview'
      }),
      90
    );
  }

  for (const curriculumCode of [
    'MATHS_Y2','MATHS_Y3','MATHS_L1','MATHS_L2','MATHS_L3','MATHS_Y6_EXTRA',
    'ENGLISH_Y2','ENGLISH_Y3','ENGLISH_Y4','ENGLISH_Y5','ENGLISH_Y6'
  ]) {
    const probe = makeDescriptor({
      viewId: `probe-${curriculumCode}`,
      subject: curriculumCode.startsWith('ENGLISH_') ? 'english' : 'maths',
      label: curriculumCode,
      curriculumCodes: [curriculumCode],
      sortOrder: 0
    });
    const catalogue = await loadDescriptorCatalogue(env, probe);
    const hasSource = catalogue.lessons.some(lesson => hasDirectOrManualCore(access, lesson.lessonId));
    if (!hasSource) continue;
    const descriptor = historicalDescriptorForCurriculum(
      curriculumCode,
      access,
      new Set(catalogue.lessons.map(lesson => lesson.lessonId))
    );
    addDescriptorDedup(bySignature, descriptor, 60);
  }

  return {
    classification,
    descriptors: [...bySignature.values()]
      .map(entry => entry.descriptor)
      .sort((a, b) => a.subject.localeCompare(b.subject) || a.sortOrder - b.sortOrder)
  };
}

async function buildStudentHome(env, auth) {
  const access = await loadStudentAccessState(env, auth);
  const { descriptors, classification } = await buildVisibleDescriptors(env, auth, access);
  const views = [];

  for (const descriptor of descriptors) {
    const visible = await visibleLessonsForDescriptor(env, auth, access, descriptor);
    if (!(descriptor.current || descriptor.lockedPreview || descriptor.source === 'fullLibrary' || visible.lessons.length)) {
      continue;
    }
    views.push({
      viewId: descriptor.viewId,
      subject: descriptor.subject,
      label: descriptor.label,
      lockedPreview: descriptor.lockedPreview,
      catalogueAvailable: visible.catalogueAvailable,
      visibleLessonCount: visible.lessons.length,
      openLessonCount: visible.openLessonCount,
      lockedLessonCount: visible.lockedLessonCount
    });
  }

  return {
    student: {
      firstName: String(auth.user.firstName || ''),
      portalUserId: auth.portalUserIdNorm,
      schoolYear: Number(auth.user.schoolYear || 0) || null,
      status: auth.account.status,
      expired: auth.account.expired,
      accountLocked: auth.account.accountLocked
    },
    subjects: [
      { subject: 'maths', label: 'Maths', views: views.filter(view => view.subject === 'maths') },
      { subject: 'english', label: 'English', views: views.filter(view => view.subject === 'english') }
    ],
    diagnostics: isDevelopment(env)
      ? {
          currentMathsDetected: classification.mathsCurrent,
          currentEnglishDetected: classification.englishCurrent,
          unclassifiedBatchCount: classification.unclassifiedCount
        }
      : undefined
  };
}

async function resolveVisibleDescriptor(env, auth, viewId) {
  const access = await loadStudentAccessState(env, auth);
  const { descriptors } = await buildVisibleDescriptors(env, auth, access);
  return {
    access,
    descriptor: descriptors.find(item => item.viewId === viewId) || null
  };
}

async function handleStudentHome(request, env) {
  const cors = corsHeaders(request, env);
  const auth = await requireSession(request, env, { touch: true, forceTouch: true });
  if (auth.error) return json({ error: auth.error }, { status: auth.status, headers: cors });

  try {
    return json(
      { ok: true, ...(await buildStudentHome(env, auth)), timestamp: new Date().toISOString() },
      { status: 200, headers: cors }
    );
  } catch {
    return json({ error: 'NAVIGATION_BUILD_FAILED' }, { status: 500, headers: cors });
  }
}

async function handleStudentViewLessons(request, env, viewId) {
  const cors = corsHeaders(request, env);
  const auth = await requireSession(request, env, { touch: true, forceTouch: true });
  if (auth.error) return json({ error: auth.error }, { status: auth.status, headers: cors });

  try {
    const { access, descriptor } = await resolveVisibleDescriptor(env, auth, viewId);
    if (!descriptor) {
      return json({ error: 'VIEW_NOT_AVAILABLE' }, { status: 404, headers: cors });
    }
    const visible = await visibleLessonsForDescriptor(env, auth, access, descriptor);
    return json(
      {
        ok: true,
        view: {
          viewId: descriptor.viewId,
          subject: descriptor.subject,
          label: descriptor.label,
          lockedPreview: descriptor.lockedPreview,
          catalogueAvailable: visible.catalogueAvailable
        },
        lessons: visible.lessons,
        timestamp: new Date().toISOString()
      },
      { status: 200, headers: cors }
    );
  } catch {
    return json({ error: 'LESSON_LIST_BUILD_FAILED' }, { status: 500, headers: cors });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      if (!Object.keys(cors).length) return new Response(null, { status: 403 });
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
        bindings.studentsKv.ok && bindings.lessonsKv.ok && bindings.d1.ok && bindings.materialsR2.ok;
      return json(
        {
          ok: true,
          service: 'fpt-portal-v2-worker',
          environment: env.ENVIRONMENT || 'development',
          studentLoginEnabled:
            !isDevelopment(env) && String(env.STUDENT_LOGIN_ENABLED || '').trim().toLowerCase() === 'true',
          developmentTestLoginEnabled: isDevelopment(env) && developmentAllowlist(env).size > 0,
          infrastructureHealthy,
          bindings,
          timestamp: new Date().toISOString()
        },
        { status: 200, headers: cors }
      );
    }

    if (url.pathname === '/api/v1/student/auth/login' && request.method === 'POST') return handleLogin(request, env);
    if (url.pathname === '/api/v1/student/auth/logout' && request.method === 'POST') return handleLogout(request, env);
    if (url.pathname === '/api/v1/student/session' && request.method === 'GET') return handleSessionSummary(request, env);
    if (url.pathname === '/api/v1/student/session/activity' && request.method === 'POST') return handleActivity(request, env);
    if (url.pathname === '/api/v1/student/home' && request.method === 'GET') return handleStudentHome(request, env);

    const viewLessonsMatch = url.pathname.match(/^\/api\/v1\/student\/views\/([^/]+)\/lessons$/);
    if (viewLessonsMatch && request.method === 'GET') {
      return handleStudentViewLessons(request, env, decodeURIComponent(viewLessonsMatch[1]));
    }

    if (url.pathname === '/api/dev/phase2' && request.method === 'GET') {
      if (!isDevelopment(env)) return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      try {
        const diagnostics = await phase2Diagnostics(env);
        const dataFoundationHealthy =
          diagnostics.student.found && diagnostics.lesson.found && diagnostics.view.found &&
          diagnostics.d1.readable && diagnostics.d1.testEntitlement.found &&
          diagnostics.d1.testEntitlement.portalUserIdNorm === 'test0101' &&
          diagnostics.d1.testEntitlement.lessonId === 'DEV-M01' &&
          diagnostics.d1.testEntitlement.coreAccess === true &&
          diagnostics.d1.testEntitlement.vrAccess === false &&
          diagnostics.d1.testEntitlement.source === 'excel';
        return json({ ok: true, phase: 2, dataFoundationHealthy, diagnostics, timestamp: new Date().toISOString() }, { status: 200, headers: cors });
      } catch {
        return json({ ok: false, phase: 2, dataFoundationHealthy: false, error: 'PHASE2_DIAGNOSTIC_FAILED' }, { status: 500, headers: cors });
      }
    }

    if (url.pathname === '/api/dev/phase3' && request.method === 'GET') {
      if (!isDevelopment(env)) return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      try {
        const portal = await buildPhase3Portal(env);
        return json({ ok: true, phase: 3, studentLoginEnabled: false, developmentStudentOnly: true, ...portal, timestamp: new Date().toISOString() }, { status: 200, headers: cors });
      } catch {
        return json({ ok: false, phase: 3, phase3Healthy: false, error: 'PHASE3_PORTAL_BUILD_FAILED' }, { status: 500, headers: cors });
      }
    }

    if (url.pathname === '/api/dev/phase3/resource' && request.method === 'GET') {
      if (!isDevelopment(env)) return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      return handlePhase3Resource(request, env, url);
    }
    if (url.pathname === '/api/dev/phase3/answer' && request.method === 'POST') {
      if (!isDevelopment(env)) return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      return handlePhase3Answer(request, env);
    }
    if (url.pathname === '/api/dev/phase4' && request.method === 'GET') {
      if (!isDevelopment(env)) return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      return handlePhase4Portal(request, env);
    }
    if (url.pathname === '/api/dev/phase4/resource' && request.method === 'GET') {
      if (!isDevelopment(env)) return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      return handlePhase4Resource(request, env, url);
    }
    if (url.pathname === '/api/dev/phase4/answer' && request.method === 'POST') {
      if (!isDevelopment(env)) return json({ error: 'NOT_FOUND' }, { status: 404, headers: cors });
      return handlePhase4Answer(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'NOT_IMPLEMENTED', message: 'Portal V2 API route not implemented yet.' }, { status: 501, headers: cors });
    }

    return json({ service: 'fpt-portal-v2-worker', message: 'Future Perfect Tuitions Portal V2 Worker' }, { status: 200, headers: cors });
  }
};
