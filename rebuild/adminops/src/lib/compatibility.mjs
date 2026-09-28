import { compileAccessScope, globalToCatalogue } from './compiler.mjs';
import {
  stableStringify,
  sha256Hex,
  publishScopeAtomic,
  resolveCurrentScope
} from './atomic-publisher.mjs';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

function safeOperationId(value) {
  return clean(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'operation';
}

async function hmacHex(secret, text) {
  const keyText = clean(secret);
  if (!keyText) throw new Error('A compatibility scope secret is required.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyText),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(clean(text))));
  return [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function opaqueAccessScopeId(portalUserIdNorm, secret) {
  const user = norm(portalUserIdNorm);
  if (!user) throw new Error('A normalized Portal User ID is required to derive an opaque scope.');
  return `u-${(await hmacHex(secret, user)).slice(0, 40)}`;
}

async function publishCompiledAccess(options = {}) {
  const store = options.readModelStore;
  const globalReadModel = options.globalReadModel;
  const accessInput = options.accessInput;
  const portalUserIdNorm = norm(options.portalUserIdNorm);
  const scopeId = options.scopeId || await opaqueAccessScopeId(portalUserIdNorm, options.scopeSecret);
  const scope = `access:${scopeId}`;
  const compiled = compileAccessScope(accessInput, globalToCatalogue(globalReadModel), {
    scopeId,
    asOfDate: options.asOfDate || accessInput?.asOfDate
  });
  const payloadSha256 = await sha256Hex(stableStringify(compiled));

  let current = null;
  try { current = await resolveCurrentScope(store, scope); } catch {}
  if (current?.sha256 === payloadSha256) {
    return {
      status: 'UNCHANGED',
      scope,
      scopeId,
      version: current.version,
      payloadSha256,
      previousVersion: clean(current.pointer?.previous?.version) || null,
      compiled
    };
  }

  const version = `a-${payloadSha256.slice(0, 24)}-${safeOperationId(options.operationId)}`;
  const published = await publishScopeAtomic(store, {
    scope,
    payload: compiled,
    version,
    updatedAt: options.updatedAt,
    failAfterCandidate: options.failShadowAfterCandidate === true
  });
  return {
    status: 'PUBLISHED',
    scope,
    scopeId,
    version: published.version,
    payloadSha256: published.payloadSha256,
    previousVersion: published.previousVersion,
    compiled
  };
}

async function runDualWriteCompatibility(options = {}) {
  if (typeof options.legacyWrite !== 'function') throw new Error('legacyWrite callback is required.');
  if (typeof options.loadAccessInput !== 'function') throw new Error('loadAccessInput callback is required.');
  if (typeof options.recordReconciliation !== 'function') throw new Error('recordReconciliation callback is required.');

  const operationId = safeOperationId(options.operationId);
  const portalUserIdNorm = norm(options.portalUserIdNorm);
  if (!portalUserIdNorm) throw new Error('portalUserIdNorm is required.');

  const legacyResult = await options.legacyWrite();
  if (legacyResult?.ok === false) {
    return {
      ok: false,
      operationId,
      legacyApplied: false,
      shadowApplied: false,
      reconciliationRequired: false,
      legacyResult
    };
  }

  try {
    const accessInput = await options.loadAccessInput();
    const shadow = await publishCompiledAccess({
      readModelStore: options.readModelStore,
      globalReadModel: options.globalReadModel,
      accessInput,
      portalUserIdNorm,
      scopeId: options.scopeId,
      scopeSecret: options.scopeSecret,
      operationId,
      asOfDate: options.asOfDate || accessInput?.asOfDate,
      updatedAt: options.updatedAt,
      failShadowAfterCandidate: options.failShadowAfterCandidate === true
    });
    await options.recordReconciliation({
      operationId,
      portalUserIdNorm,
      status: 'SYNCED',
      shadowScope: shadow.scope,
      shadowVersion: shadow.version,
      shadowSha256: shadow.payloadSha256,
      error: ''
    });
    return {
      ok: true,
      operationId,
      legacyApplied: true,
      shadowApplied: true,
      reconciliationRequired: false,
      legacyResult,
      shadow
    };
  } catch (error) {
    await options.recordReconciliation({
      operationId,
      portalUserIdNorm,
      status: 'RECONCILE_REQUIRED',
      shadowScope: '',
      shadowVersion: '',
      shadowSha256: '',
      error: clean(error?.message || 'Shadow compilation/publication failed.').slice(0, 500)
    });
    return {
      ok: true,
      operationId,
      legacyApplied: true,
      shadowApplied: false,
      reconciliationRequired: true,
      legacyResult,
      shadowError: clean(error?.message || 'Shadow compilation/publication failed.')
    };
  }
}

async function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function loadD1AccessRows(db, portalUserIdNorm) {
  const user = norm(portalUserIdNorm);
  const [assignmentResult, definitionResult, entitlementResult, prelessonResult] = await Promise.all([
    db.prepare(`SELECT
        a.assignment_id, a.portal_user_id_norm, a.batch_key, a.effective_from, a.effective_to,
        b.subject, b.school_year, b.stream, b.maths_level,
        b.active_from AS batch_active_from, b.active_to AS batch_active_to
      FROM student_batch_assignments a
      JOIN batch_definitions b ON b.batch_key = a.batch_key
      WHERE a.portal_user_id_norm = ?
      ORDER BY a.effective_from, a.assignment_id`).bind(user).all(),
    db.prepare(`SELECT batch_key, academic_year, subject, school_year, stream, maths_level, active_from, active_to
      FROM batch_definitions ORDER BY batch_key`).all(),
    db.prepare(`SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source_batch_code, source_lesson_date
      FROM lesson_entitlements WHERE portal_user_id_norm = ? ORDER BY lesson_id`).bind(user).all(),
    db.prepare(`SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access
      FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? ORDER BY lesson_id, batch_key`).bind(user).all()
  ]);
  return {
    batchAssignments: await rows(assignmentResult),
    batchDefinitions: await rows(definitionResult),
    entitlements: await rows(entitlementResult),
    onlinePreLessonEntitlements: await rows(prelessonResult)
  };
}

async function legacyLessonState(db, portalUserIdNorm, lessonId) {
  const user = norm(portalUserIdNorm);
  const id = clean(lessonId);
  const [full, pre] = await Promise.all([
    db.prepare(`SELECT portal_user_id_norm, lesson_id, core_access, vr_access, source_batch_code, source_lesson_date
      FROM lesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(user, id).first(),
    db.prepare(`SELECT portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access
      FROM online_prelesson_entitlements WHERE portal_user_id_norm = ? AND lesson_id = ? LIMIT 1`).bind(user, id).first()
  ]);
  return { full: full || null, prelesson: pre || null };
}

async function applyLegacyFullRelease(db, item, options = {}) {
  const user = norm(item?.portalUserIdNorm);
  const lessonId = clean(item?.lessonId);
  const batchKey = clean(item?.batchKey);
  const lessonDate = clean(item?.lessonDate);
  const now = clean(options.now) || new Date().toISOString();
  const vrAccess = Number(item?.vrAccess) === 1 ? 1 : 0;
  if (!user || !lessonId || !lessonDate) throw new Error('Full release requires user, lesson and lesson date.');

  const existing = await db.prepare(`SELECT first_granted_at FROM lesson_entitlements
    WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(user, lessonId).first();
  const entitlement = db.prepare(`INSERT INTO lesson_entitlements (
      portal_user_id_norm, lesson_id, core_access, vr_access, source,
      first_granted_at, last_confirmed_at, source_batch_code, source_lesson_date
    ) VALUES (?, ?, 1, ?, 'excel', ?, ?, ?, ?)
    ON CONFLICT(portal_user_id_norm, lesson_id) DO UPDATE SET
      core_access = 1,
      last_confirmed_at = excluded.last_confirmed_at,
      source_batch_code = excluded.source_batch_code,
      source_lesson_date = excluded.source_lesson_date`)
    .bind(user, lessonId, vrAccess, clean(existing?.first_granted_at) || now, now, batchKey || null, lessonDate);
  const clearPre = db.prepare(`DELETE FROM online_prelesson_entitlements
    WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(user, lessonId);
  await db.batch([entitlement, clearPre]);
  return { ok: true, accessMode: 'full', status: existing ? 'CONFIRMED' : 'CREATED' };
}

async function applyLegacyPrelessonRelease(db, item, options = {}) {
  const user = norm(item?.portalUserIdNorm);
  const lessonId = clean(item?.lessonId);
  const batchKey = clean(item?.batchKey);
  const lessonDate = clean(item?.lessonDate);
  const sourceRowId = clean(item?.syncRowId || options.sourceRowId || 'compatibility');
  const now = clean(options.now) || new Date().toISOString();
  const vrAccess = Number(item?.vrAccess) === 1 ? 1 : 0;
  if (!user || !lessonId || !batchKey || !lessonDate) throw new Error('PreLesson release requires user, lesson, batch and lesson date.');

  const full = await db.prepare(`SELECT core_access FROM lesson_entitlements
    WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(user, lessonId).first();
  if (Number(full?.core_access) === 1) {
    await db.prepare(`DELETE FROM online_prelesson_entitlements
      WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(user, lessonId).run();
    return { ok: true, accessMode: 'full', status: 'ALREADY_FULL' };
  }
  const existing = await db.prepare(`SELECT first_granted_at FROM online_prelesson_entitlements
    WHERE portal_user_id_norm = ? AND lesson_id = ? LIMIT 1`).bind(user, lessonId).first();
  const clearExisting = db.prepare(`DELETE FROM online_prelesson_entitlements
    WHERE portal_user_id_norm = ? AND lesson_id = ?`).bind(user, lessonId);
  const insert = db.prepare(`INSERT INTO online_prelesson_entitlements (
      portal_user_id_norm, lesson_id, batch_key, lesson_date, vr_access,
      source_row_id, first_granted_at, last_confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(user, lessonId, batchKey, lessonDate, vrAccess, sourceRowId, clean(existing?.first_granted_at) || now, now);
  await db.batch([clearExisting, insert]);
  return { ok: true, accessMode: 'prelesson', status: existing ? 'CONFIRMED' : 'CREATED' };
}

async function recordD1Reconciliation(db, row) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO rebuild_shadow_reconciliation (
      operation_id, portal_user_id_norm, status, shadow_scope, shadow_version,
      shadow_sha256, error_message, first_seen_at, last_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_id) DO UPDATE SET
      status = excluded.status,
      shadow_scope = excluded.shadow_scope,
      shadow_version = excluded.shadow_version,
      shadow_sha256 = excluded.shadow_sha256,
      error_message = excluded.error_message,
      last_updated_at = excluded.last_updated_at`)
    .bind(
      clean(row.operationId), norm(row.portalUserIdNorm), clean(row.status),
      clean(row.shadowScope) || null, clean(row.shadowVersion) || null,
      clean(row.shadowSha256) || null, clean(row.error) || null, now, now
    ).run();
}

function releaseParity(lessonId, legacyState, accessReadModel) {
  const id = clean(lessonId);
  const lessonAccess = accessReadModel?.snapshot?.lessonAccess?.[id] || null;
  const legacyFull = Number(legacyState?.full?.core_access) === 1;
  const legacyPrelesson = Boolean(legacyState?.prelesson) && !legacyFull;
  return {
    lessonId: id,
    legacyFull,
    legacyPrelesson,
    compiledCore: Boolean(lessonAccess?.core),
    compiledPrelessonOnly: Boolean(lessonAccess?.preLessonOnly),
    compiledBlocked: Boolean(lessonAccess?.blocked),
    match: legacyFull
      ? Boolean(lessonAccess?.core) && !lessonAccess?.blocked
      : legacyPrelesson
        ? Boolean(lessonAccess?.preLessonOnly) && !lessonAccess?.blocked
        : !lessonAccess || (!lessonAccess.core && !lessonAccess.preLessonOnly)
  };
}

export {
  clean,
  norm,
  hmacHex,
  opaqueAccessScopeId,
  publishCompiledAccess,
  runDualWriteCompatibility,
  loadD1AccessRows,
  legacyLessonState,
  applyLegacyFullRelease,
  applyLegacyPrelessonRelease,
  recordD1Reconciliation,
  releaseParity
};
