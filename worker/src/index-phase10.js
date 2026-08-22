import phase9Worker from './index-phase9.js';

const SPECIAL_BUCKETS = {
  Y4MAssT1: { type: 'assessment', allowedViews: new Set(['maths-level2']) },
  Y4MAssT2: { type: 'assessment', allowedViews: new Set(['maths-level2']) },
  Y5MAssT1: { type: 'assessment', allowedViews: new Set(['maths-level3']) },
  Y5MAssT2: { type: 'assessment', allowedViews: new Set(['maths-level3']) },
  VR_HOWTO: { type: 'vr-howto', allowedViews: new Set(['english-year4-11plus', 'english-year5-11plus']) },
  MOCKS: { type: 'mocks', allowedViews: new Set(['maths-level3', 'english-year5-11plus']) }
};

const MOCK_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MOCK_RATE_LIMIT_MAX_ATTEMPTS = 8;

const json = (body, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
};

function allowedOrigins(env) {
  return new Set(['https://futureperfecttuitions.github.io', ...String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
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

function normalisePortalUserId(value) { return String(value || '').trim().toLowerCase(); }

async function timingSafeStringEqual(left, right) {
  const encode = value => new TextEncoder().encode(String(value));
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(left)),
    crypto.subtle.digest('SHA-256', encode(right))
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i += 1) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

function screenpalEmbedUrl(screenpalId) {
  const id = String(screenpalId || '').trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return `https://go.screenpal.com/player/${encodeURIComponent(id)}?ff=1&title=0&dcc=0&bg=transparent&embedded=1`;
}

function manualSpecialBuckets(user) {
  const raw = user?.manualAccess?.specialBuckets;
  return new Set(Array.isArray(raw) ? raw.map(value => String(value || '').trim()) : []);
}

function bucketRule(bucketId) { return SPECIAL_BUCKETS[String(bucketId || '').trim()] || null; }

async function delegatedJson(request, env, path) {
  const url = new URL(path, request.url);
  const delegated = new Request(url.toString(), { method: 'GET', headers: request.headers });
  const response = await phase9Worker.fetch(delegated, env);
  let body = null;
  try { body = await response.clone().json(); } catch (_) {}
  return { response, body };
}

async function sessionContext(request, env) {
  const { response, body } = await delegatedJson(request, env, '/api/v1/student/session');
  if (!response.ok || !body?.ok) return { error: body?.error || 'SESSION_INVALID', status: response.status || 401 };
  const portalUserIdNorm = normalisePortalUserId(body.portalUserId);
  if (!portalUserIdNorm) return { error: 'SESSION_INVALID', status: 401 };
  const user = await env.STUDENTS_KV.get(`user:${portalUserIdNorm}`, { type: 'json' });
  if (!user) return { error: 'SESSION_INVALID', status: 401 };
  if (body.accountLocked) return { error: 'ACCOUNT_LOCKED', status: 403 };
  return { session: body, portalUserIdNorm, user };
}

async function visibleOpenViewContext(request, env, viewId) {
  const cleanViewId = String(viewId || '').trim();
  if (!cleanViewId) return { error: 'VIEW_REQUIRED', status: 400 };
  const { response, body } = await delegatedJson(request, env, `/api/v1/student/views/${encodeURIComponent(cleanViewId)}/lessons`);
  if (!response.ok || !body?.ok || !body?.view) return { error: body?.error || 'VIEW_NOT_AVAILABLE', status: response.status || 404 };
  if (body.view.lockedPreview) return { error: 'SPECIAL_ACCESS_NOT_AVAILABLE_IN_PREVIEW', status: 403 };
  return { view: body.view };
}

function bucketAllowedInView(bucketId, viewId) {
  const rule = bucketRule(bucketId);
  return Boolean(rule && rule.allowedViews.has(String(viewId || '').trim()));
}

async function authorisedBucketContext(request, env, bucketId, viewId) {
  const auth = await sessionContext(request, env);
  if (auth.error) return auth;
  const rule = bucketRule(bucketId);
  if (!rule) return { error: 'SPECIAL_AREA_NOT_FOUND', status: 404 };
  if (!manualSpecialBuckets(auth.user).has(bucketId)) return { error: 'SPECIAL_ACCESS_REQUIRED', status: 403 };
  if (!bucketAllowedInView(bucketId, viewId)) return { error: 'SPECIAL_AREA_NOT_AVAILABLE_IN_VIEW', status: 403 };
  const viewContext = await visibleOpenViewContext(request, env, viewId);
  if (viewContext.error) return viewContext;
  const catalogue = await env.LESSONS_KV.get(`special:${bucketId}`, { type: 'json' });
  if (!catalogue || catalogue.active === false) return { error: 'SPECIAL_AREA_NOT_FOUND', status: 404 };
  return { ...auth, rule, view: viewContext.view, catalogue };
}

function safeSpecialListItem(bucketId, catalogue) {
  return {
    bucketId,
    type: String(catalogue?.type || bucketRule(bucketId)?.type || 'special'),
    title: String(catalogue?.title || bucketId),
    description: String(catalogue?.description || ''),
    passwordProtected: bucketId === 'MOCKS'
  };
}

function safeVideoItems(bucketId, catalogue) {
  const items = Array.isArray(catalogue?.items) ? catalogue.items : [];
  return items.map((item, index) => {
    const itemId = String(item?.id || `item-${index + 1}`).trim();
    const isSeparator = item?.type === 'separator' || !item?.video?.screenpal;
    return {
      itemId,
      title: String(item?.title || `Item ${index + 1}`),
      description: String(item?.description || ''),
      separator: isSeparator,
      resourceKey: isSeparator ? null : `special~${encodeURIComponent(String(bucketId || ''))}~${encodeURIComponent(itemId)}`
    };
  });
}

function safeMockDays(catalogue) {
  const days = Array.isArray(catalogue?.days) ? catalogue.days : [];
  return days.map(day => {
    const dayNumber = Number(day?.day);
    if (!Number.isInteger(dayNumber) || dayNumber < 1) return null;
    const videos = Array.isArray(day?.videos) ? day.videos : [];
    return {
      day: dayNumber,
      title: String(day?.title || `Mock ${dayNumber}`),
      description: String(day?.description || ''),
      locked: true,
      videos: videos.map((video, index) => ({
        id: String(video?.id || `video-${index + 1}`),
        subject: String(video?.subject || '').trim().toLowerCase(),
        title: String(video?.title || `Answer video ${index + 1}`),
        locked: true
      }))
    };
  }).filter(Boolean);
}

async function handleSpecialAreasList(request, env, url) {
  const cors = corsHeaders(request, env);
  if (!browserOriginAllowed(request, env)) return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  const auth = await sessionContext(request, env);
  if (auth.error) return json({ error: auth.error }, { status: auth.status, headers: cors });
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const viewContext = await visibleOpenViewContext(request, env, viewId);
  if (viewContext.error) return json({ error: viewContext.error }, { status: viewContext.status, headers: cors });
  const granted = manualSpecialBuckets(auth.user);
  const areas = [];
  for (const bucketId of Object.keys(SPECIAL_BUCKETS)) {
    if (!granted.has(bucketId) || !bucketAllowedInView(bucketId, viewId)) continue;
    const catalogue = await env.LESSONS_KV.get(`special:${bucketId}`, { type: 'json' });
    if (!catalogue || catalogue.active === false) continue;
    areas.push(safeSpecialListItem(bucketId, catalogue));
  }
  return json({ ok: true, viewId, areas, source: 'manualAccess.specialBuckets', excelEntitlementsUsed: false }, { status: 200, headers: cors });
}

async function handleSpecialAreaDetail(request, env, bucketId, url) {
  const cors = corsHeaders(request, env);
  if (!browserOriginAllowed(request, env)) return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await authorisedBucketContext(request, env, bucketId, viewId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });
  const common = {
    bucketId,
    type: String(context.catalogue.type || context.rule.type),
    title: String(context.catalogue.title || bucketId),
    description: String(context.catalogue.description || '')
  };
  if (bucketId === 'MOCKS') {
    return json({ ok: true, area: { ...common, passwordProtected: true, passwordScope: 'mock-day-browser-session', days: safeMockDays(context.catalogue) } }, { status: 200, headers: cors });
  }
  return json({ ok: true, area: { ...common, passwordProtected: false, items: safeVideoItems(bucketId, context.catalogue) } }, { status: 200, headers: cors });
}

function parseSpecialResourceKey(resourceKey) {
  const parts = String(resourceKey || '').split('~');
  if (parts.length !== 3 || parts[0] !== 'special') return null;
  try { return { bucketId: decodeURIComponent(parts[1]), itemId: decodeURIComponent(parts[2]) }; } catch { return null; }
}

async function handleSpecialVideo(request, env, resourceKey, url) {
  const cors = corsHeaders(request, env);
  if (!browserOriginAllowed(request, env)) return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  const parsed = parseSpecialResourceKey(resourceKey);
  if (!parsed || parsed.bucketId === 'MOCKS') return json({ error: 'SPECIAL_RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await authorisedBucketContext(request, env, parsed.bucketId, viewId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });
  const items = Array.isArray(context.catalogue.items) ? context.catalogue.items : [];
  const item = items.find(candidate => String(candidate?.id || '').trim() === parsed.itemId);
  const embedUrl = screenpalEmbedUrl(item?.video?.screenpal);
  if (!item || item?.type === 'separator' || !embedUrl) return json({ error: 'SPECIAL_RESOURCE_NOT_FOUND' }, { status: 404, headers: cors });
  return json({ ok: true, bucketId: parsed.bucketId, itemId: parsed.itemId, embedUrl }, { status: 200, headers: cors });
}

function mockPasswords(env) {
  const raw = String(env.MOCK_DAILY_PASSWORDS || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch { return {}; }
}

async function checkMockRateLimit(env, portalUserIdNorm, day) {
  const now = Date.now();
  const row = await env.DB.prepare(`SELECT window_started_at, attempt_count FROM mock_password_rate_limits WHERE portal_user_id_norm = ? AND mock_day = ?`).bind(portalUserIdNorm, day).first();
  if (!row) return { limited: false, attemptCount: 0 };
  const started = Date.parse(row.window_started_at || '');
  if (!Number.isFinite(started) || now - started >= MOCK_RATE_LIMIT_WINDOW_MS) {
    await env.DB.prepare(`DELETE FROM mock_password_rate_limits WHERE portal_user_id_norm = ? AND mock_day = ?`).bind(portalUserIdNorm, day).run();
    return { limited: false, attemptCount: 0 };
  }
  return { limited: Number(row.attempt_count || 0) >= MOCK_RATE_LIMIT_MAX_ATTEMPTS, attemptCount: Number(row.attempt_count || 0) };
}

async function recordMockFailure(env, portalUserIdNorm, day) {
  const nowIso = new Date().toISOString();
  const existing = await env.DB.prepare(`SELECT window_started_at, attempt_count FROM mock_password_rate_limits WHERE portal_user_id_norm = ? AND mock_day = ?`).bind(portalUserIdNorm, day).first();
  const started = Date.parse(existing?.window_started_at || '');
  const expired = !Number.isFinite(started) || Date.now() - started >= MOCK_RATE_LIMIT_WINDOW_MS;
  if (!existing || expired) {
    await env.DB.prepare(`INSERT OR REPLACE INTO mock_password_rate_limits (portal_user_id_norm, mock_day, window_started_at, attempt_count) VALUES (?, ?, ?, 1)`).bind(portalUserIdNorm, day, nowIso).run();
    return;
  }
  await env.DB.prepare(`UPDATE mock_password_rate_limits SET attempt_count = attempt_count + 1 WHERE portal_user_id_norm = ? AND mock_day = ?`).bind(portalUserIdNorm, day).run();
}

async function clearMockFailures(env, portalUserIdNorm, day) {
  await env.DB.prepare(`DELETE FROM mock_password_rate_limits WHERE portal_user_id_norm = ? AND mock_day = ?`).bind(portalUserIdNorm, day).run();
}

async function handleMockUnlock(request, env, dayValue, url) {
  const cors = corsHeaders(request, env);
  if (!browserOriginAllowed(request, env)) return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day < 1) return json({ error: 'MOCK_DAY_INVALID' }, { status: 400, headers: cors });
  const viewId = String(url.searchParams.get('viewId') || '').trim();
  const context = await authorisedBucketContext(request, env, 'MOCKS', viewId);
  if (context.error) return json({ error: context.error }, { status: context.status, headers: cors });
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'INVALID_REQUEST' }, { status: 400, headers: cors }); }
  const password = String(body?.password || '');
  if (!password) return json({ error: 'MOCK_PASSWORD_REQUIRED' }, { status: 400, headers: cors });
  const days = Array.isArray(context.catalogue.days) ? context.catalogue.days : [];
  const mockDay = days.find(candidate => Number(candidate?.day) === day);
  if (!mockDay) return json({ error: 'MOCK_DAY_NOT_FOUND' }, { status: 404, headers: cors });
  const passwords = mockPasswords(env);
  const configured = String(passwords[String(day)] || '');
  if (!configured) return json({ error: 'MOCK_PASSWORD_NOT_CONFIGURED' }, { status: 503, headers: cors });
  const rate = await checkMockRateLimit(env, context.portalUserIdNorm, day);
  if (rate.limited) return json({ error: 'MOCK_PASSWORD_RATE_LIMITED' }, { status: 429, headers: cors });
  const matches = await timingSafeStringEqual(password, configured);
  if (!matches) {
    await recordMockFailure(env, context.portalUserIdNorm, day);
    return json({ error: 'MOCK_PASSWORD_INCORRECT' }, { status: 403, headers: cors });
  }
  await clearMockFailures(env, context.portalUserIdNorm, day);
  const videos = (Array.isArray(mockDay.videos) ? mockDay.videos : []).map((video, index) => {
    const embedUrl = screenpalEmbedUrl(video?.screenpal);
    if (!embedUrl) return null;
    return {
      id: String(video?.id || `video-${index + 1}`),
      subject: String(video?.subject || '').trim().toLowerCase(),
      title: String(video?.title || `Answer video ${index + 1}`),
      embedUrl
    };
  }).filter(Boolean);
  return json({ ok: true, bucketId: 'MOCKS', day, unlockScope: 'browser-session', videos }, { status: 200, headers: cors });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/v1/student/special')) {
      if (!Object.keys(cors).length) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname.startsWith('/api/v1/student/special') && !browserOriginAllowed(request, env)) return json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403, headers: cors });
    if (request.method === 'GET' && url.pathname === '/api/v1/student/special-areas') return handleSpecialAreasList(request, env, url);
    const mockUnlock = url.pathname.match(/^\/api\/v1\/student\/special-areas\/MOCKS\/mock-days\/(\d+)\/unlock$/);
    if (request.method === 'POST' && mockUnlock) return handleMockUnlock(request, env, mockUnlock[1], url);
    const specialDetail = url.pathname.match(/^\/api\/v1\/student\/special-areas\/([^/]+)$/);
    if (request.method === 'GET' && specialDetail) return handleSpecialAreaDetail(request, env, decodeURIComponent(specialDetail[1]), url);
    const specialVideo = url.pathname.match(/^\/api\/v1\/student\/special-resources\/([^/]+)\/video$/);
    if (request.method === 'GET' && specialVideo) return handleSpecialVideo(request, env, decodeURIComponent(specialVideo[1]), url);
    return phase9Worker.fetch(request, env);
  }
};
