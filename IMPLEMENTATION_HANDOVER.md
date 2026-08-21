# FPT Portal V2 — Implementation Handover & Build State

**Cumulative version:** 3.3  
**Updated:** 21 August 2026  
**Completed through:** Phase 5 — Build the V2 Visual Shell

## Authority

Use this file together with:

1. the latest `FPT Portal V2 Master Authoritative Specification` — business/workflow authority;
2. the latest `FPT Portal V2 — Steps to Progression` — build-sequence authority;
3. this file — actual implementation state.

If implementation differs from an older technical suggestion, this file records what has actually been built. Business-rule changes must still be reflected in the Master Specification first.

## Permanent workflow change-control rule

Whenever Sej changes a workflow, business rule or operating decision:

1. update/version the Master Authoritative Specification first;
2. inspect the latest cumulative handover and actual GitHub/Cloudflare implementation;
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

`GET /api/health` previously verified `HTTP 200`, `infrastructureHealthy: true`, with all four bindings healthy.

## Phase 2 — COMPLETE

The V2 data foundation is implemented and tested with dummy data.

Verified:

- Student KV and Lesson/View/Library KV conventions.
- D1 `lesson_entitlements` table and index.
- Dummy development data.
- Duplicate Student + Lesson confirmation is idempotent.

## Phase 3 — COMPLETE

One complete real-shaped Maths lesson works end-to-end for the development student.

Verified journey:

`Subjects → Maths → Year 5 → Y5M1 → PreLesson → ScreenPal video → Homework → password-protected Answer Pack`

The lesson page and navigation are data-driven from KV/D1/R2 rather than hard-coded to one lesson.

## Phase 4 — COMPLETE

Secure student authentication/session behaviour is implemented and manually verified.

Verified lifecycle:

`credentials → opaque HttpOnly cookie → hashed D1 session → authenticated lesson/resource access → sliding 2-hour inactivity → single-device replacement → logout/session-expiry invalidation`

Exactly one active session is allowed per Portal User ID. Migration `0003_single_active_student_session.sql` installs D1 trigger `trg_student_sessions_single_active`; latest successful login wins.

Normal production student login remains disabled.

## Phase 5 — COMPLETE

The real V2 student-facing visual shell has been created at `phase5.html` while the Phase 3 and Phase 4 proof pages remain intact.

Implemented:

- real FPT logo copied into V2 as `assets/fpt-logo.png`;
- familiar FPT login screen using the secure Phase 4 session endpoints;
- FPT navy/red palette, pale-grey background, rounded white cards and full red/white/blue airmail viewport border;
- first-name-only greeting after login;
- easy-to-reach Logout;
- exactly two top-level subject choices: Maths and English;
- responsive CSS rules for desktop/tablet/mobile;
- no Basic Auth and no login password stored in browser sessionStorage/localStorage;
- withdrawn/expired authenticated accounts remain in locked state;
- Edge native password reveal is suppressed so the portal's explicit eye control is intended to be the sole reveal control.

Manual browser verification passed for:

- login screen presentation;
- authenticated Maths/English shell;
- logout back to login;
- show/hide password control;
- wrong-password generic rejection;
- correct-login return to the shell.

Detailed record: `docs/data/PHASE5_VERIFICATION.md`.

Phase 5 checkpoint is satisfied: V2 visibly feels like the next version of the existing FPT portal rather than an unrelated product.

# GitHub and development URLs

- Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`
- Default branch: `main`
- Development status: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`
- Phase 3 lesson proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`
- Phase 4 authentication proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase4.html`
- Phase 5 student shell: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase5.html`
- Worker: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`
- No production `CNAME` configured.
- Existing live portal repository remains separate and untouched.

## Important repo files

- `index.html` — development/status page.
- `phase3.html` — Phase 3 data-driven lesson proof.
- `phase4.html` — Phase 4 authentication/session proof.
- `phase5.html` — Phase 5 real student-facing shell under development.
- `assets/fpt-logo.png` — real FPT logo used by V2.
- `assets/styles.css` — earlier shared development/proof styles.
- `assets/phase3.js` — Phase 3 navigation/resource/protected-viewer logic.
- `assets/phase3-viewer.css` — PDF.js protected-viewer styles.
- `assets/phase4-auth.js` / `assets/phase4-auth.css` — Phase 4 browser auth proof.
- `assets/phase5.js` / `assets/phase5.css` — Phase 5 secure student shell and visual styling.
- `config.js` — V2 Worker base URL.
- `worker/src/index.js` — canonical V2 Worker source.
- `worker/migrations/0001_lesson_entitlements.sql`
- `worker/migrations/0002_student_sessions.sql`
- `worker/migrations/0003_single_active_student_session.sql`
- `docs/data/PHASE2_VERIFICATION.md`
- `docs/data/PHASE3_VERIFICATION.md`
- `docs/data/PHASE4_VERIFICATION.md`
- `docs/data/PHASE5_VERIFICATION.md`

# Cloudflare Worker

- Worker name: `fpt-portal-v2-worker`
- Environment: `development`
- `DEV_LOGIN_ALLOWLIST` currently permits the designated test user `test0101`.
- Normal real-student login remains disabled server-side.

## Current routes through Phase 5

Implemented:

- `GET /api/health`
- `GET /api/dev/phase2`
- `GET /api/dev/phase3`
- `GET /api/dev/phase3/resource?resourceId=...`
- `POST /api/dev/phase3/answer`
- `POST /api/v1/student/auth/login`
- `POST /api/v1/student/auth/logout`
- `GET /api/v1/student/session`
- `POST /api/v1/student/session/activity`
- `GET /api/dev/phase4`
- `GET /api/dev/phase4/resource`
- `POST /api/dev/phase4/answer`

Other unimplemented `/api/*` routes currently return `501 NOT_IMPLEMENTED`.

The Master-spec Phase 6+ student routes such as `GET /api/v1/student/home` and `GET /api/v1/student/views/{viewId}/lessons` are not implemented yet.

# Current storage state

## Student KV

Two development-shape keys still coexist because the project was built incrementally:

- `student:test0101` — earlier Phase 2/3 proof record.
- `user:test0101` — current Phase 4/5 authentication-oriented record using the Master-spec credential/status field names.

Production work must follow the latest Master Specification, not obsolete Phase 2-only field names.

## Lessons KV

Key families already in use:

- `lesson:<LESSON_ID>` — canonical lesson metadata/resources;
- `view:<VIEW_ID>` — ordered Year/Level catalogue;
- `library:<LIBRARY_ID>` — dynamic Full Library definition.

Current proof lesson:

- `lesson:Y5M1`
- `view:maths-year5`
- ScreenPal `cOV0omn3XVh`
- D1 direct entitlement `test0101 + Y5M1`.

## D1

Database: `fpt_portal_v2_db`  
Database ID: `97250a54-fa91-45ad-a002-3c4566b1fc38`

Implemented tables through Phase 5:

- `lesson_entitlements`
- `student_sessions`

Single-active-session trigger:

- `trg_student_sessions_single_active`

The remaining minimal D1 tables for Excel sync/start-point work are later phases.

# Entitlement source rule retained

Effective lesson access must ultimately be the union of separate sources:

1. Excel-earned D1 direct entitlement;
2. manual Student KV lesson access;
3. applicable continuing Full Library access.

One source must not silently overwrite or destroy another.

# Deliberate non-actions through Phase 5

- No live-domain switch.
- No production `CNAME` on V2.
- No changes to the existing live portal/Worker/KVs.
- No normal real-student login enabled.
- No real production student population enabled yet.
- No real catalogue import yet.
- No Excel/VBA sync endpoint yet.
- No Admin console.
- No full English/VR production implementation yet.
- No Phase 6 Year/Level entitlement navigation yet.

# Manual Worker deployment rule

Canonical Worker source is `worker/src/index.js` in GitHub. Worker deployment is currently manual through Cloudflare. Whenever Worker source changes, deploy the complete current file deliberately and run relevant regression checks before the phase is treated as complete.

# Next incomplete phase

## Phase 6 — Build Curriculum Navigation

Purpose: turn the entitlement/configuration rules into the authenticated student's actual Year/Level navigation.

Required behaviour from the current Master/Steps includes:

- Maths uses Year terminology for normal streams and Level terminology for 11+ where applicable;
- English uses Year / Year 11+ presentation while sharing one core curriculum internally;
- relevant accessible/preview Year or Level entries are chronological;
- no Current/Previous grouping;
- no internal Batch ID in the UI;
- lesson lists show Lesson ID + title + open/locked state only;
- one continuous canonical lesson list with no term sections;
- entitled historical lessons remain available while the account is active;
- future unreleased lessons in a currently studied subject remain hidden;
- agreed cross-subject locked previews are computed server-side;
- locked lesson metadata must not expose R2 paths, private URLs or ScreenPal references;
- all access decisions remain Worker-authoritative.

Phase 6 requires new authenticated student-navigation Worker routes plus frontend screens beyond the current Maths/English shell. Existing Phase 3/4/5 behaviour must remain healthy while this is introduced.
