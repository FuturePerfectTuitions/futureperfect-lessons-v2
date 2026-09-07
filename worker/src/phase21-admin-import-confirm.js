import { processSyncItem } from './index-phase18-online-prelesson.js';
import { clean } from './phase21-admin-import-core.js';
import { buildPreview, publicRow } from './phase21-admin-import-preview.js';

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function timingSafeTextEqual(left, right) {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function confirmationStatus(row, result) {
  if (!row.action) {
    if (row.category === 'error') return { status: 'NOT_IMPORTED', ok: false, message: row.message };
    if (row.category === 'skipped') return { status: 'SKIPPED', ok: true, message: row.message };
    if (row.category === 'duplicate') return { status: 'DUPLICATE_SKIPPED', ok: true, message: row.message };
    return { status: 'NO_CHANGE', ok: true, message: row.message };
  }
  if (!result?.ok) {
    return { status: result?.status || 'IMPORT_FAILED', ok: false, message: result?.message || 'Portal import failed.' };
  }
  if (row.action === 'FULL') {
    return {
      status: row.status === 'WILL_UPGRADE_TO_FULL' ? 'UPGRADED_TO_FULL' : 'FULL_CONFIRMED',
      ok: true,
      message: row.status === 'WILL_UPGRADE_TO_FULL'
        ? 'PreLesson-only access upgraded to full access.'
        : 'Full access confirmed.'
    };
  }
  if (result?.accessMode === 'full') {
    return { status: 'ALREADY_FULL_AT_CONFIRM', ok: true, message: 'Full access already exists; no PreLesson-only downgrade was made.' };
  }
  return { status: 'PRELESSON_CONFIRMED', ok: true, message: 'PreLesson-only access confirmed.' };
}

async function confirmImport(env, csvText, digest, filename = '') {
  const preview = await buildPreview(env, csvText, filename);
  if (preview.error) return { error: preview.error, message: preview.message, status: 400 };
  if (!(await timingSafeTextEqual(preview.digest, clean(digest)))) {
    return { error: 'CSV_CHANGED_SINCE_PREVIEW', message: 'The CSV no longer matches the preview.', status: 409 };
  }

  const results = [];
  for (const row of preview.rows) {
    let portalResult = null;
    if (row.action) {
      portalResult = await processSyncItem(env, {
        syncRowId: row.syncRowId,
        operation: row.action === 'FULL' ? 'grant' : 'prelesson_grant',
        portalUserId: row.portalUserId,
        lessonId: row.lessonId,
        batchKey: row.batchKey,
        lessonDate: row.lessonDate
      });
    }
    const outcome = confirmationStatus(row, portalResult);
    results.push({ ...publicRow(row), importStatus: outcome.status, ok: outcome.ok, importMessage: outcome.message });
  }

  const full = results.filter(row => ['FULL_CONFIRMED', 'UPGRADED_TO_FULL'].includes(row.importStatus)).length;
  const prelesson = results.filter(row => row.importStatus === 'PRELESSON_CONFIRMED').length;
  const summary = {
    total: results.length,
    succeeded: results.filter(row => row.ok).length,
    failed: results.filter(row => !row.ok).length,
    changed: full + prelesson,
    full,
    prelesson,
    noChange: results.filter(row => ['NO_CHANGE', 'SKIPPED', 'DUPLICATE_SKIPPED', 'ALREADY_FULL_AT_CONFIRM'].includes(row.importStatus)).length
  };
  return { ok: true, digest: preview.digest, results, summary };
}

export { timingSafeTextEqual, confirmationStatus, confirmImport };
