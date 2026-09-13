# Portal V2 Performance Rebuild — Checkpoint 4

## Dual-Write / Compatibility Period

Production V2 remains authoritative throughout Checkpoint 4. The rebuild is still shadow-only: no student read path is cut over and no existing production entitlement is replaced by a rebuild value.

## Compatibility rule

For a release or other access-changing operation during the compatibility period:

1. Apply the existing/legacy V2 mutation first.
2. Treat the resulting legacy V2 state as the authoritative truth.
3. Reload that post-write truth.
4. Compile the rebuild access read model from the post-write truth.
5. Publish the rebuild model atomically using the Checkpoint 3 immutable-version/current-pointer protocol.
6. Record the shadow outcome for reconciliation.

If the legacy write fails, no rebuild publication is attempted.

If the legacy write succeeds but rebuild compilation/publication fails, the successful legacy operation is **not** rolled back. The rebuild pointer remains on the previous complete model and the operation is recorded as `RECONCILE_REQUIRED`. A later successful rebuild from authoritative legacy state may repair that drift and mark pending reconciliation rows `SYNCED`.

This asymmetry is intentional: during Checkpoint 4, legacy V2 is the source of truth and the rebuild is a compatibility shadow.

## Required release semantics retained

The current production CSV normaliser remains authoritative and is regression-tested directly from `worker/src/admin-lesson-release-import.js`:

- `Completed` → full release;
- `Continuing` → full release;
- `Continue` → full release;
- non-completed Face2Face row → no release;
- non-completed Online row → PreLesson-only release.

The compatibility compiler also covers manual access present in the current user model and preserves blocked overrides.

## Privacy boundary

Per-user rebuild keys use an opaque HMAC-derived scope ID. Raw Portal User IDs are not stored in rebuild read-model KV keys or payloads. Checkpoint 4 staging uses a fixed synthetic test user only; it does not read or copy real pupil records.

## Isolated staging proof

Checkpoint 4 staging uses:

- the existing dedicated rebuild read-model KV namespace;
- a dedicated compatibility D1 database created only for rebuild staging;
- the isolated `fpt-portal-v2-rebuild-adminops-staging` Worker;
- a fixed synthetic user and synthetic batch;
- catalogue metadata compiled read-only from the current production `LESSONS_KV`.

The staging Admin/Operations Worker must have **no** production `STUDENTS_KV`, production D1, R2 or email binding. The only D1 binding is the dedicated compatibility database.

The deployed acceptance harness proves:

1. a legacy full release is visible in the legacy compatibility tables;
2. the same release is visible as `core: true` in the compiled shadow access model;
3. a repeated/idempotent release does not create a semantically different shadow model;
4. a deliberately failed shadow publication leaves the previous pointer unchanged while retaining the successful legacy release;
5. the failure is recorded for reconciliation;
6. a later successful rebuild from the legacy truth repairs the shadow and clears pending reconciliation;
7. production Worker deployment/version remain unchanged during the staging gate.

## No destructive migration

Checkpoint 4 uses additive `CREATE TABLE IF NOT EXISTS` staging schema only. It contains no `DROP`, destructive `ALTER`, production data migration or production route repoint.

## Production activation boundary

The synthetic staging gate proves the dual-write compatibility mechanism without risking pupil entitlements. A production shadow hook, if activated as part of this checkpoint, must remain additive and observational from the student portal's perspective:

- legacy V2 mutations remain authoritative;
- student reads continue to use legacy V2;
- shadow failures do not change the legacy response or access state;
- no real pupil mutation is manufactured merely for testing;
- existing production rollback anchors remain valid.

Checkpoint 5 must not start until Checkpoint 4's compatibility gate has passed and the exact production activation state is recorded.
