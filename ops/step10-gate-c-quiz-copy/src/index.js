import { ENGINE_VERSION, MODE_COUNTS, selectQuestions } from './selector.js';
import { resultItem } from './remediation.js';

const QUIZ_COOKIE = '__Host-fpt_quiz_session';
const TIMED_MS = 25 * 60 * 1000;
const LOCK_MS = 15_000;
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();
const nowIso = () => new Date().toISOString();
const randomId = prefix => `${prefix}_${crypto.randomUUID()}`;

function safeJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let binary = '';
  for (const b of a) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function baseSecurityHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  };
}

function responseJson(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...baseSecurityHeaders(), ...extra } });
}

function responseText(text, contentType, status = 200, extra = {}) {
  return new Response(text, { status, headers: { 'content-type': contentType, ...baseSecurityHeaders(), ...extra } });
}

function portalLogin(env) {
  return clean(env.PORTAL_LOGIN_URL) || 'https://lessons.futureperfect.education/';
}

function expectedOrigin(env) {
  return clean(env.QUIZ_ORIGIN) || 'https://quiz.futureperfect.education';
}

function checkMutationOrigin(request, env) {
  return clean(request.headers.get('Origin')) === expectedOrigin(env);
}

function sessionCookie(token, maxAge) {
  return `${QUIZ_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie() {
  return `${QUIZ_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function requireAuth(request, env) {
  const raw = parseCookies(request)[QUIZ_COOKIE] || '';
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT token_hash, portal_user_id, release_context_json, expires_at
     FROM quiz_auth_session
     WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`
  ).bind(hash, now).first();
  if (!row) return null;
  const context = safeJson(row.release_context_json, {});
  if (context?.l3Eligible !== true || context?.l2Inherited !== true) return null;
  await env.DB.prepare(`UPDATE quiz_auth_session SET last_seen_at=? WHERE token_hash=?`).bind(now, hash).run();
  return { tokenHash: hash, portalUserId: row.portal_user_id, releaseContext: context, expiresAt: row.expires_at };
}

async function audit(env, portalUserId, sessionId, eventType, detail = {}) {
  await env.DB.prepare(
    `INSERT INTO quiz_audit_event(event_id,portal_user_id,session_id,event_type,event_at,detail_json) VALUES(?,?,?,?,?,?)`
  ).bind(randomId('evt'), portalUserId, sessionId || null, eventType, nowIso(), JSON.stringify(detail)).run();
}

async function redeemLaunch(request, env, code) {
  const bridge = clean(env.PORTAL_BRIDGE_URL).replace(/\/$/, '');
  const secret = clean(env.QUIZ_BRIDGE_SECRET);
  if (!bridge || !secret || !code) return { ok: false, status: 503, error: 'LAUNCH_NOT_CONFIGURED' };
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(env.LAUNCH_REDEEM_TIMEOUT_MS || 5000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${bridge}/api/v1/quiz-bridge/redeem`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ code }),
      signal: controller.signal
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok) return { ok: false, status: r.status, error: body?.error || 'LAUNCH_REDEEM_FAILED' };
    if (body.releaseContext?.l3Eligible !== true || body.releaseContext?.l2Inherited !== true) {
      return { ok: false, status: 403, error: 'INVALID_RELEASE_CONTEXT' };
    }
    return { ok: true, portalUserId: clean(body.portalUserId).toLowerCase(), releaseContext: body.releaseContext };
  } catch {
    return { ok: false, status: 503, error: 'LAUNCH_REDEEM_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}

async function handleLaunch(request, env, url) {
  const code = clean(url.searchParams.get('code'));
  if (!code) return Response.redirect(portalLogin(env), 303);
  const redeemed = await redeemLaunch(request, env, code);
  if (!redeemed.ok || !redeemed.portalUserId) {
    return responseText(`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>11+ Practice</title><p>This practice link is no longer valid. Please return to the Student Portal and open 11+ Practice again.</p><p><a href="${portalLogin(env)}">Return to Student Portal</a></p>`, 'text/html; charset=utf-8', redeemed.status || 401);
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const created = new Date();
  const ttl = Math.max(900, Number(env.QUIZ_SESSION_TTL_SECONDS || 21600));
  const expires = new Date(created.getTime() + ttl * 1000);
  await env.DB.prepare(
    `INSERT INTO quiz_auth_session(token_hash,portal_user_id,release_context_json,created_at,last_seen_at,expires_at,revoked_at)
     VALUES(?,?,?,?,?,?,NULL)`
  ).bind(tokenHash, redeemed.portalUserId, JSON.stringify(redeemed.releaseContext), created.toISOString(), created.toISOString(), expires.toISOString()).run();
  await audit(env, redeemed.portalUserId, null, 'QUIZ_LOGIN_CREATED', { source: redeemed.releaseContext?.source || 'portal' });
  return new Response(null, {
    status: 303,
    headers: { ...baseSecurityHeaders(), 'Location': '/app', 'Set-Cookie': sessionCookie(token, ttl), 'Cache-Control': 'no-store' }
  });
}

async function acquireGenerationLock(env, portalUserId) {
  const token = randomToken(18);
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_MS).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO quiz_generation_lock(portal_user_id,lock_token,lock_until) VALUES(?,?,?)
     ON CONFLICT(portal_user_id) DO UPDATE SET lock_token=excluded.lock_token,lock_until=excluded.lock_until
     WHERE quiz_generation_lock.lock_until <= ?`
  ).bind(portalUserId, token, until, now.toISOString()).run();
  return Number(result?.meta?.changes || 0) === 1 ? token : null;
}

async function releaseGenerationLock(env, portalUserId, token) {
  if (!token) return;
  await env.DB.prepare(`DELETE FROM quiz_generation_lock WHERE portal_user_id=? AND lock_token=?`).bind(portalUserId, token).run();
}

async function autoFinaliseExpired(env, auth) {
  const rows = await env.DB.prepare(
    `SELECT qs.session_id
     FROM quiz_session qs JOIN quiz_session_runtime rt ON rt.session_id=qs.session_id
     WHERE qs.portal_user_id=? AND qs.status='IN_PROGRESS' AND rt.deadline_at IS NOT NULL AND rt.deadline_at<=?`
  ).bind(auth.portalUserId, nowIso()).all();
  for (const row of rows?.results || []) await finaliseSession(env, auth, row.session_id, 'TIMEOUT');
}

async function candidateRows(env) {
  const result = await env.DB.prepare(
    `SELECT qi.question_id,qi.family_id,qi.earliest_release_point,qi.prerequisite_lessons,qi.lifecycle_status,
            qf.family_wide_eligible,qf.status AS family_status,qf.evidence_gate_status,
            (SELECT COUNT(*) FROM gl_evidence_link e WHERE e.question_id=qi.question_id) AS question_evidence_count
     FROM question_instance qi JOIN question_family qf ON qf.family_id=qi.family_id`
  ).all();
  return result?.results || [];
}

async function exposureRows(env, portalUserId) {
  const result = await env.DB.prepare(
    `SELECT question_id,MAX(shown_at) AS shown_at FROM exposure_history WHERE portal_user_id=? GROUP BY question_id`
  ).bind(portalUserId).all();
  return result?.results || [];
}

async function weaknessByFamily(env, portalUserId) {
  const result = await env.DB.prepare(
    `SELECT qi.family_id,
            SUM(CASE WHEN a.is_correct=0 THEN 1 ELSE 0 END) AS wrong_count,
            COUNT(*) AS attempt_count
     FROM attempt a JOIN question_instance qi ON qi.question_id=a.question_id
     WHERE a.portal_user_id=?
     GROUP BY qi.family_id`
  ).bind(portalUserId).all();
  const out = {};
  for (const row of result?.results || []) {
    const total = Number(row.attempt_count || 0);
    out[row.family_id] = total ? Number(row.wrong_count || 0) / total : 0;
  }
  return out;
}

async function createTest(request, env, auth) {
  if (!checkMutationOrigin(request, env)) return responseJson({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  await autoFinaliseExpired(env, auth);
  const input = await request.json().catch(() => ({}));
  const mode = upper(input.mode);
  if (!MODE_COUNTS[mode]) return responseJson({ error: 'BAD_MODE' }, 400);

  const existing = await env.DB.prepare(
    `SELECT session_id,mode FROM quiz_session WHERE portal_user_id=? AND status='IN_PROGRESS' ORDER BY started_at DESC LIMIT 1`
  ).bind(auth.portalUserId).first();
  if (existing) return responseJson({ error: 'ACTIVE_TEST_EXISTS', sessionId: existing.session_id, mode: existing.mode }, 409);

  const lock = await acquireGenerationLock(env, auth.portalUserId);
  if (!lock) return responseJson({ error: 'TEST_CREATION_BUSY' }, 409);
  try {
    const recheck = await env.DB.prepare(
      `SELECT session_id,mode FROM quiz_session WHERE portal_user_id=? AND status='IN_PROGRESS' ORDER BY started_at DESC LIMIT 1`
    ).bind(auth.portalUserId).first();
    if (recheck) return responseJson({ error: 'ACTIVE_TEST_EXISTS', sessionId: recheck.session_id, mode: recheck.mode }, 409);

    const [candidates, history, weakness] = await Promise.all([
      candidateRows(env), exposureRows(env, auth.portalUserId), weaknessByFamily(env, auth.portalUserId)
    ]);
    const started = new Date();
    const sessionId = randomId('quiz');
    const seed = `${sessionId}:${auth.portalUserId}:${mode}`;
    const plan = selectQuestions({ mode, candidates, exposureHistory: history, releaseContext: auth.releaseContext, weaknessByFamily: weakness, seed, now: started });
    if (!plan.ok) {
      await audit(env, auth.portalUserId, null, 'TEST_SELECTION_FAILED', { mode, error: plan.error, needed: plan.needed, available: plan.available });
      return responseJson({ error: plan.error, needed: plan.needed, available: plan.available }, 409);
    }

    const deadline = mode === 'TIMED' ? new Date(started.getTime() + TIMED_MS).toISOString() : null;
    const statements = [
      env.DB.prepare(`INSERT INTO quiz_session(session_id,portal_user_id,mode,requested_count,status,started_at,submitted_at,engine_version,selection_trace_json) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(sessionId, auth.portalUserId, mode, MODE_COUNTS[mode], 'IN_PROGRESS', started.toISOString(), null, ENGINE_VERSION, JSON.stringify({ seed, trace: plan.trace, eligibleCount: plan.eligibleCount, unseenCount: plan.unseenCount })),
      env.DB.prepare(`INSERT INTO quiz_session_runtime(session_id,deadline_at,release_context_json,submission_reason,score_correct,score_total,finalised_at) VALUES(?,?,?,NULL,NULL,NULL,NULL)`)
        .bind(sessionId, deadline, JSON.stringify(auth.releaseContext))
    ];
    plan.chosen.forEach((q, index) => {
      const position = index + 1;
      statements.push(env.DB.prepare(`INSERT INTO quiz_question(session_id,position,question_id,family_id,selected_at,selection_reason) VALUES(?,?,?,?,?,?)`)
        .bind(sessionId, position, q.question_id, q.family_id, started.toISOString(), plan.trace[index].reason));
      statements.push(env.DB.prepare(`INSERT INTO quiz_answer_draft(session_id,position,question_id,selected_option,first_answered_at,updated_at) VALUES(?,?,?,NULL,NULL,NULL)`)
        .bind(sessionId, position, q.question_id));
      statements.push(env.DB.prepare(`INSERT INTO exposure_history(exposure_id,portal_user_id,question_id,session_id,shown_at,mode,family_id) VALUES(?,?,?,?,?,?,?)`)
        .bind(randomId('exp'), auth.portalUserId, q.question_id, sessionId, started.toISOString(), mode, q.family_id));
      statements.push(env.DB.prepare(`INSERT INTO question_aggregate(question_id,times_shown,attempts,correct_attempts,incorrect_attempts,mean_response_ms,updated_at) VALUES(?,1,0,0,0,NULL,?) ON CONFLICT(question_id) DO UPDATE SET times_shown=times_shown+1,updated_at=excluded.updated_at`)
        .bind(q.question_id, started.toISOString()));
    });
    statements.push(env.DB.prepare(`INSERT INTO quiz_audit_event(event_id,portal_user_id,session_id,event_type,event_at,detail_json) VALUES(?,?,?,?,?,?)`)
      .bind(randomId('evt'), auth.portalUserId, sessionId, 'TEST_SERVED', started.toISOString(), JSON.stringify({ mode, count: MODE_COUNTS[mode], deadline })));
    await env.DB.batch(statements);
    return responseJson({ ok: true, sessionId, mode, count: MODE_COUNTS[mode], startedAt: started.toISOString(), deadlineAt: deadline }, 201);
  } finally {
    await releaseGenerationLock(env, auth.portalUserId, lock);
  }
}

async function sessionOwned(env, auth, sessionId) {
  return env.DB.prepare(
    `SELECT qs.session_id,qs.mode,qs.requested_count,qs.status,qs.started_at,qs.submitted_at,rt.deadline_at,rt.release_context_json,rt.submission_reason,rt.score_correct,rt.score_total
     FROM quiz_session qs JOIN quiz_session_runtime rt ON rt.session_id=qs.session_id
     WHERE qs.session_id=? AND qs.portal_user_id=?`
  ).bind(sessionId, auth.portalUserId).first();
}

async function finaliseSession(env, auth, sessionId, reason) {
  const session = await sessionOwned(env, auth, sessionId);
  if (!session) return { ok: false, status: 404, error: 'TEST_NOT_FOUND' };
  if (session.status === 'SUBMITTED') return { ok: true, already: true, session };
  const now = new Date();
  const deadlineMs = session.deadline_at ? new Date(session.deadline_at).getTime() : null;
  const timedOut = session.mode === 'TIMED' && deadlineMs != null && now.getTime() >= deadlineMs;
  const effectiveReason = timedOut ? 'TIMEOUT' : reason;

  const drafts = await env.DB.prepare(
    `SELECT d.position,d.question_id,d.selected_option,d.first_answered_at,d.updated_at,qi.correct_option,qi.family_id,qf.primary_skill_id
     FROM quiz_answer_draft d JOIN question_instance qi ON qi.question_id=d.question_id JOIN question_family qf ON qf.family_id=qi.family_id
     WHERE d.session_id=? ORDER BY d.position`
  ).bind(sessionId).all();
  const rows = drafts?.results || [];
  if (effectiveReason !== 'TIMEOUT' && rows.some(row => !row.selected_option)) {
    return { ok: false, status: 409, error: 'ALL_ANSWERS_REQUIRED' };
  }

  const submittedAt = effectiveReason === 'TIMEOUT' && session.deadline_at ? session.deadline_at : now.toISOString();
  const statements = [];
  let score = 0;
  for (const row of rows) {
    const selected = row.selected_option || null;
    const correct = selected && upper(selected) === upper(row.correct_option) ? 1 : 0;
    score += correct;
    let distractorId = null;
    if (selected) {
      const opt = await env.DB.prepare(`SELECT distractor_id FROM question_option WHERE question_id=? AND option_key=?`).bind(row.question_id, upper(selected)).first();
      distractorId = opt?.distractor_id || null;
    }
    const answeredAt = row.updated_at || submittedAt;
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO attempt(attempt_id,portal_user_id,session_id,question_id,selected_option,is_correct,response_ms,answered_at,distractor_id) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(randomId('att'), auth.portalUserId, sessionId, row.question_id, selected, correct, null, answeredAt, distractorId));
    statements.push(env.DB.prepare(
      `INSERT INTO question_aggregate(question_id,times_shown,attempts,correct_attempts,incorrect_attempts,mean_response_ms,updated_at)
       VALUES(?,0,1,?,?,NULL,?)
       ON CONFLICT(question_id) DO UPDATE SET attempts=attempts+1,correct_attempts=correct_attempts+excluded.correct_attempts,incorrect_attempts=incorrect_attempts+excluded.incorrect_attempts,updated_at=excluded.updated_at`
    ).bind(row.question_id, correct, correct ? 0 : 1, submittedAt));
    statements.push(env.DB.prepare(
      `INSERT INTO student_skill_profile(portal_user_id,skill_id,mastery_score,evidence_count,correct_count,incorrect_count,last_evidence_at,updated_at)
       VALUES(?,?,?,1,?,?,?,?)
       ON CONFLICT(portal_user_id,skill_id) DO UPDATE SET
         evidence_count=evidence_count+1,
         correct_count=correct_count+excluded.correct_count,
         incorrect_count=incorrect_count+excluded.incorrect_count,
         mastery_score=CAST(correct_count+excluded.correct_count AS REAL)/(evidence_count+1),
         last_evidence_at=excluded.last_evidence_at,
         updated_at=excluded.updated_at`
    ).bind(auth.portalUserId, row.primary_skill_id, correct, correct, correct ? 0 : 1, submittedAt, submittedAt));
  }
  statements.push(env.DB.prepare(`UPDATE quiz_session SET status='SUBMITTED',submitted_at=? WHERE session_id=? AND status='IN_PROGRESS'`).bind(submittedAt, sessionId));
  statements.push(env.DB.prepare(`UPDATE quiz_session_runtime SET submission_reason=?,score_correct=?,score_total=?,finalised_at=? WHERE session_id=?`).bind(effectiveReason, score, rows.length, now.toISOString(), sessionId));
  statements.push(env.DB.prepare(`INSERT INTO quiz_audit_event(event_id,portal_user_id,session_id,event_type,event_at,detail_json) VALUES(?,?,?,?,?,?)`)
    .bind(randomId('evt'), auth.portalUserId, sessionId, effectiveReason === 'TIMEOUT' ? 'TEST_AUTO_SUBMITTED' : 'TEST_SUBMITTED', now.toISOString(), JSON.stringify({ submittedAt, score, total: rows.length })));
  await env.DB.batch(statements);
  return { ok: true, submittedAt, reason: effectiveReason, score, total: rows.length };
}

async function getTest(env, auth, sessionId) {
  let session = await sessionOwned(env, auth, sessionId);
  if (!session) return responseJson({ error: 'TEST_NOT_FOUND' }, 404);
  if (session.status === 'IN_PROGRESS' && session.mode === 'TIMED' && session.deadline_at && Date.now() >= new Date(session.deadline_at).getTime()) {
    await finaliseSession(env, auth, sessionId, 'TIMEOUT');
    session = await sessionOwned(env, auth, sessionId);
  }
  if (session.status === 'SUBMITTED') {
    return responseJson({ ok: true, sessionId, mode: session.mode, status: 'SUBMITTED', submittedAt: session.submitted_at, submissionReason: session.submission_reason, resultAvailable: true });
  }
  const result = await env.DB.prepare(
    `SELECT qq.position,qi.question_id,qi.stem,qi.diagram_type,qi.diagram_spec_json,d.selected_option,
            o.option_key,o.option_value
     FROM quiz_question qq
     JOIN question_instance qi ON qi.question_id=qq.question_id
     JOIN quiz_answer_draft d ON d.session_id=qq.session_id AND d.position=qq.position
     JOIN question_option o ON o.question_id=qi.question_id
     WHERE qq.session_id=? ORDER BY qq.position,o.option_key`
  ).bind(sessionId).all();
  const map = new Map();
  for (const row of result?.results || []) {
    if (!map.has(row.position)) map.set(row.position, {
      position: row.position, questionId: row.question_id, stem: row.stem, diagramType: row.diagram_type,
      diagramSpec: safeJson(row.diagram_spec_json, null), selectedOption: row.selected_option || null, options: []
    });
    map.get(row.position).options.push({ key: row.option_key, value: row.option_value });
  }
  return responseJson({
    ok: true, sessionId, mode: session.mode, status: session.status, startedAt: session.started_at,
    deadlineAt: session.deadline_at, serverNow: nowIso(), questions: [...map.values()]
  });
}

async function saveAnswer(request, env, auth, sessionId) {
  if (!checkMutationOrigin(request, env)) return responseJson({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  const session = await sessionOwned(env, auth, sessionId);
  if (!session) return responseJson({ error: 'TEST_NOT_FOUND' }, 404);
  if (session.status !== 'IN_PROGRESS') return responseJson({ error: 'TEST_ALREADY_SUBMITTED' }, 409);
  if (session.mode === 'TIMED' && session.deadline_at && Date.now() >= new Date(session.deadline_at).getTime()) {
    await finaliseSession(env, auth, sessionId, 'TIMEOUT');
    return responseJson({ error: 'TEST_EXPIRED', submitted: true }, 409);
  }
  const input = await request.json().catch(() => ({}));
  const position = Number(input.position);
  const option = upper(input.option);
  if (!Number.isInteger(position) || position < 1 || !['A','B','C','D'].includes(option)) return responseJson({ error: 'BAD_ANSWER' }, 400);
  const row = await env.DB.prepare(`SELECT question_id,first_answered_at FROM quiz_answer_draft WHERE session_id=? AND position=?`).bind(sessionId, position).first();
  if (!row) return responseJson({ error: 'QUESTION_NOT_FOUND' }, 404);
  const valid = await env.DB.prepare(`SELECT option_key FROM question_option WHERE question_id=? AND option_key=?`).bind(row.question_id, option).first();
  if (!valid) return responseJson({ error: 'BAD_ANSWER' }, 400);
  const now = nowIso();
  await env.DB.prepare(`UPDATE quiz_answer_draft SET selected_option=?,first_answered_at=COALESCE(first_answered_at,?),updated_at=? WHERE session_id=? AND position=?`)
    .bind(option, now, now, sessionId, position).run();
  return responseJson({ ok: true, position, selectedOption: option });
}

async function submitTest(request, env, auth, sessionId) {
  if (!checkMutationOrigin(request, env)) return responseJson({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  const outcome = await finaliseSession(env, auth, sessionId, 'MANUAL');
  return responseJson(outcome.ok ? { ok: true, sessionId, submittedAt: outcome.submittedAt, submissionReason: outcome.reason } : { error: outcome.error }, outcome.ok ? 200 : outcome.status);
}

async function getResults(env, auth, sessionId) {
  const session = await sessionOwned(env, auth, sessionId);
  if (!session) return responseJson({ error: 'TEST_NOT_FOUND' }, 404);
  if (session.status !== 'SUBMITTED') return responseJson({ error: 'RESULTS_LOCKED_UNTIL_SUBMISSION' }, 409);
  const releaseContext = safeJson(session.release_context_json, {});
  const rows = await env.DB.prepare(
    `SELECT qq.position,qi.question_id,qi.family_id,qi.stem,qi.correct_option,qi.correct_display,qi.explanation,qi.validation_spec_json,
            a.selected_option,a.is_correct,qo.option_value AS selected_display,df.description AS distractor_description
     FROM quiz_question qq
     JOIN question_instance qi ON qi.question_id=qq.question_id
     LEFT JOIN attempt a ON a.session_id=qq.session_id AND a.question_id=qq.question_id
     LEFT JOIN question_option qo ON qo.question_id=qi.question_id AND qo.option_key=a.selected_option
     LEFT JOIN distractor_family df ON df.distractor_id=a.distractor_id
     WHERE qq.session_id=? ORDER BY qq.position`
  ).bind(sessionId).all();
  const families = [...new Set((rows?.results || []).map(r => r.family_id))];
  let reqs = [];
  if (families.length) {
    const placeholders = families.map(() => '?').join(',');
    const q = `SELECT flr.family_id,flr.lesson_code,flr.requirement_type,l.track,l.sequence_no,l.title
               FROM family_lesson_requirement flr JOIN lesson l ON l.lesson_code=flr.lesson_code
               WHERE flr.family_id IN (${placeholders})`;
    reqs = (await env.DB.prepare(q).bind(...families).all())?.results || [];
  }
  const byFamily = new Map();
  for (const req of reqs) {
    if (!byFamily.has(req.family_id)) byFamily.set(req.family_id, []);
    byFamily.get(req.family_id).push(req);
  }
  const items = (rows?.results || []).map(row => resultItem({
    question: { ...row, selected_display: row.selected_display },
    selectedOption: row.selected_option,
    timedOutUnanswered: session.submission_reason === 'TIMEOUT',
    distractorDescription: row.distractor_description,
    requirements: byFamily.get(row.family_id) || [],
    releaseContext
  }));
  return responseJson({
    ok: true, sessionId, mode: session.mode, submittedAt: session.submitted_at, submissionReason: session.submission_reason,
    score: { correct: Number(session.score_correct || 0), total: Number(session.score_total || items.length) }, items
  });
}

async function logout(request, env, auth) {
  if (!checkMutationOrigin(request, env)) return responseJson({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (auth) await env.DB.prepare(`UPDATE quiz_auth_session SET revoked_at=? WHERE token_hash=?`).bind(nowIso(), auth.tokenHash).run();
  return responseJson({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}

function routeMatch(pathname, suffix) {
  const re = new RegExp(`^/api/tests/([^/]+)${suffix}$`);
  const m = pathname.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return responseJson({ ok: true, service: 'futureperfect-11plus-practice', engineVersion: ENGINE_VERSION });
    if (url.pathname === '/launch' && request.method === 'GET') return handleLaunch(request, env, url);
    if (url.pathname === '/assets/app.js' && request.method === 'GET') return responseText(APP_JS, 'text/javascript; charset=utf-8');
    if (url.pathname === '/assets/styles.css' && request.method === 'GET') return responseText(APP_CSS, 'text/css; charset=utf-8');

    const auth = await requireAuth(request, env);
    if ((url.pathname === '/' || url.pathname === '/app') && request.method === 'GET') {
      if (!auth) return Response.redirect(portalLogin(env), 303);
      return responseText(APP_HTML, 'text/html; charset=utf-8');
    }
    if (!url.pathname.startsWith('/api/')) return Response.redirect(auth ? '/app' : portalLogin(env), 303);
    if (!auth) return responseJson({ error: 'QUIZ_SESSION_REQUIRED', portalLoginUrl: portalLogin(env) }, 401, { 'Set-Cookie': clearCookie() });

    if (url.pathname === '/api/me' && request.method === 'GET') {
      await autoFinaliseExpired(env, auth);
      const active = await env.DB.prepare(`SELECT session_id,mode FROM quiz_session WHERE portal_user_id=? AND status='IN_PROGRESS' ORDER BY started_at DESC LIMIT 1`).bind(auth.portalUserId).first();
      return responseJson({ ok: true, student: { portalUserId: auth.portalUserId }, activeTest: active || null, releaseContextSource: auth.releaseContext?.source || null });
    }
    if (url.pathname === '/api/tests' && request.method === 'POST') return createTest(request, env, auth);
    const testId = routeMatch(url.pathname, '');
    if (testId && request.method === 'GET') return getTest(env, auth, testId);
    const answerId = routeMatch(url.pathname, '/answer');
    if (answerId && request.method === 'POST') return saveAnswer(request, env, auth, answerId);
    const submitId = routeMatch(url.pathname, '/submit');
    if (submitId && request.method === 'POST') return submitTest(request, env, auth, submitId);
    const resultsId = routeMatch(url.pathname, '/results');
    if (resultsId && request.method === 'GET') return getResults(env, auth, resultsId);
    if (url.pathname === '/api/logout' && request.method === 'POST') return logout(request, env, auth);
    return responseJson({ error: 'NOT_FOUND' }, 404);
  }
};

const APP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>11+ Practice · Future Perfect Tuitions</title><link rel="stylesheet" href="/assets/styles.css"></head><body><header class="top"><div><strong>Future Perfect Tuitions</strong><span>11+ Practice</span></div><button id="logout" type="button">Return to Portal</button></header><main id="app"><p>Loading…</p></main><script type="module" src="/assets/app.js"></script></body></html>`;

const APP_CSS = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#10213d;background:#f4f7fb}*{box-sizing:border-box}body{margin:0}.top{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:#012169;color:#fff}.top div{display:flex;gap:12px;align-items:baseline}.top span{opacity:.85}.top button,.button{border:0;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer}.top button{background:#fff;color:#012169}main{max-width:980px;margin:28px auto;padding:0 18px}.card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;padding:22px;box-shadow:0 8px 28px rgba(1,33,105,.07);margin-bottom:18px}.mode-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.mode{border:2px solid #e0e7f0;border-radius:14px;padding:18px}.mode h2{margin-top:0}.primary{background:#012169;color:#fff}.secondary{background:#eaf0fb;color:#012169}.question{margin-bottom:18px}.question h2{font-size:1.08rem}.options{display:grid;gap:8px}.option{display:flex;gap:10px;padding:11px;border:1px solid #cfd9e6;border-radius:10px;cursor:pointer}.option:has(input:checked){border-color:#012169;background:#eef3ff}.timer{font-weight:800;font-variant-numeric:tabular-nums}.timer.danger{color:#a11212}.actions{display:flex;gap:10px;justify-content:flex-end;position:sticky;bottom:0;padding:12px 0;background:linear-gradient(transparent,#f4f7fb 30%)}.error{background:#fff0f0;border:1px solid #e2a7a7;padding:12px;border-radius:10px;color:#8b1111}.score{font-size:1.3rem;font-weight:800}.incorrect{border-left:5px solid #b42318}.correct{border-left:5px solid #238636}.revision{background:#fff7d6;border:1px solid #e4c44d;padding:12px;border-radius:10px}.muted{color:#5b6b81}.diagram{margin:12px 0;padding:12px;border:1px dashed #bac7d8;border-radius:10px;background:#fbfcff;overflow:auto}.diagram svg{max-width:100%;height:auto}.result-answer{display:grid;gap:6px;margin:10px 0}`;

const APP_JS = `const app=document.getElementById('app');const logout=document.getElementById('logout');let active=null;let deadlineTimer=null;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function api(path,options={}){const r=await fetch(path,{...options,headers:{Accept:'application/json',...(options.headers||{})}});const b=await r.json().catch(()=>({}));if(r.status===401){location.href=b.portalLoginUrl||'https://lessons.futureperfect.education/';throw new Error('signed out')}if(!r.ok){const e=new Error(b.error||('HTTP '+r.status));e.body=b;throw e}return b}function err(e){app.insertAdjacentHTML('afterbegin','<div class="error">'+esc(e?.body?.error||e.message||e)+'</div>')}function home(me){active=null;if(deadlineTimer)clearInterval(deadlineTimer);app.innerHTML='<section class="card"><h1>11+ Practice</h1><p>Choose a test. Your question selection follows your current FPT release state and the shared 30-day question cooldown.</p>'+ (me.activeTest?'<p><button class="button primary" id="resume">Resume '+esc(me.activeTest.mode)+' test</button></p>':'') +'<div class="mode-grid"><article class="mode"><h2>Stretch Test</h2><p><strong>15 questions</strong> · untimed</p><button class="button primary" data-mode="STRETCH">Start Stretch Test</button></article><article class="mode"><h2>Timed Test</h2><p><strong>30 questions</strong> · strict 25 minutes</p><button class="button primary" data-mode="TIMED">Start Timed Test</button></article></div></section>';document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>start(b.dataset.mode));document.getElementById('resume')?.addEventListener('click',()=>loadTest(me.activeTest.session_id||me.activeTest.sessionId))}async function start(mode){try{const b=await api('/api/tests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});await loadTest(b.sessionId)}catch(e){if(e.body?.error==='ACTIVE_TEST_EXISTS')return loadTest(e.body.sessionId);err(e)}}function diagram(type,spec){if(!spec||type==='None/text')return'';const box=x=>'<div class="diagram">'+x+'</div>';if(type==='Table'&&Array.isArray(spec.rows)){return box('<table><thead><tr>'+(spec.headers||[]).map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+spec.rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>')}if(type==='Coordinate grid'&&spec.points){const xr=spec.x_range||[-6,6],yr=spec.y_range||[-6,6],w=360,h=280,pad=28,x=v=>pad+(Number(v)-xr[0])*(w-2*pad)/(xr[1]-xr[0]),y=v=>h-pad-(Number(v)-yr[0])*(h-2*pad)/(yr[1]-yr[0]);let g='<svg viewBox=\"0 0 '+w+' '+h+'\" role=\"img\" aria-label=\"Coordinate grid\">';for(let i=Math.ceil(xr[0]);i<=Math.floor(xr[1]);i++){g+='<line x1=\"'+x(i)+'\" y1=\"'+pad+'\" x2=\"'+x(i)+'\" y2=\"'+(h-pad)+'\" stroke=\"#dbe3ee\"/><text x=\"'+x(i)+'\" y=\"'+(y(0)+16)+'\" font-size=\"10\" text-anchor=\"middle\">'+i+'</text>'}for(let i=Math.ceil(yr[0]);i<=Math.floor(yr[1]);i++){g+='<line x1=\"'+pad+'\" y1=\"'+y(i)+'\" x2=\"'+(w-pad)+'\" y2=\"'+y(i)+'\" stroke=\"#dbe3ee\"/><text x=\"'+(x(0)-8)+'\" y=\"'+(y(i)+3)+'\" font-size=\"10\" text-anchor=\"end\">'+i+'</text>'}g+='<line x1=\"'+x(0)+'\" y1=\"'+pad+'\" x2=\"'+x(0)+'\" y2=\"'+(h-pad)+'\" stroke=\"#10213d\"/><line x1=\"'+pad+'\" y1=\"'+y(0)+'\" x2=\"'+(w-pad)+'\" y2=\"'+y(0)+'\" stroke=\"#10213d\"/>';for(const [n,p] of Object.entries(spec.points)){g+='<circle cx=\"'+x(p[0])+'\" cy=\"'+y(p[1])+'\" r=\"5\" fill=\"#012169\"/><text x=\"'+(x(p[0])+8)+'\" y=\"'+(y(p[1])-8)+'\" font-size=\"14\" font-weight=\"700\">'+esc(n)+'</text>'}g+='</svg>';return box(g)}if(type==='Clock'&&spec.time12){const m=String(spec.time12.minute).padStart(2,'0');return box('<strong>Clock:</strong> '+esc(spec.time12.hour+':'+m+(spec.time12.pm?' pm':' am')))}if(type==='Grid/tile/shading')return box('<strong>Equal-part diagram:</strong> '+esc(spec.shaded_cells)+' shaded out of '+esc(spec.total_cells));if(type==='Line graph')return box('<strong>Line graph data:</strong> '+(spec.x_labels||[]).map((x,i)=>esc(x)+': '+esc(spec.y_values?.[i])).join(' · '));if(type==='Number line')return box('<strong>Number line:</strong> start '+esc(spec.start)+', step '+esc(spec.step)+', marked interval '+esc(spec.marked_index));if(type==='Money/menu'&&spec.items)return box(spec.items.map(x=>esc(x[0])+': '+esc(x[1])).join(' · ')+' · Payment: '+esc(spec.payment));if(type==='Venn/sorting')return box('<strong>Venn diagram:</strong> '+esc(spec.left)+' / '+esc(spec.right));if(type==='Net'&&spec.faces)return box('<strong>Cube net faces:</strong> '+Object.entries(spec.faces).map(([k,v])=>esc(k)+': '+esc(v)).join(' · '));if(type==='2D shape/angle'&&spec.angle_degrees!=null)return box('<strong>Angle:</strong> '+esc(spec.angle_degrees)+'°');if(type==='3D solid'&&spec.solid)return box('<strong>3D solid:</strong> '+esc(spec.solid));if(type==='Pie chart'&&spec.sector_percent!=null)return box('<strong>Pie chart sector:</strong> '+esc(spec.sector_percent)+'% of '+esc(spec.total));if(type==='Route/map'&&spec.map_distance_cm!=null)return box('<strong>Map:</strong> '+esc(spec.map_distance_cm)+' cm at scale 1 cm : '+esc(spec.scale_cm_to_cm)+' cm');if(type==='Formula/function machine')return box('<strong>Formula:</strong> '+esc(spec.expression||spec.formula||''));if(type==='Mixed/other visual'&&spec.circle)return box('<strong>Circle:</strong> radius '+esc(spec.circle.radius_cm)+' cm, diameter '+esc(spec.circle.diameter_cm)+' cm');return box('<span class="muted">Visual information: '+esc(JSON.stringify(spec))+'</span>')}async function loadTest(id){try{const b=await api('/api/tests/'+encodeURIComponent(id));if(b.status==='SUBMITTED')return results(id);active=b;renderTest(b)}catch(e){err(e)}}function renderTest(t){const answered=t.questions.filter(q=>q.selectedOption).length;app.innerHTML='<section class="card"><div style="display:flex;justify-content:space-between;gap:12px"><div><h1>'+esc(t.mode==='TIMED'?'Timed Test':'Stretch Test')+'</h1><p>'+answered+' of '+t.questions.length+' answered</p></div><div id="timer" class="timer"></div></div></section>'+t.questions.map(q=>'<section class="card question" id="q'+q.position+'"><h2>'+q.position+'. '+esc(q.stem)+'</h2>'+diagram(q.diagramType,q.diagramSpec)+'<div class="options">'+q.options.map(o=>'<label class="option"><input type="radio" name="q'+q.position+'" value="'+esc(o.key)+'" '+(q.selectedOption===o.key?'checked':'')+'><strong>'+esc(o.key)+'</strong> '+esc(o.value)+'</label>').join('')+'</div></section>').join('')+'<div class="actions"><button class="button secondary" id="backHome">Home</button><button class="button primary" id="submit">Submit whole test</button></div>';t.questions.forEach(q=>document.querySelectorAll('input[name="q'+q.position+'"]').forEach(i=>i.onchange=async()=>{try{await api('/api/tests/'+encodeURIComponent(t.sessionId)+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({position:q.position,option:i.value})});q.selectedOption=i.value}catch(e){err(e)}}));document.getElementById('backHome').onclick=loadHome;document.getElementById('submit').onclick=()=>submit(t);setupTimer(t)}function setupTimer(t){if(deadlineTimer)clearInterval(deadlineTimer);const el=document.getElementById('timer');if(!el)return;if(t.mode!=='TIMED'||!t.deadlineAt){el.textContent='Untimed';return}const tick=async()=>{const ms=new Date(t.deadlineAt).getTime()-Date.now();const remain=Math.max(0,Math.ceil(ms/1000));el.textContent=Math.floor(remain/60)+':'+String(remain%60).padStart(2,'0');el.classList.toggle('danger',remain<=300);if(ms<=0){clearInterval(deadlineTimer);try{await api('/api/tests/'+encodeURIComponent(t.sessionId)+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch(e){if(e.body?.error!=='ALL_ANSWERS_REQUIRED'&&e.body?.error!=='TEST_ALREADY_SUBMITTED'){} }return results(t.sessionId)}};tick();deadlineTimer=setInterval(tick,1000)}async function submit(t){try{await api('/api/tests/'+encodeURIComponent(t.sessionId)+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});results(t.sessionId)}catch(e){if(e.body?.error==='ALL_ANSWERS_REQUIRED'){alert('Please answer every question before submitting.')}else err(e)}}async function results(id){try{if(deadlineTimer)clearInterval(deadlineTimer);const b=await api('/api/tests/'+encodeURIComponent(id)+'/results');app.innerHTML='<section class="card"><h1>Results</h1><p class="score">'+b.score.correct+' / '+b.score.total+'</p><p>'+esc(b.submissionReason==='TIMEOUT'?'Time expired at 25:00. Unanswered questions are marked incorrect.':'Test submitted.')+'</p><button class="button primary" id="newTest">Back to practice home</button></section>'+b.items.map(x=>'<section class="card '+(x.isCorrect?'correct':'incorrect')+'"><h2>'+x.position+'. '+esc(x.stem)+'</h2><div class="result-answer"><div><strong>Your answer:</strong> '+esc(x.selectedAnswer?x.selectedAnswer.option+' — '+(x.selectedAnswer.display||''):(x.timedOutUnanswered?'Unanswered when time expired':'Unanswered'))+'</div><div><strong>Correct answer:</strong> '+esc(x.correctAnswer.option+' — '+x.correctAnswer.display)+'</div></div><p><strong>Working:</strong> '+esc(x.workedExplanation)+'</p>'+(x.misconception?'<p><strong>Possible misconception:</strong> '+esc(x.misconception)+'</p>':'')+(!x.isCorrect?'<div class="revision"><strong>Suggested FPT lesson'+(x.revisionLessons.length===1?'':'s')+' to revise</strong><ul>'+(x.revisionLessons.length?x.revisionLessons.map(l=>'<li><strong>'+esc(l.lessonCode)+'</strong> '+esc(l.title)+' ('+esc(l.track)+')</li>').join(''):'<li>Please ask your tutor which released lesson to revisit for this skill.</li>')+'</ul></div>':'')+'</section>').join('');document.getElementById('newTest').onclick=loadHome}catch(e){err(e)}}async function loadHome(){try{home(await api('/api/me'))}catch(e){err(e)}}logout.onclick=async()=>{try{await api('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}finally{location.href='https://lessons.futureperfect.education/'}};loadHome();`;
