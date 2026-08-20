# FPT Portal V2 — Implementation Handover & Build State

**Cumulative version:** 2.1  
**Updated:** 20 August 2026  
**Completed through:** Phase 2 — Define and Implement the V2 Data Foundations

## Authority

Use this file together with:

1. `FPT Portal V2 Master Authoritative Specification` — business/workflow authority.
2. `FPT Portal V2 — Steps to Progression` — build-sequence authority.
3. This file — actual implementation state.

If implementation differs from an older technical suggestion, this file records what has actually been built. Business-rule changes must still be reflected in the Master Specification.

## Permanent Workflow Change-Control Rule

Whenever Sej changes a workflow, business rule or operating decision, use this sequence before continuing development:

1. **Record the new decision first.** Update the Master Authoritative Specification to state the new rule and issue a new version before implementing around the old rule.
2. **Assess the impact against reality.** Read the latest Implementation Handover and inspect the current GitHub/Cloudflare implementation so the exact affected components are identified rather than guessed.
3. **Update the build plan when necessary.** If the new decision changes phase order, checkpoints, launch criteria or testing requirements, update the Steps to Progression as well.
4. **Implement the smallest coherent technical change.** Change only the required Worker/frontend/KV/D1/R2/Excel components and do not silently revive superseded workflows.
5. **Test the affected workflow and relevant regressions.** Do not treat a code edit as complete until the changed behaviour has been demonstrated.
6. **Update the Implementation Handover last.** Record what was actually changed, the live technical names/schema/routes involved, and the verification result.

This is the permanent documentation discipline for Portal V2. The intended new-chat handoff is therefore: latest Master Specification + latest Steps to Progression + latest cumulative Implementation Handover, with GitHub reconnected when code inspection or modification is required.

## Overall status

### Phase 1 — COMPLETE

The isolated V2 development environment is operational and separate from the live portal.

Verified chain:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

`GET /api/health` returns `HTTP 200`, `infrastructureHealthy: true`, and all four backend bindings report `bound: true` and `ok: true`.

### Phase 2 — COMPLETE

The V2 data foundation has been defined, implemented and tested with dummy data.

Verified chain:

`Dummy Student KV + Dummy Lesson/View KV + D1 Student/Lesson Entitlement → Worker diagnostic`

`GET /api/dev/phase2` returns `HTTP 200`, `dataFoundationHealthy: true`, reads the dummy student/lesson/view, reads the D1 entitlement, and proves duplicate Student + Lesson confirmation is idempotent.

Normal student login remains disabled.

## GitHub

- Repository: `FuturePerfectTuitions/futureperfect-lessons-v2`
- Default branch: `main`
- Development frontend: `https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`
- No production `CNAME` is configured.
- Existing live portal repository remains separate and untouched.

### Important repo files currently present

- `index.html` — development/status page.
- `assets/styles.css` — initial FPT visual shell.
- `assets/app.js` — Worker connectivity/health tester.
- `config.js` — V2 Worker base URL configuration.
- `worker/src/index.js` — current V2 Worker source.
- `worker/wrangler.toml` — Worker configuration starter.
- `worker/migrations/0001_lesson_entitlements.sql` — applied Phase 2 D1 schema.
- `docs/data/STUDENT_KV_FORMAT.md` — implemented student record format.
- `docs/data/LESSON_KV_FORMAT.md` — implemented lesson/view/library format.
- `docs/data/PHASE2_SETUP.md` — Phase 2 setup instructions/status.
- `docs/data/PHASE2_VERIFICATION.md` — Phase 2 verification evidence.
- `examples/phase2/student-test0101.json` — dummy student.
- `examples/phase2/lesson-DEV-M01.json` — dummy lesson.
- `examples/phase2/view-maths-year5-dev.json` — dummy curriculum view.
- `.nojekyll`
- `README.md`
- `IMPLEMENTATION_HANDOVER.md`

## Cloudflare Worker

- Worker name: `fpt-portal-v2-worker`
- Worker URL: `https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`
- Environment: `development`
- Student login enabled: `false`

### Current routes

- `GET /api/health` — Phase 1 infrastructure health.
- `GET /api/dev/phase2` — development-only Phase 2 data-foundation diagnostic.
- Other `/api/*` routes currently return `501 NOT_IMPLEMENTED`.

### Environment variables

- `ENVIRONMENT = development`
- `ALLOWED_ORIGINS = https://futureperfecttuitions.github.io`

These are configuration values, not secrets.

## Cloudflare bindings

| Worker binding | Cloudflare resource | Purpose |
|---|---|---|
| `STUDENTS_KV` | `FPT_PORTAL_V2_STUDENTS` | Manually maintained student/configuration records |
| `LESSONS_KV` | `FPT_PORTAL_V2_LESSONS` | Manually maintained lesson catalogue/views/libraries |
| `DB` | `fpt_portal_v2_db` | Automated Student + Lesson entitlements from Excel |
| `MATERIALS_R2` | `fpt-materials-dev` | Development PreLesson/Homework/Answer/resource files |

## Phase 2 Student KV format

Canonical key:

`student:<portal-user-id-lowercase>`

Current dummy key:

`student:test0101`

Current dummy record contains:

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

Excel-earned lesson entitlements are deliberately not stored in the Student KV JSON.

## Phase 2 Lessons KV format

Implemented key families:

- `lesson:<LESSON_ID>` — canonical lesson metadata/resources.
- `view:<VIEW_ID>` — ordered student-facing curriculum list.
- `library:<LIBRARY_ID>` — continuing/dynamic Full Library definition.

Current dummy records:

- `lesson:DEV-M01`
- `view:maths-year5-dev`

The dummy view contains `lessonIds: ["DEV-M01"]`.

### Implementation note on technical key names

The implemented `lesson:*` + `view:*` structure is now the code-level data model. It differs from some earlier technical examples that proposed only `curriculum:*` keys, but it preserves the agreed business rules: canonical lesson records, chronological curriculum ordering and dynamic libraries. Future code work should use the implemented format unless Sej explicitly changes it.

## D1 state

- Database name: `fpt_portal_v2_db`
- Database ID: `97250a54-fa91-45ad-a002-3c4566b1fc38`
- Phase 2 table created: `lesson_entitlements`
- Index created: `idx_lesson_entitlements_lesson_id`

### `lesson_entitlements` schema

Primary key:

`(portal_user_id_norm, lesson_id)`

Fields:

- `portal_user_id_norm`
- `lesson_id`
- `core_access`
- `vr_access`
- `source` — currently constrained to `excel`
- `first_granted_at`
- `last_confirmed_at`
- `source_batch_code`
- `source_lesson_date`

### Implementation note on table naming

The implemented table is named `lesson_entitlements`. Some earlier blueprint text used the example name `excel_entitlements`. The implemented name/schema is now authoritative for code. The business meaning is unchanged: permanent direct Student + Lesson access created/confirmed by Excel.

## Dummy D1 entitlement used for Phase 2 testing

Current test row:

- `portal_user_id_norm = test0101`
- `lesson_id = DEV-M01`
- `core_access = 1`
- `vr_access = 0`
- `source = excel`
- `first_granted_at = 2026-08-20T19:40:00Z`
- `last_confirmed_at = 2026-08-20T20:40:00Z`
- `source_batch_code = Y5MF1`
- `source_lesson_date = 2026-08-20`

This is test-only data and must not be confused with production student data.

## Idempotency proof

The same Student + Lesson upsert was executed twice.

After the second execution:

- `rowCount` remained `1`.
- `firstGrantedAt` remained `2026-08-20T19:40:00Z`.
- `lastConfirmedAt` changed to `2026-08-20T20:40:00Z`.

Therefore a duplicate `Student + Lesson` confirmation updates the existing entitlement rather than creating a duplicate row. This is the required foundation for the later `SyncPortalEntitlements` workflow.

## Phase 2 diagnostic result

Observed from:

`https://fpt-portal-v2-worker.futureperfectlessons.workers.dev/api/dev/phase2`

Verified values:

```text
ok: true
phase: 2
dataFoundationHealthy: true

student:
  found: true
  portalUserId: Test0101
  schoolYear: 5
  vrEligible: false
  accountStatus: active
  batches: [Y5MF1]

lesson:
  found: true
  lessonId: DEV-M01
  title: Development Test Lesson
  subject: maths
  active: true

view:
  found: true
  viewId: maths-year5-dev
  lessonIds: [DEV-M01]

d1:
  readable: true
  rowCount: 1
  testEntitlement.found: true
  portalUserIdNorm: test0101
  lessonId: DEV-M01
  coreAccess: true
  vrAccess: false
  source: excel
```

No student passwords are returned by the Phase 2 diagnostic route.

## Effective entitlement-source rule established in Phase 2

Effective ordinary lesson access will later be calculated from the union of separate sources:

1. Excel-earned D1 direct entitlement.
2. Manual `manualLessonAccess` in Student KV.
3. Applicable continuing `fullLibraries` in Student KV / Lessons KV library definition.

One source must not silently overwrite or destroy another source.

## R2 state

- Development bucket: `fpt-materials-dev`.
- Worker binding: `MATERIALS_R2`.
- Phase 1 health check proves it can be listed.
- Phase 2 did not yet attach a real PreLesson/Homework/Answer Pack to the dummy lesson.

## Current Worker behaviour

`worker/src/index.js` currently:

- returns JSON with `Cache-Control: no-store`;
- allows the approved GitHub Pages development origin;
- responds to CORS preflight;
- exposes `GET /api/health`;
- verifies Students KV, Lessons KV, D1 and R2 bindings;
- exposes development-only `GET /api/dev/phase2`;
- reads the dummy student, lesson and curriculum view from KV;
- queries D1 row count and the exact `test0101 + DEV-M01` entitlement;
- deliberately excludes stored student passwords from diagnostic output;
- returns `501 NOT_IMPLEMENTED` for other `/api/*` routes;
- does not yet implement normal student authentication, curriculum navigation, lesson rendering or protected resource delivery.

## Deliberate non-actions through Phase 2

- No live-domain switch.
- No `CNAME` on V2.
- No changes to the existing live site/Worker/KVs.
- No real students added to V2.
- No real lesson catalogue loaded.
- No production lesson resources wired to the dummy lesson.
- No Answer Pack viewer/security implemented yet.
- No Excel/VBA API endpoint implemented yet.
- No Admin console.
- No normal student authentication enabled.

## Manual Worker deployment note

Canonical Worker source is committed in GitHub at `worker/src/index.js`, but deployment to Cloudflare is currently manual through the Cloudflare code editor. Whenever the Worker source changes, provide the full latest `index.js` for copy/paste and deployment until/if GitHub-driven Worker deployment is introduced later.

## Next incomplete phase

# Phase 3 — Get One Complete Maths Lesson Working End-to-End

Purpose: prove the architecture with one real-shaped Maths lesson before importing the full catalogue.

According to the agreed Steps to Progression, Phase 3 should:

1. Choose one simple Maths lesson, for example `Y5M1`.
2. Add its Lesson ID, title, description and curriculum position.
3. Attach one PreLesson Sheet from R2.
4. Attach the ScreenPal video.
5. Attach one Homework from R2.
6. Attach its password-protected Answer Pack.
7. Create/use one dummy student entitled to that lesson.
8. Render the full lesson page from data rather than hard-coding a lesson-specific page.
9. Prove the dummy journey through Maths → Year/Level → Lesson → PreLesson → Video → Homework → protected Answer Pack.

Normal student access remains disabled. Any temporary development-only mechanism used to exercise the Phase 3 journey must not enable the real student population; secure production-grade login/session handling is hardened in the following authentication phase.

Checkpoint: one complete Maths lesson works end-to-end from the V2 data model and private resources before scaling the catalogue.
