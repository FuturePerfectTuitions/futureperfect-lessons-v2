import { publishStudentPreparedAccess } from './admin-prepared-access-publisher.js';

const PATHS = Object.freeze({
  create: '/api/v1/admin/trials/create',
  list: '/api/v1/admin/trials/list',
  rearm: '/api/v1/admin/trials/rearm',
  disable: '/api/v1/admin/trials/disable',
  resetPasswords: '/api/v1/admin/trials/reset-passwords'
});

const SESSION_SCOPE = 'lesson-release-import';
const FORBIDDEN_PASSWORDS = new Set(['csl1']);
const MAX_TRIALS = 1000;

const VIEW_META = Object.freeze({
  'maths-year2': { label:'Year 2 Maths', year:2 },
  'maths-year3': { label:'Year 3 Maths', year:3 },
  'maths-year4': { label:'Year 4 Maths', year:4 },
  'maths-year5': { label:'Year 5 Maths', year:5 },
  'maths-year6': { label:'Year 6 Maths', year:6 },
  'maths-level1': { label:'L1 Maths', year:4 },
  'maths-level2': { label:'L2 Maths', year:5 },
  'maths-level3': { label:'L3 Maths', year:6 },
  'english-year2': { label:'Year 2 English', year:2 },
  'english-year3': { label:'Year 3 English', year:3 },
  'english-year4': { label:'Year 4 English', year:4 },
  'english-year5': { label:'Year 5 English', year:5 },
  'english-year6': { label:'Year 6 English', year:6 },
  'english-year4-11plus': { label:'Year 4 11+ English + all Year 4 VR', year:4, vr:true },
  'english-year5-11plus': { label:'Year 5 11+ English + all Year 5 VR', year:5, vr:true }
});

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function allowedOrigin(origin, env) {
  const configured = clean(env?.ALLOWED_ORIGINS)
    .split(',').map(value => value.trim()).filter(Boolean);
  return !origin || configured.includes(origin) || origin === 'https://futureperfecttuitions.github.io';
}

function json(body, status = 200, request = null, env = null) {
  const headers = new Headers({
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store'
  });
  const origin = request?.headers?.get('Origin') || '';
  if (origin && allowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'content-type, authorization');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function base64UrlToText(value) {
  const base64 = value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(base64);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign']
  );
  return bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  ));
}

async function timingSafeTextEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function adminSessionAuthorised(request, env) {
  const match = clean(request.headers.get('Authorization')).match(/^Bearer\s+(.+)$/i);
  if (!match || !env?.ADMIN_IMPORT_SESSION_SECRET) return false;
  const parts = match[1].split('.');
  if (parts.length !== 2) return false;
  const expected = await hmac(String(env.ADMIN_IMPORT_SESSION_SECRET), parts[0]);
  if (!(await timingSafeTextEqual(parts[1], expected))) return false;
  try {
    const payload = JSON.parse(base64UrlToText(parts[0]));
    return payload.scope === SESSION_SCOPE && Number(payload.exp) >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function configured(env) {
  return Boolean(
    env?.STUDENTS_KV && env?.DB && env?.REBUILD_SHADOW_KV && env?.ADMIN_IMPORT_SESSION_SECRET
  );
}

function isTrialId(value) {
  const id = norm(value);
  return id.startsWith('trial') && !id.startsWith('admintrial');
}

function validPortalUserId(value) {
  const id = clean(value);
  return /^Trial[A-Za-z0-9_-]{1,35}$/i.test(id) && isTrialId(id);
}

function proposedPortalUserId(firstName) {
  const name = clean(firstName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '');
  return name ? `Trial${name}`.slice(0, 40) : '';
}

function normaliseTrialViews(values) {
  const input = Array.isArray(values) ? values : [];
  const unique = [];
  const seen = new Set();
  for (const raw of input) {
    const viewId = norm(raw);
    if (!VIEW_META[viewId] || seen.has(viewId)) continue;
    seen.add(viewId);
    unique.push(viewId);
  }
  return unique;
}

function deriveSchoolYear(trialViews) {
  const years = normaliseTrialViews(trialViews).map(viewId => VIEW_META[viewId].year).filter(Boolean);
  return years.length ? Math.min(...years) : 4;
}

function randomChoice(chars) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return chars[values[0] % chars.length];
}

function randomPassword(exclude = new Set()) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = `${upper}${lower}${digits}`;
  const excluded = new Set([...exclude].map(value => norm(value)));
  for (;;) {
    const chars = [randomChoice(upper), randomChoice(lower), randomChoice(digits), randomChoice(all)];
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      const j = values[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const candidate = chars.join('');
    const candidateNorm = norm(candidate);
    if (!FORBIDDEN_PASSWORDS.has(candidateNorm) && !excluded.has(candidateNorm)) return candidate;
  }
}

function buildTrialRecord({ portalUserId, firstName, loginPassword, answerPassword, trialViews, existing = null }) {
  const now = new Date().toISOString();
  const views = normaliseTrialViews(trialViews);
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    schemaVersion:1,
    portalUserId,
    firstName,
    name:firstName,
    p:loginPassword,
    loginPassword,
    answerPassword,
    status:'active',
    accountStatus:'active',
    expires:'',
    expiresOn:null,
    schoolYear:deriveSchoolYear(views),
    vrEligible:views.some(viewId => VIEW_META[viewId]?.vr === true),
    mathsYears:[],
    vrBuckets:[],
    entitlements:{},
    batches:[],
    fullLibraries:[],
    manualAccess:{ coreLessons:[], vrLessons:[], specialBuckets:[] },
    manualLessonAccess:{},
    specialAccess:[],
    upsellViews:[],
    trialViews:views,
    trialCreatedAt:existing?.trialCreatedAt || now,
    trialUpdatedAt:now,
    trialLastAction:existing ? 'updated' : 'created',
    trialLastActionAt:now
  };
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function clearTrialConsumption(env, portalUserIdNorm) {
  await env.DB.prepare(
    `DELETE FROM trial_login_consumptions WHERE portal_user_id_norm = ?`
  ).bind(norm(portalUserIdNorm)).run();
}

async function consumptionFor(env, portalUserIdNorm) {
  return env.DB.prepare(
    `SELECT consumed_at FROM trial_login_consumptions WHERE portal_user_id_norm = ? LIMIT 1`
  ).bind(norm(portalUserIdNorm)).first();
}

async function requireTrial(env, portalUserId) {
  const id = clean(portalUserId);
  const idNorm = norm(id);
  if (!validPortalUserId(id)) return { error:'INVALID_TRIAL_ID' };
  const key = `user:${idNorm}`;
  const user = await env.STUDENTS_KV.get(key, { type:'json' });
  if (!user || !isTrialId(user.portalUserId || id) || !normaliseTrialViews(user.trialViews).length) {
    return { error:'TRIAL_NOT_FOUND' };
  }
  return { id:clean(user.portalUserId || id), idNorm, key, user };
}

function publicTrial(user, consumedAt = '', includePasswords = false) {
  const views = normaliseTrialViews(user?.trialViews);
  const active = norm(user?.accountStatus || user?.status || 'active') !== 'withdrawn';
  return {
    portalUserId:clean(user?.portalUserId),
    firstName:clean(user?.firstName || user?.name),
    trialViews:views,
    access:views.map(viewId => VIEW_META[viewId]?.label || viewId),
    vrIncluded:views.filter(viewId => VIEW_META[viewId]?.vr).map(viewId => VIEW_META[viewId].label),
    active,
    consumedAt:clean(consumedAt),
    oneLoginUnused:!clean(consumedAt),
    createdAt:clean(user?.trialCreatedAt),
    updatedAt:clean(user?.trialUpdatedAt),
    ...(includePasswords ? {
      loginPassword:clean(user?.loginPassword || user?.p),
      answerPassword:clean(user?.answerPassword)
    } : {})
  };
}

async function publishOrRollback(env, idNorm, key, updated, previous = null) {
  await env.STUDENTS_KV.put(key, JSON.stringify(updated));
  try {
    return await publishStudentPreparedAccess(env, idNorm);
  } catch (error) {
    if (previous) {
      await env.STUDENTS_KV.put(key, JSON.stringify(previous));
      try { await publishStudentPreparedAccess(env, idNorm); } catch {}
    } else {
      await env.STUDENTS_KV.delete(key);
    }
    throw error;
  }
}

async function handleCreate(request, env) {
  const body = await readJson(request);
  const firstName = clean(body?.firstName);
  const trialViews = normaliseTrialViews(body?.trialViews);
  const suppliedViews = Array.isArray(body?.trialViews) ? body.trialViews.map(norm).filter(Boolean) : [];
  const portalUserId = clean(body?.portalUserId) || proposedPortalUserId(firstName);

  if (!firstName || firstName.length > 60) return json({ ok:false, error:'FIRST_NAME_REQUIRED' }, 400, request, env);
  if (!validPortalUserId(portalUserId)) return json({ ok:false, error:'INVALID_TRIAL_ID' }, 400, request, env);
  if (!trialViews.length) return json({ ok:false, error:'TRIAL_VIEW_REQUIRED' }, 400, request, env);
  if (trialViews.length !== new Set(suppliedViews).size) return json({ ok:false, error:'INVALID_TRIAL_VIEW' }, 400, request, env);

  const idNorm = norm(portalUserId);
  const key = `user:${idNorm}`;
  if (await env.STUDENTS_KV.get(key, { type:'json' })) {
    return json({ ok:false, error:'ACCOUNT_ALREADY_EXISTS', portalUserId }, 409, request, env);
  }

  const loginPassword = randomPassword();
  const answerPassword = randomPassword(new Set([loginPassword]));
  const record = buildTrialRecord({ portalUserId, firstName, loginPassword, answerPassword, trialViews });

  try {
    await clearTrialConsumption(env, idNorm);
    const published = await publishOrRollback(env, idNorm, key, record);
    const readback = await env.STUDENTS_KV.get(key, { type:'json' });
    if (!readback || readback.p !== loginPassword || !published?.ok) throw new Error('PROVISION_VERIFY_FAILED');
    return json({
      ok:true,
      ...publicTrial(readback),
      loginPassword,
      answerPassword,
      preparedAccessVersion:published.version
    }, 200, request, env);
  } catch (error) {
    try { await clearTrialConsumption(env, idNorm); } catch {}
    return json({ ok:false, error:clean(error?.message || 'PROVISION_FAILED') }, 500, request, env);
  }
}

async function listKvTrialUsers(env) {
  const keys = [];
  let cursor = undefined;
  do {
    const page = await env.STUDENTS_KV.list({ prefix:'user:trial', limit:MAX_TRIALS, ...(cursor ? { cursor } : {}) });
    keys.push(...(Array.isArray(page?.keys) ? page.keys.map(item => item.name).filter(Boolean) : []));
    cursor = page?.list_complete ? undefined : page?.cursor;
  } while (cursor && keys.length < MAX_TRIALS);
  const users = await Promise.all(keys.slice(0, MAX_TRIALS).map(key => env.STUDENTS_KV.get(key, { type:'json' })));
  return users.filter(user => user && isTrialId(user.portalUserId) && normaliseTrialViews(user.trialViews).length);
}

async function handleList(request, env) {
  const [users, consumptions] = await Promise.all([
    listKvTrialUsers(env),
    env.DB.prepare(`SELECT portal_user_id_norm, consumed_at FROM trial_login_consumptions WHERE portal_user_id_norm LIKE 'trial%'`).all()
  ]);
  const consumed = new Map(
    (Array.isArray(consumptions?.results) ? consumptions.results : [])
      .map(row => [norm(row?.portal_user_id_norm), clean(row?.consumed_at)])
  );
  const trials = users
    .map(user => publicTrial(user, consumed.get(norm(user.portalUserId)) || '', true))
    .sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.portalUserId.localeCompare(b.portalUserId));
  return json({ ok:true, trials }, 200, request, env);
}

async function handleRearm(request, env) {
  const body = await readJson(request);
  const found = await requireTrial(env, body?.portalUserId);
  if (found.error) return json({ ok:false, error:found.error }, found.error === 'TRIAL_NOT_FOUND' ? 404 : 400, request, env);

  const now = new Date().toISOString();
  const updated = {
    ...found.user,
    status:'active',
    accountStatus:'active',
    expires:'',
    expiresOn:null,
    trialUpdatedAt:now,
    trialLastAction:'rearmed',
    trialLastActionAt:now
  };
  try {
    const published = await publishOrRollback(env, found.idNorm, found.key, updated, found.user);
    await clearTrialConsumption(env, found.idNorm);
    return json({ ok:true, ...publicTrial(updated), oneLoginUnused:true, preparedAccessVersion:published.version }, 200, request, env);
  } catch (error) {
    return json({ ok:false, error:clean(error?.message || 'REARM_FAILED') }, 500, request, env);
  }
}

async function handleDisable(request, env) {
  const body = await readJson(request);
  const found = await requireTrial(env, body?.portalUserId);
  if (found.error) return json({ ok:false, error:found.error }, found.error === 'TRIAL_NOT_FOUND' ? 404 : 400, request, env);

  const now = new Date().toISOString();
  const updated = {
    ...found.user,
    status:'withdrawn',
    accountStatus:'withdrawn',
    trialUpdatedAt:now,
    trialLastAction:'disabled',
    trialLastActionAt:now
  };
  try {
    const published = await publishOrRollback(env, found.idNorm, found.key, updated, found.user);
    const consumed = await consumptionFor(env, found.idNorm);
    return json({ ok:true, ...publicTrial(updated, consumed?.consumed_at || ''), preparedAccessVersion:published.version }, 200, request, env);
  } catch (error) {
    return json({ ok:false, error:clean(error?.message || 'DISABLE_FAILED') }, 500, request, env);
  }
}

async function handleResetPasswords(request, env) {
  const body = await readJson(request);
  const found = await requireTrial(env, body?.portalUserId);
  if (found.error) return json({ ok:false, error:found.error }, found.error === 'TRIAL_NOT_FOUND' ? 404 : 400, request, env);

  const loginPassword = randomPassword();
  const answerPassword = randomPassword(new Set([loginPassword]));
  const now = new Date().toISOString();
  const updated = {
    ...found.user,
    p:loginPassword,
    loginPassword,
    answerPassword,
    trialUpdatedAt:now,
    trialLastAction:'passwords-reset',
    trialLastActionAt:now
  };
  await env.STUDENTS_KV.put(found.key, JSON.stringify(updated));
  const consumed = await consumptionFor(env, found.idNorm);
  return json({
    ok:true,
    ...publicTrial(updated, consumed?.consumed_at || ''),
    loginPassword,
    answerPassword
  }, 200, request, env);
}

export async function handleAdminTrialManager(request, env) {
  const url = new URL(request.url);
  if (!Object.values(PATHS).includes(url.pathname)) return null;

  const origin = request.headers.get('Origin') || '';
  if (origin && !allowedOrigin(origin, env)) return json({ ok:false, error:'ORIGIN_NOT_ALLOWED' }, 403, request, env);
  if (request.method === 'OPTIONS') return json({ ok:true }, 200, request, env);
  if (request.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405, request, env);
  if (!configured(env)) return json({ ok:false, error:'ADMIN_TRIALS_NOT_CONFIGURED' }, 503, request, env);
  if (!(await adminSessionAuthorised(request, env))) return json({ ok:false, error:'UNAUTHORISED' }, 401, request, env);

  if (url.pathname === PATHS.create) return handleCreate(request, env);
  if (url.pathname === PATHS.list) return handleList(request, env);
  if (url.pathname === PATHS.rearm) return handleRearm(request, env);
  if (url.pathname === PATHS.disable) return handleDisable(request, env);
  return handleResetPasswords(request, env);
}

export {
  PATHS,
  VIEW_META,
  FORBIDDEN_PASSWORDS,
  validPortalUserId,
  proposedPortalUserId,
  normaliseTrialViews,
  deriveSchoolYear,
  randomPassword,
  buildTrialRecord,
  isTrialId,
  publicTrial
};