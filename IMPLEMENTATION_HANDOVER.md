# FPT Portal V2 — Implementation Handover & Build State

**Cumulative version:** 3.5  
**Updated:** 21 August 2026  
**Completed through:** Phase 7 — Complete Lesson Page Renderer

## Authority

Use this file together with:

1. the latest `FPT Portal V2 Master Authoritative Specification` — business/workflow authority;
2. the latest `FPT Portal V2 — Steps to Progression` — build-sequence/checkpoint authority;
3. this file — actual implementation state;
4. the current GitHub/Cloudflare state — final authority for what is actually deployed.

Current governing document versions after the Phase 7 upsell-presentation refinement:

- Master Authoritative Specification v2.4 — 21 August 2026;
- Steps to Progression v1.4 — 21 August 2026.

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
- password eye;
- first-name greeting;
- exactly Maths and English at top level;
- secure Phase 4 session retained;
- responsive desktop/tablet/mobile CSS rules;
- logout and generic invalid-login behaviour verified.

Detailed verification: `docs/data/PHASE5_VERIFICATION.md`.

## Phase 6 — COMPLETE

Curriculum navigation is implemented and manually verified.

Verified hierarchy:

`Login → Maths / English → Year or Level → continuous chronological lesson list`

Worker-authoritative navigation covers current Year/Level presentation, historical access, Full Libraries, cross-subject previews, blocked lessons, direct/manual entitlements and the 11+ start-point rule.

Authenticated routes:

- `GET /api/v1/student/home`
- `GET /api/v1/student/views/{viewId}/lessons`

Migration installed:

- `worker/migrations/0004_curriculum_start_points.sql`

Detailed verification:

- `docs/data/PHASE6_VERIFICATION.md`
- `docs/data/PHASE6_PERSONA_FIXTURES.md`

### Student-facing Lesson ID rule

Canonical/internal Lesson ID and student-facing Lesson ID are separate concepts.

For the shared proof lesson with canonical key `Y5M1`:

- normal Year 5 presentation: `Y5T1M01 Number and Place Value I`;
- Level 2 / 11+ presentation: `L2T1M01 Number and Place Value I`.

The presentation alias changes by Year/Level without duplicating entitlement.

## Phase 7 — COMPLETE

One reusable ordinary lesson-page renderer is implemented and browser-verified at `phase7.html`.

### Frontend

Phase 7 files:

- `phase7.html`
- `assets/phase7.css`
- `assets/phase7.js`
- `assets/phase7-upsell.js`

The renderer is data-driven and handles ordinary Maths/English lesson packages without lesson-specific page code.

Verified:

- student-facing Lesson ID + title + full description/topics;
- zero/one/many PreLesson Sheets;
- zero/one main ScreenPal video;
- zero/one/many Homework items;
- explicit Homework → Answer Pack pairing;
- optional Other Resources;
- empty sections hidden entirely;
- Back navigation and Logout retained.

### Phase 7 Worker adapter

Repository source:

- completed Phase 6 base Worker: `worker/src/index.js`;
- Phase 7 adapter: `worker/src/index-phase7.js`.

The Phase 7 adapter composes the existing Worker instead of replacing authentication/navigation logic.

Added/augmented routes:

- augmented `GET /api/v1/student/views/{viewId}/lessons` with display IDs;
- `GET /api/v1/student/lessons/{lessonId}?viewId={viewId}`;
- `GET /api/v1/student/resources/{resourceKey}/download?viewId={viewId}`;
- `GET /api/v1/student/resources/{resourceKey}/video?viewId={viewId}`.

Manual Cloudflare deployment currently mirrors this composition with a base Phase 6 module plus Phase 7 adapter/entry module.

### Resource safety

For a locked lesson, the safe lesson model exposes resource display names/structure but not usable resource keys. Download/video handlers re-check lesson visibility and reject locked lesson access server-side.

Raw R2 object paths, direct private URLs and raw ScreenPal IDs are not exposed in locked student-facing lesson data.

For an open lesson, downloadable resources are served through Worker access validation.

Phase 8 remains responsible for the stronger per-open Answer Pack/Answer Key password gate and controlled protected-answer viewer.

### Phase 7 fixtures/browser tests

`test0101` / real-shaped `Y5M1`:

- Year 5 alias `Y5T1M01`;
- PreLesson download works;
- ScreenPal video embeds;
- Homework download works;
- Answer Pack is visibly protected.

`DEV-P7-MIN`:

- no PreLesson, video, Homework or Other Resources;
- all empty sections disappear entirely.

`DEV-P7-MANY`:

- two PreLesson Sheets;
- one video;
- two Homework/Answer Pack pairs;
- two Other Resources;
- repeated items render independently with correct pairing.

`DEV-P7-ENGLISH`:

- ordinary English fixture renders through the same reusable lesson page;
- VR intentionally absent because VR remains Phase 9.

Detailed fixture definitions:

- `docs/data/PHASE7_FIXTURES.md`

Detailed verification:

- `docs/data/PHASE7_VERIFICATION.md`

### Cross-subject upsell presentation refinement

Business rule agreed during Phase 7:

- cross-subject Year/Level cards must not advertise the lock prematurely;
- cross-subject lesson-list rows remain navigable and do not show Locked;
- the first explicit Locked/Preview indication appears on the individual lesson page;
- that page may show lesson metadata, actual section structure and resource display names;
- actual resources remain locked and inaccessible.

Browser-verified with `test0202` viewing the real-shaped Maths `Y5M1` as an English-only student's cross-subject preview.

This rule is incorporated into Master v2.4 and Steps v1.4.

### Phase 7 display-ID regression correction

During browser testing, `lesson:Y5M1` was found to lack its required `displayIds` field in Lessons KV.

Added:

```json
"displayIds": {
  "maths-year5": "Y5T1M01",
  "maths-level2": "L2T1M01"
}
```

Regression proof:

- `test0202` cross-subject Year 5 Maths list/page shows `Y5T1M01`;
- `test0303` Level 2 list shows `L2T1M01`;
- canonical entitlement key remains `Y5M1`.

# GitHub and development URLs

- Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`
- Default branch: `main`
- Development status: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`
- Phase 3 proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`
- Phase 4 proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase4.html`
- Phase 5 shell: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase5.html`
- Phase 6 navigation proof: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase6.html`
- Phase 7 lesson renderer: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase7.html`
- Worker: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`
- No production `CNAME` configured.
- Existing live portal repository remains separate and untouched.

## Important repo files

- `index.html` — development/status page.
- `phase3.html` — Phase 3 lesson proof.
- `phase4.html` — Phase 4 authentication/session proof.
- `phase5.html` — completed visual-shell proof.
- `phase6.html` — completed curriculum-navigation proof.
- `phase7.html` — completed reusable ordinary lesson-page proof.
- `assets/fpt-logo.png` — real FPT logo.
- `assets/phase5.js` / `assets/phase5.css` — Phase 5 shell.
- `assets/phase6.js` / `assets/phase6.css` — Phase 6 curriculum navigation.
- `assets/phase7.js` / `assets/phase7.css` — Phase 7 lesson rendering.
- `assets/phase7-upsell.js` — cross-subject upsell presentation refinement.
- `config.js` — Worker base URL.
- `worker/src/index.js` — completed Phase 6 base Worker source.
- `worker/src/index-phase7.js` — Phase 7 Worker adapter.
- `worker/migrations/0001_lesson_entitlements.sql`
- `worker/migrations/0002_student_sessions.sql`
- `worker/migrations/0003_single_active_student_session.sql`
- `worker/migrations/0004_curriculum_start_points.sql`
- `docs/data/PHASE6_VERIFICATION.md`
- `docs/data/PHASE6_PERSONA_FIXTURES.md`
- `docs/data/PHASE7_VERIFICATION.md`
- `docs/data/PHASE7_FIXTURES.md`

# Cloudflare Worker

- Worker name: `fpt-portal-v2-worker`
- Environment: `development`
- Development allowlist includes `test0101,test0202,test0303` for current testing.
- Normal real-student login remains disabled server-side.
- Worker deployment remains manual through Cloudflare during development.

# Current storage state

## Student KV

Development records include:

- `student:test0101` — earlier Phase 2/3 proof record;
- `user:test0101` — current normal Year 5 Maths auth persona;
- `user:test0202` — Year 5 English-only persona;
- `user:test0303` — Year 5 11+ Maths persona.

## Lessons KV

Key families in use:

- `lesson:<LESSON_ID>` — canonical/internal lesson metadata/resources;
- `curriculum:<CURRICULUM_CODE>` — canonical curriculum ordering;
- legacy/proof `view:<VIEW_ID>` keys retained as fallbacks during incremental development;
- `library:<LIBRARY_ID>` where applicable.

Current Phase 7 development data includes:

- canonical `lesson:Y5M1` with Year 5/Level 2 `displayIds`;
- `lesson:DEV-P7-MIN`;
- `lesson:DEV-P7-MANY`;
- `lesson:DEV-P7-ENGLISH`;
- `curriculum:ENGLISH_Y5` development proof catalogue;
- Year 5 Maths fallback proof catalogue containing `Y5M1`, `DEV-P7-MIN`, `DEV-P7-MANY`.

## D1

Database: `fpt_portal_v2_db`

Implemented tables:

- `lesson_entitlements`
- `student_sessions`
- `curriculum_start_points`

Single-active-session trigger:

- `trg_student_sessions_single_active`

Phase 7 development direct entitlements exist for:

- `test0101 + DEV-P7-MIN`;
- `test0101 + DEV-P7-MANY`.

The current `lesson_entitlements.source` CHECK permits only `excel`, so these development rows use `source='excel'` with `source_batch_code='DEV-P7'`.

# Entitlement source rule retained

Effective ordinary lesson access remains the union of independent sources:

1. Excel-earned D1 direct entitlement;
2. manual Student KV lesson access;
3. applicable continuing Full Library access.

One source must not silently overwrite or destroy another.

# Safety / deliberate non-actions through Phase 7

- No live-domain switch.
- No production `CNAME` on V2.
- No changes to the existing live portal/Worker/KVs.
- No normal real-student login enabled.
- No production student population enabled yet.
- No real production catalogue import yet.
- No Excel/VBA sync endpoint yet.
- No Admin console.
- No full English/VR production implementation yet.
- No Phase 8 Answer Pack/Answer Key protection implementation yet.

# Phase 7 checkpoint result

**PASS — Phase 7 is complete.**

A range of differently structured ordinary lesson packages render correctly through one reusable page without page-specific code. Empty sections disappear, multiple resources/pairs render correctly, resources remain Worker-gated, cross-subject upsell pages expose safe metadata/structure without granting access, and view-specific student-facing IDs are correct for both Year 5 and Level 2.

# Next incomplete phase

## Phase 8 — Build Answer Pack and Answer Key Protection

Purpose: add the extra per-open password gate and controlled protected-answer viewer.

Required behaviour from the current Steps includes:

- every protected Answer Pack/Answer Key open prompts for the student's current Answer Pack password;
- provide show/hide eye control;
- do not create a session-wide unlock;
- validate active login session, lesson entitlement, resource ownership and current Answer Pack password before opening;
- serve protected material through the controlled viewer rather than exposing a raw R2 URL;
- disable normal download/print controls in the viewer UI;
- display the small student-username/FPT on-screen watermark/header;
- invalidate protected access when the main session expires or the Answer Pack password changes.

Phase 8 must begin in a new chat. Before coding, read the latest Master v2.4, Steps v1.4 and this v3.5 handover, reconnect to GitHub and inspect the current implementation.

# New-chat start prompt

Continue FPT Portal V2. Start Phase 8 only. Read the latest Master Authoritative Specification v2.4, Steps to Progression v1.4 and Implementation Handover v3.5 first. Reconnect to the GitHub repository FuturePerfectTuitions/futureperfect-lessons-v2 and inspect the actual current implementation before changing anything. Phase 7 is complete. Build Answer Pack and Answer Key protection only, without changing the existing live portal. For any Cloudflare/KV/D1/manual step, guide me as a beginner in small explicit steps.