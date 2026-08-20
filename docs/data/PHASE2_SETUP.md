# Phase 2 — Data Foundation Setup

**Status: COMPLETE — verified 20 August 2026.**

## 1. D1

Database: `fpt_portal_v2_db`

Applied migration:

`worker/migrations/0001_lesson_entitlements.sql`

Created:

- table `lesson_entitlements`;
- index `idx_lesson_entitlements_lesson_id`.

## 2. Students KV dummy record

Namespace: `FPT_PORTAL_V2_STUDENTS`

Key:

`student:test0101`

Value source:

`examples/phase2/student-test0101.json`

Status: created and Worker-read verified.

## 3. Lessons KV dummy lesson

Namespace: `FPT_PORTAL_V2_LESSONS`

Key:

`lesson:DEV-M01`

Value source:

`examples/phase2/lesson-DEV-M01.json`

Status: created and Worker-read verified.

## 4. Lessons KV dummy view

Namespace: `FPT_PORTAL_V2_LESSONS`

Key:

`view:maths-year5-dev`

Value source:

`examples/phase2/view-maths-year5-dev.json`

Status: created and Worker-read verified.

## 5. Dummy D1 entitlement

Created test entitlement:

`test0101 + DEV-M01`

Verified through the Worker with core access true, VR access false and source `excel`.

## 6. Idempotency

The same Student + Lesson upsert was executed twice.

Verified:

- row count remained 1;
- first-granted timestamp remained unchanged;
- last-confirmed timestamp updated.

## 7. Worker diagnostic

Route:

`GET /api/dev/phase2`

Verified result:

`dataFoundationHealthy: true`

Full evidence is recorded in:

`docs/data/PHASE2_VERIFICATION.md`

## 8. Real data remains deferred

Phase 2 used dummy/test data only. The existing live portal remains untouched and normal student login remains disabled.

## 9. Next checkpoint

Proceed to Phase 3: get one complete Maths lesson working end-to-end from the V2 data model before loading the full catalogue.
