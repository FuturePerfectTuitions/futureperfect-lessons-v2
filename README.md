# Future Perfect Tuitions — Student Portal V2

Isolated development repository for the next-generation Future Perfect Tuitions student portal.

## Completed status

### Phase 1 — COMPLETE

The isolated V2 infrastructure foundation has been built and verified end-to-end:

`GitHub Pages → V2 Worker → Students KV + Lessons KV + D1 + R2`

### Phase 2 — COMPLETE

The V2 data foundation has been defined, implemented and tested with dummy data.

Verified:

- Student KV format and key convention.
- Lesson/View/Library KV format and key conventions.
- D1 `lesson_entitlements` table and index.
- Dummy student `student:test0101`.
- Dummy lesson `lesson:DEV-M01`.
- Dummy curriculum view `view:maths-year5-dev`.
- Development diagnostic route `GET /api/dev/phase2`.
- D1 entitlement `test0101 + DEV-M01` reads correctly.
- Duplicate Student + Lesson upsert is idempotent.

### Phase 3 — COMPLETE

One complete real-shaped Maths lesson now works end-to-end for the development student.

Proof lesson:

- Lesson: `Y5M1 Number and Place Value I`
- Lesson KV: `lesson:Y5M1`
- View KV: `view:maths-year5`
- ScreenPal: `cOV0omn3XVh`
- Development student: `Test0101`
- D1 entitlement: `test0101 + Y5M1`

Verified student journey:

`Subjects → Maths → Year 5 → Y5M1 → PreLesson Sheet → embedded ScreenPal video → Homework → password-protected Answer Pack`

Verified protected-answer behaviour:

- wrong password is rejected;
- show/hide eye works;
- correct password opens the Answer Pack;
- pages render inside a custom PDF.js viewer;
- no normal browser PDF download/print toolbar is shown;
- a small `Test0101 — Future Perfect Tuitions` on-screen watermark is displayed;
- the Answer Pack password is required each time the protected resource is reopened.

This is still a development proof. Production-grade login/session security is Phase 4.

## Development URLs

Main development status:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/`

Phase 3 lesson proof:

`https://futureperfecttuitions.github.io/futureperfect-lessons-v2/phase3.html`

## Worker

Worker name:

`fpt-portal-v2-worker`

Worker URL:

`https://fpt-portal-v2-worker.futureperfectlessons.workers.dev`

Current Worker source:

`worker/src/index.js`

Current development routes:

- `GET /api/health`
- `GET /api/dev/phase2`
- `GET /api/dev/phase3`
- `GET /api/dev/phase3/resource`
- `POST /api/dev/phase3/answer`

## Cloudflare resources

| Binding | Resource |
|---|---|
| `STUDENTS_KV` | `FPT_PORTAL_V2_STUDENTS` |
| `LESSONS_KV` | `FPT_PORTAL_V2_LESSONS` |
| `DB` | `fpt_portal_v2_db` |
| `MATERIALS_R2` | `fpt-materials-dev` |

Environment variables:

- `ENVIRONMENT=development`
- `ALLOWED_ORIGINS=https://futureperfecttuitions.github.io`

## Documentation

- `IMPLEMENTATION_HANDOVER.md`
- `docs/data/STUDENT_KV_FORMAT.md`
- `docs/data/LESSON_KV_FORMAT.md`
- `docs/data/PHASE2_SETUP.md`
- `docs/data/PHASE2_VERIFICATION.md`
- `docs/data/PHASE3_VERIFICATION.md`
- `worker/migrations/0001_lesson_entitlements.sql`

## Safety rule

The existing live portal, existing live Worker and existing live KV namespaces must remain untouched while V2 is being built and tested.

Normal student login remains disabled until the authentication phase is complete and deliberately switched on.

## Next phase

**Phase 4 — Build Secure Student Authentication.**

Replace the fixed development-student mechanism with real username/password authentication and secure sessions while preserving the Phase 3 data-driven lesson journey.