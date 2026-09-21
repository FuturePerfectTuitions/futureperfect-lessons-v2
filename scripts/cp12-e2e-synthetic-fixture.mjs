import crypto from 'node:crypto';
import {
  compileAccessScope,
  globalToCatalogue
} from '../rebuild/adminops/src/lib/compiler.mjs';
import {
  stableStringify,
  sha256Hex,
  pointerKey,
  versionKey,
  publishScopeAtomic,
  resolveCurrentScope
} from '../rebuild/adminops/src/lib/atomic-publisher.mjs';
import { opaqueAccessScopeId } from '../rebuild/student/src/lib/access-scope.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sameSet = (left, right) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());

const env = process.env;
const account = clean(env.CLOUDFLARE_ACCOUNT_ID);
const token = clean(env.CLOUDFLARE_API_TOKEN);
const portalD1 = clean(env.PORTAL_D1_ID);
const quizD1 = clean(env.QUIZ_D1_ID);
const studentsKv = clean(env.STUDENTS_KV_ID);
const readModelsKv = clean(env.READ_MODELS_KV_ID);
const portalRoot = clean(env.PORTAL_ROOT).replace(/\/$/, '');
const quizRoot = clean(env.QUIZ_ROOT).replace(/\/$/, '');
const runId = clean(env.GITHUB_RUN_ID);
const expectedVersions = {
  student: clean(env.EXPECTED_STUDENT_VERSION),
  browser: clean(env.EXPECTED_BROWSER_VERSION),
  bridge: clean(env.EXPECTED_BRIDGE_VERSION),
  quiz: clean(env.EXPECTED_QUIZ_VERSION)
};
const workers = {
  student: clean(env.STUDENT_WORKER),
  browser: clean(env.BROWSER_WORKER),
  bridge: clean(env.BRIDGE_WORKER),
  quiz: clean(env.QUIZ_WORKER)
};
for (const [key, value] of Object.entries({ account, token, portalD1, quizD1, studentsKv, readModelsKv, portalRoot, quizRoot, runId, ...expectedVersions, ...workers })) {
  assert(value, `Missing required input ${key}`);
}

const cfBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}`;
const cfHeaders = { Authorization: `Bearer ${token}` };

async function cfJson(path, init = {}) {
  const response = await fetch(`${cfBase}${path}`, {
    ...init,
    headers: { ...cfHeaders, ...(init.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok || body?.success !== true) {
    throw new Error(`Cloudflare request failed ${response.status} ${path}`);
  }
  return body.result;
}

async function activeWorkerVersion(name) {
  const result = await cfJson(`/workers/scripts/${encodeURIComponent(name)}/deployments`);
  const deployments = Array.isArray(result?.deployments) ? result.deployments : (Array.isArray(result) ? result : []);
  const versions = Array.isArray(deployments[0]?.versions) ? deployments[0].versions : [];
  return clean((versions.find(row => Number(row?.percentage || 0) === 100) || versions[0])?.version_id);
}

async function workerSettings(name) {
  return cfJson(`/workers/scripts/${encodeURIComponent(name)}/settings`);
}

async function kvGet(namespaceId, key) {
  const response = await fetch(`${cfBase}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`, { headers: cfHeaders });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`KV read failed ${response.status} ${key}`);
  return response.text();
}

async function kvPut(namespaceId, key, value) {
  const result = await fetch(`${cfBase}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { ...cfHeaders, 'content-type': 'text/plain; charset=utf-8' },
    body: String(value)
  });
  const body = await result.json().catch(() => null);
  if (!result.ok || body?.success !== true) throw new Error(`KV write failed ${result.status} ${key}`);
}

async function kvDelete(namespaceId, key) {
  const result = await fetch(`${cfBase}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: cfHeaders
  });
  const body = await result.json().catch(() => null);
  if (!result.ok || body?.success !== true) throw new Error(`KV delete failed ${result.status} ${key}`);
}

const readModelStore = {
  get: key => kvGet(readModelsKv, key),
  put: (key, value) => kvPut(readModelsKv, key, value)
};

async function d1(databaseId, sql, params = []) {
  const result = await cfJson(`/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  const block = Array.isArray(result) ? result[0] : result;
  if (!block?.success) throw new Error('D1 query block failed');
  return block;
}

async function rows(databaseId, sql, params = []) {
  const block = await d1(databaseId, sql, params);
  return Array.isArray(block?.results) ? block.results : [];
}

async function scalar(databaseId, sql, params = [], key = 'n') {
  const result = await rows(databaseId, sql, params);
  return Number(result[0]?.[key] ?? 0);
}

function londonDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function password4() {
  const d = crypto.randomBytes(2);
  return `A${d[0] % 10}b${d[1] % 10}`;
}

function cookieFrom(response, expectedName) {
  const setCookie = response.headers.get('set-cookie') || '';
  const parts = setCookie.split(',').map(x => x.trim()).filter(Boolean);
  const hit = parts.find(x => x.startsWith(`${expectedName}=`)) || setCookie;
  const cookie = hit.split(';')[0].trim();
  assert(cookie.startsWith(`${expectedName}=`), `Expected cookie ${expectedName} was not issued`);
  return cookie;
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function activeBatchSql() {
  return `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
          FROM batch_definitions
          WHERE subject='maths' AND stream='11plus' AND maths_level=?
            AND (active_from IS NULL OR active_from<=?)
            AND (active_to IS NULL OR ?<active_to)
          ORDER BY batch_key LIMIT 1`;
}

function canonicalLessonFixture(globalReadModel, level, count = 2) {
  const viewId = `maths-level${level}`;
  const lessons = globalReadModel?.catalogues?.[viewId]?.lessons || [];
  const re = new RegExp(`^L${level}T\\d+M\\d+$`, 'i');
  const rows = [];
  const seenLessonIds = new Set();
  const seenReleaseCodes = new Set();
  for (const lesson of lessons) {
    const lessonId = clean(lesson?.lessonId);
    const releaseCode = [lesson?.displayLessonId, lesson?.lessonId].map(clean).find(value => re.test(value));
    if (!lessonId || !releaseCode) continue;
    const code = releaseCode.toUpperCase();
    if (seenLessonIds.has(lessonId) || seenReleaseCodes.has(code)) continue;
    seenLessonIds.add(lessonId);
    seenReleaseCodes.add(code);
    rows.push({ lessonId, releaseCode: code });
    if (rows.length >= count) break;
  }
  assert(rows.length === count, `Could not select ${count} canonical L${level} lesson fixtures from prepared global catalogue`);
  return {
    lessonIds: rows.map(row => row.lessonId),
    releaseCodes: rows.map(row => row.releaseCode)
  };
}

async function accessRowsFor(user) {
  const batchAssignments = await rows(portalD1, `SELECT
      a.assignment_id, a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
      b.subject, b.school_year, b.stream, b.maths_level,
      b.active_from AS batch_active_from, b.active_to AS batch_active_to
    FROM student_batch_assignments a
    JOIN batch_definitions b ON b.batch_key = a.batch_key
    WHERE a.portal_user_id_norm = ?
    ORDER BY a.effective_from, a.assignment_id`, [user]);
  const batchDefinitions = await rows(portalD1, `SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
    FROM batch_definitions ORDER BY batch_key`);
  const entitlements = await rows(portalD1, `SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source_batch_code, source_lesson_date
    FROM lesson_entitlements WHERE portal_user_id_norm = ? ORDER BY lesson_id`, [user]);
  const onlinePreLessonEntitlements = await rows(portalD1, `SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access
    FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? ORDER BY lesson_id, batch_key`, [user]);
  return { batchAssignments, batchDefinitions, entitlements, onlinePreLessonEntitlements };
}

const state = {
  today: londonDate(),
  baselineLaunchRows: null,
  baselineAssignmentSequence: null,
  global: null,
  scopeSecret: null,
  personas: []
};

async function verifyTopology() {
  const live = {};
  for (const key of Object.keys(workers)) live[key] = await activeWorkerVersion(workers[key]);
  for (const key of Object.keys(expectedVersions)) {
    assert(live[key] === expectedVersions[key], `Production version drift for ${key}: ${live[key]}`);
  }
  const [student, browser, bridge, quiz] = await Promise.all([
    workerSettings(workers.student), workerSettings(workers.browser), workerSettings(workers.bridge), workerSettings(workers.quiz)
  ]);
  const binding = (settings, name) => (settings?.bindings || []).find(row => clean(row?.name) === name);
  assert(clean(binding(student, 'DB')?.id || binding(student, 'DB')?.database_id) === portalD1, 'Student Portal D1 binding drift');
  assert(clean(binding(student, 'STUDENTS_KV')?.namespace_id) === studentsKv, 'Students KV binding drift');
  assert(clean(binding(student, 'READ_MODELS_KV')?.namespace_id) === readModelsKv, 'Prepared read-model KV binding drift');
  assert(clean(binding(browser, 'STAGING_API')?.service) === workers.student, 'Browser service binding drift');
  assert(clean(binding(bridge, 'DB')?.id || binding(bridge, 'DB')?.database_id) === portalD1, 'Bridge Portal D1 binding drift');
  assert((bridge?.bindings || []).some(row => clean(row?.name) === 'QUIZ_BRIDGE_SECRET' && /secret/i.test(clean(row?.type))), 'Bridge secret binding missing');
  assert(clean(binding(quiz, 'DB')?.id || binding(quiz, 'DB')?.database_id) === quizD1, 'Quiz D1 binding drift');
  assert((quiz?.bindings || []).some(row => clean(row?.name) === 'QUIZ_BRIDGE_SECRET' && /secret/i.test(clean(row?.type))), 'Quiz bridge secret binding missing');
  console.log(`CP12_E2E_TOPOLOGY_PIN_PASS student=${live.student} browser=${live.browser} bridge=${live.bridge} quiz=${live.quiz}`);
}

async function preflight() {
  await verifyTopology();
  state.scopeSecret = clean(await kvGet(readModelsKv, 'meta:scope-salt'));
  assert(state.scopeSecret.length >= 64, 'Stable access scope salt is unavailable or too short');
  const global = await resolveCurrentScope(readModelStore, 'global');
  assert(global?.payload?.kind === 'prepared-global-read-model', 'Prepared global read model is invalid');
  assert(global.usedFallback === false, 'Prepared global read model unexpectedly requires fallback');
  state.global = global;

  const l2Batch = (await rows(portalD1, activeBatchSql(), [2, state.today, state.today]))[0];
  const l3Batch = (await rows(portalD1, activeBatchSql(), [3, state.today, state.today]))[0];
  assert(l2Batch?.batch_key, 'No active production Maths 11+ L2 batch is available for synthetic fixture');
  assert(l3Batch?.batch_key, 'No active production Maths 11+ L3 batch is available for synthetic fixture');

  const gaps = await rows(portalD1, `WITH candidates(n) AS (
      SELECT 1
      UNION
      SELECT assignment_id + 1 FROM student_batch_assignments
    ), limits AS (
      SELECT COALESCE(MAX(assignment_id), 1) AS max_id FROM student_batch_assignments
    )
    SELECT n AS assignment_id
    FROM candidates, limits
    WHERE n > 0 AND n < limits.max_id
      AND NOT EXISTS (SELECT 1 FROM student_batch_assignments a WHERE a.assignment_id = n)
    ORDER BY n LIMIT 2`);
  assert(gaps.length === 2, 'Two pre-existing positive assignment-id gaps are required so the synthetic fixture cannot advance AUTOINCREMENT state');
  state.baselineAssignmentSequence = await scalar(portalD1, `SELECT COALESCE(seq,0) AS n FROM sqlite_sequence WHERE name='student_batch_assignments'`);
  state.baselineLaunchRows = await scalar(portalD1, 'SELECT COUNT(*) AS n FROM quiz_launch_codes');

  const nonce = crypto.randomBytes(4).toString('hex');
  const l2Fixture = canonicalLessonFixture(global.payload, 2, 2);
  const l3Fixture = canonicalLessonFixture(global.payload, 3, 2);
  state.personas = [
    { level: 2, label: 'L2', user: `cp12e2el2${runId}${nonce}`.toLowerCase(), password: password4(), batch: l2Batch, assignmentId: Number(gaps[0].assignment_id), lessonCodes: l2Fixture.lessonIds, expectedReleaseCodes: l2Fixture.releaseCodes },
    { level: 3, label: 'L3', user: `cp12e2el3${runId}${nonce}`.toLowerCase(), password: password4(), batch: l3Batch, assignmentId: Number(gaps[1].assignment_id), lessonCodes: l3Fixture.lessonIds, expectedReleaseCodes: l3Fixture.releaseCodes }
  ];

  for (const persona of state.personas) {
    assert(Number.isSafeInteger(persona.assignmentId) && persona.assignmentId > 0, `${persona.label} synthetic assignment id invalid`);
    assert(await kvGet(studentsKv, `user:${persona.user}`) === null, `${persona.label} synthetic Students KV key unexpectedly exists`);
    persona.scopeId = await opaqueAccessScopeId(persona.user, state.scopeSecret);
    persona.scope = `access:${persona.scopeId}`;
    assert(await kvGet(readModelsKv, pointerKey(persona.scope)) === null, `${persona.label} synthetic access pointer unexpectedly exists`);
    const portalRows = await scalar(portalD1, `SELECT
      (SELECT COUNT(*) FROM student_batch_assignments WHERE portal_user_id_norm=?) +
      (SELECT COUNT(*) FROM lesson_entitlements WHERE portal_user_id_norm=?) +
      (SELECT COUNT(*) FROM online_prelesson_entitlements WHERE portal_user_id_norm=?) +
      (SELECT COUNT(*) FROM quiz_launch_codes WHERE portal_user_id_norm=?) AS n`, [persona.user, persona.user, persona.user, persona.user]);
    assert(portalRows === 0, `${persona.label} synthetic Portal rows unexpectedly exist`);
    const quizRows = await scalar(quizD1, `SELECT
      (SELECT COUNT(*) FROM quiz_auth_session WHERE portal_user_id=?) +
      (SELECT COUNT(*) FROM quiz_session WHERE portal_user_id=?) +
      (SELECT COUNT(*) FROM exposure_history WHERE portal_user_id=?) +
      (SELECT COUNT(*) FROM attempt WHERE portal_user_id=?) AS n`, [persona.user, persona.user, persona.user, persona.user]);
    assert(quizRows === 0, `${persona.label} synthetic Quiz rows unexpectedly exist`);
  }
  console.log(`CP12_E2E_PREFLIGHT_PASS date=${state.today} launchBaseline=${state.baselineLaunchRows} globalVersion=${global.version}`);
}

async function createPersona(persona) {
  const now = new Date().toISOString();
  persona.studentRecord = {
    firstName: `CP12 ${persona.label}`,
    p: persona.password,
    status: 'active',
    accountStatus: 'active',
    expires: null,
    expiresOn: null,
    trial: false,
    batches: [],
    fullLibraries: [],
    blockedLessons: [],
    historicalViews: [],
    upsellViews: [],
    manualAccess: { coreLessons: [], vrLessons: [], specialBuckets: [] }
  };
  await kvPut(studentsKv, `user:${persona.user}`, JSON.stringify(persona.studentRecord));
  persona.studentCreated = true;

  await d1(portalD1, `INSERT INTO student_batch_assignments(
      assignment_id,portal_user_id_norm,batch_key,effective_from,effective_to,created_at,updated_at
    ) VALUES(?,?,?,?,NULL,?,?)`, [persona.assignmentId, persona.user, persona.batch.batch_key, state.today, now, now]);
  persona.assignmentCreated = true;

  for (const lessonId of persona.lessonCodes) {
    await d1(portalD1, `INSERT INTO lesson_entitlements(
        portal_user_id_norm,lesson_id,core_access,vr_access,source,first_granted_at,last_confirmed_at,source_batch_code,source_lesson_date
      ) VALUES(?,?,1,0,'excel',?,?,?,?)`, [persona.user, lessonId, now, now, persona.batch.batch_key, state.today]);
  }
  persona.entitlementsCreated = true;

  const inputRows = await accessRowsFor(persona.user);
  assert(inputRows.batchAssignments.length === 1, `${persona.label} synthetic assignment load mismatch`);
  assert(inputRows.entitlements.length === persona.lessonCodes.length, `${persona.label} synthetic entitlement load mismatch`);
  const accessInput = {
    asOfDate: state.today,
    user: persona.studentRecord,
    ...inputRows
  };
  const compiled = compileAccessScope(accessInput, globalToCatalogue(state.global.payload), {
    scopeId: persona.scopeId,
    asOfDate: state.today
  });
  const viewId = `maths-level${persona.level}`;
  const view = (compiled?.snapshot?.views || []).find(row => clean(row?.viewId) === viewId);
  assert(view?.current === true && clean(view?.group) === 'current' && view?.lockedPreview !== true, `${persona.label} current prepared view is invalid`);
  for (const lessonId of persona.lessonCodes) {
    const access = compiled?.snapshot?.lessonAccess?.[lessonId];
    assert(access?.core === true && access?.blocked !== true, `${persona.label} lesson ${lessonId} did not compile as released core access`);
  }
  const payloadSha = await sha256Hex(stableStringify(compiled));
  persona.readModelVersion = `a-${payloadSha.slice(0, 24)}-cp12e2e-${runId}-${persona.label.toLowerCase()}`;
  persona.readModelKey = versionKey(persona.scope, persona.readModelVersion);
  persona.pointerKey = pointerKey(persona.scope);
  await publishScopeAtomic(readModelStore, {
    scope: persona.scope,
    payload: compiled,
    version: persona.readModelVersion,
    updatedAt: now
  });
  persona.readModelPublished = true;
  const resolved = await resolveCurrentScope(readModelStore, persona.scope);
  assert(resolved.version === persona.readModelVersion && resolved.sha256 === payloadSha && resolved.usedFallback === false, `${persona.label} prepared access model failed exact readback`);
  console.log(`CP12_${persona.label}_FIXTURE_PUBLISHED_PASS assignmentId=${persona.assignmentId} lessonCount=${persona.lessonCodes.length}`);
}

async function portalSession(persona) {
  let lastStatus = 0;
  let lastError = '';
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const login = await jsonFetch(`${portalRoot}/api/v2/auth/login`, {
      method: 'POST',
      headers: { Origin: portalRoot, 'content-type': 'application/json' },
      body: JSON.stringify({ username: persona.user, password: persona.password })
    });
    lastStatus = login.response.status;
    lastError = clean(login.body?.error);
    if (lastStatus === 200 && login.body?.ok === true && login.body?.accountLocked === false) {
      console.log(`CP12_${persona.label}_EDGE_PROPAGATION_READY_PASS attempts=${attempt}`);
      return cookieFrom(login.response, 'fpt_session');
    }
    const credentialPropagationPending = lastStatus === 401 && lastError === 'LOGIN_INVALID';
    const readModelPropagationPending = lastStatus === 503 && ['READ_MODEL_POINTER_UNAVAILABLE','READ_MODEL_NO_VERIFIED_VERSION','RUNTIME_UNAVAILABLE'].includes(lastError);
    if (!credentialPropagationPending && !readModelPropagationPending) {
      throw new Error(`${persona.label} signed Portal login hard-failed status=${lastStatus} error=${lastError || 'none'}`);
    }
    if (attempt < 20) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`${persona.label} signed Portal login propagation timeout status=${lastStatus} error=${lastError || 'none'}`);
}

async function verifyReleaseContext(persona, context) {
  assert(context?.policyVersion === 'quiz-release-context-v2.0', `${persona.label} release policy version mismatch`);
  assert(context?.source === 'portal-live-maths11plus-release-v2', `${persona.label} release source mismatch`);
  assert(context?.currentLevel === persona.label, `${persona.label} currentLevel mismatch`);
  assert(Number(context?.portalAssignmentId) === persona.assignmentId, `${persona.label} portalAssignmentId mismatch`);
  assert(Number.isFinite(Date.parse(clean(context?.generatedAt))), `${persona.label} generatedAt invalid`);
  if (persona.level === 2) {
    const actual = context?.releasedL2LessonCodes || []; if (!sameSet(actual, persona.expectedReleaseCodes)) console.log(`CP12_L2_RELEASE_CONTEXT_MISMATCH expected=${JSON.stringify(persona.expectedReleaseCodes)} actual=${JSON.stringify(actual)}`); assert(sameSet(actual, persona.expectedReleaseCodes), 'L2 release list is not exactly the explicit L2 entitlement release codes');
    assert(Array.isArray(context?.releasedL3LessonCodes) && context.releasedL3LessonCodes.length === 0, 'L2 release context unexpectedly contains L3 lessons');
    assert(Array.isArray(context?.inheritedLevels) && context.inheritedLevels.length === 0, 'L2 release context unexpectedly inherits another level');
  } else {
    assert(Array.isArray(context?.releasedL2LessonCodes) && context.releasedL2LessonCodes.length === 0, 'L3 release context should represent L2 through inheritance, not copied release rows');
    const actual = context?.releasedL3LessonCodes || []; if (!sameSet(actual, persona.expectedReleaseCodes)) console.log(`CP12_L3_RELEASE_CONTEXT_MISMATCH expected=${JSON.stringify(persona.expectedReleaseCodes)} actual=${JSON.stringify(actual)}`); assert(sameSet(actual, persona.expectedReleaseCodes), 'L3 release list is not exactly the explicit L3 entitlement release codes');
    assert(sameSet(context?.inheritedLevels || [], ['L2']), 'L3 release context does not inherit full L2');
  }
}

async function exercisePersona(persona) {
  const portalCookie = await portalSession(persona);
  const eligibility = await jsonFetch(`${portalRoot}/api/v2/student/quiz/eligibility`, {
    headers: { Origin: portalRoot, Cookie: portalCookie }
  });
  assert(eligibility.response.status === 200 && eligibility.body?.ok === true && eligibility.body?.eligible === true, `${persona.label} eligibility failed`);
  assert(eligibility.body?.currentLevel === persona.label, `${persona.label} eligibility level mismatch`);

  const launch = await jsonFetch(`${portalRoot}/api/v2/student/quiz/launch`, {
    method: 'POST',
    headers: { Origin: portalRoot, Cookie: portalCookie, 'content-type': 'application/json' },
    body: '{}'
  });
  assert(launch.response.status === 200 && launch.body?.ok === true, `${persona.label} Portal launch failed`);
  const launchUrl = clean(launch.body?.launchUrl);
  assert(launchUrl.startsWith(`${quizRoot}/launch?code=`), `${persona.label} launch URL target mismatch`);
  persona.launchCreated = true;

  const launchRows = await rows(portalD1, `SELECT release_context_json,expires_at,used_at FROM quiz_launch_codes
    WHERE portal_user_id_norm=? ORDER BY created_at DESC LIMIT 1`, [persona.user]);
  assert(launchRows.length === 1, `${persona.label} Portal launch row missing`);
  let context = null;
  try { context = JSON.parse(launchRows[0].release_context_json || '{}'); } catch {}
  await verifyReleaseContext(persona, context);
  assert(!launchRows[0].used_at, `${persona.label} launch code was used before Quiz redemption`);

  const first = await fetch(launchUrl, { redirect: 'manual' });
  assert(first.status === 303, `${persona.label} Quiz launch did not redeem to a session`);
  const location = clean(first.headers.get('location'));
  assert(location === '/app' || location === `${quizRoot}/app`, `${persona.label} Quiz launch redirect mismatch`);
  const quizCookie = cookieFrom(first, '__Host-fpt_quiz_session');
  persona.quizSessionCreated = true;

  const me = await jsonFetch(`${quizRoot}/api/me`, { headers: { Cookie: quizCookie } });
  assert(me.response.status === 200 && me.body?.ok === true, `${persona.label} Quiz /api/me authentication failed`);
  assert(norm(me.body?.student?.portalUserId) === persona.user, `${persona.label} Quiz identity did not preserve normalized Portal identity`);
  assert(me.body?.releaseContextSource === 'portal-live-maths11plus-release-v2', `${persona.label} Quiz trusted release-context source mismatch`);

  const second = await fetch(launchUrl, { redirect: 'manual' });
  assert(second.status === 410, `${persona.label} one-time launch code was redeemable twice`);

  const usedRows = await rows(portalD1, `SELECT release_context_json,used_at FROM quiz_launch_codes
    WHERE portal_user_id_norm=? ORDER BY created_at DESC LIMIT 1`, [persona.user]);
  assert(usedRows.length === 1 && clean(usedRows[0].used_at), `${persona.label} launch row did not record one-time redemption`);

  const quizState = (await rows(quizD1, `SELECT
      (SELECT COUNT(*) FROM quiz_auth_session WHERE portal_user_id=?) AS auth_sessions,
      (SELECT COUNT(*) FROM quiz_session WHERE portal_user_id=?) AS quiz_sessions,
      (SELECT COUNT(*) FROM exposure_history WHERE portal_user_id=?) AS exposures,
      (SELECT COUNT(*) FROM attempt WHERE portal_user_id=?) AS attempts,
      (SELECT COUNT(*) FROM quiz_audit_event WHERE portal_user_id=?) AS audit_events`, [persona.user, persona.user, persona.user, persona.user, persona.user]))[0] || {};
  assert(Number(quizState.auth_sessions || 0) >= 1, `${persona.label} Quiz auth session row missing`);
  assert(Number(quizState.quiz_sessions || 0) === 0, `${persona.label} unexpectedly created a practice test`);
  assert(Number(quizState.exposures || 0) === 0, `${persona.label} unexpectedly created question exposure history`);
  assert(Number(quizState.attempts || 0) === 0, `${persona.label} unexpectedly created attempt history`);
  console.log(`CP12_${persona.label}_SIGNED_LAUNCH_REDEEM_PASS assignmentId=${persona.assignmentId} released=${persona.lessonCodes.length} identityPreserved=true oneTime=true`);
}

async function assertNoQuizLearningHistory(persona) {
  const result = (await rows(quizD1, `SELECT
      (SELECT COUNT(*) FROM quiz_session WHERE portal_user_id=?) AS sessions,
      (SELECT COUNT(*) FROM exposure_history WHERE portal_user_id=?) AS exposures,
      (SELECT COUNT(*) FROM attempt WHERE portal_user_id=?) AS attempts`, [persona.user, persona.user, persona.user]))[0] || {};
  assert(Number(result.sessions || 0) === 0 && Number(result.exposures || 0) === 0 && Number(result.attempts || 0) === 0,
    `${persona.label} synthetic identity has unexpected learning-history rows; automatic destructive cleanup is blocked`);
}

async function cleanupPersona(persona) {
  const errors = [];
  const safe = async fn => { try { await fn(); } catch (error) { errors.push(clean(error?.message || error)); } };
  await safe(() => assertNoQuizLearningHistory(persona));
  await safe(() => d1(quizD1, 'DELETE FROM quiz_audit_event WHERE portal_user_id=?', [persona.user]));
  await safe(() => d1(quizD1, 'DELETE FROM quiz_auth_session WHERE portal_user_id=?', [persona.user]));
  await safe(() => d1(portalD1, 'DELETE FROM quiz_launch_codes WHERE portal_user_id_norm=?', [persona.user]));
  await safe(() => d1(portalD1, 'DELETE FROM online_prelesson_entitlements WHERE portal_user_id_norm=?', [persona.user]));
  await safe(() => d1(portalD1, 'DELETE FROM lesson_entitlements WHERE portal_user_id_norm=?', [persona.user]));
  await safe(() => d1(portalD1, 'DELETE FROM student_batch_assignments WHERE portal_user_id_norm=?', [persona.user]));
  await safe(() => kvDelete(studentsKv, `user:${persona.user}`));
  if (persona.pointerKey) await safe(() => kvDelete(readModelsKv, persona.pointerKey));
  if (persona.readModelKey) await safe(() => kvDelete(readModelsKv, persona.readModelKey));
  if (errors.length) throw new Error(`${persona.label} cleanup errors: ${errors.join(' | ')}`);
}

async function verifyCleanup() {
  const sequence = await scalar(portalD1, `SELECT COALESCE(seq,0) AS n FROM sqlite_sequence WHERE name='student_batch_assignments'`);
  assert(sequence === state.baselineAssignmentSequence, `student_batch_assignments AUTOINCREMENT sequence changed ${state.baselineAssignmentSequence} -> ${sequence}`);
  for (const persona of state.personas) {
    assert(await kvGet(studentsKv, `user:${persona.user}`) === null, `${persona.label} Students KV cleanup failed`);
    assert(await kvGet(readModelsKv, pointerKey(persona.scope)) === null, `${persona.label} access pointer cleanup failed`);
    if (persona.readModelVersion) assert(await kvGet(readModelsKv, versionKey(persona.scope, persona.readModelVersion)) === null, `${persona.label} access version cleanup failed`);
    const portalCount = await scalar(portalD1, `SELECT
      (SELECT COUNT(*) FROM student_batch_assignments WHERE portal_user_id_norm=?) +
      (SELECT COUNT(*) FROM lesson_entitlements WHERE portal_user_id_norm=?) +
      (SELECT COUNT(*) FROM online_prelesson_entitlements WHERE portal_user_id_norm=?) +
      (SELECT COUNT(*) FROM quiz_launch_codes WHERE portal_user_id_norm=?) AS n`, [persona.user, persona.user, persona.user, persona.user]);
    assert(portalCount === 0, `${persona.label} Portal cleanup left rows behind`);
    const quizCount = await scalar(quizD1, `SELECT
      (SELECT COUNT(*) FROM quiz_auth_session WHERE portal_user_id=?) +
      (SELECT COUNT(*) FROM quiz_audit_event WHERE portal_user_id=?) +
      (SELECT COUNT(*) FROM quiz_session WHERE portal_user_id=?) +
      (SELECT COUNT(*) FROM exposure_history WHERE portal_user_id=?) +
      (SELECT COUNT(*) FROM attempt WHERE portal_user_id=?) AS n`, [persona.user, persona.user, persona.user, persona.user, persona.user]);
    assert(quizCount === 0, `${persona.label} Quiz cleanup left rows behind`);
  }
  const launchRows = await scalar(portalD1, 'SELECT COUNT(*) AS n FROM quiz_launch_codes');
  assert(launchRows === state.baselineLaunchRows, `Portal launch-row baseline changed ${state.baselineLaunchRows} -> ${launchRows}`);

  const root = await fetch(`${portalRoot}/`);
  assert(root.ok, 'Portal root unavailable during withdrawal verification');
  const html = await root.text();
  const refs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]);
  let source = '';
  for (const ref of refs) {
    const response = await fetch(new URL(ref, `${portalRoot}/`));
    assert(response.ok, `Portal script unavailable during withdrawal verification: ${ref}`);
    source += await response.text();
  }
  const markers = ['11+ Practice', 'quiz.futureperfect.education', '/api/v2/student/quiz/eligibility', '/api/v2/student/quiz/launch'];
  const found = markers.filter(marker => source.includes(marker));
  assert(found.length === 0, `Public Quiz surface was exposed prematurely: ${found.join(', ')}`);
  console.log(`CP12_E2E_CLEANUP_PASS launchRows=${launchRows} assignmentSequence=${sequence} portalSurfaceWithdrawn=true`);
}

let primaryError = null;
try {
  await preflight();
  for (const persona of state.personas) await createPersona(persona);
  for (const persona of state.personas) await exercisePersona(persona);
  console.log('CP12_SYNTHETIC_L2_L3_E2E_ACCEPTANCE_PASS');
} catch (error) {
  primaryError = error;
  console.error(`CP12_E2E_PRIMARY_FAILURE ${clean(error?.message || error)}`);
} finally {
  if (state.personas.length) {
    for (const persona of [...state.personas].reverse()) {
      try { await cleanupPersona(persona); }
      catch (error) {
        console.error(`CP12_E2E_CLEANUP_FAILURE ${clean(error?.message || error)}`);
        if (!primaryError) primaryError = error;
      }
    }
    try { await verifyCleanup(); }
    catch (error) {
      console.error(`CP12_E2E_POSTCLEAN_VERIFY_FAILURE ${clean(error?.message || error)}`);
      if (!primaryError) primaryError = error;
    }
  }
  state.scopeSecret = null;
  for (const persona of state.personas) persona.password = null;
}

if (primaryError) throw primaryError;
console.log('CP12_SYNTHETIC_E2E_FINAL_PASS');
