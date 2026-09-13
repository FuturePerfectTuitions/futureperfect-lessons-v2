const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();

async function resolvePendingReconciliationD1(db, options = {}) {
  const user = norm(options.portalUserIdNorm);
  const shadowScope = clean(options.shadowScope);
  const shadowVersion = clean(options.shadowVersion);
  const shadowSha256 = clean(options.shadowSha256);
  const repairedBy = clean(options.operationId || 'compatibility-reconcile');
  if (!user || !shadowScope || !shadowVersion || !shadowSha256) {
    throw new Error('Reconciliation repair requires user and verified shadow identity.');
  }
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE rebuild_shadow_reconciliation
    SET status = 'SYNCED',
        shadow_scope = ?,
        shadow_version = ?,
        shadow_sha256 = ?,
        error_message = ?,
        last_updated_at = ?
    WHERE portal_user_id_norm = ? AND status = 'RECONCILE_REQUIRED'`)
    .bind(
      shadowScope,
      shadowVersion,
      shadowSha256,
      `reconciled by ${repairedBy}`.slice(0, 500),
      now,
      user
    ).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export { resolvePendingReconciliationD1 };
