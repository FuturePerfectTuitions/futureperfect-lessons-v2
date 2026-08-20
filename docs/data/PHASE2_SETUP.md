# Phase 2 — Data Foundation Setup

## 1. D1

Open Cloudflare D1 database `fpt_portal_v2_db` → Console and execute the complete contents of:

`worker/migrations/0001_lesson_entitlements.sql`

Expected result: table `lesson_entitlements` plus index `idx_lesson_entitlements_lesson_id`.

## 2. Students KV dummy record

Namespace: `FPT_PORTAL_V2_STUDENTS`

Key:

`student:test0101`

Value: exact contents of:

`examples/phase2/student-test0101.json`

## 3. Lessons KV dummy lesson

Namespace: `FPT_PORTAL_V2_LESSONS`

Key:

`lesson:DEV-M01`

Value: exact contents of:

`examples/phase2/lesson-DEV-M01.json`

## 4. Lessons KV dummy view

Namespace: `FPT_PORTAL_V2_LESSONS`

Key:

`view:maths-year5-dev`

Value: exact contents of:

`examples/phase2/view-maths-year5-dev.json`

## 5. Do not add real data yet

Phase 2 uses dummy/test data only. The existing live portal remains untouched.

## 6. Next code checkpoint

After the three dummy KV records and D1 table exist, update the Worker with Phase 2 diagnostic routes that read:

- the dummy student;
- the dummy lesson;
- the dummy view;
- the D1 entitlement table.

Then verify all four from the GitHub Pages development site/Worker before proceeding to the complete one-lesson end-to-end build.
