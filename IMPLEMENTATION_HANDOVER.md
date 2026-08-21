# FPT Portal V2 — Implementation Handover & Build State

**Cumulative version:** 3.4  
**Updated:** 21 August 2026  
**Completed through:** Phase 6 — Build Curriculum Navigation

## Authority

Use this file together with:

1. the latest `FPT Portal V2 Master Authoritative Specification` — business/workflow authority;
2. the latest `FPT Portal V2 — Steps to Progression` — build-sequence authority;
3. this file — actual implementation state;
4. the current GitHub/Cloudflare state — final authority for what is actually deployed.

Current governing document versions after Phase 6 business-rule correction:

- Master Authoritative Specification v2.3 — 21 August 2026;
- Steps to Progression v1.3 — 21 August 2026.

## Permanent workflow rules

Whenever Sej changes a workflow, business rule or operating decision:

1. update/version the Master Authoritative Specification first;
2. inspect the latest cumulative handover and actual GitHub/Cloudflare implementation;
3. update Steps to Progression if phase order/checkpoints/testing change;
4. implement only the required coherent technical changes;
5. demonstrate the changed workflow and relevant regressions;
6. update this cumulative Implementation Handover last.

Do not allow documentation and the deployed system to drift apart.

### Phase-boundary workflow

From Phase 6 onward:

- fully finish and verify the current phase;
- create/update the completed cumulative handover before the next phase starts;
- stop at that point;
- begin every new phase in a new chat;
- in the new chat, read the latest Master + Steps + Handover, reconnect to GitHub and inspect the real implementation before making changes.

### Manual-instruction workflow

Sej is a beginner with Cloudflare/KV/D1 operations.

- Give Cloudflare/KV/D1/manual-deployment instructions in small explicit steps.
- Prefer one risky/manual configuration step at a time and wait for confirmation/screenshot.
- Simple browser checks may be grouped into two or three actions when safe.
- Never assume familiarity with Worker variables, KV namespaces, D1 Studio or deployment controls.

# Overall status

## Phase 1 — COMPLETE

Isolated V2 development environment verified:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

Existing live portal remains separate.

## Phase 2 — COMPLETE

Data foundation and idempotent Student + Lesson entitlement model verified with dummy data.

## Phase 3 — COMPLETE

One complete real-shaped Maths lesson works end-to-end through PreLesson, ScreenPal video, Homework and protected Answer Pack.

Canonical proof lesson remains `lesson:Y5M1`.

## Phase 4 — COMPLETE

Secure student authentication/session model implemented and verified:

- case-insensitive username;
- agreed 4-character password;
- opaque HttpOnly/Secure browser session;
- hashed D1 token storage;
- two-hour sliding inactivity timeout;
- exactly one active session per Portal User ID — latest login wins;
- logout/session expiry invalidation;
- development allowlist;
- locked withdrawn/expired account behaviour.

Migration `0003_single_active_student_session.sql` installs trigger `trg_student_sessions_single_active`.

Normal production student login remains disabled.

## Phase 5 — COMPLETE

Real FPT visual shell implemented and browser-verified:

- real FPT logo;
- navy/red palette, pale-grey background and rounded white cards;
- full red/white/blue airmail border;
- familiar Student Login;
- password eye with Edge native duplicate eye suppressed;
- first-name greeting;
- exactly Maths and English at top level;
- secure Phase 4 session retained;
- responsive desktop/tablet/mobile CSS rules;
- logout and generic invalid-login behaviour verified.

Detailed verification: `docs/data/PHASE5_VERIFICATION.md`.

## Phase 6 — COMPLETE

Curriculum navigation is implemented and manually verified.

### Frontend

- `phase6.html`
- `assets/phase6.css`
- `assets/phase6.js`

Verified hierarchy:

`Login → Maths / English → Year or Level → continuous chronological lesson list`

No Current/Previous grouping. No Autumn/Spring/Summer sections. No internal Batch ID shown.

### Authenticated Worker navigation API

Implemented and deployed:

- `GET /api/v1/student/home`
- `GET /api/v1/student/views/{viewId}/lessons`

The Worker is authoritative for current Year/Level presentation, historical views, Full Libraries, direct/manual lesson access, blocked lessons, cross-subject previews and 11+ start-point visibility.

### 11+ curriculum start point

Migration installed and verified:

- `worker/migrations/0004_curriculum_start_points.sql`

D1 table:

- `curriculum_start_points`

The start point changes presentation only: earlier missed lessons may be shown locked, current entitled lessons remain open, and future unreleased lessons remain hidden.

### Phase 6 personas verified

`Test0101` — normal Year 5 Maths:

- Maths → Year 5;
- canonical Y5M1 open;
- English → Year 5 locked preview;
- search/back/logout verified.

`Test0202` — Year 5 English only:

- English → Year 5 current view;
- English catalogue correctly reports unavailable because production English content has not yet been loaded;
- Maths → Year 5 locked preview;
- existing Y5M1 row appears locked;
- no internal Batch ID shown.

`Test0303` — Year 5 11+ Maths:

- Maths → Level 2 from `MATHS_L2_FULL`;
- Maths → Level 3 as current Year 5 11+ curriculum;
- no duplicate Year 5 Maths view for shared canonical Level 2 content;
- Level 3 earlier fixture lesson locked;
- Level 3 current fixture lesson available;
- Level 3 future fixture lesson hidden;
- English → Year 5 11+ locked cross-subject preview.

Detailed verification: `docs/data/PHASE6_VERIFICATION.md`.
Fixture definitions: `docs/data/PHASE6_PERSONA_FIXTURES.md`.

### Student-facing Lesson ID rule added in Phase 6

A business-rule correction was identified during testing and recorded in Master v2.3 / Steps v1.3.

Canonical/internal Lesson ID and student-facing Lesson ID are separate concepts.

Example for the same shared `MATHS_L2` canonical lesson:

- normal Year 5 presentation: `Y5T1M01 Number and Place Value I`;
- Level 2 / 11+ presentation: `L2T1M01 Number and Place Value I`.

The canonical/internal entitlement/content key remains `Y5M1` in the current proof data. The presentation alias changes by Year/Level and does not create duplicate entitlement.

Phase 6 browser testing verified both Year 5 and Level 2 aliases.

# GitHub and development URLs

- Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`
- Default branch: `main`
- Development status: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`
- Phase 3 proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`
- Phase 4 proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase4.html`
- Phase 5 shell: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase5.html`
- Phase 6 navigation proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase6.html`
- Worker: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`
- No production `CNAME` configured.
- Existing live portal repository remains separate and untouched.

## Important repo files

- `index.html` — development/status page.
- `phase3.html` — Phase 3 lesson proof.
- `phase4.html` — Phase 4 authentication/session proof.
- `phase5.html` — completed visual-shell proof.
- `phase6.html` — completed curriculum-navigation proof.
- `assets/fpt-logo.png` — real FPT logo.
- `assets/phase3.js` / `assets/phase3-viewer.css` — Phase 3 resource/protected viewer.
- `assets/phase4-auth.js` / `assets/phase4-auth.css` — Phase 4 auth proof.
- `assets/phase5.js` / `assets/phase5.css` — Phase 5 shell.
- `assets/phase6.js` / `assets/phase6.css` — Phase 6 Year/Level navigation, lesson-list search and student-facing ID presentation.
- `config.js` — Worker base URL.
- `worker/src/index.js` — canonical V2 Worker source.
- `worker/migrations/0001_lesson_entitlements.sql`
- `worker/migrations/0002_student_sessions.sql`
- `worker/migrations/0003_single_active_student_session.sql`
- `worker/migrations/0004_curriculum_start_points.sql`
- `docs/data/PHASE2_VERIFICATION.md`
- `docs/data/PHASE3_VERIFICATION.md`
- `docs/data/PHASE4_VERIFICATION.md`
- `docs/data/PHASE5_VERIFICATION.md`
- `docs/data/PHASE6_VERIFICATION.md`
- `docs/data/PHASE6_PERSONA_FIXTURES.md`

# Cloudflare Worker

- Worker name: `fpt-portal-v2-worker`
- Environment: `development`
- Development allowlist currently includes `test0101,test0202,test0303` for Phase 6 testing.
- Normal real-student login remains disabled server-side.

## Implemented routes through Phase 6

- `GET /api/health`
- `GET /api/dev/phase2`
- `GET /api/dev/phase3`
- `GET /api/dev/phase3/resource?resourceId=...`
- `POST /api/dev/phase3/answer`
- `POST /api/v1/student/auth/login`
- `POST /api/v1/student/auth/logout`
- `GET /api/v1/student/session`
- `POST /api/v1/student/session/activity`
- `GET /api/v1/student/home`
- `GET /api/v1/student/views/{viewId}/lessons`
- `GET /api/dev/phase4`
- `GET /api/dev/phase4/resource`
- `POST /api/dev/phase4/answer`

Other unimplemented `/api/*` routes return `501 NOT_IMPLEMENTED`.

# Current storage state

## Student KV

Development records include:

- `student:test0101` — earlier Phase 2/3 proof record;
- `user:test0101` — current normal Year 5 Maths auth persona;
- `user:test0202` — Phase 6 Year 5 English-only persona;
- `user:test0303` — Phase 6 Year 5 11+ Maths persona.

Production work must follow the latest Master Specification rather than obsolete Phase 2-only fields.

## Lessons KV

Key families in use:

- `lesson:<LESSON_ID>` — canonical/internal lesson metadata/resources;
- `curriculum:<CURRICULUM_CODE>` — canonical curriculum ordering;
- legacy/proof `view:<VIEW_ID>` keys retained as fallbacks during incremental development;
- `library:<LIBRARY_ID>` where applicable.

Current proof data includes canonical `lesson:Y5M1` and Phase 6 development Level 3 fixture lessons.

## D1

Database: `fpt_portal_v2_db`

Implemented tables:

- `lesson_entitlements`
- `student_sessions`
- `curriculum_start_points`

Single-active-session trigger:

- `trg_student_sessions_single_active`

# Entitlement source rule retained

Effective ordinary lesson access is the union of independent sources:

1. Excel-earned D1 direct entitlement;
2. manual Student KV lesson access;
3. applicable continuing Full Library access.

One source must not silently overwrite or destroy another.

# Deliberate non-actions through Phase 6

- No live-domain switch.
- No production `CNAME` on V2.
- No changes to the existing live portal/Worker/KVs.
- No normal real-student login enabled.
- No production student population enabled yet.
- No real production catalogue import yet.
- No Excel/VBA sync endpoint yet.
- No Admin console.
- No full English/VR production implementation yet.
- No complete Phase 7 reusable lesson-page renderer yet.

# Manual Worker deployment rule

Canonical Worker source is `worker/src/index.js` in GitHub. Worker deployment is currently manual through Cloudflare. Whenever Worker source changes, deploy the complete current file deliberately and run relevant regressions before treating the phase as complete.

# Next incomplete phase

## Phase 7 — Build the Complete Lesson Page Renderer

Purpose: create one reusable data-driven lesson-page component that can render differently structured normal Maths and English lessons.

Required behaviour from the current Steps includes:

- show student-facing Lesson ID, title and full description/topics;
- show PreLesson Sheets only when present and support zero/one/many;
- show one main ScreenPal lesson video when present;
- support zero/one/many Homework items;
- pair each Homework explicitly with its own Answer Pack;
- show optional Other Resources;
- hide empty sections entirely;
- ensure downloadable resources remain behind Worker access validation;
- preserve easy Back navigation and Logout;
- do not expose R2 paths, private URLs or raw ScreenPal IDs in student UI.

Phase 7 must begin in a new chat. Before coding, read the latest Master v2.3, Steps v1.3 and this handover, reconnect to GitHub and inspect the current implementation.
