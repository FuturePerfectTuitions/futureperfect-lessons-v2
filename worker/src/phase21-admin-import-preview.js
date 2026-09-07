import { processItem as processPhase13Item, normalisePortalUserId } from './index-phase13.js';
import {
  clean,
  parseCsv,
  getField,
  parseLessonDate,
  extractLessonCode,
  extractLessonTitle,
  deriveReleaseType,
  normaliseTitle
} from './phase21-admin-import-core.js';
import { resolveLessonCode } from './phase21-admin-lesson-resolver.js';

const VALID_PROBE_STATUSES = new Set(['ENTITLEMENT_MISSING', 'BATCH_RELEASE_MISSING', 'CONFIRMED']);

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function rowSourceId(row) {
  const fingerprint = [row.portalUserIdNorm, row.batchKey, row.lessonId, row.lessonDate, row.releaseType].join('|');
  const digest = await sha256Hex(fingerprint);
  return `csv:${digest.slice(0, 32)}`;
}

function publicRow(row) {
  return {
    rowNumber: row.rowNumber,
    name: row.name,
    portalUserId: row.portalUserId,
    batchId: row.batchKey,
    csvLessonId: row.csvLessonId,
    portalLessonId: row.lessonId || '',
    lessonTitle: row.lessonTitle || row.csvLessonTitle || '',
    lessonDate: row.lessonDate || '',
    lessonStatus: row.lessonStatus,
    releaseType: row.releaseType,
    status: row.status,
    category: row.category,
    message: row.message || '',
    warnings: row.warnings || [],
    action: row.action || null,
    syncRowId: row.syncRowId || ''
  };
}

async function normaliseCsvRows(env, csvText) {
  const parsed = parseCsv(csvText);
  if (parsed.error) return parsed;
  const rows = [];

  for (const item of parsed.records) {
    const record = item.record;
    const name = getField(record, 'Name');
    const portalUserId = getField(record, 'Student');
    const batchKey = getField(record, 'Mode');
    const lessonCell = getField(record, 'Lesson');
    const lessonStatus = getField(record, 'LessonStatus');
    const csvSubject = getField(record, 'Subject');
    const lessonDateRaw = getField(record, 'LessonDated');
    const csvLessonId = extractLessonCode(lessonCell);
    const csvLessonTitle = extractLessonTitle(lessonCell);
    const releaseType = deriveReleaseType(lessonStatus, batchKey);
    const row = {
      rowNumber: item.rowNumber,
      name,
      portalUserId,
      portalUserIdNorm: normalisePortalUserId(portalUserId),
      batchKey,
      csvSubject,
      csvLessonId,
      csvLessonTitle,
      lessonStatus,
      lessonDateRaw,
      lessonDate: parseLessonDate(lessonDateRaw),
      releaseType,
      warnings: []
    };

    if (!portalUserId) {
      Object.assign(row, { status: 'PORTAL_USER_ID_MISSING', category: 'error', message: 'Student/Portal User ID is missing.' });
      rows.push(row);
      continue;
    }
    if (!batchKey) {
      Object.assign(row, { status: 'BATCH_ID_MISSING', category: 'error', message: 'Mode/Batch ID is missing.' });
      rows.push(row);
      continue;
    }
    if (!csvLessonId) {
      Object.assign(row, { status: 'LESSON_CODE_MISSING', category: 'error', message: 'Lesson code could not be extracted from the Lesson column.' });
      rows.push(row);
      continue;
    }
    if (!row.lessonDate) {
      Object.assign(row, { status: 'LESSON_DATE_INVALID', category: 'error', message: `LessonDated value "${lessonDateRaw}" is not a supported date.` });
      rows.push(row);
      continue;
    }

    const resolved = await resolveLessonCode(env, csvLessonId, csvLessonTitle);
    if (resolved.error) {
      Object.assign(row, { status: resolved.error, category: 'error', message: resolved.message });
      rows.push(row);
      continue;
    }
    row.lessonId = resolved.lessonId;
    row.lessonTitle = resolved.title || csvLessonTitle;
    row.syncRowId = await rowSourceId(row);

    if (csvLessonTitle && resolved.title && normaliseTitle(csvLessonTitle) !== normaliseTitle(resolved.title)) {
      row.warnings.push(`CSV title "${csvLessonTitle}" differs from Portal title "${resolved.title}".`);
    }

    if (releaseType === 'SKIP_INCOMPLETE_FACE_TO_FACE') {
      Object.assign(row, {
        status: 'SKIPPED_INCOMPLETE_FACE_TO_FACE',
        category: 'skipped',
        message: 'Lesson is not Completed and the batch is not Online, so no Portal release will be made.',
        action: null
      });
    }
    rows.push(row);
  }
  return { rows };
}

function markFileDuplicates(rows) {
  const actionable = rows.filter(row => row.lessonId && row.category !== 'error' && row.category !== 'skipped');
  const groups = new Map();
  for (const row of actionable) {
    const key = `${row.portalUserIdNorm}|${row.lessonId}|${row.batchKey.toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const dates = new Set(group.map(row => row.lessonDate));
    if (dates.size > 1) {
      for (const row of group) {
        Object.assign(row, {
          status: 'CONFLICTING_ROWS',
          category: 'error',
          message: 'The CSV contains the same student, lesson and batch with different lesson dates.',
          action: null
        });
      }
      continue;
    }

    const fullRows = group.filter(row => row.releaseType === 'FULL');
    const preRows = group.filter(row => row.releaseType === 'PRELESSON_ONLY');
    const winner = fullRows[0] || preRows[0];
    for (const row of group) {
      if (row === winner) continue;
      const superseded = winner?.releaseType === 'FULL' && row.releaseType === 'PRELESSON_ONLY';
      Object.assign(row, {
        status: superseded ? 'SUPERSEDED_BY_FULL_IN_FILE' : 'DUPLICATE_IN_FILE',
        category: 'duplicate',
        message: superseded
          ? 'This PRELESSON_ONLY row is superseded by a FULL row for the same student, lesson, batch and date.'
          : 'Duplicate release row in the same CSV; only the first matching row will be processed.',
        action: null
      });
    }
  }
}

async function existingPrelesson(env, row) {
  return env.DB.prepare(
    `SELECT lesson_id, batch_key, lesson_date
     FROM online_prelesson_entitlements
     WHERE portal_user_id_norm = ? AND lesson_id = ? AND batch_key = ?`
  ).bind(row.portalUserIdNorm, row.lessonId, row.batchKey).first();
}

function normaliseCsvSubject(value) {
  const text = clean(value).toLowerCase();
  if (text === 'maths' || text === 'math') return 'maths';
  if (text === 'english') return 'english';
  return '';
}

async function validateRowAgainstPortal(env, row) {
  if (row.category === 'error' || row.category === 'skipped' || row.category === 'duplicate') return row;

  const probe = await processPhase13Item(env, {
    syncRowId: row.syncRowId,
    operation: 'status_check',
    portalUserId: row.portalUserId,
    lessonId: row.lessonId,
    batchKey: row.batchKey,
    lessonDate: row.lessonDate
  });

  if (probe.status === 'BLOCKED') {
    Object.assign(row, { status: 'BLOCKED', category: 'error', message: 'This lesson is blocked for the student.', action: null });
    return row;
  }
  if (!VALID_PROBE_STATUSES.has(probe.status)) {
    Object.assign(row, {
      status: probe.status || 'VALIDATION_ERROR',
      category: 'error',
      message: probe.message || 'Portal validation failed.',
      action: null
    });
    return row;
  }

  const lesson = await env.LESSONS_KV.get(`lesson:${row.lessonId}`, { type: 'json' });
  const portalSubject = clean(lesson?.subject).toLowerCase();
  const csvSubject = normaliseCsvSubject(row.csvSubject);
  if (csvSubject && portalSubject && csvSubject !== portalSubject) {
    Object.assign(row, {
      status: 'CSV_SUBJECT_MISMATCH',
      category: 'error',
      message: `CSV subject ${row.csvSubject} does not match Portal lesson subject ${portalSubject}.`,
      action: null
    });
    return row;
  }

  const prelesson = await existingPrelesson(env, row);
  const fullExists = probe.status === 'CONFIRMED' || probe.status === 'BATCH_RELEASE_MISSING';

  if (row.releaseType === 'FULL') {
    if (probe.status === 'CONFIRMED') {
      Object.assign(row, { status: 'ALREADY_FULL', category: 'no-op', message: 'Full lesson access is already confirmed.', action: null });
    } else if (probe.status === 'BATCH_RELEASE_MISSING') {
      Object.assign(row, {
        status: 'READY_REPAIR_BATCH_RELEASE', category: 'ready',
        message: 'Full access already exists, but the batch release record is missing and will be repaired.', action: 'FULL'
      });
    } else if (prelesson) {
      Object.assign(row, {
        status: 'WILL_UPGRADE_TO_FULL', category: 'ready',
        message: 'PreLesson-only access exists and will be upgraded to full access.', action: 'FULL'
      });
    } else {
      Object.assign(row, { status: 'READY_FULL', category: 'ready', message: 'Ready to grant full lesson access.', action: 'FULL' });
    }
    return row;
  }

  if (row.releaseType === 'PRELESSON_ONLY') {
    if (fullExists) {
      Object.assign(row, {
        status: 'ALREADY_FULL', category: 'no-op',
        message: 'Full access already exists; PRELESSON_ONLY will not downgrade it.', action: null
      });
    } else if (prelesson) {
      Object.assign(row, { status: 'ALREADY_PRELESSON', category: 'no-op', message: 'PreLesson-only access already exists.', action: null });
    } else {
      Object.assign(row, {
        status: 'READY_PRELESSON', category: 'ready',
        message: 'Ready to grant PreLesson Sheets only; video, Homework and Answer Packs remain locked.', action: 'PRELESSON_ONLY'
      });
    }
    return row;
  }

  Object.assign(row, { status: 'INVALID_RELEASE_TYPE', category: 'error', message: 'Release type could not be determined.', action: null });
  return row;
}

function previewSummary(rows) {
  return {
    total: rows.length,
    ready: rows.filter(row => row.category === 'ready').length,
    noOp: rows.filter(row => row.category === 'no-op').length,
    skipped: rows.filter(row => row.category === 'skipped').length,
    duplicates: rows.filter(row => row.category === 'duplicate').length,
    errors: rows.filter(row => row.category === 'error').length
  };
}

async function buildPreview(env, csvText, filename = '') {
  const digest = await sha256Hex(csvText);
  const normalised = await normaliseCsvRows(env, csvText);
  if (normalised.error) return { error: normalised.error, message: normalised.message };
  const rows = normalised.rows;
  markFileDuplicates(rows);
  for (const row of rows) await validateRowAgainstPortal(env, row);
  return {
    ok: true,
    filename: clean(filename),
    digest,
    rows,
    publicRows: rows.map(publicRow),
    summary: previewSummary(rows)
  };
}

export {
  sha256Hex,
  publicRow,
  normaliseCsvRows,
  markFileDuplicates,
  validateRowAgainstPortal,
  buildPreview
};
