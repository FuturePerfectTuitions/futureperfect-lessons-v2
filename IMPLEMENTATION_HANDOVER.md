# FPT Portal V2 — Implementation Handover & Build State

**Cumulative version:** 3.0  
**Updated:** 20 August 2026  
**Completed through:** Phase 3 — Get One Complete Maths Lesson Working End-to-End

## Authority

Use this file together with:

1. `FPT Portal V2 Master Authoritative Specification` — business/workflow authority.
2. `FPT Portal V2 — Steps to Progression` — build-sequence authority.
3. This file — actual implementation state.

If implementation differs from an older technical suggestion, this file records what has actually been built. Business-rule changes must still be reflected in the Master Specification first.

## Permanent Workflow Change-Control Rule

Whenever Sej changes a workflow, business rule or operating decision:

1. update/version the Master Authoritative Specification first;
2. inspect the latest cumulative handover and the actual GitHub/Cloudflare implementation;
3. update Steps to Progression if phase order/checkpoints/testing change;
4. implement only the required coherent technical changes;
5. demonstrate the changed workflow and relevant regressions;
6. update this cumulative Implementation Handover last.

Do not allow documentation and the deployed system to drift apart.

## Overall status

### Phase 1 — COMPLETE

The isolated V2 development environment is operational and separate from the live portal.

Verified chain:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

`GET /api/health` returns `HTTP 200`, `infrastructureHealthy: true`, and all four bindings report healthy.

### Phase 2 — COMPLETE

The V2 data foundation has been implemented and tested with dummy data.

Verified:

- Student KV format/key convention.
- Lesson/View/Library KV format/key conventions.
- D1 `lesson_entitlements` table and index.
- Dummy student `student:test0101`.
- Dummy lesson `lesson:DEV-M01`.
- Dummy view `view:maths-year5-dev`.
- D1 duplicate Student + Lesson confirmation is idempotent.

### Phase 3 — COMPLETE

One complete real-shaped Maths lesson now works end-to-end for the development student.

Verified journey:

`Subjects → Maths → Year 5 → Y5M1 → PreLesson → ScreenPal video → Homework → password-protected Answer Pack`

The lesson page and navigation are data-driven from KV/D1/R2 rather than a hard-coded lesson-specific page.

Normal student login remains disabled.

## GitHub

- Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`
- Default branch: `main`
- Development frontend: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`
- Phase 3 page: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`
- No production `CNAME` configured.
- Existing live portal repository remains separate and untouched.

### Important repo files

- `index.html` — development/status page.
- `phase3.html` — Phase 3 data-driven lesson proof.
- `assets/styles.css` — FPT visual shell/shared styles.
- `assets/phase3.js` — Phase 3 navigation/resource/protected-viewer logic.
- `assets/phase3-viewer.css` — protected PDF page-viewer styles.
- `config.js` — V2 Worker base URL.
- `worker/src/index.js` — canonical V2 Worker source.
- `worker/migrations/0001_lesson_entitlements.sql` — applied D1 schema.
- `docs/data/STUDENT_KV_FORMAT.md`
- `docs/data/LESSON_KV_FORMAT.md`
- `docs/data/PHASE2_SETUP.md`
- `docs/data/PHASE2_VERIFICATION.md`
- `docs/data/PHASE3_VERIFICATION.md`
- `examples/phase2/*`
- `examples/phase3/lesson-Y5M1.json`
- `examples/phase3/view-maths-year5.json`
- `README.md`
- `IMPLEMENTATION_HANDOVER.md`

## Cloudflare Worker

- Worker name: `fpt-portal-v2-worker`
- Worker URL: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`
- Environment: `development`
- Student login enabled: `false`

### Current routes

- `GET /api/health` — infrastructure health.
- `GET /api/dev/phase2` — Phase 2 diagnostic.
- `GET /api/dev/phase3` — builds the development student's current Maths portal data and confirms R2 resource presence.
- `GET /api/dev/phase3/resource?resourceId=...` — serves entitled unprotected Phase 3 PDFs from private R2.
- `POST /api/dev/phase3/answer` — validates the development student's Answer Pack password and returns the entitled protected PDF.
- Other `/api/*` routes return `501 NOT_IMPLEMENTED`.

### Environment variables

- `ENVIRONMENT = development`
- `ALLOWED_ORIGINS = https://futureperfecttuitions.github.io`

## Cloudflare bindings

| Worker binding | Cloudflare resource | Purpose |
|---|---|---|
| `STUDENTS_KV` | `FPT_PORTAL_V2_STUDENTS` | Manually maintained student/config records |
| `LESSONS_KV` | `FPT_PORTAL_V2_LESSONS` | Lesson catalogue/views/libraries |
| `DB` | `fpt_portal_v2_db` | Direct Student + Lesson entitlements |
| `MATERIALS_R2` | `fpt-materials-dev` | Development PreLesson/Homework/Answer files |

## Student KV model currently implemented

Canonical key:

`student:<portal-user-id-lowercase>`

Dummy development key:

`student:test0101`

Fields currently include:

- `schemaVersion`
- `portalUserId`
- `firstName`
- `loginPassword`
- `answerPassword`
- `schoolYear`
- `vrEligible`
- `accountStatus`
- `expiresOn`
- `batches`
- `fullLibraries`
- `manualLessonAccess`
- `specialAccess`

Excel-earned lesson entitlements are not stored inside Student KV.

## Lessons KV model currently implemented

Key families:

- `lesson:<LESSON_ID>` — canonical lesson metadata/resources.
- `view:<VIEW_ID>` — ordered student-facing Year/Level catalogue.
- `library:<LIBRARY_ID>` — continuing Full Library definition.

The implemented R2 path convention is lowercase subject + compact year + term + Lesson ID, e.g.:

`maths/Y5/Autumn/Y5M1/...`

Terms are R2 organisation only and do not create student navigation sections.

## D1 state

Database: `fpt_portal_v2_db`  
Database ID: `97250a54-fa91-45ad-a002-3c4566b1fc38`

Table: `lesson_entitlements`

Primary key:

`(portal_user_id_norm, lesson_id)`

Fields:

- `portal_user_id_norm`
- `lesson_id`
- `core_access`
- `vr_access`
- `source`
- `first_granted_at`
- `last_confirmed_at`
- `source_batch_code`
- `source_lesson_date`

The `source` constraint is currently `excel`; broader source modelling is deferred until the relevant phase.

### Current development rows for Test0101

- `test0101 + DEV-M01`
- `test0101 + Y5M1`

Both have core access; VR access is false.

## Phase 2 idempotency proof

The same Student + Lesson upsert was executed twice for `DEV-M01`.

Verified:

- row count remained 1;
- first-granted timestamp stayed unchanged;
- last-confirmed timestamp updated.

This is the foundation for the later Excel sync workflow.

# Phase 3 implementation detail

## Proof lesson

- Lesson ID: `Y5M1`
- Title: `Y5M1 Number and Place Value I`
- Lesson KV: `lesson:Y5M1`
- View KV: `view:maths-year5`
- ScreenPal reference: `cOV0omn3XVh`
- Development student: `Test0101`
- D1 entitlement: `test0101 + Y5M1`

## Exact Phase 3 R2 resources

Bucket: `fpt-materials-dev`

- PreLesson: `maths/Y5/Autumn/Y5M1/PreLesson/PreLesson Sheet Y5M1 Number and Place Value I.pdf`
- Homework: `maths/Y5/Autumn/Y5M1/Homework/Homework L2T1M01 Number and Place Value I.pdf`
- Answer Pack: `maths/Y5/Autumn/Y5M1/Answers/Answer Pack Homework L2T1M01 Number and Place Value I.pdf`

Public R2 access remains disabled.

The physical Homework/Answer filenames use the source-curriculum code `L2T1M01`, while the canonical portal lesson is `Y5M1`. This is valid because exact R2 object keys are explicitly stored in the lesson record and are independent of the immutable Portal Lesson ID.

## Phase 3 backend verification

Observed from `GET /api/dev/phase3`:

- `ok: true`
- `phase: 3`
- `phase3Healthy: true`
- `studentFound: true`
- `viewFound: true`
- Y5M1 entitlement found through D1
- PreLesson `available: true`
- Homework `available: true`
- Answer Pack `available: true`
- Answer Pack `passwordRequired: true`
- ScreenPal `cOV0omn3XVh`

## Phase 3 student-facing verification

Verified manually:

1. Subject screen shows Maths and disabled Phase-3 English placeholder.
2. Maths opens Year 5.
3. Year 5 shows exactly one released lesson, Y5M1.
4. Y5M1 lesson page displays title/description/resources from data.
5. PreLesson opens correctly through the Worker from private R2.
6. ScreenPal video embeds correctly.
7. Homework opens correctly through the Worker from private R2.
8. Answer Pack requires password.
9. Wrong Answer Pack password is rejected.
10. Show/hide eye works.
11. Correct Answer Pack password opens the actual pages.
12. Protected Answer Pack uses a custom PDF.js page renderer with no ordinary browser PDF toolbar.
13. On-screen watermark `Test0101 — Future Perfect Tuitions` is displayed.
14. Closing/reopening the protected resource returns to the password prompt.

## Protected viewer implementation note

The first Phase 3 implementation used a browser PDF iframe. Chrome displayed an intermediate PDF/Open surface, which did not meet the intended protected-view experience. It was replaced with a PDF.js canvas/page renderer during Phase 3.

This hides ordinary PDF download/print controls. It does not claim absolute anti-copy protection; screenshots and advanced browser inspection cannot be fully prevented on the web.

## Phase 3 security limitation

Phase 3 intentionally uses a fixed development student and development-only routes. It proves the lesson/resource architecture only.

It is **not** the final authentication/session model. Production-grade authentication and session enforcement are Phase 4.

## Entitlement source rule retained

Effective lesson access will ultimately be the union of separate sources:

1. Excel-earned D1 direct entitlement.
2. Manual Student KV lesson access.
3. Applicable continuing Full Library access.

One source must not silently overwrite or destroy another.

## Deliberate non-actions through Phase 3

- No live-domain switch.
- No CNAME on V2.
- No changes to the existing live portal/Worker/KVs.
- No real student population enabled.
- No real catalogue import.
- No production student authentication/session system yet.
- No Excel/VBA sync endpoint yet.
- No Admin console.
- No English/VR production implementation yet.

## Manual Worker deployment rule

Canonical Worker source is committed in GitHub at `worker/src/index.js`, but Worker deployment is currently manual through the Cloudflare code editor. Whenever Worker code changes, provide the complete latest `index.js` for copy/paste until/if Worker deployment is later automated.

# Next incomplete phase

## Phase 4 — Build Secure Student Authentication

Purpose: replace the fixed development-student mechanism with real student username/password authentication and secure sessions before expanding the portal further.

Phase 4 must preserve the proven Phase 3 lesson journey while introducing the agreed student-login rules, including case-insensitive fixed usernames, 4-character login passwords, no Remember Me, multi-device use, 2-hour inactivity timeout, protected-resource invalidation when the main session expires, and globally locked behaviour for expired/withdrawn accounts.

Checkpoint: a test student can authenticate securely, obtain a valid session, access only their own entitled lesson journey, and loses protected access when the session is invalid/expired. Normal real-student access must remain disabled until this phase is deliberately verified and switched on.