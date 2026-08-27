# Phase 13 — Excel entitlement sync

Status: controlled development implementation and copied-workbook acceptance complete. Phase 13 remains a development-only integration; this is not a production cutover.

Phase 13 adds the narrow `SyncPortalEntitlements` path from the 2026–27 owner workbook to the isolated V2 development Worker and D1.

## Workbook adapter contract

The current owner workbook was inspected before implementation and its existing Live column semantics were reconciled explicitly with the Phase 13 portal contract. The approved adapter keeps `Live!C` as Year/stream and repurposes two columns that are no longer required by the new workflow:

- `E` — lesson text beginning with the immutable Lesson ID; also the workflow colour cell.
- `G` — lesson date.
- `J` — must equal exactly `Completed`.
- `N` — exact portal Batch ID for this source row.
- `O` — class time remains available as workbook context but is not entitlement timing.
- `Q` — immutable Portal User ID / Username.
- hidden `T` — stable Sync Row ID managed by the Phase 13 VBA adapter.

The one-time workbook setup derives N/Q only from the workbook's existing authoritative membership data where an exact membership match is possible. It must not invent a Batch ID or Portal User ID. Once valid N/Q values exist on a row they remain stable source fields; a later lesson-date move does not re-infer membership merely because weekday/time changed.

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
2. verifies the exact active Lesson ID exists in V2;
3. verifies the exact Batch ID exists in `batch_definitions`;
4. verifies batch subject matches lesson subject;
5. verifies the batch is active on the lesson date;
6. verifies an effective-dated `student_batch_assignments` row covers the student, exact batch and lesson date;
7. only after that source context is valid, respects an existing direct `blockedLessons` suppression.

This ordering means a stale blocked-list value cannot make an invalid Lesson/Batch/source row appear as a valid red blocked row.

Excel never creates, changes or infers batch membership.

`Student + Lesson` remains the permanent idempotent entitlement identity in `lesson_entitlements`. A duplicate grant confirms the existing row and does not create duplicate access. Existing VR access is not upgraded on a duplicate; a first English 11+ earn receives VR only when the student is VR-eligible and the exact batch is an 11+ English batch.

`Batch + Lesson` remains a separate operational release mapping in `batch_lesson_releases`. Sync Row ID is audit context only and never becomes entitlement identity.

`status_check` is read-only. It confirms that both the direct Student + Lesson entitlement and the exact Batch + Lesson release mapping exist; otherwise the workbook treats the row as not currently confirmed.

## Workbook ledger and colour semantics

The private workbook adapter maintains a separate Very Hidden Phase 13 ledger keyed by Sync Row ID. The successful fingerprint is the current Portal User ID + Lesson ID; Batch ID and lesson date are retained as successful context.

- confirmed/created = light green lesson cell;
- direct manually blocked = red lesson cell;
- not exactly `Completed`, local validation failures, API failures and unconfirmed results = uncoloured;
- an unchanged previously green row uses the lightweight read-only `status_check` path;
- changing Student or Lesson makes the current row a new unprocessed context and never revokes the previously earned entitlement;
- copied duplicate Sync Row IDs are repaired on first encounter so each source row has its own stable audit identity;
- a transport/runtime failure after send clears workflow colour for queued rows rather than leaving stale green confirmation.

## Controlled acceptance completed

A copied workbook and reserved isolated TestY fixture proved the full Excel → Worker → D1 path before any operational teaching-day use. Acceptance covered:

- first selected `Completed` grant → green row and one Student+Lesson entitlement plus one Batch+Lesson release;
- unchanged repeat → confirmed/idempotent with no duplicate rows;
- moved lesson date → same earned Student+Lesson retained while operational release context updates correctly;
- late-added second lesson → independent new entitlement/release without disturbing the first lesson;
- assignment/effective-date rejection → failed/unconfirmed and uncoloured without mutation;
- invalid student/source attempt → independent failure and no entitlement creation;
- direct manual block → red row without entitlement mutation;
- removal of that temporary block → rerun confirms the already-earned entitlement and returns the row to green;
- normal student login stayed disabled throughout.

After acceptance, the reserved TestY D1 fixture was removed under exact development-only guards. The isolated D1 baseline was restored to 632 total lesson entitlements, 4 batch definitions, 4 assignments and 0 batch lesson releases, with the reserved TestY Y5E10/Y5E11 fixture rows absent and database `quick_check` clean. Temporary acceptance workflows were then removed from the PR.

## Safety boundary

- Target is the isolated V2 development Worker only.
- Existing live portal, DNS/CNAME/routes and production services are unchanged.
- The locked 369/11 catalogue is not rewritten.
- Legacy `FPT_LESSONS_TEST` is not rebound.
- Excel sync does not modify membership.
- The Phase 13 Worker/API contains no entitlement deletion or revocation path.
- Reserved TestY acceptance data was cleaned only by an explicit temporary development-only test workflow after preflight had proved those fixture entitlements did not exist before the test.
- Normal student login remains disabled.
- Single-device sessions, 2-hour inactivity, protected answers, 11+ quiz/VR and special-content gates remain delegated to the accepted Phase 12 / Phase 11 stack.

## Phase 13 closure

The implementation, guarded isolated Worker deployment, copied-workbook compile/save/reopen gate, controlled end-to-end entitlement sync, colour/ledger behaviour, assignment guard, repeat/idempotency, date-change, late-added lesson, blocked/unblocked behaviour and exact fixture cleanup have all been proved. Phase 13 is therefore ready to merge as complete, with no production cutover and no Phase 14 work included.
