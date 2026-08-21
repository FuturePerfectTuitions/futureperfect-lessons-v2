# FPT Portal V2 — Implementation Handover & Build State

**Cumulative version:** 3.2  
**Updated:** 21 August 2026  
**Completed through:** Phase 4 — Build Secure Student Authentication

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

# Overall status

## Phase 1 — COMPLETE

The isolated V2 development environment is operational and separate from the live portal.

Verified chain:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

`GET /api/health` returns `HTTP 200`, `infrastructureHealthy: true`, and all four bindings report healthy.

## Phase 2 — COMPLETE

The V2 data foundation has been implemented and tested with dummy data.

Verified:

- Student KV format/key convention.
- Lesson/View/Library KV format/key conventions.
- D1 `lesson_entitlements` table and index.
- Dummy student `student:test0101`.
- Dummy lesson `lesson:DEV-M01`.
- Dummy view `view:maths-year5-dev`.
- D1 duplicate Student + Lesson confirmation is idempotent.

## Phase 3 — COMPLETE

One complete real-shaped Maths lesson works end-to-end for the development student.

Verified journey:

`Subjects → Maths → Year 5 → Y5M1 → PreLesson → ScreenPal video → Homework → password-protected Answer Pack`

The lesson page and navigation are data-driven from KV/D1/R2 rather than a hard-coded lesson-specific page.

## Phase 4 — COMPLETE

Secure student authentication/session behaviour is now implemented and manually verified in the isolated V2 development environment.

Verified lifecycle:

`credentials → opaque HttpOnly cookie → hashed D1 session → authenticated lesson/resource access → sliding 2-hour inactivity → single-device replacement → logout/session-expiry invalidation`

Normal production student login remains disabled.

# GitHub

- Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`
- Default branch: `main`
- Development frontend: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`
- Phase 3 page: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`
- Phase 4 page: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase4.html`
- No production `CNAME` configured.
- Existing live portal repository remains separate and untouched.

## Important repo files

- `index.html` — development/status page.
- `phase3.html` — Phase 3 data-driven lesson proof.
- `phase4.html` — real-browser Phase 4 authentication/session proof.
- `assets/styles.css` — FPT visual shell/shared styles.
- `assets/phase3.js` — Phase 3 navigation/resource/protected-viewer logic.
- `assets/phase3-viewer.css` — protected PDF page-viewer styles.
- `assets/phase4-auth.js` — Phase 4 browser login/session proof logic; uses `credentials: include` and never reads the HttpOnly cookie.
- `assets/phase4-auth.css` — Phase 4 proof-page styles.
- `config.js` — V2 Worker base URL.
- `worker/src/index.js` — canonical V2 Worker source.
- `worker/migrations/0001_lesson_entitlements.sql` — D1 lesson-entitlement schema.
- `worker/migrations/0002_student_sessions.sql` — D1 server-session schema.
- `worker/migrations/0003_single_active_student_session.sql` — single-active-session migration/trigger.
- `docs/data/PHASE2_VERIFICATION.md`
- `docs/data/PHASE3_VERIFICATION.md`
- `docs/data/PHASE4_VERIFICATION.md`
- `README.md`
- `IMPLEMENTATION_HANDOVER.md`

# Cloudflare Worker

- Worker name: `fpt-portal-v2-worker`
- Worker URL: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`
- Environment: `development`
- Normal student login enabled: `false`
- Development login allowlist includes only the designated test user(s), currently `test0101`.

## Current routes relevant through Phase 4

- `GET /api/health` — infrastructure health.
- `GET /api/dev/phase2` — Phase 2 diagnostic.
- `GET /api/dev/phase3` — Phase 3 portal proof.
- `GET /api/dev/phase3/resource?resourceId=...` — Phase 3 unprotected R2 resource proof.
- `POST /api/dev/phase3/answer` — Phase 3 protected Answer Pack proof.
- `POST /api/v1/student/auth/login` — verifies allowed development credentials and creates an opaque server session.
- `POST /api/v1/student/auth/logout` — revokes the current session and clears its cookie.
- `GET /api/v1/student/session` — validates the current session and returns student/session state.
- `POST /api/v1/student/session/activity` — throttled sliding inactivity refresh.
- `GET /api/dev/phase4` — authenticated Phase 4 lesson-access proof.
- `GET /api/dev/phase4/resource` — authenticated Phase 4 resource proof.
- `POST /api/dev/phase4/answer` — authenticated Phase 4 protected Answer Pack proof.
- Other unimplemented `/api/*` routes return `501 NOT_IMPLEMENTED`.

## Environment variables/configuration

- `ENVIRONMENT = development`
- `ALLOWED_ORIGINS = https://futureperfecttuitions.github.io`
- `DEV_LOGIN_ALLOWLIST = test0101`
- Normal real-student login remains disabled server-side.

# Cloudflare bindings

| Worker binding | Cloudflare resource | Purpose |
|---|---|---|
| `STUDENTS_KV` | `FPT_PORTAL_V2_STUDENTS` | Manually maintained student/config records |
| `LESSONS_KV` | `FPT_PORTAL_V2_LESSONS` | Lesson catalogue/views/libraries |
| `DB` | `fpt_portal_v2_db` | Direct Student + Lesson entitlements and student sessions |
| `MATERIALS_R2` | `fpt-materials-dev` | Development PreLesson/Homework/Answer files |

# Student KV state through Phase 4

Two test-shape student keys currently coexist because Phase 2/3 and Phase 4 were developed incrementally:

- `student:test0101` — earlier Phase 2/3 development record.
- `user:test0101` — Phase 4 authentication-oriented record.

The Phase 4 record contains fields such as:

- `firstName`
- `p` — current development login password
- `answerPassword`
- `schoolYear`
- `vrEligible`
- `status`
- `expires`
- `batches`
- `fullLibraries`
- `manualAccess`
- `blockedLessons`

The final production student shape must follow the current Master Authoritative Specification; do not infer production schema from obsolete Phase 2-only field names.

# Lessons KV state through Phase 4

Key families include:

- `lesson:<LESSON_ID>` — canonical lesson metadata/resources.
- `view:<VIEW_ID>` — ordered student-facing Year/Level catalogue.
- `library:<LIBRARY_ID>` — continuing Full Library definition.

The implemented R2 path convention is lowercase subject + compact year + term + Lesson ID, e.g.:

`maths/Y5/Autumn/Y5M1/...`

Terms are R2 organisation only and do not create student navigation sections.

# D1 state

Database: `fpt_portal_v2_db`  
Database ID: `97250a54-fa91-45ad-a002-3c4566b1fc38`

## Table: `lesson_entitlements`

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

Current development rows include:

- `test0101 + DEV-M01`
- `test0101 + Y5M1`

## Table: `student_sessions`

Fields verified:

- `token_hash`
- `portal_user_id_norm`
- `created_at`
- `last_activity_at`
- `idle_expires_at`
- `revoked_at`

D1 stores only the SHA-256 hash of the opaque browser token; observed hexadecimal hash length is 64 characters.

### Single-active-session enforcement

Business rule: exactly one active session per Portal User ID; latest successful login wins.

Applied migration:

`worker/migrations/0003_single_active_student_session.sql`

Installed trigger:

`trg_student_sessions_single_active`

Mechanism: immediately before a new `student_sessions` row is inserted, D1 sets `revoked_at` on every older non-revoked session for the same `portal_user_id_norm`. This gives database-level server-side enforcement independent of browser behaviour.

This rule was manually proven with two browsers: the newer login remained valid and the earlier Chrome session was rejected on its next authenticated request.

# Phase 2 idempotency proof retained

The same Student + Lesson upsert was executed twice for `DEV-M01`.

Verified:

- row count remained 1;
- first-granted timestamp stayed unchanged;
- last-confirmed timestamp updated.

This remains the foundation for the later Excel sync workflow.

# Phase 3 implementation detail retained

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

## Protected viewer

The first Phase 3 implementation used a browser PDF iframe. Chrome displayed an intermediate PDF/Open surface, so it was replaced with a PDF.js canvas/page renderer.

This hides ordinary PDF download/print controls. It does not claim absolute anti-copy protection; screenshots and advanced browser inspection cannot be fully prevented on the web.

# Phase 4 verification — COMPLETE

A detailed test record is committed at:

`docs/data/PHASE4_VERIFICATION.md`

Manual verification completed on 21 August 2026 included the following.

## Regression protection

- Phase 2 diagnostic remained healthy.
- Phase 3 diagnostic remained healthy and still returned Y5M1 with PreLesson, ScreenPal, Homework and Answer Pack availability.

## Credentials and identity

- `TEST0101` successfully authenticated and normalised to `test0101`.
- Wrong valid-format password was rejected.
- Non-allowlisted `OTHER0101` was rejected.
- Generic invalid-login wording was shown.
- Normal student login remained disabled.

## Browser/session security

- Login issued `fpt_v2_session` as an opaque `HttpOnly`, `Secure` browser cookie.
- Browser authentication worked from GitHub Pages using `credentials: include`.
- Session token was never exposed to page JavaScript.
- D1 stored only the SHA-256 token hash.
- Session idle expiry was exactly two hours after activity.
- Refreshing authenticated activity moved both last-activity and idle-expiry timestamps forward by the same amount.

## Logout and expiry

- Logout cleared browser authentication and set `revoked_at` on the corresponding D1 row.
- Forced past `idle_expires_at` caused the next authenticated request to lose the session.
- Therefore session expiry is enforced server-side rather than merely displayed in the UI.

## Single-device login

- Existing active sessions were first cleared.
- D1 single-session trigger was installed and verified.
- Chrome logged in successfully.
- A second browser logged in as the same student.
- The second browser stayed authenticated.
- The original Chrome session became invalid on refresh.

Result: PASS — exactly one active session per Portal User ID; latest successful login wins.

## Withdrawn/expired account behaviour

Withdrawn-account test:

- `status` temporarily changed to `withdrawn`.
- student remained authenticated;
- session UI displayed `Locked`;
- lesson/resource proof was blocked;
- D1 entitlements were retained.

Expired-account test:

- `status` remained active;
- `expires` temporarily set to a past date;
- student remained authenticated;
- account displayed `Locked`;
- lesson/resource proof was blocked.

Test student was restored to `status: active`, `expires: null` after testing.

## Final clean-state proof

Correct credentials were entered again after all negative tests.

Observed:

- authenticated `Test · test0101` state;
- status `active`;
- last activity recorded;
- idle expiry exactly two hours later;
- green `Phase 4 browser authentication, server session and authenticated lesson access are working.` banner.

Phase 4 checkpoint is satisfied.

# Entitlement source rule retained

Effective lesson access will ultimately be the union of separate sources:

1. Excel-earned D1 direct entitlement.
2. Manual Student KV lesson access.
3. Applicable continuing Full Library access.

One source must not silently overwrite or destroy another.

# Deliberate non-actions through Phase 4

- No live-domain switch.
- No production `CNAME` on V2.
- No changes to the existing live portal/Worker/KVs.
- No normal real-student login enabled.
- No real production student population enabled yet.
- No real catalogue import yet.
- No Excel/VBA sync endpoint yet.
- No Admin console.
- No full English/VR production implementation yet.

# Manual Worker deployment rule

Canonical Worker source remains `worker/src/index.js` in GitHub. Worker deployment is currently manual through the Cloudflare code editor. Whenever Worker source changes, deploy the complete current file deliberately and run the relevant regression checks.

The Phase 4 single-session mechanism currently relies on the applied D1 trigger in `fpt_portal_v2_db`; it does not require a new Worker deployment because the trigger executes on the existing Worker session insert.

# Next incomplete phase

## Phase 5 — Build the V2 Visual Shell

Purpose: turn the proven Phase 4 authentication/session model and Phase 3 lesson journey into the real student-facing V2 shell while preserving the established Future Perfect Tuitions visual identity.

Key Phase 5 direction from the Steps/Master:

- preserve FPT navy/red palette, top bar/logo treatment, airmail border, rounded cards and pill/button language;
- responsive desktop/tablet/mobile layouts;
- keep login visually familiar;
- after login show first-name greeting;
- two top-level subject choices only: Maths and English;
- retain the secure Phase 4 session model unchanged;
- do not enable normal student access during development.

Phase 5 checkpoint: V2 visibly feels like the next version of the current FPT portal rather than a separate unrelated product, while authentication and existing lesson/resource regressions remain healthy.
