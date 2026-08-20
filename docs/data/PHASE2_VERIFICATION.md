# Phase 2 Verification — COMPLETE

Updated: 20 August 2026

## Checkpoint

Phase 2 required one dummy student record, one dummy lesson record and one D1 entitlement to be read correctly by the Worker.

Result: **PASSED**.

## Verified resources

### Students KV

Namespace: `FPT_PORTAL_V2_STUDENTS`

Key: `student:test0101`

Verified values include:

- Portal User ID: `Test0101`
- School year: `5`
- VR eligible: `false`
- Account status: `active`
- Batch: `Y5MF1`

Passwords exist in the private KV record but are deliberately excluded from diagnostic output.

### Lessons KV

Namespace: `FPT_PORTAL_V2_LESSONS`

Lesson key: `lesson:DEV-M01`

View key: `view:maths-year5-dev`

Verified lesson:

- Lesson ID: `DEV-M01`
- Title: `Development Test Lesson`
- Subject: `maths`
- Active: `true`

Verified view:

- View ID: `maths-year5-dev`
- Lesson IDs: `["DEV-M01"]`

### D1

Database: `fpt_portal_v2_db`

Table: `lesson_entitlements`

Verified entitlement:

- `portal_user_id_norm = test0101`
- `lesson_id = DEV-M01`
- `core_access = 1`
- `vr_access = 0`
- `source = excel`
- `first_granted_at = 2026-08-20T19:40:00Z`
- `last_confirmed_at = 2026-08-20T20:40:00Z`
- `source_batch_code = Y5MF1`
- `source_lesson_date = 2026-08-20`

## Worker diagnostic

Route:

`GET /api/dev/phase2`

Verified response characteristics:

- HTTP 200
- `ok: true`
- `phase: 2`
- `dataFoundationHealthy: true`
- student found
- lesson found
- view found
- D1 readable
- D1 test entitlement found
- `coreAccess: true`
- `vrAccess: false`
- `source: excel`

## Idempotency proof

The same `(student, lesson)` entitlement was upserted twice.

After the second execution:

- row count remained `1`;
- `first_granted_at` remained unchanged;
- `last_confirmed_at` advanced from `2026-08-20T19:40:00Z` to `2026-08-20T20:40:00Z`.

This proves the required duplicate-confirmation behaviour for the later Excel sync foundation.

## Stop/Go decision

**GO to Phase 3.**

No real students or real catalogue have been loaded. Normal student login remains disabled. The existing live portal remains untouched.
