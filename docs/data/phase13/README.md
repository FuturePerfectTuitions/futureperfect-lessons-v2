# Phase 13 — Excel entitlement sync

Status: implementation branch / controlled development proof pending.

Phase 13 adds the narrow `SyncPortalEntitlements` path from the 2026–27 owner workbook to the isolated V2 development Worker and D1. It is not a production cutover.

## Workbook adapter contract

The current owner workbook was inspected before implementation and its existing Live column semantics were reconciled explicitly with the Phase 13 portal contract. The approved adapter keeps `Live!C` as Year/stream and repurposes two columns that are no longer required by the new workflow:

- `E` — lesson text beginning with the immutable Lesson ID; also the workflow colour cell.
- `G` — lesson date.
- `J` — must equal exactly `Completed`.
- `N` — exact portal Batch ID for this source row.
- `O` — class time remains available as workbook context but is not entitlement timing.
- `Q` — immutable Portal User ID / Username.
- hidden `T` — stable Sync Row ID managed by the Phase 13 VBA adapter.

The one-time workbook setup derives N/Q only from the workbook's existing authoritative membership data where an exact membership match is possible. It must not invent a Batch ID or Portal User ID.

`SyncPortalEntitlements` is manual and selected rows only. It never scans all historical Completed rows.

## Worker contract

Development-only endpoint:

`POST /api/v1/admin/excel-entitlements/sync`

Authentication uses a dedicated `EXCEL_SYNC_TOKEN` Worker secret sent as a bearer token. The secret value is never committed, logged, stored in workbook cells or stored in VBA source. Browser-origin requests are rejected.

The request contains one global `items` array. Each item contains:

- `syncRowId`
- `operation`: `grant` or `status_check`
- `portalUserId`
- `lessonId`
- `batchKey`
- `lessonDate`

Items are processed independently so one invalid row cannot block other valid selected rows.

## Validation and data semantics

For every item the Worker:

1. verifies the V2 student exists;
2. respects an existing direct `blockedLessons` suppression;
3. verifies the exact active Lesson ID exists in V2;
4. verifies the exact Batch ID exists in `batch_definitions`;
5. verifies batch subject matches lesson subject;
6. verifies the batch is active on the lesson date;
7. verifies an effective-dated `student_batch_assignments` row covers the student, exact batch and lesson date.

Excel never creates, changes or infers batch membership.

`Student + Lesson` remains the permanent idempotent entitlement identity in `lesson_entitlements`. A duplicate grant confirms the existing row and does not create duplicate access. Existing VR access is not upgraded on a duplicate; a first English 11+ earn receives VR only when the student is VR-eligible and the exact batch is an 11+ English batch.

`Batch + Lesson` remains a separate operational release mapping in `batch_lesson_releases`. Sync Row ID is audit context only and never becomes entitlement identity.

`status_check` is read-only. It confirms that both the direct Student + Lesson entitlement and the exact Batch + Lesson release mapping exist; otherwise the workbook must treat the row as not currently confirmed.

## Safety boundary

- Target is the isolated V2 development Worker only.
- Existing live portal, DNS/CNAME/routes and production services are unchanged.
- The locked 369/11 catalogue is not rewritten.
- Legacy `FPT_LESSONS_TEST` is not rebound.
- Excel sync does not modify membership.
- No direct entitlement is deleted by Phase 13.
- Normal student login remains disabled.
- Single-device sessions, 2-hour inactivity, protected answers, 11+ quiz/VR and special-content gates remain delegated to the accepted Phase 12 / Phase 11 stack.

## Closure gate

Phase 13 remains open until a controlled copied-workbook selection proves the full Excel → Worker → D1 path, including successful green row state, blocked red state where applicable, failed/skipped uncoloured state, repeat/idempotency, correct ledger/fingerprint behaviour and unchanged Phase 12 safety invariants. The first real teaching-day run must not be the first integration test.
